import { expect, type Page } from '@playwright/test'
import { exampleCourse } from '../src/learning/course-examples'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { guidanceAnchor } from '../src/learning/guidance'

export const learningSidebar = (page: Page) => page.getByTestId('learning-sidebar')
export const learningAnchor = (page: Page, ...scope: string[]) =>
  page.locator(`[data-learning-anchor=${JSON.stringify(guidanceAnchor(...scope))}]`)

export async function loadLearningNetwork(page: Page) {
  const sidebar = learningSidebar(page)
  await sidebar.getByRole('button', { name: 'Load practice network', exact: true }).click()
  await sidebar.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
  await expect(page.getByTestId('practice-workspace-bar')).toContainText('your normal design is kept separately')
  await expect(sidebar.getByRole('button', { name: 'Check task', exact: true })).toBeEnabled()
}

export async function createLessonPeering(page: Page) {
  await learningSidebar(page).getByRole('button', { name: 'Show me where', exact: true }).click()
  await learningAnchor(page, 'peer-menu', 'a').click()
  await learningAnchor(page, 'peer-target', 'a', 'b').click()
}

/** Drive real controls and checks, never mutate browser progress or inject completion. */
export async function completeLearningTasks(page: Page, count = 1) {
  const sidebar = learningSidebar(page)
  for (let index = 0; index < count; index++) {
    const taskId = await sidebar.getByTestId('learning-task').getAttribute('data-task-id')
    const lesson = exampleCourse.lessons.find((item) => item.tasks.some((task) => task.id === taskId))!
    const task = lesson.tasks.find((item) => item.id === taskId)!
    const check = exampleCourse.checks.find((item) => item.id === task.checkId)!
    if (check.kind === 'scenario.loaded') {
      const current = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), practiceWorkspaceKey)
      if (!current?.active || current.scenarioId !== lesson.scenarioId) await loadLearningNetwork(page)
    }
    if (check.kind === 'quiz.answered') {
      const choice = check.params.choices.find((item) => item.id === check.params.correctChoiceId)!
      await sidebar.getByRole('radio', { name: choice.text.en, exact: true }).check()
    }
    if (check.kind === 'routes.inspected') {
      await sidebar.getByRole('button', { name: 'Show me where', exact: true }).click()
      await page.getByTestId('learning-record-inspection').click()
    }
    if (check.kind === 'vnet.peered') await createLessonPeering(page)
    const repair = task.guidanceIds.map((id) => exampleCourse.guidance.find((item) => item.id === id)!)
      .find((target) => target.action === 'route-table.configure')
    if (check.kind === 'requirements.satisfied' && repair?.action === 'route-table.configure') {
      await sidebar.getByRole('button', { name: 'Show me where', exact: true }).click()
      const { vnetId, subnetId, routeTableId, routeId } = repair.params
      await learningAnchor(page, 'udr-route', vnetId, subnetId, routeTableId, routeId).locator('input[type="checkbox"]').uncheck()
    }
    await sidebar.getByRole('button', { name: 'Check task', exact: true }).click()
    await expect(sidebar.getByTestId('learning-feedback')).toContainText('current check passed')
    await sidebar.getByRole('button', { name: 'Complete task & continue', exact: true }).click()
  }
}
