import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { vpnGatewayModeTopology } from '../tests/fixtures/vpn-gateway-mode'

for (const mode of ['hub-spoke', 'full']) {
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
