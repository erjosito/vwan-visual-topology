import type { CourseBundle } from './course-contract'

export const peeringCheckpoint = { taskId: 'peering.explain', assessmentVersion: 1, checkId: 'explain-nontransitive' }
export const overrideCheckpoint = { taskId: 'override.explain', assessmentVersion: 1, checkId: 'explain-udr' }
export const prefixCheckpoint = { taskId: 'prefix.explain', assessmentVersion: 1, checkId: 'explain-prefix' }
export const gatewayCheckpoint = { taskId: 'gateway.explain', assessmentVersion: 1, checkId: 'explain-gateway' }
export const wanCheckpoint = { taskId: 'wan.explain', assessmentVersion: 1, checkId: 'explain-wan' }
export const capstoneCheckpoint = { taskId: 'capstone.explain', assessmentVersion: 1, checkId: 'explain-capstone' }
export const previewCourse: CourseBundle['course'] = {
  id: 'azure-networking-preview', contentVersion: 4, publication: 'complete',
  title: { en: 'Routing foundations', ja: 'ルーティングの基礎' },
  lessonOrder: ['direct-peering', 'route-override', 'prefix-outage', 'gateway-return', 'secured-wan', 'hybrid-incident'],
  belts: [
    { id: 'white', name: { en: 'White belt', ja: '白帯' }, color: '#ffffff', pointsRequired: 0, checkpointTaskIds: [] },
    { id: 'yellow', name: { en: 'Yellow belt', ja: '黄帯' }, color: '#eab308', pointsRequired: 100, checkpointTaskIds: [peeringCheckpoint.taskId] },
    { id: 'orange', name: { en: 'Orange belt', ja: '橙帯' }, color: '#ea580c', pointsRequired: 175, checkpointTaskIds: [overrideCheckpoint.taskId] },
    { id: 'green', name: { en: 'Green belt', ja: '緑帯' }, color: '#15803d', pointsRequired: 325, checkpointTaskIds: [prefixCheckpoint.taskId] },
    { id: 'blue', name: { en: 'Blue belt', ja: '青帯' }, color: '#2563eb', pointsRequired: 550, checkpointTaskIds: [gatewayCheckpoint.taskId] },
    { id: 'brown', name: { en: 'Brown belt', ja: '茶帯' }, color: '#92400e', pointsRequired: 875, checkpointTaskIds: [wanCheckpoint.taskId] },
    { id: 'black', name: { en: 'Black belt', ja: '黒帯' }, color: '#171717', pointsRequired: 1325, checkpointTaskIds: [capstoneCheckpoint.taskId] },
  ],
}
export const checkpointAssessments = [peeringCheckpoint, overrideCheckpoint, prefixCheckpoint, gatewayCheckpoint, wanCheckpoint, capstoneCheckpoint]
