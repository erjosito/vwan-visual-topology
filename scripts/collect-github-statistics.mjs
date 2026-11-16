import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const api = 'https://api.github.com'

export async function collectGitHubStatistics({
  repository,
  token,
  trafficToken,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('Provide a GitHub repository as owner/name.')
  }
  const startedAt = now().toISOString()
  const root = `/repos/${repository}`
  const get = async (path, credential = token) => {
    const response = await fetchImpl(`${api}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'github-statistics-collector',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      throw new Error(`GitHub ${path}: HTTP ${response.status}. Check token permissions or API rate limits.`)
    }
    return response.json()
  }
  const pages = async (path) => {
    const items = []
    for (let page = 1; ; page++) {
      const batch = await get(`${path}?per_page=100&page=${page}`)
      if (!Array.isArray(batch)) throw new Error(`Expected a GitHub list at ${path}.`)
      items.push(...batch)
      if (batch.length < 100) return items
    }
  }
  const count = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid GitHub counter.')
    return value
  }

  const metadata = await get(root)
  const releases = []
  for (const release of await pages(`${root}/releases`)) {
    if (release.draft) continue
    const assets = await pages(`${root}/releases/${release.id}/assets`)
    releases.push({
      id: release.id,
      tag: release.tag_name,
      publishedAt: release.published_at,
      prerelease: release.prerelease,
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        sizeBytes: count(asset.size),
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
        downloads: count(asset.download_count),
      })),
    })
  }

  const traffic = { status: 'not_configured' }
  if (trafficToken) {
    traffic.status = 'available'
    for (const [metric, dailyKey] of [['views', 'views'], ['clones', 'clones']]) {
      const result = await get(`${root}/traffic/${metric}?per=day`, trafficToken)
      traffic[metric] = {
        count: count(result.count),
        uniques: count(result.uniques),
        days: result[dailyKey].map((day) => ({
          date: day.timestamp,
          count: count(day.count),
          uniques: count(day.uniques),
        })),
      }
    }
  }

  return {
    schemaVersion: 1,
    repository,
    startedAt,
    collectedAt: now().toISOString(),
    repositoryCounters: {
      stars: count(metadata.stargazers_count),
      forks: count(metadata.forks_count),
      subscribers: count(metadata.subscribers_count),
    },
    releases,
    traffic,
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      repository: { type: 'string', default: process.env.GITHUB_REPOSITORY },
      output: { type: 'string', default: 'test-artifacts/github-statistics.json' },
    },
  })
  const snapshot = await collectGitHubStatistics({
    repository: values.repository,
    token: process.env.GITHUB_TOKEN,
    trafficToken: process.env.GH_STATS_TRAFFIC_TOKEN,
  })
  const output = resolve(values.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
  console.log(`Collected ${snapshot.repository}: ${snapshot.releases.length} releases; traffic ${snapshot.traffic.status}.`)
  if (snapshot.traffic.status === 'not_configured' && process.env.GITHUB_ACTIONS === 'true') {
    console.log('::warning::Repository traffic is not measured. Configure GH_STATS_TRAFFIC_TOKEN to collect it.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
