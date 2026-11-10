import type { ObjectSelection, Topology } from './model'
import { t } from './i18n'
import type { Simulation } from './routing'
import { advertiseSiteRoutes, applyRouteMapRules, receiveSiteRoutes, routerMapRules } from './bgp'
import { simulate } from './routing'
import type { NodePath, PathNode } from './paths'
import { azureRoutesAtSites, traceNodePath } from './paths'
import { cidr, contains, ipv4 } from './validation'
import { singleLinkIsolation } from './resilience'
import type { LinkIsolation } from './resilience'

export type DiagnosticIntent = {
  id: string
  source: PathNode
  target: PathNode
  sourcePrefix: string
  destinationPrefix: string
  expectation: 'allow' | 'deny'
  requiredFirewallHubId?: string
}
export type ExportConstraint = {
  id: string
  router: { kind: 'hub' | 'site'; id: string }
  connectionId: string
  direction: 'inbound' | 'outbound'
  prefix: string
  expectation: 'present' | 'absent'
}
export type DiagnosticsProfile = {
  version: 1
  intents: DiagnosticIntent[]
  failureAnalysis: boolean
  exportConstraints?: ExportConstraint[]
}
export interface DiagnosticsFinding {
  isolation?: LinkIsolation
  id: string
  rule: string
  severity: 'error' | 'warning' | 'info' | 'unknown'
  confidence: 'modeled' | 'risk' | 'unknown'
  title: string
  detail: string
  source?: PathNode
  target?: PathNode
  sourceAddress?: string
  destinationAddress?: string
  prefix?: string
  related: ObjectSelection[]
  forward: NodePath[]
  reverse: NodePath[]
  evidence: { code: string; nodeId?: string; prefix?: string; connectionId?: string }[]
}
export interface DiagnosticsReport {
  budget?: { maxProbes: number; maxCells: number; maxFindings: number; maxFailureCases: number; maxMillis: number }
  limitsReached?: string[]
  revision: string
  findings: DiagnosticsFinding[]
  probes: number
  cells: number
  failureCases: number
  complete: boolean
  limitations: string[]
}
export interface DiagnosticsOptions {
  automatic?: boolean
  maxProbes?: number
  maxCells?: number
  maxFindings?: number
  maxFailureCases?: number
  maxMillis?: number
}

const messages = {
  reachable: ['Required flow is modeled reachable', 'Every selected branch reaches the declared owner in both directions. No traffic hash or application success is predicted.'],
  denied: ['Intentional routing isolation', 'No selected forward branch reaches the declared destination. This is a routing result, not a firewall policy test.'],
  'deny-violation': ['Forbidden flow is modeled reachable', 'At least one selected forward branch reaches the declared destination despite the deny intent.'],
  unreachable: ['Required destination is unreachable', 'No selected forward branch reaches the declared destination owner.'],
  'missing-return': ['Missing return reachability', 'Forward delivery exists, but no selected return branch reaches the declared source owner.'],
  'partial-ecmp': ['Partial selected-path failure', 'Some selected branches reach the declared owner and others fail. Per-flow hash selection is not predicted.'],
  loop: ['Modeled forwarding loop', 'A selected forwarding branch revisits a modeled router. AS-loop prevention alone is not a forwarding loop.'],
  'summary-hole': ['Aggregate forwarding gap', 'A selected aggregate has no known contributing route for this address cell.'],
  'wrong-exit': ['Wrong destination exit', 'A selected branch terminates at the Internet or a different owner instead of the declared endpoint.'],
  asymmetric: ['Asymmetric physical path sets', 'Forward physical paths and reversed return paths differ. Asymmetry alone is not a demonstrated fault; ECMP hash pairing is unknown.'],
  firewall: ['Required inspection waypoint is bypassed', 'A selected branch does not traverse the required modeled firewall. Firewall rules, NAT and session enforcement are not modeled.'],
  ownership: ['Duplicate or overlapping IP ranges', 'Distinct sites or VNets declare overlapping IP ranges. This makes destination ownership ambiguous, but does not prove duplicate addresses on live hosts. Repeated BGP advertisements alone are not duplicate addressing.'],
  unknown: ['Routing result is not fully assessed', 'Missing ownership, unsupported model behavior, nonconvergence or truncated coverage prevents a definitive intent assessment.'],
  export: ['Route advertisement constraint violated', 'The scoped after-policy advertisement differs from the declared constraint. Before-policy evidence distinguishes filtering and summarization.'],
  'export-ok': ['Route advertisement constraint satisfied', 'The scoped after-policy advertisement matches the declared constraint. This is not proof of neighbor acceptance.'],
  failure: ['Single-link dependency', 'Removing this enabled modeled link breaks a previously satisfied required flow. Endpoint attachment loss is included; independent physical failure domains and recovery timing are not modeled.'],
  'link-isolation': ['Single point of failure', 'Removing this enabled logical link separates a currently connected topology component. This is a structural resilience risk, not a current outage. Alternate routing, convergence and shared physical failure domains are not validated.'],
  'failure-unknown': ['Single-link scenario not fully assessed', 'The cloned failure scenario has unsupported or incomplete coverage. No resilience conclusion is established.'],
  'network-unreachable': ['Unreachable network', 'No selected path reaches this network from the other endpoint. This may be intentional isolation; add a flow requirement to declare the expected behavior.'],
  'network-return': ['Missing return route', 'Forward delivery exists, but no selected return path reaches the source network.'],
  'unowned-advertisement': ['Advertised networks have no declared owner', 'These advertisements or VPN static routes cannot be verified end to end because their destination networks are not assigned to a site or VNet. An advertisement alone does not establish ownership.'],
} as const
const limits = {
  budget: 'Analysis budget reached; some declared cases were not assessed.',
  ownership: 'Declared endpoint ownership is missing, ambiguous or does not contain the tested address.',
  convergence: 'Routing or combined site learning did not converge; reachability assertions are disabled.',
  selection: 'Site route selection exceeded 32 equal paths; branch coverage is incomplete.',
  trace: 'Flow tracing exceeded 128 branches; branch coverage is incomplete.',
  sdwan: 'SD-WAN outbound learning and vendor-specific NVA ranking are not validated.',
  erDefault: 'ExpressRoute default propagation controls and legacy/physical ER default parity are not modeled.',
  ownAs: 'Hub own-AS rejection and advertised AS-path input assumptions are not validated.',
  imported: 'Imported topology reports coverage limitations; unobserved controls are not proven by this model.',
  policy: 'The requested router, neighbor or route-policy stage is unavailable or unsupported.',
  inspection: 'The required firewall hub does not exist in this topology.',
  endpoints: 'No network pairs could be checked. Add assigned networks to at least two endpoints.',
} as const
const profileError = 'Invalid diagnostics profile.'
const budgetError = 'Invalid diagnostics budget.'
export const diagnosticMessages: string[] = [...new Set([...Object.values(messages).flat(), ...Object.values(limits), profileError, budgetError])]

export interface UnsupportedCapabilityGroup {
  code: string
  limitation: string
  findings: DiagnosticsFinding[]
}

export interface CoverageSummary {
  scanIncomplete: boolean
  scanLimitations: string[]
  noCheckablePairs: boolean
  unassignedFindings: DiagnosticsFinding[]
  unassignedPrefixes: string[]
  unsupportedGroups: UnsupportedCapabilityGroup[]
  unsupportedFlowCount: number
  otherUnknownFindings: DiagnosticsFinding[]
  hasNotes: boolean
}

export function summarizeCoverage(report: DiagnosticsReport): CoverageSummary {
  const modelLimitKeys = new Set(['sdwan', 'erDefault', 'ownAs', 'imported'])
  const scanLimitMessages = new Set<string>([
    limits.budget,
    limits.convergence,
    limits.selection,
    limits.trace,
    limits.inspection,
    limits.policy,
    'Saved requirements could not be read. Automatic checks ran without them.',
  ])
  const unassignedFindings = report.findings.filter((finding) => finding.rule === 'unowned-advertisement')
  const unassignedPrefixes = [...new Set(unassignedFindings.flatMap((finding) =>
    finding.evidence.flatMap((item) => item.code === 'unowned-advertisement' && item.prefix ? [item.prefix] : []),
  ))]
  const groups = new Map<string, UnsupportedCapabilityGroup>()
  const unsupportedFindingIds = new Set<string>()
  for (const finding of report.findings) {
    if (finding.rule !== 'unknown' && finding.rule !== 'failure-unknown') continue
    const codes = finding.evidence
      .filter((item) => item.code.startsWith('limitation:'))
      .map((item) => item.code.slice('limitation:'.length))
      .filter((code) => modelLimitKeys.has(code))
    if (!codes.length) continue
    unsupportedFindingIds.add(finding.id)
    for (const code of codes) {
      const limitation = limits[code as keyof typeof limits] ?? finding.detail
      const existing = groups.get(code)
      if (existing) existing.findings.push(finding)
      else groups.set(code, { code, limitation, findings: [finding] })
    }
  }
  const unsupportedGroups = [...groups.values()]
  const otherUnknownFindings = report.findings.filter((finding) =>
    finding.severity === 'unknown' && finding.rule !== 'unowned-advertisement' && !unsupportedFindingIds.has(finding.id),
  )
  const noCheckablePairs = report.limitations.includes(limits.endpoints)
  const scanLimitations = report.limitations.filter((limitation) => scanLimitMessages.has(limitation))
  const scanIncomplete = (report.limitsReached?.length ?? 0) > 0 || scanLimitations.length > 0 || otherUnknownFindings.length > 0
  const hasNotes = scanIncomplete || noCheckablePairs || unassignedFindings.length > 0 || unsupportedGroups.length > 0 || report.limitations.length > 0
  return {
    scanIncomplete,
    scanLimitations,
    noCheckablePairs,
    unassignedFindings,
    unassignedPrefixes,
    unsupportedGroups,
    unsupportedFlowCount: unsupportedFindingIds.size,
    otherUnknownFindings,
    hasNotes,
  }
}

/** Profiles are a separate, bounded input contract, never a topology mutation. */
export function validateDiagnosticsProfile(input: unknown): DiagnosticsProfile {
  const fail = (): never => { throw new Error(profileError) }
  const object = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
    const result = value as Record<string, unknown>
    if (Object.keys(result).some((key) => !keys.includes(key))) return fail()
    return result
  }
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 120 || [...value].some((char) => char.charCodeAt(0) < 32)) return fail()
    return value
  }
  const range = (value: unknown): string => {
    const result = text(value)
    if (!cidr(result) && ipv4(result) === undefined) return fail()
    return result
  }
  const array = (value: unknown): unknown[] => {
    if (!Array.isArray(value) || value.length > 100) return fail()
    return value
  }
  const node = (value: unknown, kinds: string[]): PathNode => {
    const result = object(value, ['kind', 'id'])
    if (!kinds.includes(result.kind as string)) return fail()
    return { kind: result.kind as PathNode['kind'], id: text(result.id) }
  }
  const ids = new Set<string>()
  const id = (value: unknown) => {
    const result = text(value)
    if (ids.has(result)) return fail()
    ids.add(result)
    return result
  }
  const root = object(input, ['version', 'intents', 'failureAnalysis', 'exportConstraints'])
  if (root.version !== 1 || typeof root.failureAnalysis !== 'boolean') return fail()
  const intents = array(root.intents).map((value): DiagnosticIntent => {
    const entry = object(value, ['id', 'source', 'target', 'sourcePrefix', 'destinationPrefix', 'expectation', 'requiredFirewallHubId'])
    if (entry.expectation !== 'allow' && entry.expectation !== 'deny') return fail()
    return {
      id: id(entry.id), source: node(entry.source, ['hub', 'site', 'spoke']), target: node(entry.target, ['hub', 'site', 'spoke']),
      sourcePrefix: range(entry.sourcePrefix), destinationPrefix: range(entry.destinationPrefix), expectation: entry.expectation,
      ...(entry.requiredFirewallHubId === undefined ? {} : { requiredFirewallHubId: text(entry.requiredFirewallHubId) }),
    }
  })
  const exportConstraints = root.exportConstraints === undefined ? undefined : array(root.exportConstraints).map((value): ExportConstraint => {
    const entry = object(value, ['id', 'router', 'connectionId', 'direction', 'prefix', 'expectation'])
    if ((entry.direction !== 'inbound' && entry.direction !== 'outbound') || (entry.expectation !== 'present' && entry.expectation !== 'absent')) return fail()
    const router = node(entry.router, ['hub', 'site']) as ExportConstraint['router']
    const prefix = text(entry.prefix)
    if (!cidr(prefix)) return fail()
    return { id: id(entry.id), router, connectionId: text(entry.connectionId), direction: entry.direction, prefix, expectation: entry.expectation }
  })
  return { version: 1, intents, failureAnalysis: root.failureAnalysis, ...(exportConstraints ? { exportConstraints } : {}) }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value)
}
function hash(value: string): string {
  let a = 2166136261
  let b = 5381
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i) }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}
export function routingRevision(topology: Topology): string {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['name', 'label', 'layout', 'region'].includes(key)).map(([key, child]) => [key, clean(child)]))
    return value
  }
  const { azureImport, ...routing } = topology
  return hash(stable(clean({ ...routing, azureImport: azureImport && { warnings: azureImport.warnings, hubs: azureImport.hubs.map((hub) => ({ hubId: hub.hubId, addressPrefix: hub.addressPrefix, limitations: hub.limitations })) } })))
}

const addressText = (address: number) => [24, 16, 8, 0].map((shift) => Math.floor(address / 2 ** shift) % 256).join('.')
const addressRange = (prefix: string) => {
  const parsed = cidr(prefix)
  const start = parsed?.network ?? ipv4(prefix)!
  return { start, end: start + (parsed ? 2 ** (32 - parsed.length) : 1) }
}
interface Cell { address: string; prefix: string }
function partition(prefix: string, boundaries: number[], maximum: number): Cell[] {
  const { start, end } = addressRange(prefix)
  const cuts = [start, ...boundaries.filter((point) => point > start && point < end), end]
  const cells: Cell[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    let point = cuts[i]
    while (point < cuts[i + 1]) {
      let bits = 0
      while (bits < 32 && point % 2 ** (bits + 1) === 0 && point + 2 ** (bits + 1) <= cuts[i + 1]) bits++
      cells.push({ address: addressText(point), prefix: `${addressText(point)}/${32 - bits}` })
      if (cells.length >= maximum) return cells
      point += 2 ** bits
    }
  }
  return cells
}

/** Ordered physical tokens retain parallel links, both ER legs, and firewall placement. */
function physical(path: NodePath, source: PathNode): string[] {
  const tokens: string[] = [`${source.kind}:${source.id}`]
  const siteWalk = (nodes: string[] = [], links: string[] = []) => {
    nodes.forEach((id, index) => {
      const token = `site:${id}`
      if (tokens.at(-1) !== token) tokens.push(token)
      if (links[index]) tokens.push(`siteLink:${links[index]}`)
    })
  }
  siteWalk(path.sourceSiteHops, path.sourceSiteLinkIds)
  if (path.sourceErLinkIds?.length) tokens.push(...path.sourceErLinkIds.map((id) => `erLink:${id}`))
  else if (path.sourceConnectionId) tokens.push(`connection:${path.sourceConnectionId}`)
  if (path.sourceNvaSpokeId && path.sourceConnectionId) tokens.push(`spoke:${path.sourceNvaSpokeId}`)
  path.hubs.forEach((id) => {
    const token = path.firewalls?.includes(id) ? `hub-firewall:${id}` : `hub:${id}`
    if (tokens.at(-1) === `hub:${id}` && token !== `hub:${id}`) tokens.pop()
    if (tokens.at(-1) !== token) tokens.push(token)
  })
  if (path.nvaSpokeId && path.connectionId) tokens.push(`spoke:${path.nvaSpokeId}`)
  if (path.erLinkIds?.length) tokens.push(...path.erLinkIds.map((id) => `erLink:${id}`))
  else if (path.connectionId && (path.terminalKind !== 'spoke' || path.nvaSpokeId)) tokens.push(`connection:${path.connectionId}`)
  siteWalk(path.siteHops, path.siteLinkIds)
  if (path.siteId && path.terminalKind) {
    const token = `${path.terminalKind}:${path.siteId}`
    if (tokens.at(-1) !== token) tokens.push(token)
  } else if (path.termination === 'internet') tokens.push('internet')
  return tokens
}
function pathObjects(paths: NodePath[]): ObjectSelection[] {
  return paths.flatMap((path) => [
    ...path.hubs.map((id) => ({ kind: 'hub' as const, id })),
    ...[...(path.sourceSiteHops ?? []), ...(path.siteHops ?? [])].map((id) => ({ kind: 'site' as const, id })),
    ...[...(path.sourceSiteLinkIds ?? []), ...(path.siteLinkIds ?? [])].map((id) => ({ kind: 'siteLink' as const, id })),
    ...[...(path.sourceErLinkIds ?? []), ...(path.erLinkIds ?? [])].map((id) => ({ kind: 'erLink' as const, id })),
    ...(path.sourceSpokeId ? [{ kind: 'spoke' as const, id: path.sourceSpokeId }] : []),
    ...[path.sourceNvaSpokeId, path.nvaSpokeId].filter((id): id is string => !!id).map((id) => ({ kind: 'spoke' as const, id })),
    ...(path.sourceConnectionId && !path.sourceErLinkIds ? [{ kind: 'connection' as const, id: path.sourceConnectionId }] : []),
    ...(path.connectionId && !path.erLinkIds ? [{ kind: path.terminalKind === 'spoke' && !path.nvaSpokeId ? 'spoke' as const : 'connection' as const, id: path.connectionId }] : []),
  ])
}

interface Scenario {
  topology: Topology
  simulation: Simulation
  learned: ReturnType<typeof azureRoutesAtSites>
  boundaries: number[]
  limitations: string[]
  hasOwnAs: boolean
  ownerRanges: { node: PathNode; start: number; end: number }[]
  cache: Map<string, NodePath[]>
  limitsCache: Map<string, string[]>
  ownersCache: Map<string, PathNode[]>
}
function scenario(topology: Topology): Scenario {
  const simulation = simulate(topology)
  const learned = azureRoutesAtSites(topology, simulation)
  const boundaries = new Set<number>()
  const prefix = (value: string) => {
    if (!cidr(value)) return
    const range = addressRange(value)
    boundaries.add(range.start); boundaries.add(range.end)
  }
  const routes = (items: { prefix: string; forwardingRoutes?: typeof items }[]) => {
    for (const route of items) { prefix(route.prefix); if (route.forwardingRoutes) routes(route.forwardingRoutes) }
  }
  for (const node of [...topology.spokes, ...topology.sites]) node.prefixes.forEach(prefix)
  for (const site of topology.sites) site.vpnStaticRoutes?.forEach((route) => prefix(route.prefix))
  for (const map of topology.routeMaps ?? []) for (const rule of map.rules) [...rule.prefixes, ...rule.summaryPrefixes].forEach(prefix)
  for (const connection of topology.connections) for (const rule of [...connection.inbound, ...connection.outbound]) rule.prefixes.forEach(prefix)
  for (const table of [...Object.values(simulation.tables), ...Object.values(simulation.firewallTables), ...Object.values(simulation.bgpTables)]) {
    for (const decision of table) routes(decision.candidates)
  }
  for (const table of [...Object.values(simulation.siteCandidates), ...Object.values(learned.candidates)]) routes(table)
  const limitations: string[] = []
  if (!simulation.converged || !learned.converged) limitations.push(limits.convergence)
  if (simulation.siteSelectionComplete === false || !learned.selectionComplete) limitations.push(limits.selection)
  if (topology.azureImport && (topology.azureImport.warnings.length || topology.azureImport.hubs.some((hub) => hub.limitations.length))) limitations.push(limits.imported)
  const ownAs = (asPath: number[]) => asPath.includes(65515) || asPath.includes(65520)
  const hasOwnAs =
    topology.sites.some((site) => [65515, 65520].includes(site.asn)) ||
    Object.values(simulation.bgpTables).some((table) => table.some((d) => d.candidates.some((r) => !r.remote && ownAs(r.asPath))))
  const ownerRanges = [
    ...topology.spokes.flatMap((node) => node.prefixes.map((p) => ({ node: { kind: 'spoke' as const, id: node.id }, ...addressRange(p) }))),
    ...topology.sites.flatMap((node) => node.prefixes.map((p) => ({ node: { kind: 'site' as const, id: node.id }, ...addressRange(p) }))),
  ]
  return { topology, simulation, learned, boundaries: [...boundaries].sort((a, b) => a - b), limitations, hasOwnAs, ownerRanges, cache: new Map(), limitsCache: new Map(), ownersCache: new Map() }
}
function owners(state: Scenario, address: string): PathNode[] {
  const n = ipv4(address)!
  const seen = new Set<string>()
  const result: PathNode[] = []
  for (const entry of state.ownerRanges) {
    if (n >= entry.start && n < entry.end) {
      const key = `${entry.node.kind}:${entry.node.id}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(entry.node)
      }
    }
  }
  return result
}
const same = (a: PathNode, b: PathNode) => a.kind === b.kind && a.id === b.id
function owned(state: Scenario, node: PathNode, address: string) {
  const found = state.ownersCache.get(address) ?? owners(state, address)
  state.ownersCache.set(address, found)
  return found.length === 1 && same(found[0], node)
}
const delivered = (path: NodePath, target: PathNode) => path.status === 'delivered' && path.termination === 'owner' && path.terminalKind === target.kind && path.siteId === target.id

function modelLimits(state: Scenario, source: PathNode, destination: string, paths: NodePath[]): string[] {
  const key = `${source.kind}:${source.id}:${destination}`
  const cached = state.limitsCache.get(key)
  if (cached) return cached
  const { topology, simulation } = state
  const address = ipv4(destination)!
  const reasons: string[] = []
  const hubIds = [...new Set(paths.flatMap((path) => path.hubs))]
  for (const id of hubIds) {
    for (const table of [simulation.bgpTables[id], simulation.tables[id], simulation.firewallTables[id]]) {
      const decision = table?.filter((d) => contains(d.prefix, address)).sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
      if ((decision?.candidates.length ?? 0) > 1 && decision?.candidates.some((route) => route.transport === 'SDWAN')) reasons.push(limits.sdwan)
      if (decision?.candidates.some((route) => !route.remote && route.kind === 'bgp' && (route.asPath.includes(65515) || route.asPath.includes(65520)))) reasons.push(limits.ownAs)
      if (decision?.prefix === '0.0.0.0/0' && decision.selected.some((route) => route.transport === 'ExpressRoute')) reasons.push(limits.erDefault)
    }
  }
  if (source.kind === 'site') {
    const matches = (state.learned.tables[source.id] ?? []).filter((route) => contains(route.prefix, address))
    const length = Math.max(...matches.map((route) => cidr(route.prefix)!.length))
    const er = (id: string) => topology.connections.some((c) => c.id === id && c.enabled && c.transport === 'ExpressRoute') ||
      topology.erLinks?.some((link) => link.id === id && link.enabled)
    if (length === 0 && matches.some((route) => er(route.connectionId))) reasons.push(limits.erDefault)
    if (paths.every((path) => path.termination === 'no-route')) {
      const reachable = new Set([source.id])
      for (let size = -1; size !== reachable.size;) {
        size = reachable.size
        for (const link of topology.siteLinks.filter((link) => link.enabled)) {
          if (reachable.has(link.a)) reachable.add(link.b)
          if (reachable.has(link.b)) reachable.add(link.a)
        }
      }
      for (const c of topology.connections.filter((conn) => conn.enabled && conn.transport === 'SDWAN' && reachable.has(conn.siteId))) {
        for (const table of [simulation.bgpTables[c.hubId], simulation.tables[c.hubId], simulation.firewallTables[c.hubId]]) {
          const decision = table?.filter((d) => contains(d.prefix, address)).sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
          if ((decision?.candidates.length ?? 0) > 1 && decision?.candidates.some((route) => route.transport === 'SDWAN')) reasons.push(limits.sdwan)
        }
      }
      const erAttached = topology.connections.some((c) => c.enabled && c.transport === 'ExpressRoute' && reachable.has(c.siteId)) ||
        topology.erLinks?.some((link) => link.enabled && link.siteId && reachable.has(link.siteId))
      if (erAttached && Object.values(simulation.bgpTables).some((table) => table.some((d) => d.prefix === '0.0.0.0/0'))) reasons.push(limits.erDefault)
    }
  }
  const ownAs = (asPath: number[]) => asPath.includes(65515) || asPath.includes(65520)
  if (state.hasOwnAs && (Object.values(simulation.bgpTables).some((table) => table.some((d) => contains(d.prefix, address) && d.candidates.some((r) => !r.remote && ownAs(r.asPath)))) ||
    topology.sites.some((site) => [65515, 65520].includes(site.asn) && (site.id === source.id || paths.some((path) => path.siteHops?.includes(site.id) || path.sourceSiteHops?.includes(site.id)) || site.prefixes.some((p) => contains(p, address)))))) reasons.push(limits.ownAs)
  state.limitsCache.set(key, reasons)
  return reasons
}

function coveringCidr(cells: Cell[]): Cell {
  const unique = [...new Map(cells.map((cell) => [cell.prefix, cell])).values()]
  if (unique.length === 1) return unique[0]
  const ranges = unique.map((item) => addressRange(item.prefix))
  const minStart = Math.min(...ranges.map((range) => range.start)) >>> 0
  const maxLast = Math.max(...ranges.map((range) => range.end - 1)) >>> 0
  const totalAddresses = ranges.reduce((sum, range) => sum + (range.end - range.start), 0)
  const diff = (minStart ^ maxLast) >>> 0
  const length = diff === 0 ? 32 : Math.clz32(diff)
  const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0
  const network = (minStart & mask) >>> 0
  const blockSize = length === 0 ? 0x100000000 : 2 ** (32 - length)
  if (network === minStart && totalAddresses === blockSize) {
    return { prefix: `${addressText(network)}/${length}`, address: addressText(network) }
  }
  return unique[0]
}
function topLevelPrefixes(prefixes: string[]): string[] {
  const unique = [...new Set(prefixes)]
  return unique.filter((prefix) => {
    const current = cidr(prefix)
    if (!current) return true
    return !unique.some((other) => {
      if (other === prefix) return false
      const candidate = cidr(other)
      return Boolean(candidate && candidate.length < current.length && contains(other, current.network))
    })
  })
}
function canonicalTopologyToken(token: string): string {
  return token.startsWith('hub-firewall:') ? `hub:${token.slice('hub-firewall:'.length)}` : token
}
const isNodeToken = (token: string) =>
  token.startsWith('site:') || token.startsWith('spoke:') || token.startsWith('hub:')
function divergenceBounds(finding: DiagnosticsFinding): {
  anchorKey: string
  leftAnchor: string
  rightAnchor: string
  forwardCore: string[]
  reverseCore: string[]
} | undefined {
  if (!finding.source || !finding.target) return undefined
  const forwardPaths = finding.forward
    .filter((path) => delivered(path, finding.target!))
    .map((path) => physical(path, finding.source!).map(canonicalTopologyToken))
  const reversePaths = finding.reverse
    .filter((path) => delivered(path, finding.source!))
    .map((path) => physical(path, finding.target!).reverse().map(canonicalTopologyToken))
  const all = [...forwardPaths, ...reversePaths]
  if (!forwardPaths.length || !reversePaths.length) return undefined
  const minLen = Math.min(...all.map((tokens) => tokens.length))
  let prefixLen = 0
  while (prefixLen < minLen && all.every((tokens) => tokens[prefixLen] === all[0][prefixLen])) prefixLen++
  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    all.every((tokens) => tokens[tokens.length - 1 - suffixLen] === all[0][all[0].length - 1 - suffixLen])
  ) {
    suffixLen++
  }
  let leftIdx = Math.max(0, prefixLen - 1)
  while (leftIdx > 0 && !isNodeToken(all[0][leftIdx])) leftIdx--
  const leftAnchor = all[0][leftIdx] ?? `${finding.source.kind}:${finding.source.id}`
  let rightOffset = Math.max(1, suffixLen)
  while (rightOffset < all[0].length && !isNodeToken(all[0][all[0].length - rightOffset])) rightOffset++
  const rightAnchor =
    all[0][all[0].length - rightOffset] ?? `${finding.target.kind}:${finding.target.id}`
  const sliceCore = (tokens: string[]) =>
    tokens.slice(leftIdx, Math.max(leftIdx + 1, tokens.length - rightOffset + 1)).join('->')
  const forwardCore = [...new Set(forwardPaths.map(sliceCore))].sort()
  const reverseCore = [...new Set(reversePaths.map(sliceCore))].sort()
  const orderedAnchors = [leftAnchor, rightAnchor].sort()
  return {
    anchorKey: `${orderedAnchors[0]}<->${orderedAnchors[1]}`,
    leftAnchor,
    rightAnchor,
    forwardCore,
    reverseCore,
  }
}
function intermediateEndpoints(finding: DiagnosticsFinding): Set<string> {
  const endpoints = new Set<string>()
  const sourceKey = finding.source ? `${finding.source.kind}:${finding.source.id}` : ''
  const targetKey = finding.target ? `${finding.target.kind}:${finding.target.id}` : ''
  for (const path of [...finding.forward, ...finding.reverse]) {
    for (const siteId of [...(path.sourceSiteHops ?? []), ...(path.siteHops ?? [])]) {
      const key = `site:${siteId}`
      if (key !== sourceKey && key !== targetKey) endpoints.add(key)
    }
    for (const spokeId of [path.sourceNvaSpokeId, path.nvaSpokeId]) {
      if (!spokeId) continue
      const key = `spoke:${spokeId}`
      if (key !== sourceKey && key !== targetKey) endpoints.add(key)
    }
  }
  return endpoints
}
function suppressCascadingAutomaticFindings(findings: DiagnosticsFinding[]): DiagnosticsFinding[] {
  const flowRules = new Set<DiagnosticsFinding['rule']>([
    'asymmetric',
    'network-unreachable',
    'network-return',
    'loop',
    'summary-hole',
    'partial-ecmp',
    'firewall-bypass',
  ])
  const nonFlow = findings.filter((finding) => !flowRules.has(finding.rule) || !finding.source || !finding.target)
  const candidates = findings.filter((finding) => flowRules.has(finding.rule) && finding.source && finding.target)
  const complexity = (finding: DiagnosticsFinding) => {
    const transits = intermediateEndpoints(finding).size
    const paths = [...finding.forward, ...finding.reverse]
    const hubHops = paths.length ? Math.min(...finding.forward.map((p) => p.hubs.length || 0)) + Math.min(...(finding.reverse.length ? finding.reverse.map((p) => p.hubs.length || 0) : [0])) : 0
    const tokenLen = paths.reduce((sum, path) => sum + (path.hubs.length + (path.siteHops?.length ?? 0) + (path.sourceSiteHops?.length ?? 0)), 0)
    const spokeEndpointBonus = (finding.source?.kind === 'spoke' ? 0 : 1) + (finding.target?.kind === 'spoke' ? 0 : 1)
    return [transits, hubHops, spokeEndpointBonus, tokenLen] as const
  }
  const ordered = [...candidates].sort((a, b) => {
    const ca = complexity(a), cb = complexity(b)
    for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i]
    return a.id.localeCompare(b.id)
  })
  const kept: DiagnosticsFinding[] = []
  const seenAsymmetricAnchors = new Set<string>()
  const seenEndpointHubDivergences: { endpoint: string; hub: string; legs: Set<string> }[] = []
  const seenFailureKeys = new Set<string>()

  for (const finding of ordered) {
    const transits = intermediateEndpoints(finding)
    const transitCascade = [...transits].some((mid) =>
      kept.some((root) => {
        if (root.rule !== finding.rule || !root.source || !root.target) return false
        const rootEndpoints = [`${root.source.kind}:${root.source.id}`, `${root.target.kind}:${root.target.id}`]
        return rootEndpoints.includes(mid)
      }),
    )
    if (transitCascade) continue

    if (finding.rule === 'asymmetric') {
      const bounds = divergenceBounds(finding)
      if (bounds) {
        if (seenAsymmetricAnchors.has(bounds.anchorKey)) continue
        const allCoreTokens = [...bounds.forwardCore, ...bounds.reverseCore]
        const cascadedFromEndpointHub = seenEndpointHubDivergences.some((prior) => {
          if (bounds.leftAnchor !== prior.endpoint && bounds.rightAnchor !== prior.endpoint) return false
          return allCoreTokens.some((core) => core.includes(prior.hub)) &&
            allCoreTokens.every((core) => [...prior.legs].some((leg) => core.includes(leg)))
        })
        if (cascadedFromEndpointHub) continue
        seenAsymmetricAnchors.add(bounds.anchorKey)
        if (
          (bounds.leftAnchor.startsWith('site:') || bounds.leftAnchor.startsWith('spoke:')) &&
          bounds.rightAnchor.startsWith('hub:')
        ) {
          const extractFirstHop = (core: string) => core.split('->').slice(0, 3).join('->')
          seenEndpointHubDivergences.push({
            endpoint: bounds.leftAnchor,
            hub: bounds.rightAnchor,
            legs: new Set(allCoreTokens.map(extractFirstHop)),
          })
        } else if (
          (bounds.rightAnchor.startsWith('site:') || bounds.rightAnchor.startsWith('spoke:')) &&
          bounds.leftAnchor.startsWith('hub:')
        ) {
          const extractLastHop = (core: string) => core.split('->').slice(-3).join('->')
          seenEndpointHubDivergences.push({
            endpoint: bounds.rightAnchor,
            hub: bounds.leftAnchor,
            legs: new Set(allCoreTokens.map(extractLastHop)),
          })
        }
      }
      kept.push(finding)
      continue
    }

    if (
      finding.rule === 'network-unreachable' ||
      finding.rule === 'network-return' ||
      finding.rule === 'loop' ||
      finding.rule === 'summary-hole'
    ) {
      const failingForward = finding.rule !== 'network-return'
      const paths = failingForward ? finding.forward : finding.reverse
      const failedSource = failingForward ? finding.source! : finding.target!
      const failedTarget = failingForward ? finding.target! : finding.source!
      const failureSig = paths
        .map((path) => {
          const lastSpot = path.siteId ? `site:${path.siteId}` : path.hubs.length ? `hub:${path.hubs.at(-1)}` : `${failedSource.kind}:${failedSource.id}`
          const targetOwner = lastSpot === `${failedSource.kind}:${failedSource.id}` ? 'egress' : `${failedTarget.kind}:${failedTarget.id}`
          return `${finding.rule}:${lastSpot}:${path.termination ?? 'unknown'}:${path.lookupPrefix ?? targetOwner}`
        })
        .sort()
        .join('|')
      if (failureSig && seenFailureKeys.has(failureSig)) continue
      if (failureSig) seenFailureKeys.add(failureSig)
    }

    kept.push(finding)
  }

  return [...nonFlow, ...kept]
}

export function analyzeRouting(topology: Topology, input: DiagnosticsProfile, options: DiagnosticsOptions = {}): DiagnosticsReport {
  const profile = validateDiagnosticsProfile(input)
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error(budgetError)
  const defaults = { maxProbes: 4096, maxCells: 2048, maxFindings: 500, maxFailureCases: 24, maxMillis: 5000 }
  const ceilings = { maxProbes: 100000, maxCells: 50000, maxFindings: 10000, maxFailureCases: 240, maxMillis: 60000 }
  const budget = { ...defaults }
  for (const key of Object.keys(options)) {
    if (key === 'automatic') {
      if (options.automatic !== undefined && typeof options.automatic !== 'boolean') throw new Error(budgetError)
      continue
    }
    if (!Object.hasOwn(defaults, key)) throw new Error(budgetError)
    const value = options[key as keyof typeof defaults]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0 || value > ceilings[key as keyof typeof ceilings]) throw new Error(budgetError)
    budget[key as keyof typeof budget] = value
  }
  const started = Date.now()
  const report: DiagnosticsReport = { revision: routingRevision(topology), findings: [], probes: 0, cells: 0, failureCases: 0, complete: true, limitations: [], budget: { ...budget }, limitsReached: [] }
  const limited = (message: string) => {
    report.complete = false
    if (!report.limitations.includes(message)) report.limitations.push(message)
  }
  const time = () => Date.now() - started < budget.maxMillis
  const exhausted = (...keys: (keyof typeof budget)[]) => {
    limited(limits.budget)
    for (const key of keys) if (!report.limitsReached!.includes(key)) report.limitsReached!.push(key)
  }
  const room = () => {
    if (time() && report.cells < budget.maxCells && report.findings.length < budget.maxFindings) return true
    const reached = [
      ...(!time() ? ['maxMillis' as const] : []),
      ...(report.cells >= budget.maxCells ? ['maxCells' as const] : []),
      ...(report.findings.length >= budget.maxFindings ? ['maxFindings' as const] : []),
    ]
    if (reached.length) { exhausted(...reached); return false }
    return true
  }
  type Rule = keyof typeof messages
  const add = (rule: Rule, severity: DiagnosticsFinding['severity'], scope: string, fields: Partial<DiagnosticsFinding> = {}) => {
    if (report.findings.length >= budget.maxFindings) { exhausted('maxFindings'); return }
    const finding: DiagnosticsFinding = {
      id: `${rule}:${hash(scope)}`, rule, severity, confidence: severity === 'unknown' ? 'unknown' : severity === 'warning' ? 'risk' : 'modeled',
      title: messages[rule][0], detail: messages[rule][1], related: [], forward: [], reverse: [], evidence: [], ...fields,
    }
    finding.related = [...new Map(finding.related.map((object) => [`${object.kind}:${object.id}`, object])).values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
    if (!report.findings.some((f) => f.id === finding.id)) report.findings.push(finding)
  }
  if (!time()) { exhausted('maxMillis'); return report }
  const base = scenario(topology)
  for (const limitation of base.limitations) limited(limitation)
  const allOwners = [
    ...topology.spokes.map((node) => ({ node: { kind: 'spoke' as const, id: node.id }, prefixes: node.prefixes })),
    ...topology.sites.map((node) => ({ node: { kind: 'site' as const, id: node.id }, prefixes: node.prefixes })),
  ].sort((a, b) => `${a.node.kind}:${a.node.id}`.localeCompare(`${b.node.kind}:${b.node.id}`)).map((owner) => ({
    ...owner,
    topPrefixes: topLevelPrefixes(owner.prefixes),
    parsedPrefixes: owner.prefixes.map((prefix) => ({ prefix, ...addressRange(prefix), length: cidr(prefix)?.length ?? 32 })),
  }))
  if (options.automatic) {
    const isOwnedPrefix = (prefix: string) => {
      const range = addressRange(prefix)
      return allOwners.some((owner) => owner.parsedPrefixes.some((container) => container.start <= range.start && container.end >= range.end))
    }
    for (const site of topology.sites) {
      if (!room()) break
      const unownedSources = (site.vpnStaticRoutes ?? [])
        .filter((route) => topology.connections.some((link) => link.id === route.connectionId && link.enabled) && !isOwnedPrefix(route.prefix))
        .map((route) => ({
          code: 'unowned-advertisement' as const,
          nodeId: site.id,
          prefix: route.prefix,
          connectionId: route.connectionId,
        }))
      const prefixes = [...new Set(unownedSources.map((entry) => entry.prefix))]
      if (prefixes.length) {
        limited(limits.ownership)
        add('unowned-advertisement', 'unknown', site.id, {
          related: [{ kind: 'site', id: site.id }], prefix: prefixes.join(', '),
          evidence: unownedSources,
        })
      }
    }
    if (allOwners.filter((owner) => owner.prefixes.length).length < 2) limited(limits.endpoints)
    for (const intent of profile.intents) {
      for (const prefix of [intent.sourcePrefix, intent.destinationPrefix]) {
        const range = addressRange(prefix)
        base.boundaries.push(range.start, range.end)
      }
    }
    base.boundaries = [...new Set(base.boundaries)].sort((a, b) => a - b)
  }
  for (let i = 0; i < allOwners.length; i++) {
    for (let j = i + 1; j < allOwners.length; j++) {
      if (!time()) { exhausted('maxMillis'); break }
      const overlaps = allOwners[i].parsedPrefixes.flatMap((a) =>
        allOwners[j].parsedPrefixes
          .filter((b) => a.start < b.end && b.start < a.end)
          .map((b) => (a.length >= b.length ? a.prefix : b.prefix)),
      )
      if (overlaps.length) add('ownership', 'warning', stable([allOwners[i].node, allOwners[j].node]), {
        related: [allOwners[i].node, allOwners[j].node], prefix: overlaps.sort()[0],
        evidence: [...new Set(overlaps)].sort().map((prefix) => ({ code: 'declared-overlap', prefix })),
      })
    }
  }
  const trace = (state: Scenario, node: PathNode, destination: string): NodePath[] | undefined => {
    const key = `${node.kind}:${node.id}:${destination}`
    const cached = state.cache.get(key)
    if (cached) return cached
    if (!time()) { exhausted('maxMillis'); return undefined }
    if (report.probes >= budget.maxProbes) { exhausted('maxProbes'); return undefined }
    report.probes++
    const paths = traceNodePath(state.topology, state.simulation, node, destination, state.learned)
    state.cache.set(key, paths)
    return paths
  }
  const evaluate = (state: Scenario, intent: DiagnosticIntent, sourceCell: Cell, targetCell: Cell) => {
    const forward = trace(state, intent.source, targetCell.address)
    const reverse = intent.expectation === 'allow' ? trace(state, intent.target, sourceCell.address) : []
    if (!forward || !reverse) return undefined
    const reasons = [...state.limitations, ...modelLimits(state, intent.source, targetCell.address, forward),
      ...(intent.expectation === 'allow' ? modelLimits(state, intent.target, sourceCell.address, reverse) : [])]
    if (!owned(state, intent.source, sourceCell.address) || !owned(state, intent.target, targetCell.address)) reasons.push(limits.ownership)
    if (intent.requiredFirewallHubId && !state.topology.hubs.some((hub) => hub.id === intent.requiredFirewallHubId)) reasons.push(limits.inspection)
    if ([...forward, ...reverse].some((path) => path.traceComplete === false)) reasons.push(limits.trace)
    if (!forward.length || (intent.expectation === 'allow' && !reverse.length)) reasons.push(limits.ownership)
    const f = forward.filter((path) => delivered(path, intent.target)).length
    const r = reverse.filter((path) => delivered(path, intent.source)).length
    const inspection = !intent.requiredFirewallHubId || [...forward, ...reverse].every((path) => path.firewalls?.includes(intent.requiredFirewallHubId!))
    return { forward, reverse, reasons: [...new Set(reasons)], f, r, inspection, success: f === forward.length && r === reverse.length && inspection }
  }
  type Baseline = { intent: DiagnosticIntent; source: Cell; target: Cell }
  const healthy: Baseline[] = []
  const pathSignatures = new WeakMap<NodePath[], { forward: string; reverse: string }>()
  const signature = (paths: NodePath[], source: PathNode, reverse = false) => {
    let cached = pathSignatures.get(paths)
    if (!cached) {
      const tokens = paths.map((path) => physical(path, source))
      cached = {
        forward: stable([...new Set(tokens.map(stable))].sort()),
        reverse: stable([...new Set(tokens.map((path) => stable([...path].reverse())))].sort()),
      }
      pathSignatures.set(paths, cached)
    }
    return reverse ? cached.reverse : cached.forward
  }
  function* intents(): Generator<DiagnosticIntent & { automatic?: true }> {
    yield* [...profile.intents].sort((a, b) => a.id.localeCompare(b.id))
    if (!options.automatic) return
    for (let i = 0; i < allOwners.length; i++) {
      const sourcePrefixes = allOwners[i].topPrefixes
      for (let j = i + 1; j < allOwners.length; j++) {
        const destinationPrefixes = allOwners[j].topPrefixes
        for (const sourcePrefix of sourcePrefixes) for (const destinationPrefix of destinationPrefixes) {
          yield {
            id: `automatic:${hash(stable([allOwners[i].node, sourcePrefix, allOwners[j].node, destinationPrefix]))}`,
            source: allOwners[i].node, target: allOwners[j].node, sourcePrefix, destinationPrefix, expectation: 'allow', automatic: true,
          }
        }
      }
    }
  }
  const covers = (prefix: string, cell: Cell) => {
    const a = addressRange(prefix), b = addressRange(cell.prefix)
    return a.start <= b.start && a.end >= b.end
  }
  type PendingCellFinding = {
    rule: Rule
    severity: DiagnosticsFinding['severity']
    source: Cell
    target: Cell
    fields: Partial<DiagnosticsFinding>
    groupKey: string
  }
  const partitionCache = new Map<string, Cell[]>()
  const partitionCached = (prefix: string) => {
    let cells = partitionCache.get(prefix)
    if (!cells) {
      cells = partition(prefix, base.boundaries, budget.maxCells + 1)
      partitionCache.set(prefix, cells)
    }
    return cells
  }
  intents: for (const intent of intents()) {
    const sources = partitionCached(intent.sourcePrefix)
    const targets = partitionCached(intent.destinationPrefix)
    const pending: PendingCellFinding[] = []
    const queue = (
      rule: Rule,
      severity: DiagnosticsFinding['severity'],
      source: Cell,
      target: Cell,
      fields: Partial<DiagnosticsFinding>,
      groupKey: string = rule,
    ) => {
      pending.push({ rule, severity, source, target, fields, groupKey })
    }
    for (const source of sources) {
      for (const target of targets) {
        if (!room()) break intents
        if (intent.automatic && profile.intents.some((requirement) =>
          same(requirement.source, intent.source) && same(requirement.target, intent.target) && covers(requirement.sourcePrefix, source) && covers(requirement.destinationPrefix, target)
          || same(requirement.source, intent.target) && same(requirement.target, intent.source) && covers(requirement.sourcePrefix, target) && covers(requirement.destinationPrefix, source))) continue
        report.cells++
        const result = evaluate(base, intent, source, target)
        if (!result) break intents
        const { forward, reverse, reasons, f, r, inspection } = result
        if (intent.automatic && !reasons.length && result.success && signature(forward, intent.source) === signature(reverse, intent.target, true)) {
          if (profile.failureAnalysis) healthy.push({ intent, source, target })
          continue
        }
        const fields: Partial<DiagnosticsFinding> = {
          source: intent.source, target: intent.target, sourceAddress: source.address, destinationAddress: target.address, prefix: target.prefix,
          forward, reverse, related: [intent.source, intent.target, ...pathObjects([...forward, ...reverse])],
          evidence: [
            { code: intent.automatic ? 'automatic-network-pair' : 'intent', nodeId: intent.id },
            { code: 'source-cell', prefix: source.prefix }, { code: 'destination-cell', prefix: target.prefix },
            ...forward.map((path) => ({ code: `forward:${path.termination ?? 'unknown'}`, nodeId: path.siteId ?? path.hubs.at(-1), connectionId: path.connectionId, prefix: path.lookupPrefix })),
            ...reverse.map((path) => ({ code: `reverse:${path.termination ?? 'unknown'}`, nodeId: path.siteId ?? path.hubs.at(-1), connectionId: path.connectionId, prefix: path.lookupPrefix })),
          ],
        }
        if (reasons.length) {
          reasons.forEach(limited)
          const limCodes = reasons.map((reason) => ({ code: `limitation:${Object.entries(limits).find(([, text]) => text === reason)?.[0] ?? 'unknown'}` }))
          queue('unknown', 'unknown', source, target, { ...fields, evidence: [...fields.evidence!, ...limCodes] }, `unknown:${stable(limCodes)}`)
          continue
        }
        if (intent.expectation === 'deny') {
          const rule = f ? 'deny-violation' : 'denied'
          queue(rule, f ? 'error' : 'info', source, target, fields, `${rule}:${signature(forward, intent.source)}`)
          continue
        }
        const hasLoop = [...forward, ...reverse].some((path) => path.status === 'loop')
        const hasSummaryHole = [...forward, ...reverse].some((path) => path.termination === 'summary-hole')
        const hasWrongExit =
          forward.some((path) => path.status === 'delivered' && !delivered(path, intent.target)) ||
          reverse.some((path) => path.status === 'delivered' && !delivered(path, intent.source))
        if (!f && (!intent.automatic || (!hasLoop && !hasSummaryHole && !hasWrongExit))) {
          queue(intent.automatic ? 'network-unreachable' : 'unreachable', intent.automatic ? 'warning' : 'error', source, target, fields)
        }
        if (f && !r && (!intent.automatic || (!hasLoop && !hasSummaryHole && !hasWrongExit))) {
          queue(intent.automatic ? 'network-return' : 'missing-return', 'error', source, target, fields)
        }
        if ((f > 0 && f < forward.length) || (r > 0 && r < reverse.length)) queue('partial-ecmp', 'error', source, target, fields)
        if (hasLoop) queue('loop', 'error', source, target, fields)
        if (hasSummaryHole) queue('summary-hole', 'error', source, target, fields)
        if (hasWrongExit) queue('wrong-exit', 'error', source, target, fields)
        if (!inspection) queue('firewall', 'error', source, target, fields)
        if (f && r && !hasWrongExit) {
          const a = [...new Set(forward.filter((path) => delivered(path, intent.target)).map((path) => stable(physical(path, intent.source))))].sort()
          const b = [...new Set(reverse.filter((path) => delivered(path, intent.source)).map((path) => stable(physical(path, intent.target).reverse())))].sort()
          if (stable(a) !== stable(b)) queue('asymmetric', 'warning', source, target, fields)
        }
        if (result.success) {
          if (!intent.automatic) queue('reachable', 'info', source, target, fields, `reachable:${signature(forward, intent.source)}:${signature(reverse, intent.target, true)}`)
          if (profile.failureAnalysis) healthy.push({ intent, source, target })
        }
      }
    }
    const groups = new Map<string, PendingCellFinding[]>()
    for (const item of pending) {
      const list = groups.get(item.groupKey) ?? []
      list.push(item)
      groups.set(item.groupKey, list)
    }
    for (const group of groups.values()) {
      const first = group[0]
      const mergedSource = group.length === 1 ? first.source : coveringCidr(group.map((item) => item.source))
      const mergedTarget = group.length === 1 ? first.target : coveringCidr(group.map((item) => item.target))
      const scope = stable([intent, mergedSource.prefix, mergedTarget.prefix])
      const updatedEvidence = (first.fields.evidence ?? []).map((entry) =>
        entry.code === 'source-cell'
          ? { ...entry, prefix: mergedSource.prefix }
          : entry.code === 'destination-cell'
            ? { ...entry, prefix: mergedTarget.prefix }
            : entry,
      )
      add(first.rule, first.severity, scope, {
        ...first.fields,
        sourceAddress: mergedSource.address,
        destinationAddress: mergedTarget.address,
        prefix: mergedTarget.prefix,
        evidence: updatedEvidence,
      })
    }
  }
  for (const constraint of [...(profile.exportConstraints ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!room()) break
    let snapshot: { before: { prefix: string }[]; after: { prefix: string }[] } | undefined = base.simulation.routePolicies.find((item) => item.router.kind === constraint.router.kind && item.router.id === constraint.router.id && item.connectionId === constraint.connectionId && item.direction === constraint.direction)
    const site = constraint.router.kind === 'site' ? topology.sites.find((node) => node.id === constraint.router.id) : undefined
    const link = topology.siteLinks.find((link) => link.id === constraint.connectionId && (link.a === site?.id || link.b === site?.id))
    const neighborAttachment = [...topology.connections, ...(topology.erLinks ?? [])].find((item) => item.id === constraint.connectionId &&
      (constraint.router.kind === 'site' ? item.siteId === constraint.router.id : item.hubId === constraint.router.id))
    if ((link && !link.enabled) || (neighborAttachment && !neighborAttachment.enabled)) snapshot = { before: [], after: [] }
    if (site && link?.enabled) {
      const neighbor = topology.sites.find((node) => node.id === (link.a === site.id ? link.b : link.a))!
      const stage = (value: 'before' | 'after') => constraint.direction === 'inbound'
        ? receiveSiteRoutes(topology, site, link, base.learned.tables[neighbor.id] ?? [], false, value)
        : advertiseSiteRoutes(topology, neighbor, link, base.learned.tables[site.id] ?? [], false, value)
      snapshot = { before: stage('before'), after: stage('after') }
    } else if (site && constraint.direction === 'inbound') {
      const attachment = [...topology.connections, ...(topology.erLinks ?? [])].find((item) => item.id === constraint.connectionId && item.siteId === site.id && item.enabled)
      if (attachment) {
        const before = base.simulation.outbound[attachment.id] ?? []
        const after = [...applyRouteMapRules(before.filter((route) => route.kind !== 'vpn-static'), routerMapRules(topology, constraint.router, attachment.id, 'inbound')), ...before.filter((route) => route.kind === 'vpn-static')].filter((route) => !route.asPath.includes(site.asn))
        snapshot = { before, after }
      }
    }
    const related: ObjectSelection[] = [constraint.router, { kind: topology.erLinks?.some((link) => link.id === constraint.connectionId) ? 'erLink' : topology.siteLinks.some((link) => link.id === constraint.connectionId) ? 'siteLink' : 'connection', id: constraint.connectionId }]
    const fields = { related, prefix: constraint.prefix, evidence: [
      { code: `constraint:${constraint.direction}:${constraint.expectation}`, nodeId: constraint.router.id, connectionId: constraint.connectionId, prefix: constraint.prefix },
      { code: snapshot?.before.some((route) => route.prefix === constraint.prefix) ? 'before:present' : 'before:absent' },
      { code: snapshot?.after.some((route) => route.prefix === constraint.prefix) ? 'after:present' : 'after:absent' },
    ] }
    const attachment = topology.connections.find((item) => item.id === constraint.connectionId)
    const unsupported = (constraint.router.kind === 'hub' && attachment?.enabled && attachment.transport === 'SDWAN') || (neighborAttachment?.enabled && constraint.prefix === '0.0.0.0/0' &&
      (attachment?.transport === 'ExpressRoute' || topology.erLinks?.some((link) => link.id === constraint.connectionId)))
    if (!snapshot || base.limitations.length || unsupported) {
      limited(limits.policy)
      add('unknown', 'unknown', stable(constraint), fields)
    } else {
      const present = snapshot.after.some((route) => route.prefix === constraint.prefix)
      const matches = present === (constraint.expectation === 'present')
      add(matches ? 'export-ok' : 'export', matches ? 'info' : 'error', stable(constraint), fields)
    }
  }
  if (options.automatic) {
    for (const isolation of singleLinkIsolation(topology)) {
      if (!room()) break
      add('link-isolation', 'warning', stable([isolation.object, isolation.linkId]), {
        isolation, related: [...(isolation.object ? [isolation.object] : []), ...isolation.groups.flat()],
        evidence: [{ code: 'structural-bridge', connectionId: isolation.linkId }],
      })
    }
  }
  if (profile.failureAnalysis && healthy.length) {
    const links = [...topology.connections.map((link) => ({ kind: 'connection' as const, link })),
      ...topology.siteLinks.map((link) => ({ kind: 'siteLink' as const, link })),
      ...(topology.erLinks ?? []).map((link) => ({ kind: 'erLink' as const, link }))].filter(({ link }) => link.enabled)
      .sort((a, b) => `${a.kind}:${a.link.id}`.localeCompare(`${b.kind}:${b.link.id}`))
    failures: for (const { kind, link } of links) {
      if (!room()) break
      if (report.failureCases >= budget.maxFailureCases) { exhausted('maxFailureCases'); break }
      report.failureCases++
      const clone = structuredClone(topology)
      const collection = kind === 'connection' ? clone.connections : kind === 'siteLink' ? clone.siteLinks : clone.erLinks!
      collection.find((item) => item.id === link.id)!.enabled = false
      const failed = scenario(clone)
      for (const { intent, source, target } of healthy) {
        if (!room()) break failures
        report.cells++
        const result = evaluate(failed, intent, source, target)
        if (!result) break failures
        if (result.reasons.length) result.reasons.forEach(limited)
        if (!result.success || result.reasons.length) add(result.reasons.length ? 'failure-unknown' : 'failure', result.reasons.length ? 'unknown' : 'warning', stable([kind, link.id, intent, source.prefix, target.prefix]), {
          source: intent.source, target: intent.target, sourceAddress: source.address, destinationAddress: target.address, prefix: target.prefix,
          related: [{ kind, id: link.id }, intent.source, intent.target, ...pathObjects([...result.forward, ...result.reverse])],
          forward: result.forward, reverse: result.reverse, evidence: [
            { code: 'disabled-link', connectionId: link.id },
            { code: 'intent', nodeId: intent.id },
            { code: 'source-cell', prefix: source.prefix },
            { code: 'destination-cell', prefix: target.prefix },
            ...result.reasons.map((reason) => ({ code: `limitation:${Object.entries(limits).find(([, text]) => text === reason)?.[0] ?? 'unknown'}` })),
          ],
        })
      }
    }
  }
  if (options.automatic) {
    report.findings = suppressCascadingAutomaticFindings(report.findings)
  }
  if (!time()) exhausted('maxMillis')
  report.findings.sort((a, b) => a.id.localeCompare(b.id))
  report.limitations.sort()
  return report
}

export function describeEvidenceSource(topology: Topology, evidence: DiagnosticsFinding['evidence'][number], fallbackSiteId?: string): string {
  const siteId = evidence.nodeId ?? fallbackSiteId
  const site = siteId ? topology.sites.find((item) => item.id === siteId) : undefined
  if (evidence.connectionId) {
    const connection = topology.connections.find((item) => item.id === evidence.connectionId)
    if (connection) {
      if (site?.vpnStaticRoutes?.some((route) => route.connectionId === connection.id && route.prefix === evidence.prefix)) {
        return t('Defined in VPN static routes on site "{0}" via connection "{1}"', site.name, connection.name)
      }
      return connection.name
    }
    const erLink = topology.erLinks?.find((item) => item.id === evidence.connectionId)
    if (erLink) return erLink.name
  }
  return evidence.connectionId ?? ''
}
