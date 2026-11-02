import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { example } from '../src/model'

const languageKey = 'vwan-visual-topology:language:v1'
const topologyKey = 'vwan-visual-topology:v1'
const switchLanguage = (page: Page, language: 'en' | 'ja') => page.locator('header [data-language-selector]').selectOption(language)
async function action(page: Page, object: string, command: string) {
  await page.getByLabel(object, { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: command, exact: true }).click()
}
async function savedTopology(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), topologyKey)
}
test('English is the default; Japanese persists without changing topology or portable JSON', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle('Virtual WAN Topology Lab')
  const topology = structuredClone(example)
  topology.name = 'BGP table 日本語 {0}'
  await page.getByLabel('Import topology file').setInputFiles({
    name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
  })
  const saved = await savedTopology(page)
  await switchLanguage(page, 'ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page).toHaveTitle('Virtual WAN トポロジ ラボ')
  await expect(page.getByLabel('トポロジ名')).toHaveValue(topology.name)
  await expect(page.getByLabel('ハブ Europe hub を選択', { exact: true })).toBeVisible()
  expect(await savedTopology(page)).toBe(saved)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON をエクスポート', exact: true }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(JSON.parse(saved!))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  expect(await savedTopology(page)).toBe(saved)
  expect(await page.evaluate((key) => localStorage.getItem(key), languageKey)).toBe('ja')
})

test('live switching preserves unsaved configuration fields and localized validation errors', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select hub Europe hub', 'Edit configuration')
  const before = await savedTopology(page)
  await page.getByLabel('Name', { exact: true }).fill('Uncommitted BGP table 名前')
  await page.getByLabel('Private traffic routing intent', { exact: true }).check()
  await switchLanguage(page, 'ja')
  const editor = page.getByRole('dialog', { name: 'ハブ を編集', exact: true })
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('名前', { exact: true })).toHaveValue('Uncommitted BGP table 名前')
  await expect(editor.getByLabel('プライベート ルーティング インテント', { exact: true })).toBeChecked()
  expect(await savedTopology(page)).toBe(before)
  await editor.getByLabel('追加のプライベート トラフィック プレフィックス').fill('10.1.1.1/16')
  await editor.getByRole('button', { name: '変更を保存', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('無効な IPv4 ネットワーク CIDR: 10.1.1.1/16')
  await switchLanguage(page, 'en')
  await expect(page.getByRole('alert')).toContainText('Invalid IPv4 network CIDR: 10.1.1.1/16')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Uncommitted BGP table 名前')
  expect(await savedTopology(page)).toBe(before)
})

test('learned and advertised routes keep before/after semantics and filters on switch', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select hub Europe hub', 'Learned routes')
  await page.getByLabel('Filter by prefix').fill('10.20')
  await page.getByLabel('Route-map stage').selectOption('before')
  await switchLanguage(page, 'ja')
  await expect(page.getByRole('dialog', { name: '学習したルート · Europe hub', exact: true })).toBeVisible()
  await expect(page.getByLabel('プレフィックスで絞り込み')).toHaveValue('10.20')
  await expect(page.getByLabel('ルート マップの適用段階')).toHaveValue('before')
  await expect(page.getByLabel('ルート マップの適用段階').locator('option:checked')).toHaveText('インバウンド ルート マップの適用前')
  await expect(page.getByRole('columnheader', { name: 'ネイバー / 生成元', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '学習したルート · Europe hub を閉じる', exact: true }).click()
  await action(page, 'ハブ Europe hub を選択', 'アドバタイズしたルート')
  await expect(page.getByLabel('ルート マップの適用段階').locator('option:checked')).toHaveText('アウトバウンド ルート マップの適用後')
  await page.getByLabel('プレフィックスで絞り込み').fill('not-a-prefix')
  await expect(page.getByText('現在のフィルターに一致するルートはありません。')).toBeVisible()
})

test('Japanese cascading path menus and explanations preserve selected paths when switched', async ({ page }) => {
  await page.goto('/')
  await switchLanguage(page, 'ja')
  await action(page, 'スポーク Europe applications を選択', '次へのパスを表示')
  await page.getByRole('menu', { name: '次へのパスを表示', exact: true })
    .getByRole('menuitem', { name: 'Americas applications (スポーク)', exact: true }).click()
  await page.getByRole('menu', { name: 'Americas applications (スポーク)', exact: true })
    .getByRole('menuitem', { name: '10.2.0.0/16', exact: true }).click()
  await expect(page.locator('.highlight-status')).toContainText('到達可能')
  const paths = await page.locator('.path-flow').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-segments')))
  await page.getByRole('button', { name: 'パスの詳細', exact: true }).click()
  await page.getByText('このパスが選ばれた理由', { exact: true }).click()
  await expect(page.locator('.flow-results ol')).toContainText('最長プレフィックス一致 (LPM)')
  await expect(page.locator('.flow-results ol')).not.toContainText('Shortest learned')
  await switchLanguage(page, 'en')
  await expect(page.locator('.highlight-status')).toContainText('Reachable')
  expect(await page.locator('.path-flow').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-segments')))).toEqual(paths)
  await expect(page.locator('.flow-results details')).toHaveAttribute('open', '')
})

test('Japanese on-premises path steps translate outer lookups and nested transport-selection reasons', async ({ page }) => {
  await page.goto('/')
  await switchLanguage(page, 'ja')
  await action(page, 'スポーク Europe applications を選択', '次へのパスを表示')
  await page.getByRole('menu', { name: '次へのパスを表示', exact: true })
    .getByRole('menuitem', { name: 'London datacenter (サイト)', exact: true }).click()
  await page.getByRole('menu', { name: 'London datacenter (サイト)', exact: true })
    .getByRole('menuitem', { name: '10.20.0.0/16', exact: true }).click()
  await page.getByRole('button', { name: 'パスの詳細', exact: true }).click()
  await page.getByText('このパスが選ばれた理由', { exact: true }).click()
  const firstStep = page.locator('.flow-results ol li').first()
  await expect(firstStep).toContainText('Europe hub: 最長プレフィックス一致 (LPM) 10.20.0.0/16')
  await expect(firstStep).toContainText('ExpressRoute と S2S VPN の比較では ExpressRoute が優先されます。')
  await expect(firstStep).not.toContainText('longest prefix')
  await expect(firstStep).not.toContainText('Local connections')
  await switchLanguage(page, 'en')
  await expect(firstStep).toContainText('Europe hub: longest prefix 10.20.0.0/16.')
  await expect(firstStep).toContainText('ExpressRoute wins the ExpressRoute versus S2S VPN comparison.')
})

test('route-map drafts and rule fields stay intact while all policy terminology switches', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Route maps', exact: true }).click()
  await page.getByRole('button', { name: 'Create route map', exact: true }).click()
  await page.getByLabel('Route map name', { exact: true }).fill('Custom Prefix Map')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 1 prefixes', { exact: true }).fill('10.20.0.0/16')
  await page.getByLabel('Rule 1 action', { exact: true }).selectOption('prepend')
  await page.getByLabel('Rule 1 prepend ASNs', { exact: true }).fill('12345 12345')
  await switchLanguage(page, 'ja')
  await expect(page.getByLabel('ルート マップ名', { exact: true })).toHaveValue('Custom Prefix Map')
  await expect(page.getByLabel('規則 1 のプレフィックス', { exact: true })).toHaveValue('10.20.0.0/16')
  await expect(page.getByLabel('規則 1 のプリペンド ASN', { exact: true })).toHaveValue('12345 12345')
  await page.getByRole('button', { name: 'ルート マップを保存', exact: true }).click()
  await expect(page.getByRole('button', { name: /Custom Prefix Map/ })).toBeVisible()
  await expect(page.getByLabel('インバウンド ルート マップ')).toBeVisible()
  await expect(page.getByLabel('アウトバウンド ルート マップ')).toBeVisible()
})

test('Azure file validation and model warnings are localized while Bicep code remains source code', async ({ page }) => {
  await page.goto('/')
  await switchLanguage(page, 'ja')
  await page.getByRole('button', { name: 'モデルの注記と警告を開く', exact: true }).click()
  await expect(page.getByText('Azure コントロール プレーンではなく計画用モデル', { exact: true })).toBeVisible()
  await expect(page.locator('.model-notes .notice').first()).not.toContainText('Route maps model')
  await page.getByRole('button', { name: 'モデルの注記と警告 を閉じる', exact: true }).click()
  await page.getByRole('button', { name: 'Azure ファイル', exact: true }).click()
  await expect(page.getByText('Azure コレクターをダウンロード', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Bicep エクスポートを確認', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('IPv4 ネットワーク CIDR')
  await page.getByLabel('Europe hub のインフラストラクチャ CIDR', { exact: true }).fill('10.240.0.0/23')
  await page.getByLabel('Americas hub のインフラストラクチャ CIDR', { exact: true }).fill('10.242.0.0/23')
  await page.getByRole('button', { name: 'Bicep エクスポートを確認', exact: true }).click()
  await page.getByText('生成された Bicep', { exact: true }).click()
  await expect(page.locator('pre').last()).toContainText('Microsoft.Network/virtualWans')
  await expect(page.locator('pre').last()).not.toContainText('ルート')
})

test('feedback switches inside its modal without losing consent, text, failure or success states', async ({ page }) => {
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await page.getByLabel('Summary', { exact: true }).fill('BGP table 日本語 draft')
  await page.getByLabel('Description', { exact: true }).fill('日本語'.repeat(1200))
  await page.getByLabel('I agree to open this report in the public GitHub feedback repository without confidential data.').check()
  const modal = page.getByRole('dialog')
  await modal.locator('[data-language-selector]').selectOption('ja')
  await expect(page.getByLabel('概要', { exact: true })).toHaveValue('BGP table 日本語 draft')
  await expect(page.getByLabel('機密データを含めずに、この報告を公開の GitHub フィードバック リポジトリで開くことに同意します。')).toBeChecked()
  await expect(page.locator('#feedback-privacy')).toContainText('機密情報を含めないでください')
  await page.getByRole('button', { name: 'GitHub で Issue を開く', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('事前入力された GitHub Issue URL にはフィードバックが長すぎます。')
  await modal.locator('[data-language-selector]').selectOption('en')
  await expect(page.getByRole('alert')).toContainText('Feedback is too long for a pre-filled GitHub issue URL.')
  await page.getByLabel('Description', { exact: true }).fill('Keep the user-provided English description and 日本語 unchanged.')
  await modal.locator('[data-language-selector]').selectOption('ja')
  await expect(page.getByLabel('説明', { exact: true })).toHaveValue('Keep the user-provided English description and 日本語 unchanged.')
  await page.getByRole('button', { name: 'GitHub で Issue を開く', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub 用のフィードバックを準備しました。受付番号:')
})

test('unsupported or unavailable browser storage safely falls back and still allows switching', async ({ page }) => {
  await page.addInitScript((key) => { localStorage.setItem(key, 'unsupported') }, languageKey)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.evaluate(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    Storage.prototype.setItem = () => { throw new Error('blocked') }
  })
  await switchLanguage(page, 'ja')
  await expect(page.getByRole('button', { name: 'JSON をエクスポート', exact: true })).toBeVisible()
  await switchLanguage(page, 'en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('VPN conversion review and site-owned static routing remain editable across language changes', async ({ page }) => {
  await page.goto('/')
  await switchLanguage(page, 'ja')
  await action(page, '接続 London backup を編集', '静的ルーティングに変更')
  await expect(page.getByRole('dialog')).toHaveAccessibleName('VPN を 静的 に変更 · London backup')
  await page.getByLabel('静的宛先プレフィックス').fill('10.20.0.0/16\n10.80.0.0/16')
  await page.getByRole('button', { name: 'ルーティングの変更を確認', exact: true }).click()
  await expect(page.getByRole('table', { name: '確認済みの静的宛先' })).toContainText('10.80.0.0/16')
  await switchLanguage(page, 'en')
  await expect(page.getByRole('table', { name: 'Reviewed static destinations' })).toContainText('10.80.0.0/16')
  await page.getByRole('button', { name: 'Apply static routing', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('VPN routing changed to static')
  await switchLanguage(page, 'ja')
  await expect(page.getByRole('status')).toContainText('VPN ルーティングの変更先: 静的')
  await page.getByRole('button', { name: '完了', exact: true }).click()
  await action(page, 'サイト London datacenter を選択', '静的ルーティング')
  await page.getByLabel('静的ルーティングの VPN 接続').selectOption('vpn-eu')
  await expect(page.getByLabel('サイト VPN 静的プレフィックス')).toHaveValue('10.20.0.0/16\n10.80.0.0/16')
  const saved = await savedTopology(page)
  await page.getByLabel('サイト VPN 静的プレフィックス').fill('10.90.0.0/16')
  await switchLanguage(page, 'en')
  await expect(page.getByLabel('Site VPN static prefixes')).toHaveValue('10.90.0.0/16')
  expect(await savedTopology(page)).toBe(saved)
})

test('Japanese Azure import review keeps names and source warnings intact in JSON', async ({ page }) => {
  await page.goto('/')
  const base = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network'
  const capture = {
    kind: 'azure-vwan-capture', version: 1, collectorVersion: '1', capturedAt: '2026-10-30T12:00:00Z', complete: true, warnings: [],
    wan: { id: `${base}/virtualWans/wan`, name: 'Original WAN 名前', type: 'Standard', allowBranchToBranchTraffic: true, allowVnetToVnetTraffic: true },
    hubs: [{
      id: `${base}/virtualHubs/west`, name: 'BGP table Hub', location: 'westeurope', virtualWanId: `${base}/virtualWans/wan`,
      addressPrefix: '10.250.0.0/23', hubRoutingPreference: 'VpnGateway',
      unsupportedFeatures: ['Azure route maps are not reconstructed.', 'Unknown external warning'],
      routingPolicies: [], gatewayTypes: [],
      connections: [{ name: 'Application VNet', virtualNetworkId: `${base}/virtualNetworks/app`, addressPrefixes: ['10.20.0.0/16'], defaultRouting: true }],
    }],
  }
  await page.getByLabel('Import topology file').setInputFiles({
    name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)),
  })
  await page.getByLabel('I understand this is a structure-only import, not verified Azure routing.').check()
  await switchLanguage(page, 'ja')
  await expect(page.getByRole('heading', { name: 'Azure の取得データを確認', exact: true })).toBeVisible()
  await expect(page.getByText('BGP table Hub: Azure ルート マップは再構築しません。', { exact: true })).toBeVisible()
  await expect(page.getByText('BGP table Hub: Unknown external warning', { exact: true })).toBeVisible()
  await expect(page.getByLabel('これは構造のみのインポートであり、検証済みの Azure ルーティングではないことを理解しました。')).toBeChecked()
  await page.getByRole('button', { name: 'Azure の取得データでワークスペースを置換', exact: true }).click()
  await expect(page.getByLabel('トポロジ名')).toHaveValue('Original WAN 名前')
  const saved = JSON.parse((await savedTopology(page))!)
  expect(saved.hubs[0].name).toBe('BGP table Hub')
  expect(saved.azureImport.warnings).toContain('BGP table Hub: Azure route maps are not reconstructed.')
  expect(saved.azureImport.warnings).not.toContain('BGP table Hub: Azure ルート マップは再構築しません。')
})

test('Japanese parser errors and offline feedback remain accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await switchLanguage(page, 'ja')
  const saved = await savedTopology(page)
  await page.getByLabel('トポロジ ファイルをインポート').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid JSON'),
  })
  await expect(page.getByRole('alert')).toContainText('インポートを拒否しました: JSON が無効です。ファイルの構文を確認してください。')
  expect(await savedTopology(page)).toBe(saved)
  await page.getByRole('button', { name: 'フィードバック', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'フィードバックを送信', exact: true })
  await expect(modal.getByRole('link', { name: '公開フィードバックを参照', exact: true })).toBeVisible()
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect(modal.locator('[data-language-selector]')).toBeVisible()
  await modal.locator('[data-language-selector]').selectOption('en')
  await expect(page.getByRole('dialog', { name: 'Send feedback', exact: true }).getByRole('link', { name: 'Browse public feedback', exact: true })).toBeVisible()
})

test('Interactive documentation supports English and Japanese and syncs with simulator language preference', async ({ page }) => {
  await page.goto('/docs/index.html?lang=ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByRole('heading', { name: 'Virtual WAN トポロジ ラボ — ドキュメント', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. 概要と主な概念', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. Overview & Key Concepts', exact: true })).toBeHidden()
  expect(await page.evaluate((key) => localStorage.getItem(key), languageKey)).toBe('ja')

  await page.locator('header [data-language-selector]').selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Virtual WAN Topology Lab — Documentation', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. Overview & Key Concepts', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. 概要と主な概念', exact: true })).toBeHidden()
  expect(await page.evaluate((key) => localStorage.getItem(key), languageKey)).toBe('en')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://vwan-simulator.com/og-image.png')
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')

  await page.goto('/')
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Virtual WAN Topology Lab/)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://vwan-simulator.com/og-image.png')
  const ogImgResp = await page.request.get('/og-image.png')
  expect(ogImgResp.status()).toBe(200)
  expect(ogImgResp.headers()['content-type']).toContain('image/png')
})


