import { expect, test, type Page } from '@playwright/test'
import { createEmptyAzNetTopology, type AzNetTopology } from '../src/azure-net/model'

function inspectionTopology() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [
    { id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
      subnets: [
        { id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27', routeTableId: 'return' },
        { id: 'fw-subnet', name: 'AzureFirewallSubnet', prefix: '10.0.2.0/24' },
      ],
      gateways: [{ id: 'gw', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true }],
      appliances: [{ id: 'fw', name: 'Inspection firewall', kind: 'azure-firewall', subnetId: 'fw-subnet',
        privateIp: '10.0.2.4', enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [] }] },
    { id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16'],
      subnets: [{ id: 'work', name: 'Workload', prefix: '10.1.1.0/24', routeTableId: 'outbound' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings = [{ id: 'peer', name: 'Hub-Spoke', enabled: true, vnetAId: 'hub', vnetBId: 'spoke',
    aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags, useRemoteGateways: true } }]
  topology.sites = [{ id: 'dc', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  topology.vpnConnections = [{ id: 'vpn', name: 'VPN', siteId: 'dc', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true }]
  topology.udrTables = [
    { id: 'return', name: 'Return table', disableBgpRoutePropagation: false, disablePeeringRoutePropagation: true, routes: [] },
    { id: 'outbound', name: 'Outbound table', disableBgpRoutePropagation: true,
      routes: [{ id: 'default-fw', name: 'Inspect outbound', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true }] },
  ]
  return topology
}

async function load(page: Page, topology: AzNetTopology, mode = 'hub-spoke') {
  await page.addInitScript((value) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
  }, topology)
  await page.goto(`/?mode=${mode}`)
}

async function subnetMenu(page: Page, id: string) {
  await page.getByTestId(`aznet-subnet-${id}`).focus()
  await page.keyboard.press('Shift+F10')
}

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} explains missing peering replacement UDRs as inspection asymmetry and repairs live`, async ({ page }) => {
    await load(page, inspectionTopology(), mode)
    await page.getByTestId('aznet-check-routing-btn').click()
    const status = page.getByTestId('aznet-routing-check-status')
    await expect(status).toContainText('0 connectivity failures, 1 stateful asymmetries')
    await page.getByTestId('aznet-review-routing-issues').click()
    const finding = page.getByTestId('aznet-finding-asymmetric-firewall-bypass')
    await expect(finding).toContainText('No active covering UDR to suppress VNet peering routes in Hub/GatewaySubnet')
    await expect(finding).not.toContainText('matched only the 0.0.0.0/0 Internet')
    await finding.getByRole('button', { name: /Trace Flow/ }).click()
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Asymmetric')
    await expect(page.getByTestId('aznet-reverse-hops')).toContainText('VNetPeering')
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    await subnetMenu(page, 'gateway')
    await page.getByRole('menuitem', { name: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
    const table = page.getByTestId('aznet-rt-card-return')
    await table.getByRole('button', { name: '+ Add UDR Row', exact: true }).click()
    await table.locator('tbody tr').getByRole('textbox').nth(1).fill('10.0.0.0/8')
    await expect(status).toContainText('0 connectivity failures, 0 stateful asymmetries')
    await page.getByTestId('aznet-tab-diagnostics').click()
    await expect(finding).toHaveCount(0)
  })

  test(`${mode} grays out exhausted connection menus and enables them when destinations become available`, async ({ page }) => {
    const topology = createEmptyAzNetTopology()
    topology.erLocations = [{ id: 'er', name: 'Amsterdam' }]
    topology.sites = [{ id: 'dc', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
    topology.erLinks = [{ id: 'existing', name: 'Existing circuit', locationId: 'er', targetKind: 'site', targetId: 'dc', enabled: true }]
    await load(page, topology, mode)
    const openEr = () => page.getByTestId('aznet-erloc-er').click({ button: 'right', force: true, position: { x: 20, y: 20 } })
    await openEr()
    const globalReach = page.getByRole('menuitem', { name: 'Establish ExpressRoute Global Reach to...', exact: true })
    const connect = page.getByRole('menuitem', { name: 'Connect ExpressRoute to...', exact: true })
    await expect(globalReach).toBeDisabled()
    await expect(connect).toBeDisabled()
    await expect(connect).toHaveCSS('opacity', '0.45')
    await connect.hover({ force: true })
    await expect(page.getByRole('menu')).toHaveCount(1)
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('menuitem', { name: 'Configure ER Location & Labels', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByTestId('aznet-site-dc').focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: 'Connect Site to...', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByTestId('aznet-add-site-btn').click()
    await openEr()
    await expect(connect).toBeEnabled()
    await connect.click()
    await page.getByRole('menuitem', { name: /^Site:/ }).click()
    await openEr()
    await expect(connect).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByTestId('aznet-add-erloc-btn').click()
    await openEr()
    await expect(globalReach).toBeEnabled()
    await globalReach.click()
    await page.getByRole('menuitem', { name: /^ER MSEE:/ }).click()
    await openEr()
    await expect(globalReach).toBeDisabled()
  })
}

test('PE route-table policies alone and a default UDR do not suppress the PE /32', async ({ page }) => {
  const topology = inspectionTopology()
  topology.vnets[1].prefixes = ['10.1.0.0/20']
  topology.vnets[1].subnets[0].privateEndpointNetworkPolicies = 'RouteTableEnabled'
  topology.vnets[1].subnets[0].privateEndpoints = [{ id: 'pe', name: 'Storage PE', ipAddress: '10.1.1.20', serviceName: 'Storage' }]
  topology.vnets[0].subnets.push({ id: 'management', name: 'Management', prefix: '10.0.3.0/24', routeTableId: 'return' })
  topology.udrTables[0].disablePeeringRoutePropagation = false
  topology.udrTables[0].routes = [{ id: 'inspect', name: 'Inspection route', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true }]
  await load(page, topology)
  await subnetMenu(page, 'management')
  await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
  await page.getByTestId('aznet-lpm-input').fill('10.1.1.20')
  await expect(page.getByTestId('aznet-route-row-10.1.1.20/32-System')).toContainText('LPM Winner')
  await page.getByTestId('aznet-tab-editor').click()
  await page.getByTestId('aznet-rt-card-return').locator('tbody tr').getByRole('textbox').nth(1).fill('10.1.0.0/20')
  await page.getByTestId('aznet-tab-routes').click()
  await expect(page.getByTestId('aznet-route-row-10.1.0.0/20-User')).toContainText('LPM Winner')
  await expect(page.getByTestId('aznet-route-row-10.1.1.20/32-System')).not.toContainText('LPM Winner')
})
