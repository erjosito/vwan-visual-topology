import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const storageKey = 'vwan-feedback-draft:v1'
async function setup(page: Page, signedIn = true, available = true) {
  await page.route('**/api/feedback/status', (route) => route.fulfill({ json: { available } }))
  await page.route('**/.auth/me', (route) => route.fulfill({ json: { clientPrincipal: signedIn
    ? { identityProvider: 'github', userDetails: 'feedback-test', userRoles: ['anonymous', 'authenticated'] } : null } }))
}
async function fill(page: Page) {
  await page.getByLabel('Summary', { exact: true }).fill('Improve route table display')
  await page.getByLabel('Description', { exact: true }).fill('A sufficiently detailed controlled report without any network information.')
  await page.getByLabel('I agree to send').check()
}
test('feedback makes no startup requests and keeps drafts without changing the topology', async ({ page }) => {
  let optionalCalls = 0
  await setup(page)
  page.on('request', (request) => { if (request.url().includes('/api/') || request.url().includes('/.auth/')) optionalCalls++ })
  await page.goto('/')
  const topology = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeVisible()
  expect(optionalCalls).toBe(0)
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await fill(page)
  await expect(page.getByRole('button', { name: 'Send feedback', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Improve route table display')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(topology)
  await page.getByRole('button', { name: 'Discard draft' }).click()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull()
})
test('feedback-only sign-in preserves the draft and restores the dialog after its fixed callback', async ({ page }) => {
  await setup(page, false)
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await fill(page)
  const topology = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  let authUrl = ''
  await page.route('**/.auth/login/github?*', async (route) => {
    authUrl = route.request().url()
    await route.fulfill({ status: 302, headers: { Location: '/?feedback=1' } })
  })
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click()
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Improve route table display')
  await expect(page.getByRole('dialog', { name: 'Send feedback', exact: true })).toBeVisible()
  expect(new URL(authUrl).searchParams.get('post_login_redirect_uri')).toBe('/?feedback=1')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(topology)
})
test('submission sends only reviewed feedback, confirms a receipt and clears the draft', async ({ page }) => {
  await setup(page)
  const bodies: Record<string, string>[] = []
  await page.route('**/api/feedback', async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    await route.fulfill({ status: 201, json: { reference: `FB-${body.requestId}` } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await fill(page)
  await page.getByText('Review what will be sent', { exact: true }).click()
  await expect(page.getByRole('definition').filter({ hasText: 'feedback-test' })).toBeVisible()
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Feedback received.')
  expect(bodies).toHaveLength(1)
  expect(Object.keys(bodies[0]).sort()).toEqual(['category', 'title', 'description', 'contact', 'requestId', 'appRevision'].sort())
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull()
  await expect(page.locator('a[href*="github.com"][href*="/issues"]')).toHaveCount(0)
})
test('unavailable feedback and uncertain submission never damage or discard the draft', async ({ page }) => {
  await setup(page, true, false)
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await fill(page)
  await expect(page.getByRole('status')).toContainText('temporarily unavailable')
  await expect(page.getByRole('button', { name: 'Send feedback', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close feedback' }).click()
  await setup(page)
  let submissions = 0
  await page.route('**/api/feedback', (route) => { submissions++; return route.fulfill({ status: 503, json: { error: 'private upstream error' } }) })
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  await page.getByLabel('I agree to send').check()
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Receipt could not be confirmed')
  await expect(page.getByRole('alert')).not.toContainText('private upstream error')
  expect(submissions).toBe(1)
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Improve route table display')
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).not.toBeNull()
})
test('feedback dialog fits mobile and retains keyboard dismissal', async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Feedback', exact: true }).click()
  const box = await page.getByRole('dialog', { name: 'Send feedback', exact: true }).boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
