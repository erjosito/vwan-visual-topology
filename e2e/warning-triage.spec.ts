import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { AZURE_NET_SAMPLES, type AzNetTopology } from '../src/azure-net/model'
import type { Topology } from '../src/model'

const nativeKey = 'aznet-visual-topology:v1'
const nativeTopology = () => {
  const topology = structuredClone(AZURE_NET_SAMPLES.find((sample) => sample.id === 'hub-spoke-firewall-udr')!.topology)
  topology.vnetPeerings[0].bToA.allowGatewayTransit = true
  topology.vnetPeerings[1].bToA.allowGatewayTransit = true
  topology.vnetPeerings.push({
    id: 'peer-app-data', name: 'App to data', vnetAId: 'vnet-spoke-app', vnetBId: 'vnet-spoke-data', enabled: true,
    aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
    bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
  })
  topology.vnets[0].appliances[0].enableIpForwarding = false
  return topology
}
async function importNative(page: Page, topology: AzNetTopology) {
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'warning-triage.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
  })
}
const nativeSaved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).topology as AzNetTopology, nativeKey)
const warningCard = (page: Page, id: string) => page.locator(`[data-finding-id="${id}"]`)
const nativeWarningId = 'peering-agt-no-gw:peer-hub-app:vnet-spoke-app'
async function openNativeDiagnostics(page: Page) {
  const action = page.getByTestId('aznet-run-diagnostics-btn')
  await expect(action).toBeAttached()
  if (!await action.isVisible()) await page.locator('.presentation-group > summary').filter({ hasText: 'Routing checks' }).click()
  await action.click()
}

for (const mode of ['hub-spoke', 'full']) for (const preview of [false, true]) {
  test(`warning triage persists independent native findings, history and changed evidence in ${mode}, preview=${preview}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('aznet-ui-preview:v1', String(value)), preview)
    await page.addInitScript(() => { window.__AZNET_METRICS__ = { counts: {}, durations: {} } })
    await page.goto(`/?mode=${mode}`)
    await importNative(page, nativeTopology())
    await openNativeDiagnostics(page)
    const card = warningCard(page, nativeWarningId)
    await expect(card).toBeVisible()
    const badge = page.getByTestId('aznet-finding-badge-vnet-spoke-app')
    const before = Number(await badge.getAttribute('data-root-count'))
    expect(before).toBeGreaterThan(1)
    const workBefore = await page.evaluate(() => ({ ...window.__AZNET_METRICS__!.counts }))
    await card.getByTestId('warning-acknowledgement').click()
    await expect(card).toHaveClass(/acknowledged-warning/)
    await expect(card.getByText('Acknowledged warning — not fixed', { exact: true })).toBeVisible()
    await expect(card.getByText('Remediation:', { exact: true })).toBeVisible()
    await expect(badge).toHaveAttribute('data-root-count', String(before - 1))
    await expect(page.getByTestId('warning-attention-count')).toContainText('1 acknowledged')
    await expect.poll(async () => (await nativeSaved(page)).warningAcknowledgements?.length).toBe(1)
    const workAfter = await page.evaluate(() => ({ ...window.__AZNET_METRICS__!.counts }))
    for (const kind of ['simulation', 'connectivity', 'diagnostics', 'trace']) expect(workAfter[kind]).toBe(workBefore[kind])
    const accepted = await nativeSaved(page)
    const ids = await page.locator('[data-finding-id]').evaluateAll((cards) => cards.map((entry) => entry.getAttribute('data-finding-id')))
    expect(ids.at(-1)).toBe(nativeWarningId)
    const errors = page.locator('[data-finding-id]').filter({ has: page.locator('.aznet-badge.error') })
    expect(await errors.count()).toBeGreaterThan(0)
    await expect(errors.getByTestId('warning-acknowledgement')).toHaveCount(0)
    await page.getByRole('button', { name: /Undo/ }).click()
    await expect(card).not.toHaveClass(/acknowledged-warning/)
    await page.getByRole('button', { name: /Redo/ }).click()
    await expect(card).toHaveClass(/acknowledged-warning/)
    await page.reload()
    await openNativeDiagnostics(page)
    await expect(card).toHaveClass(/acknowledged-warning/)
    const changed = structuredClone(accepted)
    changed.vnets.find((vnet) => vnet.id === 'vnet-spoke-app')!.subnets[0].defaultOutboundAccess = false
    await importNative(page, changed)
    await openNativeDiagnostics(page)
    await expect(card).not.toHaveClass(/acknowledged-warning/)
    await expect(card.getByRole('button', { name: 'Acknowledge warning', exact: true })).toBeVisible()
    await importNative(page, accepted)
    await openNativeDiagnostics(page)
    await expect(card).toHaveClass(/acknowledged-warning/)
    if (preview) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        const accessibility = await new AxeBuilder({ page }).include('[data-finding-id]').analyze()
        expect(accessibility.violations).toEqual([])
      }
    }
    await card.getByRole('button', { name: 'Restore attention', exact: true }).click()
    await expect(card).not.toHaveClass(/acknowledged-warning/)
    await expect(badge).toHaveAttribute('data-root-count', String(before))
    await expect.poll(async () => (await nativeSaved(page)).warningAcknowledgements).toBeUndefined()
    await importNative(page, nativeTopology())
    await openNativeDiagnostics(page)
    await expect(card).not.toHaveClass(/acknowledged-warning/)
  })
}

function asymmetricTopology(): Topology {
  return {
    version: 1, name: 'Warning triage',
    hubs: [{ id: 'h', name: 'Hub', region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    spokes: [],
    sites: [
      { id: 'one', name: 'First site', asn: 65001, prefixes: ['10.1.0.0/24'] },
      { id: 'two', name: 'Second site', asn: 65002, prefixes: ['10.2.0.0/24'], routeMapAssignments: [{ connectionId: 'return', outboundMapId: 'prepend-return' }] },
    ],
    connections: [
      { id: 'first', name: 'First VPN', hubId: 'h', siteId: 'one', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] },
      { id: 'outward', name: 'Outbound VPN', hubId: 'h', siteId: 'two', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [], outboundMapId: 'drop' },
      { id: 'return', name: 'Return VPN', hubId: 'h', siteId: 'two', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] },
    ],
    siteLinks: [],
    routeMaps: [
      { id: 'drop', name: 'Return filter', hubId: 'h', rules: [{ id: 'rule', prefixes: ['10.1.0.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] },
      { id: 'prepend-return', name: 'Prepend return', siteId: 'two', rules: [{ id: 'rule-p', prefixes: ['10.2.0.0/24'], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [65002], nextStep: 'terminate' }] },
    ],
  }
}
async function importVwan(page: Page, topology: Topology) {
  await page.getByLabel('Import topology file').setInputFiles({
    name: 'warning-triage.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
  })
}
for (const advanced of [false, true]) {
  test(`VWAN warning attention is reversible and survives reanalysis/localization, advanced=${advanced}`, async ({ page }) => {
    await page.goto('/')
    await importVwan(page, asymmetricTopology())
    await page.getByRole('button', { name: 'Check routing', exact: true }).click()
    const marker = page.locator('.routing-issue-marker[data-issue-id^="asymmetric:"]').first()
    await marker.click()
    const dialog = page.getByRole('dialog', { name: advanced ? 'Routing diagnostics' : 'Routing issues', exact: true })
    if (advanced) {
      await page.getByRole('button', { name: 'Advanced checks', exact: true }).click()
      await dialog.getByRole('button', { name: 'Add flow requirement', exact: true }).click()
      await dialog.getByLabel('Diagnostic source', { exact: true }).selectOption('site:one')
      await dialog.getByLabel('Diagnostic destination', { exact: true }).selectOption('site:two')
      await dialog.getByRole('button', { name: 'Run diagnostics', exact: true }).click()
    }
    const card = dialog.locator('.diagnostic-finding.warning').filter({ has: page.getByRole('button', { name: 'Acknowledge warning', exact: true }) }).first()
    await expect(card).toBeVisible()
    const id = (await card.getAttribute('data-finding-id'))!
    const accepted = warningCard(page, id)
    await accepted.getByTestId('warning-acknowledgement').click()
    await expect(accepted).toHaveClass(/acknowledged-warning/)
    await expect(dialog.getByTestId('warning-attention-count')).toContainText('1 acknowledged')
    if (!advanced) await expect(page.locator('.routing-issue-marker[data-issue-id^="asymmetric:"]')).toHaveCount(0)
    await expect(page.locator('.path-flow')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!).warningAcknowledgements?.length)).toBe(1)
    if (advanced) {
      await dialog.getByRole('button', { name: 'Run diagnostics', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Check routing', exact: true }).click()
      await page.getByRole('button', { name: 'Review routing issues', exact: true }).click()
    }
    await expect(accepted).toHaveClass(/acknowledged-warning/)
    await page.locator('header [data-language-selector]').selectOption('ja')
    await expect(accepted.getByRole('button', { name: '要確認に戻す', exact: true })).toBeVisible()
    await expect(accepted.getByText('確認済みの警告 — 修正済みではありません', { exact: true })).toBeVisible()
    await accepted.getByRole('button', { name: '要確認に戻す', exact: true }).click()
    await expect(accepted).not.toHaveClass(/acknowledged-warning/)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!).warningAcknowledgements)).toBeUndefined()
    if (!advanced) await expect(page.locator('.routing-issue-marker[data-issue-id^="asymmetric:"]').first()).toBeVisible()
  })
}
