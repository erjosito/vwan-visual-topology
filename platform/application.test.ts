import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { applicationPlatformRequest } from '../tests/fixtures/application'
import { executePlatform } from '../src/platform/service'
import { PlatformJobs } from './jobs'
import { applicationTcpTopology, applicationTcpRequest } from '../tests/fixtures/application-tcp'
import { applicationFirewallTopology, applicationFirewallRequest, applicationFirewallTransparentTopology, applicationFirewallTransparentRequest } from '../tests/fixtures/application-firewall'

const compiled = createRequire(import.meta.url)('../platform-dist/service.cjs') as { executePlatform: typeof executePlatform }
describe('shared application headless contracts', () => {
  it('preserves actual transparent interception rather than native backend delivery across source, compiled and worker execution', async () => {
    const request = { contractVersion: 2 as const, operation: 'application' as const,
      document: { mode: 'full' as const, topology: applicationFirewallTransparentTopology() }, application: applicationFirewallTransparentRequest() }
    const expected = executePlatform(request), jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try {
      expect(expected.errors).toEqual([])
      expect(expected.application?.configuration).toBe('satisfied')
      expect(expected.application?.connections?.[0].forward.native).toMatchObject({ status: 'proxy-intercepted' })
      expect(compiled.executePlatform(request)).toEqual(expected)
      expect(await jobs.run(request)).toEqual(expected)
      request.document.topology.vnetPeerings[0].enabled = false
      const blocked = executePlatform(request)
      expect(blocked.application?.configuration).toBe('violated')
      expect(compiled.executePlatform(request)).toEqual(blocked)
      expect(await jobs.run(request)).toEqual(blocked)
    } finally { jobs.close() }
  })
  it('preserves original Firewall policy, uncertain-instance returns and deny evidence in source, compiled and worker execution', async () => {
    const topology = applicationFirewallTopology()
    const request = { contractVersion: 2 as const, operation: 'application' as const, document: { mode: 'full' as const, topology }, application: applicationFirewallRequest() }
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try {
      for (const action of ['allow', 'deny'] as const) {
        topology.application!.services[0].firewallProxy!.collections[0].action = action
        const expected = executePlatform(request)
        expect(expected.errors).toEqual([])
        expect(expected.application?.configuration).toBe(action === 'allow' ? 'satisfied' : 'violated')
        expect(compiled.executePlatform(request)).toEqual(expected)
        expect(await jobs.run(request)).toEqual(expected)
      }
    } finally { jobs.close() }
  })
  it('preserves independent private TCP connection evidence in source, compiled and isolated execution', async () => {
    const topology = applicationTcpTopology()
    const request = { contractVersion: 2 as const, operation: 'application' as const, document: { mode: 'full' as const, topology }, application: applicationTcpRequest() }
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try {
      for (const state of ['healthy', 'unknown', 'unhealthy'] as const) {
        topology.application!.services[0].tcpProxy!.declaredHealth = state
        const expected = executePlatform(request)
        expect(expected.errors).toEqual([])
        expect(expected.application?.configuration).toBe(state === 'healthy' ? 'satisfied' : state === 'unknown' ? 'not-assessed' : 'violated')
        expect(compiled.executePlatform(request)).toEqual(expected)
        expect(await jobs.run(request)).toEqual(expected)
      }
    } finally { jobs.close() }
  })
  it.each(['vwan', 'hub-spoke', 'full'] as const)('has source/compiled/worker parity for separate %s HTTP and DNS operations', async (mode) => {
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try {
      for (const kind of ['http', 'dns'] as const) {
        const request = applicationPlatformRequest(mode, kind), expected = executePlatform(request)
        expect(expected).toMatchObject({ contractVersion: 2, status: 'not assessed', application: { kind, configuration: 'not-assessed', availability: 'not-assessed' } })
        expect(compiled.executePlatform(request)).toEqual(expected)
        expect(await jobs.run(request)).toEqual(expected)
      }
    } finally { jobs.close() }
  })
  it('discards all application evidence after cancellation or an output limit, never returning partial success', async () => {
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs')), request = applicationPlatformRequest()
    try {
      const handle = jobs.start(request)
      jobs.cancel(handle)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(jobs.get(handle).result).toMatchObject({ contractVersion: 2, status: 'not assessed', errors: [{ code: 'CANCELLED' }] })
      expect(jobs.get(handle).result?.application).toBeUndefined()
      const bounded = { ...request, budget: { maxOutputBytes: 512 } }
      const direct = executePlatform(bounded)
      expect(direct).toMatchObject({ contractVersion: 2, status: 'not assessed', errors: [{ code: 'OUTPUT_LIMIT' }] })
      expect(direct.application).toBeUndefined()
      expect(compiled.executePlatform(bounded)).toEqual(direct)
      expect(await jobs.run(bounded)).toEqual(direct)
    } finally { jobs.close() }
  })
  it('negotiates v2 and retrieves typed application evidence through the actual strict stdio tools', async () => {
    const client = new Client({ name: 'application-contract-test', version: '1' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('platform-dist', 'mcp.cjs')], stderr: 'pipe' })
    await client.connect(transport)
    const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args })
    try {
      const capabilities = await call('get_capabilities')
      expect(capabilities.structuredContent).toMatchObject({ contractVersion: 2, supportedContractVersions: [1, 2], application: { providers: ['application-gateway-tcp', 'azure-firewall-explicit-proxy', 'azure-firewall-application-proxy'] } })
      const request = applicationPlatformRequest()
      for (const invalid of [{ ...request, contractVersion: 1 }, { ...request, contractVersion: 3 }, { ...request, application: { ...request.application, ignored: true } }]) {
        expect((await call('start_simulation', { request: invalid })).isError).toBe(true)
      }
      const tcp = { contractVersion: 2 as const, operation: 'application' as const,
        document: { mode: 'full' as const, topology: applicationTcpTopology() }, application: applicationTcpRequest() }
      const firewall = { contractVersion: 2 as const, operation: 'application' as const,
        document: { mode: 'full' as const, topology: applicationFirewallTopology() }, application: applicationFirewallRequest() }
      const transparent = { contractVersion: 2 as const, operation: 'application' as const,
        document: { mode: 'full' as const, topology: applicationFirewallTransparentTopology() }, application: applicationFirewallTransparentRequest() }
      for (const input of [request, tcp, firewall, transparent]) {
        const expected = executePlatform(input)
        const started = (await call('start_simulation', { request: input })).structuredContent as { handle: string }
        let completed: Record<string, unknown> | undefined
        for (let attempt = 0; attempt < 100; attempt++) {
          completed = (await call('get_job', { handle: started.handle })).structuredContent as Record<string, unknown> | undefined
          if (completed?.status === 'finished') break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(completed).toMatchObject({ resultStatus: expected.status, contractVersion: 2 })
        const chunks: string[] = []
        for (let offset = 0; ; ) {
          const evidence = (await call('get_evidence', { handle: started.handle, section: 'application', offset, limit: 5000 }))
            .structuredContent as { jsonText: string; complete: boolean; nextOffset: number }
          expect(evidence.jsonText.length).toBeGreaterThan(0)
          chunks.push(evidence.jsonText)
          if (evidence.complete) break
          expect(evidence.nextOffset).toBeGreaterThan(offset)
          offset = evidence.nextOffset
        }
        expect(JSON.parse(chunks.join(''))).toEqual(expected.application)
      }
    } finally { await client.close() }
  })
})
