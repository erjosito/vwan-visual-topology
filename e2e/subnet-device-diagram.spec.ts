import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { graphicalDetailTopology } from '../tests/fixtures/network-detail'

async function openDiagram(page: Page, mode: string, extraNics = 0, topology = graphicalDetailTopology(mode, extraNics), preview = true) {
  const key = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
  await page.addInitScript(({ topology, key, mode, preview }) => {
    localStorage.setItem('aznet-ui-preview:v1', String(preview))
    localStorage.setItem('aznet-workspace-tools:v1', 'closed')
    localStorage.setItem('aznet-theme', mode === 'hub-spoke' ? 'dark' : 'light')
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }))
  }, { topology, key, mode, preview })
  await page.setViewportSize({ width: mode === 'hub-spoke' ? 390 : 1440, height: 1000 })
  await page.goto(`/?mode=${mode}`)
  const node = page.locator(mode === 'vwan' ? '.spoke-node[data-node-id="detail-network"]' : '[data-testid="aznet-vnet-detail-network"]')
  await node.click()
  const opener = page.getByRole('button', { name: 'VNet detail', exact: true })
  await opener.click()
  const dialog = page.getByTestId('network-detail-dialog')
  const read = () => page.evaluate((key) => { const saved = JSON.parse(localStorage.getItem(key)!); return saved.topology ?? saved }, key)
  return { dialog, opener, read }
}

test('preview shared references reveal the original subnet across subnet pages and filters', async ({ page }) => {
  const topology = graphicalDetailTopology('full')
  if (topology.version !== 2) throw new Error('Expected native VNet fixture')
  for (let index = 3; index <= 105; index++) topology.vnets[0].subnets.push({
    id: `subnet-${index}`, name: `Subnet ${index}`, prefix: `10.10.${index}.0/24`,
  })
  topology.inventory!.nics[0].ipConfigurations[1] = {
    id: 'secondary', name: 'Secondary', subnetId: 'subnet-105', privateIp: '10.10.105.4',
  }
  const { dialog, read } = await openDiagram(page, 'full', 0, topology)
  const before = await read(), original = dialog.locator('[data-original-entity="nic:original-nic"]')
  await expect(dialog.locator('[data-subnet-id="subnet-105"]')).toHaveCount(0)
  await original.getByRole('button', { name: 'Subnet: Subnet 105 · subnet-105', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Subnet: Subnet 105 10.10.105.0/24', exact: true })).toBeFocused()
  await expect(dialog.getByRole('status', { name: '' }).filter({ hasText: 'Subnet page 2 of 2' })).toBeVisible()
  await dialog.getByLabel('Search subnets', { exact: true }).fill('Subnet 105')
  await original.getByRole('button', { name: 'Subnet: Application subnet · first', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Subnet: Application subnet 10.10.1.0/24', exact: true })).toBeFocused()
  await expect(dialog.getByLabel('Search subnets', { exact: true })).toHaveValue('')
  expect(await read()).toEqual(before)
})

test('preview native context actions edit the original appliance, release modal and undo', async ({ page }) => {
  const { dialog, opener, read } = await openDiagram(page, 'full')
  const before = await read()
  await dialog.getByRole('button', { name: 'NVA: Original NVA', exact: true }).focus()
  await page.keyboard.press('ContextMenu')
  await dialog.getByRole('menuitem', { name: 'Disable NIC IP Forwarding', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await read()).vnets[0].appliances[0].enableIpForwarding).toBe(false)
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
  expect(await read()).toEqual(before)
  await opener.click()
  await dialog.getByRole('button', { name: 'NVA: Original NVA', exact: true }).click({ button: 'right' })
  await dialog.getByRole('menuitem', { name: 'Inspect Appliance Subnet Effective Routes', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('aznet-effective-route-table')).toBeVisible()
})

test('preview unassociated NAT keeps identity at network level and has no enabled subnet action', async ({ page }) => {
  const topology = graphicalDetailTopology('full')
  topology.inventory!.natGateways![0].subnetIds = []
  const { dialog, read } = await openDiagram(page, 'full', 0, topology)
  const before = await read()
  await expect(dialog.locator('[data-subnet-id] [data-entity-id="original-nat"]')).toHaveCount(0)
  const nat = dialog.getByRole('region', { name: 'Network-level associations', exact: true })
    .getByRole('button', { name: 'NAT Gateway: Original shared NAT', exact: true })
  await nat.focus()
  await page.keyboard.press('ContextMenu')
  await expect(dialog.getByRole('menuitem', { name: 'Internet egress', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(nat).toBeFocused()
  expect(await read()).toEqual(before)
})

test('preview Japanese narrow detail retains translated graph relationships', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('vwan-visual-topology:language:v1', 'ja'))
  const topology = graphicalDetailTopology('hub-spoke')
  await page.addInitScript((topology) => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    localStorage.setItem('aznet-theme', 'dark')
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, topology)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mode=hub-spoke')
  await page.getByTestId('aznet-vnet-detail-network').click()
  await page.getByRole('button', { name: 'VNet の詳細', exact: true }).click()
  const dialog = page.getByTestId('network-detail-dialog')
  await expect(dialog.getByRole('region', { name: '共有される元のエンティティ', exact: true })).toBeVisible()
  await expect(dialog.locator('.detail-subnet-content > summary').first()).toHaveText('接続されたデバイスとポリシー')
  await dialog.locator('[data-subnet-id="first"] [data-attachment-reference="nic:original-nic"]')
    .getByRole('button', { name: '接続の参照 → 元のエンティティ', exact: true }).click()
  await expect(dialog.locator('[data-original-entity="nic:original-nic"] .detail-device-target')).toBeFocused()
  expect((await new AxeBuilder({ page }).include('[data-testid="network-detail-dialog"]').analyze()).violations).toEqual([])
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await info.attach('Japanese-narrow-detail', { body: await dialog.screenshot({ path: info.outputPath('diagram-ja.png') }), contentType: 'image/png' })
})

for (const preview of [true, false]) {
  test(`diagram first, colored subnet pipes, Azure icons and resource menus (${preview ? 'current' : 'legacy'} UI)`, async ({ page }, info) => {
    const topology = graphicalDetailTopology('full')
    if (topology.version !== 2) throw new Error('Expected native VNet fixture')
    const vnet = topology.vnets[0]
    vnet.subnets.push({ id: 'empty', name: 'Empty subnet', prefix: '10.10.3.0/24' },
      { id: 'firewall', name: 'AzureFirewallSubnet', prefix: '10.10.4.0/26' },
      { id: 'ars', name: 'RouteServerSubnet', prefix: '10.10.5.0/27' })
    vnet.appliances.push({ id: 'firewall-device', name: 'Azure Firewall', kind: 'azure-firewall', subnetId: 'firewall',
      privateIp: '10.10.4.4', enableIpForwarding: true, staticRoutes: [] })
    vnet.routeServer = { id: 'route-server', name: 'Azure Route Server', subnetId: 'ars', enabled: true,
      branchToBranchTraffic: false, hubRoutingPreference: 'ASPath', peerApplianceIds: [] }
    vnet.subnets[0].privateEndpoints = [{ id: 'endpoint', name: 'Storage endpoint', ipAddress: '10.10.1.9', serviceName: 'storage' }]
    topology.inventory!.nics.push({ id: 'unassigned-nic', name: 'Declared NIC without a workload', owner: { kind: 'vnet', id: vnet.id },
      ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'second', privateIp: '10.10.2.20' }] })
    const { dialog, read } = await openDiagram(page, 'full', 0, topology, preview)
    const before = await read(), diagram = dialog.getByTestId('vnet-detail-diagram')
    await expect(dialog.locator(':scope > header + [data-testid="vnet-detail-diagram"]')).toBeVisible()
    const graphBounds = await diagram.boundingBox(), configurationBounds = await dialog.locator('.detail-configuration').boundingBox()
    expect(configurationBounds!.y).toBeGreaterThanOrEqual(graphBounds!.y + graphBounds!.height)
    await expect(dialog.locator('.detail-subnet-policies[open]')).toHaveCount(0)
    const pipes = diagram.locator('.detail-subnet-target')
    const dimensions = await pipes.evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
      return { width: bounds.width, height: bounds.height, radius: parseFloat(style.borderRadius), color: style.borderColor }
    }))
    expect(dimensions.every((pipe) => pipe.width > pipe.height * 5 && pipe.radius >= pipe.height / 2)).toBe(true)
    expect(dimensions[0].color).not.toBe(dimensions[1].color)
    for (const [id, icon] of [['original-nic', 'virtual-machine'], ['original-nva', 'virtual-machine'], ['firewall-device', 'firewall'],
      ['original-gateway', 'virtual-network-gateway'], ['route-server', 'route-server'], ['original-nat', 'nat-gateway'],
      ['original-lb', 'load-balancer'], ['endpoint', 'private-endpoint'], ['service', 'application-gateway'],
      ['unassigned-nic', 'network-interface']]) {
      const resource = diagram.locator(`[data-entity-id="${id}"]`).first()
      const expectedIcon = await page.evaluate(async (name) =>
        (await import(/* @vite-ignore */ `/src/assets/azure/${name}.svg?import`)).default as string, icon)
      await expect(resource.locator('img')).toHaveAttribute('src', expectedIcon)
      await expect.poll(() => resource.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
      const target = resource.locator('.detail-device-target')
      await target.click({ button: 'right' })
      await expect(dialog.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(target).toBeFocused()
      await page.keyboard.press('Shift+F10')
      await expect(dialog.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
    }
    await diagram.locator('[data-entity-id="service"] .detail-device-target').click({ button: 'right' })
    await dialog.getByRole('menuitem', { name: 'Application and DNS contracts', exact: true }).click()
    await expect(dialog.getByTestId('application-flow-panel').getByLabel('Application operation', { exact: true })).toBeFocused()
    await expect(diagram.locator('[data-subnet-id="empty"] [data-entity-id]')).toHaveCount(0)
    expect(await read()).toEqual(before)
    await diagram.locator('.detail-network-heading').scrollIntoViewIfNeeded()
    await info.attach('diagram-first', { body: await dialog.screenshot({ path: info.outputPath('diagram-first.png') }), contentType: 'image/png' })
  })
}

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  test(`preview ${mode}: graphical branches, one original, keyboard actions and undo`, async ({ page }, info) => {
    const { dialog, opener, read } = await openDiagram(page, mode)
    const before = await read()
    const first = dialog.locator('[data-subnet-id="first"]')
    const second = dialog.locator('[data-subnet-id="second"]')
    const originals = dialog.getByRole('region', { name: 'Shared original entities', exact: true })
    for (const id of ['original-nic', 'original-nat', 'original-lb']) {
      await expect(originals.locator(`[data-original-entity$=":${id}"]`)).toHaveCount(1)
      for (const subnet of [first, second]) {
        await expect(subnet.locator(`[data-attachment-reference$=":${id}"]`)).toHaveCount(1)
        const edge = subnet.locator(`[data-attachment-edge$=":${id}"]`)
        const geometry = await edge.evaluate((path, id) => {
          const graph = path.closest('.detail-attachments')!, bounds = graph.getBoundingClientRect()
          const icon = graph.querySelector(`[data-entity-id="${id}"] .detail-resource-icon`)!.getBoundingClientRect()
          const pipe = graph.closest('.detail-subnet')!.querySelector('.detail-subnet-target')!.getBoundingClientRect()
          const points = path.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number)
          return {
            start: points[1], pipeBottom: pipe.bottom - bounds.top,
            endX: points[3], iconX: icon.left - bounds.left + icon.width / 2,
            endY: points[4], iconTop: icon.top - bounds.top,
          }
        }, id)
        expect(geometry.start).toBeCloseTo(geometry.pipeBottom, 1)
        expect(geometry.endX).toBeCloseTo(geometry.iconX, 1)
        expect(geometry.endY).toBeCloseTo(geometry.iconTop, 1)
      }

    }
    await expect(first.locator('[data-entity-id="original-nic"]')).toContainText('10.10.1.4')
    await expect(first.locator('[data-entity-id="original-nic"]')).not.toContainText('10.10.2.4')
    if (mode !== 'vwan') {
      await expect(first.locator('[data-original-entity="appliance:original-nva"]')).toHaveCount(1)
      await expect(first.locator('[data-original-entity="application:service"]')).toHaveCount(1)
      await expect(dialog.locator('[data-subnet-id] [data-entity-id="original-gateway"]')).toHaveCount(0)
      await expect(dialog.getByRole('region', { name: 'Network-level associations' }).locator('[data-original-entity="gateway:original-gateway"]')).toHaveCount(1)
    }
    await first.getByRole('button', { name: 'Subnet: Application subnet 10.10.1.0/24', exact: true }).scrollIntoViewIfNeeded()
    await info.attach('attachment-branches', { body: await dialog.screenshot({ path: info.outputPath('branches.png') }), contentType: 'image/png' })
    await dialog.getByLabel('Search subnets', { exact: true }).fill('Data subnet')
    await originals.locator('[data-original-entity="nat:original-nat"]').getByRole('button', { name: 'NAT Gateway: Original shared NAT', exact: true }).click({ button: 'right' })
    await dialog.getByRole('menuitem', { name: 'Internet egress', exact: true }).click()
    await expect(first.locator('.nat-gateway-editor > summary')).toBeFocused()
    const reference = first.locator('[data-attachment-reference="nic:original-nic"]')
    await reference.getByRole('button', { name: 'Attachment reference → original entity', exact: true }).click()
    const original = originals.locator('[data-original-entity="nic:original-nic"]')
    const target = original.getByRole('button', { name: 'NIC: Original NIC', exact: true })
    await expect(target).toBeFocused()
    await original.getByRole('button', { name: 'Subnet: Data subnet · second', exact: true }).click()
    await expect(second.getByRole('button', { name: 'Subnet: Data subnet 10.10.2.0/24', exact: true })).toBeFocused()
    await second.locator('.detail-subnet-content > summary').click()
    await expect(second.getByRole('button', { name: 'NIC: Original NIC', exact: true })).not.toBeVisible()
    await original.getByRole('button', { name: 'Subnet: Data subnet · second', exact: true }).click()
    await expect(second.getByRole('button', { name: 'NIC: Original NIC', exact: true })).toBeVisible()
    expect(await read()).toEqual(before)
    await target.focus()
    await page.keyboard.press('Shift+F10')
    await dialog.getByRole('menuitem', { name: 'Edit workload: Original workload', exact: true }).click()
    const form = dialog.getByTestId('selected-workload-form')
    await expect(form.getByLabel('Workload name', { exact: true })).toBeFocused()
    await form.getByLabel('Workload name', { exact: true }).fill('Edited original')
    await form.getByRole('button', { name: 'Save workload', exact: true }).click()
    await expect(original).toContainText('Edited original')
    await expect(reference).toContainText('Edited original')
    await target.click({ button: 'right' })
    await expect(dialog.getByRole('menuitem', { name: 'Edit workload: Edited original', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(target).toBeFocused()
    expect((await new AxeBuilder({ page }).include('[data-testid="network-detail-dialog"]').analyze()).violations).toEqual([])
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await info.attach('subnet-device-diagram', { body: await dialog.screenshot({ path: info.outputPath('diagram.png') }), contentType: 'image/png' })
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
    await page.getByRole('button', { name: /^(↶ )?Undo$/ }).click()
    expect(await read()).toEqual(before)
    await page.getByRole('button', { name: /^(↷ )?Redo$/ }).click()
    await opener.click()
    await expect(dialog.getByTestId('selected-workload-form').getByLabel('Workload name', { exact: true })).toHaveValue('Edited original')
    const expected = structuredClone(before)
    expected.inventory.workloads[0].name = 'Edited original'
    expect(await read()).toEqual(expected)
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
  })

  test(`preview ${mode}: large attachment graph search, collapse and context focus`, async ({ page }) => {
    const { dialog, opener, read } = await openDiagram(page, mode, 145)
    const before = await read(), first = dialog.locator('[data-subnet-id="first"]')
    await expect(first.getByTestId('detail-device')).toHaveCount(12)
    await first.getByRole('button', { name: 'Next attachments', exact: true }).click()
    await expect(first.locator('[data-entity-id="original-nic"]')).toHaveCount(0)
    await first.getByLabel('Search attached entities', { exact: true }).fill('vm-144')
    await expect(first.getByTestId('detail-device')).toHaveCount(1)
    await expect(first.locator('[data-attachment-edge="nic:nic-144"]')).toHaveCount(1)
    await first.getByRole('button', { name: 'Attachment reference → original entity', exact: true }).click()
    const shared = dialog.getByRole('region', { name: 'Shared original entities', exact: true })
    const original = shared.locator('[data-original-entity="nic:nic-144"]')
    await expect(original.getByRole('button', { name: 'NIC: Inventory NIC 144', exact: true })).toBeFocused()
    await original.getByRole('button', { name: 'Subnet: Application subnet · first', exact: true }).click()
    await expect(first.getByRole('button', { name: 'Subnet: Application subnet 10.10.1.0/24', exact: true })).toBeFocused()
    const target = first.getByRole('button', { name: 'NIC: Inventory NIC 144', exact: true })
    await target.focus()
    await page.keyboard.press('ContextMenu')
    await dialog.getByRole('menuitem', { name: 'NIC NSG', exact: true }).click()
    await expect(dialog.getByTestId('nsg-editor-nic-nic-144').locator('summary').first()).toBeFocused()
    await first.locator('.detail-subnet-content > summary').click()
    await expect(target).not.toBeVisible()
    await first.locator('.detail-subnet-content > summary').click()
    await expect(target).toBeVisible()
    expect(await read()).toEqual(before)
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
    await opener.click()
    await expect(first.getByTestId('detail-device')).toHaveCount(12)
    await expect(first.getByRole('button', { name: 'Previous attachments', exact: true })).toBeDisabled()
  })
}
