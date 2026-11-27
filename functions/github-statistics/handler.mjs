import { collectGitHubStatistics } from '../../scripts/collect-github-statistics.mjs'

export async function collectAndPersist({
  repository,
  trafficToken,
  invocationId,
  container,
  collect = collectGitHubStatistics,
  collectWebMetrics,
  collectCloudMetrics,
  refreshSummary,
}) {
  if (!trafficToken) throw new Error('GH_STATS_TRAFFIC_TOKEN is required for scheduled traffic collection.')
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(invocationId ?? '')) throw new Error('Invalid collection invocation ID.')
  const github = await collect({ repository, trafficToken })
  const snapshot = {
    ...github,
    ...(collectWebMetrics ? { web: await collectWebMetrics() } : {}),
    ...(collectCloudMetrics ? { cloud: await collectCloudMetrics() } : {}),
  }
  const day = snapshot.collectedAt.slice(0, 10).replaceAll('-', '/')
  const blobName = `github/${snapshot.repository}/snapshots/${day}/function-${invocationId}.json`
  const blob = container.getBlockBlobClient(blobName)
  let properties
  let status = 'created'
  try {
    properties = await blob.uploadData(Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`), {
      conditions: { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: 'application/json' },
    })
  } catch (error) {
    if (error.statusCode !== 412 && error.code !== 'BlobAlreadyExists') throw error
    properties = await blob.getProperties()
    status = 'already_exists'
  }
  const dashboard = refreshSummary ? await refreshSummary() : undefined
  return {
    status,
    blobName,
    etag: properties.etag,
    traffic: snapshot.traffic.status,
    releases: snapshot.releases.length,
    ...(snapshot.web ? { web: { status: snapshot.web.status, days: snapshot.web.days.length } } : {}),
    ...(snapshot.cloud ? { cloud: { status: snapshot.cloud.status, days: snapshot.cloud.days.length } } : {}),
    ...(dashboard ? { dashboard } : {}),
  }
}
