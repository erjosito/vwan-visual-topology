import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { denseVisualizationTopology, visualizationLayout, visualizationVariants } from '../tests/fixtures/dense-visualization'
import { parseAzNetTopology } from '../src/azure-net/admission'

test('synthetic visualization alternatives preserve the native graph and saved coordinates', () => {
  for (const count of [2, 8]) {
    const original = denseVisualizationTopology(count)
    const before = JSON.stringify(original)
    parseAzNetTopology(original)
    const withoutCoordinates = (value: unknown) => JSON.stringify(value, (key, v) => key === 'x' || key === 'y' ? undefined : v)
    for (const variant of visualizationVariants) {
      const view = visualizationLayout(original, variant)
      parseAzNetTopology(view)
      expect(withoutCoordinates(view)).toBe(withoutCoordinates(original))
    }
    expect(JSON.stringify(original)).toBe(before)
  }
})

for (const theme of ['light', 'dark']) {
  test(`${theme}: production dense connection focus retains every connection and manual coordinate`, async ({ page }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.addInitScript(({ topology, theme }) => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      localStorage.setItem('aznet-theme', theme)
    }, { topology: denseVisualizationTopology(), theme })
    await page.goto('/?mode=full')
    await expect(page.getByTestId('ui-preview-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const svg = page.getByTestId('aznet-diagram-svg')
    await expect(svg.locator('[data-canvas-connection-id]')).toHaveCount(52)
    await page.getByRole('button', { name: 'Fit view', exact: true }).click()
    const before = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.getByTestId('aznet-select-vnet-hub-0').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Focus selected connections', exact: true }).click()
    const dimmed = svg.locator('[data-connection-dimmed="true"]')
    expect(await dimmed.count()).toBeGreaterThan(0)
    await expect(svg.locator('[data-canvas-connection-id]')).toHaveCount(52)
    await expect(svg.locator('.policy-marker')).toHaveCount(40)
    await expect(page.getByTestId('connection-focus-status')).toContainText('0 hidden')
    await expect(page.getByTestId('aznet-erlink-er-site-0')).not.toHaveAttribute('data-connection-dimmed')
    expect((await new AxeBuilder({ page }).include('[data-testid="aznet-canvas-shell"]').analyze()).violations).toEqual([])
    await info.attach(`production-focus-${theme}`, { body: await page.screenshot({ path: info.outputPath(`production-focus-${theme}.png`) }), contentType: 'image/png' })
    await page.getByRole('button', { name: 'Restore all connections', exact: true }).click()
    await expect(dimmed).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
  })
}

test('research focus scope is available only for focus and visibly changes original connection emphasis', async ({ page }) => {
  await page.goto('/verification/dense-topology-comparison.html')
  const before = await page.getByTestId('research-original').textContent()
  const scope = page.getByLabel('Focus scope', { exact: true })
  await expect(scope).toBeDisabled()
  await expect(page.locator('#research-focus-help')).toContainText('Choose the focus alternative')
  await page.getByLabel('Alternative', { exact: true }).selectOption('focus')
  await expect(scope).toBeEnabled()
  const peer = page.getByTestId('aznet-peering-mesh-0-2').locator('> .aznet-edge-path')
  await page.mouse.move(0, 0)
  await expect(peer).toHaveCSS('opacity', '1')
  await scope.selectOption('chain')
  await expect(peer).toHaveCSS('opacity', '0.2')
  await expect(page.getByTestId('aznet-peering-mesh-0-1').locator('> .aznet-edge-path')).toHaveCSS('stroke-dasharray', /^12px,?\s+4px$/)
  await expect(page.getByTestId('research-view-status')).toContainText('Focus scope: Connection chain')
  await scope.selectOption('hub')
  await expect(peer).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: 'Restore saved overview', exact: true }).click()
  await expect(scope).toBeDisabled()
  expect(await page.getByTestId('research-original').textContent()).toBe(before)
})

for (const count of [8, 2]) for (const theme of ['light', 'dark']) {
  test(`${count} regions: ${theme} comparative geometry and inspection`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.goto('/verification/dense-topology-comparison.html')
    await page.getByLabel('Workload', { exact: true }).selectOption(String(count))
    await page.getByLabel('Theme', { exact: true }).selectOption(theme)
    const before = await page.getByTestId('research-original').textContent()
    const observations = []
    const screenshots: { variant: string; png: string }[] = []
    let baselineFindings: string[] = []
    const findings = (report: Awaited<ReturnType<AxeBuilder['analyze']>>) => report.violations.flatMap(v =>
      v.nodes.map(node => `${v.id}:${JSON.stringify(node.target)}`)).sort()
    for (const variant of visualizationVariants.filter(variant => !['matrix', 'regions', 'neighborhood'].includes(variant))) {
      const start = await page.evaluate(() => performance.now())
      await page.getByLabel('Alternative', { exact: true }).selectOption(variant)
      await page.getByRole('button', { name: 'Fit view', exact: true }).click()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const observation = await page.getByTestId('aznet-diagram-svg').evaluate((svg, start) => {
        const settleMs = Math.round(performance.now() - start)
        const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        const pairs = (boxes: DOMRect[]) => boxes.reduce((sum, a, i) => sum + boxes.slice(i + 1).filter(b => overlap(a, b)).length, 0)
        const labels = Array.from(svg.querySelectorAll('text')).filter(e => e.textContent?.trim()).map(e => e.getBoundingClientRect())
        const markers = Array.from(svg.querySelectorAll('.policy-marker')).map(e => e.getBoundingClientRect())
        const edges = Array.from(svg.querySelectorAll<SVGPathElement>('.aznet-edge-group > .aznet-edge-path'))
        const nodes = Array.from(svg.querySelectorAll<SVGRectElement>('.network-node-frame')).map(e => e.getBBox())
        const points = edges.map(path => Array.from({ length: 25 }, (_, i) => path.getPointAtLength(path.getTotalLength() * i / 24)))
        const cross = (a: DOMPoint, b: DOMPoint, c: DOMPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        let crossingPairs = 0
        for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
          let found = false
          for (let i = 1; i < points[a].length && !found; i++) for (let j = 1; j < points[b].length && !found; j++) {
            const [p, q, r, s] = [points[a][i - 1], points[a][i], points[b][j - 1], points[b][j]]
            if (cross(p, q, r) * cross(p, q, s) >= 0 || cross(r, s, p) * cross(r, s, q) >= 0) continue
            const dx = q.x - p.x, dy = q.y - p.y, ex = s.x - r.x, ey = s.y - r.y
            const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / (dx * ey - dy * ex)
            const x = p.x + t * dx, y = p.y + t * dy
            if (!nodes.some(n => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height)) found = true
          }

          if (found) crossingPairs++
        }
        return {
          settleMs, labelOverlapPairs: pairs(labels), markerOverlapPairs: pairs(markers),
          approximateCrossingEdgePairs: crossingPairs, medianTextHeight: labels.map(r => r.height).sort((a, b) => a - b)[Math.floor(labels.length / 2)],
          edgeCount: edges.length, dimmedCount: svg.querySelectorAll('.research-muted').length,
          markerCount: markers.length, viewBox: svg.getAttribute('viewBox'),
        }
      }, start)
      observations.push({ variant, ...observation })
      expect(observation.edgeCount).toBe(count * (count - 1) / 2 + count * 3)
      expect(observation.markerCount).toBe(count === 8 ? 40 : 10)
      expect(await page.getByTestId('research-original').textContent()).toBe(before)
      const screenshot = await page.screenshot({ path: info.outputPath(`${variant}.png`) })
      screenshots.push({ variant, png: screenshot.toString('base64') })
      await info.attach(`${variant}-${theme}-${count}`, { body: screenshot, contentType: 'image/png' })
      if (variant === 'saved') {
        const report = await new AxeBuilder({ page }).analyze()
        baselineFindings = findings(report)
        await info.attach('baseline-axe', { body: JSON.stringify(report), contentType: 'application/json' })
        expect(baselineFindings).toEqual([])
      }
    }
    await info.attach('visualization-observations', { body: JSON.stringify({ count, theme, observations }, null, 2), contentType: 'application/json' })
    await page.getByLabel('Alternative', { exact: true }).selectOption('focus')
    await page.getByRole('button', { name: 'Fit view', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('0 hidden')
    const dimmed = page.locator('.research-muted').first()
    await dimmed.focus()
    await expect(dimmed.locator('> .aznet-edge-path')).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await page.locator('details > summary').first().click()
    await expect(page.getByTestId('research-selected')).not.toContainText('null')
    const marker = page.locator('.policy-marker[data-router-id="ars-0"][data-direction="inbound"]').first()
    await marker.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('research-policy')).toContainText('"routeServerId":"ars-0"')
    await expect(page.getByTestId('research-policy')).toContainText('"direction":"inbound"')
    await expect(page.getByTestId('research-policy')).toContainText('"connectionId":"nva:nva-0-0"')
    await page.getByLabel('Focus scope', { exact: true }).selectOption('chain')
    await expect(page.locator('.research-chain')).toHaveCount(5)
    await expect(page.getByTestId('aznet-erlink-er-site-0')).not.toHaveClass(/research-muted/)
    const focusedReport = await new AxeBuilder({ page }).analyze()
    await info.attach('focused-axe', { body: JSON.stringify(focusedReport), contentType: 'application/json' })
    expect(findings(focusedReport).filter(finding => !baselineFindings.includes(finding))).toEqual([])
    await page.getByRole('button', { name: 'Restore saved overview', exact: true }).click()
    await expect(page.locator('.research-muted')).toHaveCount(0)
    expect(await page.getByTestId('research-original').textContent()).toBe(before)
    await page.getByLabel('Fixture scenario', { exact: true }).selectOption('missing')
    await expect(page.getByTestId('research-peerings')).toContainText(`${count - 2} / ${count - 1}`)
    for (const variant of ['saved', 'focus']) {
      await page.getByLabel('Alternative', { exact: true }).selectOption(variant)
      await expect(page.getByTestId(`aznet-peering-mesh-0-${count - 1}`)).toHaveCount(0)
      await expect(page.locator('.aznet-edge-group')).toHaveCount(count * (count - 1) / 2 + count * 3 - 1)
    }
    await page.setViewportSize({ width: 2400, height: 1180 })
    await page.setContent(`<html lang="en"><title>Comparison contact sheet</title><style>
      body {margin:0;display:grid;grid-template-columns:repeat(3,800px);background:${theme === 'light' ? '#fff' : '#172b45'};color:${theme === 'light' ? '#172b45' : '#fff'};font:16px sans-serif}
      figure {margin:0} figcaption {padding:8px} img {width:800px;height:550px;display:block}
      </style>${screenshots.map(s => `<figure><figcaption>${count} regions - ${s.variant} - ${theme}</figcaption><img alt="${s.variant} comparison" src="data:image/png;base64,${s.png}"></figure>`).join('')}</html>`)
    await info.attach('comparison-contact-sheet', { body: await page.screenshot({ path: info.outputPath('comparison.png'), fullPage: true }), contentType: 'image/png' })
  })
}

for (const count of [8, 2]) for (const theme of ['light', 'dark']) {
  test(`${count} regions: ${theme} semantic alternatives preserve original inspection and expose omissions`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.goto('/verification/dense-topology-comparison.html')
    await page.getByLabel('Workload', { exact: true }).selectOption(String(count))
    await page.getByLabel('Theme', { exact: true }).selectOption(theme)
    const before = await page.getByTestId('research-original').textContent()
    const observations = []
    for (const variant of ['saved', 'focus', 'matrix', 'regions', 'neighborhood']) {
      const start = await page.evaluate(() => performance.now())
      await page.getByLabel('Alternative', { exact: true }).selectOption(variant)
      if (variant === 'saved' || variant === 'focus') await page.getByRole('button', { name: 'Fit view', exact: true }).click()
      await page.evaluate(() => {
        window.scrollTo(0, 0)
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      await page.mouse.move(0, 0)
      observations.push(await page.evaluate(({ variant, start }) => {
        const elements = [...document.querySelectorAll<HTMLElement | SVGTextElement>(
          '.research-canvas text, .research-relationship-view th, .research-relationship-view button, .research-relationship-view h3, .research-relationship-view summary')]
        const labels = elements.filter(element => {
          if (element instanceof HTMLElement && !element.checkVisibility({ checkVisibilityCSS: true })) return false
          const box = element.getBoundingClientRect()
          return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth
        }).map(element => {
          const matrix = element instanceof SVGTextElement ? element.getScreenCTM() : null
          return parseFloat(getComputedStyle(element).fontSize) * (matrix ? Math.hypot(matrix.a, matrix.b) : 1)
        }).sort((a, b) => a - b)
        return { variant, scrollY, scriptedSwitchAndSettleMs: Math.round(performance.now() - start),
          viewportLabels: labels.length, labelsAtLeast12px: labels.filter(size => size >= 12).length,
          medianScreenFontPx: labels[Math.floor(labels.length / 2)] ?? null,
          pageOverflow: document.documentElement.scrollWidth > innerWidth }
      }, { variant, start }))
      await info.attach(`semantic-${variant}`, { body: await page.screenshot({ path: info.outputPath(`semantic-${variant}.png`) }), contentType: 'image/png' })
      expect(await page.getByTestId('research-original').textContent()).toBe(before)
    }
    await info.attach('semantic-observations', { body: JSON.stringify({ count, theme, observations }, null, 2), contentType: 'application/json' })
    await page.getByLabel('Alternative', { exact: true }).selectOption('matrix')
    await expect(page.getByTestId('research-view-status')).toContainText('not drawn here')
    await page.getByTestId('matrix-hub-0-hub-1').getByRole('button').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('research-view-selection')).toContainText('"peeringId":"mesh-0-1"')
    await page.getByLabel('Relationship', { exact: true }).selectOption('bgp')
    await page.getByRole('button', { name: 'Configured: Regional hub 1 ARS to Routing appliance 2.1; inspect original appliance', exact: true }).click()
    await expect(page.getByTestId('research-view-selection')).toContainText('"vnetId":"hub-1","applianceId":"nva-1-0"')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.getByLabel('Alternative', { exact: true }).selectOption('regions')
    const region = page.getByTestId('region-westeurope')
    await expect(region.getByRole('button', { name: 'OFF: On-premises ER attachment 1', exact: true })).toBeVisible()
    await region.getByRole('button', { name: 'OFF: On-premises ER attachment 1', exact: true }).click()
    await expect(page.getByTestId('research-view-selection')).toContainText('"linkId":"er-site-0"')
    await region.locator('summary').click()
    await region.getByRole('button', { name: 'IN: map-0-0 on nva:nva-0-0', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('research-view-selection')).toContainText('"routeServerId":"ars-0"')
    await expect(page.getByTestId('research-view-selection')).toContainText('"direction":"inbound"')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.setViewportSize({ width: 390, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByLabel('Alternative', { exact: true }).selectOption('matrix')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.getByTestId('research-original').textContent()).toBe(before)
    await page.getByLabel('Fixture scenario', { exact: true }).selectOption('missing')
    await expect(page.getByTestId(`matrix-hub-0-hub-${count - 1}`)).toHaveText('Absent')
    await expect(page.getByTestId(`matrix-hub-0-hub-${count - 1}`).getByRole('button')).toHaveCount(0)
    const missing = await page.getByTestId('research-original').textContent()
    await page.getByRole('button', { name: 'Restore saved overview', exact: true }).click()
    await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible()
    await expect(page.getByLabel('Alternative', { exact: true })).toHaveValue('saved')
    expect(await page.getByTestId('research-original').textContent()).toBe(missing)
  })
}
