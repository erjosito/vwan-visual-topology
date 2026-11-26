import { publicIpv4, sameInventoryOwner } from './inventory'
import type { InventoryOwner, InventoryTopology, WorkloadIpReference } from './inventory'
import type { FiveTuple, PacketLeg, WorkloadEndpoint } from './packet-flow'
import type { NsgAssessment } from './packet-security'
import { evaluateTcpProxy } from './application-tcp'
import { evaluateFirewallProxy } from './application-firewall'
import { ipv4 } from './validation'
import { applicationReferenceExists, fail, normalizeApplicationHost, object, reference, text, validateApplicationInventory } from './application-inventory'
export { normalizeApplicationHost } from './application-inventory'
export { applicationLimits, applicationReferenceKey, applicationReferenceExists, validateApplicationInventory } from './application-inventory'
export { applicationCapabilities } from './application-capabilities'

export type ApplicationReference =
  | { kind: 'service'; id: string }
  | { kind: 'dns-profile'; id: string }
  | { kind: 'subnet'; owner: InventoryOwner; id: string }
  | { kind: 'appliance'; owner: InventoryOwner; id: string }
  | ({ kind: 'workload' } & WorkloadIpReference)
  | { kind: 'public-ip'; id: string }
  | { kind: 'load-balancer-frontend' | 'load-balancer-pool'; loadBalancerId: string; id: string }
export interface ApplicationService {
  id: string
  name: string
  kind: 'application-gateway' | 'front-door' | 'azure-firewall'
  owner?: InventoryOwner
  references: ApplicationReference[]
  unsupportedFeatures: string[]
  tcpProxy?: TcpProxyConfiguration
  firewallProxy?: FirewallProxyConfiguration
}
export interface FirewallProxyConfiguration {
  applianceId: string
  policyId: string
  sku: 'Standard' | 'Premium'
  configuration: 'complete' | 'unknown'
  parentPolicy: 'none' | 'unknown'
  dnat: 'none' | 'unknown'
  threatIntelligence: 'off' | 'unknown'
  idps: 'off' | 'unknown'
  tlsInspection: 'off' | 'unknown'
  provisioningState: 'succeeded' | 'unknown'
  explicitProxy: { enabled: boolean; httpPort: number }
  collections: ({
    id: string; groupId: string; groupPriority: number; priority: number; action: 'allow' | 'deny'
  } & ({
    type: 'network'
    rules: { id: string; sourcePrefixes: string[]; destinationPrefixes: string[]; destinationPorts: (number | '*')[]; protocol: 'tcp' | 'udp' | 'any' }[]
  } | {
    type: 'application'
    rules: { id: string; sourcePrefixes: string[]; targetFqdns: string[]; protocol: 'http' | 'https'; port: number }[]
  }))[]
  dnsBindings: { id: string; host: string; backend: WorkloadIpReference }[]
}
export interface TcpProxyConfiguration {
  sku: 'Standard_v2' | 'WAF_v2'
  subnetId: string
  frontendAddress?: string
  instanceAddress?: string
  listenerId: string
  ruleId: string
  rulePriority: number
  poolId: string
  frontendPort: number
  backendPort: number
  backend: WorkloadIpReference
  declaredHealth: 'healthy' | 'unhealthy' | 'unknown'
  provisioningState: 'succeeded' | 'unknown'
  proxyProtocol: boolean
}
export interface ApplicationDnsProfile {
  id: string
  name: string
  kind: 'traffic-manager'
  references: ApplicationReference[]
  unsupportedFeatures: string[]
}
export interface ApplicationInventory {
  version: 1
  services: ApplicationService[]
  dnsProfiles: ApplicationDnsProfile[]
}
export type ApplicationClient = WorkloadEndpoint | { kind: 'external'; address: string }
export type ApplicationRequest =
  | { version: 1; kind: 'http'; serviceId: string; client: ApplicationClient; scheme: 'http' | 'https'; host: string; port: number; path: string }
  | { version: 1; kind: 'tcp'; serviceId: string; client: ApplicationClient; sourcePort: number; port: number }
  | { version: 1; kind: 'firewall-proxy'; serviceId: string; client: ApplicationClient; mode: 'explicit' | 'transparent';
      sourcePort: number; proxyPort: number; scheme: 'http' | 'https'; host: string; port: number; destinationAddress?: string }
  | { version: 1; kind: 'dns'; profileId: string; resolver: ApplicationClient; name: string; evaluatedAt: string; cache: 'fresh' }
export type ApplicationOutcome = 'satisfied' | 'violated' | 'not-assessed'
type Decision<K extends string, E> = {
  id: string
  kind: K
  outcome: ApplicationOutcome
  reasons: string[]
  references: ApplicationReference[]
  provenance: 'declared-configuration' | 'native-packet-evidence' | 'unsupported-provider'
  evidence: E
}
export type ApplicationDecision =
  | Decision<'dns-selection', { profileId: string; method: string | null; candidates: { endpointId: string; name: string; enabled: boolean | 'unknown'; health: 'healthy' | 'unhealthy' | 'unknown' }[]; ttl: number | null; cache: 'fresh'; evaluatedAt: string }>
  | Decision<'listener-match', { serviceId: string; listenerId: string | null; ruleId: string | null; priority: number | null; scheme: 'http' | 'https' | 'tcp'; host: string | null; port: number }>
  | Decision<'request-route', { serviceId: string; path: string; poolId: string | null; candidates: ApplicationReference[]; unsupportedFeatures: string[] }>
  | Decision<'network-leg', { leg: 'client-to-proxy' | 'proxy-to-backend'; source: ApplicationClient | ApplicationReference | null; target: ApplicationReference | null; before: (FiveTuple & { protocol: 'tcp' }) | null; after: (FiveTuple & { protocol: 'tcp' }) | null; packetEvidence: { section: 'packet'; direction: 'forward' | 'reply'; stepIndexes: number[] } | { section: 'application-connections'; connectionId: string } | null }>
  | Decision<'response-assumption', { conditional: true; owner: ApplicationReference | null; httpAvailability: 'not-assessed'; tlsAvailability: 'not-assessed' }>
  | Decision<'firewall-policy', { applianceId: string | null; policyId: string | null; groupId: string | null; collectionId: string | null;
      ruleId: string | null; ruleType: 'network' | 'application' | null; action: 'allow' | 'deny' | null;
      mode: 'explicit' | 'transparent'; host: string; port: number; dnsBindingId: string | null; backend: ApplicationReference | null }>
export interface ApplicationResult {
  version: 1
  kind: ApplicationRequest['kind']
  configuration: ApplicationOutcome
  availability: 'not-assessed'
  decisions: ApplicationDecision[]
  uncertainties: { decisionId: string; reasons: string[]; references: ApplicationReference[] }[]
  limitations: string[]
  connections?: { id: 'client-to-proxy' | 'proxy-to-backend'; forward: PacketLeg; reply: PacketLeg; returnVariants?: PacketLeg[]; nsg: { forward: NsgAssessment; reply: NsgAssessment } }[]
}
export const applicationDecisionLabels: Record<ApplicationDecision['kind'], string> = {
  'dns-selection': 'DNS selection',
  'listener-match': 'Listener match',
  'request-route': 'Request route',
  'network-leg': 'Network leg',
  'response-assumption': 'Response assumption',
  'firewall-policy': 'Firewall proxy policy',
}
export function normalizeApplicationPath(value: unknown): string {
  const path = text(value, 2048)
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#\s]/.test(path) || /%(?![0-9a-f]{2})/i.test(path)) return fail('absolute request path without query, fragment or backslash required')
  // Reject ambiguous encoded separators/dot segments instead of guessing provider semantics.
  if (/%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path) || path.split('/').some((segment) => segment === '.' || segment === '..')) return fail('ambiguous path encoding or dot segment')
  return path.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase())
}
function client(value: unknown): ApplicationClient {
  const entry = object(value, ['kind', 'address', 'workloadId', 'nicId', 'ipConfigurationId'])
  if (entry.kind === 'external') {
    object(entry, ['kind', 'address'])
    if (typeof entry.address !== 'string' || !publicIpv4(entry.address)) fail('explicit external public IPv4 required')
  } else if (entry.kind === 'workload') reference(entry)
  else fail('original workload or explicit external client required')
  return entry as unknown as ApplicationClient
}
export function validateApplicationRequest(value: unknown): ApplicationRequest {
  const entry = object(value, ['version', 'kind', 'serviceId', 'client', 'scheme', 'host', 'port', 'path', 'profileId', 'resolver', 'name', 'evaluatedAt', 'cache', 'sourcePort', 'mode', 'proxyPort', 'destinationAddress'])
  if (entry.version !== 1) fail('unsupported request version')
  if (entry.kind === 'firewall-proxy') {
    object(entry, ['version', 'kind', 'serviceId', 'client', 'mode', 'sourcePort', 'proxyPort', 'scheme', 'host', 'port', 'destinationAddress'])
    if ((entry.mode !== 'explicit' && entry.mode !== 'transparent') || (entry.scheme !== 'http' && entry.scheme !== 'https')) return fail('explicit/transparent mode and HTTP/HTTPS scheme required')
    if ([entry.port, entry.sourcePort, entry.proxyPort].some((port) => typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) fail('proxy TCP ports 1-65535 required')
    if (entry.mode === 'transparent' ? typeof entry.destinationAddress !== 'string' || ipv4(entry.destinationAddress) === undefined : entry.destinationAddress !== undefined) fail('only transparent proxy requests require an original destination IPv4')
    return { version: 1, kind: 'firewall-proxy', serviceId: text(entry.serviceId), client: client(entry.client), mode: entry.mode,
      sourcePort: entry.sourcePort as number, proxyPort: entry.proxyPort as number, scheme: entry.scheme, host: normalizeApplicationHost(entry.host),
      port: entry.port as number, ...(typeof entry.destinationAddress === 'string' ? { destinationAddress: entry.destinationAddress } : {}) }
  }
  if (entry.kind === 'tcp') {
    object(entry, ['version', 'kind', 'serviceId', 'client', 'sourcePort', 'port'])
    const serviceId = text(entry.serviceId), source = client(entry.client)
    if ([entry.port, entry.sourcePort].some((port) => typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) fail('TCP ports 1-65535 required')
    return { version: 1, kind: 'tcp', serviceId, client: source, port: entry.port as number, sourcePort: entry.sourcePort as number }
  }
  if (entry.kind === 'http') {
    object(entry, ['version', 'kind', 'serviceId', 'client', 'scheme', 'host', 'port', 'path'])
    text(entry.serviceId); client(entry.client)
    if (!['http', 'https'].includes(entry.scheme as string) || !Number.isInteger(entry.port) || (entry.port as number) < 1 || (entry.port as number) > 65535) fail('HTTP(S) scheme and port 1-65535 required')
    return { ...entry, host: normalizeApplicationHost(entry.host), path: normalizeApplicationPath(entry.path) } as ApplicationRequest
  }
  if (entry.kind === 'dns') {
    object(entry, ['version', 'kind', 'profileId', 'resolver', 'name', 'evaluatedAt', 'cache'])
    text(entry.profileId); client(entry.resolver)
    if (entry.cache !== 'fresh' || typeof entry.evaluatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.evaluatedAt)
      || !Number.isFinite(Date.parse(entry.evaluatedAt)) || new Date(entry.evaluatedAt).toISOString() !== entry.evaluatedAt) fail('fresh resolver and explicit canonical UTC evaluation time required')
    return { ...entry, name: normalizeApplicationHost(entry.name) } as ApplicationRequest
  }
  return fail('separate TCP, Firewall proxy, HTTP or DNS operation required')
}
export function aggregateApplicationDecisions(kind: ApplicationRequest['kind'], decisions: readonly ApplicationDecision[]): ApplicationOutcome {
  if (decisions.some((entry) => entry.outcome === 'violated')) return 'violated'
  if (!decisions.length || decisions.some((entry) => entry.outcome !== 'satisfied')) return 'not-assessed'
  if (decisions.some((entry) => {
    switch (entry.kind) {
      case 'dns-selection': return entry.evidence.method === null || entry.evidence.ttl === null || !entry.evidence.candidates.length
        || entry.evidence.candidates.some((candidate) => candidate.enabled === 'unknown' || candidate.health === 'unknown')
      case 'listener-match': return entry.evidence.listenerId === null || entry.evidence.ruleId === null || entry.evidence.priority === null
      case 'request-route': return entry.evidence.poolId === null || !entry.evidence.candidates.length || !!entry.evidence.unsupportedFeatures.length
      case 'network-leg': return entry.evidence.source === null || entry.evidence.target === null || entry.evidence.before === null
        || entry.evidence.after === null || entry.evidence.packetEvidence === null
      case 'response-assumption': return false
      case 'firewall-policy': return entry.evidence.applianceId === null || entry.evidence.policyId === null || entry.evidence.groupId === null
        || entry.evidence.collectionId === null || entry.evidence.ruleId === null || entry.evidence.ruleType !== 'application'
        || entry.evidence.action !== 'allow' || entry.evidence.dnsBindingId === null || entry.evidence.backend === null
    }
  })) return 'not-assessed'
  if (new Set(decisions.map((entry) => entry.id)).size !== decisions.length) return 'not-assessed'
  if (kind === 'dns') return decisions.length === 1 && decisions[0].kind === 'dns-selection' ? 'satisfied' : 'not-assessed'
  if (kind === 'firewall-proxy') return ['firewall-policy', 'response-assumption'].every((kind) => decisions.some((entry) => entry.kind === kind))
    && ['client-to-proxy', 'proxy-to-backend'].every((leg) => decisions.some((entry) => entry.kind === 'network-leg' && entry.evidence.leg === leg))
    && decisions.every((entry) => ['firewall-policy', 'network-leg', 'response-assumption'].includes(entry.kind)) ? 'satisfied' : 'not-assessed'
  if (!['listener-match', 'request-route', 'response-assumption'].every((kind) => decisions.some((entry) => entry.kind === kind))
    || !['client-to-proxy', 'proxy-to-backend'].every((leg) => decisions.some((entry) => entry.kind === 'network-leg' && entry.evidence.leg === leg))
    || decisions.some((entry) => entry.kind === 'dns-selection')) return 'not-assessed'
  return 'satisfied'
}
export const applicationUnavailable = 'This application or DNS operation has no enabled provider. Configuration and availability are not assessed.'
export const applicationOffline = 'Declared configuration only. No live DNS, health, HTTP, TLS or origin requests are performed.'

export function evaluateApplication(topology: InventoryTopology, input: ApplicationRequest): ApplicationResult {
  validateApplicationInventory(topology)
  const request = validateApplicationRequest(input)
  const source = request.kind === 'dns' ? request.resolver : request.client
  if (source.kind === 'workload' && !applicationReferenceExists(topology, source)) fail('missing original client/resolver identity')
  const entry = request.kind === 'dns' ? topology.application?.dnsProfiles.find((profile) => profile.id === request.profileId)
    : topology.application?.services.find((service) => service.id === request.serviceId)
  if (!entry) return fail('explicit original service/profile is missing')
  if (request.kind === 'firewall-proxy' && entry.kind !== 'traffic-manager') {
    const result = evaluateFirewallProxy(topology, request, entry)
    result.configuration = aggregateApplicationDecisions(request.kind, result.decisions)
    result.limitations.unshift(applicationOffline)
    return result
  }
  if (request.kind === 'firewall-proxy') return fail('Firewall proxy requires an original application service')
  if (request.kind === 'tcp' && entry.kind !== 'traffic-manager') {
    const result = evaluateTcpProxy(topology, request, entry)
    result.configuration = aggregateApplicationDecisions('tcp', result.decisions)
    result.limitations.unshift(applicationOffline)
    return result
  }
  if (request.kind === 'tcp') return fail('TCP requires an original application service')
  const selected: ApplicationReference = { kind: request.kind === 'http' ? 'service' : 'dns-profile', id: entry.id }
  const references = [selected, ...entry.references, ...(source.kind === 'workload' ? [source] : [])]
  const base = { outcome: 'not-assessed' as const, reasons: [applicationUnavailable], references, provenance: 'unsupported-provider' as const }
  const decisions: ApplicationDecision[] = request.kind === 'dns' ? [{
    ...base, id: 'dns-selection', kind: 'dns-selection',
    evidence: { profileId: request.profileId, method: null, candidates: [], ttl: null, cache: request.cache, evaluatedAt: request.evaluatedAt },
  }] : [
    { ...base, id: 'listener-match', kind: 'listener-match', evidence: { serviceId: request.serviceId, listenerId: null, ruleId: null, priority: null, scheme: request.scheme, host: request.host, port: request.port } },
    { ...base, id: 'request-route', kind: 'request-route', evidence: { serviceId: request.serviceId, path: request.path, poolId: null, candidates: [], unsupportedFeatures: entry.unsupportedFeatures } },
    ...(['client-to-proxy', 'proxy-to-backend'] as const).map((leg): ApplicationDecision => ({
      ...base, id: leg, kind: 'network-leg', evidence: { leg, source: leg === 'client-to-proxy' ? request.client : selected, target: leg === 'client-to-proxy' ? selected : null, before: null, after: null, packetEvidence: null },
    })),
    { ...base, id: 'response-assumption', kind: 'response-assumption', evidence: { conditional: true, owner: selected, httpAvailability: 'not-assessed', tlsAvailability: 'not-assessed' } },
  ]
  return { version: 1, kind: request.kind, configuration: aggregateApplicationDecisions(request.kind, decisions), availability: 'not-assessed', decisions,
    uncertainties: decisions.filter((entry) => entry.outcome === 'not-assessed').map(({ id, reasons, references }) => ({ decisionId: id, reasons, references })),
    limitations: [applicationUnavailable, applicationOffline] }
}

export function applicationProjection(topology: InventoryTopology, scope: InventoryOwner, result?: ApplicationResult) {
  const references = (result?.decisions.flatMap((entry) => entry.references) ?? []).filter((ref) => applicationReferenceExists(topology, ref))
  const subnetIds = new Set<string>(), workloadIds = new Set<string>()
  for (const ref of references) {
    if (ref.kind === 'subnet' && sameInventoryOwner(scope, ref.owner)) subnetIds.add(ref.id)
    if (ref.kind === 'workload') {
      const nic = topology.inventory?.nics.find((nic) => nic.id === ref.nicId)
      if (nic && sameInventoryOwner(nic.owner, scope)) {
        workloadIds.add(ref.workloadId)
        const config = nic.ipConfigurations.find((config) => config.id === ref.ipConfigurationId)
        if (config) subnetIds.add(config.subnetId)
      }
    }
  }
  return { subnetIds, workloadIds }
}
