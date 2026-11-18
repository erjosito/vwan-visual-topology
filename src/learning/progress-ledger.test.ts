import { describe, expect, it } from 'vitest'
import { exampleCourse } from './course-examples'
import { checkpointAssessments, previewCourse } from './course-profile'
import { beltProgress, createProgressLedger, earnedAwards, guidedProgressKey, legacyProgressKey,
  parseProgressLedger, progressLimits, recordCompletion, type ProgressLedger } from './progress-ledger'
import { orderedTasks, type TaskCompletion } from './runner'
import { learningTracks } from './tracks'
import { editions, highestTrackBelt, scenarioAssessments, scenarioCourse, selectedEdition } from './editions'

const empty = (): ProgressLedger => ({ version: 1, policyVersion: 1, completions: [] })
const completion = (index = 0, changes: Partial<TaskCompletion> = {}): TaskCompletion => {
  const { task, lesson } = orderedTasks(exampleCourse)[index]
  return { courseId: exampleCourse.course.id, contentVersion: 2, lessonId: lesson.id, taskId: task.id,
    assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
    title: task.title, sessionId: 'session-one', revision: index, scope: 1, engineVersion: 'test-engine',
    completedAt: '2026-11-16T12:00:00.000Z', ...changes }
}
const storage = () => {
  const data = new Map<string, string>([['normal-design', 'keep'], [legacyProgressKey, 'original legacy, even if unreadable']])
  let quota = false
  return { data, quota: (value: boolean) => { quota = value }, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (quota) throw new Error('quota'); data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) } }
}

describe('versioned completion and first-award ledger', () => {
  it('summarizes the highest earned belt independently of enrollment without counting editions as tracks', () => {
    expect(highestTrackBelt(empty())).toMatchObject({ belt: { id: 'white' }, trackCount: 1 })
    const historical = { ...empty(), enrollment: scenarioCourse.id,
      completions: orderedTasks(exampleCourse).map((_, index) => completion(index)) }
    expect(beltProgress(historical, scenarioCourse, scenarioAssessments)).toMatchObject({ belt: { id: 'white' } })
    expect(highestTrackBelt(historical)).toMatchObject({ belt: { id: 'black' }, trackCount: 1 })
    expect(highestTrackBelt({ ...empty(), completions: [completion(0, { courseId: 'future-dns', points: 9999 })] }))
      .toMatchObject({ belt: { id: 'white' }, trackCount: 1 })
  })
  it('defaults new learners to scenarios but preserves original-edition enrollment and historical black belts', () => {
    expect(selectedEdition(empty()).course.id).toBe(scenarioCourse.id)
    const historical = { ...empty(), completions: orderedTasks(exampleCourse).map((_, index) => completion(index)) }
    const raw = storage()
    raw.setItem(guidedProgressKey, JSON.stringify(historical))
    const store = createProgressLedger(() => raw)
    const previous = store.getSnapshot().ledger!.completions
    expect(selectedEdition(store.getSnapshot().ledger).course.id).toBe(previewCourse.id)
    expect(store.enroll(scenarioCourse.id, false)).toBe(false)
    expect(store.enroll(scenarioCourse.id, true)).toBe(true)
    expect(selectedEdition(createProgressLedger(() => raw).getSnapshot().ledger).course.id).toBe(scenarioCourse.id)
    expect(store.getSnapshot().ledger!.completions).toEqual(previous)
    expect(beltProgress(store.getSnapshot().ledger!, scenarioCourse, editions[1].assessments)).toMatchObject({ points: 0, belt: { id: 'white' } })
    expect(beltProgress(store.getSnapshot().ledger!, previewCourse, checkpointAssessments)).toMatchObject({ points: 1325, belt: { id: 'black' } })
    expect(store.enroll(previewCourse.id, true)).toBe(true)
    expect(store.getSnapshot().ledger!.completions).toEqual(previous)
  })
  it('does not enroll on corrupt data, conflicting writes or unknown edition identities', () => {
    const raw = storage()
    const store = createProgressLedger(() => raw)
    expect(store.enroll('unknown-course', true)).toBe(false)
    raw.setItem(guidedProgressKey, 'preserve external bytes')
    expect(store.enroll(scenarioCourse.id, true)).toBe(false)
    expect(raw.getItem(guidedProgressKey)).toBe('preserve external bytes')
    const broken = createProgressLedger(() => raw)
    expect(broken.enroll(scenarioCourse.id, true)).toBe(false)
    expect(() => parseProgressLedger(JSON.stringify({ ...empty(), enrollment: 'unknown-course' }))).toThrow()
  })
  it('retains explicit session-only enrollment through failed writes and persists it on retry', () => {
    const raw = storage()
    let quota = true
    const store = createProgressLedger(() => ({ ...raw, setItem: (key, value) => {
      if (quota) throw new Error('quota')
      raw.setItem(key, value)
    } }))
    expect(store.enroll(previewCourse.id, true)).toBe(true)
    expect(store.getSnapshot().status).toBe('session')
    expect(selectedEdition(store.getSnapshot().ledger).course.id).toBe(previewCourse.id)
    expect(raw.getItem(guidedProgressKey)).toBeNull()
    quota = false
    expect(store.retry(true)).toBe(true)
    expect(selectedEdition(createProgressLedger(() => raw).getSnapshot().ledger).course.id).toBe(previewCourse.id)
  })
  it('reads a pre-track black-belt backup unchanged, without credit from another course', () => {
    const raw = storage()
    const ledger: ProgressLedger = { ...empty(), completions: [
      ...orderedTasks(exampleCourse).map((_, index) => completion(index, {
        courseId: 'azure-networking-preview', contentVersion: index < 11 ? 2 : index < 24 ? 3 : 4,
      })),
      completion(0, { courseId: 'future-dns', points: 9999 }),
    ] }
    const backup = JSON.stringify(ledger, null, 2)
    raw.setItem('network-simulator:learning-progress:v1', backup)
    const store = createProgressLedger(() => raw)
    const track = learningTracks.find((entry) => entry.status === 'available')
    if (track?.status !== 'available') throw new Error('Playable track required')
    expect(beltProgress(store.getSnapshot().ledger!, { ...previewCourse, id: track.courseId }, checkpointAssessments))
      .toMatchObject({ belt: { id: 'black' }, points: 1325, next: undefined })
    expect(store.getSnapshot().ledger?.completions).toEqual(ledger.completions)
    expect(raw.getItem(guidedProgressKey)).toBe(backup)
    expect(JSON.parse(store.backup(false)!).completions).toEqual(ledger.completions)
    expect(earnedAwards(recordCompletion(store.getSnapshot().ledger!, completion(39)), track.courseId)).toHaveLength(40)
  })

  it('deduplicates retries, repeated events, refresh and reassessment without repricing earned or retired awards', () => {
    let ledger = recordCompletion(empty(), completion())
    ledger = recordCompletion(ledger, completion(0, { points: 999, title: { en: 'Edited wording', ja: '改訂' } }))
    expect(ledger.completions).toHaveLength(1)
    ledger = recordCompletion(ledger, completion(0, { assessmentVersion: 2, points: 1 }))
    ledger = parseProgressLedger(JSON.stringify(ledger))
    expect(ledger.completions).toHaveLength(2)
    expect(earnedAwards(ledger, previewCourse.id).map((entry) => entry.points)).toEqual([5])
    expect(earnedAwards(ledger, 'other-course')).toEqual([])
    const changed = structuredClone(previewCourse)
    changed.lessonOrder.reverse()
    expect(beltProgress(ledger, changed, checkpointAssessments).points).toBe(5)
    expect(() => recordCompletion(ledger, completion(0, { awardId: 'unversioned-award-change' }))).toThrow('Unversioned')
  })

  it('derives points and revised checkpoints, including a terminal two-belt content configuration', () => {
    const course = { ...previewCourse, belts: previewCourse.belts.slice(0, 2) }
    let ledger = empty()
    for (let index = 0; index < 6; index++) ledger = recordCompletion(ledger, completion(index))
    expect(beltProgress(ledger, course, checkpointAssessments)).toMatchObject({
      points: 80, belt: { id: 'white' }, pointsRemaining: 20, checkpointsRemaining: ['peering.explain'],
    })
    ledger = recordCompletion(ledger, completion(7, { points: 100 }))
    expect(beltProgress(ledger, course, checkpointAssessments)).toMatchObject({
      points: 180, belt: { id: 'white' }, pointsRemaining: 0, checkpointsRemaining: ['peering.explain'],
    })
    ledger = recordCompletion(ledger, completion(6))
    expect(beltProgress(ledger, course, checkpointAssessments)).toMatchObject({
      points: 200, belt: { id: 'yellow' }, next: undefined, pointsRemaining: 0,
    })
    const revised = checkpointAssessments.map((entry) => ({ ...entry, assessmentVersion: 2 }))
    expect(beltProgress(ledger, course, revised).belt.id).toBe('white')
    ledger = recordCompletion(ledger, completion(6, { assessmentVersion: 2, points: 500 }))
    expect(beltProgress(ledger, course, revised).points).toBe(200)
    expect(beltProgress(ledger, course, revised).belt.id).toBe('yellow')
    const full = structuredClone(course)
    full.belts.push({ ...full.belts[1], id: 'black', pointsRequired: 200, name: { en: 'Black belt', ja: '黒帯' } })
    full.publication = 'complete'
    expect(beltProgress(ledger, full, revised)).toMatchObject({ belt: { id: 'black' }, next: undefined, checkpointsRemaining: [] })
  })

  it('keeps lightweight header checkpoint definitions identical to the authored grading identities', () => {
    for (const id of previewCourse.belts.flatMap((belt) => belt.checkpointTaskIds)) {
      const { task } = orderedTasks(exampleCourse).find((entry) => entry.task.id === id)!
      expect(checkpointAssessments).toContainEqual({ taskId: task.id, assessmentVersion: task.assessmentVersion, checkId: task.checkId })
    }
  })

  it('rejects corrupt, unversioned, duplicate and oversized records without interpreting them as zero earned points', () => {
    for (const raw of ['null', '{}', '[]', 'broken', 'x'.repeat(progressLimits.chars + 1),
      JSON.stringify({ ...empty(), policyVersion: 2 }), JSON.stringify({ ...empty(), extra: true }),
      JSON.stringify({ ...empty(), completions: [completion(), completion()] }),
      JSON.stringify({ ...empty(), completions: [completion(0, { assessmentVersion: 0 })] }),
      JSON.stringify({ ...empty(), completions: [completion(0, { points: -1 })] }),
      JSON.stringify({ ...empty(), completions: [completion(0, { title: { en: 'x', ja: '' } })] }),
    ]) expect(() => parseProgressLedger(raw)).toThrow()
    const ledger = { ...empty(), completions: Array.from({ length: progressLimits.entries }, (_, index) =>
      completion(0, { taskId: `task.${index}`, awardId: `award.${index}` })) }
    expect(() => recordCompletion(ledger, completion(0, { taskId: 'task.new', awardId: 'award.new' }))).toThrow('limit')
  })

  it('honestly retains quota-failed awards in memory, retries saving and reloads without duplicate awards', () => {
    const raw = storage(), store = createProgressLedger(() => raw)
    raw.quota(true)
    expect(store.record(completion(), true)).toBe(true)
    expect(store.getSnapshot().status).toBe('session')
    expect(raw.getItem(guidedProgressKey)).toBeNull()
    expect(earnedAwards(store.getSnapshot().ledger!, previewCourse.id)).toHaveLength(1)
    expect(store.record(completion(), true)).toBe(true)
    raw.quota(false)
    expect(store.retry(true)).toBe(true)
    expect(store.getSnapshot().status).toBe('saved')
    const reloaded = createProgressLedger(() => raw)
    expect(reloaded.record(completion(), true)).toBe(true)
    expect(earnedAwards(reloaded.getSnapshot().ledger!, previewCourse.id).map((entry) => entry.points)).toEqual([5])
    expect(raw.getItem('normal-design')).toBe('keep')
  })

  it('refuses non-owner and interleaved stale writes rather than overwriting another tab', () => {
    const raw = storage(), first = createProgressLedger(() => raw), second = createProgressLedger(() => raw)
    expect(first.record(completion(), true)).toBe(true)
    const saved = raw.getItem(guidedProgressKey)
    expect(second.record(completion(1), false)).toBe(false)
    expect(raw.getItem(guidedProgressKey)).toBe(saved)
    expect(second.record(completion(1), true)).toBe(false)
    expect(second.getSnapshot().status).toBe('conflict')
    second.externalChange(false)
    expect(second.record(completion(1), true)).toBe(true)
    first.externalChange(true)
    expect(first.getSnapshot().status).toBe('conflict')
    expect(first.record(completion(2), true)).toBe(false)
    expect(parseProgressLedger(raw.getItem(guidedProgressKey)!).completions).toHaveLength(2)
  })

  it('preserves session-only awards for backup across repeated external changes after ownership is released', () => {
    const raw = storage(), store = createProgressLedger(() => raw)
    raw.quota(true)
    expect(store.record(completion(), true)).toBe(true)
    const unsaved = store.backup(false)
    raw.quota(false)
    const external = JSON.stringify(recordCompletion(empty(), completion(1)))
    raw.setItem(guidedProgressKey, external)
    store.externalChange(false)
    store.externalChange(false)
    expect(store.getSnapshot().status).toBe('conflict')
    expect(store.backup(false)).toBe(unsaved)
    expect(store.retry(true)).toBe(false)
    expect(raw.getItem(guidedProgressKey)).toBe(external)
  })

  it('preserves unreadable originals and legacy bytes with a usable backup, and resets only guided history', () => {
    const raw = storage()
    raw.data.set(guidedProgressKey, 'damaged guided original')
    const originals = [...raw.data]
    const store = createProgressLedger(() => raw)
    expect(store.getSnapshot()).toMatchObject({ status: 'corrupt', legacy: true })
    expect(store.getSnapshot().ledger).toBeUndefined()
    expect(store.record(completion(), true)).toBe(false)
    expect(store.backup(false)).toBe('damaged guided original')
    expect(store.backup(true)).toBe('original legacy, even if unreadable')
    expect([...raw.data]).toEqual(originals)
    expect(store.reset(true)).toBe(true)
    expect(raw.getItem(guidedProgressKey)).toBeNull()
    expect(raw.getItem('normal-design')).toBe('keep')
    expect(raw.getItem(legacyProgressKey)).toBe('original legacy, even if unreadable')
    expect(store.getSnapshot()).toMatchObject({ status: 'saved', ledger: empty() })
  })

  it('does not claim successful reset or durable progress when storage cannot be read or deleted', () => {
    const unreadable = createProgressLedger(() => { throw new Error('disabled') })
    expect(unreadable.getSnapshot().status).toBe('unavailable')
    expect(unreadable.record(completion(), true)).toBe(false)
    expect(unreadable.reset(true)).toBe(false)
    const raw = storage()
    raw.setItem(guidedProgressKey, JSON.stringify(recordCompletion(empty(), completion())))
    const store = createProgressLedger(() => ({ ...raw, removeItem: () => { throw new Error('disabled') } }))
    expect(store.reset(true)).toBe(false)
    expect(store.getSnapshot().ledger?.completions).toHaveLength(1)
    expect(raw.getItem(guidedProgressKey)).not.toBeNull()
  })
})
