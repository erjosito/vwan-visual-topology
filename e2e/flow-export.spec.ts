import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { hubFirewallTopology, azHubFirewallTopology } from '../tests/fixtures/hub-firewall'

for (const mode of ['vwan', 'full'] as const) {
  test(`${mode}: exports a short GIF and an inspected SVG from the selected independent flow`, async ({ page }) => {
    test.setTimeout(45000)
    await page.addInitScript(({ mode, topology }) => {
      localStorage.setItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1',
        JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }))
    }, { mode, topology: mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology() })
    await page.goto(`/?mode=${mode}`)
    if (mode === 'vwan') {
      await page.getByLabel('Select spoke trusted-a', { exact: true }).focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
      await page.getByLabel('Destination node', { exact: true }).selectOption('site:branch-a')
      await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
    } else {
      await page.getByTestId('aznet-subnet-sub-trusted-a').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
      await page.getByTestId('aznet-trace-dest-select').selectOption('site:branch-a:10.50.0.0/16')
      await page.getByTestId('aznet-run-trace-btn').click()
    }
    await expect(page.getByRole('button', { name: 'Export flow diagram', exact: true })).toBeVisible()
    await page.getByLabel('Loop duration', { exact: true }).selectOption('1500')
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export flow diagram', exact: true }).click()
    const downloaded = await pending
    const bytes = await readFile((await downloaded.path())!)
    expect(downloaded.suggestedFilename()).toBe('flow-selected-flow.gif')
    expect(bytes.subarray(0, 6).toString()).toBe('GIF89a')
    await expect(page.getByRole('status').filter({ hasText: 'Flow exported.' })).toBeVisible()

    if (mode === 'vwan') {
      await page.getByLabel('Destination node', { exact: true }).selectOption('spoke:untrusted-a')
      await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
    } else {
      await page.getByTestId('aznet-trace-dest-select').selectOption('subnet:untrusted-a:sub-untrusted-a')
    }
    await page.getByLabel('Flow export format', { exact: true }).selectOption('svg')
    const second = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export flow diagram', exact: true }).click()
    const svg = await readFile((await (await second).path())!, 'utf8')
    expect(svg.match(/data-kind="firewall"/g)).toHaveLength(2)
    expect(svg).toContain('animateMotion')
    expect(svg).toContain('Illustrative routing only.')

    await page.getByLabel('Flow export format', { exact: true }).selectOption('png')
    await expect(page.getByLabel('Loop duration', { exact: true })).toBeDisabled()
    const still = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export flow diagram', exact: true }).click()
    const png = await readFile((await (await still).path())!)
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    await page.getByLabel('Flow export format', { exact: true }).selectOption('gif')
    await page.getByRole('button', { name: 'Export flow diagram', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel export', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Export cancelled.' })).toBeVisible()
  })
}
