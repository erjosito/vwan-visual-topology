import { createHash } from 'node:crypto'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'

export interface Settings {
  enabled: boolean
  deploymentId: string
  productionId: string
  appId: string
  installationId: string
  privateKey: string
  bot: string
}
export interface Issue {
  body: string | null
  created_at: string
  user: { login: string } | null
}
export interface GitHub {
  recent: (since: string) => Promise<Issue[]>
  create: (title: string, body: string) => Promise<void>
}
interface Report {
  category: 'bug' | 'feature' | 'other'
  title: string
  description: string
  contact: string
  requestId: string
  appRevision: string
}
const origins = new Set([
  'https://vwan-simulator.com',
  'https://www.vwan-simulator.com',
  'https://black-sea-0b65eb803.4.azurestaticapps.net',
])
const limit = 16 * 1024
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export function settings(env = process.env): Settings {
  const site = env.WEBSITE_SITE_NAME
  const host = env.WEBSITE_HOSTNAME
  return {
    enabled: env.FEEDBACK_ENABLED === 'true',
    deploymentId: site && host ? digest(`${site}:${host}`) : '',
    productionId: env.FEEDBACK_PRODUCTION_DEPLOYMENT_ID ?? '',
    appId: env.FEEDBACK_GITHUB_APP_ID ?? '',
    installationId: env.FEEDBACK_GITHUB_INSTALLATION_ID ?? '',
    privateKey: env.FEEDBACK_GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? '',
    bot: env.FEEDBACK_GITHUB_BOT ?? '',
  }
}
export const available = (config: Settings) => !!(config.enabled && config.deploymentId &&
  config.productionId === config.deploymentId && config.appId && config.installationId && config.privateKey && config.bot)
export class FeedbackError extends Error {
  readonly status: number
  readonly retryAfter: number
  constructor(status: number, message: string, retryAfter = 60) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}
export function response(status: number, jsonBody: unknown, retryAfter?: number): HttpResponseInit {
  return { status, jsonBody, headers: {
    'Cache-Control': 'no-store',
    ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
  } }
}
async function report(request: HttpRequest): Promise<Report> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new FeedbackError(400, 'Send feedback as JSON.')
  }
  if (Number(request.headers.get('content-length')) > limit) throw new FeedbackError(413, 'Feedback exceeds 16 KiB.')
  const reader = request.body?.getReader()
  if (!reader) throw new FeedbackError(400, 'Feedback is missing.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new FeedbackError(413, 'Feedback exceeds 16 KiB.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
  catch { throw new FeedbackError(400, 'Feedback is not valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeedbackError(400, 'Invalid feedback.')
  const data = value as Record<string, unknown>
  const keys = ['category', 'title', 'description', 'contact', 'requestId', 'appRevision']
  if (Object.keys(data).some((key) => !keys.includes(key)) || keys.some((key) => typeof data[key] !== 'string')) {
    throw new FeedbackError(400, 'Unexpected or missing feedback fields.')
  }
  const result = Object.fromEntries(keys.map((key) => [key, (data[key] as string).trim()])) as unknown as Report
  if (!['bug', 'feature', 'other'].includes(result.category) || result.title.length < 5 || result.title.length > 120 ||
    [...result.title].some((character) => character.charCodeAt(0) < 32) || result.description.length < 20 || result.description.length > 8000 ||
    result.contact.length > 254 || (result.contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contact)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.requestId) ||
    !/^[a-zA-Z0-9._-]{1,64}$/.test(result.appRevision)) {
    throw new FeedbackError(400, 'Check the category, text lengths, email and report reference.')
  }
  return result
}
function principal(request: HttpRequest): { id: string; name: string } {
  try {
    const data = JSON.parse(Buffer.from(request.headers.get('x-ms-client-principal') ?? '', 'base64').toString('utf8'))
    if (data.identityProvider === 'github' && Array.isArray(data.userRoles) && data.userRoles.includes('authenticated') &&
      typeof data.userId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.userId) &&
      typeof data.userDetails === 'string' && /^[a-zA-Z0-9-]{1,39}$/.test(data.userDetails)) {
      return { id: digest(data.userId), name: data.userDetails }
    }
  } catch { /* Missing or malformed principals must fail closed. */ }
  throw new FeedbackError(401, 'Sign in with GitHub to submit feedback.')
}
function literal(text: string): string {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)))
  return `${fence}text\n${text}\n${fence}`
}
export async function submit(
  request: HttpRequest, config: Settings, github: () => Promise<GitHub>, now = new Date(),
): Promise<HttpResponseInit> {
  try {
    if (request.method !== 'POST') throw new FeedbackError(405, 'Use POST.')
    const reporter = principal(request)
    if (!origins.has(request.headers.get('origin') ?? '')) throw new FeedbackError(403, 'Unrecognized feedback origin.')
    if (!available(config)) throw new FeedbackError(503, 'Feedback is temporarily unavailable.')
    const data = await report(request)
    const fingerprint = digest(JSON.stringify(data))
    const client = await github()
    const since = new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z'
    const recent = (await client.recent(since)).filter((issue) =>
      issue.user?.login === config.bot && issue.created_at >= since)
    const markers = recent.flatMap((issue) => {
      try {
        const match = issue.body?.match(/<!-- vwan-feedback ([^\n]+) -->\s*$/)
        if (!match) return []
        const marker = JSON.parse(match[1]) as { requestId: string; reporter: string; fingerprint: string }
        return [{ ...marker, createdAt: issue.created_at }]
      } catch { return [] }
    })
    const previous = markers.find((marker) => marker.requestId === data.requestId && marker.reporter === reporter.id)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new FeedbackError(409, 'This reference belongs to a different report.')
      return response(201, { reference: `FB-${data.requestId}` })
    }
    const own = markers.filter((marker) => marker.reporter === reporter.id)
    if (markers.length >= 50 || own.length >= 10 || own.some((marker) => now.getTime() - Date.parse(marker.createdAt) < 60_000)) {
      throw new FeedbackError(429, 'Please wait before sending more feedback.', own.length >= 10 || markers.length >= 50 ? 3600 : 60)
    }
    const marker = { requestId: data.requestId, reporter: reporter.id, fingerprint }
    const body = [
      'Submitted through the Virtual WAN Topology Lab feedback form.',
      `Category: ${data.category}\n\nReporter: ${literal(reporter.name)}`,
      `Description:\n${literal(data.description)}`,
      data.contact ? `Optional contact:\n${literal(data.contact)}` : 'No contact email provided.',
      `Client-reported app revision: ${literal(data.appRevision)}\n\nSubmitted at: ${now.toISOString()}`,
      `<!-- vwan-feedback ${JSON.stringify(marker)} -->`,
    ].join('\n\n')
    await client.create(`[Feedback: ${data.category}] ${data.title.replaceAll('@', '')}`, body)
    return response(201, { reference: `FB-${data.requestId}` })
  } catch (error) {
    if (error instanceof FeedbackError) return response(error.status, { error: error.message }, error.status === 429 ? error.retryAfter : undefined)
    return response(503, { error: 'Receipt could not be confirmed. Your report may have been received; avoid resubmitting immediately.' })
  }
}
