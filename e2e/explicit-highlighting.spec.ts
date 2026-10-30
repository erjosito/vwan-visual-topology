import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { example } from '../src/model'

async function setup(page: Page) {
  const topology = { ...structuredClone(example), erLocations: [{ id: 'location', name: 'ER location' }], erLinks: [] }
  await page.goto('/')
  await page.getByLabel('Import topology file').setInputFiles({ name: 'explicit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)) })
}
async function menu(page: Page, name: string, action: string) {
  await page.getByLabel(name, { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}
const active = (page: Page) => page.locator('.network-link.preferred-link').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')).sort())

test('mouse, keyboard, context selection and configuration saves never start highlights for any node type', async ({ page }) => {
  await setup(page)
  for (const name of ['Select hub Europe hub', 'Select site London datacenter', 'Select spoke Europe applications', 'Select ER location ER location']) {
    const node = page.getByLabel(name, { exact: true })
    await node.click()
    await expect(page.locator('.preferred-link')).toHaveCount(0)
    await node.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space')
    await expect(page.locator('.preferred-link')).toHaveCount(0)
    await node.click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.locator('.preferred-link')).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  await menu(page, 'Select hub Europe hub', 'Edit configuration')
  const editor = page.getByRole('dialog', { name: 'Edit hub', exact: true })
  await editor.getByRole('textbox').first().fill('Renamed hub')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.locator('.preferred-link')).toHaveCount(0)
  await expect(page.locator('.highlight-status')).toHaveCount(0)
})

test('explicit preferred-route and prefix actions work while ordinary selection does not retarget them', async ({ page }) => {
  await setup(page)
  await menu(page, 'Select hub Europe hub', 'Highlight preferred routes')
  expect((await active(page)).length).toBeGreaterThan(0)
  const original = await active(page)
  for (const name of ['Select site London datacenter', 'Select spoke Americas applications', 'Select ER location ER location']) {
    await page.getByLabel(name, { exact: true }).click()
    expect(await active(page)).toEqual(original)
  }
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  await menu(page, 'Select hub Europe hub', 'BGP table')
  await expect(page.locator('.preferred-link')).toHaveCount(0)
  await page.getByRole('dialog', { name: 'BGP table · Europe hub', exact: true }).getByRole('button', { name: '10.20.0.0/16', exact: true }).click()
  await expect(page.getByTestId('link-er-eu')).toHaveAttribute('data-preferred', 'true')
  await page.keyboard.press('Escape')
  const selectedPrefix = await active(page)
  await page.getByLabel('Select site New York office', { exact: true }).click()
  expect(await active(page)).toEqual(selectedPrefix)
  await page.locator('header [data-language-selector]').selectOption('ja')
  await page.getByRole('button', { name: '強調表示を解除', exact: true }).click()
  await menu(page, 'ER ピアリングの場所 ER location を選択', '優先ルートを強調表示')
  await expect(page.locator('.highlight-status')).toBeVisible()
})

test.describe('touch selection', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
  test('tapping any node type selects it without starting highlights on mobile', async ({ page }) => {
    await setup(page)
    for (const name of ['Select hub Europe hub', 'Select site London datacenter', 'Select spoke Europe applications', 'Select ER location ER location']) {
      const node = page.getByLabel(name, { exact: true })
      await node.tap()
      await expect(node).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.preferred-link')).toHaveCount(0)
      await expect(page.locator('.highlight-status')).toHaveCount(0)
    }
  })
})
