import { expect, test } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'

function design(internal: boolean) {
  const topology = createEmptyAzNetTopology(), owner = { kind: 'vnet' as const, id: 'network' }
  topology.name = 'Original LB design'
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false },
      { id: 'front', name: 'Frontend', prefix: '10.1.2.0/24', defaultOutboundAccess: false }],
    gateways: [], appliances: [], x: 200, y: 200 }]
  topology.inventory = { publicIps: [], workloads: [{ id: 'server', name: 'Server', nicIds: ['nic'] }, { id: 'client', name: 'Client', nicIds: ['client-nic'] }],
    nics: [{ id: 'nic', name: 'Server NIC', owner, ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4', primary: true }] },
      { id: 'client-nic', name: 'Client NIC', owner, ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.5', primary: true }] }],
    networkSecurityGroups: [{ id: 'nsg', name: 'Backend NSG', rules: internal ? [] : [{ id: 'web', name: 'AllowWeb', priority: 100,
      direction: 'inbound', action: 'allow', protocol: 'tcp', sources: ['8.8.8.8/32'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['8443'] }] }],
    nsgAssociations: [{ owner, target: { kind: 'nic', id: 'nic' }, nsgId: 'nsg' }] }
  return topology
}

test('original connectivity capture persists provenance and unknown health; denied rules never certify packet isolation', async ({ page }) => {
  const subscription = '11111111-1111-1111-1111-111111111111'
  const base = `/subscriptions/${subscription}/resourceGroups/network/providers/Microsoft.Network`
  const vnet = `${base}/virtualNetworks/network`, subnet = `${vnet}/subnets/app`
  const nic = `${base}/networkInterfaces/server`, configuration = `${nic}/ipConfigurations/primary`
  const vm = `/subscriptions/${subscription}/resourceGroups/network/providers/Microsoft.Compute/virtualMachines/server`
  const service = `${base}/loadBalancers/service`, pool = `${service}/backendAddressPools/servers`
  const frontend = `${service}/frontendIPConfigurations/public`, probe = `${service}/probes/health`, pip = `${base}/publicIPAddresses/service`
  const capture = { kind: 'azure-network-capture', version: 2, observationVersion: 1, connectivityVersion: 1,
    resourceGroup: 'network', subscriptionId: subscription, context: { cloud: 'AzureCloud', subscriptionId: subscription },
    configurationComplete: true, warnings: [], sections: Object.fromEntries(['publicIpAddresses', 'publicIpPrefixes', 'natGateways',
      'networkInterfaces', 'virtualMachines', 'networkSecurityGroups', 'loadBalancers', 'azureFirewalls', 'firewallPolicies']
      .map((key) => [key, { state: 'succeeded', complete: true }])),
    vnets: [{ id: vnet, name: 'Original network', location: 'westeurope', addressSpace: { addressPrefixes: ['10.1.0.0/16'] },
      subnets: [{ id: subnet, name: 'App', addressPrefix: '10.1.1.0/24', defaultOutboundAccess: false }] }],
    networkInterfaces: [{ id: nic, name: 'Original NIC', virtualMachine: { id: vm },
      ipConfigurations: [{ id: configuration, name: 'Primary', privateIPAddress: '10.1.1.4', primary: true, subnet: { id: subnet } }] }],
    virtualMachines: [{ id: vm, name: 'Original server', networkProfile: { networkInterfaces: [{ id: nic }] } }],
    publicIpAddresses: [{ id: pip, name: 'Service', sku: { name: 'Standard' }, publicIPAllocationMethod: 'Static',
      ipAddress: '20.40.50.60', ipConfiguration: { id: frontend } }],
    loadBalancers: [{ id: service, name: 'Original LB', sku: { name: 'Standard' },
      frontendIPConfigurations: [{ id: frontend, name: 'Public', publicIPAddress: { id: pip } }],
      backendAddressPools: [{ id: pool, name: 'Servers', backendIPConfigurations: [{ id: configuration }] }],
      probes: [{ id: probe, name: 'Health', protocol: 'Tcp', port: 8080 }],
      loadBalancingRules: [{ id: `${service}/loadBalancingRules/web`, name: 'Web', protocol: 'Tcp', frontendPort: 443, backendPort: 8443,
        frontendIPConfiguration: { id: frontend }, backendAddressPool: { id: pool }, probe: { id: probe }, disableOutboundSnat: true }] }],
    networkSecurityGroups: [], publicIpPrefixes: [], natGateways: [], azureFirewalls: [], firewallPolicies: [], firewallPolicyRuleCollectionGroups: [] }
  await page.goto('/?mode=full')
  const upload = () => page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'original-capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)) })
  await upload()
  const saved = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology
  await expect.poll(async () => (await saved()).inventory?.workloads[0]?.name).toBe('Original server')
  const original = await saved(), inventory = original.inventory
  expect(inventory.capture.configurationComplete).toBe(true)
  expect(inventory.capture.resourceIds[inventory.workloads[0].id]).toBe(vm)
  expect(inventory.loadBalancers[0].probes[0].health[0].status).toBe('unknown')
  await page.reload()
  expect((await saved()).inventory).toEqual(inventory)
  capture.sections.networkSecurityGroups = { state: 'denied', complete: false }
  capture.configurationComplete = false
  await upload()
  await expect.poll(async () => (await saved()).inventory?.capture?.configurationComplete).toBe(false)
  const current = await saved()
  expect(current.inventory.capture.configurationComplete).toBe(false)
  await page.getByRole('button', { name: 'Close Azure & Bicep', exact: true }).click()
  await page.getByTestId(`aznet-vnet-${current.vnets[0].id}`).click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const packet = page.getByTestId('network-detail-dialog').getByTestId('packet-flow-panel')
  await packet.getByLabel('Packet source', { exact: true }).selectOption('external')
  await packet.getByLabel('Packet destination', { exact: true }).selectOption(`public:${current.inventory.publicIps[0].id}`)
  await packet.getByLabel('External IPv4 address', { exact: true }).fill('8.8.8.8')
  await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
  await expect(packet.getByTestId('packet-flow-result')).toContainText('Connectivity configuration capture is incomplete or unsupported')
})

for (const internal of [false, true]) {
  test(`${internal ? 'internal' : 'public'} Standard LB: original editing, independent probes, worker parity and narrow persisted IDs`, async ({ page }) => {
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, design(internal))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?mode=full')
    await page.getByLabel('Theme', { exact: true }).selectOption('dark')
    await page.getByTestId('aznet-vnet-network').click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog'), editor = dialog.getByTestId('load-balancer-editor')
    await editor.locator('summary').first().click()
    const create = editor.getByTestId('create-lb-form')
    await create.getByLabel('LB name', { exact: true }).fill('Application LB')
    await create.getByLabel('LB frontend kind', { exact: true }).selectOption(internal ? 'private' : 'public')
    if (internal) await create.getByLabel('LB frontend subnet', { exact: true }).selectOption('front')
    await create.getByLabel('LB frontend IPv4 (blank means unknown)', { exact: true }).fill(internal ? '10.1.2.10' : '20.40.50.60')
    await create.getByRole('button', { name: 'Add Standard LB', exact: true }).click()
    const pool = editor.getByTestId('create-lb-pool-form')
    await pool.getByLabel('New LB pool name', { exact: true }).fill('Servers')
    await pool.getByRole('button', { name: 'Add backend pool', exact: true }).click()
    await editor.getByLabel('LB original backend', { exact: true }).selectOption({ label: 'Server / Server NIC / Primary (10.1.1.4)' })
    await editor.getByRole('button', { name: 'Add original backend', exact: true }).click()
    await editor.locator('summary').filter({ hasText: 'Independent LB health probes' }).click()
    const probe = editor.getByTestId('create-lb-probe-form')
    await probe.getByLabel('LB probe name', { exact: true }).fill('TCP health')
    await probe.getByRole('button', { name: 'Add health probe', exact: true }).click()
    await editor.locator('summary').filter({ hasText: 'Ordinary LB rules' }).click()
    const rule = editor.getByTestId('lb-rule-form')
    await rule.getByLabel('LB rule name', { exact: true }).fill('Web')
    await rule.getByRole('button', { name: 'Save LB rule', exact: true }).click()
    const readSaved = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology
    const current = await readSaved(), lb = current.inventory.loadBalancers[0], packet = dialog.getByTestId('packet-flow-panel')
    const target = internal ? { kind: 'load-balancer' as const, loadBalancerId: lb.id, frontendId: lb.frontends[0].id }
      : { kind: 'public-ip' as const, publicIpId: lb.frontends[0].publicIpId }
    await packet.getByLabel('Packet source', { exact: true }).selectOption(internal ? JSON.stringify(['workload', 'client', 'client-nic', 'client-ip']) : 'external')
    await packet.getByLabel('Packet destination', { exact: true }).selectOption(internal ? JSON.stringify(['lb', lb.id, lb.frontends[0].id]) : `public:${lb.frontends[0].publicIpId}`)
    if (!internal) await packet.getByLabel('External IPv4 address', { exact: true }).fill('8.8.8.8')
    await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
    await expect(packet.getByTestId('packet-flow-result')).toContainText('No known-eligible backend')
    await editor.getByLabel(/Declared backend health \(unverified\)/).selectOption('healthy')
    await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
    await expect(packet.getByTestId('packet-flow-result')).toContainText('Load Balancer ingress: configured')
    await expect(packet.getByTestId('packet-lb-result')).toContainText('Known eligible backends: 1')
    await packet.getByRole('button', { name: 'Highlight original backend', exact: true }).click()
    await expect(dialog.locator('.detail-workload[data-selected="true"]')).toContainText('Server')
    await editor.locator('summary').filter({ hasText: 'LB frontends' }).click()
    await editor.getByRole('button', { name: 'Edit frontend', exact: true }).click()
    const frontend = editor.getByTestId('lb-frontend-form')
    await frontend.getByLabel('LB frontend name', { exact: true }).fill('Retained frontend')
    await frontend.getByRole('button', { name: 'Save frontend', exact: true }).click()
    await editor.getByRole('button', { name: 'Edit probe', exact: true }).click()
    await probe.getByLabel('LB probe port', { exact: true }).fill('8081')
    await probe.getByRole('button', { name: 'Save probe', exact: true }).click()
    await expect(editor.getByLabel(/Declared backend health \(unverified\)/)).toHaveValue('unknown')
    await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
    await expect(packet.getByTestId('packet-flow-result')).toContainText('No known-eligible backend')
    await editor.getByLabel(/Declared backend health \(unverified\)/).selectOption('healthy')
    if (!internal) {
      await editor.locator('summary').filter({ hasText: 'Specific LB inbound NAT' }).click()
      const nat = editor.getByTestId('lb-inbound-nat-form')
      await nat.getByLabel('LB inbound NAT name', { exact: true }).fill('Administration')
      await nat.getByRole('button', { name: 'Add specific inbound NAT', exact: true }).click()
      const natId = (await readSaved()).inventory.loadBalancers[0].inboundNatRules[0].id
      await editor.getByRole('button', { name: 'Edit inbound NAT', exact: true }).click()
      await nat.getByLabel('LB NAT backend port', { exact: true }).fill('8443')
      await nat.getByRole('button', { name: 'Save inbound NAT', exact: true }).click()
      expect((await readSaved()).inventory.loadBalancers[0].inboundNatRules[0]).toMatchObject({ id: natId, backendPort: 8443 })
      await editor.locator('summary').filter({ hasText: 'Public LB outbound rules' }).click()
      const outbound = editor.getByTestId('lb-outbound-form')
      await outbound.getByLabel('LB outbound name', { exact: true }).fill('Pool outbound')
      await outbound.getByRole('button', { name: 'Add public outbound rule', exact: true }).click()
      const outboundId = (await readSaved()).inventory.loadBalancers[0].outboundRules[0].id
      await editor.getByRole('button', { name: 'Edit outbound rule', exact: true }).click()
      await outbound.getByLabel('LB outbound protocol', { exact: true }).selectOption('tcp')
      await outbound.getByRole('button', { name: 'Save outbound rule', exact: true }).click()
      expect((await readSaved()).inventory.loadBalancers[0].outboundRules[0]).toMatchObject({ id: outboundId, protocol: 'tcp' })
      await packet.getByLabel('Packet source', { exact: true }).selectOption(JSON.stringify(['workload', 'server', 'nic', 'ip']))
      await packet.getByLabel('Packet destination', { exact: true }).selectOption('external')
      await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
      await expect(packet.getByTestId('packet-flow-result')).toContainText('Illustrative SNAT configured')
    }

    const saved = await readSaved()
    expect(saved.inventory.loadBalancers[0]).toMatchObject({ id: lb.id, frontends: [{ id: lb.frontends[0].id, name: 'Retained frontend' }],
      probes: [{ id: lb.probes[0].id, port: 8081 }], rules: [{ id: lb.rules[0].id }] })
    const input: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: saved },
      packet: { source: internal ? { kind: 'workload', workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' }
        : { kind: 'external', address: '8.8.8.8' }, target, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
    expect(await page.evaluate(async (input) => {
      const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
      return module.runBrowserSimulation(input)
    }, input)).toEqual(executePlatform(input))
    expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('aznet-subnet-lb-pill').first()).toBeVisible()
    await page.reload()
    expect(await readSaved()).toEqual(saved)
    await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
    await page.reload()
    await page.getByTestId('aznet-vnet-network').click()
    await page.getByRole('button', { name: 'VNet の詳細', exact: true }).click()
    await editor.locator('summary').first().click()
    await editor.getByLabel('元の LB を選択', { exact: true }).selectOption(lb.id)
    await editor.locator('summary').filter({ hasText: '通常の LB ルール' }).click()
    await expect(editor.getByRole('button', { name: 'LB ルールを保存', exact: true })).toBeVisible()
    expect(await readSaved()).toEqual(saved)
  })
}

test('dense LB search retains original selection and reaches backends beyond the display bound by keyboard', async ({ page }) => {
  const topology = design(true), inventory = topology.inventory!, owner = { kind: 'vnet' as const, id: 'network' }
  for (let index = 0; index < 120; index++) {
    const id = String(index).padStart(3, '0')
    inventory.workloads.push({ id: `node-${id}`, name: `Node${id}`, nicIds: [`node-nic-${id}`] })
    inventory.nics.push({ id: `node-nic-${id}`, name: `NIC${id}`, owner,
      ipConfigurations: [{ id: `node-ip-${id}`, name: 'Primary', subnetId: 'app', privateIp: `10.1.1.${index + 6}`, primary: true }] })
  }
  inventory.loadBalancers = Array.from({ length: 125 }, (_, index) => ({ id: `service-${index}`, name: `Service${String(index).padStart(3, '0')}`,
    sku: 'Standard', owner, frontends: [], pools: [], probes: [], rules: [], inboundNatRules: [], outboundRules: [] }))
  await page.addInitScript((topology) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vnet-network').click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog'), editor = dialog.getByTestId('load-balancer-editor')
  await editor.locator('summary').first().click()
  const search = editor.getByLabel('Search original LBs', { exact: true }), selection = editor.getByLabel('Select original LB', { exact: true })
  await search.fill('Service124')
  await search.press('Tab')
  await expect(selection).toBeFocused()
  await selection.selectOption('service-124')
  await search.fill('Service000')
  await expect(selection).toHaveValue('service-124')
  const pool = editor.getByTestId('create-lb-pool-form')
  await pool.getByLabel('New LB pool name', { exact: true }).fill('Retained original pool')
  await pool.getByRole('button', { name: 'Add backend pool', exact: true }).click()
  await editor.getByLabel('Search LB backends', { exact: true }).fill('Node119')
  await editor.getByLabel('LB original backend', { exact: true }).selectOption({ label: 'Node119 / NIC119 / Primary (10.1.1.125)' })
  await editor.getByRole('button', { name: 'Add original backend', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  expect(saved.inventory.loadBalancers[124].pools[0].members).toEqual([{ workloadId: 'node-119', nicId: 'node-nic-119', ipConfigurationId: 'node-ip-119' }])
  await editor.getByLabel('Search LB backends', { exact: true }).fill('Node000')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)).toEqual(saved)
  expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
})
