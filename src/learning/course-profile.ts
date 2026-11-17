import type { CourseBundle } from './course-contract'

export const peeringCheckpoint = { taskId: 'peering.explain', assessmentVersion: 1, checkId: 'explain-nontransitive' }
export const previewCourse: CourseBundle['course'] = {
  id: 'azure-networking-preview', contentVersion: 2, publication: 'preview',
  title: { en: 'Azure networking: guided practice', ja: 'Azure ネットワーク: ガイド付き練習' },
  lessonOrder: ['direct-peering', 'route-override'],
  belts: [
    { id: 'white', name: { en: 'White belt', ja: '白帯' }, color: '#ffffff', pointsRequired: 0, checkpointTaskIds: [] },
    { id: 'yellow', name: { en: 'Yellow belt', ja: '黄帯' }, color: '#eab308', pointsRequired: 100, checkpointTaskIds: [peeringCheckpoint.taskId] },
  ],
}
export const checkpointAssessments = [peeringCheckpoint]
