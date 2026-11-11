import { expect, test, type Page } from '@playwright/test'
import { example, type Topology } from '../src/model'
import { createEmptyAzNetTopology, type AzNetTopology } from '../src/azure-net/model'

function hybridTopology(): AzNetTopology {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [
    { id: 'hub', name: 'Transit hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'workload', name: 'Workload', prefix: '10.0.1.0/24' }],
      gateways: [{ id: 'gateway', name: 'ER gateway', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true }],
      appliances: [] },
    { id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16'],
      subnets: [{ id: 'spoke-subnet', name: 'Spoke workload', prefix: '10.1.1.0/24' }],
      gateways: [], appliances: [], vwanHubAttachment: { hubId: 'vhub', enabled: true } },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings = [{ id: 'peer', name: 'Hub peering', vnetAId: 'hub', vnetBId: 'spoke', enabled: true, aToB: flags, bToA: { ...flags } }]
  topology.erLocations = [{ id: 'location', name: 'ER location' }]
  topology.sites = [{ id: 'site', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  topology.erLinks = [
    { id: 'gateway-connection', name: 'Gateway attachment', locationId: 'location', targetKind: 'vnet-gateway', targetId: 'gateway', enabled: true },
    { id: 'site-link', name: 'Site attachment', locationId: 'location', targetKind: 'site', targetId: 'site', enabled: true },
    { id: 'hub-connection', name: 'Hub attachment', locationId: 'location', targetKind: 'vwan-hub', targetId: 'vhub', enabled: true },
  ]
  topology.vwanHubs = [{ id: 'vhub', name: 'Virtual hub', region: 'West Europe', prefix: '10.2.0.0/23',
    preference: 'ExpressRoute', routingIntent: { private: false, internet: false } }]
  return topology
}

async function loadHybrid(page: Page, mode: string) {
  await page.addInitScript((topology) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, hybridTopology())
  await page.goto(`/?mode=${mode}`)
}

const confirmation = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })
async function selectAndDelete(page: Page, testId: string) {
  await page.getByTestId(testId).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Delete')
}

test('VWAN Delete confirms the selected node, supports cancellation and undo, and ignores stale selection', async ({ page }) => {
  await page.goto('/?mode=vwan')
  const hub = page.getByLabel('Select hub Europe hub', { exact: true })
  await page.keyboard.press('Delete')
  await expect(confirmation(page, 'Delete hub')).toHaveCount(0)
  await hub.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Delete')
  await expect(confirmation(page, 'Delete hub')).toHaveCount(0)
  await page.keyboard.press('Delete')
  await expect(confirmation(page, 'Delete hub')).toContainText('Europe hub')
  await confirmation(page, 'Delete hub').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(hub).toBeVisible()
  await hub.focus()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await expect(confirmation(page, 'Delete hub')).toHaveCount(0)
  await hub.focus()
  await page.keyboard.press('Delete')
  await confirmation(page, 'Delete hub').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await expect(hub).toHaveCount(0)
  const stored: Topology = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  expect(stored.connections.some((c) => c.hubId === 'eu')).toBe(false)
  expect(stored.spokes.some((s) => s.hubId === 'eu')).toBe(false)
  expect(stored.sites).toHaveLength(example.sites.length)
  await page.keyboard.press('Delete')
  await expect(confirmation(page, 'Delete hub')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(hub).toBeVisible()
})

test('VWAN selected connections use the same confirmed deletion as context menus', async ({ page }) => {
  await page.goto('/?mode=vwan')
  const link = page.getByLabel('Edit connection London primary', { exact: true })
  await link.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Delete')
  await expect(confirmation(page, 'Delete connection')).toContainText('London primary')
  await confirmation(page, 'Delete connection').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await expect(link).toHaveCount(0)
  await expect(page.getByLabel('Select site London datacenter', { exact: true })).toBeVisible()
})

test('Delete ignores composition, repeat, modal search and unsaved configuration fields', async ({ page }) => {
  await page.goto('/?mode=vwan')
  const site = page.getByLabel('Select site London datacenter', { exact: true })
  await site.focus()
  await page.keyboard.press('Enter')
  await site.evaluate((node) => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, repeat: true }))
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, isComposing: true }))
  })
  await expect(confirmation(page, 'Delete site')).toHaveCount(0)
  await page.getByTestId('vwan-topbar-er-locations-btn').click()
  const search = page.getByTestId('er-catalog-search')
  await search.fill('Paris')
  await search.press('Home')
  await search.press('Delete')
  await expect(search).toHaveValue('aris')
  await expect(confirmation(page, 'Delete site')).toHaveCount(0)
  await page.getByTestId('close-er-location-info-modal').click()
  await site.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
  const name = confirmation(page, 'Edit site').getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Unsaved name')
  await name.press('Home')
  await name.press('Delete')
  await expect(name).toHaveValue('nsaved name')
  await expect(confirmation(page, 'Delete site')).toHaveCount(0)
  await expect(site).toBeVisible()
})

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} Delete requires explicit selection and confirmation, protects editing, and preserves undo`, async ({ page }) => {
    await loadHybrid(page, mode)
    const node = page.getByTestId('aznet-vnet-hub')
    await page.keyboard.press('Delete')
    await expect(confirmation(page, 'Delete VNet')).toHaveCount(0)
    await selectAndDelete(page, 'aznet-vnet-hub')
    await expect(confirmation(page, 'Delete VNet')).toContainText('Transit hub')
    await page.keyboard.press('Delete')
    await expect(node).toBeVisible()
    await confirmation(page, 'Delete VNet').getByRole('button', { name: 'Cancel', exact: true }).click()
    await selectAndDelete(page, 'aznet-vnet-hub')
    await page.keyboard.press('Escape')
    await expect(node).toBeVisible()
    await node.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    const label = page.getByTestId('aznet-node-label-input-hub')
    await label.fill('Label')
    await label.press('Home')
    await label.press('Delete')
    await expect(label).toHaveValue('abel')
    await expect(confirmation(page, 'Delete VNet')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
    await selectAndDelete(page, 'aznet-vnet-hub')
    await confirmation(page, 'Delete VNet').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(node).toHaveCount(0)
    const stored: AzNetTopology = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(stored.vnetPeerings).toHaveLength(0)
    expect(stored.erLinks.some((l) => l.targetId === 'gateway')).toBe(false)
    expect(stored.vnets.some((v) => v.id === 'spoke')).toBe(true)
    await page.keyboard.press('Delete')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTitle('Undo', { exact: true }).click()
    await expect(node).toBeVisible()
  })

  test(`${mode} calls gateway attachments ER connections and deletes only the selected subnet or connection`, async ({ page }) => {
    await loadHybrid(page, mode)
    const link = page.getByTestId('aznet-erlink-gateway-connection')
    await expect(link).toHaveAccessibleName('Select ER connection Gateway attachment')
    await link.focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu', { name: 'ER connection · Gateway attachment', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete ER connection', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await selectAndDelete(page, 'aznet-erlink-gateway-connection')
    await expect(confirmation(page, 'Delete ER connection')).toContainText('Gateway attachment')
    await confirmation(page, 'Delete ER connection').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(link).toHaveCount(0)
    await expect(page.getByTestId('aznet-erlink-site-link')).toHaveAccessibleName('Select ExpressRoute link Site attachment')
    await expect(page.getByTestId('aznet-chip-gateway')).toBeVisible()
    await selectAndDelete(page, 'aznet-subnet-workload')
    await expect(confirmation(page, 'Delete Subnet')).toContainText('Workload')
    await confirmation(page, 'Delete Subnet').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(page.getByTestId('aznet-subnet-workload')).toHaveCount(0)
    await expect(page.getByTestId('aznet-vnet-hub')).toBeVisible()
  })
}

test('Full Hybrid hub deletion cleans attachments and keeps other endpoints', async ({ page }) => {
  await loadHybrid(page, 'full')
  await selectAndDelete(page, 'aznet-vwanhub-vhub')
  await expect(confirmation(page, 'Delete Virtual WAN Hub')).toContainText('Virtual hub')
  await confirmation(page, 'Delete Virtual WAN Hub').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await expect(page.getByTestId('aznet-vwanhub-vhub')).toHaveCount(0)
  await expect(page.getByTestId('aznet-erlink-hub-connection')).toHaveCount(0)
  await expect(page.getByTestId('aznet-vnet-spoke')).toBeVisible()
  const stored: AzNetTopology = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  expect(stored.vnets.find((v) => v.id === 'spoke')?.vwanHubAttachment).toBeUndefined()
})
