import { describe, expect, it } from 'vitest'
import { cloudFixture, testOwner } from '../../tests/user-cloud-fixture'
import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import { example } from '../../src/model'

const id = '11111111-1111-4111-8111-111111111111'
const path = `/api/cloud/topologies/${id}`
const headers = (user = 'alice', version?: string) => ({
  Authorization: `Bearer ${user}`, 'Content-Type': 'application/json',
  ...(version ? { 'If-Match': version } : { 'If-None-Match': '*' }),
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
