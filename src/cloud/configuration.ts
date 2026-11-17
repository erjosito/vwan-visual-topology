export interface CloudConfiguration { clientId: string; scope: string; base: string }
export function cloudConfiguration(env: Record<string, unknown>, origin: string, desktop: boolean): CloudConfiguration | undefined {
  if (desktop || !env.VITE_MICROSOFT_CLIENT_ID) return undefined
  const clientId = String(env.VITE_MICROSOFT_CLIENT_ID)
  const scope = String(env.VITE_CLOUD_API_SCOPE ?? '')
  let url: URL
  try { url = new URL(String(env.VITE_CLOUD_API_BASE_URL ?? '/api/cloud'), origin) } catch { return undefined }
  const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  if (!new RegExp(`^${guid}$`, 'i').test(clientId) || !new RegExp(`^api://${guid}/Cloud\\.Access$`, 'i').test(scope)
    || url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    return undefined
  }
  return { clientId, scope, base: url.href.replace(/\/$/, '') }
}
export const readCloudConfiguration = () => cloudConfiguration(import.meta.env, location.origin, !!window.desktopSimulator)
