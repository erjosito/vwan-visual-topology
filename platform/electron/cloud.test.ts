import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PublicClientApplication, type AccountInfo, type AuthenticationResult } from '@azure/msal-node'
import { cloudLoopback } from './cloud-loopback'
import { EncryptedCloudCache } from './cloud-cache'
import { MsalDesktopCloudAuth, desktopCloudConfiguration, type DesktopCloudAuth } from './cloud-auth'
import { DesktopCloudBroker } from './cloud-broker'
import { boundedCloudFetch } from './cloud-http'

const config = { clientId: '11111111-1111-4111-8111-111111111111',
  scope: 'api://22222222-2222-4222-8222-222222222222/Cloud.Access', base: 'https://cloud.example.test/api/cloud' }
const account = { homeAccountId: 'personal-account', tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
  environment: 'login.microsoftonline.com', username: 'synthetic', localAccountId: 'local', name: 'Synthetic account' } satisfies AccountInfo
const cloudAccount = { id: account.homeAccountId, name: account.name }
const topologyId = '33333333-3333-4333-8333-333333333333'
const cleanup: (() => unknown)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function cacheFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aznet-cloud-test-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'credentials.bin')
  const encryption = { isEncryptionAvailable: () => true,
    encryptString: vi.fn((value: string) => Buffer.from(Buffer.from(value).map(byte => byte ^ 0x7f))),
    decryptString: vi.fn((value: Buffer) => Buffer.from(value).map(byte => byte ^ 0x7f).toString()) }
  return { directory, file, encryption, cache: new EncryptedCloudCache(file, encryption) }
}
const nativeAuth = (): DesktopCloudAuth => ({
  restore: vi.fn(async () => cloudAccount), signIn: vi.fn(async () => cloudAccount),
  token: vi.fn(async () => 'synthetic-bearer-main-only'), signOut: vi.fn(async () => {}),
})
function authFixture(cache: EncryptedCloudCache, open: (url: string) => Promise<void>) {
  const codeUrl = vi.spyOn(PublicClientApplication.prototype, 'getAuthCodeUrl').mockImplementation(async request =>
    `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${new URLSearchParams({
      redirect_uri: request.redirectUri, state: request.state!, code_challenge: request.codeChallenge!,
    })}`)
  const byCode = vi.spyOn(PublicClientApplication.prototype, 'acquireTokenByCode')
    .mockResolvedValue({ account, accessToken: 'synthetic-bearer-main-only' } as AuthenticationResult)
  const silent = vi.spyOn(PublicClientApplication.prototype, 'acquireTokenSilent')
    .mockResolvedValue({ account, accessToken: 'synthetic-refreshed-main-only' } as AuthenticationResult)
  return { auth: new MsalDesktopCloudAuth(config, cache, open), codeUrl, byCode, silent }
}

describe('desktop system-browser callback', () => {
  it('rejects wrong state, duplicate state and paths without consuming the valid callback, then closes', async () => {
    const callback = await cloudLoopback(new AbortController().signal)
    cleanup.push(callback.close)
    for (const query of ['/?state=wrong&code=x', `/?state=${callback.state}&state=${callback.state}&code=x`,
      `/other?state=${callback.state}&code=x`]) {
      expect((await fetch(callback.redirectUri + query)).status).toBe(400)
    }
    const response = await fetch(`${callback.redirectUri}/?state=${callback.state}&code=synthetic-code`)
    expect(await response.text()).not.toContain('synthetic-code')
    await expect(callback.code).resolves.toBe('synthetic-code')
    await expect(fetch(callback.redirectUri)).rejects.toThrow()
  })
  it('bounds time and closes on cancellation and denied consent', async () => {
    const abort = new AbortController(), cancelled = await cloudLoopback(abort.signal)
    abort.abort()
    await expect(cancelled.code).rejects.toThrow('cancelled')
    await expect(fetch(cancelled.redirectUri)).rejects.toThrow()
    const timeout = await cloudLoopback(new AbortController().signal, 10)
    await expect(timeout.code).rejects.toThrow('timed out')
    const denied = await cloudLoopback(new AbortController().signal)
    await fetch(`${denied.redirectUri}/?state=${denied.state}&error=access_denied&error_description=private-details`)
    await expect(denied.code).rejects.toThrow('not completed')
    await expect(fetch(denied.redirectUri)).rejects.toThrow()
  })
})

describe('OS-protected native identity', () => {
  it('persists ciphertext only, atomically replaces it and fails closed without OS encryption', async () => {
    const { cache, file, directory, encryption } = await cacheFixture()
    await cache.write('synthetic-refresh-token')
    expect((await readFile(file)).toString()).not.toContain('synthetic-refresh-token')
    expect(await cache.read()).toBe('synthetic-refresh-token')
    await cache.write('replacement')
    expect(await cache.read()).toBe('replacement')
    expect(await readdir(directory)).toEqual(['credentials.bin'])
    encryption.isEncryptionAvailable = () => false
    await expect(cache.read()).rejects.toThrow('unavailable')
    await expect(cache.write('never-plaintext')).rejects.toThrow('unavailable')
    expect(encryption.encryptString).toHaveBeenCalledTimes(2)
    await cache.clear()
    expect(await readdir(directory)).toEqual([])
  })
  it('keeps incomplete/unsafe configuration disabled without affecting local startup', () => {
    expect(desktopCloudConfiguration(config.clientId, config.scope, config.base)).toEqual(config)
    for (const base of ['http://cloud.test/api', '/api/cloud', 'https://user:password@cloud.test/api', 'https://cloud.test/api#secret']) {
      expect(desktopCloudConfiguration(config.clientId, config.scope, base)).toBeUndefined()
    }
    expect(desktopCloudConfiguration('', config.scope, config.base)).toBeUndefined()
    expect(desktopCloudConfiguration('not-a-guid', config.scope, config.base)).toBeUndefined()
    expect(desktopCloudConfiguration(config.clientId, 'User.Read', config.base)).toBeUndefined()
  })
  it('wires random state and PKCE into MSAL, confines tokens to native auth and clears credentials on sign-out', async () => {
    const { cache, file } = await cacheFixture()
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const { auth, codeUrl, byCode, silent } = authFixture(cache, async url => {
      const request = new URL(url)
      await fetch(`${request.searchParams.get('redirect_uri')}/?${new URLSearchParams({
        state: request.searchParams.get('state')!, code: 'synthetic-code',
      })}`)
    })
    expect(await auth.restore(new AbortController().signal)).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
    expect(codeUrl).not.toHaveBeenCalled()
    expect(await auth.signIn(new AbortController().signal)).toEqual(cloudAccount)
    expect(codeUrl).toHaveBeenCalledWith(expect.objectContaining({ scopes: [config.scope], prompt: 'select_account',
      state: expect.stringMatching(/^[\w-]{43}$/), codeChallengeMethod: 'S256', codeChallenge: expect.any(String) }))
    const verifier = byCode.mock.calls[0][0].codeVerifier!
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(codeUrl.mock.calls[0][0].codeChallenge)
    expect(await auth.token(new AbortController().signal)).toBe('synthetic-refreshed-main-only')
    expect(silent).toHaveBeenCalledWith({ account, scopes: [config.scope] })
    expect((await readFile(file)).toString()).not.toContain('personal-account')
    await auth.signOut()
    expect(await cache.read()).toBeUndefined()
    await expect(auth.token(new AbortController().signal)).rejects.toThrow('Sign in')
  })
  it('rejects non-personal accounts and does not persist them', async () => {
    const { cache } = await cacheFixture()
    const { auth, byCode } = authFixture(cache, async url => {
      const request = new URL(url)
      await fetch(`${request.searchParams.get('redirect_uri')}/?state=${request.searchParams.get('state')}&code=x`)
    })
    byCode.mockResolvedValue({ account: { ...account, tenantId: 'other-tenant' } } as AuthenticationResult)
    await expect(auth.signIn(new AbortController().signal)).rejects.toThrow('personal Microsoft')
    expect(await cache.read()).toBeUndefined()
  })
  it('restores only the selected account from the matching encrypted client/scope cache without a browser', async () => {
    const { cache } = await cacheFixture()
    await cache.write(JSON.stringify({ version: 1, clientId: config.clientId, scope: config.scope,
      accountId: account.homeAccountId, cache: 'synthetic-msal-cache' }))
    const tokenCache = { deserialize: vi.fn(), getAccountByHomeId: vi.fn(async () => account) }
    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(
      tokenCache as unknown as ReturnType<PublicClientApplication['getTokenCache']>)
    const open = vi.fn(async () => {})
    const auth = new MsalDesktopCloudAuth(config, cache, open)
    expect(await auth.restore(new AbortController().signal)).toEqual(cloudAccount)
    expect(tokenCache.deserialize).toHaveBeenCalledWith('synthetic-msal-cache')
    expect(tokenCache.getAccountByHomeId).toHaveBeenCalledWith(account.homeAccountId)
    const other = new MsalDesktopCloudAuth({ ...config, clientId: topologyId }, cache, open)
    expect(await other.restore(new AbortController().signal)).toBeUndefined()
    expect(tokenCache.deserialize).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
  })
  it('cancels the actual callback listener before code exchange or persistence', async () => {
    const { cache } = await cacheFixture(), abort = new AbortController()
    let browserUrl = ''
    const { auth, byCode } = authFixture(cache, async url => { browserUrl = url })
    const connecting = auth.signIn(abort.signal), rejected = expect(connecting).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(browserUrl).not.toBe(''))
    const redirect = new URL(browserUrl).searchParams.get('redirect_uri')!
    abort.abort()
    await rejected
    await expect(fetch(redirect)).rejects.toThrow()
    expect(byCode).not.toHaveBeenCalled()
    expect(await cache.read()).toBeUndefined()
  })
  it('allows explicit recovery after a damaged cache, but never opens a browser without OS encryption', async () => {
    const { cache, encryption } = await cacheFixture()
    await cache.write('not-valid-cache-json')
    const { auth, codeUrl } = authFixture(cache, async url => {
      const request = new URL(url)
      await fetch(`${request.searchParams.get('redirect_uri')}/?state=${request.searchParams.get('state')}&code=x`)
    })
    await expect(auth.restore(new AbortController().signal)).rejects.toThrow()
    expect(await auth.signIn(new AbortController().signal)).toEqual(cloudAccount)
    expect(codeUrl).toHaveBeenCalledOnce()
    encryption.isEncryptionAvailable = () => false
    await expect(auth.signIn(new AbortController().signal)).rejects.toThrow('unavailable')
    expect(codeUrl).toHaveBeenCalledOnce()
  })
})

describe('main-process cloud operation broker', () => {
  it('keeps unconfigured desktops offline and confines bearer authorization to the configured native API', async () => {
    const auth = nativeAuth(), fetcher = vi.fn(async (_input, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer synthetic-bearer-main-only' })
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
      return new Response('{"entries":[]}')
    }) as unknown as typeof fetch
    const disabled = new DesktopCloudBroker(undefined, auth, fetcher)
    expect(await disabled.status()).toEqual({ configured: false })
    expect(auth.restore).not.toHaveBeenCalled()
    const broker = new DesktopCloudBroker(config, auth, fetcher)
    cleanup.push(() => broker.close())
    const state = await broker.signIn()
    expect(Object.keys(state).sort()).toEqual(['account', 'configured', 'session'])
    expect(JSON.stringify(state)).not.toContain('bearer')
    expect(await broker.request({ session: state.session, operation: 'listTopologies', args: [] })).toEqual([])
    expect(fetcher).toHaveBeenCalledWith(`${config.base}/topologies`, expect.any(Object))
  })
  it('rejects arbitrary proxy requests, traversal, extra arguments, malformed writes and missing revisions before acquiring tokens', async () => {
    const auth = nativeAuth(), fetcher = vi.fn() as unknown as typeof fetch
    const broker = new DesktopCloudBroker(config, auth, fetcher)
    cleanup.push(() => broker.close())
    const { session } = await broker.signIn()
    for (const request of [
      { operation: 'fetch', args: ['https://untrusted.test'] },
      { operation: 'getTopology', args: ['../progress'] },
      { operation: 'deleteTopology', args: [topologyId, '*'] },
      { operation: 'getProgress', args: ['extra'] },
      { operation: 'saveProgress', args: [{ version: 999 }, null] },
      { operation: 'saveTopology', args: [topologyId, { version: 1, name: 'x', topology: {} }, null] },
      { operation: 'updateTopologyMetadata', args: [topologyId, { name: 'x' }, null] },
      { operation: 'updateTopologyMetadata', args: [topologyId, { name: 'x', topology: {} }, '"previous"'] },
      { operation: 'updateTopologyMetadata', args: [topologyId, { name: 'x', description: 'x'.repeat(1025) }, '"previous"'] },
      { operation: 'getProgress', args: [], url: 'https://untrusted.test' },
    ]) await expect(broker.request({ session, ...request })).rejects.toThrow()
    expect(auth.token).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves conditional writes and HTTP conflict statuses', async () => {
    const fetcher = vi.fn(async (_input, init: RequestInit) => {
      expect(init.headers).toMatchObject({ 'If-Match': '"previous"' })
      return new Response(null, { status: 412 })
    }) as unknown as typeof fetch
    const broker = new DesktopCloudBroker(config, nativeAuth(), fetcher)
    cleanup.push(() => broker.close())
    const { session } = await broker.signIn()
    await expect(broker.request({ session, operation: 'deleteTopology', args: [topologyId, '"previous"'] }))
      .rejects.toMatchObject({ status: 412 })
  })
  it('admits bounded metadata-only edits and keeps exact conditions on the native PATCH transport', async () => {
    const fetcher = vi.fn(async (_input, init: RequestInit) => {
      expect(init.method).toBe('PATCH')
      expect(init.headers).toMatchObject({ 'If-Match': '"previous"' })
      expect(JSON.parse(init.body as string)).toEqual({ name: 'Saved metadata', description: '説明' })
      return new Response('{"saved":true}', { headers: { ETag: '"next"' } })
    }) as unknown as typeof fetch
    const broker = new DesktopCloudBroker(config, nativeAuth(), fetcher)
    cleanup.push(() => broker.close())
    const { session } = await broker.signIn()
    expect(await broker.request({ session, operation: 'updateTopologyMetadata',
      args: [topologyId, { name: 'Saved metadata', description: '説明' }, '"previous"'] })).toBe('"next"')
    expect(fetcher).toHaveBeenCalledWith(`${config.base}/topologies/${topologyId}`, expect.any(Object))
  })
  it('rejects stale handles before network access and cancels in-flight calls on sign-out', async () => {
    let requestSignal: AbortSignal | undefined
    const auth = nativeAuth(), fetcher = vi.fn(async (_input, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        requestSignal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
      })
    }) as unknown as typeof fetch
    const broker = new DesktopCloudBroker(config, auth, fetcher)
    cleanup.push(() => broker.close())
    const { session } = await broker.signIn()
    const request = broker.request({ session, operation: 'listTopologies', args: [] })
    const rejected = expect(request).rejects.toThrow()
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    await broker.signOut()
    await rejected
    expect(requestSignal!.aborted).toBe(true)
    await broker.signIn()
    await expect(broker.request({ session, operation: 'listTopologies', args: [] })).rejects.toThrow('Account changed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('cancels a pending sign-in and serializes credential removal before another account', async () => {
    const auth = nativeAuth()
    let started = false, finish!: () => void
    auth.signIn = vi.fn<DesktopCloudAuth['signIn']>(signal => new Promise((_resolve, reject) => {
      started = true; signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
    }))
    auth.signOut = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const broker = new DesktopCloudBroker(config, auth)
    cleanup.push(() => broker.close())
    const login = broker.signIn(), rejected = expect(login).rejects.toThrow('Cancelled')
    await vi.waitFor(() => expect(started).toBe(true))
    const logout = broker.signOut()
    await rejected
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    auth.signIn = vi.fn(async () => cloudAccount)
    const next = broker.signIn()
    expect(auth.signIn).not.toHaveBeenCalled()
    finish()
    await logout
    expect((await next).account).toEqual(cloudAccount)
  })
  it('restores a cached account once, without an interactive browser or API call', async () => {
    const auth = nativeAuth(), fetcher = vi.fn() as unknown as typeof fetch
    const broker = new DesktopCloudBroker(config, auth, fetcher)
    cleanup.push(() => broker.close())
    const [first, second] = await Promise.all([broker.status(), broker.status()])
    expect(first).toEqual(second)
    expect(auth.restore).toHaveBeenCalledTimes(1)
    expect(auth.signIn).not.toHaveBeenCalled()
    expect(auth.token).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('leaves explicit sign-in available when cached-account restoration fails', async () => {
    const auth = nativeAuth()
    auth.restore = vi.fn(async () => { throw new Error('Private cache details must not reach the canvas.') })
    const broker = new DesktopCloudBroker(config, auth)
    cleanup.push(() => broker.close())
    expect(await broker.status()).toEqual({ configured: true })
    expect(auth.signIn).not.toHaveBeenCalled()
    expect((await broker.signIn()).account).toEqual(cloudAccount)
  })
  it('stops streaming oversized responses rather than buffering an unbounded body', async () => {
    const cancelled = vi.fn()
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(8)) }, cancel: cancelled,
    }))) as unknown as typeof fetch
    await expect(boundedCloudFetch(fetcher, 16)('https://cloud.example.test')).rejects.toThrow('too large')
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
