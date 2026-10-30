import { createAppAuth } from '@octokit/auth-app'
import { request } from '@octokit/request'
import { FeedbackError } from './feedback.js'
import type { GitHub, Issue, Settings } from './feedback.js'

const endpoint = 'https://api.github.com/repos/erjosito/vwan-visual-topology'
export async function github(config: Settings): Promise<GitHub> {
  const auth = createAppAuth({
    appId: config.appId,
    installationId: config.installationId,
    privateKey: config.privateKey,
    request: request.defaults({ request: {
      fetch: (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(7000) }),
    } }),
  })
  const { token } = await auth({ type: 'installation' })
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const result = await fetch(`${endpoint}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(7000),
    })
    if (!result.ok) {
      if (result.status === 429 || (result.status === 403 && (result.headers.has('retry-after') || result.headers.get('x-ratelimit-remaining') === '0'))) {
        const delay = result.headers.get('retry-after') ?? ''
        const seconds = /^\d+$/.test(delay) ? Number(delay) : Math.ceil((Date.parse(delay) - Date.now()) / 1000)
        throw new FeedbackError(429, 'Feedback is temporarily rate limited. Try again later.', Math.max(300, seconds || 0))
      }
      throw new Error('GitHub feedback request was not confirmed.')
    }
    return result
  }
  return {
    async recent(since) {
      const issues: Issue[] = []
      for (let page = 1; page <= 2; page++) {
        const result = await call(`/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}&since=${encodeURIComponent(since)}&labels=feedback`)
        const batch = await result.json() as Issue[]
        issues.push(...batch)
        if (batch.length < 100 || batch.some((issue) => issue.created_at < since)) return issues
      }
      throw new FeedbackError(503, 'Feedback is temporarily unavailable.')
    },
    async create(title, body) {
      const result = await call('/issues', 'POST', { title, body, labels: ['feedback'] })
      if (result.status !== 201) throw new Error('GitHub issue creation was not confirmed.')
      const issue = await result.json() as { number?: number; labels?: { name: string }[] }
      if (!Number.isInteger(issue.number) || !issue.labels?.some((label) => label.name === 'feedback')) {
        throw new Error('GitHub feedback tracking could not be confirmed.')
      }
    },
  }
}
