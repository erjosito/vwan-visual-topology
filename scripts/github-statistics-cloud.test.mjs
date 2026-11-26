import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectUserCloudMetrics, cloudMetricsSource } from '../functions/github-statistics/cloud.mjs'

const resourceId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/user-cloud/providers/Microsoft.Insights/components/cloud-api'
const now = new Date('2026-11-16T19:00:00Z')
const point = (day, count) => ({ timeStamp: `2026-11-${day}T00:00:00Z`, count })
const series = (code, data) => ({
  metadatavalues: code === undefined ? [] : [{ name: { value: 'request/resultCode' }, value: code }], data,
})
const credential = { async getToken(scope) {
  assert.equal(scope, 'https://management.azure.com/.default')
  return { token: 'private-test-token' }
} }
function response(url) {
  const recent = url.searchParams.get('timespan').startsWith('2026-10-17')
  const split = url.searchParams.has('$filter')
  return {
    timespan: url.searchParams.get('timespan'), interval: 'P1D',
    value: [{ name: { value: 'requests/count' }, errorCode: 'Success', timeseries: !recent ? [] : split
      ? [series('200', [point('15', 5), point('13', 5)]), series('429', [point('15', 2)]),
        series('503', [point('15', 1)]), series('401', [point('15', 2)])]
      : [series(undefined, [point('15', 10), point('14', 0), point('13', 8), point('12', null)])] }],
    unwanted: 'do-not-archive',
  }
}

test('collects only standard aggregate counts, reconciles HTTP status buckets and preserves missing coverage', async () => {
  const requests = []
  const result = await collectUserCloudMetrics({ resourceId, credential, now, fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://management.azure.com')
    assert.equal(url.searchParams.get('metricnamespace'), 'Microsoft.Insights/components')
    assert.equal(url.searchParams.get('metricnames'), 'requests/count')
    assert.equal(url.searchParams.get('aggregation'), 'Count')
    assert.equal(url.searchParams.get('interval'), 'P1D')
    assert.equal(url.searchParams.get('AutoAdjustTimegrain'), 'false')
    assert.equal(url.searchParams.get('ValidateDimensions'), 'true')
    if (url.searchParams.has('$filter')) {
      assert.equal(url.searchParams.get('$filter'), "request/resultCode eq '*'")
      assert.equal(url.searchParams.get('top'), '1000')
    }
    assert.equal(options.headers.Authorization, 'Bearer private-test-token')
    assert.equal(options.redirect, 'error')
    requests.push(url.searchParams.get('timespan'))
    return Response.json(response(url))
  } })
  assert.equal(requests.length, 6)
  assert.deepEqual([...new Set(requests)], [
    '2026-08-18T00:00:00.000Z/2026-09-17T00:00:00.000Z',
    '2026-09-17T00:00:00.000Z/2026-10-17T00:00:00.000Z',
    '2026-10-17T00:00:00.000Z/2026-11-16T00:00:00.000Z',
  ])
  assert.equal(result.source, cloudMetricsSource)
  assert.equal(result.days.length, 90)
  assert.deepEqual(result.days.at(-1), { date: '2026-11-15', requests: 10, throttled: 2, serverErrors: 1 })
  assert.deepEqual(result.days.at(-2), { date: '2026-11-14', requests: 0, throttled: 0, serverErrors: 0 })
  assert.deepEqual(result.days.at(-3), { date: '2026-11-13', requests: 8, throttled: null, serverErrors: null })
  assert.deepEqual(result.days.at(-4), { date: '2026-11-12', requests: null, throttled: null, serverErrors: null })
  assert.equal(result.days[0].requests, null)
  for (const secret of ['private-test-token', 'do-not-archive', 'request/resultCode']) assert.ok(!JSON.stringify(result).includes(secret))
})

test('missing, unknown and mismatched status buckets cannot establish an error-free day', async () => {
  for (const change of [
    data => { data.value[0].timeseries = [] },
    data => { data.value[0].timeseries[0].metadatavalues[0].value = 'unknown' },
    data => { data.value[0].timeseries[0].data[0].count = 50 },
  ]) {
    const result = await collectUserCloudMetrics({ resourceId, credential, now, fetchImpl: async url => {
      const data = response(url)
      if (url.searchParams.has('$filter') && data.value[0].timeseries.length) change(data)
      return Response.json(data)
    } })
    assert.equal(result.days.at(-1).requests, 10)
    assert.equal(result.days.at(-1).throttled, null)
    assert.equal(result.days.at(-1).serverErrors, null)
  }
})

test('invalid resource configuration and monitoring failures do not become zero activity', async () => {
  await assert.rejects(collectUserCloudMetrics({
    resourceId: `${resourceId}?redirect=elsewhere`, credential, now,
    fetchImpl: () => assert.fail('Invalid resource must not be queried'),
  }), /resource ID/)
  for (const status of [403, 429, 500]) {
    await assert.rejects(collectUserCloudMetrics({
      resourceId, credential, now, fetchImpl: async () => new Response('', { status }),
    }), new RegExp(`HTTP ${status}`))
  }
})

test('truncated, failed, duplicate, malformed and unexpectedly dimensioned responses fail collection', async () => {
  for (const mutate of [
    data => { data.interval = 'PT1H' },
    data => { data.timespan = '2026-11-01T00:00:00Z/2026-11-16T00:00:00Z' },
    data => { data.value = [] },
    data => { data.value.push(data.value[0]) },
    data => { data.value[0].name.value = 'requests/failed' },
    data => { data.value[0].errorCode = 'Error' },
    data => { data.value[0].timeseries.push(data.value[0].timeseries[0]) },
    data => { data.value[0].timeseries[0].metadatavalues = [{ name: { value: 'owner' }, value: 'not-allowed' }] },
    data => { data.value[0].timeseries[0].data[0].count = -1 },
    data => { data.value[0].timeseries[0].data[0].count = '10' },
    data => { data.value[0].timeseries[0].data[0].timeStamp = '2026-11-15T01:00:00Z' },
    data => { data.value[0].timeseries[0].data[0].timeStamp = '2026-11-16T00:00:00Z' },
    data => { data.value[0].timeseries[0].data.push(data.value[0].timeseries[0].data[0]) },
  ]) {
    await assert.rejects(collectUserCloudMetrics({ resourceId, credential, now, fetchImpl: async url => {
      const data = response(url)
      if (data.value[0].timeseries.length) mutate(data)
      return Response.json(data)
    } }), /user-cloud/)
  }
})
