import { expect, test, type Page } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'

function bgpTopology() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{
    id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
    subnets: [
      { id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' },
      { id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.0.254.0/27' },
    ],
    gateways: [{ id: 'gw', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true }],
    routeServer: { id: 'ars', name: 'Route Server', enabled: true, subnetId: 'ars-subnet',
      branchToBranchTraffic: false, hubRoutingPreference: 'ASPath', peerApplianceIds: [] },
    appliances: [],
  }]
  topology.sites = [
    { id: 'a', name: 'Site A', asn: 65001, prefixes: ['172.16.0.0/24'] },
    { id: 'b', name: 'Site B', asn: 65002, prefixes: ['172.17.0.0/24'] },
    { id: 'empty', name: 'Empty site', asn: 65003, prefixes: [] },
  ]
  topology.vpnConnections = [
    { id: 'primary', name: 'Primary VPN', siteId: 'a', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true },
    { id: 'backup', name: 'Backup VPN', siteId: 'a', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true, outboundPrepend: [65010] },
    { id: 'other', name: 'Other VPN', siteId: 'b', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true },
  ]
  topology.erLocations = [{ id: 'er', name: 'Amsterdam' }]
  topology.erLinks = [{ id: 'circuit', name: 'Circuit A', locationId: 'er', targetKind: 'site', targetId: 'a', enabled: true }]
  return topology
}

async function load(page: Page, mode: string, topology = bgpTopology()) {
  if (mode === 'full') topology.vwanHubs.push({
    id: 'vhub', name: 'Virtual hub', region: 'West Europe', preference: 'ExpressRoute', x: 700, y: 700,
    routingIntent: { private: false, internet: false },
  })
  await page.addInitScript((value) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) {
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
    }
  }, topology)
  await page.goto(`/?mode=${mode}`)
}

async function inspectSite(page: Page, id: string) {
  await page.getByTestId(`aznet-site-${id}`).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Inspect Site BGP Route Table', exact: true }).click()
}

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} keeps subnet pills compact and reveals prefixes and route-table settings on demand`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 650 })
    const topology = bgpTopology()
    topology.udrTables.push({
      id: 'compact-rt', name: 'Production-Spoke-Route-Table',
      disableBgpRoutePropagation: true, disablePeeringRoutePropagation: true, routes: [],
    })
    topology.vnets[0].subnets.push({
      id: 'compact-work', name: 'ProductionApplicationServicesSubnetWithALongName', prefix: '10.0.2.0/24', routeTableId: 'compact-rt',
      privateEndpoints: [{ id: 'compact-pe', name: 'Private service', ipAddress: '10.0.2.4', serviceName: 'Storage' }],
    })
    await load(page, mode, topology)
    const subnet = page.getByTestId('aznet-subnet-compact-work')
    const badge = page.getByTestId('aznet-subnet-rt-badge-compact-work')
    await expect(subnet).not.toContainText('10.0.2.0/24')
    await expect(subnet).not.toContainText('GWroutes:OFF')
    await expect(subnet).not.toContainText('PeerSuppress:ON')
    await expect(subnet).toContainText('PE')
    expect(Number(await badge.locator('rect').getAttribute('width'))).toBeLessThanOrEqual(88)
    const clip = subnet.locator('clipPath rect')
    expect(Number(await clip.getAttribute('x')) + Number(await clip.getAttribute('width'))).toBeLessThan(Number(await badge.locator('rect').getAttribute('x')))
    await page.getByTestId('aznet-canvas-shell').screenshot({ path: test.info().outputPath('compact-subnets.png') })
    await subnet.focus()
    const tooltip = page.getByTestId('aznet-subnet-hover-card')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('10.0.2.0/24')
    await expect(tooltip).toContainText('ProductionApplicationServicesSubnetWithALongName')
    await page.getByTestId('aznet-vnet-hub').focus()
    await expect(tooltip).toBeHidden()
    await subnet.hover({ position: { x: 8, y: 2 } })
    await expect(tooltip).toBeVisible()
    await badge.hover()
    const settings = page.getByTestId('aznet-rt-hover-card')
    await expect(settings).toContainText('Production-Spoke-Route-Table')
    await expect(settings.getByRole('checkbox', { name: /Propagate Gateway Routes/ })).not.toBeChecked()
    await settings.getByRole('checkbox', { name: /Propagate Gateway Routes/ }).check()
    await expect(badge).not.toContainText('GWroutes')
  })

  test(`${mode} shows endpoint-owned IN/OUT policy markers with scoped previews, keyboard inspection and cleanup`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()) })
    const topology = bgpTopology()
    const rule = { id: 'filter', prefixes: ['192.168.10.0/24'], match: 'equals' as const, action: 'drop' as const, summaryPrefixes: [], prepend: [], nextStep: 'terminate' as const }
    topology.routeMaps = [
      { id: 'site-filter', name: 'Site A filter', siteId: 'a', rules: [rule] },
      { id: 'other-filter', name: 'Site B filter', siteId: 'b', rules: [{ ...rule, id: 'other-rule' }] },
    ]
    topology.sites[0].routeMapAssignments = [
      { connectionId: 'primary', inboundMapId: 'site-filter', outboundMapId: 'site-filter' },
      { connectionId: 'backup', outboundMapId: 'site-filter' },
      { connectionId: 'circuit', outboundMapId: 'site-filter' },
      { connectionId: 'wan', outboundMapId: 'site-filter' },
    ]
    topology.sites[1].routeMapAssignments = [{ connectionId: 'wan', inboundMapId: 'other-filter' }]
    topology.vpnConnections[1].bgpEnabled = false
    topology.siteLinks.push({ id: 'wan', name: 'Inter-site WAN', siteAId: 'a', siteBId: 'b', enabled: true })
    const hub = topology.vnets[0]
    hub.appliances.push({
      id: 'one', name: 'NVA one', kind: 'nva-vm', subnetId: 'gateway', privateIp: '10.0.255.4',
      asn: 65010, bgpEnabled: true, enableIpForwarding: true, advertisedPrefixes: [], staticRoutes: [],
    })
    Object.assign(hub.routeServer!, {
      branchToBranchTraffic: true, peerApplianceIds: ['one'],
      routeMaps: [{ id: 'ars-filter', name: 'ARS filter', rules: [{ ...rule, id: 'ars-rule' }] }],
      routeMapAssignments: [
        { connectionId: 'nva:one', inboundMapId: 'ars-filter', outboundMapId: 'ars-filter' },
        { connectionId: 'gateway:gw', inboundMapId: 'ars-filter', outboundMapId: 'ars-filter' },
      ],
    })
    await load(page, mode, topology)
    const markers = page.locator('.policy-marker')
    const marker = (owner: string, connection: string, direction: string) => page.locator(`.policy-marker[data-router-id="${owner}"][data-connection-id="${connection}"][data-direction="${direction}"]`)
    await expect(markers).toHaveCount(10)
    for (const style of ['default', 'curved', 'straight']) {
      await page.getByLabel('Connection style', { exact: true }).selectOption(style)
      const primary = page.getByTestId('aznet-vpnconn-primary').locator('.aznet-edge-path')
      const backup = page.getByTestId('aznet-vpnconn-backup').locator('.aznet-edge-path')
      expect(await primary.getAttribute('d')).not.toBe(await backup.getAttribute('d'))
      const alignment = await marker('a', 'primary', 'outbound').evaluate((element) => {
        const path = element.ownerSVGElement!.querySelector<SVGPathElement>('[data-testid="aznet-vpnconn-primary"] .aznet-edge-path')!
        const arrow = element.previousElementSibling!.querySelector<SVGPathElement>('.policy-arrow')!
        const matrix = arrow.transform.baseVal.consolidate()!.matrix
        let distance = Infinity, at = 0
        for (let index = 0; index <= 1000; index++) {
          const length = path.getTotalLength() * index / 1000
          const point = path.getPointAtLength(length)
          const error = Math.hypot(point.x - matrix.e, point.y - matrix.f)
          if (error < distance) { distance = error; at = length }
        }
        const a = path.getPointAtLength(at - 1), b = path.getPointAtLength(at + 1)
        const dx = b.x - a.x, dy = b.y - a.y
        return { distance, direction: (dx * matrix.a + dy * matrix.b) / Math.hypot(dx, dy) }
      })
      expect(alignment.distance).toBeLessThan(1)
      expect(alignment.direction).toBeGreaterThan(0.99)
    }
    await page.getByTestId('aznet-canvas-shell').screenshot({ path: test.info().outputPath('policy-markers.png') })
    const inbound = marker('a', 'primary', 'inbound')
    await inbound.hover()
    await expect(page.getByRole('tooltip')).toContainText('Site A · Primary VPN')
    await expect(page.getByRole('tooltip')).toContainText('Site A filter')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await inbound.focus()
    await page.keyboard.press('Enter')
    const sitePanel = page.getByRole('dialog', { name: 'Route maps · Site A', exact: true })
    await expect(sitePanel.getByRole('combobox', { name: 'Route map connection', exact: true })).toHaveValue('primary')
    await expect(sitePanel.getByRole('combobox', { name: 'Inbound route map', exact: true })).toBeFocused()
    await expect(sitePanel.getByRole('textbox', { name: 'Route map name', exact: true })).toHaveValue('Site A filter')
    await sitePanel.getByRole('button', { name: 'Close Route maps · Site A', exact: true }).click()
    const inactive = marker('a', 'backup', 'outbound')
    await expect(inactive).toHaveClass(/is-down/)
    await inactive.hover()
    await expect(page.getByRole('tooltip')).toContainText('BGP exchange inactive')
    await page.keyboard.press('Escape')
    const arsOut = marker('ars', 'gateway:gw', 'outbound')
    const arsIn = marker('ars', 'gateway:gw', 'inbound')
    expect(await arsOut.evaluate((element) => element.previousElementSibling!.querySelector('.policy-arrow')!.getAttribute('transform'))).toContain('rotate(0)')
    expect(await arsIn.evaluate((element) => element.previousElementSibling!.querySelector('.policy-arrow')!.getAttribute('transform'))).toContain('rotate(180)')
    await arsOut.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Show route map rules', exact: true }).click()
    const arsPanel = page.getByRole('dialog', { name: 'Route maps · Route Server', exact: true })
    await expect(arsPanel.getByRole('combobox', { name: 'Route map connection', exact: true })).toHaveValue('gateway:gw')
    await expect(arsPanel.getByRole('combobox', { name: 'Outbound route map', exact: true })).toBeFocused()
    await expect(arsPanel.getByRole('textbox', { name: 'Route map name', exact: true })).toHaveValue('ARS filter')
    await arsPanel.getByRole('button', { name: 'Close Route maps · Route Server', exact: true }).click()
    await page.reload()
    await expect(markers).toHaveCount(10)
    await arsOut.click()
    await arsPanel.getByRole('button', { name: 'Delete route map', exact: true }).click()
    await arsPanel.getByRole('button', { name: 'Confirm route map deletion', exact: true }).click()
    await expect(markers).toHaveCount(6)
    await expect(page.locator('[data-testid^="aznet-ars-session-"]')).toHaveCount(0)
    await arsPanel.getByRole('button', { name: 'Close Route maps · Route Server', exact: true }).click()
    await marker('b', 'wan', 'inbound').hover()
    await expect(page.getByRole('tooltip')).toContainText('Site B · Inter-site WAN')
    expect(errors).toEqual([])
  })

  test(`${mode} scopes ARS maps by peer and direction, keeps outbound separate from best paths and persists policies`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()) })
    const topology = bgpTopology()
    const hub = topology.vnets[0]
    hub.subnets.push({ id: 'nvas', name: 'NVAs', prefix: '10.0.2.0/24' })
    hub.appliances = ['one', 'two'].map((id, index) => ({
      id, name: `NVA ${id}`, kind: 'nva-vm', subnetId: 'nvas', privateIp: `10.0.2.${4 + index}`,
      asn: 65010 + index, bgpEnabled: true, enableIpForwarding: true, advertisedPrefixes: ['192.168.10.0/24'], staticRoutes: [],
    }))
    hub.routeServer!.peerApplianceIds = ['one', 'two']
    hub.routeServer!.branchToBranchTraffic = true
    await load(page, mode, topology)
    const open = async () => {
      const routes = page.getByRole('dialog', { name: 'Effective routes', exact: true })
      if (await routes.isVisible()) await routes.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
      await page.getByTestId('aznet-chip-ars').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Manage ARS Route Maps', exact: true }).click()
    }
    await open()
    const policy = page.getByRole('dialog', { name: 'Route maps · Route Server', exact: true })
    await policy.getByRole('button', { name: 'Create route map', exact: true }).click()
    await policy.getByRole('textbox', { name: 'Route map name', exact: true }).fill('Scoped ARS filter')
    await policy.getByRole('button', { name: 'Add rule', exact: true }).click()
    await policy.getByRole('textbox', { name: 'Rule 1 prefixes', exact: true }).fill('192.168.10.0/24')
    await policy.getByRole('combobox', { name: 'Rule 1 action', exact: true }).selectOption('drop')
    await policy.getByRole('button', { name: 'Save route map', exact: true }).click()
    await policy.getByRole('combobox', { name: 'Route map connection', exact: true }).selectOption('nva:one')
    const mapId = await policy.getByRole('combobox', { name: 'Inbound route map', exact: true }).locator('option', { hasText: 'Scoped ARS filter' }).getAttribute('value')
    await policy.getByRole('combobox', { name: 'Inbound route map', exact: true }).selectOption(mapId!)
    await policy.getByRole('button', { name: 'Close Route maps · Route Server', exact: true }).click()
    const inspect = async () => {
      await page.getByTestId('aznet-chip-ars').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Inspect Route Server RIB (ASN 65515)', exact: true }).click()
    }
    await inspect()
    const rib = page.getByTestId('aznet-control-rib-card')
    await expect(rib.locator('[data-prefix="192.168.10.0/24"]')).toHaveCount(1)
    await expect(rib.locator('[data-prefix="192.168.10.0/24"]')).toContainText('NVA two')
    await open()
    await policy.getByRole('combobox', { name: 'Route map connection', exact: true }).selectOption('gateway:gw')
    await policy.getByRole('combobox', { name: 'Outbound route map', exact: true }).selectOption(mapId!)
    await expect(policy.getByTestId('aznet-policy-outbound').locator('[data-prefix="192.168.10.0/24"]')).toHaveCount(0)
    await expect(policy.getByTestId('aznet-policy-outbound').locator('[data-prefix="10.0.0.0/16"]')).toHaveCount(1)
    await policy.getByRole('button', { name: 'Close Route maps · Route Server', exact: true }).click()
    await inspect()
    await expect(rib.locator('[data-prefix="192.168.10.0/24"][data-preferred="true"]')).toHaveCount(1)
    await page.reload()
    await open()
    await expect(policy.getByRole('combobox', { name: 'Inbound route map', exact: true })).toHaveValue(mapId!)
    await policy.getByRole('combobox', { name: 'Route map connection', exact: true }).selectOption('gateway:gw')
    await expect(policy.getByRole('combobox', { name: 'Outbound route map', exact: true })).toHaveValue(mapId!)
    await policy.getByRole('button', { name: /Scoped ARS filter/ }).click()
    await policy.getByRole('button', { name: 'Delete route map', exact: true }).click()
    await policy.getByRole('button', { name: 'Confirm route map deletion', exact: true }).click()
    await expect(policy.getByRole('combobox', { name: 'Outbound route map', exact: true })).toHaveValue('')
    await policy.getByRole('combobox', { name: 'Route map connection', exact: true }).selectOption('nva:one')
    await expect(policy.getByRole('combobox', { name: 'Inbound route map', exact: true })).toHaveValue('')
    expect(errors).toEqual([])
  })

  test(`${mode} edits site route maps, scopes assignments and preserves policies across reload and undo`, async ({ page }) => {
    await load(page, mode)
    await page.getByTestId('aznet-site-a').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Manage Site Route Maps', exact: true }).click()
    const policy = page.getByRole('dialog', { name: 'Route maps · Site A', exact: true })
    await policy.getByRole('button', { name: 'Create route map', exact: true }).click()
    await policy.getByRole('textbox', { name: 'Route map name', exact: true }).fill('Block primary site export')
    await policy.getByRole('button', { name: 'Add rule', exact: true }).click()
    await policy.getByRole('textbox', { name: 'Rule 1 prefixes', exact: true }).fill('172.16.0.0/24')
    await policy.getByRole('combobox', { name: 'Rule 1 action', exact: true }).selectOption('drop')
    await policy.getByRole('button', { name: 'Save route map', exact: true }).click()
    await policy.getByRole('combobox', { name: 'Route map connection', exact: true }).selectOption('primary')
    const mapId = await policy.getByRole('combobox', { name: 'Outbound route map', exact: true }).locator('option', { hasText: 'Block primary site export' }).getAttribute('value')
    await policy.getByRole('combobox', { name: 'Outbound route map', exact: true }).selectOption(mapId!)
    await expect(policy.locator('[data-route-map-attachments]')).toContainText('Primary VPN (Outbound)')
    await expect(policy.getByRole('combobox', { name: 'Inbound route map', exact: true })).toHaveValue('')
    await policy.getByRole('button', { name: 'Close Route maps · Site A', exact: true }).click()
    await page.getByTestId('aznet-chip-gw').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Inspect Gateway BGP RIB', exact: true }).click()
    const rib = page.getByTestId('aznet-control-rib-card')
    await expect(rib.locator('[data-prefix="172.16.0.0/24"]')).toHaveCount(1)
    await expect(rib.locator('[data-prefix="172.16.0.0/24"]')).not.toContainText('Primary VPN')
    await expect(rib.locator('[data-prefix="172.16.0.0/24"]', { hasText: 'Backup VPN' })).toHaveCount(1)
    await page.reload()
    await page.getByTestId('aznet-site-a').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Manage Site Route Maps', exact: true }).click()
    await expect(policy.getByRole('combobox', { name: 'Outbound route map', exact: true })).toHaveValue(mapId!)
    await policy.getByRole('button', { name: /Block primary site export/, exact: false }).click()
    await policy.getByRole('button', { name: 'Delete route map', exact: true }).click()
    await policy.getByRole('button', { name: 'Confirm route map deletion', exact: true }).click()
    await expect(policy.getByRole('combobox', { name: 'Outbound route map', exact: true })).toHaveValue('')
    await policy.getByRole('button', { name: 'Close Route maps · Site A', exact: true }).click()
    await page.getByRole('button', { name: /Undo/ }).click()
    await page.getByTestId('aznet-site-a').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Manage Site Route Maps', exact: true }).click()
    await expect(policy.getByRole('combobox', { name: 'Outbound route map', exact: true })).toHaveValue(mapId!)
  })

  test(`${mode} prefers ER over shorter VPN paths in FirewallSubnet effective routes without ARS`, async ({ page }) => {
    const topology = bgpTopology()
    topology.vnets[0].routeServer = undefined
    topology.vnets[0].subnets.push({ id: 'firewall', name: 'AzureFirewallSubnet', prefix: '10.0.1.0/26' })
    topology.vnets[0].gateways.push({
      id: 'er-gw', name: 'ExpressRoute gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true,
    })
    topology.sites[0].asn = 65010
    topology.sites[0].prefixes = ['172.16.10.0/24']
    topology.vpnConnections = [topology.vpnConnections[0]]
    topology.erLinks.push({
      id: 'er-gateway', name: 'Gateway circuit', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'er-gw', enabled: true,
    })
    await load(page, mode, topology)
    await page.getByTestId('aznet-subnet-firewall').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
    const table = page.getByTestId('aznet-effective-route-table')
    const active = table.locator('tbody tr:not(.suppressed)').filter({ hasText: '172.16.10.0/24' })
    await expect(active).toHaveCount(1)
    await expect(active.getByRole('cell').nth(3)).toContainText('ExpressRoute gateway')
    await expect(active.locator('.as-path')).toHaveText('12076 65010')
    await expect(table.locator('tr.suppressed').filter({ hasText: '172.16.10.0/24' }).locator('.as-path')).toHaveText('65010')
    await page.getByTestId('aznet-lpm-input').fill('172.16.10.4')
    await expect(active).toContainText('LPM Winner')
  })

  test(`${mode} separates effective-route AS paths from origins and suppression details`, async ({ page }) => {
    const topology = bgpTopology()
    topology.udrTables.push({
      id: 'override', name: 'Override BGP', disableBgpRoutePropagation: false,
      routes: [{ id: 'discard', name: 'Discard site traffic', prefix: '172.16.0.0/24', nextHopType: 'None', enabled: true }],
    })
    topology.vnets[0].subnets[0].routeTableId = 'override'
    await load(page, mode, topology)
    await page.getByTestId('aznet-subnet-gateway').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
    const table = page.getByTestId('aznet-effective-route-table')
    await expect(table.locator('thead th')).toHaveText(['State', 'Source', 'Prefix', 'Next Hop', 'AS path', 'Origin / Tie-Breaker'])
    const bgp = table.getByTestId('aznet-route-row-172.16.0.0/24-VirtualNetworkGateway').first()
    await expect(bgp.locator('.as-path')).toHaveText('65001')
    await expect(bgp.getByRole('cell').nth(5)).toContainText('BGP')
    await expect(bgp.getByRole('cell').nth(5)).toContainText('Overridden by User route')
    await expect(bgp.getByRole('cell').nth(5)).not.toContainText('65001')
    await expect(table).not.toContainText('AS Path:')
    await expect(table.getByTestId('aznet-route-row-172.16.0.0/24-User').locator('.as-path')).toHaveText('—')
    await expect(table.getByTestId('aznet-route-row-10.0.0.0/16-System').locator('.as-path')).toHaveText('—')
    const dialog = page.getByRole('dialog', { name: 'Effective routes', exact: true })
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(1000)
    const scroller = table.locator('..')
    expect(await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const lastHeading = table.getByRole('columnheader', { name: 'Origin / Tie-Breaker', exact: true })
    await expect(lastHeading).toBeInViewport()
    await page.setViewportSize({ width: 640, height: 900 })
    expect(await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })).toBe(true)
    expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await lastHeading.scrollIntoViewIfNeeded()
    await expect(lastHeading).toBeInViewport()
    await bgp.locator('.as-path').scrollIntoViewIfNeeded()
    await expect(bgp.locator('.as-path')).toBeInViewport()
  })

  test(`${mode} groups only the requested site's BGP candidates and preserves explicit scope`, async ({ page }) => {
    await load(page, mode)
    await page.getByTestId('aznet-subnet-gateway').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
    await expect(page.getByTestId('aznet-subnet-routes-card')).toBeVisible()
    await inspectSite(page, 'b')
    const rib = page.getByTestId('aznet-control-rib-card')
    await expect(rib.getByRole('heading')).toContainText('Site B')
    await page.getByRole('searchbox', { name: 'Filter BGP prefixes' }).fill('172.17')
    await expect(rib.locator('[data-prefix="172.17.0.0/24"]')).toHaveCount(1)
    await inspectSite(page, 'a')
    await expect(rib.getByRole('heading')).toContainText('Site A')
    await expect(page.getByRole('searchbox', { name: 'Filter BGP prefixes' })).toHaveValue('')
    await expect(page.getByTestId('aznet-subnet-routes-card')).toHaveCount(0)
    await expect(page.getByTestId('aznet-lpm-input')).toHaveCount(0)
    await expect(rib.locator('thead th')).toHaveText(['*', 'Next hop / source', 'AS path'])
    await expect(rib.locator('[data-reason-prefix="10.0.0.0/16"]')).toHaveCount(1)
    const preferred = rib.locator('[data-prefix="10.0.0.0/16"][data-preferred="true"]')
    const alternative = rib.locator('[data-prefix="10.0.0.0/16"][data-preferred="false"]')
    await expect(preferred).toHaveCount(1)
    await expect(preferred).toContainText('Primary VPN')
    await expect(preferred.locator('.as-path')).toHaveText('65515')
    await expect(alternative).toHaveCount(1)
    await expect(alternative).toContainText('Backup VPN')
    await expect(alternative.locator('.as-path')).toHaveText('65010 65515')
    await expect(rib.locator('[data-prefix="172.16.0.0/24"]')).toContainText('Local origin')
    await expect(rib.locator('[data-prefix="172.17.0.0/24"]')).toHaveCount(0)
    await page.getByTestId('aznet-site-b').click({ force: true })
    await expect(rib.getByRole('heading')).toContainText('Site A')
    await page.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
    await inspectSite(page, 'b')
    await expect(rib.getByRole('heading')).toContainText('Site B')
    await expect(rib.locator('[data-prefix="172.16.0.0/24"]')).toHaveCount(0)
  })

  test(`${mode} keeps an empty or removed requested site explicit without falling back`, async ({ page }) => {
    await load(page, mode)
    await inspectSite(page, 'a')
    await inspectSite(page, 'empty')
    const rib = page.getByTestId('aznet-control-rib-card')
    await expect(rib.getByRole('heading')).toContainText('Empty site')
    await expect(page.getByTestId('aznet-rib-empty')).toContainText('No BGP routes')
    await expect(rib.locator('[data-prefix]')).toHaveCount(0)
    await page.getByTestId('aznet-site-empty').focus()
    await page.keyboard.press('Delete')
    await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(page.getByTestId('aznet-rib-unavailable')).toBeVisible()
    await expect(page.getByTestId('aznet-subnet-routes-card')).toHaveCount(0)
    await page.getByRole('button', { name: /Undo/ }).click()
    await expect(rib.getByRole('heading')).toContainText('Empty site')
    await expect(page.getByTestId('aznet-rib-empty')).toBeVisible()
    await expect(page.getByTestId('aznet-rib-unavailable')).toHaveCount(0)
  })
}

test('all full-mode router inspectors use the same grouped table without a subnet fallback', async ({ page }) => {
  await load(page, 'full')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [id, action, heading] of [
    ['aznet-chip-gw', 'Inspect Gateway BGP RIB', 'VPN gateway'],
    ['aznet-chip-ars', 'Inspect Route Server RIB (ASN 65515)', 'Route Server'],
    ['aznet-erloc-er', 'Inspect ExpressRoute Location BGP RIB', 'Amsterdam'],
    ['aznet-vwanhub-vhub', 'Inspect Virtual WAN Hub Effective RIB', 'Virtual hub'],
  ]) {
    await page.getByTestId(id).click({ button: 'right' })
    await page.getByRole('menuitem', { name: action, exact: true }).click()
    const rib = page.getByTestId('aznet-control-rib-card')
    await expect(rib.getByRole('heading')).toContainText(heading)
    await expect(rib.locator('thead th')).toHaveText(['*', 'Next hop / source', 'AS path'])
    await expect(page.getByTestId('aznet-subnet-routes-card')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
  }
  expect(errors).toEqual([])
})
