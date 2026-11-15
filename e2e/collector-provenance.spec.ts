import { test, expect } from '@playwright/test'

test('partial and legacy empty NIC captures never display a complete-match badge', async ({ page }) => {
  await page.goto('/?mode=hub-spoke')
  const capture = {
    kind: 'azure-network-capture', version: 2, resourceGroup: 'rg',
    vnets: [{ id: 'known', name: 'Known VNet', addressSpace: { addressPrefixes: ['10.42.0.0/16'] },
      subnets: [{ id: 'work', name: 'Workload', addressPrefix: '10.42.1.0/24' }] }],
    nicEffectiveRoutes: [{ nicId: 'nic', nicName: 'Probe', vnetName: 'Known VNet', subnetName: 'Workload', effectiveRoutes: [] }],
  }
  await page.locator('input[data-desktop-import]').setInputFiles({
    name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)),
  })
  const report = page.getByTestId('aznet-comparison-report')
  await expect(report).toContainText('COVERAGE UNKNOWN')
  await expect(report).not.toContainText('MATCHED (')
  const sections = Object.fromEntries(
    ['account', 'vnets', 'routeTables', 'vnetGateways', 'localNetworkGateways', 'vpnConnections', 'routeServers', 'privateEndpoints', 'networkInterfaces']
      .map((key) => [key, { state: 'succeeded', complete: true }]),
  )
  await page.locator('input[data-desktop-import]').setInputFiles({
    name: 'partial.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      ...capture, observationVersion: 1, configurationComplete: true, context: { cloud: 'AzureCloud' }, sections,
      nicEffectiveRoutes: [{ ...capture.nicEffectiveRoutes[0], observation: { state: 'denied', complete: false } }],
    })),
  })
  await expect(report).toContainText('COVERAGE PARTIAL')
  await expect(report).not.toContainText('MATCHED (')
  await expect(report).toContainText('0 matched, 0 mismatched')
})
