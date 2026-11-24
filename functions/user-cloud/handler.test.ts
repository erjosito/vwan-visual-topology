import { describe, expect, it } from 'vitest'
import { cloudFixture, testOwner } from '../../tests/user-cloud-fixture'
import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import { example } from '../../src/model'
import type { CloudShare } from '../../src/cloud/contracts'
import type { ContainerClient } from '@azure/storage-blob'
import { Readable } from 'node:stream'
import { blobStore } from './index'

const id = '11111111-1111-4111-8111-111111111111'
const path = `/api/cloud/topologies/${id}`
const headers = (user = 'alice', version?: string) => ({
  Authorization: `Bearer ${user}`, 'Content-Type': 'application/json',
  ...(version ? { 'If-Match': version } : { 'If-None-Match': '*' }),
})

describe('saved topology metadata', () => {
  const topology = { ...createEmptyAzNetTopology(), name: 'Native topology name stays separate' }
  async function seed(description?: string) {
    const cloud = cloudFixture(), value = { version: 1, name: 'Original saved name', ...(description ? { description } : {}), topology }
    const response = await cloud.request(path, { method: 'PUT', headers: headers(), body: JSON.stringify(value) })
    expect(response.status).toBe(200)
    return { cloud, value, etag: (response.headers as Record<string, string>).ETag }
  }
  it('creates, lists, renames and clears plain-text metadata without changing the saved ID or topology payload', async () => {
    const { cloud, value, etag } = await seed('Initial multiline\n説明')
    const updated = await cloud.request(path, { method: 'PATCH', headers: headers('alice', etag),
      body: JSON.stringify({ name: '  Renamed cloud save  ', description: '  <b>Plain text</b>\n説明  ' }) })
    expect(updated.status).toBe(200)
    const next = (updated.headers as Record<string, string>).ETag
    expect(next).not.toBe(etag)
    expect((await cloud.request(path, { headers: headers() })).jsonBody).toEqual({
      ...value, name: 'Renamed cloud save', description: '<b>Plain text</b>\n説明',
    })
    expect((await cloud.request('/api/cloud/topologies', { headers: headers() })).jsonBody).toMatchObject({
      entries: [{ id, name: 'Renamed cloud save', description: '<b>Plain text</b>\n説明', etag: next }],
    })
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', next),
      body: JSON.stringify({ name: 'Without description', description: ' \n ' }) })).status).toBe(200)
    expect((await cloud.request(path, { headers: headers() })).jsonBody).toEqual({
      version: 1, name: 'Without description', topology: value.topology,
    })
    const entries = (await cloud.request('/api/cloud/topologies', { headers: headers() })).jsonBody as { entries: object[] }
    expect(entries.entries[0]).not.toHaveProperty('description')
    expect(cloud.data.size).toBe(1)
  })
  it('requires an authenticated owner and exact ETag; metadata and content updates conflict in both directions', async () => {
    const { cloud, value, etag } = await seed()
    const body = JSON.stringify({ name: 'Metadata update', description: 'New description' })
    expect((await cloud.request(path, { method: 'PATCH', body })).status).toBe(401)
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('bob', etag), body })).status).toBe(404)
    expect((await cloud.request(path, { method: 'PATCH', headers: headers(), body })).status).toBe(428)
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', '"stale"'), body })).status).toBe(412)
    const changed = await cloud.request(path, { method: 'PUT', headers: headers('alice', etag), body: JSON.stringify(value) })
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', etag), body })).status).toBe(412)
    const update = await cloud.request(path, { method: 'PATCH',
      headers: headers('alice', (changed.headers as Record<string, string>).ETag), body })
    expect(update.status).toBe(200)
    expect((await cloud.request(path, { method: 'PUT', headers: headers('alice', (changed.headers as Record<string, string>).ETag),
      body: JSON.stringify(value) })).status).toBe(412)
    expect((await cloud.request(path, { headers: headers() })).jsonBody).toMatchObject({ name: 'Metadata update', topology })
  })
  it('does not lose a content update racing between the metadata read and conditional write', async () => {
    const { cloud, value, etag } = await seed()
    const put = cloud.store.put
    cloud.store.put = async (...args) => {
      await put(args[0], JSON.stringify({ ...value, topology: { ...topology, name: 'Concurrent content' } }), etag, value.name)
      return put(...args)
    }
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', etag),
      body: JSON.stringify({ name: 'Racing metadata' }) })).status).toBe(412)
    expect((await cloud.request(path, { headers: headers() })).jsonBody).toMatchObject({
      name: value.name, topology: { name: 'Concurrent content' },
    })
  })
  it('rejects invalid metadata, topology injection and excessive text without replacing old saves', async () => {
    const { cloud, value, etag } = await seed()
    for (const input of [null, [], { name: '' }, { name: ' '.repeat(5) }, { name: 'x'.repeat(121) },
      { name: 'x', description: false }, { name: 'x', description: '界'.repeat(1025) },
      { name: 'x', topology: { name: 'Injected' } }, { name: 'x', owner: 'bob' }]) {
      expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', etag), body: JSON.stringify(input) })).status).toBe(400)
    }
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', etag), body: ' '.repeat(16385) })).status).toBe(413)
    expect((await cloud.request(path, { headers: headers() })).jsonBody).toEqual(value)
    const original = JSON.stringify({ ...value, topology: { ...topology, extension: 'x'.repeat(4 * 1024 * 1024 - 400) } })
    const next = await cloud.store.put(`users/${testOwner('alice')}/topologies/${id}.json`, original, etag, value.name)
    expect((await cloud.request(path, { method: 'PATCH', headers: headers('alice', next),
      body: JSON.stringify({ name: value.name, description: '界'.repeat(1024) }) })).status).toBe(413)
    expect(cloud.data.get(`users/${testOwner('alice')}/topologies/${id}.json`)!.raw).toBe(original)
  })
})

describe('explicit latest-saved, revocable sharing', () => {
  const sharePath = '/api/cloud/shares/22222222-2222-4222-8222-222222222222'
  const value = { version: 1, name: 'Owner saved version', topology: createEmptyAzNetTopology() }
  const resolve = (cloud: ReturnType<typeof cloudFixture>, token: string) => cloud.request('/api/cloud/shared', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  })
  async function seed(cloud = cloudFixture()) {
    const saved = await cloud.request(path, { method: 'PUT', headers: headers(), body: JSON.stringify(value) })
    const sourceEtag = (saved.headers as Record<string, string>).ETag
    const input = { topologyId: id, sourceEtag, consent: true }
    return { cloud, input, create: (share = sharePath, user = 'alice', data = input) => cloud.request(share, {
      method: 'PUT', headers: headers(user), body: JSON.stringify(data),
    }) }
  }
  it('requires an authenticated owner, exact saved version and explicit consent; exposes no private namespace', async () => {
    const { cloud, create, input } = await seed()
    expect((await cloud.request('/api/cloud/shares')).status).toBe(401)
    expect((await create(sharePath, 'bob')).status).toBe(404)
    expect((await create(sharePath, 'alice', { ...input, consent: false })).status).toBe(400)
    expect((await create(sharePath, 'alice', { ...input, sourceEtag: '"stale"' })).status).toBe(412)
    const response = await create()
    expect(response.status).toBe(200)
    const share = response.jsonBody as CloudShare
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(share)).not.toContain(testOwner('alice'))
    expect(JSON.stringify(share)).not.toContain('users/')
    expect((await cloud.request('/api/cloud/shares', { headers: headers('bob') })).jsonBody).toEqual({ entries: [] })
    const publicResponse = await resolve(cloud, share.token)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.jsonBody).toMatchObject({ document: value, sourceVersion: input.sourceEtag })
    expect(publicResponse.headers).toMatchObject({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    expect((await cloud.request(path)).status).toBe(401)
    expect((await cloud.request('/api/cloud/shared', { method: 'PUT', headers: headers(), body: '{}' })).status).toBe(405)
  })
  it('follows confirmed updates/renames, never resurrects after deletion and same-ID recreation', async () => {
    const { cloud, create, input } = await seed()
    const share = (await create()).jsonBody as CloudShare
    const changed = { ...value, name: 'Renamed latest save', description: 'Shared saved description',
      topology: { ...value.topology, name: 'Changed topology' } }
    const updated = await cloud.request(path, { method: 'PUT', headers: headers('alice', input.sourceEtag), body: JSON.stringify(changed) })
    expect(updated.status).toBe(200)
    expect((await resolve(cloud, share.token)).jsonBody).toMatchObject({ document: changed })
    expect((await cloud.request(path, { method: 'DELETE', headers: headers('alice', (updated.headers as Record<string, string>).ETag) })).status).toBe(204)
    expect((await resolve(cloud, share.token)).status).toBe(404)
    expect((await cloud.request(path, { method: 'PUT', headers: headers(), body: JSON.stringify(value) })).status).toBe(200)
    expect((await resolve(cloud, share.token)).status).toBe(404)
  })
  it('revokes only with owner authorization and exact share version; expired and unknown tokens fail identically', async () => {
    let time = Date.now()
    const { cloud, create } = await seed(cloudFixture(undefined, () => time))
    const share = (await create()).jsonBody as CloudShare
    expect(Date.parse(share.expiresAt) - time).toBe(30 * 86400000)
    expect((await cloud.request(sharePath, { method: 'DELETE', headers: headers('bob', share.etag) })).status).toBe(404)
    expect((await cloud.request(sharePath, { method: 'DELETE', headers: headers('alice', '"stale"') })).status).toBe(412)
    expect((await resolve(cloud, share.token)).status).toBe(200)
    time += 30 * 86400000
    const expired = await resolve(cloud, share.token)
    expect(expired.status).toBe(404)
    expect((await resolve(cloud, 'X'.repeat(43))).jsonBody).toEqual(expired.jsonBody)
    time -= 30 * 86400000
    expect((await cloud.request(sharePath, { method: 'DELETE', headers: headers('alice', share.etag) })).status).toBe(204)
    expect((await resolve(cloud, share.token)).jsonBody).toEqual(expired.jsonBody)
  })
  it('bounds anonymous resolver traffic and owner issuance without making the private API anonymous', async () => {
    const { cloud, create } = await seed()
    for (let index = 0; index < 6; index++) expect((await create(`/api/cloud/shares/${crypto.randomUUID()}`)).status).toBe(200)
    expect((await create()).status).toBe(429)
    for (let index = 0; index < 120; index++) expect((await resolve(cloud, 'X'.repeat(43))).status).toBe(404)
    expect((await resolve(cloud, 'X'.repeat(43))).status).toBe(429)
    expect((await cloud.request('/api/cloud/progress')).status).toBe(401)
  })
  it('upgrades old blobs conditionally before binding links to a persistent incarnation', async () => {
    const { cloud, create } = await seed()
    const stored = cloud.data.get(`users/${testOwner('alice')}/topologies/${id}.json`)!
    delete stored.generation
    const share = (await create()).jsonBody as CloudShare
    expect((await resolve(cloud, share.token)).status).toBe(200)
    const current = cloud.data.get(`users/${testOwner('alice')}/topologies/${id}.json`)!
    expect(current.generation).toBeTruthy()
    expect(current.etag).not.toBe(stored.etag)
    expect(current.raw).toBe(stored.raw)
  })
  it('fails closed on partial publication and permits the owner to revoke the incomplete record', async () => {
    const { cloud, create } = await seed()
    const put = cloud.store.put
    cloud.store.put = async (...args) => {
      if (args[0].startsWith('shared/')) throw new Error('Storage unavailable')
      return put(...args)
    }
    expect((await create()).status).toBe(503)
    const index = cloud.data.get(`users/${testOwner('alice')}/shares/${sharePath.split('/').at(-1)}.json`)!
    const record = JSON.parse(index.raw) as CloudShare
    expect((await resolve(cloud, record.token)).status).toBe(404)
    expect((await cloud.request(sharePath, { method: 'DELETE', headers: headers('alice', index.etag) })).status).toBe(204)
  })
  it('bounds in-flight anonymous resolution without consuming additional storage work', async () => {
    const { cloud, create } = await seed()
    const share = (await create()).jsonBody as CloudShare
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const get = cloud.store.get
    cloud.store.get = async key => { await gate; return get(key) }
    const pending = Array.from({ length: 8 }, () => resolve(cloud, share.token))
    expect((await resolve(cloud, share.token)).status).toBe(429)
    release()
    expect((await Promise.all(pending)).every(result => result.status === 200)).toBe(true)
  })
  it('the Blob adapter preserves incarnation on exact conditional updates, but not deletion/recreation', async () => {
    let value: { raw: Buffer; metadata: Record<string, string>; etag: string } | undefined
    let version = 0
    const blob = {
      async getProperties(options: { conditions: { ifMatch: string } }) {
        expect(options.conditions.ifMatch).toBe(value?.etag)
        return { metadata: value!.metadata }
      },
      async uploadData(raw: Buffer, options: { conditions: { ifMatch?: string; ifNoneMatch?: string }; metadata: Record<string, string> }) {
        if (value) expect(options.conditions.ifMatch).toBe(value.etag)
        else expect(options.conditions.ifNoneMatch).toBe('*')
        value = { raw, metadata: options.metadata, etag: `"${++version}"` }
        return { etag: value.etag }
      },
      async download() {
        return { ...value!, contentLength: value!.raw.length, readableStreamBody: Readable.from([value!.raw]) }
      },
      async delete(options: { conditions: { ifMatch: string } }) {
        expect(options.conditions.ifMatch).toBe(value!.etag); value = undefined
      },
    }
    const store = blobStore({ getBlockBlobClient: () => blob, async *listBlobsFlat() {
      yield { name: `topologies/${id}.json`, metadata: value!.metadata, properties: { etag: value!.etag } }
    } } as unknown as ContainerClient)
    const description = '界'.repeat(1024)
    let etag = await store.put('source', '{}', null, 'Original', description)
    expect((await store.list('topologies/'))[0].description).toBe(description)
    expect(Buffer.byteLength(JSON.stringify(value!.metadata))).toBeLessThan(8192)
    const generation = (await store.get('source'))!.generation
    expect(generation).toBeTruthy()
    etag = await store.put('source', '{"updated":true}', etag, 'Renamed')
    expect((await store.get('source'))!.generation).toBe(generation)
    expect((await store.list('topologies/'))[0].description).toBe(description)
    etag = await store.put('source', '{"updated":true}', etag, 'Renamed', '')
    expect((await store.list('topologies/'))[0]).not.toHaveProperty('description')
    await store.delete('source', etag)
    await store.put('source', '{}', null, 'Recreated')
    expect((await store.get('source'))!.generation).not.toBe(generation)
  })
})
const progress = { version: 1, policyVersion: 1, completions: [] }
describe('user-isolated, conditional cloud operations', () => {
  it('requires authentication and rejects unexpected origins before storage access', async () => {
    const cloud = cloudFixture()
    expect((await cloud.request('/api/cloud/progress')).status).toBe(401)
    expect((await cloud.request('/api/cloud/progress', { headers: { ...headers(), Origin: 'https://untrusted.test' } })).status).toBe(403)
    expect(cloud.data.size).toBe(0)
    expect((await cloud.request('/api/cloud/progress', { method: 'OPTIONS', headers: { Origin: 'https://app.test' } })).status).toBe(204)
  })
  it.each([createEmptyAzNetTopology(), example])('round-trips an admitted native topology without exposing another owner', async topology => {
    const cloud = cloudFixture(), value = { version: 1, name: 'Private design', topology }
    const saved = await cloud.request(path, { method: 'PUT', headers: headers(), body: JSON.stringify(value) })
    expect(saved.status).toBe(200)
    expect(saved.headers).toHaveProperty('ETag')
    expect((await cloud.request(path, { headers: headers('bob') })).status).toBe(404)
    expect((await cloud.request('/api/cloud/topologies', { headers: headers('bob') })).jsonBody).toEqual({ entries: [] })
    const read = await cloud.request(path, { headers: headers() })
    expect(read.jsonBody).toMatchObject({ version: 1, name: 'Private design', topology: { version: topology.version } })
    expect(JSON.stringify([...cloud.data.keys()])).toContain(testOwner('alice'))
    expect((await cloud.request(path, { method: 'DELETE', headers: headers('bob', (saved.headers as Record<string, string>).ETag) })).status).toBe(404)
    expect((await cloud.request(path, { headers: headers() })).status).toBe(200)
  })
  it('rejects stale overwrites/deletes, unconditioned writes and invalid record ownership fields', async () => {
    const cloud = cloudFixture()
    const body = JSON.stringify({ version: 1, name: 'Original', topology: createEmptyAzNetTopology() })
    const first = await cloud.request(path, { method: 'PUT', headers: headers(), body })
    const etag = (first.headers as Record<string, string>).ETag
    expect((await cloud.request(path, { method: 'PUT', headers: headers(), body })).status).toBe(412)
    expect((await cloud.request(path, { method: 'PUT', headers: headers('alice', '"stale"'), body })).status).toBe(412)
    expect((await cloud.request(path, { method: 'DELETE', headers: headers('alice', '"stale"') })).status).toBe(412)
    expect((await cloud.request(path, { method: 'PUT', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body })).status).toBe(428)
    expect((await cloud.request(path, { method: 'PUT', headers: headers('alice', etag),
      body: JSON.stringify({ ...JSON.parse(body), owner: 'bob' }) })).status).toBe(400)
    expect((await cloud.request(path, { method: 'DELETE', headers: headers('alice', etag) })).status).toBe(204)
  })
  it('stores bounded curriculum ledgers and rejects malformed/oversized payloads without replacing history', async () => {
    const cloud = cloudFixture()
    const saved = await cloud.request('/api/cloud/progress', { method: 'PUT', headers: headers(), body: JSON.stringify(progress) })
    expect(saved.status).toBe(200)
    const etag = (saved.headers as Record<string, string>).ETag
    expect((await cloud.request('/api/cloud/progress', { method: 'PUT', headers: headers('alice', etag),
      body: JSON.stringify({ ...progress, completions: [{ points: 999999 }] }) })).status).toBe(400)
    expect((await cloud.request('/api/cloud/progress', { method: 'PUT', headers: headers('alice', etag),
      body: JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) }) })).status).toBe(413)
    expect((await cloud.request('/api/cloud/progress', { headers: headers() })).jsonBody).toEqual(progress)
    expect((await cloud.request('/api/cloud/progress', { headers: headers('bob') })).status).toBe(404)
  })
})
