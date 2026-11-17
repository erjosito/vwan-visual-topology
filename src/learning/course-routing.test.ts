import { describe, expect, it } from 'vitest'
import { executePlatform } from '../platform/service'
import { exampleCourse } from './course-examples'
import { checkpointAssessments } from './course-profile'
import { validateCourse } from './course-validation'
import { beltProgress, earnedAwards, parseProgressLedger, recordCompletion, type ProgressLedger } from './progress-ledger'
import { createCourseRunner, orderedTasks, type LearningWorkspace } from './runner'

function scenario(id: string) {
  const document = structuredClone(exampleCourse.scenarios.find((item) => item.id === id)!.document)
  if (document.mode === 'vwan') throw new Error('Mixed provider required')
  return document
}

function evaluate(document: ReturnType<typeof scenario>, checkId: string) {
  const check = exampleCourse.checks.find((item) => item.id === checkId)!
  if (check.kind !== 'requirements.satisfied') throw new Error('Engine check required')
  const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document, requirements: check.params.requirements })
  expect(result.status).toBe('complete')
  expect(result.errors).toEqual([])
  expect(result.assessments.every((item) => item.outcome !== 'not assessed')).toBe(true)
  return result.assessments
}

describe('routing incident content', () => {
  it('admits every authored scope and distinguishes the two destinations before repair', () => {
    expect(validateCourse(exampleCourse)).toEqual(exampleCourse)
    const document = scenario('prefix-outage')
    expect(evaluate(document, 'prefix-restored').map((item) => item.outcome)).toEqual(['violated', 'satisfied'])
    document.topology.udrTables[0].routes.find((route) => route.id === 'broad-discard')!.enabled = false
    expect(evaluate(document, 'prefix-restored').map((item) => item.outcome)).toEqual(['violated', 'satisfied'])
  })

  it('requires the gateway return path even when the source has a learned route and can forward', () => {
    const document = scenario('gateway-return')
    const before = evaluate(document, 'gateway-evidence')
    expect(before.map((item) => item.outcome)).toEqual(['satisfied', 'violated'])
    expect(before[1].evidence).toMatchObject({
      forward: { status: 'delivered' }, reverse: { status: 'dropped-blackhole' },
    })
    document.topology.udrTables[0].routes[0].enabled = false
    const after = evaluate(document, 'gateway-evidence')
    expect(after.map((item) => item.outcome)).toEqual(['satisfied', 'satisfied'])
    expect(after[1].evidence).toMatchObject({
      forward: { traversedEdgeIds: expect.arrayContaining(['gateway-transit', 'branch-vpn']) },
      reverse: { traversedEdgeIds: expect.arrayContaining(['gateway-transit', 'branch-vpn']) },
    })
    document.topology.vnetPeerings[0].bToA.useRemoteGateways = false
    expect(evaluate(document, 'gateway-restored')[0].outcome).toBe('violated')
  })

  it.each(['prefix-outage', 'gateway-return'])('accepts both supported outcome-based repairs for %s', (id) => {
    for (const repair of ['disable-route', 'remove-association']) {
      const document = scenario(id)
      const checkId = id === 'prefix-outage' ? 'prefix-restored' : 'gateway-restored'
      expect(evaluate(document, checkId).some((item) => item.outcome === 'violated')).toBe(true)
      if (repair === 'disable-route') document.topology.udrTables[0].routes[0].enabled = false
      else {
        const owner = document.topology.vnets.flatMap((vnet) => vnet.subnets).find((subnet) => subnet.routeTableId)!
        delete owner.routeTableId
      }
      expect(evaluate(document, checkId).every((item) => item.outcome === 'satisfied')).toBe(true)
    }
  })

  it.each([0, 11, 24])('reaches every belt retaining historical awards, reload after task count: %s', async (reloadAt) => {
    let ledger: ProgressLedger = { version: 1, policyVersion: 1, completions: [] }
    let live: LearningWorkspace | undefined
    const options = () => ({
      workspace: () => live, changed: () => {},
      completions: ledger.completions,
      evaluate: async (request: Parameters<typeof executePlatform>[0]) => executePlatform(request),
      completed: (completion: Parameters<typeof recordCompletion>[1]) => {
        ledger = recordCompletion(ledger, { ...completion,
          contentVersion: reloadAt && ledger.completions.length < reloadAt ? reloadAt === 11 ? 2 : 3 : completion.contentVersion })
      },
    })
    let runner = createCourseRunner(exampleCourse, options())
    const checkpoints: Record<string, [string, number]> = {
      'peering.explain': ['yellow', 100], 'override.explain': ['orange', 175],
      'prefix.explain': ['green', 325], 'gateway.explain': ['blue', 550],
      'wan.explain': ['brown', 875], 'capstone.explain': ['black', 1325],
    }
    for (const { task, lesson } of orderedTasks(exampleCourse)) {
      expect(runner.getSnapshot().taskId).toBe(task.id)
      const check = exampleCourse.checks.find((item) => item.id === task.checkId)!
      if (check.kind === 'scenario.loaded') {
        live = { scope: (live?.scope ?? 0) + 1, revision: (live?.revision ?? 0) + 1, practice: {
          version: 1, active: true, courseId: exampleCourse.course.id, scenarioId: lesson.scenarioId,
          returnProvider: 'azure-net', document: scenario(lesson.scenarioId),
        } }
        runner.workspaceChanged()
      }
      if (!live || live.practice.document.mode === 'vwan') throw new Error('Practice required')
      if (check.kind === 'routes.inspected') runner.observe(runner.getSnapshot().observation!)
      if (check.kind === 'vnet.peered') {
        live.practice.document.topology.vnetPeerings.push({
          id: 'learner', name: 'Learner', vnetAId: 'a', vnetBId: 'b', enabled: true,
          aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
          bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
        })
        live.revision++; runner.workspaceChanged()
      }
      const target = task.guidanceIds.map((id) => exampleCourse.guidance.find((item) => item.id === id)!)
        .find((item) => item.action === 'route-table.configure')
      if (target?.action === 'route-table.configure') {
        await runner.assess()
        expect(runner.getSnapshot().feedback).toBe('requirements')
        live.practice.document.topology.udrTables.find((table) => table.id === target.params.routeTableId)!
          .routes.find((route) => route.id === target.params.routeId)!.enabled = false
        live.revision++; runner.workspaceChanged()
      }
      await runner.assess(check.kind === 'quiz.answered' ? check.params.correctChoiceId : undefined)
      expect(runner.getSnapshot().feedback).toBe('passed')
      expect(runner.advance()).toBe(true)
      const checkpoint = checkpoints[task.id]
      if (checkpoint) expect(beltProgress(ledger, exampleCourse.course, checkpointAssessments)).toMatchObject({
        belt: { id: checkpoint[0] }, points: checkpoint[1],
      })
      if (reloadAt && ledger.completions.length === reloadAt) {
        const original = JSON.stringify(ledger)
        ledger = parseProgressLedger(original)
        runner = createCourseRunner(exampleCourse, options())
        expect(runner.getSnapshot().taskId).toBe(orderedTasks(exampleCourse)[reloadAt].task.id)
        expect(JSON.stringify(ledger)).toBe(original)
      }
    }
    expect(runner.getSnapshot().taskId).toBeUndefined()
    expect(earnedAwards(ledger, exampleCourse.course.id)).toHaveLength(40)
    const reloaded = createCourseRunner(exampleCourse, options())
    expect(reloaded.getSnapshot().taskId).toBeUndefined()
    expect(beltProgress(ledger, exampleCourse.course, checkpointAssessments)).toMatchObject({
      points: 1325, belt: { id: 'black' }, next: undefined,
    })
  })
})
