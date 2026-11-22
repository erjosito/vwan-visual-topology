import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { vpnGatewayModeTopology } from '../tests/fixtures/vpn-gateway-mode'
import { coexistenceTopology } from '../tests/fixtures/coexistence'

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} retains unknown coexistence metadata and authors routing type, SKU and generation`, async ({ page }) => {
    const topology = coexistenceTopology()
    delete topology.vnets[0].gateways[0].vpnType
    delete topology.vnets[0].gateways[0].sku
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[data-desktop-import]').setInputFiles({
      name: 'coexistence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await page.getByTestId('aznet-chip-vpn').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure Gateway & Peerings', exact: true }).click()
    const settings = page.getByTestId('vpn-gateway-settings-vpn')
    const type = settings.getByRole('combobox', { name: 'VPN gateway routing type', exact: true })
    const sku = settings.getByRole('combobox', { name: 'Gateway SKU', exact: true })
    await expect(type).toHaveValue('')
    await expect(sku).toHaveValue('')
    await expect(settings).toContainText('Missing settings do not prove compatibility')
    await expect(settings).toContainText('selectors are not a PolicyBased gateway')
    await expect(settings).toContainText('not Microsoft peering')
    await type.selectOption('PolicyBased')
    await sku.fill('Basic')
    await expect(type).toHaveAttribute('aria-invalid', 'true')
    await expect(sku).toHaveAttribute('aria-invalid', 'true')
    await type.selectOption('RouteBased')
    await expect(settings.locator('datalist option[value="VpnGw1"]')).toHaveCount(1)
    await expect(settings.locator('datalist option[value="VpnGw1AZ"]')).toHaveCount(1)
    await sku.fill('VpnGw1AZ')
    await expect(settings.getByRole('combobox', { name: 'VPN gateway generation', exact: true })).toHaveValue('Generation1')
    await sku.fill('VpnGw5AZ')
    await settings.getByRole('combobox', { name: 'VPN gateway generation', exact: true }).selectOption('Generation2')
    await expect(type).toHaveAttribute('aria-invalid', 'false')
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    await expect.poll(async () => (await saved()).vnets[0].gateways[0]).toMatchObject({
      sku: 'VpnGw5AZ', vpnType: 'RouteBased', vpnGatewayGeneration: 'Generation2',
    })
    expect((await saved()).vnets[0].gateways[1]).toEqual(topology.vnets[0].gateways[1])
    await page.reload()
    expect((await saved()).vnets[0].gateways[0]).toMatchObject({
      sku: 'VpnGw5AZ', vpnType: 'RouteBased', vpnGatewayGeneration: 'Generation2',
    })
  })
  test(`${mode} fixes the actual Basic gateway, restores undo and defaults newly added VPN gateways to VpnGw1AZ`, async ({ page }) => {
    const topology = coexistenceTopology()
    topology.vnets[0].gateways[0].sku = 'Basic'
    topology.vnets[0].gateways[0].vpnGatewayGeneration = 'Generation2'
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[data-desktop-import]').setInputFiles({
      name: 'basic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await page.getByRole('button', { name: /^Advanced checks/ }).click()
    const finding = page.locator('[data-finding-id="coexistence:hub:sku:vpn"]')
    await expect(finding).toContainText('uses Basic')
    await finding.getByTestId('aznet-autofix-gateway-coexistence').click()
    await expect(finding).toHaveCount(0)
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    await expect.poll(async () => (await saved()).vnets[0].gateways[0]).toMatchObject({
      sku: 'VpnGw1AZ', vpnGatewayGeneration: 'Generation1',
    })
    expect((await saved()).vnets[0].gateways[1]).toEqual(topology.vnets[0].gateways[1])
    await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
    await expect(finding).toContainText('uses Basic')
    await finding.getByTestId('aznet-autofix-gateway-coexistence').click()
    await page.reload()
    expect((await saved()).vnets[0].gateways[0].sku).toBe('VpnGw1AZ')
    await page.getByTestId('aznet-chip-vpn').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure Gateway & Peerings', exact: true }).click()
    await page.getByTestId('aznet-remove-gw-vpn').click()
    await page.getByTestId('aznet-chip-er-gw').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure Gateway & Peerings', exact: true }).click()
    await page.getByTestId('aznet-add-vpngw-hub').click()
    await expect.poll(async () => (await saved()).vnets[0].gateways.find((gateway: { kind: string }) => gateway.kind === 'Vpn')).toMatchObject({
      sku: 'VpnGw1AZ', vpnGatewayGeneration: 'Generation1',
    })
  })
  test(`${mode} authors standalone VPN mode, keeps legacy absence and persists it without changing VWAN`, async ({ page }) => {
    const topology = vpnGatewayModeTopology()
    if (mode === 'full') topology.vwanHubs.push({ id: 'vhub', name: 'Virtual hub', region: 'West Europe',
      preference: 'ExpressRoute', routingIntent: { private: false, internet: false } })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[data-desktop-import]').setInputFiles({
      name: 'vpn-mode.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await page.getByTestId('aznet-chip-vpn').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure Gateway & Peerings', exact: true }).click()
    const settings = page.getByTestId('vpn-gateway-settings-vpn')
    const select = settings.getByRole('combobox', { name: 'Standalone VPN gateway mode', exact: true })
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    await expect(select).toHaveValue('unspecified')
    await expect(settings).toContainText('Legacy Bicep export defaults')
    await select.selectOption('active-standby')
    await expect.poll(async () => (await saved()).vnets[0].gateways[0].activeActive).toBe(false)
    await expect(settings).toContainText('ARS route exchange requires')
    await select.selectOption('active-active')
    await expect.poll(async () => (await saved()).vnets[0].gateways[0].activeActive).toBe(true)
    await expect(settings).not.toContainText('ARS route exchange requires')
    await page.reload()
    await page.getByTestId('aznet-chip-vpn').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure Gateway & Peerings', exact: true }).click()
    await expect(select).toHaveValue('active-active')
    await select.selectOption('unspecified')
    await expect.poll(async () => Object.hasOwn((await saved()).vnets[0].gateways[0], 'activeActive')).toBe(false)
    expect((await saved()).vwanHubs).toEqual(topology.vwanHubs)
    expect((await saved()).vpnConnections).toEqual(topology.vpnConnections)
    await page.setViewportSize({ width: 700, height: 900 })
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
    await page.getByRole('combobox', { name: 'Language / 言語', exact: true }).selectOption('ja')
    await expect(settings.getByRole('combobox', { name: 'スタンドアロン VPN ゲートウェイのモード', exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page }).include('[data-testid="vpn-gateway-settings-vpn"]').analyze()).violations).toEqual([])
  })
}
