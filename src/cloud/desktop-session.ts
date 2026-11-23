import type { CloudClient } from './client'
import { desktopCloudOperations, type DesktopCloudBridge, type DesktopCloudState } from './desktop-contract'
import type { CloudSessionState } from './session'

export function createDesktopCloudSession(bridge: DesktopCloudBridge) {
  let configured = false, generation = 0
  let state: CloudSessionState = { status: 'signed-out' }
  let restoring: Promise<void> | undefined
  let leaving = Promise.resolve()
  const listeners = new Set<() => void>()
  const publish = (next: CloudSessionState) => { state = next; for (const listener of listeners) listener() }
  const attach = async (value: DesktopCloudState, ticket: number) => {
    if (ticket !== generation) return
    configured = value.configured
    if (!value.account || !value.session) { publish({ status: 'signed-out' }); return }
    const [{ CloudHttpError }, { createProgressSync }] = await Promise.all([import('./client'), import('./progress-sync')])
    if (ticket !== generation) return
    const api = Object.fromEntries(desktopCloudOperations.map(operation => [operation, async (...args: unknown[]) => {
      if (ticket !== generation) throw new Error('Account changed.')
      const result = await bridge.cloudRequest({ session: value.session!, operation, args })
      if (ticket !== generation) throw new Error('Account changed.')
      if (!result.ok) throw new CloudHttpError(result.status ?? 503, result.error)
      return result.value
    }])) as CloudClient
    publish({ status: 'signed-in', account: value.account, api, progressSync: createProgressSync })
  }
  return {
    get configured() { return configured },
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    restore() {
      return restoring ??= (async () => {
        const ticket = ++generation
        try {
          const result = await bridge.cloudStatus()
          if (!result.ok) throw new Error(result.error)
          await attach(result.value, ticket)
        } catch { if (ticket === generation) publish({ status: 'error' }) }
      })()
    },
    async connect() {
      if (state.status === 'connecting') return
      const ticket = ++generation
      publish({ status: 'connecting' })
      try {
        await leaving
        if (ticket !== generation) return
        const result = await bridge.cloudSignIn()
        if (!result.ok) throw new Error(result.error)
        await attach(result.value, ticket)
      } catch { if (ticket === generation) publish({ status: 'error' }) }
    },
    async disconnect() {
      const ticket = ++generation
      publish({ status: 'signed-out' })
      const operation = leaving.then(async () => {
        const result = await bridge.cloudSignOut()
        if (!result.ok) throw new Error(result.error)
      })
      leaving = operation.catch(() => {})
      try { await operation } catch { if (ticket === generation) publish({ status: 'error' }) }
    },
  }
}
