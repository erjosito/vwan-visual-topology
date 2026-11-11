import { expect, test } from '@playwright/test'
import { example } from '../src/model'

const styleKey = 'aznet-canvas-style:v1'

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode} shares canvas presets, restores its viewport and keeps presentation out of topology JSON`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    if (mode === 'vwan') {
      await page.addInitScript((topology) => {
        if (!localStorage.getItem('vwan-visual-topology:v1')) localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
      }, { ...example, layout: { mode: 'layered', positions: { layered: { eu: { x: 420, y: 300 } } } } })
    }
    await page.goto(`/?mode=${mode}${mode === 'vwan' ? '' : '&sample=hub-spoke-firewall-udr'}`)
    const shell = page.locator('.simulator-shell')
    const canvas = mode === 'vwan' ? page.locator('.canvas-stage') : page.getByTestId('aznet-canvas-shell')
    const svg = mode === 'vwan' ? page.locator('svg.diagram') : page.getByTestId('aznet-diagram-svg')
    const diagramViewport = mode === 'vwan' ? page.locator('.diagram-scroll') : svg
    const controls = page.getByRole('group', { name: 'Canvas controls', exact: true })
    const topologyKey = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), topologyKey)).not.toBeNull()
    const original = await page.evaluate((key) => localStorage.getItem(key), topologyKey)
    await expect(shell).toHaveAttribute('data-canvas-style', 'grid')
    await expect(svg.locator('[data-canvas-pattern="grid"] path')).toHaveCount(1)
    let bounds = (await canvas.boundingBox())!
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(1440)
    await expect(controls).toBeVisible()
    await expect(controls.getByLabel('Canvas style', { exact: true })).toBeVisible()
    const initialViewport = (await diagramViewport.boundingBox())!
    expect(initialViewport.y + initialViewport.height).toBeLessThanOrEqual((await controls.boundingBox())!.y)

    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(page.getByLabel('Canvas zoom')).toHaveValue(mode === 'vwan' ? '1.25' : '1.15')
    const initialView = await svg.getAttribute('viewBox')
    bounds = (await canvas.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width - 12, bounds.y + 12)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width - 70, bounds.y + 45, { steps: 4 })
    await page.mouse.up()
    await expect(svg).not.toHaveAttribute('viewBox', initialView!)
    await page.getByRole('button', { name: 'Reset view', exact: true }).click()
    await expect(page.getByLabel('Canvas zoom')).toHaveValue('1')
    await expect(svg).toHaveAttribute('viewBox', /^0 0 /)

    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme)
      await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
      await expect(svg.locator('[data-canvas-pattern="dots"] circle')).toHaveCount(1)
      await expect(canvas).toHaveCSS('border-radius', '12px')
      bounds = (await canvas.boundingBox())!
      expect(bounds.x).toBe(14)
      expect(bounds.width).toBe(1412)
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${theme}-framed.png`), fullPage: true })
      await page.getByLabel('Canvas style', { exact: true }).selectOption('grid')
      await expect(canvas).toHaveCSS('border-radius', '0px')
    }
    await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
    await page.reload()
    await expect(shell).toHaveAttribute('data-canvas-style', 'dots')
    await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
    expect(await page.evaluate((key) => localStorage.getItem(key), topologyKey)).toBe(original)
    await page.getByRole('button', { name: 'Maximize canvas', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Restore panels', exact: true })).toBeVisible()
    expect((await canvas.boundingBox())!.height).toBeGreaterThan(960)
    await page.setViewportSize({ width: 360, height: 800 })
    const controlBounds = (await controls.boundingBox())!
    expect(controlBounds.x).toBeGreaterThanOrEqual(0)
    expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(360)
    const maximizeBounds = (await page.getByRole('button', { name: 'Restore panels', exact: true }).boundingBox())!
    expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(maximizeBounds.x)
    const compactViewport = (await diagramViewport.boundingBox())!
    expect(compactViewport.y + compactViewport.height).toBeLessThanOrEqual(controlBounds.y)
    await page.getByLabel('Canvas style', { exact: true }).selectOption('grid')
    await expect(shell).toHaveAttribute('data-canvas-style', 'grid')
    await page.getByRole('button', { name: 'Restore panels', exact: true }).click()
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByLabel('Canvas style', { exact: true })).toBeVisible()
  })
}

test('canvas style survives mode changes and synchronizes tabs without sharing transient maximization', async ({ page, context }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
  for (const mode of ['hub-spoke', 'full', 'vwan']) {
    await page.getByTestId(`simulator-mode-${mode}`).click()
    await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
    await expect(page.locator('[data-canvas-pattern="dots"] circle')).toHaveCount(1)
  }
  const second = await context.newPage()
  await second.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')
  await expect(second.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
  await page.getByRole('button', { name: 'Maximize canvas', exact: true }).click()
  await expect(second.getByRole('button', { name: 'Maximize canvas', exact: true })).toBeVisible()
  await second.getByLabel('Canvas style', { exact: true }).selectOption('grid')
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('grid')
  await second.getByLabel('Canvas style', { exact: true }).selectOption('dots')
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
  await second.evaluate((key) => { localStorage.removeItem(key) }, styleKey)
  await expect(page.locator('.simulator-shell')).toHaveAttribute('data-canvas-style', 'grid')
})

test('invalid preferences and unavailable storage safely fall back to grid while allowing in-session changes', async ({ page }) => {
  await page.addInitScript((key) => {
    try { localStorage.setItem(key, 'unsupported') } catch { /* The later storage-denial script may already be installed. */ }
  }, styleKey)
  await page.goto('/?mode=vwan')
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('grid')
  await page.evaluate(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable') }
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable') }
  })
  await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
  await expect(page.locator('.simulator-shell')).toHaveAttribute('data-canvas-style', 'dots')
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable') }
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable') }
  })
  await page.reload()
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('grid')
})
