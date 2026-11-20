import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { loadLanguage, translate } from '../src/i18n'

test.use({ storageState: { cookies: [], origins: [] } })

for (const mode of ['hub-spoke', 'full']) {
  for (const profile of [{ language: 'en' as const, preview: true, width: 1440 },
    { language: 'en' as const, preview: false, width: 1440 }, { language: 'ja' as const, preview: true, width: 390 }]) {
    test(`${mode}: global UDR sharing, cloning, deletion, undo and persistence (${profile.language}, ${profile.preview})`, async ({ page }) => {
      test.setTimeout(60_000)
      await loadLanguage(profile.language)
      const text = (value: string, ...values: string[]) => translate(profile.language, value, ...values)
      const topology = createEmptyAzNetTopology()
      topology.udrTables = [
        { id: 'shared', name: 'Shared', region: 'westeurope', disableBgpRoutePropagation: true,
          routes: [{ id: 'inspect', name: 'Inspect', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true }] },
        { id: 'unused', name: 'Unused', region: 'eastus', disableBgpRoutePropagation: false, routes: [] },
      ]
      topology.vnets = ['a', 'b'].map((id, index) => ({ id, name: `Network ${id}`, role: 'spoke', region: 'West Europe',
        prefixes: [`10.${index}.0.0/16`], appliances: [], gateways: [],
        subnets: [{ id: `s-${id}`, name: 'Workload', prefix: `10.${index}.1.0/24`, routeTableId: 'shared' }] }))
      await page.setViewportSize({ width: profile.width, height: 1000 })
      await page.emulateMedia({ colorScheme: profile.language === 'ja' ? 'dark' : 'light' })
      await page.addInitScript(({ topology, profile }) => {
        localStorage.setItem('aznet-ui-preview:v1', String(profile.preview))
        localStorage.setItem('aznet-workspace-tools:v1', 'closed')
        localStorage.setItem('vwan-visual-topology:language:v1', profile.language)
        if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      }, { topology, profile })
      await page.goto(`/?mode=${mode}`)
      const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
      const open = async () => {
        await page.getByRole('button', { name: text('Workspace controls'), exact: true }).click()
        await page.getByTestId('aznet-route-table-library-btn').click()
      }
      const manager = page.getByTestId('udr-table-manager')
      const close = () => manager.getByRole('button', { name: text('Close'), exact: true }).click()
      await open()
      await expect(manager.getByTestId('udr-library-unused')).toContainText(text('Unassociated'))
      await expect(manager.getByTestId('udr-library-shared')).toContainText('Network a/Workload')
      await expect(manager.getByTestId('udr-library-shared')).toContainText('Network b/Workload')
      await expect(manager.getByTestId('udr-library-shared')).toContainText(text('BGP propagation disabled'))
      const shared = manager.getByTestId('aznet-rt-card-shared')
      await expect(shared.getByTestId('aznet-delete-rt-shared')).toBeDisabled()
      await shared.getByTestId('aznet-rt-disable-bgp-shared').uncheck()
      await shared.locator('tbody tr').getByRole('textbox').nth(1).fill('10.2.0.0/16')
      await expect.poll(async () => (await read()).udrTables[0].routes[0].prefix).toBe('10.2.0.0/16')
      const source = (await read()).udrTables[0]
      await shared.getByRole('button', { name: text('Clone route table'), exact: true }).click()
      const form = manager.getByTestId('udr-create-form')
      await form.getByLabel(text('Route-table name'), { exact: true }).fill('Independent copy')
      await form.getByLabel(text('Route-table region'), { exact: true }).fill('East US')
      await form.getByRole('button', { name: text('Create route-table clone'), exact: true }).click()
      await expect.poll(async () => (await read()).udrTables.length).toBe(3)
      const saved = await read(), clone = saved.udrTables.find((table: { name: string }) => table.name === 'Independent copy')
      expect(saved.udrTables[0]).toEqual(source)
      expect(clone.id).not.toBe(source.id)
      expect(clone.routes[0].id).not.toBe(source.routes[0].id)
      expect(clone.routes[0].nextHopIp).toBe('10.0.1.4')
      expect(saved.vnets.map((vnet: { subnets: { routeTableId: string }[] }) => vnet.subnets[0].routeTableId)).toEqual(['shared', 'shared'])
      const copy = manager.getByTestId(`aznet-rt-card-${clone.id}`)
      await copy.locator('tbody tr').getByRole('textbox').nth(1).fill('10.3.0.0/16')
      expect((await read()).udrTables[0]).toEqual(source)
      expect((await new AxeBuilder({ page }).include('[data-testid="udr-table-manager"]').analyze()).violations).toEqual([])
      expect(await manager.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await copy.getByTestId(`aznet-delete-rt-${clone.id}`).click()
      await expect.poll(async () => (await read()).udrTables.length).toBe(2)
      await close()
      await page.getByTitle('Undo', { exact: true }).click()
      await expect.poll(async () => (await read()).udrTables.length).toBe(3)
      await page.getByTitle('Redo', { exact: true }).click()
      await expect.poll(async () => (await read()).udrTables.length).toBe(2)
      await page.getByTestId('aznet-select-vnet-a').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
      const summary = page.locator('.aznet-inspector-window summary').filter({ hasText: text('Route tables') }).first()
      if (await summary.count() && await summary.locator('..').getAttribute('open') === null) await summary.click()
      await page.locator('.aznet-inspector-window').getByTestId('aznet-rt-card-shared')
        .getByRole('button', { name: text('Open in route-table library'), exact: true }).click()
      await shared.getByRole('button', { name: text('Dissociate {0}', 'Network a/Workload'), exact: true }).click()
      await expect(shared.getByTestId('aznet-delete-rt-shared')).toBeDisabled()
      await shared.getByRole('button', { name: text('Dissociate {0}', 'Network b/Workload'), exact: true }).click()
      await shared.getByTestId('aznet-delete-rt-shared').click()
      await expect.poll(async () => (await read()).udrTables.length).toBe(1)
      await close()
      await page.reload()
      await open()
      await expect(manager.getByTestId('udr-library-unused')).toBeVisible()
      await expect(manager.getByTestId('udr-library-shared')).toHaveCount(0)
      await close()
    })
  }
  test(`${mode}: workspace creation without any selected VNet creates an unused regional table`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('aznet-workspace-tools:v1', 'closed')
    })
    await page.goto(`/?mode=${mode}`)
    await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    await page.getByTestId('aznet-add-rt-topbar-btn').click()
    const manager = page.getByTestId('udr-table-manager'), form = manager.getByTestId('udr-create-form')
    await expect(manager).toContainText('Unsaved configuration changes.')
    await form.getByLabel('Route-table name', { exact: true }).fill('Created without VNet')
    page.once('dialog', (dialog) => dialog.dismiss())
    await manager.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(form.getByLabel('Route-table name', { exact: true })).toHaveValue('Created without VNet')
    await form.getByLabel('Route-table region', { exact: true }).fill('West Europe')
    await form.getByRole('button', { name: 'Create route table', exact: true }).click()
    await expect(manager.getByRole('button', { name: /Created without VNet/ })).toContainText('Unassociated')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(saved.vnets).toEqual([])
    expect(saved.udrTables[0]).toMatchObject({ name: 'Created without VNet', region: 'West Europe', routes: [] })
    await manager.getByRole('button', { name: 'Close', exact: true }).click()
  })
  test(`${mode}: subnet creation associates only its initial table and later global creation remains unused`, async ({ page }) => {
    const topology = createEmptyAzNetTopology()
    topology.vnets = [{ id: 'a', name: 'Network', role: 'spoke', region: 'westeurope', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'work', name: 'Workload', prefix: '10.0.1.0/24' }], gateways: [], appliances: [] }]
    await page.addInitScript((topology) => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('aznet-workspace-tools:v1', 'closed')
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    }, topology)
    await page.goto(`/?mode=${mode}`)
    await page.getByTestId('aznet-select-vnet-a').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
    await page.locator('.aznet-inspector-window summary').filter({ hasText: 'Subnet configuration' }).first().click()
    await page.getByTestId('aznet-subnet-rt-select-work').selectOption('__create__')
    const manager = page.getByTestId('udr-table-manager'), form = manager.getByTestId('udr-create-form')
    await form.getByLabel('Route-table name', { exact: true }).fill('Associated')
    await expect(form.getByLabel('Route-table region', { exact: true })).toHaveValue('westeurope')
    await form.getByRole('button', { name: 'Create route table', exact: true }).click()
    await manager.getByRole('button', { name: 'Create route table', exact: true }).click()
    await form.getByLabel('Route-table name', { exact: true }).fill('Unused')
    await form.getByLabel('Route-table region', { exact: true }).fill('eastus')
    await form.getByRole('button', { name: 'Create route table', exact: true }).click()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    expect(saved.udrTables.map((table: { name: string }) => table.name)).toEqual(['Associated', 'Unused'])
    expect(saved.vnets[0].subnets[0].routeTableId).toBe(saved.udrTables[0].id)
    await manager.getByRole('button', { name: 'Close', exact: true }).click()
  })
}
