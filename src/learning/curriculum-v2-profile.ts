import type { CourseBundle } from './course-contract'
import { previewCourse } from './course-profile'

const lessons = ['peering', 'firewall', 'wan', 'secured-wan', 'static-vpn', 'bgp', 'expressroute', 'er-locations', 'vpn-backup', 'nva-ha', 'segmentation', 'handover'].map((id) => `v2-${id}`)
export const curriculumV2Assessments = lessons.map((id) => ({
  taskId: `${id}.checkpoint`, assessmentVersion: 1, checkId: `${id}.checkpoint.check`,
}))
const thresholds = [80, 225, 300, 390, 505, 625, 735, 845, 930, 1080, 1190, 1345]
export const curriculumV2Course: CourseBundle['course'] = {
  id: 'azure-routing-v2', contentVersion: 3, publication: 'complete', preparation: 'ungraded',
  title: { en: 'Azure routing: foundations to handover', ja: 'Azure ルーティング：基礎から引き継ぎまで' },
  lessonOrder: lessons,
  belts: [previewCourse.belts[0], ...thresholds.map((pointsRequired, index) => {
    const lower = previewCourse.belts[Math.floor(index / 2)], upper = previewCourse.belts[Math.floor(index / 2) + 1]
    const mixed = index % 2 === 0
    return {
      id: mixed ? `${lower.id}-${upper.id}` : upper.id,
      name: mixed ? { en: `${lower.name.en.replace(' belt', '')}/${upper.name.en}`, ja: `${lower.name.ja.replace('帯', '')}・${upper.name.ja}` } : upper.name,
      color: mixed ? lower.color : upper.color,
      ...(mixed ? { secondaryColor: upper.color } : {}),
      pointsRequired, checkpointTaskIds: curriculumV2Assessments.slice(0, index + 1).map((a) => a.taskId),
    }
  })],
}
