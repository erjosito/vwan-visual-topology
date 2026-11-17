import { expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { applicationFixture, applicationPlatformRequest } from '../tests/fixtures/application'
import { executePlatform } from '../src/platform/service'
import { loadLanguage, translate } from '../src/messages'
import '../src/application-messages-ja'
import '../src/network-detail-messages-ja'

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  for (const locale of ['en', 'ja'] as const) {
    test(`${mode} ${locale}: original-identity contracts, keyboard, narrow layout and worker parity`, async ({ page }, testInfo) => {
      await loadLanguage(locale)
      const topology = applicationFixture(mode), key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      const t = (message: string) => translate(locale, message)
      const unexpected: string[] = [], errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { unexpected.push(url.origin); await route.abort() }
        else await route.continue()
      })
      await page.addInitScript(({ key, value, locale }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
        localStorage.setItem('vwan-visual-topology:language:v1', locale)
      }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology }, locale })
      await page.setViewportSize({ width: locale === 'ja' ? 390 : 1440, height: locale === 'ja' ? 844 : 1000 })
      await page.goto(`/?mode=${mode}`)
      await page.getByLabel(t('Theme'), { exact: true }).selectOption(locale === 'ja' ? 'dark' : 'light')
      const node = mode === 'vwan' ? page.locator('.spoke-node[data-node-id="original-network"]') : page.getByTestId('aznet-vnet-original-network')
      await node.click()
      const opener = page.getByRole('button', { name: t('VNet detail'), exact: true })
      await opener.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByTestId('network-detail-dialog'), panel = page.getByTestId('application-flow-panel')
      await expect(dialog.getByRole('button', { name: t('Close VNet detail'), exact: true })).toBeFocused()
      await expect(panel.getByRole('heading', { name: t('Application and DNS contracts'), exact: true })).toBeVisible()
      await expect(panel.getByText('Declared gateway {0}', { exact: true })).toBeVisible()
      const inspect = panel.getByRole('button', { name: t('Inspect application contract'), exact: true })
      await inspect.focus()
      await page.keyboard.press('Enter')
      const decisions = panel.getByTestId('application-decisions')
      await expect(decisions).toBeVisible()
      await expect(decisions.locator('ol > li')).toHaveCount(5)
      await expect(dialog.getByTestId('application-subnet-reference')).toHaveText(`${t('Selected application reference')}: original-subnet`)
      await expect(dialog.getByTestId('application-workload-reference')).toBeVisible()
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      expect((await new AxeBuilder({ page }).include('[data-testid="application-flow-panel"]').analyze()).violations).toEqual([])
      const request = applicationPlatformRequest(mode)
      expect(await page.evaluate(async (input) => {
        const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
        return module.runBrowserSimulation(input)
      }, request)).toEqual(executePlatform(request))
      const bounded = { ...request, budget: { maxOutputBytes: 512 } }
      expect(await page.evaluate(async (input) => {
        const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
        return module.runBrowserSimulation(input)
      }, bounded)).toEqual(executePlatform(bounded))
      const cancelled = await page.evaluate(async (input) => {
        const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
        const controller = new AbortController()
        controller.abort()
        return module.runBrowserSimulation(input, controller.signal)
      }, request)
      expect(cancelled).toMatchObject({ contractVersion: 2, status: 'not assessed', errors: [{ code: 'CANCELLED' }] })
      expect(cancelled.application).toBeUndefined()
      await panel.getByLabel(t('Request host'), { exact: true }).fill('invalid/host')
      await expect(decisions).toHaveCount(0)
      await expect(dialog.getByTestId('application-subnet-reference')).toHaveCount(0)
      await inspect.click()
      await expect(panel.getByRole('alert')).toHaveText(t('The request could not be assessed. Check the original identities, hostname, path and explicit evaluation time.'))
      await expect(decisions).toHaveCount(0)
      await panel.getByLabel(t('Application operation'), { exact: true }).selectOption('dns')
      await panel.getByLabel(t('Evaluation time (UTC)'), { exact: true }).fill('2026-11-16T00:00:00.000Z')
      await inspect.click()
      await expect(decisions.locator('ol > li')).toHaveCount(1)
      await expect(decisions.locator('ol > li > strong')).toHaveText(t('DNS selection'))
      await expect(dialog.getByTestId('application-subnet-reference')).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${locale}-application-contracts.png`), fullPage: true })
      const persisted = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
      expect((persisted.topology ?? persisted).application).toEqual(topology.application)
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(opener).toBeFocused()
      await page.reload()
      await node.click()
      await opener.click()
      await expect(panel.getByText('Declared gateway {0}', { exact: true })).toBeVisible()
      await expect(panel.getByTestId('application-decisions')).toHaveCount(0)
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
    })
  }
}

test('native edit/undo/export retains application identities and blocks deleting referenced endpoints', async ({ page }) => {
  const topology = applicationFixture('full'), key = 'aznet-visual-topology:v1'
  await page.addInitScript(({ key, topology }) => localStorage.setItem(key, JSON.stringify({ sampleId: '', topology })), { key, topology })
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vnet-original-network').click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog')
  await dialog.getByRole('button', { name: 'Inspect application contract', exact: true }).click()
  await expect(dialog.getByTestId('application-decisions')).toBeVisible()
  await dialog.getByRole('button', { name: 'Original workload', exact: true }).click()
  await dialog.getByLabel('Workload name', { exact: true }).first().fill('Edited original')
  await dialog.getByRole('button', { name: 'Save workload', exact: true }).click()
  await expect(dialog.getByTestId('application-decisions')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Remove workload and NICs', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Application:')
  await expect(dialog.getByRole('button', { name: 'Edited original', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
  const persisted = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!).topology
  expect(persisted.inventory.workloads[0].name).toBe('Original workload')
  expect(persisted.application).toEqual(topology.application)
  // The exported native document is the exact persistence envelope's topology.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export JSON/, exact: true }).click()
  const exported = await download
  const stream = await exported.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString()).application).toEqual(topology.application)
})

test('offline Electron keeps unavailable contracts honest through UI and desktop worker', async ({ playwright }, testInfo) => {
  const profile = testInfo.outputPath('electron-profile')
  await mkdir(profile, { recursive: true })
  let application: ElectronApplication | undefined
  try {
    application = await playwright._electron.launch({ args: [resolve('platform-dist', 'electron', 'main.cjs'), `--user-data-dir=${profile}`] })
    const page = await application.firstWindow(), topology = applicationFixture('full')
    await page.getByTestId('aznet-app').waitFor()
    await page.evaluate((topology) => {
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      localStorage.setItem('vwan-visual-topology:language:v1', 'ja')
    }, topology)
    await application.context().setOffline(true)
    await page.goto('app://simulator/?mode=full')
    await page.getByTestId('aznet-vnet-original-network').click()
    await page.getByRole('button', { name: 'VNet の詳細', exact: true }).click()
    const panel = page.getByTestId('application-flow-panel')
    await panel.getByRole('button', { name: translate('ja', 'Inspect application contract'), exact: true }).click()
    await expect(panel.getByTestId('application-decisions')).toBeVisible()
    const result = await page.evaluate(async (request) => window.desktopSimulator!.simulate(request), applicationPlatformRequest())
    expect(result).toEqual({ ok: true, value: executePlatform(applicationPlatformRequest()) })
    await page.screenshot({ path: testInfo.outputPath('electron-ja-offline-contracts.png'), fullPage: true })
  } finally {
    try { await application?.close() }
    finally { await rm(profile, { recursive: true, force: true }) }
  }
})
