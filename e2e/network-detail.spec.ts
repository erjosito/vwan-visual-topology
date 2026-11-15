import { expect, test } from '@playwright/test'
import type { Topology } from '../src/model'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import type { NetworkInventory } from '../src/inventory'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'

function design(mode: string) {
  const subnets = [{ id: 'app', name: 'App subnet', prefix: '10.1.1.0/24' }]
  const inventory: NetworkInventory = {
    workloads: [{ id: 'vm:a', name: 'Application', nicIds: ['nic-a'] }, { id: 'vm-b', name: 'Database', nicIds: ['nic-b'] }],
    nics: [
      { id: 'nic-a', name: 'App NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'network' }, ipConfigurations: [{ id: 'ip-a', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] },
      { id: 'nic-b', name: 'DB NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'network' }, ipConfigurations: [{ id: 'ip-b', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.5' }] },
    ], publicIps: [],
  }
  if (mode === 'vwan') return {
    version: 1, name: 'Detail design', hubs: [], sites: [], connections: [], siteLinks: [],
    spokes: [{ id: 'network', name: 'Network', prefixes: ['10.1.0.0/16'], subnets }], inventory,
  } satisfies Topology
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets, gateways: [], appliances: [], x: 200, y: 200 }]
  topology.inventory = inventory
  return topology
}

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  for (const narrow of [false, true]) {
    test(`${mode}: ${narrow ? 'narrow dark' : 'wide light'} detail edits original entities and preserves canvas state`, async ({ page }) => {
      const topology = design(mode)
      const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      await page.addInitScript(({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
      }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
      await page.setViewportSize({ width: narrow ? 390 : 1440, height: narrow ? 844 : 1000 })
      await page.goto(`/?mode=${mode}`)
      await page.getByLabel('Theme', { exact: true }).selectOption(narrow ? 'dark' : 'light')
      const node = mode === 'vwan' ? page.locator('.spoke-node[data-node-id="network"]') : page.getByTestId('aznet-vnet-network')
      await node.click()
      const opener = page.getByRole('button', { name: 'VNet detail', exact: true })
      await opener.click()
      const dialog = page.getByTestId('network-detail-dialog')
      const svg = page.locator(mode === 'vwan' ? 'svg.diagram' : '[data-testid="aznet-diagram-svg"]')
      const viewBox = await svg.getAttribute('viewBox')
      await expect(dialog).toHaveAccessibleName('VNet detail: Network')
      const close = dialog.getByRole('button', { name: 'Close VNet detail', exact: true })
      await expect(close).toBeFocused()
      const contrast = await close.evaluate((button) => {
        const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
        const luminance = (color: string) => rgb(color).map((value) => {
          const c = value / 255
          return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
        }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
        const style = getComputedStyle(button), foreground = luminance(style.color), background = luminance(style.backgroundColor)
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
      })
      expect(contrast).toBeGreaterThanOrEqual(4.5)
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      expect(await dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true)
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(narrow ? 391 : 1441)
      const form = dialog.getByTestId('add-workload-form')
      await form.getByLabel('Workload name', { exact: true }).fill('New VM')
      await form.getByLabel('Subnet', { exact: true }).selectOption('app')
      await form.getByLabel('Private IPv4 address (blank means unknown)', { exact: true }).fill('10.1.1.6')
      await expect(form.getByLabel('Public IPv4 address (blank means unknown)', { exact: true })).toBeDisabled()
      if (!narrow) {
        await form.getByLabel('Declare public IP association', { exact: true }).check()
        await form.getByLabel('Public IPv4 address (blank means unknown)', { exact: true }).fill('20.50.60.80')
      }
      await form.getByRole('button', { name: 'Add workload and NIC', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'New VM', exact: true })).toBeVisible()
      await expect.poll(async () => {
        const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
        return (saved.topology ?? saved).inventory.workloads.length
      }).toBe(3)
      if (!narrow) await expect(dialog.getByText('20.50.60.80', { exact: true })).toBeVisible()
      const packet = dialog.getByTestId('packet-flow-panel')
      await packet.getByLabel('Packet source', { exact: true }).selectOption({ label: 'Application / App NIC / Primary (10.1.1.4)' })
      await packet.getByLabel('Packet destination', { exact: true }).selectOption({ label: 'Database / DB NIC / Primary (10.1.1.5)' })
      await packet.getByRole('button', { name: 'Trace packet routing', exact: true }).click()
      await expect(packet.getByRole('heading', { name: 'Forward routing: reachable', exact: true })).toBeVisible()
      await expect(packet.getByRole('heading', { name: 'Reply routing: reachable', exact: true })).toBeVisible()
      await expect(packet.getByText('Delivery, security and translation readiness: not assessed', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      expect(await svg.getAttribute('viewBox')).toBe(viewBox)
      if (mode !== 'vwan') await expect(page.getByTestId('aznet-subnet-inventory-pill').locator('text')).toHaveText('VM 3 · NIC 3')
      const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
      const persisted = saved.topology ?? saved
      expect(persisted.inventory.workloads.map((workload: { id: string }) => workload.id)).toContain('vm:a')
      expect(persisted.version === 2 ? persisted.vnets[0].x : undefined).toBe(mode === 'vwan' ? undefined : 200)
      await page.reload()
      await node.click()
      await opener.click()
      await expect(dialog.getByRole('button', { name: 'New VM', exact: true })).toBeVisible()
      await close.click()
      await node.focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(node).toBeFocused()
      const input: PlatformRequest = {
        contractVersion: 1, operation: 'simulate', document: { mode, topology: persisted },
        packet: { source: { kind: 'workload', workloadId: 'vm:a', nicId: 'nic-a', ipConfigurationId: 'ip-a' },
          target: { kind: 'workload', workloadId: 'vm-b', nicId: 'nic-b', ipConfigurationId: 'ip-b' },
          protocol: 'udp', sourcePort: 49152, destinationPort: 53 },
      }
      const actual = await page.evaluate(async (input) => {
        const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
        return module.runBrowserSimulation(input)
      }, input)
      expect(actual).toEqual(executePlatform(input))
      expect(actual.packet!.forward.routing).toBe('reachable')
      if (narrow) {
        await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
        await page.reload()
        await node.focus()
        await page.keyboard.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'VNet の詳細を開く', exact: true }).click()
        await expect(dialog).toHaveAccessibleName('VNet の詳細: Network')
        await expect(dialog.getByRole('heading', { name: 'ワークロード パケット プローブ', exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Application', exact: true })).toBeVisible()
        await expect(dialog.getByLabel('パケット送信元', { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }

    })
  }
}

test('mixed hub controls preserve association, expose a label-propagated custom RIB and render inter-hub transit', async ({ page }) => {
  const topology = design('full')
  if (topology.version !== 2) throw new Error('Mixed topology required')
  topology.vwanHubs = ['a', 'b'].map((suffix) => ({
    id: `hub-${suffix}`, name: `Hub ${suffix.toUpperCase()}`, region: 'westeurope', preference: 'ASPath',
    routingIntent: { private: false, internet: false },
  }))
  topology.vwanHubs[0].routeTablesStatus = 'unknown'
  topology.vnets[0].vwanHubAttachment = { hubId: 'hub-a', enabled: true }
  topology.vnets.push({ id: 'remote', name: 'Remote', role: 'spoke-vnet', region: 'westeurope', prefixes: ['10.2.0.0/16'],
    subnets: [{ id: 'remote-app', name: 'Remote app', prefix: '10.2.1.0/24' }], gateways: [], appliances: [],
    vwanHubAttachment: { hubId: 'hub-b', enabled: true, hubRouting: {
      status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['defaultRouteTable'], labels: ['blue'],
    } } })
  await page.addInitScript((topology) => {
    if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('aznet-inter-hub-edge')).toHaveCount(1)
  const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
  await tools.getByRole('searchbox').fill('hub-a')
  await tools.getByRole('button', { name: 'Select Virtual WAN hub: Hub A', exact: true }).click()
  await tools.getByRole('button', { name: 'Configure Hub & Labels', exact: true }).click()
  const editor = page.getByTestId('aznet-hub-tables-editor')
  await expect(editor.getByRole('status')).toContainText('Hub table scope is unknown.')
  await editor.getByRole('button', { name: 'Add hub table', exact: true }).click()
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
  await expect.poll(async () => (await read()).vwanHubs[0].routeTables?.length).toBe(1)
  expect((await read()).vwanHubs[0].routeTablesStatus).toBe('unknown')
  await editor.getByRole('button', { name: 'Use edited hub table scope', exact: true }).click()
  await expect.poll(async () => (await read()).vwanHubs[0].routeTablesStatus).toBeUndefined()
  const id = (await read()).vwanHubs[0].routeTables[0].id
  await editor.getByLabel(`Table name ${id}`, { exact: true }).fill('Blue')
  await editor.getByLabel(`Table labels ${id}`, { exact: true }).fill('blue')
  await editor.getByLabel(`Table labels ${id}`, { exact: true }).press('Tab')
  await editor.getByLabel('Associated table Network', { exact: true }).selectOption(id)
  await expect.poll(async () => (await read()).vnets[0].vwanHubAttachment.hubRouting.associatedTableId).toBe(id)
  await tools.getByRole('button', { name: 'Inspect Virtual WAN Hub Effective RIB', exact: true }).click()
  await page.getByLabel('Hub routing table', { exact: true }).selectOption(id)
  await expect(page.getByRole('dialog')).toContainText('10.2.0.0/16')
  await page.reload()
  expect((await read()).vwanHubs[0].routeTables[0]).toMatchObject({ id, name: 'Blue', labels: ['blue'] })
})

test('large inventory remains searchable and rejected edits preserve the original graph and input draft', async ({ page }) => {
  const topology = design('full')
  topology.inventory!.workloads[0].name = 'LongImportedWorkloadName'.repeat(160)
  for (let index = 0; index < 150; index++) {
    topology.inventory!.workloads.push({ id: `late-${index}`, name: `Late ${index}`, nicIds: [`late-nic-${index}`] })
    topology.inventory!.nics.push({ id: `late-nic-${index}`, name: `NIC ${index}`, owner: { kind: 'vnet', id: 'network' },
      ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: 'app', privateIp: `10.1.1.${index + 10}` }] })
  }
  await page.addInitScript((topology) => localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology })), topology)
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-vnet-network').click()
  await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog')
  await expect(dialog.locator('.detail-workload')).toHaveCount(100)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await dialog.getByLabel('Search workloads', { exact: true }).fill('late-149')
  await expect(dialog.locator('.detail-workload')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Late 149', exact: true }).click()
  const form = dialog.locator('form').filter({ has: page.getByRole('heading', { name: 'Selected workload', exact: true }) })
  await form.getByLabel('Workload name', { exact: true }).fill('Changed draft')
  await form.getByLabel('Primary · Private IPv4 address (blank means unknown)', { exact: true }).fill('10.9.9.9')
  const before = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await form.getByRole('button', { name: 'Save workload', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('invalid, reserved or duplicate private address')
  await expect(form.getByLabel('Workload name', { exact: true })).toHaveValue('Changed draft')
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(before)
  await form.getByLabel('Primary · Private IPv4 address (blank means unknown)', { exact: true }).fill('10.1.1.159')
  await form.getByRole('button', { name: 'Save workload', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Changed draft', exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByTestId('aznet-subnet-app').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
  const prefix = page.getByTestId('aznet-subnet-prefix-app')
  const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await prefix.fill('')
  await prefix.pressSequentially('10.1.0.0/23')
  await expect(prefix).toHaveValue('10.1.0.0/23')
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
  await prefix.press('Tab')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].subnets[0].prefix)).toBe('10.1.0.0/23')
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`${mode}: opening legacy detail does not invent workloads, NICs, public IPs or subnets`, async ({ page }) => {
    const topology = design(mode)
    delete topology.inventory
    if (topology.version === 1) delete topology.spokes[0].subnets
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
    }, { key, value: mode === 'vwan' ? topology : { sampleId: '', topology } })
    await page.goto(`/?mode=${mode}`)
    await page.locator(mode === 'vwan' ? '.spoke-node[data-node-id="network"]' : '[data-testid="aznet-vnet-network"]').click()
    const before = await page.evaluate((key) => localStorage.getItem(key), key)
    await page.getByRole('button', { name: 'VNet detail', exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog')
    await expect(dialog.getByText('No named workloads are declared. Legacy subnet probes remain available; they are not discovered VMs.', { exact: true })).toBeVisible()
    if (mode === 'vwan') await expect(dialog.getByRole('button', { name: 'Add workload and NIC', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before)
  })
}
