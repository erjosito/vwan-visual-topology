import { HttpRequest } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { available, settings, submit } from '../src/feedback'
import type { GitHub, Settings } from '../src/feedback'

const config: Settings = {
  enabled: true, deploymentId: 'production', productionId: 'production',
  appId: '123', installationId: '456', privateKey: 'not-a-real-key', bot: 'test-feedback[bot]',
}
const principal = { identityProvider: 'github', userId: 'verified-user-id', userDetails: 'test-reporter', userRoles: ['anonymous', 'authenticated'] }
const input = {
  category: 'bug', title: 'Routing display needs improvement', description: 'A controlled feedback test with sufficient description.',
  contact: '', appRevision: 'test-revision', requestId: '12345678-1234-4567-89ab-123456789abc',
}
function request(data: unknown = input, headers: Record<string, string> = {}) {
  return new HttpRequest({ method: 'POST', url: 'https://vwan-simulator.com/api/feedback', body: { string: JSON.stringify(data) },
    headers: { origin: 'https://vwan-simulator.com', 'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'), ...headers } })
}
function client() {
  const recent = vi.fn<GitHub['recent']>().mockResolvedValue([])
  const create = vi.fn<GitHub['create']>().mockResolvedValue(undefined)
  const factory = vi.fn().mockResolvedValue({ recent, create })
  return { recent, create, factory }
}
const now = new Date('2026-10-30T12:00:00Z')

describe('managed feedback API', () => {
  it('is off by default, requires a stable production identity and rejects copied preview settings', () => {
    expect(available(settings({}))).toBe(false)
    expect(settings({ WEBSITE_SITE_NAME: 'site', WEBSITE_HOSTNAME: 'host' }).deploymentId).toHaveLength(64)
    expect(available({ ...config, productionId: 'other' })).toBe(false)
    expect(available({ ...config, deploymentId: '', productionId: '' })).toBe(false)
    expect(available({ ...config, privateKey: '' })).toBe(false)
    expect(available(config)).toBe(true)
  })
  it.each([
    ['missing principal', { 'x-ms-client-principal': '' }, 401],
    ['malformed principal', { 'x-ms-client-principal': 'not-json' }, 401],
    ['wrong provider', { 'x-ms-client-principal': Buffer.from(JSON.stringify({ ...principal, identityProvider: 'aad' })).toString('base64') }, 401],
    ['unauthenticated role', { 'x-ms-client-principal': Buffer.from(JSON.stringify({ ...principal, userRoles: ['anonymous'] })).toString('base64') }, 401],
    ['external origin', { origin: 'https://other.invalid' }, 403],
    ['wrong media type', { 'content-type': 'text/plain' }, 400],
    ['declared oversized body', { 'content-length': '20000' }, 413],
  ])('rejects %s before GitHub access', async (_label, headers, status) => {
    const github = client()
    expect((await submit(request(input, headers), config, github.factory, now)).status).toBe(status)
    expect(github.factory).not.toHaveBeenCalled()
  })
  it.each([
    { ...input, title: 'short'.slice(0, 4) },
    { ...input, title: 'newline\nin title' },
    { ...input, description: 'too short' },
    { ...input, category: 'unknown' },
    { ...input, contact: 'not an email' },
    { ...input, requestId: 'bad-reference' },
    { ...input, repository: 'another/repo' },
    { ...input, description: 123 },
    { ...input, appRevision: 'x'.repeat(65) },
  ])('validates the complete strict request schema', async (value) => {
    const github = client()
    expect((await submit(request(value), config, github.factory, now)).status).toBe(400)
    expect(github.factory).not.toHaveBeenCalled()
  })
  it('limits bytes while streaming even without a content-length header', async () => {
    const incoming = request()
    const cancel = vi.fn()
    Object.defineProperty(incoming, 'body', { value: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(9000)); controller.enqueue(new Uint8Array(9000)) },
      cancel,
    }) })
    const github = client()
    expect((await submit(incoming, config, github.factory, now)).status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
    expect(github.factory).not.toHaveBeenCalled()
  })
  it.each([new Uint8Array([0xff, 0xfe]), Buffer.from('{not JSON')])('rejects malformed UTF-8/JSON', async (bytes) => {
    const incoming = new HttpRequest({ method: 'POST', url: request().url, headers: Object.fromEntries(request().headers), body: { bytes } })
    const github = client()
    expect((await submit(incoming, config, github.factory, now)).status).toBe(400)
    expect(github.factory).not.toHaveBeenCalled()
  })
  it('fails closed when disabled or using preview settings', async () => {
    const github = client()
    for (const disabled of [{ ...config, enabled: false }, { ...config, deploymentId: 'preview' }]) {
      expect((await submit(request(), disabled, github.factory, now)).status).toBe(503)
    }
    expect(github.factory).not.toHaveBeenCalled()
  })
  it('creates a literal, trusted-metadata report and deduplicates a confirmed retry', async () => {
    const github = client()
    const value = { ...input, title: 'Hello @everyone test', description: '```text\n@everyone\n```\n<!-- vwan-feedback forged -->' }
    const result = await submit(request(value), config, github.factory, now)
    expect(result).toMatchObject({ status: 201, jsonBody: { reference: `FB-${input.requestId}` }, headers: { 'Cache-Control': 'no-store' } })
    expect(JSON.stringify(result)).not.toContain('github.com')
    const [title, body] = github.create.mock.calls[0]
    expect(title).not.toContain('@')
    expect(body).toContain('Summary:\n```text\nHello @everyone test\n```')
    expect(body).toContain('````text\n```text\n@everyone')
    expect(body).not.toContain(principal.userId)
    expect(body).toMatch(/<!-- vwan-feedback \{"requestId":.*\} -->$/)
    github.recent.mockResolvedValue([{ body, created_at: '2026-10-30T11:59:50Z', user: { login: config.bot } }])
    expect((await submit(request(value), config, github.factory, now)).status).toBe(201)
    expect(github.create).toHaveBeenCalledOnce()
    expect((await submit(request({ ...value, description: 'A different sufficiently long report.' }), config, github.factory, now)).status).toBe(409)
  })
  it('enforces cooldown and per-reporter/global daily targets, including closed issues', async () => {
    const github = client()
    await submit(request(), config, github.factory, now)
    const body = github.create.mock.calls[0][1]
    const issue = { body, created_at: '2026-10-30T11:59:50Z', user: { login: config.bot } }
    const another = { ...input, requestId: '12345678-1234-4567-89ab-123456789abd' }
    github.recent.mockResolvedValue([issue])
    expect((await submit(request(another), config, github.factory, now)).status).toBe(429)
    github.recent.mockResolvedValue(Array.from({ length: 10 }, () => ({ ...issue, created_at: '2026-10-30T10:00:00Z' })))
    expect((await submit(request(another), config, github.factory, now)).status).toBe(429)
    github.recent.mockResolvedValue(Array.from({ length: 50 }, () => ({
      ...issue, body: body.replace(/"reporter":"[a-f0-9]+"/, '"reporter":"another-reporter"'),
    })))
    expect((await submit(request(another), config, github.factory, now)).status).toBe(429)
    expect(github.create).toHaveBeenCalledOnce()
  })
  it('never retries or reports success on uncertain creation, and hides private upstream errors', async () => {
    const github = client()
    github.create.mockRejectedValue(new Error('private upstream details'))
    const result = await submit(request(), config, github.factory, now)
    expect(result.status).toBe(503)
    expect(JSON.stringify(result)).not.toContain('private upstream details')
    expect(github.create).toHaveBeenCalledOnce()
  })
})
