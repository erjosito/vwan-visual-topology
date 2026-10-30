import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { example } from '../src/model'
import type { Topology } from '../src/model'

const readTopology = (page: Page): Promise<Topology> => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
interface MotionEdge { id: string; from: string; to: string }
const motionFlows = (page: Page): Promise<MotionEdge[][]> => page.locator('.path-flow').evaluateAll((elements) =>
  elements.map((element) => JSON.parse(element.getAttribute('data-segments')!)))
async function motionDirections(page: Page, id: string) {
  const directions = (await motionFlows(page)).flat().filter((edge) => edge.id === id).map(({ from, to }) => ({ from, to }))
  return [...new Map(directions.map((direction) => [JSON.stringify(direction), direction])).values()]
}
const importTopology = (page: Page, topology: Topology) => page.getByLabel('Import topology file').setInputFiles({
  name: 'topology.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
})
async function action(page: Page, object: string, command: string) {
  await page.getByLabel(object, { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menu').getByRole('menuitem', { name: command, exact: true }).click()
}
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })
async function showRoutes(page: Page, hub = 'Europe hub') { await action(page, `Select hub ${hub}`, 'BGP table') }
async function createMap(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create route map', exact: true }).click()
  await page.getByLabel('Route map name', { exact: true }).fill(name)
}
async function downloadTopology(page: Page, button = 'Export JSON'): Promise<Topology> {
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of (await (await event).createReadStream())!) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function pathMenu(page: Page, object: string, direction: 'to' | 'from', endpoint: string) {
  await page.getByLabel(object, { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: `Show path ${direction}`, exact: true }).hover()
  await page.getByRole('menu', { name: `Show path ${direction}`, exact: true }).getByRole('menuitem', { name: endpoint, exact: true }).hover()
  return page.getByRole('menu', { name: endpoint, exact: true })
}
async function groupPath(page: Page, object: string, direction: 'to' | 'from', group: string) {
  await action(page, object, `Show path ${direction}`)
  await page.getByRole('menu', { name: `Show path ${direction}`, exact: true }).getByRole('menuitem', { name: group, exact: true }).click()
}

test('tab icon resolves to a browser-decodable SVG rather than the app fallback', async ({ page }) => {
  await page.goto('/')
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute('type', 'image/svg+xml')
  const url = await icon.evaluate((link) => (link as HTMLLinkElement).href)
  const response = await page.request.get(url)
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('image/svg+xml')
  expect(await page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    return image.naturalWidth > 0 && image.naturalHeight > 0
  }, url)).toBe(true)
})

test('File issue opens the repository issue form in a new tab without changing or sharing the workspace', async ({ page }) => {
  await page.goto('/')
  const topology = await readTopology(page)
  const url = page.url()
  const issueUrl = 'https://github.com/erjosito/vwan-visual-topology/issues/new'
  await page.context().route(issueUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<title>New issue</title>' }))
  const link = page.getByRole('link', { name: 'File issue', exact: true })
  await expect(link).toHaveAttribute('href', issueUrl)
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  const popup = page.waitForEvent('popup')
  await link.click()
  const issuePage = await popup
  await expect(issuePage).toHaveURL(issueUrl)
  await issuePage.close()
  expect(page.url()).toBe(url)
  expect(await readTopology(page)).toEqual(topology)
})

test('canvas hubs and spokes render official Azure SVG icons in both layouts', async ({ page }) => {
  await page.goto('/')
  for (const [kind, count] of [['hub', example.hubs.length], ['spoke', example.spokes.length]] as const) {
    const icons = page.locator(`.node-icon.${kind} image`)
    await expect(icons).toHaveCount(count)
    const url = await icons.first().getAttribute('href')
    expect(await page.evaluate(async (url) => {
      const image = new Image()
      image.src = url
      await image.decode()
      return image.naturalWidth > 0 && image.naturalHeight > 0
    }, url!)).toBe(true)
    await expect(icons.first()).toBeVisible()
  }
  await page.getByLabel('Visualization').selectOption('constellation')
  await expect(page.locator('.node-icon.hub image').first()).toBeVisible()
  await expect(page.locator('.node-icon.spoke image').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/official-azure-canvas-icons.png', fullPage: true })
})

test('zoom buttons stay synchronized and nodes can use both canvas sides in either layout', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.getByLabel('Canvas zoom')).toHaveValue('1.25')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled()
  await page.getByLabel('Canvas zoom').selectOption('0.75')
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.getByLabel('Canvas zoom')).toHaveValue('1')
  for (const mode of ['layered', 'constellation']) {
    await page.getByLabel('Visualization mode').selectOption(mode)
    const dimensions = await page.locator('svg.diagram').evaluate((element) => {
      const svg = element as SVGSVGElement, bounds = svg.getBoundingClientRect()
      const origin = new DOMPoint(0, 0).matrixTransform(svg.getScreenCTM()!)
      const end = new DOMPoint(svg.viewBox.baseVal.width, svg.viewBox.baseVal.height).matrixTransform(svg.getScreenCTM()!)
      return { width: svg.viewBox.baseVal.width, leftGap: origin.x - bounds.left, rightGap: bounds.right - end.x }
    })
    expect(Math.abs(dimensions.leftGap)).toBeLessThan(1)
    expect(Math.abs(dimensions.rightGap)).toBeLessThan(1)
    const hub = page.locator('[data-node-id="eu"]')
    const [x] = (await hub.getAttribute('transform'))!.match(/[\d.]+/g)!.map(Number)
    await dragNode(page, 'eu', dimensions.width - 145 - x, 0); await page.mouse.up()
    const position = (await readTopology(page)).layout!.positions[mode as 'layered' | 'constellation']!.eu
    expect(position.x).toBeCloseTo(dimensions.width - 145, 0)
    const bounds = (await hub.boundingBox())!, canvas = (await page.locator('svg.diagram').boundingBox())!
    expect(bounds.x + bounds.width / 2).toBeGreaterThan(canvas.x + canvas.width * 0.8)
    await dragNode(page, 'eu', 125 - position.x, 0); await page.mouse.up()
    expect((await readTopology(page)).layout!.positions[mode as 'layered' | 'constellation']!.eu.x).toBe(125)
  }
})

test('highlighted paths stream larger circles end to end at constant speed in either direction and layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.locator('.path-flow-circle')).toHaveCount(0)
  for (const layout of ['layered', 'constellation']) {
    await page.getByLabel('Visualization mode').selectOption(layout)
    for (const reverse of [false, true]) {
      await page.getByLabel('Canvas zoom').selectOption(reverse ? '1.5' : '1')
      await (await pathMenu(page, reverse ? 'Select spoke Americas applications' : 'Select spoke Europe applications', 'to',
        reverse ? 'Europe applications (spoke)' : 'Americas applications (spoke)'))
        .getByRole('menuitem', { name: reverse ? '10.1.0.0/16' : '10.2.0.0/16', exact: true }).click()
      if (reverse) {
        await page.getByLabel('Select hub Europe hub', { exact: true }).focus()
        await page.keyboard.press('Alt+ArrowDown')
      }
      await expect(page.locator('.path-flow')).toHaveCount(1)
      expect(await page.locator('.path-flow-circle').count()).toBeGreaterThan(1)
      const source = reverse ? 'us' : 'eu', destination = reverse ? 'eu' : 'us'
      expect(await motionFlows(page)).toEqual([[
        { id: `${source}-apps`, from: `${source}-apps`, to: source },
        { id: 'interhub:eu:us', from: source, to: destination },
        { id: `${destination}-apps`, from: destination, to: `${destination}-apps` },
      ]])
      const movement = await page.locator('.path-flow').evaluate(async (element, { source, destination, reverse }) => {
        const svg = element.ownerSVGElement!, track = element.querySelector<SVGPathElement>('.path-flow-track')!
        const circle = element.querySelector<SVGCircleElement>('circle')!, animation = circle.querySelector('animateMotion')!
        svg.pauseAnimations()
        const start = animation.getStartTime(), duration = animation.getSimpleDuration()
        const transform = track.getScreenCTM()!, scale = Math.hypot(transform.a, transform.b), errors: number[] = []
        const sample = async (seconds: number, expected: DOMPoint) => {
          svg.setCurrentTime(start + seconds)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const actual = new DOMPoint().matrixTransform(circle.getScreenCTM()!)
          const target = expected.matrixTransform(transform)
          errors.push(Math.hypot(actual.x - target.x, actual.y - target.y))
        }
        let distance = 0, previous: DOMPoint | undefined
        for (const [testId, backwards] of [
          [`spoke-link-${source}-apps`, false], ['interhub-eu-us', reverse], [`spoke-link-${destination}-apps`, true],
        ] as const) {
          const edge = svg.querySelector<SVGPathElement>(`[data-testid="${testId}"]`)!, length = edge.getTotalLength()
          const first = edge.getPointAtLength(backwards ? length : 0)
          if (previous) distance += Math.hypot(first.x - previous.x, first.y - previous.y)
          await sample((distance + length / 2) * scale / 200, edge.getPointAtLength(length / 2))
          distance += length
          previous = edge.getPointAtLength(backwards ? 0 : length)
        }
        for (const fraction of [0.99, 1.02]) {
          await sample(duration * fraction, track.getPointAtLength(track.getTotalLength() * (fraction % 1)))
        }
        const circles = element.querySelectorAll<SVGCircleElement>('circle'), interval = duration / circles.length
        await sample(interval * 1.1, track.getPointAtLength(track.getTotalLength() * 1.1 / circles.length))
        const newest = new DOMPoint().matrixTransform(circles[circles.length - 1].getScreenCTM()!)
        const expected = track.getPointAtLength(track.getTotalLength() * 0.1 / circles.length).matrixTransform(transform)
        errors.push(Math.hypot(newest.x - expected.x, newest.y - expected.y))
        svg.unpauseAnimations()
        return {
          speed: track.getTotalLength() * scale / duration, errors, radius: circle.r.baseVal.value,
          pointerEvents: getComputedStyle(circle).pointerEvents, totalLength: track.getTotalLength(), distance, interval,
        }
      }, { source, destination, reverse })
      expect(movement.speed).toBeCloseTo(200, 1)
      expect(movement.radius).toBeGreaterThanOrEqual(6)
      expect(movement.pointerEvents).toBe('none')
      expect(movement.totalLength).toBeCloseTo(movement.distance, 0)
      expect(movement.interval).toBeLessThanOrEqual(0.651)
      expect(Math.max(...movement.errors)).toBeLessThan(2)
    }
  }
  await page.getByLabel('Canvas zoom').selectOption('1')
  await page.getByLabel('Canvas zoom').evaluate((element) => element.blur())
  await expect.poll(() => page.locator('.path-flow').evaluate(async (element) => {
    const svg = element.ownerSVGElement!, animation = element.querySelector('animateMotion')!
    const first = svg.querySelector<SVGPathElement>('[data-testid="spoke-link-us-apps"]')!
    const scale = Math.hypot(first.getScreenCTM()!.a, first.getScreenCTM()!.b)
    svg.pauseAnimations()
    svg.setCurrentTime(animation.getStartTime() + first.getTotalLength() / 2 * scale / 200)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const actual = new DOMPoint().matrixTransform(element.querySelector('circle')!.getScreenCTM()!)
    const expected = first.getPointAtLength(first.getTotalLength() / 2).matrixTransform(first.getScreenCTM()!)
    return Math.hypot(actual.x - expected.x, actual.y - expected.y)
  })).toBeLessThan(2)
  await page.screenshot({ path: 'test-results/constant-speed-path-circles.png', fullPage: true })
  await page.locator('svg.diagram').evaluate((element) => (element as SVGSVGElement).unpauseAnimations())
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  await expect(page.locator('.path-flow-circle')).toHaveCount(0)
})

test('static VPN traces highlight the final downstream site link and its traffic direction', async ({ page }) => {
  const topology = structuredClone(example)
  topology.connections = [topology.connections[1]]
  topology.connections[0].routes = []
  topology.sites = [
    { id: 'dc', name: 'VPN transit site', asn: 65010, prefixes: ['10.20.0.0/16'],
      vpnStaticRoutes: [{ id: 'static-destination', prefix: '10.80.0.0/16', connectionId: 'vpn-eu' }] },
    { id: 'destination', name: 'Downstream site', asn: 65050, prefixes: ['10.80.0.0/16'] },
  ]
  topology.siteLinks = [{
    id: 'last-hop', name: 'Downstream WAN', a: 'destination', b: 'dc', enabled: true,
    aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] },
  }]
  await page.goto('/'); await importTopology(page, topology)
  for (const layout of ['layered', 'constellation']) {
    await page.getByLabel('Visualization mode').selectOption(layout)
    await (await pathMenu(page, 'Select spoke Americas applications', 'to', 'Downstream site (site)'))
      .getByRole('menuitem', { name: '10.80.0.0/16', exact: true }).click()
    await expect(page.getByTestId('peer-link-last-hop')).toHaveClass(/preferred-link/)
    await expect.poll(() => motionDirections(page, 'last-hop')).toEqual([{ from: 'dc', to: 'destination' }])
    await expect(page.locator('.path-flow')).toHaveCount(1)
    expect((await motionFlows(page))[0].map((edge) => edge.id)).toEqual(['us-apps', 'interhub:eu:us', 'vpn-eu', 'last-hop'])
    await groupPath(page, 'Select site Downstream site', 'from', 'All Azure VNets')
    await expect(page.getByTestId('peer-link-last-hop')).toHaveClass(/preferred-link/)
    await expect.poll(() => motionDirections(page, 'last-hop')).toEqual([{ from: 'dc', to: 'destination' }])
  }
})

test('grouped paths deduplicate complete routes, show both directions and respect reduced motion', async ({ page }) => {
  const topology = structuredClone(example)
  topology.connections[2].siteId = 'dc'
  topology.connections[2].routes = [{ id: 'second-destination', prefix: '10.50.0.0/16', asPath: [65010], kind: 'bgp' }]
  await page.goto('/'); await importTopology(page, topology)
  await expect.poll(async () => (await readTopology(page)).connections[2].routes[0].prefix).toBe('10.50.0.0/16')
  await groupPath(page, 'Select site London datacenter', 'from', 'All Azure VNets')
  await expect.poll(async () => (await motionDirections(page, 'interhub:eu:us')).map((edge) => edge.from).sort()).toEqual(['eu', 'us'])
  const flows = await motionFlows(page)
  expect(new Set(flows.map((flow) => JSON.stringify(flow))).size).toBe(flows.length)
  const circles = await page.locator('.path-flow-circle').count()
  expect(circles).toBeGreaterThan(flows.length)
  const destinationColor = await page.locator('[data-node-id="dc"]').getAttribute('data-destination-color')
  expect(destinationColor).toBeTruthy()
  const speeds = await page.locator('.path-flow').evaluateAll((elements) => elements.map((element) => {
    const track = element.querySelector<SVGPathElement>('path')!, transform = track.getScreenCTM()!
    return track.getTotalLength() * Math.hypot(transform.a, transform.b) / element.querySelector('animateMotion')!.getSimpleDuration()
  }))
  for (const speed of speeds) expect(speed).toBeCloseTo(200, 1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.path-flow-circle')).toHaveCount(0)
  await expect(page.locator('animateMotion')).toHaveCount(0)
  await expect(page.getByTestId('interhub-eu-us')).toHaveClass(/preferred-link/)
  await expect(page.locator('[data-node-id="dc"]')).toHaveAttribute('data-destination-color', destinationColor!)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('.path-flow-circle')).toHaveCount(circles)
  await expect(page.locator('animateMotion')).toHaveCount(circles)
})

test('destination streams share sequential palette colors with node backgrounds, reuse ECMP colors and wrap after twenty', async ({ page }) => {
  const topology = structuredClone(example)
  topology.hubs = [topology.hubs[0]]
  topology.spokes = [topology.spokes[0]]
  topology.sites = Array.from({ length: 21 }, (_, i) => ({
    id: `target-${i}`, name: `Destination ${i + 1}`, asn: 65010 + i, prefixes: [`10.${80 + i}.0.0/16`],
  }))
  topology.connections = topology.sites.map((site, i) => ({
    id: `vpn-${i}`, name: `VPN to ${site.name}`, hubId: 'eu', siteId: site.id, transport: 'VPN',
    enabled: true, learnSiteRoutes: true, routes: [], inbound: [], outbound: [],
  }))
  topology.connections.push({ ...topology.connections[0], id: 'alternate-vpn', name: 'Alternate VPN to Destination 1' })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/'); await importTopology(page, topology)
  const original = await readTopology(page)
  const normalFills = await page.locator('[data-node-id^="target-"] > rect').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).fill))
  await groupPath(page, 'Select spoke Europe applications', 'to', 'All onprem sites')
  await expect(page.locator('.path-flow')).toHaveCount(22)
  const nodes = await page.locator('[data-node-id^="target-"]').evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-node-id')!, color: getComputedStyle(element).color,
    fill: getComputedStyle(element.querySelector(':scope > rect')!).fill,
  })))
  expect(new Set(nodes.slice(0, 20).map((node) => node.color)).size).toBe(20)
  expect(nodes[20].color).toBe(nodes[0].color)
  nodes.forEach((node, i) => expect(node.fill).not.toBe(normalFills[i]))
  const streams = await page.locator('.path-flow').evaluateAll((elements) => elements.map((element) => ({
    destination: element.getAttribute('data-destination-id'),
    colors: [...element.querySelectorAll('circle')].map((circle) => getComputedStyle(circle).fill),
  })))
  for (const stream of streams) {
    expect(stream.colors.length).toBeGreaterThan(1)
    expect(new Set(stream.colors)).toEqual(new Set([nodes.find((node) => node.id === stream.destination)!.color]))
  }
  expect(streams.filter((stream) => stream.destination === 'target-0')).toHaveLength(2)
  expect(await readTopology(page)).toEqual(original)
  await page.getByLabel('Visualization mode').selectOption('constellation')
  await page.getByLabel('Canvas zoom').selectOption('1.25')
  expect(await page.locator('[data-node-id^="target-"]').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color)))
    .toEqual(nodes.map((node) => node.color))
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  await expect(page.locator('[data-destination-color]')).toHaveCount(0)
  await expect(page.locator('.path-flow-circle')).toHaveCount(0)

  topology.sites = topology.sites.slice(0, 5)
  topology.connections = topology.connections.filter((connection) => topology.sites.some((site) => site.id === connection.siteId))
  await importTopology(page, topology)
  await page.getByLabel('Canvas zoom').selectOption('1')
  await page.getByLabel('Visualization mode').selectOption('constellation')
  await groupPath(page, 'Select spoke Europe applications', 'to', 'All onprem sites')
  await expect(page.locator('[data-destination-color]')).toHaveCount(5)
  await page.locator('svg.diagram').evaluate((element) => {
    const svg = element as SVGSVGElement
    svg.pauseAnimations()
    svg.setCurrentTime(svg.getCurrentTime() + 1)
  })
  await page.screenshot({ path: 'test-results/destination-colored-streams.png', fullPage: true })
})

test('ER locations connect hubs and sites, expose filtered advertisements, trace both legs and persist safely', async ({ page }) => {
  const topology = structuredClone(example)
  topology.sites[0].prefixes = ['10.20.0.0/16']
  topology.hubs[1].preference = 'ExpressRoute'
  topology.connections[0].hubId = 'us'
  topology.connections[0].siteId = 'ny'
  topology.connections[0].routes = [{ id: 'remote-er-ad', prefix: '10.30.0.0/16', asPath: [12076, 65020], kind: 'bgp' }]
  await page.goto('/'); await importTopology(page, topology)
  await page.getByRole('button', { name: '+ ER location', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Frankfurt ER')
  await page.getByRole('button', { name: 'Create object', exact: true }).click()
  const location = page.getByLabel('Select ER location Frankfurt ER', { exact: true })
  await expect(location.locator('image')).toBeVisible()
  await action(page, 'Select ER location Frankfurt ER', 'Connect to hub')
  await page.getByLabel('Name', { exact: true }).fill('Frankfurt to Europe')
  await page.getByLabel('Hub', { exact: true }).selectOption('eu')
  await page.getByRole('button', { name: 'Create object', exact: true }).click()
  await action(page, 'Select ER location Frankfurt ER', 'Connect to site')
  await page.getByLabel('Name', { exact: true }).fill('London circuit')
  await page.getByLabel('On-premises site', { exact: true }).selectOption('dc')
  await page.getByLabel('ER BGP advertisements').fill('10.88.0.0/16 65010 65010')
  await page.getByRole('button', { name: 'Create object', exact: true }).click()
  await expect(page.locator('.er-location-node')).toHaveCount(1)
  const saved = await readTopology(page)
  expect(saved.erLinks).toHaveLength(2)
  const hubLink = saved.erLinks!.find((link) => link.hubId)!, siteLink = saved.erLinks!.find((link) => link.siteId)!
  await showRoutes(page)
  await expect(page.locator('tr[data-prefix="10.88.0.0/16"] .as-path').first()).toHaveText('12076 65010 65010')
  await page.locator('.effective-routes button.prefix-button').filter({ hasText: /^10\.20\.0\.0\/16$/ }).click()
  await expect(page.getByTestId(`er-link-${hubLink.id}`)).toHaveClass(/preferred-link/)
  await expect(page.getByTestId(`er-link-${siteLink.id}`)).toHaveClass(/preferred-link/)
  await expect.poll(() => motionDirections(page, hubLink.id)).toEqual([{ from: 'eu', to: saved.erLocations![0].id }])
  await expect.poll(() => motionDirections(page, siteLink.id)).toEqual([{ from: saved.erLocations![0].id, to: 'dc' }])
  expect((await motionFlows(page)).map((flow) => flow.map((edge) => edge.id))).toContainEqual(['eu-apps', hubLink.id, siteLink.id])
  await page.keyboard.press('Escape')
  await action(page, 'Select ER location Frankfurt ER', 'Advertised routes')
  await page.getByLabel('Neighbor', { exact: true }).selectOption(siteLink.id)
  const attachment = dialog(page, 'Advertised routes · Frankfurt ER')
  await expect(attachment).toContainText('10.1.0.0/16')
  await expect(attachment).toContainText('10.2.0.0/16')
  await expect(attachment).not.toContainText('10.30.0.0/16')
  await page.keyboard.press('Escape')
  await action(page, 'Select ER location Frankfurt ER', 'Learned routes')
  await page.getByLabel('Neighbor', { exact: true }).selectOption(siteLink.id)
  await expect(page.locator('.effective-routes tr[data-prefix="10.88.0.0/16"]')).toHaveCount(1)
  await expect(page.locator('.effective-routes tr[data-prefix="10.1.0.0/16"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await action(page, 'Select ER location Frankfurt ER', 'BGP table')
  await expect(dialog(page, 'BGP table · Frankfurt ER').getByRole('table')).toBeVisible()
  await expect(page.locator('.effective-routes tr[data-prefix="10.88.0.0/16"][data-preferred="true"]')).toContainText('London datacenter')
  await expect(page.locator('.effective-routes tr[data-prefix="10.88.0.0/16"] .as-path')).toHaveText('65010 65010')
  await page.keyboard.press('Escape')
  await (await pathMenu(page, 'Select site London datacenter', 'to', 'Americas applications (spoke)')).getByRole('menuitem', { name: '10.2.0.0/16', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Reachable')
  await expect(page.getByTestId(`er-link-${hubLink.id}`)).toHaveClass(/preferred-link/)
  await expect(page.getByTestId(`er-link-${siteLink.id}`)).toHaveClass(/preferred-link/)
  await expect.poll(() => motionDirections(page, siteLink.id)).toEqual([{ from: 'dc', to: saved.erLocations![0].id }])
  await expect.poll(() => motionDirections(page, hubLink.id)).toEqual([{ from: saved.erLocations![0].id, to: 'eu' }])
  expect((await motionFlows(page)).map((flow) => flow.map((edge) => edge.id))).toContainEqual([siteLink.id, hubLink.id, 'interhub:eu:us', 'us-apps'])
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  const exported = await downloadTopology(page)
  await page.reload()
  expect((await readTopology(page)).erLinks).toEqual(exported.erLinks)
  await action(page, 'Edit ER connection Frankfurt to Europe', 'Disable connection')
  await showRoutes(page)
  await expect(page.locator('tr[data-prefix="10.88.0.0/16"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await importTopology(page, exported)
  await page.getByLabel('Visualization mode').selectOption('constellation')
  await location.focus(); await page.keyboard.press('Alt+ArrowRight')
  expect((await readTopology(page)).layout!.positions.constellation![exported.erLocations![0].id]).toBeDefined()
  const withPolicies = await readTopology(page)
  withPolicies.routeMaps = [
    { id: 'er-site-policy', name: 'ER site filter', siteId: 'dc', rules: [{ id: 'er-site-rule', prefixes: ['10.88.0.0/16'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] },
    { id: 'er-hub-policy', name: 'ER hub filter', hubId: 'eu', rules: [] },
  ]
  withPolicies.sites[0].routeMapAssignments = [{ connectionId: siteLink.id, outboundMapId: 'er-site-policy' }]
  withPolicies.hubs[0].routeMapAssignments = [{ connectionId: hubLink.id, inboundMapId: 'er-hub-policy' }]
  await importTopology(page, withPolicies)
  await page.getByLabel('Outbound route map rules for London datacenter on London circuit', { exact: true }).click()
  await expect(page.getByLabel('Policy connection')).toHaveValue(siteLink.id)
  await expect(dialog(page, 'Route map rules · London datacenter')).toContainText('ER site filter')
  await page.getByRole('button', { name: 'Configure route maps', exact: true }).click()
  await expect(page.getByLabel('Route map connection')).toHaveValue(siteLink.id)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/expressroute-locations.png', fullPage: true })
  await action(page, 'Select ER location Frankfurt ER', 'Delete ER location')
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  expect((await readTopology(page)).erLinks).toEqual([])
  expect((await readTopology(page)).sites).toHaveLength(3)
  expect((await readTopology(page)).sites[0].routeMapAssignments).toEqual([])
  expect((await readTopology(page)).hubs[0].routeMapAssignments).toEqual([])
})

test('ER BGP table shows best paths, alternatives and ties, filters prefixes and withdraws disabled neighbors', async ({ page }) => {
  const topology = structuredClone(example)
  topology.connections = []
  topology.sites[0].prefixes = ['10.80.0.0/16']
  topology.erLocations = [{ id: 'er', name: 'Test ER location' }]
  topology.erLinks = [
    { id: 'er-hub', name: 'Azure attachment', locationId: 'er', hubId: 'eu', enabled: true, routes: [], learnSiteRoutes: false },
    { id: 'er-primary', name: 'Primary circuit', locationId: 'er', siteId: 'dc', enabled: true, routes: [], learnSiteRoutes: true },
    { id: 'er-backup', name: 'Backup circuit', locationId: 'er', siteId: 'ny', enabled: true, learnSiteRoutes: false,
      routes: [{ id: 'backup-prefix', prefix: '10.80.0.0/16', kind: 'bgp', asPath: [65020, 65020] }] },
    { id: 'er-equal', name: 'Equal circuit', locationId: 'er', siteId: 'branch', enabled: true, learnSiteRoutes: false,
      routes: [{ id: 'equal-prefix', prefix: '10.80.0.0/16', kind: 'bgp', asPath: [65030] }] },
  ]
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/'); await importTopology(page, topology)
  const original = await readTopology(page)
  await action(page, 'Select ER location Test ER location', 'BGP table')
  const table = dialog(page, 'BGP table · Test ER location')
  await expect(table.getByRole('table')).toBeVisible()
  await expect(page.getByLabel('Inspect router', { exact: true })).toHaveValue('erLocation:er')
  await expect(table.locator('tr[data-prefix="10.80.0.0/16"]')).toHaveCount(3)
  await expect(table.locator('tr[data-prefix="10.80.0.0/16"][data-preferred="true"]')).toHaveCount(2)
  await expect(table.locator('tr[data-prefix="10.80.0.0/16"][data-preferred="false"]')).toContainText('Backup circuit')
  await expect(table.locator('tr[data-prefix="10.1.0.0/16"]')).toContainText('Europe hub')
  await table.getByLabel('Filter by prefix', { exact: true }).fill('10.80')
  await expect(table.locator('tr[data-prefix]')).toHaveCount(3)
  await table.locator('.prefix-button').click()
  await expect(page.getByTestId('er-link-er-primary')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('er-link-er-equal')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('er-link-er-backup')).not.toHaveClass(/preferred-link/)
  await expect(page.getByTestId('er-link-er-hub')).not.toHaveClass(/preferred-link/)
  await expect.poll(() => motionDirections(page, 'er-primary')).toEqual([{ from: 'er', to: 'dc' }])
  await expect(page.locator('.path-flow')).toHaveCount(2)
  await table.getByLabel('Filter by prefix', { exact: true }).fill('10.1.')
  await table.locator('.prefix-button').click()
  await expect(page.getByTestId('er-link-er-hub')).toHaveClass(/preferred-link/)
  await expect.poll(() => motionDirections(page, 'er-hub')).toEqual([{ from: 'er', to: 'eu' }])
  await table.getByLabel('Filter by prefix', { exact: true }).fill('203.0.113')
  await expect(table.locator('tr[data-prefix]')).toHaveCount(0)
  await expect(table).toContainText('No routes match the current filters.')
  await table.getByLabel('Filter by prefix', { exact: true }).fill('10.80')
  await table.locator('.prefix-button').click()
  await page.screenshot({ path: 'test-results/er-location-bgp-table.png', fullPage: true })
  expect(await readTopology(page)).toEqual(original)
  await action(page, 'Edit ER connection Primary circuit', 'Disable connection')
  await action(page, 'Edit ER connection Equal circuit', 'Disable connection')
  await action(page, 'Select ER location Test ER location', 'BGP table')
  await expect(table.locator('tr[data-prefix="10.80.0.0/16"]')).toHaveCount(1)
  await expect(table.locator('tr[data-prefix="10.80.0.0/16"][data-preferred="true"]')).toContainText('Backup circuit')
  await action(page, 'Edit ER connection Backup circuit', 'Disable connection')
  await action(page, 'Edit ER connection Azure attachment', 'Disable connection')
  await action(page, 'Select ER location Test ER location', 'BGP table')
  await table.getByLabel('Filter by prefix', { exact: true }).fill('')
  await expect(table.getByRole('table')).toBeVisible()
  await expect(table.locator('tr[data-prefix]')).toHaveCount(0)
  await expect(table).toContainText('No routes available on this router.')
})

test('nested Everywhere paths retain per-prefix reachability and replace the standalone bulk action', async ({ page }) => {
  const topology = structuredClone(example)
  topology.sites[1].prefixes = ['203.0.113.0/24']
  await page.goto('/'); await importTopology(page, topology)
  await page.getByLabel('Select spoke Europe applications', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Show paths to all destinations', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Show path to', exact: true }).click()
  await page.getByRole('menu', { name: 'Show path to', exact: true }).getByRole('menuitem', { name: 'Everywhere', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Paths from Europe applications to Everywhere')
  await expect(page.getByRole('status')).toContainText('Partially reachable')
  await expect(page.getByTestId('link-er-eu')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('link-sdwan-eu')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-us-apps')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-eu-apps')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('link-vpn-eu')).not.toHaveClass(/preferred-link/)
  await page.getByRole('button', { name: 'Path details', exact: true }).click()
  await expect(dialog(page, 'Path explorer').locator('.flow-result.unreachable')).toContainText('New York office · 203.0.113.0/24')
  await expect(dialog(page, 'Path explorer').locator('.flow-result.delivered').first()).toContainText('Americas applications · 10.2.0.0/16')
  await page.keyboard.press('Escape')
  await groupPath(page, 'Select site London datacenter', 'to', 'Everywhere')
  await expect(page.getByRole('status')).toContainText('Paths from London datacenter to Everywhere')
  await expect(page.getByTestId('link-er-eu')).toHaveClass(/preferred-link/)
  await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await (await pathMenu(page, 'Select spoke Europe applications', 'to', 'Berlin branch (site)')).getByRole('menuitem', { name: '10.40.0.0/16', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Path: Europe applications')
  await expect(page.getByTestId('link-er-eu')).not.toHaveClass(/preferred-link/)
  await importTopology(page, { version: 1, name: 'Single site', hubs: [], spokes: [], sites: [{ id: 'only', name: 'Only site', asn: 65001, prefixes: [] }], siteLinks: [], connections: [] })
  await groupPath(page, 'Select site Only site', 'to', 'Everywhere')
  await expect(page.getByRole('status')).toContainText('No matching sources or destination prefixes configured')
  await groupPath(page, 'Select site Only site', 'from', 'Everywhere')
  await expect(page.getByRole('status')).toContainText('No matching sources or destination prefixes configured')
})

test('grouped to/from menus filter VNets and sites and highlight each incoming VNet leg', async ({ page }) => {
  await page.goto('/')
  await groupPath(page, 'Select spoke Europe applications', 'to', 'All Azure VNets')
  await expect(page.getByRole('status')).toContainText('Paths from Europe applications to All Azure VNets')
  await expect(page.getByTestId('spoke-link-us-apps')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('link-er-eu')).not.toHaveClass(/preferred-link/)
  await page.getByRole('button', { name: 'Path details', exact: true }).click()
  await expect(dialog(page, 'Path explorer').locator('.flow-result')).toHaveCount(1)
  await expect(dialog(page, 'Path explorer').locator('.flow-result')).toContainText('Europe applications → Americas applications · 10.2.0.0/16')
  await page.keyboard.press('Escape')
  await groupPath(page, 'Select spoke Europe applications', 'to', 'All onprem sites')
  await expect(page.getByTestId('link-er-eu')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-us-apps')).not.toHaveClass(/preferred-link/)
  await groupPath(page, 'Select site London datacenter', 'from', 'All Azure VNets')
  await expect(page.getByRole('status')).toContainText('Paths from All Azure VNets to London datacenter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('spoke-link-eu-apps')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-us-apps')).toHaveClass(/preferred-link/)
  await page.getByRole('button', { name: 'Path details', exact: true }).click()
  const paths = dialog(page, 'Path explorer').locator('.flow-results')
  await expect(paths).toContainText('Europe applications → London datacenter · 10.20.0.0/16')
  await expect(paths).toContainText('Americas applications → London datacenter · 10.20.10.0/24')
  await page.keyboard.press('Escape')
  await groupPath(page, 'Select spoke Europe applications', 'from', 'All onprem sites')
  await expect(page.getByRole('status')).toContainText('Paths from All onprem sites to Europe applications')
  await expect(page.getByRole('status')).toContainText('Partially reachable')
  await expect(page.getByTestId('link-vpn-us')).toHaveClass(/preferred-link/)
  await page.getByRole('button', { name: 'Path details', exact: true }).click()
  await expect(paths).toContainText('New York office → Europe applications · 10.1.0.0/16')
  await expect(dialog(page, 'Path explorer').locator('.flow-result.unreachable')).toContainText('Berlin branch → Europe applications')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await groupPath(page, 'Select hub Europe hub', 'from', 'Everywhere')
  await expect(page.getByRole('status')).toContainText('Paths from Everywhere to Europe hub')
  await expect(page.getByTestId('spoke-link-us-apps')).toHaveClass(/preferred-link/)
})

test('per-connection policy marks distinguish parallel links, owners and directions and open only their rules', async ({ page }) => {
  const topology = structuredClone(example)
  topology.siteLinks = [{ id: 'policy-peer', name: 'Private WAN', a: 'dc', b: 'ny', enabled: false,
    aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }]
  topology.routeMaps = [
    { id: 'visual-in', name: 'Site receive', siteId: 'dc', rules: [
      { id: 'visual-permit', prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'continue' },
      { id: 'visual-prepend', prefixes: ['10.0.0.0/8'], match: 'contains', action: 'prepend', summaryPrefixes: [], prepend: [65040, 65040], nextStep: 'continue' },
      { id: 'visual-summary', prefixes: ['10.1.0.0/16'], match: 'equals', action: 'summarize', summaryPrefixes: ['10.0.0.0/8'], prepend: [], nextStep: 'terminate' },
      { id: 'visual-drop', prefixes: ['203.0.113.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'continue' },
    ] },
    { id: 'visual-out', name: 'Site export', siteId: 'dc', rules: [] },
    { id: 'visual-hub', name: 'Hub receive', hubId: 'eu', rules: [] },
    { id: 'visual-unused', name: 'Unassigned resource', siteId: 'ny', rules: [] },
    { id: 'visual-peer-in', name: 'Peer receive', siteId: 'ny', rules: [] },
  ]
  topology.sites[0].routeMapAssignments = [
    { connectionId: 'er-eu', inboundMapId: 'visual-in', outboundMapId: 'visual-out' }, { connectionId: 'vpn-eu', inboundMapId: 'visual-in' },
    { connectionId: 'policy-peer', outboundMapId: 'visual-out' },
  ]
  topology.sites[1].routeMapAssignments = [{ connectionId: 'policy-peer', inboundMapId: 'visual-peer-in' }]
  topology.hubs[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'visual-hub', outboundMapId: 'visual-hub' }]
  await page.goto('/'); await importTopology(page, topology)
  const inbound = page.getByRole('button', { name: 'Inbound route map rules for London datacenter on London primary', exact: true })
  const backup = page.getByRole('button', { name: 'Inbound route map rules for London datacenter on London backup', exact: true })
  const outbound = page.getByRole('button', { name: 'Outbound route map rules for London datacenter on Private WAN', exact: true })
  const hubInbound = page.getByRole('button', { name: 'Inbound route map rules for Europe hub on London primary', exact: true })
  const hubOutbound = page.getByRole('button', { name: 'Outbound route map rules for Europe hub on London primary', exact: true })
  await expect(page.locator('.policy-badge')).toHaveCount(0)
  await expect(page.locator('.policy-marker')).toHaveCount(7)
  await expect(inbound.locator('text')).toHaveText('IN')
  await expect(outbound.locator('text')).toHaveText('OUT')
  await expect(inbound.locator('.policy-filter')).toHaveCount(1)
  await inbound.hover()
  const preview = page.getByRole('tooltip')
  await expect(preview).toContainText('Site receive')
  await expect(preview).toContainText('London primary')
  await expect(preview.getByRole('table').locator('tbody tr')).toHaveCount(4)
  await expect(preview).toContainText('65040 65040')
  await expect(preview).toContainText('Summarize to')
  await expect(preview).toContainText('Stop (drop)')
  await expect(inbound).toHaveAttribute('aria-describedby', await preview.getAttribute('id') as string)
  await preview.hover()
  await expect(preview).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/policy-hover-rules.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await inbound.focus()
  await expect(preview).toContainText('Site receive')
  await outbound.focus()
  await expect(preview).toContainText('configured but inactive')
  await expect(preview).toContainText('No rules; all routes pass unchanged.')
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(inbound).toHaveAttribute('data-connection-id', 'er-eu')
  await expect(backup).toHaveAttribute('data-connection-id', 'vpn-eu')
  expect(await inbound.getAttribute('transform')).not.toBe(await backup.getAttribute('transform'))
  await expect(page.getByRole('button', { name: /route map rules for Berlin branch/ })).toHaveCount(0)
  for (const [marker, sign] of [[inbound, 1], [hubInbound, 1], [hubOutbound, -1]] as const) {
    const dot = await marker.evaluate((element) => {
      const arrow = element.previousElementSibling!.querySelector('.policy-arrow') as SVGGraphicsElement
      const matrix = arrow.getScreenCTM()!
      const from = new DOMPoint(-9, 0).matrixTransform(matrix), to = new DOMPoint(9, 0).matrixTransform(matrix)
      const owner = [...document.querySelectorAll('[data-node-id]')].find((node) => node.getAttribute('data-node-id') === element.getAttribute('data-router-id'))!.getBoundingClientRect()
      return (to.x - from.x) * (owner.x + owner.width / 2 - (from.x + to.x) / 2) + (to.y - from.y) * (owner.y + owner.height / 2 - (from.y + to.y) / 2)
    })
    expect(dot * sign).toBeGreaterThan(0)
  }
  await page.screenshot({ path: 'test-results/connection-policy-marks.png', fullPage: true })
  const saved = await readTopology(page)
  await inbound.click()
  const rules = dialog(page, 'Route map rules · London datacenter')
  await expect(rules.getByLabel('Policy direction', { exact: true })).toHaveValue('inbound')
  await expect(rules.getByLabel('Policy connection', { exact: true })).toHaveValue('er-eu')
  await expect(rules.locator('.policy-assignment')).toHaveCount(1)
  await expect(rules.getByRole('region', { name: 'Policies on London backup', exact: true })).toHaveCount(0)
  const table = rules.getByRole('table', { name: 'Rules for Site receive on London primary, inbound', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(4)
  await expect(table.locator('tbody tr').nth(0)).toContainText('All prefixes')
  await expect(table.locator('tbody tr').nth(1)).toContainText('Contains (including more specific)')
  await expect(table.locator('tbody tr').nth(1)).toContainText('65040 65040')
  await expect(table.locator('tbody tr').nth(2)).toContainText('Summarize to')
  await expect(table.locator('tbody tr').nth(2)).toContainText('10.0.0.0/8')
  await expect(table.locator('tbody tr').nth(3)).toContainText('Stop (drop)')
  await expect(rules.getByRole('textbox')).toHaveCount(0)
  expect(await readTopology(page)).toEqual(saved)
  await rules.getByRole('button', { name: 'Close Route map rules · London datacenter', exact: true }).click()
  await backup.click()
  await expect(rules.getByLabel('Policy connection', { exact: true })).toHaveValue('vpn-eu')
  await expect(rules.getByRole('table', { name: 'Rules for Site receive on London backup, inbound', exact: true })).toBeVisible()
  await rules.getByRole('button', { name: 'Close Route map rules · London datacenter', exact: true }).click()
  await hubInbound.click()
  const hubRules = dialog(page, 'Route map rules · Europe hub')
  await expect(hubRules).toContainText('Hub receive')
  await expect(hubRules.getByLabel('Policy connection', { exact: true })).toHaveValue('er-eu')
  await hubRules.getByRole('button', { name: 'Close Route map rules · Europe hub', exact: true }).click()
  await outbound.focus(); await page.keyboard.press('Enter')
  await expect(rules.getByLabel('Policy direction', { exact: true })).toHaveValue('outbound')
  await expect(rules.getByLabel('Policy connection', { exact: true })).toHaveValue('policy-peer')
  await expect(rules).toContainText('Private WAN')
  await expect(rules).toContainText('configured but inactive')
  await expect(rules).toContainText('No rules; all routes pass unchanged.')
  await action(page, 'Select site London datacenter', 'Show route map rules')
  await expect(rules.getByLabel('Policy direction', { exact: true })).toHaveValue('all')
  await expect(rules.getByLabel('Policy connection', { exact: true })).toHaveValue('')
  await expect(rules.locator('.policy-assignment')).toHaveCount(4)
  await rules.getByLabel('Policy connection', { exact: true }).selectOption('policy-peer')
  await page.screenshot({ path: 'test-results/connection-policy-rules.png', fullPage: true })
  await rules.getByRole('button', { name: 'Configure route maps', exact: true }).click()
  await expect(page.getByLabel('Route map connection', { exact: true })).toHaveValue('policy-peer')
  await page.getByLabel('Outbound route map', { exact: true }).selectOption('')
  await expect(outbound).toHaveCount(0)
  await expect(inbound).toHaveCount(1)
  expect((await readTopology(page)).routeMaps!.some((m) => m.id === 'visual-out')).toBe(true)
  await page.getByRole('button', { name: 'Close Route maps · London datacenter', exact: true }).click()
  const before = await inbound.getAttribute('transform')
  await page.getByLabel('Select site London datacenter', { exact: true }).focus()
  await page.keyboard.press('Alt+ArrowRight')
  expect(await inbound.getAttribute('transform')).not.toBe(before)
  await page.getByLabel('Visualization mode', { exact: true }).selectOption('constellation')
  await page.getByLabel('Canvas zoom', { exact: true }).selectOption('1.5')
  const distance = await inbound.evaluate((element) => {
    const arrow = element.previousElementSibling!.querySelector('.policy-arrow') as SVGGraphicsElement
    const anchor = new DOMPoint(0, 0).matrixTransform(arrow.getScreenCTM()!)
    const curve = document.querySelector('[data-testid="link-er-eu"]') as SVGPathElement
    return Math.min(...Array.from({ length: 201 }, (_, i) => {
      const point = curve.getPointAtLength(curve.getTotalLength() * i / 200)
      const screen = new DOMPoint(point.x, point.y).matrixTransform(curve.getScreenCTM()!)
      return Math.hypot(anchor.x - screen.x, anchor.y - screen.y)
    }))
  })
  expect(distance).toBeLessThan(3)
  await inbound.scrollIntoViewIfNeeded(); await inbound.click()
  await expect(rules.getByLabel('Policy direction', { exact: true })).toHaveValue('inbound')
  await action(page, 'Edit connection London primary', 'Delete connection')
  await dialog(page, 'Delete connection').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await expect(inbound).toHaveCount(0)
  await expect(rules.getByLabel('Policy connection', { exact: true })).toHaveValue('')
  await expect(rules.getByRole('region', { name: 'Policies on London backup', exact: true })).toBeVisible()
  await action(page, 'Select site London datacenter', 'Delete site')
  await dialog(page, 'Delete site').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await expect(rules).toHaveCount(0)
  await expect(page.locator('.policy-marker')).toHaveCount(0)
})

test('routers without assigned maps have no connection policy marks and can inspect the empty state on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.policy-marker')).toHaveCount(0)
  await action(page, 'Select hub Europe hub', 'Show route map rules')
  const rules = dialog(page, 'Route map rules · Europe hub')
  await expect(rules).toContainText('No route maps assigned to this router.')
  await rules.getByLabel('Policy direction', { exact: true }).selectOption('outbound')
  await expect(rules).toContainText('No outbound route maps assigned to this router.')
  await rules.getByRole('button', { name: 'Configure route maps', exact: true }).click()
  await expect(page.getByLabel('Route map router', { exact: true })).toHaveValue('hub:eu')
})

test('cascading hover menus trace to/from the chosen prefix without opening an inspector', async ({ page }) => {
  await page.goto('/')
  const to = await pathMenu(page, 'Select spoke Europe applications', 'to', 'London datacenter (site)')
  await expect(to.getByRole('menuitem', { name: '10.20.0.0/16', exact: true })).toBeVisible()
  await to.getByRole('menuitem', { name: '10.20.10.0/24', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Europe applications → London datacenter · 10.20.10.0/24 · Reachable')
  await expect(page.getByTestId('link-er-eu')).toHaveAttribute('data-preferred', 'true')
  const from = await pathMenu(page, 'Select spoke Europe applications', 'from', 'New York office (site)')
  await expect(from.getByRole('menuitem', { name: '10.30.0.0/16', exact: true })).toHaveCount(0)
  await from.getByRole('menuitem', { name: '10.1.0.0/16', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('New York office → Europe applications · 10.1.0.0/16 · Reachable')
  await expect(page.getByTestId('link-vpn-us')).toHaveAttribute('data-preferred', 'true')
  await expect(page.getByTestId('interhub-eu-us')).toHaveClass(/preferred-link/)
  await page.getByRole('button', { name: 'Path details', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('New York office')
  await expect(page.getByLabel('Source node', { exact: true })).toHaveValue('site:ny')
})

test('nested menus flip at viewport edges, support keyboard backtracking and restore focus', async ({ page }) => {
  await page.goto('/')
  const node = page.getByLabel('Select spoke Europe applications', { exact: true })
  await node.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 5, clientY: innerHeight - 5 })))
  const parent = page.getByRole('menuitem', { name: 'Show path to', exact: true })
  await parent.focus(); await page.keyboard.press('ArrowRight')
  const endpoint = page.getByRole('menu', { name: 'Show path to', exact: true }).getByRole('menuitem', { name: 'New York office (site)', exact: true })
  await endpoint.focus(); await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: '10.30.0.0/16', exact: true })).toBeFocused()
  for (const menu of await page.getByRole('menu').all()) {
    const box = (await menu.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8)
    expect(box.x + box.width).toBeLessThanOrEqual(1272); expect(box.y + box.height).toBeLessThanOrEqual(712)
  }
  await page.screenshot({ path: 'test-results/cascading-path-menus.png', fullPage: true })
  await page.keyboard.press('ArrowLeft')
  await expect(endpoint).toBeFocused(); await expect(page.getByRole('menu')).toHaveCount(2)
  await page.keyboard.press('ArrowLeft')
  await expect(parent).toBeFocused(); await expect(page.getByRole('menu')).toHaveCount(1)
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape')
  await expect(parent).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(node).toBeFocused(); await expect(page.getByRole('menu')).toHaveCount(0)
})

test('compact menus work by tapping and explain missing prefixes and unreachable destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const topology = structuredClone(example)
  topology.sites.push({ id: 'isolated', name: 'Isolated site', asn: 65090, prefixes: ['192.0.2.0/24'] },
    { id: 'transit', name: 'Transit only', asn: 65091, prefixes: [] })
  await page.goto('/'); await importTopology(page, topology)
  await action(page, 'Select spoke Europe applications', 'Show path to')
  const endpoints = page.getByRole('menu', { name: 'Show path to', exact: true })
  await endpoints.getByRole('menuitem', { name: 'Transit only (site)', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'No destination prefixes configured', exact: true })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Back from Transit only (site)', exact: true }).click()
  await endpoints.getByRole('menuitem', { name: 'Isolated site (site)', exact: true }).click()
  await page.getByRole('menuitem', { name: '192.0.2.0/24', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('No route')
  await expect(page.locator('[data-testid^="link-"][data-preferred="true"]')).toHaveCount(0)
})

test('multi-prefix imports preserve the workspace and legacy browser data can be downloaded intact', async ({ page }) => {
  const legacy = structuredClone(example)
  legacy.sites[0].prefixes = ['10.90.0.0/16', '10.91.0.0/16']
  await page.goto('/')
  await importTopology(page, example)
  const before = await readTopology(page)
  await importTopology(page, legacy)
  await expect(page.getByRole('alert')).toContainText('only one originated prefix')
  expect(await readTopology(page)).toEqual(before)
  await page.evaluate((topology) => localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology)), legacy)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('saved data has not been overwritten')
  expect(await readTopology(page)).toEqual(legacy)
  expect(await downloadTopology(page, 'Download original saved topology')).toEqual(legacy)
})

async function dragNode(page: Page, id: string, dx: number, dy: number) {
  const node = page.locator(`[data-node-id="${id}"]`)
  await node.scrollIntoViewIfNeeded()
  const screen = await node.evaluate((element, delta) => {
    const matrix = (element as SVGGraphicsElement).getScreenCTM()!
    const start = new DOMPoint(0, 0).matrixTransform(matrix)
    const end = new DOMPoint(delta.dx, delta.dy).matrixTransform(matrix)
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
  }, { dx, dy })
  await page.mouse.move(screen.start.x, screen.start.y)
  await page.mouse.down()
  await page.mouse.move(screen.end.x, screen.end.y, { steps: 6 })
}

test('dragging updates links live, saves per-view positions and round-trips the arrangement', async ({ page }) => {
  await page.goto('/')
  const hub = page.locator('[data-node-id="eu"]')
  const original = await hub.getAttribute('transform')
  const edge = await page.getByTestId('link-er-eu').getAttribute('d')
  await dragNode(page, 'eu', 90, -60)
  expect(await hub.getAttribute('transform')).not.toBe(original)
  expect(await page.getByTestId('link-er-eu').getAttribute('d')).not.toBe(edge)
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBeNull()
  await page.mouse.up()
  await expect(hub).toHaveAttribute('aria-pressed', 'false')
  const moved = await hub.getAttribute('transform')
  const saved = await readTopology(page)
  expect(saved.layout!.positions.layered!.eu.y).toBe(250)
  await page.reload()
  await expect(hub).toHaveAttribute('transform', moved!)
  await page.getByLabel('Visualization mode').selectOption('constellation')
  await page.locator('[data-node-id="eu-apps"]').focus()
  await page.keyboard.press('Alt+ArrowRight')
  const spokePosition = await page.locator('[data-node-id="eu-apps"]').getAttribute('transform')
  await page.getByLabel('Visualization mode').selectOption('layered')
  await expect(hub).toHaveAttribute('transform', moved!)
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click()
  await expect(hub).toHaveAttribute('transform', original!)
  await page.getByLabel('Visualization mode').selectOption('constellation')
  await expect(page.locator('[data-node-id="eu-apps"]')).toHaveAttribute('transform', spokePosition!)
  const exported = await downloadTopology(page)
  await importTopology(page, example)
  await importTopology(page, exported)
  await expect(page.getByLabel('Visualization mode')).toHaveValue('constellation')
  await expect(page.locator('[data-node-id="eu-apps"]')).toHaveAttribute('transform', spokePosition!)
  await page.screenshot({ path: 'test-results/network-constellation.png', fullPage: true })
  await action(page, 'Select hub Europe hub', 'BGP table')
  await expect(page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]')).toHaveCount(3)
})

for (const mode of ['layered', 'constellation'] as const) {
  test(`dragging remains accurate after zooming and scrolling in ${mode}`, async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Visualization mode').selectOption(mode)
    const node = page.locator('[data-node-id="us"]')
    const beforeWidth = (await node.boundingBox())!.width
    await page.getByLabel('Canvas zoom').selectOption('1.5')
    expect((await node.boundingBox())!.width).toBeCloseTo(beforeWidth * 1.5, 0)
    await page.locator('.diagram-scroll').evaluate((element) => element.scrollTo(70, 40))
    const original = await node.getAttribute('transform')
    const [x, y] = original!.match(/[\d.]+/g)!.map(Number)
    await dragNode(page, 'us', -65, 50)
    await page.mouse.up()
    const position = (await readTopology(page)).layout!.positions[mode]!.us
    expect(Math.abs(position.x - (x - 65))).toBeLessThanOrEqual(1)
    expect(Math.abs(position.y - (y + 50))).toBeLessThanOrEqual(1)
    await expect(node).toHaveAttribute('aria-pressed', 'false')
    await node.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Edit configuration', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    const stable = await node.getAttribute('transform')
    await node.click()
    await expect(node).toHaveAttribute('aria-pressed', 'true')
    await expect(node).toHaveAttribute('transform', stable!)
  })
}

test('prefix-only paths work without an IP field and custom addresses remain available for exceptions', async ({ page }) => {
  const topology = structuredClone(example)
  topology.hubs[0].preference = 'VPN'
  topology.connections[0].routes.push({ id: 'same-base-prefix', prefix: '10.20.0.0/24', asPath: [12076, 65010], kind: 'bgp' })
  await page.goto('/'); await importTopology(page, topology)
  await action(page, 'Select spoke Europe applications', 'Open path explorer')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:dc')
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('10.20.10.0/24')
  await expect(page.getByLabel('Destination IPv4', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('London primary')
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('10.20.0.0/24')
  await expect(page.getByLabel('Destination prefix', { exact: true })).toHaveValue('10.20.0.0/24')
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('10.20.1.1')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('London backup')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('10.20.10.42')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('London primary')
})

test('canvas is the workspace, with layouts, zoom and keyboard background actions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('aside')).toHaveCount(0)
  await expect(page.getByLabel('Highlight prefix', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const site = page.getByLabel('Select site London datacenter', { exact: true })
  const original = await site.getAttribute('transform')
  await expect(page.getByLabel('Visualization mode').locator('option')).toHaveText(['Layered topology', 'Network constellation'])
  await page.getByLabel('Visualization mode').selectOption('constellation')
  expect(await site.getAttribute('transform')).not.toBe(original)
  await page.getByLabel('Canvas zoom').selectOption('1.25')
  await expect(page.locator('.diagram')).toHaveCSS('width', /\d+/)
  await page.locator('.diagram').focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu', { name: 'Canvas actions' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Add hub', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('BGP overlay preserves all candidates, colors, preference changes and topology comparison', async ({ page }) => {
  await page.goto('/')
  await showRoutes(page)
  const inspector = dialog(page, 'BGP table · Europe hub')
  const rows = inspector.locator('tr[data-prefix="10.20.0.0/16"]')
  const preferred = inspector.locator('tr[data-prefix="10.20.0.0/16"][data-preferred="true"]')
  await expect(rows).toHaveCount(3)
  await expect(preferred).toContainText('London primary')
  await expect(preferred.locator('.as-path')).toHaveText('12076 65010')
  await expect(inspector.locator('tr[data-prefix="10.20.0.0/16"][data-preferred="false"]')).toHaveCount(2)
  await expect(inspector.locator('thead th')).toHaveCount(3)
  await expect(rows.locator('.route-state')).toHaveText(['*', '', ''])
  await expect(inspector).not.toContainText(/\d+ candidates? · \d+ preferred/)
  await expect(inspector.locator('tr[data-reason-prefix="10.20.0.0/16"]')).toContainText('ExpressRoute wins')
  const before = await inspector.boundingBox()
  await inspector.getByRole('button', { name: 'Move BGP table · Europe hub to left', exact: true }).click()
  expect((await inspector.boundingBox())!.x).toBeLessThan(before!.x)
  await page.getByLabel('Hub routing preference', { exact: true }).selectOption('VPN')
  await expect(preferred).toContainText('London backup')
  await inspector.locator('tr[data-reason-prefix="10.20.0.0/16"]').getByRole('button', { name: '10.20.0.0/16', exact: true }).click()
  await expect(page.getByTestId('link-vpn-eu')).toHaveAttribute('data-preferred', 'true')
  await expect(page.getByTestId('link-er-eu')).toHaveAttribute('data-preferred', 'false')
  expect(await preferred.locator('.as-path').evaluate((e) => getComputedStyle(e).color)).not.toBe(
    await inspector.locator('tr[data-preferred="false"] .as-path').first().evaluate((e) => getComputedStyle(e).color),
  )
  await inspector.getByRole('button', { name: 'Move BGP table · Europe hub to right', exact: true }).click()
  await page.screenshot({ path: 'test-results/canvas-routes.png', fullPage: true })
  await page.reload()
  await showRoutes(page)
  await expect(page.getByLabel('Hub routing preference', { exact: true })).toHaveValue('VPN')
})

test('ECMP alternatives remain visible and connection failure withdraws only the failed path', async ({ page }) => {
  const t = structuredClone(example)
  t.hubs = [t.hubs[0]]; t.hubs[0].preference = 'ASPath'
  t.spokes = t.spokes.filter((s) => s.hubId === 'eu')
  t.connections = [0, 1, 2].map((i) => ({
    ...structuredClone(example.connections[1]), id: `vpn-${i}`, name: `VPN ${i + 1}`,
    routes: [{ id: `r-${i}`, prefix: '10.20.0.0/16', kind: 'bgp', asPath: i === 2 ? [65010, 65010] : [65010] }],
  }))
  await page.goto('/'); await importTopology(page, t); await showRoutes(page)
  const rows = page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]')
  await expect(rows).toHaveCount(3)
  await expect(rows.locator('.route-state')).toHaveText(['*', '*', ''])
  await action(page, 'Edit connection VPN 1', 'Disable connection')
  await expect(rows).toHaveCount(2)
  await expect(rows.locator('.route-state')).toHaveText(['*', ''])
  await expect(rows.filter({ hasText: 'VPN 1' })).toHaveCount(0)
})

test('either routing policy secures the existing hub icon in both layouts and disabling both restores it', async ({ page }) => {
  await page.goto('/')
  const securedHubReference = await readFile(new URL('../src/assets/azure/secured-virtual-hub.png', import.meta.url))
  const hub = page.getByLabel('Select hub Europe hub', { exact: true })
  const icon = hub.locator('.node-icon.hub image')
  const originalIcon = await icon.getAttribute('href')
  let securedIcon: string | null = null
  for (const [privateTraffic, internetTraffic] of [[true, false], [false, true], [false, false]]) {
    await action(page, 'Select hub Europe hub', 'Edit configuration')
    const editor = dialog(page, 'Edit hub')
    await editor.getByLabel('Private traffic routing intent', { exact: true }).setChecked(privateTraffic)
    await editor.getByLabel('Internet traffic routing intent', { exact: true }).setChecked(internetTraffic)
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    const secured = privateTraffic || internetTraffic
    for (const layout of ['layered', 'constellation']) {
      await page.getByLabel('Visualization mode', { exact: true }).selectOption(layout)
      await expect(hub.locator('.node-kind')).toHaveText(secured ? 'SECURED VIRTUAL HUB' : 'VIRTUAL HUB')
      await expect(hub.locator('.node-icon.secured')).toHaveCount(secured ? 1 : 0)
      await expect(page.locator('.firewall-node')).toHaveCount(0)
      await expect(page.locator('.hub-node')).toHaveCount(example.hubs.length)
      await expect(page.locator('.site-node')).toHaveCount(example.sites.length)
      const currentIcon = await icon.getAttribute('href')
      if (secured) {
        expect(currentIcon).not.toBe(originalIcon)
        const artwork = await page.request.get(currentIcon!)
        expect(artwork.ok()).toBe(true)
        expect(await artwork.body()).toEqual(securedHubReference)
        if (securedIcon) expect(currentIcon).toBe(securedIcon)
        securedIcon = currentIcon
        expect(await page.evaluate(async (url) => {
          const image = new Image(); image.src = url!; await image.decode()
          return image.naturalWidth > 0 && image.naturalHeight > 0
        }, currentIcon)).toBe(true)
        await expect(hub.locator('title')).toContainText('Azure Firewall')
      } else expect(currentIcon).toBe(originalIcon)
    }
    if (internetTraffic) {
      await page.reload()
      await expect(hub.locator('.node-icon.secured')).toHaveCount(1)
      await page.screenshot({ path: 'test-results/secured-virtual-hub.png', fullPage: true })
    }
  }
})

test('routing intent stays on hubs, with separate overlay tables and firewall paths', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select hub Europe hub', 'Edit configuration')
  const editor = dialog(page, 'Edit hub')
  await editor.getByLabel('Private traffic routing intent', { exact: true }).check()
  await editor.getByLabel('Internet traffic routing intent', { exact: true }).check()
  await editor.getByLabel('Additional private traffic prefixes', { exact: true }).fill('100.64.0.0/10')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.locator('.firewall-node')).toHaveCount(0)
  await expect(page.getByLabel('Select hub Europe hub', { exact: true }).locator('.node-icon.secured')).toHaveCount(1)
  await showRoutes(page)
  await expect(page.getByLabel('Route view', { exact: true })).toHaveValue('bgp')
  await expect(page.locator('.effective-routes table')).toContainText('10.20.0.0/16')
  await expect(page.locator('.effective-routes table')).not.toContainText('100.64.0.0/10')
  await page.getByLabel('Route view', { exact: true }).selectOption('hub')
  await expect(page.locator('.effective-routes table')).toContainText('100.64.0.0/10')
  await expect(page.locator('.effective-routes table')).not.toContainText('10.20.0.0/16')
  await action(page, 'Select hub Europe hub', 'Show firewall routes')
  await expect(page.getByLabel('Route view', { exact: true })).toHaveValue('firewall')
  await expect(page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]')).toHaveCount(3)
  await action(page, 'Select spoke Europe applications', 'Open path explorer')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:dc')
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('10.20.0.0/16')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('Azure Firewall')
  await expect(page.getByLabel('Select hub Europe hub', { exact: true })).toHaveClass(/firewall-active/)
  await expect(page.getByLabel('Select hub Europe hub', { exact: true }).locator('title')).toContainText('Active path traverses Azure Firewall')
  expect((await readTopology(page)).hubs[0].routingIntent.private).toBe(true)
})

test('context editing preserves IDs, advertisements and migrated route maps', async ({ page }) => {
  const t = structuredClone(example)
  t.connections[0].inbound = [{ id: 'legacy-prepend', prefixes: ['10.20.0.0/16'], match: 'equals', prepend: [64496] }]
  await page.goto('/'); await importTopology(page, t)
  const before = await readTopology(page)
  expect(before.routeMaps).toHaveLength(1)
  const changes = [
    { object: 'Select hub Europe hub', kind: 'hub', name: 'EU core' },
    { object: 'Select spoke Europe applications', kind: 'spoke', name: 'EU workloads' },
    { object: 'Select site London datacenter', kind: 'site', name: 'London campus' },
    { object: 'Edit connection London primary', kind: 'connection', name: 'London circuit' },
  ]
  for (const change of changes) {
    await action(page, change.object, 'Edit configuration')
    const editor = dialog(page, `Edit ${change.kind}`)
    await editor.getByLabel('Name', { exact: true }).fill(change.name)
    if (change.kind === 'site') await editor.getByLabel('Site ASN', { exact: true }).fill('65110')
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  }
  const after = await readTopology(page)
  expect(after.routeMaps).toEqual(before.routeMaps)
  expect(after.hubs[0].routeMapAssignments).toEqual(before.hubs[0].routeMapAssignments)
  expect(after.connections[0]).toEqual({ ...before.connections[0], name: 'London circuit' })
  expect(after.sites[0]).toEqual({ ...before.sites[0], name: 'London campus', asn: 65110 })
  await page.reload()
  await expect(page.getByLabel('Select site London campus', { exact: true })).toContainText('ASN 65110')
})

test('creates nodes through canvas menus, validates prefixes and confirms cascading deletion', async ({ page }) => {
  await page.goto('/')
  await importTopology(page, { version: 1, name: 'Empty', hubs: [], spokes: [], sites: [], connections: [], siteLinks: [] })
  await page.locator('.diagram').focus(); await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Add hub', exact: true }).click()
  await dialog(page, 'Add hub').getByLabel('Name', { exact: true }).fill('Lab hub')
  await dialog(page, 'Add hub').getByLabel('Region', { exact: true }).fill('West Europe')
  await dialog(page, 'Add hub').getByRole('button', { name: 'Create object', exact: true }).click()
  await action(page, 'Select hub Lab hub', 'Add spoke')
  const spoke = dialog(page, 'Add spoke')
  await spoke.getByLabel('Name', { exact: true }).fill('Lab spoke')
  await spoke.getByLabel('Prefixes', { exact: true }).fill('10.90.0.7/16')
  await spoke.getByRole('button', { name: 'Create object', exact: true }).click()
  await expect(spoke.getByRole('alert')).toContainText('Invalid spoke IPv4')
  await spoke.getByLabel('Prefixes', { exact: true }).fill('10.90.0.0/16')
  await spoke.getByRole('button', { name: 'Create object', exact: true }).click()
  await action(page, 'Select hub Lab hub', 'Add connected site')
  const site = dialog(page, 'Add connected site')
  await site.getByLabel('Name', { exact: true }).fill('Lab branch')
  await site.getByLabel('Site ASN', { exact: true }).fill('65042')
  await site.getByLabel('Originated prefix', { exact: true }).fill('10.91.0.0/16, 10.92.0.0/16')
  await site.getByRole('button', { name: 'Create object', exact: true }).click()
  await expect(site.getByRole('alert')).toContainText('Invalid IPv4 network CIDR')
  await site.getByLabel('Originated prefix', { exact: true }).fill('10.91.0.0/16')
  await site.getByLabel('Transport', { exact: true }).selectOption('VPN')
  await site.getByRole('button', { name: 'Create object', exact: true }).click()
  await expect(page.getByLabel('Select site Lab branch', { exact: true }).locator('.node-prefixes')).toHaveText('10.91.0.0/16')
  await showRoutes(page, 'Lab hub')
  await expect(page.locator('.effective-routes table')).toContainText('10.91.0.0/16')
  await action(page, 'Select hub Lab hub', 'Delete hub')
  await expect(dialog(page, 'Delete hub')).toContainText('1 attached spoke and 1 connection')
  await dialog(page, 'Delete hub').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  expect((await readTopology(page)).hubs).toHaveLength(0)
  expect((await readTopology(page)).sites).toHaveLength(1)
  await page.reload()
  await expect(page.getByLabel('Select site Lab branch', { exact: true }).locator('.node-prefixes')).toHaveText('10.91.0.0/16')
})

test('advanced path explorer calculates forward and reverse BGP paths independently', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select spoke Europe applications', 'Open path explorer')
  await expect(page.getByLabel('Source node', { exact: true })).toHaveValue('spoke:eu-apps')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:ny')
  await expect(page.getByLabel('Destination IPv4', { exact: true })).toHaveCount(0)
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('10.30.0.0/16')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('Europe hub → Americas hub → New York VPN → New York office')
  await expect(page.getByTestId('interhub-eu-us')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-eu-apps')).toHaveClass(/preferred-link/)
  await page.getByLabel('Destination node', { exact: true }).selectOption('spoke:eu-apps')
  await expect(page.getByLabel('Destination node', { exact: true })).toHaveValue('spoke:eu-apps')
  await page.getByLabel('Source node', { exact: true }).selectOption('site:ny')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('Reachable')
  await expect(page.getByTestId('link-vpn-us')).toHaveAttribute('data-preferred', 'true')
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('203.0.113.1')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('No route')
})

test('on-premises links and directional policies feed hub routes and transit paths', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select site New York office', 'Edit configuration')
  await dialog(page, 'Edit site').getByLabel('Originated prefix', { exact: true }).fill('10.80.0.0/16')
  await dialog(page, 'Edit site').getByRole('button', { name: 'Save changes', exact: true }).click()
  await action(page, 'Select site London datacenter', 'Link to another site')
  const editor = dialog(page, 'Add on-premises link')
  await editor.getByLabel('Name', { exact: true }).fill('Corporate WAN')
  await editor.getByLabel('Site B', { exact: true }).selectOption('ny')
  await editor.getByLabel('bToA inbound prepend ASNs', { exact: true }).fill('65020')
  await editor.getByRole('button', { name: 'Create object', exact: true }).click()
  await action(page, 'Edit connection London backup', 'Edit advertisements')
  await page.getByLabel('Import site mesh routes', { exact: true }).check()
  await showRoutes(page)
  await expect(page.locator('.effective-routes table')).toContainText('10.80.0.0/16')
  await action(page, 'Select spoke Europe applications', 'Open path explorer')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:ny')
  await page.getByLabel('Destination prefix', { exact: true }).selectOption('10.80.0.0/16')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('London datacenter → New York office')
  await expect(page.locator('.peer-link')).toHaveClass(/preferred-link/)
})

test('reusable maps summarize, prepend, share, preserve metadata and delete safely', async ({ page }) => {
  const t = structuredClone(example)
  t.connections[0].routes.push(
    { id: 'summary-a', prefix: '10.90.1.0/24', asPath: [12076, 65010], kind: 'bgp' },
    { id: 'summary-b', prefix: '10.90.2.0/24', asPath: [12076, 65010], kind: 'bgp' },
  )
  await page.goto('/'); await importTopology(page, t)
  await action(page, 'Select hub Europe hub', 'Route maps')
  await createMap(page, 'Branch policy')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 1 prefixes', { exact: true }).fill('10.90.0.0/16')
  await page.getByLabel('Rule 1 match', { exact: true }).selectOption('contains')
  await page.getByLabel('Rule 1 action', { exact: true }).selectOption('summarize')
  await page.getByLabel('Rule 1 summary prefixes', { exact: true }).fill('10.90.0.0/16')
  await page.getByLabel('Rule 1 next step', { exact: true }).selectOption('continue')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 2 prefixes', { exact: true }).fill('10.90.0.0/16')
  await page.getByLabel('Rule 2 action', { exact: true }).selectOption('prepend')
  await page.getByLabel('Rule 2 prepend ASNs', { exact: true }).fill('65001')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('public')
  await page.getByLabel('Rule 2 prepend ASNs', { exact: true }).fill('64496')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  const mapId = (await readTopology(page)).routeMaps![0].id
  await page.getByLabel('Inbound route map', { exact: true }).selectOption(mapId)
  await showRoutes(page)
  await expect(page.locator('.effective-routes tr[data-prefix="10.90.0.0/16"][data-preferred="true"] .as-path')).toHaveText('64496')
  await expect(page.locator('.effective-routes table')).not.toContainText('10.90.1.0/24')
  await action(page, 'Select hub Europe hub', 'Route maps')
  await page.getByLabel('Route map connection', { exact: true }).selectOption('vpn-eu')
  await page.getByLabel('Inbound route map', { exact: true }).selectOption(mapId)
  expect((await readTopology(page)).hubs[0].routeMapAssignments!.filter((a) => ['er-eu', 'vpn-eu'].includes(a.connectionId)).every((a) => a.inboundMapId === mapId)).toBe(true)
  await page.getByRole('button', { name: /^Branch policy/ }).click()
  await page.getByLabel('Route map name', { exact: true }).fill('Shared branch policy')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  expect((await readTopology(page)).routeMaps![0].name).toBe('Shared branch policy')
  await page.getByRole('button', { name: 'Delete route map', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm route map deletion', exact: true }).click()
  expect((await readTopology(page)).routeMaps).toHaveLength(0)
  expect((await readTopology(page)).hubs[0].routeMapAssignments).toEqual([])
  expect((await readTopology(page)).connections[0].routes).toEqual(t.connections[0].routes)
})

test('outbound block maps affect advertisements and site ingress, not Azure best routes', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select hub Europe hub', 'Route maps')
  await createMap(page, 'Block spoke export')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 1 prefixes', { exact: true }).fill('10.1.0.0/16')
  await page.getByLabel('Rule 1 action', { exact: true }).selectOption('drop')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  const mapId = (await readTopology(page)).routeMaps![0].id
  await page.getByLabel('Outbound route map', { exact: true }).selectOption(mapId)
  await page.getByText(/^Outbound advertisement preview/).click()
  await expect(page.locator('.assignment-panel table')).not.toContainText('10.1.0.0/16')
  await showRoutes(page)
  await expect(page.locator('.effective-routes table')).toContainText('10.1.0.0/16')
  await action(page, 'Select site London datacenter', 'Open path explorer')
  await page.getByLabel('Destination node', { exact: true }).selectOption('spoke:eu-apps')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.getByTestId('link-er-eu')).toHaveAttribute('data-preferred', 'false')
  await expect(page.getByTestId('link-vpn-eu')).toHaveAttribute('data-preferred', 'true')
})

test('hub and site own independent per-connection route maps and configuration exposes router policies', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Edit connection London primary', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Route maps', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await action(page, 'Select site London datacenter', 'Edit configuration')
  await dialog(page, 'Edit site').getByRole('button', { name: 'Configure route maps', exact: true }).click()
  await expect(page.getByLabel('Route map router', { exact: true })).toHaveValue('site:dc')
  await expect(page.getByLabel('Route map connection', { exact: true })).toHaveValue('er-eu')
  await createMap(page, 'Site export policy')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 1 action', { exact: true }).selectOption('prepend')
  await page.getByLabel('Rule 1 prepend ASNs', { exact: true }).fill('65010 65010')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  const mapId = (await readTopology(page)).routeMaps![0].id
  await page.getByLabel('Outbound route map', { exact: true }).selectOption(mapId)
  await page.getByLabel('Route map router', { exact: true }).selectOption('hub:us')
  await action(page, 'Select site London datacenter', 'Route maps')
  await expect(page.getByLabel('Route map router', { exact: true })).toHaveValue('site:dc')
  await expect(page.getByLabel('Outbound route map', { exact: true })).toHaveValue(mapId)
  await page.screenshot({ path: 'test-results/site-route-map-policies.png', fullPage: true })
  await showRoutes(page)
  await expect(page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]').filter({ hasText: 'London primary' }).locator('.as-path')).toHaveText('12076 65010 65010 65010')
  await action(page, 'Select hub Europe hub', 'Route maps')
  await expect(page.getByLabel('Outbound route map', { exact: true }).locator('option', { hasText: 'Site export policy' })).toHaveCount(0)
  await createMap(page, 'Hub inbound policy')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 1 prefixes', { exact: true }).fill('10.20.0.0/16')
  await page.getByLabel('Rule 1 action', { exact: true }).selectOption('drop')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  const hubMap = (await readTopology(page)).routeMaps!.find((m) => m.hubId === 'eu')!
  await page.getByLabel('Inbound route map', { exact: true }).selectOption(hubMap.id)
  const saved = await readTopology(page)
  expect(saved.connections[0]).not.toHaveProperty('inboundMapId')
  expect(saved.hubs[0].routeMapAssignments).toEqual([{ connectionId: 'er-eu', inboundMapId: hubMap.id }])
  expect(saved.sites[0].routeMapAssignments).toEqual([{ connectionId: 'er-eu', outboundMapId: mapId }])
  await page.reload(); await showRoutes(page)
  await expect(page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]').filter({ hasText: 'London primary' })).toHaveCount(0)
  await action(page, 'Select site London datacenter', 'Route maps')
  await expect(page.getByLabel('Outbound route map', { exact: true })).toHaveValue(mapId)
})

test('site-peer policies belong to the endpoint and are cleaned up with deleted links and routers', async ({ page }) => {
  const topology: Topology = { version: 1, name: 'Peer policies', hubs: [], spokes: [], connections: [], sites: [
    { id: 'a', name: 'Site A', asn: 65001, prefixes: [] },
    { id: 'b', name: 'Site B', asn: 65002, prefixes: ['10.20.0.0/16'] },
  ], siteLinks: [{ id: 'wan', name: 'WAN', a: 'a', b: 'b', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }] }
  await page.goto('/'); await importTopology(page, topology)
  await action(page, 'Select site Site B', 'Route maps')
  await expect(page.getByLabel('Route map connection', { exact: true })).toHaveValue('wan')
  await createMap(page, 'Peer export')
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule 1 action', { exact: true }).selectOption('drop')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  const mapId = (await readTopology(page)).routeMaps![0].id
  await page.getByLabel('Outbound route map', { exact: true }).selectOption(mapId)
  await action(page, 'Select site Site A', 'BGP table')
  await expect(page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]')).toHaveCount(0)
  await action(page, 'Select on-premises link WAN', 'Delete on-premises link')
  await dialog(page, 'Delete on-premises link').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  expect((await readTopology(page)).sites[1].routeMapAssignments).toEqual([])
  expect((await readTopology(page)).routeMaps).toHaveLength(1)
  await action(page, 'Select site Site B', 'Delete site')
  await dialog(page, 'Delete site').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  expect((await readTopology(page)).routeMaps).toHaveLength(0)
})

test('site BGP view retains alternatives, with route commands restricted to routers', async ({ page }) => {
  await page.goto('/')
  for (const object of ['Edit connection London primary', 'Select spoke Europe applications']) {
    await page.getByLabel(object, { exact: true }).focus(); await page.keyboard.press('Shift+F10')
    for (const command of ['BGP table', 'Learned routes', 'Advertised routes']) {
      await expect(page.getByRole('menuitem', { name: command, exact: true })).toHaveCount(0)
    }
    await page.keyboard.press('Escape')
  }
  const t: Topology = { version: 1, name: 'Site BGP', hubs: [], spokes: [], connections: [], sites: [
    { id: 'a', name: 'Site A', asn: 65010, prefixes: [] },
    { id: 'b', name: 'Site B', asn: 65020, prefixes: ['10.80.0.0/16'] },
    { id: 'c', name: 'Site C', asn: 65030, prefixes: ['10.80.0.0/16'] },
  ], siteLinks: [
    { id: 'ab', name: 'A to B', a: 'a', b: 'b', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } },
    { id: 'ac', name: 'A to C', a: 'a', b: 'c', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [65030] } },
  ] }
  await importTopology(page, t)
  await action(page, 'Select site Site A', 'BGP table')
  await expect(page.getByLabel('Inspect router', { exact: true })).toHaveValue('site:a')
  await expect(page.locator('.effective-routes tr[data-prefix="10.80.0.0/16"]')).toHaveCount(2)
  await expect(page.locator('.effective-routes tr[data-prefix="10.80.0.0/16"][data-preferred="true"]')).toContainText('Site B')
  await expect(page.getByTestId('peer-link-ab')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('peer-link-ac')).not.toHaveClass(/preferred-link/)
  await expect.poll(() => motionDirections(page, 'ab')).toEqual([{ from: 'a', to: 'b' }])
  await expect.poll(() => motionDirections(page, 'ac')).toEqual([])
  await expect(page.getByLabel('Select site Site B', { exact: true }).locator('.node-prefixes')).toHaveText('10.80.0.0/16')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('/24')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(0)
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.80')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(2)
})

test('learned and advertised route views default after maps and retain neighbor and prefix filters before maps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const t = structuredClone(example)
  t.connections[1].routes = ['10.60.0.0/16', '10.61.0.0/16', '10.62.0.0/16']
    .map((prefix) => ({ id: prefix, prefix, asPath: [65010], kind: 'bgp' }))
  t.routeMaps = [{
    id: 'in', name: 'Inbound test', hubId: 'eu', rules: [
      { id: 'drop', prefixes: ['10.60.0.0/16'], match: 'equals', action: 'drop', prepend: [], summaryPrefixes: [], nextStep: 'terminate' },
      { id: 'prepend', prefixes: ['10.61.0.0/16'], match: 'equals', action: 'prepend', prepend: [64496], summaryPrefixes: [], nextStep: 'terminate' },
      { id: 'summary', prefixes: ['10.62.0.0/16'], match: 'equals', action: 'summarize', prepend: [], summaryPrefixes: ['10.0.0.0/8'], nextStep: 'terminate' },
    ],
  }, {
    id: 'out', name: 'Outbound test', hubId: 'eu', rules: [
      { id: 'drop-out', prefixes: ['10.1.0.0/16'], match: 'equals', action: 'drop', prepend: [], summaryPrefixes: [], nextStep: 'terminate' },
    ],
  }]
  t.hubs[0].routeMapAssignments = [{ connectionId: 'vpn-eu', inboundMapId: 'in', outboundMapId: 'out' }]
  await page.goto('/'); await importTopology(page, t)
  const original = await readTopology(page)
  await action(page, 'Select hub Europe hub', 'Learned routes')
  await expect(page.getByLabel('Route-map stage', { exact: true })).toHaveValue('after')
  await page.getByLabel('Neighbor', { exact: true }).selectOption('vpn-eu')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.6')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(1)
  await expect(page.locator('.effective-routes .as-path')).toHaveText('64496 65010')
  await page.getByLabel('Route-map stage', { exact: true }).selectOption('before')
  await expect(page.getByLabel('Neighbor', { exact: true })).toHaveValue('vpn-eu')
  await expect(page.getByLabel('Filter by prefix', { exact: true })).toHaveValue('10.6')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(3)
  await expect(page.locator('.effective-routes tr[data-prefix="10.61.0.0/16"] .as-path')).toHaveText('65010')
  await page.screenshot({ path: 'test-results/route-policy-stage-inspector.png', fullPage: true })
  await page.getByLabel('Filter by prefix', { exact: true }).fill('/8')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(0)
  await page.getByLabel('Route-map stage', { exact: true }).selectOption('after')
  await expect(page.locator('.effective-routes tr[data-prefix="10.0.0.0/8"]')).toHaveCount(1)
  await action(page, 'Select hub Europe hub', 'Advertised routes')
  await expect(page.getByLabel('Route-map stage', { exact: true })).toHaveValue('after')
  await page.getByLabel('Neighbor', { exact: true }).selectOption('vpn-eu')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.1.')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(0)
  await page.getByLabel('Route-map stage', { exact: true }).selectOption('before')
  await expect(page.locator('.effective-routes tr[data-prefix="10.1.0.0/16"]')).toHaveCount(1)
  await showRoutes(page)
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.60')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await action(page, 'Select hub Europe hub', 'Learned routes')
  await page.getByLabel('Neighbor', { exact: true }).selectOption('vpn-eu')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.61')
  await page.getByLabel('Route-map stage', { exact: true }).selectOption('before')
  await expect(page.locator('.effective-routes .as-path')).toHaveText('65010')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await readTopology(page)).toEqual(original)
})

test('site route views inspect Azure policies and highlight Azure-learned BGP paths', async ({ page }) => {
  const t = structuredClone(example)
  t.connections = [t.connections[1]]
  t.connections[0].routes = [{ id: 'site-origin', prefix: '10.20.0.0/16', kind: 'bgp', asPath: [65010] }]
  t.routeMaps = [
    { id: 'site-in', name: 'Site inbound', siteId: 'dc', rules: [{
      id: 'site-drop', prefixes: ['10.1.0.0/16'], match: 'equals', action: 'drop', prepend: [], summaryPrefixes: [], nextStep: 'terminate',
    }] },
    { id: 'site-out', name: 'Site outbound', siteId: 'dc', rules: [{
      id: 'site-prepend', prefixes: ['10.20.0.0/16'], match: 'equals', action: 'prepend', prepend: [64496], summaryPrefixes: [], nextStep: 'terminate',
    }] },
  ]
  t.sites[0].routeMapAssignments = [{ connectionId: 'vpn-eu', inboundMapId: 'site-in', outboundMapId: 'site-out' }]
  await page.goto('/'); await importTopology(page, t)
  const original = await readTopology(page)
  await action(page, 'Select site London datacenter', 'Learned routes')
  await expect(page.getByLabel('Route-map stage', { exact: true })).toHaveValue('after')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.1.')
  await expect(page.locator('.effective-routes tr[data-prefix]')).toHaveCount(0)
  await page.getByLabel('Route-map stage', { exact: true }).selectOption('before')
  await expect(page.locator('.effective-routes tr[data-prefix="10.1.0.0/16"]')).toHaveCount(1)
  await action(page, 'Select site London datacenter', 'Advertised routes')
  await expect(page.getByLabel('Route-map stage', { exact: true })).toHaveValue('after')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.20.')
  await expect(page.locator('.effective-routes .as-path')).toHaveText('64496 65010')
  await page.getByLabel('Route-map stage', { exact: true }).selectOption('before')
  await expect(page.locator('.effective-routes .as-path')).toHaveText('65010')
  await action(page, 'Select site London datacenter', 'BGP table')
  await page.getByLabel('Filter by prefix', { exact: true }).fill('10.2.')
  await expect(page.locator('.effective-routes tr[data-prefix="10.2.0.0/16"][data-preferred="true"]')).toContainText('Azure BGP')
  await page.locator('.effective-routes .prefix-button').click()
  await expect(page.getByTestId('link-vpn-eu')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('interhub-eu-us')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-us-apps')).toHaveClass(/preferred-link/)
  await expect.poll(() => motionDirections(page, 'vpn-eu')).toEqual([{ from: 'dc', to: 'eu' }])
  expect(await readTopology(page)).toEqual(original)
})

test('JSON import/export, mobile overlays and Escape preserve user data', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByLabel('Import topology file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') })
  await expect(page.getByRole('alert')).toContainText('Import rejected')
  await expect(page.getByLabel('Topology name')).toHaveValue('Global branch network')
  await action(page, 'Select site London datacenter', 'Edit configuration')
  const editor = dialog(page, 'Edit site')
  await editor.getByLabel('Name', { exact: true }).fill('Unsaved name')
  expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(page.getByLabel('Select site London datacenter', { exact: true })).toBeAttached()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel('Topology name').fill('Portable workspace')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const path = await (await downloadPromise).path()
  await page.getByLabel('Open model notes and warnings').click()
  await page.getByRole('button', { name: 'Load example (replaces workspace)', exact: true }).click()
  await page.getByLabel('Import topology file').setInputFiles(path!)
  await expect(page.getByLabel('Topology name')).toHaveValue('Portable workspace')
})

test('VPN static prefixes are site attributes, editable from either endpoint and cleaned up with the VPN', async ({ page }) => {
  await page.goto('/')
  const point = await page.getByLabel('Edit connection London backup', { exact: true }).locator('.link-hitbox').evaluate((element) => {
    const path = element as SVGPathElement
    const p = path.getPointAtLength(path.getTotalLength() * 0.6)
    const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Static routing', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Edit advertisements', exact: true }).click()
  await expect(page.getByLabel('Route type', { exact: true })).toHaveCount(0)
  await expect(dialog(page, 'Advertisements · London backup')).toContainText('Configure non-BGP VPN prefixes through Static routing on the site or hub')
  await action(page, 'Select site London datacenter', 'Edit configuration')
  await dialog(page, 'Edit site').getByRole('button', { name: 'Configure static routing', exact: true }).click()
  await expect(page.getByLabel('Static routing VPN connection', { exact: true })).toHaveValue('vpn-eu')
  await page.getByLabel('Site VPN static prefixes', { exact: true }).fill('10.90.0.0/16\n10.91.0.0/16')
  await page.getByLabel('Static-only VPN', { exact: true }).check()
  await page.getByRole('button', { name: 'Save static routing', exact: true }).click()
  const saved = await readTopology(page)
  expect(saved.sites[0].vpnStaticRoutes).toMatchObject([
    { prefix: '10.90.0.0/16', connectionId: 'vpn-eu' }, { prefix: '10.91.0.0/16', connectionId: 'vpn-eu' },
  ])
  expect(saved.connections[1].routes).toEqual([])
  expect(saved.connections[1].learnSiteRoutes).toBe(false)
  await page.getByLabel('Site VPN static prefixes', { exact: true }).fill('10.90.0.1/16')
  await page.getByRole('button', { name: 'Save static routing', exact: true }).click()
  await expect(dialog(page, 'Static routing · London datacenter').getByRole('alert')).toContainText('Invalid static IPv4')
  expect(await readTopology(page)).toEqual(saved)
  await showRoutes(page)
  await expect(page.locator('.effective-routes tr[data-prefix="10.90.0.0/16"]')).toContainText('VPN site static')
  await action(page, 'Select hub Europe hub', 'Static routing')
  await expect(page.getByLabel('Site VPN static prefixes', { exact: true })).toHaveValue('10.90.0.0/16\n10.91.0.0/16')
  await page.screenshot({ path: 'test-results/site-static-routing.png', fullPage: true })
  await page.reload()
  await action(page, 'Select site London datacenter', 'Static routing')
  await expect(page.getByLabel('Site VPN static prefixes', { exact: true })).toHaveValue('10.90.0.0/16\n10.91.0.0/16')
  await action(page, 'Edit connection London backup', 'Edit configuration')
  const editor = dialog(page, 'Edit connection')
  await editor.getByLabel('Transport', { exact: true }).selectOption('ExpressRoute')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Site static routes require an attached S2S VPN')
  expect((await readTopology(page)).connections[1].transport).toBe('VPN')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await action(page, 'Edit connection London backup', 'Delete connection')
  await dialog(page, 'Delete connection').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  expect((await readTopology(page)).sites[0].vpnStaticRoutes).toEqual([])
  await expect(dialog(page, 'Static routing · London datacenter')).toContainText('No S2S VPN connections attached')
})

test('VPN conversion wizard reviews, cancels and converts static/BGP settings together with editable route seeds', async ({ page }) => {
  const topology = structuredClone(example)
  topology.sites[0].prefixes = ['10.90.0.0/16']
  await page.goto('/'); await importTopology(page, topology)
  const original = await readTopology(page)
  await page.getByLabel('Edit connection London backup', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Change to BGP routing', exact: true })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Change to static routing', exact: true })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Change to static routing', exact: true }).click()
  const wizard = dialog(page, 'Change VPN to static · London backup')
  await expect(wizard).toContainText('Source prefixes: 10.1.0.0/16')
  await expect(wizard.getByLabel('Static destination prefixes')).toHaveValue('10.20.0.0/16\n10.90.0.0/16')
  await wizard.getByLabel('Static destination prefixes').fill('10.90.0.1/16')
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await expect(wizard.getByRole('alert')).toContainText('Invalid static IPv4')
  expect(await readTopology(page)).toEqual(original)
  await wizard.getByLabel('Static destination prefixes').fill('10.90.0.0/16\n10.91.0.0/16')
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await expect(wizard.getByRole('table', { name: 'Reviewed static destinations' })).toContainText('10.91.0.0/16')
  await wizard.getByRole('button', { name: 'Cancel conversion', exact: true }).click()
  expect(await readTopology(page)).toEqual(original)
  await action(page, 'Edit connection London backup', 'Change to static routing')
  await wizard.getByLabel('Static destination prefixes').fill('10.90.0.0/16\n10.91.0.0/16')
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await wizard.getByRole('button', { name: 'Back to destinations', exact: true }).click()
  await expect(wizard.getByLabel('Static destination prefixes')).toHaveValue('10.90.0.0/16\n10.91.0.0/16')
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await wizard.getByRole('button', { name: 'Apply static routing', exact: true }).click()
  await expect(wizard.getByRole('status')).toContainText('updated together')
  await wizard.getByRole('button', { name: 'Done', exact: true }).click()
  const staticTopology = await readTopology(page)
  expect(staticTopology.connections[1].routes).toEqual([])
  expect(staticTopology.connections[1].learnSiteRoutes).toBe(false)
  expect(staticTopology.sites[0].vpnStaticRoutes!.map((route) => route.prefix)).toEqual(['10.90.0.0/16', '10.91.0.0/16'])
  expect(staticTopology.sites[0].prefixes).toEqual(original.sites[0].prefixes)
  expect(staticTopology.connections[0]).toEqual(original.connections[0])
  await showRoutes(page)
  await expect(page.locator('.effective-routes tr[data-prefix="10.91.0.0/16"]')).toContainText('VPN site static')
  await page.reload()
  await page.getByLabel('Edit connection London backup', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Change to static routing', exact: true })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Change to BGP routing', exact: true })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Change to BGP routing', exact: true }).click()
  const bgpWizard = dialog(page, 'Change VPN to BGP · London backup')
  await expect(bgpWizard.getByLabel('BGP destination prefix 1', { exact: true })).toHaveValue('10.90.0.0/16')
  await expect(bgpWizard.getByLabel('BGP AS path 1', { exact: true })).toHaveValue('65010')
  await bgpWizard.getByLabel('BGP AS path 1', { exact: true }).fill('65010 65010')
  await bgpWizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await expect(bgpWizard.getByRole('table', { name: 'Reviewed BGP destinations' })).toContainText('65010 65010')
  await page.screenshot({ path: 'test-results/vpn-conversion-review.png', fullPage: true })
  await bgpWizard.getByRole('button', { name: 'Apply BGP routing', exact: true }).click()
  await bgpWizard.getByRole('button', { name: 'Done', exact: true }).click()
  const bgpTopology = await readTopology(page)
  expect(bgpTopology.sites[0].vpnStaticRoutes).toEqual([])
  expect(bgpTopology.connections[1].routes).toMatchObject([
    { id: staticTopology.sites[0].vpnStaticRoutes![0].id, prefix: '10.90.0.0/16', kind: 'bgp', asPath: [65010, 65010] },
    { prefix: '10.91.0.0/16', kind: 'bgp', asPath: [65010] },
  ])
  await showRoutes(page)
  await expect(page.locator('.effective-routes tr[data-prefix="10.90.0.0/16"] .as-path')).toHaveText('65010 65010')
  const exported = await downloadTopology(page)
  await page.reload()
  expect(await readTopology(page)).toEqual(exported)
})

test('VPN wizard never invents destination networks and is not offered for ER connections', async ({ page }) => {
  const topology = structuredClone(example)
  topology.connections[1].routes = []
  await page.goto('/'); await importTopology(page, topology)
  const original = await readTopology(page)
  await action(page, 'Edit connection London backup', 'Change to static routing')
  const wizard = dialog(page, 'Change VPN to static · London backup')
  await expect(wizard.getByLabel('Static destination prefixes')).toHaveValue('')
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await expect(wizard.getByRole('alert')).toContainText('at least one destination prefix')
  await page.keyboard.press('Escape')
  expect(await readTopology(page)).toEqual(original)
  await page.getByLabel('Edit connection London primary', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: /^Change to (static|BGP) routing$/ })).toHaveCount(0)
})

test('mixed VPN routing offers both conversions and rejects stale review without losing concurrent edits', async ({ page }) => {
  const topology = structuredClone(example)
  topology.sites[0].vpnStaticRoutes = [{ id: 'wizard-mixed-static', prefix: '10.90.0.0/16', connectionId: 'vpn-eu' }]
  await page.goto('/'); await importTopology(page, topology)
  await page.getByLabel('Edit connection London backup', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Change to static routing', exact: true })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Change to BGP routing', exact: true })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Change to BGP routing', exact: true }).click()
  const wizard = dialog(page, 'Change VPN to BGP · London backup')
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await action(page, 'Edit connection London backup', 'Disable connection')
  await wizard.getByRole('button', { name: 'Apply BGP routing', exact: true }).click()
  await expect(wizard.getByRole('alert')).toContainText('configuration changed after review')
  expect((await readTopology(page)).sites[0].vpnStaticRoutes).toHaveLength(1)
  await wizard.getByRole('button', { name: 'Back to destinations', exact: true }).click()
  await wizard.getByRole('button', { name: 'Review routing changes', exact: true }).click()
  await wizard.getByRole('button', { name: 'Apply BGP routing', exact: true }).click()
  expect((await readTopology(page)).connections[1].enabled).toBe(false)
  expect((await readTopology(page)).sites[0].vpnStaticRoutes).toEqual([])
})

test('clearing requires confirmation, persists an empty workspace and allows starting from scratch', async ({ page }) => {
  const topology = structuredClone(example)
  topology.sites[0].vpnStaticRoutes = [{ id: 'clear-static', prefix: '10.90.0.0/16', connectionId: 'vpn-eu' }]
  topology.routeMaps = [{ id: 'clear-map', name: 'Clear policy', hubId: 'eu', rules: [] }]
  topology.hubs[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'clear-map' }]
  topology.layout = { mode: 'constellation', positions: { constellation: { eu: { x: 500, y: 300 } } } }
  await page.goto('/'); await importTopology(page, topology)
  const original = await readTopology(page)
  await page.getByRole('button', { name: 'Clear topology', exact: true }).click()
  await expect(dialog(page, 'Clear topology')).toContainText('cannot be undone')
  await dialog(page, 'Clear topology').getByRole('button', { name: 'Cancel clearing', exact: true }).click()
  expect(await readTopology(page)).toEqual(original)
  await page.getByRole('button', { name: 'Clear topology', exact: true }).click()
  await page.keyboard.press('Escape')
  expect(await readTopology(page)).toEqual(original)
  await page.getByRole('button', { name: 'Clear topology', exact: true }).click()
  await dialog(page, 'Clear topology').getByRole('button', { name: 'Clear all objects', exact: true }).click()
  const empty = await readTopology(page)
  expect(empty).toEqual({ version: 1, name: 'New topology', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [] })
  await expect(page.locator('.diagram [data-node-id]')).toHaveCount(0)
  await expect(page.locator('.policy-marker')).toHaveCount(0)
  await expect(page.getByLabel('Visualization mode', { exact: true })).toHaveValue('layered')
  await page.reload()
  expect(await readTopology(page)).toEqual(empty)
  await expect(page.locator('.empty-diagram')).toBeVisible()
  await page.getByRole('button', { name: '+ Hub', exact: true }).click()
  await dialog(page, 'Add hub').getByLabel('Name', { exact: true }).fill('Fresh hub')
  await dialog(page, 'Add hub').getByLabel('Region', { exact: true }).fill('West Europe')
  await dialog(page, 'Add hub').getByRole('button', { name: 'Create object', exact: true }).click()
  expect((await readTopology(page)).hubs).toHaveLength(1)
  await importTopology(page, original)
  expect(await readTopology(page)).toEqual(original)
})
