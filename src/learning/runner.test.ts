import { describe, expect, it, vi } from 'vitest'
import { executePlatform } from '../platform/service'
import type { PlatformRequest, PlatformResult } from '../platform/contract'
import { exampleCourse } from './course-examples'
import { requirementDescription } from './runner-content'
import { createCourseRunner, orderedTasks, type LearningWorkspace, type RunnerOptions, type TaskCompletion } from './runner'

function harness(overrides: Partial<RunnerOptions> = {}) {
  const bundle = structuredClone(exampleCourse)
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

describe('evidence-gated course runner', () => {
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
