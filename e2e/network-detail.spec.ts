import { expect, test } from '@playwright/test'
import type { Topology } from '../src/model'
import { createEmptyAzNetTopology, type AzNetTopology } from '../src/azure-net/model'
import type { NetworkInventory } from '../src/inventory'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'
import { validateTopology } from '../src/validation'

function design(mode: string): Topology | AzNetTopology {
  const subnets = [{ id: 'app', name: 'App subnet', prefix: '10.1.1.0/24' }]
  const inventory: NetworkInventory = {
    workloads: [{ id: 'vm:a', name: 'Application', nicIds: ['nic-a'] }, { id: 'vm-b', name: 'Database', nicIds: ['nic-b'] }],
    nics: [
      { id: 'nic-a', name: 'App NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'network' }, ipConfigurations: [{ id: 'ip-a', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] },
      { id: 'nic-b', name: 'DB NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'network' }, ipConfigurations: [{ id: 'ip-b', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.5' }] },
    ], publicIps: [],
  }

  if (mode === 'vwan') return {
    version: 1, name: 'Detail design', hubs: [], sites: [], connections: [], siteLinks: [],
    spokes: [{ id: 'network', name: 'Network', prefixes: ['10.1.0.0/16'], subnets }], inventory,
  } satisfies Topology
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets, gateways: [], appliances: [], x: 200, y: 200 }]
  topology.inventory = inventory
  return topology
}

function graphicalDesign(mode: string) {
  const topology = design(mode), owner = { kind: mode === 'vwan' ? 'spoke' as const : 'vnet' as const, id: 'network' }
  const subnets = topology.version === 1 ? topology.spokes[0].subnets! : topology.vnets[0].subnets
  subnets.push({ id: 'second', name: 'Second subnet', prefix: '10.1.2.0/24' })
  topology.inventory!.nics[0].ipConfigurations.push({ id: 'ip-second', name: 'Secondary', subnetId: 'second', privateIp: '10.1.2.4' })
  topology.inventory!.publicIps.push({ id: 'nat-pip', name: 'NAT public IP', address: '20.50.60.80', sku: 'Standard', allocation: 'Static' })
  topology.inventory!.natGateways = [{ id: 'nat-original', name: 'Shared NAT', owner, sku: 'Standard', subnetIds: ['app', 'second'], publicIpIds: ['nat-pip'] }]
  topology.inventory!.loadBalancers = [{ id: 'lb-original', name: 'Shared LB', owner, sku: 'Standard',
    frontends: [{ id: 'frontend', name: 'Private frontend', kind: 'private', subnetId: 'second', privateIp: '10.1.2.10' }],
    pools: [{ id: 'pool', name: 'Original backends', members: [{ workloadId: 'vm:a', nicId: 'nic-a', ipConfigurationId: 'ip-a' }] }],
    probes: [], rules: [], inboundNatRules: [], outboundRules: [] }]
  topology.application = { version: 1, services: [{ id: 'service-original', name: 'Declared application', kind: 'application-gateway', owner,
    references: [{ kind: 'subnet', owner, id: 'app' }], unsupportedFeatures: [] }], dnsProfiles: [] }
  if (topology.version === 2) {
    const vnet = topology.vnets[0]
    vnet.subnets[0].privateEndpoints = [{ id: 'pe-original', name: 'Storage endpoint', ipAddress: '10.1.1.9', serviceName: 'storage' }]
    vnet.subnets.push({ id: 'transit', name: 'VirtualNetworkApplianceSubnet', prefix: '10.1.3.0/24' },
      { id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.1.4.0/27' },
      { id: 'firewall-subnet', name: 'AzureFirewallSubnet', prefix: '10.1.5.0/26' })
    vnet.appliances = [
      { id: 'nva-original', name: 'Original NVA', kind: 'nva-vm', subnetId: 'app', privateIp: '10.1.1.8', enableIpForwarding: true, staticRoutes: [] },
      { id: 'vnra-original', name: 'Original VNRA', kind: 'vnra', subnetId: 'transit', privateIp: '10.1.3.4', enableIpForwarding: true, staticRoutes: [] },
      { id: 'firewall-original', name: 'Original Firewall', kind: 'azure-firewall', subnetId: 'firewall-subnet', privateIp: '10.1.5.4', enableIpForwarding: true, staticRoutes: [] },
    ]
    vnet.gateways = [{ id: 'gateway-original', name: 'Original gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true }]
    vnet.routeServer = { id: 'ars-original', name: 'Original ARS', subnetId: 'ars-subnet', enabled: true, branchToBranchTraffic: false, hubRoutingPreference: 'ASPath', peerApplianceIds: [] }
  } else {
    topology.hubs = [{ id: 'hub', name: 'Hub', region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }]
    topology.spokes[0].hubId = 'hub'
    topology.sites = [{ id: 'nva-original', name: 'Original NVA', role: 'spoke-nva', asn: 65001, prefixes: [] }]
    topology.connections = [{ id: 'nva-connection', name: 'Original NVA association', hubId: 'hub', siteId: 'nva-original', spokeId: 'network',
      transport: 'SpokeNVA', peerIp: '10.1.1.8', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] }]
  }
  return topology.version === 1 ? validateTopology(topology) : topology
}

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  test(`graphical detail ${mode}: original attachment references, keyboard actions, edits and history`, async ({ page }) => {
    const topology = graphicalDesign(mode), key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
    }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
    await page.setViewportSize({ width: mode === 'hub-spoke' ? 390 : 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.getByLabel('Theme', { exact: true }).selectOption(mode === 'hub-spoke' ? 'dark' : 'light')
    const read = () => page.evaluate((key) => { const saved = JSON.parse(localStorage.getItem(key)!); return saved.topology ?? saved }, key)
    const node = mode === 'vwan' ? page.locator('.spoke-node[data-node-id="network"]') : page.getByTestId('aznet-vnet-network')
    await node.click()
    const opener = page.getByRole('button', { name: 'VNet detail', exact: true })
    const before = await read()
    await opener.click()
    const dialog = page.getByTestId('network-detail-dialog')
    const app = dialog.locator('[data-subnet-id="app"]'), second = dialog.locator('[data-subnet-id="second"]')
    for (const container of [app, second]) {
      await expect(container.locator('[data-entity-id="nic-a"]')).toHaveCount(1)
      await expect(container.locator('[data-entity-id="nat-original"]')).toHaveCount(1)
      await expect(container.locator('[data-entity-id="lb-original"]')).toHaveCount(1)
      await expect(container.getByText('Original entity; 2 declared subnet associations', { exact: true })).toHaveCount(3)
    }
    await expect(app.locator('[data-entity-id="nic-a"]')).toContainText('10.1.1.4')
    await expect(app.locator('[data-entity-id="nic-a"]')).not.toContainText('10.1.2.4')
    await expect(second.locator('[data-entity-id="nic-a"]')).toContainText('10.1.2.4')
    await expect(second.locator('[data-entity-id="service-original"]')).toHaveCount(0)
    await expect(app.locator('[data-entity-id="service-original"]')).toHaveCount(1)
    if (mode !== 'vwan') {
      for (const [id, subnetId] of [['nva-original', 'app'], ['vnra-original', 'transit'], ['firewall-original', 'firewall-subnet'], ['ars-original', 'ars-subnet'], ['pe-original', 'app']]) {
        await expect(dialog.locator(`[data-subnet-id="${subnetId}"] [data-entity-id="${id}"]`)).toHaveCount(1)
      }
      await expect(dialog.getByRole('region', { name: 'Network-level associations', exact: true }).locator('[data-entity-id="gateway-original"]')).toHaveCount(1)
      await expect(dialog.locator('[data-subnet-id] [data-entity-id="gateway-original"]')).toHaveCount(0)
    } else await expect(dialog.getByRole('region', { name: 'Network-level associations', exact: true }).locator('[data-entity-id="nva-original"]')).toHaveCount(1)
    const subnetTarget = app.getByRole('button', { name: 'Subnet: App subnet', exact: true })
    await subnetTarget.focus()
    await page.keyboard.press('Shift+F10')
    const menu = dialog.getByRole('menu', { name: 'App subnet', exact: true })
    await expect(menu.getByRole('menuitem', { name: 'Subnet NSG', exact: true })).toBeVisible()
    if (mode !== 'vwan') await expect(menu.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(subnetTarget).toBeFocused()
    expect(await read()).toEqual(before)
    const nic = app.getByRole('button', { name: 'NIC: App NIC', exact: true })
    await nic.click({ button: 'right' })
    await dialog.getByRole('menuitem', { name: 'Edit workload: Application', exact: true }).click()
    const form = dialog.getByTestId('selected-workload-form')
    await expect(form.getByLabel('Workload name', { exact: true })).toBeFocused()
    await form.getByLabel('Workload name', { exact: true }).fill('Renamed original')
    await form.getByRole('button', { name: 'Save workload', exact: true }).click()
    await expect(app.locator('[data-entity-id="nic-a"]')).toContainText('Renamed original')
    await expect(second.locator('[data-entity-id="nic-a"]')).toContainText('Renamed original')
    expect((await read()).inventory.workloads[0]).toMatchObject({ id: 'vm:a', name: 'Renamed original', nicIds: ['nic-a'] })
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
    await page.getByRole('button', { name: mode === 'vwan' ? 'Undo' : '↶ Undo', exact: true }).click()
    await expect.poll(async () => (await read()).inventory.workloads[0].name).toBe('Application')
    await page.getByRole('button', { name: mode === 'vwan' ? 'Redo' : '↷ Redo', exact: true }).click()
    await opener.click()
    await expect(form.getByLabel('Workload name', { exact: true })).toHaveValue('Renamed original')
    await expect(dialog.getByRole('button', { name: 'Renamed original', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const persisted = await read()
    const expected = structuredClone(before)
    expected.inventory.workloads[0].name = 'Renamed original'
    expect(persisted).toEqual(expected)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
  })
}

test('graphical detail native shared actions release the modal for original subnet and appliance inspectors', async ({ page }) => {
  const topology = graphicalDesign('full')
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vnet-network').click()
  const opener = page.getByRole('button', { name: 'VNet detail', exact: true })
  const dialog = page.getByTestId('network-detail-dialog')
  await opener.click()
  const appliance = dialog.getByRole('button', { name: 'NVA: Original NVA', exact: true })
  await appliance.focus()
  await page.keyboard.press('ContextMenu')
  await dialog.getByRole('menuitem', { name: 'Disable NIC IP Forwarding', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  await expect.poll(async () => (await read()).vnets[0].appliances[0].enableIpForwarding).toBe(false)
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
  await expect.poll(async () => (await read()).vnets[0].appliances[0].enableIpForwarding).toBe(true)
  await opener.click()
  await appliance.click({ button: 'right' })
  await dialog.getByRole('menuitem', { name: 'Inspect Appliance Subnet Effective Routes', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('aznet-effective-route-table')).toBeVisible()
  await opener.click()
  await dialog.getByRole('button', { name: 'Subnet: App subnet', exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await dialog.getByRole('menuitem', { name: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const prefix = page.getByTestId('aznet-subnet-prefix-app')
  await expect(prefix).toBeVisible()
  await prefix.fill('10.1.1.0/25')
  await prefix.press('Tab')
  await expect.poll(async () => (await read()).vnets[0].subnets[0].prefix).toBe('10.1.1.0/25')
  await opener.click()
  await expect(dialog.locator('[data-subnet-id="app"]').getByText('10.1.1.0/25', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
  await expect.poll(async () => (await read()).vnets[0].subnets[0].prefix).toBe('10.1.1.0/24')
})

test('graphical detail VWAN NVA invokes the original shared editor and retains history without subnet inference', async ({ page }) => {
  const topology = graphicalDesign('vwan')
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('vwan-visual-topology:v1')) localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
  }, topology)
  await page.goto('/?mode=vwan')
  const node = page.locator('.spoke-node[data-node-id="network"]')
  await node.click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog')
  await expect(dialog.locator('[data-subnet-id] [data-entity-id="nva-original"]')).toHaveCount(0)
  const nva = dialog.getByRole('button', { name: 'NVA: Original NVA', exact: true })
  await nva.focus()
  await page.keyboard.press('Shift+F10')
  await expect(dialog.getByRole('menuitem', { name: 'BGP table', exact: true })).toBeVisible()
  await dialog.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const editor = page.locator('.object-editor')
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Original NVA')
  await editor.getByLabel('Name', { exact: true }).fill('Renamed original NVA')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  await expect.poll(async () => (await read()).sites[0].name).toBe('Renamed original NVA')
  expect((await read()).sites[0].id).toBe('nva-original')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await read()).sites[0].name).toBe('Original NVA')
  await node.click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  await expect(nva).toBeVisible()
  await page.keyboard.press('Escape')
})

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  test(`graphical detail ${mode}: bounded attachment pages, search, collapsing and narrow keyboard return`, async ({ page }) => {
    const topology = design(mode), key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    for (let index = 0; index < 140; index++) {
      topology.inventory!.workloads.push({ id: `late-${index}`, name: `Late workload ${index}`, nicIds: [`late-nic-${index}`] })
      topology.inventory!.nics.push({ id: `late-nic-${index}`, name: `Late NIC ${index}`, owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'network' },
        ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: 'app', privateIp: `10.1.1.${index + 10}` }] })
    }
    topology.inventory!.nics.push({ id: 'orphan', name: 'Orphan NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'network' },
      ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.250' }] })
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
    }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/?mode=${mode}`)
    await page.getByLabel('Theme', { exact: true }).selectOption('dark')
    await page.locator(mode === 'vwan' ? '.spoke-node[data-node-id="network"]' : '[data-testid="aznet-vnet-network"]').click()
    const opener = page.getByRole('button', { name: 'VNet detail', exact: true })
    const before = await page.evaluate((key) => localStorage.getItem(key), key)
    await opener.click()
    const dialog = page.getByTestId('network-detail-dialog')
    await expect(dialog.getByTestId('detail-device')).toHaveCount(12)
    await dialog.getByRole('button', { name: 'Next attachments', exact: true }).click()
    await expect(dialog.locator('[data-entity-id="nic-a"]')).toHaveCount(0)
    await expect(dialog.getByTestId('detail-device')).toHaveCount(12)
    await dialog.getByLabel('Search attached entities', { exact: true }).fill('late-139')
    await expect(dialog.getByTestId('detail-device')).toHaveCount(1)
    const nic = dialog.getByRole('button', { name: 'NIC: Late NIC 139', exact: true })
    await nic.focus()
    await page.keyboard.press('ContextMenu')
    await expect(dialog.getByRole('menuitem', { name: 'Edit workload: Late workload 139', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(nic).toBeFocused()
    await page.keyboard.press('ContextMenu')
    await dialog.getByRole('menuitem', { name: 'NIC NSG', exact: true }).click()
    const nsg = dialog.getByTestId('nsg-editor-nic-late-nic-139')
    await expect(nsg.locator('summary').first()).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Late workload 139', exact: true })).toBeVisible()
    await dialog.getByLabel('Search attached entities', { exact: true }).fill('orphan')
    const orphan = dialog.getByRole('button', { name: 'NIC: Orphan NIC', exact: true })
    await orphan.focus()
    await page.keyboard.press('ContextMenu')
    await expect(dialog.getByRole('menuitem', { name: 'NIC NSG', exact: true })).toBeDisabled()
    await expect(dialog.getByTestId('nsg-editor-nic-orphan')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(orphan).toBeFocused()
    await dialog.locator('.detail-workload-inventory > summary').click()
    await expect(dialog.getByRole('button', { name: 'Late workload 139', exact: true })).not.toBeVisible()
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before)
    await opener.click()
    await expect(dialog.getByTestId('detail-device')).toHaveCount(12)
    await expect(dialog.getByRole('button', { name: 'Previous attachments', exact: true })).toBeDisabled()
  })
}

for (const mode of ['vwan', 'full'] as const) {
  test(`scoped NSG ${mode}: original edits, intersection, stateful response and Japanese narrow evidence`, async ({ page }) => {
    const topology = design(mode), key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
    }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/?mode=${mode}`)
    await page.getByLabel('Theme', { exact: true }).selectOption('dark')
    const node = mode === 'vwan' ? page.locator('.spoke-node[data-node-id="network"]') : page.getByTestId('aznet-vnet-network')
    await node.click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog'), packet = dialog.getByTestId('packet-flow-panel')
    const subnet = dialog.getByTestId('nsg-editor-subnet-app'), nic = dialog.getByTestId('nsg-editor-nic-nic-a')
    await subnet.locator('summary').first().click()
    await subnet.getByLabel('NSG name', { exact: true }).fill('Subnet policy')
    await subnet.getByRole('button', { name: 'Declare default-only NSG', exact: true }).click()
    await subnet.getByLabel('NSG rule name', { exact: true }).fill('DenyWeb')
    await subnet.getByLabel('NSG direction', { exact: true }).selectOption('outbound')
    await subnet.getByLabel('NSG action', { exact: true }).selectOption('deny')
    await subnet.getByLabel('NSG destination ports', { exact: true }).fill('443')
    await subnet.getByRole('button', { name: 'Save NSG rule', exact: true }).click()
    await nic.locator('summary').first().click()
    await nic.getByLabel('NSG name', { exact: true }).fill('NIC policy')
    await nic.getByRole('button', { name: 'Declare default-only NSG', exact: true }).click()
    await nic.getByLabel('NSG rule name', { exact: true }).fill('AllowWeb')
    await nic.getByLabel('NSG direction', { exact: true }).selectOption('outbound')
    await nic.getByLabel('NSG destination ports', { exact: true }).fill('443')
    await nic.getByRole('button', { name: 'Save NSG rule', exact: true }).click()
    await packet.getByLabel('Packet source', { exact: true }).selectOption({ label: 'Application / App NIC / Primary (10.1.1.4)' })
    await packet.getByLabel('Packet destination', { exact: true }).selectOption({ label: 'Database / DB NIC / Primary (10.1.1.5)' })
    await packet.getByLabel('Destination port', { exact: true }).fill('443')
    const trace = packet.getByRole('button', { name: 'Trace packet routing', exact: true })
    await trace.click()
    await expect(packet.getByRole('heading', { name: 'Forward routing: reachable', exact: true })).toBeVisible()
    await expect(packet.getByTestId('packet-nsg-result').getByRole('heading', { name: 'NSG filtering: denied', exact: true })).toBeVisible()
    await subnet.getByRole('button', { name: 'Delete NSG rule', exact: true }).click()
    await expect(subnet.getByLabel('NSG rule name', { exact: true })).toHaveValue('')
    await trace.click()
    await expect(packet.getByTestId('packet-nsg-result').getByRole('heading', { name: 'NSG filtering: allowed', exact: true })).toBeVisible()
    const response = packet.getByTestId('packet-nsg-result').locator('details').last()
    await response.locator('summary').click()
    await expect(response.getByText('Conditional response uses the allowed flow record, not newly initiated reverse rules. No live session is observed.', { exact: true })).toBeVisible()
    const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
    const persisted = saved.topology ?? saved
    expect(persisted.inventory.networkSecurityGroups).toHaveLength(2)
    expect(persisted.inventory.nsgAssociations.map((binding: { target: { id: string } }) => binding.target.id).sort()).toEqual(['app', 'nic-a'])
    expect(persisted.version).toBe(mode === 'vwan' ? 1 : 2)
    expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    const input: PlatformRequest = {
      contractVersion: 1, operation: 'simulate', document: { mode, topology: persisted },
      packet: {
        source: { kind: 'workload', workloadId: 'vm:a', nicId: 'nic-a', ipConfigurationId: 'ip-a' },
        target: { kind: 'workload', workloadId: 'vm-b', nicId: 'nic-b', ipConfigurationId: 'ip-b' },
        protocol: 'tcp', sourcePort: 49152, destinationPort: 443
      }
    }
    expect(await page.evaluate(async (input) => {
      const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
      return module.runBrowserSimulation(input)
    }, input)).toEqual(executePlatform(input))
    await page.keyboard.press('Escape')
    if (mode === 'full') await expect(page.getByTestId('aznet-subnet-nsg-pill').locator('text')).toHaveText('NSG 2')
    else await expect(page.getByTestId('vwan-spoke-nsg-pill').locator('text')).toHaveText('NSG 2')
    await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
    await page.reload()
    await node.click()
    await page.getByRole('button', { name: 'VNet の詳細', exact: true }).click()
    await subnet.locator('summary').first().click()
    await expect(subnet.getByLabel('NSG の関連付け', { exact: true })).toBeVisible()
    await expect(subnet.getByRole('button', { name: 'NSG ルールを保存', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'en'))
    await page.reload()
    await node.click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    await dialog.getByRole('button', { name: 'Application', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove workload and NICs', exact: true }).click()
    const afterDelete = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
    const pruned = afterDelete.topology ?? afterDelete
    expect(pruned.inventory.workloads.map((workload: { id: string }) => workload.id)).toEqual(['vm-b'])
    expect(pruned.inventory.nics.map((nic: { id: string }) => nic.id)).toEqual(['nic-b'])
    expect(pruned.inventory.networkSecurityGroups).toHaveLength(2)
    expect(pruned.inventory.nsgAssociations.map((binding: { target: { id: string } }) => binding.target.id)).toEqual(['app'])
  })
}

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  for (const narrow of [false, true]) {
    test(`${mode}: ${narrow ? 'narrow dark' : 'wide light'} detail edits original entities and preserves canvas state`, async ({ page }) => {
      const topology = design(mode)
      const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      await page.addInitScript(({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
      }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
      await page.setViewportSize({ width: narrow ? 390 : 1440, height: narrow ? 844 : 1000 })
      await page.goto(`/?mode=${mode}`)
      await page.getByLabel('Theme', { exact: true }).selectOption(narrow ? 'dark' : 'light')
      const node = mode === 'vwan' ? page.locator('.spoke-node[data-node-id="network"]') : page.getByTestId('aznet-vnet-network')
      const focusNode = mode === 'vwan' ? node : page.getByTestId('aznet-select-vnet-network')
      await node.click()
      const opener = page.getByRole('button', { name: 'VNet detail', exact: true })
      await opener.click()
      const dialog = page.getByTestId('network-detail-dialog')
      const svg = page.locator(mode === 'vwan' ? 'svg.diagram' : '[data-testid="aznet-diagram-svg"]')
      const viewBox = await svg.getAttribute('viewBox')
      await expect(dialog).toHaveAccessibleName('VNet detail: Network')
      const close = dialog.getByRole('button', { name: 'Close VNet detail', exact: true })
      await expect(close).toBeFocused()
      const contrast = await close.evaluate((button) => {
        const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
        const luminance = (color: string) => rgb(color).map((value) => {
          const c = value / 255
          return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
        }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
        const style = getComputedStyle(button), foreground = luminance(style.color), background = luminance(style.backgroundColor)
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
      })
      expect(contrast).toBeGreaterThanOrEqual(4.5)
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(narrow ? 391 : 1441)
      const form = dialog.getByTestId('add-workload-form')
      await form.getByLabel('Workload name', { exact: true }).fill('New VM')
      await form.getByLabel('Subnet', { exact: true }).selectOption('app')
      await form.getByLabel('Private IPv4 address (blank means unknown)', { exact: true }).fill('10.1.1.6')
      await expect(form.getByLabel('Public IPv4 address (blank means unknown)', { exact: true })).toBeDisabled()
      if (!narrow) {
        await form.getByLabel('Declare public IP association', { exact: true }).check()
        await form.getByLabel('Public IPv4 address (blank means unknown)', { exact: true }).fill('20.50.60.80')
      }
      await form.getByRole('button', { name: 'Add workload and NIC', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'New VM', exact: true })).toBeVisible()
      await expect.poll(async () => {
        const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
        return (saved.topology ?? saved).inventory.workloads.length
      }).toBe(3)
      if (!narrow) await expect(dialog.getByText('20.50.60.80', { exact: true })).toBeVisible()
      const packet = dialog.getByTestId('packet-flow-panel')
      await packet.getByLabel('Packet source', { exact: true }).selectOption({ label: 'Application / App NIC / Primary (10.1.1.4)' })
      await packet.getByLabel('Packet destination', { exact: true }).selectOption({ label: 'Database / DB NIC / Primary (10.1.1.5)' })
      await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
      await expect(packet.getByRole('heading', { name: 'Forward routing: reachable', exact: true })).toBeVisible()
      await expect(packet.getByRole('heading', { name: 'Reply routing: reachable', exact: true })).toBeVisible()
      await expect(packet.getByText('Delivery, security and translation readiness: not assessed', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      expect(await svg.getAttribute('viewBox')).toBe(viewBox)
      if (mode !== 'vwan') await expect(page.getByTestId('aznet-subnet-inventory-pill').locator('text')).toHaveText('VM 3 · NIC 3')
      const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
      const persisted = saved.topology ?? saved
      expect(persisted.inventory.workloads.map((workload: { id: string }) => workload.id)).toContain('vm:a')
      expect(persisted.version === 2 ? persisted.vnets[0].x : undefined).toBe(mode === 'vwan' ? undefined : 200)
      await page.reload()
      await node.click()
      await opener.click()
      await expect(dialog.getByRole('button', { name: 'New VM', exact: true })).toBeVisible()
      await close.click()
      await expect(dialog).toHaveCount(0)
      await focusNode.focus()
      await expect(focusNode).toBeFocused()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(focusNode).toBeFocused()
      const input: PlatformRequest = {
        contractVersion: 1, operation: 'simulate', document: { mode, topology: persisted },
        packet: { source: { kind: 'workload', workloadId: 'vm:a', nicId: 'nic-a', ipConfigurationId: 'ip-a' },
          target: { kind: 'workload', workloadId: 'vm-b', nicId: 'nic-b', ipConfigurationId: 'ip-b' },
          protocol: 'udp', sourcePort: 49152, destinationPort: 53 },
      }
      const actual = await page.evaluate(async (input) => {
        const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
        return module.runBrowserSimulation(input)
      }, input)
      expect(actual).toEqual(executePlatform(input))
      expect(actual.packet!.forward.routing).toBe('reachable')
      if (narrow) {
        await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
        await page.reload()
        await focusNode.focus()
        await page.keyboard.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'VNet の詳細を開く', exact: true }).click()
        await expect(dialog).toHaveAccessibleName('VNet の詳細: Network')
        await expect(dialog.getByRole('heading', { name: 'ワークロード パケット プローブ', exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Application', exact: true })).toBeVisible()
        await expect(dialog.getByLabel('パケット送信元', { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }

    })
  }
}

for (const narrow of [false, true]) {
  test(`explicit NAT Gateway: ${narrow ? 'narrow dark and Japanese' : 'wide light'} direct egress, tuple evidence and original-state persistence`, async ({ page }) => {
    const topology = design('full')
    if (topology.version !== 2) throw new Error('Mixed topology required')
    topology.vnets[0].subnets[0].defaultOutboundAccess = false
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, topology)
    await page.setViewportSize({ width: narrow ? 390 : 1440, height: narrow ? 844 : 1000 })
    await page.goto('/?mode=full')
    await page.getByLabel('Theme', { exact: true }).selectOption(narrow ? 'dark' : 'light')
    const node = page.getByTestId('aznet-vnet-network')
    const focusNode = page.getByTestId('aznet-select-vnet-network')
    await node.click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog'), editor = dialog.getByTestId('nat-gateway-editor')
    const packet = dialog.getByTestId('packet-flow-panel')
    await packet.getByRole('combobox', { name: 'Packet source', exact: true }).selectOption({ label: 'Application / App NIC / Primary (10.1.1.4)' })
    await packet.getByRole('combobox', { name: 'Packet destination', exact: true }).selectOption('external')
    await packet.getByLabel('External IPv4 address', { exact: true }).fill('8.8.8.8')
    const trace = packet.getByRole('button', { name: 'Trace packet routing', exact: true })
    await trace.click()
    await expect(packet.getByRole('heading', { name: 'Forward routing: unreachable', exact: true })).toBeVisible()
    await editor.locator('summary').click()
    await editor.getByLabel('NAT Gateway name', { exact: true }).fill('Declared egress')
    await editor.getByRole('button', { name: 'Add NAT Gateway', exact: true }).click()
    await trace.click()
    await expect(packet.getByRole('heading', { name: 'Forward routing: reachable', exact: true })).toBeVisible()
    await expect(packet.getByText('Delivery, security and translation readiness: not assessed', { exact: true })).toBeVisible()
    await editor.getByLabel('Public IPv4 address (blank means unknown)', { exact: true }).fill('20.40.50.60')
    await editor.getByRole('button', { name: 'Save NAT Gateway', exact: true }).click()
    await trace.click()
    await expect(packet.getByText('Conditional response, not a new Internet initiation', { exact: true })).toBeVisible()
    await expect(packet.getByText('Illustrative SNAT configured; delivery and security readiness: not assessed', { exact: true })).toBeVisible()
    await packet.getByRole('region', { name: 'Forward routing', exact: true }).locator('summary').click()
    await expect(packet.getByTestId('packet-step-tuples').first()).toContainText('10.1.1.4:49152')
    await expect(packet.getByTestId('packet-step-tuples').first()).toContainText('20.40.50.60:')
    expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    const persisted = await read()
    expect(persisted.vnets[0].subnets[0].defaultOutboundAccess).toBe(false)
    expect(persisted.inventory.natGateways[0]).toMatchObject({ owner: { kind: 'vnet', id: 'network' }, subnetIds: ['app'] })
    const input: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: persisted },
      packet: { source: { kind: 'workload', workloadId: 'vm:a', nicId: 'nic-a', ipConfigurationId: 'ip-a' },
        target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
    const worker = await page.evaluate(async (input) => {
      const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
      return module.runBrowserSimulation(input)
    }, input)
    expect(worker).toEqual(executePlatform(input))
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('aznet-subnet-nat-pill')).toHaveCount(1)
    await page.reload()
    await node.click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    await editor.locator('summary').click()
    await expect(editor.getByLabel('Public IPv4 address (blank means unknown)', { exact: true })).toHaveValue('20.40.50.60')
    await editor.getByRole('button', { name: 'Remove NAT Gateway from all associated subnets', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('aznet-subnet-nat-pill')).toHaveCount(0)
    await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
    await expect(page.getByTestId('aznet-subnet-nat-pill')).toHaveCount(1)
    expect((await read()).inventory.natGateways[0].id).toBe(persisted.inventory.natGateways[0].id)
    if (narrow) {
      await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
      await page.reload()
      await focusNode.focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'VNet の詳細を開く', exact: true }).click()
      await editor.locator('summary').click()
      await expect(editor.getByLabel('NAT Gateway 名', { exact: true })).toBeVisible()
      await expect(editor.getByRole('button', { name: 'NAT Gateway を保存', exact: true })).toBeVisible()
      expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    }
  })
}

for (const kind of ['azure-firewall', 'nva-vm'] as const) {
  test(`${kind}: original-router SNAT and its own subnet NAT Gateway preserve translated tuples and conditional returns`, async ({ page }) => {
    const topology = design('full')
    if (topology.version !== 2) throw new Error('Mixed topology required')
    topology.vnets[0].subnets[0].defaultOutboundAccess = false
    topology.vnets[0].subnets[0].routeTableId = 'steering'
    topology.vnets[0].subnets.push({ id: 'router-subnet', name: kind === 'azure-firewall' ? 'AzureFirewallSubnet' : 'Router subnet', prefix: '10.1.2.0/24' })
    topology.vnets[0].appliances = [{ id: 'router', name: 'Original router', kind, subnetId: 'router-subnet',
      privateIp: '10.1.2.4', enableIpForwarding: true, staticRoutes: [] }]
    topology.udrTables = [{ id: 'steering', name: 'Steering', disableBgpRoutePropagation: false,
      routes: [{ id: 'default', name: 'Default', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] }]
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, topology)
    await page.setViewportSize({ width: kind === 'nva-vm' ? 390 : 1440, height: 1000 })
    await page.goto('/?mode=full')
    await page.getByLabel('Theme', { exact: true }).selectOption(kind === 'nva-vm' ? 'dark' : 'light')
    await page.getByTestId('aznet-vnet-network').click()
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog')
    const editor = dialog.getByTestId('router-snat-editor')
    await editor.locator('summary').click()
    await editor.getByLabel('Router public IPv4 pool (comma-separated; ? means unknown; blank means no declared pool)', { exact: true }).fill('20.40.50.70')
    await editor.getByRole('button', { name: 'Save router SNAT', exact: true }).click()
    const nat = dialog.getByTestId('detail-subnet').filter({ hasText: '10.1.2.0/24' }).getByTestId('nat-gateway-editor')
    await nat.locator('summary').click()
    await nat.getByLabel('NAT Gateway name', { exact: true }).fill('Router egress')
    await nat.getByLabel('Public IPv4 addresses (comma-separated; blank means unknown)', { exact: true }).fill('20.40.50.60')
    await nat.getByRole('button', { name: 'Add NAT Gateway', exact: true }).click()
    const packet = dialog.getByTestId('packet-flow-panel')
    await packet.getByRole('combobox', { name: 'Packet source', exact: true }).selectOption({ label: 'Application / App NIC / Primary (10.1.1.4)' })
    await packet.getByRole('combobox', { name: 'Packet destination', exact: true }).selectOption('external')
    await packet.getByLabel('External IPv4 address', { exact: true }).fill('8.8.8.8')
    await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
    await expect(packet.getByRole('heading', { name: 'Reply routing: reachable', exact: true })).toBeVisible()
    await packet.getByRole('region', { name: 'Forward routing', exact: true }).locator('summary').click()
    const tuples = packet.getByRole('region', { name: 'Forward routing', exact: true }).getByTestId('packet-step-tuples')
    await expect(tuples).toHaveCount(2)
    await expect(tuples.nth(0)).toContainText('10.1.2.4:')
    await expect(tuples.nth(1)).toContainText('20.40.50.60:')
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(persisted.inventory.routerSnatPolicies[0]).toMatchObject({ owner: { kind: 'appliance', id: 'router' } })
    expect(persisted.inventory.natGateways[0].subnetIds).toEqual(['router-subnet'])
    const input: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: persisted },
      packet: { source: { kind: 'workload', workloadId: 'vm:a', nicId: 'nic-a', ipConfigurationId: 'ip-a' },
        target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
    const worker = await page.evaluate(async (input) => {
      const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
      return module.runBrowserSimulation(input)
    }, input)
    expect(worker).toEqual(executePlatform(input))
    expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    if (kind === 'nva-vm') {
      await page.keyboard.press('Escape')
      await page.getByRole('combobox', { name: 'Language / 言語', exact: true }).selectOption('ja')
      await page.getByTestId('aznet-select-vnet-network').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'VNet の詳細を開く', exact: true }).click()
      await editor.locator('summary').click()
      await expect(editor.getByRole('button', { name: 'ルーター SNAT を保存', exact: true })).toBeVisible()
      await expect(editor).toContainText('IP 転送だけでは NAT は有効になりません。')
      expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
    }
  })
}

test('explicitly resolving an unknown captured association is required before claiming instance public egress', async ({ page }) => {
  const topology = design('full')
  if (topology.version !== 2) throw new Error('Mixed topology required')
  topology.vnets[0].subnets[0].defaultOutboundAccess = false
  topology.vnets[0].subnets[0].internetEgressStatus = 'unknown'
  topology.inventory!.publicIps.push({ id: 'pip', name: 'Instance IP', address: '20.40.50.60', sku: 'Standard', allocation: 'Static' })
  topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'pip'
  await page.addInitScript((topology) => localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology })), topology)
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vnet-network').click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog'), editor = dialog.getByTestId('nat-gateway-editor')
  const packet = dialog.getByTestId('packet-flow-panel')
  await packet.getByRole('combobox', { name: 'Packet source', exact: true }).selectOption({ label: 'Application / App NIC / Primary (10.1.1.4)' })
  await packet.getByRole('combobox', { name: 'Packet destination', exact: true }).selectOption('external')
  await packet.getByLabel('External IPv4 address', { exact: true }).fill('8.8.8.8')
  await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
  await expect(packet.getByText('Delivery, security and translation readiness: not assessed', { exact: true })).toBeVisible()
  await editor.locator('summary').click()
  await editor.getByRole('combobox', { name: 'NAT Gateway association', exact: true }).selectOption({ label: 'No explicit NAT Gateway' })
  await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
  await expect(packet.getByText('Illustrative SNAT configured; delivery and security readiness: not assessed', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].subnets[0].internetEgressStatus)).toBeUndefined()
})

test('mixed hub controls preserve association, expose a label-propagated custom RIB and render inter-hub transit', async ({ page }) => {
  const topology = design('full')
  if (topology.version !== 2) throw new Error('Mixed topology required')
  topology.vwanHubs = ['a', 'b'].map((suffix) => ({
    id: `hub-${suffix}`, name: `Hub ${suffix.toUpperCase()}`, region: 'westeurope', preference: 'ASPath',
    routingIntent: { private: false, internet: false },
  }))
  topology.vwanHubs[0].routeTablesStatus = 'unknown'
  topology.vnets[0].vwanHubAttachment = { hubId: 'hub-a', enabled: true }
  topology.vnets.push({ id: 'remote', name: 'Remote', role: 'spoke-vnet', region: 'westeurope', prefixes: ['10.2.0.0/16'],
    subnets: [{ id: 'remote-app', name: 'Remote app', prefix: '10.2.1.0/24' }], gateways: [], appliances: [],
    vwanHubAttachment: { hubId: 'hub-b', enabled: true, hubRouting: {
      status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['defaultRouteTable'], labels: ['blue'],
    } } })
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('aznet-inter-hub-edge')).toHaveCount(1)
  const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
  await tools.getByRole('searchbox').fill('hub-a')
  await tools.getByRole('button', { name: 'Select Virtual WAN hub: Hub A', exact: true }).click()
  await tools.getByRole('button', { name: 'Configure Hub & Labels', exact: true }).click()
  const editor = page.getByTestId('aznet-hub-tables-editor')
  await expect(editor.getByRole('status')).toContainText('Hub table scope is unknown.')
  await editor.getByRole('button', { name: 'Add hub table', exact: true }).click()
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  await expect.poll(async () => (await read()).vwanHubs[0].routeTables?.length).toBe(1)
  expect((await read()).vwanHubs[0].routeTablesStatus).toBe('unknown')
  await editor.getByRole('button', { name: 'Use edited hub table scope', exact: true }).click()
  await expect.poll(async () => (await read()).vwanHubs[0].routeTablesStatus).toBeUndefined()
  const id = (await read()).vwanHubs[0].routeTables[0].id
  await editor.getByLabel(`Table name ${id}`, { exact: true }).fill('Blue')
  await editor.getByLabel(`Table labels ${id}`, { exact: true }).fill('blue')
  await editor.getByLabel(`Table labels ${id}`, { exact: true }).press('Tab')
  await editor.getByLabel('Associated table Network', { exact: true }).selectOption(id)
  await expect.poll(async () => (await read()).vnets[0].vwanHubAttachment.hubRouting.associatedTableId).toBe(id)
  await tools.getByRole('button', { name: 'Inspect Virtual WAN Hub Effective RIB', exact: true }).click()
  await page.getByLabel('Hub routing table', { exact: true }).selectOption(id)
  await expect(page.getByRole('dialog')).toContainText('10.2.0.0/16')
  await page.reload()
  expect((await read()).vwanHubs[0].routeTables[0]).toMatchObject({ id, name: 'Blue', labels: ['blue'] })
})

test('large inventory remains searchable and rejected edits preserve the original graph and input draft', async ({ page }) => {
  const topology = design('full')
  topology.inventory!.workloads[0].name = 'LongImportedWorkloadName'.repeat(160)
  for (let index = 0; index < 150; index++) {
    topology.inventory!.workloads.push({ id: `late-${index}`, name: `Late ${index}`, nicIds: [`late-nic-${index}`] })
    topology.inventory!.nics.push({ id: `late-nic-${index}`, name: `NIC ${index}`, owner: { kind: 'vnet', id: 'network' },
      ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: 'app', privateIp: `10.1.1.${index + 10}` }] })
  }
  await page.addInitScript((topology) => localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology })), topology)
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vnet-network').click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog')
  await expect(dialog.locator('.detail-workload')).toHaveCount(100)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await dialog.getByLabel('Search workloads', { exact: true }).fill('late-149')
  await expect(dialog.locator('.detail-workload')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Late 149', exact: true }).click()
  const form = dialog.locator('form').filter({ has: page.getByRole('heading', { name: 'Selected workload', exact: true }) })
  await form.getByLabel('Workload name', { exact: true }).fill('Changed draft')
  await form.getByLabel('Primary · Private IPv4 address (blank means unknown)', { exact: true }).fill('10.9.9.9')
  const before = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await form.getByRole('button', { name: 'Save workload', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('invalid, reserved or duplicate private address')
  await expect(form.getByLabel('Workload name', { exact: true })).toHaveValue('Changed draft')
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
  await form.getByLabel('Primary · Private IPv4 address (blank means unknown)', { exact: true }).fill('10.1.1.159')
  await form.getByRole('button', { name: 'Save workload', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Changed draft', exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByTestId('aznet-subnet-app').focus()
  await expect(page.getByTestId('aznet-subnet-app')).toBeFocused()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
  const prefix = page.getByTestId('aznet-subnet-prefix-app')
  const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await prefix.fill('')
  await prefix.pressSequentially('10.1.0.0/23')
  await expect(prefix).toHaveValue('10.1.0.0/23')
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
  await prefix.press('Tab')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].subnets[0].prefix)).toBe('10.1.0.0/23')
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode}: opening legacy detail does not invent workloads, NICs, public IPs or subnets`, async ({ page }) => {
    const topology = design(mode)
    delete topology.inventory
    if (topology.version === 1) delete topology.spokes[0].subnets
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
    }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
    await page.goto(`/?mode=${mode}`)
    await page.locator(mode === 'vwan' ? '.spoke-node[data-node-id="network"]' : '[data-testid="aznet-vnet-network"]').click()
    const before = await page.evaluate((key) => localStorage.getItem(key), key)
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog')
    await expect(dialog.getByText('No named workloads are declared. Legacy subnet probes remain available; they are not discovered VMs.', { exact: true })).toBeVisible()
    if (mode === 'vwan') await expect(dialog.getByRole('button', { name: 'Add workload and NIC', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before)
  })
}
