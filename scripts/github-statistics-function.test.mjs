import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectAndPersist } from '../functions/github-statistics/handler.mjs'

const snapshot = {
  repository: 'owner/project',
  collectedAt: '2026-11-16T04:17:00Z',
  releases: [{ id: 1 }],
  traffic: { status: 'available' },
}

function options(blob) {
  return {
    repository: 'owner/project',
    trafficToken: 'do-not-persist-this-token',
    invocationId: 'invocation-123',
    collect: async ({ repository, trafficToken }) => {
      assert.equal(repository, snapshot.repository)
      assert.equal(trafficToken, 'do-not-persist-this-token')
      return snapshot
    },
    container: {
      getBlockBlobClient(name) {
        assert.equal(name, 'github/owner/project/snapshots/2026/11/16/function-invocation-123.json')
        return blob
      },
    },
  }
}

test('persists an immutable snapshot and returns only a verified storage receipt', async () => {
  const result = await collectAndPersist(options({
    async uploadData(data, settings) {
      assert.equal(settings.conditions.ifNoneMatch, '*')
      assert.equal(settings.blobHTTPHeaders.blobContentType, 'application/json')
      assert.deepEqual(JSON.parse(data.toString()), snapshot)
      assert.ok(!data.toString().includes('do-not-persist-this-token'))
      return { etag: 'storage-receipt' }
    },
  }))
  assert.deepEqual(result, {
    status: 'created',
    blobName: 'github/owner/project/snapshots/2026/11/16/function-invocation-123.json',
    etag: 'storage-receipt',
    traffic: 'available',
    releases: 1,
  })
})

test('an invocation retry checks the existing blob rather than overwriting it', async () => {
  const result = await collectAndPersist(options({
    async uploadData() { throw Object.assign(new Error('Already stored'), { statusCode: 412 }) },
    async getProperties() { return { etag: 'original-receipt' } },
  }))
  assert.equal(result.status, 'already_exists')
  assert.equal(result.etag, 'original-receipt')
})

test('optional platform aggregates are persisted without secrets; configured failures prevent partial snapshots', async () => {
  const web = { status: 'available', days: [{ date: '2026-11-15', hits: 17, errors: null, bytesSent: 1024 }] }
  const result = await collectAndPersist({
    ...options({ async uploadData(data) {
      assert.deepEqual(JSON.parse(data.toString()).web, web)
      return { etag: 'web-receipt' }
    } }),
    collectWebMetrics: async () => web,
  })
  assert.deepEqual(result.web, { status: 'available', days: 1 })
  await assert.rejects(collectAndPersist({
    ...options({ async uploadData() { assert.fail('Partial snapshot must not be uploaded') } }),
    collectWebMetrics: async () => { throw new Error('Metrics unavailable') },
  }), /Metrics unavailable/)
})

test('missing credentials and failed collection never create a blob; storage failures propagate', async () => {
  const neverUpload = { async uploadData() { assert.fail('Unexpected write') } }
  await assert.rejects(collectAndPersist({ ...options(neverUpload), trafficToken: '' }), /required/)
  await assert.rejects(collectAndPersist({
    ...options(neverUpload), collect: async () => { throw new Error('GitHub unavailable') },
  }), /GitHub unavailable/)
  await assert.rejects(collectAndPersist(options({
    async uploadData() { throw Object.assign(new Error('Private endpoint unavailable'), { statusCode: 403 }) },
  })), /Private endpoint unavailable/)
})

test('summary refresh runs only after persistence and failures remain retryable without losing the raw snapshot', async () => {
  let persisted = false
  const stored = options({ async uploadData() { persisted = true; return { etag: 'raw-etag' } } })
  const result = await collectAndPersist({
    ...stored,
    async refreshSummary() { assert.equal(persisted, true); return { etag: 'summary-etag' } },
  })
  assert.equal(result.dashboard.etag, 'summary-etag')
  await assert.rejects(collectAndPersist({
    ...stored, async refreshSummary() { throw new Error('Summary unavailable') },
  }), /Summary unavailable/)
  await assert.rejects(collectAndPersist({
    ...options({ async uploadData() { throw new Error('Write failed') } }),
    async refreshSummary() { assert.fail('Refresh before persistence') },
  }), /Write failed/)
})
