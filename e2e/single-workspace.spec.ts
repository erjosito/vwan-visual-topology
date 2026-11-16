import { expect, test } from '@playwright/test'
import { example } from '../src/model'
import { sampleHybridVwanAndHubSpoke } from '../src/azure-net/model'
import { workspaceArchiveKey, workspaceSessionKey, workspaceStorageKeys } from '../src/workspace-session'
import { observationFixture } from '../tests/azure-observation-fixture'

test('fresh web and desktop enter the same empty mixed workspace with both creation families', async ({ page }) => {
  for (const desktop of [false, true]) {
    if (desktop) await page.addInitScript(() => Object.defineProperty(window, 'desktopSimulator', { value: {} }))
    await page.goto('/')
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
    await expect(page.getByTestId('aznet-add-vnet-btn')).toBeEnabled()
    await expect(page.getByTestId('aznet-add-vwan-hub-btn')).toBeEnabled()
    await expect(page.locator('[data-testid^="aznet-vnet-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="aznet-vwanhub-"]')).toHaveCount(0)
  }
})

test('cross-provider captures retain native review and partial comparison behavior', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'vwan-capture.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...observationFixture(), version: 1 })),
  })
  const review = page.getByRole('dialog', { name: 'Azure files', exact: true })
  await expect(review.getByRole('heading', { name: 'Review Azure capture' })).toBeVisible()
  await expect(review.getByRole('button', { name: 'Replace workspace with Azure capture' })).toBeDisabled()
  await review.getByRole('button', { name: 'Cancel Azure import' }).click()
  const original = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'mixed-capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      kind: 'azure-network-capture', version: 2, resourceGroup: 'rg',
      vnets: [{ id: 'known', name: 'Captured VNet', addressSpace: { addressPrefixes: ['10.42.0.0/16'] },
        subnets: [{ id: 'work', name: 'Workload', addressPrefix: '10.42.1.0/24' }] }],
      nicEffectiveRoutes: [{ nicId: 'nic', nicName: 'Probe', vnetName: 'Captured VNet', subnetName: 'Workload', effectiveRoutes: [] }],
    })),
  })
  await expect(page.getByTestId('aznet-comparison-report')).toContainText('COVERAGE UNKNOWN')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
})

test('live shared snapshots cross native providers once and malformed snapshots keep the active design', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  await page.getByLabel('Topology name', { exact: true }).fill('Preserved native design')
  await page.evaluate(() => { location.hash = 's=not-valid-json' })
  await expect(page.getByRole('alert')).toContainText('Shared snapshot rejected')
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Preserved native design')
  const snapshot = Buffer.from(JSON.stringify(sampleHybridVwanAndHubSpoke)).toString('base64url')
  await page.evaluate((snapshot) => { location.hash = `retained&s=${snapshot}` }, snapshot)
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  await expect.poll(() => new URL(page.url()).hash).toBe('#retained')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!).name)).toBe('Preserved native design')
  await page.reload()
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
})

test('damaged selection requires recovery and storage failure never replaces a saved design', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('network-simulator:workspace:v1', '{"version":99,"provider":"vwan"}')
    localStorage.setItem('vwan-visual-topology:v1', '{"version":1,"name":"Original bytes"}')
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (key === 'network-simulator:originals:v1') throw new DOMException('Full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.goto('/')
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: 'New mixed-network workspace', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be selected or preserved')
  await expect(library).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('network-simulator:workspace:v1'))).toBe('{"version":99,"provider":"vwan"}')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe('{"version":1,"name":"Original bytes"}')
})

test('workspace library fits narrow dark Japanese view and returns keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('header [data-language-selector]').selectOption('ja')
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  const opener = page.getByTestId('workspace-library-open')
  await opener.click()
  const library = page.getByRole('dialog', { name: 'ワークスペース', exact: true })
  await expect(library).toContainText('新しい混在ネットワーク')
  const box = await library.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(391)
  await page.keyboard.press('Escape')
  await expect(library).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('ambiguous legacy saves require a choice and preserve both native originals and practice', async ({ page }) => {
  const native = structuredClone(example)
  native.layout = { mode: 'layered', positions: { layered: { eu: { x: 733, y: 422 } } } }
  const v1 = JSON.stringify(native), v2 = JSON.stringify({ sampleId: 'native', topology: sampleHybridVwanAndHubSpoke })
  await page.addInitScript(({ v1, v2 }) => {
    if (sessionStorage.getItem('arranged')) return
    sessionStorage.setItem('arranged', '1')
    localStorage.setItem('vwan-visual-topology:v1', v1)
    localStorage.setItem('aznet-visual-topology:v1', v2)
    localStorage.setItem('aznet-simulator:practice:v1', '{"version":1,"entries":[]}')
  }, { v1, v2 })
  await page.goto('/?keep=original#retained')
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(library).toContainText('Neither saved family has been selected')
  expect(await page.evaluate(() => localStorage.getItem('network-simulator:workspace:v1'))).toBeNull()
  await page.keyboard.press('Escape')
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: `Open saved design: ${native.name}`, exact: true }).click()
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(native.name)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), workspaceStorageKeys.vwan)).toEqual(native)
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceStorageKeys['azure-net'])).toBe(v2)
  await page.getByLabel('Topology name', { exact: true }).fill('Edited original design')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(native.name)
  await page.reload()
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('keep')).toBe('original')
  expect(new URL(page.url()).hash).toBe('#retained')
  await page.getByTestId('workspace-library-open').click()
  await library.getByRole('button', { name: `Open saved design: ${sampleHybridVwanAndHubSpoke.name}`, exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), workspaceSessionKey)).toEqual({ version: 1, provider: 'azure-net' })
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), workspaceArchiveKey)).toEqual(expect.arrayContaining([
    { key: workspaceStorageKeys.vwan, raw: v1 }, { key: workspaceStorageKeys['azure-net'], raw: v2 },
  ]))
  expect(await page.evaluate(() => localStorage.getItem('aznet-simulator:practice:v1'))).toBe('{"version":1,"entries":[]}')
})

test('cross-provider JSON imports keep native IDs and routes without user-facing mode selection', async ({ page }) => {
  await page.goto('/')
  const input = () => page.getByLabel('Import topology file', { exact: true })
  await input().setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(example)) })
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  const native = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  expect(native.connections.map((connection: { id: string }) => connection.id)).toEqual(example.connections.map((connection) => connection.id))
  await input().setInputFiles({ name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleHybridVwanAndHubSpoke)) })
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  await page.goto('/?mode=hub-spoke')
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  await expect(page.getByTestId('aznet-add-vwan-hub-btn')).toBeEnabled()
  await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
})

for (const provider of ['vwan', 'full']) {
  test(`a delayed ${provider} file import cannot replace a subsequently selected workspace`, async ({ page }) => {
    await page.goto(`/?mode=${provider}`)
    await expect(page.getByTestId(provider === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    await page.evaluate(() => {
      const read = File.prototype.text
      File.prototype.text = async function() {
        const content = await read.call(this)
        if (this.name === 'delayed.json') await new Promise<void>((resolve) => { Reflect.set(window, 'releaseDelayedRead', resolve) })
        return content
      }
    })
    await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
      name: 'delayed.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(provider === 'vwan' ? sampleHybridVwanAndHubSpoke : example)),
    })
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseDelayedRead'))).toBe('function')
    await page.getByTestId('workspace-library-open').click()
    await page.getByRole('button', { name: 'New mixed-network workspace', exact: true }).click()
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await page.evaluate(() => Reflect.get(window, 'releaseDelayedRead')())
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace:v1')!))).toEqual({ version: 1, provider: 'azure-net' })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.name)).toBe('Empty Topology')
    await expect(page.locator('[data-testid^="aznet-vwanhub-"]')).toHaveCount(0)
    await expect(page.getByTestId('vwan-app')).toHaveCount(0)
  })
}

for (const operation of ['openTopology', 'collect'] as const) {
  test(`a delayed desktop ${operation} cannot import into a newly selected workspace`, async ({ page }) => {
    await page.addInitScript(({ operation, content }) => {
      const delayed = () => new Promise((resolve) => Reflect.set(window, 'releaseDesktopResult', () => resolve({
        ok: true, value: { name: 'previous-workspace.json', content },
      })))
      Object.defineProperty(window, 'desktopSimulator', { value: {
        openTopology: operation === 'openTopology' ? delayed : async () => ({ ok: true, value: null }),
        collect: delayed,
        accounts: async () => ({ ok: true, value: {
          cloud: { name: 'AzureCloud', resourceManager: 'https://management.azure.com/' },
          accounts: [{ id: 'subscription', tenantId: 'tenant', name: 'Test subscription', state: 'Enabled' }],
        } }),
        targets: async () => ({ ok: true, value: { wans: [{ id: 'wan-id', name: 'Test WAN' }], groups: [] } }),
      } })
      Reflect.set(window, 'desktopImportEvents', 0)
      document.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-desktop-import')) {
          Reflect.set(window, 'desktopImportEvents', Reflect.get(window, 'desktopImportEvents') + 1)
        }
      })
    }, { operation, content: JSON.stringify(operation === 'openTopology' ? example : { ...observationFixture(), version: 1 }) })
    await page.goto('/')
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    if (operation === 'openTopology') await page.getByRole('button', { name: 'Open local JSON', exact: true }).click()
    else {
      await page.getByText('Read-only local Azure collection', { exact: true }).click()
      await page.getByRole('combobox', { name: 'Capture type', exact: true }).selectOption('vwan')
      await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
      await page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true }).selectOption('subscription')
      await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
      await page.getByRole('combobox', { name: 'Virtual WAN', exact: true }).selectOption('wan-id')
      await page.getByRole('button', { name: 'Collect and review locally', exact: true }).click()
    }
    await page.getByTestId('workspace-library-open').click()
    await page.getByRole('button', { name: 'New mixed-network workspace', exact: true }).click()
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    const saved = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.evaluate(async () => {
      Reflect.get(window, 'releaseDesktopResult')()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(await page.evaluate(() => Reflect.get(window, 'desktopImportEvents'))).toBe(0)
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(saved)
  })
}

test('fresh desktop offers both capture families without changing the editable workspace', async ({ page }) => {
  await page.addInitScript((capture) => Object.defineProperty(window, 'desktopSimulator', { value: {
    accounts: async () => ({ ok: true, value: {
      cloud: { name: 'AzureCloud', resourceManager: 'https://management.azure.com/' },
      accounts: [{ id: 'subscription', tenantId: 'tenant', name: 'Test subscription', state: 'Enabled' }],
    } }),
    targets: async () => ({ ok: true, value: { wans: [{ id: 'wan-id', name: 'Test WAN' }], groups: [{ id: 'rg-id', name: 'Test resource group' }] } }),
    collect: async (request: unknown) => {
      Reflect.set(window, 'capturedRequest', request)
      return { ok: true, value: { name: 'wan.json', content: JSON.stringify(capture) } }
    },
  } }), { ...observationFixture(), version: 1 })
  await page.goto('/')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByText('Read-only local Azure collection', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Capture type', exact: true }).selectOption('vwan')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
  await page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true }).selectOption('subscription')
  await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
  await page.getByRole('combobox', { name: 'Virtual WAN', exact: true }).selectOption('wan-id')
  await page.getByRole('button', { name: 'Collect and review locally', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Azure capture', exact: true })).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'capturedRequest'))).toEqual({ subscriptionId: 'subscription', tenantId: 'tenant', mode: 'vwan', target: 'wan-id' })
})
