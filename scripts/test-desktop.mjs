import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const artifacts = resolve('test-artifacts', 'desktop')
await mkdir(artifacts, { recursive: true })
const executablePath = process.env.DESKTOP_EXECUTABLE
const application = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('platform-dist', 'electron', 'main.cjs')]), `--user-data-dir=${join(artifacts, executablePath ? 'packaged-profile' : 'development-profile')}`],
})
const require = createRequire(import.meta.url)
const { executePlatform } = require('../platform-dist/service.cjs')
const outbound = [], failures = []
try {
  const page = await application.firstWindow()
  page.on('request', (request) => { if (/^https?:/.test(request.url())) outbound.push(request.url()) })
  page.on('pageerror', (error) => failures.push(error.message))
  await page.getByTestId('vwan-app').waitFor()
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => ({ node: typeof window.require, ipc: Object.keys(window.desktopSimulator) }))).toEqual({
    node: 'undefined', ipc: ['openTopology', 'accounts', 'targets', 'collect', 'simulate'],
  })
  for (const [mode, file] of [
    ['vwan', 'hub-routing-preferences.json'],
    ['hub-spoke', 'azure-net/hub-spoke-firewall-udr.json'],
    ['full', 'azure-net/hybrid-vwan-and-hub-spoke.json'],
  ]) {
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    const topology = JSON.parse(await readFile(resolve('public', 'docs', 'samples', ...file.split('/')), 'utf8'))
    const request = { contractVersion: 1, operation: 'simulate', document: { mode, topology } }
    const result = await page.evaluate((input) => window.desktopSimulator.simulate(input), request)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(executePlatform(request))
    if (mode !== 'vwan') await expect(page.getByTestId('aznet-share-url-btn')).toBeDisabled()
    const localFile = join(artifacts, `roundtrip-${mode}.json`)
    await writeFile(localFile, JSON.stringify(topology))
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, localFile)
    await page.getByRole('button', { name: 'Open local JSON', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Review the local file' })).toBeVisible()
    const readSaved = () => page.evaluate((mode) => {
      const value = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'))
      return mode === 'vwan' ? value : value.topology
    }, mode)
    await expect.poll(readSaved).toEqual(executePlatform({ ...request, operation: 'validate' }).document.topology)
  }
  expect(outbound).toEqual([])
  expect(failures).toEqual([])
  const blocked = await page.evaluate(async () => {
    try { await fetch('https://example.com/desktop-privacy-test'); return false }
    catch { return true }
  })
  expect(blocked).toBe(true)
  const rejected = await page.evaluate(() => window.desktopSimulator.targets({ subscriptionId: '& whoami', tenantId: 'invalid' }))
  expect(rejected.ok).toBe(false)
  await page.goto('app://simulator/?mode=vwan&feedback=1')
  await page.getByTestId('vwan-app').waitFor()
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeDisabled()
  expect(await page.locator('.feedback-modal').count()).toBe(0)
  const documentationWindow = application.waitForEvent('window')
  await page.getByRole('button', { name: 'Docs', exact: true }).click()
  const documentation = await documentationWindow
  await documentation.waitForLoadState()
  expect(documentation.url()).toContain('app://simulator/docs/')
  expect(await documentation.evaluate(() => typeof window.desktopSimulator)).toBe('undefined')
  expect(await documentation.locator('body').innerText()).toContain('Virtual WAN')
  await documentation.close()
  const runtime = await application.evaluate(({ app }) => ({
    version: app.getVersion(), electron: process.versions.electron,
    userData: app.getPath('userData'), mainMemoryBytes: process.memoryUsage().rss,
  }))
  await page.screenshot({ path: join(artifacts, executablePath ? 'packaged.png' : 'development.png') })
  await writeFile(join(artifacts, executablePath ? 'packaged-checks.json' : 'development-checks.json'), JSON.stringify({
    verifiedAtUtc: new Date().toISOString(), packaged: !!executablePath, modes: ['vwan', 'hub-spoke', 'full'],
    engineParity: true, localJsonRoundTrips: true, offlineNoAutomaticHttpRequests: true,
    rendererNodeUnavailable: true, remoteFetchBlocked: true, malformedScopeRejected: true, externalIntegrationsDisabled: true,
    documentationWithoutBridge: true, runtime,
  }, null, 2))
  console.log('Desktop smoke passed: three-mode parity, native file import, offline assets, narrow IPC and blocked outbound integrations.')
} finally { await application.close() }
