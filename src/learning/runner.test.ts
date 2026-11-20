import { describe, expect, it, vi } from 'vitest'
import { executePlatform } from '../platform/service'
import type { PlatformRequest, PlatformResult } from '../platform/contract'
import { exampleCourse } from './course-examples'
import { scenarioBundle } from './scenario-course'
import type { CourseBundle } from './course-contract'
import type { AzSimulationResult } from '../azure-net/engine'
import { requirementDescription } from './runner-content'
import { createCourseRunner, orderedTasks, type LearningWorkspace, type RunnerOptions, type TaskCompletion } from './runner'
import { createProgressLedger, guidedProgressKey } from './progress-ledger'
import { newBeltAchievement } from './belt-achievement'
import { achievedStages, beltStages } from './belt-stages'

function harness(overrides: Partial<RunnerOptions> = {}, course = exampleCourse) {
  const bundle = structuredClone(course)
  let live: LearningWorkspace | undefined
  const completed = vi.fn()
  const evaluate = vi.fn(async (request: PlatformRequest) => executePlatform(request))
  const runner = createCourseRunner(bundle, { workspace: () => live, changed: () => {}, evaluate, completed, ...overrides })
  const state = () => runner.getSnapshot()
  const load = (index = 0) => {
    live = { scope: (live?.scope ?? 0) + 1, revision: (live?.revision ?? 0) + 1, practice: {
      version: 1, active: true, returnProvider: 'azure-net', courseId: bundle.course.id,
      scenarioId: bundle.scenarios[index].id, document: structuredClone(bundle.scenarios[index].document),
    } }
    runner.workspaceChanged()
  }
  const edit = (change: (document: LearningWorkspace['practice']['document']) => void) => {
    change(live!.practice.document); live!.revision++; runner.workspaceChanged()
  }
  const pass = async (answer?: string) => {
    await runner.assess(answer)
    expect(state().feedback).toBe('passed')
    expect(runner.advance()).toBe(true)
  }
  const inspect = async () => { runner.observe(state().observation!); await pass() }
  const toObservation = async () => { load(); await pass(); await pass('no-connection') }
  const toPeering = async () => { await toObservation(); await inspect() }
  const peer = () => edit((document) => {
    if (document.mode === 'vwan') throw new Error('Mixed fixture required')
    document.topology.vnetPeerings.push({
      id: 'learner', name: 'Learner', vnetAId: 'b', vnetBId: 'a', enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    })
  })
  const finishPeering = async () => {
    await toPeering(); peer(); await pass(); await inspect(); await pass(); await pass('not-transitive')
  }
  return { bundle, runner, state, load, edit, pass, inspect, toObservation, toPeering, peer, finishPeering,
    evaluate, completed, live: () => live }
}

function beforeTask(bundle: CourseBundle, taskId: string): TaskCompletion[] {
  const tasks = orderedTasks(bundle)
  return tasks.slice(0, tasks.findIndex(({ task }) => task.id === taskId)).map(({ task, lesson }) => ({
    courseId: bundle.course.id, contentVersion: bundle.course.contentVersion, lessonId: lesson.id, taskId: task.id,
    assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
    title: task.title, sessionId: 'earlier', revision: 1, scope: 1, engineVersion: 'earlier', completedAt: '2026-11-18T12:00:00Z',
  }))
}

describe('evidence-gated course runner', () => {
  it.each(['saved', 'session', 'conflict'] as const)('celebrates only accepted upward belt awards, preserving the held debrief: %s', async (mode) => {
    vi.useFakeTimers()
    const ledger = { version: 1, policyVersion: 1, completions: beforeTask(exampleCourse, 'peering.explain') }
    const data = new Map([[guidedProgressKey, JSON.stringify(ledger)]])
    const store = createProgressLedger(() => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { if (mode === 'session') throw new Error('quota'); data.set(key, value) },
      removeItem: (key) => { data.delete(key) },
    }))
    if (mode === 'conflict') data.set(guidedProgressKey, 'preserve conflicting bytes')
    const h = harness({ completions: ledger.completions, completed: (completion) => store.record(completion, true) })
    try {
      expect(h.state().celebration).toBeUndefined()
      h.load(); h.runner.setAutomatic(true)
      await h.runner.assess('not-transitive')
      await vi.advanceTimersByTimeAsync(2000)
      expect(store.getSnapshot().status).toBe(mode)
      if (mode === 'conflict') {
        expect(h.state().celebration).toBeUndefined()
        expect(h.state().awaitingNext).toBe(false)
        expect(data.get(guidedProgressKey)).toBe('preserve conflicting bytes')
      } else {
        expect(h.state().celebration?.belt).toEqual({ courseId: exampleCourse.course.id, previousBeltId: 'white', beltId: 'yellow' })
        expect(h.state().awaitingNext).toBe(true)
        const accepted = store.backup(false)
        h.runner.dismissBelt(); h.runner.cancel()
        expect(h.state().celebration?.beltDismissed).toBe(true)
        expect(h.state().taskId).toBe('peering.explain')
        expect(h.state().awaitingNext).toBe(true)
        h.runner.review('peering.inspect')
        h.runner.review()
        expect(h.state().celebration?.beltDismissed).toBe(true)
        expect(store.backup(false)).toBe(accepted)
        expect(h.runner.advance()).toBe(true)
        expect(h.state().taskId).toBe('override.load')
      }
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it('does not celebrate restored, externally replaced or replayed historical achievements', async () => {
    const historical = beforeTask(exampleCourse, 'override.load')
    const h = harness({ completions: historical })
    expect(h.state().celebration).toBeUndefined()
    h.runner.replaceProgress(historical)
    expect(h.state().celebration).toBeUndefined()
    h.runner.replayLesson('direct-peering')
    await h.finishPeering()
    expect(h.completed).not.toHaveBeenCalled()
    expect(h.state().celebration?.belt).toBeUndefined()
    expect(h.state().completions).toEqual(historical)
  })

  it('summarizes every newly crossed stage when one missing checkpoint unlocks several historical XP thresholds', () => {
    const all = beforeTask(exampleCourse, 'capstone.explain')
    const { lesson, task } = orderedTasks(exampleCourse).at(-1)!
    all.push({ ...all[0], lessonId: lesson.id, taskId: task.id, checkId: task.checkId, awardId: task.awardId, points: task.points })
    const before = all.filter((entry) => entry.taskId !== 'peering.explain')
    const achievement = newBeltAchievement(exampleCourse, before, all)!
    expect(achievement).toMatchObject({ previousBeltId: 'white', beltId: 'black' })
    expect(achievedStages(achievement).map((stage) => stage.lessonIds)).toEqual(exampleCourse.course.lessonOrder.map((id) => [id]))
    expect(newBeltAchievement(exampleCourse, all, before)).toBeUndefined()
    expect(newBeltAchievement(exampleCourse, all, all)).toBeUndefined()
  })

  it.each([exampleCourse, scenarioBundle])('aligns authored stages with actual opening debriefs and existing terminal checkpoints: $course.id', (bundle) => {
    const stages = beltStages[bundle.course.id]
    const covered = stages.flatMap((stage) => stage.lessonIds)
    expect(covered).toEqual(bundle.course.lessonOrder.slice(0, bundle.course.id === scenarioBundle.course.id ? 8 : 6))
    expect(new Set(covered).size).toBe(covered.length)
    for (const [index, stage] of stages.entries()) {
      const first = bundle.lessons.find((lesson) => lesson.id === stage.lessonIds[0])!
      const last = bundle.lessons.find((lesson) => lesson.id === stage.lessonIds.at(-1))!
      expect(bundle.course.belts[index + 1].id).toBe(stage.beltId)
      expect(bundle.course.belts[index + 1].checkpointTaskIds.at(-1)).toBe(last.taskOrder.at(-1))
      const opening = first.tasks.find((task) => task.id === first.taskOrder[0])!.debrief!
      for (const language of ['en', 'ja'] as const) {
        expect(opening.paragraphs[0][language]).toContain(stage.introduction[language])
        expect(stage.topics.every((topic) => topic[language].length > 0)).toBe(true)
      }
    }
  })

  it.each([false, true])('grades stable quiz IDs and feedback after authored choice reversal: %s', async (reverse) => {
    const h = harness({ completions: beforeTask(exampleCourse, 'override.explain') })
    const check = h.bundle.checks.find((entry) => entry.id === 'explain-udr')!
    if (check.kind !== 'quiz.answered') throw new Error('Quiz required')
    if (reverse) check.params.choices.reverse()
    h.load(1)
    const wrong = check.params.choices.find((choice) => choice.id !== check.params.correctChoiceId)!
    await h.runner.assess(wrong.id)
    expect(h.state().feedback).toBe('incorrect')
    expect(h.state().explanation).toEqual(wrong.feedback)
    expect(h.completed).not.toHaveBeenCalled()
    await h.pass(check.params.correctChoiceId)
    expect(h.completed).toHaveBeenCalledOnce()
    expect(h.completed).toHaveBeenCalledWith(expect.objectContaining({ awardId: 'override.explain', assessmentVersion: 1, points: 25 }))
  })

  it('requires both hub peerings and enabled access, not just the first connection', async () => {
    const h = harness({ completions: beforeTask(scenarioBundle, 'inspection-bypass.connect') }, scenarioBundle)
    h.load(1)
    const connect = (vnetAId: string) => h.edit((document) => {
      if (document.mode === 'vwan') throw new Error('Mixed fixture required')
      document.topology.vnetPeerings.push({ ...structuredClone(document.topology.vnetPeerings[0]), id: `learner-${vnetAId}`, vnetAId, vnetBId: 'hub' })
    })
    connect('a')
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    connect('b')
    await h.runner.assess()
    expect(h.state().feedback).toBe('passed')
    h.edit((document) => {
      if (document.mode === 'vwan') throw new Error('Mixed fixture required')
      document.topology.vnetPeerings[2].bToA.allowVirtualNetworkAccess = false
    })
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    expect(h.completed).not.toHaveBeenCalled()
  })

  it('requires enabled appliance UDRs on each owned subnet association before completing the introductory policy task', async () => {
    const h = harness({ completions: beforeTask(scenarioBundle, 'inspection-bypass.summary') }, scenarioBundle)
    h.load(1)
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    h.edit((document) => {
      if (document.mode === 'vwan') throw new Error('Mixed fixture required')
      for (const table of document.topology.udrTables) table.routes.push({
        id: 'learner-summary', name: 'Private inspection', prefix: '10.0.0.0/8', nextHopType: 'VirtualAppliance', nextHopIp: '10.20.1.4', enabled: true,
      })
    })
    await h.runner.assess()
    expect(h.state().feedback).toBe('passed')
    h.edit((document) => {
      if (document.mode === 'vwan') throw new Error('Mixed fixture required')
      delete document.topology.vnets[1].subnets[0].routeTableId
    })
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    expect(h.completed).not.toHaveBeenCalled()
  })

  it('automatically verifies and awards once, then waits for Next after each task including committed quizzes and exact inspections', async () => {
    vi.useFakeTimers()
    const h = harness()
    try {
      h.load()
      h.runner.setAutomatic(true)
      await vi.advanceTimersByTimeAsync(500)
      expect(h.state().canContinue).toBe(true)
      expect(h.completed).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2000)
      expect(h.completed).toHaveBeenCalledTimes(1)
      expect(h.state().celebration?.points).toBe(h.bundle.lessons[0].tasks[0].points)
      expect(h.state().awaitingNext).toBe(true)
      expect(h.state().taskId).toBe('peering.load')
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.state().taskId).toBe('peering.load')
      expect(h.runner.advance()).toBe(true)
      const quiz = h.state().taskId
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.state().taskId).toBe(quiz)
      await h.runner.assess('no-connection')
      await vi.advanceTimersByTimeAsync(2000)
      expect(h.completed).toHaveBeenCalledTimes(2)
      expect(h.state().celebration?.explanation).toBeTruthy()
      expect(h.state().taskId).toBe(quiz)
      expect(h.runner.advance()).toBe(true)
      const observation = h.state().observation!
      h.runner.observe({ ...observation, subnetId: 'work-b' })
      await vi.advanceTimersByTimeAsync(3000)
      expect(h.completed).toHaveBeenCalledTimes(2)
      h.runner.observe(observation)
      await vi.advanceTimersByTimeAsync(3000)
      expect(h.completed).toHaveBeenCalledTimes(3)
      expect(h.state().taskId).toBe('peering.inspect-before')
      expect(h.state().awaitingNext).toBe(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.completed).toHaveBeenCalledTimes(3)
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it('keeps an awarded teaching step across documentation-tab pauses, edits and historical review without reusing proof or awarding again', async () => {
    vi.useFakeTimers()
    const h = harness()
    try {
      h.load(); h.runner.setAutomatic(true)
      await vi.advanceTimersByTimeAsync(2600)
      const celebration = h.state().celebration
      h.runner.setAutomatic(false)
      h.edit(() => {})
      h.runner.review('peering.load')
      expect(h.runner.advance()).toBe(false)
      h.runner.review()
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.state().celebration).toBe(celebration)
      expect(h.state().taskId).toBe('peering.load')
      expect(h.state().awaitingNext).toBe(true)
      expect(h.state().observation).toBeUndefined()
      expect(h.completed).toHaveBeenCalledTimes(1)
      expect(h.runner.advance()).toBe(true)
      expect(h.state().taskId).toBe('peering.predict')
      expect(h.state().awaitingNext).toBe(false)
      expect(h.state().canContinue).toBe(false)
      expect(h.completed).toHaveBeenCalledTimes(1)
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it('retains the final task explanation until Next before showing course completion', async () => {
    vi.useFakeTimers()
    const last = orderedTasks(exampleCourse).at(-1)!
    const h = harness({ completions: beforeTask(exampleCourse, last.task.id) })
    try {
      h.load(exampleCourse.scenarios.findIndex((entry) => entry.id === last.lesson.scenarioId))
      h.runner.setAutomatic(true)
      const check = exampleCourse.checks.find((entry) => entry.id === last.task.checkId)!
      if (check.kind !== 'quiz.answered') throw new Error('Final quiz expected')
      await h.runner.assess(check.params.correctChoiceId)
      await vi.advanceTimersByTimeAsync(2000)
      expect(h.state().completions).toHaveLength(40)
      expect(h.state().taskId).toBe(last.task.id)
      expect(h.state().awaitingNext).toBe(true)
      expect(h.runner.advance()).toBe(true)
      expect(h.state().taskId).toBeUndefined()
      expect(h.completed).toHaveBeenCalledTimes(1)
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it('debounces native edits and rejects an automatic pass after undo, pause, or review', async () => {
    vi.useFakeTimers()
    const h = harness()
    try {
      await h.toPeering()
      h.runner.setAutomatic(true)
      h.peer()
      await vi.advanceTimersByTimeAsync(200)
      h.edit(() => {})
      await vi.advanceTimersByTimeAsync(300)
      expect(h.state().canContinue).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      expect(h.state().canContinue).toBe(true)
      const awards = h.completed.mock.calls.length
      h.edit((document) => { if (document.mode !== 'vwan') document.topology.vnetPeerings = [] })
      await vi.advanceTimersByTimeAsync(3000)
      expect(h.completed).toHaveBeenCalledTimes(awards)
      h.peer()
      await vi.advanceTimersByTimeAsync(500)
      h.runner.setAutomatic(false)
      await vi.advanceTimersByTimeAsync(3000)
      expect(h.completed).toHaveBeenCalledTimes(awards)
      h.runner.setAutomatic(true)
      await vi.advanceTimersByTimeAsync(500)
      h.runner.review(h.bundle.lessons[0].tasks[0].id)
      await vi.advanceTimersByTimeAsync(3000)
      expect(h.completed).toHaveBeenCalledTimes(awards)
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it('does not spin on unassessed results or unlock when the award cannot be recorded', async () => {
    vi.useFakeTimers()
    const completed = vi.fn(() => false)
    const h = harness({ completed })
    try {
      h.load()
      h.evaluate.mockImplementation(async (request) => ({ ...executePlatform(request), status: 'not assessed' }))
      h.runner.setAutomatic(true)
      await vi.advanceTimersByTimeAsync(8000)
      expect(h.evaluate).toHaveBeenCalledTimes(1)
      expect(completed).not.toHaveBeenCalled()
      h.evaluate.mockImplementation(async (request) => executePlatform(request))
      h.edit(() => {})
      await vi.advanceTimersByTimeAsync(8000)
      expect(h.state().feedback).toBe('progress')
      expect(completed).toHaveBeenCalledTimes(1)
      expect(h.state().completions).toHaveLength(0)
      expect(h.state().celebration).toBeUndefined()
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it('aborts pending automatic work on pause and ignores a late result on resume', async () => {
    vi.useFakeTimers()
    const h = harness()
    let finish!: (result: PlatformResult) => void
    try {
      h.load()
      h.evaluate.mockImplementationOnce(() => new Promise<PlatformResult>((resolve) => { finish = resolve }))
      h.runner.setAutomatic(true)
      await vi.advanceTimersByTimeAsync(500)
      expect(h.state().running).toBe(true)
      const request = h.evaluate.mock.calls[0][0]
      h.runner.setAutomatic(false)
      finish(executePlatform(request))
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.completed).not.toHaveBeenCalled()
      expect(h.state().canContinue).toBe(false)
      h.runner.setAutomatic(true)
      await vi.advanceTimersByTimeAsync(3000)
      expect(h.completed).toHaveBeenCalledTimes(1)
    } finally { h.runner.setAutomatic(false); vi.useRealTimers() }
  })

  it.each(['disabled', 'different-hub', 'different-table', 'unknown', 'removed'])('retains the original multi-hub tenant attachment and association: %s', async (change) => {
    const h = harness({ completions: beforeTask(scenarioBundle, 'multihub-labels.repair') }, scenarioBundle)
    h.load(h.bundle.scenarios.findIndex((scenario) => scenario.id === 'multihub-labels'))
    await h.runner.assess()
    expect(h.state().canContinue).toBe(false)
    h.edit((document) => {
      if (document.mode !== 'vwan') document.topology.vwanHubs[0].routeTables![0].labels = ['shared']
    })
    await h.runner.assess()
    expect(h.state().canContinue).toBe(true)
    h.evaluate.mockClear()
    h.edit((document) => {
      if (document.mode === 'vwan') throw new Error('Mixed fixture required')
      const tenant = document.topology.vnets[2]
      if (change === 'disabled') tenant.vwanHubAttachment!.enabled = false
      if (change === 'different-hub') tenant.vwanHubAttachment!.hubId = 'west-hub'
      if (change === 'different-table') tenant.vwanHubAttachment!.hubRouting!.associatedTableId = 'defaultRouteTable'
      if (change === 'unknown') tenant.vwanHubAttachment!.hubRouting!.status = 'unknown'
      if (change === 'removed') delete tenant.vwanHubAttachment
    })
    expect(h.runner.advance()).toBe(false)
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    expect(h.state().canContinue).toBe(false)
    expect(h.evaluate).not.toHaveBeenCalled()
  })

  it('requires exact multi-hub table observations and fresh source/return evidence after task or revision changes', async () => {
    const h = harness({ completions: beforeTask(scenarioBundle, 'multihub-labels.inspect') }, scenarioBundle)
    h.load(h.bundle.scenarios.findIndex((scenario) => scenario.id === 'multihub-labels'))
    const original = h.state().observation!
    for (const change of [{ hubId: 'east-hub' }, { tableId: 'defaultRouteTable' }, { prefix: '10.101.0.0/16' }]) {
      h.runner.observe({ ...original, ...change })
      await h.runner.assess()
      expect(h.state().feedback).toBe('inspect')
    }
    await h.inspect()
    expect(h.state().taskId).toBe('multihub-labels.compare')
    h.runner.observe(original)
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    const reply = h.state().observation!
    h.edit(() => {})
    h.runner.observe(reply)
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    await h.inspect()
    expect(h.state().taskId).toBe('multihub-labels.diagnose')
  })

  it('requires original hybrid connection state and actual selected gateways in addition to shared outcomes', async () => {
    const h = harness({ completions: beforeTask(scenarioBundle, 'hybrid-preference.repair') }, scenarioBundle)
    h.load(h.bundle.scenarios.findIndex((scenario) => scenario.id === 'hybrid-preference'))
    await h.runner.assess()
    expect(h.state().canContinue).toBe(false)
    h.edit((document) => {
      if (document.mode !== 'vwan') document.topology.vpnConnections[0].enabled = true
    })
    h.evaluate.mockImplementation(async (request) => {
      const result = executePlatform(request)
      const simulation = result.simulation as AzSimulationResult
      simulation.subnetTables.work.routes.forEach((route) => {
        if (route.prefix === '172.28.20.0/24') route.nextHopResourceId = 'backup-vpn'
      })
      return result
    })
    await h.runner.assess()
    expect(h.state().canContinue).toBe(false)
    expect(h.state().feedback).toBe('requirements')
    h.evaluate.mockImplementation(async (request) => executePlatform(request))
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.vpnConnections[0].bgpEnabled = false })
    await h.runner.assess()
    expect(h.state().canContinue).toBe(false)
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.vpnConnections[0].bgpEnabled = true })
    await h.runner.assess()
    expect(h.state().canContinue).toBe(true)
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.erLinks[1].enabled = false })
    expect(h.runner.advance()).toBe(false)
    await h.runner.assess()
    expect(h.state().canContinue).toBe(false)
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.erLinks[1].enabled = true })
    await h.pass()
  })

  it('requires the exact independent branch observation and invalidates it on edits and task changes', async () => {
    const h = harness({ completions: beforeTask(scenarioBundle, 'hybrid-preference.return') }, scenarioBundle)
    h.load(h.bundle.scenarios.findIndex((scenario) => scenario.id === 'hybrid-preference'))
    const observation = h.state().observation!
    h.runner.observe({ ...observation, siteId: 'another-branch' })
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    h.edit(() => {})
    h.runner.observe(observation)
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    await h.inspect()
    expect(h.state().taskId).toBe('hybrid-preference.explain')
  })
  it.each(['refused', 'throws'])('does not advance or reuse proof when completion recording %s', async (failure) => {
    let accepted = false
    const h = harness({ completed: () => {
      if (!accepted && failure === 'throws') throw new Error('Storage conflict')
      return accepted
    } })
    h.load()
    await h.runner.assess()
    expect(h.runner.advance()).toBe(false)
    expect(h.state()).toMatchObject({ taskId: 'peering.load', feedback: 'progress', canContinue: false, completions: [] })
    accepted = true
    expect(h.runner.advance()).toBe(false)
    await h.pass()
    expect(h.state().completions).toHaveLength(1)
    h.runner.replaceProgress([])
    expect(h.state()).toMatchObject({ taskId: 'peering.load', canContinue: false, completions: [] })
  })

  it('only advances after an explicit passing check on the matching protected practice canvas', async () => {
    const h = harness()
    expect(h.runner.advance()).toBe(false)
    await h.runner.assess()
    expect(h.state().feedback).toBe('scope')
    h.load(1)
    await h.runner.assess()
    expect(h.state().feedback).toBe('scope')
    h.load()
    await h.runner.assess()
    expect(h.state().completions).toHaveLength(0)
    expect(h.state().canContinue).toBe(true)
    h.runner.advance()
    expect(h.state().taskId).toBe('peering.predict')
    expect(h.completed).toHaveBeenCalledOnce()
    expect(h.completed.mock.calls[0][0]).toMatchObject({
      courseId: h.bundle.course.id, taskId: 'peering.load', awardId: 'peering.load',
      assessmentVersion: 1, points: 5, revision: h.live()!.revision, scope: h.live()!.scope,
    })
    expect(h.runner.advance()).toBe(false)
    h.runner.review('override.repair')
    expect(h.state().reviewId).toBeUndefined()
    h.runner.replayLesson('route-override')
    expect(h.state().taskId).toBe('peering.predict')
  })

  it('gives answer-specific retry feedback, without awarding wrong or missing quiz answers', async () => {
    const h = harness(); h.load(); await h.pass()
    await h.runner.assess()
    expect(h.state().feedback).toBe('answer')
    await h.runner.assess('same-region')
    expect(h.state().feedback).toBe('incorrect')
    expect(h.state().explanation?.en).toContain('does not establish')
    expect(h.state().canContinue).toBe(false)
    expect(h.completed).toHaveBeenCalledTimes(1)
    await h.pass('no-connection')
    expect(h.state().taskId).toBe('peering.inspect-before')
  })

  it('requires exact task/revision-scoped observation rather than assistance or an earlier inspection', async () => {
    const h = harness(); await h.toObservation()
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    const old = { ...h.state().observation! }
    for (const wrong of [{ ...old, subnetId: 'work-b' }, { ...old, prefix: '0.0.0.0/0' }, { ...old, token: 'old-task' }]) {
      h.runner.observe(wrong)
      await h.runner.assess()
      expect(h.state().canContinue).toBe(false)
    }
    h.edit((document) => { document.topology.name = 'Edited network' })
    h.runner.observe(old)
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    await h.inspect()
    h.peer(); await h.pass()
    expect(h.state().taskId).toBe('peering.inspect-after')
    h.runner.observe(old)
    await h.runner.assess()
    expect(h.state().feedback).toBe('inspect')
    await h.inspect()
    expect(h.state().taskId).toBe('peering.verify')
  })

  it('checks the exact direct peering in either orientation, both access flags and shared-engine outcome', async () => {
    const h = harness(); await h.toPeering()
    await h.runner.assess()
    expect(h.state().feedback).toBe('peering')
    h.peer()
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.vnetPeerings[0].bToA.allowVirtualNetworkAccess = false })
    await h.runner.assess()
    expect(h.state().feedback).toBe('peering')
    h.edit((document) => {
      if (document.mode === 'vwan') return
      document.topology.vnetPeerings[0].bToA.allowVirtualNetworkAccess = true
      document.topology.udrTables.push({ id: 'block', name: 'Block', disableBgpRoutePropagation: false, routes: [
        { id: 'drop', name: 'Drop', prefix: '10.2.0.0/16', nextHopType: 'None', enabled: true },
      ] })
      document.topology.vnets[0].subnets[0].routeTableId = 'block'
    })
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    expect(h.state().unmet).toContain('direct-flow')
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.udrTables[0].routes[0].enabled = false })
    await h.pass()
  })

  it.each(['disable-route', 'remove-association'])('completes the original lessons and unlocks the next incident with supported repair %s', async (repair) => {
    const h = harness(); await h.finishPeering()
    expect(h.state().taskId).toBe('override.load')
    await h.runner.assess()
    expect(h.state().feedback).toBe('scope')
    h.load(1); await h.pass(); await h.inspect()
    await h.runner.assess()
    expect(h.state().feedback).toBe('requirements')
    h.edit((document) => {
      if (document.mode === 'vwan') return
      if (repair === 'disable-route') document.topology.udrTables[0].routes[0].enabled = false
      else delete document.topology.vnets[0].subnets[0].routeTableId
    })
    await h.pass(); await h.pass('same-prefix')
    expect(h.state().taskId).toBe('prefix.load')
    expect(h.state().completions).toHaveLength(11)
    expect(h.completed).toHaveBeenCalledTimes(11)
  })

  it('invalidates an already passing candidate after edits, undo, reset or suspension', async () => {
    const h = harness(); h.load()
    await h.runner.assess()
    h.edit(() => {})
    expect(h.state().feedback).toBe('stale')
    expect(h.runner.advance()).toBe(false)
    await h.runner.assess()
    h.runner.cancel()
    expect(h.runner.advance()).toBe(false)
    await h.runner.assess()
    h.load()
    expect(h.runner.advance()).toBe(false)
    expect(h.completed).not.toHaveBeenCalled()
  })

  it.each(['edit', 'pause', 'replay', 'scope', 'assessment-version', 'content-version'])('discards delayed worker success after %s', async (change) => {
    let finish!: (result: PlatformResult) => void
    let captured!: PlatformRequest
    let signal!: AbortSignal
    const h = harness({ evaluate: (request, incoming) => {
      captured = request; signal = incoming
      return new Promise((resolve) => { finish = resolve })
    } })
    h.load()
    const pending = h.runner.assess()
    expect(h.state().running).toBe(true)
    if (change === 'edit') h.edit(() => {})
    if (change === 'pause') h.runner.cancel()
    if (change === 'replay') h.runner.replayLesson('direct-peering')
    if (change === 'scope') h.live()!.scope++
    if (change === 'assessment-version') h.bundle.lessons[0].tasks[0].assessmentVersion++
    if (change === 'content-version') h.bundle.course.contentVersion++
    if (['edit', 'pause', 'replay'].includes(change)) expect(signal.aborted).toBe(true)
    finish(executePlatform(captured))
    await pending
    expect(h.state().running).toBe(false)
    expect(h.state().canContinue).toBe(false)
    expect(h.state().completions).toHaveLength(0)
  })

  it.each(['not assessed', 'invalid', 'missing', 'unknown', 'duplicate', 'throw'])('never converts %s evidence to a pass', async (failure) => {
    const h = harness(); await h.toPeering(); h.peer()
    h.evaluate.mockImplementation(async (request) => {
      const result = executePlatform(request)
      if (failure === 'throw') throw new Error('worker stopped')
      if (failure === 'not assessed' || failure === 'invalid') result.status = failure
      if (failure === 'missing') result.assessments.pop()
      if (failure === 'duplicate') result.assessments[1] = result.assessments[0]
      if (failure === 'unknown') result.assessments[0].outcome = 'not assessed'
      return result
    })
    await h.runner.assess()
    expect(h.state().feedback).toBe('unassessed')
    expect(h.state().canContinue).toBe(false)
    expect(h.state().taskId).toBe('peering.connect')
  })

  it('keeps historical completion separate from current configuration, review and replay', async () => {
    const h = harness(); await h.finishPeering()
    const history = h.state().completions
    h.runner.review('peering.connect')
    expect(h.state().reviewId).toBe('peering.connect')
    h.edit((document) => { if (document.mode !== 'vwan') document.topology.vnetPeerings = [] })
    await h.runner.assess()
    expect(h.state().canContinue).toBe(false)
    expect(h.state().completions).toEqual(history)
    h.runner.replayLesson('direct-peering')
    expect(h.state().taskId).toBe('peering.load')
    h.load(); await h.pass(); await h.pass('no-connection'); await h.inspect(); h.peer()
    await h.pass(); await h.inspect(); await h.pass(); await h.pass('not-transitive')
    expect(h.state().taskId).toBe('override.load')
    expect(h.completed).toHaveBeenCalledTimes(7)
    expect(h.state().completions).toEqual(history)
  })

  it('resumes stable identities after reordering, but requires inserted and revised tasks without granting legacy credit', async () => {
    const h = harness(); h.load(); await h.pass(); await h.pass('no-connection')
    const completions = [...h.state().completions]
    const resume = () => createCourseRunner(h.bundle, { workspace: h.live, changed: () => {}, evaluate: h.evaluate, completions }).getSnapshot()
    h.bundle.lessons[0].taskOrder.splice(1, 2, 'peering.inspect-before', 'peering.predict')
    expect(resume().taskId).toBe('peering.inspect-before')
    const inserted = { ...h.bundle.lessons[0].tasks[1], id: 'peering.new-question', awardId: 'peering.new-question' }
    h.bundle.lessons[0].tasks.push(inserted)
    h.bundle.lessons[0].taskOrder.splice(1, 0, inserted.id)
    expect(resume().taskId).toBe(inserted.id)
    h.bundle.lessons[0].tasks[0].assessmentVersion++
    expect(resume().taskId).toBe('peering.load')
    expect(completions).toHaveLength(2)
    expect(orderedTasks(h.bundle)).toHaveLength(orderedTasks(exampleCourse).length + 1)
    expect(createCourseRunner(h.bundle, {
      workspace: h.live, changed: () => {}, evaluate: h.evaluate, completions: [] as TaskCompletion[],
    }).getSnapshot().taskId).toBe('peering.load')
  })
})

describe('learner-facing unmet flow conditions', () => {
  const flow = {
    id: 'inspected-pair', kind: 'flow' as const,
    source: { kind: 'subnet' as const, vnetId: 'a', subnetId: 'work-a' },
    target: { kind: 'subnet' as const, vnetId: 'b', subnetId: 'work-b' },
    sourceAddress: '10.1.1.4', destinationAddress: '10.2.1.4', expectation: 'allow' as const,
  }
  it.each([{ requiredApplianceId: 'vhub-fw:wan' }, { requiredFirewallHubId: 'wan' }])('explains both-direction inspection for %o without exposing engine IDs', (waypoint) => {
    const description = requirementDescription({ ...flow, ...waypoint })
    expect(description.en).toContain('Both directions must also traverse the required inspection waypoint.')
    expect(description.ja).toContain('往路と復路の両方が、指定された検査の通過点も経由する必要があります。')
    expect(description.en).not.toContain('vhub-fw:')
    expect(description.ja).not.toContain('vhub-fw:')
  })

  it('does not imply an inspection condition for ordinary allow/deny or exact-route checks', () => {
    const allow = requirementDescription(flow)
    const deny = requirementDescription({ ...flow, expectation: 'deny' })
    expect(allow.en).toContain('allow traffic')
    expect(deny.en).toContain('demonstrate the requested block')
    const route = requirementDescription({ id: 'route', kind: 'route', table: 'wan', prefix: '10.2.0.0/16', expectation: 'present' })
    for (const description of [allow, deny, route]) {
      expect(description.en).not.toContain('inspection waypoint')
      expect(description.ja).not.toContain('検査の通過点')
    }
  })
})
