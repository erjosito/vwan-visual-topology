import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

const tenant = '9188040d-6c67-4c5b-b112-36a304b66dad'
export interface CloudAccount { id: string; name: string }
export interface MicrosoftClient {
  restore(): CloudAccount | undefined
  signIn(): Promise<CloudAccount>
  signOut(): Promise<void>
  token(): Promise<string>
}
export async function createMicrosoftClient(clientId: string, scope: string): Promise<MicrosoftClient> {
  const instance = new PublicClientApplication({
    auth: { clientId, authority: 'https://login.microsoftonline.com/consumers',
      redirectUri: new URL('auth-redirect.html', document.baseURI).href },
    cache: { cacheLocation: 'sessionStorage' },
  })
  await instance.initialize()
  let account: AccountInfo | undefined
  const select = (value: AccountInfo | null | undefined) => {
    if (!value || value.tenantId !== tenant) throw new Error('A personal Microsoft account is required.')
    account = value
    instance.setActiveAccount(value)
    return { id: value.homeAccountId, name: value.name || value.username || 'Microsoft account' }
  }
  return {
    restore() {
      const available = instance.getAllAccounts().filter(value => value.tenantId === tenant)
      const active = instance.getActiveAccount()
      return active?.tenantId === tenant ? select(active) : available.length === 1 ? select(available[0]) : undefined
    },
    async signIn() { return select((await instance.loginPopup({ scopes: [scope], prompt: 'select_account' })).account) },
    async signOut() {
      await instance.clearCache()
      account = undefined
      instance.setActiveAccount(null)
    },
    async token() {
      if (!account) throw new Error('Sign in to access cloud data.')
      return (await instance.acquireTokenSilent({ account, scopes: [scope] })).accessToken
    },
  }
}
