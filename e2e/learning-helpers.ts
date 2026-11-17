import { expect, type Page } from '@playwright/test'
import { exampleCourse } from '../src/learning/course-examples'
import { scenarioBundle } from '../src/learning/scenario-course'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { guidanceAnchor } from '../src/learning/guidance'
import { runnerLabels } from '../src/learning/runner-content'
import { sidebarLabels } from '../src/learning/sidebar-content'
import { practiceLabels } from '../src/learning/practice-content'

export const learningSidebar = (page: Page) => page.getByTestId('learning-sidebar')
export const learningAnchor = (page: Page, ...scope: string[]) =>
  page.locator(`[data-learning-anchor=${JSON.stringify(guidanceAnchor(...scope))}]`)

export async function loadLearningNetwork(page: Page, language: 'en' | 'ja' = 'en') {
  const sidebar = learningSidebar(page)
  await sidebar.getByRole('button', { name: sidebarLabels.load[language], exact: true }).click()
  await sidebar.getByRole('button', { name: sidebarLabels.confirm[language], exact: true }).click()
  await expect(page.getByTestId('practice-workspace-bar')).toContainText(practiceLabels.practiceProtected[language])
  await expect(sidebar.getByRole('button', { name: runnerLabels.check[language], exact: true })).toBeEnabled()
}

export async function createLessonPeering(page: Page, language: 'en' | 'ja' = 'en') {
  await learningSidebar(page).getByRole('button', { name: sidebarLabels.show[language], exact: true }).first().click()
  await learningAnchor(page, 'peer-menu', 'a').click()
  await learningAnchor(page, 'peer-target', 'a', 'b').click()
}

/** Drive real controls and checks, never mutate browser progress or inject completion. */
export async function completeLearningTasks(page: Page, count = 1, language: 'en' | 'ja' = 'en') {
  const sidebar = learningSidebar(page)
  for (let index = 0; index < count; index++) {
    const taskId = await sidebar.getByTestId('learning-task').getAttribute('data-task-id')
    const bundle = exampleCourse.lessons.some((item) => item.tasks.some((task) => task.id === taskId)) ? exampleCourse : scenarioBundle
    const lesson = bundle.lessons.find((item) => item.tasks.some((task) => task.id === taskId))!
    const task = lesson.tasks.find((item) => item.id === taskId)!
    const check = bundle.checks.find((item) => item.id === task.checkId)!
    if (check.kind === 'scenario.loaded') {
      const current = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), practiceWorkspaceKey)
      if (!current?.active || current.scenarioId !== lesson.scenarioId) await loadLearningNetwork(page, language)
    }
    if (check.kind === 'quiz.answered') {
      const choice = check.params.choices.find((item) => item.id === check.params.correctChoiceId)!
      await sidebar.getByRole('radio', { name: choice.text[language], exact: true }).check()
    }
    if (check.kind === 'routes.inspected') {
      await sidebar.getByRole('button', { name: sidebarLabels.show[language], exact: true }).click()
      await page.getByTestId('learning-record-inspection').click()
    }
    if (check.kind === 'vnet.peered') await createLessonPeering(page, language)
    if (taskId === 'private-link.repair') {
      const current = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), practiceWorkspaceKey)
      if (!current.document.topology.vnetPeerings.some((peer: { vnetAId: string; vnetBId: string }) =>
        [peer.vnetAId, peer.vnetBId].includes('a') && [peer.vnetAId, peer.vnetBId].includes('b'))) await createLessonPeering(page, language)
    }
    const repair = task.guidanceIds.map((id) => bundle.guidance.find((item) => item.id === id)!)
      .find((target) => target.action === 'route-table.configure')
    if (check.kind === 'requirements.satisfied' && repair?.action === 'route-table.configure') {
      await sidebar.getByRole('button', { name: sidebarLabels.show[language], exact: true }).click()
      const { vnetId, subnetId, routeTableId, routeId } = repair.params
      await learningAnchor(page, 'udr-route', vnetId, subnetId, routeTableId, routeId!).locator('input[type="checkbox"]').uncheck()
    }
    await sidebar.getByRole('button', { name: runnerLabels.check[language], exact: true }).click()
    await expect(sidebar.getByTestId('learning-feedback')).toContainText(runnerLabels.passed[language])
    await sidebar.getByRole('button', { name: runnerLabels.continue[language], exact: true }).click()
  }
}
