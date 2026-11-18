import { expect, test, type Page } from '@playwright/test'
import { nvaBgpTopology } from '../tests/fixtures/nva-bgp'

async function load(page: Page, mode: string, topology = nvaBgpTopology()) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) {
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
    }
  }, topology)
  await page.goto(`/?mode=${mode}`)
}

async function open(page: Page, chip: string, action: string) {
  await page.getByTestId(`aznet-chip-${chip}`).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
}

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} scopes unassessed gateway summaries to their original ARS without presenting them as received routes`, async ({ page }) => {
    const topology = nvaBgpTopology()
    topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/12', '203.0.113.0/24']
    await load(page, mode, topology)
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    const boundary = inspector.getByTestId('nva-gateway-summary-boundary')
    await expect(boundary).toContainText('west-ars: Configured gateway summaries (not assessed)')
    await expect(boundary).toContainText('203.0.113.0/24')
    await expect(inspector.getByTestId('nva-bgp-routes').locator('[data-prefix="203.0.113.0/24"]')).toHaveCount(0)
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('east-ars')
    await expect(boundary).toHaveCount(0)
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('west-ars')
    await expect(boundary).toHaveCount(1)
    expect(await saved(page)).toEqual(topology)
  })

  test(`${mode} inspects duplicate NVA received routes read-only and independently of canvas and effective-route selection`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const topology = nvaBgpTopology()
    await load(page, mode, topology)
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    const routes = inspector.getByTestId('nva-bgp-routes')
    await expect(routes.locator('[data-prefix="198.18.0.0/24"]')).toHaveCount(2)
    await expect(routes.locator('[data-ars-id="west-ars"][data-prefix="198.18.0.0/24"]')).toContainText('65020:1')
    await expect(routes.locator('[data-ars-id="east-ars"][data-prefix="198.18.0.0/24"]')).toContainText('65020:2')
    await expect(routes.locator('[data-prefix="192.0.2.0/24"]')).toHaveCount(0)
    await expect(inspector.getByText('ARS selects before export. NVA best-path selection and forwarding from these candidates are not modeled.', { exact: true })).toBeVisible()
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('west-ars')
    await expect(routes.locator('[data-prefix="198.18.0.0/24"]')).toHaveCount(1)
    await open(page, 'east-ars', 'Inspect Route Server RIB (ASN 65515)')
    await expect(page.getByTestId('aznet-control-rib-card')).toContainText('east Route Server')
    await expect(inspector.getByLabel('NVA BGP peer filter', { exact: true })).toHaveValue('west-ars')
    await expect(routes.locator('[data-ars-id="east-ars"]')).toHaveCount(0)
    expect(await saved(page)).toEqual(topology)
    expect(errors).toEqual([])
  })

  test(`${mode} edits independent ARS memberships, persists them, and retains explicit disabled-peer evidence`, async ({ page }) => {
    const topology = nvaBgpTopology()
    topology.vnets[1].routeServer!.enabled = false
    await load(page, mode, topology)
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    await expect(inspector.getByTestId('nva-bgp-peers').locator('[data-ars-id="east-ars"]')).toContainText('ARS disabled')
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('east-ars')
    await expect(inspector.getByTestId('nva-bgp-routes').locator('tbody tr')).toHaveCount(0)
    await inspector.getByRole('button', { name: 'Edit ARS peers', exact: true }).click()
    const west = inspector.getByRole('checkbox', { name: 'ARS peer west Route Server', exact: true })
    const east = inspector.getByRole('checkbox', { name: 'ARS peer east Route Server', exact: true })
    await west.uncheck()
    await expect(east).toBeChecked()
    expect((await saved(page)).vnets[1].routeServer.peerApplianceIds).toEqual(['east-source', 'reader'])
    await west.check()
    await east.uncheck()
    await expect(west).toBeChecked()
    await expect(east).toBeDisabled()
    await expect(inspector.getByLabel('NVA BGP peer filter', { exact: true })).toHaveValue('east-ars')
    await expect(inspector.getByTestId('nva-bgp-routes').locator('tbody tr')).toHaveCount(0)
    await expect(inspector.getByText('The selected ARS peer is no longer configured. No received-route evidence is available in this scope.', { exact: true })).toBeVisible()
    await page.reload()
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    await expect(inspector.getByTestId('nva-bgp-peers').locator('tbody tr')).toHaveCount(1)
    await expect(inspector.getByTestId('nva-bgp-peers')).toContainText('west Route Server')
    expect((await saved(page)).vnets[0].routeServer.peerApplianceIds).toContain('reader')
    expect((await saved(page)).vnets[1].routeServer.peerApplianceIds).toEqual(['east-source'])
  })

  test(`${mode} refreshes the independent NVA inspector when a scoped ARS outbound policy changes`, async ({ page }) => {
    const topology = nvaBgpTopology()
    topology.vnetPeerings[0].aToB.allowGatewayTransit = true
    topology.vnetPeerings[0].bToA.useRemoteGateways = true
    topology.vnets[0].routeServer!.routeMaps = [{ id: 'export', name: 'West export', rules: [{
      id: 'drop', prefixes: ['198.19.0.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate',
    }] }]
    await load(page, mode, topology)
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('west-ars')
    await expect(inspector.getByTestId('nva-bgp-routes').locator('[data-prefix="198.19.0.0/24"]')).toHaveCount(1)
    await open(page, 'west-ars', 'Manage ARS Route Maps')
    const policies = page.getByRole('dialog', { name: 'Route maps · west Route Server', exact: true })
    await policies.getByRole('combobox', { name: 'Route map connection', exact: true }).selectOption('vnet:shared')
    await policies.getByRole('combobox', { name: 'Outbound route map', exact: true }).selectOption('export')
    await expect(inspector.getByTestId('nva-bgp-routes').locator('[data-prefix="198.19.0.0/24"]')).toHaveCount(0)
    await policies.getByRole('button', { name: 'Close Route maps · west Route Server', exact: true }).click()
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('east-ars')
    await expect(inspector.getByTestId('nva-bgp-routes').locator('[data-prefix="198.19.1.0/24"]')).toHaveCount(1)
    expect((await saved(page)).vnets[0].routeServer.routeMapAssignments).toEqual([{ connectionId: 'vnet:shared', outboundMapId: 'export' }])
  })
}

test('localizes the NVA inspector on a narrow dark workspace and enforces the ARS peer limit', async ({ page }) => {
  const topology = nvaBgpTopology()
  const west = topology.vnets[0]
  west.appliances = Array.from({ length: 16 }, (_, index) => ({
    ...west.appliances[0], id: `source-${index}`, name: `Source ${index}`, privateIp: `10.10.1.${index + 4}`, asn: 65020 + index,
  }))
  west.routeServer!.peerApplianceIds = west.appliances.map((app) => app.id)
  topology.vnets[1].routeServer!.enabled = false
  await page.setViewportSize({ width: 700, height: 900 })
  await load(page, 'full', topology)
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
  await page.getByRole('combobox', { name: 'Language / 言語', exact: true }).selectOption('ja')
  await expect(page.getByRole('button', { name: 'ワークスペース', exact: true })).toBeVisible()
  await open(page, 'reader', 'NVA が学習した BGP ルートを確認')
  const inspector = page.getByRole('dialog', { name: 'NVA が学習した BGP ルート · Dual-region NVA', exact: true })
  await expect(inspector.getByTestId('nva-bgp-peers')).toContainText('ARS が無効')
  await inspector.getByRole('button', { name: 'ARS ピアを編集', exact: true }).click()
  await expect(inspector.getByRole('checkbox', { name: 'ARS ピア west Route Server', exact: true })).toBeDisabled()
  await expect(inspector.getByRole('checkbox', { name: 'ARS ピア east Route Server', exact: true })).toBeChecked()
  await expect(inspector.getByLabel('NVA BGP ピアフィルター', { exact: true })).toBeVisible()
  await expect(inspector.getByRole('columnheader', { name: '広告元 ARS / ネイバー', exact: true })).toBeVisible()
  expect((await saved(page)).vnets[0].routeServer.peerApplianceIds).toHaveLength(16)
})
