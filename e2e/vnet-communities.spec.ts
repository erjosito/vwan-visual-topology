import { downloadTopologyCopy } from './document-action-helpers'
import { expect, test, type Page } from '@playwright/test'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { example } from '../src/model'

function topology() {
  const value = createEmptyAzNetTopology()
  value.vnets = [{
    id: 'hub', name: 'Community VNet', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
    bgpCommunities: { regionalCommunity: '12076:50004' },
    subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
    gateways: [{ id: 'gw', name: 'Gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true }], appliances: [],
  }]
  value.sites = [{ id: 'dc', name: 'Datacenter', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  value.erLocations = [{ id: 'er', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
  value.erLinks = [
    { id: 'er-gw', name: 'Gateway circuit', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
    { id: 'er-site', name: 'Site circuit', locationId: 'er', targetKind: 'site', targetId: 'dc', enabled: true },
  ]
  return value
}

async function menu(page: Page, id: string, action: string) {
  await page.getByTestId(id).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

for (const mode of ['hub-spoke', 'full']) {
  test(`${mode} authors, validates and clears VNet community by keyboard with persisted ER evidence`, async ({ page }) => {
    await page.addInitScript((value) => {
      if (!localStorage.getItem('aznet-visual-topology:v1')) localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: value }))
    }, topology())
    await page.goto(`/?mode=${mode}`)
    await menu(page, 'aznet-select-vnet-hub', 'Configure VNet & Elements')
    const input = page.getByRole('textbox', { name: 'VNet BGP community', exact: true })
    await expect(input).toBeVisible()
    await expect(page.getByText('Captured regional community: 12076:50004', { exact: true })).toBeVisible()
    await input.fill('12076:65536')
    await input.press('Enter')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toContainText('12076:0–65535')
    await input.fill('12076:20001')
    await input.press('Enter')
    await expect(input).toBeFocused()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].bgpCommunities))
      .toEqual({ virtualNetworkCommunity: '12076:20001', regionalCommunity: '12076:50004' })
    const downloaded = page.waitForEvent('download')
    await downloadTopologyCopy(page)
    const chunks: Buffer[] = []
    for await (const chunk of (await (await downloaded).createReadStream())!) chunks.push(chunk)
    expect(JSON.parse(Buffer.concat(chunks).toString()).vnets[0].bgpCommunities)
      .toEqual({ virtualNetworkCommunity: '12076:20001', regionalCommunity: '12076:50004' })
    await menu(page, 'aznet-site-dc', 'Inspect Site BGP Route Table')
    const rib = page.getByTestId('aznet-control-rib-card')
    await rib.getByLabel(/^Evidence · 10\.0\.0\.0\/16/).click()
    await expect(rib).toContainText('12076:20001 12076:50004')
    await expect(rib).toContainText('Original VNet community configuration: 12076:20001')
    await page.reload()
    await menu(page, 'aznet-select-vnet-hub', 'Configure VNet & Elements')
    await expect(input).toHaveValue('12076:20001')
    await input.fill('')
    await input.press('Tab')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].bgpCommunities))
      .toEqual({ regionalCommunity: '12076:50004' })
    await page.locator('[data-language-selector]').selectOption('ja')
    const japanese = page.getByRole('textbox', { name: 'VNet BGP コミュニティ', exact: true })
    await expect(japanese).toBeVisible()
    await page.context().setOffline(true)
    await japanese.fill('12076:65536')
    await japanese.press('Enter')
    await expect(page.getByRole('alert')).toContainText('12076:0～65535')
    await japanese.fill('12076:281')
    await japanese.press('Enter')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].bgpCommunities))
      .toEqual({ virtualNetworkCommunity: '12076:281', regionalCommunity: '12076:50004' })
    await page.context().setOffline(false)
    await page.getByTestId('aznet-vnet-region-hub').fill('eastus')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets[0].bgpCommunities))
      .toEqual({ virtualNetworkCommunity: '12076:281' })
  })
}

test('VWAN edits and round-trips the resource property while explaining unsupported automatic propagation', async ({ page }) => {
  await page.addInitScript((value) => { localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(value)) }, example)
  await page.goto('/?mode=vwan')
  await page.getByLabel(`Select spoke ${example.spokes[0].name}`, { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'VNet BGP community', exact: true })
  await expect(page.getByText(/VNet communities are advertised over classic ExpressRoute/)).toBeVisible()
  await input.fill('12076:20001')
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!).spokes[0].bgpCommunities))
    .toEqual({ virtualNetworkCommunity: '12076:20001' })
})
