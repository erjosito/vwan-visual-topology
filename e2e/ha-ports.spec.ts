import { expect, test } from '@playwright/test'
import { haPacket, haPortsTopology } from '../tests/fixtures/ha-ports'
import { executePlatform } from '../src/platform/service'
import { loadLanguage, translate } from '../src/messages'
import '../src/packet-messages-ja'

for (const language of ['en', 'ja'] as const) {
  test(`${language}: author floating HA ports, inspect original tuple/backend evidence and retain native IDs`, async ({ page }) => {
    await loadLanguage(language)
    const t = (message: string) => translate(language, message)
    const topology = haPortsTopology()
    topology.inventory!.loadBalancers![0].rules = []
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, topology)
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.goto('/?mode=full')
    await page.evaluate(async (language) => { const { setLanguage } = await import('/src/i18n.ts'); await setLanguage(language) }, language)
    await page.getByTestId('aznet-vnet-hub').click()
    await page.getByRole('button', { name: t('VNet detail'), exact: true }).click()
    const dialog = page.getByTestId('network-detail-dialog'), editor = dialog.getByTestId('load-balancer-editor')
    await editor.locator('summary').first().click()
    await editor.getByLabel(t('Select original LB'), { exact: true }).selectOption('transit-lb')
    await editor.locator('summary').filter({ hasText: t('Ordinary LB rules') }).click()
    const rule = editor.getByTestId('lb-rule-form')
    await rule.getByLabel(t('LB rule name'), { exact: true }).fill('Declared HA transit')
    await rule.getByLabel(t('Internal HA ports with Floating IP'), { exact: true }).check()
    await rule.getByLabel(t('Declare tuple-preserving NVA forwarding (unverified)'), { exact: true }).check()
    await rule.getByRole('button', { name: t('Save LB rule'), exact: true }).click()
    const saved = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1')))!).topology
    await expect.poll(async () => (await saved()).inventory.loadBalancers[0].rules.length).toBe(1)
    const original = await saved()
    expect(original.inventory.loadBalancers[0].rules[0]).toMatchObject({
      haPorts: true, floatingIp: true, haPortsForwarding: 'preserve-tuple', protocol: 'all', frontendPort: 0, backendPort: 0,
    })
    const panel = dialog.getByTestId('packet-flow-panel')
    await panel.getByLabel(t('Packet source'), { exact: true }).selectOption(JSON.stringify(['workload', 'client', 'client-nic', 'client-ip']))
    await panel.getByLabel(t('Packet destination'), { exact: true }).selectOption(JSON.stringify(['workload', 'server', 'server-nic', 'server-ip']))
    await panel.getByRole('button', { name: t('Trace packet routing'), exact: true }).click()
    const evidence = panel.getByTestId('packet-ha-ports-result')
    await expect(evidence).toContainText('primary-vm')
    await expect(evidence).toContainText(t('symmetric'))
    await expect(panel.getByTestId('packet-flow-result')).toContainText('10.81.1.10:49152')
    await expect(panel.getByTestId('packet-flow-result')).toContainText('10.82.1.10:443')
    await evidence.getByRole('button', { name: t('Highlight original backend'), exact: true }).first().click()
    await expect(dialog.locator('.detail-workload[data-selected="true"]')).toContainText('primary VM')
    const request = { contractVersion: 2 as const, operation: 'simulate' as const,
      document: { mode: 'full' as const, topology: original }, packet: haPacket }
    const workerResult = await page.evaluate(async (request) => {
      const { runBrowserSimulation } = await import('/src/platform/browser.ts')
      return await runBrowserSimulation(request)
    }, request)
    expect(workerResult).toEqual(executePlatform(request))
    await editor.locator('summary').filter({ hasText: t('Independent LB health probes') }).click()
    await editor.getByRole('combobox', { name: /primary VM/ }).selectOption('unknown')
    await expect(panel.getByTestId('packet-flow-result')).toHaveCount(0)
    await panel.getByRole('button', { name: t('Trace packet routing'), exact: true }).click()
    await expect(panel.getByTestId('packet-ha-ports-result')).toContainText('eligibility is unknown')
    await expect(panel.getByRole('button', { name: t('Highlight original backend'), exact: true })).toHaveCount(0)
    const updated = await saved()
    await page.reload()
    expect((await saved()).inventory).toEqual(updated.inventory)
  })
}
