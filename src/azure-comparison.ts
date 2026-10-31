import type { ObjectSelection, Topology } from './model'
import { simulate } from './routing'
import type { Candidate } from './routing'
import { routingRevision } from './diagnostics'
import { cidr } from './validation'
import { armKey, normalizeObservedAsPath, normalizeObservedPrefix } from './azure-observation'
import type { AzureObservation, ObservedRoute } from './azure-observation'

export type ComparisonHop = { kind: 'hub' | 'spoke' | 'connection'; id: string }
  | { kind: 'gateway'; id: string; transport: 'VPN' | 'ExpressRoute' }
export interface ComparisonProfile {
  hubs: Record<string, string>
  spokes: Record<string, string>
  nextHops: Record<string, ComparisonHop>
  hubResourceId: string
  prefixes: string[]
  completeDesign: boolean
  compareAsPaths: boolean
}
export type ComparisonStatus = 'match' | 'design-only' | 'azure-only' | 'next-hop' | 'attribute' | 'changed' | 'unknown'
export interface ComparisonTuple { hop: string; asPath: string }
export interface ComparisonRow {
  id: string
  area: 'structure' | 'route'
  hubResourceId: string
  prefix: string
  status: ComparisonStatus
  detail: string
  related: ObjectSelection[]
  designed: ComparisonTuple[]
  observed: ObservedRoute[]
  configuration?: { label: string; designed: string | boolean | string[] | null; observed: string | boolean | string[] | null }[]
}
export interface ComparisonReport {
  revision: string
  profileKey: string
  generatedAt: string
  rows: ComparisonRow[]
  compared: number
  notCompared: number
  truncated: boolean
  limitations: string[]
}
export const comparisonProfileKey = (profile: ComparisonProfile) => JSON.stringify(profile)
export const comparisonStatuses: Record<ComparisonStatus, string> = {
  match: 'Compared fields match', 'design-only': 'Design-only route', 'azure-only': 'Azure-only / unmodeled',
  'next-hop': 'Selected next hops differ', attribute: 'AS paths differ', changed: 'Configuration differs', unknown: 'Not compared',
}
const messages = {
  unmapped: 'Azure object has no explicit design mapping. It has not been added to the workspace.',
  missingMapping: 'Design object is not mapped to an observed resource; absence in Azure is not established.',
  configMatch: 'The captured supported configuration fields match the design.',
  configDiff: 'The captured supported configuration fields differ from the design.',
  context: 'This table, routing context or observation status is not comparable. Missing routes are not inferred.',
  stale: 'This table is older than 24 hours or is future-dated. Refresh the capture before drawing current routing conclusions.',
  provisional: 'The modeled selection is provisional or depends on unvalidated ER-default, hub-AS or NVA behavior.',
  unmappedHop: 'A next-hop identity, type, address family or AS-path representation cannot be compared safely.',
  additional: 'This exact prefix is observed in Azure but is not selected in the design. It may be intentional or unmodeled.',
  missing: 'This expected exact prefix was not returned by the complete comparable table. A covering aggregate is not an identical route.',
  coverage: 'Missing-route assessment requires explicit exact-prefix scope and confirmation of complete expected design coverage.',
  nextHop: 'The associated selected next-hop sets differ at the compared observation boundary.',
  attributes: 'Selected next-hop sets match, but associated learned AS paths differ. Repeated and provider ASNs are preserved.',
  match: 'The compared selected next-hop sets match. Unselected candidates and unrequested attributes are not compared.',
  matchAs: 'The compared selected next-hop and AS-path tuple sets match. Other attributes are not certified.',
}
export const comparisonMessages = Object.values(messages)
const same = (left: string[], right: string[]) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
const hopKey = (hop: ComparisonHop) => hop.kind === 'gateway' ? `gateway:${hop.id}:${hop.transport}` : `${hop.kind}:${hop.id}`
const hopExists = (topology: Topology, hop: ComparisonHop) => hop.kind === 'gateway' || hop.kind === 'hub'
  ? topology.hubs.some((item) => item.id === hop.id)
  : hop.kind === 'spoke' ? topology.spokes.some((item) => item.id === hop.id) : topology.connections.some((item) => item.id === hop.id)

export function defaultComparisonProfile(topology: Topology, observation: AzureObservation): ComparisonProfile {
  const hubs: Record<string, string> = {}, spokes: Record<string, string> = {}
  for (const hub of observation.hubs) {
    const retained = topology.azureImport?.hubs.find((source) => armKey(source.resourceId) === armKey(hub.resourceId))
    if (retained && topology.hubs.some((node) => node.id === retained.hubId)) hubs[armKey(hub.resourceId)] = retained.hubId
    for (const spoke of hub.spokes) {
      if (topology.spokes.some((node) => node.id === spoke.importedId)) spokes[armKey(spoke.resourceId)] = spoke.importedId
    }
  }
  return { hubs, spokes, nextHops: {}, hubResourceId: observation.hubs[0]?.resourceId ?? '', prefixes: [], completeDesign: false, compareAsPaths: false }
}

export function comparisonHopChoices(topology: Topology): { value: ComparisonHop; name: string }[] {
  return [
    ...topology.hubs.map((hub) => ({ value: { kind: 'hub' as const, id: hub.id }, name: hub.name })),
    ...topology.spokes.map((spoke) => ({ value: { kind: 'spoke' as const, id: spoke.id }, name: spoke.name })),
    ...topology.hubs.flatMap((hub) => (['VPN', 'ExpressRoute'] as const).map((transport) => ({
      value: { kind: 'gateway' as const, id: hub.id, transport }, name: `${hub.name} · ${transport}`,
    }))),
    ...topology.connections.filter((connection) => connection.transport === 'SDWAN' || connection.transport === 'SpokeNVA').map((connection) => ({
      value: { kind: 'connection' as const, id: connection.id }, name: connection.name,
    })),
  ]
}
function resolveHop(topology: Topology, profile: ComparisonProfile, raw: string): ComparisonHop | undefined {
  const key = armKey(raw)
  const hub = Object.hasOwn(profile.hubs, key) ? profile.hubs[key] : undefined
  const spoke = Object.hasOwn(profile.spokes, key) ? profile.spokes[key] : undefined
  const explicit = Object.hasOwn(profile.nextHops, key) ? profile.nextHops[key] : undefined
  const hop: ComparisonHop | undefined = hub ? { kind: 'hub', id: hub } : spoke ? { kind: 'spoke', id: spoke } : explicit
  return hop && hopExists(topology, hop) ? hop : undefined
}
function observedType(type: string): string | undefined {
  return ({ virtualnetworkconnection: 'spoke', remotehub: 'hub', expressroutegateway: 'ExpressRoute',
    vpns2sgateway: 'VPN', hubbgpconnection: 'connection' } as Record<string, string>)[type.replace(/[\s_-]/g, '').toLowerCase()]
}
function modeledHop(hubId: string, route: Candidate): ComparisonHop | undefined {
  if (route.kind === 'policy') return
  if (route.remote) return { kind: 'hub', id: route.originHubId }
  if (route.transport === 'VNet') return { kind: 'spoke', id: route.connectionId }
  if (route.transport === 'VPN' || route.transport === 'ExpressRoute') return { kind: 'gateway', id: hubId, transport: route.transport }
  if (route.transport === 'SDWAN' || route.transport === 'SpokeNVA') return { kind: 'connection', id: route.connectionId }
}

export function compareAzure(topology: Topology, observation: AzureObservation, profile: ComparisonProfile, now = Date.now()): ComparisonReport {
  if (profile.prefixes.length > 1000 || profile.prefixes.some((prefix) => !cidr(prefix))) throw new Error('Use up to 1000 canonical IPv4 prefixes for the comparison scope.')
  for (const mappings of [profile.hubs, profile.spokes]) {
    if (new Set(Object.values(mappings)).size !== Object.values(mappings).length) throw new Error('Each design object can map to only one observed resource.')
  }
  const rows: ComparisonRow[] = []
  let omitted = 0
  const add = (row: Omit<ComparisonRow, 'id' | 'designed' | 'observed'> & Partial<Pick<ComparisonRow, 'designed' | 'observed'>>) => {
    if (rows.length >= 10_000) { omitted++; return }
    rows.push({ id: String(rows.length), designed: [], observed: [], ...row })
  }
  const simulation = simulate(topology)
  for (const hub of observation.hubs.filter((hub) => !profile.hubResourceId || armKey(hub.resourceId) === armKey(profile.hubResourceId))) {
    const hubId = profile.hubs[armKey(hub.resourceId)], designedHub = topology.hubs.find((node) => node.id === hubId)
    if (!designedHub) {
      add({ area: 'structure', hubResourceId: hub.resourceId, prefix: hub.name, status: 'azure-only', detail: messages.unmapped, related: [] })
      continue
    }
    const related: ObjectSelection[] = [{ kind: 'hub', id: hubId }]
    const configKnown = !hub.limitations.length
    const preferenceMatch = designedHub.preference === hub.preference
    const configMatch = preferenceMatch && designedHub.routingIntent.private === hub.privateIntent && designedHub.routingIntent.internet === hub.internetIntent
    add({ area: 'structure', hubResourceId: hub.resourceId, prefix: hub.name, related,
      status: !preferenceMatch ? 'changed' : !configKnown ? 'unknown' : configMatch ? 'match' : 'changed',
      detail: preferenceMatch && !configKnown ? messages.context : configMatch ? messages.configMatch : messages.configDiff,
      configuration: [
        { label: 'Hub routing preference', designed: designedHub.preference, observed: hub.preference },
        { label: 'Private intent enabled', designed: designedHub.routingIntent.private, observed: configKnown ? hub.privateIntent : null },
        { label: 'Internet intent enabled', designed: designedHub.routingIntent.internet, observed: configKnown ? hub.internetIntent : null },
      ] })
    for (const spoke of hub.spokes) {
      const spokeId = profile.spokes[armKey(spoke.resourceId)], designed = topology.spokes.find((node) => node.id === spokeId)
      const prefixesKnown = spoke.prefixes !== null && spoke.prefixes.every((prefix) => !!normalizeObservedPrefix(prefix))
      const changed = designed && (designed.hubId !== hubId || !same(designed.prefixes, spoke.prefixes ?? []))
      add({ area: 'structure', hubResourceId: hub.resourceId, prefix: spoke.name,
        related: designed ? [...related, { kind: 'spoke', id: designed.id }] : related,
        status: !designed ? 'azure-only' : !prefixesKnown ? 'unknown' : changed ? 'changed' : 'match',
        detail: !designed ? messages.unmapped : !prefixesKnown ? messages.context : changed ? messages.configDiff : messages.configMatch,
        configuration: [
          { label: 'Hub attachment', designed: designed?.hubId ?? null, observed: hubId },
          { label: 'Address spaces', designed: designed?.prefixes ?? null, observed: spoke.prefixes },
        ] })
    }
    for (const spoke of topology.spokes.filter((spoke) => spoke.hubId === hubId && !Object.values(profile.spokes).includes(spoke.id))) {
      add({ area: 'structure', hubResourceId: hub.resourceId, prefix: spoke.name, related: [...related, { kind: 'spoke', id: spoke.id }],
        status: 'unknown', detail: messages.missingMapping })
    }
    const table = observation.tables.find((table) => armKey(table.resourceId) === `${armKey(hub.resourceId)}/hubroutetables/defaultroutetable`)
    const selected = simulation.tables[hubId] ?? []
    const observed = new Map<string, ObservedRoute[]>()
    for (const row of table?.routes ?? []) for (const rawPrefix of row.addressPrefixes) {
      const prefix = normalizeObservedPrefix(rawPrefix) ?? rawPrefix
      const values = observed.get(prefix) ?? []; values.push(row); observed.set(prefix, values)
    }
    const decisions = new Map(selected.map((decision) => [decision.prefix, decision]))
    const prefixes = profile.prefixes.length ? [...new Set(profile.prefixes)] : [...new Set([...decisions.keys(), ...observed.keys()])]
    const expectedLimitations = topology.azureImport?.hubs.find((source) => source.hubId === hubId)?.limitations ?? []
    const tableKnown = configKnown && !expectedLimitations.length && !!observation.context.tenantId && !!observation.context.azureCliVersion
      && !hub.privateIntent && !hub.internetIntent && !designedHub.routingIntent.private && !designedHub.routingIntent.internet && table?.resourceType === 'RouteTable'
      && (table.status === 'complete' || table.status === 'empty') && table.routes.every((row) => row.addressPrefixes.length > 0)
      && hub.spokes.every((spoke) => spoke.defaultRouting === true && spoke.enableInternetSecurity === false)
    const age = table ? now - Date.parse(table.capturedAt) : 0
    const stale = age > 86_400_000 || age < -300_000
    for (const prefix of prefixes.sort()) {
      const decision = decisions.get(prefix), actual = observed.get(prefix) ?? []
      const expected = decision?.selected ?? []
      const designed: ComparisonTuple[] = expected.flatMap((route) => {
        const hop = modeledHop(hubId, route)
        return hop ? [{ hop: hopKey(hop), asPath: route.asPath.join(' ') }] : []
      })
      const affected = [...related, ...expected.flatMap((route): ObjectSelection[] => route.transport === 'VNet' && !route.remote
        ? [{ kind: 'spoke', id: route.connectionId }] : topology.connections.some((item) => item.id === route.connectionId)
          ? [{ kind: 'connection', id: route.connectionId }] : route.erHubLinkId ? [{ kind: 'erLink', id: route.erHubLinkId }] : [])]
      const base = { area: 'route' as const, hubResourceId: hub.resourceId, prefix, related: affected, designed, observed: actual }
      if (!tableKnown) { add({ ...base, status: 'unknown', detail: messages.context }); continue }
      if (stale) { add({ ...base, status: 'unknown', detail: messages.stale }); continue }
      const provisional = !simulation.converged || simulation.siteSelectionComplete !== true
        || decision?.candidates.some((route) => route.transport === 'SDWAN' || route.asPath.includes(65515))
        || (prefix === '0.0.0.0/0' && (topology.connections.some((connection) => connection.enabled && connection.transport === 'ExpressRoute')
          || topology.erLinks?.some((link) => link.enabled)))
      if (provisional) { add({ ...base, status: 'unknown', detail: messages.provisional }); continue }
      if (!expected.length && actual.length && cidr(prefix)) { add({ ...base, status: 'azure-only', detail: messages.additional }); continue }
      const tuples: ComparisonTuple[] = []
      let unknown = !cidr(prefix) || designed.length !== expected.length
      for (const row of actual) {
        const type = observedType(row.nextHopType), asPath = normalizeObservedAsPath(row.asPath)
        if (!row.nextHops.length || !type || (profile.compareAsPaths && asPath === undefined)) unknown = true
        for (const rawHop of row.nextHops) {
          const hop = resolveHop(topology, profile, rawHop)
          if (!hop || (hop.kind === 'gateway' ? hop.transport : hop.kind) !== type) unknown = true
          else tuples.push({ hop: hopKey(hop), asPath: asPath ?? row.asPath })
        }
      }
      if (unknown) { add({ ...base, status: 'unknown', detail: messages.unmappedHop }); continue }
      if (!actual.length) {
        if (!expected.length) { add({ ...base, status: 'unknown', detail: messages.coverage }); continue }
        add({ ...base, status: profile.completeDesign && profile.prefixes.includes(prefix) ? 'design-only' : 'unknown',
          detail: profile.completeDesign && profile.prefixes.includes(prefix) ? messages.missing : messages.coverage })
        continue
      }
      const hopsMatch = same(designed.map((tuple) => tuple.hop), tuples.map((tuple) => tuple.hop))
      const pathsMatch = same(designed.map((tuple) => JSON.stringify(tuple)), tuples.map((tuple) => JSON.stringify(tuple)))
      add({ ...base, status: !hopsMatch ? 'next-hop' : profile.compareAsPaths && !pathsMatch ? 'attribute' : 'match',
        detail: !hopsMatch ? messages.nextHop : profile.compareAsPaths ? pathsMatch ? messages.matchAs : messages.attributes : messages.match })
    }
  }
  if (!rows.length) add({ area: 'structure', hubResourceId: profile.hubResourceId, prefix: '', status: 'unknown', detail: messages.context, related: [] })
  return {
    revision: routingRevision(topology), profileKey: comparisonProfileKey(profile), generatedAt: new Date(now).toISOString(),
    rows, compared: rows.filter((row) => row.status !== 'unknown').length, notCompared: rows.filter((row) => row.status === 'unknown').length + omitted,
    truncated: omitted > 0, limitations: [
      'Point-in-time captures are not atomic or live network tests. Differences are not automatically Azure faults.',
      'Only unsecured Default table contexts are compared. Origins, gateway instances, per-circuit exits, communities and traffic hashes are not compared.',
      'Gateway next hops compare gateway class and hub, not individual branch connections. ECMP tuple sets do not predict traffic hashes.',
      ...(omitted ? ['Comparison result limit reached; omitted cases are not assessed.'] : []),
    ],
  }
}
