import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectStaticWebAppMetrics } from '../functions/github-statistics/swa.mjs'

const resourceId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/production/providers/Microsoft.Web/staticSites/simulator'
const now = new Date('2026-11-16T19:00:00Z')
const metric = (name, data) => ({ name: { value: name }, errorCode: 'Success', timeseries: [{ data }] })
const response = () => ({
  interval: 'P1D',
  value: [
    metric('SiteHits', [{ timeStamp: '2026-11-15T00:00:00Z', total: 17 }]),
    metric('SiteErrors', [{ timeStamp: '2026-11-15T00:00:00Z' }, { timeStamp: '2026-11-14T00:00:00Z', total: 0 }]),
    metric('BytesSent', [{ timeStamp: '2026-11-15T00:00:00Z', total: 1048576 }]),
  ],
})
const credential = { async getToken(scope) {
  assert.equal(scope, 'https://management.azure.com/.default')
  return { token: 'private-test-token' }
} }
function batch(url, data = response()) {
  const timespan = url.searchParams.get('timespan')
  if (!timespan.startsWith('2026-10-17')) {
    data = response()
    for (const metric of data.value) metric.timeseries = []
  }
  return Response.json({ timespan, ...data })
}

test('queries only existing SWA daily aggregates over 90 complete UTC days; missing samples stay null', async () => {
  const windows = []
  const result = await collectStaticWebAppMetrics({
    resourceId, credential, now,
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://management.azure.com')
      assert.equal(url.searchParams.get('metricnames'), 'SiteHits,SiteErrors,BytesSent')
      windows.push(url.searchParams.get('timespan'))
      assert.equal(url.searchParams.get('interval'), 'P1D')
      assert.equal(url.searchParams.get('aggregation'), 'Total')
      assert.equal(options.headers.Authorization, 'Bearer private-test-token')
      assert.equal(options.redirect, 'error')
      const body = response()
      body.unwanted = 'do-not-archive'
      return batch(url, body)
    },
  })
  assert.equal(result.days.length, 90)
  assert.deepEqual(windows, [
    '2026-08-18T00:00:00.000Z/2026-09-17T00:00:00.000Z',
    '2026-09-17T00:00:00.000Z/2026-10-17T00:00:00.000Z',
    '2026-10-17T00:00:00.000Z/2026-11-16T00:00:00.000Z',
  ])
  assert.deepEqual(result.days.at(-1), { date: '2026-11-15', hits: 17, errors: null, bytesSent: 1048576 })
  assert.equal(result.days.at(-2).errors, 0)
  assert.deepEqual(result.days[0], { date: '2026-08-18', hits: null, errors: null, bytesSent: null })
  assert.ok(!JSON.stringify(result).includes('private-test-token'))
  assert.ok(!JSON.stringify(result).includes('do-not-archive'))
})

test('invalid resource IDs and HTTP failures cannot become false zero activity', async () => {
  await assert.rejects(collectStaticWebAppMetrics({
    resourceId: `${resourceId}?redirect=elsewhere`, credential, now,
    fetchImpl: () => assert.fail('Invalid resource must not be queried'),
  }), /resource ID/)
  for (const status of [403, 429, 500]) {
    await assert.rejects(collectStaticWebAppMetrics({
      resourceId, credential, now, fetchImpl: async () => new Response('', { status }),
    }), new RegExp(`HTTP ${status}`))
  }
})

test('failed, missing, duplicate, malformed and non-daily metrics fail collection', async () => {
  const mutations = [
    (data) => { data.interval = 'PT1H' },
    (data) => { data.timespan = '2026-11-01T00:00:00Z/2026-11-16T00:00:00Z' },
    (data) => { data.value.pop() },
    (data) => { data.value.push(data.value[0]) },
    (data) => { data.value[0].errorCode = 'Error' },
    (data) => { data.value[0].timeseries.push({ data: [] }) },
    (data) => { data.value[0].timeseries[0].data[0].total = -1 },
    (data) => { data.value[0].timeseries[0].data[0].total = '17' },
    (data) => { data.value[0].timeseries[0].data[0].timeStamp = '2026-11-15T01:00:00Z' },
    (data) => { data.value[0].timeseries[0].data[0].timeStamp = '2026-11-16T00:00:00Z' },
    (data) => { data.value[0].timeseries[0].data.push(data.value[0].timeseries[0].data[0]) },
  ]
  for (const mutate of mutations) {
    const data = response()
    mutate(data)
    await assert.rejects(collectStaticWebAppMetrics({
      resourceId, credential, now, fetchImpl: async (url) => batch(url, data),
    }), /Static Web App/)
  }
  const data = response()
  data.value[1].timeseries = []
  const result = await collectStaticWebAppMetrics({
    resourceId, credential, now, fetchImpl: async (url) => batch(url, data),
  })
  assert.ok(result.days.every(({ errors }) => errors === null))
})
