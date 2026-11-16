import { expect, test } from '@playwright/test'
import { createEmptyAzNetTopology, type AzNetTopology } from '../src/azure-net/model'

const toolsName = 'Workspace controls'
const storageKey = 'aznet-visual-topology:v1'

function deviceTopology(): AzNetTopology {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [1, 2].map((index) => ({
    id: `owner-${index}`, name: `Owner ${index}`, role: 'standalone', region: 'westeurope', prefixes: [`10.${index}.0.0/16`],
    subnets: [
      { id: `work-${index}`, name: 'Work', prefix: `10.${index}.1.0/24` },
      { id: `gateway-subnet-${index}`, name: 'GatewaySubnet', prefix: `10.${index}.255.0/27` },
      { id: `ars-subnet-${index}`, name: 'RouteServerSubnet', prefix: `10.${index}.254.0/27` },
    ],
    gateways: [
      { id: `er-${index}`, name: 'Shared ER name', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true },
      { id: `vpn-${index}`, name: 'Shared VPN name', kind: 'Vpn', asn: 65515, bgpEnabled: true, enabled: false },
    ],
    routeServer: { id: `ars-${index}`, name: 'Shared ARS name', subnetId: `ars-subnet-${index}`,
      enabled: false, branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: [] },
    appliances: [],
  }))
  return topology
}

for (const mode of ['vwan', 'hub-spoke', 'full'] as const) {
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : storageKey
  const sample = mode === 'vwan' ? 'hub-routing-preferences' : 'hub-spoke-firewall-udr'
  const rootId = mode === 'vwan' ? 'vwan-app' : 'aznet-app'

  test(`${mode}: object discovery focuses context without changing the design or explicit route scope`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}&sample=${sample}`)
    await expect(page.getByTestId(rootId)).toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
    const original = (await page.evaluate((key) => localStorage.getItem(key), key))!
    const saved = JSON.parse(original)
    const nodes = mode === 'vwan' ? (saved.topology ?? saved).hubs : saved.topology.vnets
    const tools = page.getByRole('complementary', { name: toolsName, exact: true })
    const search = tools.getByRole('searchbox')
    await expect(tools.getByRole('list', { name: 'Objects in this design' })).toHaveCount(0)
    const choose = async (index: number) => {
      await search.fill(nodes[index].id)
      const title = `Select ${mode === 'vwan' ? 'Virtual WAN hub' : 'VNet'}: ${nodes[index].label ?? nodes[index].name}`
      await tools.getByRole('button', { name: title, exact: true }).click()
      await expect(search).toHaveValue('')
      await expect(tools.locator('h3[tabindex="-1"]')).toBeFocused()
      await expect(tools.getByRole('list', { name: 'Objects in this design' })).toHaveCount(0)
    }
    await choose(0)
    const routeAction = tools.getByRole('button', { name: mode === 'vwan' ? 'BGP table' : 'Inspect Effective Routes', exact: true })
    await routeAction.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const before = await dialog.innerText()
    await choose(1)
    await expect(dialog).toHaveText(before, { useInnerText: true })
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
  })

  test(`${mode}: narrow discovery closes before selection and restores keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/?mode=${mode}&sample=${sample}`)
    await expect(page.getByTestId(rootId)).toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
    const original = (await page.evaluate((key) => localStorage.getItem(key), key))!
    const saved = JSON.parse(original)
    const node = mode === 'vwan' ? (saved.topology ?? saved).hubs[0] : saved.topology.vnets[0]
    const opener = page.getByRole('button', { name: toolsName, exact: true })
    await opener.click()
    const tools = page.getByRole('complementary', { name: toolsName, exact: true })
    await tools.getByRole('searchbox').fill(node.id)
    await tools.getByRole('button', {
      name: `Select ${mode === 'vwan' ? 'Virtual WAN hub' : 'VNet'}: ${node.label ?? node.name}`, exact: true,
    }).click()
    await expect(tools).toHaveCount(0)
    await expect(opener).toBeFocused()
    await opener.click()
    await expect(tools.getByRole('button', { name: mode === 'vwan' ? 'BGP table' : 'Inspect Effective Routes', exact: true })).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original)
  })
}

test('same-named nested and disabled devices select the exact owner and leave configuration unchanged', async ({ page }) => {
  await page.addInitScript((topology) => localStorage.setItem('aznet-visual-topology:v1',
    JSON.stringify({ sampleId: '', topology })), deviceTopology())
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  const tools = page.getByRole('complementary', { name: toolsName, exact: true })
  const search = tools.getByRole('searchbox')
  await search.fill('vpn-2')
  const gateway = tools.getByRole('button', { name: 'Select VPN gateway: Shared VPN name (Owner 2)', exact: true })
  await expect(gateway).toBeEnabled()
  await expect(gateway).toContainText('Disabled')
  await gateway.click()
  await expect(tools.getByRole('heading', { level: 3 }).last()).toContainText('Shared VPN name')
  await tools.getByText('Find objects', { exact: true }).click()
  await expect(tools.getByRole('button', { name: 'Select VPN gateway: Shared VPN name (Owner 2)', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await search.fill('ars-2')
  await tools.getByRole('button', { name: 'Select Azure Route Server: Shared ARS name (Owner 2)', exact: true }).click()
  await expect(tools.getByRole('heading', { level: 3 }).last()).toContainText('Shared ARS name')
  await search.fill('work-2')
  await tools.getByRole('button', { name: 'Select Subnet: Work (Owner 2)', exact: true }).click()
  await tools.getByRole('button', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Owner 2')
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
})

test('object results mount lazily, cap rendering without hiding searchable later objects, and refresh after deletion/undo', async ({ page }) => {
  const topology = createEmptyAzNetTopology()
  topology.sites = Array.from({ length: 160 }, (_, index) => ({
    id: `remote-${String(index).padStart(3, '0')}`, name: `Research ${index}`, asn: 65000 + index, prefixes: [`10.1.${index}.0/24`],
  }))
  await page.addInitScript((topology) => localStorage.setItem('aznet-visual-topology:v1',
    JSON.stringify({ sampleId: '', topology })), topology)
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const tools = page.getByRole('complementary', { name: toolsName, exact: true })
  const search = tools.getByRole('searchbox')
  await expect(tools.getByRole('list', { name: 'Objects in this design' })).toHaveCount(0)
  await tools.getByText('Find objects', { exact: true }).click()
  await expect(tools.getByRole('list', { name: 'Objects in this design' }).getByRole('button')).toHaveCount(100)
  await expect(tools.getByRole('status')).toHaveText('Showing 100 of 160 objects. Refine your search to find others.')
  await search.fill('remote-159')
  await tools.getByRole('button', { name: 'Select site: Research 159', exact: true }).click()
  await tools.getByRole('button', { name: 'Delete On-Premises Site', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm deletion', exact: true }).click()
  await search.fill('remote-159')
  await expect(tools.getByRole('button', { name: 'Select site: Research 159', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Undo/, exact: false }).click()
  await expect(tools.getByRole('button', { name: 'Select site: Research 159', exact: true })).toBeVisible()
})

test('Japanese discovery translates presentation but preserves opaque user labels and ID search', async ({ page }) => {
  const topology = deviceTopology()
  topology.vnets[0].label = 'Workspace controls'
  await page.addInitScript((topology) => {
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
    localStorage.setItem('vwan-visual-topology:language:v1', 'ja')
  }, topology)
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const tools = page.getByRole('complementary', { name: 'ワークスペースの操作', exact: true })
  await tools.getByRole('searchbox').fill('owner-1')
  await expect(tools.getByRole('button', { name: 'VNet を選択: Workspace controls', exact: true })).toBeVisible()
  await expect(tools.getByText('オブジェクトを探す', { exact: true })).toBeVisible()
})

test('compact desktop-height workspace keeps pointer discovery and focused context within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 })
  await page.addInitScript((topology) => {
    Object.defineProperty(window, 'desktopSimulator', { value: {} })
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, deviceTopology())
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  const tools = page.getByRole('complementary', { name: toolsName, exact: true })
  const bounds = (await tools.boundingBox())!
  expect(bounds.height).toBeGreaterThanOrEqual(239)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(641)
  await tools.getByRole('searchbox').fill('vpn-2')
  await tools.getByRole('button', { name: 'Select VPN gateway: Shared VPN name (Owner 2)', exact: true }).click()
  const heading = tools.locator('h3[tabindex="-1"]')
  await expect(heading).toBeFocused()
  await expect(heading).toBeInViewport()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
})

test('focused VWAN discovery remains visible after the shared status header reflows', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 })
  await page.addInitScript(() => Object.defineProperty(window, 'desktopSimulator', { value: {} }))
  await page.goto('/?mode=vwan&sample=hub-routing-preferences')
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  const topology = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  const hub = topology.hubs[0]
  const tools = page.getByRole('complementary', { name: toolsName, exact: true })
  await tools.getByRole('searchbox').fill(hub.id)
  await tools.getByRole('button', { name: `Select Virtual WAN hub: ${hub.name}`, exact: true }).click()
  const heading = tools.locator('h3[tabindex="-1"]')
  await expect(heading).toBeFocused()
  const header = page.locator('header.unified-topbar')
  const height = (await header.boundingBox())!.height
  await header.evaluate((header) => { header.style.paddingBottom = '70px' })
  await expect.poll(async () => (await header.boundingBox())!.height).toBeGreaterThan(height)
  await expect(heading).toBeInViewport({ ratio: 0.99 })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))).toEqual(topology)
})
