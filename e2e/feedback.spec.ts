import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const storageKey = 'vwan-feedback-draft:v1'
const publicFeedbackRepoUrl = 'https://github.com/erjosito/vwan-visual-topology-feedback'

async function fill(page: Page) {
  await page.getByLabel('Summary', { exact: true }).fill('Improve route table display')
  await page.getByLabel('Description', { exact: true }).fill('A sufficiently detailed controlled report without any network information.')
  await page.getByLabel('I agree to open this report in the public GitHub feedback repository without confidential data.').check()
}
test('feedback makes no startup or dialog network requests and keeps drafts without changing the topology', async ({ page }) => {
  let optionalCalls = 0
  page.on('request', (request) => { if (request.url().includes('/api/') || request.url().includes('/.auth/')) optionalCalls++ })
  await page.goto('/')
  const topology = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeVisible()
  expect(optionalCalls).toBe(0)
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  expect(optionalCalls).toBe(0)
  await fill(page)
  await expect(page.getByRole('button', { name: 'Open issue on GitHub', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Improve route table display')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(topology)
  await page.getByRole('button', { name: 'Discard draft' }).click()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull()
})
test('submission prepares a pre-filled public GitHub issue URL without OAuth consent and clears the draft', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __openedUrls: string[] }).__openedUrls = []
    window.open = ((url?: string | URL) => {
      (window as unknown as { __openedUrls: string[] }).__openedUrls.push(String(url ?? ''))
      return null
    }) as typeof window.open
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await page.getByLabel('Category').selectOption('feature')
  await fill(page)
  await page.getByText('Review what will be sent', { exact: true }).click()
  await expect(page.getByRole('definition').filter({ hasText: 'erjosito/vwan-visual-topology-feedback' })).toBeVisible()
  await page.getByRole('button', { name: 'Open issue on GitHub', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Feedback prepared for GitHub. Reference:')
  const openedUrls = await page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls)
  expect(openedUrls).toHaveLength(1)
  const parsed = new URL(openedUrls[0])
  expect(`${parsed.origin}${parsed.pathname}`).toBe(`${publicFeedbackRepoUrl}/issues/new`)
  expect(parsed.searchParams.get('labels')).toBe('feedback,enhancement')
  expect(parsed.searchParams.get('title')).toBe('[Feature request] Improve route table display')
  expect(parsed.searchParams.get('body')).toContain('A sufficiently detailed controlled report without any network information.')
  expect(parsed.searchParams.get('body')).toContain('Report reference:')
  await expect(page.getByRole('link', { name: 'Continue to GitHub issue form', exact: true })).toHaveAttribute('href', openedUrls[0])
  await expect(page.getByRole('link', { name: 'Browse public feedback', exact: true })).toHaveAttribute('href', `${publicFeedbackRepoUrl}/issues`)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull()
})
test('oversized feedback preserves the draft and displays an actionable alert', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await page.getByLabel('Summary', { exact: true }).fill('Oversized feedback check')
  await page.getByLabel('Description', { exact: true }).fill('日本語'.repeat(1200))
  await page.getByLabel('I agree to open this report in the public GitHub feedback repository without confidential data.').check()
  await page.getByRole('button', { name: 'Open issue on GitHub', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Feedback is too long for a pre-filled GitHub issue URL.')
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Oversized feedback check')
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).not.toBeNull()
})
test('feedback dialog fits mobile and retains keyboard dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  const box = await page.getByRole('dialog', { name: 'Send feedback', exact: true }).boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
