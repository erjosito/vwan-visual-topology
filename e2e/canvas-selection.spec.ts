import { expect, test, type Locator } from '@playwright/test'
import { example } from '../src/model'
import { sampleArsSdwanNvaCoexistence, sampleHybridVwanAndHubSpoke } from '../src/azure-net/model'

async function blankPoint(svg: Locator) {
  return svg.evaluate((element) => {
    const box = element.getBoundingClientRect()
    for (let y = Math.max(0, box.top) + 16; y < Math.min(innerHeight, box.bottom) - 48; y += 24) {
      for (let x = Math.max(0, box.left) + 16; x < Math.min(innerWidth, box.right) - 48; x += 24) {
        if (document.elementFromPoint(x, y) === element) return { x, y }
      }
    }
    throw new Error('No visible blank canvas point')
  })
}

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode}: canvas selection clears independently, preserves pans and respects inspector/menu Escape`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const topology = mode === 'vwan' ? example : sampleArsSdwanNvaCoexistence
    const storageKey = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ topology, storageKey }) => {
      localStorage.setItem(storageKey, JSON.stringify(storageKey === 'vwan-visual-topology:v1' ? topology : { sampleId: '', topology }))
    }, { topology, storageKey })
    await page.goto(`/?mode=${mode}`)
    const svg = page.locator(mode === 'vwan' ? 'svg.diagram' : '[data-testid="aznet-diagram-svg"]')
    const hub = sampleArsSdwanNvaCoexistence.vnets[0]
    const nodes = mode === 'vwan'
      ? [page.getByLabel(`Select hub ${example.hubs[0].name}`, { exact: true }),
        page.getByLabel(`Select spoke ${example.spokes[0].name}`, { exact: true })]
      : [page.getByTestId(`aznet-select-vnet-${hub.id}`), page.getByTestId(`aznet-subnet-${hub.subnets[0].id}`),
        page.getByTestId(`aznet-chip-${hub.appliances[0].id}`), page.getByTestId(`aznet-chip-${hub.routeServer!.id}`)]
    await nodes[0].waitFor()
    const original = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)
    for (const node of nodes) {
      await node.focus()
      await page.keyboard.press('Enter')
      await expect(node).toHaveAttribute('aria-pressed', 'true')
      const point = await blankPoint(svg)
      await page.mouse.click(point.x, point.y)
      await expect(node).toHaveAttribute('aria-pressed', 'false')
      await node.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      await expect(node).toHaveAttribute('aria-pressed', 'false')
    }
    const node = nodes[0]
    await node.focus()
    await page.keyboard.press('Enter')
    const point = await blankPoint(svg)
    const beforePan = await svg.getAttribute('viewBox')
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 30, point.y + 24, { steps: 4 })
    await page.mouse.up()
    await expect(svg).not.toHaveAttribute('viewBox', beforePan!)
    await expect(node).toHaveAttribute('aria-pressed', 'true')
    const cancelPoint = await blankPoint(svg)
    await page.mouse.move(cancelPoint.x, cancelPoint.y)
    await page.mouse.down()
    await page.mouse.move(cancelPoint.x + 20, cancelPoint.y + 16, { steps: 3 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(node).toHaveAttribute('aria-pressed', 'true')
    const nextObject = mode === 'vwan'
      ? page.getByRole('button', { name: `Edit connection ${example.connections[0].name}`, exact: true })
      : nodes[1]
    await nextObject.locator('text').first().click()
    await expect(nextObject).toHaveAttribute('aria-pressed', 'true')
    await node.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(node).toHaveAttribute('aria-pressed', 'true')
    const inspectorNode = mode === 'vwan' ? node : nodes[1]
    await inspectorNode.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: mode === 'vwan' ? 'BGP table' : 'Inspect Subnet Effective Routes', exact: true }).click()
    const inspector = page.locator('.canvas-overlay').last()
    await expect(inspector).toBeVisible()
    await svg.focus()
    await page.keyboard.press('Escape')
    await expect(inspectorNode).toHaveAttribute('aria-pressed', 'false')
    await expect(inspector).toBeVisible()
    await inspector.focus()
    await page.keyboard.press('Escape')
    await expect(inspector).toHaveCount(0)
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)).toEqual(original)
  })
}

function edgeTopology() {
  const topology = structuredClone(sampleHybridVwanAndHubSpoke)
  topology.vnets = topology.vnets.filter((vnet) => vnet.id !== 'vnet-vwan-spoke-1')
  topology.vwanHubs = []
  topology.erLinks = topology.erLinks.filter((link) => link.targetKind !== 'vwan-hub')
  topology.erLocations.push({ id: 'selection-location', name: 'London', globalReachEnabled: true })
  topology.erGlobalReachLinks = [{ id: 'selection-global', name: 'Metro Global Reach',
    locationAId: topology.erLocations[0].id, locationBId: 'selection-location', enabled: true }]
  topology.sites.push({ id: 'selection-branch', name: 'Branch', asn: 65091, prefixes: ['172.31.0.0/16'] })
  const hub = topology.vnets.find((vnet) => vnet.id === 'vnet-legacy-hub')!
  hub.gateways.push({ id: 'selection-vpn-gw', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true })
  topology.vpnConnections.push({ id: 'selection-vpn', name: 'Branch VPN', siteId: 'selection-branch',
    targetKind: 'vnet-gateway', targetId: 'selection-vpn-gw', bgpEnabled: true, enabled: true })
  topology.siteLinks.push({ id: 'selection-wan', name: 'WAN mesh', siteAId: topology.sites[0].id,
    siteBId: 'selection-branch', enabled: true })
  topology.erLinks.find((link) => link.id === 'erlink-fra-dc')!.enabled = false
  Object.assign(hub, { x: 120, y: 100 })
  Object.assign(topology.vnets[1], { x: 700, y: 60 })
  topology.erLocations.forEach((location, index) => Object.assign(location, { x: 60 + index * 700, y: 540 }))
  topology.sites.forEach((site, index) => Object.assign(site, { x: 60 + index * 700, y: 850 }))
  return topology
}

async function edgeContrast(path: Locator) {
  return path.evaluate((element) => {
    const rgb = (color: string) => color.startsWith('#')
      ? [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16))
      : color.match(/[\d.]+/g)!.map(Number)
    const luminance = (color: string) => rgb(color).slice(0, 3).map((value) => {
      const channel = value / 255
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const foreground = luminance(getComputedStyle(element).stroke)
    const shell = element.closest('.aznet-canvas-shell')!
    return [getComputedStyle(shell).backgroundColor, getComputedStyle(shell).getPropertyValue('--grid').trim()].map((background) => {
      const behind = luminance(background)
      return (Math.max(foreground, behind) + .05) / (Math.min(foreground, behind) + .05)
    })
  })
}

for (const theme of ['light', 'dark']) {
  for (const mode of ['hub-spoke', 'full']) {
    test(`${theme} ${mode}: canvas selection preserves edge meaning, contrast and keyboard focus without pointer outlines`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.addInitScript((topology) => {
        localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      }, edgeTopology())
      await page.goto(`/?mode=${mode}`)
      await page.getByLabel('Theme', { exact: true }).selectOption(theme)
      await page.getByRole('button', { name: 'Fit view', exact: true }).click()
      const svg = page.getByTestId('aznet-diagram-svg')
      const er = page.getByTestId('aznet-erlink-erlink-leghub-fra')
      const edges = [er, page.getByTestId('aznet-peering-peer-leg-hub-spoke'), page.getByTestId('aznet-vpnconn-selection-vpn'),
        page.getByTestId('aznet-sitelink-selection-wan'), page.getByTestId('aznet-ergrlink-selection-global'),
        page.getByTestId('aznet-erlink-erlink-fra-dc')]
      for (const edge of edges) {
        const path = edge.locator('.aznet-edge-path')
        const stroke = await path.evaluate((element) => getComputedStyle(element).stroke)
        const dash = await path.getAttribute('stroke-dasharray')
        await edge.locator('text').hover()
        expect(Math.min(...await edgeContrast(path))).toBeGreaterThanOrEqual(3)
        await edge.focus()
        await page.keyboard.press('Enter')
        await expect(edge).toHaveAttribute('aria-pressed', 'true')
        await expect(edge.locator('.canvas-edge-selection')).toHaveCount(1)
        await expect(path).toHaveCSS('stroke', stroke)
        expect(await path.getAttribute('stroke-dasharray')).toBe(dash)
        expect(Math.min(...await edgeContrast(path))).toBeGreaterThanOrEqual(3)
        await page.keyboard.press('Escape')
        await expect(edge).toHaveAttribute('aria-pressed', 'false')
        await expect(edge.locator('.canvas-edge-selection')).toHaveCount(0)
        await expect(path).toHaveCSS('stroke', stroke)
      }
      await er.locator('text').click()
      await expect(er).toHaveAttribute('aria-pressed', 'true')
      expect(await er.evaluate((element) => element.matches(':focus-visible'))).toBe(false)
      await expect(er).toHaveCSS('outline-style', 'none')
      const point = await blankPoint(svg)
      await page.mouse.click(point.x, point.y)
      await expect(er).toHaveAttribute('aria-pressed', 'false')
      await er.focus()
      await page.keyboard.press('Enter')
      await expect(er).toHaveCSS('outline-style', 'solid')
      expect(await er.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
      await edges[2].focus()
      await page.keyboard.press('Enter')
      await expect(er).toHaveAttribute('aria-pressed', 'false')
      await expect(er.locator('.canvas-edge-selection')).toHaveCount(0)
      for (const zoom of ['0.65', '1', '1.6']) {
        await page.getByLabel('Canvas zoom', { exact: true }).selectOption(zoom)
        await expect(edges[2].locator('.canvas-edge-selection')).toHaveAttribute('vector-effect', 'non-scaling-stroke')
        expect(Math.min(...await edgeContrast(edges[2].locator('.aznet-edge-path')))).toBeGreaterThanOrEqual(3)
      }
      await page.getByRole('button', { name: 'Fit view', exact: true }).click()
      await expect(edges[2].locator('.canvas-edge-selection')).toHaveCount(1)
      const screenshot = testInfo.outputPath(`${mode}-${theme}-edge-selection.png`)
      await page.screenshot({ path: screenshot })
      await testInfo.attach('Themed edge selection', { path: screenshot, contentType: 'image/png' })
      await page.getByRole('button', { name: /Clear highlights & icons/ }).click()
      await expect(edges[2]).toHaveAttribute('aria-pressed', 'false')
    })
  }
}
