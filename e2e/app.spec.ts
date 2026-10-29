import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { example } from '../src/model'
import type { Topology } from '../src/model'

const readTopology = (page: Page): Promise<Topology> => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
const importTopology = (page: Page, topology: Topology) => page.getByLabel('Import topology file').setInputFiles({
  name: 'topology.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
})
async function action(page: Page, object: string, command: string) {
  await page.getByLabel(object, { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menu').getByRole('menuitem', { name: command, exact: true }).click()
}
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })
async function showRoutes(page: Page, hub = 'Europe hub') { await action(page, `Select hub ${hub}`, 'Show BGP routes') }
async function createMap(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create route map', exact: true }).click()
  await page.getByLabel('Route map name', { exact: true }).fill(name)
}

test('canvas is the workspace, with layouts, zoom and keyboard background actions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('aside')).toHaveCount(0)
  await expect(page.getByLabel('Highlight prefix', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const site = page.getByLabel('Select site London datacenter', { exact: true })
  const original = await site.getAttribute('transform')
  await page.getByLabel('Visualization mode').selectOption('regional')
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
  const inspector = dialog(page, 'BGP routes · Europe hub')
  const rows = inspector.locator('tr[data-prefix="10.20.0.0/16"]')
  const preferred = inspector.locator('tr[data-prefix="10.20.0.0/16"][data-preferred="true"]')
  await expect(rows).toHaveCount(3)
  await expect(preferred).toContainText('London primary')
  await expect(preferred.locator('.as-path')).toHaveText('12076 65010')
  await expect(inspector.locator('tr[data-prefix="10.20.0.0/16"][data-preferred="false"]')).toHaveCount(2)
  await expect(inspector.locator('tr[data-reason-prefix="10.20.0.0/16"]')).toContainText('ExpressRoute wins')
  const before = await inspector.boundingBox()
  await inspector.getByRole('button', { name: 'Move BGP routes · Europe hub to left', exact: true }).click()
  expect((await inspector.boundingBox())!.x).toBeLessThan(before!.x)
  await page.getByLabel('Hub routing preference', { exact: true }).selectOption('VPN')
  await expect(preferred).toContainText('London backup')
  await preferred.getByRole('button', { name: '10.20.0.0/16', exact: true }).click()
  await expect(page.getByTestId('link-vpn-eu')).toHaveAttribute('data-preferred', 'true')
  await expect(page.getByTestId('link-er-eu')).toHaveAttribute('data-preferred', 'false')
  expect(await preferred.locator('.as-path').evaluate((e) => getComputedStyle(e).color)).not.toBe(
    await inspector.locator('tr[data-preferred="false"] .as-path').first().evaluate((e) => getComputedStyle(e).color),
  )
  await inspector.getByRole('button', { name: 'Move BGP routes · Europe hub to right', exact: true }).click()
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
  await expect(rows.locator('.ecmp')).toHaveText(['ECMP ×2', 'ECMP ×2'])
  await action(page, 'Edit connection VPN 1', 'Disable connection')
  await expect(rows).toHaveCount(2)
  await expect(rows.locator('.ecmp')).toHaveCount(0)
  await expect(rows.filter({ hasText: 'VPN 1' })).toHaveCount(0)
})

test('routing intent stays on hubs, with separate overlay tables and firewall paths', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select hub Europe hub', 'Edit configuration')
  const editor = dialog(page, 'Edit hub')
  await editor.getByLabel('Private traffic routing intent', { exact: true }).check()
  await editor.getByLabel('Internet traffic routing intent', { exact: true }).check()
  await editor.getByLabel('Additional private traffic prefixes', { exact: true }).fill('100.64.0.0/10')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await showRoutes(page)
  await expect(page.locator('.effective-routes table')).toContainText('100.64.0.0/10')
  await expect(page.locator('.effective-routes table')).not.toContainText('10.20.0.0/16')
  await action(page, 'Select hub Europe hub', 'Show firewall routes')
  await expect(page.getByLabel('Route view', { exact: true })).toHaveValue('firewall')
  await expect(page.locator('.effective-routes tr[data-prefix="10.20.0.0/16"]')).toHaveCount(3)
  await action(page, 'Select spoke Europe applications', 'Show path to')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:dc')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('10.20.1.1')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('Azure Firewall')
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
  await site.getByLabel('Originated prefixes', { exact: true }).fill('10.91.0.0/16\n10.92.0.0/16, 10.93.0.0/16')
  await site.getByLabel('Transport', { exact: true }).selectOption('VPN')
  await site.getByRole('button', { name: 'Create object', exact: true }).click()
  await expect(page.getByLabel('Select site Lab branch', { exact: true }).locator('.node-prefixes')).toHaveText('10.91.0.0/16 +2')
  await showRoutes(page, 'Lab hub')
  await expect(page.locator('.effective-routes table')).toContainText('10.93.0.0/16')
  await action(page, 'Select hub Lab hub', 'Delete hub')
  await expect(dialog(page, 'Delete hub')).toContainText('1 attached spoke and 1 connection')
  await dialog(page, 'Delete hub').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  expect((await readTopology(page)).hubs).toHaveLength(0)
  expect((await readTopology(page)).sites).toHaveLength(1)
  await page.reload()
  await expect(page.getByLabel('Select site Lab branch', { exact: true }).locator('.node-prefixes')).toHaveText('10.91.0.0/16 +2')
})

test('path-to and path-from menus calculate forward and reverse BGP paths independently', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select spoke Europe applications', 'Show path to')
  await expect(page.getByLabel('Source node', { exact: true })).toHaveValue('spoke:eu-apps')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:ny')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('10.30.0.25')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('Europe hub → Americas hub → New York VPN → New York office')
  await expect(page.getByTestId('interhub-eu-us')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('spoke-link-eu-apps')).toHaveClass(/preferred-link/)
  await action(page, 'Select spoke Europe applications', 'Show path from')
  await expect(page.getByLabel('Destination node', { exact: true })).toHaveValue('spoke:eu-apps')
  await page.getByLabel('Source node', { exact: true }).selectOption('site:ny')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('Reachable')
  await expect(page.getByTestId('link-vpn-us')).toHaveAttribute('data-preferred', 'true')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('203.0.113.1')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.locator('.flow-result')).toContainText('No route')
})

test('on-premises links and directional policies feed hub routes and transit paths', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Select site New York office', 'Edit configuration')
  await dialog(page, 'Edit site').getByLabel('Originated prefixes', { exact: true }).fill('10.80.0.0/16\n10.81.0.0/16')
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
  await expect(page.locator('.effective-routes table')).toContainText('10.81.0.0/16')
  await action(page, 'Select spoke Europe applications', 'Show path to')
  await page.getByLabel('Destination node', { exact: true }).selectOption('site:ny')
  await page.getByLabel('Destination IPv4', { exact: true }).fill('10.80.0.10')
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
  await action(page, 'Edit connection London primary', 'Route maps')
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
  await action(page, 'Edit connection London backup', 'Route maps')
  await page.getByLabel('Inbound route map', { exact: true }).selectOption(mapId)
  expect((await readTopology(page)).connections.slice(0, 2).every((c) => c.inboundMapId === mapId)).toBe(true)
  await page.getByRole('button', { name: /^Branch policy/ }).click()
  await page.getByLabel('Route map name', { exact: true }).fill('Shared branch policy')
  await page.getByRole('button', { name: 'Save route map', exact: true }).click()
  expect((await readTopology(page)).routeMaps![0].name).toBe('Shared branch policy')
  await page.getByRole('button', { name: 'Delete route map', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm route map deletion', exact: true }).click()
  expect((await readTopology(page)).routeMaps).toHaveLength(0)
  expect((await readTopology(page)).connections.every((c) => !c.inboundMapId && !c.outboundMapId)).toBe(true)
  expect((await readTopology(page)).connections[0].routes).toEqual(t.connections[0].routes)
})

test('outbound block maps affect advertisements and site ingress, not Azure best routes', async ({ page }) => {
  await page.goto('/')
  await action(page, 'Edit connection London primary', 'Route maps')
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
  await action(page, 'Select site London datacenter', 'Show path to')
  await page.getByLabel('Destination node', { exact: true }).selectOption('spoke:eu-apps')
  await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
  await expect(page.getByTestId('link-er-eu')).toHaveAttribute('data-preferred', 'false')
  await expect(page.getByTestId('link-vpn-eu')).toHaveAttribute('data-preferred', 'true')
})

test('site BGP view retains alternatives, with route commands restricted to routers', async ({ page }) => {
  await page.goto('/')
  for (const object of ['Edit connection London primary', 'Select spoke Europe applications']) {
    await page.getByLabel(object, { exact: true }).focus(); await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: 'Show BGP routes', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  const t: Topology = { version: 1, name: 'Site BGP', hubs: [], spokes: [], connections: [], sites: [
    { id: 'a', name: 'Site A', asn: 65010, prefixes: [] },
    { id: 'b', name: 'Site B', asn: 65020, prefixes: ['10.80.0.0/16', '10.81.0.0/16'] },
    { id: 'c', name: 'Site C', asn: 65030, prefixes: ['10.80.0.0/16', '10.81.0.0/16'] },
  ], siteLinks: [
    { id: 'ab', name: 'A to B', a: 'a', b: 'b', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } },
    { id: 'ac', name: 'A to C', a: 'a', b: 'c', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [65030] } },
  ] }
  await importTopology(page, t)
  await action(page, 'Select site Site A', 'Show BGP routes')
  await expect(page.getByLabel('Inspect router', { exact: true })).toHaveValue('site:a')
  await expect(page.locator('.effective-routes tr[data-prefix="10.80.0.0/16"]')).toHaveCount(2)
  await expect(page.locator('.effective-routes tr[data-prefix="10.80.0.0/16"][data-preferred="true"]')).toContainText('Site B')
  await expect(page.getByTestId('peer-link-ab')).toHaveClass(/preferred-link/)
  await expect(page.getByTestId('peer-link-ac')).not.toHaveClass(/preferred-link/)
  await expect(page.getByLabel('Select site Site B', { exact: true }).locator('.node-prefixes')).toHaveText('10.80.0.0/16 +1')
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

test('VPN static editing uses the actual mouse context menu and rejects incompatible transport changes', async ({ page }) => {
  await page.goto('/')
  const point = await page.getByLabel('Edit connection London backup', { exact: true }).locator('.link-hitbox').evaluate((element) => {
    const path = element as SVGPathElement
    const p = path.getPointAtLength(path.getTotalLength() * 0.6)
    const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit advertisements', exact: true }).click()
  await page.getByLabel('Route type', { exact: true }).selectOption('vpn-static')
  await expect(page.getByLabel('Received AS path', { exact: true })).toBeDisabled()
  expect((await readTopology(page)).connections[1].routes[0].asPath).toEqual([])
  await action(page, 'Edit connection London backup', 'Edit configuration')
  const editor = dialog(page, 'Edit connection')
  await editor.getByLabel('Transport', { exact: true }).selectOption('ExpressRoute')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Static routes are supported only on VPN')
  expect((await readTopology(page)).connections[1].transport).toBe('VPN')
})
