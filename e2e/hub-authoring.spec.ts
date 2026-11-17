import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { hubFirewallTopology, azHubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { loadLanguage, translate } from '../src/messages'
import '../src/hub-dialog-messages-ja'

async function saved(page: Page, mode: string) {
  return page.evaluate((mode) => {
    const value = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1')!)
    return mode === 'vwan' ? value : value.topology
  }, mode)
}

for (const mode of ['vwan', 'full'] as const) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: discover Firewall without intent and inspect honest derived gateway capabilities`, async ({ page }, testInfo) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    const native = hubFirewallTopology()
    delete native.hubs[0].firewall
    for (const table of native.hubs[0].routeTables!) table.staticRoutes = []
    native.connections[1].enabled = false
    native.erLocations = [{ id: 'er-local', name: 'Modeled ER' }]
    native.erLinks = [{ id: 'hub-er', name: 'Disabled hub ER', locationId: 'er-local', hubId: 'hub-local', enabled: false, learnSiteRoutes: false, hubRouting: structuredClone(native.connections[0].hubRouting) }]
    const mixed = azHubFirewallTopology()
    mixed.vwanHubs = structuredClone(native.hubs)
    mixed.vpnConnections[1].enabled = false
    mixed.erLocations = structuredClone(native.erLocations)
    mixed.erLinks = [{ id: 'hub-er', name: 'Disabled hub ER', locationId: 'er-local', targetKind: 'vwan-hub', targetId: 'hub-local', enabled: false, hubRouting: structuredClone(native.connections[0].hubRouting) }]
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((language) => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 1000 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-capabilities.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? native : mixed)),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const node = mode === 'vwan' ? page.locator('[data-node-id="hub-local"]') : page.getByTestId('aznet-vwanhub-hub-local')
    if (mode === 'vwan') await expect(node).toHaveAccessibleDescription(/VPN 1\/2 · ER 0\/1/)
    else await expect(node).toHaveAccessibleName(/VPN 1\/2 · ER 0\/1/)
    await node.screenshot({ path: testInfo.outputPath('modeled-hub.png') })
    const menu = async () => { await node.focus(); await page.keyboard.press('Shift+F10') }
    await menu()
    await page.getByRole('menuitem', { name: text('Gateway capabilities (modeled)'), exact: true }).click()
    const capabilities = page.getByRole('dialog', { name: text('Gateway capabilities (modeled)'), exact: true })
    await expect(capabilities).toBeVisible()
    await expect(capabilities.getByTestId('hub-gateway-vpn-branch-a')).toContainText(text('Enabled'))
    await expect(capabilities.getByTestId('hub-gateway-vpn-branch-b')).toContainText(text('Disabled'))
    await expect(capabilities.getByTestId('hub-gateway-hub-er')).toContainText(text('Disabled'))
    await expect(capabilities).toContainText(text('Derived from this topology, not explicit gateway inventory or live observations. SKU, public addresses and provisioning state are unknown.'))
    await expect(capabilities).toContainText(text('No explicit local Firewall declaration.'))
    expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([])
    await capabilities.screenshot({ path: testInfo.outputPath('modeled-gateways.png') })
    await page.keyboard.press('Escape')
    await expect(capabilities).toHaveCount(0)
    await expect(node).toBeFocused()
    expect(await saved(page, mode)).toEqual(original)
    await menu()
    await page.getByRole('menuitem', { name: text('Add Azure Firewall'), exact: true }).click()
    const declaration = page.getByRole('checkbox', { name: text('Declare local Azure Firewall'), exact: true })
    await expect(declaration).toBeFocused()
    await expect(declaration).not.toBeChecked()
    await declaration.check()
    await page.getByRole('textbox', { name: text('Local Firewall name'), exact: true }).fill('Declared original Firewall')
    await page.getByRole('textbox', { name: text('Local Firewall name'), exact: true }).press('Tab')
    if (mode === 'vwan') await page.getByRole('button', { name: text('Save changes'), exact: true }).click()
    else await page.keyboard.press('Escape')
    const result = await saved(page, mode)
    const key = mode === 'vwan' ? 'hubs' : 'vwanHubs'
    expect(result[key][0]).toEqual({ ...original[key][0], firewall: { id: 'fw-hub-local', name: 'Declared original Firewall' } })
    expect(result[mode === 'vwan' ? 'connections' : 'vpnConnections']).toEqual(original[mode === 'vwan' ? 'connections' : 'vpnConnections'])
    expect(result.erLinks).toEqual(original.erLinks)
    await menu()
    await page.getByRole('menuitem', { name: text('Configure Azure Firewall'), exact: true }).click()
    await expect(declaration).toBeChecked()
    await expect(page.getByRole('textbox', { name: text('Local Firewall ID'), exact: true })).toHaveValue('fw-hub-local')
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(node).toBeVisible()
    expect(await saved(page, mode)).toEqual(result)
    expect(errors).toEqual([])
  })
}

for (const mode of ['vwan', 'full'] as const) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: reciprocal hub connections preserve originals and reject silent reattachment`, async ({ page }) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    const native = hubFirewallTopology()
    delete native.hubs[0].firewall
    for (const table of native.hubs[0].routeTables!) table.staticRoutes = []
    native.hubs.push({ ...structuredClone(native.hubs[0]), id: 'other-hub', name: 'Other hub' })
    for (const spoke of native.spokes.slice(0, 2)) { delete spoke.hubId; delete spoke.hubRouting }
    native.spokes[2].subnets = [{ id: 'original-subnet', name: 'Original subnet', prefix: '10.30.0.0/24' }]
    native.spokes[3].hubId = 'other-hub'
    const mixed = azHubFirewallTopology()
    mixed.vwanHubs = structuredClone(native.hubs)
    for (const vnet of mixed.vnets.slice(0, 2)) delete vnet.vwanHubAttachment
    mixed.vnets[3].vwanHubAttachment!.hubId = 'other-hub'
    await page.addInitScript((language) => localStorage.setItem('vwan-visual-topology:language:v1', language), language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 1000 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    const upload = (topology: unknown) => page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-connections.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await upload(mode === 'vwan' ? native : mixed)
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const node = (id: string, hub = false) => mode === 'vwan'
      ? page.locator(`[data-node-id="${id}"]`)
      : page.getByTestId(`aznet-${hub ? 'vwanhub' : 'select-vnet'}-${id}`)
    const menu = async (id: string, hub = false) => { await node(id, hub).focus(); await page.keyboard.press('Shift+F10') }
    const original = await saved(page, mode)
    await menu('trusted-a')
    await page.getByRole('menuitem', { name: text('Connect to virtual hub'), exact: true }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(node('trusted-a')).toBeFocused()
    expect(await saved(page, mode)).toEqual(original)
    await menu('trusted-a')
    await page.getByRole('menuitem', { name: text('Connect to virtual hub'), exact: true }).click()
    await page.getByRole('menuitem', { name: 'Local secure hub', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await menu('hub-local', true)
    await page.getByRole('menuitem', { name: text('Connect to spoke'), exact: true }).click()
    await page.getByRole('menuitem', { name: 'trusted-b', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    const connected = await saved(page, mode)
    const originals = mode === 'vwan' ? connected.spokes : connected.vnets
    expect(originals.map((entry: { id: string }) => entry.id)).toEqual(['trusted-a', 'trusted-b', 'untrusted-a', 'untrusted-b'])
    for (const entry of originals.slice(0, 2)) expect(mode === 'vwan' ? entry.hubId : entry.vwanHubAttachment.hubId).toBe('hub-local')
    expect(originals[0].prefixes).toEqual(['10.10.0.0/16'])
    await menu('hub-local', true)
    await page.getByRole('menuitem', { name: text('Connect to spoke'), exact: true }).click()
    await expect(page.getByRole('menuitem', { name: translate(language, '{0} (connected to {1})', 'untrusted-b', 'Other hub'), exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    expect(await saved(page, mode)).toEqual(connected)
    await menu('untrusted-a')
    await expect(page.getByRole('menuitem', { name: text('Connect to virtual hub'), exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: text('Configure virtual hub connection'), exact: true }).click()
    if (mode === 'vwan') {
      await page.getByRole('button', { name: text('Save changes'), exact: true }).click()
      const current = (await saved(page, mode)).spokes[2]
      expect(current.hubRouting).toEqual(native.spokes[2].hubRouting)
      expect(current.subnets).toEqual(native.spokes[2].subnets)
    } else await page.keyboard.press('Escape')
    await menu('hub-local', true)
    await page.getByRole('menuitem', { name: text(mode === 'vwan' ? 'BGP table' : 'Inspect Virtual WAN Hub Effective RIB'), exact: true }).click()
    await expect(page.getByRole('dialog').locator('tr[data-prefix="10.10.0.0/16"][data-preferred="true"]')).toContainText('trusted-a')
    await page.keyboard.press('Escape')
    const result = await saved(page, mode)
    await page.reload()
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    expect(await saved(page, mode)).toEqual(result)
    await upload(result)
    await expect.poll(async () => await saved(page, mode)).toEqual(result)
  })
}

for (const mode of ['vwan', 'hub-spoke', 'full']) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: clear is explicit, safely focused and preserves unrelated local data`, async ({ page }) => {
    await loadLanguage(language)
    const text = (value: string) => translate(language, value)
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-simulator:practice:v1', '{"version":1,"entries":[]}')
      localStorage.setItem('unrelated-workspace-test', 'keep')
    }, language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-hub.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology())),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const trigger = mode === 'vwan' ? page.getByRole('button', { name: text('Clear topology'), exact: true }) : page.getByTestId('aznet-clear-topology-btn')
    const dialog = page.getByRole('dialog', { name: text('Clear topology'), exact: true })
    for (const method of ['cancel', 'escape', 'close']) {
      await trigger.click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: text('Cancel clearing'), exact: true })).toBeFocused()
      expect(await saved(page, mode)).toEqual(original)
      if (method === 'escape') await page.keyboard.press('Escape')
      else if (method === 'cancel') await page.keyboard.press('Enter')
      else await dialog.getByRole('button', { name: translate(language, 'Close {0}', text('Clear topology')), exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
      expect(await saved(page, mode)).toEqual(original)
    }
    await trigger.click()
    await dialog.getByRole('button', { name: text('Clear all objects'), exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    const empty = await saved(page, mode)
    expect(mode === 'vwan' ? empty.hubs : empty.vwanHubs).toHaveLength(0)
    expect(mode === 'vwan' ? empty.spokes : empty.vnets).toHaveLength(0)
    expect(empty.sites).toHaveLength(0)
    expect(await page.evaluate(() => [localStorage.getItem('aznet-simulator:practice:v1'), localStorage.getItem('unrelated-workspace-test')])).toEqual(['{"version":1,"entries":[]}', 'keep'])
    await page.reload()
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    expect(await saved(page, mode)).toEqual(empty)
  })
}
