import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDashboardSummary, persistDashboardSummary, isApprovedDashboardUser, dashboardResponse,
} from '../functions/github-statistics/dashboard.mjs'

const repository = 'owner/project'
const now = new Date('2026-11-16T12:00:00Z')
const asset = (id, downloads, name = 'installer.exe') => ({ id, downloads, name })
function snapshot(collectedAt, assets, views = []) {
  return {
    schemaVersion: 1, repository, collectedAt,
    repositoryCounters: { stars: 4, forks: 2, subscribers: 1 },
    releases: [{ id: 11, tag: 'release-1', publishedAt: '2026-11-10T00:00:00Z', prerelease: false, assets }],
    traffic: {
      status: 'available',
      views: { count: views.reduce((sum, day) => sum + day.count, 0), uniques: 5, days: views },
      clones: { count: 2, uniques: 1, days: [{ date: '2026-11-15T00:00:00Z', count: 2, uniques: 1 }] },
    },
  }
}

test('latest observations replace overlapping traffic windows without adding uniques or leaking extra fields', async () => {
  const first = snapshot('2026-11-15T04:17:00Z', [asset(1, 10)], [
    { date: '2026-11-14T00:00:00Z', count: 4, uniques: 3 },
    { date: '2026-11-15T00:00:00Z', count: 2, uniques: 2 },
  ])
  const latest = snapshot('2026-11-16T04:17:00Z', [asset(1, 14)], [
    { date: '2026-11-15T00:00:00Z', count: 8, uniques: 4 },
    { date: '2026-11-16T00:00:00Z', count: 1, uniques: 1 },
  ])
  latest.unexpectedToken = 'must-not-appear'
  const result = await buildDashboardSummary([latest, first, latest], { repository, now })
  assert.equal(result.traffic.views.count, 9)
  assert.equal(result.traffic.views.uniques, 5)
  assert.deepEqual(result.trafficDays.map((day) => [day.date, day.views.count, day.partial]), [
    ['2026-11-14', 4, false], ['2026-11-15', 8, false], ['2026-11-16', 1, true],
  ])
  assert.equal(result.series.length, 2)
  assert.equal(result.series[1].growth, 4)
  assert.equal(result.series[0].growth, null)
  assert.ok(!JSON.stringify(result).includes('must-not-appear'))
})

test('asset IDs, new/reset baselines, deleted assets and collection gaps preserve download meaning', async () => {
  const result = await buildDashboardSummary([
    snapshot('2026-11-10T04:17:00Z', [asset(1, 10), asset(2, 20)]),
    snapshot('2026-11-11T04:17:00Z', [asset(1, 12, 'renamed.exe'), asset(3, 100)]),
    snapshot('2026-11-11T14:00:00Z', [asset(1, 14, 'renamed.exe'), asset(3, 110)]),
    snapshot('2026-11-14T04:17:00Z', [asset(1, 3), asset(2, 25), asset(3, 115)]),
  ], { repository, now })
  assert.deepEqual(result.series.map((day) => day.growth), [null, 14, 10])
  assert.deepEqual(result.series.map((day) => day.baselines), [2, 1, 0])
  assert.equal(result.series[2].resets, 1)
  assert.equal(result.series[2].intervalStart, '2026-11-10T04:17:00Z')
  assert.equal(result.series[1].observedAt, '2026-11-11T14:00:00Z')
  assert.equal(result.downloads, 143)
})

test('missing traffic is not zero; empty and foreign archives are rejected', async () => {
  const data = snapshot('2026-11-16T04:17:00Z', [])
  data.traffic = { status: 'not_configured' }
  const result = await buildDashboardSummary([data], { repository, now })
  assert.deepEqual(result.traffic, { status: 'not_configured' })
  assert.deepEqual(result.trafficDays, [])
  assert.deepEqual(result.web, { status: 'not_configured', days: [] })
  await assert.rejects(buildDashboardSummary([], { repository, now }), /No statistics/)
  await assert.rejects(buildDashboardSummary([{ ...data, repository: 'other/repository' }], { repository, now }), /Invalid/)
})

test('platform history deduplicates windows, keeps nulls and zeroes, and never mixes SWA resources', async () => {
  const first = snapshot('2026-11-15T04:17:00Z', [])
  const latest = snapshot('2026-11-16T04:17:00Z', [])
  const other = snapshot('2026-11-14T04:17:00Z', [])
  const source = '/subscriptions/id/resourceGroups/production/providers/Microsoft.Web/staticSites/simulator'
  first.web = {
    status: 'available', resourceId: source, collectedAt: first.collectedAt,
    days: [{ date: '2026-11-14', hits: 10, errors: 3, bytesSent: 1024 }],
  }
  latest.web = {
    status: 'available', resourceId: source.toUpperCase(), collectedAt: latest.collectedAt,
    days: [
      { date: '2026-11-14', hits: 12, errors: null, bytesSent: 2048, unwanted: 'omit-this' },
      { date: '2026-11-15', hits: 0, errors: 0, bytesSent: null },
      { date: '2026-11-16', hits: 1 },
      { date: '2020-01-01', hits: 100 },
    ],
  }
  other.web = {
    ...first.web, resourceId: `${source}-preview`, collectedAt: other.collectedAt,
    days: [{ date: '2026-11-13', hits: 1000 }],
  }
  const result = await buildDashboardSummary([latest, other, first, latest], { repository, now })
  assert.deepEqual(result.web.days, [
    { date: '2026-11-14', hits: 12, errors: null, bytesSent: 2048 },
    { date: '2026-11-15', hits: 0, errors: 0, bytesSent: null },
  ])
  assert.equal(result.web.collectedAt, latest.collectedAt)
  assert.ok(!JSON.stringify(result.web).includes('omit-this'))
})

test('summary rebuild excludes old history and retries conditional writes after a concurrent refresh', async () => {
  const current = snapshot('2026-11-16T04:17:00Z', [asset(1, 10)])
  const oldName = `github/${repository}/snapshots/2024/01/01/function-old.json`
  const currentName = `github/${repository}/snapshots/2026/11/16/function-current.json`
  const summaryName = `github/${repository}/dashboard/summary.json`
  let attempts = 0
  let reads = 0
  const container = {
    async *listBlobsFlat({ prefix }) {
      assert.equal(prefix, `github/${repository}/snapshots/`)
      yield { name: oldName }
      yield { name: currentName }
    },
    getBlockBlobClient(name) {
      assert.notEqual(name, oldName, 'Old snapshots must not be downloaded')
      if (name !== summaryName) return { async downloadToBuffer() { reads++; return Buffer.from(JSON.stringify(current)) } }
      return {
        async getProperties() {
          if (!attempts) throw Object.assign(new Error('Missing'), { statusCode: 404 })
          return { etag: 'concurrent-etag' }
        },
        async uploadData(data, options) {
          attempts++
          assert.equal(JSON.parse(data.toString()).downloads, 10)
          assert.equal(options.blobHTTPHeaders.blobCacheControl, 'private, no-store')
          if (attempts === 1) {
            assert.deepEqual(options.conditions, { ifNoneMatch: '*' })
            throw Object.assign(new Error('Concurrent update'), { statusCode: 412 })
          }
          assert.deepEqual(options.conditions, { ifMatch: 'concurrent-etag' })
          return { etag: 'summary-receipt' }
        },
      }
    },
  }
  const result = await persistDashboardSummary({ container, repository, now })
  assert.equal(result.etag, 'summary-receipt')
  assert.equal(reads, 2)
  await assert.rejects(persistDashboardSummary({
    repository, now,
    container: { getBlockBlobClient() { return { async getProperties() { throw new Error('Storage unavailable') } } } },
  }), /Storage unavailable/)
})

const tenantId = '11111111-1111-4111-8111-111111111111'
const objectId = '22222222-2222-4222-8222-222222222222'
function request(path = '/api/statistics', { user = objectId, tenant = tenantId, provider = 'aad' } = {}) {
  const principal = { auth_typ: provider, claims: [{ typ: 'oid', val: user }, { typ: 'tid', val: tenant }] }
  return new Request(`https://statistics.example${path}`, {
    headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') },
  })
}
const authorization = { tenantId, allowedObjectIds: objectId }

test('application guard fails closed without configuration or trusted approved-user identity', () => {
  assert.equal(isApprovedDashboardUser(request(), authorization), true)
  assert.equal(isApprovedDashboardUser(request(), { tenantId, allowedObjectIds: '' }), false)
  assert.equal(isApprovedDashboardUser(new Request('https://statistics.example'), authorization), false)
  assert.equal(isApprovedDashboardUser(request('/', { user: tenantId }), authorization), false)
  assert.equal(isApprovedDashboardUser(request('/', { tenant: objectId }), authorization), false)
  assert.equal(isApprovedDashboardUser(request('/', { provider: 'github' }), authorization), false)
  assert.equal(isApprovedDashboardUser(new Request('https://statistics.example', {
    headers: { 'x-ms-client-principal': 'not-valid-json' },
  }), authorization), false)
})

test('all dashboard routes authorize before reading data and return only read-only summary content', async () => {
  const options = {
    html: '<h1>Statistics</h1>', script: 'load()',
    authorize: (incoming) => isApprovedDashboardUser(incoming, authorization),
    readSummary: async () => ({ downloads: 123 }),
  }
  const denied = await dashboardResponse(request('/api/statistics/summary', { user: tenantId }), {
    ...options, readSummary: () => assert.fail('Unauthorized read'),
  })
  assert.equal(denied.status, 403)
  const html = await dashboardResponse(request(), options)
  assert.equal(html.body, '<h1>Statistics</h1>')
  assert.equal((await dashboardResponse(request('/'), options)).body, '<h1>Statistics</h1>')
  assert.equal(html.headers['Cache-Control'], 'private, no-store')
  assert.match(html.headers['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.equal((await dashboardResponse(request('/api/statistics/dashboard.js'), options)).body, 'load()')
  const data = await dashboardResponse(request('/api/statistics/summary'), options)
  assert.deepEqual(data.jsonBody, { downloads: 123 })
  const missing = await dashboardResponse(request('/api/statistics/summary'), {
    ...options, readSummary: async () => { throw Object.assign(new Error('Missing'), { statusCode: 404 }) },
  })
  assert.equal(missing.status, 503)
  assert.equal((await dashboardResponse(request('/api/statistics/other'), options)).status, 404)
})
