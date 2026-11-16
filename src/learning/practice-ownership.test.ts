import { describe, expect, it } from 'vitest'
import { createPracticeOwnership } from './practice-ownership'

describe('exclusive practice ownership', () => {
  it('uses one real lock lifetime, refuses competing writers and recovers after explicit release', async () => {
    let held = false
    const requests: Promise<unknown>[] = []
    const locks = { request: ((name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
      if (held) return Promise.resolve(callback(null))
      held = true
      const request = Promise.resolve(callback({ name, mode: 'exclusive' })).finally(() => { held = false })
      requests.push(request)
      return request
    }) as LockManager['request'] }
    const first = createPracticeOwnership(locks), second = createPracticeOwnership(locks)
    expect(await first.acquire()).toBe(true)
    expect(await first.acquire()).toBe(true)
    expect(requests).toHaveLength(1)
    expect(await second.acquire()).toBe(false)
    expect(second.owned).toBe(false)
    first.release()
    await requests[0]
    expect(await second.acquire()).toBe(true)
    expect(await first.acquire()).toBe(false)
    second.release()
    await requests[1]
  })

  it('fails closed when exclusive locking is unavailable or rejected', async () => {
    expect(await createPracticeOwnership(undefined).acquire()).toBe(false)
    const locks = { request: (() => Promise.reject(new Error('unavailable'))) as LockManager['request'] }
    expect(await createPracticeOwnership(locks).acquire()).toBe(false)
  })
})
