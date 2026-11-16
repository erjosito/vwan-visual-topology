import { expect, test } from '@playwright/test'
import { example } from '../src/model'

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const language of ['en', 'ja']) {
  test(`${language}: visible SVG labels name original keyboard-selectable nodes`, async ({ page }) => {
    const topology = structuredClone(example)
    const hub = topology.hubs[0]
    hub.name = 'Original hub with a deliberately long untruncated name'
    hub.label = 'User supplied label'
    await page.addInitScript(({ topology, language }) => {
      localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
      localStorage.setItem('vwan-visual-topology:language:v1', language)
    }, { topology, language })
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    await page.goto('/?mode=vwan')
    const node = page.locator(`.hub-node[data-node-id="${hub.id}"]`)
    await expect(node).toBeVisible()
    await expect(node.locator('.node-name text')).toContainText('…')
    await expect(node).toHaveAccessibleName(new RegExp(escaped(hub.name)))
    for (const original of await page.locator('svg.diagram [data-node-id][role="button"]').all()) {
      const visible = (await original.locator('text').allTextContents()).join(' ').replace(/\s+/g, ' ').trim()
      await expect(original).toHaveAccessibleName(new RegExp(escaped(visible)))
    }
    const before = await node.getAttribute('transform')
    await node.focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(node).not.toHaveAttribute('transform', before!)
    await page.keyboard.press('Enter')
    await expect(node).toHaveAttribute('aria-pressed', 'true')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
    expect(saved.hubs[0].id).toBe(hub.id)
    expect(saved.hubs[0].name).toBe(hub.name)
    expect(saved.hubs[0].label).toBe(hub.label)
  })

  test(`${language}: mixed workspace content belongs to one main landmark`, async ({ page }) => {
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
    }, language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('main').locator('.aznet-scenario-banner')).toBeVisible()
    await expect(page.getByRole('main').locator('.canvas-controls-stack')).toBeVisible()
  })
}
