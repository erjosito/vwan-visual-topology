import { expect, test, type Page } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import type { Topology } from '../src/model'

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
    if (topology.version === 1) localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
    else localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, { topology, profile })
  await page.goto(`/?mode=${mode}`)
  await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
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
    const status = editor.locator('.configuration-edit-status')
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
      await section(page, ja ? 'Virtual WAN ハブの構成' : 'Virtual WAN hub configuration')
      const prefixes = page.getByLabel(ja ? 'プライベート ルーティング インテントのプレフィックス' : 'Private routing intent prefixes', { exact: true })
      await prefixes.fill('10.200.0.0/16')
      await expect(status).toContainText(ja ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
      if (profile.preview) {
        const summary = page.locator('.presentation-inspector-section > summary').filter({ hasText: ja ? 'Virtual WAN ハブの構成' : 'Virtual WAN hub configuration' }).first()
        await summary.click()
        await expect(summary.locator('.configuration-section-status')).toContainText(ja ? '未保存の構成変更があります。' : 'Unsaved configuration changes.')
        await section(page, ja ? 'Virtual WAN ハブの構成' : 'Virtual WAN hub configuration')
      }
      page.once('dialog', dialog => dialog.dismiss())
      await select(page, 'aznet-vwanhub-two')
      await expect(scope).toContainText('Hub one')
      await expect(prefixes).toHaveValue('10.200.0.0/16')
      page.once('dialog', dialog => dialog.accept())
      await select(page, 'aznet-vwanhub-two')
      await expect(scope).toContainText('Hub two')
      await section(page, ja ? 'Virtual WAN ハブの構成' : 'Virtual WAN hub configuration')
      await expect(prefixes).toHaveValue('')
      await select(page, 'aznet-vwanhub-one')
      await section(page, ja ? 'Virtual WAN ハブの構成' : 'Virtual WAN hub configuration')
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
