import { expect, test, type Page } from '@playwright/test'
import { cloudFixture, testOwner } from '../tests/user-cloud-fixture'
import { guidedProgressKey } from '../src/learning/progress-ledger'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { exampleCourse } from '../src/learning/course-examples'
import { curriculumV2Bundle } from '../src/learning/curriculum-v2'
import { orderedTasks } from '../src/learning/runner'
import { openLearning, learningAdvancedOptions, completeLearningTasks, learningSidebar } from './learning-helpers'
import { sampleHubSpokeFirewallUdr, sampleHybridVwanAndHubSpoke } from '../src/azure-net/model'
import { readFileSync } from 'node:fs'
import { workspaceStorageKeys, workspaceSessionKey } from '../src/workspace-session'
import { parseCloudTopology } from '../src/cloud/contracts'
import { graphicalDetailTopology } from '../tests/fixtures/network-detail'
import { example } from '../src/model'
import AxeBuilder from '@axe-core/playwright'
import { languageStorageKey } from '../src/i18n'
import { openWorkspaceActions } from './document-action-helpers'

async function documentCloudMetadata(page: Page, documentId?: string) {
  return page.evaluate(documentId => {
    const id = documentId ?? JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId
    return localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:cloud`)
  }, documentId)
}

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

for (const mode of ['vwan', 'full'] as const) {
  test(`${mode}: a clean final cloud tab closes into an unlinked empty editor with its cloud library still reachable`, async ({ page }) => {
    const service = await setup(page)
    await page.addInitScript(() => localStorage.setItem('aznet-ui-preview:v1', 'true'))
    await page.goto(`/?mode=${mode}`)
    await signIn(page)
    await page.getByLabel('Cloud topology name', { exact: true }).fill('Closed cloud original')
    await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Closed cloud original', exact: true })).toBeVisible()
    const before = [...service.data].find(([key]) => key.includes('/topologies/'))![1].raw
    const originalId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)
    const metadata = await documentCloudMetadata(page)
    const account = page.getByRole('dialog', { name: 'Cloud account', exact: true })
    await account.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator('.workspace-tab-close').click()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: 'Save changes before closing?', exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Workspace', exact: true })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)).not.toBe(originalId)
    expect(await documentCloudMetadata(page)).toBeNull()
    expect(await documentCloudMetadata(page, originalId)).toBe(metadata)
    await page.getByTestId('cloud-account-open').click()
    await expect(page.getByRole('button', { name: 'Refresh cloud topologies', exact: true })).toBeEnabled()
    await expect(page.getByRole('heading', { name: 'Closed cloud original', exact: true })).toBeVisible()
    await account.getByRole('button', { name: 'Close', exact: true }).click()
    await page.keyboard.press('Control+s')
    const chooser = page.getByRole('dialog', { name: 'Save As', exact: true })
    await expect(chooser).toBeVisible()
    await expect(chooser.getByRole('option', { name: 'Private cloud library', exact: true })).toBeEnabled()
    expect([...service.data].find(([key]) => key.includes('/topologies/'))![1].raw).toBe(before)
    await chooser.getByRole('button', { name: 'Cancel', exact: true }).click()
  })

  for (const failure of ['quota', 'other-window'] as const) {
    test(`${mode} ${failure}: profile recovery failure stays in save details after a confirmed cloud save`, async ({ page, context }) => {
      let service = await setup(page)
      await page.goto(`/?mode=${mode}`)
      const edit = async (target: Page, name: string) => {
        if (mode === 'vwan') await target.getByLabel('Topology name', { exact: true }).fill(name)
        else await target.getByTestId('aznet-add-vnet-btn').click()
      }
      await edit(page, 'Owned design')
      await expect(page.getByTestId('document-cloud-state')).toHaveText('Locally saved')
      const key = workspaceStorageKeys[mode === 'vwan' ? 'vwan' : 'azure-net']
      const original = await page.evaluate(key => localStorage.getItem(key), key)
      const target = failure === 'other-window' ? await context.newPage() : page
      try {
        if (target !== page) {
          service = await setup(target)
          await target.goto(`/?mode=${mode}`)
          await expect(target.getByText('Temporary', { exact: true })).toBeVisible()
        } else {
          await target.evaluate(() => {
            const set = Storage.prototype.setItem
            Storage.prototype.setItem = function (key, value) {
              if (/^network-simulator:workspace-tab:v1:.*:topology$/.test(key)) throw new DOMException('Test quota exhausted', 'QuotaExceededError')
              return set.call(this, key, value)
            }
          })
        }
        await edit(target, 'Cloud-only design')
        const status = target.getByTestId('document-save-state')
        await expect(status).toHaveText('Not saved')
        await expect(target.getByTestId('aznet-save-error')).toHaveCount(0)
        await expect(target.getByText('Browser storage is unavailable or full. Use Save As to preserve your topology.', { exact: true })).toHaveCount(0)
        await signIn(target)
        await target.getByLabel('Cloud topology name', { exact: true }).fill('Confirmed without profile recovery')
        await target.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
        await expect(target.getByRole('heading', { name: 'Confirmed without profile recovery', exact: true })).toBeVisible()
        const account = target.getByRole('dialog', { name: 'Cloud account', exact: true })
        await account.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(status).toHaveText('Cloud saved')
        await expect(status).toHaveAttribute('title', /Profile recovery unavailable/)
        await expect(target.locator('.document-artifact-details summary')).toHaveAttribute('title', /Profile recovery unavailable/)
        await expect(target.getByRole('tab', { selected: true }).locator('..').locator('small')).toHaveText('Cloud saved')
        await expect(target.getByRole('tab', { selected: true })).toHaveAttribute('title', /Profile recovery unavailable/)
        const saved = [...service.data].find(([key]) => key.includes('/topologies/'))![1].raw
        await edit(target, 'New unsaved edits')
        await expect(status).toHaveText('Not saved')
        await expect(target.getByTestId('aznet-save-error')).toHaveCount(0)
        expect([...service.data].find(([key]) => key.includes('/topologies/'))![1].raw).toBe(saved)
        expect(await target.evaluate(key => localStorage.getItem(key), key)).toBe(original)
      } finally {
        if (target !== page) await target.close()
      }
    })
  }
}

for (const language of ['en', 'ja'] as const) {
  test(`${language}: learning status follows actual pending, failed, synced and conflicting cloud progress`, async ({ page }) => {
    const service = await setup(page)
    const text = (en: string, ja: string) => language === 'ja' ? ja : en
    await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
    await page.addInitScript(language => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('aznet-workspace-tools:v1', 'closed')
    }, language)
    let releaseRead!: () => void, releaseWrite!: () => void
    const reading = new Promise<void>(resolve => { releaseRead = resolve })
    const writing = new Promise<void>(resolve => { releaseWrite = resolve })
    let writeError: number | undefined = 503
    await page.route('**/api/cloud/progress', async route => {
      if (route.request().method() === 'GET') await reading
      else if (route.request().method() === 'PUT') {
        await writing
        if (writeError) { await route.fulfill({ status: writeError, body: '{}' }); return }
      }
      await route.fallback()
    })
    await page.goto('/?mode=full')
    const learning = page.getByTestId('learning-status-details')
    const summary = page.getByTestId('learning-sync-summary')
    const sync = page.getByTestId('learning-cloud-status')
    const closeLearning = () => learning.getByRole('button', { name: text('Close learning status', '学習状態を閉じる'), exact: true }).click()
    const account = page.getByRole('dialog', { name: text('Cloud account', 'クラウド アカウント'), exact: true })
    const closeAccount = () => account.getByRole('button', { name: text('Close', '閉じる'), exact: true }).click()
    const edition = async (original: boolean) => {
      await learningAdvancedOptions(page)
      await learning.getByRole('button', { name: original
        ? text('Switch to Original edition', '従来版に切り替える') : text('Switch to Scenario edition', 'シナリオ版に切り替える'), exact: true }).click()
      await learning.getByRole('button', { name: text('Confirm edition switch', '版の切り替えを確認'), exact: true }).click()
    }
    await page.getByTestId('learning-status').click()
    await expect(learning.getByRole('status')).toHaveText(text('Saved locally', 'ローカルに保存済み'))
    await expect(summary).toHaveCount(0)
    await closeLearning()
    await page.getByTestId('cloud-account-open').click()
    await account.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true }).click()
    await expect(page.getByTestId('cloud-progress-status')).toContainText(text('Loading', '読み込み中'))
    await closeAccount()
    await page.getByTestId('learning-status').click()
    await expect(sync).toHaveText(text('Cloud progress: Loading', 'クラウドの進捗: 読み込み中'))
    await expect(learning.getByText(text('Saved locally', 'ローカルに保存済み'), { exact: true })).toHaveCount(0)
    await learningAdvancedOptions(page)
    const refresh = learning.getByRole('button', { name: text('Refresh cloud progress', 'クラウドの進捗を再取得'), exact: true })
    await expect(refresh).toBeDisabled()
    releaseRead()
    await expect(sync).toHaveText(text('Cloud progress: Synced', 'クラウドの進捗: 同期済み'))
    await edition(true)
    await expect(sync).toContainText(text('Saving', '保存中'))
    await expect(summary).toContainText(text('Saving', '保存中'))
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(`${key}:account:alice`)!).enrollment, guidedProgressKey)).toBe(exampleCourse.course.id)
    releaseWrite()
    await expect(sync).toContainText(text('Not synced', '未同期'))
    await expect(summary).toContainText(text('Not synced', '未同期'))
    expect(service.data.has(`users/${testOwner('alice')}/progress.json`)).toBe(false)
    writeError = undefined
    await refresh.click()
    await expect(sync).toHaveText(text('Cloud progress: Synced', 'クラウドの進捗: 同期済み'))
    await expect(summary).toContainText(text('Synced', '同期済み'))
    const cloudKey = `users/${testOwner('alice')}/progress.json`
    expect(JSON.parse(service.data.get(cloudKey)!.raw).enrollment).toBe(exampleCourse.course.id)
    writeError = 412
    await edition(false)
    await expect(sync).toContainText(text('Conflict: no cloud overwrite was made', '競合: クラウドは上書きしていません'))
    await expect(summary).toContainText(text('Conflict', '競合'))
    expect(JSON.parse(service.data.get(cloudKey)!.raw).enrollment).toBe(exampleCourse.course.id)
    expect((await new AxeBuilder({ page }).include('.learning-status-panel').analyze()).violations).toEqual([])
    expect(await learning.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await closeLearning()
    await page.getByTestId('cloud-account-open').click()
    await expect(page.getByTestId('cloud-progress-status')).toContainText(text('Conflict', '競合'))
    await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
    await account.getByRole('button', { name: text('Sign in again / switch account', '再サインイン / アカウントの切り替え'), exact: true }).click()
    await expect(account).toContainText('Test Bob')
    await expect(page.getByTestId('cloud-progress-status')).toContainText(text('Synced', '同期済み'))
    await closeAccount()
    await page.getByTestId('learning-status').click()
    await expect(sync).toHaveText(text('Cloud progress: Synced', 'クラウドの進捗: 同期済み'))
    await expect(learning).toContainText(text('0 points', '0 ポイント'))
    await closeLearning()
    await page.getByTestId('cloud-account-open').click()
    await account.getByRole('button', { name: text('Sign out of this app', 'このアプリからサインアウト'), exact: true }).click()
    await closeAccount()
    await page.getByTestId('learning-status').click()
    await expect(learning.getByRole('status')).toHaveText(text('Saved locally', 'ローカルに保存済み'))
    await expect(sync).toHaveCount(0)
    await expect(summary).toHaveCount(0)
  })
}

for (const [mode, topology] of [['vwan', example], ['hub-spoke', sampleHubSpokeFirewallUdr], ['full', sampleHybridVwanAndHubSpoke]] as const) {
  for (const language of ['en', 'ja']) {
    test(`${mode} ${language}: save status distinguishes linked updates, new copies and same-tab reload`, async ({ page }, info) => {
      const service = await setup(page), text = (en: string, ja: string) => language === 'ja' ? ja : en
      const writes: string[] = []
      page.on('request', request => {
        if (request.method() === 'PUT' && request.url().includes('/api/cloud/topologies/')) writes.push(request.url())
      })
      await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
      const key = workspaceStorageKeys[mode === 'vwan' ? 'vwan' : 'azure-net']
      await page.addInitScript(({ language, key, initial }) => {
        localStorage.setItem('aznet-ui-preview:v1', 'true')
        localStorage.setItem('aznet-workspace-tools:v1', 'closed')
        localStorage.setItem('vwan-visual-topology:language:v1', language)
        localStorage.setItem('aznet-theme', language === 'ja' ? 'dark' : 'light')
        if (!sessionStorage.getItem('save-status-seeded')) {
          localStorage.setItem(key, initial)
          sessionStorage.setItem('save-status-seeded', 'true')
        }
      }, { language, key, initial: JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }) })
      await page.goto(`/?mode=${mode}`)
      const persistent = page.getByTestId('document-save-state')
      const status = page.getByTestId('document-cloud-state')
      const matches = text('Cloud saved', 'クラウドに保存済み')
      const modified = text('Locally saved', 'ローカルに保存済み')
      const matchesDetail = text('Matches last confirmed cloud save', '最後に確認したクラウドの保存と一致')
      const modifiedDetail = text('Local changes not saved to cloud', 'ローカルの変更はクラウドに未保存')
      await openWorkspaceActions(page)
      await expect(status).toHaveText(modified)
      await expect(status).toHaveAttribute('title', new RegExp(text('No cloud save linked in this tab', 'このタブに関連するクラウドの保存はありません')))
      await persistent.focus(); await page.keyboard.press('Enter')
      const account = page.getByRole('dialog', { name: text('Cloud account', 'クラウド アカウント'), exact: true })
      await account.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true }).click()
      const create = account.getByRole('button', { name: text('Save as new cloud copy', '新しいクラウドのコピーとして保存'), exact: true })
      await expect(create).toBeEnabled()
      await account.getByLabel(text('Cloud topology name', 'クラウドのトポロジ名'), { exact: true }).fill('Linked design')
      await create.click()
      await expect(account.getByRole('heading', { name: 'Linked design', exact: true })).toBeVisible()
      const [originalKey, original] = [...service.data].find(([key]) => key.includes('/topologies/'))!
      await account.getByRole('button', { name: text('Close', '閉じる'), exact: true }).click()
      await expect(persistent).toBeFocused()
      await expect(status).toHaveText(matches)
      await expect(status).toHaveAttribute('title', new RegExp(matchesDetail))
      if (mode === 'vwan') await page.locator('.topology-name').fill('Edited design')
      else {
        await page.getByRole('button', { name: text('Workspace controls', 'ワークスペースの操作'), exact: true }).click()
        await page.getByRole('complementary').getByRole('searchbox').fill('VNet')
        await page.getByTestId('aznet-add-vnet-btn').click()
        await page.keyboard.press('Escape')
      }
      await expect(status).toHaveText(modified)
      await expect(status).toHaveAttribute('title', new RegExp(modifiedDetail))
      await openWorkspaceActions(page)
      if (mode === 'vwan') { await persistent.focus(); await page.keyboard.press('Control+z') }
      else await page.getByRole('button', { name: '↶ Undo', exact: true }).click()
      await expect(status).toHaveText(matches)
      if (mode === 'vwan') await page.keyboard.press('Control+y')
      else await page.getByRole('button', { name: '↷ Redo', exact: true }).click()
      await expect(status).toHaveText(modified)
      const edited = await page.evaluate(key => localStorage.getItem(key), key)
      await persistent.press('Enter')
      const update = account.getByRole('button', { name: text('Update linked cloud save', '関連するクラウドの保存を更新'), exact: true })
      await expect(update).toBeEnabled()
      await update.click()
      await expect.poll(() => service.data.get(originalKey)!.etag).not.toBe(original.etag)
      await expect(create).toBeEnabled()
      expect([...service.data.keys()].filter(key => key.includes('/topologies/'))).toHaveLength(1)
      expect(JSON.parse(service.data.get(originalKey)!.raw).topology).not.toEqual(JSON.parse(original.raw).topology)
      await account.getByLabel(text('Cloud topology name', 'クラウドのトポロジ名'), { exact: true }).fill('Separate copy')
      await create.click()
      await expect(account.getByRole('heading', { name: 'Separate copy', exact: true })).toBeVisible()
      expect([...service.data.keys()].filter(key => key.includes('/topologies/'))).toHaveLength(2)
      const metadata = JSON.parse((await documentCloudMetadata(page))!)
      expect(metadata.id).not.toBe(originalKey.split('/').at(-1)!.replace('.json', ''))
      expect(metadata).not.toHaveProperty('topology')
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await account.evaluate(element => { element.scrollTop = 0 })
      await account.screenshot({ path: info.outputPath(`save-status-${mode}-${language}.png`) })
      await page.keyboard.press('Escape')
      await expect(persistent).toBeFocused()
      const writeCount = writes.length
      await page.reload()
      await expect(status).toHaveText(matches)
      expect(writes).toHaveLength(writeCount)
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(edited)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`save-header-${mode}-${language}.png`) })
      await openWorkspaceActions(page)
      await persistent.click()
      await expect(account.getByText('Separate copy', { exact: true }).first()).toBeVisible()
      await account.getByRole('button', { name: text('Sign out of this app', 'このアプリからサインアウト'), exact: true }).click()
      await account.getByRole('button', { name: text('Close', '閉じる'), exact: true }).click()
      await expect(status).toHaveText(modified)
      await expect(status).toHaveAttribute('title', new RegExp(text('No cloud save linked in this tab', 'このタブに関連するクラウドの保存はありません')))
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(edited)
      expect(await documentCloudMetadata(page)).toBeNull()
    })
  }
}

test('an acknowledged upload keeps later edits dirty and imports open independent unlinked tabs', async ({ page }) => {
  const service = await setup(page)
  await page.addInitScript(topology => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    localStorage.setItem('aznet-workspace-tools:v1', 'closed')
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology }))
  }, sampleHubSpokeFirewallUdr)
  await page.goto('/?mode=full')
  await signIn(page)
  let release!: () => void
  const acknowledgement = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/cloud/topologies/*', async route => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.fallback()
    const result = await service.request(request.url(), { method: 'PUT', headers: request.headers(), body: request.postData()! })
    await acknowledgement
    await route.fulfill({ status: result.status ?? 200,
      headers: { ...result.headers as Record<string, string>, 'content-type': 'application/json' },
      body: result.jsonBody === undefined ? '' : JSON.stringify(result.jsonBody) })
  })
  try {
    await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
    await expect.poll(() => [...service.data.keys()].filter(key => key.includes('/topologies/')).length).toBe(1)
    const [, uploaded] = [...service.data].find(([key]) => key.includes('/topologies/'))!
    await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Workspace controls', exact: true }).click()
    await page.getByRole('complementary').getByRole('searchbox').fill('VNet')
    await page.getByTestId('aznet-add-vnet-btn').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Uploading a snapshot…/)
    release()
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Local changes not saved to cloud/)
    const current = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)
    const originalId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)
    expect(current.vnets.length).toBe(JSON.parse(uploaded.raw).topology.vnets.length + 1)
    const input = page.locator('input[type=file]').first()
    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') })
    await expect(page.getByTestId('aznet-workspace-notice')).toContainText('Import rejected')
    const linked = await documentCloudMetadata(page)
    expect(linked).not.toBeNull()
    await input.setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(current)) })
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /No cloud save linked in this tab/)
    expect(await documentCloudMetadata(page)).toBeNull()
    expect(await documentCloudMetadata(page, originalId)).toBe(linked)
    await page.locator(`#workspace-tab-${originalId}`).click()
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Local changes not saved to cloud/)
    expect(JSON.parse([...service.data].find(([key]) => key.includes('/topologies/'))![1].raw)).toEqual(JSON.parse(uploaded.raw))
  } finally { release() }
})

function largeSharedTopology() {
  const detail = graphicalDetailTopology('full', 190)
  if (!('vnets' in detail)) throw new Error('Native network fixture required.')
  return { ...structuredClone(sampleHybridVwanAndHubSpoke),
    vnets: [...structuredClone(sampleHybridVwanAndHubSpoke.vnets), ...detail.vnets],
    inventory: detail.inventory, application: detail.application }
}

for (const [mode, topology] of [['vwan', example], ['hub-spoke', sampleHubSpokeFirewallUdr], ['full', sampleHybridVwanAndHubSpoke]] as const) {
  for (const [language, theme] of [['en', 'light'], ['ja', 'dark']] as const) {
    test(`${mode} ${language} ${theme}: latest saved sharing is short, read only and recipient-isolated`, async ({ page }, info) => {
      const text = (en: string, ja: string) => language === 'ja' ? ja : en
      const service = await setup(page)
      const id = crypto.randomUUID(), key = `users/${testOwner('alice')}/topologies/${id}.json`
      const document = parseCloudTopology({ version: 1, name: `Saved ${mode}`, topology: mode === 'full' ? largeSharedTopology() : structuredClone(topology) })
      if (mode === 'full') expect(JSON.stringify(document).length).toBeGreaterThan(50000)
      const etag = await service.store.put(key, JSON.stringify(document), null, document.name)
      await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
      await page.addInitScript(({ language, theme, key, draft }) => {
        localStorage.setItem('aznet-ui-preview:v1', 'true')
        localStorage.setItem('vwan-visual-topology:language:v1', language)
        localStorage.setItem('aznet-theme', theme)
        if (!sessionStorage.getItem('share-local-draft-seeded')) {
          localStorage.setItem(key, draft)
          sessionStorage.setItem('share-local-draft-seeded', 'true')
        }
      }, { language, theme, key: mode === 'vwan' ? workspaceStorageKeys.vwan : workspaceStorageKeys['azure-net'],
        draft: mode === 'vwan' ? JSON.stringify({ ...example, name: 'Recipient local draft' })
          : JSON.stringify({ sampleId: '', topology: { ...sampleHubSpokeFirewallUdr, name: 'Recipient local draft' } }) })
      await page.goto(`/?mode=${mode}`)
      await page.getByTestId('cloud-account-open').click()
      const account = page.getByRole('dialog', { name: text('Cloud account', 'クラウド アカウント'), exact: true })
      await account.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true }).click()
      const share = account.getByRole('button', { name: new RegExp(`^${text('Share saved version', '保存したバージョンを共有')} `) })
      await expect(share).toBeEnabled()
      const originals = await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [...Object.values(workspaceStorageKeys), workspaceSessionKey])
      await share.click()
      const enable = account.getByRole('button', { name: new RegExp(`^${text('Enable a 30-day link', '30 日間のリンクを有効化')}`) })
      await expect(enable).toBeEnabled()
      page.removeAllListeners('dialog')
      page.once('dialog', dialog => { void dialog.dismiss() })
      await enable.click()
      expect([...service.data.keys()].filter(key => key.includes('/shares/'))).toHaveLength(0)
      page.on('dialog', dialog => { void dialog.accept() })
      await enable.click()
      const linkInput = account.getByRole('textbox', { name: text('Read-only link', '読み取り専用リンク'), exact: true })
      await expect(linkInput).toBeVisible()
      const link = await linkInput.inputValue()
      expect(link.length).toBeLessThan(160)
      expect(new URL(link).hash).toMatch(/^#share=[A-Za-z0-9_-]{43}$/)
      expect(new URL(link).search).toBe('')
      expect(link).not.toContain(id)
      expect(service.data.get(key)!.raw).toBe(JSON.stringify(document))
      await account.getByRole('button', { name: text('Sign out of this app', 'このアプリからサインアウト'), exact: true }).click()
      await expect(account.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true })).toBeVisible()
      const latest = { ...document, name: `Renamed ${mode}`, topology: { ...(document.topology as object), name: `Latest ${mode}` } }
      const sourceVersion = await service.store.put(key, JSON.stringify(latest), etag, latest.name)
      await page.goto(link)
      await expect(page.getByRole('heading', { name: latest.name, exact: true })).toBeVisible()
      const viewer = page.getByRole('main')
      await expect(viewer.getByText(`${text('Cloud-saved revision', 'クラウドの保存リビジョン')}: ${sourceVersion}`, { exact: true })).toBeVisible()
      await expect(viewer.locator('svg.diagram, svg[data-testid="aznet-diagram-svg"]')).toBeVisible()
      const exportButton = page.getByRole('button', { name: text('Export a local copy', 'ローカル コピーをエクスポート'), exact: true })
      const copyButton = page.getByRole('button', { name: text('Save a copy to my cloud', '自分のクラウドにコピーを保存'), exact: true })
      await expect(exportButton).toBeDisabled()
      await expect(copyButton).toBeDisabled()
      await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).not.toBeVisible()
      await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
      await page.getByRole('button', { name: text('Sign in with Microsoft', 'Microsoft でサインイン'), exact: true }).click()
      await expect(copyButton).toBeEnabled()
      const download = page.waitForEvent('download')
      await exportButton.click()
      expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8'))).toEqual(latest.topology)
      await copyButton.click()
      await expect(page.getByRole('status')).toContainText(text('Copy saved to your cloud library.', 'コピーを自分のクラウド ライブラリに保存しました。'))
      const copies = [...service.data].filter(([key]) => key.startsWith(`users/${testOwner('bob')}/topologies/`))
      expect(copies).toHaveLength(1)
      expect(JSON.parse(copies[0][1].raw)).toEqual(latest)
      expect(service.data.get(key)!.raw).toBe(JSON.stringify(latest))
      expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [...Object.values(workspaceStorageKeys), workspaceSessionKey])).toEqual(originals)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.screenshot({ path: info.outputPath(`shared-${mode}-${language}-${theme}.png`) })
      await page.getByRole('button', { name: text('Return to workspace', 'ワークスペースに戻る'), exact: true }).click()
      await expect(page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
      expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [...Object.values(workspaceStorageKeys), workspaceSessionKey])).toEqual(originals)
      expect(service.data.get(key)!.raw).toBe(JSON.stringify(latest))
    })
  }
}

test('sharing rejects stale and unavailable creation, then permits explicit owner revocation', async ({ page }) => {
  const service = await setup(page), id = crypto.randomUUID()
  const key = `users/${testOwner('alice')}/topologies/${id}.json`
  const document = parseCloudTopology({ version: 1, name: 'Owner cloud save', topology: sampleHubSpokeFirewallUdr })
  const etag = await service.store.put(key, JSON.stringify(document), null, document.name)
  await page.addInitScript(() => localStorage.setItem('aznet-ui-preview:v1', 'true'))
  await page.goto('/?mode=full')
  await signIn(page)
  await page.getByRole('button', { name: /^Share saved version / }).click()
  const enable = page.getByRole('button', { name: /^Enable a 30-day link/ })
  await expect(enable).toBeEnabled()
  await service.store.put(key, JSON.stringify(document), etag, document.name)
  await enable.click()
  await expect(page.getByRole('status').filter({ hasText: 'Cloud save changed.' })).toBeVisible()
  expect([...service.data.keys()].filter(key => key.includes('/shares/'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Refresh cloud topologies', exact: true }).click()
  await expect(enable).toBeEnabled()
  await page.route('**/api/cloud/shares/*', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await enable.click()
  await expect(page.getByRole('status').filter({ hasText: 'Sharing did not complete.' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Read-only link', exact: true })).toHaveCount(0)
  await page.unroute('**/api/cloud/shares/*')
  await enable.click()
  const linkInput = page.getByRole('textbox', { name: 'Read-only link', exact: true })
  await expect(linkInput).toBeVisible()
  const link = await linkInput.inputValue()
  await page.getByRole('button', { name: 'Revoke link', exact: true }).click()
  await expect(linkInput).toHaveCount(0)
  await page.goto(link)
  await expect(page.getByRole('alert')).toContainText('Shared topology unavailable.')
  expect(service.data.get(key)!.raw).toBe(JSON.stringify(document))
})

for (const desktop of [false, true]) test(`${desktop ? 'desktop never resolves externally' : 'unreachable shared API'} keeps local JSON export available`, async ({ page }) => {
  await setup(page)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/cloud/')) requests.push(request.url()) })
  if (desktop) await page.addInitScript(() => { Object.defineProperty(window, 'desktopSimulator', { value: {} }) })
  else await page.route('**/api/cloud/shared', route => route.abort('internetdisconnected'))
  await page.goto(`/#share=${'x'.repeat(43)}`)
  await expect(page.getByRole('alert')).toContainText('Shared topology unavailable.')
  if (desktop) expect(requests).toEqual([])
  else { expect(requests.length).toBeGreaterThan(0); expect(requests.every(url => new URL(url).pathname === '/api/cloud/shared')).toBe(true) }
  const count = requests.length
  await page.getByRole('button', { name: 'Return to workspace', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save As', exact: true })).toBeEnabled()
  if (desktop) await expect(page.getByTestId('aznet-share-url-btn')).toBeDisabled()
  expect(requests).toHaveLength(count)
})

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
    await rows.getByRole('button', { name: /^Load in new tab |^新しいタブに読み込む / }).click()
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
    await learningAdvancedOptions(page)
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
    await page.locator('.canvas-view-toggle').click()
    await expect(page.locator('.canvas-view-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(account).not.toBeVisible()
    await expect(belt).not.toBeVisible()
    await expect(status).not.toBeVisible()
    await page.locator('.canvas-view-toggle').click()
    await expect(page.locator('.canvas-view-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(account).toHaveText(identity)
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
    await expect(page.locator('.canvas-view-toggle')).toHaveAttribute('aria-pressed', 'false')
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

test('cloud-restored belts and account switches never replay milestone celebrations', async ({ page }) => {
  const service = await setup(page)
  const raw = JSON.stringify({ version: 1, policyVersion: 1, enrollment: exampleCourse.course.id,
    completions: orderedTasks(exampleCourse).slice(0, exampleCourse.lessons[0].taskOrder.length).map(({ task, lesson }) => ({
      courseId: exampleCourse.course.id, contentVersion: 6, lessonId: lesson.id, taskId: task.id,
      assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
      title: task.title, sessionId: 'historical-cloud', revision: 1, scope: 1, engineVersion: 'test',
      completedAt: '2026-11-17T12:00:00Z',
    })) })
  for (const user of ['alice', 'bob']) service.data.set(`users/${testOwner(user)}/progress.json`, { raw, etag: `"historical-${user}"` })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible()
  const popup = page.getByTestId('learning-belt-dialog')
  const account = page.getByRole('dialog', { name: 'Cloud account', exact: true })
  const savedDesigns = () => page.evaluate((key) => [
    localStorage.getItem('aznet-visual-topology:v1'), localStorage.getItem('vwan-visual-topology:v1'),
    localStorage.getItem(key),
  ], practiceWorkspaceKey)
  const originals = await savedDesigns()
  await signIn(page)
  await expect(page.getByTestId('learning-status')).toContainText('Yellow belt')
  await account.getByRole('button', { name: 'Close', exact: true }).click()
  for (const user of ['alice', 'bob']) {
    if (user === 'bob') {
      await page.getByTestId('cloud-account-open').click()
      await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
      await account.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
      await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
      await account.getByRole('button', { name: 'Close', exact: true }).click()
    }
    await expect(page.getByTestId('learning-status')).toContainText(user === 'alice' ? 'Test Alice' : 'Test Bob')
    await expect(page.getByTestId('learning-status')).toContainText('Yellow belt')
    await expect(popup).toHaveCount(0)
    await openLearning(page)
    await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'override.load')
    await learningSidebar(page).getByRole('button', { name: 'Pause learning', exact: true }).click()
    expect(await savedDesigns()).toEqual(originals)
    expect(service.data.get(`users/${testOwner(user)}/progress.json`)!.raw).toBe(raw)
  }
  await openLearning(page)
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'override.load')
  await expect(popup).toHaveCount(0)
  await completeLearningTasks(page, 1)
  await expect.poll(() => JSON.parse(service.data.get(`users/${testOwner('bob')}/progress.json`)!.raw).completions.length)
    .toBe(JSON.parse(raw).completions.length + 1)
  expect(service.data.get(`users/${testOwner('alice')}/progress.json`)!.raw).toBe(raw)
  expect(await page.evaluate(() => [
    localStorage.getItem('aznet-visual-topology:v1'), localStorage.getItem('vwan-visual-topology:v1'),
  ])).toEqual(originals.slice(0, 2))
  await expect(popup).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('learning-status')).toContainText('Test Bob')
  await expect(page.getByTestId('learning-status')).toContainText('Yellow belt')
  await openLearning(page)
  const nextTask = orderedTasks(exampleCourse)[JSON.parse(raw).completions.length + 1].task.id
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', nextTask)
  await expect(popup).toHaveCount(0)
})

test('an open learning sidebar rebinds on account switching and sign-out without creating progress', async ({ page }) => {
  const service = await setup(page)
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible()
  await signIn(page)
  const account = page.getByRole('dialog', { name: 'Cloud account', exact: true })
  const closeAccount = () => account.getByRole('button', { name: 'Close', exact: true }).click()
  await closeAccount()
  const stored = () => page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), [
    'aznet-visual-topology:v1', 'vwan-visual-topology:v1', practiceWorkspaceKey, guidedProgressKey,
  ])
  const original = await stored()
  await openLearning(page)
  const task = learningSidebar(page).getByTestId('learning-task')
  const firstTask = curriculumV2Bundle.lessons[0].taskOrder[0]
  await expect(task).toHaveAttribute('data-task-id', firstTask)
  await page.getByTestId('cloud-account-open').click()
  await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
  await account.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Test Bob')
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Synced')
  await closeAccount()
  await expect(task).toHaveAttribute('data-task-id', firstTask)
  await page.getByTestId('cloud-account-open').click()
  await account.getByRole('button', { name: 'Sign out of this app', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Not signed in')
  await closeAccount()
  await expect(task).toHaveAttribute('data-task-id', firstTask)
  await expect(page.getByTestId('learning-belt-dialog')).toHaveCount(0)
  await expect(page.getByTestId('learning-status')).toContainText('0 points')
  expect(await stored()).toEqual(original)
  expect([...service.data.keys()].filter((key) => key.endsWith('/progress.json'))).toEqual([])
})

test('switching accounts preserves session-only history when both local and cloud writes fail', async ({ page }) => {
  const points = curriculumV2Bundle.lessons[0].tasks.slice(0, 2).reduce((sum, task) => sum + task.points, 0)
  await setup(page)
  await page.goto('/?mode=full')
  await signIn(page)
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  let offline = true
  await page.route('**/api/cloud/progress', async route => {
    if (route.request().method() === 'PUT' && offline) await route.abort()
    else await route.fallback()
  })
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('network-simulator:learning-progress:v1:account:')) throw new DOMException('Full', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await openLearning(page)
  await completeLearningTasks(page, 2)
  await expect(page.getByTestId('learning-status')).toContainText(`${points} points`)
  await page.getByTestId('practice-workspace-bar').getByRole('button', { name: 'Return to my design', exact: true }).click()
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await expect(page.getByTestId('cloud-progress-status')).toContainText('Not synced')
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('learning-status').click()
  const details = page.getByTestId('learning-status-details')
  await expect(details.getByRole('status').first()).toContainText('Session only')
  await expect(page.getByTestId('learning-cloud-status')).toContainText('Not synced')
  await learningAdvancedOptions(page)
  offline = false
  await details.getByRole('button', { name: 'Refresh cloud progress', exact: true }).click()
  await expect(page.getByTestId('learning-cloud-status')).toContainText('Synced')
  await expect(details.getByRole('status').first()).toContainText('Session only')
  await expect(details.getByRole('button', { name: 'Retry saving progress', exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Close learning status', exact: true }).click()
  await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
  await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'bob'))
  await page.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Test Bob')
  await expect(page.getByTestId('learning-status')).toContainText('0 points')
  await expect(page.getByRole('button', { name: 'Refresh cloud topologies', exact: true })).toBeEnabled()
  await page.evaluate(() => sessionStorage.setItem('mock-cloud-user', 'alice'))
  await page.getByRole('button', { name: 'Sign in again / switch account', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Test Alice')
  await expect(page.getByTestId('learning-status')).toContainText(`${points} points`)
})

test('real curriculum completions, offline resets and enrollment changes synchronize automatically', async ({ page }) => {
  const service = await setup(page)
  await page.goto('/?mode=full')
  await signIn(page)
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await openLearning(page)
  await expect(learningSidebar(page)).not.toContainText('No account, upload')
  await expect(learningSidebar(page)).not.toContainText('not encrypted or synchronized')
  await completeLearningTasks(page, 2)
  const key = `users/${testOwner('alice')}/progress.json`
  await expect.poll(() => JSON.parse(service.data.get(key)?.raw ?? '{}').completions?.length).toBe(2)
  expect(JSON.parse(service.data.get(key)!.raw).completions.every((entry: { courseId: string }) => entry.courseId === curriculumV2Bundle.course.id)).toBe(true)
  await page.getByTestId('practice-workspace-bar').getByRole('button', { name: 'Return to my design', exact: true }).click()
  const offline = async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'PUT') await route.abort()
    else await route.fallback()
  }
  await page.route('**/api/cloud/progress', offline)
  await page.getByTestId('learning-status').click()
  await learningAdvancedOptions(page)
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
  await learningAdvancedOptions(page)
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
  await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
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
  await page.getByRole('button', { name: /^Load in new tab Confirmed save / }).click()
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
  await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toBeVisible()
  await expect(page.getByText('Topology saved to your cloud library.', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Cloud operation not confirmed/)
  const originalId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)
  await page.getByRole('dialog', { name: 'Cloud account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
  await page.locator(`#workspace-tab-${originalId}`).click()
  await page.getByTestId('cloud-account-open').click()
  await page.getByLabel('Cloud topology name', { exact: true }).fill('Lost acknowledgement')
  await page.unroute('**/api/cloud/topologies/*', interrupted)
  await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lost acknowledgement', exact: true })).toBeVisible()
  await expect(page.getByText('Topology saved to your cloud library.', { exact: true })).toBeVisible()
  expect([...service.data.keys()].filter(key => key.includes('/topologies/'))).toHaveLength(1)
})

test('a cloud upload stays busy and confirms only its original live tab after switching', async ({ page }) => {
  const service = await setup(page)
  await page.goto('/?mode=full')
  await signIn(page)
  const originalId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)
  let release!: () => void
  const acknowledgement = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/cloud/topologies/*', async route => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.fallback()
    const result = await service.request(request.url(), { method: 'PUT', headers: request.headers(), body: request.postData()! })
    await acknowledgement
    await route.fulfill({ status: result.status ?? 200,
      headers: { ...result.headers as Record<string, string>, 'content-type': 'application/json' },
      body: result.jsonBody === undefined ? '' : JSON.stringify(result.jsonBody) })
  })
  const account = page.getByRole('dialog', { name: 'Cloud account', exact: true })
  try {
    await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
    await expect.poll(() => [...service.data.keys()].filter(key => key.includes('/topologies/')).length).toBe(1)
    await account.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)).not.toBe(originalId)
    const otherId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)
    await page.locator(`#workspace-tab-${originalId}`).click()
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Uploading a snapshot…/)
    await page.getByRole('button', { name: 'Close topology: Empty Topology', exact: true }).click()
    await expect(page.getByText('Wait for the save to finish before closing its tab.', { exact: true })).toBeVisible()
    await page.getByTestId('cloud-account-open').click()
    await expect(account.getByRole('button', { name: 'Save as new cloud copy', exact: true })).toBeDisabled()
    await account.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator(`#workspace-tab-${otherId}`).click()
    release()
    await expect.poll(() => documentCloudMetadata(page, originalId)).not.toBeNull()
    expect(await documentCloudMetadata(page, otherId)).toBeNull()
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /No cloud save linked in this tab/)
    await page.locator(`#workspace-tab-${originalId}`).click()
    await expect(page.getByTestId('document-cloud-state')).toHaveText('Cloud saved')
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Matches last confirmed cloud save/)
    expect([...service.data.keys()].filter(key => key.includes('/topologies/'))).toHaveLength(1)
  } finally { release() }
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
    await page.getByRole('button', { name: 'Save as new cloud copy', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Saved cloud design', exact: true })).toBeVisible()
    const [key, record] = [...service.data].find(([key]) => key.includes('/topologies/'))!
    const changed = JSON.parse(record.raw)
    changed.name = 'Remote changed'
    changed.topology.name = 'Remote topology'
    await service.store.put(key, JSON.stringify(changed), record.etag, changed.name)
    const local = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.getByRole('button', { name: /^Overwrite cloud save Saved cloud design / }).click()
    await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toBeVisible()
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Cloud save changed: review first/)
    await expect(page.getByTestId('document-cloud-state')).toHaveText('Locally saved')
    expect(JSON.parse(service.data.get(key)!.raw).topology.name).toBe('Remote topology')
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(local)
    await page.getByRole('button', { name: 'Refresh cloud topologies', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Remote changed', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update linked cloud save', exact: true })).toBeDisabled()
    expect(JSON.parse((await documentCloudMetadata(page))!).etag).toBe(record.etag)
    await expect(page.getByRole('status').filter({ hasText: 'cloud operation did not complete' })).toHaveCount(0)
    await page.getByRole('dialog', { name: 'Cloud account', exact: true }).screenshot({ path: testInfo.outputPath(`cloud-${theme}.png`) })
    await page.getByRole('button', { name: /^Load in new tab Remote changed / }).click()
    await expect(page.getByRole('dialog', { name: 'Cloud account', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.name)).toBe('Remote topology')
    await page.getByRole('button', { name: 'Cloud account', exact: true }).click()
    await page.getByRole('button', { name: /^Delete Remote changed / }).click()
    await expect(page.getByText('No saved cloud topologies.', { exact: true })).toBeVisible()
    await expect(page.getByTestId('document-cloud-state')).toHaveAttribute('title', /Linked cloud save unavailable/)
    await expect(page.getByTestId('document-cloud-state')).toHaveText('Locally saved')
    expect(service.data.has(key)).toBe(false)
    expect(errors).toEqual([])
  })
}
