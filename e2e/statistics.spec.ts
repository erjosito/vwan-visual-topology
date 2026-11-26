import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'

const html = readFileSync(new URL('../functions/github-statistics/dashboard.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../functions/github-statistics/dashboard-client.js', import.meta.url), 'utf8')
const collectedAt = '2026-11-26T04:17:00Z'
async function dashboard(page: Page, cloud?: object) {
  await page.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'))
  await page.route('**/statistics-preview', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.route('**/api/statistics/dashboard.js', route => route.fulfill({ contentType: 'application/javascript', body: script }))
  await page.route('**/api/statistics/summary', route => route.fulfill({ json: {
    schemaVersion: 1, repository: 'owner/project', collectedAt, historyStart: collectedAt,
    repositoryCounters: { stars: 4, forks: 2 }, downloads: 0,
    releases: [], traffic: { status: 'not_configured' }, trafficDays: [], series: [],
    ...(cloud ? { cloud } : {}),
  } }))
  await page.goto('/statistics-preview')
}

test('cloud operations shows range-scoped aggregates, unavailable status coverage and an accessible narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await dashboard(page, {
    status: 'available', resourceName: 'cloud-api', collectedAt,
    days: [
      { date: '2026-10-10', requests: 100, throttled: 10, serverErrors: 5 },
      { date: '2026-11-24', requests: 20, throttled: null, serverErrors: null },
      { date: '2026-11-25', requests: 0, throttled: 0, serverErrors: 0 },
    ],
  })
  const cloud = page.getByRole('region', { name: 'Cloud operations (Application Insights)' })
  await expect(cloud).toBeVisible()
  await expect(cloud.locator('#cloud-cards article').nth(0)).toContainText('20')
  await expect(cloud.locator('#cloud-cards article').nth(0)).toContainText('2/30 UTC days measured')
  await expect(cloud.locator('#cloud-cards article').nth(1)).toContainText('1/30 UTC days measured')
  await expect(cloud.locator('#cloud-rows tr').first()).toHaveText('2026-11-25000')
  await expect(cloud.locator('#cloud-rows tr').nth(1)).toHaveText('2026-11-2420UnavailableUnavailable')
  await expect(cloud.locator('svg')).toHaveCount(2)
  await page.getByRole('combobox', { name: /^History/ }).selectOption('90')
  await expect(cloud.locator('#cloud-cards article').nth(0)).toContainText('120')
  await expect(cloud.locator('#cloud-rows tr')).toHaveCount(3)
  expect((await new AxeBuilder({ page }).include('[aria-labelledby="cloud-title"]').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('historical summaries without cloud data remain usable and stale cloud history does not look current', async ({ page }) => {
  await dashboard(page)
  await expect(page.locator('#cloud-status')).toContainText('have not been collected')
  await expect(page.locator('#cloud-cards strong')).toHaveText(['Unavailable', 'Unavailable', 'Unavailable'])
  await expect(page.locator('#cloud-requests-chart')).toContainText('No comparable observations')
  await expect(page.locator('#cards')).toContainText('Stars')
  await dashboard(page, {
    status: 'available', resourceName: 'cloud-api', collectedAt: '2026-11-23T04:17:00Z',
    days: [{ date: '2026-11-22', requests: null, throttled: null, serverErrors: null }],
  })
  await expect(page.locator('#cloud-status')).toHaveClass('muted warning')
  await expect(page.locator('#cloud-status')).toContainText('2026-11-23')
  await expect(page.locator('#cloud-cards strong')).toHaveText(['Unavailable', 'Unavailable', 'Unavailable'])
})
