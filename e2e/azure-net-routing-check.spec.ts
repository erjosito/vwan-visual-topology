import { expect, test, type Page } from '@playwright/test'
import { replaceActiveSavedTopology } from './workspace-storage-helpers'
import { AZURE_NET_SAMPLES, createEmptyAzNetTopology, type AzNetTopology } from '../src/azure-net/model'

function missingTransitTopology() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [
    { id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
      gateways: [{ id: 'gw', name: 'ER gateway', kind: 'ExpressRoute', enabled: true, bgpEnabled: true, asn: 65515 }],
      appliances: [] },
    { id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16'],
      subnets: [{ id: 'work', name: 'Workload', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings = [{ id: 'peer', name: 'Gateway transit', vnetAId: 'hub', vnetBId: 'spoke', enabled: true,
    aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags } }]
  topology.erLocations = [{ id: 'er', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
  topology.sites = [{ id: 'dc', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  topology.erLinks = [
    { id: 'er-gw', name: 'Gateway connection', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
    { id: 'er-dc', name: 'Datacenter circuit', locationId: 'er', targetKind: 'site', targetId: 'dc', enabled: true },
  ]
  return topology
}

async function load(page: Page, topology: AzNetTopology, mode = 'hub-spoke') {
  await page.addInitScript((value) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
  }, topology)
  await page.goto(`/?mode=${mode}`)
}

test('queued diagnosis replies cannot cross document owners and interrupted runs restore as cancelled', async ({ page }) => {
  await page.addInitScript(() => {
    const replies: (() => void)[] = []
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (String(url).includes('diagnostics-worker')) Object.defineProperty(this, 'onmessage', {
          set: (handler: (event: MessageEvent) => void) => {
            this.addEventListener('message', event => replies.push(() => handler(event)))
          },
        })
      }
    }
    Object.assign(window, { pendingDiagnosisReplies: () => replies.length,
      flushDiagnosisReplies: () => replies.splice(0).forEach(deliver => deliver()) })
  })
  const first = missingTransitTopology()
  first.name = 'Diagnosis owner A'
  await load(page, first, 'full')
  await page.getByTestId('aznet-check-routing-btn').click()
  const pending = () => page.evaluate(() => (window as unknown as { pendingDiagnosisReplies: () => number }).pendingDiagnosisReplies())
  const flush = () => page.evaluate(() => (window as unknown as { flushDiagnosisReplies: () => void }).flushDiagnosisReplies())
  await expect.poll(pending).toBe(1)
  const second = structuredClone(first)
  second.name = 'Diagnosis owner B'
  second.sites[0].id = 'second-dc'
  second.erLinks[1].targetId = 'second-dc'
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)),
  })
  const tabs = page.getByRole('tablist', { name: 'Designs', exact: true })
  await expect(tabs.getByRole('tab', { name: second.name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await flush()
  await expect(page.getByTestId('aznet-routing-check-status')).toHaveCount(0)
  await expect(page.locator('[data-testid^="aznet-finding-badge-"]')).toHaveCount(0)
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect.poll(pending).toBe(1)
  await flush()
  await expect(page.getByTestId('aznet-finding-badge-site-second-dc')).toBeVisible()
  await tabs.getByRole('tab', { name: first.name, exact: true }).click()
  await expect(page.locator('.routing-check-status')).toContainText('Analysis cancelled')
  await expect(page.locator('[data-testid^="aznet-finding-badge-"]')).toHaveCount(0)
})

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} checks the landscape in one click, navigates endpoint badges and refreshes repaired routing`, async ({ page }) => {
    await load(page, missingTransitTopology(), mode)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Check routing', exact: true }).click()
    const status = page.getByTestId('aznet-routing-check-status')
    await expect(status).toContainText('1 connectivity failures')
    await expect(status).toContainText('Checked 1 of 1 representative pairs (2 directional traces)')
    await expect(status).toContainText('intentional isolation may appear as disconnected pairs')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const spokeBadge = page.getByTestId('aznet-finding-badge-spoke')
    const siteBadge = page.getByTestId('aznet-finding-badge-site-dc')
    await expect(spokeBadge).toBeVisible()
    await expect(siteBadge).toBeVisible()
    await siteBadge.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Topology analysis', exact: true })).toBeVisible()
    await expect(page.getByTestId('aznet-review-finding-scope')).toContainText('selected canvas marker')
    await expect(page.getByTestId('aznet-analysis-scope')).toHaveValue('landscape')
    const failure = page.getByTestId('aznet-finding-connectivity-failure')
    await expect(failure).toContainText('useRemoteGateways / allowGatewayTransit')
    await failure.getByRole('button', { name: /Trace Flow/ }).click()
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Flow Blocked')
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    await page.getByTestId('aznet-peering-pill-peer').hover({ force: true })
    await page.getByTestId('aznet-peering-hover-card').getByLabel('Use Remote GW', { exact: true }).last().check()
    await page.mouse.move(10, 10)
    await expect(status).toContainText('0 connectivity failures')
    await expect(status).toContainText('No routing issues found within the checked model scope')
    await expect(siteBadge).toHaveCount(0)
    await expect(spokeBadge).toHaveCount(0)
    await page.getByTestId('aznet-review-routing-issues').click()
    await expect(page.getByTestId('aznet-finding-connectivity-failure')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close Topology analysis', exact: true }).click()
    await page.getByRole('button', { name: 'Clear routing check', exact: true }).click()
    await expect(status).toHaveCount(0)
    await expect(page.locator('[data-testid^="aznet-finding-badge-"]')).toHaveCount(0)
  })
}

test('one-click checks expose stateful asymmetry and link its marker to independent path evidence', async ({ page }) => {
  await load(page, AZURE_NET_SAMPLES[0].topology)
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(page.getByTestId('aznet-routing-check-status')).toContainText(/[1-9]\d* stateful asymmetries/)
  const badge = page.getByTestId('aznet-finding-badge-vnet-spoke-data')
  await badge.click()
  await expect(page.getByTestId('aznet-review-finding-scope')).toBeVisible()
  await page.getByTestId('aznet-finding-asymmetric-firewall-bypass').first().getByRole('button', { name: /Trace Flow/ }).click()
  await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Asymmetric')
  await expect(page.getByTestId('aznet-forward-hops')).toBeVisible()
  await expect(page.getByTestId('aznet-reverse-hops')).toBeVisible()
})

test('checks site-only landscapes and marks both disconnected sites without selecting endpoint combinations', async ({ page }) => {
  const topology = createEmptyAzNetTopology()
  topology.sites = [
    { id: 'a', name: 'Site A', asn: 65001, prefixes: ['10.10.0.0/24', '10.11.0.0/24'] },
    { id: 'b', name: 'Site B', asn: 65002, prefixes: ['10.20.0.0/24'] },
  ]
  await load(page, topology)
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(page.getByTestId('aznet-routing-check-status')).toContainText('2 connectivity failures')
  await expect(page.getByTestId('aznet-routing-check-status')).toContainText('Checked 2 of 2')
  await expect(page.getByTestId('aznet-finding-badge-site-a')).toBeVisible()
  await page.getByTestId('aznet-finding-badge-site-b').click()
  await expect(page.getByTestId('aznet-finding-connectivity-failure')).toHaveCount(2)
  await page.getByTestId('aznet-finding-connectivity-failure').first().getByRole('button', { name: /Trace Flow/ }).click()
  await expect(page.getByTestId('aznet-trace-source-select')).toHaveValue('site:a:10.10.0.0/24')
  await expect(page.getByTestId('aznet-trace-dest-select')).toHaveValue('site:b:10.20.0.0/24')
  await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Flow Blocked')
})

test('never claims success for empty, invalid or pair-limited coverage', async ({ page }) => {
  await page.goto('/?mode=hub-spoke')
  await page.getByTestId('aznet-check-routing-btn').click()
  const status = page.getByTestId('aznet-routing-check-status')
  await expect(status).toContainText('No eligible endpoint pairs were checked')
  await expect(status).not.toContainText('No routing issues found')
  const topology = createEmptyAzNetTopology()
  topology.sites = Array.from({ length: 22 }, (_, i) => ({
    id: `site-${i}`, name: `Site ${i}`, asn: 65000 + i, prefixes: [`10.${i}.0.0/24`],
  }))
  await replaceActiveSavedTopology(page, 'azure-net', JSON.stringify({ sampleId: '', topology }))
  await page.reload()
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(status).toContainText('Routing check incomplete; unchecked pairs are not verified')
  await expect(status).toContainText('Checked 200 of 231')
  await expect(status).not.toContainText('No routing issues found')
  topology.sites = [{ id: 'invalid', name: 'Invalid site', asn: 65001, prefixes: ['not-a-prefix'] }]
  await replaceActiveSavedTopology(page, 'azure-net', JSON.stringify({ sampleId: '', topology }))
  await page.reload()
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(status).not.toContainText('No routing issues found')
  await expect(status).toContainText(/validation errors|No eligible endpoint pairs/)
})
