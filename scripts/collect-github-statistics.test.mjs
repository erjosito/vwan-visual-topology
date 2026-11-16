import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectGitHubStatistics } from './collect-github-statistics.mjs'

const repository = 'owner/project'
const root = `/repos/${repository}`
const now = () => new Date('2026-11-16T04:17:00Z')
const metadata = { stargazers_count: 7, forks_count: 2, subscribers_count: 3, private: false }
const release = { id: 11, tag_name: 'v1', published_at: '2026-11-15T00:00:00Z', prerelease: true, draft: false }
const asset = { id: 22, name: 'installer.exe', size: 1024, download_count: 9, created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T01:00:00Z' }

function mockGitHub(routes) {
  const calls = []
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.github.com')
    const path = new URL(url).pathname + new URL(url).search
    calls.push({ path, ...options })
    assert.ok(Object.hasOwn(routes, path), `Unexpected GitHub request: ${path}`)
    const result = routes[path]
    return result instanceof Response ? result : Response.json(result)
  }
  return { fetchImpl, calls }
}

function baseRoutes() {
  return {
    [root]: metadata,
    [`${root}/releases?per_page=100&page=1`]: [release],
    [`${root}/releases/11/assets?per_page=100&page=1`]: [asset],
  }
}

test('collects public counters and asset identities without treating missing traffic as zero', async () => {
  const mock = mockGitHub(baseRoutes())
  const snapshot = await collectGitHubStatistics({ repository, now, token: 'public-token', ...mock })
  assert.deepEqual(snapshot.repositoryCounters, { stars: 7, forks: 2, subscribers: 3 })
  assert.deepEqual(snapshot.traffic, { status: 'not_configured' })
  assert.deepEqual(snapshot.releases, [{
    id: 11,
    tag: 'v1',
    publishedAt: release.published_at,
    prerelease: true,
    assets: [{
      id: 22, name: 'installer.exe', sizeBytes: 1024, downloads: 9,
      createdAt: asset.created_at, updatedAt: asset.updated_at,
    }],
  }])
  assert.equal(snapshot.startedAt, now().toISOString())
  assert.equal(snapshot.collectedAt, now().toISOString())
  assert.ok(mock.calls.every((call) => call.headers.Authorization === 'Bearer public-token'))
  assert.ok(!JSON.stringify(snapshot).includes('public-token'))
})

test('paginates both releases and assets and excludes draft release information', async () => {
  const routes = baseRoutes()
  routes[`${root}/releases?per_page=100&page=1`] = Array.from({ length: 100 }, (_, id) => ({ ...release, id, draft: true }))
  routes[`${root}/releases?per_page=100&page=2`] = [release]
  routes[`${root}/releases/11/assets?per_page=100&page=1`] = Array.from({ length: 100 }, (_, id) => ({ ...asset, id }))
  routes[`${root}/releases/11/assets?per_page=100&page=2`] = [{ ...asset, id: 999 }]
  const snapshot = await collectGitHubStatistics({ repository, now, ...mockGitHub(routes) })
  assert.equal(snapshot.releases.length, 1)
  assert.equal(snapshot.releases[0].assets.length, 101)
  assert.equal(snapshot.releases[0].assets[100].id, 999)
})

test('preserves overlapping traffic windows and uses the privileged token only for traffic', async () => {
  const routes = baseRoutes()
  const days = [
    { timestamp: '2026-11-14T00:00:00Z', count: 5, uniques: 3, ignored: 'not retained' },
    { timestamp: '2026-11-15T00:00:00Z', count: 4, uniques: 3 },
  ]
  routes[`${root}/traffic/views?per=day`] = { count: 9, uniques: 4, views: days }
  routes[`${root}/traffic/clones?per=day`] = { count: 9, uniques: 4, clones: days }
  const mock = mockGitHub(routes)
  const snapshot = await collectGitHubStatistics({
    repository, now, token: 'public-token', trafficToken: 'traffic-token', ...mock,
  })
  assert.equal(snapshot.traffic.status, 'available')
  assert.equal(snapshot.traffic.views.uniques, 4)
  assert.equal(snapshot.traffic.views.days[0].uniques, 3)
  assert.ok(!JSON.stringify(snapshot).includes('not retained'))
  for (const call of mock.calls) {
    assert.equal(call.headers.Authorization, `Bearer ${call.path.includes('/traffic/') ? 'traffic-token' : 'public-token'}`)
  }
})

test('fails on configured traffic permission errors instead of recording false zeroes', async () => {
  const routes = baseRoutes()
  routes[`${root}/traffic/views?per=day`] = new Response('Do not log response content or tokens', { status: 403 })
  await assert.rejects(
    collectGitHubStatistics({ repository, now, trafficToken: 'secret', ...mockGitHub(routes) }),
    { message: `GitHub ${root}/traffic/views?per=day: HTTP 403. Check token permissions or API rate limits.` },
  )
})

test('rejects invalid repositories, API failures and invalid counters', async () => {
  await assert.rejects(collectGitHubStatistics({ repository: '../other', ...mockGitHub({}) }), /owner\/name/)
  await assert.rejects(collectGitHubStatistics({
    repository, ...mockGitHub({ [root]: new Response('', { status: 429 }) }),
  }), /HTTP 429/)
  const routes = baseRoutes()
  routes[`${root}/releases/11/assets?per_page=100&page=1`] = [{ ...asset, download_count: -1 }]
  await assert.rejects(collectGitHubStatistics({ repository, ...mockGitHub(routes) }), /Invalid GitHub counter/)
})
