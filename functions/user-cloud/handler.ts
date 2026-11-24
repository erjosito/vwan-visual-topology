import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { cloudLimits, parseCloudMetadata, parseCloudTopology, parseProgressLedger } from '../../src/cloud/contracts'
import { createSharingHandler } from './sharing'
import { body, CloudError, type CloudStore } from './http'
export { body, CloudError, type CloudStore, type StoredValue } from './http'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const validEtag = (value: string | null) => !!value && /^"[\x21\x23-\x7e]{1,160}"$/.test(value)

export function createCloudHandler(options: {
  authenticate: (authorization: string | null) => Promise<string>
  store: CloudStore
  origins: string[]
  now?: () => number
}) {
  const sharing = createSharingHandler(options.store, options.now)
  const failure = (error: unknown, headers: Record<string, string>): HttpResponseInit => ({
    status: error instanceof CloudError ? error.status : 503,
    headers: error instanceof CloudError && error.status === 429 ? { ...headers, 'Retry-After': '60' } : headers,
    jsonBody: { error: error instanceof CloudError ? error.message : 'Cloud storage is unavailable. Keep your local copy and retry.' },
  })
  return async (request: HttpRequest): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin')
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', Vary: 'Origin' }
    if (origin && !options.origins.includes(origin)) return { status: 403, headers, jsonBody: { error: 'Origin not allowed.' } }
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Expose-Headers'] = 'ETag'
    }
    if (request.method === 'OPTIONS') return { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,If-Match,If-None-Match' } }
    if (request.params.resource === 'shared') {
      try { return await sharing.resolve(request, headers) } catch (error) { return failure(error, headers) }
    }
    let owner: string
    try { owner = await options.authenticate(request.headers.get('authorization')) }
    catch { return { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' }, jsonBody: { error: 'Sign in again to access your cloud data.' } } }
    if (!/^[0-9a-f]{64}$/.test(owner)) return { status: 401, headers }
    try {
      const resource = request.params.resource, id = request.params.id
      if (resource === 'shares') return await sharing.manage(request, headers, owner)
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
      if (request.method === 'PATCH' && resource === 'topologies') {
        if (!validEtag(match) || create) throw new CloudError(428, 'An exact cloud version is required.')
        let metadata
        try { metadata = parseCloudMetadata(await body(request, 16 * 1024)) }
        catch (error) {
          if (error instanceof CloudError) throw error
          throw new CloudError(400, 'Invalid cloud save name or description.')
        }
        const found = await options.store.get(key)
        if (!found) throw new CloudError(404, 'Cloud item not found.')
        if (found.etag !== match) throw new CloudError(412, 'This cloud version changed. Refresh before editing it.')
        const value = { ...JSON.parse(found.raw), ...metadata }
        if (!metadata.description) delete value.description
        const raw = JSON.stringify(value)
        if (new TextEncoder().encode(raw).length > cloudLimits.bytes) throw new CloudError(413, 'Cloud topology size limit exceeded.')
        const etag = await options.store.put(key, raw, match!, metadata.name, metadata.description ?? '')
        return { status: 200, headers: { ...headers, ETag: etag }, jsonBody: { saved: true } }
      }
      if (request.method === 'DELETE') {
        if (!validEtag(match) || create) throw new CloudError(428, 'An exact cloud version is required.')
        await options.store.delete(key, match!)
        return { status: 204, headers }
      }
      if (request.method !== 'PUT') throw new CloudError(405, 'Method not allowed.')
      if (create ? !!match : !validEtag(match)) throw new CloudError(428, 'An exact cloud version or create-only condition is required.')
      const input = await body(request)
      let value: unknown, name: string | undefined, description: string | undefined
      try {
        if (resource === 'progress') value = parseProgressLedger(JSON.stringify(input))
        else { const topology = parseCloudTopology(input); value = topology; name = topology.name; description = topology.description ?? '' }
      } catch { throw new CloudError(400, 'Unsupported or invalid cloud document. Your local data is unchanged.') }
      if (resource === 'topologies' && create && (await options.store.list(prefix)).length >= cloudLimits.records) {
        throw new CloudError(413, 'Cloud library is full. Delete an unused topology first.')
      }
      const etag = await options.store.put(key, JSON.stringify(value), create ? null : match!, name, description)
      return { status: 200, headers: { ...headers, ETag: etag }, jsonBody: { saved: true } }
    } catch (error) {
      return failure(error, headers)
    }
  }
}
