import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PlatformJobs } from './jobs'
import { RenderJobs } from './render-jobs'
import { capabilities, engineVersion } from '../src/platform/contract'
import vwanExample from '../public/docs/samples/hub-routing-preferences.json'
import hubSpokeExample from '../public/docs/samples/azure-net/hub-spoke-firewall-udr.json'
import fullExample from '../public/docs/samples/azure-net/hybrid-vwan-and-hub-spoke.json'

const server = new McpServer({ name: 'azure-network-simulator', version: engineVersion })
const jobs = new PlatformJobs()
const renders = new RenderJobs()
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
    ...(mode === 'vwan' ? [] : [{ kind: 'flow', expectation: 'allow',
      applianceChain: { forward: ['original-firewall-id', 'original-sdwan-id'], reverse: ['original-sdwan-id', 'original-firewall-id'] },
      note: 'Optional ordered waypoint subsequences. Each leg needs 1-16 distinct original appliance IDs. Do not combine with other waypoint fields; not HA or session enforcement.' }]),
    { kind: 'flow', expectation: 'allow', firewallPolicy: { hubId: 'original hub ID', forward: 'required or bypassed', reverse: 'required or bypassed' },
      note: 'Optional per-leg inspection predicate; independent return routing; do not combine with legacy waypoint fields. This is not a Firewall permission or delivery assertion.' },
    { id: 'unique-packet-id', kind: 'packet', packet: 'explicit packet request', sourceAddress: 'fixed original IPv4', destinationAddress: 'fixed original IPv4',
      expectation: 'configured or blocked (configuration only)', optional: 'requiredBackend: original workloadId/nicId/ipConfigurationId/address binding; no live readiness certification' },
    { id: 'unique-goal-id', kind: 'flow', source: 'owned endpoint', target: 'owned endpoint', sourceAddress: 'IPv4', destinationAddress: 'IPv4', expectation: 'allow or deny', optionalWaypoint: mode === 'vwan' ? 'requiredFirewallHubId' : 'requiredApplianceId' },
    { id: 'unique-route-id', kind: 'route', table: mode === 'vwan' ? 'hub ID' : 'simulation subnet table key, or hub ID with explicit hubTableId', prefix: 'canonical IPv4 CIDR', expectation: 'present or absent', optional: 'hubTableId: exact owned table ID, subject to complete modeled coverage' },
  ],
  example: mode === 'vwan' ? vwanExample : mode === 'hub-spoke' ? hubSpokeExample : fullExample,
  optionalStaticHubFirewall: { firewall: { id: 'original-local-firewall', name: 'Local Azure Firewall' },
    staticRoute: { name: 'inspect-private', destinationType: 'CIDR', destinations: ['10.0.0.0/8'], nextHopType: 'ResourceId', nextHop: 'original-local-firewall' },
    boundary: 'Single hub, routing intent disabled; define the route in the ingress associated hub table. Unknown targets remain unassessed.' },
  renderRequest: { tool: 'start_render', handle: 'finished evaluation job handle', assessmentId: 'exact flow requirement ID',
    options: { format: 'gif, svg or png', durationMs: '1500 or 2000', width: '640-1400' },
    retrieval: 'get_render_job, then get_artifact; decode each base64 byte chunk separately and concatenate bytes in offset order. SVG includes animation; PNG is a static frame.' },
  optionalPacket: { operation: 'simulate', packet: { source: { kind: 'workload', workloadId: 'ID', nicId: 'ID', ipConfigurationId: 'ID' }, target: { kind: 'external', address: 'explicit public IPv4' }, protocol: 'tcp or udp', sourcePort: '1-65535', destinationPort: '1-65535' }, result: 'packet section; independent routing probes, no delivery/security/NAT certification' },
  optionalVpnPacket: mode === 'vwan' ? { supported: false, reason: 'Legacy v1 VWAN NAT is unsupported; use the Azure/Full Hybrid native provider.' }
    : { operation: 'simulate', vpnPacket: { connectionId: 'original NAT-associated VPN connection ID', direction: 'ingress or egress',
      tuple: { sourceAddress: 'original initiator IPv4', destinationAddress: 'initiator-visible destination IPv4',
        protocol: 'tcp or udp', sourcePort: '1-65535', destinationPort: '1-65535' } },
      result: 'vpnPacket section: original/translated tuples, native forwarding and one bounded conditional reply; no security/application delivery certification' },
  packetDestinationShapes: [{ kind: 'public-ip', publicIpId: 'original public-IP ID' },
    { kind: 'load-balancer', loadBalancerId: 'original LB ID', frontendId: 'original frontend ID' }],
  inventoryShapes: {
    workloads: [{ id: 'VM_ID', name: 'Workload name', nicIds: ['NIC_ID'], backingDeviceId: 'optional existing router ID; omit for normal VMs' }],
    nics: [{ id: 'NIC_ID', name: 'NIC name', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'existing network ID' },
      ipConfigurations: [{ id: 'IP_CONFIG_ID', name: 'Primary', subnetId: 'existing owned subnet ID', privateIp: 'optional known IPv4', publicIpId: 'optional public-IP ID',
        primary: 'optional boolean; missing role on multiple configurations is unknown' }] }],
    publicIps: [{ id: 'PUBLIC_IP_ID', name: 'Public IP name', address: 'optional known public IPv4' }],
    loadBalancers: [{ id: 'LB_ID', name: 'Regional Standard LB', sku: 'Standard', owner: { kind: mode === 'vwan' ? 'spoke' : 'vnet', id: 'original network ID' },
      frontends: [{ id: 'FRONTEND_ID', name: 'Internal frontend', kind: 'private', subnetId: 'original subnet ID', privateIp: 'optional known IPv4' }],
      pools: [{ id: 'POOL_ID', name: 'Original NIC pool', members: [{ workloadId: 'VM_ID', nicId: 'NIC_ID', ipConfigurationId: 'IP_CONFIG_ID' }] }],
      probes: [{ id: 'PROBE_ID', name: 'Health', protocol: 'tcp', port: 8080, health: [] }],
      rules: [{ id: 'RULE_ID', name: 'Ordinary rule', frontendId: 'FRONTEND_ID', poolId: 'POOL_ID', probeId: 'PROBE_ID', protocol: 'tcp',
        frontendPort: 443, backendPort: 8443, disableOutboundSnat: true }], inboundNatRules: [], outboundRules: [] }],
    haPortsRule: { id: 'RULE_ID', name: 'Declared NVA transit', frontendId: 'FRONTEND_ID', poolId: 'POOL_ID', probeId: 'PROBE_ID',
      protocol: 'all', frontendPort: 0, backendPort: 0, haPorts: true, floatingIp: true, haPortsForwarding: 'preserve-tuple', disableOutboundSnat: true },
    haPortsUsage: 'Native v2 only: use the owned internal VIP as a subnet UDR VirtualAppliance next hop, not as the packet destination. Original backends must be single-NIC/single-IP workloads backed by the matching original nva-vm device.',
    location: 'optional topology.inventory; omitted addresses remain unknown; VWAN detailed subnets are explicitly declared in spoke.subnets',
  },
  applicationContracts: {
    contractVersion: 2, operation: 'application', providers: [],
    inventory: { location: 'optional topology.application', version: 1,
      services: [{ id: 'original-service', name: 'Declared identity only', kind: 'application-gateway or front-door',
        owner: 'optional original VNet/spoke owner', references: [], unsupportedFeatures: [] }],
      dnsProfiles: [{ id: 'original-profile', name: 'Declared identity only', kind: 'traffic-manager', references: [], unsupportedFeatures: [] }] },
    http: { version: 1, kind: 'http', serviceId: 'original-service', client: 'original workload tuple or explicit external public IPv4',
      scheme: 'http or https', host: 'app.example.test', port: 443, path: '/' },
    dns: { version: 1, kind: 'dns', profileId: 'original-profile', resolver: 'original workload tuple or explicit external public IPv4',
      name: 'app.example.test', evaluatedAt: '2026-11-16T00:00:00.000Z', cache: 'fresh' },
    evidence: 'application section: ordered typed decisions, original references, configuration outcome, uncertainty and permanently unverified availability.',
    boundary: 'No service provider/configuration authoring, DNS queries, probes, origin fetches, HTTP/TLS availability or application training grades. Unknown service configuration fields fail admission.',
  },
  handoff: 'Review the resulting native topology JSON, then import it through the web or desktop file UI. This server does not write files or modify an open UI.',
}))

server.registerTool('start_simulation', {
  description: 'Start an isolated bounded validation/simulation/evaluation job. Requirements must be explicit, uniquely identified and fully represented. Returns an expiring session-local handle, not a passing grade.',
  inputSchema: {
    request: z.object({
      contractVersion: z.union([z.literal(1), z.literal(2)]),
      engineVersion: z.string().optional(),
      operation: z.enum(['validate', 'simulate', 'evaluate', 'application']),
      document: z.object({ mode: z.enum(['vwan', 'hub-spoke', 'full']), topology: z.record(z.string(), z.unknown()) }).strict(),
      locale: z.enum(['en', 'ja']).optional(),
      requirements: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
      application: z.record(z.string(), z.unknown()).optional(),
      packet: z.object({
        source: z.record(z.string(), z.unknown()), target: z.record(z.string(), z.unknown()),
        protocol: z.enum(['tcp', 'udp']), sourcePort: z.number().int().min(1).max(65535), destinationPort: z.number().int().min(1).max(65535),
      }).strict().optional(),
      vpnPacket: z.object({
        connectionId: z.string().min(1).max(120), direction: z.enum(['ingress', 'egress']),
        tuple: z.object({ sourceAddress: z.string(), destinationAddress: z.string(), protocol: z.enum(['tcp', 'udp']),
          sourcePort: z.number().int().min(1).max(65535), destinationPort: z.number().int().min(1).max(65535) }).strict(),
      }).strict().optional(),
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
      sections: ['document', 'simulation', 'assessments', 'packet', 'vpnPacket', 'application'],
    } : {}),
  })
})

server.registerTool('get_evidence', {
  description: 'Retrieve bounded JSON-text chunks of a completed job section. Concatenate all chunks in offset order before parsing; a partial chunk is not complete evidence.',
  inputSchema: { handle: z.string().uuid(), section: z.enum(['document', 'simulation', 'assessments', 'packet', 'vpnPacket', 'application']), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(16000).default(8000) }, annotations,
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

server.registerTool('start_render', {
  description: 'Render one existing evaluated flow as a bounded GIF/SVG/PNG using its actual forward/return evidence. Local worker; no arbitrary HTML, URLs, paths or UI mutation.',
  inputSchema: {
    handle: z.string().uuid(), assessmentId: z.string().min(1).max(120),
    options: z.object({ format: z.enum(['gif', 'svg', 'png']).optional(), durationMs: z.union([z.literal(1500), z.literal(2000)]).optional(),
      width: z.number().int().min(640).max(1400).optional() }).strict().optional(),
  }, annotations,
}, async ({ handle, assessmentId, options }) => {
  const { result } = jobs.get(handle)
  if (!result) throw new Error('Simulation is still running.')
  return reply({ handle: renders.start(result, assessmentId, options), status: 'running', lifetimeSeconds: 600 })
})

server.registerTool('get_render_job', {
  description: 'Get render status and artifact metadata, SHA-256, source revision, per-leg logical nodes and limitations. Rendering does not change routing assessment outcomes.',
  inputSchema: { handle: z.string().uuid() }, annotations,
}, async ({ handle }) => reply(renders.describe(handle)))

server.registerTool('get_artifact', {
  description: 'Retrieve a finished artifact in bounded base64 byte chunks. Decode each chunk separately, concatenate bytes in offset order, then verify length and get_render_job SHA-256. No file writes.',
  inputSchema: { handle: z.string().uuid(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(12000).default(12000) }, annotations,
}, async ({ handle, offset, limit }) => reply(renders.artifact(handle, offset, limit)))

server.registerTool('cancel_render', {
  description: 'Cancel one local rendering job without changing its source simulation.',
  inputSchema: { handle: z.string().uuid() }, annotations,
}, async ({ handle }) => { await renders.cancel(handle); return reply({ handle, cancellationRequested: true }) })

server.registerTool('release_render', {
  description: 'Release one render artifact and its retained metadata after retrieval, or cancel and release an unfinished render. Does not write or delete filesystem files.',
  inputSchema: { handle: z.string().uuid() }, annotations,
}, async ({ handle }) => { await renders.release(handle); return reply({ handle, released: true }) })

const close = () => { renders.close(); jobs.close(); void server.close() }
process.once('SIGINT', close)
process.once('SIGTERM', close)
process.stdin.once('end', close)
void server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 4_100_000 })).catch(() => { jobs.close(); process.exitCode = 1 })
