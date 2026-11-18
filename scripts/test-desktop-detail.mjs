import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const executablePath = process.env.DESKTOP_EXECUTABLE
const flavor = executablePath ? 'packaged' : 'development'
const artifacts = resolve('test-artifacts', 'desktop', `${flavor}-detail-${randomUUID()}`)
await mkdir(artifacts, { recursive: true })
const fixture = join(artifacts, 'network-detail.cjs')
await build({ entryPoints: [resolve('tests', 'fixtures', 'network-detail.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: fixture })
const { graphicalDetailTopology } = createRequire(import.meta.url)(fixture)
const application = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('platform-dist', 'electron', 'main.cjs')]), `--user-data-dir=${join(artifacts, 'profile')}`],
})
const results = []
try {
  const page = await application.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.evaluate(({ mode, topology }) => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1',
        JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }))
    }, { mode, topology: graphicalDetailTopology(mode, 145) })
    await page.reload()
    const node = page.locator(mode === 'vwan' ? '.spoke-node[data-node-id="detail-network"]' : '[data-testid="aznet-select-vnet-detail-network"]')
    await node.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
    const detail = page.getByTestId('network-detail-dialog'), first = detail.locator('[data-subnet-id="first"]')
    const read = () => page.evaluate((mode) => {
      const saved = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'))
      return saved.topology ?? saved
    }, mode)
    const before = await read()
    await expect(first.getByTestId('detail-device')).toHaveCount(12)
    await expect(first.locator('[data-attachment-edge="nic:original-nic"]')).toHaveCount(1)
    await first.locator('[data-attachment-reference="nic:original-nic"]').getByRole('button', { name: 'Attachment reference → original entity', exact: true }).click()
    const original = detail.locator('[data-original-entity="nic:original-nic"]')
    const target = original.getByRole('button', { name: 'NIC: Original NIC', exact: true })
    await expect(target).toBeFocused()
    await page.keyboard.press('ContextMenu')
    await detail.getByRole('menuitem', { name: 'Edit workload: Original workload', exact: true }).click()
    const form = detail.getByTestId('selected-workload-form')
    await expect(form.getByLabel('Workload name', { exact: true })).toBeFocused()
    await form.getByLabel('Workload name', { exact: true }).fill('Edited desktop original')
    await form.getByRole('button', { name: 'Save workload', exact: true }).click()
    await expect(original).toContainText('Edited desktop original')
    await first.getByLabel('Search attached entities', { exact: true }).fill('vm-144')
    await expect(first.getByTestId('detail-device')).toHaveCount(1)
    await first.locator('.detail-subnet-content > summary').click()
    await expect(first.getByRole('button', { name: 'NIC: Inventory NIC 144', exact: true })).not.toBeVisible()
    await first.locator('.detail-subnet-content > summary').click()
    await detail.screenshot({ path: join(artifacts, `${mode}.png`) })
    await page.keyboard.press('Escape')
    await expect(node).toBeFocused()
    await page.getByRole('button', { name: /^(↶ )?Undo$/ }).click()
    expect(await read()).toEqual(before)
    await page.getByRole('button', { name: /^(↷ )?Redo$/ }).click()
    await node.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
    await expect(form.getByLabel('Workload name', { exact: true })).toHaveValue('Edited desktop original')
    await expect(first.getByTestId('detail-device')).toHaveCount(12)
    const expected = structuredClone(before)
    expected.inventory.workloads[0].name = 'Edited desktop original'
    expect(await read()).toEqual(expected)
    await page.keyboard.press('Escape')
    results.push({ mode, preview: true, attachments: 145, originalIdentity: true, editUndoRedo: true, keyboardFocus: true })
  }
  expect(errors).toEqual([])
  await writeFile(join(artifacts, 'results.json'), `${JSON.stringify({ flavor, results, errors }, null, 2)}\n`)
  console.log(JSON.stringify({ artifacts, flavor, results }))
} finally {
  await application.close()
}
