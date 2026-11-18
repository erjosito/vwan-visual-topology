import type { CloudEntry, CloudTopology, CloudValue, ProgressLedger } from './contracts'

export class CloudHttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export function createCloudClient(base: string, token: () => Promise<string>, signal: AbortSignal, fetcher = fetch) {
  async function request<T>(path: string, method = 'GET', value?: unknown, etag?: string | null): Promise<CloudValue<T> | undefined> {
    const bearer = await token()
    signal.throwIfAborted()
    const headers: Record<string, string> = { Authorization: `Bearer ${bearer}` }
    if (value !== undefined) headers['Content-Type'] = 'application/json'
    if (etag === null) headers['If-None-Match'] = '*'
    else if (etag !== undefined) headers['If-Match'] = etag
    const response = await fetcher(`${base}${path}`, {
      method, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), body: value === undefined ? undefined : JSON.stringify(value),
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    })
    if (response.status === 404 && method === 'GET' && path !== '/topologies') return undefined
    if (!response.ok) throw new CloudHttpError(response.status, response.status === 412
      ? 'Cloud data changed on another device. Reload before replacing it.'
      : response.status === 401 ? 'Your cloud session expired. Sign in again.'
        : 'Cloud operation failed. Your local data is unchanged; keep a backup and retry.')
    if (response.status === 204) return undefined
    const raw = await response.text()
    if (raw.length > 4 * 1024 * 1024) throw new Error('Cloud response exceeds the supported size.')
    const version = response.headers.get('etag')
    if (!version && path !== '/topologies') throw new Error('Cloud version is missing.')
    return { value: JSON.parse(raw) as T, etag: version ?? '' }
  }
  return {
    getProgress: () => request<ProgressLedger>('/progress'),
    saveProgress: (value: ProgressLedger, etag: string | null) => request('/progress', 'PUT', value, etag).then(result => result!.etag),
    listTopologies: () => request<{ entries: CloudEntry[] }>('/topologies').then(result => result?.value.entries ?? []),
    getTopology: (id: string) => request<CloudTopology>(`/topologies/${encodeURIComponent(id)}`),
    saveTopology: (id: string, value: CloudTopology, etag: string | null) =>
      request(`/topologies/${encodeURIComponent(id)}`, 'PUT', value, etag).then(result => result!.etag),
    deleteTopology: (id: string, etag: string) => request(`/topologies/${encodeURIComponent(id)}`, 'DELETE', undefined, etag),
  }
}
export type CloudClient = ReturnType<typeof createCloudClient>
