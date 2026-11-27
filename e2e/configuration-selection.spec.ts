import { expect, test, type Page } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import type { Topology } from '../src/model'
import { vpnGatewayModeTopology } from '../tests/fixtures/vpn-gateway-mode'
import { dualExpressRouteTopology } from '../tests/fixtures/dual-expressroute'

test.use({ storageState: { cookies: [], origins: [] } })

const profiles = [{ preview: true, language: 'en', width: 1440 }, { preview: false, language: 'en', width: 1440 },
  { preview: true, language: 'ja', width: 390 }]
const select = async (page: Page, testId: string) => {
  const node = page.getByTestId(testId)
  await node.focus()
  await node.press('Enter')
}
async function section(page: Page, title: string) {
  const disclosure = page.locator('.aznet-inspector-window summary').filter({ hasText: title }).first().locator('..')
  if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click()
}
function nativeTopology() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [
    { id: 'a', name: 'Network A', region: 'westeurope', role: 'spoke', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'work', name: 'Application', prefix: '10.0.1.0/24' }], gateways: [], appliances: [] },
    { id: 'b', name: 'Network B', region: 'eastus', role: 'spoke', prefixes: ['10.4.0.0/16'], subnets: [], gateways: [], appliances: [] },
  ]
  topology.sites = [{ id: 'site', name: 'Branch', asn: 65001, prefixes: ['192.0.2.0/24'] }]
  topology.erLocations = [{ id: 'er', name: 'Circuit location', sku: 'Standard' }]
  topology.vwanHubs = ['one', 'two'].map((id, index) => ({ id, name: `Hub ${id}`, region: 'westeurope',
    prefix: `10.${100 + index}.0.0/23`, preference: 'ExpressRoute', routingIntent: { private: false, internet: false } }))
  return topology
}
async function prepare(page: Page, mode: string, topology: Topology | ReturnType<typeof nativeTopology>, profile = profiles[0]) {
  await page.setViewportSize({ width: profile.width, height: 1000 })
  await page.addInitScript(({ topology, profile }) => {
    localStorage.setItem('aznet-ui-preview:v1', String(profile.preview))
    localStorage.setItem('aznet-workspace-tools:v1', 'closed')
    localStorage.setItem('vwan-visual-topology:language:v1', profile.language)
    const key = topology.version === 1 ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    if (!localStorage.getItem(key)) localStorage.setItem(key,
      JSON.stringify(topology.version === 1 ? topology : { sampleId: '', topology }))
  }, { topology, profile })
  await page.goto(`/?mode=${mode}`)
  await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
}

for (const mode of ['hub-spoke', 'full']) for (const preview of [true, false]) {
  for (const width of [1440, 390]) test(`${mode}: site controls retain mouse focus and character-by-character edits (${preview}, ${width})`, async ({ page }) => {
    await prepare(page, mode, nativeTopology(), { preview, language: 'en', width })
    const node = page.getByTestId('aznet-site-site')
    await node.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Configure Site & Labels', exact: true }).click()
    await section(page, 'On-premises site configuration')
    const card = page.getByTestId('aznet-site-config-site')
    const name = card.locator('input').nth(0)
    await name.click()
    await name.press('Control+a')
    await name.press('Backspace')
    await name.pressSequentially('Renamed branch')
    await expect(name).toHaveValue('Renamed branch')
    await expect(name).toBeFocused()
    const prefixes = card.locator('input').nth(2)
    await prefixes.click()
    await prefixes.press('End')
    await prefixes.pressSequentially(', 198.51.100.0/24')
    await expect(prefixes).toHaveValue('192.0.2.0/24, 198.51.100.0/24')
    await expect(prefixes).toBeFocused()
    await expect(page.locator('.configuration-edit-status:not(.configuration-section-status)')).toContainText('Unsaved configuration changes.')
    await prefixes.blur()
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect((await read()).sites[0]).toMatchObject({ id: 'site', name: 'Renamed branch', prefixes: ['192.0.2.0/24', '198.51.100.0/24'] })
    await prefixes.click()
    await prefixes.press('End')
    await prefixes.pressSequentially(', ')
    await expect(prefixes).toHaveValue('192.0.2.0/24, 198.51.100.0/24, ')
    await prefixes.blur()
    await expect(prefixes).toHaveValue('192.0.2.0/24, 198.51.100.0/24')
    await expect(page.locator('.configuration-edit-status:not(.configuration-section-status)')).toContainText('No pending configuration edits.')
    await prefixes.click()
    await prefixes.press('Control+a')
    await prefixes.press('Backspace')
    await expect(prefixes).toHaveValue('')
    await prefixes.blur()
    expect((await read()).sites[0].prefixes).toEqual([])
    const asn = card.getByRole('spinbutton')
    await asn.click()
    await asn.press('Control+a')
    await asn.press('Backspace')
    await expect(asn).toHaveValue('')
    await asn.pressSequentially('65042')
    await expect(asn).toBeFocused()
    await asn.press('Tab')
    expect((await read()).sites[0].asn).toBe(65042)
    await page.reload()
    expect((await read()).sites[0]).toMatchObject({ id: 'site', name: 'Renamed branch', asn: 65042, prefixes: [] })
  })

  test(`${mode}: other node editors accept typing and retain saved values (${preview})`, async ({ page }) => {
    test.setTimeout(60_000)
    const topology = nativeTopology()
    const devices = vpnGatewayModeTopology().vnets[0]
    topology.vnets[0].subnets.push(...devices.subnets.filter(subnet => subnet.id !== 'app'))
    topology.vnets[0].gateways = devices.gateways
    topology.vnets[0].routeServer = devices.routeServer
    topology.vnets[0].appliances = [{ id: 'nva', name: 'NVA', kind: 'nva-vm', subnetId: 'work',
      privateIp: '10.0.1.8', enableIpForwarding: true, staticRoutes: [], asn: 65010 }]
    await prepare(page, mode, topology, { preview, language: 'en', width: 1440 })
    await page.getByTestId('aznet-select-vnet-b').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    await section(page, 'VNet configuration')
    const replace = async (input: ReturnType<Page['locator']>, value: string) => {
      await input.click()
      await input.press('Control+a')
      await input.press('Backspace')
      await input.pressSequentially(value)
      await expect(input).toHaveValue(value)
      await expect(input).toBeFocused()
      await input.blur()
    }
    await replace(page.locator('[aria-label^="VNet name "]'), 'Renamed VNet')
    const prefixes = page.getByTitle('VNet CIDR prefixes (comma-separated)', { exact: true })
    await prefixes.click()
    await prefixes.press('End')
    await prefixes.pressSequentially(', 10.5.0.0/16')
    await expect(prefixes).toHaveValue('10.4.0.0/16, 10.5.0.0/16')
    await prefixes.blur()
    await select(page, 'aznet-subnet-work')
    await section(page, 'Subnet configuration')
    await replace(page.getByTestId('aznet-subnet-name-work'), 'Renamed subnet')
    await replace(page.getByTestId('aznet-subnet-prefix-work'), '10.0.2.0/24')
    await select(page, 'aznet-erloc-er')
    await section(page, 'ExpressRoute location configuration')
    await replace(page.getByTestId('aznet-erloc-config-er').locator('input').first(), 'Renamed location')
    await select(page, 'aznet-vwanhub-one')
    await replace(page.getByRole('textbox', { name: 'Hub name', exact: true }), 'Renamed hub')
    await replace(page.getByRole('textbox', { name: 'Hub address prefix', exact: true }), '10.110.0.0/23')
    await select(page, 'aznet-chip-vpn')
    await section(page, 'VNet configuration')
    await page.getByRole('combobox', { name: 'Gateway SKU', exact: true }).selectOption('VpnGw1AZ')
    await select(page, 'aznet-chip-ars')
    await section(page, 'VNet configuration')
    await page.getByRole('combobox', { name: 'ARS Hub Routing Preference', exact: true }).selectOption('VpnGateway')
    await select(page, 'aznet-chip-nva')
    await replace(page.getByRole('spinbutton', { name: 'Peer ASN', exact: true }), '65020')
    await replace(page.getByRole('textbox', { name: 'Advertised prefixes', exact: true }), '203.0.113.0/24, 198.51.100.0/24')
    await page.getByRole('button', { name: 'Save NVA BGP routing', exact: true }).click()
    await page.reload()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(saved.vnets[1]).toMatchObject({ id: 'b', name: 'Renamed VNet', prefixes: ['10.4.0.0/16', '10.5.0.0/16'] })
    expect(saved.vnets[0].subnets[0]).toMatchObject({ id: 'work', name: 'Renamed subnet', prefix: '10.0.2.0/24' })
    expect(saved.erLocations[0]).toMatchObject({ id: 'er', name: 'Renamed location' })
    expect(saved.vwanHubs[0]).toMatchObject({ id: 'one', name: 'Renamed hub', prefix: '10.110.0.0/23' })
    expect(saved.vnets[0].gateways[0]).toMatchObject({ id: 'vpn', sku: 'VpnGw1AZ' })
    expect(saved.vnets[0].routeServer).toMatchObject({ id: 'ars', hubRoutingPreference: 'VpnGateway' })
    expect(saved.vnets[0].appliances[0]).toMatchObject({ id: 'nva', asn: 65020, advertisedPrefixes: ['203.0.113.0/24', '198.51.100.0/24'] })
    expect(saved.sites).toEqual(topology.sites)
  })
}

for (const preview of [true, false]) {
  test(`vwan: node names and prefix lists accept character-by-character replacement (${preview})`, async ({ page }) => {
    test.setTimeout(60_000)
    const topology: Topology = { version: 1, name: 'Typing audit',
      hubs: [{ id: 'hub', name: 'Hub', region: 'westeurope', preference: 'ExpressRoute',
        routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
      spokes: [{ id: 'spoke', name: 'VNet', prefixes: ['10.0.0.0/16'] }],
      sites: [{ id: 'site', name: 'Site', asn: 65001, prefixes: ['192.0.2.0/24'] }],
      erLocations: [{ id: 'er', name: 'Location', sku: 'Standard' }], connections: [], siteLinks: [], routeMaps: [] }
    await prepare(page, 'vwan', topology, { preview, language: 'en', width: 1440 })
    for (const id of ['site', 'spoke', 'hub', 'er']) {
      const node = page.locator(`[data-node-id="${id}"]`)
      await node.focus()
      await node.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
      const editor = page.locator('.object-editor')
      const replace = async (field: string, value: string) => {
        const input = editor.locator(`[name="${field}"]`)
        await input.click()
        await input.press('Control+a')
        await input.press('Backspace')
        await input.pressSequentially(value)
        await expect(input).toHaveValue(value)
        await expect(input).toBeFocused()
      }
      await replace('name', `Renamed ${id}`)
      if (id === 'site') await replace('prefix', '192.0.2.0/24, 198.51.100.0/24')
      if (id === 'spoke') await replace('prefixes', '10.0.0.0/16, 10.1.0.0/16')
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(editor).toHaveCount(0)
    }
    await page.reload()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
    expect(saved.sites[0]).toMatchObject({ id: 'site', name: 'Renamed site', prefixes: ['192.0.2.0/24', '198.51.100.0/24'] })
    expect(saved.spokes[0]).toMatchObject({ id: 'spoke', name: 'Renamed spoke', prefixes: ['10.0.0.0/16', '10.1.0.0/16'] })
    expect(saved.hubs[0]).toMatchObject({ id: 'hub', name: 'Renamed hub' })
    expect(saved.erLocations[0]).toMatchObject({ id: 'er', name: 'Renamed er' })
  })
}

for (const profile of profiles) {
  test(`vwan: configuration follows selection with pending edits (${profile.preview}, ${profile.language})`, async ({ page }) => {
    const topology: Topology = { version: 1, name: 'Configuration switching', hubs: [{ id: 'hub', name: 'Virtual hub',
      region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
      spokes: [], sites: [{ id: 'a', name: 'Site A', asn: 65001, prefixes: ['192.0.2.0/24'] },
        { id: 'b', name: 'Site B', asn: 65002, prefixes: ['198.51.100.0/24'] }], connections: [], siteLinks: [], routeMaps: [],
      erLocations: [{ id: 'er', name: 'Circuit location', sku: 'Standard' }] }
    await prepare(page, 'vwan', topology, profile)
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
    const node = (id: string) => page.locator(`[data-node-id="${id}"]`)
    const choose = async (id: string) => { await node(id).focus(); await node(id).press('Enter') }
    await node('a').focus()
    await node('a').press('Shift+F10')
    await page.getByRole('menuitem', { name: profile.language === 'ja' ? '構成を編集' : 'Edit configuration', exact: true }).click()
    const editor = page.locator('.object-editor')
    const name = editor.locator('input[name="name"]')
    const status = editor.locator('.configuration-edit-status:not(.configuration-section-status)')
    await expect(name).toHaveValue('Site A')
    await expect(status).toContainText(profile.language === 'ja' ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
    await expect(status).toContainText(profile.language === 'ja' ? 'クラウドへの保存は別の操作です。' : 'Cloud saving is separate.')
    await name.fill('')
    await expect(status).toContainText(profile.language === 'ja' ? '構成の入力内容を確認してください。' : 'Check configuration input.')
    await name.fill('Unsaved A')
    await expect(status).toContainText(profile.language === 'ja' ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
    await expect(status).not.toContainText(profile.language === 'ja' ? '構成の入力内容を確認してください。' : 'Check configuration input.')
    await choose('a')
    await expect(name).toHaveValue('Unsaved A')
    page.once('dialog', dialog => dialog.dismiss())
    await choose('b')
    await expect(name).toHaveValue('Unsaved A')
    expect(await read()).toEqual(topology)
    page.once('dialog', dialog => dialog.accept())
    await choose('b')
    await expect(name).toHaveValue('Site B')
    await expect(status).toContainText(profile.language === 'ja' ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
    await expect(editor.locator('input[name="asn"]')).toHaveValue('65002')
    expect(await read()).toEqual(topology)
    await choose('a')
    await expect(name).toHaveValue('Site A')
    await choose('hub')
    await expect(name).toHaveValue('Virtual hub')
    await expect(editor.locator('input[name="asn"]')).toHaveCount(0)
    await choose('er')
    await expect(name).toHaveValue('Circuit location')
    await expect(editor.locator('select[name="sku"]')).toHaveValue('Standard')
    await name.fill('Saved location')
    await editor.getByRole('button', { name: profile.language === 'ja' ? '変更を保存' : 'Save changes', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect((await read()).erLocations[0].name).toBe('Saved location')
    expect((await read()).sites).toEqual(topology.sites)
    await choose('a')
    await expect(editor).toHaveCount(0)
  })

  for (const mode of ['hub-spoke', 'full']) {
    test(`${mode}: configuration follows selection with saved and pending edits (${profile.preview}, ${profile.language})`, async ({ page }) => {
      await prepare(page, mode, nativeTopology(), profile)
      const ja = profile.language === 'ja'
      await page.getByTestId('aznet-select-vnet-a').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
      const scope = page.getByTestId('aznet-editor-scope-banner')
      const status = page.locator('.configuration-edit-status:not(.configuration-section-status)')
      await expect(scope).toContainText('Network A')
      await section(page, ja ? 'VNet の構成' : 'VNet configuration')
      await page.getByRole('textbox', { name: ja ? 'VNet 名 Network A' : 'VNet name Network A', exact: true }).fill('Saved network')
      await expect(status).toContainText(ja ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
      await select(page, 'aznet-select-vnet-b')
      await expect(scope).toContainText('Network B')
      await expect(page.getByTestId('aznet-vnet-config-a')).toHaveCount(0)
      await section(page, ja ? 'VNet の構成' : 'VNet configuration')
      await expect(page.getByRole('textbox', { name: ja ? 'VNet 名 Network B' : 'VNet name Network B', exact: true })).toHaveValue('Network B')
      await select(page, 'aznet-site-site')
      await expect(scope).toContainText('Branch')
      await expect(page.getByTestId('aznet-vnet-elements-editor')).toHaveCount(0)
      await select(page, 'aznet-erloc-er')
      await expect(scope).toContainText('Circuit location')
      await select(page, 'aznet-vwanhub-one')
      await expect(scope).toContainText('Hub one')
      await section(page, ja ? 'ハブ ルーティング テーブル' : 'Hub routing tables')
      const prefixes = page.getByLabel(ja ? 'プライベート ルーティング インテントのプレフィックス' : 'Private routing intent prefixes', { exact: true })
      await prefixes.fill('10.200.0.0/16')
      await expect(status).toContainText(ja ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
      if (profile.preview) {
        const summary = page.locator('.presentation-inspector-section > summary').filter({ hasText: ja ? 'ハブ ルーティング テーブル' : 'Hub routing tables' }).first()
        await summary.click()
        await expect(summary.locator('.configuration-section-status')).toContainText(ja ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
        await section(page, ja ? 'ハブ ルーティング テーブル' : 'Hub routing tables')
      }
      page.once('dialog', dialog => dialog.dismiss())
      await select(page, 'aznet-vwanhub-two')
      await expect(scope).toContainText('Hub one')
      await expect(prefixes).toHaveValue('10.200.0.0/16')
      page.once('dialog', dialog => dialog.accept())
      await select(page, 'aznet-vwanhub-two')
      await expect(scope).toContainText('Hub two')
      await section(page, ja ? 'ハブ ルーティング テーブル' : 'Hub routing tables')
      await expect(prefixes).toHaveValue('')
      await select(page, 'aznet-vwanhub-one')
      await section(page, ja ? 'ハブ ルーティング テーブル' : 'Hub routing tables')
      await expect(prefixes).toHaveValue('')
      await prefixes.fill('10.201.0.0/16')
      await page.getByRole('button', { name: ja ? 'プライベート ルーティング プレフィックスを保存' : 'Save private routing prefixes', exact: true }).click()
      await expect(status).toContainText(ja ? '未保存の構成編集はありません。' : 'No pending configuration edits.')
      await select(page, 'aznet-select-vnet-a')
      await expect(scope).toContainText('Saved network')
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
      expect(saved.vwanHubs[0].routingIntent.privatePrefixes).toEqual(['10.201.0.0/16'])
      expect(saved.vwanHubs[1].routingIntent.privatePrefixes).toBeUndefined()
      expect(saved.vnets[1].name).toBe('Network B')
    })
  }

}

test('full: explicit hybrid drafts are protected and saved changes do not prompt again', async ({ page }) => {
    const topology = nativeTopology()
    topology.vpnConnections = [{ id: 'vpn', name: 'Branch VPN', siteId: 'site', targetKind: 'vwan-hub',
      targetId: 'one', bgpEnabled: true, transport: 'VPN', enabled: true }]
    await prepare(page, 'full', topology)
    await page.getByTestId('aznet-vpnconn-vpn').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure VPN Connection', exact: true }).click()
    const scope = page.getByTestId('aznet-editor-scope-banner')
    const name = page.getByRole('textbox', { name: 'Connection name', exact: true })
    const status = page.locator('.configuration-edit-status:not(.configuration-section-status)')
    await expect(scope).toContainText('Branch VPN')
    await name.fill('Unsubmitted connection')
    await expect(status).toContainText('Unsaved configuration changes.')
    page.once('dialog', dialog => dialog.dismiss())
    await select(page, 'aznet-site-site')
    await expect(name).toHaveValue('Unsubmitted connection')
    await name.fill('Branch VPN')
    await page.getByRole('checkbox', { name: 'BGP enabled (required for SD-WAN)', exact: true }).uncheck()
    page.once('dialog', dialog => dialog.dismiss())
    await select(page, 'aznet-select-vnet-b')
    await expect(scope).toContainText('Branch VPN')
    await page.getByRole('button', { name: 'Save connection routing', exact: true }).click()
    await expect(status).toContainText('No pending configuration edits.')
    await select(page, 'aznet-site-site')
    await expect(scope).toContainText('Branch')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(saved.vpnConnections[0]).toMatchObject({ name: 'Branch VPN', bgpEnabled: false })
})

for (const profile of [profiles[0], profiles[2]]) test(`full: dual ER controls retain direction and imported values (${profile.language})`, async ({ page }) => {
  const topology = dualExpressRouteTopology()
  topology.erLinks.find((link) => link.id === 'azure-a')!.prepend = [64496]
  topology.erLinks.find((link) => link.id === 'site-a')!.weight = 10
  await prepare(page, 'full', topology, profile)
  const ja = profile.language === 'ja'
  const open = async (id: string, weight = false) => {
    await page.getByTestId(`aznet-erlink-${id}`).focus()
    await page.keyboard.press('Shift+F10')
    if (id === 'site-a') await expect(page.getByRole('menuitem', { name: 'Set Routing Weight', exact: true })).toHaveCount(0)
    if (weight) await page.getByRole('menuitem', { name: 'Set Routing Weight', exact: true }).click()
    else await page.getByRole('menuitem').filter({ hasText: 'Circuit A' }).click()
    return page.getByTestId('aznet-hybrid-connection-editor')
  }
  const save = async () => {
    await page.getByTestId('aznet-hybrid-connection-editor').getByRole('button', {
      name: ja ? '接続のルーティングを保存' : 'Save connection routing', exact: true,
    }).click()
  }
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  let editor = await open('azure-a', true)
  const weight = editor.getByRole('spinbutton', { name: ja ? 'Azure 接続のルーティング重み' : 'Azure connection routing weight' })
  await expect(editor.locator('input[name="inbound"]')).toHaveCount(0)
  await weight.fill('32001')
  await save()
  expect((await read()).erLinks.find((link: { id: string }) => link.id === 'azure-a').weight).toBe(0)
  await weight.fill('200')
  await save()
  expect((await read()).erLinks.find((link: { id: string }) => link.id === 'azure-a')).toMatchObject({ weight: 200, prepend: [64496] })
  editor = await open('site-a')
  await expect(editor.locator('input[name="weight"]')).toHaveCount(0)
  await editor.getByRole('textbox', { name: ja ? 'サイトから Azure への AS パス プリペンド' : 'Site-to-Azure AS-path prepend' }).fill('65010 65010 65010')
  await save()
  expect((await read()).erLinks.find((link: { id: string }) => link.id === 'site-a')).toMatchObject({
    weight: 10, prepend: [65010, 65010, 65010],
  })
  await page.reload()
  editor = await open('azure-a')
  await expect(editor.locator('input[name="weight"]')).toHaveValue('200')
})

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode}: rejected deferred configuration stays with its owner; valid blur saves before switching`, async ({ page }) => {
    const topology = nativeTopology()
    topology.inventory = { workloads: [{ id: 'vm', name: 'VM', nicIds: ['nic'] }], publicIps: [],
      nics: [{ id: 'nic', name: 'NIC', owner: { kind: 'vnet', id: 'a' }, ipConfigurations: [
        { id: 'ip', name: 'Primary', subnetId: 'work', privateIp: '10.0.1.4' },
      ] }] }
    await prepare(page, mode, topology)
    await page.getByTestId('aznet-select-vnet-a').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    await section(page, 'VNet configuration')
    const prefixes = page.getByRole('textbox', { name: 'VNet CIDR prefixes Network A', exact: true })
    const status = page.locator('.configuration-edit-status:not(.configuration-section-status)')
    await expect(prefixes.locator('..')).toContainText('Save on blur')
    await prefixes.fill('not-a-prefix')
    await expect(status).toContainText('Check configuration input.')
    await expect(status).toContainText('Unsaved configuration changes.')
    await prefixes.fill('10.8.0.0/16')
    page.once('dialog', dialog => dialog.dismiss())
    await select(page, 'aznet-select-vnet-b')
    await expect(page.getByTestId('aznet-editor-scope-banner')).toContainText('Network A')
    await expect(prefixes).toHaveValue('10.8.0.0/16')
    await prefixes.fill('10.0.0.0/15')
    await select(page, 'aznet-select-vnet-b')
    await expect(page.getByTestId('aznet-editor-scope-banner')).toContainText('Network B')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(saved.vnets[0].prefixes).toEqual(['10.0.0.0/15'])
    expect(saved.vnets[1].prefixes).toEqual(['10.4.0.0/16'])
    expect(saved.inventory).toEqual(topology.inventory)
  })
}
