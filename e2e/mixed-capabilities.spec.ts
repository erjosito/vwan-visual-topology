import { expect, test } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { executePlatform } from '../src/platform/service'
import type { PlatformRequest } from '../src/platform/contract'

function design() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Mixed capability bridge'
  topology.vwanHubs = [{
    id: 'wan', name: 'WAN', region: 'westeurope', preference: 'ExpressRoute',
    routingIntent: { private: false, internet: false },
    routeMapAssignments: [{ connectionId: 'branch-link', inboundMapId: 'hub-policy' }],
  }]
  topology.vnets = [{
    id: 'spoke', name: 'Spoke', region: 'westeurope', role: 'spoke-vnet', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'work', name: 'Work', prefix: '10.1.1.0/24' }], gateways: [],
    appliances: [{ id: 'edge', name: 'Edge', kind: 'nva-vm', subnetId: 'work', privateIp: '10.1.1.5', asn: 65010, bgpEnabled: true, enableIpForwarding: true, staticRoutes: [] }],
    vwanHubAttachment: { hubId: 'wan', enabled: true },
  }]
  topology.sites = [{ id: 'branch', name: 'Branch', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  topology.vpnConnections = [{ id: 'branch-link', name: 'Branch link', siteId: 'branch', targetKind: 'vwan-hub', targetId: 'wan', enabled: true, bgpEnabled: true }]
  topology.routeMaps = [{ id: 'hub-policy', name: 'Hub policy', hubId: 'wan', rules: [] }]
  return topology
}

for (const narrow of [false, true]) {
  test(`full: ${narrow ? 'narrow dark' : 'wide light'} original hub policy markers, SD-WAN and NVA controls persist and match the worker`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: narrow ? 390 : 1440, height: narrow ? 844 : 1000 })
    await page.addInitScript((topology) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, design())
    await page.goto('/?mode=full')
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await page.getByLabel('Theme', { exact: true }).selectOption(narrow ? 'dark' : 'light')
    const marker = page.locator('.policy-marker[data-router-id="wan"][data-connection-id="branch-link"]')
    await expect(marker).toHaveCount(1)
    await marker.focus()
    await marker.press('Enter')
    const policy = page.getByRole('dialog', { name: 'Route maps · WAN', exact: true })
    await expect(policy.getByLabel('Inbound route map', { exact: true })).toHaveValue('hub-policy')
    await policy.getByRole('button', { name: /^Hub policy/ }).click()
    await policy.getByRole('button', { name: 'Add rule', exact: true }).click()
    await policy.getByLabel('Rule 1 action', { exact: true }).selectOption('prepend')
    await policy.getByLabel('Rule 1 prepend ASNs', { exact: true }).fill('64496')
    await policy.getByRole('button', { name: 'Save route map', exact: true }).click()
    await expect(policy.getByRole('alert')).toHaveCount(0)
    await policy.getByRole('button', { name: 'Close Route maps · WAN', exact: true }).click()
    await expect(policy).toHaveCount(0)
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    const openTools = async () => {
      if (!await tools.isVisible()) await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    }
    await openTools()
    await tools.getByRole('searchbox').fill('branch-link')
    await tools.locator('.workspace-tools-objects button').click()
    await openTools()
    await tools.getByRole('button', { name: 'Configure VPN Connection', exact: true }).click()
    const editor = page.getByTestId('aznet-hybrid-connection-editor')
    await editor.getByRole('combobox', { name: 'Transport', exact: true }).selectOption('SDWAN')
    await expect(editor.getByRole('checkbox', { name: 'BGP enabled (required for SD-WAN)', exact: true })).toBeChecked()
    await expect(editor.getByRole('checkbox', { name: 'BGP enabled (required for SD-WAN)', exact: true })).toBeDisabled()
    await editor.getByRole('button', { name: 'Save connection routing', exact: true }).click()
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    await expect.poll(async () => (await read()).vpnConnections[0].transport).toBe('SDWAN')
    await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    if (await tools.isVisible()) await tools.getByRole('button', { name: 'Close workspace controls', exact: true }).click()
    await page.getByRole('button', { name: /^Select NVA \([^)]*\) · Edge/ }).focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure Appliance', exact: true }).click()
    const nva = page.getByTestId('aznet-hybrid-nva-editor')
    await nva.getByLabel('Peer with the attached Virtual WAN hub', { exact: true }).check()
    await nva.getByLabel('Advertised prefixes', { exact: true }).fill('192.168.10.0/24')
    await nva.getByRole('button', { name: 'Save NVA BGP routing', exact: true }).click()
    await expect.poll(async () => (await read()).vnets[0].appliances[0].vwanBgpEnabled).toBe(true)
    const saved = await read()
    expect(saved.vpnConnections[0].id).toBe('branch-link')
    expect(saved.vwanHubs[0].routeMapAssignments).toEqual([{ connectionId: 'branch-link', inboundMapId: 'hub-policy' }])
    expect(saved.routeMaps[0].rules[0].prepend).toEqual([64496])
    const request: PlatformRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: saved } }
    const workerResult = await page.evaluate(async (request) => {
      const { runBrowserSimulation } = await import('/src/platform/browser.ts')
      return await runBrowserSimulation(request)
    }, request)
    expect(workerResult).toEqual(executePlatform(request))
    await page.reload()
    expect(await read()).toEqual(saved)
    expect(errors).toEqual([])
  })
}

test('all native providers expose searchable capability boundaries without mutating the workspace', async ({ page }) => {
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    await page.goto(`/?mode=${mode}`)
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    const original = await page.evaluate(() => [localStorage.getItem('vwan-visual-topology:v1'), localStorage.getItem('aznet-visual-topology:v1')])
    const tools = page.getByRole('complementary', { name: 'Workspace controls', exact: true })
    if (!await tools.isVisible()) await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    await tools.getByRole('searchbox').fill('spoke NVA')
    const matrix = tools.getByTestId('workspace-capabilities')
    await expect(matrix.getByRole('rowheader', { name: 'Integrated SD-WAN and spoke NVA BGP peering', exact: true })).toBeVisible()
    await expect(matrix).toContainText('Static hub Firewall routing requires one hub and a declared local Firewall.')
    expect(await page.evaluate(() => [localStorage.getItem('vwan-visual-topology:v1'), localStorage.getItem('aznet-visual-topology:v1')])).toEqual(original)
  }
})
