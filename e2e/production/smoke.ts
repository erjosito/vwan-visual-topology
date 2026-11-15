import { expect, test as base, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { assetGraph } from '../../scripts/production-assets.mjs'
import { exercises } from '../../src/learning/exercises'

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
  await expect(page.getByTestId(`simulator-mode-${mode}`)).toHaveAttribute('aria-pressed', 'true')
}

for (const [hostname, defaultMode] of [
  ['vwan-simulator.com', 'vwan'], ['www.vwan-simulator.com', 'vwan'],
  ['aznet-simulator.com', 'hub-spoke'], ['www.aznet-simulator.com', 'hub-spoke'],
]) {
  test(`${hostname}: dedicated default, query aliases and full override use the same artifact`, async ({ page }) => {
    const origin = `http://${hostname}:4174`
    await page.goto(`${origin}/`)
    await ready(page, defaultMode)
    await expect(page.locator(defaultMode === 'vwan' ? '.diagram [data-node-id]' : '[data-testid^="aznet-vnet-"]')).toHaveCount(0)
    await page.goto(`${origin}/?mode=unknown`)
    await ready(page, defaultMode)
    const override = defaultMode === 'vwan' ? 'hub-spoke' : 'vwan'
    await page.goto(`${origin}/workspace?mode=${override === 'vwan' ? 'vwan-only' : 'vnet'}`)
    await ready(page, override)
    await page.reload()
    await ready(page, override)
    await page.goto(`${origin}/?mode=full`)
    await ready(page, 'full')
    await expect(page).toHaveURL(/mode=azure-net/)
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
    expect(graph.localGzipBytes).toBeLessThanOrEqual(320_000)
    expect(graph.rawBytes).toBeLessThanOrEqual(1_200_000)
    expect(graph.files.some(({ path }: { path: string }) => mode === 'vwan' ? /\/AzureNetApp-/.test(path) : /\/App-/.test(path))).toBe(false)
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
    await commandSearch.fill('production-unmatched-command')
    await expect(tools.getByRole('status')).toHaveText('No commands match your search.')
    await page.keyboard.press('Escape')
    await expect(tools).toHaveCount(0)
    await expect(toolsOpener).toBeFocused()
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
    const nextMode = mode === 'vwan' ? 'hub-spoke' : 'vwan'
    const switchStart = performance.now()
    await page.getByTestId(`simulator-mode-${nextMode}`).click()
    await ready(page, nextMode)
    await page.getByTestId(`simulator-mode-${mode}`).click()
    await ready(page, mode)
    await testInfo.attach('startup-local-measurement', {
      body: JSON.stringify({ readyMs, firstOptionalPanelMs, firstInactiveWorkspaceMs: performance.now() - switchStart, graph, compression: 'local gzip; not Azure transfer' }, null, 2),
      contentType: 'application/json',
    })
  })
}

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
  await page.getByTestId('simulator-mode-hub-spoke').click()
  await expect(page.getByRole('status').filter({ hasText: 'Loading workspace' })).toBeVisible()
  release()
  await expect(page.getByRole('alert')).toContainText('Workspace could not load')
  await expect(page.getByRole('button', { name: 'Reload workspace', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  await page.getByTestId('simulator-mode-vwan').click()
  await ready(page, 'vwan')
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Saved recovery design')
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode}: production workers, P3 practice, native JSON/history and cached offline routes stay local`, async ({ page, context }) => {
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
    const practice = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
    await practice.getByRole('button', { name: 'Practice', exact: true }).click()
    const draft = structuredClone(exercises.find((exercise) => exercise.starter.mode === mode)!.starter)
    if (draft.mode === 'vwan') {
      draft.topology.spokes[1].hubId = 'one'
      delete draft.topology.spokes[1].hubRouting
    } else {
      const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
      draft.topology.vnetPeerings.push({ id: 'production-peer', name: 'Workload peering', vnetAId: 'a', vnetBId: 'b', enabled: true, aToB: flags, bToA: { ...flags } })
    }
    await practice.getByLabel('Practice topology JSON', { exact: true }).fill(JSON.stringify(draft.topology))
    await practice.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(practice.getByTestId('practice-result')).toContainText('Practice requirements satisfied')
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original)
    await page.keyboard.press('Escape')

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

    await context.setOffline(true)
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
    await practice.getByRole('button', { name: 'Practice', exact: true }).click()
    await practice.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(practice.getByTestId('practice-result')).toContainText('Practice requirements satisfied')
    expect(external).toEqual([])
    await context.setOffline(false)
  })
}
