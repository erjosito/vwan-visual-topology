import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { comparisonDesign, observationFixture } from '../tests/azure-observation-fixture'

const panel = (page: Page) => page.getByRole('dialog', { name: 'Compare with Azure capture', exact: true })
async function open(page: Page) {
  await page.getByRole('button', { name: 'Azure files', exact: true }).click()
  await page.getByRole('button', { name: 'Compare with Azure capture', exact: true }).click()
}
async function setup(page: Page, capture = observationFixture()) {
  await page.goto('/')
  await page.getByLabel('Import topology file').setInputFiles({ name: 'design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(comparisonDesign())) })
  await open(page)
  await page.getByLabel('Azure comparison capture file').setInputFiles({ name: 'capture-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)) })
  await panel(page).getByLabel('Design hub for Observed west', { exact: true }).selectOption('h')
  await panel(page).getByLabel('Design spoke for Observed a', { exact: true }).selectOption('a')
  await panel(page).getByLabel('Design spoke for Observed b', { exact: true }).selectOption('b')
}
test('comparison attaches observations without changing or transmitting the design and does not infer name identity', async ({ page }) => {
  const external: string[] = []
  await setup(page)
  const origin = new URL(page.url()).origin
  page.on('request', (request) => { if (new URL(request.url()).origin !== origin) external.push(request.url()) })
  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await panel(page).getByRole('button', { name: 'Compare captured fields', exact: true }).click()
  await expect(panel(page).getByRole('region', { name: 'Azure comparison results' })).toBeVisible()
  await expect(panel(page).getByText('No rows match this view.', { exact: false })).toBeVisible()
  await panel(page).getByLabel('Comparison view', { exact: true }).selectOption('designed')
  await expect(panel(page).locator('.comparison-finding.match')).toHaveCount(5)
  await panel(page).getByRole('button', { name: '10.1.0.0/24', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select spoke Desired a', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.highlight-status')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  expect(external).toEqual([])
})

test('missing and additional routes retain evidence, Japanese interaction, bounded mobile layout and old data after bad import', async ({ page }) => {
  const capture = observationFixture()
  capture.observations.tables[0].routes.pop()
  capture.observations.tables[0].routes.push({ addressPrefixes: ['10.88.0.0/24'], nextHopType: 'Unknown', nextHops: ['unknown'], routeOrigin: 'unknown', asPath: '65099' })
  await setup(page, capture)
  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await panel(page).getByLabel('Exact expected IPv4 prefixes', { exact: false }).fill('10.1.0.0/24\n10.2.0.0/24\n10.88.0.0/24')
  await panel(page).getByRole('checkbox', { name: /I have modeled all expected routes/ }).check()
  await panel(page).getByRole('button', { name: 'Compare captured fields', exact: true }).click()
  await expect(panel(page).locator('.comparison-finding.design-only')).toContainText('10.2.0.0/24')
  await expect(panel(page).locator('.comparison-finding.azure-only')).toContainText('10.88.0.0/24')
  const pending = page.waitForEvent('download')
  await panel(page).getByRole('button', { name: 'Export local comparison report', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of (await (await pending).createReadStream())!) chunks.push(chunk)
  const report = JSON.parse(Buffer.concat(chunks).toString())
  expect(report.report.rows.some((row: { status: string }) => row.status === 'design-only')).toBe(true)
  expect(report.report.observedRows.some((row: { addressPrefixes: string[] }) => row.addressPrefixes.includes('10.88.0.0/24'))).toBe(true)
  await page.locator('header [data-language-selector]').selectOption('ja')
  const japanese = page.getByRole('dialog', { name: 'Azure の取得データと比較', exact: true })
  await expect(japanese.locator('.comparison-finding.design-only')).toContainText('設計にのみ存在するルート')
  await page.getByLabel('Azure 比較用の取得ファイル').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2}') })
  await expect(japanese.getByRole('alert')).toContainText('以前の観測データと設計は保持されました')
  await expect(japanese.locator('.comparison-finding.design-only')).toContainText('10.2.0.0/24')
  await page.setViewportSize({ width: 390, height: 844 })
  const box = await japanese.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(391)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
})

test('denied observations never become missing routes and routing edits invalidate old results', async ({ page }) => {
  const capture = observationFixture()
  capture.observations.tables[0].status = 'denied'; capture.observations.tables[0].routes = []
  await setup(page, capture)
  await panel(page).getByLabel('Exact expected IPv4 prefixes', { exact: false }).fill('10.2.0.0/24')
  await panel(page).getByRole('checkbox', { name: /I have modeled all expected routes/ }).check()
  await panel(page).getByRole('button', { name: 'Compare captured fields', exact: true }).click()
  await expect(panel(page).locator('.comparison-finding.design-only')).toHaveCount(0)
  await expect(panel(page).locator('.comparison-finding.unknown')).toContainText('Missing routes are not inferred')
  const changed = comparisonDesign(); changed.hubs[0].preference = 'ExpressRoute'
  await page.getByLabel('Import topology file').setInputFiles({ name: 'changed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) })
  await open(page)
  await expect(panel(page).getByText('The design or mappings changed.', { exact: false })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Export local comparison report', exact: true })).toHaveCount(0)
  await page.reload(); await open(page)
  await expect(panel(page).getByRole('heading', { name: 'Observation scope and mappings' })).toHaveCount(0)
})
