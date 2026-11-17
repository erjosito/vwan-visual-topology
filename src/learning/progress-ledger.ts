import type { CourseBundle } from './course-contract'
import type { TaskCompletion } from './runner'

export const guidedProgressKey = 'network-simulator:learning-progress:v1'
export const legacyProgressKey = 'aznet-simulator:practice:v1'
export const progressLimits = { entries: 2048, chars: 1_000_000 }
export type ProgressLedger = { version: 1; policyVersion: 1; completions: TaskCompletion[]; enrollment?: string }
export type ProgressStatus = 'saved' | 'session' | 'corrupt' | 'unavailable' | 'conflict' | 'limit' | 'ownership'
export type LedgerState = { ledger?: ProgressLedger; status: ProgressStatus; legacy: boolean }
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const emptyLedger = (): ProgressLedger => ({ version: 1, policyVersion: 1, completions: [] })
const identity = (entry: TaskCompletion) => JSON.stringify([entry.courseId, entry.taskId, entry.assessmentVersion])
const keys = ['courseId', 'contentVersion', 'lessonId', 'taskId', 'assessmentVersion', 'checkId', 'awardId',
  'points', 'title', 'sessionId', 'revision', 'scope', 'engineVersion', 'completedAt']
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
const bounded = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max
const objectKeys = (value: object, allowed: string[]) =>
  Object.keys(value).length === allowed.length && Object.keys(value).every((key) => allowed.includes(key))

function validCompletion(value: TaskCompletion): boolean {
  return !!value && objectKeys(value, keys)
    && [value.courseId, value.lessonId, value.taskId, value.checkId, value.awardId].every((id) =>
      typeof id === 'string' && /^[a-z][a-z0-9.-]{0,119}$/.test(id))
    && integer(value.contentVersion, 1) && integer(value.assessmentVersion, 1)
    && integer(value.points, 1, 10_000) && integer(value.revision) && integer(value.scope)
    && !!value.title && objectKeys(value.title, ['en', 'ja'])
    && bounded(value.title.en, 1000) && bounded(value.title.ja, 1000)
    && bounded(value.sessionId, 120) && bounded(value.engineVersion, 40)
    && bounded(value.completedAt, 40) && Number.isFinite(Date.parse(value.completedAt))
}

export function parseProgressLedger(raw: string): ProgressLedger {
  if (raw.length > progressLimits.chars) throw new Error('Progress storage limit')
  const value = JSON.parse(raw) as ProgressLedger
  if (!value || !objectKeys(value, ['version', 'policyVersion', 'completions', ...('enrollment' in value ? ['enrollment'] : [])])
    || ('enrollment' in value && !['azure-networking-preview', 'azure-routing-scenarios'].includes(value.enrollment!)) || value.version !== 1
    || value.policyVersion !== 1 || !Array.isArray(value.completions) || value.completions.length > progressLimits.entries
    || value.completions.some((entry) => !validCompletion(entry))
    || new Set(value.completions.map(identity)).size !== value.completions.length) throw new Error('Invalid guided progress')
  return value
}

export function recordCompletion(ledger: ProgressLedger, completion: TaskCompletion): ProgressLedger {
  if (!validCompletion(completion)) throw new Error('Invalid guided completion')
  const previous = ledger.completions.find((entry) => identity(entry) === identity(completion))
  if (previous) {
    if (previous.checkId !== completion.checkId || previous.awardId !== completion.awardId) throw new Error('Unversioned assessment change')
    return ledger
  }
  const next = { ...ledger, completions: [...ledger.completions, structuredClone(completion)] }
  if (next.completions.length > progressLimits.entries || JSON.stringify(next).length > progressLimits.chars) throw new Error('Progress storage limit')
  return next
}

export function earnedAwards(ledger: ProgressLedger, courseId: string) {
  const awards = new Map<string, TaskCompletion>()
  for (const completion of ledger.completions) {
    if (completion.courseId === courseId && !awards.has(completion.awardId)) awards.set(completion.awardId, completion)
  }
  return [...awards.values()]
}

export function beltProgress(
  ledger: ProgressLedger,
  course: CourseBundle['course'],
  assessments: { taskId: string; assessmentVersion: number; checkId: string }[],
) {
  const points = earnedAwards(ledger, course.id).reduce((total, entry) => total + entry.points, 0)
  const checkpointPassed = (id: string) => {
    const assessment = assessments.find((entry) => entry.taskId === id)
    return !!assessment && ledger.completions.some((entry) => entry.courseId === course.id && entry.taskId === id
      && entry.assessmentVersion === assessment.assessmentVersion && entry.checkId === assessment.checkId)
  }
  let index = 0
  while (index + 1 < course.belts.length) {
    const belt = course.belts[index + 1]
    if (points < belt.pointsRequired || !belt.checkpointTaskIds.every(checkpointPassed)) break
    index++
  }
  const next = course.belts[index + 1]
  return { points, belt: course.belts[index], next, pointsRemaining: next ? Math.max(0, next.pointsRequired - points) : 0,
    checkpointsRemaining: next?.checkpointTaskIds.filter((id) => !checkpointPassed(id)) ?? [] }
}

/** Storage mutation is only permitted while the caller owns the origin's exclusive practice lock. */
export function createProgressLedger(storage: StorageAccess) {
  let expected: string | null | undefined
  let dirty = false
  let state: LedgerState
  const listeners = new Set<() => void>()
  const publish = (next: LedgerState) => { state = next; for (const listener of listeners) listener() }
  const read = () => {
    let legacy = false
    try { legacy = storage().getItem(legacyProgressKey) !== null } catch { /* Guided data has its own recovery state. */ }
    try {
      expected = storage().getItem(guidedProgressKey)
      try { return { ledger: expected === null ? emptyLedger() : parseProgressLedger(expected), status: 'saved' as const, legacy } }
      catch { return { status: 'corrupt' as const, legacy } }
    } catch { expected = undefined; return { status: 'unavailable' as const, legacy } }
  }
  state = read()
  const write = (ledger: ProgressLedger, owned: boolean) => {
    if (!owned) { publish({ ...state, status: 'ownership' }); return false }
    if (expected === undefined) { publish({ ...state, status: 'unavailable' }); return false }
    try {
      if (storage().getItem(guidedProgressKey) !== expected) { publish({ ...state, status: 'conflict' }); return false }
    } catch { dirty = true; publish({ ...state, ledger, status: 'session' }); return true }
    const raw = JSON.stringify(ledger)
    try {
      storage().setItem(guidedProgressKey, raw)
      expected = raw; dirty = false
      publish({ ...state, ledger, status: 'saved' })
    } catch { dirty = true; publish({ ...state, ledger, status: 'session' }) }
    return true
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    record(completion: TaskCompletion, owned: boolean) {
      if (!state.ledger || ['corrupt', 'unavailable', 'conflict', 'limit'].includes(state.status)) return false
      let next: ProgressLedger
      try { next = recordCompletion(state.ledger, completion) }
      catch { publish({ ...state, status: 'limit' }); return false }
      return write(next, owned)
    },
    replace(ledger: ProgressLedger, owned: boolean) {
      if (!state.ledger || !['saved', 'session', 'ownership'].includes(state.status)) return false
      let next: ProgressLedger
      try { next = parseProgressLedger(JSON.stringify(ledger)) } catch { return false }
      return write(next, owned)
    },
    enroll(courseId: string, owned: boolean) {
      if (!state.ledger || !['saved', 'session', 'ownership'].includes(state.status)
        || !['azure-networking-preview', 'azure-routing-scenarios'].includes(courseId)) return false
      return write({ ...state.ledger, enrollment: courseId }, owned)
    },
    retry: (owned: boolean) => !!state.ledger && !['corrupt', 'conflict', 'limit'].includes(state.status) && write(state.ledger, owned),
    reset(owned: boolean) {
      if (!owned) { publish({ ...state, status: 'ownership' }); return false }
      try {
        if (expected === undefined || storage().getItem(guidedProgressKey) !== expected) {
          publish({ ...state, status: 'conflict' }); return false
        }
        storage().removeItem(guidedProgressKey)
        expected = null; dirty = false; publish({ ledger: emptyLedger(), status: 'saved', legacy: state.legacy })
        return true
      } catch { publish({ ...state, status: state.ledger ? 'session' : 'unavailable' }); return false }
    },
    externalChange(owned: boolean) {
      if (owned || dirty) { publish({ ...state, status: 'conflict' }); return }
      publish(read())
    },
    backup: (legacy: boolean) => legacy ? storage().getItem(legacyProgressKey) : state.ledger ? JSON.stringify(state.ledger) : expected,
  }
}

export type ProgressLedgerStore = ReturnType<typeof createProgressLedger>
