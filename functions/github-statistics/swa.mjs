const dayMs = 86_400_000
const metrics = { SiteHits: 'hits', SiteErrors: 'errors', BytesSent: 'bytesSent' }

export async function collectStaticWebAppMetrics({
  resourceId,
  credential,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-zA-Z0-9_.()-]+\/providers\/Microsoft\.Web\/staticSites\/[a-zA-Z0-9-]+$/i.test(resourceId ?? '')) {
    throw new Error('Configure a Static Web App resource ID for platform metrics.')
  }
  const end = new Date(now.toISOString().slice(0, 10))
  const start = new Date(end.getTime() - 90 * dayMs)
  const token = await credential.getToken('https://management.azure.com/.default')
  const days = new Map()
  for (let time = start.getTime(); time < end.getTime(); time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10)
    days.set(date, { date, hits: null, errors: null, bytesSent: null })
  }
  // SWA silently truncates long metric queries; keep each request below its 31-day limit.
  for (let from = start.getTime(); from < end.getTime(); from += 30 * dayMs) {
    const through = Math.min(from + 30 * dayMs, end.getTime())
    const url = new URL(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics`)
    url.search = new URLSearchParams({
      'api-version': '2018-01-01',
      metricnamespace: 'Microsoft.Web/staticSites',
      metricnames: Object.keys(metrics).join(','),
      timespan: `${new Date(from).toISOString()}/${new Date(through).toISOString()}`,
      interval: 'P1D',
      aggregation: 'Total',
      AutoAdjustTimegrain: 'false',
    }).toString()
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Static Web App metrics: HTTP ${response.status}. Check resource-scoped monitoring access.`)
    const result = await response.json()
    const bounds = result.timespan?.split('/').map(Date.parse)
    if (result.interval !== 'P1D' || !Array.isArray(result.value)
      || bounds?.length !== 2 || bounds[0] !== from || bounds[1] !== through) {
      throw new Error('Invalid or truncated Static Web App daily metrics response.')
    }
    const seen = new Set()
    for (const metric of result.value) {
      const name = metric.name?.value
      if (!Object.hasOwn(metrics, name) || seen.has(name) || metric.errorCode !== 'Success'
        || !Array.isArray(metric.timeseries) || metric.timeseries.length > 1) {
        throw new Error('Invalid or failed Static Web App metric.')
      }
      seen.add(name)
      const series = metric.timeseries[0]
      if (!series) continue
      if ((series.metadatavalues?.length ?? 0) || !Array.isArray(series.data)) throw new Error('Unexpected Static Web App metric dimensions.')
      const dates = new Set()
      for (const point of series.data) {
        const time = Date.parse(point.timeStamp)
        if (!Number.isFinite(time) || time % dayMs !== 0) throw new Error('Invalid Static Web App metric timestamp.')
        const date = new Date(time).toISOString().slice(0, 10)
        if (time < from || time >= through || dates.has(date)) throw new Error('Unexpected Static Web App metric date.')
        dates.add(date)
        if (point.total === null || point.total === undefined) continue
        if (!Number.isFinite(point.total) || point.total < 0) throw new Error('Invalid Static Web App metric total.')
        days.get(date)[metrics[name]] = point.total
      }
    }
    if (seen.size !== Object.keys(metrics).length) throw new Error('Missing Static Web App metrics in response.')
  }
  return {
    status: 'available',
    resourceId,
    collectedAt: now.toISOString(),
    days: [...days.values()],
  }
}
