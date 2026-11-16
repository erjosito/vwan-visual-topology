import { engineVersion } from '../platform/contract'
import type { PlatformResult } from '../platform/contract'
import { exercises } from './exercises'
import type { Exercise } from './exercises'
export { guidedProgressKey, parseProgressLedger, recordCompletion, earnedAwards, beltProgress } from './progress-ledger'

export const progressKey = 'aznet-simulator:practice:v1'
export const maxDraftChars = 200_000
export type Attempt = {
  at: string
  outcome: 'satisfied' | 'violated' | 'not assessed'
  engine: string
  exerciseVersion: number
  revision: string
  hints: number
}
export type Progress = { version: 1; entries: { id: string; draft: string; hints: number; attempts: Attempt[]; achievement?: Attempt }[] }
export const emptyProgress = (): Progress => ({ version: 1, entries: [] })

export function parseProgress(raw: string): Progress {
  if (raw.length > 1_000_000) throw new Error('Practice storage limit')
  const value = JSON.parse(raw) as Progress
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > exercises.length) throw new Error('Invalid practice storage')
  if (Object.keys(value).some((key) => !['version', 'entries'].includes(key))) throw new Error('Unknown practice field')
  const ids = new Set<string>()
  for (const entry of value.entries) {
    const exercise = exercises.find((item) => item.id === entry.id)
    if (!exercise || ids.has(entry.id) || typeof entry.draft !== 'string' || entry.draft.length > maxDraftChars
      || !Number.isInteger(entry.hints) || entry.hints < 0 || entry.hints > exercise.hints.length
      || !Array.isArray(entry.attempts) || entry.attempts.length > 20) throw new Error('Invalid practice entry')
    ids.add(entry.id)
    if (Object.keys(entry).some((key) => !['id', 'draft', 'hints', 'attempts', 'achievement'].includes(key))
      || (entry.achievement && entry.achievement.outcome !== 'satisfied')) throw new Error('Invalid practice achievement')
    for (const attempt of [...entry.attempts, ...(entry.achievement ? [entry.achievement] : [])]) {
      if (!attempt || !['satisfied', 'violated', 'not assessed'].includes(attempt.outcome)
        || typeof attempt.at !== 'string' || !Number.isFinite(Date.parse(attempt.at))
        || typeof attempt.engine !== 'string' || attempt.engine.length > 40
        || typeof attempt.revision !== 'string' || attempt.revision.length > 40
        || !Number.isInteger(attempt.exerciseVersion) || attempt.exerciseVersion < 1
        || !Number.isInteger(attempt.hints) || attempt.hints < 0 || attempt.hints > exercise.hints.length
        || Object.keys(attempt).some((key) => !['at', 'outcome', 'engine', 'exerciseVersion', 'revision', 'hints'].includes(key))) throw new Error('Invalid practice attempt')
    }
  }
  return value
}

export function entryFor(progress: Progress, exercise: Exercise): Progress['entries'][number] {
  return progress.entries.find((entry) => entry.id === exercise.id)
    ?? { id: exercise.id, draft: JSON.stringify(exercise.starter.topology, null, 2), hints: 0, attempts: [] }
}

export function outcomeFor(exercise: Exercise, result: PlatformResult): Attempt['outcome'] {
  const ids = exercise.requirements.map((requirement) => requirement.id)
  if (result.status !== 'complete' || result.contractVersion !== 1 || result.engineVersion !== engineVersion
    || result.errors.length || !result.document || result.document.mode !== exercise.starter.mode
    || result.assessments.length !== ids.length || new Set(result.assessments.map((item) => item.id)).size !== ids.length
    || ids.some((id) => !result.assessments.some((item) => item.id === id))
    || result.assessments.some((item) => !['satisfied', 'violated'].includes(item.outcome))) return 'not assessed'
  return result.assessments.every((item) => item.outcome === 'satisfied') ? 'satisfied' : 'violated'
}

export function recordAttempt(progress: Progress, exercise: Exercise, result: PlatformResult, draft: string): Progress {
  const entry = entryFor(progress, exercise)
  const attempt: Attempt = {
    at: new Date().toISOString(), outcome: outcomeFor(exercise, result),
    engine: engineVersion, exerciseVersion: exercise.version, revision: result.revision, hints: entry.hints,
  }
  return { ...progress, entries: [...progress.entries.filter((item) => item.id !== exercise.id), {
    ...entry, draft, attempts: [...entry.attempts, attempt].slice(-20),
    ...(attempt.outcome === 'satisfied' ? { achievement: attempt } : {}),
  }] }
}
