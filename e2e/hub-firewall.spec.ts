import { expect, test } from '@playwright/test'
import { azHubFirewallTopology, hubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'

for (const mode of ['vwan', 'full'] as const) {
  test(`${mode}: ID-only propagation retains bidirectional Firewall inspection in the browser worker`, async ({ page }) => {
    const document = mode === 'vwan'
      ? { mode, topology: hubFirewallTopology('published-vnet') }
      : { mode, topology: azHubFirewallTopology('published-vnet') }
    if (document.mode === 'vwan') {
      document.topology.spokes = document.topology.spokes.filter((spoke) => spoke.id !== 'untrusted-b')
      document.topology.sites = []
      document.topology.connections = []
      for (const spoke of document.topology.spokes) spoke.hubRouting!.labels = []
    } else {
      document.topology.vnets = document.topology.vnets.filter((vnet) => vnet.id !== 'untrusted-b')
      document.topology.sites = []
      document.topology.vpnConnections = []
      for (const vnet of document.topology.vnets) vnet.vwanHubAttachment!.hubRouting!.labels = []
    }
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'id-only-firewall.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document.topology)),
    })
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    await expect.poll(() => page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
      return saved.topology?.name ?? saved.name
    }, key)).toBe(document.topology.name)
    const request: PlatformRequest = { contractVersion: 1, operation: 'evaluate', document, requirements: [{
      id: 'id-only-inspection', kind: 'flow',
      source: mode === 'vwan' ? { kind: 'spoke', id: 'untrusted-a' } : { kind: 'subnet', vnetId: 'untrusted-a', subnetId: 'sub-untrusted-a' },
      target: mode === 'vwan' ? { kind: 'spoke', id: 'trusted-a' } : { kind: 'subnet', vnetId: 'trusted-a', subnetId: 'sub-trusted-a' },
      sourceAddress: '10.30.0.4', destinationAddress: '10.10.0.4', expectation: 'allow',
      firewallPolicy: { hubId: 'hub-local', forward: 'required', reverse: 'required' },
    }] }
    const result = await page.evaluate(async (request) => {
      const { runBrowserSimulation } = await import('/src/platform/browser.ts')
      return await runBrowserSimulation(request)
    }, request)
    expect(result).toEqual(executePlatform(request))
    expect(result.assessments[0].outcome).toBe('satisfied')
  })

  test(`${mode}: original static Firewall declarations, native handoff, worker evidence and EN/JA persistence`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: mode === 'full' ? 390 : 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'selective-firewall.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology())),
    })
    const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    const saved = () => page.evaluate(({ key, mode }) => {
      const value = JSON.parse(localStorage.getItem(key)!)
      return mode === 'vwan' ? value : value.topology
    }, { key, mode })
    await expect.poll(async () => (await saved()).name).toContain('Selective Firewall')
    await page.getByLabel('Theme', { exact: true }).selectOption(mode === 'full' ? 'dark' : 'light')
    if (mode === 'vwan') {
      await page.getByLabel('Select hub Local secure hub', { exact: true }).focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
    } else {
      await page.getByTestId('aznet-vwanhub-hub-local').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Configure Hub & Labels', exact: true }).click()
    }
    const editor = page.getByRole('region', { name: 'Static hub Firewall routing', exact: true })
    await expect(editor.getByRole('checkbox', { name: 'Declare local Azure Firewall', exact: true })).toBeChecked()
    await expect(editor.getByRole('textbox', { name: 'Local Firewall ID', exact: true })).toHaveValue('fw-local')
    await editor.getByRole('textbox', { name: 'Destination prefixes defaultRouteTable 1', exact: true }).fill('10.1.0.1/8')
    await editor.getByRole('textbox', { name: 'Destination prefixes defaultRouteTable 1', exact: true }).press('Tab')
    await expect(editor.getByRole('alert')).toHaveText('Enter valid IPv4 CIDR prefixes.')
    await editor.getByRole('textbox', { name: 'Destination prefixes defaultRouteTable 1', exact: true }).fill('10.0.0.0/8, 172.16.0.0/12')
    await editor.getByRole('textbox', { name: 'Destination prefixes defaultRouteTable 1', exact: true }).press('Tab')
    if (mode === 'vwan') await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    else await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
    const topology = await saved()
    const hubs = mode === 'vwan' ? topology.hubs : topology.vwanHubs
    expect(hubs[0].routeTables[0].staticRoutes[0].destinations).toEqual(['10.0.0.0/8', '172.16.0.0/12'])
    const request: PlatformRequest = { contractVersion: 1, operation: 'evaluate', document: { mode, topology }, requirements: [{
      id: 'inspected', kind: 'flow',
      source: mode === 'vwan' ? { kind: 'spoke', id: 'untrusted-a' } : { kind: 'subnet', vnetId: 'untrusted-a', subnetId: 'sub-untrusted-a' },
      target: mode === 'vwan' ? { kind: 'site', id: 'branch-a' } : { kind: 'site', siteId: 'branch-a' },
      sourceAddress: '10.30.0.4', destinationAddress: '10.50.0.4', expectation: 'allow',
      firewallPolicy: { hubId: 'hub-local', forward: 'required', reverse: 'required' },
    }] }
    const workerResult = await page.evaluate(async (request) => {
      const { runBrowserSimulation } = await import('/src/platform/browser.ts')
      return await runBrowserSimulation(request)
    }, request)
    expect(workerResult).toEqual(executePlatform(request))
    expect(workerResult.assessments[0].outcome).toBe('satisfied')
    const hubNode = mode === 'vwan' ? page.locator('[data-node-id="hub-local"]') : page.getByTestId('aznet-vwanhub-hub-local')
    await hubNode.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: mode === 'vwan' ? 'BGP table' : 'Inspect Virtual WAN Hub Effective RIB', exact: true }).click()
    const routes = page.getByRole('dialog', { name: mode === 'vwan' ? /^(BGP table|Firewall forwarding table) · Local secure hub$/ : 'Effective routes', exact: true })
    await expect(routes.locator('tr[data-prefix="10.0.0.0/8"][data-preferred="true"]')).toContainText('Original local Firewall')
    if (mode === 'vwan') await routes.getByLabel('Route view', { exact: true }).selectOption('firewall')
    else await routes.getByLabel('Hub routing table', { exact: true }).selectOption('')
    await expect(routes.locator('tr[data-prefix="10.30.0.0/16"][data-preferred="true"]')).toContainText('untrusted-a')
    await expect(routes.locator('tr[data-prefix="10.0.0.0/8"]')).toHaveCount(0)
    if (mode === 'full') {
      await page.getByTestId('aznet-tab-tracer').click()
      await page.getByTestId('aznet-trace-source-select').selectOption('subnet:untrusted-a:sub-untrusted-a')
      await page.getByTestId('aznet-trace-dest-select').selectOption('site:branch-a:10.50.0.0/16')
      await page.getByTestId('aznet-run-trace-btn').click()
      await expect(page.getByTestId('aznet-forward-hops')).toContainText('Original local Firewall [fw-local]')
      await expect(page.getByTestId('aznet-reverse-hops')).toContainText('Original local Firewall [fw-local]')
      await expect(page.locator('[data-firewall-traversed="true"]')).toHaveCount(1)
    }
    await page.keyboard.press('Escape')
    await page.reload()
    expect(await saved()).toEqual(topology)
    await page.getByRole('combobox', { name: 'Language / 言語', exact: true }).selectOption('ja')
    if (mode === 'vwan') {
      await page.locator('[data-node-id="hub-local"]').focus()
      await page.keyboard.press('Shift+F10')
      const label = await page.evaluate(async () => (await import('/src/i18n.ts')).t('Edit configuration'))
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    } else {
      await page.getByTestId('aznet-vwanhub-hub-local').focus()
      await page.keyboard.press('Shift+F10')
      const label = await page.evaluate(async () => (await import('/src/i18n.ts')).t('Configure Hub & Labels'))
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    await expect(page.getByRole('region', { name: '静的ハブ Firewall ルーティング', exact: true })).toContainText('配信を保証しません')
    expect(errors).toEqual([])
  })
}
