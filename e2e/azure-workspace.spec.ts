import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { comparisonDesign, observationFixture } from '../tests/azure-observation-fixture'

const subscriptionId = '11111111-1111-1111-1111-111111111111'
const tenantId = '22222222-2222-2222-2222-222222222222'
const wanId = `/subscriptions/${subscriptionId}/resourceGroups/network/providers/Microsoft.Network/virtualWans/wan`

async function desktop(page: Page, capture: unknown, failure = '') {
  await page.addInitScript(({ capture, failure, subscriptionId, tenantId, wanId }) => {
    Reflect.set(window, 'azureCalls', [])
    Object.defineProperty(window, 'desktopSimulator', { value: {
      accounts: async () => ({ ok: true, value: {
        cloud: { name: 'AzureCloud', resourceManager: 'https://management.azure.com/' },
        accounts: [{ id: subscriptionId, tenantId, name: 'Suggested subscription', state: 'Enabled', isDefault: true }],
      } }),
      targets: async (scope: unknown) => {
        Reflect.get(window, 'azureCalls').push({ operation: 'targets', scope })
        return { ok: true, value: { wans: [{ id: wanId, name: 'Observed WAN' }], groups: [{ id: 'group', name: 'network' }] } }
      },
      collect: async (scope: unknown) => {
        Reflect.get(window, 'azureCalls').push({ operation: 'collect', scope })
        return failure ? { ok: false, error: failure } : { ok: true, value: { name: 'capture.json', content: JSON.stringify(capture) } }
      },
      openDocument: async (request: unknown) => {
        Reflect.get(window, 'azureCalls').push({ operation: 'openDocument', request })
        return { ok: true }
      },
      releaseDocument: async () => ({ ok: true }),
    } })
  }, { capture, failure, subscriptionId, tenantId, wanId })
}

for (const mode of ['vwan', 'full']) {
  test(`Azure entry preserves ${mode} canvas and explains offline/web capabilities at narrow widths`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 })
    await page.goto(`/?mode=${mode}`)
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    const opener = page.getByTestId('workspace-azure-button')
    await opener.click()
    const panel = page.getByRole('dialog', { name: mode === 'vwan' ? 'Azure files' : 'Azure & Bicep', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Local Azure CLI integration requires', { exact: false })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Read existing Azure session', exact: true })).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Capture → Compare current design', exact: true })).toBeDisabled()
    await expect(panel.getByRole('link', { name: mode === 'vwan' ? 'Download Azure collector' : '⬇ Download Collector Script (.ps1)', exact: true })).toBeVisible()
    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(640)
    await panel.focus()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
}

test('default session is only a suggestion; each local capture requires fresh explicit scope and preserves denied evidence', async ({ page }) => {
  const capture = observationFixture()
  capture.observations.tables[0].status = 'denied'
  capture.observations.tables[0].routes = []
  await desktop(page, capture)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mode=vwan')
  await page.locator('input[data-desktop-import]').setInputFiles({ name: 'desired.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(comparisonDesign())) })
  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.getByTestId('workspace-azure-button').click()
  await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
  await expect(page.getByText('Current CLI subscription (suggestion only)', { exact: false })).toContainText('Suggested subscription')
  const subscription = page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true })
  await expect(subscription).toHaveValue('')
  const collect = page.getByRole('button', { name: 'Capture → Compare current design', exact: true })
  await expect(collect).toBeDisabled()
  await subscription.selectOption(subscriptionId)
  await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
  await page.getByRole('combobox', { name: 'Virtual WAN', exact: true }).selectOption(wanId)
  await expect(collect).toBeDisabled()
  await page.getByRole('checkbox', { name: /Confirm read-only capture scope/ }).check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await collect.click()
  await expect(page.getByRole('heading', { name: 'Observation scope and mappings', exact: true })).toBeVisible()
  await expect(collect).toBeDisabled()
  await page.getByLabel('Design hub for Observed west', { exact: true }).selectOption('h')
  await page.getByRole('button', { name: 'Compare captured fields', exact: true }).click()
  await expect(page.locator('.comparison-finding.unknown')).not.toHaveCount(0)
  await expect(page.locator('.comparison-finding.design-only')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  expect(await page.evaluate(() => Reflect.get(window, 'azureCalls'))).toEqual([
    { operation: 'targets', scope: { subscriptionId, tenantId } },
    { operation: 'collect', scope: { subscriptionId, tenantId, mode: 'vwan', target: wanId } },
  ])
  await expect(page.getByRole('region', { name: 'Local desktop tools' })).toHaveCount(0)
})

for (const mode of ['vwan', 'full']) {
  for (const language of ['en', 'ja']) {
    test(`desktop ${mode} ${language} has no persistent banner and retains native file loading`, async ({ page }) => {
      await desktop(page, null)
      await page.addInitScript(language => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
      await page.setViewportSize({ width: 640, height: 900 })
      await page.goto(`/?mode=${mode}`)
      await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
      await expect(page.locator('.desktop-tools')).toHaveCount(0)
      await page.getByRole('button', { name: language === 'ja' ? '読み込み' : 'Load', exact: true }).click()
      await page.getByRole('button', { name: language === 'ja' ? 'ファイルを読み込み' : 'Load file', exact: true }).click()
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'azureCalls'))).toEqual([
        { operation: 'openDocument', request: { documentId: expect.any(String), language } },
      ])
      await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    })
  }
}

test('failed local collection leaves the design intact and requires reconfirmation', async ({ page }) => {
  await desktop(page, null, 'Existing session expired or read permission denied. Sign in outside the app and read the session again.')
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const saved = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await page.getByTestId('workspace-azure-button').click()
  await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
  await page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true }).selectOption(subscriptionId)
  await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
  await page.getByRole('combobox', { name: 'Resource group', exact: true }).selectOption('network')
  await page.getByRole('checkbox', { name: /Confirm read-only capture scope/ }).check()
  const collect = page.getByRole('button', { name: 'Capture → Compare current design', exact: true })
  await collect.click()
  await expect(page.getByRole('status').filter({ hasText: 'Existing session expired' })).toBeVisible()
  await expect(collect).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(saved)
})

test('mixed-network local capture preserves the open design and invalidates results after routing edits', async ({ page }) => {
  await desktop(page, {
    kind: 'azure-network-capture', version: 2, resourceGroup: 'network', warnings: ['Partial fixture: route reads denied'],
    vnets: [{ name: 'Observed only', location: 'westeurope', addressSpace: { addressPrefixes: ['10.0.0.0/16'] }, subnets: [] }],
    nicEffectiveRoutes: [],
  })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const saved = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await page.getByTestId('workspace-azure-button').click()
  await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
  await page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true }).selectOption(subscriptionId)
  await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
  await page.getByRole('combobox', { name: 'Resource group', exact: true }).selectOption('network')
  await page.getByRole('checkbox', { name: /Confirm read-only capture scope/ }).check()
  await page.getByRole('button', { name: 'Capture → Compare current design', exact: true }).click()
  await expect(page.getByTestId('aznet-comparison-report')).toBeVisible()
  await expect(page.getByText('Missing, partial and unsupported evidence', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(saved)
  await page.getByRole('button', { name: 'Close Azure & Bicep', exact: true }).click()
  await page.getByRole('button', { name: '+ VNet', exact: true }).click()
  await page.getByTestId('workspace-azure-button').click()
  await expect(page.getByRole('status').filter({ hasText: 'The design changed. Compare again; previous results are stale.' })).toBeVisible()
  await expect(page.getByTestId('aznet-comparison-report')).toHaveCount(0)
  await page.getByRole('button', { name: 'Compare captured fields', exact: true }).click()
  await expect(page.getByTestId('aznet-comparison-report')).toBeVisible()
})
