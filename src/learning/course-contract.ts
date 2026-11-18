import { z } from 'zod'
import type { PlatformDocument, Requirement } from '../platform/contract'
import type { Localized } from './content'

const id = z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/)
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const localized = z.strictObject({ en: z.string().trim().min(1), ja: z.string().trim().min(1) })
const entityId = z.string().min(1).max(120)
const subnet = z.strictObject({ vnetId: entityId, subnetId: entityId })
const routeScope = subnet.extend({ prefix: z.string() })
const peering = z.strictObject({ vnetAId: entityId, vnetBId: entityId })

export const courseCheckSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id, kind: z.literal('scenario.loaded'), params: z.strictObject({ scenarioId: id }) }),
  z.strictObject({ id, kind: z.literal('routes.inspected'), params: routeScope }),
  z.strictObject({ id, kind: z.literal('vnet.peered'),
    params: peering.extend({ requirements: z.array(z.custom<Requirement>()).min(1).max(64) }) }),
  z.strictObject({
    id, kind: z.literal('requirements.satisfied'),
    params: z.strictObject({ requirements: z.array(z.custom<Requirement>()).min(1).max(64) }),
  }),
  z.strictObject({
    id, kind: z.literal('quiz.answered'),
    params: z.strictObject({
      question: localized,
      choices: z.array(z.strictObject({ id, text: localized, feedback: localized })).min(2),
      correctChoiceId: id,
    }),
  }),
])

export const courseGuidanceSchema = z.discriminatedUnion('action', [
  z.strictObject({ id, action: z.literal('packet-probe.open'), params: z.strictObject({ vnetId: entityId }), instruction: localized }),
  z.strictObject({ id, action: z.literal('network.configure'), params: z.strictObject({ vnetId: entityId }), instruction: localized }),
  z.strictObject({ id, action: z.literal('hub.configure'), params: z.strictObject({ hubId: entityId }), instruction: localized }),
  z.strictObject({ id, action: z.literal('hub-routes.open'), params: z.strictObject({ hubId: entityId, tableId: entityId }), instruction: localized }),
  z.strictObject({ id, action: z.literal('routes.open'), params: routeScope, instruction: localized }),
  z.strictObject({ id, action: z.literal('peering.command'), params: peering, instruction: localized }),
  z.strictObject({
    id, action: z.literal('route-table.configure'),
    params: subnet.extend({ routeTableId: entityId, routeId: entityId.optional() }),
    instruction: localized,
  }),
])

export const courseTaskSchema = z.strictObject({
  id,
  assessmentVersion: version,
  awardId: id,
  points: z.number().int().positive().max(10_000),
  title: localized,
  instruction: localized,
  hints: z.array(localized),
  checkId: id,
  guidanceIds: z.array(id),
})

export const courseLessonSchema = z.strictObject({
  id,
  contentVersion: version,
  title: localized,
  objective: localized,
  scenarioId: id,
  prerequisites: z.array(id),
  taskOrder: z.array(id).min(1),
  tasks: z.array(courseTaskSchema).min(1),
})

export const courseBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  course: z.strictObject({
    id,
    contentVersion: version,
    publication: z.enum(['preview', 'complete']),
    title: localized,
    lessonOrder: z.array(id).min(1),
    belts: z.array(z.strictObject({
      id, name: localized, color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      pointsRequired: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      checkpointTaskIds: z.array(id),
    })).min(2),
  }),
  lessons: z.array(courseLessonSchema).min(1),
  scenarios: z.array(z.strictObject({
    id,
    // The existing platform admission validates these native documents and requirements.
    document: z.custom<PlatformDocument>(),
  })).min(1),
  checks: z.array(courseCheckSchema).min(1),
  guidance: z.array(courseGuidanceSchema),
})

export type CourseBundle = z.infer<typeof courseBundleSchema>
export type CourseTask = z.infer<typeof courseTaskSchema>
export type CourseLesson = z.infer<typeof courseLessonSchema>
export type CourseCheck = z.infer<typeof courseCheckSchema>
export type CourseGuidance = z.infer<typeof courseGuidanceSchema>

export type BeltPlan = {
  id: string
  name: Localized
  color: string
  pointsRequired: number
  plannedTaskPoints: number
  objective: Localized
}

export const courseCompatibilityPolicy = {
  presentation: 'Keep task IDs, assessment versions and award IDs for wording, localization and reordering.',
  assessment: 'Increment assessmentVersion for changed grading, bindings, answers or starter assumptions.',
  awards: 'Store points at first award by course ID and award ID; never reprice or re-award historical points.',
  newCredit: 'New credit requires a new award ID and an explicit content migration, never a version bump alone.',
  insertion: 'Keep completed history; require inserted or revised unmet prerequisites before the next uncompleted task.',
  retirement: 'Archive removed tasks and their awards; never map their completion to replacement tasks automatically.',
  legacy: 'Retain existing practice v1 drafts and achievements as legacy history; they grant no guided-task credit.',
} as const
