import { expect, test } from '@playwright/test'
import { example } from '../src/model'
import { sampleHybridVwanAndHubSpoke, sampleArsSdwanNvaCoexistence } from '../src/azure-net/model'

const styleKey = 'aznet-canvas-style:v1'

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode} keeps long node headers inside shared badges and label bounds`, async ({ page }, testInfo) => {
    const topology = mode === 'vwan' ? structuredClone(example) : structuredClone(sampleHybridVwanAndHubSpoke)
    const nodes = 'hubs' in topology ? [...topology.hubs, ...topology.spokes, ...topology.sites, ...(topology.erLocations ?? [])] :
      [...topology.vnets, ...topology.vwanHubs, ...topology.sites, ...topology.erLocations]
    for (const node of nodes) node.name = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' + ' 長い名前'
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
    }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    const svg = page.locator(mode === 'vwan' ? 'svg.diagram' : '[data-testid="aznet-diagram-svg"]')
    await expect(svg.locator('.network-node-badge').first()).toBeVisible()
    const original = await page.evaluate((key) => localStorage.getItem(key), key)
    await page.getByRole('button', { name: 'Fit view', exact: true }).click()
    const labels = svg.locator('.network-node-label')
    expect(await labels.count()).toBeGreaterThan(5)
    expect(await labels.evaluateAll((elements) => elements.filter((element) => {
      const text = element.querySelector('text')!
      const clip = element.querySelector('clipPath rect') as SVGRectElement
      return text.getComputedTextLength() > clip.width.baseVal.value + 1
    }).map((element) => element.textContent))).toEqual([])
    const nameLabel = labels.filter({ hasText: '長い名前' }).first()
    await expect(nameLabel.locator('text')).toContainText('…')
    expect(await nameLabel.locator('title').textContent()).toContain('長い名前')
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme)
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${theme}-node-labels.png`), fullPage: true })
    }
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
  })
}

test('wrapped device badges expose every appliance and disabled ARS without covering subnets', async ({ page }) => {
  const topology = structuredClone(sampleArsSdwanNvaCoexistence)
  const hub = topology.vnets.find((vnet) => vnet.routeServer)!
  hub.routeServer!.enabled = false
  const appliance = hub.appliances[0]
  hub.appliances = Array.from({ length: 7 }, (_, index) => ({ ...appliance, id: `badge-nva-${index}`, name: `Device ${index}`, privateIp: `10.0.2.${index + 10}` }))
  hub.routeServer!.peerApplianceIds = []
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.goto('/?mode=hub-spoke')
  const card = page.getByTestId(`aznet-vnet-${hub.id}`)
  const chips = card.locator('.network-device-chip')
  await expect(chips).toHaveCount(hub.gateways.length + 8)
  await expect(page.getByTestId(`aznet-chip-${hub.routeServer!.id}`)).toHaveAttribute('data-disabled', 'true')
  const geometry = await card.evaluate((node) => {
    const frame = node.querySelector(':scope > rect')!.getBoundingClientRect()
    const badges = [...node.querySelectorAll('.network-device-chip > g > rect')].map((badge) => badge.getBoundingClientRect())
    const subnets = [...node.querySelectorAll('[data-testid^="aznet-subnet-"] > rect')].map((row) => row.getBoundingClientRect())
    return {
      outside: badges.some((badge) => badge.left < frame.left || badge.right > frame.right || badge.bottom > frame.bottom),
      overlap: badges.some((badge) => subnets.some((row) => badge.top < row.bottom && badge.bottom > row.top)),
      rows: new Set(badges.map((badge) => badge.top)).size,
    }
  })
  expect(geometry.outside).toBe(false)
  expect(geometry.overlap).toBe(false)
  expect(geometry.rows).toBeGreaterThan(1)
  const last = page.getByTestId('aznet-chip-badge-nva-6')
  await last.focus()
  await expect(last).toBeFocused()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Inspect Appliance Subnet Effective Routes', exact: true })).toBeVisible()
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode} shares canvas presets, restores its viewport and keeps presentation out of topology JSON`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    if (mode === 'vwan') {
      await page.addInitScript((topology) => {
        if (!localStorage.getItem('vwan-visual-topology:v1')) localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
      }, { ...example, layout: { mode: 'layered', positions: { layered: { eu: { x: 420, y: 300 } } } } })
    }
    await page.goto(`/?mode=${mode}${mode === 'vwan' ? '' : '&sample=hub-spoke-firewall-udr'}`)
    const shell = page.locator('.simulator-shell')
    const canvas = mode === 'vwan' ? page.locator('.canvas-stage') : page.getByTestId('aznet-canvas-shell')
    const svg = mode === 'vwan' ? page.locator('svg.diagram') : page.getByTestId('aznet-diagram-svg')
    const diagramViewport = mode === 'vwan' ? page.locator('.diagram-scroll') : svg
    const controls = page.getByRole('group', { name: 'Canvas controls', exact: true })
    const topologyKey = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), topologyKey)).not.toBeNull()
    const original = await page.evaluate((key) => localStorage.getItem(key), topologyKey)
    await expect(shell).toHaveAttribute('data-canvas-style', 'grid')
    await expect(svg.locator('[data-canvas-pattern="grid"] path')).toHaveCount(1)
    let bounds = (await canvas.boundingBox())!
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(1440)
    await expect(controls).toBeVisible()
    await expect(controls.getByLabel('Canvas style', { exact: true })).toBeVisible()
    const initialViewport = (await diagramViewport.boundingBox())!
    expect(initialViewport.y + initialViewport.height).toBeLessThanOrEqual((await controls.boundingBox())!.y)

    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(page.getByLabel('Canvas zoom')).toHaveValue(mode === 'vwan' ? '1.25' : '1.15')
    const initialView = await svg.getAttribute('viewBox')
    bounds = (await canvas.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width - 12, bounds.y + 12)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width - 70, bounds.y + 45, { steps: 4 })
    await page.mouse.up()
    await expect(svg).not.toHaveAttribute('viewBox', initialView!)
    await page.getByRole('button', { name: 'Reset view', exact: true }).click()
    await expect(page.getByLabel('Canvas zoom')).toHaveValue('1')
    await expect(svg).toHaveAttribute('viewBox', /^0 0 /)
    const originalPaths = await svg.locator(mode === 'vwan' ? '.network-link' : '.aznet-edge-path').evaluateAll((edges) => edges.map((edge) => edge.getAttribute('d')))
    await page.getByLabel('Connection style', { exact: true }).selectOption(mode === 'vwan' ? 'straight' : 'curved')
    await expect.poll(() => svg.locator(mode === 'vwan' ? '.network-link' : '.aznet-edge-path').evaluateAll((edges) => edges.map((edge) => edge.getAttribute('d')))).not.toEqual(originalPaths)
    await expect(svg.locator('.node-icon image').first()).toBeVisible()
    await page.getByRole('button', { name: 'Fit view', exact: true }).click()
    const fittedBox = await svg.getAttribute('viewBox')
    await expect(svg).not.toHaveAttribute('viewBox', /^0 0 /)
    const fitErrors = await svg.evaluate((node) => {
      const svgBounds = node.getBoundingClientRect()
      return [...node.querySelectorAll<SVGGElement>('g[role="button"][data-testid]')]
        .filter((element) => /^(?:node-|aznet-(?:vnet|vwan-hub|erloc|site)-)/.test(element.dataset.testid ?? ''))
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.x < svgBounds.x - 1 || box.y < svgBounds.y - 1 ||
          box.right > svgBounds.right + 1 || box.bottom > svgBounds.bottom + 1).length
    })
    expect(fitErrors).toBe(0)
    expect(await page.evaluate((key) => localStorage.getItem(key), topologyKey)).toBe(original)
    await page.getByRole('button', { name: 'Reset view', exact: true }).click()
    await expect(svg).not.toHaveAttribute('viewBox', fittedBox!)
    await expect(svg).toHaveAttribute('viewBox', /^0 0 /)

    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme)
      await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
      await expect(svg.locator('[data-canvas-pattern="dots"] circle')).toHaveCount(1)
      await expect(canvas).toHaveCSS('border-radius', '12px')
      bounds = (await canvas.boundingBox())!
      expect(bounds.x).toBe(14)
      expect(bounds.width).toBe(1412)
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${theme}-framed.png`), fullPage: true })
      await page.getByLabel('Canvas style', { exact: true }).selectOption('grid')
      await expect(canvas).toHaveCSS('border-radius', '0px')
    }
    await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
    await page.reload()
    await expect(shell).toHaveAttribute('data-canvas-style', 'dots')
    await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
    await expect(page.getByLabel('Connection style', { exact: true })).toHaveValue(mode === 'vwan' ? 'straight' : 'curved')
    expect(await page.evaluate((key) => localStorage.getItem(key), topologyKey)).toBe(original)
    await page.getByRole('button', { name: 'Maximize canvas', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Restore panels', exact: true })).toBeVisible()
    expect((await canvas.boundingBox())!.height).toBeGreaterThan(960)
    await page.setViewportSize({ width: 360, height: 800 })
    const controlBounds = (await controls.boundingBox())!
    expect(controlBounds.x).toBeGreaterThanOrEqual(0)
    expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(360)
    const maximizeBounds = (await page.getByRole('button', { name: 'Restore panels', exact: true }).boundingBox())!
    expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(maximizeBounds.x)
    const compactViewport = (await diagramViewport.boundingBox())!
    expect(compactViewport.y + compactViewport.height).toBeLessThanOrEqual(controlBounds.y)
    await page.getByLabel('Canvas style', { exact: true }).selectOption('grid')
    await expect(shell).toHaveAttribute('data-canvas-style', 'grid')
    await page.getByRole('button', { name: 'Restore panels', exact: true }).click()
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByLabel('Canvas style', { exact: true })).toBeVisible()
  })
}

test('canvas style survives mode changes and synchronizes tabs without sharing transient maximization', async ({ page, context }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
  await page.getByLabel('Connection style', { exact: true }).selectOption('straight')
  for (const mode of ['hub-spoke', 'full', 'vwan']) {
    await page.getByTestId(`simulator-mode-${mode}`).click()
    await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
    await expect(page.getByLabel('Connection style', { exact: true })).toHaveValue('straight')
    await expect(page.locator('[data-canvas-pattern="dots"] circle')).toHaveCount(1)
  }
  const second = await context.newPage()
  await second.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')
  await expect(second.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
  await expect(second.getByLabel('Connection style', { exact: true })).toHaveValue('straight')
  await second.getByLabel('Connection style', { exact: true }).selectOption('curved')
  await expect(page.getByLabel('Connection style', { exact: true })).toHaveValue('curved')
  await page.getByRole('button', { name: 'Maximize canvas', exact: true }).click()
  await expect(second.getByRole('button', { name: 'Maximize canvas', exact: true })).toBeVisible()
  await second.getByLabel('Canvas style', { exact: true }).selectOption('grid')
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('grid')
  await expect(page.getByLabel('Connection style', { exact: true })).toHaveValue('curved')
  await second.getByLabel('Canvas style', { exact: true }).selectOption('dots')
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('dots')
  await second.evaluate((key) => { localStorage.removeItem(key) }, styleKey)
  await expect(page.locator('.simulator-shell')).toHaveAttribute('data-canvas-style', 'grid')
  await second.evaluate(() => localStorage.removeItem('aznet-connection-style:v1'))
  await expect(page.getByLabel('Connection style', { exact: true })).toHaveValue('default')
})

test('invalid preferences and unavailable storage safely fall back to grid while allowing in-session changes', async ({ page }) => {
  await page.addInitScript((key) => {
    try { localStorage.setItem(key, 'unsupported') } catch { /* The later storage-denial script may already be installed. */ }
  }, styleKey)
  await page.goto('/?mode=vwan')
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('grid')
  await page.evaluate(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable') }
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable') }
  })
  await page.getByLabel('Canvas style', { exact: true }).selectOption('dots')
  await page.getByLabel('Connection style', { exact: true }).selectOption('straight')
  await expect(page.getByLabel('Connection style', { exact: true })).toHaveValue('straight')
  await expect(page.locator('.simulator-shell')).toHaveAttribute('data-canvas-style', 'dots')
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable') }
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable') }
  })
  await page.reload()
  await expect(page.getByLabel('Canvas style', { exact: true })).toHaveValue('grid')
})

test('Full Hybrid fits off-screen saved nodes and resets only layout in one undoable edit', async ({ page }) => {
  const topology = structuredClone(sampleHybridVwanAndHubSpoke)
  topology.vnets[0].x = 1800
  topology.vnets[0].y = 1200
  await page.addInitScript((value) => localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value })), topology)
  await page.goto('/?mode=full')
  const key = 'aznet-visual-topology:v1'
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).topology, key)
  await page.getByRole('button', { name: 'Fit view', exact: true }).click()
  const visible = await page.getByTestId('aznet-vnet-' + topology.vnets[0].id).boundingBox()
  const viewport = await page.getByTestId('aznet-diagram-svg').boundingBox()
  expect(visible!.x).toBeGreaterThanOrEqual(viewport!.x)
  expect(visible!.y + visible!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height)
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click()
  const expected = structuredClone(before)
  for (const node of [...expected.vnets, ...expected.vwanHubs, ...expected.erLocations, ...expected.sites]) {
    delete node.x; delete node.y
  }
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).topology, key)).toEqual(expected)
  await page.getByTitle('Undo', { exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).topology, key)).toEqual(before)
})
