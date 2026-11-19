import { createHash, randomBytes } from 'node:crypto'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { parseCloudTopology, type CloudShare } from '../../src/cloud/contracts'
import { body, CloudError, type CloudStore } from './handler'

interface ShareRecord extends Omit<CloudShare, 'etag'> { owner: string; generation: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const publicKey = (token: string) => `shared/${hash(token)}.json`
const indexKey = (owner: string, id: string) => `users/${owner}/shares/${id}.json`
const unavailable = () => new CloudError(404, 'Shared topology is unavailable, expired or revoked.')
const exactVersion = (value: string | null) => !!value && /^"[\x21\x23-\x7e]{1,160}"$/.test(value)

export function createSharingHandler(store: CloudStore, now = Date.now) {
  let start = now(), requests = 0, active = 0
  const creators = new Map<string, { start: number; count: number }>()
  return {
    async resolve(request: HttpRequest, headers: Record<string, string>): Promise<HttpResponseInit> {
      if (request.method !== 'POST' || request.params.id) throw new CloudError(405, 'Method not allowed.')
      if (now() - start >= 60000) { start = now(); requests = 0 }
      if (++requests > 120 || active >= 8) throw new CloudError(429, 'Sharing is busy. Retry later.')
      active++
      try {
        const input = await body(request, 1024)
        if (!input || Object.keys(input).some(key => key !== 'token')
          || typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw unavailable()
        const saved = await store.get(publicKey(input.token))
        if (!saved) throw unavailable()
        const record = JSON.parse(saved.raw) as ShareRecord
        if (record.token !== input.token || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= now()) throw unavailable()
        const index = await store.get(indexKey(record.owner, record.id))
        if (!index || index.raw !== saved.raw) throw unavailable()
        const source = await store.get(`users/${record.owner}/topologies/${record.topologyId}.json`)
        if (!source || !source.generation || source.generation !== record.generation) throw unavailable()
        return { status: 200, headers, jsonBody: { document: parseCloudTopology(JSON.parse(source.raw)), expiresAt: record.expiresAt } }
      } finally { active-- }
    },
    async manage(request: HttpRequest, headers: Record<string, string>, owner: string): Promise<HttpResponseInit> {
      const id = request.params.id, prefix = `users/${owner}/shares/`
      if (id !== undefined && !uuid.test(id)) throw new CloudError(404, 'Cloud item not found.')
      if (request.method === 'GET' && !id) {
        const entries: CloudShare[] = []
        for (const entry of await store.list(prefix)) {
          const value = await store.get(indexKey(owner, entry.id))
          if (!value) continue
          const record = JSON.parse(value.raw) as ShareRecord
          entries.push({ id: record.id, topologyId: record.topologyId, token: record.token, expiresAt: record.expiresAt, etag: value.etag })
        }
        return { status: 200, headers, jsonBody: { entries } }
      }
      if (!id) throw new CloudError(405, 'Method not allowed.')
      const key = indexKey(owner, id)
      if (request.method === 'DELETE') {
        const match = request.headers.get('if-match')
        if (!exactVersion(match)) throw new CloudError(428, 'An exact cloud version is required.')
        const existing = await store.get(key)
        if (!existing) throw new CloudError(404, 'Cloud item not found.')
        if (existing.etag !== match) throw new CloudError(412, 'Sharing changed. Refresh before revoking.')
        const record = JSON.parse(existing.raw) as ShareRecord
        const publicValue = await store.get(publicKey(record.token))
        if (publicValue) await store.delete(publicKey(record.token), publicValue.etag)
        await store.delete(key, match!)
        return { status: 204, headers }
      }
      if (request.method !== 'PUT') throw new CloudError(405, 'Method not allowed.')
      if (request.headers.get('if-none-match') !== '*' || request.headers.has('if-match')) throw new CloudError(428, 'Create-only sharing is required.')
      const input = await body(request, 2048)
      if (!input || input.consent !== true || !uuid.test(input.topologyId ?? '') || !exactVersion(input.sourceEtag ?? null)
        || Object.keys(input).some(key => !['consent', 'topologyId', 'sourceEtag'].includes(key))) throw new CloudError(400, 'Confirm sharing an exact saved topology.')
      if ((await store.list(prefix)).length >= 50) throw new CloudError(413, 'Sharing limit reached. Revoke an unused link first.')
      if (creators.size >= 1000) for (const [key, value] of creators) { if (now() - value.start >= 60000) creators.delete(key) }
      let quota = creators.get(owner)
      if (!quota || now() - quota.start >= 60000) {
        if (creators.size >= 1000) throw new CloudError(429, 'Sharing is busy. Retry later.')
        quota = { start: now(), count: 0 }; creators.set(owner, quota)
      }
      if (++quota.count > 6) throw new CloudError(429, 'Too many new links. Retry later.')
      const sourceKey = `users/${owner}/topologies/${input.topologyId}.json`
      let source = await store.get(sourceKey)
      if (!source) throw new CloudError(404, 'Cloud item not found.')
      if (source.etag !== input.sourceEtag) throw new CloudError(412, 'Cloud save changed. Refresh before sharing.')
      const document = parseCloudTopology(JSON.parse(source.raw))
      // Upgrade pre-sharing blobs once; subsequent conditional overwrites preserve this incarnation.
      if (!source.generation) {
        const etag = await store.put(sourceKey, source.raw, source.etag, document.name)
        source = await store.get(sourceKey)
        if (!source?.generation || source.etag !== etag) throw new CloudError(412, 'Cloud save changed. Refresh before sharing.')
      }
      const record: ShareRecord = { id, owner, topologyId: input.topologyId, generation: source.generation,
        token: randomBytes(32).toString('base64url'), expiresAt: new Date(now() + 30 * 86400000).toISOString() }
      const raw = JSON.stringify(record)
      const etag = await store.put(key, raw, null, document.name)
      await store.put(publicKey(record.token), raw, null)
      return { status: 200, headers: { ...headers, ETag: etag }, jsonBody: {
        id, topologyId: record.topologyId, token: record.token, expiresAt: record.expiresAt, etag,
      } satisfies CloudShare }
    },
  }
}
