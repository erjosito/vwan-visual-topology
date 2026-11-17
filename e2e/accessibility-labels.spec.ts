import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
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

  test(`${language}: partially clipped hub labels retain their name and descriptive metadata`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
    }, language)
    await page.goto('/?mode=vwan&sample=hub-routing-preferences')
    await page.getByLabel('Theme', { exact: true }).selectOption('dark')
    const hub = page.locator('.hub-node[data-node-id="hub-neu"]')
    await expect(hub).toHaveAccessibleName(/North Europe Hub \(ASPath Preference\)/)
    await expect(hub).toHaveAccessibleDescription(/North Europe/)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  for (const width of [1440, 390]) {
    test(`${language} ${width}px: loaded practice VNets and subnets are independent accessible controls`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.goto('/?mode=full')
      await page.getByTestId('learning-open').click()
      const sidebar = page.getByTestId('learning-sidebar')
      await sidebar.getByRole('button', { name: 'Load practice network', exact: true }).click()
      await sidebar.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
      await sidebar.getByRole('button', { name: 'Check task', exact: true }).click()
      await sidebar.getByRole('button', { name: 'Complete task & continue', exact: true }).click()
      await page.locator('header [data-language-selector]').selectOption(language)
      await page.getByLabel('Theme', { exact: true }).selectOption(width === 390 ? 'dark' : 'light')
      const card = page.getByTestId('aznet-vnet-a')
      const header = page.getByTestId('aznet-select-vnet-a')
      const subnet = page.getByTestId('aznet-subnet-a-work')
      await expect(card).toHaveAttribute('role', 'group')
      await expect(card.locator('[role="button"] [role="button"]')).toHaveCount(0)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await header.focus()
      await page.keyboard.press('Tab')
      await expect(subnet).toBeFocused()
      await header.press('Enter')
      await expect(header).toHaveAttribute('aria-pressed', 'true')
      await header.press('Shift+F10')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(header).toBeFocused()
      await subnet.focus()
      await subnet.press('Enter')
      await expect(header).toHaveAttribute('aria-pressed', 'false')
      await subnet.press('Shift+F10')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(subnet).toBeFocused()
    })
  }
}
