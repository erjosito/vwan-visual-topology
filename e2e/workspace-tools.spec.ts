import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { vpnGatewayModeTopology } from '../tests/fixtures/vpn-gateway-mode'
import type { Topology } from '../src/model'

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
  const sample = mode === 'vwan' ? 'hub-routing-preferences' : 'hub-spoke-firewall-udr'
  const rootId = mode === 'vwan' ? 'vwan-app' : 'aznet-app'

  test(`${mode}: searchable controls reserve space and collapse without changing saved design or coordinates`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}&sample=${sample}`)
    await expect(page.getByTestId(rootId)).toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
    const original = await page.evaluate((key) => localStorage.getItem(key), key)
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    const opener = page.getByRole('button', { name: 'Workspace controls', exact: true })
    await expect(tools).toBeVisible()
    const canvas = page.locator(mode === 'vwan' ? '.canvas-stage' : '.aznet-canvas-shell')
    const toolsBounds = (await tools.boundingBox())!
    expect((await canvas.boundingBox())!.x).toBeGreaterThanOrEqual(toolsBounds.x + toolsBounds.width)
    const search = tools.getByRole('searchbox', { name: 'Search workspace controls', exact: true })
    await search.fill('no-command-matches')
    await expect(tools.getByRole('status')).toHaveText('No commands match your search.')
    await page.keyboard.press('Escape')
    await expect(tools).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect((await canvas.boundingBox())!.width).toBe(1440)
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await page.reload()
    await expect(page.getByTestId(rootId)).toBeVisible()
    await expect(tools).toHaveCount(0)
    await opener.click()
    await expect(search).toBeFocused()
    await search.fill('VNet')
    await expect(tools.getByRole('button', { name: '+ VNet', exact: true })).toBeVisible()
    await expect(tools.getByRole('button', { name: '+ Site', exact: true })).toHaveCount(0)
    await search.fill('')
    const node = page.getByRole('button', { name: mode === 'vwan' ? /^Select hub / : /^VNet / }).first()
    await node.focus()
    await node.press('Enter')
    const routeAction = tools.getByRole('button', { name: mode === 'vwan' ? 'BGP table' : 'Inspect Effective Routes', exact: true })
    await routeAction.click()
    await expect(page.getByRole('dialog')).toContainText(mode === 'vwan' ? 'BGP table' : 'Effective routes')
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await page.getByRole('button', { name: 'Maximize canvas', exact: true }).click()
    await expect(tools).toBeHidden()
    expect((await canvas.boundingBox())!.width).toBe(1440)
    await page.getByRole('button', { name: 'Restore panels', exact: true }).click()
    await expect(tools).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
  })

  test(`${mode}: narrow controls keep startup empty, focus search and close safely`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/?mode=${mode}`)
    await expect(page.getByTestId(rootId)).toBeVisible()
    if (mode !== 'vwan') await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
    const original = await page.evaluate((key) => localStorage.getItem(key), key)
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    await expect(tools).toHaveCount(0)
    await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    const search = tools.getByRole('searchbox', { name: 'Search workspace controls', exact: true })
    await expect(search).toBeFocused()
    const bounds = (await tools.boundingBox())!
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBeLessThan(390)
    expect(await tools.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await search.fill('VNet')
    await page.keyboard.press('Escape')
    await expect(tools).toHaveCount(0)
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    await search.fill('VNet')
    await tools.getByRole('button', { name: '+ VNet', exact: true }).click()
    await expect(tools).toHaveCount(0)
    if (mode === 'vwan') {
      await expect(page.getByRole('dialog')).toContainText('VNet')
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
    } else {
      await expect.poll(async () => JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!).topology.vnets.length).toBe(1)
      await expect(page.getByRole('button', { name: 'Workspace controls', exact: true })).toBeFocused()
    }
  })
}

test('legacy classic aliases expose both network families without removing existing hubs', async ({ page }) => {
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByTestId('aznet-add-vwan-hub-btn').click()
  await expect.poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology.vwanHubs.length).toBe(1)
  await page.goto('/?mode=hub-spoke')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(page.getByTestId('aznet-add-vwan-hub-btn')).toBeEnabled()
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology.vwanHubs).toHaveLength(1)
  await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
})

test('contextual deletion requires confirmation and cancellation preserves the selected VNet', async ({ page }) => {
  await page.goto('/?mode=hub-spoke')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByTestId('aznet-add-vnet-btn').click()
  await expect.poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology.vnets.length).toBe(1)
  const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
  await tools.getByRole('button', { name: 'Delete VNet', exact: true }).click()
  const confirmation = page.getByRole('dialog')
  await expect(confirmation).toContainText('Spoke-VNet-1')
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
  await tools.getByRole('button', { name: 'Delete VNet', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await expect.poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology.vnets.length).toBe(0)
  await expect(tools.getByRole('button', { name: 'Delete VNet', exact: true })).toHaveCount(0)
})

test('the wide palette leaves native desktop file and read-only collection controls reachable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'desktopSimulator', { value: {} }))
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const native = page.getByRole('region', { name: 'Local desktop tools', exact: true })
  await native.getByRole('button', { name: 'Load file', exact: true }).click({ trial: true })
  await native.getByText('Read-only local Azure collection', { exact: true }).click()
  await native.getByRole('button', { name: 'Read existing Azure session', exact: true }).click({ trial: true })
})

test('nested capability controls mount on demand and dispatch to the selected VNet', async ({ page }) => {
  await page.goto('/?mode=hub-spoke')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByTestId('aznet-add-vnet-btn').click()
  const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
  await expect(tools.locator('details button')).toHaveCount(0)
  await tools.getByText('Add / Remove VNet Elements', { exact: true }).click()
  await tools.getByRole('button', { name: 'Add / Remove VNet Elements > + Add Azure Firewall', exact: true }).click()
  await expect.poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology.vnets[0].appliances[0]?.kind).toBe('azure-firewall')
})

test.describe('VNet structure cloning', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  for (const mode of ['vwan', 'hub-spoke', 'full']) for (const profile of [
    { ui: 'new', language: 'en', width: 1440 },
    { ui: 'legacy', language: 'en', width: 1440 },
    { ui: 'new', language: 'ja', width: 390 },
  ]) {
    test(`${mode}: ${profile.ui} ${profile.language} clones selected structure with validation, cancellation, history and persistence`, async ({ page }) => {
      await page.setViewportSize({ width: profile.width, height: 1000 })
      const native = vpnGatewayModeTopology()
      native.vnets[0].subnets[2] = { ...native.vnets[0].subnets[2], routeTableId: 'original-policy',
        defaultOutboundAccess: false, privateEndpointNetworkPolicies: 'Enabled',
        privateEndpoints: [{ id: 'pe', name: 'Private service', ipAddress: '10.0.1.10', serviceName: 'service.example.test' }] }
      native.udrTables.push({ id: 'original-policy', name: 'Original policy', disableBgpRoutePropagation: true, routes: [] })
      const classic: Topology = { version: 1, name: 'Clone test', hubs: [{ id: 'vwan-hub', name: 'Connected hub',
        region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
        sites: [], connections: [], siteLinks: [], routeMaps: [], spokes: [{ id: 'hub', name: 'Source VNet', region: 'westeurope',
          hubId: 'vwan-hub', prefixes: ['10.0.0.0/16'], subnets: [
            { id: 'app', name: 'Application', prefix: '10.0.1.0/24' },
          ] }] }
      const topology = mode === 'vwan' ? classic : native
      topology.inventory = { workloads: [{ id: 'vm', name: 'Source VM', nicIds: ['nic'] }],
        nics: [{ id: 'nic', name: 'Source NIC', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'hub' },
          ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.0.1.4' }] }],
        publicIps: [], networkSecurityGroups: [{ id: 'nsg', name: 'Source NSG', rules: [] }],
        nsgAssociations: [{ owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'hub' }, target: { kind: 'subnet', id: 'app' }, nsgId: 'nsg' }] }
      const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      await page.addInitScript(({ key, topology, profile }) => {
        localStorage.setItem('aznet-ui-preview:v1', String(profile.ui === 'new'))
        localStorage.setItem('aznet-workspace-tools:v1', 'closed')
        localStorage.setItem('vwan-visual-topology:language:v1', profile.language)
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(topology.version === 1 ? topology : { sampleId: '', topology }))
      }, { key, topology, profile })
      await page.goto(`/?mode=${mode}`)
      await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
      const read = () => page.evaluate(key => {
        const stored = JSON.parse(localStorage.getItem(key)!)
        return stored.topology ?? stored
      }, key)
      const before = await read()
      const source = (before.spokes ?? before.vnets)[0]
      const ja = profile.language === 'ja'
      const controlsName = ja ? 'ワークスペースの操作' : 'Workspace controls'
      const cloneAction = ja ? 'VNet を複製...' : 'Clone VNet...'
      const tools = page.getByRole('complementary', { name: controlsName, exact: true })
      const opener = page.getByRole('button', { name: controlsName, exact: true })
      const node = mode === 'vwan' ? page.locator('[data-node-id="hub"]')
        : page.getByTestId('aznet-vnet-hub').getByRole('button', { name: /^VNet / })
      await node.focus()
      await node.press('Shift+F10')
      await page.getByRole('menuitem', { name: cloneAction, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: ja ? 'VNet の複製' : 'Clone VNet', exact: true })
      const name = dialog.getByRole('textbox', { name: ja ? '新しい VNet 名' : 'New VNet name', exact: true })
      const prefixes = dialog.getByRole('textbox', { name: ja ? '新しいアドレス空間' : 'New address spaces', exact: true })
      const submit = dialog.getByRole('button', { name: ja ? 'VNet の複製を作成' : 'Create VNet clone', exact: true })
      await expect(name).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(await read()).toEqual(before)
      await expect(node).toBeFocused()
      await node.press('Enter')

      const openClone = async () => {
        if (!await tools.isVisible()) await opener.click()
        await tools.getByRole('button', { name: cloneAction, exact: true }).click()
        await expect(name).toBeFocused()
      }
      await openClone()
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      const scan = await new AxeBuilder({ page }).include('dialog[open]').analyze()
      expect(scan.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
      await dialog.getByRole('button', { name: ja ? 'キャンセル' : 'Cancel', exact: true }).click()
      expect(await read()).toEqual(before)
      if (profile.width === 390) await expect(opener).toBeFocused()
      else await expect(tools.getByRole('button', { name: cloneAction, exact: true })).toBeFocused()
      await openClone()
      await name.fill('Cloned network')
      await prefixes.fill('10.8.1.0/16')
      await submit.click()
      await expect(dialog.getByRole('alert')).toBeVisible()
      expect(await read()).toEqual(before)
      await prefixes.fill('10.0.0.0/16')
      await submit.click()
      await expect(dialog.getByRole('alert')).toContainText(ja ? '重複' : 'overlap')
      expect(await read()).toEqual(before)
      await prefixes.fill('10.8.0.0/16')
      await submit.click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => ((await read()).spokes ?? (await read()).vnets).length).toBe(2)
      const after = await read()
      const vnets = after.spokes ?? after.vnets
      const copy = vnets[1]
      expect(copy).toMatchObject({ name: 'Cloned network', prefixes: ['10.8.0.0/16'], region: source.region })
      expect(copy.id).not.toBe(source.id)
      expect(copy.subnets.map((subnet: { prefix: string }) => subnet.prefix)).toEqual(mode === 'vwan'
        ? ['10.8.1.0/24'] : ['10.8.255.0/27', '10.8.254.0/27', '10.8.1.0/24'])
      expect(copy.subnets.every((subnet: { id: string }) => !source.subnets.some((original: { id: string }) => original.id === subnet.id))).toBe(true)
      expect(copy.hubId ?? copy.vwanHubAttachment ?? copy.routeServer).toBeUndefined()
      if (mode !== 'vwan') {
        expect(copy.gateways).toEqual([])
        expect(copy.appliances).toEqual([])
        expect(copy.subnets[2]).toEqual({ id: expect.any(String), name: 'Application', prefix: '10.8.1.0/24',
          defaultOutboundAccess: false, privateEndpointNetworkPolicies: 'Enabled' })
      }
      expect({ ...after, [mode === 'vwan' ? 'spokes' : 'vnets']: vnets.slice(0, 1) }).toEqual(before)
      await page.getByRole('button', { name: ja && mode === 'vwan' ? /元に戻す/ : /Undo/ }).click()
      await expect.poll(read).toEqual(before)
      await page.getByRole('button', { name: ja && mode === 'vwan' ? /やり直す/ : /Redo/ }).click()
      await expect.poll(read).toEqual(after)
      await page.reload()
      await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
      expect(await read()).toEqual(after)
    })
  }
})
