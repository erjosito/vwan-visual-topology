import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { comparisonDesign, observationFixture } from '../tests/azure-observation-fixture'
import { createDiscrepancyBundle, readDiscrepancyBundle } from '../src/discrepancy-bundle'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { compareAzNetWithObservations } from '../src/azure-net/azure-import'
import { simulateAzNet } from '../src/azure-net/engine'
import type { AzCapturedObservations } from '../src/azure-net/azure-import'

async function open(page: Page) {
  await page.getByTestId('workspace-azure-button').click()
  await page.getByText('Report a discrepancy', { exact: true }).click()
}
async function upload(page: Page, bytes: Uint8Array) {
  await page.getByLabel('Issue bundle ZIP file', { exact: true }).setInputFiles({
    name: 'aznetsim-discrepancy.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes),
  })
}
async function download(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download issue bundle', exact: true }).click()
  const result = await pending, chunks: Buffer[] = []
  expect(result.suggestedFilename()).toBe('aznetsim-discrepancy.zip')
  for await (const chunk of (await result.createReadStream())!) chunks.push(chunk)
  return Buffer.concat(chunks)
}

test('exports a reviewed local comparison and replays it only after confirmation, preserving invalid/cancelled imports', async ({ page }) => {
  const external: string[] = [], failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await page.goto('/?mode=vwan')
  const origin = new URL(page.url()).origin
  page.on('request', request => { if (new URL(request.url()).origin !== origin) external.push(request.url()) })
  await page.getByLabel('Import topology file').setInputFiles({
    name: 'design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(comparisonDesign())),
  })
  await open(page)
  await page.getByRole('button', { name: 'Compare with Azure capture', exact: true }).click()
  const capture = observationFixture()
  capture.observations.tables[0].routes.pop()
  await page.getByLabel('Azure comparison capture file').setInputFiles({
    name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)),
  })
  await page.getByLabel('Design hub for Observed west', { exact: true }).selectOption('h')
  for (const id of ['a', 'b']) await page.getByLabel(`Design spoke for Observed ${id}`, { exact: true }).selectOption(id)
  await page.getByLabel('Exact expected IPv4 prefixes', { exact: false }).fill('10.2.0.0/24')
  await page.getByRole('checkbox', { name: /I have modeled all expected routes/ }).check()
  await page.getByRole('button', { name: 'Compare captured fields', exact: true }).click()
  await expect(page.locator('.comparison-finding.design-only')).toContainText('10.2.0.0/24')
  await page.getByLabel('Summary', { exact: true }).fill('Investigate the missing route')
  await page.getByLabel('Expected result', { exact: true }).fill('Azure should return 10.2.0.0/24.')
  await page.getByLabel('Actual result', { exact: true }).fill('The route is absent from the capture.')
  await expect(page.getByRole('button', { name: 'Download issue bundle', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: /I reviewed the contents and understand/ }).check()
  const bytes = await download(page), bundle = await readDiscrepancyBundle(bytes)
  expect(bundle.manifest.app.host).toBe('web')
  if (bundle.source.mode !== 'vwan') throw new Error('Wrong mode')
  expect(bundle.source.session?.capture).toEqual(capture)
  expect(bundle.originalReport).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ status: 'design-only' })]) })
  const issueLink = page.getByRole('link', { name: 'Open GitHub issue and attach ZIP manually', exact: true })
  const issueUrl = decodeURIComponent((await issueLink.getAttribute('href'))!)
  expect(issueUrl).not.toContain('Investigate the missing route')
  expect(issueUrl).not.toContain('10.2.0.0')
  await page.getByLabel('Actual result', { exact: true }).fill('Updated description requires another review.')
  await expect(issueLink).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download issue bundle', exact: true })).toBeDisabled()

  const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await upload(page, Buffer.from('not a ZIP'))
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  await expect(page.locator('.comparison-finding.design-only')).toContainText('10.2.0.0/24')
  await upload(page, bytes)
  await expect(page.getByRole('region', { name: 'Review imported bundle' })).toContainText('Investigate the missing route')
  await expect(page.getByRole('button', { name: 'Replace workspace and replay bundle', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel bundle import', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
  await upload(page, bytes)
  await page.getByRole('checkbox', { name: /I understand this replaces the current workspace/ }).check()
  await page.getByRole('button', { name: 'Replace workspace and replay bundle', exact: true }).click()
  await expect(page.getByText('Historical comparison replay at', { exact: false })).toBeVisible()
  await expect(page.locator('.comparison-finding.design-only')).toContainText('10.2.0.0/24')
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1')))!)).toEqual(bundle.source.topology)
  expect(external).toEqual([])
  expect(failures).toEqual([])
})

test('full-network bundles restore denied NIC and BGP evidence without treating it as a match, including Japanese/mobile interaction', async ({ page }) => {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Offline investigation'
  topology.vnets.push({ id: 'a', name: 'vnet', region: 'westeurope', role: 'spoke-vnet', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 's', name: 'work', prefix: '10.1.0.0/24' }], gateways: [], appliances: [] })
  const observations: AzCapturedObservations = {
    capturedAt: '2026-01-01T00:00:00.000Z', collectorVersion: 'test-collector', resourceGroup: 'network', observationVersion: 1,
    nicEffectiveRoutes: [{ nicName: 'vm-nic', nicId: '/nic', vnetName: 'vnet', subnetName: 'work',
      effectiveRoutes: [], observation: { state: 'denied', complete: false } }],
    vngLearnedRoutes: { gateway: [{ network: '172.16.0.0/16', asPath: '65001 65001' }] },
  }
  const bytes = createDiscrepancyBundle({
    mode: 'azure-network', topology, observations, notices: ['Permission denied; evidence is incomplete.'],
    comparison: compareAzNetWithObservations(topology, simulateAzNet(topology), observations), comparisonCurrent: true,
  }, { summary: 'Denied NIC route capture', expected: 'A complete captured table.', actual: 'Permission denied.' },
  { version: 'test-version', revision: 'original-commit', engineRevision: 'original-commit', host: 'windows' })
  await page.goto('/?mode=full')
  await open(page)
  const saved = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await upload(page, bytes)
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(saved)
  await page.getByRole('checkbox', { name: /I understand this replaces the current workspace/ }).check()
  await page.getByRole('button', { name: 'Replace workspace and replay bundle', exact: true }).click()
  await expect(page.getByTestId('aznet-comparison-report')).toContainText('COVERAGE UNKNOWN')
  await expect(page.getByText('Imported historical evidence from app test-version', { exact: false })).toBeVisible()
  await expect(page.getByText('Permission denied; evidence is incomplete.', { exact: true })).toBeVisible()
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology.name).toBe(topology.name)
  await page.getByLabel('Summary', { exact: true }).fill('Round trip this evidence')
  await page.getByLabel('Expected result', { exact: true }).fill('Preserve the observations.')
  await page.getByLabel('Actual result', { exact: true }).fill('Retain partial coverage.')
  await page.getByRole('checkbox', { name: /I reviewed the contents and understand/ }).check()
  const exported = await readDiscrepancyBundle(await download(page))
  if (exported.source.mode !== 'azure-network') throw new Error('Wrong mode')
  expect(exported.source.observations).toEqual(observations)
  await page.locator('header [data-language-selector]').selectOption('ja')
  await expect(page.getByRole('button', { name: 'Issue 用バンドルを読み込む', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('rejects a bundle from the wrong workspace mode without replacing the design', async ({ page }) => {
  const bytes = createDiscrepancyBundle({ mode: 'vwan', topology: comparisonDesign() },
    { summary: 'Wrong workspace mode', expected: 'Reject the package.', actual: 'VWAN package in Full Hybrid.' },
    { version: 'test', revision: 'test', engineRevision: 'test', host: 'web' })
  await page.goto('/?mode=full')
  await open(page)
  const saved = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await upload(page, bytes)
  await expect(page.getByRole('alert')).toContainText('matching workspace mode: vwan')
  await expect(page.getByRole('region', { name: 'Review imported bundle' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(saved)
})
