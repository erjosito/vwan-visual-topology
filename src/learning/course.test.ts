import { describe, expect, it } from 'vitest'
import { executePlatform } from '../platform/service'
import type { CourseBundle, CourseCheck } from './course-contract'
import { exampleCourse } from './course-examples'
import { courseOutline } from './course-outline'
import { validateCourse } from './course-validation'

function outcome(bundle: CourseBundle, lessonIndex: number) {
  const lesson = bundle.lessons[lessonIndex]
  const document = bundle.scenarios.find((scenario) => scenario.id === lesson.scenarioId)!.document
  const checkId = lesson.tasks.find((task) => bundle.checks.find((check) =>
    check.id === task.checkId)?.kind === 'requirements.satisfied')!.checkId
  const check = bundle.checks.find((check) => check.id === checkId)! as Extract<CourseCheck, { kind: 'requirements.satisfied' }>
  return executePlatform({ contractVersion: 1, operation: 'evaluate', document, requirements: check.params.requirements })
}

describe('declarative guided course content', () => {
  it('admits complete representative lessons without grading unsupported starters as valid content', () => {
    expect(validateCourse(exampleCourse)).toEqual(exampleCourse)
    for (const index of [0, 1]) {
      const result = outcome(exampleCourse, index)
      expect(result.status).toBe('complete')
      expect(result.assessments.some((assessment) => assessment.outcome === 'violated')).toBe(true)
      expect(result.assessments.some((assessment) => assessment.outcome === 'not assessed')).toBe(false)
    }
  })

  it('grounds the peering lesson in exact-route and bidirectional shared-engine evidence', () => {
    const bundle = structuredClone(exampleCourse)
    const document = bundle.scenarios[0].document
    if (document.mode === 'vwan') throw new Error('Mixed-network fixture required')
    document.topology.vnetPeerings.push({
      id: 'learner-peering', name: 'Learner connection', vnetAId: 'a', vnetBId: 'b', enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    })
    expect(outcome(bundle, 0).assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied', 'satisfied'])
    document.topology.vnetPeerings[0].bToA.allowVirtualNetworkAccess = false
    const reverseDenied = outcome(bundle, 0).assessments
    expect(reverseDenied[0].outcome).toBe('satisfied')
    expect(reverseDenied[1].outcome).toBe('violated')
  })

  it.each(['disable-route', 'remove-association'])('accepts supported advanced repair: %s', (repair) => {
    const bundle = structuredClone(exampleCourse)
    const document = bundle.scenarios[1].document
    if (document.mode === 'vwan') throw new Error('Mixed-network fixture required')
    if (repair === 'disable-route') document.topology.udrTables[0].routes[0].enabled = false
    else delete document.topology.vnets[0].subnets[0].routeTableId
    expect(outcome(bundle, 1).assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied'])
  })

  it('supports adding/reordering lessons, revising quizzes and tuning thresholds through content only', () => {
    const bundle = structuredClone(exampleCourse)
    const extra = structuredClone(bundle.lessons[0])
    extra.id = 'peering-review'
    extra.prerequisites = []
    const newIds = new Map(extra.tasks.map((task) => [task.id, `review.${task.id}`]))
    extra.taskOrder = extra.taskOrder.map((id) => newIds.get(id)!)
    for (const task of extra.tasks) {
      task.id = newIds.get(task.id)!
      task.awardId = task.id
      task.points += 1
      task.title = { en: 'Review the networking evidence', ja: 'ネットワークの根拠を復習する' }
    }
    bundle.lessons.push(extra)
    bundle.course.lessonOrder = [extra.id, ...bundle.course.lessonOrder]
    bundle.course.belts[1].pointsRequired = 150
    const quiz = bundle.checks.find((check) => check.kind === 'quiz.answered')!
    if (quiz.kind !== 'quiz.answered') throw new Error('Quiz required')
    quiz.params.question = { en: 'Predict whether a private connecting path exists.', ja: 'プライベート接続経路の有無を予測してください。' }
    expect(validateCourse(bundle)).toEqual(bundle)
    expect(bundle.lessons[0].tasks[0].awardId).toBe(exampleCourse.lessons[0].tasks[0].awardId)
  })

  it('resolves semantic guidance independent of parameter property order', () => {
    const bundle = structuredClone(exampleCourse)
    bundle.guidance[0].params = { prefix: '10.2.0.0/16', subnetId: 'work-a', vnetId: 'a' }
    expect(() => validateCourse(bundle)).not.toThrow()
  })

  const invalidCases: [string, (bundle: CourseBundle) => void][] = [
    ['missing translation', (bundle) => { bundle.lessons[0].objective.ja = '' }],
    ['unknown lesson reference', (bundle) => { bundle.course.lessonOrder[0] = 'missing' }],
    ['duplicate lesson reference', (bundle) => { bundle.course.lessonOrder.push(bundle.course.lessonOrder[0]) }],
    ['missing task reference', (bundle) => { bundle.lessons[0].taskOrder.pop() }],
    ['duplicate task identity', (bundle) => { bundle.lessons[1].tasks[0].id = bundle.lessons[0].tasks[0].id }],
    ['missing prerequisite', (bundle) => { bundle.lessons[1].prerequisites = ['missing'] }],
    ['prerequisite cycle', (bundle) => { bundle.lessons[0].prerequisites = [bundle.lessons[1].id] }],
    ['wrong dependency order', (bundle) => { bundle.course.lessonOrder.reverse() }],
    ['unknown check', (bundle) => { bundle.lessons[0].tasks[0].checkId = 'missing' }],
    ['unknown guidance', (bundle) => { bundle.lessons[0].tasks[2].guidanceIds = ['missing'] }],
    ['missing command guidance', (bundle) => { bundle.lessons[0].tasks[3].guidanceIds = [] }],
    ['wrong guidance scope', (bundle) => { bundle.lessons[0].tasks[2].guidanceIds = ['peer-command'] }],
    ['duplicate award', (bundle) => { bundle.lessons[1].tasks[0].awardId = bundle.lessons[0].tasks[0].awardId }],
    ['zero completion points', (bundle) => { bundle.lessons[0].tasks[0].points = 0 }],
    ['unattainable threshold', (bundle) => { bundle.course.belts[1].pointsRequired = Number.MAX_SAFE_INTEGER }],
    ['nonincreasing thresholds', (bundle) => { bundle.course.belts[1].pointsRequired = 0 }],
    ['unknown checkpoint', (bundle) => { bundle.course.belts[1].checkpointTaskIds = ['missing'] }],
    ['missing checkpoint', (bundle) => { bundle.course.belts[1].checkpointTaskIds = [] }],
    ['starting belt checkpoint', (bundle) => { bundle.course.belts[0].checkpointTaskIds = ['peering.explain'] }],
    ['unreferenced definition', (bundle) => { bundle.checks.push({ id: 'orphan', kind: 'scenario.loaded', params: { scenarioId: 'two-vnets' } }) }],
    ['wrong scenario load', (bundle) => { bundle.lessons[1].tasks[0].checkId = 'load-peering' }],
    ['implicit starter loading', (bundle) => { bundle.lessons[0].taskOrder.reverse() }],
  ]
  it.each(invalidCases)('rejects %s', (_name, change) => {
    const bundle = structuredClone(exampleCourse)
    change(bundle)
    expect(() => validateCourse(bundle)).toThrow()
  })

  it('rejects unknown task/check/action parameters and embedded executable lesson code', () => {
    for (const change of [
      (bundle: CourseBundle) => Object.assign(bundle.checks[0], { kind: 'arbitrary-script' }),
      (bundle: CourseBundle) => Object.assign(bundle.guidance[0].params, { selector: 'button:nth-child(2)' }),
      (bundle: CourseBundle) => Object.assign(bundle.lessons[0].tasks[0], { execute: () => true }),
    ]) {
      const bundle = structuredClone(exampleCourse)
      change(bundle)
      expect(() => validateCourse(bundle)).toThrow()
    }
  })

  it('rejects malformed, unowned and unsupported assessment bindings', () => {
    for (const change of [
      (bundle: CourseBundle) => { Object.assign(bundle.checks.find((check) => check.id === 'inspect-a')!.params, { prefix: '10.2.1.1/16' }) },
      (bundle: CourseBundle) => { Object.assign(bundle.checks.find((check) => check.id === 'peer-a-b')!.params, { vnetBId: 'missing' }) },
      (bundle: CourseBundle) => { Object.assign(bundle.guidance.find((target) => target.id === 'repair-drop')!.params, { routeId: 'missing' }) },
      (bundle: CourseBundle) => {
        const check = bundle.checks.find((check) => check.id === 'connected')!
        if (check.kind === 'requirements.satisfied') Object.assign(check.params.requirements[0], { table: 'missing' })
      },
      (bundle: CourseBundle) => {
        const check = bundle.checks.find((check) => check.id === 'connected')!
        if (check.kind === 'requirements.satisfied') Object.assign(check.params.requirements[1], { sourceAddress: 'invalid' })
      },
      (bundle: CourseBundle) => { Object.assign(bundle.scenarios[0].document, { topology: {} }) },
    ]) {
      const bundle = structuredClone(exampleCourse)
      change(bundle)
      expect(() => validateCourse(bundle)).toThrow()
    }
  })

  it('rejects missing quiz answers, duplicate choices and untranslated answer-specific feedback', () => {
    for (const change of [
      (check: Extract<CourseCheck, { kind: 'quiz.answered' }>) => { check.params.correctChoiceId = 'missing' },
      (check: Extract<CourseCheck, { kind: 'quiz.answered' }>) => { check.params.choices[1].id = check.params.choices[0].id },
      (check: Extract<CourseCheck, { kind: 'quiz.answered' }>) => { check.params.choices[0].feedback.ja = '' },
    ]) {
      const bundle = structuredClone(exampleCourse)
      const check = bundle.checks.find((item) => item.kind === 'quiz.answered')!
      if (check.kind === 'quiz.answered') change(check)
      expect(() => validateCourse(bundle)).toThrow()
    }
  })

  it('backs every reviewed belt allocation with the actual sequential task budget', () => {
    let budget = 0
    for (const belt of courseOutline) {
      expect(belt.pointsRequired).toBe(budget)
      budget += belt.plannedTaskPoints
    }
    expect(exampleCourse.course.publication).toBe('complete')
    let available = 0
    for (const [index, id] of exampleCourse.course.lessonOrder.entries()) {
      const lesson = exampleCourse.lessons.find((item) => item.id === id)!
      const points = lesson.tasks.reduce((total, task) => total + task.points, 0)
      expect(points).toBe(courseOutline[index].plannedTaskPoints)
      available += points
      expect(exampleCourse.course.belts[index + 1].pointsRequired).toBe(available)
    }
    expect(available).toBe(courseOutline.at(-1)!.pointsRequired)
  })
})
