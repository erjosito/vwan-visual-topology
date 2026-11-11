import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import { getGeopoliticalRegionForAzureRegion, normalizeAzureRegionName } from './er-locations-catalog'
import { embeddedSpokeNvaSiteIds } from './topology-graph'

export interface FailureDomain {
  kind: 'region' | 'er-location' | 'site'
  id: string
  name: string
}
export type FaultMap = Record<string, FailureDomain[]>
export const failureKey = (fault: FailureDomain) => `${fault.kind}:${fault.id}`
export const failureLabel = (fault: FailureDomain) => `${fault.kind === 'region' ? 'Azure region' : fault.kind === 'site' ? 'on-premises site' : 'ER location'} ${fault.name}`

export function regionKey(region?: string): string | undefined {
  if (!region || !getGeopoliticalRegionForAzureRegion(region)) return undefined
  return normalizeAzureRegionName(region).toLowerCase().replace(/[\s-]/g, '')
}

export interface FailureProjection<T> {
  active: T
  domains: FailureDomain[]
  affected: FaultMap
  unassessed: string[]
}

function domainList(regions: (string | undefined)[], sites: { id: string; name: string }[], locations: { id: string; name: string }[]): FailureDomain[] {
  const unique = new Map<string, FailureDomain>()
  for (const region of regions) {
    const id = regionKey(region)
    if (id) unique.set(id, { kind: 'region', id, name: normalizeAzureRegionName(region) })
  }
  return [...unique.values(), ...sites.map((site): FailureDomain => ({ ...site, kind: 'site' })),
    ...locations.map((location): FailureDomain => ({ ...location, kind: 'er-location' }))]
}

export function projectVwanFailures(baseline: Topology, faults: FailureDomain[] = []): FailureProjection<Topology> {
  const affected: FaultMap = {}, unassessed: string[] = []
  const embedded = embeddedSpokeNvaSiteIds(baseline)
  const regions = new Map<string, string | undefined>()
  for (const hub of baseline.hubs) regions.set(hub.id, hub.region)
  for (const spoke of baseline.spokes) {
    regions.set(spoke.id, spoke.region)
  }
  for (const siteId of embedded) {
    const hosts = baseline.connections.filter((c) => c.transport === 'SpokeNVA' && c.siteId === siteId && c.spokeId)
      .map((c) => regions.get(c.spokeId!))
    const keys = new Set(hosts.map((r) => regionKey(r)))
    regions.set(siteId, keys.size === 1 && !keys.has(undefined) ? hosts[0] : undefined)
  }
  for (const [id, region] of regions) if (!regionKey(region)) unassessed.push(`${id}: missing or unrecognized Azure region; regional availability unassessed.`)
  const mark = (id: string, matches: FailureDomain[]) => { if (matches.length) affected[id] = matches }
  for (const [id, region] of regions) mark(id, faults.filter((f) => f.kind === 'region' && f.id === regionKey(region)))
  for (const site of baseline.sites.filter((s) => !embedded.has(s.id))) mark(site.id, faults.filter((f) => f.kind === 'site' && f.id === site.id))
  for (const location of baseline.erLocations ?? []) mark(location.id, faults.filter((f) => f.kind === 'er-location' && f.id === location.id))
  const inherit = (id: string, dependencies: (string | undefined)[]) => mark(id, [...new Map(dependencies.flatMap((id) => id ? affected[id] ?? [] : []).map((f) => [failureKey(f), f])).values()])
  for (const c of baseline.connections) inherit(c.id, [c.hubId, c.siteId, c.spokeId])
  for (const l of baseline.siteLinks) inherit(l.id, [l.a, l.b])
  for (const l of baseline.erLinks ?? []) inherit(l.id, [l.locationId, l.siteId, l.hubId])
  const alive = (item: { id: string }) => !affected[item.id]
  const active = structuredClone(baseline)
  active.hubs = active.hubs.filter(alive)
  active.spokes = active.spokes.filter(alive).map((spoke) => ({
    ...spoke,
    hubId: active.hubs.some((h) => h.id === spoke.hubId) ? spoke.hubId : undefined,
    nvaSpokeIds: spoke.nvaSpokeIds?.filter((id) => !affected[id]),
  }))
  active.sites = active.sites.filter(alive)
  active.connections = active.connections.filter(alive)
  active.siteLinks = active.siteLinks.filter(alive)
  active.erLocations = active.erLocations?.filter(alive).map((l) => ({ ...l, globalReachLocationIds: l.globalReachLocationIds?.filter((id) => !affected[id]) }))
  active.erLinks = active.erLinks?.filter(alive)
  return { active, affected, unassessed, domains: domainList([...regions.values()], baseline.sites.filter((s) => !embedded.has(s.id)), baseline.erLocations ?? []) }
}

export function projectAzFailures(baseline: AzNetTopology, faults: FailureDomain[] = []): FailureProjection<AzNetTopology> {
  const affected: FaultMap = {}, unassessed: string[] = []
  const mark = (id: string, matches: FailureDomain[]) => { if (matches.length) affected[id] = matches }
  for (const node of [...baseline.vnets, ...baseline.vwanHubs]) {
    const region = regionKey(node.region)
    if (!region) unassessed.push(`${node.name}: missing or unrecognized Azure region; regional availability unassessed.`)
    mark(node.id, faults.filter((f) => f.kind === 'region' && f.id === region))
  }
  for (const vnet of baseline.vnets) for (const item of [...vnet.gateways, ...vnet.appliances, ...vnet.subnets, ...(vnet.routeServer ? [vnet.routeServer] : [])]) mark(item.id, affected[vnet.id] ?? [])
  for (const site of baseline.sites) mark(site.id, faults.filter((f) => f.kind === 'site' && f.id === site.id))
  for (const location of baseline.erLocations) mark(location.id, faults.filter((f) => f.kind === 'er-location' && f.id === location.id))
  const inherit = (id: string, dependencies: string[]) => mark(id, [...new Map(dependencies.flatMap((id) => affected[id] ?? []).map((f) => [failureKey(f), f])).values()])
  for (const l of baseline.vnetPeerings) inherit(l.id, [l.vnetAId, l.vnetBId])
  for (const l of baseline.erLinks) inherit(l.id, [l.locationId, l.targetId])
  for (const l of baseline.erGlobalReachLinks ?? []) inherit(l.id, [l.locationAId, l.locationBId])
  for (const l of baseline.vpnConnections) inherit(l.id, [l.siteId, l.targetId])
  for (const l of baseline.siteLinks) inherit(l.id, [l.siteAId, l.siteBId])
  const alive = (item: { id: string }) => !affected[item.id]
  const active = structuredClone(baseline)
  active.vnets = active.vnets.filter(alive).map((vnet) => ({
    ...vnet,
    vwanHubAttachment: vnet.vwanHubAttachment && !affected[vnet.vwanHubAttachment.hubId] ? vnet.vwanHubAttachment : undefined,
  }))
  active.vwanHubs = active.vwanHubs.filter(alive)
  active.sites = active.sites.filter(alive)
  active.erLocations = active.erLocations.filter(alive)
  active.vnetPeerings = active.vnetPeerings.filter(alive)
  active.erLinks = active.erLinks.filter(alive)
  active.erGlobalReachLinks = active.erGlobalReachLinks?.filter(alive)
  active.vpnConnections = active.vpnConnections.filter(alive)
  active.siteLinks = active.siteLinks.filter(alive)
  return { active, affected, unassessed, domains: domainList([...baseline.vnets, ...baseline.vwanHubs].map((n) => n.region), baseline.sites, baseline.erLocations) }
}
