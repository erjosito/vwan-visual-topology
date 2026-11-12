import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createEmptyAzNetTopology } from '../src/azure-net/model'

function topology(transport: 'ExpressRoute' | 'Vpn') {
  const value = createEmptyAzNetTopology()
  value.vnets = [
    { id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16', '192.168.0.0/16'],
      subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
      gateways: [{ id: 'gw', name: 'Gateway', kind: transport, asn: 65515, enabled: true, bgpEnabled: true }], appliances: [] },
    { id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16', '10.4.0.0/16'],
      subnets: [{ id: 'work', name: 'Workload', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  value.vnetPeerings = [{ id: 'peer', name: 'Hub-Spoke', enabled: true, vnetAId: 'hub', vnetBId: 'spoke',
    aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags, useRemoteGateways: true } }]
  value.sites = [{ id: 'dc', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  if (transport === 'ExpressRoute') {
    value.erLocations = [{ id: 'er', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
    value.erLinks = [
      { id: 'er-gw', name: 'Gateway circuit', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
      { id: 'er-site', name: 'Site circuit', locationId: 'er', targetKind: 'site', targetId: 'dc', enabled: true },
    ]
  } else value.vpnConnections = [{ id: 'vpn', name: 'VPN', siteId: 'dc', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true, bgpEnabled: true }]
  return value
}

async function menu(page: Page, id: string, action: string) {
  await page.getByTestId(id).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

const inspect = (page: Page) => menu(page, 'aznet-site-dc', 'Inspect Site BGP Route Table')
const configure = (page: Page) => menu(page, 'aznet-vnet-hub', 'Configure VNet & Elements')

for (const [mode, transport] of [['hub-spoke', 'ExpressRoute'], ['full', 'Vpn']] as const) {
  test(`${mode} edits ${transport} gateway summaries, keeps uncovered spaces and round-trips persistence/JSON/share`, async ({ page, browser }) => {
    await page.addInitScript((value) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
    }, topology(transport))
    await page.goto(`/?mode=${mode}`)
    await inspect(page)
    const rib = page.getByTestId('aznet-control-rib-card')
    await expect(rib.getByText('10.1.0.0/16', { exact: true })).toBeVisible()
    await configure(page)
    const prefixes = page.getByRole('textbox', { name: 'Advertised gateway prefixes Hub', exact: true })
    await prefixes.fill('10.0.0.0/15, 198.18.0.0/15')
    await prefixes.press('Tab')
    await inspect(page)
    await expect(rib.getByText('10.0.0.0/15', { exact: true })).toBeVisible()
    await expect(rib.getByText('198.18.0.0/15', { exact: true })).toBeVisible()
    await expect(rib.getByText('10.0.0.0/16', { exact: true })).toHaveCount(0)
    await expect(rib.getByText('10.1.0.0/16', { exact: true })).toHaveCount(0)
    await expect(rib.getByText('10.4.0.0/16', { exact: true })).toBeVisible()
    await expect(rib.getByText('192.168.0.0/16', { exact: true })).toBeVisible()
    await expect(rib).toContainText('Advertised gateway summary from Hub')
    await page.reload()
    await inspect(page)
    await expect(rib.getByText('10.0.0.0/15', { exact: true })).toBeVisible()
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export JSON/ }).click()
    const download = await downloadEvent
    const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'))
    expect(exported.vnets[0].summarizedGatewayPrefixes).toEqual(['10.0.0.0/15', '198.18.0.0/15'])
    expect(exported.vnets[0].prefixes).toEqual(['10.0.0.0/16', '192.168.0.0/16'])
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByTestId('aznet-share-url-btn').click()
    await expect(page.getByTestId('aznet-share-url-btn')).toHaveText('✓ Link Copied')
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText())
    expect(sharedUrl).toContain('#s=')
    expect(new URL(page.url()).hash).toBe('')
    const shared = await browser.newPage()
    await shared.goto(sharedUrl)
    await inspect(shared)
    await expect(shared.getByTestId('aznet-control-rib-card').getByText('10.0.0.0/15', { exact: true })).toBeVisible()
    await shared.close()
    await configure(page)
    await prefixes.fill('')
    await prefixes.press('Tab')
    await inspect(page)
    await expect(rib.getByText('10.0.0.0/15', { exact: true })).toHaveCount(0)
    await expect(rib.getByText('10.0.0.0/16', { exact: true })).toBeVisible()
    await expect(rib.getByText('10.1.0.0/16', { exact: true })).toBeVisible()
  })
}

test('gateway-prefix editing rejects overlapping, noncanonical and unsupported-family values without constraining them to VNet spaces', async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value })), topology('ExpressRoute'))
  await page.goto('/?mode=hub-spoke')
  await configure(page)
  const prefixes = page.getByRole('textbox', { name: 'Advertised gateway prefixes Hub', exact: true })
  for (const [value, error] of [['10.0.0.0/8, 10.1.0.0/16', 'overlap'], ['fd00::/48', 'IPv4'], ['10.0.0.1/16', 'invalid advertised gateway prefix']]) {
    await prefixes.fill(value)
    await prefixes.press('Tab')
    await expect(page.getByRole('alert')).toContainText(error)
    await page.getByTestId('aznet-check-routing-btn').click()
    await expect(page.getByTestId('aznet-routing-check-status')).toContainText('fix topology validation errors')
    await configure(page)
  }
  await prefixes.fill('198.18.0.0/15')
  await prefixes.press('Tab')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(page.getByTestId('aznet-routing-check-status')).toContainText('No routing issues found')
})
