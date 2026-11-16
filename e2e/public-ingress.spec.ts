import { expect, test } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'

function design(kind: 'direct' | 'azure-firewall' | 'nva-vm') {
  const topology = createEmptyAzNetTopology(), owner = { kind: 'vnet' as const, id: 'network' }
  topology.name = 'Public ingress design'
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false },
      { id: 'router-subnet', name: kind === 'azure-firewall' ? 'AzureFirewallSubnet' : 'Router', prefix: '10.1.2.0/24' }],
    gateways: [], appliances: kind === 'direct' ? [] : [{ id: 'router', name: 'Ingress router', kind,
      subnetId: 'router-subnet', privateIp: '10.1.2.4', enableIpForwarding: true, staticRoutes: [] }], x: 200, y: 200 }]
  topology.inventory = { workloads: [{ id: 'server', name: 'Server', nicIds: ['nic'] }], nics: [{ id: 'nic', name: 'Server NIC', owner,
    ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4', ...(kind === 'direct' ? { publicIpId: 'frontend' } : {}) }] }],
    publicIps: kind === 'direct' ? [{ id: 'frontend', name: 'Public frontend', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' }] : [],
    networkSecurityGroups: [{ id: 'nsg', name: 'Server NSG', rules: [{ id: 'web', name: 'AllowWeb', priority: 100, direction: 'inbound',
      action: 'allow', protocol: 'tcp', sources: [kind === 'direct' ? '8.8.8.8/32' : '10.1.2.0/24'], destinations: ['10.1.1.4'],
      sourcePorts: ['*'], destinationPorts: [kind === 'direct' ? '443' : '8443'] }] }],
    nsgAssociations: [{ owner, target: { kind: 'nic', id: 'nic' }, nsgId: 'nsg' }] }
  if (kind === 'nva-vm') {
    topology.inventory.workloads.push({ id: 'router-vm', name: 'Router VM', nicIds: ['router-nic'], backingDeviceId: 'router' })
    topology.inventory.nics.push({ id: 'router-nic', name: 'Router NIC', owner, ipConfigurations: [{
      id: 'router-ip', name: 'Primary', subnetId: 'router-subnet', privateIp: '10.1.2.4',
    }] })
    topology.inventory.networkSecurityGroups!.push({ id: 'router-nsg', name: 'Router NSG', rules: [{
      id: 'allow-ingress', name: 'AllowIngress', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['8.8.8.8/32'], destinations: ['10.1.2.4'], sourcePorts: ['*'], destinationPorts: ['443'],
    }] })
    topology.inventory.nsgAssociations!.push({ owner, target: { kind: 'nic', id: 'router-nic' }, nsgId: 'router-nsg' })
  }
  return topology
}

for (const kind of ['direct', 'azure-firewall', 'nva-vm'] as const) {
  test(`${kind}: original public ingress edits, private tuples, owner responses and saved IDs`, async ({ page }) => {
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, design(kind))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?mode=full')
    await page.getByLabel('Theme', { exact: true }).selectOption('dark')
    const node = page.getByTestId('aznet-vnet-network')
    await node.click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog'), packet = dialog.getByTestId('packet-flow-panel')
    if (kind !== 'direct') {
      const editor = dialog.getByTestId('router-dnat-editor')
      await editor.locator('summary').first().click()
      await editor.getByLabel('DNAT public IPv4 frontends (comma-separated; ? means unknown)', { exact: true }).fill('20.40.50.60')
      if (kind === 'nva-vm') await editor.getByLabel('Guest DNAT source translation', { exact: true }).selectOption('interface')
      await editor.getByRole('button', { name: 'Save DNAT frontends', exact: true }).click()
      await editor.getByLabel('DNAT rule name', { exact: true }).fill('Public web')
      await editor.getByLabel('DNAT source IPv4 prefixes', { exact: true }).fill('8.8.8.8/32')
      await editor.getByLabel('DNAT original backend', { exact: true }).selectOption({ label: 'Server / Server NIC / Primary (10.1.1.4)' })
      await editor.getByLabel('DNAT backend port', { exact: true }).fill('8443')
      await editor.getByRole('button', { name: 'Save DNAT rule', exact: true }).click()
    }
    const readSaved = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology
    const saved = await readSaved()
    const frontendId = kind === 'direct' ? 'frontend' : saved.inventory.routerDnatPolicies[0].publicIpIds[0]
    await packet.getByLabel('Packet source', { exact: true }).selectOption('external')
    await packet.getByLabel('Packet destination', { exact: true }).selectOption(`public:${frontendId}`)
    await packet.getByLabel('External IPv4 address', { exact: true }).fill('8.8.8.8')
    await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
    await expect(packet.getByTestId('packet-flow-result')).toContainText('Public ingress: configured')
    await expect(packet.getByRole('heading', { name: 'Reply routing: reachable', exact: true })).toBeVisible()
    await packet.getByRole('button', { name: 'Highlight original backend', exact: true }).click()
    await expect(dialog.locator('.detail-workload[data-selected="true"]')).toContainText('Server')
    await packet.locator('details').first().locator('summary').click()
    await expect(packet.getByTestId('packet-step-tuples').first()).toContainText('20.40.50.60:443')
    const input: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: saved }, packet: {
      source: { kind: 'external', address: '8.8.8.8' }, target: { kind: 'public-ip', publicIpId: frontendId },
      protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
    } }
    expect(await page.evaluate(async (input) => {
      const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
      return module.runBrowserSimulation(input)
    }, input)).toEqual(executePlatform(input))
    expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    await page.reload()
    expect(await readSaved()).toEqual(saved)
    await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
    await page.reload()
    await node.click()
    await page.getByRole('button', { name: 'VNet の詳細', exact: true }).click()
    await expect(packet.getByLabel('パケット宛先', { exact: true })).toBeVisible()
    if (kind !== 'direct') {
      await dialog.getByTestId('router-dnat-editor').locator('summary').first().click()
      await expect(dialog.getByRole('button', { name: 'DNAT ルールを保存', exact: true })).toBeVisible()
    }
  })
}
