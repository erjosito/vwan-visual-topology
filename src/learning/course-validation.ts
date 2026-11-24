import { cidr, contains, ipv4 } from '../validation'
import { hubRouteTables } from '../hub-routing'
import { admitJson, executePlatform, validateRequest } from '../platform/service'
import type { PlatformDocument } from '../platform/contract'
import { courseBundleSchema, type CourseBundle, type CourseCheck, type CourseGuidance } from './course-contract'
import { inspectionScope } from './task-guidance'

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

function selectedDestination(scope: { prefix: string; destinationAddress?: string }) {
  if (scope.destinationAddress === undefined) return true
  const address = ipv4(scope.destinationAddress)
  return address !== undefined && contains(scope.prefix, address)
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
    if (params.inspection) checkScope({ id: definition.id, kind: 'routes.inspected', params: params.inspection }, document, scenarioId)
  } else if ('associations' in params) {
    requireContent(document.mode !== 'vwan'
      && new Set(params.associations.map((scope) => scope.vnetId)).size === params.associations.length
      && params.associations.every((scope) => document.topology.vnets.some((vnet) =>
        vnet.id === scope.vnetId && vnet.vwanHubAttachment?.hubId === scope.hubId)
        && document.topology.vwanHubs.some((hub) => hub.id === scope.hubId
          && hubRouteTables(hub).some((table) => table.id === scope.tableId))),
    `${definition.id} needs distinct original VNet attachments and owned hub/table associations`)
  } else if ('peerings' in params) {
    requireContent(document.mode !== 'vwan' && params.peerings.every((pair) => pair.vnetAId !== pair.vnetBId
      && [pair.vnetAId, pair.vnetBId].every((id) => document.topology.vnets.some((vnet) => vnet.id === id))),
    `${definition.id} needs distinct owned peering endpoints`)
  } else if ('routes' in params) {
    requireContent(document.mode !== 'vwan' && params.routes.every((scope) => !!cidr(scope.prefix) && !!cidr(`${scope.nextHopIp}/32`)
      && document.topology.vnets.some((vnet) => vnet.id === scope.vnetId && vnet.subnets.some((subnet) => subnet.id === scope.subnetId))
      && document.topology.vnets.some((vnet) => vnet.appliances.some((appliance) => appliance.privateIp === scope.nextHopIp))),
    `${definition.id} needs owned subnet routing scopes and appliance next hops`)
  } else if ('connections' in params) {
    requireContent(document.mode !== 'vwan'
      && new Set(params.connections.map((state) => `${state.kind}:${state.connectionId}`)).size === params.connections.length
      && params.connections.every((state) => (state.kind === 'er-link' ? document.topology.erLinks : document.topology.vpnConnections)
        .some((connection) => connection.id === state.connectionId))
      && params.selectedRoutes.every((scope) => !!cidr(scope.prefix) && selectedDestination(scope)
        && document.topology.vnets.some((vnet) => vnet.id === scope.vnetId && vnet.subnets.some((subnet) => subnet.id === scope.subnetId))
        && document.topology.vnets.some((vnet) => vnet.gateways.some((gateway) => gateway.id === scope.nextHopResourceId))),
    `${definition.id} needs distinct original connections and owned selected-route scopes`)
  } else if ('connectionId' in params) {
    requireContent(document.mode !== 'vwan'
      && (params.kind === 'er-link' ? document.topology.erLinks : document.topology.vpnConnections)
        .some((connection) => connection.id === params.connectionId), `${definition.id} needs an owned connection`)
  } else if ('gatewayId' in params) {
    requireContent(document.mode !== 'vwan' && !!cidr(params.prefix)
      && document.topology.vnets.some((vnet) => vnet.id === params.vnetId
        && vnet.gateways.some((gateway) => gateway.id === params.gatewayId)),
    `${definition.id} needs an owned gateway and exact prefix`)
  } else if ('locationId' in params) {
    requireContent(document.mode !== 'vwan' && !!cidr(params.prefix)
      && document.topology.erLocations.some((location) => location.id === params.locationId),
    `${definition.id} needs an owned ExpressRoute location and exact prefix`)
  } else if ('peeringId' in params) {
    requireContent(document.mode !== 'vwan' && document.topology.vnetPeerings.some((peering) => peering.id === params.peeringId),
      `${definition.id} needs an original VNet peering`)
  } else if ('loadBalancerId' in params) {
    requireContent(document.mode !== 'vwan' && document.topology.inventory?.loadBalancers?.some((lb) =>
      lb.id === params.loadBalancerId && lb.owner.kind === 'vnet' && lb.owner.id === params.vnetId),
    `${definition.id} needs an original Load Balancer and its owned VNet`)
  } else if ('packet' in params) {
    requireContent(document.mode !== 'vwan' && document.topology.vnets.some((vnet) => vnet.id === params.vnetId),
      `${definition.id} needs an owned native packet inspection view`)
    validateRequest({ contractVersion: 1, operation: 'simulate', document, packet: params.packet })
  } else if ('expected' in params) {
    requireContent(document.mode !== 'vwan'
      && Object.keys(params.expected).every((key) => Object.hasOwn(document.topology, key)),
    `${definition.id} needs native topology configuration fields`)
    for (const scope of params.selectedRoutes ?? []) {
      requireContent(!!cidr(scope.prefix) && selectedDestination(scope)
        && document.topology.vnets.some((vnet) => vnet.id === scope.vnetId
          && vnet.subnets.some((subnet) => subnet.id === scope.subnetId))
        && document.topology.vnets.some((vnet) => vnet.gateways.some((gateway) => gateway.id === scope.nextHopResourceId)),
      `${definition.id} needs original subnet and gateway selection scopes`)
    }
  } else if ('siteId' in params) {
    requireContent(document.mode !== 'vwan' && !!cidr(params.prefix)
      && document.topology.sites.some((site) => site.id === params.siteId), `${definition.id} needs an owned site and exact prefix`)
  } else if ('hubId' in params) {
    requireContent(document.mode !== 'vwan' && document.topology.vwanHubs.some((hub) => hub.id === params.hubId
      && (!('tableId' in params) || hubRouteTables(hub).some((table) => table.id === params.tableId)))
      && (!('prefix' in params) || params.prefix === undefined || !!cidr(params.prefix)), `${definition.id} needs an owned hub/table`)
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
  if ('requirements' in params && params.requirements) {
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
    if (scenario.extendsScenarioId) {
      const source = scenarios.get(scenario.extendsScenarioId)
      requireContent(source && source !== scenario && source.document.mode === scenario.document.mode && source.document.mode !== 'vwan',
        `invalid scenario extension for ${scenario.id}`)
    }
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
    if (scenario.extendsScenarioId) requireContent(lessonIndex > 0
      && lessons.get(bundle.course.lessonOrder[lessonIndex - 1])?.scenarioId === scenario.extendsScenarioId,
    `${lesson.id} must extend the preceding scenario`)
    requireContent(lesson.context, `missing scenario context for ${lesson.id}`)
    requireContent(new Set(lesson.prerequisites).size === lesson.prerequisites.length, `duplicate prerequisite for ${lesson.id}`)
    for (const prerequisite of lesson.prerequisites) {
      const position = bundle.course.lessonOrder.indexOf(prerequisite)
      requireContent(position >= 0 && position < lessonIndex, `invalid prerequisite/order or cycle for ${lesson.id}`)
    }
    const localTasks = unique(lesson.tasks, 'task')
    order(lesson.taskOrder, localTasks, `task in ${lesson.id}`)
    const first = localTasks.get(lesson.taskOrder[0])!
    requireContent(bundle.course.preparation === 'ungraded' || checks.get(first.checkId)?.kind === 'scenario.loaded',
      `${lesson.id} must start with explicit scenario loading`)
    for (const taskId of lesson.taskOrder) {
      const task = localTasks.get(taskId)!
      const check = checks.get(task.checkId)
      requireContent(check, `unknown check for ${task.id}`)
      requireContent(bundle.course.preparation !== 'ungraded' || check.kind !== 'scenario.loaded',
        `${task.id} cannot award points for ungraded preparation`)
      requireContent(task.debrief, `missing teaching debrief for ${task.id}`)
      requireContent(!awards.has(task.awardId), `duplicate award ${task.awardId}`)
      awards.add(task.awardId)
      totalPoints += task.points
      usedChecks.add(check.id)
      checkScope(check, scenario.document, scenario.id)
      const inspection = inspectionScope(check)
      requireContent(new Set(task.guidanceIds).size === task.guidanceIds.length, `duplicate guidance for ${task.id}`)
      if (inspection || check.kind === 'vnet.peered') {
        requireContent(task.guidanceIds.length > 0, `missing navigation guidance for ${task.id}`)
      }
      if (check.kind === 'routes.inspected') {
        requireContent(task.guidanceIds.some((id) => guidance.get(id)?.action === 'routes.open'),
          `missing inspection guidance for ${task.id}`)
      }
      for (const targetId of task.guidanceIds) {
        const target = guidance.get(targetId)
        requireContent(target, `unknown guidance target for ${task.id}`)
        checkScope(target, scenario.document, scenario.id)
        usedGuidance.add(target.id)
        if (check.kind === 'routes.inspected' && target.action === 'peering.command') continue
        if (inspection || check.kind === 'vnet.peered') {
          const action = check.kind === 'vnet.peered' ? 'peering.command'
            : check.kind === 'packet.inspected' ? 'packet-probe.open'
            : inspection && 'gatewayId' in inspection ? 'gateway-routes.open'
            : inspection && 'locationId' in inspection ? 'er-routes.open'
            : inspection && 'vnetId' in inspection ? 'routes.open'
            : inspection && 'siteId' in inspection ? 'site-routes.open' : 'hub-routes.open'
          const scope = check.kind === 'packet.inspected' ? { vnetId: check.params.vnetId } : inspection ?? check.params
          requireContent(target.action === action
            && Object.entries(scope).filter(([key]) => key !== 'requirements').every(([key, value]) =>
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
