import { expect, test, type Locator, type Page } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import AxeBuilder from '@axe-core/playwright'
import { ALL_KNOWN_AZURE_REGIONS } from '../src/er-locations-catalog'
import { openWorkspaceActions } from './document-action-helpers'

test.use({ storageState: { cookies: [], origins: [] } })

async function chooseLastWithMouse(page: Page, select: Locator) {
  await expect(select).toHaveJSProperty('tagName', 'SELECT')
  await select.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
}

for (const mode of ['hub-spoke', 'full']) {
  for (const current of ['westeurope', 'Future Azure Region 2099', '']) {
    test(`${mode}: region dropdown mouse, keyboard and legacy values (${current || 'missing'})`, async ({ page }) => {
      const topology = createEmptyAzNetTopology()
      topology.vnets = [{ id: 'a', name: 'Network', region: current, role: 'spoke', prefixes: ['10.0.0.0/16'],
        gateways: [], appliances: [], subnets: [] }]
      topology.udrTables = [{ id: 'table', name: 'Routes', region: current || undefined, disableBgpRoutePropagation: false,
        routes: [{ id: 'route', name: 'Default', prefix: '0.0.0.0/0', nextHopType: 'Internet', enabled: true }] }]
      await page.addInitScript(({ topology, current }) => {
        localStorage.setItem('aznet-ui-preview:v1', String(current !== 'Future Azure Region 2099'))
        localStorage.setItem('aznet-workspace-tools:v1', 'closed')
        if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      }, { topology, current })
      await page.goto(`/?mode=${mode}`)
      const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
      const node = page.getByTestId('aznet-select-vnet-a')
      await node.focus()
      await node.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
      const summary = page.locator('.aznet-inspector-window summary').filter({ hasText: 'VNet configuration' }).first()
      if (await summary.locator('..').getAttribute('open') === null) await summary.click()
      const region = page.getByTestId('aznet-vnet-region-a')
      await expect(region).toHaveAccessibleName('VNet region Network')
      await expect(region).toHaveValue(current)
      expect(await region.locator('option').allTextContents()).toEqual(current === 'westeurope' ? ALL_KNOWN_AZURE_REGIONS
        : [current ? `${current} (Unknown region)` : 'Not specified', ...ALL_KNOWN_AZURE_REGIONS])
      await page.getByLabel('VNet name Network', { exact: true }).fill('Renamed')
      expect((await read()).vnets[0].region).toBe(current)
      const last = ALL_KNOWN_AZURE_REGIONS.at(-1)!
      await chooseLastWithMouse(page, region)
      await expect.poll(async () => (await read()).vnets[0].region).toBe(last)
      await region.focus()
      await page.keyboard.press('Home')
      await expect.poll(async () => (await read()).vnets[0].region).toBe(ALL_KNOWN_AZURE_REGIONS[0])
      await page.getByRole('button', { name: 'Close Configure selected object', exact: true }).click()
      await openWorkspaceActions(page)
      await page.getByTitle('Workspace controls', { exact: true }).click()
      await page.getByRole('searchbox', { name: 'Search workspace controls', exact: true }).fill('Route-table library')
      await page.getByTestId('aznet-route-table-library-btn').click()
      const manager = page.getByTestId('udr-table-manager')
      const tableRegion = manager.getByTestId('aznet-rt-region-table')
      await expect(tableRegion).toHaveAccessibleName('Route-table region Routes')
      await expect(tableRegion).toHaveValue(current)
      await manager.getByLabel('Route Table name Routes', { exact: true }).fill('Renamed routes')
      expect((await read()).udrTables[0].region).toBe(current || undefined)
      await chooseLastWithMouse(page, tableRegion)
      expect((await read()).udrTables[0].region).toBe(current || undefined)
      await manager.getByRole('button', { name: 'Apply region', exact: true }).click()
      await expect.poll(async () => (await read()).udrTables[0].region).toBe(last)
      const nextHop = manager.getByRole('combobox', { name: 'Route next hop Default', exact: true })
      await chooseLastWithMouse(page, nextHop)
      await expect.poll(async () => (await read()).udrTables[0].routes[0].nextHopType).toBe('None')
      await manager.getByRole('button', { name: 'Close', exact: true }).click()
      await page.reload()
      await expect.poll(async () => (await read()).vnets[0].region).toBe(ALL_KNOWN_AZURE_REGIONS[0])
      expect((await read()).udrTables[0].region).toBe(last)
    })
  }
}

for (const mode of ['hub-spoke', 'full']) {
  for (const preview of [true, false]) {
    test(`${mode}: UDR region eligibility and shared-resource changes (${preview})`, async ({ page }) => {
      const topology = createEmptyAzNetTopology()
      topology.vnets = ['a', 'b', 'c'].map((id, index) => ({
        id, name: `Network ${id}`, region: index === 2 ? 'eastus' : 'West Europe', role: 'spoke',
        prefixes: [`10.${index}.0.0/16`], gateways: [], appliances: [],
        subnets: [{ id: `s-${id}`, name: 'Workload', prefix: `10.${index}.1.0/24`, routeTableId: index ? undefined : 'shared' }],
      }))
      topology.udrTables = ['shared', 'east', 'unknown'].map((id) => ({
        id, name: id, region: id === 'shared' ? 'westeurope' : id === 'east' ? 'eastus' : undefined,
        disableBgpRoutePropagation: false, routes: [],
      }))
      await page.addInitScript(({ topology, preview }) => {
        localStorage.setItem('aznet-ui-preview:v1', String(preview))
        localStorage.setItem('aznet-workspace-tools:v1', 'closed')
        if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      }, { topology, preview })
      await page.goto(`/?mode=${mode}`)
      const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
      const configure = async (id: string) => {
        const node = page.getByTestId(`aznet-select-vnet-${id}`)
        await node.focus()
        await node.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
      }
      const section = async (title: string) => {
        const summary = page.locator('.aznet-inspector-window summary').filter({ hasText: title }).first()
        if (await summary.count() && await summary.locator('..').getAttribute('open') === null) await summary.click()
      }
      await configure('b')
      await section('Subnet configuration')
      const association = page.getByTestId('aznet-subnet-rt-select-s-b')
      await expect(association.locator('option[value="east"]')).toHaveJSProperty('disabled', true)
      await expect(association.locator('option[value="unknown"]')).toHaveJSProperty('disabled', true)
      await association.selectOption('shared')
      await expect.poll(async () => (await read()).vnets[1].subnets[0].routeTableId).toBe('shared')
      await section('Route tables')
      const card = page.getByTestId('aznet-rt-card-shared')
      await expect(card).toContainText('Network a/Workload')
      await expect(card).toContainText('Network b/Workload')
      expect((await new AxeBuilder({ page }).include('[data-testid="aznet-rt-card-shared"] form').analyze()).violations).toEqual([])
      await card.getByTestId('aznet-rt-region-shared').selectOption('East US')
      await card.getByRole('button', { name: 'Apply region', exact: true }).click()
      await expect(page.getByTestId('aznet-workspace-notice')).toContainText('same region')
      expect((await read()).udrTables[0].region).toBe('westeurope')
      await card.getByTestId('aznet-rt-region-shared').selectOption('westeurope')
      await card.getByRole('button', { name: 'Apply region', exact: true }).click()
      await expect.poll(async () => (await read()).udrTables[0].region).toBe('westeurope')
      await section('VNet configuration')
      await page.getByTestId('aznet-vnet-region-b').selectOption('East US')
      expect((await read()).vnets[1].region).toBe('West Europe')
      await section('Subnet configuration')
      await association.selectOption('')
      await page.getByTestId('aznet-vnet-region-b').selectOption('East US')
      await expect.poll(async () => (await read()).vnets[1].region).toBe('East US')
      await expect(association.locator('option[value="shared"]')).toHaveJSProperty('disabled', true)
      await association.selectOption('east')
      await expect.poll(async () => (await read()).vnets[1].subnets[0].routeTableId).toBe('east')
      await page.reload()
      await configure('b')
      await section('Subnet configuration')
      await expect(page.getByTestId('aznet-subnet-rt-select-s-b')).toHaveValue('east')
    })
  }
}
