const dayMs = 86_400_000
export const cloudMetricsSource = 'application-insights-standard-metrics'

export async function collectUserCloudMetrics({
  resourceId,
  credential,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-zA-Z0-9_.()-]+\/providers\/Microsoft\.Insights\/components\/[a-zA-Z0-9_.()-]+$/i.test(resourceId ?? '')) {
    throw new Error('Configure the dedicated user-cloud Application Insights resource ID.')
  }
  const end = new Date(now.toISOString().slice(0, 10))
  const start = end.getTime() - 90 * dayMs
  const token = await credential.getToken('https://management.azure.com/.default')
  const days = new Map()
  for (let time = start; time < end.getTime(); time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10)
    days.set(date, { date, requests: null, throttled: null, serverErrors: null })
  }
  async function query(from, through, split) {
    const url = new URL(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics`)
    url.search = new URLSearchParams({
      'api-version': '2023-10-01',
      metricnamespace: 'Microsoft.Insights/components',
      metricnames: 'requests/count',
      timespan: `${new Date(from).toISOString()}/${new Date(through).toISOString()}`,
      interval: 'P1D',
      aggregation: 'Count',
      AutoAdjustTimegrain: 'false',
      ValidateDimensions: 'true',
      ...(split ? { '$filter': "request/resultCode eq '*'", top: '1000' } : {}),
    }).toString()
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`User-cloud metrics: HTTP ${response.status}. Check resource-scoped monitoring access.`)
    const result = await response.json()
    const bounds = result.timespan?.split('/').map(Date.parse)
    const metric = result.value?.[0]
    if (result.interval !== 'P1D' || bounds?.length !== 2 || bounds[0] !== from || bounds[1] !== through
      || !Array.isArray(result.value) || result.value.length !== 1 || metric?.name?.value !== 'requests/count'
      || metric.errorCode !== 'Success' || !Array.isArray(metric.timeseries)
      || metric.timeseries.length > (split ? 1000 : 1)) {
      throw new Error('Invalid, failed or truncated user-cloud daily metrics response.')
    }
    const series = new Map()
    for (const entry of metric.timeseries) {
      const metadata = entry.metadatavalues ?? []
      const code = split ? metadata[0]?.value : ''
      if (!Array.isArray(metadata) || metadata.length !== (split ? 1 : 0)
        || split && (metadata[0]?.name?.value?.toLowerCase() !== 'request/resultcode'
          || typeof code !== 'string' || code.length > 32)
        || series.has(code) || !Array.isArray(entry.data)) throw new Error('Invalid user-cloud metric dimensions.')
      const values = new Map()
      for (const point of entry.data) {
        const time = Date.parse(point.timeStamp)
        if (!Number.isFinite(time) || time % dayMs !== 0 || time < from || time >= through || values.has(time)
          || point.count != null && (!Number.isSafeInteger(point.count) || point.count < 0)) {
          throw new Error('Invalid user-cloud daily metric sample.')
        }
        values.set(time, point.count ?? null)
      }
      series.set(code, values)
    }
    return series
  }
  for (let from = start; from < end.getTime(); from += 30 * dayMs) {
    const through = Math.min(from + 30 * dayMs, end.getTime())
    const [totals, codes] = await Promise.all([query(from, through, false), query(from, through, true)])
    for (let time = from; time < through; time += dayMs) {
      const day = days.get(new Date(time).toISOString().slice(0, 10))
      day.requests = totals.get('')?.get(time) ?? null
      let sum = 0, throttled = 0, serverErrors = 0, unknown = false
      for (const [code, values] of codes) {
        const value = values.get(time)
        if (value == null) continue
        sum += value
        if (code === '429') throttled += value
        if (/^5\d\d$/.test(code)) serverErrors += value
        if (value > 0 && !/^[1-5]\d\d$/.test(code)) unknown = true
      }
      // Missing status series mean zero only when all buckets reconcile with an explicit total.
      if (day.requests !== null && sum === day.requests && !unknown) {
        day.throttled = throttled
        day.serverErrors = serverErrors
      }
    }
  }
  return {
    status: 'available',
    source: cloudMetricsSource,
    resourceId,
    collectedAt: now.toISOString(),
    days: [...days.values()],
  }
}
