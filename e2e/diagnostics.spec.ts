import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Topology } from '../src/model'

const topology: Topology = {
  version: 1, name: 'Diagnostics lab',
  hubs: [{ id: 'h', name: 'Hub', region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
  spokes: [{ id: 'a', name: 'Source VNet', hubId: 'h', prefixes: ['10.1.0.0/24'] }, { id: 'b', name: 'Destination VNet', hubId: 'h', prefixes: ['10.2.0.0/24'] }],
  sites: [{ id: 'isolated', name: 'Isolated site', asn: 65001, prefixes: ['10.9.0.0/24'] }],
  connections: [], siteLinks: [],
}
const panel = (page: Page) => page.getByRole('dialog', { name: 'Routing diagnostics', exact: true })
async function setup(page: Page) {
  await page.goto('/')
  await page.getByLabel('Import topology file').setInputFiles({ name: 'diagnostics.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)) })
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
}
async function downloadedJson(page: Page, button: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}
test('diagnostics checks declared flows, highlights evidence and preserves topology and profile across localization', async ({ page }) => {
  await setup(page)
  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await panel(page).getByRole('button', { name: 'Add flow requirement', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Run diagnostics', exact: true }).click()
  await expect(panel(page).getByRole('region', { name: 'Diagnostic results' })).toBeVisible()
  await expect(panel(page).getByText('Analysis completed within the requested model scope.', { exact: false })).toBeVisible()
  const healthy = await downloadedJson(page, 'Export diagnostic report')
  expect(healthy.report.probes).toBeGreaterThan(0)
  expect(healthy.report.findings.filter((finding: { severity: string }) => finding.severity === 'error')).toEqual([])
  await panel(page).getByLabel('Diagnostic destination', { exact: true }).selectOption('site:isolated')
  await panel(page).getByRole('button', { name: 'Add flow requirement', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Run diagnostics', exact: true }).click()
  await expect(panel(page).locator('.diagnostic-finding.error').first()).toBeVisible()
  await panel(page).locator('.diagnostic-finding.error .finding-title').first().click()
  await expect(page.getByTestId('spoke-link-a')).toHaveClass(/preferred-link/)
  const profile = await downloadedJson(page, 'Export analysis profile')
  expect(profile.intents).toHaveLength(2)
  await page.locator('header [data-language-selector]').selectOption('ja')
  await expect(page.getByRole('dialog', { name: 'ルーティング診断', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '必要な宛先に到達不可', exact: true })).toBeVisible()
  await expect(page.getByLabel('診断の宛先')).toHaveValue('site:isolated')
  await expect(page.getByRole('button', { name: '診断レポートをエクスポート', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  await page.reload()
  await page.getByRole('button', { name: 'ルーティングを診断', exact: true }).click()
  await expect(page.locator('.analysis-requirements').first().locator('li')).toHaveCount(2)
})

test('invalid profile imports preserve the current requirements and expected deny is not silently allowed', async ({ page }) => {
  await setup(page)
  await panel(page).getByLabel('Expected communication').selectOption('deny')
  await panel(page).getByRole('button', { name: 'Add flow requirement', exact: true }).click()
  const before = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:diagnostics:v1'))
  await page.getByLabel('Import analysis profile file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"intents":[{}]}') })
  await expect(panel(page).getByRole('alert')).toContainText('Invalid analysis profile')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:diagnostics:v1'))).toBe(before)
  await panel(page).getByRole('button', { name: 'Run diagnostics', exact: true }).click()
  await expect(panel(page).locator('.diagnostic-finding.error').first()).toBeVisible()
  await panel(page).getByLabel('Diagnostic severity').selectOption('unknown')
  await expect(panel(page).getByText('No findings match these filters.', { exact: false })).toBeVisible()
})

test('worker analysis can be cancelled and mobile reports stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await panel(page).getByRole('button', { name: 'Add flow requirement', exact: true }).click()
  await page.route('**/*diagnostics-worker*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue().catch(() => undefined)
  })
  await panel(page).getByRole('button', { name: 'Run diagnostics', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Cancel analysis', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'Run diagnostics', exact: true })).toBeEnabled()
  await expect(panel(page).getByRole('region', { name: 'Diagnostic results' })).toHaveCount(0)
  const bounds = await panel(page).boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})
