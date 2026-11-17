export const practiceLockName = 'network-simulator:practice-writer:v1'
export const practiceOwnershipFailure = 'Another tab owns practice, or exclusive local storage access is unavailable. Return to your design in that tab or close it, then resume practice here. Normal designs are unaffected.'

export function createPracticeOwnership(locks: Pick<LockManager, 'request'> | undefined) {
  let owned = false
  let pending: Promise<boolean> | undefined
  let unlock: (() => void) | undefined
  return {
    get owned() { return owned },
    acquire() {
      if (owned) return Promise.resolve(true)
      if (pending) return pending
      pending = new Promise<boolean>((resolve) => {
        if (!locks) { resolve(false); return }
        void locks.request(practiceLockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (!lock) { resolve(false); return }
          owned = true
          await new Promise<void>((release) => { unlock = release; resolve(true) })
          owned = false; unlock = undefined
        }).catch(() => resolve(false))
      }).finally(() => { pending = undefined })
      return pending
    },
    release() { owned = false; unlock?.() },
  }
}
export type PracticeOwnership = ReturnType<typeof createPracticeOwnership>
