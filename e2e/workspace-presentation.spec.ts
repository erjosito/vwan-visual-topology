import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyAzNetTopology, type AzNetTopology } from '../src/azure-net/model'
import { vpnGatewayModeTopology } from '../tests/fixtures/vpn-gateway-mode'

test.use({ storageState: { cookies: [], origins: [] } })

async function openVnetConfiguration(page: Page, mode: string, topology: AzNetTopology) {
  await page.goto(`/?mode=${mode}`)
  await page.locator('input[data-desktop-import]').setInputFiles({
    name: 'inspector.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
  })
  await page.getByTestId('aznet-diagram-svg').getByRole('button', { name: /^VNet / }).first().focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
}

for (const mode of ['hub-spoke', 'full']) {
  for (const language of ['en', 'ja']) {
    test(`${mode}: ${language} VNet inspector groups optional tasks without losing deferred edits`, async ({ page }, info) => {
      await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
      await page.addInitScript(language => {
        localStorage.setItem('vwan-visual-topology:language:v1', language)
        localStorage.setItem('aznet-theme', language === 'ja' ? 'dark' : 'light')
      }, language)
      const topology = createEmptyAzNetTopology()
      topology.vnets = [{ id: 'hub', name: 'Simple VNet', role: 'hub', region: 'westeurope', prefixes: ['10.0.0.0/16'],
        subnets: [{ id: 'app', name: 'Application', prefix: '10.0.1.0/24' }], gateways: [], appliances: [] }]
      await openVnetConfiguration(page, mode, topology)
      const card = page.getByTestId('aznet-vnet-config-hub')
      const before = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
      const advertisements = card.locator('.presentation-inspector-section').filter({
        has: page.locator('summary', { hasText: language === 'ja' ? 'ゲートウェイの経路アドバタイズ' : 'Gateway route advertisements' }),
      })
      const devices = card.locator('.presentation-inspector-section').filter({
        has: page.locator('summary', { hasText: language === 'ja' ? 'ルーティング デバイスの追加と削除' : 'Add or remove routing devices' }),
      })
      await expect(card.getByRole('textbox', { name: language === 'ja' ? 'VNet 名 Simple VNet' : 'VNet name Simple VNet', exact: true })).toBeVisible()
      await expect(card.getByTestId('aznet-vnet-region-hub')).toBeVisible()
      await expect(advertisements).not.toHaveAttribute('open')
      await expect(devices).not.toHaveAttribute('open')
      await expect(advertisements.getByRole('textbox')).not.toBeVisible()
      const groupedCount = await card.locator('button:visible, input:visible, select:visible').count()
      await info.attach('grouped-inspector', { body: await page.screenshot({ path: info.outputPath('grouped-inspector.png') }), contentType: 'image/png' })
      expect((await new AxeBuilder({ page }).include('[data-testid="aznet-vnet-config-hub"]').analyze()).violations).toEqual([])
      await advertisements.locator('summary').focus()
      await page.keyboard.press('Enter')
      const draft = advertisements.getByRole('textbox')
      await draft.fill('10.0.0.0/8')
      const toggle = page.getByTestId('ui-preview-toggle')
      // Avoid blur so this checks an uncommitted editor draft, not just saved JSON.
      await toggle.dispatchEvent('click')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(draft).toHaveValue('10.0.0.0/8')
      await expect(card.getByTestId('aznet-add-fw-hub')).toBeVisible()
      const legacyCount = await card.locator('button:visible, input:visible, select:visible').count()
      expect(groupedCount).toBeLessThan(legacyCount)
      await info.attach('inspector-control-counts', { body: JSON.stringify({ mode, language, groupedCount, legacyCount }), contentType: 'application/json' })
      await info.attach('legacy-inspector', { body: await page.screenshot({ path: info.outputPath('legacy-inspector.png') }), contentType: 'image/png' })
      expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
      await toggle.dispatchEvent('click')
      await expect(draft).toHaveValue('10.0.0.0/8')
      await draft.press('Tab')
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].summarizedGatewayPrefixes)).toEqual(['10.0.0.0/8'])
      await page.getByRole('button', { name: /Undo/ }).click()
      await expect.poll(() => page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
      await devices.locator('summary').focus()
      await page.keyboard.press('Enter')
      await card.getByTestId('aznet-add-fw-hub').click()
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].appliances.length)).toBe(1)
      await page.getByRole('button', { name: /Undo/ }).click()
      await expect.poll(() => page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })

    test(`${mode}: ${language} imported VNet settings expand and keep warnings outside disclosure`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.addInitScript(language => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
      const topology = vpnGatewayModeTopology()
      topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/8']
      topology.vnets[0].gateways[0].activeActive = false
      await openVnetConfiguration(page, mode, topology)
      const card = page.getByTestId('aznet-vnet-config-hub')
      const before = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
      await expect(card.locator('.presentation-inspector-section[open]')).toHaveCount(2)
      await expect(card.getByRole('textbox', { name: 'Advertised gateway prefixes VPN mode hub', exact: true })).toHaveValue('10.0.0.0/8')
      for (const summary of await card.locator('.presentation-inspector-section > summary').all()) await summary.click()
      await expect(card.locator('.presentation-inspector-section[open]')).toHaveCount(0)
      const vpn = page.getByTestId('vpn-gateway-settings-vpn')
      await expect(vpn.getByRole('combobox')).toBeVisible()
      await expect(vpn).toContainText(language === 'ja' ? 'アクティブ/アクティブ' : 'ARS route exchange requires')
      await expect(card.getByRole('combobox', { name: 'ARS Hub Routing Preference', exact: true })).toHaveValue('ASPath')
      expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
      expect((await new AxeBuilder({ page }).include('[data-testid="aznet-vnet-config-hub"]').analyze()).violations).toEqual([])
    })
  }
}

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  for (const width of [390, 1440]) {
    test(`${mode}: account and belt stay visible at the top right at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/?mode=${mode}`)
      const status = page.getByTestId('learning-status')
      await expect(status).toContainText('Not signed in')
      await expect(status).toContainText('White belt')
      await expect(status).toHaveAttribute('aria-description', /Highest belt across tracks: White belt.*Tracks at this belt: 1/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const bounds = (await page.locator('.workspace-account-status').boundingBox())!
      const header = (await page.locator('header').boundingBox())!
      expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(header.x + header.width - 16)
      expect(bounds.y).toBeLessThanOrEqual(header.y + 12)
      await status.click()
      await expect(page.getByTestId('learning-status-details')).toBeVisible()
      await page.getByRole('button', { name: 'Close learning status', exact: true }).click()
      await expect(status).toBeFocused()
    })
  }
}

for (const mode of ['vwan', 'full'] as const) {
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
  const sample = mode === 'vwan' ? 'hub-routing-preferences' : 'hub-spoke-firewall-udr'
  const rootId = mode === 'vwan' ? 'vwan-app' : 'aznet-app'

  test(`${mode}: preview preserves the selected design and history while exposing every VNet action`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.addInitScript(() => {
      if (localStorage.getItem('aznet-ui-preview:v1') === null) localStorage.setItem('aznet-ui-preview:v1', 'false')
    })
    await page.goto(`/?mode=${mode}&sample=${sample}`)
    await expect(page.getByTestId(rootId)).toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
    const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
    const imported = mode === 'full' ? saved.topology : saved
    await page.locator('input[data-desktop-import]').setInputFiles({
      name: 'advanced-design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
    })
    const node = mode === 'vwan' ? page.getByRole('button', { name: /^Select spoke / }).first()
      : page.getByTestId('aznet-diagram-svg').getByRole('button', { name: /^VNet / }).first()
    await node.focus()
    await node.press('Enter')
    const selected = await node.getAttribute('aria-pressed')
    const original = await page.evaluate((key) => localStorage.getItem(key), key)
    const history = await page.getByRole('button', { name: /Undo/ }).isEnabled()
    await info.attach('current-presentation', { body: await page.screenshot(), contentType: 'image/png' })
    await node.press('Shift+F10')
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const originalActions = await menu.getByRole('menuitem').allTextContents()
    await page.keyboard.press('Escape')
    const toggle = page.getByTestId('ui-preview-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await node.getAttribute('aria-pressed')).toBe(selected)
    expect(await page.getByRole('button', { name: /Undo/ }).isEnabled()).toBe(history)
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await info.attach('preview-presentation', { body: await page.screenshot(), contentType: 'image/png' })
    await node.focus()
    await node.press('Shift+F10')
    await expect(menu.getByRole('menuitem', { name: 'All VNet actions', exact: true })).toBeVisible()
    expect(await menu.getByRole('menuitem').count()).toBeLessThan(originalActions.length)
    await menu.getByRole('menuitem', { name: 'All VNet actions', exact: true }).click()
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    const search = tools.getByRole('searchbox')
    await expect(search).toBeFocused()
    for (const label of originalActions) {
      await search.fill(label)
      await expect(tools.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await search.fill('no-command-matches')
    await page.keyboard.press('Escape')
    await node.focus()
    await node.press('Shift+F10')
    await menu.getByRole('menuitem', { name: 'All VNet actions', exact: true }).click()
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await search.fill(mode === 'vwan' ? 'Edit configuration' : 'Configure VNet & Elements')
    await tools.getByRole('button', { name: mode === 'vwan' ? 'Edit configuration' : 'Configure VNet & Elements', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: /Close/ }).first().click()
    await page.keyboard.press('Escape')
    const file = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^File$/ }) })
    await file.locator('summary').click()
    const download = page.waitForEvent('download')
    await file.getByRole('button', { name: /Export JSON/ }).click()
    await download
    await expect(file).not.toHaveAttribute('open')
    await expect(file.locator('summary')).toBeFocused()
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    if (mode === 'full') {
      const checks = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^Routing checks$/ }) })
      await checks.locator('summary').click()
      await expect(checks.getByRole('button', { name: /Advanced checks/ })).toBeVisible()
      await page.keyboard.press('Escape')
    } else await expect(page.getByRole('button', { name: 'Open model notes and warnings' })).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(await node.getAttribute('aria-pressed')).toBe(selected)
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await node.focus()
    await node.press('Alt+ArrowRight')
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBe(original)
    const moved = await page.evaluate((key) => localStorage.getItem(key), key)
    await toggle.click()
    await page.getByRole('button', { name: /Undo/ }).click()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await page.getByRole('button', { name: /Redo/ }).click()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBe(moved)
    await page.getByRole('button', { name: /Undo/ }).click()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
  })

  test.describe(`${mode}: touch presentation`, () => {
  test.use({ hasTouch: true })
  for (const theme of ['light', 'dark']) {
    test(`${mode}: ${theme} narrow preview menus support touch, keyboard and visible dismissal`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 800 })
      await page.addInitScript((theme) => {
        localStorage.setItem('aznet-theme', theme)
        localStorage.setItem('aznet-ui-preview:v1', 'true')
      }, theme)
      await page.goto(`/?mode=${mode}`)
      await expect(page.getByTestId(rootId)).toBeVisible()
      await expect(page.getByTestId('ui-preview-toggle')).toHaveAttribute('aria-pressed', 'true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const settings = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^Settings$/ }) })
      const summary = settings.locator('summary')
      await summary.tap()
      await expect(settings.getByRole('combobox', { name: 'Theme', exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).include('.presentation-group[open]').analyze()).violations).toEqual([])
      const bounds = (await settings.locator('.presentation-group-content').boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      await settings.getByRole('button', { name: 'Close', exact: true }).tap()
      await expect(settings).not.toHaveAttribute('open')
      await expect(summary).toBeFocused()
      await summary.press('Enter')
      await settings.getByRole('combobox', { name: 'Theme', exact: true }).focus()
      await page.keyboard.press('Escape')
      await expect(summary).toBeFocused()
      await expect(settings).not.toHaveAttribute('open')
      const explore = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^Explore$/ }) })
      await explore.locator('summary').tap()
      await explore.getByRole('button', { name: 'Sample topologies', exact: true }).tap()
      await expect(explore).not.toHaveAttribute('open')
      await expect(page.getByRole('dialog')).toBeVisible()
      await info.attach('narrow-preview', { body: await page.screenshot(), contentType: 'image/png' })
    })
  }
  })
}

test('Japanese preview and unavailable preference storage remain usable in-session', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vwan-visual-topology:language:v1', 'ja')
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key === 'aznet-ui-preview:v1') throw new DOMException('Unavailable', 'SecurityError')
      return get.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'aznet-ui-preview:v1') throw new DOMException('Unavailable', 'QuotaExceededError')
      set.call(this, key, value)
    }
  })
  await page.goto('/?mode=full')
  const toggle = page.getByTestId('ui-preview-toggle')
  await expect(toggle).toHaveText('従来の UI を使用')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveText('新しい UI を使用')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.presentation-group > summary').filter({ hasText: 'ファイル' })).toBeVisible()
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  for (const preference of [null, 'false', 'true', 'invalid']) {
    test(`${mode}: presentation default and saved preference ${preference}`, async ({ page }) => {
      if (preference !== null) await page.addInitScript(value => {
        localStorage.setItem('aznet-ui-preview:v1', value)
      }, preference)
      await page.goto(`/?mode=${mode}`)
      const toggle = page.getByTestId('ui-preview-toggle')
      const enabled = preference !== 'false'
      await expect(toggle).toHaveAttribute('aria-pressed', String(enabled))
      await expect(toggle).toHaveText(enabled ? 'Use legacy UI' : 'Use new UI')
      await expect(page.locator('.presentation-group > summary').filter({ hasText: /^File$/ })).toHaveCount(enabled ? 1 : 0)
    })
  }
}

test('default UI can switch to legacy with keyboard and persist across reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/?mode=full')
  const toggle = page.getByTestId('ui-preview-toggle')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  for (const language of ['en', 'ja']) {
    test(`${mode}: ${language} settings persist outside canvas controls and help opens local docs`, async ({ page, context }) => {
      await page.setViewportSize({ width: 390, height: 900 })
      await page.addInitScript(language => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
      const sample = mode === 'vwan' ? 'hub-routing-preferences' : 'hub-spoke-firewall-udr'
      await page.goto(`/?mode=${mode}&sample=${sample}`)
      const settings = page.locator('.presentation-group').filter({
        has: page.locator('summary', { hasText: language === 'ja' ? /^設定$/ : /^Settings$/ }),
      })
      const help = page.locator('.presentation-group').filter({
        has: page.locator('summary', { hasText: language === 'ja' ? /^ヘルプとフィードバック$/ : /^Help & feedback$/ }),
      })
      const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).not.toBeNull()
      const before = await page.evaluate(key => localStorage.getItem(key), key)
      const controls = page.getByRole('group', { name: language === 'ja' ? 'キャンバス コントロール' : 'Canvas controls' })
      await expect(controls.locator('select')).toHaveCount(mode === 'vwan' ? 2 : 1)
      await settings.locator('summary').click()
      const background = settings.getByRole('combobox', { name: language === 'ja' ? 'キャンバスのスタイル' : 'Canvas style', exact: true })
      const connections = settings.getByRole('combobox', { name: language === 'ja' ? '接続線のスタイル' : 'Connection style', exact: true })
      await background.selectOption('dots')
      await connections.selectOption('straight')
      await expect(page.locator('.simulator-shell')).toHaveAttribute('data-canvas-style', 'dots')
      expect((await new AxeBuilder({ page }).include('.presentation-group[open]').analyze()).violations).toEqual([])
      await page.keyboard.press('Escape')
      await expect(settings.locator('summary')).toBeFocused()
      await page.reload()
      await settings.locator('summary').click()
      await expect(background).toHaveValue('dots')
      await expect(connections).toHaveValue('straight')
      await page.keyboard.press('Escape')
      await help.locator('summary').click()
      await expect(settings).not.toHaveAttribute('open')
      expect((await new AxeBuilder({ page }).include('.presentation-group[open]').analyze()).violations).toEqual([])
      const pending = context.waitForEvent('page')
      await help.getByRole('button', { name: language === 'ja' ? 'ドキュメント' : 'Docs', exact: true }).click()
      const docs = await pending
      await docs.waitForLoadState()
      expect(new URL(docs.url()).pathname).toBe('/docs/index.html')
      expect(new URL(docs.url()).searchParams.get('lang')).toBe(language === 'ja' ? 'ja' : null)
      await expect(docs.getByRole('heading', { level: 1 })).toBeVisible()
      await docs.close()
      await expect(help).not.toHaveAttribute('open')
      await help.locator('summary').click()
      await help.getByRole('button', { name: language === 'ja' ? 'フィードバック' : 'Feedback', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before)
      await page.getByTestId('ui-preview-toggle').click()
      await expect(page.getByRole('combobox', { name: language === 'ja' ? 'キャンバスのスタイル' : 'Canvas style', exact: true })).toHaveValue('dots')
      await expect(page.getByRole('combobox', { name: language === 'ja' ? '接続線のスタイル' : 'Connection style', exact: true })).toHaveValue('straight')
    })

    test(`${mode}: ${language} routing checks share an accessible menu without hiding results`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 })
      await page.addInitScript(language => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
      const sample = mode === 'vwan' ? 'hub-routing-preferences' : 'hub-spoke-firewall-udr'
      await page.goto(`/?mode=${mode}&sample=${sample}`)
      const checks = page.locator('.presentation-group').filter({
        has: page.locator('summary', { hasText: language === 'ja' ? /^ルーティングの確認$/ : /^Routing checks$/ }),
      })
      const summary = checks.locator('summary')
      await summary.focus()
      await page.keyboard.press('Enter')
      const run = checks.getByRole('button', { name: language === 'ja' ? 'ルーティングを診断' : 'Check routing', exact: true })
      const advanced = checks.getByRole('button', { name: language === 'ja' ? /詳細な診断/ : /Advanced checks/ })
      await expect(run).toBeVisible()
      await expect(advanced).toBeVisible()
      expect((await new AxeBuilder({ page }).include('.presentation-group[open]').analyze()).violations).toEqual([])
      const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      const before = await page.evaluate(key => localStorage.getItem(key), key)
      await run.click()
      await expect(checks).not.toHaveAttribute('open')
      await expect(summary).toBeFocused()
      const status = page.locator(mode === 'vwan' ? '.routing-check-status' : '[data-testid="aznet-routing-check-status"]')
      await expect(status).toBeVisible()
      await expect(status).not.toContainText(language === 'ja' ? '確認中' : 'Checking all modeled networks', { timeout: 30000 })
      await summary.click()
      await advanced.click()
      await expect(checks).not.toHaveAttribute('open')
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}
