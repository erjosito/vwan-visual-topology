import { publicIpv4, sameInventoryOwner } from './inventory'
import type { InventoryOwner, InventoryTopology, WorkloadIpReference } from './inventory'
import type { FiveTuple, WorkloadEndpoint } from './packet-flow'
import { applicationReferenceExists, fail, object, reference, text, validateApplicationInventory } from './application-inventory'
export { applicationLimits, applicationCapabilities, applicationReferenceKey, applicationReferenceExists, validateApplicationInventory } from './application-inventory'

export type ApplicationReference =
  | { kind: 'service'; id: string }
  | { kind: 'dns-profile'; id: string }
  | { kind: 'subnet'; owner: InventoryOwner; id: string }
  | ({ kind: 'workload' } & WorkloadIpReference)
  | { kind: 'public-ip'; id: string }
  | { kind: 'load-balancer-frontend' | 'load-balancer-pool'; loadBalancerId: string; id: string }
export interface ApplicationService {
  id: string
  name: string
  kind: 'application-gateway' | 'front-door'
  owner?: InventoryOwner
  references: ApplicationReference[]
  unsupportedFeatures: string[]
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
  | Decision<'listener-match', { serviceId: string; listenerId: string | null; ruleId: string | null; priority: number | null; scheme: 'http' | 'https'; host: string; port: number }>
  | Decision<'request-route', { serviceId: string; path: string; poolId: string | null; candidates: ApplicationReference[]; unsupportedFeatures: string[] }>
  | Decision<'network-leg', { leg: 'client-to-proxy' | 'proxy-to-backend'; source: ApplicationClient | ApplicationReference | null; target: ApplicationReference | null; before: (FiveTuple & { protocol: 'tcp' }) | null; after: (FiveTuple & { protocol: 'tcp' }) | null; packetEvidence: { section: 'packet'; direction: 'forward' | 'reply'; stepIndexes: number[] } | null }>
  | Decision<'response-assumption', { conditional: true; owner: ApplicationReference | null; httpAvailability: 'not-assessed'; tlsAvailability: 'not-assessed' }>
export interface ApplicationResult {
  version: 1
  kind: 'http' | 'dns'
  configuration: ApplicationOutcome
  availability: 'not-assessed'
  decisions: ApplicationDecision[]
  uncertainties: { decisionId: string; reasons: string[]; references: ApplicationReference[] }[]
  limitations: string[]
}
export const applicationDecisionLabels: Record<ApplicationDecision['kind'], string> = {
  'dns-selection': 'DNS selection',
  'listener-match': 'Listener match',
  'request-route': 'Request route',
  'network-leg': 'Network leg',
  'response-assumption': 'Response assumption',
}
export function normalizeApplicationHost(value: unknown): string {
  const host = text(value, 253).toLowerCase().replace(/\.$/, '')
  if (!host || host.split('.').some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    || /^\d+(?:\.\d+){3}$/.test(host)) return fail('explicit DNS hostname required; URLs, IP literals and wildcards are not request hosts')
  return host
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
  const entry = object(value, ['version', 'kind', 'serviceId', 'client', 'scheme', 'host', 'port', 'path', 'profileId', 'resolver', 'name', 'evaluatedAt', 'cache'])
  if (entry.version !== 1) fail('unsupported request version')
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
  return fail('separate HTTP or DNS operation required')
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
    }
  })) return 'not-assessed'
  if (new Set(decisions.map((entry) => entry.id)).size !== decisions.length) return 'not-assessed'
  if (kind === 'dns') return decisions.length === 1 && decisions[0].kind === 'dns-selection' ? 'satisfied' : 'not-assessed'
  if (!['listener-match', 'request-route', 'response-assumption'].every((kind) => decisions.some((entry) => entry.kind === kind))
    || !['client-to-proxy', 'proxy-to-backend'].every((leg) => decisions.some((entry) => entry.kind === 'network-leg' && entry.evidence.leg === leg))
    || decisions.some((entry) => entry.kind === 'dns-selection')) return 'not-assessed'
  return 'satisfied'
}
export const applicationUnavailable = 'No application or DNS service provider is enabled. Configuration and availability are not assessed.'
export const applicationOffline = 'Declared configuration only. No live DNS, health, HTTP, TLS or origin requests are performed.'

export function evaluateApplication(topology: InventoryTopology, input: ApplicationRequest): ApplicationResult {
  validateApplicationInventory(topology)
  const request = validateApplicationRequest(input)
  const source = request.kind === 'http' ? request.client : request.resolver
  if (source.kind === 'workload' && !applicationReferenceExists(topology, source)) fail('missing original client/resolver identity')
  const entry = request.kind === 'http' ? topology.application?.services.find((service) => service.id === request.serviceId)
    : topology.application?.dnsProfiles.find((profile) => profile.id === request.profileId)
  if (!entry) return fail('explicit original service/profile is missing')
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
