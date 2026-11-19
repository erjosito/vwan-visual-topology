import { expect, test, type Page } from '@playwright/test'
import { cloudFixture, testOwner } from '../tests/user-cloud-fixture'
import { guidedProgressKey } from '../src/learning/progress-ledger'
import { exampleCourse } from '../src/learning/course-examples'
import { orderedTasks } from '../src/learning/runner'
import { completeLearningTasks, learningSidebar } from './learning-helpers'
import { sampleHubSpokeFirewallUdr } from '../src/azure-net/model'
import { example } from '../src/model'
import AxeBuilder from '@axe-core/playwright'
import { languageStorageKey } from '../src/i18n'

async function setup(page: Page, accountName?: string) {
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
      const account = () => ({id:user,name:${accountName === undefined ? "user==='bob'?'Test Bob':'Test Alice'" : JSON.stringify(accountName)}});
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
  await page.getByTestId('cloud-account-open').click()
  await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
  await expect(page.getByRole('button', { name: 'Refresh cloud topologies', exact: true })).toBeEnabled()
}

for (const language of ['en', 'ja']) for (const theme of ['light', 'dark']) {
  test(`${language} ${theme}: compact cloud library keeps fifty sorted and filtered saves distinct`, async ({ page }, info) => {
    const text = (en: string, ja: string) => language === 'ja' ? ja : en
    const service = await setup(page)
    const ids = Array.from({ length: 50 }, () => crypto.randomUUID())
    for (const [index, id] of ids.entries()) {
      const name = index === 44 || index === 45 ? 'Duplicate name'
        : index === 49 ? 'Long configuration '.repeat(6).trim() : `Saved ${String(index).padStart(2, '0')}`
      await service.store.put(`users/${testOwner('alice')}/topologies/${id}.json`, JSON.stringify({
        version: 1, name, topology: { ...sampleHubSpokeFirewallUdr, name: `Cloud topology ${index}` },
      }), null, name)
    }
    const list = service.store.list
    service.store.list = async prefix => (await list(prefix)).map((entry, index) => ({
      ...entry, updatedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
    }))
    const original = new Map([...service.data].map(([key, value]) => [key, value.raw]))
    await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-theme', theme)
    }, { language, theme })
    await page.goto('/?mode=full&sample=hub-spoke-firewall-udr')
    await page.getByTestId('cloud-account-open').click()
    await page.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true }).click()
    const dialog = page.getByRole('dialog', { name: text('Cloud account', 'クラウド アカウント'), exact: true })
    const rows = dialog.locator('tbody tr')
    await expect(rows).toHaveCount(50)
    await expect(rows.first()).toHaveAttribute('data-cloud-save-id', ids[49])
    const local = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    const search = dialog.getByRole('searchbox', { name: text('Find cloud saves', 'クラウドの保存を検索'), exact: true })
    const sort = dialog.getByRole('combobox', { name: text('Sort cloud saves', 'クラウドの保存の並べ替え'), exact: true })
    await sort.selectOption('name')
    await expect(rows.first()).toContainText('Duplicate name')
    const region = dialog.getByRole('region', { name: text('Cloud saves', 'クラウドの保存'), exact: true })
    await region.scrollIntoViewIfNeeded()
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await region.locator('button').evaluateAll(buttons => buttons.every(button => {
      const bounds = button.getBoundingClientRect(), parent = button.closest('[role="region"]')!.getBoundingClientRect()
      return bounds.left >= parent.left && bounds.right <= parent.right && bounds.height >= 36
    }))).toBe(true)
    expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([])
    await region.screenshot({ path: info.outputPath(`cloud-library-${language}-${theme}.png`) })
    await search.fill('no matching configuration')
    await expect(rows).toHaveCount(0)
    await search.fill('Duplicate name')
    await expect(rows).toHaveCount(2)
    if (language === 'en' && theme === 'light') {
      page.removeAllListeners('dialog')
      page.once('dialog', dialog => { void dialog.dismiss() })
      await rows.first().getByRole('button', { name: /^Overwrite cloud save / }).click()
      expect([...service.data].map(([key, value]) => [key, value.raw])).toEqual([...original])
      page.on('dialog', dialog => { void dialog.accept() })
    }
    const deletedKey = `users/${testOwner('alice')}/topologies/${ids[44]}.json`
    await dialog.locator(`[data-cloud-save-id="${ids[44]}"]`).getByRole('button', { name: /^Delete |^削除 / }).click()
    await expect(rows).toHaveCount(1)
    expect(service.data.has(deletedKey)).toBe(false)
    await expect(dialog.getByRole('button', { name: text('Refresh cloud topologies', 'クラウドの一覧を更新'), exact: true })).toBeFocused()
    await dialog.getByLabel(text('Cloud topology name', 'クラウドのトポロジ名'), { exact: true }).fill('Updated cloud copy')
    await rows.getByRole('button', { name: /^Overwrite cloud save |^クラウドの保存を上書き / }).focus()
    await page.keyboard.press('Enter')
    const overwrittenKey = `users/${testOwner('alice')}/topologies/${ids[45]}.json`
    await expect.poll(() => JSON.parse(service.data.get(overwrittenKey)!.raw).name).toBe('Updated cloud copy')
    await expect(search).toBeFocused()
    for (const [key, raw] of original) {
      if (key !== deletedKey && key !== overwrittenKey) expect(service.data.get(key)?.raw).toBe(raw)
    }
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(local)
    await search.fill('Saved 00')
    await rows.getByRole('button', { name: /^Load into workspace |^ワークスペースに読み込む / }).click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.name)).toBe('Cloud topology 0')
    for (const [key, raw] of original) {
      if (key !== deletedKey && key !== overwrittenKey) expect(service.data.get(key)?.raw).toBe(raw)
    }
  })
}

for (const language of ['en', 'ja'] as const) {
  test(`${language}: Close dismisses the cloud dialog without signing out or changing the design`, async ({ page }) => {
    await setup(page)
    await page.addInitScript(({ key, language }) => localStorage.setItem(key, language), { key: languageStorageKey, language })
    await page.goto('/?mode=full')
    const accountName = language === 'ja' ? 'クラウド アカウント' : 'Cloud account'
    const account = page.getByRole('button', { name: accountName, exact: true })
    await account.click()
    const dialog = page.getByRole('dialog', { name: accountName, exact: true })
    await dialog.getByRole('button', { name: language === 'ja' ? 'Microsoft でサインイン' : 'Sign in with Microsoft', exact: true }).click()
    const signOut = dialog.getByRole('button', { name: language === 'ja' ? 'このアプリからサインアウト' : 'Sign out of this app', exact: true })
    await expect(signOut).toBeVisible()
    const design = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await dialog.getByRole('button', { name: language === 'ja' ? '閉じる' : 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('learning-status')).toContainText('Test Alice')
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(design)
    await account.click()
    await expect(signOut).toBeVisible()
  })
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
    const status = page.getByTestId('account-belt-status')
    await expect(status).toContainText('Not signed in')
    await expect(status).toContainText('Black belt')
    await expect(status).not.toContainText('x2')
    await signIn(page)
    await expect(status).toContainText('Test Alice')
    await expect(status).toContainText('White belt')
    await page.getByRole('button', { name: 'Sign out of this app', exact: true }).click()
    await expect(status).toContainText('Not signed in')
    await expect(status).toContainText('Black belt')
    await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByTestId('learning-status').click()
    await page.getByRole('button', { name: 'Reset guided learning progress', exact: true }).click()
    await page.getByRole('button', { name: 'Delete guided history & points', exact: true }).click()
    await expect(status).toContainText('White belt')
  })
})

for (const mode of ['vwan', 'hub-spoke', 'full']) for (const language of ['en', 'ja']) {
  test(`${mode} ${language}: identity opens account actions and the adjacent belt opens learning`, async ({ page }, info) => {
    const text = (en: string, ja: string) => language === 'ja' ? ja : en
    const identity = language === 'ja' ? 'A long signed-in identity with multiple names '.repeat(3).trim() : 'Test Alice'
    const service = await setup(page, identity)
    await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
    await page.addInitScript(({ language, topology, classic }) => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-theme', language === 'ja' ? 'dark' : 'light')
      localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
      localStorage.setItem('vwan-visual-topology:v1', JSON.stringify({ sampleId: '', topology: classic }))
    }, { language, topology: sampleHubSpokeFirewallUdr, classic: example })
    if (mode === 'full' && language === 'en') {
      await page.route('**/api/cloud/topologies', route => route.fulfill({ status: 404, body: '' }))
    }
    await page.goto(`/?mode=${mode}`)
    const localKey = mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    const local = await page.evaluate(key => localStorage.getItem(key), localKey)
    const account = page.getByTestId('cloud-account-open'), belt = page.getByTestId('learning-status')
    const status = page.getByTestId('account-belt-status')
    await expect(account).toHaveText(text('Not signed in', '未サインイン'))
    await account.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: text('Cloud account', 'クラウド アカウント'), exact: true })
    await expect(page.getByTestId('learning-status-details')).toHaveCount(0)
    await dialog.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true }).click()
    await expect(account).toHaveText(identity)
    await expect(account).toHaveAttribute('title', `${text('Cloud account', 'クラウド アカウント')}: ${identity}`)
    if (mode === 'full' && language === 'en') await expect(dialog.getByRole('alert')).toContainText('Check the backend deployment')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(account).toBeFocused()
    await expect(belt).toHaveAccessibleName(new RegExp(text('Learning status', '学習の状況')))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await account.evaluate(el => getComputedStyle(el).textAlign)).toBe('left')
    expect((await account.boundingBox())!.height).toBeLessThanOrEqual(70)
    expect((await new AxeBuilder({ page }).include('.workspace-account-status').analyze()).violations).toEqual([])
    await status.screenshot({ path: info.outputPath(`account-belt-${mode}-${language}.png`) })
    await belt.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('learning-status-details')).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('learning-status-details')).toHaveCount(0)
    await expect(belt).toBeFocused()
    await account.click()
    await dialog.getByRole('button', { name: text('Sign out of this app', 'このアプリからサインアウト'), exact: true }).click()
    await expect(account).toHaveText(text('Not signed in', '未サインイン'))
    await page.keyboard.press('Escape')
    await expect(account).toBeFocused()
    expect(await page.evaluate(key => localStorage.getItem(key), localKey)).toBe(local)
    expect(service.data.size).toBe(0)
  })
}

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
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
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
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
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
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('learning-open').click()
  await expect(learningSidebar(page)).not.toContainText('No account, upload')
  await expect(learningSidebar(page)).not.toContainText('not encrypted or synchronized')
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
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
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
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirmed save', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(local)
  await page.getByRole('button', { name: /^Load into workspace Confirmed save / }).click()
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
    await page.getByRole('button', { name: /^Overwrite cloud save Saved cloud design / }).click()
    await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toBeVisible()
    expect(JSON.parse(service.data.get(key)!.raw).topology.name).toBe('Remote topology')
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(local)
    await page.getByRole('button', { name: 'Refresh cloud topologies', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Remote changed', exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toHaveCount(0)
    await page.getByRole('dialog', { name: 'Cloud account', exact: true }).screenshot({ path: testInfo.outputPath(`cloud-${theme}.png`) })
    await page.getByRole('button', { name: /^Load into workspace Remote changed / }).click()
    await expect(page.getByRole('dialog', { name: 'Cloud account', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.name)).toBe('Remote topology')
    await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
    await page.getByRole('button', { name: /^Delete Remote changed / }).click()
    await expect(page.getByText('No saved cloud topologies.', { exact: true })).toBeVisible()
    expect(service.data.has(key)).toBe(false)
    expect(errors).toEqual([])
  })
}
