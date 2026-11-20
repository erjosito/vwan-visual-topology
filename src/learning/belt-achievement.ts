import type { CourseBundle } from './course-contract'
import { beltProgress } from './progress-ledger'
import type { TaskCompletion } from './runner'

export type BeltAchievement = { courseId: string; previousBeltId: string; beltId: string }

export function newBeltAchievement(bundle: CourseBundle, before: readonly TaskCompletion[], after: readonly TaskCompletion[]): BeltAchievement | undefined {
  const assessments = bundle.lessons.flatMap((lesson) => lesson.tasks)
    .map((task) => ({ taskId: task.id, assessmentVersion: task.assessmentVersion, checkId: task.checkId }))
  const rank = (completions: readonly TaskCompletion[]) => {
    const progress = beltProgress({ version: 1, policyVersion: 1, completions: [...completions] }, bundle.course, assessments)
    return bundle.course.belts.findIndex((belt) => belt.id === progress.belt.id)
  }
  const previous = rank(before), next = rank(after)
  if (next <= previous) return undefined
  return { courseId: bundle.course.id, previousBeltId: bundle.course.belts[previous].id, beltId: bundle.course.belts[next].id }
}
