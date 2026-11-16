import { expect, test, type Page } from '@playwright/test'
import { hubFirewallTopology, azHubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { translate } from '../src/messages'

async function saved(page: Page, mode: string) {
  return page.evaluate((mode) => {
    const value = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1')!)
    return mode === 'vwan' ? value : value.topology
  }, mode)
}

for (const mode of ['vwan', 'hub-spoke', 'full']) for (const language of ['en', 'ja'] as const) {
  test(`${mode} ${language}: clear is explicit, safely focused and preserves unrelated local data`, async ({ page }) => {
    const text = (value: string) => translate(language, value)
    await page.addInitScript((language) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-simulator:practice:v1', '{"version":1,"entries":[]}')
      localStorage.setItem('unrelated-workspace-test', 'keep')
    }, language)
    await page.setViewportSize(language === 'ja' ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    await page.goto(`/?mode=${mode}`)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'synthetic-hub.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology())),
    })
    await expect.poll(async () => (await saved(page, mode))?.name).toContain('Selective Firewall')
    const original = await saved(page, mode)
    const trigger = mode === 'vwan' ? page.getByRole('button', { name: text('Clear topology'), exact: true }) : page.getByTestId('aznet-clear-topology-btn')
    const dialog = page.getByRole('dialog', { name: text('Clear topology'), exact: true })
    for (const method of ['cancel', 'escape', 'close']) {
      await trigger.click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: text('Cancel clearing'), exact: true })).toBeFocused()
      expect(await saved(page, mode)).toEqual(original)
      if (method === 'escape') await page.keyboard.press('Escape')
      else if (method === 'cancel') await page.keyboard.press('Enter')
      else await dialog.getByRole('button', { name: translate(language, 'Close {0}', text('Clear topology')), exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
      expect(await saved(page, mode)).toEqual(original)
    }
    await trigger.click()
    await dialog.getByRole('button', { name: text('Clear all objects'), exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    const empty = await saved(page, mode)
    expect(mode === 'vwan' ? empty.hubs : empty.vwanHubs).toHaveLength(0)
    expect(mode === 'vwan' ? empty.spokes : empty.vnets).toHaveLength(0)
    expect(empty.sites).toHaveLength(0)
    expect(await page.evaluate(() => [localStorage.getItem('aznet-simulator:practice:v1'), localStorage.getItem('unrelated-workspace-test')])).toEqual(['{"version":1,"entries":[]}', 'keep'])
    await page.reload()
    await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    expect(await saved(page, mode)).toEqual(empty)
  })
}
