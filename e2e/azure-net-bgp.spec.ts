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

async function load(page: Page, mode: string) {
  const topology = bgpTopology()
  if (mode === 'full') topology.vwanHubs.push({
    id: 'vhub', name: 'Virtual hub', region: 'West Europe', preference: 'ExpressRoute', x: 700, y: 700,
    routingIntent: { private: false, internet: false },
  })
  await page.addInitScript((value) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
  }, topology)
  await page.goto(`/?mode=${mode}`)
}

async function inspectSite(page: Page, id: string) {
  await page.getByTestId(`aznet-site-${id}`).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Inspect Site BGP Route Table', exact: true }).click()
}

for (const mode of ['hub-spoke', 'full']) {
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
    ['aznet-erloc-er', 'Inspect ExpressRoute MSEE BGP RIB', 'Amsterdam'],
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
