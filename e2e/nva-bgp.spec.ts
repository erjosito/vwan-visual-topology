import { expect, test, type Locator, type Page } from '@playwright/test'
import { nvaBgpTopology } from '../tests/fixtures/nva-bgp'
import { bgpNeighborTopology, bgpNeighborVwanTopology } from '../tests/fixtures/bgp-neighbors'
import { bgpResourceKey, type BgpResourceRef } from '../src/bgp-neighbors'
import AxeBuilder from '@axe-core/playwright'
import { resolve } from 'node:path'

async function load(page: Page, mode: string, topology = nvaBgpTopology()) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) {
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
    }
  }, topology)
  await page.goto(`/?mode=${mode}`)
}

async function open(page: Page, target: string | Locator, action: string) {
  const node = typeof target === 'string' ? page.getByTestId(`aznet-chip-${target}`) : target
  await (await node.getAttribute('role') === 'group' ? node.locator(':scope > .network-node') : node).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
}

for (const profile of [
  { mode: 'vwan', preview: true, language: 'en', width: 1440 },
  { mode: 'hub-spoke', preview: false, language: 'en', width: 1440 },
  { mode: 'full', preview: true, language: 'ja', width: 390 },
] as const) {
  test(`${profile.mode}: contextual BGP inspection carries each supported resource without a generic top-bar action`, async ({ page }) => {
    const native = bgpNeighborVwanTopology()
    native.spokes.push({ id: 'plain-vnet', name: 'Plain VNet', hubId: 'managed-hub', prefixes: ['10.80.0.0/16'] })
    const topology = profile.mode === 'vwan' ? native : bgpNeighborTopology()
    if (profile.mode === 'full' && 'vwanHubs' in topology) topology.vwanHubs = native.hubs
    const key = profile.mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    const original = profile.mode === 'vwan' ? topology : { sampleId: '', topology }
    await page.addInitScript(({ profile, key, original }) => {
      localStorage.setItem('aznet-ui-preview:v1', String(profile.preview))
      localStorage.setItem('vwan-visual-topology:language:v1', profile.language)
      localStorage.setItem('aznet-theme', profile.language === 'ja' ? 'dark' : 'light')
      localStorage.setItem(key, JSON.stringify(original))
    }, { profile, key, original })
    await page.setViewportSize({ width: profile.width, height: 1000 })
    await page.goto(`/?mode=${profile.mode}`)
    await expect(page.getByTestId(profile.mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    const label = profile.language === 'ja' ? 'BGP ネイバー' : 'BGP neighbors'
    await expect(page.getByRole('banner').getByRole('button', { name: label, exact: true })).toHaveCount(0)
    const targets: BgpResourceRef[] = profile.mode === 'vwan' ? [
      { kind: 'vwan-hub', id: 'managed-hub' }, { kind: 'site', id: 'branch' }, { kind: 'er-location', id: 'edge-location' },
    ] : [
      { kind: 'gateway', id: 'vpn-aa' }, { kind: 'gateway', id: 'vpn-as' }, { kind: 'gateway', id: 'er-gateway' },
      { kind: 'appliance', id: 'reader' }, { kind: 'route-server', id: 'west-ars' },
      { kind: 'site', id: 'branch' }, { kind: 'er-location', id: 'edge-location' },
      ...(profile.mode === 'full' ? [{ kind: 'vwan-hub' as const, id: 'managed-hub' }] : []),
    ]
    for (const resource of targets) {
      const node = profile.mode === 'vwan' ? page.locator(`[data-node-id="${resource.id}"]`)
        : page.getByTestId(resource.kind === 'site' ? `aznet-site-${resource.id}`
          : resource.kind === 'er-location' ? `aznet-erloc-${resource.id}`
            : resource.kind === 'vwan-hub' ? `aznet-vwanhub-${resource.id}` : `aznet-chip-${resource.id}`)
      await open(page, node, label)
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await expect(dialog.getByRole('combobox', {
        name: profile.language === 'ja' ? 'ローカル BGP リソース' : 'Local BGP resource', exact: true,
      })).toHaveValue(bgpResourceKey(resource))
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    const unsupported = profile.mode === 'vwan' ? page.locator('[data-node-id="plain-vnet"]')
      : page.getByTestId(`aznet-vnet-${'vnets' in topology ? topology.vnets[0].id : ''}`)
    await (await unsupported.getAttribute('role') === 'group' ? unsupported.locator(':scope > .network-node') : unsupported).focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(original)
  })
}

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} B2B gates peered-VNet reflection without losing neighbors, east control or source provenance`, async ({ page }) => {
    const topology = nvaBgpTopology()
    topology.vnets[0].routeServer!.branchToBranchTraffic = false
    await load(page, mode, topology)
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    const routes = inspector.getByTestId('nva-bgp-routes')
    await expect(routes.locator('[data-ars-id="west-ars"][data-prefix="198.18.0.0/24"]')).toHaveCount(0)
    await expect(routes.locator('[data-ars-id="west-ars"][data-prefix="10.10.0.0/16"]')).toHaveCount(1)
    const east = routes.locator('[data-ars-id="east-ars"][data-prefix="198.18.0.0/24"]')
    await expect(east.locator('td').nth(2)).toHaveText('Wire next-hop IP not assessed')
    await expect(east.locator('td').nth(3)).toHaveText('65515 65021')
    await expect(inspector.getByTestId('nva-reflection-boundary')).toContainText('west-ars')
    await expect(inspector.getByTestId('nva-bgp-peers').locator('tbody tr')).toHaveCount(2)
    await open(page, 'west-ars', 'Enable Branch-to-Branch Traffic')
    const west = routes.locator('[data-ars-id="west-ars"][data-prefix="198.18.0.0/24"]')
    await expect(west).toHaveCount(1)
    await expect(west.locator('td').nth(2)).toHaveText('Wire next-hop IP not assessed')
    await expect(west.locator('td').nth(3)).toHaveText('65515 65020')
    await west.locator('td > details > summary').click()
    await west.getByText('ARS-learned source route (not receiver wire attributes)', { exact: true }).click()
    await expect(west).toContainText('10.10.1.4')
    await expect(west).toContainText('west-source')
    await expect(inspector.getByTestId('nva-reflection-boundary')).toHaveCount(0)
    await open(page, 'reader', 'BGP neighbors')
    const neighbors = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
    const neighborRows = neighbors.getByTestId('bgp-neighbor-rows').locator('tbody tr')
    await expect(neighborRows).toHaveCount(4)
    const ids = await neighborRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-neighbor-id')))
    await neighborRows.getByRole('button', { name: /west Route Server.*ARS speaker 1/ }).click()
    await expect(neighbors.getByTestId('bgp-neighbor-received').locator('[data-prefix="198.18.0.0/24"]')).toHaveCount(1)
    await open(page, 'west-ars', 'Disable Branch-to-Branch Traffic')
    await expect(neighbors.getByTestId('bgp-neighbor-received').locator('[data-prefix="198.18.0.0/24"]')).toHaveCount(0)
    await expect(neighborRows.filter({ hasText: 'west Route Server' }).first().locator('td').nth(3)).toHaveText('1')
    await expect(neighborRows.filter({ hasText: 'east Route Server' }).first().locator('td').nth(3)).toHaveText('3')
    expect(await neighborRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-neighbor-id')))).toEqual(ids)
    expect(await saved(page)).toEqual(topology)
    await page.reload()
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    await expect(page.getByTestId('nva-reflection-boundary')).toContainText('west-ars')
    await expect(page.getByTestId('nva-bgp-routes').locator('[data-ars-id="east-ars"][data-prefix="198.18.0.0/24"]')).toHaveCount(1)
    expect(await saved(page)).toEqual(topology)
  })

  test(`${mode} simulated BGP neighbors retain local-instance scope, duplicate peers and read-only route provenance`, async ({ page }) => {
    const topology = bgpNeighborTopology()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await load(page, mode, topology)
    await open(page, 'reader', 'BGP neighbors')
    const dialog = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
    const rows = dialog.getByTestId('bgp-neighbor-rows').locator('tbody tr')
    await expect(rows).toHaveCount(4)
    await expect(dialog.getByLabel('Local BGP instance')).toContainText('Logical router')
    await rows.getByRole('button', { name: /west Route Server.*ARS speaker 1/ }).click()
    const details = dialog.getByTestId('bgp-neighbor-details')
    await expect(details.getByTestId('bgp-neighbor-received').locator('[data-prefix="198.18.0.0/24"]')).toHaveCount(1)
    await expect(details).toContainText('logical relationship')
    await details.getByRole('button', { name: 'Inspect from peer', exact: true }).click()
    await expect(dialog.getByLabel('Local BGP resource')).toHaveValue(bgpResourceKey({ kind: 'route-server', id: 'west-ars' }))
    await expect(rows).toHaveCount(2)
    const first = await rows.first().getAttribute('data-local-instance-id')
    await dialog.getByLabel('Local BGP instance').focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(rows.first()).not.toHaveAttribute('data-local-instance-id', first!)
    await expect(rows).toHaveCount(2)
    await dialog.getByRole('searchbox', { name: 'Filter neighbors' }).fill('reader')
    await expect(rows).toHaveCount(1)
    await rows.getByRole('button').click()
    await details.getByRole('searchbox', { name: 'Filter BGP prefixes' }).fill('192.0.2')
    await expect(details.getByTestId('bgp-neighbor-received').locator('tbody tr')).toHaveCount(1)
    await open(page, 'reader', 'BGP neighbors')
    await expect(dialog.getByLabel('Local BGP resource')).toHaveValue(bgpResourceKey({ kind: 'appliance', id: 'reader' }))
    await expect(rows).toHaveCount(4)
    await page.setViewportSize({ width: 390, height: 844 })
    const region = dialog.getByRole('region', { name: 'BGP neighbor summary', exact: true })
    await region.focus()
    await expect(region).toBeFocused()
    expect((await new AxeBuilder({ page }).include('.bgp-neighbors-panel').analyze()).violations).toEqual([])
    await page.locator('header [data-language-selector]').selectOption('ja')
    const translated = page.getByRole('dialog', { name: 'BGP ネイバー', exact: true })
    await expect(translated.getByRole('combobox', { name: 'ローカル BGP インスタンス' })).toBeVisible()
    await expect(translated.getByTestId('bgp-neighbor-rows')).toContainText('受信（論理）')
    expect(await saved(page)).toEqual(topology)
    expect(errors).toEqual([])
  })

  test(`${mode} simulated BGP neighbors separate AA, AS and unmapped ER relationships and never substitute a deleted resource`, async ({ page }) => {
    const topology = bgpNeighborTopology()
    await load(page, mode, topology)
    await open(page, 'vpn-aa', 'BGP neighbors')
    const dialog = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
    const resource = dialog.getByLabel('Local BGP resource')
    const rows = dialog.getByTestId('bgp-neighbor-rows').locator('tbody tr')
    await expect(resource).toHaveValue(bgpResourceKey({ kind: 'gateway', id: 'vpn-aa' }))
    await expect(dialog.getByLabel('Local BGP instance').locator('option')).toHaveCount(2)
    await expect(rows).toHaveCount(1)
    await resource.selectOption(bgpResourceKey({ kind: 'gateway', id: 'vpn-as' }))
    await expect(dialog.getByLabel('Local BGP instance').locator('option')).toHaveCount(1)
    await expect(rows).toHaveCount(1)
    await expect(dialog).toContainText('standby physical instance exists')
    await resource.selectOption(bgpResourceKey({ kind: 'er-location', id: 'edge-location' }))
    await expect(dialog.getByLabel('Local BGP instance')).toHaveCount(0)
    await expect(dialog.getByTestId('bgp-managed-relationships').locator('details')).toHaveCount(2)
    await expect(dialog).toContainText('primary and secondary')
    await resource.selectOption(bgpResourceKey({ kind: 'route-server', id: 'east-ars' }))
    await open(page, 'east-ars', 'Remove Azure Route Server')
    await expect(dialog).toContainText('The requested BGP resource is unavailable. No other resource is substituted.')
    await expect(resource).toHaveValue(bgpResourceKey({ kind: 'route-server', id: 'east-ars' }))
    await expect(dialog.getByTestId('bgp-neighbor-rows')).toHaveCount(0)
  })

  test(`${mode} simulated BGP neighbors distinguish zero advertised prefixes from an unavailable peer`, async ({ page }) => {
    const topology = bgpNeighborTopology()
    topology.vnets[2].appliances[0].advertisedPrefixes = []
    topology.vnets[1].routeServer!.enabled = false
    await load(page, mode, topology)
    await open(page, 'reader', 'BGP neighbors')
    const dialog = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
    const rows = dialog.getByTestId('bgp-neighbor-rows').locator('tbody tr')
    await expect(rows).toHaveCount(4)
    const west = rows.filter({ hasText: 'west Route Server' })
    await expect(west.first().locator('td').nth(4)).toHaveText('0')
    await expect(west.first()).toContainText('Modeled relationship available')
    const east = rows.filter({ hasText: 'east Route Server' })
    await expect(east.first().locator('td').nth(4)).toHaveText('Not assessed')
    await expect(east.first()).toContainText('Modeled relationship unavailable')
    await west.first().getByRole('button').click()
    await expect(dialog.getByTestId('bgp-neighbor-details')).toContainText('Zero modeled prefixes')
    expect(await saved(page)).toEqual(topology)
  })

  test(`${mode} keeps independent canvas inspectors interactive when focus changes`, async ({ page }) => {
    const topology = nvaBgpTopology()
    await load(page, mode, topology)
    await page.locator('input[data-desktop-import]').setInputFiles(resolve('tests', 'fixtures', 'gateway-bgp-capture.json'))
    const capture = page.getByRole('dialog', { name: 'Azure & Bicep', exact: true })
    await expect(capture.getByTestId('captured-bgp-neighbors')).toBeVisible()
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'nva-bgp-native.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await expect(capture.getByTestId('captured-bgp-neighbors')).toHaveCount(0)
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    await expect(capture).toHaveCount(0)
    await expect(inspector).toBeVisible()
    await page.getByRole('button', { name: /Azure & Bicep$/ }).click()
    await expect(capture).toBeVisible()
    await inspector.focus()
    await inspector.getByText('Copyable route text', { exact: true }).click()
    await expect(inspector.getByRole('textbox', { name: 'Select route text to copy' })).toBeVisible()
    await capture.focus()
    await capture.getByRole('button', { name: 'Close Azure & Bicep', exact: true }).click()
    await expect(capture).toHaveCount(0)
    await expect(inspector).toBeVisible()
    expect(await saved(page)).toEqual(topology)
  })

  test(`${mode} compact NVA rows disclose provenance by keyboard and remain usable narrow, themed and Japanese`, async ({ page }) => {
    const topology = nvaBgpTopology()
    await load(page, mode, topology)
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(mode === 'full' ? 'dark' : 'light')
    await open(page, 'reader', 'Inspect NVA Learned BGP Routes')
    const inspector = page.getByRole('dialog', { name: 'NVA learned BGP routes · Dual-region NVA', exact: true })
    const routes = inspector.getByTestId('nva-bgp-routes')
    await expect(routes.locator('thead th')).toHaveText(['Status', 'Network', 'Advertising ARS / neighbor', 'Next hop', 'AS path', 'Route details'])
    const row = routes.locator('[data-ars-id="west-ars"][data-prefix="198.18.0.0/24"]')
    const evidence = row.locator('td > details')
    await expect(evidence).not.toHaveAttribute('open')
    await evidence.locator(':scope > summary').focus()
    await page.keyboard.press('Space')
    await expect(evidence).toHaveAttribute('open', '')
    await expect(evidence).toContainText('65020:1')
    await expect(evidence).toContainText('west-ars')
    await page.keyboard.press('Space')
    await expect(evidence).not.toHaveAttribute('open')
    await inspector.getByRole('searchbox', { name: 'Filter by prefix', exact: true }).fill('198.18')
    await expect(routes.locator('tbody tr')).toHaveCount(2)
    await inspector.getByLabel('NVA BGP peer filter', { exact: true }).selectOption('east-ars')
    await expect(routes.locator('tbody tr')).toHaveCount(1)
    await inspector.getByText('Copyable route text', { exact: true }).click()
    const copy = inspector.getByRole('textbox', { name: 'Select route text to copy' })
    await copy.focus()
    await expect(copy).toHaveValue(/east-ars/)
    await expect(copy).not.toHaveValue(/west-ars/)
    expect(await copy.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBeGreaterThan(0)
    await page.setViewportSize({ width: 390, height: 844 })
    const scroller = inspector.getByRole('region', { name: 'NVA learned BGP routes', exact: true })
    await scroller.focus()
    await expect(scroller).toBeFocused()
    expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await page.keyboard.press('End')
    await routes.locator('td > details > summary').focus()
    await page.keyboard.press('Enter')
    await expect(routes.locator('td > details')).toHaveAttribute('open', '')
    expect((await new AxeBuilder({ page }).include('.nva-bgp-panel .compact-bgp').analyze()).violations).toEqual([])
    await page.locator('header [data-language-selector]').selectOption('ja')
    await expect(page.getByTestId('nva-bgp-routes').locator('thead th')).toHaveText(['状態', 'ネットワーク', '広告元 ARS / ネイバー', 'ネクスト ホップ', 'AS パス', 'ルートの詳細'])
    await expect(page.getByText('コピー用ルートテキスト', { exact: true })).toBeVisible()
    expect(await saved(page)).toEqual(topology)
  })

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
    await open(page, 'east-ars', 'Inspect Route Server BGP table (ASN 65515)')
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

for (const mode of ['vwan', 'full']) test(`${mode} managed BGP relationships show known hub, MSEE and VPN peers without invented sessions`, async ({ page }) => {
  const vwan = bgpNeighborVwanTopology()
  const full = bgpNeighborTopology()
  full.vwanHubs = vwan.hubs
  full.erLinks.push({ id: 'er-hub', name: 'Hub ER', locationId: 'edge-location', targetKind: 'vwan-hub', targetId: 'managed-hub', enabled: true })
  full.vpnConnections.push({ id: 'managed-vpn', name: 'Managed VPN', siteId: 'branch', targetKind: 'vwan-hub', targetId: 'managed-hub', enabled: true, bgpEnabled: true })
  const topology = mode === 'vwan' ? vwan : full
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
  await page.addInitScript(({ key, topology, mode }) => localStorage.setItem(key,
    JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology })), { key, topology, mode })
  await page.goto(`/?mode=${mode}`)
  await open(page, mode === 'vwan' ? page.locator('[data-node-id="managed-hub"]') : page.getByTestId('aznet-vwanhub-managed-hub'), 'BGP neighbors')
  const dialog = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
  await expect(dialog.getByLabel('Local BGP resource')).toHaveValue(bgpResourceKey({ kind: 'vwan-hub', id: 'managed-hub' }))
  await expect(dialog.getByLabel('Local BGP instance')).toHaveCount(0)
  const rows = dialog.getByTestId('bgp-managed-rows').locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'Remote hub' })).toContainText('65515')
  await expect(rows.filter({ hasText: 'Managed VPN' })).toContainText('65050')
  await expect(rows.filter({ hasText: 'Hub ER' })).toContainText('12076')
  await expect(rows).toContainText(['Not observed', 'Not observed', 'Not observed'])
  await expect(dialog).toContainText('Standalone VPN active/standby controls do not apply')
  await dialog.getByRole('searchbox', { name: 'Filter neighbors', exact: true }).fill('12076')
  await expect(rows).toHaveCount(1)
  await rows.getByRole('button', { name: mode === 'vwan' ? 'Synthetic ER location' : 'Frankfurt', exact: true }).click()
  await expect(dialog.getByLabel('Local BGP resource')).toBeFocused()
  await expect(rows.filter({ hasText: 'er-hub' })).toContainText('65515')
  await dialog.getByLabel('Local BGP resource').selectOption(bgpResourceKey({ kind: 'site', id: 'branch' }))
  await expect(rows.filter({ hasText: 'managed-vpn' })).toContainText('65515')
  await expect(rows.filter({ hasText: 'er-site' })).toContainText('12076')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
  await page.locator('header [data-language-selector]').selectOption('ja')
  const translated = page.getByRole('dialog', { name: 'BGP ネイバー', exact: true })
  const region = translated.getByRole('region', { name: 'マネージド ピア関係', exact: true })
  await region.focus()
  await expect(region).toBeFocused()
  await translated.getByLabel('ローカル BGP リソース').selectOption(bgpResourceKey({ kind: 'vwan-hub', id: 'managed-hub' }))
  await expect(translated.getByTestId('bgp-managed-rows')).toContainText('ハブ間ルーティング')
  await translated.getByTestId('bgp-managed-rows').locator('summary').first().focus()
  await page.keyboard.press('Enter')
  await expect(translated.getByTestId('bgp-managed-rows').locator('details[open]')).toHaveCount(1)
  expect((await new AxeBuilder({ page }).include('.bgp-neighbors-panel').analyze()).violations).toEqual([])
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key))
    .toEqual(mode === 'vwan' ? topology : { sampleId: '', topology })
})

for (const mode of ['vwan', 'full']) test(`${mode} static VWAN routing and disabled ER remain visible without implying BGP sessions`, async ({ page }) => {
  const vwan = bgpNeighborVwanTopology()
  vwan.connections[0].learnSiteRoutes = false
  vwan.sites[0].vpnStaticRoutes = [{ id: 'static', prefix: '203.0.113.0/24', connectionId: 'managed-vpn' }]
  vwan.erLinks![1].enabled = false
  const full = bgpNeighborTopology()
  full.vwanHubs = vwan.hubs
  full.erLinks.push({ id: 'er-hub', name: 'Hub ER', locationId: 'edge-location', targetKind: 'vwan-hub', targetId: 'managed-hub', enabled: false })
  full.vpnConnections.push({ id: 'managed-vpn', name: 'Managed VPN', siteId: 'branch', targetKind: 'vwan-hub', targetId: 'managed-hub', enabled: true, bgpEnabled: false })
  const topology = mode === 'vwan' ? vwan : full
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
  const original = mode === 'vwan' ? topology : { sampleId: '', topology }
  await page.addInitScript(({ key, original }) => localStorage.setItem(key, JSON.stringify(original)), { key, original })
  await page.goto(`/?mode=${mode}`)
  await open(page, mode === 'vwan' ? page.locator('[data-node-id="managed-hub"]') : page.getByTestId('aznet-vwanhub-managed-hub'), 'BGP neighbors')
  const dialog = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
  await expect(dialog.getByLabel('Local BGP resource')).toHaveValue(bgpResourceKey({ kind: 'vwan-hub', id: 'managed-hub' }))
  const rows = dialog.getByTestId('bgp-managed-rows').locator('tbody tr')
  await expect(rows.filter({ hasText: 'managed-vpn' })).toContainText('Not applicable (static routing)')
  await expect(rows.filter({ hasText: 'managed-vpn' })).toContainText('Enabled')
  await expect(rows.filter({ has: page.getByText('er-hub', { exact: true }) })).toContainText('Disabled / unavailable')
  await expect(dialog.getByLabel('Local BGP instance')).toHaveCount(0)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(original)
})

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
