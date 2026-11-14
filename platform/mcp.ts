import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PlatformJobs } from './jobs'
import { capabilities, engineVersion } from '../src/platform/contract'
import vwanExample from '../public/docs/samples/hub-routing-preferences.json'
import hubSpokeExample from '../public/docs/samples/azure-net/hub-spoke-firewall-udr.json'
import fullExample from '../public/docs/samples/azure-net/hybrid-vwan-and-hub-spoke.json'

const server = new McpServer({ name: 'azure-network-simulator', version: engineVersion })
const jobs = new PlatformJobs()
const reply = (data: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data,
})
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }

server.registerTool('get_capabilities', {
  description: 'Discover supported modes, contract/engine versions, limits and privacy boundaries. No network or Azure access.',
  inputSchema: {}, annotations,
}, async () => reply(capabilities))

server.registerTool('get_schema', {
  description: 'Get the request envelope, owned endpoint shapes and an authored native topology example for a mode. Use the real validator before assuming compatibility.',
  inputSchema: { mode: z.enum(['vwan', 'hub-spoke', 'full']) }, annotations,
}, async ({ mode }) => reply({
  ...capabilities,
  envelope: { contractVersion: 1, operation: 'evaluate', document: { mode, topology: 'native topology JSON shown below' }, requirements: [], budget: { maxMillis: 15000, maxOutputBytes: 8000000 } },
  endpointShapes: mode === 'vwan' ? [{ kind: 'spoke', id: 'ID' }, { kind: 'site', id: 'ID' }, { kind: 'hub', id: 'ID' }]
    : [{ kind: 'subnet', vnetId: 'ID', subnetId: 'ID' }, { kind: 'site', siteId: 'ID' }],
  requirementShapes: [
    { id: 'unique-goal-id', kind: 'flow', source: 'owned endpoint', target: 'owned endpoint', sourceAddress: 'IPv4', destinationAddress: 'IPv4', expectation: 'allow or deny', optionalWaypoint: mode === 'vwan' ? 'requiredFirewallHubId' : 'requiredApplianceId' },
    { id: 'unique-route-id', kind: 'route', table: mode === 'vwan' ? 'hub ID' : 'simulation subnet table key', prefix: 'canonical IPv4 CIDR', expectation: 'present or absent', optional: mode === 'vwan' ? 'hubTableId' : null },
  ],
  example: mode === 'vwan' ? vwanExample : mode === 'hub-spoke' ? hubSpokeExample : fullExample,
  handoff: 'Review the resulting native topology JSON, then import it through the web or desktop file UI. This server does not write files or modify an open UI.',
}))

server.registerTool('start_simulation', {
  description: 'Start an isolated bounded validation/simulation/evaluation job. Requirements must be explicit, uniquely identified and fully represented. Returns an expiring session-local handle, not a passing grade.',
  inputSchema: {
    request: z.object({
      contractVersion: z.literal(1),
      engineVersion: z.string().optional(),
      operation: z.enum(['validate', 'simulate', 'evaluate']),
      document: z.object({ mode: z.enum(['vwan', 'hub-spoke', 'full']), topology: z.record(z.string(), z.unknown()) }).strict(),
      locale: z.enum(['en', 'ja']).optional(),
      requirements: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
      budget: z.object({ maxMillis: z.number().int().positive().max(15000).optional(), maxOutputBytes: z.number().int().positive().max(8000000).optional() }).strict().optional(),
    }).strict(),
  }, annotations,
}, async ({ request }) => reply({ handle: jobs.start(request), status: 'running', lifetimeSeconds: 600 }))

server.registerTool('get_job', {
  description: 'Read job completion and explicit requirement outcomes. A not-assessed requirement must never be treated as satisfied. Fetch bounded evidence separately.',
  inputSchema: { handle: z.string().uuid() }, annotations,
}, async ({ handle }) => {
  const { status, result } = jobs.get(handle)
  return reply({
    status, ...(result ? {
      contractVersion: result.contractVersion, engineVersion: result.engineVersion, revision: result.revision,
      resultStatus: result.status, errors: result.errors, limitations: result.limitations.slice(0, 20),
      assessments: result.assessments.map(({ id, outcome, reasons }) => ({ id, outcome, reasons })),
      sections: ['document', 'simulation', 'assessments'],
    } : {}),
  })
})

server.registerTool('get_evidence', {
  description: 'Retrieve bounded JSON-text chunks of a completed job section. Concatenate all chunks in offset order before parsing; a partial chunk is not complete evidence.',
  inputSchema: { handle: z.string().uuid(), section: z.enum(['document', 'simulation', 'assessments']), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(16000).default(8000) }, annotations,
}, async ({ handle, section, offset, limit }) => {
  const { result } = jobs.get(handle)
  if (!result) throw new Error('Job is still running.')
  const text = JSON.stringify(result[section] ?? null)
  if (offset > text.length) throw new Error('Offset outside evidence.')
  return reply({ section, offset, nextOffset: Math.min(offset + limit, text.length), totalCharacters: text.length, complete: offset + limit >= text.length, jsonText: text.slice(offset, offset + limit) })
})

server.registerTool('cancel_job', {
  description: 'Cancel one session-owned job. It returns not-assessed results, never a partial passing grade.',
  inputSchema: { handle: z.string().uuid() }, annotations,
}, async ({ handle }) => { jobs.cancel(handle); return reply({ handle, cancellationRequested: true }) })

process.once('SIGINT', () => { jobs.close(); void server.close() })
process.once('SIGTERM', () => { jobs.close(); void server.close() })
process.stdin.once('end', () => { jobs.close(); void server.close() })
void server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 4_100_000 })).catch(() => { jobs.close(); process.exitCode = 1 })
