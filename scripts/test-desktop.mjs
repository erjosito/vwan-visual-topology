import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const artifacts = resolve('test-artifacts', 'desktop')
await mkdir(artifacts, { recursive: true })
const executablePath = process.env.DESKTOP_EXECUTABLE
let brandedWindowsResources = false
if (executablePath) {
  const { NtExecutable, NtExecutableResource } = await import('resedit')
  const icon = await readFile(resolve('public', 'desktop-icon.png'))
  const { buildVersion } = JSON.parse(await readFile(resolve('electron-builder.json'), 'utf8'))
  for (const file of [executablePath, resolve('release', `Azure-Network-Simulator-${buildVersion}-x64.exe`)]) {
    const resources = NtExecutableResource.from(NtExecutable.from(await readFile(file))).entries
    expect(resources.some((entry) => entry.type === 3 && Buffer.from(entry.bin).equals(icon))).toBe(true)
  }
  brandedWindowsResources = true
}
const application = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('platform-dist', 'electron', 'main.cjs')]), `--user-data-dir=${join(artifacts, executablePath ? 'packaged-profile' : 'development-profile')}`],
})
const require = createRequire(import.meta.url)
const { executePlatform } = require('../platform-dist/service.cjs')
const outbound = [], failures = []
try {
  const page = await application.firstWindow()
  page.on('request', (request) => { if (/^https?:/.test(request.url())) outbound.push(request.url()) })
  page.on('pageerror', (error) => failures.push(error.message))
  await page.locator('[data-testid="vwan-app"], [data-testid="aznet-app"], dialog[aria-labelledby="workspace-library-title"]').waitFor()
  await page.evaluate(() => {
    for (const key of ['network-simulator:workspace:v1', 'network-simulator:originals:v1', 'vwan-visual-topology:v1', 'aznet-visual-topology:v1']) localStorage.removeItem(key)
  })
  await page.reload()
  await page.getByTestId('aznet-app').waitFor()
  const emptyToolsOpener = page.getByRole('button', { name: 'Workspace controls', exact: true })
  if (await emptyToolsOpener.getAttribute('aria-expanded') !== 'true') await emptyToolsOpener.click()
  await expect(page.getByTestId('aznet-add-vwan-hub-btn')).toBeEnabled()
  await expect(page.getByTestId('aznet-add-vnet-btn')).toBeEnabled()
  await expect(page.locator('[data-testid^="aznet-vnet-"]')).toHaveCount(0)
  await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
  await page.goto('app://simulator/?mode=vwan')
  await page.getByTestId('vwan-app').waitFor()
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeDisabled()
  await expect(page.locator('.diagram [data-node-id]')).toHaveCount(0)
  const initialToolsOpener = page.getByRole('button', { name: 'Workspace controls', exact: true })
  if (await initialToolsOpener.getAttribute('aria-expanded') !== 'true') await initialToolsOpener.click()
  await expect(page.getByRole('button', { name: '+ Hub', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Sample topologies', exact: true }).click()
  await page.getByRole('dialog', { name: 'Sample topologies', exact: true }).getByRole('button', { name: 'Load sample topology', exact: true }).first().click()
  const savedVwan = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  const hubCount = JSON.parse(savedVwan).hubs.length
  expect(hubCount).toBeGreaterThan(0)
  await page.reload()
  await expect(page.locator('.hub-node')).toHaveCount(hubCount)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(savedVwan)
  await page.evaluate(() => localStorage.setItem('vwan-visual-topology:v1', 'damaged saved workspace'))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Download original saved topology', exact: true })).toBeVisible()
  await expect(page.locator('.diagram [data-node-id]')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe('damaged saved workspace')
  await page.evaluate(() => localStorage.removeItem('vwan-visual-topology:v1'))
  await page.reload()
  await page.evaluate(() => localStorage.removeItem('aznet-simulator:practice:v1'))
  expect(await page.evaluate(() => ({ node: typeof window.require, ipc: Object.keys(window.desktopSimulator) }))).toEqual({
    node: 'undefined', ipc: ['openTopology', 'accounts', 'targets', 'collect', 'simulate'],
  })
  for (const [mode, file] of [
    ['vwan', 'hub-routing-preferences.json'],
    ['hub-spoke', 'azure-net/hub-spoke-firewall-udr.json'],
    ['full', 'azure-net/hybrid-vwan-and-hub-spoke.json'],
  ]) {
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    const topology = JSON.parse(await readFile(resolve('public', 'docs', 'samples', ...file.split('/')), 'utf8'))
    const inventoryOwner = mode === 'vwan' ? topology.spokes[0] : topology.vnets.find((vnet) => vnet.role === 'spoke-vnet')
    if (mode === 'vwan') inventoryOwner.subnets = [{ id: 'desktop-subnet', name: 'Desktop subnet', prefix: inventoryOwner.prefixes[0] }]
    const subnet = inventoryOwner.subnets[0]
    if (mode === 'full') {
      const hub = topology.vwanHubs[0]
      topology.vpnConnections.push({ id: 'desktop-sdwan', name: 'Desktop SD-WAN', siteId: topology.sites[0].id,
        targetKind: 'vwan-hub', targetId: hub.id, enabled: true, bgpEnabled: true, transport: 'SDWAN', learnSiteRoutes: true, propagateDefaultRoute: false })
      topology.routeMaps = [...(topology.routeMaps ?? []), { id: 'desktop-policy', name: 'Desktop hub policy', hubId: hub.id,
        rules: [{ id: 'prepend', prefixes: [], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [64496], nextStep: 'terminate' }] }]
      hub.routeMapAssignments = [{ connectionId: inventoryOwner.id, inboundMapId: 'desktop-policy' }]
      inventoryOwner.appliances.push({ id: 'desktop-nva', name: 'Desktop NVA', kind: 'nva-vm', subnetId: subnet.id,
        privateIp: `${subnet.prefix.split('/')[0].split('.').slice(0, 3).join('.')}.5`, asn: 65010,
        bgpEnabled: true, vwanBgpEnabled: true, enableIpForwarding: true, staticRoutes: [], advertisedPrefixes: ['192.0.2.0/24'] })
    }
    topology.inventory = {
      workloads: [{ id: 'desktop-vm', name: 'Desktop workload', nicIds: ['desktop-nic'] }],
      nics: [{ id: 'desktop-nic', name: 'Desktop NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: inventoryOwner.id },
        ipConfigurations: [{ id: 'desktop-ip', name: 'Primary', subnetId: subnet.id, privateIp: `${subnet.prefix.split('/')[0].split('.').slice(0, 3).join('.')}.4` }] }],
      publicIps: [],
    }
    const request = { contractVersion: 1, operation: 'simulate', document: { mode, topology } }
    const result = await page.evaluate((input) => window.desktopSimulator.simulate(input), request)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(executePlatform(request))
    if (mode === 'full') {
      expect(result.value.simulation.vwanHubRibs[topology.vwanHubs[0].id]).toEqual(expect.arrayContaining([
        expect.objectContaining({ prefix: '192.0.2.0/24', nextHopId: 'desktop-nva', asPath: [64496, 65010], preferred: true }),
      ]))
    }
    const packetRequest = { ...request, packet: {
      source: { kind: 'workload', workloadId: 'desktop-vm', nicId: 'desktop-nic', ipConfigurationId: 'desktop-ip' },
      target: { kind: 'external', address: '20.50.60.70' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
    } }
    const packet = await page.evaluate((input) => window.desktopSimulator.simulate(input), packetRequest)
    expect(packet.ok).toBe(true)
    expect(packet.value.status).toBe('complete')
    expect(packet.value).toEqual(executePlatform(packetRequest))
    expect(packet.value.packet.reply.routing).toBe('not-assessed')
    if (mode === 'full') {
      const hub = topology.vwanHubs[0]
      const vnet = topology.vnets.find((vnet) => vnet.vwanHubAttachment?.hubId === hub.id)
      const scoped = { ...request, operation: 'evaluate', requirements: [
        { id: 'hub', kind: 'route', table: hub.id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
        { id: 'custom', kind: 'route', table: hub.id, hubTableId: 'custom', prefix: vnet.prefixes[0], expectation: 'absent' },
        { id: 'subnet', kind: 'route', table: vnet.subnets[0].id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
      ] }
      const assessed = await page.evaluate((input) => window.desktopSimulator.simulate(input), scoped)
      expect(assessed.ok).toBe(true)
      expect(assessed.value.assessments.map((goal) => goal.outcome)).toEqual(['satisfied', 'not assessed', 'not assessed'])
      expect(assessed.value).toEqual(executePlatform(scoped))
    }
    if (mode !== 'vwan') await expect(page.getByTestId('aznet-share-url-btn')).toBeDisabled()
    const localFile = join(artifacts, `roundtrip-${mode}.json`)
    await writeFile(localFile, JSON.stringify(topology))
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, localFile)
    await page.getByRole('button', { name: 'Open local JSON', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Review the local file' })).toBeVisible()
    const readSaved = () => page.evaluate((mode) => {
      const value = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'))
      return mode === 'vwan' ? value : value.topology
    }, mode)
    await expect.poll(readSaved).toEqual(executePlatform({ ...request, operation: 'validate' }).document.topology)
    const detailNode = mode === 'vwan' ? page.locator(`.spoke-node[data-node-id="${inventoryOwner.id}"]`) : page.getByTestId(`aznet-vnet-${inventoryOwner.id}`)
    await detailNode.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
    const detail = page.getByTestId('network-detail-dialog')
    await detail.getByRole('button', { name: 'Desktop workload', exact: true }).click()
    const workloadForm = detail.locator('form').filter({ has: page.getByRole('heading', { name: 'Selected workload', exact: true }) })
    await workloadForm.getByLabel('Workload name', { exact: true }).fill('Edited desktop workload')
    await workloadForm.getByRole('button', { name: 'Save workload', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Edited desktop workload', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    expect((await readSaved()).inventory.workloads[0]).toEqual({ id: 'desktop-vm', name: 'Edited desktop workload', nicIds: ['desktop-nic'] })
    const originalWindow = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const size = window.getContentSize()
      window.setContentSize(1024, 640)
      return size
    })
    const toolsOpener = page.getByRole('button', { name: 'Workspace controls', exact: true })
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    if (await toolsOpener.getAttribute('aria-expanded') !== 'true') await toolsOpener.click()
    const beforeDiscovery = await readSaved()
    const hub = mode === 'vwan' ? beforeDiscovery.hubs[0] : mode === 'full' ? beforeDiscovery.vwanHubs[0] : undefined
    const node = hub ?? beforeDiscovery.vnets[0]
    await tools.getByRole('searchbox').fill(node.id)
    await tools.getByRole('button', {
      name: `Select ${hub ? 'Virtual WAN hub' : 'VNet'}: ${node.label ?? node.name}`, exact: true,
    }).click()
    await expect(tools.locator('h3[tabindex="-1"]')).toBeFocused()
    await expect(tools.locator('h3[tabindex="-1"]')).toBeInViewport()
    await expect(tools.getByRole('searchbox')).toHaveValue('')
    expect(await readSaved()).toEqual(beforeDiscovery)
    await toolsOpener.click()
    await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), originalWindow)
    const exportFile = join(artifacts, `export-${mode}.json`)
    await application.evaluate(({ session }, destination) => {
      globalThis.__desktopDownloadDone = new Promise((resolve) => {
        session.defaultSession.once('will-download', (_event, item) => {
          item.setSavePath(destination)
          item.once('done', (_event, state) => resolve(state))
        })
      })
    }, exportFile)
    await page.getByRole('button', { name: /Export JSON/ }).click()
    expect(await application.evaluate(() => globalThis.__desktopDownloadDone)).toBe('completed')
    expect(JSON.parse(await readFile(exportFile, 'utf8'))).toEqual(await readSaved())
    if (mode === 'vwan') {
      await page.getByLabel(`Select hub ${topology.hubs[0].name}`, { exact: true }).focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'BGP table', exact: true }).click()
      const routes = page.getByRole('dialog', { name: `BGP table · ${topology.hubs[0].name}`, exact: true })
      const preferred = routes.locator('tr[data-prefix="10.50.0.0/16"][data-preferred="true"] .as-path').first()
      const before = await preferred.innerText()
      await routes.getByLabel('Hub routing preference', { exact: true }).selectOption('VPN')
      await expect(preferred).not.toHaveText(before)
      await expect.poll(async () => (await readSaved()).hubs[0].preference).toBe('VPN')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Check routing', exact: true }).click()
      await page.getByRole('button', { name: 'Advanced checks', exact: true }).click()
      const diagnostics = page.getByRole('dialog', { name: 'Routing diagnostics', exact: true })
      await diagnostics.getByRole('button', { name: 'Add flow requirement', exact: true }).click()
      await diagnostics.getByRole('button', { name: 'Run diagnostics', exact: true }).click()
      await expect(diagnostics.getByRole('region', { name: 'Diagnostic results' })).toBeVisible({ timeout: 15000 })
    }
    await page.getByTestId('learning-open').click()
    const learning = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
    await learning.locator('[data-concept="coverage"] summary').click()
    await expect(learning.locator('[data-concept="coverage"]')).toContainText('not certification')
    await learning.getByRole('button', { name: 'Practice', exact: true }).click()
    await learning.getByLabel('Choose an exercise', { exact: true }).selectOption(mode === 'vwan' ? 'vwan-connect' : mode === 'hub-spoke' ? 'peering-connect' : 'hybrid-connect')
    const draftControl = learning.getByLabel('Practice topology JSON', { exact: true })
    const practice = JSON.parse(await draftControl.inputValue())
    if (mode === 'vwan') {
      practice.spokes[1].hubId = 'one'
      delete practice.spokes[1].hubRouting
    } else if (mode === 'full') {
      practice.vnets[1].vwanHubAttachment = { hubId: 'hub', enabled: true }
    } else {
      const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
      practice.vnetPeerings.push({ id: 'practice-peer', name: 'Practice peering', vnetAId: 'a', vnetBId: 'b', enabled: true, aToB: flags, bToA: { ...flags } })
    }
    await draftControl.fill(JSON.stringify(practice, null, 2))
    await learning.getByRole('button', { name: 'Show next hint', exact: true }).click()
    await learning.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(learning.getByTestId('practice-result')).toContainText('Practice requirements satisfied', { timeout: 15000 })
    await expect(learning).toContainText('Practice badge (local, unverified)')
    const retainedWorkspace = await readSaved()
    await page.keyboard.press('Escape')
    await page.reload()
    await page.getByTestId('learning-open').click()
    await learning.getByRole('button', { name: 'Practice', exact: true }).click()
    await learning.getByLabel('Choose an exercise', { exact: true }).selectOption(mode === 'vwan' ? 'vwan-connect' : mode === 'hub-spoke' ? 'peering-connect' : 'hybrid-connect')
    await expect(draftControl).toHaveValue(JSON.stringify(practice, null, 2))
    await expect(learning).toContainText('Hints used: 1/2')
    expect(await readSaved()).toEqual(retainedWorkspace)
    await page.keyboard.press('Escape')
  }
  expect(outbound).toEqual([])
  expect(failures).toEqual([])
  const blocked = await page.evaluate(async () => {
    try { await fetch('https://example.com/desktop-privacy-test'); return false }
    catch { return true }
  })
  expect(blocked).toBe(true)
  const rejected = await page.evaluate(() => window.desktopSimulator.targets({ subscriptionId: '& whoami', tenantId: 'invalid' }))
  expect(rejected.ok).toBe(false)
  for (const kind of ['direct', 'azure-firewall', 'nva-vm', 'vwan-hub']) {
    const native = kind === 'vwan-hub', mode = native ? 'vwan' : 'full'
    const inventory = {
      workloads: [{ id: 'client', name: 'Client', nicIds: ['client-nic'] }],
      nics: [{ id: 'client-nic', name: 'Client NIC', owner: { kind: native ? 'spoke' : 'vnet', id: 'network' },
        ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] }],
      publicIps: [{ id: 'nat-ip', name: 'NAT IP', address: '20.40.50.60', sku: 'Standard', allocation: 'Static' },
        { id: 'router-ip', name: 'Router IP', address: '20.40.50.70', sku: 'Standard', allocation: 'Static' }],
      natGateways: [{ id: 'nat', name: 'NAT Gateway', sku: 'Standard', owner: { kind: native ? 'spoke' : 'vnet', id: 'network' },
        subnetIds: [kind === 'direct' || native ? 'app' : 'router-subnet'], publicIpIds: ['nat-ip'] }],
      ...(kind !== 'direct' ? { routerSnatPolicies: [kind === 'nva-vm'
        ? { owner: { kind: 'appliance', id: 'router' }, kind: 'nva-snat', publicIpIds: ['router-ip'],
          sourcePrefixes: ['10.1.1.0/24'], destinationPrefixes: ['0.0.0.0/0'], protocol: 'any' }
        : { owner: { kind: native ? 'hub' : 'appliance', id: 'router' }, kind: 'firewall-network-rules',
          publicIpIds: ['router-ip'], zoneRedundant: false }] } : {}),
    }
    const appSubnet = { id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false }
    const topology = native
      ? { version: 1, name: 'Desktop hub SNAT', hubs: [{ id: 'router', name: 'Router', region: 'westeurope', preference: 'ExpressRoute',
        routingIntent: { internet: true, private: false, privatePrefixes: [] } }],
        spokes: [{ id: 'network', name: 'Network', hubId: 'router', prefixes: ['10.1.0.0/16'], subnets: [appSubnet] }],
        sites: [], connections: [], siteLinks: [], inventory }
      : { version: 2, kind: 'azure-network-topology', name: `Desktop ${kind} SNAT`,
        vnets: [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
          subnets: [{ ...appSubnet, ...(kind !== 'direct' ? { routeTableId: 'steering' } : {}) },
            { id: 'router-subnet', name: kind === 'azure-firewall' ? 'AzureFirewallSubnet' : 'Router', prefix: '10.1.2.0/24' }],
          gateways: [], appliances: kind === 'direct' ? [] : [{ id: 'router', name: 'Router', kind,
            subnetId: 'router-subnet', privateIp: '10.1.2.4', enableIpForwarding: true, staticRoutes: [] }] }],
        udrTables: kind === 'direct' ? [] : [{ id: 'steering', name: 'Steering', disableBgpRoutePropagation: false,
          routes: [{ id: 'default', name: 'Default', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] }],
        vnetPeerings: [], vwanHubs: [], erLocations: [], erLinks: [], erGlobalReachLinks: [], sites: [], vpnConnections: [], siteLinks: [], inventory }
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.getByTestId(native ? 'vwan-app' : 'aznet-app').waitFor()
    const input = { contractVersion: 1, operation: 'simulate', document: { mode, topology }, packet: {
      source: { kind: 'workload', workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
      target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
    } }
    const result = await page.evaluate((request) => window.desktopSimulator.simulate(request), input)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(executePlatform(input))
    expect(result.value.packet).toMatchObject({ translation: 'snat', egress: 'configured', reply: { session: 'conditional-response', routing: 'reachable' } })
    const translations = result.value.packet.forward.steps.filter((step) => step.after && step.before.sourceAddress !== step.after.sourceAddress)
    expect(translations.at(-1).after.sourceAddress).toBe(native ? '20.40.50.70' : '20.40.50.60')
    if (kind === 'azure-firewall' || kind === 'nva-vm') expect(translations[0].after.sourceAddress).toBe('10.1.2.4')
    inventory.networkSecurityGroups = [{ id: 'source-nsg', name: 'Source NSG', rules: [{ id: 'deny-web', name: 'DenyWeb',
      priority: 100, direction: 'outbound', action: 'deny', protocol: 'tcp', sources: ['*'], destinations: ['*'],
      sourcePorts: ['*'], destinationPorts: ['443'] }] }]
    inventory.nsgAssociations = [{ owner: inventory.nics[0].owner, target: { kind: 'subnet', id: 'app' }, nsgId: 'source-nsg' },
      { owner: inventory.nics[0].owner, target: { kind: 'nic', id: 'client-nic' }, nsgId: 'source-nsg' }]
    const denied = await page.evaluate((request) => window.desktopSimulator.simulate(request), input)
    expect(denied.ok).toBe(true)
    expect(denied.value).toEqual(executePlatform(input))
    expect(denied.value.packet).toMatchObject({ security: 'denied', translation: 'not-assessed', egress: 'blocked',
      forward: { routing: 'reachable' }, nsg: { forward: { outcome: 'denied' } } })
    expect(denied.value.packet.forward.native).toEqual(result.value.packet.forward.native)
    expect(denied.value.packet.reply.session).toBeUndefined()
    inventory.networkSecurityGroups[0].rulesStatus = 'unknown'
    const unknown = await page.evaluate((request) => window.desktopSimulator.simulate(request), input)
    expect(unknown.ok).toBe(true)
    expect(unknown.value).toEqual(executePlatform(input))
    expect(unknown.value.packet.nsg.forward.outcome).toBe('not-assessed')
    if (!native) {
      const ingressTopology = structuredClone(topology), ingressInventory = ingressTopology.inventory
      ingressInventory.networkSecurityGroups[0] = { id: 'source-nsg', name: 'Backend NSG', rules: [{
        id: 'allow-ingress', name: 'AllowIngress', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
        sources: [kind === 'direct' ? '8.8.8.8/32' : '10.1.2.0/24'], destinations: ['10.1.1.4'],
        sourcePorts: ['*'], destinationPorts: [kind === 'direct' ? '443' : '8443'],
      }] }
      const frontendId = kind === 'direct' ? 'instance-ingress' : 'router-ip'
      if (kind === 'direct') {
        ingressInventory.publicIps.push({ id: frontendId, name: 'Instance ingress', sku: 'Standard', allocation: 'Static', address: '20.40.50.80' })
        ingressInventory.nics[0].ipConfigurations[0].publicIpId = frontendId
      } else {
        const base = { owner: { kind: 'appliance', id: 'router' }, publicIpIds: [frontendId], rules: [{
          id: 'ingress-web', name: 'Ingress web', priority: 100, protocol: 'tcp', sourcePrefixes: ['8.8.8.8/32'],
          publicIpId: frontendId, frontendPort: 443,
          target: { workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' }, translatedPort: 8443,
        }] }
        ingressInventory.routerDnatPolicies = [kind === 'azure-firewall' ? { ...base, kind: 'firewall-dnat' }
          : { ...base, kind: 'nva-dnat', sourceTranslation: 'interface' }]
        if (kind === 'nva-vm') {
          ingressInventory.workloads.push({ id: 'router-vm', name: 'Router VM', backingDeviceId: 'router', nicIds: ['router-nic'] })
          ingressInventory.nics.push({ id: 'router-nic', name: 'Router NIC', owner: { kind: 'vnet', id: 'network' },
            ipConfigurations: [{ id: 'router-config', name: 'Primary', subnetId: 'router-subnet', privateIp: '10.1.2.4' }] })
          ingressInventory.networkSecurityGroups.push({ id: 'router-nsg', name: 'Router NSG', rules: [{
            id: 'allow-router', name: 'AllowRouter', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
            sources: ['8.8.8.8/32'], destinations: ['10.1.2.4'], sourcePorts: ['*'], destinationPorts: ['443'],
          }] })
          ingressInventory.nsgAssociations.push({ owner: { kind: 'vnet', id: 'network' }, target: { kind: 'nic', id: 'router-nic' }, nsgId: 'router-nsg' })
        }
      }
      const ingressInput = { ...input, document: { mode, topology: ingressTopology }, packet: {
        source: { kind: 'external', address: '8.8.8.8' }, target: { kind: 'public-ip', publicIpId: frontendId },
        protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
      } }
      const ingress = await page.evaluate((request) => window.desktopSimulator.simulate(request), ingressInput)
      expect(ingress.ok).toBe(true)
      expect(ingress.value).toEqual(executePlatform(ingressInput))
      expect(ingress.value.packet).toMatchObject({ ingress: 'configured', reply: { routing: 'reachable', session: 'conditional-response' } })
      expect(ingress.value.packet.reply.steps.at(-1).after.sourceAddress).toBe(kind === 'direct' ? '20.40.50.80' : '20.40.50.70')
    }
  }
  await page.goto('app://simulator/?mode=vwan&feedback=1')
  await page.getByTestId('vwan-app').waitFor()
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeDisabled()
  expect(await page.locator('.feedback-modal').count()).toBe(0)
  const documentationWindow = application.waitForEvent('window')
  await page.getByRole('button', { name: 'Docs', exact: true }).click()
  const documentation = await documentationWindow
  await documentation.waitForLoadState()
  expect(documentation.url()).toContain('app://simulator/docs/')
  expect(await documentation.evaluate(() => typeof window.desktopSimulator)).toBe('undefined')
  expect(await documentation.locator('body').innerText()).toContain('Virtual WAN')
  await documentation.close()
  const runtime = await application.evaluate(({ app }) => ({
    version: app.getVersion(), electron: process.versions.electron,
    userData: app.getPath('userData'), mainMemoryBytes: process.memoryUsage().rss,
  }))
  await page.screenshot({ path: join(artifacts, executablePath ? 'packaged.png' : 'development.png') })
  await writeFile(join(artifacts, executablePath ? 'packaged-checks.json' : 'development-checks.json'), JSON.stringify({
    verifiedAtUtc: new Date().toISOString(), packaged: !!executablePath, modes: ['vwan', 'hub-spoke', 'full'],
    engineParity: true, localJsonRoundTrips: true, localNativeExports: true, offlineNoAutomaticHttpRequests: true,
    rendererNodeUnavailable: true, remoteFetchBlocked: true, malformedScopeRejected: true, externalIntegrationsDisabled: true,
    documentationWithoutBridge: true, runtime,
    immediateHrpUiReevaluation: true, localDiagnosticsWorker: true,
    localThreeModePracticeWorker: true, independentPersistedPracticeDrafts: true, unverifiedLocalPracticeBadges: true,
    freshVwanStartsEmpty: true, explicitVwanSampleLoading: true, savedVwanRestored: true, damagedVwanSavedDataPreserved: true,
    brandedWindowsResources,
    sharedObjectDiscovery: true, providerScopedSelection: true, objectDiscoveryPreservesSavedGraph: true,
    compactDesktopPointerDiscovery: true,
    ownedMixedHubRouteAssertions: true,
    ownedWorkloadPacketParity: true, originalInventoryDetailEditsPersisted: true,
    explicitNatFirewallNvaAndNativeHubPacketParity: true,
    scopedNsgDenialAndUnknownCapturePacketParity: true,
    explicitVmFirewallNvaIngressAndResponseOwnerParity: true,
  }, null, 2))
  console.log('Desktop smoke passed: three-mode parity, native file import, offline assets, narrow IPC and blocked outbound integrations.')
} finally { await application.close() }
