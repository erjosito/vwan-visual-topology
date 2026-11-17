import { createCloudClient, type CloudClient } from './client'
import type { CloudAccount, MicrosoftClient } from './microsoft'
import type { CloudConfiguration } from './configuration'

export interface CloudSessionState {
  status: 'signed-out' | 'connecting' | 'signed-in' | 'error'
  account?: CloudAccount
  api?: CloudClient
}
export const cloudSessionKey = 'network-simulator:cloud-session:v1'
export function createCloudSession(config: CloudConfiguration | undefined, options: {
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  load?: () => Promise<MicrosoftClient>
  fetcher?: typeof fetch
}) {
  let state: CloudSessionState = { status: 'signed-out' }
  let client: MicrosoftClient | undefined
  let pending: Promise<MicrosoftClient> | undefined
  let leaving = Promise.resolve()
  let generation = 0
  let abort = new AbortController()
  const listeners = new Set<() => void>()
  const publish = (next: CloudSessionState) => { state = next; for (const listener of listeners) listener() }
  const load = () => pending ??= (options.load ? options.load() : import('./microsoft').then(module =>
    module.createMicrosoftClient(config!.clientId, config!.scope))).catch(error => { pending = undefined; throw error })
  const connect = async (restore = false) => {
    if (!config || state.status === 'connecting') return
    const ticket = ++generation
    abort.abort(); abort = new AbortController()
    publish({ status: 'connecting' })
    try {
      await leaving
      if (ticket !== generation) return
      client = await load()
      if (ticket !== generation) return
      const account = restore ? client.restore() : await client.signIn()
      if (ticket !== generation) return
      if (!account) {
        try { options.storage().removeItem(cloudSessionKey) } catch {}
        publish({ status: 'signed-out' }); return
      }
      const current = client, signal = abort.signal
      const api = createCloudClient(config.base, async () => {
        if (ticket !== generation) throw new Error('Account changed.')
        const token = await current.token()
        if (ticket !== generation) throw new Error('Account changed.')
        return token
      }, signal, options.fetcher)
      try { options.storage().setItem(cloudSessionKey, 'active') } catch {}
      publish({ status: 'signed-in', account, api })
    } catch { if (ticket === generation) publish({ status: 'error' }) }
  }
  return {
    configured: !!config,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    connect: () => connect(),
    async restore() {
      try { if (options.storage().getItem(cloudSessionKey) === 'active') await connect(true) } catch {}
    },
    async disconnect() {
      const ticket = ++generation
      abort.abort()
      try { options.storage().removeItem(cloudSessionKey) } catch {}
      publish({ status: 'signed-out' })
      const current = client
      const operation = leaving.then(async () => { await current?.signOut() })
      leaving = operation.catch(() => {})
      try { await operation } catch { if (ticket === generation) publish({ status: 'error' }) }
    },
  }
}
