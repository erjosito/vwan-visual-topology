import { expect, test, type Page } from '@playwright/test'
import { scenarioBundle } from '../src/learning/scenario-course'
import { exampleCourse } from '../src/learning/course-examples'
import { orderedTasks } from '../src/learning/runner'
import { guidedProgressKey } from '../src/learning/progress-ledger'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { sidebarLabels } from '../src/learning/sidebar-content'
import { runnerLabels } from '../src/learning/runner-content'
import { completeLearningTasks, createLessonPeering, learningAnchor, learningSidebar, loadLearningNetwork } from './learning-helpers'

async function show(page: Page, taskId: string, guidanceId: string, language: 'en' | 'ja') {
  const task = scenarioBundle.lessons.flatMap((lesson) => lesson.tasks).find((task) => task.id === taskId)!
  await learningSidebar(page).getByRole('button', { name: sidebarLabels.show[language], exact: true })
    .nth(task.guidanceIds.indexOf(guidanceId)).click()
}
async function openTable(page: Page, taskId: string, tableId: string, language: 'en' | 'ja') {
  const cue = scenarioBundle.guidance.find((entry) => entry.id.startsWith(taskId.split('.')[0])
    && entry.action === 'route-table.configure' && entry.params.routeTableId === tableId)!
  await show(page, taskId, cue.id, language)
  return page.getByTestId(`aznet-rt-card-${tableId}`)
}
async function repair(page: Page, id: string, language: 'en' | 'ja') {
  const taskId = `${id}.repair`
  if (id === 'private-link') await createLessonPeering(page, language)
  if (id === 'inspection-bypass') {
    for (const [tableId, prefix] of [['application-policy', '10.22.0.0/16'], ['partner-policy', '10.21.0.0/16']]) {
      const card = await openTable(page, taskId, tableId, language)
      await card.getByRole('button', { name: '+ Add UDR Row', exact: true }).click()
      await card.locator('tbody tr').last().locator('input[type="text"]').nth(1).fill(prefix)
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
    await openTable(page, taskId, 'indirect-egress', language)
    await learningAnchor(page, 'udr-route', 'leaf', 'leaf-work', 'indirect-egress', 'partner-service').getByRole('checkbox').check()
    await learningSidebar(page).getByRole('button', { name: runnerLabels.check[language], exact: true }).click()
    await expect(learningSidebar(page).getByRole('button', { name: runnerLabels.continue[language], exact: true })).toBeDisabled()
    await openTable(page, taskId, 'inspection-onward', language)
    await learningAnchor(page, 'udr-route', 'hub', 'hub-work', 'inspection-onward', 'indirect-return')
      .locator('input[type="text"]').nth(2).fill('10.21.3.4')
  }
}

for (const language of ['en', 'ja'] as const) {
  test(`${language}: complete the scenario edition through real native controls and preserve the design`, async ({ page }) => {
    test.setTimeout(240_000)
    await page.goto('/?mode=full')
    await page.locator('header [data-language-selector]').selectOption(language)
    const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.getByTestId('learning-open').click()
    const panel = learningSidebar(page)
    for (const { lesson, task } of orderedTasks(scenarioBundle)) {
      await expect(panel.getByTestId('learning-task')).toHaveAttribute('data-task-id', task.id)
      const check = scenarioBundle.checks.find((entry) => entry.id === task.checkId)!
      if (check.kind === 'scenario.loaded') await loadLearningNetwork(page, language)
      if (check.kind === 'routes.inspected') {
        await panel.getByRole('button', { name: sidebarLabels.show[language], exact: true }).click()
        await page.getByTestId('learning-record-inspection').click()
      }
      if (check.kind === 'requirements.satisfied') {
        await panel.getByRole('button', { name: runnerLabels.check[language], exact: true }).click()
        await expect(panel.getByRole('button', { name: runnerLabels.continue[language], exact: true })).toBeDisabled()
        await repair(page, lesson.id, language)
      }
      if (check.kind === 'quiz.answered') {
        const answer = check.params.choices.find((choice) => choice.id === check.params.correctChoiceId)!
        await panel.getByRole('radio', { name: answer.text[language], exact: true }).check()
      }
      await panel.getByRole('button', { name: runnerLabels.check[language], exact: true }).click()
      await expect(panel.getByTestId('learning-feedback')).toContainText(runnerLabels.passed[language])
      await panel.getByRole('button', { name: runnerLabels.continue[language], exact: true }).click()
    }
    await expect(panel.getByRole('heading', { name: runnerLabels.done[language], exact: true })).toBeVisible()
    await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? 'Black belt · 1325 points' : '黒帯 · 1325 ポイント')
    await page.getByTestId('practice-workspace-bar').getByRole('button', { name: language === 'en' ? 'Return to my design' : '自分の設計に戻る', exact: true }).click()
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
    await page.reload()
    await expect(page.getByTestId('learning-status')).toContainText('1325')
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), guidedProgressKey)
    expect(saved.completions).toHaveLength(35)
    expect(new Set(saved.completions.map((entry: { awardId: string }) => entry.awardId)).size).toBe(35)
  })
}

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
  await learningSidebar(page).getByRole('button', { name: 'Curriculum editions', exact: true }).click()
  let details = page.getByTestId('learning-status-details')
  await details.getByRole('button', { name: 'Switch to Original edition', exact: true }).click()
  await details.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Original edition - White belt · 0 points')
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', orderedTasks(exampleCourse)[0].task.id)
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(current)
  await details.getByRole('button', { name: 'Close learning status', exact: true }).click()
  await learningSidebar(page).getByRole('button', { name: 'Curriculum editions', exact: true }).click()
  details = page.getByTestId('learning-status-details')
  await details.getByRole('button', { name: 'Switch to Scenario edition', exact: true }).click()
  await details.getByRole('button', { name: 'Confirm edition switch', exact: true }).click()
  await expect(page.getByTestId('learning-status')).toContainText('Scenario edition - White belt · 10 points')
  await expect(learningSidebar(page).getByTestId('learning-task')).toHaveAttribute('data-task-id', 'private-link.repair')
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe(current)
})

test('header and sidebar share a single accessible learning-status panel', async ({ page }) => {
  await page.goto('/?mode=full')
  await page.getByTestId('learning-open').click()
  await page.getByTestId('learning-status').click()
  await expect(page.getByTestId('learning-status-details')).toHaveCount(1)
  await learningSidebar(page).getByRole('button', { name: 'Curriculum editions', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('learning-status-details')).toHaveCount(1)
  await expect(page.getByTestId('learning-status')).toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('learning-status-details').getByRole('button', { name: 'Close learning status', exact: true }).click()
  await expect(page.getByTestId('learning-status-details')).toHaveCount(0)
  await expect(page.getByTestId('learning-status')).toHaveAttribute('aria-expanded', 'false')
})
