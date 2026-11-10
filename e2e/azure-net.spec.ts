import { expect, test } from '@playwright/test'

test.describe('Azure Networking Simulator Preview (/?mode=azure-net)', () => {
  test('renders compound VNet diagram, Subnet Effective Routes, Symmetry Tracer, and Auto-Fix Diagnostics', async ({
    page,
  }) => {
    await page.goto('/?mode=azure-net')

    await expect(page.getByRole('heading', { name: 'AzNet Simulator' })).toBeVisible()
    await expect(page).toHaveTitle('AzNet Simulator')
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon-aznet.svg')
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

    // Open Sample Gallery modal and load the 5th flagship all-features showcase topology
    await page.getByTestId('aznet-open-sample-gallery-btn').click()
    await expect(page.getByTestId('aznet-sample-gallery-modal')).toBeVisible()
    await expect(page.getByTestId('aznet-gallery-card-uc9-expressroute-hairpin-two-vnets')).toBeVisible()
    await page.getByTestId('aznet-gallery-load-enterprise-vnet-all-features-showcase').click()
    await expect(page.getByTestId('aznet-sample-gallery-modal')).toHaveCount(0)
    await expect(page.getByTestId('aznet-vnet-vnet-hub-neu')).toBeVisible()
  })

  test('supports Unified Mode Switcher (Full / Hub & Spoke-Only / vWAN-Only), URL hash state sharing (#s=...), Internet egress tracing, and Effective Route trace badges', async ({
    page,
  }) => {
    await page.goto('/?mode=azure-net')

    // 1. Mode switcher toggles between Full Hybrid, Hub & Spoke-Only, and Virtual WAN-Only
    await expect(page.getByTestId('simulator-mode-switch')).toBeVisible()
    await page.getByTestId('simulator-mode-hub-spoke').click()
    await expect(page).toHaveURL(/mode=hub-spoke/)

    // In Hub & Spoke-Only mode, sample dropdown hides vWAN Hub samples
    const sampleOptions = await page
      .getByTestId('aznet-sample-select')
      .locator('option')
      .allTextContents()
    expect(sampleOptions.some((t) => t.includes('Hybrid Secured vWAN Hub'))).toBe(false)

    // Switch to vWAN-Only mode and back to Full Hybrid mode
    await page.getByTestId('simulator-mode-vwan').click()
    await expect(page.getByRole('heading', { name: 'Virtual WAN Topology Lab' })).toBeVisible()
    await page.getByTestId('simulator-mode-full').click()
    await expect(page.getByRole('heading', { name: 'AzNet Simulator' })).toBeVisible()

    // 2. Public Internet endpoint in Path Tracer + Subnet Default Outbound Access toggle
    await page.getByTestId('aznet-tab-tracer').click()
    await page.getByTestId('aznet-trace-source-select').selectOption('subnet:vnet-spoke-app:sub-app-web')
    await page.getByTestId('aznet-trace-dest-select').selectOption('internet:20.50.60.70')
    await expect(page.getByTestId('aznet-symmetry-verdict')).toBeVisible()

    // 3. Active trace route highlighting (FWD / RET badges) in Effective Route Table
    await page.getByTestId('aznet-tab-routes').click()
    await page.getByTestId('aznet-subnet-sub-app-web').click()
    await expect(page.getByTestId('aznet-route-trace-badge-fwd').first()).toBeVisible()

    // 4. Share Link encodes topology into URL hash (#s=...) and reloads cleanly
    await page.getByTestId('aznet-share-url-btn').click()
    await expect(page).toHaveURL(/#s=/)

    // 5. Optional diagram node labels in AzNet Configure tab & vWAN mode
    await page.getByTestId('aznet-tab-editor').click()
    const hubLabelInput = page.getByTestId('aznet-node-label-input-vnet-hub-weu')
    await expect(hubLabelInput).toBeVisible()
    await hubLabelInput.fill('Transit Inspection Hub')
    await expect(page.getByTestId('aznet-node-label-vnet-hub-weu')).toContainText('Transit Inspection Hub')

    // Switch to vWAN-Only mode and set a custom diagram label on Europe hub
    await page.getByTestId('simulator-mode-vwan').click()
    await page.getByLabel('Select hub Europe hub', { exact: true }).focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menu').getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
    const editHubDialog = page.getByRole('dialog', { name: 'Edit hub', exact: true })
    const vwanLabelInput = editHubDialog.getByLabel('Diagram label (optional)', { exact: true })
    await expect(vwanLabelInput).toBeVisible()
    await vwanLabelInput.fill('Core EMEA Hub')
    await editHubDialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByTestId('node-label-eu')).toContainText('Core EMEA Hub')
  })
})

