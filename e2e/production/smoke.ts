import { expect, test as base, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assetGraph } from '../../scripts/production-assets.mjs'
import { executePlatform } from '../../src/platform/service'
import type { PlatformRequest, PlatformResult } from '../../src/platform/contract'

const test = base.extend<{ artifactErrors: string[] }>({
  artifactErrors: [async ({ page }, runTest) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text())
    })
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        sessionStorage.setItem('production-csp-violations', `${sessionStorage.getItem('production-csp-violations') || ''}${event.violatedDirective}: ${event.blockedURI}\n`)
      })
    })
    await runTest(errors)
    expect(errors).toEqual([])
    if (!page.isClosed()) expect(await page.evaluate(() => sessionStorage.getItem('production-csp-violations'))).toBeNull()
  }, { auto: true }],
})

async function ready(page: Page, mode: string) {
  await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
  await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
}

test.describe('default presentation', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    test(`${mode}: new UI starts by default and legacy remains available`, async ({ page }) => {
      await page.goto(`/?mode=${mode}`)
      await ready(page, mode)
      const toggle = page.getByTestId('ui-preview-toggle')
      await expect(toggle).toHaveText('Use legacy UI')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.presentation-group > summary').filter({ hasText: /^File$/ })).toBeVisible()
      const settings = page.locator('.presentation-group:has([data-language-selector])')
      await settings.locator('summary').click()
      await settings.getByRole('combobox', { name: 'Canvas style', exact: true }).selectOption('dots')
      await settings.getByRole('combobox', { name: 'Connection style', exact: true }).selectOption('curved')
      await page.keyboard.press('Escape')
      const checks = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^Routing checks$/ }) })
      await checks.locator('summary').click()
      await checks.getByRole('button', { name: 'Check routing', exact: true }).click()
      await expect(page.locator('.routing-check-status')).toBeVisible()
      const help = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^Help & feedback$/ }) })
      await help.locator('summary').click()
      const pendingDocs = page.context().waitForEvent('page')
      await help.getByRole('button', { name: 'Docs', exact: true }).click()
      const docs = await pendingDocs
      await expect(docs.getByRole('heading', { level: 1 })).toBeVisible()
      await docs.close()
      await toggle.click()
      await expect(toggle).toHaveText('Use new UI')
      await page.reload()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(page.getByRole('combobox', { name: 'Canvas style', exact: true })).toHaveValue('dots')
      await expect(page.getByRole('combobox', { name: 'Connection style', exact: true })).toHaveValue('curved')
    })
  }
})

test('AzNetSim documentation branding and language switching work under production CSP', async ({ page }) => {
  const response = await page.goto('/docs/index.html?lang=ja')
  expect(response!.headers()['content-security-policy']).toContain("script-src 'self'")
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page).toHaveTitle('Azure ネットワーク シミュレーター (AzNetSim) — ドキュメントと実践サンプル')
  await expect(page.getByRole('heading', { name: 'Azure ネットワーク シミュレーター (AzNetSim) — ドキュメント', exact: true })).toBeVisible()
  await page.locator('header [data-language-selector]').selectOption('en')
  await expect(page).toHaveTitle('Azure Network Simulator (AzNetSim) — Documentation & Worked Examples')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /VNets.*hub-and-spoke.*Virtual WAN.*hybrid/)
  await page.getByRole('link', { name: 'classic hub-and-spoke', exact: true }).click()
  await ready(page, 'full')
  await expect(page.getByRole('heading', { name: 'Azure Network Simulator', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Azure Network Simulator (AzNetSim)')
})

for (const hostname of ['vwan-simulator.com', 'www.vwan-simulator.com', 'aznet-simulator.com', 'www.aznet-simulator.com']) {
  test(`${hostname}: shared empty default and compatible aliases use the same artifact`, async ({ page }) => {
    const origin = `http://${hostname}:4174`
    await page.goto(`${origin}/`)
    await ready(page, 'full')
    await expect(page.locator('[data-testid^="aznet-vnet-"]')).toHaveCount(0)
    await page.goto(`${origin}/?mode=unknown`)
    await ready(page, 'full')
    await page.goto(`${origin}/workspace?mode=vwan-only`)
    await ready(page, 'vwan')
    await page.reload()
    await ready(page, 'vwan')
    await page.goto(`${origin}/?mode=full`)
    await ready(page, 'full')
    expect(new URL(page.url()).searchParams.has('mode')).toBe(false)
  })
}

for (const [preference, system, expected] of [
  ['light', 'dark', 'light'], ['dark', 'light', 'dark'],
  ['system', 'dark', 'dark'], ['invalid', 'light', 'light'],
] as const) {
  test(`CSP-safe ${preference} theme paints before the React entry executes`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system })
    await page.addInitScript((value) => localStorage.setItem('aznet-theme', value), preference)
    const html = await readFile('dist/index.html', 'utf8')
    const entry = html.match(/type="module"[^>]*src="([^"]+)"/)![1]
    await page.route(`**/${entry.replace(/^\.\//, '')}`, (route) => route.abort())
    const response = await page.goto('/')
    expect(response!.headers()['content-security-policy']).toContain("script-src 'self'")
    expect(response!.headers()['content-security-policy']).not.toMatch(/script-src[^;]*unsafe-inline/)
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected)
    await expect(page.locator('html')).toHaveCSS('color-scheme', expected)
    await expect(page.locator('#root')).toBeEmpty()
  })
}

test('pre-paint theme tolerates unavailable storage', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('Storage unavailable') } })
  await page.route('**/assets/*.js', (route) => route.abort())
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('#root')).toBeEmpty()
  // Restore the test instrumentation so the automatic CSP assertion can inspect storage.
  await page.evaluate(() => { Storage.prototype.getItem = () => null })
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode}: measured startup requests exclude the inactive root; optional panels and first switch work`, async ({ page }, testInfo) => {
    const requests = new Set<string>()
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (/\.(js|css)$/.test(path)) requests.add(path)
    })
    await page.goto(`/?mode=${mode}`)
    await ready(page, mode)
    const readyMs = await page.evaluate(() => performance.now())
    await page.waitForLoadState('networkidle')
    const graph = await assetGraph([...requests])
    expect(graph.localGzipBytes).toBeLessThanOrEqual(300_000)
    expect(graph.rawBytes).toBeLessThanOrEqual(1_200_000)
    expect(graph.files.some(({ path }: { path: string }) => /\/packet-flow-/.test(path))).toBe(false)
    expect(graph.files.some(({ path }: { path: string }) => /\/japanese-catalog-/.test(path))).toBe(false)
    expect(graph.files.some(({ path }: { path: string }) => /\/(?:practice-session|PracticeWorkspaceBar)-/.test(path))).toBe(false)
    expect(graph.files.some(({ path }: { path: string }) => /\/flow-gif-codec-/.test(path))).toBe(false)
    expect(graph.files.some(({ path }: { path: string }) => /\/(?:microsoft-auth|CloudPanel)-/.test(path))).toBe(false)
    expect(graph.files.some(({ path }: { path: string }) => /\/(?:LearningStatusDetails|TrackOverview|tracks|concept-bodies)-/.test(path))).toBe(false)
    expect(graph.files.some(({ path }: { path: string }) => mode === 'vwan' ? /\/AzureNetApp-/.test(path) : /\/App-/.test(path))).toBe(false)
    await page.getByTestId('learning-status').click()
    await expect(page.getByTestId('learning-status-details')).toContainText('Saved locally')
    const trackOverview = page.getByTestId('learning-status-details').getByTestId('learning-tracks')
    await trackOverview.locator('summary').click()
    await expect(trackOverview).toContainText('DNS and name resolution - Planned')
    await expect(trackOverview).toContainText('Application delivery - Planned')
    await page.getByRole('button', { name: 'Close learning status', exact: true }).click()
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    await expect(tools).toBeVisible()
    const canvas = page.locator(mode === 'vwan' ? '.canvas-stage' : '.aznet-canvas-shell')
    const toolsBounds = (await tools.boundingBox())!
    expect((await canvas.boundingBox())!.x).toBeGreaterThanOrEqual(toolsBounds.x + toolsBounds.width)
    const toolsOpener = page.getByRole('button', { name: 'Workspace controls', exact: true })
    await toolsOpener.click()
    await expect(tools).toHaveCount(0)
    await toolsOpener.click()
    const commandSearch = tools.getByRole('searchbox', { name: 'Search workspace controls', exact: true })
    await expect(commandSearch).toBeFocused()
    await expect(tools.getByRole('list', { name: 'Objects in this design' })).toHaveCount(0)
    await tools.getByText('Find objects', { exact: true }).click()
    await expect(tools.getByRole('status')).toHaveText('No selectable objects in this design.')
    await commandSearch.fill('production-unmatched-command')
    await expect(tools.getByRole('status')).toHaveText('No commands match your search.')
    await page.keyboard.press('Escape')
    await expect(tools).toHaveCount(0)
    await expect(toolsOpener).toBeFocused()
    if (mode !== 'vwan') {
      expect(graph.files.some(({ path }: { path: string }) => /\/ErLocationInfoModal-/.test(path))).toBe(false)
      const locationOpener = page.getByTestId('aznet-open-er-locations-btn')
      await locationOpener.click()
      const locations = page.getByTestId('er-location-info-modal')
      await locations.getByRole('searchbox').fill('Frankfurt')
      await locations.getByTestId('close-er-location-info-modal').click()
      await locationOpener.click()
      await expect(locations.getByRole('searchbox')).toHaveValue('Frankfurt')
      await locations.getByTestId('close-er-location-info-modal').click()
    }
    const panelStart = performance.now()
    if (mode === 'vwan') {
      await page.getByRole('button', { name: 'Azure files', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Azure files', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Close Azure files', exact: true }).click()
    }
    const galleryOpener = page.getByRole('button', { name: 'Sample topologies', exact: true })
    await galleryOpener.click()
    const gallery = page.getByTestId(`${mode === 'vwan' ? 'vwan' : 'aznet'}-sample-gallery-modal`)
    await expect(gallery).toBeVisible()
    const search = gallery.getByRole('searchbox', { name: 'Search samples', exact: true })
    await expect(search).toBeFocused()
    await search.fill('production-empty-search')
    await expect(gallery).toContainText('No samples match your search.')
    await page.keyboard.press('Escape')
    await expect(gallery).toHaveCount(0)
    await expect(galleryOpener).toBeFocused()
    const firstOptionalPanelMs = performance.now() - panelStart
    if (mode === 'vwan') await page.getByLabel('Topology name', { exact: true }).fill('Preserved production design')
    const nextMode = mode === 'vwan' ? 'full' : 'vwan'
    const switchStart = performance.now()
    const file = nextMode === 'vwan' ? 'public/docs/samples/hub-routing-preferences.json' : 'public/docs/samples/azure-net/hub-spoke-firewall-udr.json'
    await page.locator('input[data-desktop-import]').setInputFiles({ name: 'compatible.json', mimeType: 'application/json', buffer: await readFile(file) })
    await ready(page, nextMode)
    await page.getByTestId('workspace-library-open').click()
    await page.getByRole('dialog', { name: 'Workspace', exact: true }).getByRole('button', { name: /^Open saved design:/ }).filter({
      hasText: mode === 'vwan' ? 'Preserved production design' : 'Empty Topology',
    }).click()
    await ready(page, mode)
    await testInfo.attach('startup-local-measurement', {
      body: JSON.stringify({ readyMs, firstOptionalPanelMs, firstInactiveWorkspaceMs: performance.now() - switchStart, graph, compression: 'local gzip; not Azure transfer' }, null, 2),
      contentType: 'application/json',
    })

  })
}

test('authentication bridge is standalone, same-origin frameable and does not relax application framing', async ({ page }) => {
  const response = await page.goto('/auth-redirect.html')
  expect(response!.headers()['cross-origin-opener-policy']).toBeUndefined()
  expect(response!.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
  expect(response!.headers()['x-frame-options']).toBe('SAMEORIGIN')
  await expect(page.locator('#root')).toHaveCount(0)
  await expect(page.locator('body')).toContainText(/Sign-in|Completing Microsoft/)
  const app = await page.goto('/')
  expect(app!.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(app!.headers()['x-frame-options']).toBe('DENY')
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.id = 'auth-frame'
    frame.src = '/auth-redirect.html'
    document.body.append(frame)
  })
  await expect(page.frameLocator('#auth-frame').locator('body')).toContainText(/Sign-in|Completing Microsoft/)
})

test('a delayed Japanese switch preserves drafts and both cached languages work offline', async ({ page, context }) => {
  const topology = JSON.parse(await readFile('public/docs/samples/hub-routing-preferences.json', 'utf8'))
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('vwan-visual-topology:v1')) localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
  }, topology)
  await page.goto('/?mode=vwan')
  await ready(page, 'vwan')
  const original = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.locator('.hub-node').first().focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Uncommitted original draft')
  let release!: () => void
  const delayed = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/japanese-catalog[.-]/, async (route) => { await delayed; await route.continue() })
  const language = page.locator('header [data-language-selector]')
  await language.focus()
  await language.selectOption('ja')
  try {
    await expect(language).toBeDisabled()
    await expect(language).toBeFocused()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Uncommitted original draft')
    expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
  } finally { release() }
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(language).toBeEnabled()
  await expect(language).toBeFocused()
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('Uncommitted original draft')
  await context.setOffline(true)
  await language.selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await language.selectOption('ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('Uncommitted original draft')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
})

test('a failed optional language load preserves the active workspace and supports reload recovery', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await ready(page, 'vwan')
  await page.getByLabel('Topology name', { exact: true }).fill('Protected language failure design')
  const original = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.route(/\/japanese-catalog[.-]/, (route) => route.abort('failed'))
  const language = page.locator('header [data-language-selector]')
  await language.selectOption('ja')
  await expect(page.getByRole('alert')).toContainText('Language could not load')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(language).toBeEnabled()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
  await page.unroute(/\/japanese-catalog[.-]/)
  await page.getByRole('button', { name: 'Reload workspace', exact: true }).click()
  await ready(page, 'vwan')
  await language.selectOption('ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByLabel('トポロジ名', { exact: true })).toHaveValue('Protected language failure design')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
})

test('initial Japanese load failures keep original bytes and allow explicit English recovery or Japanese reload', async ({ page }) => {
  const topology = JSON.parse(await readFile('public/docs/samples/hub-routing-preferences.json', 'utf8'))
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('vwan-visual-topology:v1')) localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
    if (!localStorage.getItem('vwan-visual-topology:language:v1')) localStorage.setItem('vwan-visual-topology:language:v1', 'ja')
  }, topology)
  await page.route(/\/japanese-catalog[.-]/, (route) => route.abort('failed'))
  await page.goto('/?mode=vwan')
  await expect(page.getByRole('alert')).toContainText('Workspace could not load')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))).toEqual(topology)
  await page.getByRole('button', { name: 'Use English', exact: true }).click()
  await ready(page, 'vwan')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const original = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.unroute(/\/japanese-catalog[.-]/)
  await page.locator('header [data-language-selector]').selectOption('ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await page.reload()
  await ready(page, 'vwan')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByLabel('トポロジ名', { exact: true })).toHaveValue(topology.name)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
})

test('a delayed or failed inactive workspace retains loading/recovery controls and the saved design', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await ready(page, 'vwan')
  await page.getByLabel('Topology name', { exact: true }).fill('Saved recovery design')
  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  let release!: () => void
  const pending = new Promise<void>((accept) => { release = accept })
  await page.route('**/assets/AzureNetApp-*.js', async (route) => {
    await pending
    await route.abort()
  })
  await page.locator('input[data-desktop-import]').setInputFiles({
    name: 'mixed.json', mimeType: 'application/json', buffer: await readFile('public/docs/samples/azure-net/hub-spoke-firewall-udr.json'),
  })
  await expect(page.getByRole('status').filter({ hasText: 'Loading workspace' })).toBeVisible()
  release()
  await expect(page.getByRole('alert')).toContainText('Workspace could not load')
  await expect(page.getByRole('button', { name: 'Reload workspace', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Open saved design: Saved recovery design', exact: true }).click()
  await ready(page, 'vwan')
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Saved recovery design')
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode}: production workers, guided practice, native JSON/history and cached offline routes stay local`, async ({ page, context }) => {
    const workers: string[] = []
    const external: string[] = []
    page.on('worker', (worker) => workers.push(worker.url()))
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:4174') external.push(request.url())
    })
    await page.goto(`/?mode=${mode}`)
    await ready(page, mode)
    const storageKey = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    const original = await page.evaluate((key) => localStorage.getItem(key), storageKey)
    await page.getByTestId('learning-open').click()
    const practice = page.getByTestId('learning-sidebar')
    await expect(practice.locator('textarea,select,pre')).toHaveCount(0)
    await practice.getByRole('button', { name: 'Load practice network', exact: true }).click()
    await practice.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
    await expect(page.getByTestId('practice-workspace-bar')).toContainText('your normal design is kept separately')
    await practice.getByRole('button', { name: 'Pause learning', exact: true }).click()
    await page.getByRole('button', { name: 'Return to my design', exact: true }).click()
    await ready(page, mode)
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original)

    const sample = await readFile(mode === 'vwan' ? 'public/docs/samples/hub-routing-preferences.json' : 'public/docs/samples/azure-net/hub-spoke-firewall-udr.json')
    await page.locator('input[data-desktop-import]').setInputFiles({ name: 'native.json', mimeType: 'application/json', buffer: sample })
    await page.getByRole('button', { name: 'Check routing', exact: true }).click()
    if (mode === 'vwan') {
      await expect(page.locator('.routing-check-status')).toContainText(/Checked|completed/)
    } else {
      await expect(page.getByTestId('aznet-routing-check-status')).toContainText('Checked')
    }
    expect(workers.some((url) => /\/assets\/browser-worker-.*\.js$/.test(url))).toBe(true)
    expect(workers.some((url) => /\/assets\/diagnostics-worker-.*\.js$/.test(url))).toBe(true)
    expect(workers.every((url) => new URL(url).origin === 'http://127.0.0.1:4174')).toBe(true)
    const detailTopology = JSON.parse(sample.toString())
    const detailOwner = mode === 'vwan' ? detailTopology.spokes[0] : detailTopology.vnets[0]
    const detailNode = mode === 'vwan' ? page.locator(`.spoke-node[data-node-id="${detailOwner.id}"]`) : page.getByTestId(`aznet-select-vnet-${detailOwner.id}`)
    const beforeDetail = await page.evaluate((key) => localStorage.getItem(key), storageKey)
    await detailNode.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
    const detail = page.getByTestId('network-detail-dialog')
    await expect(detail).toHaveAccessibleName(`VNet detail: ${detailOwner.name}`)
    await expect(detail.getByRole('heading', { name: 'Workload packet probe', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(beforeDetail)
    if (mode === 'full') {
      const topology = JSON.parse(await readFile(resolve('public', 'docs', 'samples', 'azure-net', 'hybrid-vwan-and-hub-spoke.json'), 'utf8'))
      const hub = topology.vwanHubs[0]
      const vnet = topology.vnets.find((vnet: { vwanHubAttachment?: { hubId: string } }) => vnet.vwanHubAttachment?.hubId === hub.id)
      topology.vpnConnections.push({ id: 'production-sdwan', name: 'Production SD-WAN', siteId: topology.sites[0].id,
        targetKind: 'vwan-hub', targetId: hub.id, enabled: true, bgpEnabled: true, transport: 'SDWAN', learnSiteRoutes: true, propagateDefaultRoute: false })
      topology.routeMaps = [{ id: 'production-policy', name: 'Production hub policy', hubId: hub.id,
        rules: [{ id: 'prepend', prefixes: [], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [64496], nextStep: 'terminate' }] }]
      hub.routeMapAssignments = [{ connectionId: vnet.id, inboundMapId: 'production-policy' }]
      vnet.appliances.push({ id: 'production-nva', name: 'Production NVA', kind: 'nva-vm', subnetId: vnet.subnets[0].id,
        privateIp: `${vnet.subnets[0].prefix.split('/')[0].split('.').slice(0, 3).join('.')}.5`, asn: 65010,
        bgpEnabled: true, vwanBgpEnabled: true, enableIpForwarding: true, staticRoutes: [], advertisedPrefixes: ['192.0.2.0/24'] })
      const request = { contractVersion: 1, operation: 'evaluate', document: { mode, topology }, requirements: [
        { id: 'hub', kind: 'route', table: hub.id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
        { id: 'custom', kind: 'route', table: hub.id, hubTableId: 'custom', prefix: vnet.prefixes[0], expectation: 'absent' },
        { id: 'subnet', kind: 'route', table: vnet.subnets[0].id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
      ] }
      const assessed = await page.evaluate(({ url, request }) => new Promise<{ assessments: { outcome: string }[]; document: unknown }>((resolve, reject) => {
        const worker = new Worker(url!, { type: 'module' })
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Production route assessment timed out')) }, 15000)
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Production route worker failed')) }
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data) }
        worker.postMessage(request)
      }), { url: workers.find((url) => /\/assets\/browser-worker-.*\.js$/.test(url)), request })
      expect(assessed.assessments.map((goal) => goal.outcome)).toEqual(['satisfied', 'not assessed', 'not assessed'])
      expect(assessed.document).toEqual(request.document)
      expect(assessed).toEqual(executePlatform(request as PlatformRequest))
      expect((assessed as PlatformResult & { simulation: { vwanHubRibs: Record<string, unknown[]> } }).simulation.vwanHubRibs[hub.id]).toEqual(expect.arrayContaining([
        expect.objectContaining({ prefix: '192.0.2.0/24', nextHopId: 'production-nva', asPath: [64496, 65010], preferred: true }),
      ]))
      const subnet = vnet.subnets[0]
      topology.inventory = {
        workloads: [{ id: 'production-vm', name: 'Production VM', nicIds: ['production-nic'] }],
        nics: [{ id: 'production-nic', name: 'Production NIC', owner: { kind: 'vnet', id: vnet.id },
          ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: subnet.id, privateIp: `${subnet.prefix.split('/')[0].split('.').slice(0, 3).join('.')}.4` }] }],
        publicIps: [],
      }
      const packetRequest: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode, topology },
        packet: { source: { kind: 'workload', workloadId: 'production-vm', nicId: 'production-nic', ipConfigurationId: 'primary' },
          target: { kind: 'external', address: '20.50.60.70' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
      const packet = await page.evaluate(({ url, request }) => new Promise<PlatformResult>((resolve, reject) => {
        const worker = new Worker(url!, { type: 'module' })
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Production packet timed out')) }, 15000)
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Production packet worker failed')) }
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data) }
        worker.postMessage(request)
      }), { url: workers.find((url) => /\/assets\/browser-worker-.*\.js$/.test(url)), request: packetRequest })
      expect(packet).toEqual(executePlatform(packetRequest))
      expect(packet.status).toBe('complete')
      expect(packet.packet!.reply.routing).toBe('not-assessed')
    }

    await context.setOffline(true)
    const beforeDiscovery = await page.evaluate((key) => localStorage.getItem(key), storageKey)
    const design = JSON.parse(beforeDiscovery!)
    const node = mode === 'vwan' ? design.hubs[0] : design.topology.vnets[0]
    const offlineTools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    await offlineTools.getByRole('searchbox').fill(node.id)
    await offlineTools.getByRole('button', {
      name: `Select ${mode === 'vwan' ? 'Virtual WAN hub' : 'VNet'}: ${node.label ?? node.name}`, exact: true,
    }).click()
    await expect(offlineTools.locator('h3[tabindex="-1"]')).toBeFocused()
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(beforeDiscovery)
    if (mode === 'vwan') {
      const name = page.getByLabel('Topology name', { exact: true })
      const before = await name.inputValue()
      await name.fill('Offline design')
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(name).toHaveValue(before)
      await page.getByRole('button', { name: 'Redo', exact: true }).click()
      await expect(name).toHaveValue('Offline design')
      await page.getByRole('button', { name: /^Select hub / }).first().focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'BGP table', exact: true }).click()
      await expect(page.getByRole('dialog', { name: /^BGP table ·/ }).getByRole('table')).toContainText('10.10.0.0/16')
      await page.getByRole('button', { name: /^Close BGP table ·/ }).click()
    } else {
      const vnets = page.getByRole('button', { name: /^VNet / })
      const count = await vnets.count()
      await page.getByTestId('aznet-add-vnet-btn').click()
      await expect(vnets).toHaveCount(count + 1)
      await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
      await expect(vnets).toHaveCount(count)
      await page.getByRole('button', { name: '↷ Redo', exact: true }).click()
      await expect(vnets).toHaveCount(count + 1)
      await page.getByTestId('aznet-subnet-sub-data-db').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
      await expect(page.getByTestId('aznet-effective-route-table')).toContainText('InterfaceEndpoint')
      await page.getByTestId('aznet-tab-tracer').click()
      await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-data:sub-data-db')
      await page.getByTestId('aznet-trace-dest-select').selectOption('site:site-munich-hq:172.16.10.0/24')
      await page.getByTestId('aznet-run-trace-btn').click()
      await expect(page.getByTestId('aznet-symmetry-verdict')).toBeVisible()
      await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    }
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: mode === 'vwan' ? 'Export JSON' : '⬇ Export JSON', exact: true }).click()
    const native = await readFile((await (await download).path())!)
    await page.locator('input[data-desktop-import]').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: native })
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)
    expect(mode === 'vwan' ? saved : saved.topology).toEqual(JSON.parse(native.toString()))
    await page.getByTestId('learning-open').click()
    await expect(practice).toContainText('Navigation help never costs points and never changes configuration or answers questions.')
    await expect(practice.locator('textarea,select,pre')).toHaveCount(0)
    expect(external).toEqual([])
    await context.setOffline(false)
  })
}
