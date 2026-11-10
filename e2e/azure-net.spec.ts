import { expect, test } from '@playwright/test'

test.describe('Azure Networking Simulator Preview (/?mode=azure-net)', () => {
  test('renders compound VNet diagram, Subnet Effective Routes, Symmetry Tracer, and Auto-Fix Diagnostics', async ({
    page,
  }) => {
    await page.goto('/?mode=azure-net&sample=hub-spoke-firewall-udr')

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
    await page.goto('/?mode=azure-net&sample=hub-spoke-firewall-udr')

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
    await expect(page.getByRole('heading', { name: 'AzNet Simulator' })).toBeVisible()
    await expect(page.getByTestId('unified-mode-pill')).toHaveText('Virtual WAN')
    await page.getByTestId('simulator-mode-full').click()
    await expect(page.getByRole('heading', { name: 'AzNet Simulator' })).toBeVisible()
    await expect(page.getByTestId('unified-mode-pill')).toHaveText('Full Hybrid')

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

    // 5. Optional diagram node labels in AzNet Configure tab & vWAN mode (#47 scoped to selected node)
    await page.getByTestId('aznet-vnet-vnet-hub-weu').click()
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

  test('supports issues #35-#42: pinned mode switcher, context menus, peering & Route Table popovers, GWroutes:OFF badge, VNet element controls, and site/ER deletion', async ({
    page,
  }) => {
    await page.goto('/?mode=hub-spoke&sample=hub-spoke-firewall-udr')

    // #35: Mode switcher stays at a fixed position across all 3 modes
    const switchBoxHubSpoke = await page.getByTestId('simulator-mode-switch').boundingBox()
    expect(switchBoxHubSpoke).not.toBeNull()
    await page.getByTestId('simulator-mode-full').click()
    const switchBoxFull = await page.getByTestId('simulator-mode-switch').boundingBox()
    expect(switchBoxFull).not.toBeNull()
    expect(Math.abs((switchBoxHubSpoke?.x ?? 0) - (switchBoxFull?.x ?? 0))).toBeLessThanOrEqual(4)
    expect(Math.abs((switchBoxHubSpoke?.y ?? 0) - (switchBoxFull?.y ?? 0))).toBeLessThanOrEqual(4)

    await page.getByTestId('simulator-mode-vwan').click()
    const switchBoxVwan = await page.getByTestId('simulator-mode-switch').boundingBox()
    expect(switchBoxVwan).not.toBeNull()
    expect(Math.abs((switchBoxHubSpoke?.x ?? 0) - (switchBoxVwan?.x ?? 0))).toBeLessThanOrEqual(4)
    expect(Math.abs((switchBoxHubSpoke?.y ?? 0) - (switchBoxVwan?.y ?? 0))).toBeLessThanOrEqual(4)

    // Switch back to Hub & Spoke-Only mode
    await page.getByTestId('simulator-mode-hub-spoke').click()

    // #40 & #41: Verify GWroutes:OFF and RT-Spokes badge on sub-app-web
    await expect(page.getByTestId('aznet-subnet-sub-app-web')).toContainText('GWroutes:OFF')
    await expect(page.getByTestId('aznet-subnet-rt-badge-sub-app-web')).toContainText('RT-Spokes')

    // #41: Hover over Route Table badge on sub-app-web to open Route Table popover
    await page.getByTestId('aznet-subnet-rt-badge-sub-app-web').hover()
    const rtHoverCard = page.getByTestId('aznet-rt-hover-card')
    await expect(rtHoverCard).toBeVisible()
    await expect(rtHoverCard).toContainText('Propagate Gateway Routes (GWroutes)')
    await page.mouse.move(10, 10)
    await expect(rtHoverCard).toHaveCount(0)

    // #38: Hover peering pill on canvas to open VNet Peering interactive popover
    await page.getByTestId('aznet-peering-pill-peer-hub-app').hover({ force: true })
    const peerHoverCard = page.getByTestId('aznet-peering-hover-card')
    await expect(peerHoverCard).toBeVisible()
    await expect(peerHoverCard).toContainText('Allow GW Transit')
    await page.mouse.move(10, 10)
    await expect(peerHoverCard).toHaveCount(0)

    // #36: Right-click VNet node to open contextual menu
    await page.getByTestId('aznet-vnet-vnet-spoke-app').click({ button: 'right', position: { x: 24, y: 18 }, force: true })
    const ctxMenu = page.getByRole('menu').first()
    await expect(ctxMenu).toBeVisible()
    await expect(ctxMenu.getByRole('menuitem', { name: /Configure VNet/i })).toBeVisible()
    await ctxMenu.getByRole('menuitem', { name: /Add \/ Remove VNet Elements/i }).click()
    await page.getByRole('menuitem', { name: /Add Azure Firewall/i }).click()

    // #39: Verify Azure Firewall was added to VNet-Spoke-App via context menu
    await expect(page.getByTestId('aznet-chip-vnet-spoke-app-azfw-1')).toBeVisible()

    // #42: Topbar quick-create buttons (+ Site, + ER MSEE, + VNet, + Route Table)
    await page.getByTestId('aznet-add-site-btn').click()
    await expect(page.getByTestId('aznet-site-site-custom-3')).toBeVisible()

    // #37: Delete the newly added site from the Configure tab
    await page.getByTestId('aznet-tab-editor').click()
    await page.getByTestId('aznet-delete-site-site-custom-3').click()
    await expect(page.getByTestId('aznet-site-site-custom-3')).toHaveCount(0)
  })

  test('supports issues #43-#49 and localStorage persistence: empty default topology, reload persistence, ER Location Info modal, scoped Configure tab, VNet attribute editing, and Subnet CRUD', async ({
    page,
  }) => {
    await page.goto('/?mode=hub-spoke')

    // Default topology is empty when no sample or localStorage is present
    await expect(page.getByTestId('aznet-vnet-vnet-hub-weu')).toHaveCount(0)

    // Create a VNet and verify it persists across browser reload
    await page.getByTestId('aznet-add-vnet-btn').click()
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toBeVisible()

    // #43: Open ExpressRoute Peering Locations & Providers catalog modal
    await page.getByTestId('aznet-open-er-locations-btn').click()
    await expect(page.getByTestId('er-location-info-modal')).toBeVisible()
    await page.getByTestId('er-catalog-search').fill('Equinix-Amsterdam')
    await expect(page.getByTestId('er-location-detail-name')).toContainText('Amsterdam')
    await expect(page.getByTestId('er-location-local-regions')).toContainText('West Europe')
    await page.getByTestId('close-er-location-info-modal').click()
    await expect(page.getByTestId('er-location-info-modal')).toHaveCount(0)

    // #46 & #47: Select vnet-custom-1 and verify scoped Configure tab + VNet region editing
    await page.getByTestId('aznet-vnet-vnet-custom-1').click()
    await page.getByTestId('aznet-tab-editor').click()
    await expect(page.getByTestId('aznet-editor-scope-banner')).toContainText('Spoke-VNet-1')
    await page.getByTestId('aznet-vnet-region-vnet-custom-1').fill('Sweden Central')
    await expect(page.getByTestId('aznet-vnet-vnet-custom-1')).toContainText('Sweden Central')

    // #49: Subnet CRUD (create, rename, delete)
    await page.getByTestId('aznet-add-subnet-vnet-custom-1').click()
    const createdSubnetNameInput = page.getByTestId('aznet-subnet-name-snet-vnet-custom-1-2')
    await expect(createdSubnetNameInput).toBeVisible()
    await createdSubnetNameInput.fill('snet-app-tier')
    await expect(page.getByTestId('aznet-subnet-snet-vnet-custom-1-2')).toContainText('snet-app-tier')
    await page.getByTestId('aznet-delete-subnet-snet-vnet-custom-1-2').click()
    await expect(page.getByTestId('aznet-subnet-snet-vnet-custom-1-2')).toHaveCount(0)
  })
})

