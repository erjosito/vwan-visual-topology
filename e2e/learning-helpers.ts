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

export async function advanceLearningTask(page: Page, language: 'en' | 'ja' = 'en') {
  await expect(learningSidebar(page).getByTestId('learning-debrief')).toBeVisible()
  if (await learningSidebar(page).getByTestId('learning-belt-earned').count()) {
    const celebration = page.getByTestId('learning-belt-dialog')
    if (await celebration.count()) await celebration.getByRole('button', { name: language === 'ja' ? '学習に戻る' : 'Continue learning', exact: true }).click()
  }
  await learningSidebar(page).getByRole('button', { name: runnerLabels.next[language], exact: true }).click()
}

export async function learningOptions(page: Page, language: 'en' | 'ja' = 'en') {
  const summary = learningSidebar(page).getByText(sidebarLabels.options[language], { exact: true })
  if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click()
}

export async function loadLearningNetwork(page: Page, language: 'en' | 'ja' = 'en') {
  await page.bringToFront()
  const sidebar = learningSidebar(page)
  await expect(sidebar.getByRole('button', { name: sidebarLabels.pause[language], exact: true })).toBeVisible()
  const load = sidebar.getByRole('button', { name: sidebarLabels.load[language], exact: true })
  if (await load.count()) await load.click()
  else {
    await learningOptions(page, language)
    await sidebar.getByRole('button', { name: sidebarLabels.restart[language], exact: true }).click()
    await sidebar.getByText(sidebarLabels.options[language], { exact: true }).click()
  }
  await sidebar.getByRole('button', { name: sidebarLabels.confirm[language], exact: true }).click()
  await expect(page.getByTestId('practice-workspace-bar')).toContainText(practiceLabels.practiceProtected[language])
  await expect(sidebar.getByRole('button', { name: sidebarLabels.pause[language], exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(sidebar.locator('[data-learning-confirm]')).toHaveCount(0)
}

export async function createLessonPeering(page: Page, language: 'en' | 'ja' = 'en') {
  await learningSidebar(page).getByRole('button', { name: sidebarLabels.show[language], exact: true }).first().click()
  await learningAnchor(page, 'peer-menu', 'a').click()
  await learningAnchor(page, 'peer-target', 'a', 'b').click()
}

/** Drive real controls and checks, never mutate browser progress or inject completion. */
export async function completeLearningTasks(page: Page, count = 1, language: 'en' | 'ja' = 'en') {
  await page.bringToFront()
  const sidebar = learningSidebar(page)
  for (let index = 0; index < count; index++) {
    const taskId = await sidebar.getByTestId('learning-task').getAttribute('data-task-id')
    const bundle = exampleCourse.lessons.some((item) => item.tasks.some((task) => task.id === taskId)) ? exampleCourse : scenarioBundle
    const lesson = bundle.lessons.find((item) => item.tasks.some((task) => task.id === taskId))!
    const task = lesson.tasks.find((item) => item.id === taskId)!
    const check = bundle.checks.find((item) => item.id === task.checkId)!
    if (await sidebar.getByTestId('learning-next').count()) {
      await advanceLearningTask(page, language)
      await expect(sidebar.locator(`[data-task-id="${taskId}"]`)).toHaveCount(0)
      continue
    }
    if (check.kind === 'scenario.loaded') {
      const current = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), practiceWorkspaceKey)
      if (!current?.active || current.courseId !== bundle.course.id) await loadLearningNetwork(page, language)
      else await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.scenarioId, practiceWorkspaceKey)).toBe(lesson.scenarioId)
    }
    if (check.kind === 'quiz.answered') {
      const choice = check.params.choices.find((item) => item.id === check.params.correctChoiceId)!
      await sidebar.getByRole('radio', { name: choice.text[language], exact: true }).check()
      await sidebar.getByRole('button', { name: runnerLabels.submit[language], exact: true }).click()
    }
    if (check.kind === 'routes.inspected' || check.kind === 'control-routes.inspected') {
      await sidebar.getByRole('button', { name: sidebarLabels.show[language], exact: true }).click()
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
    await advanceLearningTask(page, language)
    await expect(sidebar.locator(`[data-task-id="${taskId}"]`)).toHaveCount(0)
  }
}
