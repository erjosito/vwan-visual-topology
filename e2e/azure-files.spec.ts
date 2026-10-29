import { expect, test } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Topology } from '../src/model'

const base = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network'
function capture() {
  return {
    kind: 'azure-vwan-capture', version: 1, collectorVersion: '1', capturedAt: '2026-09-10T12:00:00Z', complete: true, warnings: [],
    wan: { id: `${base}/virtualWans/wan`, name: 'Azure captured WAN', type: 'Standard', allowBranchToBranchTraffic: true, allowVnetToVnetTraffic: true },
    hubs: [{
      id: `${base}/virtualHubs/west`, name: 'West hub', location: 'westeurope', virtualWanId: `${base}/virtualWans/wan`,
      addressPrefix: '10.250.0.0/23', hubRoutingPreference: 'VpnGateway', unsupportedFeatures: [] as string[],
      routingPolicies: [] as { destinations: string[]; nextHop: string }[], gatewayTypes: [],
      connections: [{ name: 'Application VNet', virtualNetworkId: `${base}/virtualNetworks/app`, addressPrefixes: ['10.20.0.0/16'] as string[] | null, defaultRouting: true }],
    }],
  }
}
const upload = (page: Page, input: unknown) => page.getByLabel('Import topology file').setInputFiles({
  name: 'azure-capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)),
})
const saved = (page: Page): Promise<Topology> => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
const panel = (page: Page) => page.getByRole('dialog', { name: 'Azure files', exact: true })
async function contents(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(chunk)
  return Buffer.concat(chunks)
}
async function confirmImport(page: Page) {
  await panel(page).getByLabel('I understand this is a structure-only import, not verified Azure routing.').check()
  await panel(page).getByRole('button', { name: 'Replace workspace with Azure capture' }).click()
  await expect(page.getByLabel('Topology name')).toHaveValue('Azure captured WAN')
}

test('Azure captures preview without replacement, cancel cleanly, and retain limitations through reload/native JSON', async ({ page }) => {
  const externalRequests: string[] = []
  await page.goto('/')
  const appOrigin = new URL(page.url()).origin
  page.on('request', (request) => { if (new URL(request.url()).origin !== appOrigin) externalRequests.push(request.url()) })
  const original = await saved(page)
  await upload(page, capture())
  await expect(panel(page).getByRole('heading', { name: 'Review Azure capture' })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Replace workspace with Azure capture' })).toBeDisabled()
  expect(await saved(page)).toEqual(original)
  await panel(page).getByRole('button', { name: 'Cancel Azure import' }).click()
  expect(await saved(page)).toEqual(original)
  await upload(page, capture())
  await confirmImport(page)
  await expect(page.getByRole('status').filter({ hasText: 'Azure structure-only import' })).toBeVisible()
  expect((await saved(page)).hubs[0].preference).toBe('VPN')
  expect((await saved(page)).sites).toEqual([])
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Azure structure-only import' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const native = JSON.parse((await contents(await download)).toString()) as Topology
  expect(native.azureImport?.hubs[0].addressPrefix).toBe('10.250.0.0/23')
  await upload(page, native)
  await expect(panel(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Review import limitations' }).click()
  await expect(panel(page).getByText(/Structural Azure import, not a production routing replica/)).toBeVisible()
  expect(await saved(page)).toEqual(native)
  expect(externalRequests).toEqual([])
})

test('partial imports disclose omissions, require renewed acknowledgement, and reject malformed files without changing the workspace', async ({ page }) => {
  await page.goto('/')
  const original = await saved(page)
  await upload(page, capture())
  await panel(page).getByLabel('I understand this is a structure-only import, not verified Azure routing.').check()
  const partial = capture()
  partial.complete = false
  partial.hubs[0].unsupportedFeatures = ['Route maps could not be read.']
  partial.hubs[0].connections[0].addressPrefixes = null
  await upload(page, partial)
  await expect(panel(page).getByRole('button', { name: 'Replace workspace with Azure capture' })).toBeDisabled()
  await expect(panel(page).getByText(/1 hubs · 0 IPv4 spokes/)).toBeVisible()
  await expect(panel(page).getByText(/A referenced VNet could not be read/)).toBeVisible()
  await expect(panel(page).getByRole('cell', { name: 'Partial / unsupported routing' })).toBeVisible()
  expect(await saved(page)).toEqual(original)
  await upload(page, { kind: 'azure-vwan-capture', version: 999 })
  await expect(page.getByRole('alert')).toContainText('Unsupported Azure capture')
  expect(await saved(page)).toEqual(original)
  await expect(panel(page).getByRole('button', { name: 'Replace workspace with Azure capture' })).toHaveCount(0)
  await upload(page, { ...capture(), warnings: ['x'.repeat(2_000_000)] })
  await expect(page.getByRole('alert')).toContainText('2 MB')
  expect(await saved(page)).toEqual(original)
})

test('Bicep download uses explicit reviewed infrastructure settings and invalidates a stale preview', async ({ page }) => {
  await page.goto('/')
  await upload(page, capture()); await confirmImport(page)
  await page.getByRole('button', { name: 'Azure files', exact: true }).click()
  await expect(panel(page).getByLabel('Infrastructure CIDR for West hub')).toHaveValue('10.250.0.0/23')
  await panel(page).getByRole('button', { name: 'Review Bicep export' }).click()
  await expect(panel(page).getByRole('heading', { name: '2 resources · new deployment' })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Download main.bicep' })).toBeDisabled()
  await panel(page).getByLabel('I reviewed the resources, exclusions and deployment costs.').check()
  await page.getByLabel('Topology name', { exact: true }).fill('Changed planning workspace')
  await expect(panel(page).getByRole('button', { name: 'Download main.bicep' })).toHaveCount(0)
  await expect(panel(page).getByText('Workspace changed. Review the export again before downloading.')).toBeVisible()
  await panel(page).getByLabel('Infrastructure CIDR for West hub').fill('10.250.0.0/25')
  await panel(page).getByRole('button', { name: 'Review Bicep export' }).click()
  await expect(panel(page).getByRole('alert')).toContainText('explicit IPv4 network CIDR')
  await panel(page).getByLabel('Infrastructure CIDR for West hub').fill('10.250.0.0/23')
  await panel(page).getByRole('button', { name: 'Review Bicep export' }).click()
  await panel(page).getByLabel('I reviewed the resources, exclusions and deployment costs.').check()
  const event = page.waitForEvent('download')
  await panel(page).getByRole('button', { name: 'Download main.bicep' }).click()
  const download = await event
  expect(download.suggestedFilename()).toBe('main.bicep')
  const text = (await contents(download)).toString()
  expect(text).toContain("'VpnGateway'")
  expect(text).toContain("addressPrefix: '10.250.0.0/23'")
  expect(text).toContain('1 spokes')
  expect(text).not.toContain('/subscriptions/')
  expect(text).not.toContain('Microsoft.Network/virtualHubs/hubVirtualNetworkConnections')
})

test('secured hubs cannot be exported as unsecured; excluding them is explicit', async ({ page }) => {
  await page.goto('/')
  const input = capture()
  const secured = structuredClone(input.hubs[0])
  secured.id = `${base}/virtualHubs/secured`; secured.name = 'Secured hub'; secured.addressPrefix = '10.251.0.0/23'; secured.connections = []
  secured.routingPolicies = [{ destinations: ['PrivateTraffic'], nextHop: `${base}/azureFirewalls/firewall` }]
  input.hubs.push(secured)
  await upload(page, input); await confirmImport(page)
  await page.getByRole('button', { name: 'Azure files', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Review Bicep export' }).click()
  await expect(panel(page).getByRole('alert')).toContainText('Secured hubs require firewall deployment support')
  await expect(panel(page).getByRole('button', { name: 'Download main.bicep' })).toHaveCount(0)
  await panel(page).getByLabel('Export Secured hub', { exact: true }).uncheck()
  await panel(page).getByRole('button', { name: 'Review Bicep export' }).click()
  await expect(panel(page).getByText('Excluded hubs: Secured hub.', { exact: true })).toBeVisible()
  await expect(panel(page).getByRole('heading', { name: '2 resources · new deployment' })).toBeVisible()
})

test('collector downloads the exact reviewable script from a static asset, with no Azure authentication', async ({ page }) => {
  await page.goto('/')
  const original = await saved(page)
  await page.getByRole('button', { name: 'Azure files', exact: true }).click()
  const link = panel(page).getByRole('link', { name: 'Download Azure collector' })
  const event = page.waitForEvent('download')
  await link.click()
  const download = await event
  expect(download.suggestedFilename()).toBe('collect-azure-vwan.ps1')
  const expected = await readFile(new URL('../src/collect-azure-vwan.ps1', import.meta.url), 'utf8')
  expect((await contents(download)).toString().replaceAll('\r\n', '\n')).toBe(expected.replaceAll('\r\n', '\n'))
  const response = await page.request.get((await link.getAttribute('href'))!)
  expect(response.ok()).toBe(true)
  expect((await response.text()).startsWith('#requires -Version 7.0')).toBe(true)
  expect(await saved(page)).toEqual(original)
})
