import { expect, test, type Locator, type Page } from '@playwright/test'
import { example, type Topology } from '../src/model'
import { validateTopology } from '../src/validation'
import { createEmptyAzNetTopology } from '../src/azure-net/model'

function vwanFixture(): Topology {
  const t = structuredClone(example)
  t.spokes = [
    { id: 'west-vnet', name: 'Regional VNet', region: 'westeurope', hubId: 'eu', prefixes: ['10.0.0.0/24'] },
    { id: 'work', name: 'Workload', region: 'East US', hubId: 'us', prefixes: ['10.1.0.0/24'] },
  ]
  t.sites = [
    { id: 'a', name: 'Branch', asn: 65001, prefixes: ['172.16.0.0/24'] },
    { id: 'transit', name: 'Transit', asn: 65002, prefixes: [] },
  ]
  t.connections = []
  t.siteLinks = [{ id: 'wan', name: 'WAN', a: 'a', b: 'transit', enabled: true,
    aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }]
  t.erLocations = [{ id: 'er', name: 'Amsterdam', sku: 'Premium' }]
  t.erLinks = [
    { id: 'hub-circuit', name: 'Hub circuit', locationId: 'er', hubId: 'eu', enabled: true, learnSiteRoutes: false },
    { id: 'site-circuit', name: 'Site circuit', locationId: 'er', siteId: 'transit', enabled: true, learnSiteRoutes: true },
  ]
  return t
}

function azFixture(full: boolean) {
  const t = createEmptyAzNetTopology()
  t.vnets = [
    { id: 'west', name: 'Regional VNet', region: 'westeurope', role: 'hub', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'gw-subnet', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
      gateways: [{ id: 'gw', name: 'ER gateway', kind: 'ExpressRoute', enabled: true, bgpEnabled: true, asn: 65515 }],
      appliances: [] },
    { id: 'work', name: 'Workload', region: 'East US', role: 'spoke', prefixes: ['10.1.0.0/16'],
      subnets: [{ id: 'work-subnet', name: 'Workload', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  t.vnetPeerings = [{ id: 'peer', name: 'Transit peering', enabled: true, vnetAId: 'west', vnetBId: 'work',
    aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags, useRemoteGateways: true } }]
  t.sites = vwanFixture().sites
  t.siteLinks = [{ id: 'wan', name: 'WAN', siteAId: 'a', siteBId: 'transit', enabled: true }]
  t.erLocations = [{ id: 'er', name: 'Amsterdam', sku: 'Premium' }]
  t.erLinks = [
    { id: 'hub-circuit', name: 'Hub circuit', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
    { id: 'site-circuit', name: 'Site circuit', locationId: 'er', targetKind: 'site', targetId: 'transit', enabled: true },
  ]
  if (full) {
    t.vwanHubs = [{ id: 'hub', name: 'Regional hub', region: 'West Europe', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false } }]
    t.erLinks[0] = { ...t.erLinks[0], targetKind: 'vwan-hub', targetId: 'hub' }
    t.vnets[1].vwanHubAttachment = { hubId: 'hub', enabled: true }
    t.vnetPeerings = []
  }
  return t
}

async function menu(page: Page, node: Locator) {
  await node.focus()
  await page.keyboard.press('Shift+F10')
}

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode} supports offline domain failures, fault-only menus including regional children, and exact baseline restoration`, async ({ page }) => {
    const topology = mode === 'vwan' ? vwanFixture() : azFixture(mode === 'full')
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ topology, key, mode }) => {
      localStorage.setItem(key, JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }))
    }, { topology, key, mode })
    await page.goto(`/?mode=${mode}`)
    const initial = await page.evaluate((key) => localStorage.getItem(key), key)
    const regionNode = mode === 'vwan' ? page.locator('[data-node-id="eu"][role="button"]') : page.getByTestId('aznet-vnet-west')
    const regionalChild = mode === 'vwan' ? page.locator('[data-node-id="west-vnet"][role="button"]') : page.getByTestId('aznet-subnet-gw-subnet')
    const locationNode = mode === 'vwan' ? page.locator('[data-node-id="er"][role="button"]') : page.getByTestId('aznet-erloc-er')
    const transitNode = mode === 'vwan' ? page.locator('[data-node-id="transit"][role="button"]') : page.getByTestId('aznet-site-transit')

    for (const [node, label] of [[regionNode, 'Azure region West Europe'], [locationNode, 'ER location Amsterdam'], [transitNode, 'on-premises site Transit']] as const) {
      await menu(page, node)
      await page.getByRole('menuitem', { name: `Simulate failure of ${label}`, exact: true }).click()
      await expect(page.getByTestId('active-faults')).toContainText(label)
      await expect(node).toHaveAttribute('data-simulated-failed', 'true')
      await expect(page.getByRole('img', { name: /Simulated failure:/ }).first()).toBeVisible()
      await menu(page, node)
      await expect(page.getByRole('menuitem')).toHaveCount(1)
      await expect(page.getByRole('menuitem')).toHaveText(`Restore ${label}`)
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('menu')).toHaveCount(1)
      await page.keyboard.press('Escape')
      if (label.startsWith('Azure')) {
        await menu(page, regionalChild)
        await expect(page.getByRole('menuitem')).toHaveCount(1)
        await expect(page.getByRole('menuitem')).toHaveText('Restore Azure region West Europe')
        await page.keyboard.press('Escape')
        await expect(locationNode).not.toHaveAttribute('data-simulated-failed', 'true')
      }
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(initial)
      if (label.startsWith('Azure')) {
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: /Export JSON/ }).click()
        const chunks: Buffer[] = []
        for await (const chunk of (await (await download).createReadStream())!) chunks.push(chunk)
        const exported = JSON.parse(Buffer.concat(chunks).toString())
        const saved = JSON.parse(initial!)
        expect(exported).toEqual(mode === 'vwan' ? validateTopology(saved) : saved.topology)
      }
      await menu(page, label.startsWith('Azure') ? regionalChild : node)
      await page.getByRole('menuitem', { name: `Restore ${label}`, exact: true }).click()
      await expect(page.getByTestId('active-faults')).toHaveCount(0)
      await expect(node).not.toHaveAttribute('data-simulated-failed', 'true')
      await menu(page, node)
      expect(await page.getByRole('menuitem').count()).toBeGreaterThan(1)
      await page.keyboard.press('Escape')
    }

    await page.getByText('Failure-domain resilience analysis (N-1)', { exact: true }).click()
    await page.getByRole('button', { name: 'Analyze N-1 resilience', exact: true }).click()
    const result = page.getByTestId('resilience-results')
    await expect(result).toContainText(/N-1 resilience gaps/)
    await expect(result).toContainText('baseline-working pair/scenario cases')
    await expect(result).toContainText('service recovery unassessed')
    const finding = result.locator('details').filter({ has: page.locator('summary').filter({ hasText: /Resilience gap:.*Workload.*loss of ER location Amsterdam/ }) }).first()
    await expect(finding).toHaveAttribute('data-scenario-id', 'er-location:er')
    await expect(finding).toHaveAttribute('data-failure-domain-id', 'er')
    await expect(finding).toHaveAttribute('data-failure-domain-kind', 'er-location')
    await expect(finding).toHaveAttribute('data-finding-id', /^resilience-gap:/)
    await finding.locator('summary').first().click()
    await expect(finding).toContainText('independently routed alternate')
    await finding.getByRole('button', { name: 'Simulate loss of ER location Amsterdam', exact: true }).click()
    await expect(locationNode).toHaveAttribute('data-simulated-failed', 'true')
    await expect(page.getByRole('button', { name: /Review \d+ N-1 resilience gaps for work/ })).toBeVisible()
    await page.getByRole('button', { name: 'Restore all simulated failures', exact: true }).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(initial)
  })

  test(`${mode} recomputes independent path evidence and analysis on fault/restore without changing saved topology`, async ({ page }) => {
    const topology = mode === 'vwan' ? vwanFixture() : azFixture(mode === 'full')
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ topology, key, mode }) => {
      localStorage.setItem(key, JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }))
    }, { topology, key, mode })
    await page.goto(`/?mode=${mode}`)
    const work = mode === 'vwan' ? page.locator('[data-node-id="work"][role="button"]') : page.getByTestId('aznet-subnet-work-subnet')
    const er = mode === 'vwan' ? page.locator('[data-node-id="er"][role="button"]') : page.getByTestId('aznet-erloc-er')
    await page.getByRole('button', { name: 'Check routing', exact: true }).click()
    const routingStatus = mode === 'vwan' ? page.locator('.routing-check-status') : page.getByTestId('aznet-routing-check-status')
    await expect(routingStatus).toContainText(mode === 'vwan' ? /\d+ routing issues/ : '0 connectivity failures')
    const baselineIssues = mode === 'vwan' ? (await routingStatus.textContent())!.match(/\d+ routing issues/)![0] : '0 connectivity failures'
    const show = async () => {
      await menu(page, work)
      await page.getByRole('menuitem', { name: 'Show path to', exact: true }).click()
      await page.getByRole('menuitem', { name: mode === 'vwan' ? 'All onprem sites' : 'All on-premises sites', exact: true }).click()
    }
    await show()
    if (mode === 'vwan') await expect(page.locator('.highlight-status')).toContainText('Reachable')
    else await expect(page.getByTestId('aznet-path-tracer-panel')).toContainText('delivered')
    await menu(page, er)
    await page.getByRole('menuitem', { name: 'Simulate failure of ER location Amsterdam', exact: true }).click()
    await expect(routingStatus).toContainText(mode === 'vwan' ? /[1-9]\d* routing issues/ : /[1-9]\d* connectivity failures/)
    await show()
    if (mode === 'vwan') await expect(page.locator('.highlight-status')).toContainText('No route')
    else await expect(page.getByTestId('aznet-path-tracer-panel')).toContainText('dropped-no-route')
    await page.getByRole('button', { name: 'Restore all simulated failures', exact: true }).click()
    await expect(routingStatus).toContainText(baselineIssues)
    await show()
    if (mode === 'vwan') await expect(page.locator('.highlight-status')).toContainText('Reachable')
    else await expect(page.getByTestId('aznet-path-tracer-panel')).toContainText('delivered')
  })
}
