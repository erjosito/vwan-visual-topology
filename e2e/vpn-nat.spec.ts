import { expect, test } from '@playwright/test'
import { vpnNatFixture } from '../tests/fixtures/vpn-nat'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'

for (const provider of ['classic', 'vwan'] as const) {
  test(`${provider}: author original VPN rules, assess both legs, reject dynamic external initiation, persist and localize`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const topology = vpnNatFixture(provider)
    delete topology.vpnConnections[0].nat
    topology.vnets[0].gateways.forEach((gateway) => { delete gateway.vpnNat })
    topology.vwanHubs.forEach((hub) => { delete hub.vpnNat })
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, topology)
    await page.setViewportSize({ width: provider === 'classic' ? 1440 : 390, height: 1000 })
    await page.goto('/?mode=full')
    await page.getByLabel('Theme', { exact: true }).selectOption(provider === 'classic' ? 'light' : 'dark')
    const configure = async () => {
      const [controls, configure] = await page.evaluate(async () => {
        const { t, loadLanguage, readLanguage } = await import('/src/i18n.ts')
        await loadLanguage(readLanguage())
        return [t('Workspace controls'), t('Configure VPN Connection')]
      })
      const tools = page.getByRole('complementary', { name: controls, exact: true })
      const toggle = page.getByRole('button', { name: controls, exact: true })
      await expect(toggle).toBeVisible()
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
      await tools.getByRole('searchbox').fill('vpn')
      await tools.locator('.workspace-tools-objects button').filter({ hasText: 'VPN link' }).click()
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
      await tools.getByRole('button', { name: configure, exact: true }).click()
    }
    await configure()
    const gateway = page.getByTestId('vpn-nat-gateway-editor')
    if (provider === 'classic') await gateway.getByRole('combobox', { name: 'Classic VPN NAT SKU', exact: true }).selectOption('VpnGw2AZ')
    await gateway.getByLabel('Enable gateway BGP route translation', { exact: true }).check()
    await gateway.getByRole('button', { name: 'Save VPN NAT gateway capability', exact: true }).click()
    const editor = page.getByTestId('vpn-nat-connection-editor')
    await expect(editor.getByRole('status')).toHaveCount(0)
    const addRule = async (name: string, mode: string, external: string) => {
      await editor.getByRole('button', { name: 'New VPN NAT rule', exact: true }).click()
      await editor.getByLabel('VPN NAT rule name', { exact: true }).fill(name)
      await editor.getByRole('combobox', { name: 'VPN NAT mode', exact: true }).selectOption(mode)
      await editor.getByLabel('Internal mapping (pre-NAT IPv4 CIDR)', { exact: true }).fill('10.0.0.0/24')
      await editor.getByLabel('External mapping (post-NAT IPv4 CIDR)', { exact: true }).fill(external)
      await editor.getByLabel('Original on-premises BGP peer IPv4', { exact: true }).fill('172.20.0.1')
      await editor.getByLabel('Configured post-NAT BGP peer IPv4', { exact: true }).fill('172.20.0.1')
      await editor.getByRole('button', { name: 'Save VPN NAT rule', exact: true }).click()
      await expect(editor.getByRole('alert')).toHaveCount(0)
    }
    await addRule('Branch ingress', 'IngressSNAT', '192.168.1.0/24')
    await addRule('Azure egress', 'EgressSNAT', '192.168.2.0/24')
    const packet = page.getByTestId('vpn-nat-packet-inspector')
    const assess = async (source: string, target: string, direction: 'ingress' | 'egress') => {
      await packet.getByRole('combobox', { name: 'VPN initiation direction', exact: true }).selectOption(direction)
      await packet.getByLabel('VPN source IPv4', { exact: true }).fill(source)
      await packet.getByLabel('VPN destination IPv4', { exact: true }).fill(target)
      await packet.getByRole('button', { name: 'Assess VPN NAT packet', exact: true }).click()
    }
    await assess('10.0.0.4', '192.168.2.5', 'ingress')
    await expect(packet.getByTestId('vpn-nat-forward')).toContainText('Forward VPN routing: reachable')
    await expect(packet.getByTestId('vpn-nat-forward')).toContainText('192.168.1.4:49152 → 10.0.0.5:443')
    await expect(packet.getByTestId('vpn-nat-reply')).toContainText('Conditional VPN reply: reachable')
    await expect(packet.getByTestId('vpn-nat-reply')).toContainText('192.168.2.5:443 → 10.0.0.4:49152')
    await editor.getByRole('button', { name: 'Edit VPN NAT rule Branch ingress', exact: true }).click()
    await editor.getByRole('combobox', { name: 'VPN NAT type', exact: true }).selectOption('Dynamic')
    await editor.getByLabel('External mapping (post-NAT IPv4 CIDR)', { exact: true }).fill('192.168.1.0/28')
    if (provider === 'vwan') await editor.getByRole('combobox', { name: 'VPN gateway instance', exact: true }).selectOption('0')
    await editor.getByRole('button', { name: 'Save VPN NAT rule', exact: true }).click()
    await assess('10.0.0.4', '192.168.2.5', 'ingress')
    await expect(packet.getByTestId('vpn-nat-reply')).toContainText('Conditional VPN reply: reachable')
    await assess('10.0.0.5', '192.168.1.0', 'egress')
    await expect(packet.getByTestId('vpn-nat-forward')).toContainText('Forward VPN routing: unreachable')
    await expect(packet.getByTestId('vpn-nat-forward')).toContainText('internal mapping')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    const request: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: saved },
      vpnPacket: { connectionId: 'vpn', direction: 'ingress', tuple: { sourceAddress: '10.0.0.4', destinationAddress: '192.168.2.5',
        protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } } }
    const workerResult = await page.evaluate(async (request) => {
      const { runBrowserSimulation } = await import('/src/platform/browser.ts')
      return await runBrowserSimulation(request)
    }, request)
    expect(workerResult).toEqual(executePlatform(request))
    await page.reload()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)).toEqual(saved)
    await page.evaluate(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
    await page.reload()
    await configure()
    await expect(editor.getByRole('heading', { name: '接続所有の VPN 重複アドレス NAT', exact: true })).toBeVisible()
    await expect(gateway).toContainText('NAT64')
    await expect(editor).toContainText('別の DNAT ルールは不要です')
    await packet.getByLabel('VPN 送信元 IPv4', { exact: true }).fill('10.0.0.4')
    await packet.getByLabel('VPN 宛先 IPv4', { exact: true }).fill('192.168.2.5')
    await packet.getByRole('button', { name: 'VPN NAT パケットを評価', exact: true }).click()
    await expect(packet.getByTestId('vpn-nat-reply')).toContainText('条件付き VPN 応答')
    await expect(packet.getByTestId('vpn-nat-reply')).toContainText('192.168.2.5:443 → 10.0.0.4:49152')
    expect(errors).toEqual([])
  })
}
