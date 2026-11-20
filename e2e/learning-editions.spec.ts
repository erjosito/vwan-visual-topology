import { expect, test, type Page } from '@playwright/test'
import { scenarioBundle } from '../src/learning/scenario-course'
import { exampleCourse } from '../src/learning/course-examples'
import { orderedTasks } from '../src/learning/runner'
import { guidedProgressKey } from '../src/learning/progress-ledger'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { sidebarLabels } from '../src/learning/sidebar-content'
import { runnerLabels } from '../src/learning/runner-content'
import { loadLanguage, translate } from '../src/messages'
import '../src/packet-messages-ja'
import '../src/network-detail-messages-ja'
import { advanceLearningTask, completeLearningTasks, createLessonPeering, learningAnchor, learningOptions, learningSidebar, loadLearningNetwork } from './learning-helpers'

async function show(page: Page, taskId: string, guidanceId: string, language: 'en' | 'ja') {
  const task = scenarioBundle.lessons.flatMap((lesson) => lesson.tasks).find((task) => task.id === taskId)!
  expect(task.guidanceIds).toContain(guidanceId)
  const panel = learningSidebar(page)
  const button = panel.getByTestId(`learning-guide-${guidanceId}`)
  if (!await button.isVisible()) {
    await learningOptions(page, language)
    const navigation = panel.getByText(sidebarLabels.navigationHelp[language], { exact: true })
    if (!await navigation.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await navigation.click()
  }
  await button.click()
}
async function openTable(page: Page, taskId: string, tableId: string, language: 'en' | 'ja') {
  const cue = scenarioBundle.guidance.find((entry) => entry.id.startsWith(taskId.split('.')[0])
    && entry.action === 'route-table.configure' && entry.params.routeTableId === tableId)!
  await show(page, taskId, cue.id, language)
  return page.getByTestId(`aznet-rt-card-${tableId}`)
}
async function probeHa(page: Page, taskId: string, language: 'en' | 'ja', symmetry: 'symmetric' | 'asymmetric') {
  await loadLanguage(language)
  const t = (text: string) => translate(language, text)
  const before = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
  await show(page, taskId, 'ha-return-path.packet', language)
  const dialog = page.getByTestId('network-detail-dialog')
  const panel = dialog.getByTestId('packet-flow-panel')
  await expect(learningAnchor(page, 'packet-probe', 'hub')).toBeVisible()
  await expect(dialog.locator('.learning-cue')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
  await expect(panel.getByTestId('packet-flow-result')).toHaveCount(0)
  await panel.getByLabel(t('Packet source'), { exact: true }).selectOption(JSON.stringify(['workload', 'client', 'client-nic', 'client-ip']))
  await panel.getByLabel(t('Packet destination'), { exact: true }).selectOption(JSON.stringify(['workload', 'server', 'server-nic', 'server-ip']))
  await panel.getByRole('button', { name: t('Trace packet routing'), exact: true }).click()
  await expect(panel.getByTestId('packet-ha-ports-result')).toContainText(t(symmetry))
  await expect(panel.getByTestId('packet-ha-ports-result')).toContainText('primary-vm')
  await expect(panel.getByTestId('packet-flow-result')).toContainText('10.81.1.10:49152')
  await expect(panel.getByTestId('packet-flow-result')).toContainText('10.82.1.10:443')
  await dialog.getByRole('button', { name: t('Close VNet detail'), exact: true }).click()
}
async function repair(page: Page, id: string, language: 'en' | 'ja') {
  const taskId = `${id}.repair`
  if (id === 'multihub-labels') {
    const before = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
    await show(page, taskId, `${id}.west-guide`, language)
    await expect(learningAnchor(page, 'hub-editor', 'west-hub')).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
    const labels = page.getByTestId('aznet-hub-tables-editor').getByLabel(`${translate(language, 'Table labels')} west-workloads`, { exact: true })
    await labels.fill('shared')
    await labels.press('Tab')
  }
  if (id === 'private-link') await createLessonPeering(page, language)
  if (id === 'inspection-bypass') {
    for (const [tableId, prefix] of [['partner-policy', '10.21.0.0/16']]) {
      const card = await openTable(page, taskId, tableId, language)
      await card.getByRole('button', { name: '+ Add UDR Row', exact: true }).click()
      await card.locator('tbody tr').last().locator('input[type="text"]').nth(1).fill(prefix)
      await card.locator('tbody tr').last().locator('input[type="text"]').nth(2).fill('10.20.1.4')
    }
  }
  if (id === 'colocated-chain') {
    await openTable(page, taskId, 'inspection-onward', language)
    await learningAnchor(page, 'udr-route', 'hub', 'hub-work', 'inspection-onward', 'partner-onward').getByRole('checkbox').check()
  }
  if (id === 'dedicated-chain') {
    await show(page, taskId, `${id}.configure-transport`, language)
    await page.getByTestId('aznet-vnet-config-transport').getByRole('checkbox', { name: 'NIC IP Forwarding', exact: true }).check()
  }
  if (id === 'branch-advertisement') {
    await openTable(page, taskId, 'workload-learning', language)
    await page.getByTestId('aznet-rt-disable-bgp-workload-learning').uncheck()
  }
  if (id === 'wan-isolation') {
    const before = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
    await show(page, taskId, `${id}.hub`, language)
    await expect(learningAnchor(page, 'hub-effective-table', 'wan', 'defaultRouteTable')).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
    await show(page, taskId, `${id}.hub-config`, language)
    const group = page.getByTestId('aznet-hub-tables-editor').getByRole('group', { name: 'Partner', exact: true })
    await group.getByRole('checkbox', { name: 'None', exact: true }).uncheck()
    await group.getByRole('checkbox', { name: 'Default', exact: true }).check()
  }
  if (id === 'tiered-incident') {
    await expect(learningSidebar(page).getByTestId('learning-debrief')).toHaveCount(0)
    await openTable(page, taskId, 'inspection-onward', language)
    await learningAnchor(page, 'udr-route', 'hub', 'hub-work', 'inspection-onward', 'indirect-return')
      .locator('input[type="text"]').nth(2).fill('10.21.3.4')
  }
  if (id === 'ha-return-path') {
    const card = await openTable(page, taskId, 'remote-steering', language)
    await card.locator('tbody tr').first().locator('input[type="text"]').nth(2).fill('10.80.3.10')
  }
  if (id === 'routing-handover') {
    await openTable(page, taskId, 'service-policy', language)
    await learningAnchor(page, 'udr-route', 'supplier', 'supplier-api', 'service-policy', 'change-window').getByRole('checkbox').uncheck()
  }
}

async function configureStage(page: Page, taskId: string, language: 'en' | 'ja') {
  if (taskId === 'inspection-bypass.forward') {
    const card = await openTable(page, taskId, 'application-policy', language)
    await card.getByRole('button', { name: '+ Add UDR Row', exact: true }).click()
    const inputs = card.locator('tbody tr').last().locator('input[type="text"]')
    await inputs.nth(1).fill('10.22.0.0/16')
    await inputs.nth(2).fill('10.20.1.4')
    await inputs.nth(2).press('Tab')
  }
  if (taskId === 'tiered-incident.entry') {
    await openTable(page, taskId, 'indirect-egress', language)
    await learningAnchor(page, 'udr-route', 'leaf', 'leaf-work', 'indirect-egress', 'partner-service').getByRole('checkbox').check()
  }
}

async function configureHybrid(page: Page, taskId: string, language: 'en' | 'ja') {
  const withdraw = taskId.endsWith('.withdraw')
  const before = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
  await show(page, taskId, `hybrid-preference.${withdraw ? 'er' : 'vpn'}-guide`, language)
  const editor = page.getByTestId('aznet-hybrid-connection-editor')
  await expect(editor).toBeVisible()
  await expect(learningAnchor(page, 'connection-editor', withdraw ? 'er-link' : 'vpn-connection', withdraw ? 'branch-er' : 'branch-vpn')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
  await editor.locator('input[name="enabled"]').setChecked(!withdraw)
  await editor.getByRole('button', { name: translate(language, 'Save connection routing'), exact: true }).click()
}

for (const language of ['en', 'ja'] as const) {
  test(`${language}: contextual first exercise awards automatically but keeps teaching and documentation until Next`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/?mode=full')
    await page.locator('header [data-language-selector]').selectOption(language)
    await page.getByTestId('learning-open').click()
    const panel = learningSidebar(page)
    await expect(panel.getByTestId('learning-scenario-context')).toHaveText(scenarioBundle.lessons[0].context![language])
    await loadLearningNetwork(page, language)
    await expect(panel.getByTestId('learning-debrief')).toBeVisible()
    await page.waitForTimeout(2200)
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.load')
    await advanceLearningTask(page, language)
    await expect(panel.getByTestId('learning-task')).toContainText(language === 'en' ? 'Effective routes' : '有効なルート')
    await expect(panel.getByTestId('learning-task')).toContainText('10.22.0.0/16')
    await expect(panel.getByTestId('learning-task')).not.toContainText('Record the inspection')
    await show(page, 'private-link.inspect', 'private-link.before-guide', language)
    const debrief = panel.getByTestId('learning-debrief')
    await expect(debrief).toContainText('System')
    await expect(debrief).toContainText('VNetPeering')
    await expect(debrief).toContainText('10.22.1.4')
    await expect(debrief).not.toContainText('BGP')
    await expect(panel.getByTestId('learning-celebration')).toContainText('+5')
    const awards = await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)
    expect(JSON.parse(awards!).completions).toHaveLength(2)
    await page.context().route('https://learn.microsoft.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Microsoft Learn reference fixture</title>' }))
    const reference = debrief.getByRole('link').first()
    await expect(reference).toHaveAttribute('target', '_blank')
    await expect(reference).toHaveAttribute('rel', 'noopener noreferrer')
    const [documentation] = await Promise.all([page.waitForEvent('popup'), reference.click()])
    await expect(documentation).toHaveURL(scenarioBundle.lessons[0].tasks[1].debrief!.references[0].url)
    expect(await documentation.evaluate(() => window.opener)).toBeNull()
    await documentation.close()
    await page.bringToFront()
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.inspect')
    await expect(debrief).toBeVisible()
    await panel.getByRole('button', { name: sidebarLabels.pause[language], exact: true }).click()
    await page.getByTestId('learning-open').click()
    await expect(debrief).toBeVisible()
    expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
    await panel.getByRole('button', { name: runnerLabels.next[language], exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.address-range')
    await expect(panel.locator('#learning-task')).toBeFocused()
    expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
    const practice = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
    await panel.getByRole('button', { name: runnerLabels.back[language], exact: true }).click()
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.inspect')
    await expect(debrief).toContainText('VNetPeering')
    await expect(panel.locator('#learning-debrief-title')).toBeFocused()
    await panel.getByRole('button', { name: runnerLabels.next[language], exact: true }).click()
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.address-range')
    expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(practice)
    const membership = scenarioBundle.checks.find((entry) => entry.id === 'private-link.address-check')!
    if (membership.kind !== 'quiz.answered') throw new Error('Membership quiz required')
    const wrong = membership.params.choices.find((choice) => choice.id !== membership.params.correctChoiceId)!
    await panel.getByRole('radio', { name: wrong.text[language], exact: true }).focus()
    await page.keyboard.press('Space')
    await panel.getByRole('button', { name: runnerLabels.submit[language], exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByTestId('learning-feedback')).toContainText(wrong.feedback[language])
    expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
    await completeLearningTasks(page, scenarioBundle.lessons[0].tasks.length - 3, language)
    const connected = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.topology.vnetPeerings, practiceWorkspaceKey)
    await completeLearningTasks(page, 1, language)
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'inspection-bypass.load')
    await expect(debrief).toContainText(language === 'en' ? 'hub VNet' : 'ハブ VNet')
    await page.waitForTimeout(2200)
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'inspection-bypass.load')
    const extended = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.topology, practiceWorkspaceKey)
    expect(extended.vnetPeerings).toEqual(connected)
    expect(extended.vnets.map((vnet: { id: string }) => vnet.id)).toEqual(['a', 'b', 'c', 'hub'])
    expect(extended.udrTables.map((table: { routes: unknown[] }) => table.routes)).toEqual([[], []])
    await panel.getByRole('button', { name: runnerLabels.back[language], exact: true }).click()
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.explain')
    await panel.getByRole('button', { name: runnerLabels.next[language], exact: true }).click()
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'inspection-bypass.load')
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.topology, practiceWorkspaceKey)).toEqual(extended)
    await advanceLearningTask(page, language)
    for (const vnetId of ['a', 'b']) {
      await expect(panel.getByTestId(`learning-guide-inspection-bypass.peer-${vnetId}`)).toBeVisible()
      await expect(panel.getByRole('button', { name: sidebarLabels.show[language], exact: true })).toHaveCount(1)
      await show(page, 'inspection-bypass.connect', `inspection-bypass.peer-${vnetId}`, language)
      await learningAnchor(page, 'peer-menu', vnetId).click()
      await learningAnchor(page, 'peer-target', vnetId, 'hub').click()
    }
    await advanceLearningTask(page, language)
    const applicationPolicy = await openTable(page, 'inspection-bypass.summary', 'application-policy', language)
    await applicationPolicy.getByRole('button', { name: '+ Add UDR Row', exact: true }).click()
    const inputs = applicationPolicy.locator('tbody tr').last().locator('input[type="text"]')
    await inputs.nth(1).fill('10.0.0.0/8')
    await inputs.nth(2).fill('10.20.1.4')
    await inputs.nth(2).press('Tab')
    await expect(panel.getByTestId('learning-guide-inspection-bypass.table-b-work')).toBeVisible()
    await expect(panel.getByTestId('learning-guide-inspection-bypass.table-a-work')).toBeHidden()
    await expect(panel.getByTestId('learning-debrief')).toHaveCount(0)
  })

  test(`${language}: repair has one primary guide, progressive hints and named secondary help without changing the network`, async ({ page }) => {
    test.setTimeout(60_000)
    const tasks = orderedTasks(scenarioBundle)
    const completions = tasks.slice(0, tasks.findIndex(({ task }) => task.id === 'tiered-incident.load'))
      .map(({ lesson, task }, revision) => ({
        courseId: scenarioBundle.course.id, contentVersion: scenarioBundle.course.contentVersion, lessonId: lesson.id, taskId: task.id,
        assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
        title: task.title, sessionId: 'earlier-missions', revision, scope: 1, engineVersion: 'earlier',
        completedAt: '2026-11-19T10:00:00.000Z',
      }))
    await page.addInitScript(({ key, completions }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, policyVersion: 1, completions }))
    }, { key: guidedProgressKey, completions })
    await page.goto('/?mode=full')
    await page.locator('header [data-language-selector]').selectOption(language)
    await page.getByTestId('learning-open').click()
    await completeLearningTasks(page, 2, language)
    const panel = learningSidebar(page)
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'tiered-incident.entry')
    await configureStage(page, 'tiered-incident.entry', language)
    await expect(panel.getByTestId('learning-debrief')).toContainText(language === 'en' ? 'does not yet certify' : 'まだ認定していません')
    await advanceLearningTask(page, language)
    await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', 'tiered-incident.repair')
    await expect(panel.getByRole('button', { name: sidebarLabels.show[language], exact: true })).toHaveCount(1)
    const secondary = panel.getByTestId('learning-guide-tiered-incident.table-leaf-work')
    await expect(secondary).toBeHidden()
    const awards = await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)
    const practice = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
    const first = panel.getByTestId('learning-hint-1'), second = panel.getByTestId('learning-hint-2')
    await expect(first.locator('p').first()).toBeHidden()
    await expect(second.locator('summary')).toBeHidden()
    await first.locator('summary').first().focus()
    await page.keyboard.press('Enter')
    await expect(first.locator('p').first()).toBeVisible()
    await second.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(second.locator('p')).toBeVisible()
    await show(page, 'tiered-incident.repair', 'tiered-incident.table-hub-work', language)
    await expect(learningAnchor(page, 'udr-route', 'hub', 'hub-work', 'inspection-onward', 'indirect-return')).toBeVisible()
    await learningOptions(page, language)
    await panel.getByText(sidebarLabels.navigationHelp[language], { exact: true }).click()
    await expect(secondary).toHaveText(language === 'en'
      ? 'Open Indirect workload / Workload routing policy.' : 'Indirect workload / Workload のルーティング ポリシーを開く。')
    await secondary.focus()
    await page.keyboard.press('Enter')
    await expect(learningAnchor(page, 'udr-route', 'leaf', 'leaf-work', 'indirect-egress', 'partner-service')).toBeVisible()
    await expect(panel.getByText(sidebarLabels.options[language], { exact: true }).locator('..')).not.toHaveAttribute('open', '')
    expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(practice)
    expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
    await repair(page, 'tiered-incident', language)
    await expect(panel.getByTestId('learning-debrief')).toBeVisible()
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), guidedProgressKey)
    expect(saved.completions).toHaveLength(JSON.parse(awards!).completions.length + 1)
  })

  test(`${language}: complete the scenario edition through real native controls and preserve the design`, async ({ page }) => {
    test.setTimeout(420_000)
    await page.goto('/?mode=full')
    await page.locator('header [data-language-selector]').selectOption(language)
    const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.getByTestId('learning-open').click()
    const panel = learningSidebar(page)
    for (const { lesson, task } of orderedTasks(scenarioBundle)) {
      await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', task.id)
      const check = scenarioBundle.checks.find((entry) => entry.id === task.checkId)!
      if (check.kind === 'scenario.loaded') {
        if (lesson.id === scenarioBundle.course.lessonOrder[0]) await loadLearningNetwork(page, language)
        else await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.scenarioId, practiceWorkspaceKey)).toBe(lesson.scenarioId)
      }
      if (task.id === 'inspection-bypass.connect') {
        for (const vnetId of ['a', 'b']) {
          await show(page, task.id, `inspection-bypass.peer-${vnetId}`, language)
          await learningAnchor(page, 'peer-menu', vnetId).click()
          await learningAnchor(page, 'peer-target', vnetId, 'hub').click()
        }
      }
      if (task.id === 'inspection-bypass.summary') {
        for (const tableId of ['application-policy', 'partner-policy']) {
          const card = await openTable(page, task.id, tableId, language)
          await card.getByRole('button', { name: '+ Add UDR Row', exact: true }).click()
          const inputs = card.locator('tbody tr').last().locator('input[type="text"]')
          await inputs.nth(1).fill('10.0.0.0/8')
          await inputs.nth(2).fill('10.20.1.4')
          await inputs.nth(2).press('Tab')
        }
      }
      if (check.kind === 'udrs.configured' && task.id !== 'inspection-bypass.summary') await configureStage(page, task.id, language)
      if (check.kind === 'routes.inspected' || check.kind === 'control-routes.inspected') {
        if (task.id === 'ha-return-path.verify') await probeHa(page, task.id, language, 'symmetric')
        await panel.getByRole('button', { name: sidebarLabels.show[language], exact: true }).click()
      }
      if (check.kind === 'connections.configured') {
        await configureHybrid(page, task.id, language)
      }
      if ((check.kind === 'requirements.satisfied' || check.kind === 'hub-associations.configured') && !task.id.endsWith('.connect')) {
        await repair(page, lesson.id, language)
      }
      if (check.kind === 'quiz.answered') {
        if (task.id === 'ha-return-path.diagnose') await probeHa(page, task.id, language, 'asymmetric')
        const answer = check.params.choices.find((choice) => choice.id === check.params.correctChoiceId)!
        await panel.getByRole('radio', { name: answer.text[language], exact: true }).check()
        await panel.getByRole('button', { name: runnerLabels.submit[language], exact: true }).click()
      }
      await expect(panel.getByTestId('learning-debrief')).toContainText(task.debrief!.paragraphs[0][language], { timeout: 15_000 })
      await advanceLearningTask(page, language)
      await expect(panel.locator(`[data-task-id="${task.id}"]`)).toHaveCount(0)
    }
    await expect(panel.getByRole('heading', { name: runnerLabels.done[language], exact: true })).toBeVisible()
    const tasks = orderedTasks(scenarioBundle)
    const points = tasks.reduce((sum, { task }) => sum + task.points, 0)
    await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? `Black belt · ${points} points` : `黒帯 · ${points} ポイント`)
    await page.getByTestId('practice-workspace-bar').getByRole('button', { name: language === 'en' ? 'Return to my design' : '自分の設計に戻る', exact: true }).click()
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
    await page.reload()
    await expect(page.getByTestId('learning-status')).toContainText(String(points))
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), guidedProgressKey)
    expect(saved.completions).toHaveLength(tasks.length)
    expect(new Set(saved.completions.map((entry: { awardId: string }) => entry.awardId)).size).toBe(tasks.length)
  })
}

test('default mobile workspace reveals the scoped HA packet form without changing practice or awards', async ({ page }) => {
  const completions = orderedTasks(scenarioBundle).filter(({ lesson }) =>
    scenarioBundle.course.lessonOrder.indexOf(lesson.id) < scenarioBundle.course.lessonOrder.indexOf('ha-return-path'))
    .map(({ lesson, task }, revision) => ({
      courseId: scenarioBundle.course.id, contentVersion: 2, lessonId: lesson.id, taskId: task.id,
      assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
      title: task.title, sessionId: 'earlier-missions', revision, scope: 1, engineVersion: 'earlier',
      completedAt: '2026-11-18T12:00:00.000Z',
    }))
  await page.addInitScript(({ key, completions }) => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, policyVersion: 1, completions }))
  }, { key: guidedProgressKey, completions })
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/?mode=full')
  await page.getByTestId('learning-open').click()
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'ha-return-path.load')
  await completeLearningTasks(page, 2)
  const awards = await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)
  await probeHa(page, 'ha-return-path.diagnose', 'en', 'asymmetric')
  expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'ha-return-path.diagnose')
})

test('default mobile table guidance preserves practice and requires each exact multi-hub observation', async ({ page }) => {
  const tasks = orderedTasks(scenarioBundle)
  const completions = tasks.slice(0, tasks.findIndex(({ task }) => task.id === 'multihub-labels.load'))
    .map(({ lesson, task }, revision) => ({
      courseId: scenarioBundle.course.id, contentVersion: scenarioBundle.course.contentVersion, lessonId: lesson.id, taskId: task.id,
      assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
      title: task.title, sessionId: 'earlier-missions', revision, scope: 1, engineVersion: 'earlier',
      completedAt: '2026-11-18T12:00:00.000Z',
    }))
  await page.addInitScript(({ key, completions }) => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, policyVersion: 1, completions }))
  }, { key: guidedProgressKey, completions })
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('learning-status')).toHaveAttribute('title', new RegExp(`Scenario edition · Black belt · ${completions.reduce((sum, task) => sum + task.points, 0)} points · Core belts completed$`))
  await page.getByTestId('learning-open').click()
  await completeLearningTasks(page, 1)
  const before = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
  const awards = await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)
  await show(page, 'multihub-labels.inspect', 'multihub-labels.source-guide', 'en')
  await expect(learningAnchor(page, 'hub-effective-table', 'west-hub', 'west-workloads')).toBeVisible()
  await expect(page.getByTestId('learning-record-inspection')).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
  expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
  await page.getByRole('combobox', { name: 'Hub routing table', exact: true }).selectOption('defaultRouteTable')
  await expect(page.getByTestId('learning-record-inspection')).toHaveCount(0)
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'multihub-labels.inspect')
  await completeLearningTasks(page, 1)
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'multihub-labels.compare')
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'multihub-labels.compare')
  await learningOptions(page)
  await show(page, 'multihub-labels.compare', 'multihub-labels.return-guide', 'en')
  await expect(learningAnchor(page, 'hub-effective-table', 'east-hub', 'east-services')).toBeVisible()
  const routes = page.getByRole('region', { name: 'Requested router BGP table', exact: true })
  const prefix = learningAnchor(page, 'hub-effective-prefix', 'east-hub', 'east-services', '10.101.0.0/16').locator('code').first()
  await prefix.evaluate((element) => {
    const scroll = element.closest('.table-scroll')!
    scroll.scrollLeft += element.getBoundingClientRect().right - scroll.getBoundingClientRect().left + 8
  })
  await expect(prefix).not.toBeInViewport()
  await learningSidebar(page).getByText('Progress, review & options', { exact: true }).click()
  await page.waitForTimeout(3500)
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'multihub-labels.compare')
  await expect(learningSidebar(page).getByTestId('learning-feedback')).toHaveCount(0)
  await routes.evaluate((element) => { element.scrollLeft = 0 })
  await expect(prefix).toBeInViewport()
  await advanceLearningTask(page)
  await expect(learningSidebar(page).locator('[data-task-id="multihub-labels.compare"]')).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
})

test('default mobile connection guidance never configures the assessed hybrid backup', async ({ page }) => {
  const completions = orderedTasks(scenarioBundle).filter(({ lesson }) =>
    scenarioBundle.course.lessonOrder.indexOf(lesson.id) < scenarioBundle.course.lessonOrder.indexOf('hybrid-preference'))
    .map(({ lesson, task }, revision) => ({
      courseId: scenarioBundle.course.id, contentVersion: scenarioBundle.course.contentVersion, lessonId: lesson.id, taskId: task.id,
      assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
      title: task.title, sessionId: 'earlier-missions', revision, scope: 1, engineVersion: 'earlier',
      completedAt: '2026-11-18T12:00:00.000Z',
    }))
  await page.addInitScript(({ key, completions }) => {
    localStorage.setItem('aznet-ui-preview:v1', 'true')
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, policyVersion: 1, completions }))
  }, { key: guidedProgressKey, completions })
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('learning-status')).toHaveAttribute('title', new RegExp(`Scenario edition · Black belt · ${completions.reduce((sum, task) => sum + task.points, 0)} points · Core belts completed$`))
  await page.getByTestId('learning-open').click()
  await completeLearningTasks(page, 2)
  const before = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
  const awards = await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)
  await show(page, 'hybrid-preference.repair', 'hybrid-preference.vpn-guide', 'en')
  await expect(learningAnchor(page, 'connection-editor', 'vpn-connection', 'branch-vpn')).toBeVisible()
  await expect(page.getByTestId('aznet-hybrid-connection-editor').locator('input[name="enabled"]')).not.toBeChecked()
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(before)
  expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(awards)
})

test('historical black belt stays intact across explicit edition opt-in, reload and return', async ({ page }) => {
  const completions = orderedTasks(exampleCourse).map(({ lesson, task }, revision) => ({
    courseId: exampleCourse.course.id, contentVersion: 4, lessonId: lesson.id, taskId: task.id,
    assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
    title: task.title, sessionId: 'historical-session', revision, scope: 1, engineVersion: 'historical',
    completedAt: '2026-11-16T12:00:00.000Z',
  }))
  await page.addInitScript(({ key, completions }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, policyVersion: 1, completions }))
  }, { key: guidedProgressKey, completions })
  await page.goto('/?mode=full')
  await expect(page.getByTestId('learning-status')).toContainText('Original edition - Black belt · 1325 points')
  const raw = await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)
  await page.getByTestId('learning-status').click()
  const details = page.getByTestId('learning-status-details')
  await details.getByRole('button', { name: 'Switch to Scenario edition', exact: true }).click()
  await details.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate((key) => localStorage.getItem(key), guidedProgressKey)).toBe(raw)
  await details.getByRole('button', { name: 'Switch to Scenario edition', exact: true }).click()
  await details.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Scenario edition - White belt · 0 points')
  await expect(details).toContainText('Original edition: 1325 points')
  await page.reload()
  await expect(page.getByTestId('learning-status')).toContainText('Scenario edition - White belt')
  await page.getByTestId('learning-status').click()
  await details.getByRole('button', { name: 'Switch to Original edition', exact: true }).click()
  await details.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Original edition - Black belt · 1325 points')
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), guidedProgressKey)
  expect(saved.completions).toEqual(completions)
})

test('sidebar edition switching preserves an active practice canvas and separate progress', async ({ page }) => {
  await page.goto('/?mode=full')
  await page.getByTestId('learning-open').click()
  await completeLearningTasks(page, 2)
  const current = await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)
  await learningOptions(page)
  await learningSidebar(page).getByRole('button', { name: 'Curriculum editions & learning data', exact: true }).click()
  let details = page.getByTestId('learning-status-details')
  await details.getByRole('button', { name: 'Switch to Original edition', exact: true }).click()
  await details.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Original edition - White belt · 0 points')
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', orderedTasks(exampleCourse)[0].task.id)
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(current)
  await details.getByRole('button', { name: 'Close learning status', exact: true }).click()
  await learningOptions(page)
  await learningSidebar(page).getByRole('button', { name: 'Curriculum editions & learning data', exact: true }).click()
  details = page.getByTestId('learning-status-details')
  await details.getByRole('button', { name: 'Switch to Scenario edition', exact: true }).click()
  await details.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Scenario edition - White belt · 10 points')
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.address-range')
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(current)
})

test('header and sidebar share a single accessible learning-status panel', async ({ page }) => {
  await page.goto('/?mode=full')
  await page.getByTestId('learning-open').click()
  await learningOptions(page)
  await page.getByTestId('learning-status').click()
  await expect(page.getByTestId('learning-status-details')).toHaveCount(1)
  await learningSidebar(page).getByRole('button', { name: 'Curriculum editions & learning data', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('learning-status-details')).toHaveCount(1)
  await expect(page.getByTestId('learning-status')).toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('learning-status-details').getByRole('button', { name: 'Close learning status', exact: true }).click()
  await expect(page.getByTestId('learning-status-details')).toHaveCount(0)
  await expect(page.getByTestId('learning-status')).toHaveAttribute('aria-expanded', 'false')
})
