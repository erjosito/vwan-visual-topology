import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { guidedProgressKey, legacyProgressKey } from '../src/learning/progress-ledger'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { scenarioBundle } from '../src/learning/scenario-course'
import { orderedTasks } from '../src/learning/runner'
import { completeLearningTasks, learningSidebar, loadLearningNetwork } from './learning-helpers'

const status = (page: Page) => page.getByTestId('learning-status')
const details = (page: Page) => page.getByTestId('learning-status-details')
const saved = (page: Page, key: string) => page.evaluate((key) => localStorage.getItem(key), key)
async function open(page: Page) {
  await page.goto('/?mode=full')
  await page.getByTestId('learning-open').click()
  await expect(learningSidebar(page)).toBeVisible()
}
async function backup(page: Page, legacy = false) {
  const downloaded = page.waitForEvent('download')
  await details(page).getByRole('button', { name: legacy ? 'Download previous practice backup' : 'Download learning backup', exact: true }).click()
  return readFile((await (await downloaded).path())!, 'utf8')
}

for (const language of ['en', 'ja'] as const) {
  test(`${language}: track overview is informational and planned tracks cannot create progress or practice`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    if (language === 'ja') await page.addInitScript(() => localStorage.setItem('aznet-theme', 'dark'))
    await page.goto('/?mode=full')
    await page.locator('header [data-language-selector]').selectOption(language)
    const name = language === 'en' ? 'Routing foundations' : 'ルーティングの基礎'
    const plannedName = language === 'en' ? 'Planned tracks' : '計画中のトラック'
    const plannedStatus = language === 'en' ? 'Planned' : '計画中'
    const titles = language === 'en' ? ['DNS and name resolution', 'Application delivery'] : ['DNS と名前解決', 'アプリケーション配信']
    await expect(status(page)).toContainText(name)
    const before = await page.evaluate(({ guided, practice }) => [
      localStorage.getItem(guided), localStorage.getItem(practice), localStorage.getItem('aznet-visual-topology:v1'),
    ], { guided: guidedProgressKey, practice: practiceWorkspaceKey })
    await status(page).click()
    await expect(details(page)).toContainText(`${name} · ${language === 'en' ? 'Scenario edition - White belt · 0 points' : 'シナリオ版 - 白帯 · 0 ポイント'}`)
    const statusOverview = details(page).getByTestId('learning-tracks')
    await statusOverview.locator('summary').focus()
    await page.keyboard.press('Enter')
    const planned = statusOverview.getByRole('region', { name: plannedName, exact: true })
    for (const title of titles) {
      const entry = planned.getByRole('listitem').filter({ hasText: title })
      await expect(entry).toContainText(`${title} - ${plannedStatus}`)
      await entry.getByText(title, { exact: true }).click()
    }
    await expect(planned.locator('button,a,input,select')).toHaveCount(0)
    expect((await new AxeBuilder({ page }).include('.learning-status-panel').analyze()).violations).toEqual([])
    expect(await details(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await details(page).getByRole('button', { name: language === 'en' ? 'Close learning status' : '学習状態を閉じる', exact: true }).click()
    await page.getByTestId('learning-open').click()
    const panel = learningSidebar(page)
    await expect(panel.getByTestId('learning-active-track')).toContainText(name)
    await expect(panel.getByTestId('learning-completion-count')).toHaveText(`0 / ${orderedTasks(scenarioBundle).length} ${language === 'en' ? 'Completed' : '完了'}`)
    const overview = panel.getByTestId('learning-tracks')
    await overview.locator('summary').focus()
    await page.keyboard.press('Enter')
    const plannedInSidebar = overview.getByRole('region', { name: plannedName, exact: true })
    for (const title of titles) await expect(plannedInSidebar.getByText(title, { exact: true })).toBeVisible()
    await expect(plannedInSidebar.locator('button,a,input,select')).toHaveCount(0)
    expect((await new AxeBuilder({ page }).include('.learning-tracks').analyze()).violations).toEqual([])
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(({ guided, practice }) => [
      localStorage.getItem(guided), localStorage.getItem(practice), localStorage.getItem('aznet-visual-topology:v1'),
    ], { guided: guidedProgressKey, practice: practiceWorkspaceKey })).toEqual(before)
    await expect(page.getByTestId('practice-workspace-bar')).toHaveCount(0)
  })
}

for (const unavailable of [false, true]) {
  test(`concept bodies load only on explicit expansion, with local failure feedback: ${unavailable}`, async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => { if (request.url().includes('concept-bodies')) requests.push(request.url()) })
    if (unavailable) await page.route('**/concept-bodies*', (route) => route.abort())
    await open(page)
    await learningSidebar(page).getByText('Networking reference', { exact: true }).click()
    expect(requests).toEqual([])
    const concept = learningSidebar(page).locator('[data-concept="selection"]')
    await concept.locator('summary').click()
    await expect(concept).toContainText(unavailable ? 'Explanation could not load' : 'A forwarding lookup first finds the most specific')
    expect(requests.length).toBeGreaterThan(0)
    await expect(page.getByTestId('aznet-app')).toBeVisible()
  })
}

test('first-earned points, checkpoint gap and linear position survive reload and replay without farming', async ({ page }) => {
  test.setTimeout(60_000)
  await open(page); await loadLearningNetwork(page); await completeLearningTasks(page, 2)
  await expect(status(page)).toContainText('Not signed in')
  await expect(status(page)).toContainText('White belt · 10 points')
  await status(page).click()
  await expect(details(page)).toContainText('Yellow belt · 90 points remaining')
  await expect(details(page)).toContainText('Required mastery checkpoints remaining: 1')
  await details(page).getByRole('button', { name: 'Close learning status', exact: true }).click()
  await page.reload()
  await expect(status(page)).toContainText('Scenario edition - White belt')
  await expect(status(page)).toContainText('10 points')
  await page.getByTestId('learning-open').click()
  await expect(learningSidebar(page).getByTestId('learning-active-track')).toContainText('Routing foundations')
  await expect(learningSidebar(page).getByRole('heading', { name: 'Meet the network requirements', exact: true })).toBeVisible()
  await completeLearningTasks(page)
  await expect(status(page)).toContainText('75 points')
  const ledger = await saved(page, guidedProgressKey)
  await learningSidebar(page).getByRole('button', { name: 'Replay this lesson', exact: true }).click()
  await learningSidebar(page).getByRole('button', { name: 'Start lesson replay', exact: true }).click()
  await completeLearningTasks(page, 3)
  await expect(status(page)).toContainText('75 points')
  expect(await saved(page, guidedProgressKey)).toBe(ledger)
  await page.reload()
  await expect(status(page)).toContainText('75 points')
})

test('quota-failed points are explicitly session-only, can be saved later, and scoped reset preserves legacy and canvases', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(({ guided, legacy }) => {
    Reflect.set(window, 'learningQuota', true)
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === guided && Reflect.get(window, 'learningQuota')) throw new DOMException('Full', 'QuotaExceededError')
      return write.call(this, key, value)
    }
    if (!localStorage.getItem(legacy)) localStorage.setItem(legacy, 'unchanged previous practice bytes')
  }, { guided: guidedProgressKey, legacy: legacyProgressKey })
  await open(page); await loadLearningNetwork(page); await completeLearningTasks(page)
  await expect(status(page)).toContainText('5 points · Session only')
  expect(await saved(page, guidedProgressKey)).toBeNull()
  await status(page).click()
  await expect(details(page).getByRole('status')).toContainText('progress could not be saved')
  expect(JSON.parse(await backup(page)).completions).toHaveLength(1)
  expect(await backup(page, true)).toBe('unchanged previous practice bytes')
  await page.evaluate(() => Reflect.set(window, 'learningQuota', false))
  await details(page).getByRole('button', { name: 'Retry saving progress', exact: true }).click()
  await expect(details(page).getByRole('status')).toHaveText('Saved locally')
  const practice = await saved(page, practiceWorkspaceKey)
  const normal = await saved(page, 'aznet-visual-topology:v1')
  await details(page).getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
  await details(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(status(page)).toContainText('5 points')
  await details(page).getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
  await details(page).getByRole('button', { name: 'Delete guided history & points', exact: true }).click()
  await expect(status(page)).toContainText('White belt · 0 points')
  expect(await saved(page, guidedProgressKey)).toBeNull()
  expect(await saved(page, practiceWorkspaceKey)).toBe(practice)
  expect(await saved(page, 'aznet-visual-topology:v1')).toBe(normal)
  expect(await saved(page, legacyProgressKey)).toBe('unchanged previous practice bytes')
  await details(page).getByRole('button', { name: 'Close learning status', exact: true }).click()
  await expect(learningSidebar(page).getByRole('heading', { name: 'Open this scenario', exact: true })).toBeVisible()
})

test('damaged guided data is not zero credit, cannot be overwritten by completion, and has an original-byte backup', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'damaged guided original'), guidedProgressKey)
  await open(page)
  await expect(status(page)).toContainText('Learning progress unavailable')
  await loadLearningNetwork(page)
  await learningSidebar(page).getByRole('button', { name: 'Check task', exact: true }).click()
  await learningSidebar(page).getByRole('button', { name: 'Complete task & continue', exact: true }).click()
  await expect(learningSidebar(page).getByTestId('learning-feedback')).toContainText('Completion could not be recorded')
  expect(await saved(page, guidedProgressKey)).toBe('damaged guided original')
  await status(page).click()
  await expect(details(page)).toContainText('original is preserved')
  await expect(details(page)).toContainText('Original edition: Learning progress unavailable')
  expect(await backup(page)).toBe('damaged guided original')
  await details(page).getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
  await details(page).getByRole('button', { name: 'Delete guided history & points', exact: true }).click()
  await expect(status(page)).toContainText('0 points')
})

test('actual competing tabs cannot write practice or farm points, and recover the latest canvas after the owner closes', async ({ page, context }) => {
  test.setTimeout(90_000)
  await open(page); await loadLearningNetwork(page); await completeLearningTasks(page, 2)
  const other = await context.newPage()
  try {
    await other.goto('/')
    await expect(status(other)).toContainText('10 points')
    const bar = other.getByTestId('practice-workspace-bar')
    await expect(bar.getByRole('alert')).toContainText('Another tab owns practice')
    await expect(bar.getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible()
    await other.getByTestId('learning-open').click()
    await learningSidebar(other).getByRole('button', { name: 'Check task', exact: true }).click()
    await expect(learningSidebar(other).getByTestId('learning-feedback')).toContainText('protected practice canvas first')
    await learningSidebar(other).getByRole('button', { name: 'Load practice network', exact: true }).click()
    await learningSidebar(other).getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
    await expect(learningSidebar(other).getByRole('alert')).toContainText('Another tab owns practice')
    const unchanged = await saved(page, practiceWorkspaceKey)
    await completeLearningTasks(page, 2)
    await expect(status(other)).toContainText('80 points')
    const latest = await saved(page, practiceWorkspaceKey)
    expect(latest).not.toBe(unchanged)
    await page.close()
    await expect.poll(async () => (await other.evaluate(() => navigator.locks.query())).held.length).toBe(0)
    await bar.getByRole('button', { name: 'Resume practice', exact: true }).click()
    await expect(bar).toContainText('your normal design is kept separately')
    expect(JSON.parse((await saved(other, practiceWorkspaceKey))!).document).toEqual(JSON.parse(latest!).document)
    await completeLearningTasks(other)
    await expect(status(other)).toContainText('100 points')
    expect(JSON.parse((await saved(other, guidedProgressKey))!).completions).toHaveLength(5)
  } finally { await other.close() }
})

test('missing exclusive locking fails closed without persisting or opening a practice canvas', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }))
  await open(page)
  await learningSidebar(page).getByRole('button', { name: 'Load practice network', exact: true }).click()
  await learningSidebar(page).getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
  await expect(learningSidebar(page).getByRole('alert')).toContainText('exclusive local storage access is unavailable')
  expect(await saved(page, practiceWorkspaceKey)).toBeNull()
  expect(await saved(page, guidedProgressKey)).toBeNull()
})

test('reset refuses a record changed after confirmation instead of deleting the newer saved bytes', async ({ page, context }) => {
  await open(page); await loadLearningNetwork(page); await completeLearningTasks(page)
  await status(page).click()
  await details(page).getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
  const other = await context.newPage()
  try {
    await other.goto('/')
    await other.evaluate((key) => localStorage.setItem(key, 'unexpected external record'), guidedProgressKey)
    await expect(details(page).getByRole('status')).toContainText('Saved progress changed elsewhere')
    await details(page).getByRole('button', { name: 'Delete guided history & points', exact: true }).click()
    await expect(details(page).getByRole('alert')).toContainText('Nothing is reported as saved or reset')
    expect(await saved(page, guidedProgressKey)).toBe('unexpected external record')
  } finally { await other.close() }
})

test('Japanese dark narrow status is keyboard accessible and identifies the belt without relying on color', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('aznet-theme', 'dark'))
  await page.goto('/?mode=vwan')
  await page.locator('header [data-language-selector]').selectOption('ja')
  await expect(status(page)).toContainText('未サインイン')
  await expect(status(page)).toContainText('白帯')
  await status(page).click()
  const bounds = (await details(page).boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect((await new AxeBuilder({ page }).include('.learning-status-panel').analyze()).violations).toEqual([])
  await details(page).getByRole('button', { name: '学習状態を閉じる', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(details(page)).toHaveCount(0)
  await expect(status(page)).toBeFocused()
})
