import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { cloudLimits, parseCloudTopology, parseProgressLedger } from '../../src/cloud/contracts'

export interface StoredValue { raw: string; etag: string }
export interface CloudStore {
  get(key: string): Promise<StoredValue | undefined>
  put(key: string, raw: string, etag: string | null, name?: string): Promise<string>
  delete(key: string, etag: string): Promise<void>
  list(prefix: string): Promise<{ id: string; name: string; etag: string; updatedAt: string }[]>
}
export class CloudError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const validEtag = (value: string | null) => !!value && /^"[\x21\x23-\x7e]{1,160}"$/.test(value)

async function body(request: HttpRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new CloudError(415, 'JSON required.')
  const reader = request.body?.getReader()
  if (!reader) throw new CloudError(400, 'JSON required.')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, raw = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > cloudLimits.bytes) { await reader.cancel(); throw new CloudError(413, 'Cloud document size limit exceeded.') }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
    return JSON.parse(raw)
  } catch (error) {
    if (error instanceof CloudError) throw error
    throw new CloudError(400, 'Invalid JSON document.')
  } finally { reader.releaseLock() }
}

export function createCloudHandler(options: {
  authenticate: (authorization: string | null) => Promise<string>
  store: CloudStore
  origins: string[]
}) {
  return async (request: HttpRequest): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin')
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }
    if (origin && !options.origins.includes(origin)) return { status: 403, headers, jsonBody: { error: 'Origin not allowed.' } }
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Expose-Headers'] = 'ETag'
    }
    if (request.method === 'OPTIONS') return { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,If-Match,If-None-Match' } }
    let owner: string
    try { owner = await options.authenticate(request.headers.get('authorization')) }
    catch { return { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' }, jsonBody: { error: 'Sign in again to access your cloud data.' } } }
    if (!/^[0-9a-f]{64}$/.test(owner)) return { status: 401, headers }
    try {
      const resource = request.params.resource, id = request.params.id
      if (!['progress', 'topologies'].includes(resource) || (resource === 'progress' ? !!id : id !== undefined && !uuid.test(id))) {
        throw new CloudError(404, 'Cloud item not found.')
      }
      const prefix = `users/${owner}/topologies/`
      if (resource === 'topologies' && !id) {
        if (request.method !== 'GET') throw new CloudError(405, 'Method not allowed.')
        return { status: 200, headers, jsonBody: { entries: await options.store.list(prefix) } }
      }
      const key = resource === 'progress' ? `users/${owner}/progress.json` : `${prefix}${id}.json`
      if (request.method === 'GET') {
        const found = await options.store.get(key)
        if (!found) throw new CloudError(404, 'Cloud item not found.')
        return { status: 200, headers: { ...headers, ETag: found.etag }, jsonBody: JSON.parse(found.raw) }
      }
      const match = request.headers.get('if-match')
      const create = request.headers.get('if-none-match') === '*'
      if (request.method === 'DELETE') {
        if (!validEtag(match) || create) throw new CloudError(428, 'An exact cloud version is required.')
        await options.store.delete(key, match!)
        return { status: 204, headers }
      }
      if (request.method !== 'PUT') throw new CloudError(405, 'Method not allowed.')
      if (create ? !!match : !validEtag(match)) throw new CloudError(428, 'An exact cloud version or create-only condition is required.')
      const input = await body(request)
      let value: unknown, name: string | undefined
      try {
        if (resource === 'progress') value = parseProgressLedger(JSON.stringify(input))
        else { const topology = parseCloudTopology(input); value = topology; name = topology.name }
      } catch { throw new CloudError(400, 'Unsupported or invalid cloud document. Your local data is unchanged.') }
      if (resource === 'topologies' && create && (await options.store.list(prefix)).length >= cloudLimits.records) {
        throw new CloudError(413, 'Cloud library is full. Delete an unused topology first.')
      }
      const etag = await options.store.put(key, JSON.stringify(value), create ? null : match!, name)
      return { status: 200, headers: { ...headers, ETag: etag }, jsonBody: { saved: true } }
    } catch (error) {
      const status = error instanceof CloudError ? error.status : 503
      return { status, headers, jsonBody: { error: error instanceof CloudError ? error.message : 'Cloud storage is unavailable. Keep your local copy and retry.' } }
    }
  }
}
