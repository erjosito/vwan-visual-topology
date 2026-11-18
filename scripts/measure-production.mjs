import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'
import { createProductionServer } from './production-server.mjs'
import { assetGraph, initialAssetGraph } from './production-assets.mjs'

const root = process.env.PRODUCTION_ROOT || 'dist'
const server = await createProductionServer({ root, port: 0 })
let browser
try {
  browser = await chromium.launch()
  const result = {
    measuredAt: new Date().toISOString(),
    browserVersion: browser.version(),
    compression: 'Local gzipSync bytes; not observed Azure transfer. HTTP server serves uncompressed dist.',
    timing: 'Single cold browser context per mode on local loopback; not an Azure latency claim.',
    initialReferencedGraph: await initialAssetGraph(root),
    modes: [],
  }
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const requests = new Set()
    page.on('requestfinished', (request) => {
      const path = new URL(request.url()).pathname
      if (/\.(js|css)$/.test(path)) requests.add(path)
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    const readyMs = await page.evaluate(() => performance.now())
    await page.waitForLoadState('networkidle')
    const initialRequests = await assetGraph([...requests], root)
    const start = performance.now()
    const panelOpener = mode === 'vwan' ? page.getByRole('button', { name: 'Azure files', exact: true, includeHidden: true }) : page.getByTestId('aznet-open-sample-gallery-btn')
    await page.locator('.presentation-group').filter({ has: panelOpener }).locator('summary').click()
    await panelOpener.click()
    await (mode === 'vwan' ? page.getByRole('dialog', { name: 'Azure files', exact: true }) : page.getByTestId('aznet-sample-gallery-modal')).waitFor()
    const firstOptionalPanelMs = performance.now() - start
    await (mode === 'vwan' ? page.getByRole('button', { name: 'Close Azure files', exact: true }) : page.getByTestId('aznet-close-sample-gallery-btn')).click()
    const nextMode = mode === 'vwan' ? 'hub-spoke' : 'vwan'
    const switchStart = performance.now()
    const file = nextMode === 'vwan' ? 'public/docs/samples/hub-routing-preferences.json' : 'public/docs/samples/azure-net/hub-spoke-firewall-udr.json'
    await page.locator('input[data-desktop-import]').setInputFiles({
      name: 'compatible.json', mimeType: 'application/json', buffer: await readFile(file),
    })
    await page.getByTestId(nextMode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    const firstInactiveWorkspaceMs = performance.now() - switchStart
    const languageStart = performance.now()
    await page.locator('.presentation-group:has([data-language-selector]) > summary').click()
    await page.locator('header [data-language-selector]').selectOption('ja')
    await page.locator('html[lang="ja"]').waitFor()
    await page.locator('header [data-language-selector][aria-label="言語 / Language"]').waitFor({ state: 'attached' })
    const firstJapaneseSwitchMs = performance.now() - languageStart
    result.modes.push({ mode, language: 'en', readyMs, initialRequests, firstOptionalPanelMs, firstInactiveWorkspaceMs,
      firstJapaneseSwitchMs, firstJapaneseSwitchWorkspace: nextMode })
    await context.close()
  }
  const context = await browser.newContext()
  await context.addInitScript(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
  const page = await context.newPage()
  const requests = new Set()
  page.on('requestfinished', (request) => {
    const path = new URL(request.url()).pathname
    if (/\.(js|css)$/.test(path)) requests.add(path)
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=full`)
  await page.getByTestId('aznet-app').waitFor()
  await page.locator('header [data-language-selector][aria-label="言語 / Language"]').waitFor({ state: 'attached' })
  const readyMs = await page.evaluate(() => performance.now())
  await page.waitForLoadState('networkidle')
  result.initialJapaneseWorkspace = { mode: 'full', language: 'ja', readyMs, initialRequests: await assetGraph([...requests], root) }
  await context.close()
  const json = `${JSON.stringify(result, null, 2)}\n`
  if (process.argv[2]) {
    await mkdir(dirname(process.argv[2]), { recursive: true })
    await writeFile(process.argv[2], json)
  }
  console.log(json)
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((accept) => server.close(accept))
}
