import { expect, test } from '@playwright/test'

test.describe('Azure Networking Simulator Preview (/?mode=azure-net)', () => {
  test('renders compound VNet diagram, Subnet Effective Routes, Symmetry Tracer, and Auto-Fix Diagnostics', async ({
    page,
  }) => {
    await page.goto('/?mode=azure-net')

    await expect(page.getByRole('heading', { name: 'Azure Networking Simulator' })).toBeVisible()
    await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible()
    await expect(page.getByTestId('aznet-vnet-vnet-hub-weu')).toBeVisible()

    // Click Spoke-Data subnet and verify Private Endpoint /32 LPM override in Effective Route Table
    await page.getByTestId('aznet-subnet-sub-data-db').click()
    await page.getByTestId('aznet-lpm-input').fill('10.2.2.15')
    await expect(page.getByTestId('aznet-effective-route-table')).toContainText('InterfaceEndpoint')

    // Switch to Path & Symmetry Tracer and inspect asymmetric firewall bypass between Spoke-Data and Munich Core DC
    await page.getByTestId('aznet-tab-tracer').click()
    await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-data:sub-data-db')
    await page.getByTestId('aznet-trace-dest-select').selectOption('site:site-munich-hq')
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Asymmetric')

    // Switch to Root-Cause Diagnostics and click Auto-Fix for GatewaySubnet missing UDR
    await page.getByTestId('aznet-tab-diagnostics').click()
    const gwFinding = page.getByTestId('aznet-finding-gateway-subnet-missing-udr')
    await expect(gwFinding).toBeVisible()
    await page.getByTestId('aznet-autofix-gateway-subnet-missing-udr').click()

    // Verify that after Auto-Fix, the GatewaySubnet missing UDR finding is gone and symmetry is restored
    await expect(gwFinding).toHaveCount(0)
    await page.getByTestId('aznet-tab-tracer').click()
    await expect(page.getByTestId('aznet-symmetry-verdict')).toContainText('Symmetric')

    // Switch to Sample 2 (Azure Route Server + SD-WAN NVA)
    await page.getByTestId('aznet-sample-select').selectOption('ars-sdwan-nva-coexistence')
    await page.getByTestId('aznet-tab-diagnostics').click()
    await expect(page.getByTestId('aznet-finding-bgp-propagation-blackhole')).toBeVisible()
  })
})
