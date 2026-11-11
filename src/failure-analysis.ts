import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import { validateAzNetTopology } from './azure-net/model'
import type { DiagnosticIntent } from './diagnostics'
import { simulate } from './routing'
import { traceNodePath, type NodePath, type PathNode } from './paths'
import { simulateAzNet, traceAzNetPair } from './azure-net/engine'
import { azEndpointKey, getAzNetEndpoints } from './azure-net/endpoints'
import { cidr, contains, ipv4 } from './validation'
import { embeddedSpokeNvaSiteIds } from './topology-graph'
import { failureKey, projectAzFailures, projectVwanFailures, regionKey, type FailureDomain, type FailureProjection } from './failures'

export interface FailureEvidence {
  forward: string[]
  reverse: string[]
  working: boolean
  assessed: boolean
}
interface RequiredPair {
  id: string
  name: string
  endpointIds: string[]
  remediation: (fault: FailureDomain) => string
  trace: (active: unknown, simulation: unknown) => FailureEvidence
}
export interface ResilienceGap {
  id: string
  category: 'n-1-resilience-gap'
  scenarioId: string
  pairId: string
  name: string
  endpointIds: string[]
  fault: FailureDomain
  baseline: FailureEvidence
  failed: FailureEvidence
  remediation: string
}
export interface ResilienceEndpointExclusion {
  id: string
  category: 'failed-endpoint-exclusion'
  scenarioId: string
  pairId: string
  name: string
  fault: FailureDomain
  failedEndpointIds: string[]
  survivingEndpointIds: string[]
  baseline: FailureEvidence
}
export interface ResilienceReport {
  gaps: ResilienceGap[]
  endpointExclusions: ResilienceEndpointExclusion[]
  baselineFaults: number
  baselineUnknown: number
  baselineWorking: number
  baselineChecked: number
  totalPairs: number
  checkedScenarios: number
  totalScenarios: number
  checkedCases: number
  totalCases: number
  endpointUnavailable: number
  unknownCases: number
  complete: boolean
  limitations: string[]
}
export interface ResilienceBudget { maxCases?: number; maxMillis?: number; maxPairs?: number }
export interface ResilienceFinding {
  id: string
  category: ResilienceGap['category']
  scenarioId: string
  fault: FailureDomain
  endpointIds: string[]
  occurrences: ResilienceGap[]
}
export function groupResilienceGaps(gaps: ResilienceGap[]): ResilienceFinding[] {
  const groups = new Map<string, ResilienceFinding>()
  for (const gap of gaps) {
    const key = `${gap.category}:${gap.scenarioId}`
    let group = groups.get(key)
    if (!group) {
      group = {
        id: `resilience-root:${encodeURIComponent(key)}`, category: gap.category,
        scenarioId: gap.scenarioId, fault: gap.fault, endpointIds: [], occurrences: [],
      }
      groups.set(key, group)
    }
    group.occurrences.push(gap)
    group.endpointIds = [...new Set([...group.endpointIds, ...gap.endpointIds])]
  }
  return [...groups.values()]
}
export function resilienceMarkers(report?: ResilienceReport): Record<string, number> {
  const markers: Record<string, number> = {}
  for (const finding of groupResilienceGaps(report?.gaps ?? [])) for (const id of finding.endpointIds) markers[id] = (markers[id] ?? 0) + 1
  return markers
}
function independentPathGuidance(fault: FailureDomain, attachments: { name: string; region: string }[], locations: { id: string; name: string }[]): string {
  const surviving = attachments.filter((n) => regionKey(n.region) && (fault.kind !== 'region' || regionKey(n.region) !== fault.id))
  const targets = surviving.map((n) => `${n.name} (${n.region})`).join(', ') || 'none currently modeled; add an attachment in another assessed region'
  if (fault.kind === 'er-location') {
    const others = locations.filter((l) => l.id !== fault.id).map((l) => l.name)
    return `Independent ER locations in this topology: ${others.join(', ') || 'none; add another location or a usable VPN alternate'}. Verify both endpoint advertisements through the alternate; parallel circuits at ${fault.name} share this fault.`
  }
  return `${fault.kind === 'site' ? `Bypass transit site ${fault.name} with an independent attachment for the surviving endpoints.` : `Place alternate routing outside ${fault.name}; same-region gateways are not independent.`} Surviving Azure attachment candidates: ${targets}. Verify return advertisements and stateful UDR/inspection steering before relying on them.`
}

function evaluate<T>(baseline: T, pairs: RequiredPair[], project: (t: T, faults?: FailureDomain[]) => FailureProjection<T>, simulate: (t: T) => unknown, limitations: string[], budget: ResilienceBudget, totalPairs = pairs.length): ResilienceReport {
  const projection = project(baseline)
  const report: ResilienceReport = {
    gaps: [], endpointExclusions: [], baselineFaults: 0, baselineUnknown: 0, baselineWorking: 0, baselineChecked: 0, totalPairs,
    checkedScenarios: 0, totalScenarios: projection.domains.length, checkedCases: 0, totalCases: 0,
    endpointUnavailable: 0, unknownCases: 0, complete: false,
    limitations: [...limitations, ...projection.unassessed,
      'Representative address per declared prefix; exhaustive ECMP/hash selection, convergence timing, physical shared risks, firewall policy, NAT, platform recovery and application availability are not assessed.',
      'Endpoints inside a failed domain are unavailable, not routing-redundancy gaps. Replica/alternate service ownership and recovery are unassessed.'],
  }
  const deadline = Date.now() + (budget.maxMillis ?? 3000)
  const maxCases = budget.maxCases ?? 1200
  const baselineSimulation = simulate(baseline)
  const working: { pair: RequiredPair; evidence: FailureEvidence }[] = []
  for (const pair of pairs.slice(0, budget.maxPairs ?? 200)) {
    if (Date.now() >= deadline) break
    const evidence = pair.trace(baseline, baselineSimulation)
    report.baselineChecked++
    if (!evidence.assessed) report.baselineUnknown++
    else if (!evidence.working) report.baselineFaults++
    else working.push({ pair, evidence })
  }
  report.baselineWorking = working.length
  report.totalCases = working.length * projection.domains.length
  outer: for (const fault of projection.domains) {
    if (Date.now() >= deadline || report.checkedCases >= maxCases) break
    const failed = project(baseline, [fault])
    const scenarioId = failureKey(fault)
    let simulation: unknown
    for (const { pair, evidence } of working) {
      if (Date.now() >= deadline || report.checkedCases >= maxCases) break outer
      report.checkedCases++
      const caseId = `${encodeURIComponent(scenarioId)}:${encodeURIComponent(pair.id)}`
      const failedEndpointIds = [...new Set(pair.endpointIds.filter((id) => failed.affected[id]))]
      if (failedEndpointIds.length) {
        report.endpointUnavailable++
        report.endpointExclusions.push({
          id: `endpoint-exclusion:${caseId}`, category: 'failed-endpoint-exclusion', scenarioId,
          pairId: pair.id, name: pair.name, fault, failedEndpointIds,
          survivingEndpointIds: [...new Set(pair.endpointIds.filter((id) => !failed.affected[id]))],
          baseline: evidence,
        })
        continue
      }
      if (fault.kind === 'region' && projection.unassessed.length) { report.unknownCases++; continue }
      simulation ??= simulate(failed.active)
      const result = pair.trace(failed.active, simulation)
      if (!result.assessed) report.unknownCases++
      else if (!result.working) report.gaps.push({
        id: `resilience-gap:${caseId}`, category: 'n-1-resilience-gap', scenarioId,
        pairId: pair.id, name: pair.name, endpointIds: pair.endpointIds, fault,
        baseline: evidence, failed: result, remediation: pair.remediation(fault),
      })
    }
    report.checkedScenarios++
  }
  const bounded = report.baselineChecked < totalPairs || report.checkedScenarios < projection.domains.length
  if (projection.unassessed.length) report.limitations.push('Regional cases with surviving endpoints are conservatively unassessed while any Azure resource has missing/ambiguous region metadata; unknown regional transit/endpoint ownership must not create a false gap or pass.')
  if (bounded) report.limitations.push(`Computation limit reached (${budget.maxPairs ?? 200} baseline pairs, ${maxCases} failure/pair cases, ${budget.maxMillis ?? 3000} ms). Unchecked cases are not verified.`)
  report.complete = !bounded && !!working.length && !!projection.domains.length && !projection.unassessed.length &&
    !report.baselineUnknown && !report.unknownCases
  return report
}

function vwanEvidence(topology: Topology, simulation: ReturnType<typeof simulate>, source: PathNode, target: PathNode, sourceIp: string, destinationIp: string, requiredFirewall?: string): FailureEvidence {
  const forward = traceNodePath(topology, simulation, source, destinationIp)
  const reverse = traceNodePath(topology, simulation, target, sourceIp)
  const owned = (paths: NodePath[], node: PathNode) => !!paths.length && paths.every((p) => p.status === 'delivered' && p.siteId === node.id && p.terminalKind === node.kind)
  const inspection = (path: NodePath) => [...new Set(path.firewalls ?? [])].sort().join(',')
  const inspected = !requiredFirewall || [...forward, ...reverse].every((p) => p.firewalls?.includes(requiredFirewall))
  const ownerKnown = (ip: string, node: PathNode) => {
    const address = ipv4(ip)
    const owners = [...topology.spokes, ...topology.sites.filter((s) => !embeddedSpokeNvaSiteIds(topology).has(s.id))]
      .filter((n) => n.prefixes.some((p) => address !== undefined && contains(p, address)))
    return owners.length === 1 && owners[0].id === node.id
  }
  const assessed = simulation.converged && !!forward.length && !!reverse.length &&
    [...forward, ...reverse].every((p) => p.traceComplete !== false) && ownerKnown(sourceIp, source) && ownerKnown(destinationIp, target)
  const describe = (paths: NodePath[]) => paths.flatMap((p) => [`${p.status}; owner ${p.terminalKind ?? '?'}:${p.siteId ?? '?'}; inspection [${(p.firewalls ?? []).join(', ')}]`, ...p.steps])
  return {
    assessed, working: owned(forward, target) && owned(reverse, source) && inspected && forward.every((f) => reverse.every((r) => inspection(f) === inspection(r))),
    forward: describe(forward), reverse: describe(reverse),
  }
}

export function analyzeVwanResilience(topology: Topology, intents: DiagnosticIntent[] = [], budget: ResilienceBudget = {}): ResilienceReport {
  const embedded = embeddedSpokeNvaSiteIds(topology)
  const endpoints = [
    ...topology.spokes.map((n) => ({ node: { kind: 'spoke' as const, id: n.id }, name: n.name, prefixes: n.prefixes })),
    ...topology.sites.filter((s) => !embedded.has(s.id)).map((n) => ({ node: { kind: 'site' as const, id: n.id }, name: n.name, prefixes: n.prefixes })),
  ]
  const pairs: RequiredPair[] = []
  let totalPairs = 0
  const add = (source: PathNode, target: PathNode, sourceIp: string, destinationIp: string, name: string, requiredFirewall?: string) => {
    totalPairs++
    if (pairs.length >= (budget.maxPairs ?? 200)) return
    pairs.push({ id: `${source.kind}:${source.id}:${sourceIp}>${target.kind}:${target.id}:${destinationIp}`, name, endpointIds: [source.id, target.id],
      remediation: (fault) => independentPathGuidance(fault, topology.hubs, topology.erLocations ?? []),
      trace: (active, simulation) => vwanEvidence(active as Topology, simulation as ReturnType<typeof simulate>, source, target, sourceIp, destinationIp, requiredFirewall) })
  }
  if (intents.length) {
    for (const intent of intents.filter((i) => i.expectation === 'allow')) {
      add(intent.source, intent.target, intent.sourcePrefix.split('/')[0], intent.destinationPrefix.split('/')[0],
        `${endpoints.find((e) => e.node.id === intent.source.id)?.name ?? intent.source.id} ↔ ${endpoints.find((e) => e.node.id === intent.target.id)?.name ?? intent.target.id} (${intent.sourcePrefix} ↔ ${intent.destinationPrefix})`, intent.requiredFirewallHubId)
    }
  } else {
    for (let i = 0; i < endpoints.length; i++) for (const b of endpoints.slice(i + 1)) {
      const a = endpoints[i]
      for (const ap of a.prefixes.filter((p) => cidr(p))) for (const bp of b.prefixes.filter((p) => cidr(p))) {
        add(a.node, b.node, ap.split('/')[0], bp.split('/')[0], `${a.name} ↔ ${b.name} (${ap} ↔ ${bp})`)
      }
    }
  }
  return evaluate(topology, pairs, projectVwanFailures, simulate,
    [intents.length ? 'Only declared allow requirements checked; deny requirements excluded.' : 'No declared connectivity intent: full connectivity assumed among assigned workload VNets and distinct on-premises sites.',
      'Virtual WAN SD-WAN vendor ranking, own-AS/default-propagation parity and imported unobserved controls remain model limitations. Stateful firewall waypoint sets are compared in both directions.'], budget, totalPairs)
}

export function analyzeAzResilience(topology: AzNetTopology, budget: ResilienceBudget = {}): ResilienceReport {
  const endpoints = getAzNetEndpoints(topology).filter((e) => e.group === 'workload' || e.group === 'site')
  const pairs: RequiredPair[] = []
  let totalPairs = 0
  for (let i = 0; i < endpoints.length; i++) for (const b of endpoints.slice(i + 1)) {
    const a = endpoints[i]
    if (a.ref.kind === 'site' && b.ref.kind === 'site' && a.ref.siteId === b.ref.siteId) continue
    totalPairs++
    if (pairs.length >= (budget.maxPairs ?? 200)) continue
    const ids = [a, b].map((e) => e.ref.kind === 'subnet' ? e.ref.vnetId : e.ref.kind === 'site' ? e.ref.siteId : '')
    pairs.push({
      id: `${a.key}>${b.key}`, name: `${a.label} ↔ ${b.label}`, endpointIds: ids,
      remediation: (fault) => independentPathGuidance(fault, [...topology.vwanHubs, ...topology.vnets.filter((v) => v.gateways.some((g) => g.enabled))], topology.erLocations),
      trace: (active, simulation) => {
        const t = active as AzNetTopology
        const pair = traceAzNetPair(t, simulation as ReturnType<typeof simulateAzNet>, a.ref, a.defaultIp, b.ref, b.defaultIp)
        const validOwner = (endpoint: typeof a) => new Set(getAzNetEndpoints(t).filter((e) => e.group === 'site' || e.ref.kind === 'subnet')
          .filter((e) => contains(e.prefix, ipv4(endpoint.defaultIp)!)).map((e) => azEndpointKey(e.ref))).size === 1
        return {
          assessed: validOwner(a) && validOwner(b) &&
            ![pair.forward, pair.reverse].some((trace) => trace.summaryReason.startsWith('No complete forwarding path')),
          working: pair.forward.status === 'delivered' && pair.reverse.status === 'delivered' && pair.symmetricInspection,
          forward: [pair.forward.status, pair.forward.summaryReason, ...pair.forward.hops.map((h) => `${h.nodeName}: ${h.detail}`)],
          reverse: [pair.reverse.status, pair.reverse.summaryReason, ...pair.reverse.hops.map((h) => `${h.nodeName}: ${h.detail}`)],
        }
      },
    })
  }
  const report = evaluate(topology, pairs, projectAzFailures, simulateAzNet,
    ['No declared connectivity exclusions in this mode: full landscape connectivity assumed for workload subnets and distinct site prefixes. Intentional isolation is a baseline fault under this assumption, not an N-1 gap.',
      'Infrastructure-only subnets and Internet endpoints are excluded. Effective routes/UDRs and independently traced return paths are checked. Stateless path differences alone are not faults; modeled stateful inspection must be symmetric.'], budget, totalPairs)
  const errors = validateAzNetTopology(topology)
  if (errors.length) { report.complete = false; report.limitations.push(`Invalid baseline configuration: ${errors.join(' ')}`) }
  return report
}
