import type { Page } from '@playwright/test'

export async function downloadTopologyCopy(page: Page) {
  const japanese = await page.locator('html').getAttribute('lang') === 'ja'
  const button = page.getByRole('button', { name: japanese ? '名前を付けて保存' : 'Save As', exact: true, includeHidden: true })
  await button.waitFor({ state: 'attached' })
  const group = button.locator('xpath=ancestor::details[1]')
  if (await group.count() && !await button.isVisible()) await group.locator('summary').click()
  await button.click()
  const chooser = page.getByRole('dialog', { name: japanese ? '名前を付けて保存' : 'Save As', exact: true })
  await chooser.getByRole('combobox', { name: japanese ? '保存先' : 'Destination', exact: true }).selectOption('download')
  await chooser.getByRole('button', { name: japanese ? '保存' : 'Save', exact: true }).click()
}
