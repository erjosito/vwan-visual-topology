const dayMs = 86_400_000
export const dashboardHistoryDays = 366

export async function buildDashboardSummary(snapshots, { repository, now = new Date() }) {
  const observations = []
  const trafficDays = new Map()
  const webObservations = []
  let latest
  for await (const snapshot of snapshots) {
    if (snapshot.schemaVersion !== 1 || snapshot.repository !== repository
      || !Number.isFinite(Date.parse(snapshot.collectedAt))) throw new Error('Invalid statistics snapshot.')
    if (!latest || snapshot.collectedAt > latest.collectedAt) latest = snapshot
    observations.push({
      collectedAt: snapshot.collectedAt,
      repositoryCounters: snapshot.repositoryCounters,
      assets: snapshot.releases.flatMap((release) => release.assets.map(({ id, downloads }) => ({ id, downloads }))),
    })
    if (snapshot.web?.status === 'available') webObservations.push(snapshot.web)
    if (snapshot.traffic.status !== 'available') continue
    for (const metric of ['views', 'clones']) {
      for (const entry of snapshot.traffic[metric].days) {
        const key = entry.date.slice(0, 10)
        const row = trafficDays.get(key) ?? { date: key }
        if (!row[metric] || snapshot.collectedAt > row[metric].observedAt) {
          row[metric] = { count: entry.count, uniques: entry.uniques, observedAt: snapshot.collectedAt }
        }
        trafficDays.set(key, row)
      }
    }
  }
  if (!latest) throw new Error('No statistics snapshots are available.')

  const assets = new Map()
  const days = new Map()
  for (const observation of observations.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))) {
    const date = observation.collectedAt.slice(0, 10)
    const row = days.get(date) ?? { date, growth: null, intervalStart: null, baselines: 0, resets: 0 }
    Object.assign(row, { observedAt: observation.collectedAt, ...observation.repositoryCounters, downloads: 0 })
    for (const asset of observation.assets) {
      row.downloads += asset.downloads
      const previous = assets.get(asset.id)
      if (!previous) row.baselines++
      else if (asset.downloads < previous.downloads) row.resets++
      else {
        row.growth = (row.growth ?? 0) + asset.downloads - previous.downloads
        if (!row.intervalStart || previous.observedAt < row.intervalStart) row.intervalStart = previous.observedAt
      }
      assets.set(asset.id, { downloads: asset.downloads, observedAt: observation.collectedAt })
    }
    days.set(date, row)
  }
  const series = [...days.values()]
  const webDays = new Map()
  let web = { status: 'not_configured', days: [] }
  const cutoff = new Date(now.getTime() - (dashboardHistoryDays - 1) * dayMs).toISOString().slice(0, 10)
  webObservations.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
  const latestWeb = webObservations.at(-1)
  if (latestWeb) {
    for (const observation of webObservations) {
      if (observation.resourceId.toLowerCase() !== latestWeb.resourceId.toLowerCase()) continue
      for (const entry of observation.days) {
        if (entry.date < cutoff || entry.date >= observation.collectedAt.slice(0, 10)) continue
        webDays.set(entry.date, {
          date: entry.date, hits: entry.hits, errors: entry.errors, bytesSent: entry.bytesSent,
        })
      }
    }
    web = {
      status: 'available',
      resourceName: latestWeb.resourceId.split('/').at(-1),
      collectedAt: latestWeb.collectedAt,
      days: [...webDays.values()].sort((a, b) => a.date.localeCompare(b.date)),
    }
  }
  const window = (metric) => {
    const data = latest.traffic[metric]
    return { count: data.count, uniques: data.uniques, from: data.days[0]?.date ?? null, through: data.days.at(-1)?.date ?? null }
  }
  return {
    schemaVersion: 1,
    repository,
    generatedAt: now.toISOString(),
    collectedAt: latest.collectedAt,
    historyStart: series[0].observedAt,
    repositoryCounters: latest.repositoryCounters,
    downloads: series.at(-1).downloads,
    releases: latest.releases.map((release) => ({
      id: release.id, tag: release.tag, prerelease: release.prerelease, publishedAt: release.publishedAt,
      assets: release.assets.map(({ id, name, downloads }) => ({ id, name, downloads })),
    })),
    traffic: latest.traffic.status === 'available'
      ? { status: 'available', views: window('views'), clones: window('clones') }
      : { status: 'not_configured' },
    series,
    trafficDays: [...trafficDays.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, partial: row.date >= latest.collectedAt.slice(0, 10) })),
    web,
  }
}

export async function persistDashboardSummary({ container, repository, now = new Date() }) {
  const prefix = `github/${repository}/snapshots/`
  const cutoff = new Date(now.getTime() - (dashboardHistoryDays - 1) * dayMs).toISOString().slice(0, 10).replaceAll('-', '/')
  const blobName = `github/${repository}/dashboard/summary.json`
  const output = container.getBlockBlobClient(blobName)
  async function* snapshots() {
    for await (const item of container.listBlobsFlat({ prefix })) {
      if (item.name.slice(prefix.length, prefix.length + 10) < cutoff || !item.name.endsWith('.json')) continue
      yield JSON.parse((await container.getBlockBlobClient(item.name).downloadToBuffer()).toString('utf8'))
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    let etag
    try { etag = (await output.getProperties()).etag } catch (error) {
      if (error.statusCode !== 404) throw error
    }
    const summary = await buildDashboardSummary(snapshots(), { repository, now })
    try {
      const saved = await output.uploadData(Buffer.from(`${JSON.stringify(summary)}\n`), {
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/json', blobCacheControl: 'private, no-store' },
      })
      return { blobName, etag: saved.etag, collectedAt: summary.collectedAt, observations: summary.series.length }
    } catch (error) {
      if (error.statusCode !== 412 || attempt === 2) throw error
    }
  }
}

export function isApprovedDashboardUser(request, {
  tenantId = process.env.AZURE_STATS_DASHBOARD_TENANT_ID,
  allowedObjectIds = process.env.AZURE_STATS_DASHBOARD_ALLOWED_OBJECT_IDS,
} = {}) {
  if (!tenantId || !allowedObjectIds) return false
  try {
    const principal = JSON.parse(Buffer.from(request.headers.get('x-ms-client-principal') ?? '', 'base64').toString('utf8'))
    const claim = (...types) => principal.claims?.find(({ typ }) => types.includes(typ))?.val
    const objectId = claim('oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier')
    const tenant = claim('tid', 'http://schemas.microsoft.com/identity/claims/tenantid')
    return principal.auth_typ === 'aad' && tenant?.toLowerCase() === tenantId.toLowerCase()
      && typeof objectId === 'string'
      && allowedObjectIds.split(',').some((id) => id.trim().toLowerCase() === objectId.toLowerCase())
  } catch {
    return false
  }
}

export function dashboardHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  }
}

export async function dashboardResponse(request, { html, script, readSummary, authorize = isApprovedDashboardUser }) {
  if (!authorize(request)) return { status: 403, headers: dashboardHeaders('text/plain'), body: 'Dashboard access is restricted.' }
  const path = new URL(request.url).pathname.replace(/\/$/, '')
  if (path === '' || path === '/api/statistics') return { headers: dashboardHeaders('text/html; charset=utf-8'), body: html }
  if (path === '/api/statistics/dashboard.js') return { headers: dashboardHeaders('text/javascript; charset=utf-8'), body: script }
  if (path !== '/api/statistics/summary') return { status: 404 }
  try {
    return { headers: dashboardHeaders('application/json'), jsonBody: await readSummary() }
  } catch (error) {
    if (error.statusCode !== 404) throw error
    return { status: 503, headers: dashboardHeaders('application/json'), jsonBody: { error: 'No dashboard summary is available yet. Run collection or wait for the next daily collection.' } }
  }
}
