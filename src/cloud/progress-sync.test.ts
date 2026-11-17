import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgressLedger, type ProgressLedger } from '../learning/progress-ledger'
import { exampleCourse } from '../learning/course-examples'
import { orderedTasks, type TaskCompletion } from '../learning/runner'
import { createProgressSync } from './progress-sync'
import { CloudHttpError } from './client'

const empty = (): ProgressLedger => ({ version: 1, policyVersion: 1, completions: [] })
const completion = (index = 0): TaskCompletion => {
  const { task, lesson } = orderedTasks(exampleCourse)[index]
  return { courseId: exampleCourse.course.id, contentVersion: 2, lessonId: lesson.id, taskId: task.id,
    assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
    title: task.title, sessionId: 'test', revision: index, scope: 1, engineVersion: 'test',
    completedAt: '2026-11-17T12:00:00Z' }
}
const store = () => {
  const data = new Map<string, string>()
  return createProgressLedger(() => ({ getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }))
}
const running: ReturnType<typeof createProgressSync>[] = []
afterEach(() => { for (const sync of running.splice(0)) sync.stop() })
const start = (...args: Parameters<typeof createProgressSync>) => {
  const sync = createProgressSync(...args); running.push(sync); sync.start(); return sync
}

describe('account-only cloud progress synchronization', () => {
  it('loads remote history into the account cache without uploading anonymous or duplicate awards', async () => {
    const local = store(), remote = { ...empty(), completions: [completion()] }
    const saveProgress = vi.fn(async () => '"2"')
    const sync = start({ getProgress: async () => ({ value: remote, etag: '"1"' }), saveProgress },
      local, async value => local.replace(value, true))
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('synced'))
    expect(local.getSnapshot().ledger).toEqual(remote)
    expect(saveProgress).not.toHaveBeenCalled()
    local.record(completion(), true)
    expect(saveProgress).not.toHaveBeenCalled()
  })
  it('serializes autosaves and preserves changes made while a write is in flight', async () => {
    const local = store()
    let finish!: (value: string) => void
    const saveProgress = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue('"3"')
    const sync = start({ getProgress: async () => undefined, saveProgress }, local, async value => local.replace(value, true))
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('synced'))
    local.record(completion(0), true)
    local.record(completion(1), true)
    expect(saveProgress).toHaveBeenCalledTimes(1)
    finish('"2"')
    await vi.waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2))
    expect(saveProgress.mock.calls[1][0].completions).toHaveLength(2)
    expect(saveProgress.mock.calls[1][1]).toBe('"2"')
  })
  it('retries unsaved device changes when the remote version did not change', async () => {
    const local = store()
    const saveProgress = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('"2"')
    const sync = start({ getProgress: async () => undefined, saveProgress }, local, async value => local.replace(value, true))
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('synced'))
    local.record(completion(), true)
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('offline'))
    await sync.refresh()
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('synced'))
    expect(saveProgress).toHaveBeenCalledTimes(2)
  })
  it('does not overwrite divergent histories or a remotely changed version without explicit resolution', async () => {
    const local = store()
    local.record(completion(0), true)
    const remote = { ...empty(), completions: [completion(1)] }
    const saveProgress = vi.fn(async () => '"2"')
    const sync = start({ getProgress: async () => ({ value: remote, etag: '"1"' }), saveProgress }, local,
      async value => local.replace(value, true))
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('conflict'))
    expect(saveProgress).not.toHaveBeenCalled()
    expect(local.getSnapshot().ledger?.completions[0].taskId).toBe(completion(0).taskId)
    await sync.refresh('cloud')
    expect(local.getSnapshot().ledger).toEqual(remote)
    expect(saveProgress).not.toHaveBeenCalled()
    saveProgress.mockRejectedValueOnce(new CloudHttpError(412, 'changed'))
    local.record(completion(0), true)
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('conflict'))
  })
  it('ignores a stale initialization response after stop/restart or account disposal', async () => {
    const local = store()
    let finish!: (value: { value: ProgressLedger; etag: string }) => void
    const getProgress = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(undefined)
    const apply = vi.fn(async value => local.replace(value, true))
    const sync = start({ getProgress, saveProgress: async () => '"2"' }, local, apply)
    sync.stop(); sync.start()
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('synced'))
    finish({ value: { ...empty(), completions: [completion()] }, etag: '"old"' })
    await Promise.resolve()
    expect(apply).not.toHaveBeenCalled()
    expect(local.getSnapshot().ledger).toEqual(empty())
  })
  it('cannot replace a local ledger without practice ownership or with invalid cloud history', () => {
    const local = store()
    expect(local.replace({ ...empty(), completions: [completion()] }, false)).toBe(false)
    expect(local.replace({ ...empty(), completions: [{} as TaskCompletion] }, true)).toBe(false)
    expect(local.getSnapshot().ledger).toEqual(empty())
  })
})
