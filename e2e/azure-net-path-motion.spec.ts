import { expect, test, type Page } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'

function topology(blockPeering = false) {
  const result = createEmptyAzNetTopology()
  result.vnets = [
    { id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'hub-workload', name: 'Hub workload', prefix: '10.0.1.0/24' }],
      gateways: [{ id: 'gateway', name: 'ER gateway', kind: 'ExpressRoute', enabled: true, bgpEnabled: true, asn: 65515 }],
      appliances: [] },
    { id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16'],
      subnets: [{ id: 'workload', name: 'Workload', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: !blockPeering, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  result.vnetPeerings = [{ id: 'peer', name: 'Gateway transit', vnetAId: 'hub', vnetBId: 'spoke', enabled: true,
    aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags, useRemoteGateways: true } }]
  result.erLocations = [{ id: 'location', name: 'ER location' }]
  result.sites = [{ id: 'dc', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  result.erLinks = [
    { id: 'er-gateway', name: 'Gateway connection', locationId: 'location', targetKind: 'vnet-gateway', targetId: 'gateway', enabled: true },
    { id: 'er-site', name: 'Site connection', locationId: 'location', targetKind: 'site', targetId: 'dc', enabled: true },
  ]
  return result
}

async function openMenu(page: Page, id: string) {
  await page.getByTestId(id).focus()
  await page.keyboard.press('Shift+F10')
}

async function trace(page: Page, mode: string, blockPeering = false) {
  await page.addInitScript((value) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
  }, topology(blockPeering))
  await page.goto(`/?mode=${mode}`)
  await expect(page.locator('.path-flow-circle')).toHaveCount(0)
  await openMenu(page, 'aznet-subnet-workload')
  await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
  await page.getByTestId('aznet-trace-dest-select').selectOption('site:dc:172.16.0.0/24')
  await page.getByTestId('aznet-run-trace-btn').click()
}

async function speeds(page: Page) {
  return page.locator('.path-flow').evaluateAll((flows) => flows.map((flow) => {
    const track = flow.querySelector<SVGPathElement>('.path-flow-track')!
    const matrix = track.getScreenCTM()!
    return track.getTotalLength() * Math.hypot(matrix.a, matrix.b) / flow.querySelector('animateMotion')!.getSimpleDuration()
  }))
}

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} streams filled circles along independent forward/return paths and keeps motion aligned`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await trace(page, mode)
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Symmetric Path')
    await expect(page.locator('.path-flow')).toHaveCount(2)
    const forward = page.locator('.path-flow[data-direction="forward"]')
    const reverse = page.locator('.path-flow[data-direction="return"]')
    expect(await forward.evaluate((node) => JSON.parse(node.getAttribute('data-segments')!))).toEqual([
      { id: 'peer', from: 'vnet:spoke', to: 'vnet:hub' },
      { id: 'er-gateway', from: 'vnet:hub', to: 'er-location:location' },
      { id: 'er-site', from: 'er-location:location', to: 'site:dc' },
    ])
    expect(await reverse.evaluate((node) => JSON.parse(node.getAttribute('data-segments')!))).toEqual([
      { id: 'er-site', from: 'site:dc', to: 'er-location:location' },
      { id: 'er-gateway', from: 'er-location:location', to: 'vnet:hub' },
      { id: 'peer', from: 'vnet:hub', to: 'vnet:spoke' },
    ])
    expect(await page.locator('.path-flow-circle').count()).toBeGreaterThan(2)
    const motion = await forward.evaluate(async (flow) => {
      const svg = flow.ownerSVGElement!
      const track = flow.querySelector<SVGPathElement>('.path-flow-track')!
      const circle = flow.querySelector('circle')!
      const animation = circle.querySelector('animateMotion')!
      svg.pauseAnimations()
      const duration = animation.getSimpleDuration(), start = animation.getStartTime()
      const errors = []
      for (const fraction of [0.2, 0.6]) {
        svg.setCurrentTime(start + duration * fraction)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const actual = new DOMPoint().matrixTransform(circle.getScreenCTM()!)
        const expected = track.getPointAtLength(track.getTotalLength() * fraction).matrixTransform(track.getScreenCTM()!)
        errors.push(Math.hypot(actual.x - expected.x, actual.y - expected.y))
      }
      const distance = ['aznet-peering-peer', 'aznet-erlink-er-gateway', 'aznet-erlink-er-site'].reduce((sum, id) =>
        sum + svg.querySelector<SVGLineElement>(`[data-testid="${id}"] line`)!.getTotalLength(), 0)
      svg.unpauseAnimations()
      return { errors, distance, trackLength: track.getTotalLength(), fill: getComputedStyle(circle).fill, pointerEvents: getComputedStyle(circle).pointerEvents }
    })
    expect(Math.max(...motion.errors)).toBeLessThan(2)
    expect(motion.trackLength).toBeCloseTo(motion.distance, 0)
    expect(motion.fill).toBe('rgb(5, 150, 105)')
    expect(motion.pointerEvents).toBe('none')
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    await page.getByTitle('Zoom in', { exact: true }).click()
    await expect.poll(async () => (await speeds(page)).every((speed) => Math.abs(speed - 200) < 0.01)).toBe(true)
    const oldTrack = await forward.locator('path').getAttribute('d')
    const box = await page.getByTestId('aznet-vnet-hub').boundingBox()
    await page.mouse.move(box!.x + 25, box!.y + 18)
    await page.mouse.down()
    await page.mouse.move(box!.x + 95, box!.y + 48, { steps: 4 })
    await page.mouse.up()
    await expect(forward.locator('path')).not.toHaveAttribute('d', oldTrack!)
    await expect.poll(async () => (await speeds(page)).every((speed) => Math.abs(speed - 200) < 0.01)).toBe(true)
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect.poll(async () => (await speeds(page)).every((speed) => Math.abs(speed - 200) < 0.01)).toBe(true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.path-flow-circle')).toHaveCount(0)
    await expect(page.getByTestId('aznet-erlink-er-site').locator('line')).toHaveAttribute('stroke', '#059669')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('.path-flow')).toHaveCount(2)
    await page.getByTestId('aznet-clear-highlights-btn').click()
    await expect(page.locator('.path-flow-circle')).toHaveCount(0)
    await openMenu(page, 'aznet-subnet-workload')
    await page.getByRole('menuitem', { name: 'Show path to', exact: true }).click()
    await page.getByRole('menuitem', { name: 'All workload subnets', exact: true }).click()
    await expect(page.locator('.path-flow')).toHaveCount(2)
    expect(await forward.evaluate((node) => JSON.parse(node.getAttribute('data-segments')!))).toEqual([
      { id: 'peer', from: 'vnet:spoke', to: 'vnet:hub' },
    ])
    await page.getByTestId('aznet-vnet-spoke').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Delete')
    await page.getByRole('dialog', { name: 'Delete VNet', exact: true }).getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(page.locator('.path-flow-circle')).toHaveCount(0)
  })
}

test('failed peering crossings never animate an untraversed link', async ({ page }) => {
  await trace(page, 'hub-spoke', true)
  await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Flow Blocked')
  const segments = await page.locator('.path-flow').evaluateAll((flows) =>
    flows.flatMap((flow) => JSON.parse(flow.getAttribute('data-segments')!) as { id: string }[]))
  expect(segments.some((segment) => segment.id === 'peer')).toBe(false)
})
