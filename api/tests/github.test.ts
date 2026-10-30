import { afterEach, describe, expect, it, vi } from 'vitest'
import { github } from '../src/github'
import { FeedbackError } from '../src/feedback'
import type { Settings } from '../src/feedback'

vi.mock('@octokit/auth-app', () => ({ createAppAuth: () => async () => ({ token: 'test-installation-token' }) }))
const config: Settings = { enabled: true, deploymentId: 'prod', productionId: 'prod', appId: '1', installationId: '2', privateKey: 'test-key', bot: 'bot' }
afterEach(() => vi.unstubAllGlobals())
describe('GitHub adapter', () => {
  it('fixes the repository, label and closed/open issue query, and creates only once', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('{"number":123,"labels":[{"name":"feedback"}]}', { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const client = await github(config)
    await client.recent('2026-10-30T00:00:00Z')
    await client.create('title', 'body')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('https://api.github.com/repos/erjosito/vwan-visual-topology/issues?state=all')
    expect(url).toContain('labels=feedback')
    expect(options.headers.Authorization).toBe('Bearer test-installation-token')
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ title: 'title', body: 'body', labels: ['feedback'] }) })
  })
  it('fails closed rather than accepting incomplete pagination', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(
      Array.from({ length: 100 }, () => ({ created_at: '2026-10-30T12:00:00Z', body: null, user: null })),
    )))
    vi.stubGlobal('fetch', fetch)
    const client = await github(config)
    await expect(client.recent('2026-10-30T00:00:00Z')).rejects.toBeInstanceOf(FeedbackError)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('respects upstream rate limiting without exposing raw GitHub responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('sensitive', { status: 403, headers: { 'Retry-After': '60' } }))
    vi.stubGlobal('fetch', fetch)
    const client = await github(config)
    await expect(client.create('title', 'body')).rejects.toMatchObject({ status: 429, retryAfter: 300 })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('does not retry a timed-out create operation', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    vi.stubGlobal('fetch', fetch)
    const client = await github(config)
    await expect(client.create('title', 'body')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('does not claim success if the fixed quota-tracking label was not applied', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"number":123,"labels":[]}', { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const client = await github(config)
    await expect(client.create('title', 'body')).rejects.toThrow('tracking could not be confirmed')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
