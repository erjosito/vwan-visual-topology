import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import type { RouteMap, Topology } from '../src/model'

test.use({ storageState: { cookies: [], origins: [] } })

function design(mode: string) {
  const map: RouteMap = { id: 'policy', name: 'Policy {0} 日本語', siteId: 'a', rules: [
    { id: 'first', prefixes: ['192.0.2.0/24'], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [],
      nextStep: 'continue', localPreference: 200, matchConditions: [{ id: 'condition', property: 'asPath', match: 'contains', values: ['65005'] }] },
    { id: 'second', prefixes: [], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' },
  ] }
  const sites = [{ id: 'a', name: 'Branch', asn: 65001, prefixes: ['192.0.2.0/24'] }]
  if (mode === 'vwan') return { version: 1, name: 'Policy authoring', sites, routeMaps: [map], spokes: [], siteLinks: [],
    hubs: [{ id: 'hub', name: 'Hub', region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    connections: [{ id: 'vpn', name: 'Branch VPN', hubId: 'hub', siteId: 'a', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] }],
  } satisfies Topology
  const topology = createEmptyAzNetTopology()
  topology.sites = sites
  topology.routeMaps = [map]
  topology.vnets = [{ id: 'hub', name: 'Hub', role: 'hub', region: 'westeurope', prefixes: ['10.0.0.0/16'], appliances: [],
    subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
    gateways: [{ id: 'gw', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true }] }]
  topology.vpnConnections = [{ id: 'vpn', name: 'Branch VPN', siteId: 'a', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true }]
  return topology
}

async function prepare(page: Page, mode: string, ja: boolean, topology = design(mode)) {
  await page.setViewportSize({ width: ja ? 390 : 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: ja ? 'dark' : 'light' })
  await page.addInitScript(({ topology, ja }) => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    localStorage.setItem('aznet-workspace-tools:v1', 'closed')
    localStorage.setItem('vwan-visual-topology:language:v1', ja ? 'ja' : 'en')
    const key = topology.version === 1 ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(topology.version === 1 ? topology : { sampleId: '', topology }))
  }, { topology, ja })
  await page.goto(`/?mode=${mode}`)
  await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
}

async function open(page: Page, mode: string, ja: boolean, hub = false) {
  const node = mode === 'vwan' ? page.locator(`[data-node-id="${hub ? 'hub' : 'a'}"]`) : page.getByTestId('aznet-site-a')
  await node.focus()
  await node.press('Shift+F10')
  await page.getByRole('menuitem', { name: mode === 'vwan' ? ja ? 'ルート マップ' : 'Route maps' : 'Manage Site Route Maps', exact: true }).click()
  return page.locator('.route-map-panel')
}

for (const mode of ['vwan', 'hub-spoke', 'full']) for (const ja of [false, true]) {
  test(`${mode}: ${ja ? 'JA narrow dark' : 'EN wide light'} rule summaries preserve drafts, ordering and assignment boundaries`, async ({ page }) => {
    await prepare(page, mode, ja)
    const policy = await open(page, mode, ja)
    await policy.getByRole('button', { name: /Policy/ }).click()
    const first = policy.locator('[data-rule-id="first"]')
    const second = policy.locator('[data-rule-id="second"]')
    const status = policy.locator('.map-definition > .configuration-edit-status')
    await expect(first).not.toHaveAttribute('open')
    await expect(first.locator(':scope > summary')).toContainText('192.0.2.0/24')
    await expect(first.locator(':scope > summary')).toContainText('200')
    await expect(first.locator('textarea[name="first-prefixes"]')).toBeHidden()
    await first.locator(':scope > summary').focus()
    await first.locator(':scope > summary').press('Enter')
    await expect(first.locator('input[name="first-condition-0"]')).toBeVisible()
    await first.locator('input[name="first-condition-0"]').fill('65020')
    await first.locator('input[name="first-local-preference"]').fill('250')
    await first.locator('textarea[name="first-prefixes"]').fill('192.0.2.0/25 198.51.100.0/24 203.0.113.0/24 198.18.0.0/24')
    await first.getByRole('combobox', { name: ja ? '規則 1 のアクション' : 'Rule 1 action', exact: true }).selectOption('prepend')
    await first.locator('input[name="first-prepend"]').fill('65010 65010')
    await first.locator(':scope > summary').click()
    await expect(first.locator(':scope > summary')).toContainText('198.51.100.0/24')
    await expect(first.locator(':scope > summary')).toContainText(ja ? 'ほか 1 件' : '+1 more')
    await expect(first.locator(':scope > summary')).not.toContainText('198.18.0.0/24')
    await expect(first.locator(':scope > summary')).toContainText('65010 65010')
    await expect(first.locator(':scope > summary')).toContainText('250')
    await expect(status).toContainText(ja ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
    await second.locator(':scope > summary').click()
    await second.getByRole('button', { name: ja ? '規則 2 を上へ移動' : 'Move rule 2 up', exact: true }).click()
    await expect(policy.locator('[data-rule-id]').first()).toHaveAttribute('data-rule-id', 'second')
    await second.locator(':scope > summary').click()
    await policy.getByRole('button', { name: ja ? 'ルート マップを保存' : 'Save route map', exact: true }).click()
    await expect(status).toContainText(ja ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
    const read = () => page.evaluate((mode) => {
      const saved = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1')!)
      return mode === 'vwan' ? saved : saved.topology
    }, mode)
    const saved = await read()
    expect(saved.routeMaps[0].rules.map((rule: { id: string }) => rule.id)).toEqual(['second', 'first'])
    expect(saved.routeMaps[0].rules[1]).toMatchObject({ prefixes: ['192.0.2.0/25', '198.51.100.0/24', '203.0.113.0/24', '198.18.0.0/24'], prepend: [65010, 65010],
      localPreference: 250, matchConditions: [{ id: 'condition', property: 'asPath', match: 'contains', values: ['65020'] }] })
    expect(saved.sites[0].routeMapAssignments ?? []).toEqual([])
    const inbound = policy.getByRole('combobox', { name: ja ? 'インバウンド ルート マップ' : 'Inbound route map', exact: true })
    await expect(inbound).toHaveValue('')
    await inbound.selectOption('policy')
    await expect.poll(async () => (await read()).sites[0].routeMapAssignments).toEqual([{ connectionId: 'vpn', inboundMapId: 'policy' }])
    await expect(status).toContainText(ja ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
    await page.reload()
    await open(page, mode, ja)
    await expect(inbound).toHaveValue('policy')
    await policy.getByRole('button', { name: /Policy/ }).click()
    await expect(first).not.toHaveAttribute('open')
    await expect(first.locator(':scope > summary')).toContainText('65010 65010')
    await first.locator(':scope > summary').click()
    await expect(first.locator('input[name="first-condition-0"]')).toHaveValue('65020')
    await expect(first.locator('input[name="first-local-preference"]')).toHaveValue('250')
    await first.locator('textarea[name="first-prefixes"]').fill('203.0.113.0/24')
    await policy.getByRole('button', { name: ja ? 'ルート マップを保存' : 'Save route map', exact: true }).click()
    const updated = await read()
    expect(updated.routeMaps[0].rules[1].prefixes).toEqual(['203.0.113.0/24'])
    expect(updated.sites[0].routeMapAssignments).toEqual([{ connectionId: 'vpn', inboundMapId: 'policy' }])
    expect(await policy.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.route-map-panel').analyze()).violations).toEqual([])
    await policy.getByRole('button', { name: ja ? 'ルート マップを作成' : 'Create route map', exact: true }).click()
    await expect(status).toContainText(ja ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
    await policy.getByRole('button', { name: ja ? '規則を追加' : 'Add rule', exact: true }).click()
    await expect(policy.locator('[data-rule-id]')).toHaveAttribute('open')
    await policy.getByRole('button', { name: ja ? 'ルート マップを保存' : 'Save route map', exact: true }).click()
    await expect(status).toContainText(ja ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
    expect((await read()).routeMaps).toHaveLength(2)
    expect((await read()).sites[0].routeMapAssignments).toEqual([{ connectionId: 'vpn', inboundMapId: 'policy' }])
  })
}

test('vwan: saving reveals a collapsed rule with an invalid required field', async ({ page }) => {
  await prepare(page, 'vwan', false)
  const policy = await open(page, 'vwan', false, true)
  await policy.getByRole('button', { name: 'Create route map', exact: true }).click()
  await policy.getByRole('button', { name: 'Add rule', exact: true }).click()
  await policy.getByRole('combobox', { name: 'Rule 1 action', exact: true }).selectOption('prepend')
  const rule = policy.locator('[data-rule-id]')
  await rule.locator(':scope > summary').click()
  await expect(rule).not.toHaveAttribute('open')
  await policy.getByRole('button', { name: 'Save route map', exact: true }).click()
  await expect(rule).toHaveAttribute('open')
  await expect(policy.getByRole('alert')).toContainText('Check the highlighted rule fields before saving.')
  await expect(policy.getByRole('textbox', { name: 'Rule 1 prepend ASNs', exact: true })).toBeFocused()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  expect((await saved()).routeMaps).toHaveLength(1)
  await policy.getByRole('textbox', { name: 'Rule 1 prepend ASNs', exact: true }).fill('64496')
  await policy.getByRole('button', { name: 'Save route map', exact: true }).click()
  expect((await saved()).routeMaps).toHaveLength(2)
})

test('full: configured ARS attributes stay discoverable and survive nested disclosure and save', async ({ page }) => {
  const topology = design('full')
  if (topology.version === 1) throw new Error('Expected native fixture')
  const hub = topology.vnets[0]
  hub.subnets.push({ id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.0.254.0/27' },
    { id: 'nvas', name: 'NVAs', prefix: '10.0.2.0/24' })
  hub.appliances.push({ id: 'nva', name: 'NVA', kind: 'nva-vm', subnetId: 'nvas', privateIp: '10.0.2.4', asn: 65010,
    bgpEnabled: true, enableIpForwarding: true, advertisedPrefixes: ['192.0.2.0/24'], staticRoutes: [] })
  hub.routeServer = { id: 'ars', name: 'Route Server', enabled: true, subnetId: 'ars-subnet', branchToBranchTraffic: false,
    hubRoutingPreference: 'ASPath', peerApplianceIds: ['nva'], routeMaps: [{ id: 'ars-policy', name: 'ARS attributes', rules: [{
      id: 'ars-rule', prefixes: ['192.0.2.0/24'], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate',
      matchConditions: [{ id: 'community', property: 'community', match: 'contains', values: ['65001:100'] }],
      modifications: [{ id: 'modify', property: 'community', action: 'add', values: ['65001:200'] }],
    }] }] }
  await prepare(page, 'full', false, topology)
  await page.getByTestId('aznet-chip-ars').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Manage ARS Route Maps', exact: true }).click()
  const policy = page.locator('.route-map-panel')
  await policy.getByRole('button', { name: /ARS attributes/ }).click()
  const rule = policy.locator('[data-rule-id="ars-rule"]')
  await expect(rule.locator(':scope > summary')).toContainText('1 additional conditions; 1 attribute modifications')
  await rule.locator(':scope > summary').click()
  const advanced = rule.locator('.presentation-inspector-section')
  await expect(advanced).toHaveAttribute('open')
  await policy.getByRole('textbox', { name: 'Rule 1 condition 1 values', exact: true }).fill('65001:110')
  await policy.getByRole('textbox', { name: 'Rule 1 modification 1 values', exact: true }).fill('65001:210')
  await policy.getByRole('button', { name: 'Add modification', exact: true }).click()
  await policy.getByRole('combobox', { name: 'Rule 1 modification 2 property', exact: true }).selectOption('asPath')
  await policy.getByRole('textbox', { name: 'Rule 1 modification 2 values', exact: true }).fill('64501')
  await advanced.locator(':scope > summary').click()
  await rule.locator(':scope > summary').click()
  await expect(rule.locator(':scope > summary')).toContainText('2 attribute modifications')
  await policy.getByRole('button', { name: 'Save route map', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  expect(saved.vnets[0].routeServer.routeMaps[0].rules[0]).toMatchObject({
    matchConditions: [{ id: 'community', values: ['65001:110'] }],
    modifications: [{ id: 'modify', values: ['65001:210'] }, { property: 'asPath', action: 'replace', values: ['64501'] }],
  })
  await expect(policy.locator('.map-definition > .configuration-edit-status')).toContainText('No pending configuration edits.')
})
