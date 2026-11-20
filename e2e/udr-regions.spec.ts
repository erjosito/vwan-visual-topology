import { expect, test } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import AxeBuilder from '@axe-core/playwright'

test.use({ storageState: { cookies: [], origins: [] } })

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
      await card.getByTestId('aznet-rt-region-shared').fill('eastus')
      await card.getByRole('button', { name: 'Apply region', exact: true }).click()
      await expect(page.getByTestId('aznet-workspace-notice')).toContainText('same region')
      expect((await read()).udrTables[0].region).toBe('westeurope')
      await card.getByTestId('aznet-rt-region-shared').fill('West Europe')
      await card.getByRole('button', { name: 'Apply region', exact: true }).click()
      await expect.poll(async () => (await read()).udrTables[0].region).toBe('West Europe')
      await section('VNet configuration')
      await page.getByTestId('aznet-vnet-region-b').fill('eastus')
      expect((await read()).vnets[1].region).toBe('West Europe')
      await section('Subnet configuration')
      await association.selectOption('')
      await page.getByTestId('aznet-vnet-region-b').fill('eastus')
      await expect.poll(async () => (await read()).vnets[1].region).toBe('eastus')
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
