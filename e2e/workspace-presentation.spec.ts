import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const mode of ['vwan', 'full'] as const) {
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
  const sample = mode === 'vwan' ? 'hub-routing-preferences' : 'hub-spoke-firewall-udr'
  const rootId = mode === 'vwan' ? 'vwan-app' : 'aznet-app'

  test(`${mode}: preview preserves the selected design and history while exposing every VNet action`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
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
    await expect(page.getByRole('button', { name: mode === 'full' ? /Advanced checks/ : 'Open model notes and warnings' })).toBeVisible()
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
      const settings = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: 'Settings & help' }) })
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
  await expect(toggle).toHaveText('UI プレビュー')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.presentation-group > summary').filter({ hasText: 'ファイル' })).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
})
