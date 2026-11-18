import { expect, test } from './vwan-example-fixture'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { AZURE_NET_SAMPLES, createEmptyAzNetTopology, sampleDualHubVnraGlobalPeering, type AzNetTopology } from '../src/azure-net/model'

async function openNodeMenu(page: Page, testId: string) {
  await page.getByTestId(testId.replace(/^aznet-vnet-/, 'aznet-select-vnet-')).focus()
  await page.keyboard.press('Shift+F10')
}

async function inspectSubnet(page: Page, subnetId: string) {
  await openNodeMenu(page, `aznet-subnet-${subnetId}`)
  await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
}

async function loadTopology(page: Page, topology: AzNetTopology) {
  await page.addInitScript((value) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
  }, topology)
  await page.goto('/?mode=hub-spoke')
}

test('authors Managed VNRA transit with original ownership, scoped inspection, history and JSON round trips', async ({ page }) => {
  test.slow()
  const topology = structuredClone(sampleDualHubVnraGlobalPeering)
  topology.vnets[0].appliances = []
  topology.vnets[0].subnets = []
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology as AzNetTopology)
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('vnra-arranged')) return
    sessionStorage.setItem('vnra-arranged', '1')
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
  }, topology)
  await page.goto('/?mode=full')
  await openNodeMenu(page, 'aznet-vnet-vnet-hub-r1')
  await page.getByRole('menuitem', { name: 'Add / Remove VNet Elements', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add Managed VNRA', exact: true }).click()
  const editor = page.getByTestId('aznet-vnra-editor')
  await expect(editor).toContainText('vnet-hub-r1')
  await expect(editor.getByLabel('Peer ASN', { exact: true })).toHaveCount(0)
  await editor.getByLabel('VNRA name', { exact: true }).fill('Authored transit')
  await editor.getByLabel('VNRA subnet prefix', { exact: true }).fill('10.10.2.0/24')
  await editor.getByLabel('VNRA private IPv4 address', { exact: true }).fill('10.10.3.4')
  await editor.getByRole('button', { name: 'Create Managed VNRA', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('selected subnet')
  expect((await saved()).vnets[0].appliances).toHaveLength(0)
  await editor.getByLabel('VNRA private IPv4 address', { exact: true }).fill('10.10.2.4')
  await editor.getByRole('button', { name: 'Create Managed VNRA', exact: true }).click()
  await expect(editor.getByRole('heading', { name: 'Configure Managed VNRA', exact: true })).toBeVisible()
  expect((await new AxeBuilder({ page }).include('[data-testid="aznet-vnra-editor"]').include('.network-device-chip').analyze()).violations).toEqual([])
  const app = (await saved()).vnets[0].appliances[0]
  expect(app.kind).toBe('vnra')
  expect((await saved()).vnetPeerings).toEqual(topology.vnetPeerings)
  expect((await saved()).udrTables).toEqual(topology.udrTables)
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
  await expect.poll(async () => (await saved()).vnets[0].appliances.length).toBe(0)
  await page.getByRole('button', { name: '↷ Redo', exact: true }).click()
  await expect.poll(async () => (await saved()).vnets[0].appliances[0]).toEqual(app)
  await page.reload()
  expect((await saved()).vnets[0].appliances[0]).toEqual(app)

  await openNodeMenu(page, 'aznet-vnet-vnet-hub-r1')
  await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
  const detail = page.getByTestId('network-detail-dialog')
  const device = detail.getByTestId('detail-vnra')
  await expect(device).toContainText(app.id)
  await expect(device).toContainText('Authored transit')
  await device.getByRole('button', { name: 'Configure Managed VNRA', exact: true }).click()
  await expect(detail).toHaveCount(0)
  await editor.getByLabel('VNRA name', { exact: true }).fill('Renamed transit')
  await editor.getByRole('button', { name: 'Save Managed VNRA', exact: true }).click()
  await expect.poll(async () => (await saved()).vnets[0].appliances[0].name).toBe('Renamed transit')
  expect((await saved()).vnets[0].appliances[0].id).toBe(app.id)
  await openNodeMenu(page, 'aznet-vnet-vnet-hub-r1')
  await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
  await device.getByRole('button', { name: 'Inspect Appliance Subnet Effective Routes', exact: true }).click()
  await expect(page.getByTestId('aznet-effective-route-table')).toBeVisible()
  await expect(page.getByTestId('aznet-editor-scope-banner')).toHaveCount(0)

  await openNodeMenu(page, 'aznet-subnet-sub-r1a-work')
  await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
  await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-r1-a:sub-r1a-work')
  await page.getByTestId('aznet-trace-dest-select').selectOption('subnet:vnet-spoke-r2-b:sub-r2b-work')
  await expect(page.getByTestId('aznet-forward-hops')).toContainText('Renamed transit')
  await expect(page.getByTestId('aznet-forward-hops')).toContainText('VNRA-Hub-NEU')
  await expect(page.getByTestId('aznet-reverse-hops')).toContainText('Renamed transit')
  await expect(page.getByTestId('aznet-forward-hops').locator('.delivered')).toHaveCount(1)
  await expect(page.getByTestId('aznet-reverse-hops').locator('.delivered')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export JSON/ }).click()
  const file = (await (await download).path())!
  const exported = JSON.parse(readFileSync(file, 'utf8')) as AzNetTopology
  expect(exported.vnets[0].appliances[0]).toEqual((await saved()).vnets[0].appliances[0])
  await page.getByTestId(`aznet-chip-${app.id}`).focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: /NIC IP Forwarding/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Remove Appliance', exact: true }).click()
  await expect.poll(async () => (await saved()).vnets[0].appliances.length).toBe(0)
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
  await expect.poll(async () => (await saved()).vnets[0].appliances[0].id).toBe(app.id)
  await page.getByRole('button', { name: '↷ Redo', exact: true }).click()
  await expect.poll(async () => (await saved()).vnets[0].appliances.length).toBe(0)
  await page.locator('input[type=file]').first().setInputFiles(file)
  await expect.poll(async () => (await saved()).vnets[0].appliances[0]?.id).toBe(app.id)
})

test('edits Managed VNRA in Japanese using keyboard submission without exposing BGP settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
  await loadTopology(page, structuredClone(sampleDualHubVnraGlobalPeering))
  await page.getByTestId('aznet-chip-app-vnra-r1').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: /アプライアンス.*構成|Configure Appliance/ }).click()
  const editor = page.getByTestId('aznet-vnra-editor')
  await expect(editor.getByRole('heading', { name: 'マネージド VNRA を構成', exact: true })).toBeVisible()
  expect((await new AxeBuilder({ page }).include('[data-testid="aznet-vnra-editor"]').include('.network-device-chip').analyze()).violations).toEqual([])
  await expect(editor.locator('input[name="asn"]')).toHaveCount(0)
  await editor.getByLabel('VNRA 名', { exact: true }).fill('日本語 VNRA')
  await editor.getByLabel('VNRA プライベート IPv4 アドレス', { exact: true }).fill('10.10.2.3')
  await page.keyboard.press('Enter')
  await expect(editor.getByRole('alert')).toContainText('最初の 4 個')
  await editor.getByLabel('VNRA プライベート IPv4 アドレス', { exact: true }).fill('10.10.2.4')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].appliances[0].name)).toBe('日本語 VNRA')
})

test('resumable routing checks retain pair coverage, cancel honestly and invalidate edited topology', async ({ page }) => {
  const topology = createEmptyAzNetTopology()
  topology.sites = Array.from({ length: 22 }, (_, i) => ({
    id: `site-${i}`, name: `Site ${i}`, asn: 65000 + i, prefixes: [`10.${i}.0.0/24`],
  }))
  await loadTopology(page, topology)
  await page.getByTestId('aznet-check-routing-btn').click()
  const status = page.getByTestId('aznet-routing-check-status')
  await expect(status).toContainText('Checked 200 of 231')
  await expect(status).toContainText('31 representative pairs remain unassessed.')
  await status.getByRole('button', { name: 'Cancel analysis', exact: true }).click()
  await expect(status).toContainText('Analysis cancelled')
  await expect(status.getByRole('button', { name: 'Continue analysis', exact: true })).toHaveCount(0)
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(status).toContainText('Checked 200 of 231')
  await page.getByTestId('aznet-continue-routing-check').click()
  await expect(status).toContainText('Checked 231 of 231')
  await expect(status).toContainText('0 representative pairs remain unassessed.')
  await page.getByTestId('aznet-check-routing-btn').click()
  await expect(page.getByTestId('aznet-continue-routing-check')).toBeVisible()
  await openNodeMenu(page, 'aznet-site-site-21')
  await page.getByRole('menuitem', { name: 'Delete On-Premises Site', exact: true }).click()
  await expect(status).toContainText('Checked 200 of 210')
  await expect(status).not.toContainText('231')
  await page.getByTestId('aznet-continue-routing-check').click()
  await expect(status).toContainText('Checked 210 of 210')
})

test.describe('AzNet bounded workspace and durable gestures', () => {
  const storageKey = 'aznet-visual-topology:v1'
  const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).topology as AzNetTopology, storageKey)
  const instrument = async (page: Page) => page.addInitScript(() => {
    window.__AZNET_METRICS__ = { counts: {}, durations: {} }
  })
  const counts = (page: Page) => page.evaluate(() => ({ ...window.__AZNET_METRICS__!.counts }))

  test('preserves unreadable originals through edits and exports until recovery is acknowledged', async ({ page }) => {
    const raw = '{"topology":{"version":2,"vnets":[null]}}'
    await page.addInitScript(({ key, raw }) => {
      if (!sessionStorage.getItem('seeded-recovery')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('seeded-recovery', 'yes')
      }
    }, { key: storageKey, raw })
    await page.goto('/?mode=hub-spoke')
    await expect(page.getByTestId('aznet-recovery-notice')).toContainText('Originals have not been overwritten')
    await page.getByTestId('aznet-add-vnet-btn').click()
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export original browser workspace', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('aznet-recovery-0.json')
    await page.getByRole('button', { name: 'Acknowledge recovery and enable saving' }).click()
    await expect.poll(async () => (await stored(page)).vnets.length).toBe(1)
    await page.reload()
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toBeVisible()
    await expect(page.getByTestId('aznet-recovery-notice')).toHaveCount(0)
  })

  test('reports rejected imports and quota failure while preserving the active design and export', async ({ page }) => {
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'aznet-visual-topology:v1') throw new DOMException('Test quota exhausted', 'QuotaExceededError')
        return set.call(this, key, value)
      }
    })
    await page.goto('/?mode=full&sample=hub-spoke-firewall-udr')
    await expect(page.getByTestId('aznet-save-error')).toContainText('Export JSON')
    const node = page.getByTestId('aznet-vnet-vnet-hub-weu')
    const input = page.locator('input[type=file]').first()
    for (const body of ['null', '{"version":2,"kind":"azure-network-topology","name":"Broken","vnets":[]}']) {
      await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(body) })
      await expect(page.getByTestId('aznet-workspace-notice')).toContainText('Import rejected; the active design is unchanged')
      await expect(node).toBeVisible()
    }
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '⬇ Export JSON', exact: true }).click()
    expect((await download).suggestedFilename()).toMatch(/\.json$/)
  })

  test('consumes shared snapshots once and reloads newer edits without uploading a topology', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')
    const uploads: string[] = []
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) uploads.push(request.url()) })
    await page.getByTestId('aznet-share-url-btn').click()
    await expect(page.getByTestId('aznet-share-url-btn')).toHaveText('✓ Link Copied')
    await expect(page.getByTestId('aznet-share-url-btn')).toHaveAttribute('title', /full design.*Not encrypted or redacted/)
    const link = await page.evaluate(() => navigator.clipboard.readText())
    expect(link).toContain('#s=')
    expect(new URL(page.url()).hash).toBe('')
    await page.goto(link)
    await expect(page.getByTestId('aznet-vnet-vnet-hub-weu')).toBeVisible()
    await expect.poll(() => new URL(page.url()).hash).toBe('')
    await page.getByTestId('aznet-add-vnet-btn').click()
    const added = page.locator('[data-testid^="aznet-vnet-vnet-custom-"]')
    await expect(added).toHaveCount(1)
    await page.reload()
    await expect(added).toHaveCount(1)
    await page.goto('/?mode=hub-spoke&sample=ars-sdwan-nva-coexistence')
    await expect(page.getByTestId(`aznet-vnet-${AZURE_NET_SAMPLES[1].topology.vnets[0].id}`)).toBeVisible()
    expect(uploads).toEqual([])
  })

  test('cancels preview on pointercancel, lost capture and Escape; keyboard moves remain undoable', async ({ page }) => {
    await instrument(page)
    await page.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')
    const node = page.getByTestId('aznet-vnet-vnet-spoke-app')
    const frame = node.locator('.network-node-frame')
    const original = { x: await frame.getAttribute('x'), y: await frame.getAttribute('y') }
    const start = await counts(page)
    for (const cancel of ['pointercancel', 'lostpointercapture', 'Escape']) {
      const box = (await frame.boundingBox())!
      await page.mouse.move(box.x + 30, box.y + 15)
      await page.mouse.down()
      await page.mouse.move(box.x + 75, box.y + 35, { steps: 4 })
      await expect(frame).not.toHaveAttribute('x', original.x!)
      if (cancel === 'Escape') await page.keyboard.press('Escape')
      else await frame.dispatchEvent(cancel, { pointerId: 1 })
      await page.mouse.up()
      await expect(frame).toHaveAttribute('x', original.x!)
      await expect(frame).toHaveAttribute('y', original.y!)
    }
    expect((await counts(page)).commit ?? 0).toBe(start.commit ?? 0)
    expect((await counts(page)).simulation).toBe(start.simulation)
    await expect(page.getByRole('button', { name: '↶ Undo', exact: true })).toBeDisabled()
    await page.getByTestId('aznet-select-vnet-vnet-spoke-app').focus()
    await page.keyboard.press('ArrowRight')
    await expect(frame).toHaveAttribute('x', String(Number(original.x) + 5))
    await page.keyboard.press('Shift+ArrowDown')
    await expect(frame).toHaveAttribute('y', String(Number(original.y) + 20))
    await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
    await expect(frame).toHaveAttribute('y', original.y!)
    await expect(frame).toHaveAttribute('x', String(Number(original.x) + 5))
    await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
    await expect(frame).toHaveAttribute('x', original.x!)
    expect((await counts(page)).simulation).toBe(start.simulation)
    await page.getByRole('combobox', { name: 'Canvas zoom', exact: true }).selectOption('1.25')
    await page.getByRole('combobox', { name: 'Connection style', exact: true }).selectOption('straight')
    await node.click({ position: { x: 30, y: 15 } })
    expect((await counts(page)).simulation).toBe(start.simulation)
  })

  test('moves parallel ER links and policy anchors live without losing link identity', async ({ page }) => {
    const topology = structuredClone(AZURE_NET_SAMPLES[0].topology)
    const site = topology.sites[0]
    const circuit = topology.erLinks.find((link) => link.targetKind === 'site' && link.targetId === site.id)!
    topology.erLinks.push({ ...circuit, id: 'parallel-circuit', name: 'Parallel circuit' })
    topology.routeMaps = [{ id: 'site-policy', name: 'Site policy', siteId: site.id, rules: [{
      id: 'rule', prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate',
    }] }]
    site.routeMapAssignments = [{ connectionId: circuit.id, inboundMapId: 'site-policy' }]
    await instrument(page)
    await loadTopology(page, topology)
    const node = page.getByTestId(`aznet-site-${site.id}`)
    const marker = page.locator(`.policy-marker[data-router-id="${site.id}"][data-connection-id="${circuit.id}"]`)
    const anchorBefore = await marker.getAttribute('transform')
    const links = [page.getByTestId(`aznet-erlink-${circuit.id}`).locator('path').first(), page.getByTestId('aznet-erlink-parallel-circuit').locator('path').first()]
    const beforePaths = await Promise.all(links.map((link) => link.getAttribute('d')))
    expect(beforePaths[0]).not.toBe(beforePaths[1])
    const before = await counts(page)
    const box = (await node.boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 15)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + 35, { steps: 4 })
    await expect(marker).not.toHaveAttribute('transform', anchorBefore!)
    const afterPaths = await Promise.all(links.map((link) => link.getAttribute('d')))
    expect(afterPaths[0]).not.toBe(beforePaths[0])
    expect(afterPaths[1]).not.toBe(beforePaths[1])
    expect(afterPaths[0]).not.toBe(afterPaths[1])
    expect(await counts(page)).toEqual(before)
    await page.mouse.up()
    expect((await counts(page)).commit).toBe((before.commit ?? 0) + 1)
  })

  test('keeps active routing and traces cached for presentation edits but refreshes names and invalidates region edits', async ({ page }) => {
    await instrument(page)
    await page.goto('/?mode=full&sample=hub-spoke-firewall-udr')
    await page.getByTestId('aznet-check-routing-btn').click()
    await expect(page.getByTestId('aznet-routing-check-status')).toBeVisible()
    await page.getByText('Failure-domain resilience analysis (N-1)', { exact: true }).click()
    await page.getByRole('button', { name: 'Analyze N-1 resilience', exact: true }).click()
    await expect(page.getByTestId('resilience-results')).toBeVisible()
    await openNodeMenu(page, 'aznet-subnet-sub-data-db')
    await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
    await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-data:sub-data-db')
    await page.getByTestId('aznet-trace-dest-select').selectOption('site:site-munich-hq:172.16.10.0/24')
    await expect(page.getByTestId('aznet-forward-hops')).toContainText('VNet-Spoke-Data')
    await openNodeMenu(page, 'aznet-vnet-vnet-spoke-data')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    const before = await counts(page)
    await page.getByRole('textbox', { name: 'VNet name VNet-Spoke-Data', exact: true }).fill('Renamed data workload')
    await page.getByTestId('aznet-node-label-input-vnet-spoke-data').fill('Display only label')
    const renamed = await counts(page)
    for (const kind of ['simulation', 'connectivity', 'trace', 'diagnostics', 'resilience']) expect(renamed[kind]).toBe(before[kind])
    await expect(page.getByTestId('resilience-results')).toBeVisible()
    await page.getByTestId('aznet-select-vnet-vnet-spoke-data').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('resilience-results')).toBeVisible()
    await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
    await expect(page.getByTestId('resilience-results')).toBeVisible()
    expect((await counts(page)).resilience).toBe(before.resilience)
    await page.getByTestId('aznet-tab-tracer').click()
    await expect(page.getByTestId('aznet-forward-hops')).toContainText('Renamed data workload')
    await expect(page.getByTestId('aznet-forward-hops')).not.toContainText('VNet-Spoke-Data')
    await page.getByTestId('aznet-tab-diagnostics').click()
    await expect(page.getByTestId('aznet-diagnostics-panel')).toContainText('Renamed data workload')
    await page.getByTestId('aznet-open-azure-tab-btn').click()
    await expect(page.getByTestId('aznet-bicep-code')).toContainText('Renamed data workload')
    await openNodeMenu(page, 'aznet-vnet-vnet-spoke-data')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    const beforeRegion = await counts(page)
    await page.getByTestId('aznet-vnet-region-vnet-spoke-data').fill('eastus')
    await expect.poll(async () => (await counts(page)).simulation).toBeGreaterThan(beforeRegion.simulation)
    await expect.poll(async () => (await counts(page)).connectivity).toBeGreaterThan(beforeRegion.connectivity)
  })

  for (const [mode, size, prefixCount] of [['hub-spoke', 21, 100], ['full', 61, 500]] as const) {
    test(`benchmarks ${size}-VNet/${prefixCount}-prefix ${mode} drag with live geometry and one durable undo step`, async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const topology = structuredClone(AZURE_NET_SAMPLES[0].topology)
      const template = topology.vnets[1]
      topology.vnets = [topology.vnets[0], ...Array.from({ length: size - 1 }, (_, index) => ({
        ...structuredClone(template), id: `bench-vnet-${index}`, name: `Benchmark spoke ${index}`,
        prefixes: [`10.${index + 20}.0.0/16`], x: index === 0 ? 80 : 1600 + index * 320, y: 45,
        subnets: [{ id: `bench-subnet-${index}`, name: 'workload', prefix: `10.${index + 20}.1.0/24` }],
      }))]
      const peering = topology.vnetPeerings.find((p) => p.vnetAId === topology.vnets[0].id)!
      topology.vnetPeerings = topology.vnets.slice(1).map((vnet, index) => ({
        ...structuredClone(peering), id: `bench-peer-${index}`, vnetAId: topology.vnets[0].id, vnetBId: vnet.id,
      }))
      topology.sites = [topology.sites[0]]
      topology.sites[0].prefixes = Array.from({ length: prefixCount }, (_, index) => `172.${16 + Math.floor(index / 256)}.${index % 256}.0/24`)
      topology.erLinks = topology.erLinks.filter((l) => l.targetKind !== 'site' || l.targetId === topology.sites[0].id)
      topology.vpnConnections = topology.vpnConnections.filter((l) => l.siteId === topology.sites[0].id)
      topology.siteLinks = []
      await instrument(page)
      await page.addInitScript((value) => {
        if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ topology: value }))
      }, topology)
      await page.goto(`/?mode=${mode}`)
      await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
      await page.getByTestId('aznet-check-routing-btn').click()
      await expect(page.getByTestId('aznet-routing-check-status')).toBeVisible()
      const node = page.getByTestId('aznet-vnet-bench-vnet-0')
      const frame = node.locator('.network-node-frame')
      const originalX = await frame.getAttribute('x')
      const originalY = await frame.getAttribute('y')
      const edge = page.getByTestId('aznet-peering-bench-peer-0').locator('path').first()
      const edgeBefore = await edge.getAttribute('d')
      const before = await counts(page)
      await page.evaluate(() => {
        window.__AZNET_METRICS__!.durations.pointerToPaint = []
        document.querySelector('[data-testid="aznet-diagram-svg"]')!.addEventListener('pointermove', (event) => {
          if (!(event as PointerEvent).buttons) return
          const start = performance.now()
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__AZNET_METRICS__!.durations.pointerToPaint.push(performance.now() - start)
          }))
        })
      })
      const box = (await frame.boundingBox())!
      await page.mouse.move(box.x + 30, box.y + 15)
      await page.mouse.down()
      await page.mouse.move(box.x + 135, box.y + 65, { steps: 16 })
      await expect(frame).not.toHaveAttribute('x', originalX!)
      await expect(edge).not.toHaveAttribute('d', edgeBefore!)
      const previewCounts = await counts(page)
      expect(previewCounts).toEqual(before)
      expect((await stored(page)).vnets[1].x).toBe(80)
      await page.mouse.up()
      await expect.poll(async () => (await counts(page)).commit).toBe((before.commit ?? 0) + 1)
      const after = await counts(page)
      expect(after.simulation).toBe(before.simulation)
      expect(after.connectivity).toBe(before.connectivity)
      expect(after.diagnostics).toBe(before.diagnostics)
      expect(after.persist).toBe(before.persist + 1)
      const x = await frame.getAttribute('x')
      await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
      await expect(frame).toHaveAttribute('x', originalX!)
      await expect(frame).toHaveAttribute('y', originalY!)
      await expect(edge).toHaveAttribute('d', edgeBefore!)
      await expect(page.getByRole('button', { name: '↶ Undo', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: '↷ Redo', exact: true }).click()
      await expect(frame).toHaveAttribute('x', x!)
      const gestureEvidence = await page.evaluate(() => window.__AZNET_METRICS__)
      await page.reload()
      await expect(frame).toHaveAttribute('x', x!)
      const evidence = await page.evaluate(() => window.__AZNET_METRICS__)
      // Reload resets counters, so record the actual gesture counters separately.
      const report = { size, prefixCount, before, previewCounts, after, gesture: gestureEvidence, reload: evidence }
      await testInfo.attach('interaction-benchmark', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
      console.log('AZNET_BENCHMARK', JSON.stringify(report))
    })
  }
})

test.describe('AzNetSim native workspace compatibility', () => {
  for (const hostname of ['aznet-simulator.com', 'vwan-simulator.com']) {
    test(`defaults ${hostname} to the same mixed workspace and preserves compatible imports`, async ({ page, baseURL }) => {
      await page.addInitScript(() => {
        if (!sessionStorage.getItem('fresh-host-arranged')) {
          localStorage.removeItem('vwan-visual-topology:v1')
          sessionStorage.setItem('fresh-host-arranged', '1')
        }
      })
      await page.route(`https://${hostname}/**`, async (route) => {
        const url = new URL(route.request().url())
        await route.fulfill({ response: await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href }) })
      })
      await page.goto(`https://${hostname}/`)
      await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
      await expect(page.getByTestId('aznet-app')).toBeVisible()
      await page.reload()
      await expect(page.getByTestId('aznet-app')).toBeVisible()
      await page.goto(`https://${hostname}/?mode=hub-spoke&sample=hub-spoke-firewall-udr`)
      await expect(page.getByTestId('aznet-vnet-vnet-hub-weu')).toBeVisible()
      await page.goto(`https://${hostname}/?mode=vwan`)
      await expect(page.getByTestId('vwan-app')).toBeVisible()
    })
  }

  for (const mode of ['hub-spoke', 'full']) {
    test(`keeps the sample selector compact and returns a toolbar row to the canvas in ${mode}`, async ({ page }) => {
      await page.goto(`/?mode=${mode}&sample=hub-spoke-firewall-udr`)
      const selector = page.getByTestId('aznet-sample-select')
      await expect(selector).toHaveValue('hub-spoke-firewall-udr')
      await expect(selector).toHaveAttribute('title', (await selector.locator('option:checked').textContent())!.trim())
      await page.evaluate(() => document.fonts.ready)
      const header = page.locator('.aznet-topbar')
      const canvas = page.locator('.aznet-canvas-shell')
      const reclaimedHeights: number[] = []
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        await selector.evaluate((element) => { element.style.width = '100%' })
        const oldHeader = (await header.boundingBox())!.height
        const oldCanvas = (await canvas.boundingBox())!.height
        await selector.evaluate((element) => { element.style.removeProperty('width') })
        const reclaimed = (await canvas.boundingBox())!.height - oldCanvas
        expect(oldHeader - (await header.boundingBox())!.height, `${width}px header must not grow`).toBeGreaterThanOrEqual(0)
        expect(reclaimed, `${width}px canvas must not shrink`).toBeGreaterThanOrEqual(0)
        reclaimedHeights.push(reclaimed)
      }
      expect(Math.max(...reclaimedHeights), 'reclaim at least one toolbar row at desktop widths').toBeGreaterThanOrEqual(30)
      await page.setViewportSize({ width: 360, height: 900 })
      const bounds = (await selector.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(360)
      await selector.selectOption('')
      await expect(selector).toHaveValue('')
      await expect(selector).toHaveAttribute('title', 'No sample loaded (Custom / Blank)')
    })

    test(`edits ER peering locations independently of node names in ${mode}`, async ({ page }) => {
      const topology = structuredClone(AZURE_NET_SAMPLES[0].topology)
      const location = topology.erLocations[0]
      location.name = 'Core circuit'
      location.peeringLocation = 'Amsterdam'
      await page.addInitScript((value) => {
        if (!localStorage.getItem('aznet-visual-topology:v1')) {
          localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
        }
      }, topology)
      await page.goto(`/?mode=${mode}`)
      await expect(page.getByTestId('aznet-add-erloc-btn')).toHaveText('+ ER location')
      await expect(page.getByTestId(`aznet-erloc-${location.id}`)).not.toContainText('MSEE')
      const configure = async () => {
        await openNodeMenu(page, `aznet-erloc-${location.id}`)
        await page.getByRole('menuitem', { name: 'Configure ER Location & Labels', exact: true }).click()
      }
      await configure()
      const selector = page.getByRole('combobox', { name: 'ER peering location Core circuit', exact: true })
      await expect(selector).toHaveValue('Amsterdam')
      await selector.selectOption('Paris')
      await page.getByRole('textbox', { name: 'ER Location name Core circuit', exact: true }).fill('Renamed core circuit')
      const renamedSelector = page.getByRole('combobox', { name: 'ER peering location Renamed core circuit', exact: true })
      await expect(renamedSelector).toHaveValue('Paris')
      await page.getByTestId(`aznet-erloc-info-btn-${location.id}`).click()
      await expect(page.getByTestId('er-location-detail-name')).toHaveText('Paris')
      await page.getByTestId('close-er-location-info-modal').click()
      await page.reload()
      await configure()
      await expect(renamedSelector).toHaveValue('Paris')
      await expect(page.getByRole('textbox', { name: 'ER Location name Renamed core circuit', exact: true })).toHaveValue('Renamed core circuit')
    })
  }

  test('preserves legacy inferred and unknown ER locations until a catalog location is selected', async ({ page }) => {
    const topology = structuredClone(AZURE_NET_SAMPLES[0].topology)
    const location = topology.erLocations[0]
    location.name = 'Amsterdam'
    delete location.peeringLocation
    topology.erLocations.push({ id: 'legacy-er', name: 'Imported circuit', peeringLocation: 'Unknown facility', globalReachEnabled: false })
    await loadTopology(page, topology)
    await openNodeMenu(page, `aznet-erloc-${location.id}`)
    await page.getByRole('menuitem', { name: 'Configure ER Location & Labels', exact: true }).click()
    await expect(page.getByTestId(`aznet-erloc-peering-location-${location.id}`)).toHaveValue('Amsterdam')
    await page.getByRole('textbox', { name: 'ER Location name Amsterdam', exact: true }).fill('Renamed legacy circuit')
    await expect(page.getByTestId(`aznet-erloc-peering-location-${location.id}`)).toHaveValue('Amsterdam')
    await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()

    await openNodeMenu(page, 'aznet-erloc-legacy-er')
    await page.getByRole('menuitem', { name: 'Configure ER Location & Labels', exact: true }).click()
    const selector = page.getByTestId('aznet-erloc-peering-location-legacy-er')
    await expect(selector).toHaveValue('')
    await expect(selector.locator('option:checked')).toHaveText('Unknown location: Unknown facility')
    await selector.selectOption('London')
    await expect(selector).toHaveValue('London')
    await expect(page.getByRole('textbox', { name: 'ER Location name Imported circuit', exact: true })).toHaveValue('Imported circuit')

    await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
    await page.getByTestId('aznet-add-erloc-btn').click()
    await openNodeMenu(page, `aznet-erloc-erloc-custom-${topology.erLocations.length + 1}`)
    await page.getByRole('menuitem', { name: 'Configure ER Location & Labels', exact: true }).click()
    const newSelector = page.getByRole('combobox', { name: /ER peering location ER-Location-/ })
    await expect(newSelector).toHaveValue('')
    await expect(newSelector.locator('option:checked')).toHaveText('Select ER peering location')
    await newSelector.selectOption('Stockholm')
    await expect(newSelector).toHaveValue('Stockholm')
  })

  test('consumes legacy aliases once, preserves native workspace selection and retains unrelated URL state', async ({ page }) => {
    for (const mode of ['hub-spoke', 'full', 'vwan']) {
      await page.goto(`/?mode=${mode}&keep=mode-test#retained`)
      const root = page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')
      await expect(root).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Azure Network Simulator', exact: true })).toBeVisible()
      await expect(page).toHaveTitle('Azure Network Simulator (AzNetSim)')
      await expect(page.getByTestId('unified-mode-pill')).toHaveCount(0)
      await page.locator('header [data-language-selector]').selectOption('ja')
      await expect(page).toHaveTitle('Azure ネットワーク シミュレーター (AzNetSim)')
      await page.locator('header [data-language-selector]').selectOption('en')
      await page.reload()
      await expect(root).toBeVisible()
      await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
      const url = new URL(page.url())
      expect(url.searchParams.get('mode')).toBeNull()
      expect(url.searchParams.get('keep')).toBe('mode-test')
      expect(url.hash).toBe('#retained')
    }
  })

  test('renders compound VNet diagram, Subnet Effective Routes, Symmetry Tracer, and Auto-Fix Diagnostics', async ({
    page,
  }) => {
    await page.goto('/?mode=azure-net&sample=hub-spoke-firewall-udr')

    await expect(page.getByRole('heading', { name: 'Azure Network Simulator' })).toBeVisible()
    await expect(page).toHaveTitle('Azure Network Simulator (AzNetSim)')
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon-aznet.svg')
    await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible()
    await expect(page.getByTestId('aznet-vnet-vnet-hub-weu')).toBeVisible()

    // Click Spoke-Data subnet and verify Private Endpoint /32 LPM override in Effective Route Table
    await inspectSubnet(page, 'sub-data-db')
    await page.getByTestId('aznet-lpm-input').fill('10.2.2.15')
    await expect(page.getByTestId('aznet-effective-route-table')).toContainText('InterfaceEndpoint')

    // Switch to Path & Symmetry Tracer and inspect asymmetric firewall bypass between Spoke-Data and Munich Core DC
    await page.getByTestId('aznet-tab-tracer').click()
    await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-data:sub-data-db')
    await page.getByTestId('aznet-trace-dest-select').selectOption('site:site-munich-hq:172.16.10.0/24')
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Asymmetric')

    // Switch to Root-Cause Diagnostics and click Auto-Fix for GatewaySubnet missing UDR
    await page.getByTestId('aznet-tab-diagnostics').click()
    const gwFinding = page.getByTestId('aznet-finding-gateway-subnet-missing-udr')
    await expect(gwFinding).toBeVisible()
    await page.getByTestId('aznet-autofix-gateway-subnet-missing-udr').click()

    // Verify that after Auto-Fix, the GatewaySubnet missing UDR finding is gone and symmetry is restored
    await expect(gwFinding).toHaveCount(0)
    await page.getByTestId('aznet-tab-tracer').click()
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Symmetric')

    // Switch to Sample 2 (Azure Route Server + SD-WAN NVA)
    await page.getByTestId('aznet-sample-select').selectOption('ars-sdwan-nva-coexistence')
    await page.getByTestId('aznet-tab-diagnostics').click()
    await expect(page.getByTestId('aznet-finding-bgp-routes-suppressed')).toBeVisible()

    // Load the all-features stress case from the secondary validation collection.
    await page.getByTestId('aznet-open-sample-gallery-btn').click()
    await expect(page.getByTestId('aznet-sample-gallery-modal')).toBeVisible()
    await page.getByTestId('aznet-sample-gallery-modal').getByRole('combobox', { name: 'Collection', exact: true }).selectOption('validation')
    await expect(page.getByTestId('aznet-gallery-card-uc9-expressroute-hairpin-two-vnets')).toBeVisible()
    await page.getByTestId('aznet-gallery-load-enterprise-vnet-all-features-showcase').click()
    await page.getByRole('button', { name: 'Replace and load', exact: true }).click()
    await expect(page.getByTestId('aznet-sample-gallery-modal')).toHaveCount(0)
    await expect(page.getByTestId('aznet-vnet-vnet-hub-neu')).toBeVisible()
  })

  test('supports all samples without mode restrictions, URL hash sharing, Internet tracing and native label compatibility', async ({
    page,
  }) => {
    await page.goto('/?mode=azure-net&sample=hub-spoke-firewall-udr')

    await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
    await expect(page.getByTestId('aznet-sample-select')).toBeVisible()
    await expect(page.getByTestId('aznet-sample-select').locator('option[value="hybrid-vwan-and-hub-spoke"]')).toHaveText('Hybrid Virtual WAN Secured Hub + Classic Hub-and-Spoke')

    // 2. Public Internet endpoint in Path Tracer + Subnet Default Outbound Access toggle
    await openNodeMenu(page, 'aznet-subnet-sub-app-web')
    await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
    await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-app:sub-app-web')
    await page.getByTestId('aznet-trace-dest-select').selectOption('internet:20.50.60.70')
    await expect(page.getByTestId('aznet-symmetry-verdict')).toBeVisible()

    // 3. Active trace route highlighting (FWD / RET badges) in Effective Route Table
    await page.getByTestId('aznet-tab-routes').click()
    await page.getByTestId('aznet-subnet-selector').selectOption('sub-app-web')
    await expect(page.getByTestId('aznet-route-trace-badge-fwd').first()).toBeVisible()

    // Sharing copies a snapshot without installing a stale override in this workspace's URL.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByTestId('aznet-share-url-btn').click()
    await expect(page.getByTestId('aznet-share-url-btn')).toHaveText('✓ Link Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('#s=')
    expect(new URL(page.url()).hash).not.toContain('s=')

    // 5. Optional diagram node labels in AzNet Configure tab & vWAN mode (#47 scoped to selected node)
    await openNodeMenu(page, 'aznet-vnet-vnet-hub-weu')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    const hubLabelInput = page.getByTestId('aznet-node-label-input-vnet-hub-weu')
    await expect(hubLabelInput).toBeVisible()
    await hubLabelInput.fill('Transit Inspection Hub')
    await expect(page.getByTestId('aznet-node-label-vnet-hub-weu')).toContainText('Transit Inspection Hub')

    // Switch to vWAN-Only mode and set a custom diagram label on Europe hub
    await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
    await page.getByTestId('workspace-library-open').click()
    await page.getByRole('button', { name: 'Open saved design: Global branch network', exact: true }).click()
    await page.getByLabel('Select hub Europe hub', { exact: true }).focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menu').getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
    const editHubDialog = page.getByRole('dialog', { name: 'Edit hub', exact: true })
    const vwanLabelInput = editHubDialog.getByLabel('Diagram label (optional)', { exact: true })
    await expect(vwanLabelInput).toBeVisible()
    await vwanLabelInput.fill('Core EMEA Hub')
    await editHubDialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByTestId('node-label-eu')).toContainText('Core EMEA Hub')
  })

  test('supports shared workspace access, context menus, compact popovers, VNet element controls and site deletion', async ({
    page,
  }) => {
    await page.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')

    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await page.getByTestId('workspace-library-open').click()
    await expect(page.getByRole('dialog', { name: 'Workspace', exact: true })).toContainText('One active design')
    await page.getByRole('dialog', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()

    await expect(page.getByTestId('aznet-subnet-sub-app-web')).not.toContainText('GWroutes:OFF')
    await expect(page.getByTestId('aznet-subnet-rt-badge-sub-app-web')).toContainText('RT-Spokes')

    // #41: Hover over Route Table badge on sub-app-web to open Route Table popover
    await page.getByTestId('aznet-subnet-rt-badge-sub-app-web').hover()
    const rtHoverCard = page.getByTestId('aznet-rt-hover-card')
    await expect(rtHoverCard).toBeVisible()
    await expect(rtHoverCard).toContainText('Propagate Gateway Routes (GWroutes)')
    await page.mouse.move(10, 10)
    await expect(rtHoverCard).toHaveCount(0)

    // #38: Hover peering pill on canvas to open VNet Peering interactive popover
    await page.getByTestId('aznet-peering-pill-peer-hub-app').hover({ force: true })
    const peerHoverCard = page.getByTestId('aznet-peering-hover-card')
    await expect(peerHoverCard).toBeVisible()
    await expect(peerHoverCard).toContainText('Allow GW Transit')
    await page.mouse.move(10, 10)
    await expect(peerHoverCard).toHaveCount(0)

    // #36: Right-click VNet node to open contextual menu
    await page.getByTestId('aznet-vnet-vnet-spoke-app').click({ button: 'right', position: { x: 24, y: 18 }, force: true })
    const ctxMenu = page.getByRole('menu').first()
    await expect(ctxMenu).toBeVisible()
    await expect(ctxMenu.getByRole('menuitem', { name: /Configure VNet/i })).toBeVisible()
    await ctxMenu.getByRole('menuitem', { name: /Add \/ Remove VNet Elements/i }).click()
    await page.getByRole('menuitem', { name: /Add Azure Firewall/i }).click()

    // #39: Verify Azure Firewall was added to VNet-Spoke-App via context menu
    await expect(page.getByTestId('aznet-chip-vnet-spoke-app-azfw-1')).toBeVisible()

    // #42: Topbar quick-create buttons (+ Site, + ER location, + VNet, + Route Table)
    await page.getByTestId('aznet-add-site-btn').click()
    await expect(page.getByTestId('aznet-site-site-custom-3')).toBeVisible()

    // #37: Delete the newly added site from the Configure tab
    await openNodeMenu(page, 'aznet-site-site-custom-3')
    await page.getByRole('menuitem', { name: 'Configure Site & Labels', exact: true }).click()
    await page.getByTestId('aznet-delete-site-site-custom-3').click()
    await expect(page.getByTestId('aznet-site-site-custom-3')).toHaveCount(0)
  })

  test('supports issues #43-#49 and localStorage persistence: empty default topology, reload persistence, ER Location Info modal, scoped Configure tab, VNet attribute editing, and Subnet CRUD', async ({
    page,
  }) => {
    await page.goto('/?mode=hub-spoke')

    // Default topology is empty when no sample or localStorage is present
    await expect(page.getByTestId('aznet-vnet-vnet-hub-weu')).toHaveCount(0)

    // Create a VNet and verify it persists across browser reload
    await page.getByTestId('aznet-add-vnet-btn').click()
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toBeVisible()

    // #43: Open ExpressRoute Peering Locations & Providers catalog modal
    await page.getByTestId('aznet-open-er-locations-btn').click()
    await expect(page.getByTestId('er-location-info-modal')).toBeVisible()
    await page.getByTestId('er-catalog-search').fill('Equinix-Amsterdam')
    await expect(page.getByTestId('er-location-detail-name')).toContainText('Amsterdam')
    await expect(page.getByTestId('er-location-local-regions')).toContainText('West Europe')
    await page.getByTestId('close-er-location-info-modal').click()
    await expect(page.getByTestId('er-location-info-modal')).toHaveCount(0)

    // #46 & #47: Select vnet-custom-1 and verify scoped Configure tab + VNet region editing
    await openNodeMenu(page, 'aznet-vnet-vnet-custom-1')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    await expect(page.getByTestId('aznet-editor-scope-banner')).toContainText('Spoke-VNet-1')
    await page.getByTestId('aznet-vnet-region-vnet-custom-1').fill('Sweden Central')
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toContainText('Sweden Central')

    // #49: Subnet CRUD (create, rename, delete)
    await page.getByTestId('aznet-add-subnet-vnet-custom-1').click()
    const createdSubnetNameInput = page.getByTestId('aznet-subnet-name-snet-vnet-custom-1-2')
    await expect(createdSubnetNameInput).toBeVisible()
    await createdSubnetNameInput.fill('snet-app-tier')
    await expect(page.getByTestId('aznet-subnet-snet-vnet-custom-1-2')).toContainText('snet-app-tier')
    await page.getByTestId('aznet-delete-subnet-snet-vnet-custom-1-2').click()
    await expect(page.getByTestId('aznet-subnet-snet-vnet-custom-1-2')).toHaveCount(0)
  })

  test('opens movable inspectors only on request, preserves edits when closed, and uses the full canvas', async ({ page }) => {
    await page.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')
    await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('aznet-subnet-sub-app-web').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const canvas = await page.getByTestId('aznet-diagram-svg').boundingBox()
    expect(canvas!.width).toBeGreaterThan(1100)

    await openNodeMenu(page, 'aznet-subnet-sub-app-web')
    await page.getByRole('menuitem', { name: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Configure selected object', exact: true })
    await expect(dialog).toBeVisible()
    const before = await dialog.boundingBox()
    const header = await dialog.locator('.overlay-heading h2').boundingBox()
    await page.mouse.move(header!.x + 20, header!.y + 5)
    await page.mouse.down()
    await page.mouse.move(header!.x - 120, header!.y + 30, { steps: 6 })
    await page.mouse.up()
    const after = await dialog.boundingBox()
    expect(after!.x).toBeLessThan(before!.x - 100)
    await page.getByTestId('aznet-subnet-name-sub-app-web').fill('Application Tier')
    await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openNodeMenu(page, 'aznet-subnet-sub-app-web')
    await page.getByRole('menuitem', { name: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
    await expect(page.getByTestId('aznet-subnet-name-sub-app-web')).toHaveValue('Application Tier')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.setViewportSize({ width: 640, height: 900 })
    await inspectSubnet(page, 'sub-app-web')
    const mobileWindow = await page.getByRole('dialog', { name: 'Effective routes', exact: true }).boundingBox()
    expect(mobileWindow!.x).toBeGreaterThanOrEqual(0)
    expect(mobileWindow!.x + mobileWindow!.width).toBeLessThanOrEqual(640)
  })

  test('matches VWAN Show path to/from semantics, offers prefixes and groups, and clears stale paths', async ({ page }) => {
    const topology = structuredClone(AZURE_NET_SAMPLES[0].topology)
    topology.sites.find((s) => s.id === 'site-munich-hq')!.prefixes.push('172.20.0.0/24')
    topology.vnets.find((v) => v.id === 'vnet-spoke-app')!.subnets.push({
      id: 'alternate-workload', name: 'Alternate workload', prefix: '10.1.3.0/24',
    })
    await loadTopology(page, topology)
    await openNodeMenu(page, 'aznet-subnet-sub-app-web')
    await page.getByRole('menuitem', { name: 'Show path to', exact: true }).click()
    await page.getByRole('menuitem', { name: /On-Prem Site · Munich Core DC \(172\.20\.0\.0\/24\)/ }).click()
    await expect(page.getByTestId('aznet-trace-source-select')).toHaveValue('subnet:vnet-spoke-app:sub-app-web')
    await expect(page.getByTestId('aznet-trace-dest-select')).toHaveValue('site:site-munich-hq:172.20.0.0/24')
    await expect(page.getByTestId('aznet-forward-hops')).toContainText('172.20.')
    await expect(page.getByTestId('aznet-reverse-hops')).toBeVisible()
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()

    await openNodeMenu(page, 'aznet-site-site-munich-hq')
    await page.getByRole('menuitem', { name: 'Show path from', exact: true }).click()
    await page.getByRole('menuitem', { name: /On-Prem Site · Munich Core DC \(172\.16\.10\.0\/24\)/ }).last().click()
    await page.getByRole('menuitem', { name: /VNet Subnet · VNet-Spoke-App \/ snet-app-tier/ }).click()
    await expect(page.getByTestId('aznet-trace-source-select')).toHaveValue('subnet:vnet-spoke-app:sub-app-web')
    await expect(page.getByTestId('aznet-trace-dest-select')).toHaveValue('site:site-munich-hq:172.16.10.0/24')
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()

    await openNodeMenu(page, 'aznet-subnet-sub-app-web')
    await page.getByRole('menuitem', { name: 'Show path from', exact: true }).click()
    await page.getByRole('menuitem', { name: 'All on-premises sites', exact: true }).click()
    await expect(page.getByTestId('aznet-group-path-results')).toContainText('Paths to')
    await expect(page.getByTestId('aznet-group-path-results')).toContainText('Return')
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    await page.getByRole('button', { name: /Clear.*Highlights/i }).click()
    await openNodeMenu(page, 'aznet-subnet-sub-app-web')
    await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
    await expect(page.getByTestId('aznet-group-path-results')).toHaveCount(0)
    await expect(page.getByTestId('aznet-forward-hops')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    await openNodeMenu(page, 'aznet-vnet-vnet-spoke-app')
    await page.getByRole('menuitem', { name: 'Show path to', exact: true }).click()
    await page.getByRole('menuitem', { name: /VNet Subnet · VNet-Spoke-App \/ Alternate workload/ }).click()
    await page.getByRole('menuitem', { name: /^On-Prem Site · Munich Core DC \(172\.20\.0\.0\/24\)$/ }).click()
    await expect(page.getByTestId('aznet-trace-source-select')).toHaveValue('subnet:vnet-spoke-app:alternate-workload')
    await openNodeMenu(page, 'aznet-site-site-munich-hq')
    await page.getByRole('menuitem', { name: 'Delete On-Premises Site', exact: true }).click()
    await expect(page.getByTestId('aznet-forward-hops')).toHaveCount(0)
    await expect(page.getByTestId('aznet-path-tracer-panel')).toContainText('previously selected endpoint may have been removed')
  })

  test('shows neutral route suppression and analyzes expected connectivity with live repair and trace navigation', async ({ page }) => {
    const topology = JSON.parse(readFileSync(resolve('samples', 'azure-net', 'uc1-hub-spoke-nva-ars-baseline.json'), 'utf8')) as AzNetTopology
    const table = topology.udrTables.find((t) => t.id === 'rt-spoke1')!
    table.disableBgpRoutePropagation = true
    table.routes.push({
      id: 'expected-site', name: 'Site via NVA', prefix: '10.250.0.0/16',
      nextHopType: 'VirtualAppliance', nextHopIp: '10.100.2.4', enabled: true,
    })
    await loadTopology(page, topology)
    await expect(page.getByTestId('aznet-finding-badge-vnet-spoke1')).toHaveCount(0)
    await expect(page.getByTestId('aznet-subnet-rt-badge-sub-spoke1-work').locator('rect')).toHaveAttribute('fill', 'var(--surface-muted)')
    await inspectSubnet(page, 'sub-spoke1-work')
    await expect(page.getByTestId('aznet-suppressed-bgp-banner')).toContainText('suppressed by configuration')
    await expect(page.getByTestId('aznet-suppressed-bgp-banner')).toHaveCSS('background-color',
      await page.locator('.overlay-heading').evaluate((node) => getComputedStyle(node).backgroundColor))
    await page.getByTestId('aznet-tab-diagnostics').click()
    await page.getByTestId('aznet-analysis-source').selectOption('subnet:vnet-spoke1:sub-spoke1-work')
    await page.getByTestId('aznet-analysis-destination').selectOption('site:site-branch1:10.250.0.0/16')
    await page.getByTestId('aznet-analyze-connectivity').click()
    await expect(page.getByTestId('aznet-analysis-coverage')).toContainText('checked 1 of 1')
    await expect(page.getByTestId('aznet-finding-connectivity-failure')).toHaveCount(0)

    await page.getByTestId('aznet-tab-editor').click()
    await page.getByTestId('aznet-select-peering-peer-hub-spoke1').click()
    const peering = page.getByTestId('aznet-peering-card-peer-hub-spoke1')
    await peering.getByLabel('Use Remote Gateways', { exact: true }).last().uncheck()
    await page.getByTestId('aznet-tab-diagnostics').click()
    const failure = page.getByTestId('aznet-finding-connectivity-failure')
    await expect(failure).toContainText('Return')
    await failure.getByRole('button', { name: /Trace Flow/ }).click()
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Flow Blocked')
    await page.getByTestId('aznet-tab-editor').click()
    await peering.getByLabel('Use Remote Gateways', { exact: true }).last().check()
    await page.getByTestId('aznet-tab-diagnostics').click()
    await expect(failure).toHaveCount(0)
  })
})

