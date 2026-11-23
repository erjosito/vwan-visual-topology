import { describe, expect, it, vi } from 'vitest'
import { cloudConfiguration } from './configuration'
import { cloudSessionKey, createCloudSession } from './session'
import type { MicrosoftClient } from './microsoft'
import { CloudHttpError, createCloudClient } from './client'
import { cloudDocumentKey, createDocumentSaveState } from './document-state'

const config = { clientId: '11111111-1111-4111-8111-111111111111',
  scope: 'api://22222222-2222-4222-8222-222222222222/Cloud.Access', base: 'https://app.test/api/cloud' }
const storage = () => {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const microsoft = (): MicrosoftClient => ({
  restore: () => ({ id: 'alice', name: 'Test Alice' }),
  signIn: async () => ({ id: 'alice', name: 'Test Alice' }), signOut: async () => {},
  token: async () => 'test-access-token',
})

describe('document save provenance', () => {
  const source = { accountId: 'alice', id: '11111111-1111-4111-8111-111111111111', name: 'Cloud design', etag: '"original"' }
  const design = { name: 'Local design', nested: { first: 1, second: 2 } }
  const linked = async () => {
    const cache = storage(), state = createDocumentSaveState(() => cache)
    state.setAccount('alice'); state.observe(design, 'azure-net'); state.local(design, 'saved')
    await state.confirmed(state.begin(source.id, 'alice')!, source, design, 'azure-net')
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('matches'))
    return { cache, state }
  }
  it('retains edited cloud metadata with the original content digest and dirty state across reload', async () => {
    const { cache, state } = await linked()
    const digest = JSON.parse(cache.getItem(cloudDocumentKey)!).digest
    const edited = { ...design, name: 'Unsaved local edits' }
    state.observe(edited, 'azure-net')
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('modified'))
    expect(state.metadataUpdated('bob', source.id, source.etag, 'Wrong owner', '"next"')).toBe(false)
    expect(state.metadataUpdated('alice', source.id, '"stale"', 'Wrong version', '"next"')).toBe(false)
    expect(state.metadataUpdated('alice', source.id, source.etag, 'Saved metadata only', '"next"')).toBe(true)
    expect(state.getSnapshot().cloud).toMatchObject({ name: 'Saved metadata only', etag: '"next"', state: 'modified' })
    expect(JSON.parse(cache.getItem(cloudDocumentKey)!).digest).toBe(digest)
    const restored = createDocumentSaveState(() => cache)
    restored.observe(edited, 'azure-net'); restored.setAccount('alice')
    await vi.waitFor(() => expect(restored.getSnapshot().cloud?.state).toBe('modified'))
    restored.observe(design, 'azure-net')
    await vi.waitFor(() => expect(restored.getSnapshot().cloud?.state).toBe('matches'))
    state.setAccount('bob')
    expect(state.metadataUpdated('alice', source.id, '"next"', 'Late update', '"later"')).toBe(false)
  })
  it('reports only acknowledged local writes, including a write reported before the editor commits', () => {
    const state = createDocumentSaveState(storage)
    state.observe(design, 'vwan')
    expect(state.getSnapshot().local).toBe('draft')
    state.local(design, 'saved')
    const next = { ...design, name: 'Edit' }
    state.observe(next, 'vwan')
    expect(state.getSnapshot().local).toBe('draft')
    state.local(next, 'unavailable')
    expect(state.getSnapshot().local).toBe('unavailable')
    state.local(design, 'saved'); state.observe(design, 'vwan')
    expect(state.getSnapshot().local).toBe('saved')
    state.invalidateLocal()
    expect(state.getSnapshot().local).toBe('unavailable')
  })
  it('binds the acknowledged snapshot, leaves subsequent edits dirty and recognizes an equivalent undo', async () => {
    const { state } = await linked()
    const ticket = state.begin(source.id, 'alice')!
    const changed = { ...design, name: 'Edited while uploading' }
    const acknowledging = state.confirmed(ticket, { ...source, etag: '"next"' }, design, 'azure-net')
    state.observe(changed, 'azure-net')
    await acknowledging
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('modified'))
    state.observe({ nested: { second: 2, first: 1 }, name: design.name }, 'azure-net')
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('matches'))
  })
  it('retains only bounded metadata and a fingerprint for same-tab reload, scoped to the account', async () => {
    const { cache } = await linked()
    const saved = JSON.parse(cache.getItem(cloudDocumentKey)!)
    expect(Object.keys(saved).sort()).toEqual(['accountId', 'digest', 'etag', 'id', 'name', 'provider', 'version'])
    expect(saved).not.toHaveProperty('topology')
    const restored = createDocumentSaveState(() => cache)
    restored.observe(design, 'azure-net')
    expect(restored.getSnapshot().cloud).toBeUndefined()
    restored.setAccount('alice')
    await vi.waitFor(() => expect(restored.getSnapshot().cloud?.state).toBe('matches'))
    restored.setAccount('bob')
    expect(restored.getSnapshot().cloud).toBeUndefined()
    expect(cache.getItem(cloudDocumentKey)).toBeNull()
    restored.setAccount('alice')
    expect(restored.getSnapshot().cloud).toBeUndefined()
  })
  it('never promotes a refreshed ETag and ignores stale account/list responses', async () => {
    const { state } = await linked()
    const oldScope = state.scope('alice')
    state.listed([{ ...source, etag: '"remote"', updatedAt: '' }], oldScope)
    expect(state.getSnapshot().cloud).toMatchObject({ state: 'changed', etag: source.etag })
    state.listed([{ ...source, updatedAt: '' }], oldScope)
    state.listUnavailable(oldScope)
    expect(state.getSnapshot().cloud?.state).toBe('changed')
    state.listed([], oldScope)
    expect(state.getSnapshot().cloud?.state).toBe('missing')
    state.listUnavailable(oldScope)
    expect(state.getSnapshot().cloud?.state).toBe('missing')
    state.setAccount('bob')
    const bob = { ...source, accountId: 'bob', name: 'Bob save' }
    await state.confirmed(state.begin(bob.id, 'bob')!, bob, design, 'azure-net')
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('matches'))
    state.listed([], oldScope); state.listUnavailable(oldScope)
    expect(state.getSnapshot().cloud).toMatchObject({ accountId: 'bob', state: 'matches' })
    expect(state.begin(source.id, 'alice')).toBeUndefined()
  })
  it('invalidates pending confirmations on document, account and practice boundaries', async () => {
    const { state } = await linked()
    for (const change of [() => { state.reset(); state.observe(design, 'azure-net') },
      () => { state.setAccount('bob'); state.setAccount('alice') },
      () => { state.setActive(false); state.setActive(true) }]) {
      const ticket = state.begin(source.id, 'alice')!
      const acknowledging = state.confirmed(ticket, source, design, 'azure-net')
      change()
      expect(await acknowledging).toBe(false)
      expect(state.getSnapshot().operation).toBe('idle')
    }
  })
  it('preserves the normal design link through practice without observing practice topology', async () => {
    const { state, cache } = await linked()
    const metadata = cache.getItem(cloudDocumentKey)
    state.setActive(false)
    state.observe({ name: 'Practice design' }, 'vwan')
    state.local({ name: 'Practice design' }, 'saved')
    expect(state.getSnapshot()).toMatchObject({ ready: false, cloud: undefined })
    expect(state.begin(source.id, 'alice')).toBeUndefined()
    expect(cache.getItem(cloudDocumentKey)).toBe(metadata)
    state.setActive(true)
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('matches'))
    expect(state.getSnapshot()).toMatchObject({ ready: true, provider: 'azure-net', local: 'saved' })
  })
  it('limits inactive artifact confirmations to live document-owned sessions', async () => {
    const ordinary = createDocumentSaveState(storage)
    ordinary.setAccount('alice'); ordinary.observe(design, 'azure-net'); ordinary.setActive(false)
    expect(ordinary.beginArtifact(source.id, 'alice')).toBeUndefined()
    const cache = storage(), document = createDocumentSaveState(() => cache, undefined, true)
    document.setAccount('alice'); document.observe(design, 'azure-net'); document.setActive(false)
    expect(document.begin(source.id, 'alice')).toBeUndefined()
    expect(document.beginArtifact(source.id, 'alice')).toBeDefined()
    document.linkArtifact(source, design, 'azure-net')
    await vi.waitFor(() => expect(cache.getItem(cloudDocumentKey)).toContain(source.id))
    document.setActive(true)
    await vi.waitFor(() => expect(document.getSnapshot().cloud?.state).toBe('matches'))
    document.revoke()
    expect(document.beginArtifact(source.id, 'alice')).toBeUndefined()
    document.linkArtifact({ ...source, name: 'Late save' }, design, 'azure-net')
    expect(cache.getItem(cloudDocumentKey)).not.toContain('Late save')
  })
  it('does not turn a failed upload into saved state or reuse an earlier list during a new upload', async () => {
    const { state } = await linked()
    const oldList = state.scope('alice'), ticket = state.begin(source.id, 'alice')!
    state.listed([], oldList)
    expect(state.getSnapshot().cloud?.state).toBe('matches')
    state.failed(ticket, true)
    expect(state.getSnapshot()).toMatchObject({ operation: 'failed', cloud: { state: 'changed', etag: source.etag } })
    state.reset(); state.observe(design, 'azure-net')
    const fresh = state.begin(source.id, 'alice')!
    state.failed(fresh, false)
    expect(state.getSnapshot()).toMatchObject({ operation: 'failed', cloud: undefined })
  })
  it('keeps cloud acknowledgement separate from unavailable metadata storage or comparison', async () => {
    const cache = storage(), state = createDocumentSaveState(() => ({
      ...cache, setItem: () => { throw new Error('Storage unavailable') },
    }))
    state.setAccount('alice'); state.observe(design, 'azure-net')
    await state.confirmed(state.begin(source.id, 'alice')!, source, design, 'azure-net')
    await vi.waitFor(() => expect(state.getSnapshot().cloud?.state).toBe('matches'))
    expect(state.getSnapshot().retained).toBe(false)
    const unavailable = createDocumentSaveState(() => cache, async () => { throw new Error('Digest unavailable') })
    unavailable.setAccount('alice'); unavailable.observe(design, 'azure-net')
    await unavailable.confirmed(unavailable.begin(source.id, 'alice')!, source, design, 'azure-net')
    await vi.waitFor(() => expect(unavailable.getSnapshot().cloud?.state).toBe('unknown'))
    expect(unavailable.getSnapshot().operation).toBe('idle')
  })
})

describe('optional personal-account sessions', () => {
  it('distinguishes an undeployed list endpoint from missing individual cloud data', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    const api = createCloudClient(config.base, async () => 'test-access-token', new AbortController().signal, fetcher)
    await expect(api.listTopologies()).rejects.toBeInstanceOf(CloudHttpError)
    await expect(api.getProgress()).resolves.toBeUndefined()
    await expect(api.getTopology('missing')).resolves.toBeUndefined()
  })
  it('does not load Microsoft auth or call the API without configuration or explicit sign-in', async () => {
    const cache = storage(), load = vi.fn(async () => microsoft())
    const session = createCloudSession(config, { storage: () => cache, load })
    await session.restore()
    expect(load).not.toHaveBeenCalled()
    const disabled = createCloudSession(undefined, { storage: () => cache, load })
    await disabled.connect()
    expect(load).not.toHaveBeenCalled()
    await session.connect()
    expect(session.getSnapshot().account?.id).toBe('alice')
    expect(cache.data.get(cloudSessionKey)).toBe('active')
  })
  it('restores a previously chosen account, omits cookies, uses access tokens and clears the app session on logout', async () => {
    const cache = storage(), client = microsoft()
    cache.setItem(cloudSessionKey, 'active')
    const fetcher = vi.fn(async (_input, init: RequestInit) => {
      expect(init.credentials).toBe('omit')
      expect(init.redirect).toBe('error')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer test-access-token' })
      return new Response('{"version":1,"policyVersion":1,"completions":[]}', { headers: { ETag: '"1"' } })
    }) as unknown as typeof fetch
    const session = createCloudSession(config, { storage: () => cache, load: async () => client, fetcher })
    await session.restore()
    const oldApi = session.getSnapshot().api!
    expect((await oldApi.getProgress())?.etag).toBe('"1"')
    await session.disconnect()
    expect(session.getSnapshot().account).toBeUndefined()
    expect(cache.getItem(cloudSessionKey)).toBeNull()
    await expect(oldApi.getProgress()).rejects.toThrow('Account changed')
  })
  it('does not publish an account when sign-out wins a pending sign-in', async () => {
    let resolve!: (value: { id: string; name: string }) => void
    const cache = storage(), client = microsoft()
    client.signIn = () => new Promise(value => { resolve = value })
    const session = createCloudSession(config, { storage: () => cache, load: async () => client })
    const connecting = session.connect()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await session.disconnect()
    resolve({ id: 'alice', name: 'Test Alice' })
    await connecting
    expect(session.getSnapshot()).toEqual({ status: 'signed-out' })
  })
  it('rejects unsafe/partial configuration and leaves Electron local-only', () => {
    const env = { VITE_MICROSOFT_CLIENT_ID: config.clientId, VITE_CLOUD_API_SCOPE: config.scope }
    expect(cloudConfiguration(env, 'https://app.test', false)?.base).toBe(config.base)
    expect(cloudConfiguration(env, 'https://app.test', true)).toBeUndefined()
    for (const base of ['javascript:alert(1)', 'http://remote.test/api', 'https://user:password@remote.test/api', 'https://[bad']) {
      expect(cloudConfiguration({ ...env, VITE_CLOUD_API_BASE_URL: base }, 'https://app.test', false)).toBeUndefined()
    }
    expect(cloudConfiguration({ ...env, VITE_CLOUD_API_SCOPE: '' }, 'https://app.test', false)).toBeUndefined()
  })
  it('finishes clearing the old account before a subsequent sign-in uses the SDK', async () => {
    let finish!: () => void
    const cache = storage(), client = microsoft()
    client.signOut = () => new Promise(resolve => { finish = resolve })
    const signIn = vi.spyOn(client, 'signIn')
    const session = createCloudSession(config, { storage: () => cache, load: async () => client })
    await session.connect()
    const logout = session.disconnect()
    const login = session.connect()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(signIn).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([logout, login])
    expect(signIn).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().account?.id).toBe('alice')
  })
})
