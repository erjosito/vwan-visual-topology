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
async function setup(page: Page, advanced = true) {
  await page.goto('/')
  await page.getByLabel('Import topology file').setInputFiles({ name: 'diagnostics.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)) })
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
  if (advanced) await page.getByRole('button', { name: 'Advanced checks', exact: true }).click()
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
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  await expect(page.getByTestId('spoke-link-a')).not.toHaveClass(/preferred-link/)
  await panel(page).locator('.diagnostic-finding.error .finding-title').first().click()
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
  await page.getByRole('button', { name: '詳細な診断', exact: true }).click()
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

test('one click discovers problems and danger signs explain them without starting path animations', async ({ page }) => {
  await setup(page, false)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const marker = page.locator('.routing-issue-marker[data-object-key="site:isolated"]')
  await expect(marker).toBeVisible()
  await expect(marker).toHaveClass(/danger/)
  await expect(page.locator('.network-link.preferred-link')).toHaveCount(0)
  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await marker.click()
  const issues = page.getByRole('dialog', { name: 'Routing issues', exact: true })
  await expect(issues.getByText('Unreachable network', { exact: true })).toHaveCount(2)
  await expect(issues).toContainText('No selected path reaches this network')
  await expect(page.locator('.network-link.preferred-link')).toHaveCount(0)
  await issues.getByRole('button', { name: 'Highlight issue paths', exact: true }).first().click()
  await expect(page.locator('.network-link.preferred-link').first()).toBeVisible()
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  await page.keyboard.press('Escape')
  await marker.focus()
  await page.keyboard.press('Enter')
  await expect(issues).toBeVisible()
  await page.locator('header [data-language-selector]').selectOption('ja')
  await expect(page.getByRole('dialog', { name: 'ルーティングの問題', exact: true })).toContainText('到達できないネットワーク')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
})

test('automatic checks keep markers across display changes but remove them when routing changes', async ({ page }) => {
  await setup(page, false)
  const markers = page.locator('.routing-issue-marker')
  await expect(markers.first()).toBeVisible()
  const before = await markers.count()
  await page.getByLabel('Topology name', { exact: true }).fill('Renamed topology')
  await page.getByLabel('Visualization mode', { exact: true }).selectOption('constellation')
  await expect(markers).toHaveCount(before)
  await page.getByLabel('Select spoke Source VNet', { exact: true }).focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(markers).toHaveCount(before)
  const changed = structuredClone(topology)
  changed.sites[0].prefixes = ['10.8.0.0/24']
  await page.getByLabel('Import topology file').setInputFiles({ name: 'changed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) })
  await expect(markers).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Routing issues', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
  await expect(markers.first()).toBeVisible()
})

test('automatic checks report unknown ownership instead of a healthy topology and explanations fit mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const unknown = structuredClone(topology)
  unknown.sites[0].prefixes = []
  unknown.connections.push({
    id: 'vpn', name: 'VPN', hubId: 'h', siteId: 'isolated', transport: 'VPN', enabled: true, learnSiteRoutes: false, inbound: [], outbound: [],
    routes: [{ id: 'unowned', prefix: '10.9.0.0/24', asPath: [65001], kind: 'bgp' }],
  })
  await page.getByLabel('Import topology file').setInputFiles({ name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(unknown)) })
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
  const marker = page.locator('.routing-issue-marker[data-object-key="site:isolated"]')
  await expect(marker).toHaveClass(/unknown/)
  await expect(page.locator('.routing-check-status')).toContainText('Routing check is incomplete')
  await marker.click()
  const issues = page.getByRole('dialog', { name: 'Routing issues', exact: true })
  await expect(issues).toContainText('Advertised networks have no declared owner')
  const bounds = await issues.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('cancelling an automatic scan or replacing the topology prevents late worker results from adding signs', async ({ page }) => {
  await page.route('**/*diagnostics-worker*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue().catch(() => undefined)
  })
  await setup(page, false)
  await page.getByRole('button', { name: 'Cancel analysis', exact: true }).click()
  await expect(page.locator('.routing-check-status')).toContainText('Routing check cancelled')
  await expect(page.getByRole('button', { name: 'Check routing', exact: true })).toBeEnabled()
  await expect(page.locator('.routing-issue-marker')).toHaveCount(0)
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
  const healthy = { ...structuredClone(topology), sites: [] }
  await page.getByLabel('Import topology file').setInputFiles({ name: 'healthy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(healthy)) })
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
  await expect(page.locator('.routing-check-status')).toContainText('No routing issues found within the checked model scope.')
  await expect(page.locator('.routing-issue-marker')).toHaveCount(0)
})
