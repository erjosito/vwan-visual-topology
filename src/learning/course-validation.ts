import { cidr } from '../validation'
import { hubRouteTables } from '../hub-routing'
import { admitJson, executePlatform, validateRequest } from '../platform/service'
import type { PlatformDocument } from '../platform/contract'
import { courseBundleSchema, type CourseBundle, type CourseCheck, type CourseGuidance } from './course-contract'

function requireContent(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Course content: ${message}`)
}

function unique<T extends { id: string }>(entries: T[], label: string): Map<string, T> {
  const result = new Map<string, T>()
  for (const entry of entries) {
    requireContent(!result.has(entry.id), `duplicate ${label} ${entry.id}`)
    result.set(entry.id, entry)
  }
  return result
}

function order(ids: string[], entries: Map<string, unknown>, label: string) {
  requireContent(new Set(ids).size === ids.length, `duplicate ${label} order reference`)
  requireContent(ids.length === entries.size && ids.every((id) => entries.has(id)), `invalid ${label} order references`)
}

function checkScope(
  definition: CourseCheck | CourseGuidance,
  document: PlatformDocument,
  scenarioId: string,
) {
  const kind = 'kind' in definition ? definition.kind : definition.action
  const params = definition.params
  if ('scenarioId' in params) {
    requireContent(params.scenarioId === scenarioId, `${definition.id} loads a different scenario`)
  } else if ('hubId' in params) {
    requireContent(document.mode !== 'vwan' && document.topology.vwanHubs.some((hub) => hub.id === params.hubId
      && (!('tableId' in params) || hubRouteTables(hub).some((table) => table.id === params.tableId))), `${definition.id} needs an owned hub/table`)
  } else if ((kind === 'network.configure' || kind === 'packet-probe.open') && 'vnetId' in params) {
    requireContent(document.mode !== 'vwan' && document.topology.vnets.some((vnet) => vnet.id === params.vnetId), `${definition.id} needs an owned VNet`)
  } else if ('vnetAId' in params || 'subnetId' in params) {
    requireContent(document.mode !== 'vwan', `${definition.id} needs the mixed-network provider`)
    if ('vnetAId' in params) {
      requireContent(params.vnetAId !== params.vnetBId
        && [params.vnetAId, params.vnetBId].every((id) => document.topology.vnets.some((vnet) => vnet.id === id)),
      `${definition.id} needs two distinct owned VNets`)
    } else if ('routeTableId' in params) {
      requireContent(document.topology.vnets.some((vnet) => vnet.id === params.vnetId
        && vnet.subnets.some((subnet) => subnet.id === params.subnetId && subnet.routeTableId === params.routeTableId))
        && document.topology.udrTables.some((table) => table.id === params.routeTableId
          && (!params.routeId || table.routes.some((route) => route.id === params.routeId))),
      `${definition.id} needs the owned subnet's associated route table and route`)
    } else {
      requireContent(!!cidr(params.prefix)
        && document.topology.vnets.some((vnet) => vnet.id === params.vnetId
          && vnet.subnets.some((subnet) => subnet.id === params.subnetId)),
      `${definition.id} needs an owned subnet and exact IPv4 prefix`)
    }
  } else if (!('requirements' in params)) {
    requireContent(kind === 'quiz.answered', `unsupported check ${definition.id}`)
  }
  if ('requirements' in params) {
    validateRequest({ contractVersion: 1, operation: 'evaluate', document, requirements: params.requirements })
    const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document, requirements: params.requirements })
    requireContent(result.status === 'complete' && result.assessments.length === params.requirements.length
      && result.assessments.every((assessment) => assessment.outcome !== 'not assessed'),
    `${definition.id} has no fully assessed starter path: ${result.errors.map((error) => error.message).join('; ')}`)
  }
}

/** Author-time validation only; this does not execute learner tasks or persist progress. */
export function validateCourse(input: unknown): CourseBundle {
  admitJson(input)
  const bundle = courseBundleSchema.parse(input)
  const lessons = unique(bundle.lessons, 'lesson')
  const scenarios = unique(bundle.scenarios, 'scenario')
  const checks = unique(bundle.checks, 'check')
  const guidance = unique(bundle.guidance, 'guidance target')
  unique(bundle.course.belts, 'belt')
  order(bundle.course.lessonOrder, lessons, 'lesson')

  for (const scenario of scenarios.values()) {
    const result = executePlatform({ contractVersion: 1, operation: 'validate', document: scenario.document })
    requireContent(result.status === 'complete', `invalid scenario ${scenario.id}: ${result.errors.map((error) => error.message).join('; ')}`)
  }
  for (const check of checks.values()) {
    if (check.kind === 'scenario.loaded') requireContent(scenarios.has(check.params.scenarioId), `unknown scenario for ${check.id}`)
    if (check.kind === 'quiz.answered') {
      const choices = unique(check.params.choices, 'quiz choice')
      requireContent(choices.has(check.params.correctChoiceId), `unknown quiz answer for ${check.id}`)
    }
  }

  const tasks = unique(bundle.lessons.flatMap((lesson) => lesson.tasks), 'task')
  const awards = new Set<string>()
  const usedChecks = new Set<string>()
  const usedGuidance = new Set<string>()
  let totalPoints = 0
  for (const [lessonIndex, lessonId] of bundle.course.lessonOrder.entries()) {
    const lesson = lessons.get(lessonId)!
    const scenario = scenarios.get(lesson.scenarioId)
    requireContent(scenario, `unknown scenario for ${lesson.id}`)
    requireContent(new Set(lesson.prerequisites).size === lesson.prerequisites.length, `duplicate prerequisite for ${lesson.id}`)
    for (const prerequisite of lesson.prerequisites) {
      const position = bundle.course.lessonOrder.indexOf(prerequisite)
      requireContent(position >= 0 && position < lessonIndex, `invalid prerequisite/order or cycle for ${lesson.id}`)
    }
    const localTasks = unique(lesson.tasks, 'task')
    order(lesson.taskOrder, localTasks, `task in ${lesson.id}`)
    const first = localTasks.get(lesson.taskOrder[0])!
    requireContent(checks.get(first.checkId)?.kind === 'scenario.loaded', `${lesson.id} must start with explicit scenario loading`)
    for (const taskId of lesson.taskOrder) {
      const task = localTasks.get(taskId)!
      const check = checks.get(task.checkId)
      requireContent(check, `unknown check for ${task.id}`)
      requireContent(!awards.has(task.awardId), `duplicate award ${task.awardId}`)
      awards.add(task.awardId)
      totalPoints += task.points
      usedChecks.add(check.id)
      checkScope(check, scenario.document, scenario.id)
      requireContent(new Set(task.guidanceIds).size === task.guidanceIds.length, `duplicate guidance for ${task.id}`)
      if (check.kind === 'routes.inspected' || check.kind === 'vnet.peered') {
        requireContent(task.guidanceIds.length > 0, `missing navigation guidance for ${task.id}`)
      }
      for (const targetId of task.guidanceIds) {
        const target = guidance.get(targetId)
        requireContent(target, `unknown guidance target for ${task.id}`)
        checkScope(target, scenario.document, scenario.id)
        usedGuidance.add(target.id)
        if (check.kind === 'routes.inspected' || check.kind === 'vnet.peered') {
          const action = check.kind === 'routes.inspected' ? 'routes.open' : 'peering.command'
          requireContent(target.action === action
            && Object.entries(check.params).filter(([key]) => key !== 'requirements').every(([key, value]) =>
              Object.entries(target.params).some(([targetKey, targetValue]) => targetKey === key && targetValue === value)),
          `mismatched guidance scope for ${task.id}`)
        }
      }
    }
  }
  requireContent(usedChecks.size === checks.size, 'unreferenced checks have no validated scenario scope')
  requireContent(usedGuidance.size === guidance.size, 'unreferenced guidance has no validated scenario scope')
  requireContent(Number.isSafeInteger(totalPoints), 'point budget exceeds safe integer range')
  for (const [index, belt] of bundle.course.belts.entries()) {
    requireContent(index === 0 ? belt.pointsRequired === 0
      : belt.pointsRequired > bundle.course.belts[index - 1].pointsRequired, 'belt thresholds must increase from zero')
    requireContent(belt.pointsRequired <= totalPoints, `unreachable belt threshold ${belt.id}`)
    requireContent(new Set(belt.checkpointTaskIds).size === belt.checkpointTaskIds.length
      && belt.checkpointTaskIds.every((id) => tasks.has(id)), `unknown/duplicate checkpoint for ${belt.id}`)
    requireContent(index === 0 || belt.checkpointTaskIds.length > 0, `missing mastery checkpoint for ${belt.id}`)
    requireContent(index !== 0 || belt.checkpointTaskIds.length === 0, 'starting belt cannot require completed checkpoints')
  }
  return bundle
}
