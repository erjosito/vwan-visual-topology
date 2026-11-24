import { contractVersion, engineVersion, type PlatformRequest, type PlatformResult } from '../platform/contract'
import type { CourseBundle, CourseTask } from './course-contract'
import { inspectionScope } from './task-guidance'
import type { Localized } from './content'
import type { PracticeWorkspace } from './practice-workspace'
import { createPlatformRequest } from '../platform/request'
import { newBeltAchievement, type BeltAchievement } from './belt-achievement'
import { matchesConfiguration } from './configuration-check'
import { lookupSubnetEffectiveRoute } from '../azure-net/engine'

export type LearningWorkspace = { practice: PracticeWorkspace; revision: number; scope: number }
export type LearningObservation = {
  token: string
  vnetId?: string
  subnetId?: string
  siteId?: string
  hubId?: string
  tableId?: string
  gatewayId?: string
  locationId?: string
  prefix: string
}
export type TaskCompletion = {
  courseId: string
  contentVersion: number
  lessonId: string
  taskId: string
  assessmentVersion: number
  checkId: string
  awardId: string
  points: number
  title: Localized
  sessionId: string
  revision: number
  scope: number
  engineVersion: string
  completedAt: string
}
export type RunnerFeedback = 'passed' | 'scope' | 'inspect' | 'observed' | 'peering' | 'requirements'
  | 'answer' | 'incorrect' | 'unassessed' | 'stale' | 'cancelled' | 'progress'
export type RunnerState = {
  taskId?: string
  reviewId?: string
  replayLessonId?: string
  completions: readonly TaskCompletion[]
  running: boolean
  automatic: boolean
  awaitingNext: boolean
  feedback?: RunnerFeedback
  explanation?: Localized
  unmet: string[]
  observation?: LearningObservation
  celebration?: { title: Localized; points: number; explanation?: Localized; belt?: BeltAchievement; beltDismissed?: boolean }
  canContinue: boolean
}
export type CourseRunner = ReturnType<typeof createCourseRunner>
export type RunnerOptions = {
  workspace: () => LearningWorkspace | undefined
  evaluate: (request: PlatformRequest, signal: AbortSignal) => Promise<PlatformResult>
  changed: (state: RunnerState) => void
  completions?: TaskCompletion[]
  completed?: (completion: TaskCompletion) => boolean | void
}

export function orderedTasks(bundle: CourseBundle) {
  return bundle.course.lessonOrder.flatMap((id) => {
    const lesson = bundle.lessons.find((item) => item.id === id)!
    return lesson.taskOrder.map((taskId) => ({ lesson, task: lesson.tasks.find((item) => item.id === taskId)! }))
  })
}

export function taskCompleted(bundle: CourseBundle, completions: readonly TaskCompletion[], task: CourseTask) {
  return completions.some((entry) => entry.courseId === bundle.course.id && entry.taskId === task.id
    && entry.assessmentVersion === task.assessmentVersion && entry.checkId === task.checkId)
}

/** One progression authority; recording always rechecks the passing live-revision binding. */
export function createCourseRunner(bundle: CourseBundle, options: RunnerOptions) {
  const tasks = orderedTasks(bundle)
  let completions = [...(options.completions ?? [])]
  const nextUncompleted = () => tasks.find(({ task }) => !taskCompleted(bundle, completions, task))?.task.id
  let taskId = nextUncompleted()
  let reviewId: string | undefined
  let replay: { lessonId: string; done: Set<string> } | undefined
  let sessionId = crypto.randomUUID()
  let generation = 0
  let job: AbortController | undefined
  let proof: string | undefined
  let observed: string | undefined
  let observation: LearningObservation | undefined
  let observationKey: string | undefined
  let feedback: RunnerFeedback | undefined
  let explanation: Localized | undefined
  let unmet: string[] = []
  let automatic = false
  let automaticTimer: ReturnType<typeof setTimeout> | undefined
  let automaticAttempt: string | undefined
  let celebration: RunnerState['celebration']
  let awaitingNext = false
  let state: RunnerState
  const current = () => tasks.find((item) => item.task.id === taskId)
  const binding = () => {
    const live = options.workspace()
    const item = current()
    if (!live?.practice.active || !item || live.practice.courseId !== bundle.course.id
      || live.practice.scenarioId !== item.lesson.scenarioId
      || live.practice.document.mode !== bundle.scenarios.find((scenario) => scenario.id === item.lesson.scenarioId)?.document.mode) return undefined
    return JSON.stringify([sessionId, generation, bundle.course.id, bundle.course.contentVersion,
      item.task.id, item.task.assessmentVersion, item.task.checkId, live.scope, live.revision])
  }
  const publish = () => {
    const key = binding()
    const check = bundle.checks.find((item) => item.id === current()?.task.checkId)
    const inspection = inspectionScope(check)
    if (!awaitingNext && inspection && key) {
      if (!observation || observationKey !== key) observation = { token: crypto.randomUUID(), ...inspection }
      observationKey = key
    } else { observation = undefined; observationKey = undefined }
    state = { taskId, reviewId, replayLessonId: replay?.lessonId, completions: [...completions],
      running: !!job, automatic, awaitingNext, feedback, explanation, unmet, observation, celebration,
      canContinue: !reviewId && (awaitingNext || !!key && proof === key && !job) }
    options.changed(state)
    clearTimeout(automaticTimer)
    automaticTimer = undefined
    if (!automatic || awaitingNext || reviewId || job || !key || !check) return
    if (state.canContinue) automaticTimer = setTimeout(() => { if (automatic) complete() }, 450)
    else if (check.kind !== 'quiz.answered' && automaticAttempt !== key
      && (!inspection || observed === key)) {
      automaticTimer = setTimeout(() => {
        if (!automatic || key !== binding()) return
        automaticAttempt = key
        void assess()
      }, 450)
    }
  }
  const invalidate = (reason?: RunnerFeedback) => {
    generation++
    job?.abort(); job = undefined
    proof = undefined; observed = undefined; observation = undefined; observationKey = undefined
    feedback = reason; explanation = undefined; unmet = []
  }
  const workspaceChanged = () => {
    if (!awaitingNext) celebration = undefined
    invalidate(job || proof || observed || feedback === 'stale' ? 'stale' : undefined)
    publish()
  }
  const assess = async (answerId?: string) => {
    if (reviewId || awaitingNext || !taskId) return
    job?.abort()
    proof = undefined; feedback = undefined; explanation = undefined; unmet = []
    const key = binding()
    const live = options.workspace()
    const item = current()!
    const check = bundle.checks.find((entry) => entry.id === item.task.checkId)!
    if (!key || !live) { feedback = 'scope'; publish(); return }
    const controller = new AbortController()
    job = controller
    publish()
    let result: RunnerFeedback = 'unassessed'
    let detail: Localized | undefined
    let failures: string[] = []
    try {
      if (check.kind === 'quiz.answered') {
        const choice = check.params.choices.find((entry) => entry.id === answerId)
        detail = choice?.feedback
        result = !choice ? 'answer' : choice.id === check.params.correctChoiceId ? 'passed' : 'incorrect'
      } else if (inspectionScope(check) && observed !== key) result = 'inspect'
      else {
        const document = structuredClone(live.practice.document)
        let configured = true
        if (check.kind === 'topology.configured') configured = matchesConfiguration(document.topology, check.params.expected)
        if (check.kind === 'udrs.configured') {
          configured = document.mode !== 'vwan' && check.params.routes.every((scope) => {
            const subnet = document.topology.vnets.find((vnet) => vnet.id === scope.vnetId)?.subnets.find((entry) => entry.id === scope.subnetId)
            return document.topology.udrTables.find((table) => table.id === subnet?.routeTableId)?.routes.some((route) =>
              route.enabled && route.prefix === scope.prefix && route.nextHopType === 'VirtualAppliance' && route.nextHopIp === scope.nextHopIp)
          })
        }
        if (check.kind === 'vnet.peered' || check.kind === 'peerings.configured') {
          const pairs = check.kind === 'vnet.peered' ? [check.params] : check.params.peerings
          configured = document.mode !== 'vwan' && pairs.every((pair) => document.topology.vnetPeerings.some((peering) =>
            peering.enabled && peering.aToB.allowVirtualNetworkAccess && peering.bToA.allowVirtualNetworkAccess
            && ((peering.vnetAId === pair.vnetAId && peering.vnetBId === pair.vnetBId)
              || (peering.vnetBId === pair.vnetAId && peering.vnetAId === pair.vnetBId))))
        }
        if (check.kind === 'hub-associations.configured') {
          configured = document.mode !== 'vwan' && check.params.associations.every((scope) => {
            const attachment = document.topology.vnets.find((vnet) => vnet.id === scope.vnetId)?.vwanHubAttachment
            return attachment?.enabled && attachment.hubId === scope.hubId
              && attachment.hubRouting?.status === 'configured' && attachment.hubRouting.associatedTableId === scope.tableId
          })
        }
        if (check.kind === 'connections.configured') {
          const starter = bundle.scenarios.find((scenario) => scenario.id === item.lesson.scenarioId)!.document
          configured = document.mode !== 'vwan' && starter.mode !== 'vwan' && check.params.connections.every((state) => {
            const actual = (state.kind === 'er-link' ? document.topology.erLinks : document.topology.vpnConnections)
              .find((connection) => connection.id === state.connectionId)
            const original = (state.kind === 'er-link' ? starter.topology.erLinks : starter.topology.vpnConnections)
              .find((connection) => connection.id === state.connectionId)
            return actual && original && actual.enabled === state.enabled
              && actual.targetId === original.targetId && actual.targetKind === original.targetKind
              && ('siteId' in original ? 'siteId' in actual && actual.siteId === original.siteId
                : 'locationId' in actual && actual.locationId === original.locationId)
              && (state.kind !== 'vpn-connection' || 'bgpEnabled' in actual && actual.bgpEnabled === state.bgpEnabled)
          })
        }
        if (!configured) result = check.kind === 'vnet.peered' ? 'peering' : 'requirements'
        else {
          const requirements = 'requirements' in check.params ? check.params.requirements : undefined
          const evaluated = await options.evaluate(createPlatformRequest({ contractVersion, engineVersion, document,
            operation: requirements ? 'evaluate' : 'validate', requirements }), controller.signal)
          if (evaluated.status === 'complete' && evaluated.contractVersion === contractVersion
            && evaluated.engineVersion === engineVersion && evaluated.document && !evaluated.errors.length) {
            if (!requirements) result = 'passed'
            else {
              const exact = evaluated.assessments.length === requirements.length
                && new Set(evaluated.assessments.map((entry) => entry.id)).size === requirements.length
                && requirements.every((requirement) => evaluated.assessments.some((entry) => entry.id === requirement.id))
              if (exact && evaluated.assessments.every((entry) => entry.outcome === 'satisfied' || entry.outcome === 'violated')) {
                failures = evaluated.assessments.filter((entry) => entry.outcome !== 'satisfied').map((entry) => entry.id)
                result = failures.length ? 'requirements' : 'passed'
              }
              if (result === 'passed' && (check.kind === 'connections.configured'
                || check.kind === 'topology.configured' && check.params.selectedRoutes)) {
                const simulation = evaluated.document.mode !== 'vwan' && evaluated.simulation
                  && 'subnetTables' in evaluated.simulation ? evaluated.simulation : undefined
                const selected = check.params.selectedRoutes!.every((scope) => {
                  const table = simulation?.subnetTables?.[scope.subnetId]
                  return table?.vnetId === scope.vnetId && table.routes.some((route) =>
                    route.active && route.prefix === scope.prefix && route.nextHopResourceId === scope.nextHopResourceId)
                    && (!scope.destinationAddress || lookupSubnetEffectiveRoute(table, scope.destinationAddress)?.nextHopResourceId === scope.nextHopResourceId)
                })
                if (!selected) result = 'requirements'
              }
            }
          }
        }
      }
    } catch { result = 'unassessed' }
    // Both revision and generation matter: edit/undo must not resurrect old evidence.
    if (controller.signal.aborted || job !== controller) return
    if (key !== binding()) { invalidate('stale'); publish(); return }
    job = undefined; feedback = result; explanation = detail; unmet = failures
    if (result === 'passed') proof = key
    publish()
  }
  const complete = () => {
    const key = binding()
    if (!key || proof !== key || job || reviewId || !taskId) {
      invalidate('stale'); publish(); return false
    }
    const { task, lesson } = current()!
    const firstCompletion = !taskCompleted(bundle, completions, task)
    const firstAward = !completions.some((entry) => entry.courseId === bundle.course.id && entry.awardId === task.awardId)
    const before = completions
    if (firstCompletion) {
      const live = options.workspace()!
      const completion: TaskCompletion = {
        courseId: bundle.course.id, contentVersion: bundle.course.contentVersion, lessonId: lesson.id,
        taskId: task.id, assessmentVersion: task.assessmentVersion, checkId: task.checkId,
        awardId: task.awardId, points: task.points, title: { ...task.title }, sessionId,
        revision: live.revision, scope: live.scope, engineVersion, completedAt: new Date().toISOString(),
      }
      try {
        if (options.completed?.(completion) === false) { proof = undefined; feedback = 'progress'; publish(); return false }
      } catch { proof = undefined; feedback = 'progress'; publish(); return false }
      completions = [...completions, completion]
    }
    const belt = firstCompletion ? newBeltAchievement(bundle, before, completions) : undefined
    celebration = { title: task.title, points: firstAward ? task.points : 0, explanation, belt }
    awaitingNext = true
    invalidate(); publish()
    return true
  }
  const advance = () => {
    if (reviewId || !taskId) return false
    if (!awaitingNext && !complete()) return false
    const { task, lesson } = current()!
    awaitingNext = false
    if (replay) {
      replay.done.add(task.id)
      taskId = lesson.taskOrder.find((id) => !replay!.done.has(id))
      if (!taskId) { replay = undefined; taskId = nextUncompleted() }
    } else taskId = nextUncompleted()
    invalidate(); publish()
    return true
  }
  const review = (id?: string) => {
    if (id && !tasks.some(({ task }) => task.id === id && taskCompleted(bundle, completions, task))) return
    if (!awaitingNext) celebration = undefined
    invalidate()
    reviewId = id
    publish()
  }
  const replayLesson = (lessonId: string) => {
    const lesson = bundle.lessons.find((entry) => entry.id === lessonId)
    const firstUnmetIndex = tasks.findIndex((entry) => entry.task.id === nextUncompleted())
    const lessonIndex = tasks.findIndex((entry) => entry.lesson.id === lessonId)
    if (!lesson || (firstUnmetIndex >= 0 && lessonIndex > firstUnmetIndex)) return
    celebration = undefined
    awaitingNext = false
    invalidate(); reviewId = undefined
    replay = { lessonId, done: new Set() }
    taskId = lesson.taskOrder[0]; sessionId = crypto.randomUUID()
    publish()
  }
  publish()
  return {
    bundle,
    getSnapshot: () => state,
    assess, advance, review, replayLesson, workspaceChanged,
    dismissBelt: () => {
      if (!celebration?.belt) return
      celebration = { ...celebration, beltDismissed: true }; publish()
    },
    setAutomatic: (enabled: boolean) => {
      if (automatic === enabled) return
      automatic = enabled
      automaticAttempt = undefined
      if (!enabled) invalidate()
      publish()
    },
    replaceProgress: (entries: readonly TaskCompletion[]) => {
      celebration = undefined
      awaitingNext = false
      invalidate(); completions = [...entries]; reviewId = undefined; replay = undefined
      taskId = nextUncompleted(); sessionId = crypto.randomUUID(); publish()
    },
    cancel: () => { if (!awaitingNext) celebration = undefined; invalidate('cancelled'); automaticAttempt = binding(); publish() },
    resumeCurrent: () => {
      celebration = undefined
      awaitingNext = false
      invalidate(); reviewId = undefined; replay = undefined; taskId = nextUncompleted(); publish()
    },
    observe: (event: LearningObservation) => {
      const key = binding()
      if (!reviewId && !awaitingNext && key && observationKey === key && observation && Object.entries(observation).every(([name, value]) =>
        event[name as keyof LearningObservation] === value)) {
        observed = key; feedback = 'observed'; publish()
      }
    },
  }
}
