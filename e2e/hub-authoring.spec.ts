import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { hubFirewallTopology, azHubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { loadLanguage, translate } from '../src/messages'
import '../src/hub-dialog-messages-ja'
import '../src/VwanVnetConnectionPanel'
import '../src/RoutingIntentNotice'
import '../src/vpn-nat-messages-ja'
import '../src/route-map-messages-ja'
import { vpnNatFixture } from '../tests/fixtures/vpn-nat'

for (const profile of [
  { preview: true, language: 'en', width: 1440 },
  { preview: false, language: 'en', width: 1440 },
  { preview: true, language: 'ja', width: 390 },
] as const) {
  test(`full ${profile.language} ${profile.preview}: hub sections author scoped route maps and VPN NAT without changing ownership`, async ({ page }, testInfo) => {
    await loadLanguage(profile.language)
    const text = (value: string) => translate(profile.language, value)
    const topology = vpnNatFixture('vwan')
    delete topology.vpnConnections[0].nat
    delete topology.vwanHubs[0].vpnNat
    topology.vwanHubs.push({ ...structuredClone(topology.vwanHubs[0]), id: 'other', name: 'Other hub' })
    topology.vpnConnections.push(
      { ...structuredClone(topology.vpnConnections[0]), id: 'second', name: 'Second VPN' },
      { ...structuredClone(topology.vpnConnections[0]), id: 'remote', name: 'Other hub VPN', targetId: 'other' },
      { ...structuredClone(topology.vpnConnections[0]), id: 'sdwan', name: 'SD-WAN link', transport: 'SDWAN' },
    )
    topology.vnets.push({ id: 'spare', name: 'Spare', region: 'westeurope', role: 'spoke',
      prefixes: ['10.4.0.0/16'], subnets: [], gateways: [], appliances: [] })
    await page.addInitScript(({ topology, profile }) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      localStorage.setItem('aznet-ui-preview:v1', String(profile.preview))
      localStorage.setItem('vwan-visual-topology:language:v1', profile.language)
      localStorage.setItem('aznet-theme', profile.language === 'ja' ? 'dark' : 'light')
    }, { topology, profile })
    await page.setViewportSize({ width: profile.width, height: 1000 })
    await page.goto('/?mode=full')
    const read = () => saved(page, 'full')
    const open = async () => {
      await page.getByTestId('aznet-vwanhub-hub').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Configure Hub & Labels', exact: true }).click()
    }
    await open()
    const config = page.getByTestId('aznet-vwanhub-config-hub')
    const disclosure = (title: string) => config.locator('.presentation-inspector-section > summary').filter({ hasText: text(title) }).first().locator('..')
    const expand = async (title: string) => {
      const group = disclosure(title)
      if (await group.getAttribute('open') === null) {
        await group.locator(':scope > summary').focus()
        await page.keyboard.press('Enter')
      }
    }
    if (profile.preview) {
      await expect(disclosure('Virtual WAN hub configuration')).toHaveAttribute('open', '')
      await expect(disclosure('VPN NAT')).not.toHaveAttribute('open', '')
      await expect(disclosure('Hub routing tables')).not.toHaveAttribute('open', '')
    }
    expect(await read()).toEqual(topology)
    await expand('VNet connections')
    const vnets = config.getByRole('region', { name: text('VNet connections'), exact: true })
    await expect(vnets.getByRole('group', { name: 'Azure', exact: true })).toBeVisible()
    await expect(vnets.getByRole('group', { name: 'VPN link', exact: true })).toHaveCount(0)
    await vnets.getByRole('button', { name: translate(profile.language, 'Connect {0}', 'Spare'), exact: true }).click()
    await expect.poll(async () => (await read()).vnets[1].vwanHubAttachment?.hubId).toBe('hub')
    await expand('Branch connections')
    await expect(config.getByRole('region', { name: text('Branch connections'), exact: true }).getByRole('group', { name: 'VPN link', exact: true })).toBeVisible()
    await expand('VPN NAT')
    const gateway = config.getByTestId('vpn-nat-gateway-editor')
    await gateway.getByLabel(text('Enable gateway BGP route translation'), { exact: true }).check()
    await gateway.getByRole('button', { name: text('Save VPN NAT gateway capability'), exact: true }).click()
    await expect.poll(async () => (await read()).vwanHubs[0].vpnNat?.bgpRouteTranslation).toBe(true)
    expect((await read()).vpnConnections.every((connection: { nat?: unknown }) => !connection.nat)).toBe(true)
    const connection = config.getByRole('combobox', { name: text('VPN NAT connection'), exact: true })
    await expect(connection.locator('option')).toHaveCount(2)
    const nat = config.getByTestId('vpn-nat-connection-editor')
    await nat.getByLabel(text('VPN NAT rule name'), { exact: true }).fill('Scoped ingress')
    page.once('dialog', (dialog) => dialog.dismiss())
    await connection.selectOption('second')
    await expect(connection).toHaveValue('vpn')
    await expect(nat.getByLabel(text('VPN NAT rule name'), { exact: true })).toHaveValue('Scoped ingress')
    await nat.getByLabel(text('Internal mapping (pre-NAT IPv4 CIDR)'), { exact: true }).fill('10.0.0.0/24')
    await nat.getByLabel(text('External mapping (post-NAT IPv4 CIDR)'), { exact: true }).fill('10.0.0.0/24')
    for (const label of ['Original on-premises BGP peer IPv4', 'Configured post-NAT BGP peer IPv4']) {
      await nat.getByLabel(text(label), { exact: true }).fill('172.20.0.1')
    }
    await nat.getByRole('button', { name: text('Save VPN NAT rule'), exact: true }).click()
    await expect(nat.getByRole('alert')).toBeVisible()
    expect((await read()).vpnConnections[0].nat).toBeUndefined()
    await nat.getByLabel(text('External mapping (post-NAT IPv4 CIDR)'), { exact: true }).fill('192.168.10.0/24')
    await nat.getByRole('button', { name: text('Save VPN NAT rule'), exact: true }).click()
    await expect(nat.getByRole('alert')).toHaveCount(0)
    const mapped = await read()
    expect(mapped.vpnConnections[0].nat.rules[0].externalMapping).toBe('192.168.10.0/24')
    expect(mapped.vpnConnections.slice(1)).toEqual(topology.vpnConnections.slice(1))
    expect(mapped.vwanHubs[1]).toEqual(topology.vwanHubs[1])
    await connection.selectOption('second')
    await expect(nat.getByLabel(text('VPN NAT rule name'), { exact: true })).toHaveValue('')
    await connection.selectOption('vpn')
    const history = async (name: string) => {
      const action = page.getByTitle(name, { exact: true })
      if (!await action.isVisible()) await page.getByRole('button', {
        name: profile.language === 'ja' ? 'ワークスペース メニュー' : 'Workspace menu', exact: true,
      }).click()
      await action.click()
    }
    await history('Undo')
    expect((await read()).vpnConnections[0].nat).toBeUndefined()
    await history('Redo')
    expect((await read()).vpnConnections[0].nat).toEqual(mapped.vpnConnections[0].nat)
    await expand('Route maps')
    const maps = config.getByRole('region', { name: translate(profile.language, 'Route maps · {0}', 'Hub'), exact: true })
    await maps.getByRole('button', { name: text('Create route map'), exact: true }).click()
    await maps.getByRole('textbox', { name: text('Route map name'), exact: true }).fill('Hub-only policy')
    await maps.getByRole('button', { name: text('Add rule'), exact: true }).click()
    await maps.getByRole('combobox', { name: translate(profile.language, 'Rule {0} action', 1), exact: true }).selectOption('drop')
    await maps.getByRole('button', { name: text('Save route map'), exact: true }).click()
    const map = (await read()).routeMaps[0]
    expect(map.hubId).toBe('hub')
    await maps.getByRole('combobox', { name: text('Route map connection'), exact: true }).selectOption('vpn')
    await maps.getByRole('combobox', { name: text('Inbound route map'), exact: true }).selectOption(map.id)
    const result = await read()
    expect(result.vwanHubs[0].routeMapAssignments).toEqual([{ connectionId: 'vpn', inboundMapId: map.id }])
    expect(result.vwanHubs[1]).toEqual(topology.vwanHubs[1])
    expect(result.vpnConnections).toEqual(mapped.vpnConnections)
    expect((await new AxeBuilder({ page }).include('[data-testid="aznet-vwanhub-config-hub"]').analyze()).violations).toEqual([])
    expect(await config.evaluate((element) => [...element.querySelectorAll<HTMLElement>('*')]
      .filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1)
      .map((child) => `${child.tagName}.${child.className}: ${child.textContent?.slice(0, 60)}`).slice(0, 10))).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('hub-sections.png') })
    await page.reload()
    await expect(page.getByTestId('aznet-vwanhub-hub')).toBeVisible()
    expect(await read()).toEqual(result)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'hub-sections-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(result)),
    })
    await expect.poll(read).toEqual(result)
  })
}

async function saved(page: Page, mode: string) {
  return page.evaluate((mode) => {
    const value = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1')!)
    return mode === 'vwan' ? value : value.topology
  }, mode)
}

for (const mode of ['vwan', 'full'] as const) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: routing intent owns connection tables but not default or static propagation`, async ({ page }) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    const native = hubFirewallTopology()
    native.hubs[0].routeTables = []
    native.spokes.forEach((spoke) => { delete spoke.hubRouting })
    native.connections.forEach((connection) => { delete connection.hubRouting })
    const mixed = azHubFirewallTopology()
    mixed.vwanHubs = structuredClone(native.hubs)
    mixed.vnets.forEach((vnet) => { delete vnet.vwanHubAttachment!.hubRouting })
    mixed.vpnConnections.forEach((connection) => { delete connection.hubRouting })
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-ui-preview:v1', 'true')
    }, language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 1100 } : { width: 1440, height: 1100 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'routing-intent.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? native : mixed)),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const hub = mode === 'vwan' ? page.locator('[data-node-id="hub-local"]') : page.getByTestId('aznet-vwanhub-hub-local')
    const setIntent = async (enabled: boolean) => {
      await hub.focus()
      await page.keyboard.press('Shift+F10')
      if (mode === 'full') {
        await page.getByRole('menuitem', { name: enabled ? 'Enable Private Traffic Routing Intent' : 'Disable Private Traffic Routing Intent', exact: true }).click()
      } else {
        await page.getByRole('menuitem', { name: text('Edit configuration'), exact: true }).click()
        await page.getByRole('dialog').getByLabel(text('Private traffic routing intent'), { exact: true }).setChecked(enabled)
        await page.getByRole('button', { name: text('Save changes'), exact: true }).click()
      }
    }
    await setIntent(true)
    const current = await saved(page, mode)
    const config = mode === 'vwan' ? current.spokes[0].hubRouting : current.vnets[0].vwanHubAttachment.hubRouting
    expect(config).toMatchObject({ associatedTableId: 'defaultRouteTable', propagatedTableIds: ['noneRouteTable'] })
    const edge = page.getByTestId(`${mode === 'vwan' ? 'spoke' : 'aznet-vnet'}-connection-trusted-a`)
    await edge.focus()
    await page.keyboard.press('Enter')
    const panel = page.getByTestId('vwan-vnet-connection-panel')
    await expect(panel).toContainText(text('Managed by routing intent'))
    await expect(panel.getByLabel(text('Associated table'), { exact: true })).toBeDisabled()
    await expect(panel.getByLabel(text('Propagation labels'), { exact: true })).toBeDisabled()
    await panel.getByLabel(text('Propagate default route (0.0.0.0/0)'), { exact: true }).check()
    if (mode === 'full') {
      await panel.getByLabel(text('Propagate connection static routes into BGP'), { exact: true }).check()
      await expect(panel.getByLabel(text('Propagate default route (0.0.0.0/0)'), { exact: true })).toBeChecked()
    }
    expect((await new AxeBuilder({ page }).include('[data-testid="vwan-vnet-connection-panel"]').analyze()).violations).toEqual([])
    await page.keyboard.press('Escape')
    await setIntent(false)
    const removed = await saved(page, mode)
    expect(mode === 'vwan' ? removed.spokes[0].hubRouting.labels : removed.vnets[0].vwanHubAttachment.hubRouting.labels).toEqual(['default'])
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.getByRole('button', { name: new RegExp(`Undo|${text('Undo')}`) }).click()
    const undone = await saved(page, mode)
    expect(mode === 'vwan' ? undone.hubs[0].routingIntent.private : undone.vwanHubs[0].routingIntent.private).toBe(true)
    expect(mode === 'vwan' ? undone.spokes[0].hubRouting.propagatedTableIds : undone.vnets[0].vwanHubAttachment.hubRouting.propagatedTableIds).toEqual(['noneRouteTable'])
    await page.reload()
    await expect(edge).toBeVisible()
    expect(await saved(page, mode)).toEqual(undone)
  })
}

test('full: hub VPN NAT explains missing IPsec connections instead of offering SD-WAN rules', async ({ page }) => {
  const topology = vpnNatFixture('vwan')
  delete topology.vpnConnections[0].nat
  topology.vpnConnections[0].transport = 'SDWAN'
  delete topology.vwanHubs[0].vpnNat
  await page.addInitScript((topology) => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vwanhub-hub').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Configure Hub & Labels', exact: true }).click()
  const config = page.getByTestId('aznet-vwanhub-config-hub')
  await config.locator('.presentation-inspector-section > summary').filter({ hasText: 'VPN NAT' }).click()
  await expect(config.getByRole('combobox', { name: 'VPN NAT connection', exact: true })).toHaveCount(0)
  const status = config.getByRole('region', { name: 'VPN NAT', exact: true }).getByRole('status')
  await expect(status).toContainText('No IPsec VPN connections target this hub.')
  await expect(status).toContainText('SD-WAN connections do not support overlap NAT.')
  expect(await saved(page, 'full')).toEqual(topology)
  await config.getByRole('button', { name: 'Save VPN NAT gateway capability', exact: true }).click()
  const result = await saved(page, 'full')
  expect(result.vwanHubs[0].vpnNat).toEqual({ bgpRouteTranslation: false })
  expect(result.vpnConnections).toEqual(topology.vpnConnections)
})

for (const mode of ['vwan', 'full'] as const) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: discover Firewall without intent and inspect honest derived gateway capabilities`, async ({ page }, testInfo) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    const native = hubFirewallTopology()
    delete native.hubs[0].firewall
    for (const table of native.hubs[0].routeTables!) table.staticRoutes = []
    native.connections[1].enabled = false
    native.erLocations = [{ id: 'er-local', name: 'Modeled ER' }]
    native.erLinks = [{ id: 'hub-er', name: 'Disabled hub ER', locationId: 'er-local', hubId: 'hub-local', enabled: false, learnSiteRoutes: false, hubRouting: structuredClone(native.connections[0].hubRouting) }]
    const mixed = azHubFirewallTopology()
    mixed.vwanHubs = structuredClone(native.hubs)
    mixed.vpnConnections[1].enabled = false
    mixed.erLocations = structuredClone(native.erLocations)
    mixed.erLinks = [{ id: 'hub-er', name: 'Disabled hub ER', locationId: 'er-local', targetKind: 'vwan-hub', targetId: 'hub-local', enabled: false, hubRouting: structuredClone(native.connections[0].hubRouting) }]
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((language) => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 1000 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-capabilities.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? native : mixed)),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const node = mode === 'vwan' ? page.locator('[data-node-id="hub-local"]') : page.getByTestId('aznet-vwanhub-hub-local')
    if (mode === 'vwan') await expect(node).toHaveAccessibleDescription(/VPN 1\/2 · ER 0\/1/)
    else await expect(node).toHaveAccessibleName(/VPN 1\/2 · ER 0\/1/)
    await node.screenshot({ path: testInfo.outputPath('modeled-hub.png') })
    const menu = async () => { await node.focus(); await page.keyboard.press('Shift+F10') }
    await menu()
    await page.getByRole('menuitem', { name: text('Gateway capabilities (modeled)'), exact: true }).click()
    const capabilities = page.getByRole('dialog', { name: text('Gateway capabilities (modeled)'), exact: true })
    await expect(capabilities).toBeVisible()
    await expect(capabilities.getByTestId('hub-gateway-vpn-branch-a')).toContainText(text('Enabled'))
    await expect(capabilities.getByTestId('hub-gateway-vpn-branch-b')).toContainText(text('Disabled'))
    await expect(capabilities.getByTestId('hub-gateway-hub-er')).toContainText(text('Disabled'))
    await expect(capabilities).toContainText(text('Derived from this topology, not explicit gateway inventory or live observations. SKU, public addresses and provisioning state are unknown.'))
    await expect(capabilities).toContainText(text('No explicit local Firewall declaration.'))
    expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([])
    await capabilities.screenshot({ path: testInfo.outputPath('modeled-gateways.png') })
    await page.keyboard.press('Escape')
    await expect(capabilities).toHaveCount(0)
    await expect(node).toBeFocused()
    expect(await saved(page, mode)).toEqual(original)
    await menu()
    await page.getByRole('menuitem', { name: text('Add Azure Firewall'), exact: true }).click()
    const declaration = page.getByRole('checkbox', { name: text('Declare local Azure Firewall'), exact: true })
    await expect(declaration).toBeFocused()
    await expect(declaration).not.toBeChecked()
    await declaration.check()
    await page.getByRole('textbox', { name: text('Local Firewall name'), exact: true }).fill('Declared original Firewall')
    await page.getByRole('textbox', { name: text('Local Firewall name'), exact: true }).press('Tab')
    if (mode === 'vwan') await page.getByRole('button', { name: text('Save changes'), exact: true }).click()
    else await page.keyboard.press('Escape')
    const result = await saved(page, mode)
    const key = mode === 'vwan' ? 'hubs' : 'vwanHubs'
    expect(result[key][0]).toEqual({ ...original[key][0], firewall: { id: 'fw-hub-local', name: 'Declared original Firewall' } })
    expect(result[mode === 'vwan' ? 'connections' : 'vpnConnections']).toEqual(original[mode === 'vwan' ? 'connections' : 'vpnConnections'])
    expect(result.erLinks).toEqual(original.erLinks)
    await menu()
    await page.getByRole('menuitem', { name: text('Configure Azure Firewall'), exact: true }).click()
    await expect(declaration).toBeChecked()
    await expect(page.getByRole('textbox', { name: text('Local Firewall ID'), exact: true })).toHaveValue('fw-hub-local')
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(node).toBeVisible()
    expect(await saved(page, mode)).toEqual(result)
    expect(errors).toEqual([])
  })
}

for (const mode of ['vwan', 'full'] as const) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: reciprocal hub connections preserve originals and reject silent reattachment`, async ({ page }) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    const native = hubFirewallTopology()
    delete native.hubs[0].firewall
    for (const table of native.hubs[0].routeTables!) table.staticRoutes = []
    native.hubs.push({ ...structuredClone(native.hubs[0]), id: 'other-hub', name: 'Other hub' })
    for (const spoke of native.spokes.slice(0, 2)) { delete spoke.hubId; delete spoke.hubRouting }
    native.spokes[2].subnets = [{ id: 'original-subnet', name: 'Original subnet', prefix: '10.30.0.0/24' }]
    native.spokes[3].hubId = 'other-hub'
    const mixed = azHubFirewallTopology()
    mixed.vwanHubs = structuredClone(native.hubs)
    for (const vnet of mixed.vnets.slice(0, 2)) delete vnet.vwanHubAttachment
    mixed.vnets[3].vwanHubAttachment!.hubId = 'other-hub'
    await page.addInitScript((language) => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 1000 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    const upload = (topology: unknown) => page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-connections.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await upload(mode === 'vwan' ? native : mixed)
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const node = (id: string, hub = false) => mode === 'vwan'
      ? page.locator(`[data-node-id="${id}"]`)
      : page.getByTestId(`aznet-${hub ? 'vwanhub' : 'select-vnet'}-${id}`)
    const menu = async (id: string, hub = false) => { await node(id, hub).focus(); await page.keyboard.press('Shift+F10') }
    const original = await saved(page, mode)
    await menu('trusted-a')
    await page.getByRole('menuitem', { name: text('Connect to virtual hub'), exact: true }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(node('trusted-a')).toBeFocused()
    expect(await saved(page, mode)).toEqual(original)
    await menu('trusted-a')
    await page.getByRole('menuitem', { name: text('Connect to virtual hub'), exact: true }).click()
    await page.getByRole('menuitem', { name: 'Local secure hub', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await menu('hub-local', true)
    await page.getByRole('menuitem', { name: text('Connect to spoke'), exact: true }).click()
    await page.getByRole('menuitem', { name: 'trusted-b', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    const connected = await saved(page, mode)
    const originals = mode === 'vwan' ? connected.spokes : connected.vnets
    expect(originals.map((entry: { id: string }) => entry.id)).toEqual(['trusted-a', 'trusted-b', 'untrusted-a', 'untrusted-b'])
    for (const entry of originals.slice(0, 2)) expect(mode === 'vwan' ? entry.hubId : entry.vwanHubAttachment.hubId).toBe('hub-local')
    expect(originals[0].prefixes).toEqual(['10.10.0.0/16'])
    await menu('hub-local', true)
    await page.getByRole('menuitem', { name: text('Connect to spoke'), exact: true }).click()
    await expect(page.getByRole('menuitem', { name: translate(language, '{0} (connected to {1})', 'untrusted-b', 'Other hub'), exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    expect(await saved(page, mode)).toEqual(connected)
    await menu('untrusted-a')
    await expect(page.getByRole('menuitem', { name: text('Connect to virtual hub'), exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: text('Configure virtual hub connection'), exact: true }).click()
    await expect(page.getByTestId('vwan-vnet-connection-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    if (mode === 'vwan') {
      const current = (await saved(page, mode)).spokes[2]
      expect(current.hubRouting).toEqual(native.spokes[2].hubRouting)
      expect(current.subnets).toEqual(native.spokes[2].subnets)
    }
    await menu('hub-local', true)
    await page.getByRole('menuitem', { name: text(mode === 'vwan' ? 'BGP table' : 'Inspect Virtual WAN Hub BGP table'), exact: true }).click()
    await expect(page.getByRole('dialog').locator('tr[data-prefix="10.10.0.0/16"][data-preferred="true"]')).toContainText('trusted-a')
    await page.keyboard.press('Escape')
    const result = await saved(page, mode)
    await page.reload()
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    expect(await saved(page, mode)).toEqual(result)
    await upload(result)
    await expect.poll(async () => await saved(page, mode)).toEqual(result)
  })
}

for (const mode of ['vwan', 'full'] as const) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: selectable VNet connections edit original routing without authoring ordinary peerings`, async ({ page }) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    const topology = mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-ui-preview:v1', String(language === 'en'))
    }, language)
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'selectable-vnet-connections.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const edge = page.getByTestId(`${mode === 'vwan' ? 'spoke' : 'aznet-vnet'}-connection-trusted-a`)
    await edge.focus()
    await page.keyboard.press('Enter')
    const panel = page.getByTestId('vwan-vnet-connection-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('trusted-a ↔ Local secure hub')
    await expect(panel).toContainText(text('Microsoft-managed peering'))
    await expect(panel).toContainText(text('Additional ordinary VNet peerings are allowed; they must not consume another remote gateway or Route Server. Peering alone does not extend Virtual WAN transit to an indirect VNet.'))
    await expect(panel.getByLabel(/Use Remote Gateways|Allow Gateway Transit/)).toHaveCount(0)
    expect(await saved(page, mode)).toEqual(original)
    expect((await new AxeBuilder({ page }).include('[data-testid="vwan-vnet-connection-panel"]').analyze()).violations).toEqual([])
    const flag = panel.getByLabel(text('Propagate default route (0.0.0.0/0)'), { exact: true })
    await flag.check()
    await page.getByRole('button', { name: new RegExp(`Undo|${text('Undo')}`) }).click()
    await expect(flag).not.toBeChecked()
    expect(await saved(page, mode)).toEqual(original)
    await page.getByRole('button', { name: new RegExp(`Redo|${text('Redo')}`) }).click()
    await expect(flag).toBeChecked()
    await panel.getByLabel(text('Associated table'), { exact: true }).selectOption('untrusted')
    await panel.getByLabel(text('Propagation labels'), { exact: true }).fill('trusted, CaseSensitive')
    await panel.getByLabel(text('Propagation labels'), { exact: true }).press('Tab')
    const current = await saved(page, mode)
    const entries = mode === 'vwan' ? current.spokes : current.vnets
    const originalEntries = mode === 'vwan' ? original.spokes : original.vnets
    const attachment = mode === 'vwan' ? entries[0] : entries[0].vwanHubAttachment
    expect(attachment.propagateDefaultRoute).toBe(true)
    expect(attachment.hubRouting).toEqual({
      ...(mode === 'vwan' ? originalEntries[0] : originalEntries[0].vwanHubAttachment).hubRouting,
      associatedTableId: 'untrusted', labels: ['trusted', 'CaseSensitive'],
    })
    expect(entries.slice(1)).toEqual(originalEntries.slice(1))
    if (mode === 'full') {
      expect(current.vnetPeerings).toEqual(original.vnetPeerings)
      await panel.getByLabel(text('Enabled'), { exact: true }).uncheck()
      await page.keyboard.press('Escape')
      await edge.focus()
      await page.keyboard.press('Space')
      await expect(panel.getByLabel(text('Enabled'), { exact: true })).not.toBeChecked()
      await panel.getByLabel(text('Enabled'), { exact: true }).check()
      await panel.getByTestId('connection-static-trusted-a').getByRole('checkbox').check()
      expect((await saved(page, mode)).vnets[0].vwanHubAttachment.propagateStaticRoutes).toBe(true)
    }
    const edited = await saved(page, mode)
    await page.keyboard.press('Escape')
    // Click the visible edge badge, not an overlapping node or hitbox.
    await edge.locator('text').click()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    if (mode === 'full') {
      await page.getByTestId('aznet-select-vnet-trusted-a').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: text('Peer with VNet'), exact: true }).click()
      await page.getByRole('menuitem', { name: 'trusted-b (swedencentral)', exact: true }).click()
      const peerings = (await saved(page, mode)).vnetPeerings
      expect(peerings).toHaveLength(1)
      expect(peerings[0]).toMatchObject({
        vnetAId: 'trusted-a', vnetBId: 'trusted-b',
        aToB: { useRemoteGateways: false }, bToA: { useRemoteGateways: false },
      })
      expect((await saved(page, mode)).vnets).toEqual(edited.vnets)
    }
    const persisted = await saved(page, mode)
    await page.reload()
    await expect(edge).toBeVisible()
    expect(await saved(page, mode)).toEqual(persisted)
    expect(errors).toEqual([])
  })
}

for (const mode of ['vwan', 'full'] as const) {
  test(`${mode}: opening imported VNet connections preserves unknown scopes and omitted legacy defaults`, async ({ page }) => {
    const native = hubFirewallTopology()
    const mixed = azHubFirewallTopology()
    const unknown = { status: 'unknown' as const, associatedTableId: mode === 'vwan' ? 'external-table' : null,
      propagatedTableIds: mode === 'vwan' ? ['external-propagation'] : [], labels: ['CaseSensitive'], limitations: ['Capture incomplete'] }
    native.spokes[0].hubRouting = structuredClone(unknown)
    mixed.vnets[0].vwanHubAttachment!.hubRouting = structuredClone(unknown)
    delete native.spokes[1].hubRouting
    delete mixed.vnets[1].vwanHubAttachment!.hubRouting
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'unknown-connection-scope.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? native : mixed)),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const edge = (id: string) => page.getByTestId(`${mode === 'vwan' ? 'spoke' : 'aznet-vnet'}-connection-${id}`)
    await edge('trusted-a').focus()
    await page.keyboard.press('Enter')
    const panel = page.getByTestId('vwan-vnet-connection-panel')
    await expect(panel.getByLabel('Associated table', { exact: true })).toHaveValue(unknown.associatedTableId ?? '')
    await expect(panel).toContainText('Capture incomplete')
    expect(await saved(page, mode)).toEqual(original)
    await panel.getByLabel('Propagate default route (0.0.0.0/0)', { exact: true }).check()
    const edited = await saved(page, mode)
    expect((mode === 'vwan' ? edited.spokes[0] : edited.vnets[0].vwanHubAttachment).hubRouting).toEqual(unknown)
    await page.keyboard.press('Escape')
    await edge('trusted-b').focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByLabel('Associated table', { exact: true })).toHaveValue('defaultRouteTable')
    await page.keyboard.press('Escape')
    expect(await saved(page, mode)).toEqual(edited)
  })
}

for (const mode of ['vwan', 'hub-spoke', 'full']) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: clear is explicit, safely focused and preserves unrelated local data`, async ({ page }) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-simulator:practice:v1', '{"version":1,"entries":[]}')
      localStorage.setItem('unrelated-workspace-test', 'keep')
    }, language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-hub.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology())),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const trigger = mode === 'vwan' ? page.getByRole('button', { name: text('Clear topology'), exact: true }) : page.getByTestId('aznet-clear-topology-btn')
    const dialog = page.getByRole('dialog', { name: text('Clear topology'), exact: true })
    for (const method of ['cancel', 'escape', 'close']) {
      await trigger.click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: text('Cancel clearing'), exact: true })).toBeFocused()
      expect(await saved(page, mode)).toEqual(original)
      if (method === 'escape') await page.keyboard.press('Escape')
      else if (method === 'cancel') await page.keyboard.press('Enter')
      else await dialog.getByRole('button', { name: translate(language, 'Close {0}', text('Clear topology')), exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
      expect(await saved(page, mode)).toEqual(original)
    }
    await trigger.click()
    await dialog.getByRole('button', { name: text('Clear all objects'), exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('dialog', { name: language === 'ja' ? '閉じる前に変更を保存しますか?' : 'Save changes before closing?', exact: true })
      .getByRole('button', { name: language === 'ja' ? '破棄して閉じる' : 'Discard and close', exact: true }).click()
    await expect(trigger).toBeVisible()
    const empty = await saved(page, mode)
    expect(mode === 'vwan' ? empty.hubs : empty.vwanHubs).toHaveLength(0)
    expect(mode === 'vwan' ? empty.spokes : empty.vnets).toHaveLength(0)
    expect(empty.sites).toHaveLength(0)
    expect(await page.evaluate(() => [localStorage.getItem('aznet-simulator:practice:v1'), localStorage.getItem('unrelated-workspace-test')])).toEqual(['{"version":1,"entries":[]}', 'keep'])
    await page.reload()
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    expect(await saved(page, mode)).toEqual(empty)
  })
}
