import { expect, test, type Page } from '@playwright/test'
import { cloudFixture, testOwner } from '../tests/user-cloud-fixture'
import { guidedProgressKey } from '../src/learning/progress-ledger'
import { exampleCourse } from '../src/learning/course-examples'
import { orderedTasks } from '../src/learning/runner'
import { completeLearningTasks, loadLearningNetwork } from './learning-helpers'

async function setup(page: Page) {
  const service = cloudFixture([new URL(test.info().project.use.baseURL as string).origin])
  await page.route('**/src/cloud/configuration.ts*', route => route.fulfill({
    contentType: 'application/javascript', body: `export const readCloudConfiguration = () => window.desktopSimulator ? undefined : ({
      clientId:'11111111-1111-4111-8111-111111111111',
      scope:'api://22222222-2222-4222-8222-222222222222/Cloud.Access',
      base:new URL('/api/cloud',location.origin).href
    });`,
  }))
  await page.route('**/src/cloud/microsoft.ts*', route => route.fulfill({
    contentType: 'application/javascript', body: `export async function createMicrosoftClient() {
      let user;
      const account = () => ({id:user,name:user==='bob'?'Test Bob':'Test Alice'});
      return {
        restore:()=>{user=sessionStorage.getItem('mock-cloud-user')||'alice';return account()},
        signIn:async()=>{user=sessionStorage.getItem('mock-cloud-user')||'alice';return account()},
        signOut:async()=>{user=undefined},
        token:async()=>user
      };
    }`,
  }))
  await page.route('**/api/cloud/**', async route => {
    const request = route.request()
    const result = await service.request(request.url(), {
      method: request.method(), headers: request.headers(), body: request.postData() ?? undefined,
    })
    await route.fulfill({ status: result.status ?? 200, headers: { ...result.headers as Record<string, string>, 'content-type': 'application/json' },
      body: result.jsonBody === undefined ? '' : JSON.stringify(result.jsonBody) })
  })
  page.on('dialog', dialog => { void dialog.accept() })
  return service
}
async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
  await expect(page.getByRole('button', { name: 'Refresh cloud topologies', exact: true })).toBeEnabled()
}

test.describe('new UI account and belt summary', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test('shows highest local belt independently of enrollment and updates on account changes', async ({ page }) => {
    await setup(page)
    const raw = JSON.stringify({ version: 1, policyVersion: 1, enrollment: 'azure-routing-scenarios',
      completions: orderedTasks(exampleCourse).map(({ task, lesson }) => ({
        courseId: exampleCourse.course.id, contentVersion: exampleCourse.course.contentVersion,
        lessonId: lesson.id, taskId: task.id, assessmentVersion: task.assessmentVersion,
        checkId: task.checkId, awardId: task.awardId, points: task.points, title: task.title,
        sessionId: 'original-local', revision: 1, scope: 1, engineVersion: 'test', completedAt: '2026-11-17T12:00:00Z',
      })) })
    await page.addInitScript(({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw)
    }, { key: guidedProgressKey, raw })
    await page.goto('/?mode=full')
    const status = page.getByTestId('learning-status')
    await expect(status).toContainText('Not signed in')
    await expect(status).toContainText('Black belt')
    await expect(status).not.toContainText('x2')
    await signIn(page)
    await expect(status).toContainText('Test Alice')
    await expect(status).toContainText('White belt')
    await page.getByRole('button', { name: 'Sign out of this app', exact: true }).click()
    await expect(status).toContainText('Not signed in')
    await expect(status).toContainText('Black belt')
    await page.getByRole('button', { name: 'Close cloud account', exact: true }).click()
    await status.click()
    await page.getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
    await page.getByRole('button', { name: 'Delete guided history & points', exact: true }).click()
    await expect(status).toContainText('White belt')
  })
})

test('anonymous history requires import consent; reload, switching and sign-out preserve account isolation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const service = await setup(page)
  const requests: string[] = []
  page.on('request', request => { if (/\/api\/cloud\/|\/cloud\/microsoft\.ts/.test(request.url())) requests.push(request.url()) })
  const { task, lesson } = orderedTasks(exampleCourse)[0]
  const original = JSON.stringify({ version: 1, policyVersion: 1, enrollment: exampleCourse.course.id, completions: [{
    courseId: exampleCourse.course.id, contentVersion: 2, lessonId: lesson.id, taskId: task.id,
    assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
    title: task.title, sessionId: 'original-local', revision: 1, scope: 1, engineVersion: 'test',
    completedAt: '2026-11-17T12:00:00Z',
  }] })
  await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw) }, { key: guidedProgressKey, raw: original })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('learning-status')).toContainText(`${task.points} points`)
  expect(service.data.size).toBe(0)
  expect(requests).toEqual([])
  await signIn(page)
  await expect(page.getByTestId('learning-status')).toContainText('Test Alice')
  await expect(page.getByTestId('learning-status')).toContainText('0 points')
  expect(service.data.has(`users/${testOwner('alice')}/progress.json`)).toBe(false)
  const other = await page.context().newPage()
  await other.goto('/')
  await other.evaluate(key => localStorage.removeItem(key), guidedProgressKey)
  await expect(page.getByRole('button', { name: 'Import anonymous progress', exact: true })).toHaveCount(0)
  await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: guidedProgressKey, raw: original })
  await expect(page.getByRole('button', { name: 'Import anonymous progress', exact: true })).toBeVisible()
  await other.close()
  await page.getByRole('button', { name: 'Import anonymous progress', exact: true }).click()
  await expect.poll(() => service.data.has(`users/${testOwner('alice')}/progress.json`)).toBe(true)
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
  expect(JSON.parse(service.data.get(`users/${testOwner('alice')}/progress.json`)!.raw).completions).toHaveLength(1)
  expect(await page.evaluate(key => localStorage.getItem(key), guidedProgressKey)).toBe(original)
  await page.getByRole('button', { name: 'Close cloud account', exact: true }).click()
  await page.reload()
  await expect(page.getByTestId('learning-status')).toContainText('Test Alice')
  await expect(page.getByTestId('learning-status')).toContainText(`${task.points} points`)
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
  await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
  await page.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Test Bob')
  await expect(page.getByTestId('learning-status')).toContainText('0 points')
  expect(service.data.has(`users/${testOwner('bob')}/progress.json`)).toBe(false)
  await page.getByRole('button', { name: 'Sign out of this app', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Not signed in')
  await expect(page.getByTestId('learning-status')).toContainText(`${task.points} points`)
  expect(errors).toEqual([])
})

test('switching accounts preserves session-only history when both local and cloud writes fail', async ({ page }) => {
  await setup(page)
  await page.goto('/?mode=full')
  await signIn(page)
  await page.getByRole('button', { name: 'Close cloud account', exact: true }).click()
  await page.route('**/api/cloud/progress', async route => {
    if (route.request().method() === 'PUT') await route.abort()
    else await route.fallback()
  })
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('network-simulator:learning-progress:v1:account:')) throw new DOMException('Full', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await page.getByTestId('learning-open').click()
  await loadLearningNetwork(page)
  await completeLearningTasks(page, 2)
  await expect(page.getByTestId('learning-status')).toContainText('10 points')
  await page.getByTestId('practice-workspace-bar').getByRole('button', { name: 'Return to my design', exact: true }).click()
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Not synced')
  await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
  await page.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Test Bob')
  await expect(page.getByTestId('learning-status')).toContainText('0 points')
  await expect(page.getByRole('button', { name: 'Refresh cloud topologies', exact: true })).toBeEnabled()
  await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'alice'))
  await page.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Test Alice')
  await expect(page.getByTestId('learning-status')).toContainText('10 points')
})

test('real curriculum completions, offline resets and enrollment changes synchronize automatically', async ({ page }) => {
  const service = await setup(page)
  await page.goto('/?mode=full')
  await signIn(page)
  await page.getByRole('button', { name: 'Close cloud account', exact: true }).click()
  await page.getByTestId('learning-open').click()
  await loadLearningNetwork(page)
  await completeLearningTasks(page, 2)
  const key = `users/${testOwner('alice')}/progress.json`
  await expect.poll(() => JSON.parse(service.data.get(key)?.raw ?? '{}').completions?.length).toBe(2)
  await page.getByTestId('practice-workspace-bar').getByRole('button', { name: 'Return to my design', exact: true }).click()
  const offline = async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'PUT') await route.abort()
    else await route.fallback()
  }
  await page.route('**/api/cloud/progress', offline)
  await page.getByTestId('learning-status').click()
  await page.getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
  await page.getByRole('button', { name: 'Delete guided history & points', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('0 points')
  await page.getByRole('button', { name: 'Close learning status', exact: true }).click()
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Not synced')
  expect(JSON.parse(service.data.get(key)!.raw).completions).toHaveLength(2)
  await page.unroute('**/api/cloud/progress', offline)
  await page.getByRole('button', { name: 'Refresh cloud progress', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
  expect(JSON.parse(service.data.get(key)!.raw).completions).toHaveLength(0)
  await page.getByRole('button', { name: 'Close cloud account', exact: true }).click()
  await page.getByTestId('learning-status').click()
  await page.getByRole('button', { name: 'Switch to Original edition', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect.poll(() => JSON.parse(service.data.get(key)!.raw).enrollment).toBe(exampleCourse.course.id)
  expect(await page.evaluate(key => localStorage.getItem(key), guidedProgressKey)).toBeNull()
})

test('a missing API is not an empty library and a confirmed save survives a failed list refresh', async ({ page }) => {
  const service = await setup(page)
  const unavailable = async (route: import('@playwright/test').Route) => route.fulfill({ status: 404, body: '' })
  await page.route('**/api/cloud/topologies', unavailable)
  await page.goto('/?mode=full')
  await signIn(page)
  await expect(page.getByRole('alert')).toContainText('Check the backend deployment')
  await expect(page.getByText('No saved cloud topologies.', { exact: true })).toHaveCount(0)
  const local = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await page.getByLabel('Cloud topology name', { exact: true }).fill('Confirmed save')
  await page.getByRole('button', { name: 'Save current topology to cloud', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Topology saved to your cloud library.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Confirmed save', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Check the backend deployment')
  expect([...service.data.keys()].filter(key => key.includes('/topologies/'))).toHaveLength(1)
  await page.unroute('**/api/cloud/topologies', unavailable)
  await page.getByRole('button', { name: 'Refresh cloud topologies', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close cloud account', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirmed save', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(local)
  await page.getByRole('button', { name: 'Load Confirmed save', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Cloud account', exact: true })).toHaveCount(0)
})

test('retrying a lost save acknowledgement confirms the original record without creating duplicates', async ({ page }) => {
  const service = await setup(page)
  await page.goto('/?mode=full')
  await signIn(page)
  await page.getByLabel('Cloud topology name', { exact: true }).fill('Lost acknowledgement')
  const interrupted = async (route: import('@playwright/test').Route) => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.fallback()
    await service.request(request.url(), { method: 'PUT', headers: request.headers(), body: request.postData()! })
    await route.abort()
  }
  await page.route('**/api/cloud/topologies/*', interrupted)
  await page.getByRole('button', { name: 'Save current topology to cloud', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toBeVisible()
  await expect(page.getByText('Topology saved to your cloud library.', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/cloud/topologies/*', interrupted)
  await page.getByRole('button', { name: 'Save current topology to cloud', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lost acknowledgement', exact: true })).toBeVisible()
  await expect(page.getByText('Topology saved to your cloud library.', { exact: true })).toBeVisible()
  expect([...service.data.keys()].filter(key => key.includes('/topologies/'))).toHaveLength(1)
})

for (const theme of ['light', 'dark']) {
  test(`${theme}: explicit cloud topology saves, stale-version protection, loading and deletion`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const service = await setup(page)
    await page.goto('/?mode=full')
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
    await signIn(page)
    await page.getByLabel('Cloud topology name', { exact: true }).fill('Saved cloud design')
    await page.getByRole('button', { name: 'Save current topology to cloud', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Saved cloud design', exact: true })).toBeVisible()
    const [key, record] = [...service.data].find(([key]) => key.includes('/topologies/'))!
    const changed = JSON.parse(record.raw)
    changed.name = 'Remote changed'
    changed.topology.name = 'Remote topology'
    await service.store.put(key, JSON.stringify(changed), record.etag, changed.name)
    const local = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.getByRole('button', { name: 'Replace Saved cloud design', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toBeVisible()
    expect(JSON.parse(service.data.get(key)!.raw).topology.name).toBe('Remote topology')
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(local)
    await page.getByRole('button', { name: 'Refresh cloud topologies', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Remote changed', exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toHaveCount(0)
    await page.getByRole('dialog', { name: 'Cloud account', exact: true }).screenshot({ path: testInfo.outputPath(`cloud-${theme}.png`) })
    await page.getByRole('button', { name: 'Load Remote changed', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Cloud account', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.name)).toBe('Remote topology')
    await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
    await page.getByRole('button', { name: 'Delete Remote changed', exact: true }).click()
    await expect(page.getByText('No saved cloud topologies.', { exact: true })).toBeVisible()
    expect(service.data.has(key)).toBe(false)
    expect(errors).toEqual([])
  })
}
