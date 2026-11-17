import { checkpointAssessments, previewCourse } from './course-profile'
import type { CourseBundle } from './course-contract'
import type { ProgressLedger } from './progress-ledger'

export const scenarioLessonOrder = ['private-link', 'inspection-bypass', 'colocated-chain', 'dedicated-chain', 'branch-advertisement', 'wan-isolation', 'tiered-incident']
export const scenarioAssessments = scenarioLessonOrder.map((id) => ({ taskId: `${id}.explain`, assessmentVersion: 1, checkId: `${id}.quiz` }))
export const scenarioCourse: CourseBundle['course'] = {
  id: 'azure-routing-scenarios', contentVersion: 1, publication: 'complete',
  title: previewCourse.title, lessonOrder: scenarioLessonOrder,
  belts: previewCourse.belts.map((belt, index) => ({
    ...belt, pointsRequired: [0, 100, 225, 425, 675, 1075, 1325][index],
    checkpointTaskIds: index === 0 ? [] : scenarioAssessments.slice(0, [0, 1, 2, 3, 4, 6, 7][index]).map((entry) => entry.taskId),
  })),
}
export const editions = [
  { course: previewCourse, assessments: checkpointAssessments, name: { en: 'Original edition', ja: '従来版' } },
  { course: scenarioCourse, assessments: scenarioAssessments, name: { en: 'Scenario edition', ja: 'シナリオ版' } },
]
export function selectedEdition(ledger?: ProgressLedger, practiceCourseId?: string) {
  const id = ledger?.enrollment ?? (ledger?.completions.some((entry) => entry.courseId === previewCourse.id)
    ? previewCourse.id : practiceCourseId ?? scenarioCourse.id)
  return editions.find((entry) => entry.course.id === id) ?? editions[1]
}
