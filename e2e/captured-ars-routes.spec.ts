import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { arsRouteCapture } from '../tests/fixtures/ars-route-capture'

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} scopes historical ARS routes by peering, direction and original local role`, async ({ page }) => {
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[data-desktop-import]').setInputFiles({
      name: 'synthetic-ars.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(arsRouteCapture())),
    })
    const panel = page.getByTestId('captured-ars-routes')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('172.16.0.0/16')
    await expect(panel).not.toContainText('192.168.0.0/24')
    await expect(panel).not.toContainText('198.51.100.0/24')
    await expect(panel).toContainText('historical')
    await expect(panel).toContainText('unknown')
    await panel.getByRole('combobox', { name: 'Captured ARS endpoint', exact: true })
      .selectOption(JSON.stringify(['RouteServiceRole_IN_1', '10.1.0.5']))
    await expect(panel).toContainText('192.168.0.0/24')
    await expect(panel).not.toContainText('172.16.0.0/16')
    await panel.getByRole('combobox', { name: 'Captured ARS endpoint', exact: true })
      .selectOption(JSON.stringify(['', '']))
    await expect(panel).toContainText('203.0.113.0/24')
    await expect(panel).not.toContainText('192.168.0.0/24')
    await panel.getByRole('combobox', { name: 'Route direction', exact: true }).selectOption('arsAdvertisedRoutes')
    await expect(panel.locator('tbody tr')).toHaveCount(1)
    await expect(panel.locator('tbody tr td').nth(2)).toHaveText('65515-65050')
    await expect(panel.locator('tbody tr td').nth(3)).toHaveText('Not captured')
    await panel.getByText('Captured route attributes', { exact: true }).click()
    await expect(panel).toContainText('Weight: 0')
    await panel.getByRole('combobox', { name: 'Captured ARS peering', exact: true }).selectOption('ars-b/same-peer')
    await expect(panel.locator('tbody tr')).toHaveCount(0)
    await expect(panel).toContainText('Missing rows do not establish')
    await panel.getByRole('combobox', { name: 'Route direction', exact: true }).selectOption('arsLearnedRoutes')
    await expect(panel).toContainText('198.51.100.0/24')
  })
}

test('bounds visible rows and supports narrow Japanese dark-mode keyboard inspection', async ({ page }) => {
  const capture = arsRouteCapture()
  const route = capture.arsLearnedRoutes['ars-a/same-peer'][0]
  capture.arsLearnedRoutes['ars-a/same-peer'] = Array.from({ length: 101 }, (_, index) =>
    ({ ...route, network: `172.16.${index}.0/24` }))
  await page.setViewportSize({ width: 700, height: 1000 })
  await page.goto('/?mode=full')
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
  await page.getByRole('combobox', { name: 'Language / 言語', exact: true }).selectOption('ja')
  await page.locator('input[data-desktop-import]').setInputFiles({
    name: 'synthetic-ars.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)),
  })
  const panel = page.getByTestId('captured-ars-routes')
  await expect(panel.getByRole('heading', { name: '取得済み ARS BGP ルート', exact: true })).toBeVisible()
  await expect(panel.locator('tbody tr')).toHaveCount(100)
  await panel.getByRole('button', { name: '次のルート', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(panel.locator('tbody tr')).toHaveCount(1)
  await expect(panel).toContainText('172.16.100.0/24')
  expect((await new AxeBuilder({ page }).include('[data-testid="captured-ars-routes"]').analyze()).violations).toEqual([])
})
