import { describe, expect, it, vi } from 'vitest'
import { cloudConfiguration } from './configuration'
import { cloudSessionKey, createCloudSession } from './session'
import type { MicrosoftClient } from './microsoft'
import { CloudHttpError, createCloudClient } from './client'

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
