import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const modes = [
  { mode: 'vwan', prefix: 'vwan', sample: 'hub-routing-preferences', other: 'default-example', key: 'vwan-visual-topology:v1', file: '/docs/samples/hub-routing-preferences.json' },
  { mode: 'hub-spoke', prefix: 'aznet', sample: 'uc1-hub-spoke-nva-ars-baseline', other: 'hub-spoke-firewall-udr', key: 'aznet-visual-topology:v1', file: '/docs/samples/azure-net/uc1-hub-spoke-nva-ars-baseline.json' },
  { mode: 'full', prefix: 'aznet', sample: 'uc1-hub-spoke-nva-ars-baseline', other: 'hybrid-vwan-and-hub-spoke', key: 'aznet-visual-topology:v1', file: '/docs/samples/azure-net/uc1-hub-spoke-nva-ars-baseline.json' },
] as const

for (const entry of modes) {
  test(`${entry.mode}: shared search, keyboard focus, replacement backup/cancel and saved sample`, async ({ page }) => {
    await page.goto(`/?mode=${entry.mode}`)
    await expect(page.getByTestId(entry.mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    const opener = page.getByRole('button', { name: 'Sample topologies', exact: true })
    await opener.click()
    const gallery = page.getByTestId(`${entry.prefix}-sample-gallery-modal`)
    const search = gallery.getByRole('searchbox', { name: 'Search samples', exact: true })
    await expect(search).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    expect(await gallery.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await search.fill('nothing-matches-this-sample')
    await expect(gallery).toContainText('No samples match your search.')
    await page.keyboard.press('Escape')
    await expect(gallery).toHaveCount(0)
    await expect(opener).toBeFocused()

    await opener.click()
    await search.fill(entry.sample)
    await expect(gallery.locator('article')).toHaveCount(1)
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.sample}`).click()
    await expect(gallery).toHaveCount(0)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), entry.key)).not.toBeNull()
    const original = await page.evaluate((key) => localStorage.getItem(key), entry.key)
    await opener.click()
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.other}`).click()
    await expect(gallery.getByRole('region', { name: 'Replace current workspace', exact: true })).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), entry.key)).toBe(original)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      gallery.getByRole('button', { name: 'Export JSON', exact: true }).click(),
    ])
    const path = await download.path()
    const savedDocument = JSON.parse(original!)
    expect(JSON.parse(await readFile(path!, 'utf8'))).toEqual(entry.mode === 'vwan' ? savedDocument : savedDocument.topology)
    await gallery.getByRole('button', { name: 'Cancel replacement', exact: true }).click()
    await expect(gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.other}`)).toBeFocused()
    expect(await page.evaluate((key) => localStorage.getItem(key), entry.key)).toBe(original)
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.other}`).click()
    await gallery.getByRole('button', { name: 'Replace and load', exact: true }).click()
    await expect(gallery).toHaveCount(0)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), entry.key)).not.toBe(original)
    const replacement = await page.evaluate((key) => localStorage.getItem(key), entry.key)
    await page.reload()
    await expect(page.getByTestId(entry.mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), entry.key)).toBe(replacement)
  })

  test(`${entry.mode}: failed sample load preserves the workspace and narrow dark gallery retries`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/?mode=${entry.mode}`)
    await expect(page.getByTestId(entry.mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
    if (entry.mode !== 'vwan') await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), entry.key)).not.toBeNull()
    const original = await page.evaluate((key) => localStorage.getItem(key), entry.key)
    await page.route(`**${entry.file}`, (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
    await page.getByRole('button', { name: 'Sample topologies', exact: true }).click()
    const gallery = page.getByTestId(`${entry.prefix}-sample-gallery-modal`)
    await gallery.getByRole('searchbox', { name: 'Search samples' }).fill(entry.sample)
    const bounds = await gallery.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    expect(await gallery.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.sample}`).click()
    await expect(gallery.getByRole('alert')).toContainText('Your current workspace is unchanged.')
    expect(await page.evaluate((key) => localStorage.getItem(key), entry.key)).toBe(original)
    await page.unroute(`**${entry.file}`)
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.sample}`).click()
    await expect(gallery).toHaveCount(0)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), entry.key)).not.toBe(original)
  })

  test(`${entry.mode}: closing a pending gallery load cancels it without overwriting a later sample`, async ({ page }) => {
    const body = await readFile(resolve('public', ...entry.file.split('/').filter(Boolean)), 'utf8')
    let release!: () => void
    let finish!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const finished = new Promise<void>((resolve) => { finish = resolve })
    let cancelled = false
    await page.route(`**${entry.file}`, async (route) => {
      await held
      try { await route.fulfill({ contentType: 'application/json', body }) }
      catch (error) { if (!cancelled) throw error }
      finally { finish() }
    })
    await page.goto(`/?mode=${entry.mode}`)
    await expect(page.getByTestId(entry.mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    const opener = page.getByRole('button', { name: 'Sample topologies', exact: true })
    const gallery = page.getByTestId(`${entry.prefix}-sample-gallery-modal`)
    await opener.click()
    const started = page.waitForRequest((request) => new URL(request.url()).pathname === entry.file)
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.sample}`).click()
    await started
    await expect(gallery.getByRole('status')).toContainText('Loading sample…')
    const aborted = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === entry.file)
    await page.keyboard.press('Escape')
    await aborted
    cancelled = true
    await expect(gallery).toHaveCount(0)
    await opener.click()
    await gallery.getByTestId(`${entry.prefix}-gallery-load-${entry.other}`).click()
    await expect(gallery).toHaveCount(0)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), entry.key)).not.toBeNull()
    const saved = await page.evaluate((key) => localStorage.getItem(key), entry.key)
    release()
    await finished
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    expect(await page.evaluate((key) => localStorage.getItem(key), entry.key)).toBe(saved)
    await expect(page.getByText(/Sample rejected:|Sample load failed:/)).toHaveCount(0)
  })
}
