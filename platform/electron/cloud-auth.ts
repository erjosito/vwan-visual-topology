import { PublicClientApplication, CryptoProvider, type AccountInfo, type Configuration } from '@azure/msal-node'
import type { CloudAccount } from '../../src/cloud/microsoft'
import type { CloudConfiguration } from '../../src/cloud/configuration'
import { EncryptedCloudCache } from './cloud-cache'
import { cloudLoopback } from './cloud-loopback'
import { boundedCloudFetch } from './cloud-http'

const tenant = '9188040d-6c67-4c5b-b112-36a304b66dad'
export interface DesktopCloudAuth {
  restore(signal: AbortSignal): Promise<CloudAccount | undefined>
  signIn(signal: AbortSignal): Promise<CloudAccount>
  token(signal: AbortSignal): Promise<string>
  signOut(): Promise<void>
}
export function desktopCloudConfiguration(clientId: string, scope: string, base: string): CloudConfiguration | undefined {
  if (!clientId) return undefined
  const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  let url: URL
  try { url = new URL(base) } catch { return undefined }
  if (!new RegExp(`^${guid}$`, 'i').test(clientId) || !new RegExp(`^api://${guid}/Cloud\\.Access$`, 'i').test(scope)
    || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return undefined
  }
  return { clientId, scope, base: url.href.replace(/\/$/, '') }
}
export class MsalDesktopCloudAuth implements DesktopCloudAuth {
  private instance: PublicClientApplication
  private account?: AccountInfo
  private loaded = false
  private signal = new AbortController().signal
  constructor(private config: CloudConfiguration, private cache: EncryptedCloudCache,
    private openBrowser: (url: string) => Promise<void>) {
    this.instance = this.create()
  }
  private create() {
    const request = async <T>(url: string, method: string, options?: { headers?: Record<string, string>; body?: string }) => {
      const target = new URL(url)
      if (target.protocol !== 'https:' || target.hostname !== 'login.microsoftonline.com' || target.username || target.password || target.port) {
        throw new Error('Untrusted authentication endpoint.')
      }
      const response = await boundedCloudFetch(fetch, 1024 * 1024)(url, { method, headers: options?.headers, body: options?.body,
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(20_000)]), redirect: 'error', credentials: 'omit', cache: 'no-store' })
      const text = await response.text()
      if (text.length > 1024 * 1024) throw new Error('Authentication response is too large.')
      return { status: response.status, headers: Object.fromEntries(response.headers), body: JSON.parse(text) as T }
    }
    const networkClient: NonNullable<Configuration['system']>['networkClient'] = {
      sendGetRequestAsync: (url, options) => request(url, 'GET', options),
      sendPostRequestAsync: (url, options) => request(url, 'POST', options),
    }
    return new PublicClientApplication({ auth: { clientId: this.config.clientId, authority: 'https://login.microsoftonline.com/consumers' },
      system: { networkClient, disableInternalRetries: true, loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } })
  }
  private select(account: AccountInfo | null | undefined) {
    if (!account || account.tenantId !== tenant) throw new Error('A personal Microsoft account is required.')
    this.account = account
    return { id: account.homeAccountId, name: account.name || account.username || 'Microsoft account' }
  }
  private async load() {
    if (this.loaded) return
    this.loaded = true
    const saved = await this.cache.read()
    if (!saved) return
    const envelope = JSON.parse(saved)
    if (envelope.version !== 1 || envelope.clientId !== this.config.clientId || envelope.scope !== this.config.scope
      || typeof envelope.cache !== 'string' || typeof envelope.accountId !== 'string') return
    this.instance.getTokenCache().deserialize(envelope.cache)
    const account = await this.instance.getTokenCache().getAccountByHomeId(envelope.accountId)
    if (account?.tenantId === tenant) this.account = account
  }
  private async save(signal: AbortSignal) {
    signal.throwIfAborted()
    await this.cache.write(JSON.stringify({ version: 1, clientId: this.config.clientId, scope: this.config.scope,
      accountId: this.account?.homeAccountId, cache: this.instance.getTokenCache().serialize() }))
  }
  async restore(signal: AbortSignal) {
    this.signal = signal
    try { await this.load() }
    catch (error) { this.account = undefined; this.instance = this.create(); throw error }
    signal.throwIfAborted()
    return this.account ? this.select(this.account) : undefined
  }
  async signIn(signal: AbortSignal) {
    this.signal = signal
    this.cache.assertAvailable()
    await this.load()
    const callback = await cloudLoopback(signal)
    try {
      const { verifier, challenge } = await new CryptoProvider().generatePkceCodes()
      const url = await this.instance.getAuthCodeUrl({ scopes: [this.config.scope], redirectUri: callback.redirectUri,
        state: callback.state, prompt: 'select_account', codeChallenge: challenge, codeChallengeMethod: 'S256' })
      signal.throwIfAborted()
      const target = new URL(url)
      if (target.protocol !== 'https:' || target.hostname !== 'login.microsoftonline.com' || target.port
        || target.username || target.password || target.pathname !== '/consumers/oauth2/v2.0/authorize') {
        throw new Error('Untrusted sign-in URL.')
      }
      await this.openBrowser(url)
      const code = await callback.code
      signal.throwIfAborted()
      const result = await this.instance.acquireTokenByCode({ code, codeVerifier: verifier, redirectUri: callback.redirectUri, scopes: [this.config.scope] })
      signal.throwIfAborted()
      const account = this.select(result.account)
      await this.save(signal)
      return account
    } finally { callback.close() }
  }
  async token(signal: AbortSignal) {
    this.signal = signal
    if (!this.account) throw new Error('Sign in to access cloud data.')
    const result = await this.instance.acquireTokenSilent({ account: this.account, scopes: [this.config.scope] })
    signal.throwIfAborted()
    if (result.account?.homeAccountId !== this.account.homeAccountId) throw new Error('Account changed.')
    this.select(result.account)
    await this.save(signal)
    return result.accessToken
  }
  async signOut() {
    this.account = undefined
    this.loaded = true
    this.instance = this.create()
    await this.cache.clear()
  }
}
