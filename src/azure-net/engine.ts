import { cidr, contains, ipv4 } from '../validation'
import { mappedVpnAddress, translateVpnRoutes, validateVpnNat } from '../vpn-nat'
import { loadBalancerOutboundCandidates, namedEndpoints, natGatewayForSubnet } from '../inventory'
import { resolveHaPortsNextHop, type HaPortsAssessment } from '../ha-ports'
import { chooseVwanHubRoutes, type Candidate } from '../routing'
import { evaluateErSkuRegionalCompatibility, type ErSkuCompatibilityResult } from '../er-locations-catalog'
import { applyAzHubRouteMap, applyAzSiteRouteMap } from './route-maps'
import { peeringPrefixes, peeringSubnetIds, subnetPeeringLimitations, validateSubnetPeeringScopes } from './subnet-peering'
import { ARS_MAX_BGP_PEERS, applyAzArsRouteMap, azArsPeers, azArsPolicyLinks, azArsSpokes } from './ars-route-maps'
import { DEFAULT_HUB_TABLE, hubRouteTables, hubStaticPrefixes, propagatesLocally, propagatesRemotely } from '../hub-routing'
import { azHubAssociation, azHubAttachments, azHubRouting, azHubTableCoverage, azHubVnetExports, azInterHubId } from './hub-routing'
import type { RouteMapDirection, Transport } from '../model'
import type {
  AzAppliance,
  AzArsPreference,
  AzErLocation,
  AzNetTopology,
  AzPeeringDirectionFlags,
  AzSubnet,
  AzUdrNextHopType,
  AzVNet,
  AzVnetPeering,
} from './model'

export function checkErLocationAzureRegionAccess(
  loc: AzErLocation,
  azureRegion: string,
): ErSkuCompatibilityResult {
  return evaluateErSkuRegionalCompatibility(
    loc.sku ?? 'Standard',
    loc.peeringLocation ?? loc.name,
    azureRegion,
  )
}

export type AzRouteSource = 'System' | 'VirtualNetworkGateway' | 'RouteServer' | 'User'

export type AzEffectiveNextHopType =
  | 'VnetLocal'
  | 'VNetPeering'
  | 'VirtualNetworkGateway'
  | 'VirtualAppliance'
  | 'InterfaceEndpoint'
  | 'Internet'
  | 'None'

export interface AzEffectiveRoute {
  id: string
  prefix: string
  source: AzRouteSource
  nextHopType: AzEffectiveNextHopType
  nextHopIp?: string
  nextHopResourceId?: string
  nextHopName?: string
  originLabel: string
  asPath: number[]
  active: boolean
  suppressedReason?: string
  privateEndpointRouteTableEnabled?: boolean
  weight?: number
}

export interface AzBgpRibEntry {
  natOriginalPrefix?: string
  natRuleId?: string
  id: string
  prefix: string
  asPath: number[]
  communities?: string[]
  sourceVnetId?: string
  nextHopName: string
  nextHopIp?: string
  nextHopKind: 'er-location' | 'site' | 'vnet-gateway' | 'appliance' | 'vwan-hub' | 'local' | 'hub-firewall'
  nextHopId: string
  originProtocol: 'ExpressRoute' | 'VPN' | 'BGP-NVA' | 'VNet' | 'InterHub' | 'Static'
  preferred: boolean
  weight?: number
  explanation: string
  advertisedSummaryFrom?: string
  forwardingRoutes?: AzBgpRibEntry[]
  routeMapTrace?: string[]
  connectionId?: string
  originHubTableId?: string
  originHubRouteId?: string
  protectedVnet?: boolean
  hubPath?: string[]
  vpnStatic?: boolean
  hubTransport?: Transport | 'VNet'
  secureOrigin?: boolean
  localPreference?: number
  staticRouteName?: string
}

export interface AzSubnetRouteTableResult {
  vnetId: string
  vnetName: string
  subnetId: string
  subnetName: string
  subnetPrefix: string
  udrTableId?: string
  udrTableName?: string
  bgpPropagationDisabled: boolean
  peeringPropagationDisabled: boolean
  routes: AzEffectiveRoute[]
  suppressedBgpRoutes: AzEffectiveRoute[]
  suppressedPeeringRoutes: AzEffectiveRoute[]
}

export type AzNvaReceivedRoute = Omit<AzBgpRibEntry, 'preferred'> & { selectedByArs: boolean }

export interface AzNvaBgpPeer {
  gatewaySummaryAssessment?: {
    status: 'not-assessed'
    configuredPrefixes: string[]
    gatewayIds: string[]
    gatewaySubnetId?: string
    branchToBranch: boolean
  }
  applianceId: string
  applianceVnetId: string
  routeServerId: string
  routeServerVnetId: string
  connectionId: string
  policyConnectionId?: string
  state: 'available' | 'ars-disabled' | 'bgp-disabled' | 'unsupported-asn' | 'unsupported-appliance'
    | 'unreachable' | 'subnet-peering-not-assessed'
  routes: AzNvaReceivedRoute[]
}

export interface AzSimulationResult {
  controlPlaneComplete?: boolean
  subnetTables: Record<string, AzSubnetRouteTableResult>
  gatewayRibs: Record<string, AzBgpRibEntry[]>
  routeServerRibs: Record<string, AzBgpRibEntry[]>
  routeServerInbound?: Record<string, Record<string, AzBgpRibEntry[]>>
  routeServerOutbound?: Record<string, Record<string, AzBgpRibEntry[]>>
  nvaBgpPeers?: Record<string, AzNvaBgpPeer[]>
  vwanHubRibs: Record<string, AzBgpRibEntry[]>
  vwanFirewallRibs: Record<string, AzBgpRibEntry[]>
  vwanHubTables: Record<string, Record<string, AzBgpRibEntry[]>>
  vwanHubTableCoverage: ReturnType<typeof azHubTableCoverage>
  erLocationRibs: Record<string, AzBgpRibEntry[]>
  siteRibs: Record<string, AzBgpRibEntry[]>
  warnings: string[]
}

export type AzEndpointRef =
  | { kind: 'subnet'; vnetId: string; subnetId: string }
  | { kind: 'site'; siteId: string }
  | { kind: 'vwanHub'; hubId: string }
  | { kind: 'internet'; ip?: string }

export interface AzTraceHop {
  index: number
  nodeKind: 'subnet' | 'vnet-gateway' | 'route-server' | 'appliance' | 'vwan-hub' | 'er-location' | 'site' | 'internet'
  nodeId: string
  vnetId?: string
  nodeName: string
  subnetId?: string
  subnetName?: string
  action:
    | 'origin'
    | 'subnet-lookup'
    | 'peering-cross'
    | 'inspect-firewall'
    | 'inspect-nva'
    | 'vnra-transit'
    | 'gateway-transit'
    | 'vwan-transit'
    | 'er-transit'
    | 'delivered'
    | 'dropped'
    | 'loop'
  detail: string
  matchedRoute?: AzEffectiveRoute
  edgeId?: string
  hubTableId?: string
  haPorts?: HaPortsAssessment
}

export type AzTraceStatus =
  | 'delivered'
  | 'dropped-blackhole'
  | 'dropped-no-route'
  | 'dropped-no-outbound-access'
  | 'dropped-peering-access'
  | 'dropped-peering-forwarded-traffic'
  | 'dropped-peering-non-transitive'
  | 'dropped-ip-forwarding-disabled'
  | 'loop'
  | 'not-assessed'

export interface AzFlowTrace {
  source: AzEndpointRef
  destinationIp: string
  destinationLabel: string
  status: AzTraceStatus
  hops: AzTraceHop[]
  traversedApplianceIds: string[]
  traversedEdgeIds: string[]
  traversedVnetIds: string[]
  summaryReason: string
}

export interface AzPairFlowAnalysis {
  forward: AzFlowTrace
  reverse: AzFlowTrace
  symmetricInspection: boolean
  asymmetricBypassApplianceNames: string[]
}

function isPrivateAsn(asn: number): boolean {
  return (asn >= 64512 && asn <= 65534) || (asn >= 4200000000 && asn <= 4294967294)
}

export function stripPrivateAsnsForMsee(asPath: number[]): number[] {
  return asPath.filter((asn) => !isPrivateAsn(asn))
}

function mseeAdvertisedAsPath(route: AzBgpRibEntry, standaloneGateway = false): number[] {
  if (route.nextHopKind !== 'vnet-gateway') return route.asPath
  // Azure-originated routes retain 65515 at MSEE; standalone gateway hairpins add two 12076 hops.
  return [...(standaloneGateway ? [12076, 12076] : [12076]), ...stripPrivateAsnsForMsee(route.asPath)]
}

export function firstUsableIp(prefix: string): string {
  const parsed = cidr(prefix)
  if (!parsed) return '0.0.0.0'
  const ipNum = parsed.length >= 31 ? parsed.network : (parsed.network + 4) >>> 0
  return [
    (ipNum >>> 24) & 255,
    (ipNum >>> 16) & 255,
    (ipNum >>> 8) & 255,
    ipNum & 255,
  ].join('.')
}

export function findApplianceByIp(topology: AzNetTopology, ip?: string): { vnet: AzVNet; appliance: AzAppliance } | undefined {
  if (!ip) return undefined
  for (const vnet of topology.vnets) {
    for (const appliance of vnet.appliances) {
      if (appliance.privateIp === ip) {
        return { vnet, appliance }
      }
    }
  }
  return undefined
}

export function getActivePeeringBetween(
  topology: AzNetTopology,
  fromVnetId: string,
  toVnetId: string,
): { peering: AzVnetPeering; forwardFlags: AzPeeringDirectionFlags; reverseFlags: AzPeeringDirectionFlags } | undefined {
  for (const peering of topology.vnetPeerings) {
    if (!peering.enabled) continue
    if (peering.vnetAId === fromVnetId && peering.vnetBId === toVnetId) {
      return { peering, forwardFlags: peering.aToB, reverseFlags: peering.bToA }
    }
    if (peering.vnetBId === fromVnetId && peering.vnetAId === toVnetId) {
      return { peering, forwardFlags: peering.bToA, reverseFlags: peering.aToB }
    }
  }
  return undefined
}

function chooseBgpWinners(
  entries: AzBgpRibEntry[],
  preference: AzArsPreference | 'VPN',
  siteSelection = false,
): AzBgpRibEntry[] {
  const byPrefix = new Map<string, AzBgpRibEntry[]>()
  for (const entry of entries) {
    const list = byPrefix.get(entry.prefix) ?? []
    list.push(entry)
    byPrefix.set(entry.prefix, list)
  }

  const normalizedPref: AzArsPreference = preference === 'VPN' ? 'VpnGateway' : preference

  const protocolRank = (entry: AzBgpRibEntry): number => {
    if (entry.originProtocol === 'VNet') return 0
    if (normalizedPref === 'ASPath') {
      return 1
    }
    if (normalizedPref === 'VpnGateway') {
      if (entry.originProtocol === 'VPN' || entry.originProtocol === 'BGP-NVA') return 1
      if (entry.originProtocol === 'ExpressRoute') return 2
      return 3
    }
    // Default ExpressRoute preference
    if (entry.originProtocol === 'ExpressRoute') return 1
    if (entry.originProtocol === 'VPN' || entry.originProtocol === 'BGP-NVA') return 2
    return 3
  }

  const output: AzBgpRibEntry[] = []
  for (const [, candidates] of byPrefix) {
    const rank = (route: AzBgpRibEntry) => siteSelection && route.nextHopKind === 'local' ? -1 : protocolRank(route)
    const minProto = Math.min(...candidates.map(rank))
    const protoFiltered = candidates.filter((c) => rank(c) === minProto)
    const maxLocalPreference = Math.max(...protoFiltered.map((route) => siteSelection ? route.localPreference ?? 100 : 100))
    const preferenceFiltered = protoFiltered.filter((route) => !siteSelection || (route.localPreference ?? 100) === maxLocalPreference)
    const maxWeight = Math.max(...preferenceFiltered.map((c) => c.weight ?? 0))
    const weightFiltered = preferenceFiltered.filter((c) => (c.weight ?? 0) === maxWeight)
    const minAsLen = Math.min(...weightFiltered.map((c) => c.asPath.length))
    const winners = new Set(
      weightFiltered.filter((c) => c.asPath.length === minAsLen).map((c) => c.id),
    )

    for (const c of candidates) {
      const isWinner = winners.has(c.id)
      let explanation = 'Selected as best BGP route'
      if (!isWinner) {
        if (rank(c) > minProto) {
          explanation = `Not preferred under routing preference (${normalizedPref})`
        } else if (siteSelection && (c.localPreference ?? 100) < maxLocalPreference) {
          explanation = `Lower site local preference (${c.localPreference ?? 100} < ${maxLocalPreference})`
        } else if ((c.weight ?? 0) < maxWeight) {
          explanation = `Lower ExpressRoute link weight (${c.weight ?? 0} < ${maxWeight})`
        } else {
          explanation = `Longer AS path (${c.asPath.length} > ${minAsLen} hops)`
        }
      } else if (candidates.length > 1) {
        explanation =
          normalizedPref === 'ASPath'
            ? `Won via shortest AS path (${minAsLen} hops)`
            : `Won via ${normalizedPref} routing preference (AS path len ${minAsLen})`
      }
      if (c.advertisedSummaryFrom) explanation += ` · Advertised gateway summary from ${c.advertisedSummaryFrom}; not a local forwarding route`
      if (c.routeMapTrace?.length) explanation += ` · ${c.routeMapTrace.join('; ')}`
      output.push({ ...c, preferred: isWinner, explanation })
    }
  }
  return output.sort((a, b) => {
    const ca = cidr(a.prefix)
    const cb = cidr(b.prefix)
    if (ca && cb && ca.network !== cb.network) return ca.network - cb.network
    if (ca && cb && ca.length !== cb.length) return ca.length - cb.length
    return Number(b.preferred) - Number(a.preferred)
  })
}

function chooseHubWinners(hub: { id: string; preference: 'ExpressRoute' | 'VPN' | 'ASPath' }, entries: AzBgpRibEntry[]): AzBgpRibEntry[] {
  return [...new Set(entries.map((route) => route.prefix))].flatMap((prefix) => {
    const routes = entries.filter((route) => route.prefix === prefix)
    const candidates = routes.map((route): Candidate => ({
      key: route.id, prefix, asPath: route.asPath, weight: route.weight,
      kind: route.nextHopKind === 'hub-firewall' ? 'hub-static' : route.originProtocol === 'VNet' ? 'system' : route.vpnStatic ? 'vpn-static' : 'bgp',
      transport: route.nextHopKind === 'hub-firewall' ? 'Firewall' : route.hubTransport ?? (route.originProtocol === 'VNet' ? 'VNet' : route.originProtocol === 'BGP-NVA' ? 'SpokeNVA' : route.originProtocol === 'VPN' ? 'VPN' : 'ExpressRoute'),
      connectionId: route.connectionId ?? '', siteId: '', originHubId: route.originHubTableId ? route.nextHopId : hub.id,
      remote: Boolean(route.originHubTableId), secureOrigin: route.secureOrigin,
    }))
    const decision = chooseVwanHubRoutes(hub, prefix, candidates)
    const selected = new Set(decision.selected.map((route) => route.key))
    return routes.map((route) => ({
      ...route, preferred: selected.has(route.id),
      explanation: `${selected.has(route.id) ? 'Selected' : 'Not selected'}: ${decision.explanation.join(' ')}${route.routeMapTrace?.length ? ` · ${route.routeMapTrace.join('; ')}` : ''}`,
    }))
  })
}

function hubAdvertisements(
  topology: AzNetTopology, hubId: string, connectionId: string, routes: AzBgpRibEntry[],
  propagateDefault: boolean | undefined, branch: boolean,
): AzBgpRibEntry[] {
  const hub = topology.vwanHubs.find((hub) => hub.id === hubId)!
  const selected = routes.filter((route) => route.preferred && (propagateDefault || route.prefix !== '0.0.0.0/0')
    && (!branch || topology.allowBranchToBranchTraffic !== false || route.originProtocol === 'VNet' || route.hubTransport === 'VNet' || route.nextHopKind === 'hub-firewall'))
  if (propagateDefault && hub.routingIntent.internet) {
    selected.splice(0, selected.length, ...selected.filter((route) => route.prefix !== '0.0.0.0/0'), {
      id: `hub-internet:${hubId}:${connectionId}`, prefix: '0.0.0.0/0', asPath: [], nextHopName: hub.name,
      nextHopKind: 'local', nextHopId: hubId, originProtocol: 'Static', hubTransport: 'VNet', preferred: true,
      explanation: 'Internet routing intent default advertisement; not a NAT or delivery assessment',
    })
  }
  const er = topology.erLinks.some((link) => link.id === connectionId)
  const before = selected.map((route) => ({ ...route, asPath: er ? route.asPath : [65515, ...route.asPath] }))
  return [
    ...applyAzHubRouteMap(topology, hubId, connectionId, 'outbound', before.filter((route) => !route.vpnStatic)),
    ...before.filter((route) => route.vpnStatic),
  ]
}

export function simulateAzNet(topology: AzNetTopology): AzSimulationResult {
  validateVpnNat(topology)
  let result = simulateAzNetPass(topology)
  if (!topology.vwanHubs.length && !topology.routeMaps?.some((map) => map.siteId && map.rules.some((rule) => rule.localPreference !== undefined))) return result
  const signature = (value: AzSimulationResult) => JSON.stringify([value.vwanHubTables, value.erLocationRibs, value.siteRibs])
  const seen = new Set([signature(result)])
  for (let round = 0; round < 64; round++) {
    const next = simulateAzNetPass(topology, result)
    const key = signature(next)
    if (key === signature(result)) return next
    if (seen.has(key)) break
    seen.add(key)
    result = next
  }
  const reason = 'Mixed hub/site advertisements did not converge; reachability and isolation are not established.'
  for (const tables of Object.values(result.vwanHubTableCoverage)) for (const coverage of Object.values(tables)) {
    coverage.complete = false
    coverage.limitations = [...coverage.limitations, reason]
  }
  return { ...result, controlPlaneComplete: false, warnings: [...result.warnings, reason] }
}

function simulateAzNetPass(topology: AzNetTopology, previous?: AzSimulationResult): AzSimulationResult {
  const peeringLimitations = [...validateSubnetPeeringScopes(topology), ...subnetPeeringLimitations(topology)]
  const warnings: string[] = [...peeringLimitations]
  const siteRibs: Record<string, AzBgpRibEntry[]> = {}
  const erLocationRibs: Record<string, AzBgpRibEntry[]> = {}
  const gatewayRibs: Record<string, AzBgpRibEntry[]> = {}
  const routeServerRibs: Record<string, AzBgpRibEntry[]> = {}
  const routeServerInbound: Record<string, Record<string, AzBgpRibEntry[]>> = {}
  const routeServerOutbound: Record<string, Record<string, AzBgpRibEntry[]>> = {}
  const nvaBgpPeers: Record<string, AzNvaBgpPeer[]> = {}
  const vwanHubRibs: Record<string, AzBgpRibEntry[]> = {}
  const vwanHubTables: Record<string, Record<string, AzBgpRibEntry[]>> = {}
  const vwanHubTableCoverage = azHubTableCoverage(topology)
  const sitePolicy = (siteId: string, connectionId: string, direction: RouteMapDirection, routes: AzBgpRibEntry[]) => {
    const result = applyAzSiteRouteMap(topology, siteId, connectionId, direction, routes)
    const filtered = routes.filter((route) => !result.some((candidate) =>
      candidate.prefix === route.prefix || candidate.forwardingRoutes?.some((child) => child.prefix === route.prefix)))
    if (filtered.length) {
      const name = topology.sites.find((site) => site.id === siteId)?.name ?? siteId
      const warning = `Site route map (${direction}) at ${name} on ${connectionId} filtered: ${[...new Set(filtered.map((route) => route.prefix))].join(', ')}.`
      if (!warnings.includes(warning)) warnings.push(warning)
    }
    return result
  }

  // 1. Seed On-Premises Sites and propagate across siteLinks
  for (const site of topology.sites) {
    siteRibs[site.id] = site.prefixes.map((prefix) => ({
      id: `site-seed:${site.id}:${prefix}`,
      prefix,
      asPath: [site.asn],
      nextHopName: site.name,
      nextHopKind: 'local',
      nextHopId: site.id,
      originProtocol: 'Static',
      preferred: true,
      explanation: `Originated locally at ${site.name} (AS ${site.asn})`,
    }))
  }
  const initialSiteRibs = structuredClone(siteRibs)
  const siteFeedback = topology.routeMaps?.some((map) => map.siteId && map.rules.some((rule) => rule.localPreference !== undefined))
  if (siteFeedback && previous) for (const site of topology.sites) siteRibs[site.id] = structuredClone(previous.siteRibs[site.id])

  const propagateSiteLinks = () => {
    for (let round = 0; round < Math.max(1, topology.sites.length); round++) {
      let changed = false
      for (const link of topology.siteLinks) {
        if (!link.enabled) continue
        const siteA = topology.sites.find((s) => s.id === link.siteAId)
        const siteB = topology.sites.find((s) => s.id === link.siteBId)
        if (!siteA || !siteB) continue
        for (const [sender, receiver] of [[siteA, siteB], [siteB, siteA]] as const) {
          const current = sitePolicy(sender.id, link.id, 'outbound', siteRibs[sender.id]?.filter((r) => r.preferred) ?? [])
          const received = sitePolicy(receiver.id, link.id, 'inbound', current.filter((r) => !r.asPath.includes(receiver.asn)))
          for (const r of received) {
            const id = `sitelink:${link.id}:${sender.id}->${receiver.id}:${r.prefix}`
            const existing = siteRibs[receiver.id].findIndex((entry) => entry.id === id)
            if (existing < 0 || (siteFeedback
              ? JSON.stringify([siteRibs[receiver.id][existing].asPath, siteRibs[receiver.id][existing].localPreference])
                !== JSON.stringify([[receiver.asn, ...r.asPath], r.localPreference])
              : siteRibs[receiver.id][existing].asPath.length > r.asPath.length + 1)) {
              const candidate: AzBgpRibEntry = {
                ...r,
                id,
                connectionId: link.id,
                prefix: r.prefix,
                asPath: [receiver.asn, ...r.asPath],
                nextHopName: sender.name,
                nextHopKind: 'site',
                nextHopId: sender.id,
                originProtocol: 'VPN',
                preferred: false,
                explanation: `Learned over site link ${link.name} from ${sender.name}`,
              }
              if (existing < 0) siteRibs[receiver.id].push(candidate)
              else siteRibs[receiver.id][existing] = candidate
              changed = true
            }
          }
        }
      }
      for (const site of topology.sites) siteRibs[site.id] = chooseBgpWinners(siteRibs[site.id], 'ASPath', true)
      if (!changed) break
    }
  }
  propagateSiteLinks()

  const peerInputs = new Map<string, Record<string, AzBgpRibEntry[]>>()
  const receivedPeerRoutes = (vnet: AzVNet) => {
    const ars = vnet.routeServer!
    const cached = peerInputs.get(ars.id)
    if (cached) return cached
    const groups: Record<string, AzBgpRibEntry[]> = {}
    for (const spoke of azArsSpokes(vnet, topology).filter((spoke) => spoke.active)) {
      groups[`vnet:${spoke.vnet.id}`] = spoke.vnet.prefixes.map((prefix) => ({
        id: `ars:${ars.id}:spoke:${spoke.vnet.id}:${prefix}`, prefix, asPath: [65515],
        sourceVnetId: spoke.vnet.id, nextHopName: `${spoke.vnet.name} (On-link)`, nextHopKind: 'local',
        nextHopId: spoke.vnet.id, originProtocol: 'VNet', preferred: true,
        explanation: 'Spoke address space received on the virtual network connection',
      }))
    }
    for (const { host, peer: app, connectionId } of azArsPeers(vnet, topology)) {
      if (!app.bgpEnabled || !app.enableIpForwarding) continue
      const appAsn = app.asn ?? 65501
      if (appAsn === 65515 || appAsn === 12076) continue
      const entries = groups[connectionId] ??= []
      for (const prefix of app.advertisedPrefixes ?? []) {
        const attributes = app.advertisedRouteAttributes?.find((attributes) => attributes.prefix === prefix)
        const asPath = [appAsn, ...(attributes?.asPath ?? [])]
        if (asPath.includes(65515)) continue
        entries.push({
          id: `ars:${ars.id}:nva:${app.id}:${prefix}`, prefix, asPath,
          ...(attributes?.communities ? { communities: [...attributes.communities] } : {}), sourceVnetId: host.id,
          nextHopName: `${app.name} (${app.privateIp})`, nextHopIp: app.privateIp, nextHopKind: 'appliance',
          nextHopId: app.id, originProtocol: 'BGP-NVA', preferred: true,
          explanation: `Learned by Azure Route Server ${ars.name} from BGP NVA peer ${app.name} (${app.privateIp}, AS ${appAsn})`,
        })
      }
      for (const conn of topology.vpnConnections.filter((connection) => connection.enabled && connection.targetKind === 'appliance' && connection.targetId === app.id)) {
        const site = topology.sites.find((site) => site.id === conn.siteId)
        if (!site) continue
        for (const route of sitePolicy(site.id, conn.id, 'outbound', (siteRibs[site.id] ?? []).filter((route) => route.preferred))) {
          if (route.asPath.includes(appAsn) || route.asPath.includes(65515) || entries.some((entry) => entry.prefix === route.prefix && entry.nextHopId === app.id)) continue
          entries.push({
            ...route, id: `ars:${ars.id}:nva-vpn:${app.id}:${conn.id}:${route.prefix}`, connectionId: conn.id,
            asPath: [appAsn, ...route.asPath], sourceVnetId: host.id, nextHopName: `${app.name} (${app.privateIp}) → ${site.name}`,
            nextHopIp: app.privateIp, nextHopKind: 'appliance', nextHopId: app.id, originProtocol: 'BGP-NVA',
            explanation: `Learned by ARS ${ars.name} from ${app.name} via overlay tunnel ${conn.name}`,
          })
        }
      }
    }
    for (const [id, routes] of Object.entries(groups)) groups[id] = applyAzArsRouteMap(ars, id, 'inbound', routes)
    peerInputs.set(ars.id, groups)
    return groups
  }
  type VnetAdvertisement = {
    prefix: string; asPath: number[]; communities?: string[]; sourceName: string; advertisedSummaryFrom?: string; protectedVnet?: boolean; routeMapTrace?: string[]; nvaRoute?: boolean
  }
  const connectedVnetPrefixes = (vnet: AzVNet, processSpokes = true): VnetAdvertisement[] => {
    const result: VnetAdvertisement[] = vnet.prefixes.map((prefix) => ({
      prefix,
      asPath: [65515],
      sourceName: vnet.name,
      protectedVnet: true,
    }))
    // Include peered spokes that have allowGatewayTransit (from this hub) + useRemoteGateways (from spoke)
    // Azure rules: hub must have an enabled Gateway/ARS, and spoke cannot have its own Gateway/ARS.
    const hubHasGatewayOrArs = vnet.gateways.some((g) => g.enabled) || Boolean(vnet.routeServer?.enabled)
    for (const other of topology.vnets) {
      if (other.id === vnet.id) continue
      const rel = getActivePeeringBetween(topology, vnet.id, other.id)
      if (!rel) continue
      if (rel.peering.scope?.type === 'subnets') continue
      if (
        rel.forwardFlags.allowVirtualNetworkAccess &&
        rel.reverseFlags.allowVirtualNetworkAccess &&
        rel.forwardFlags.allowGatewayTransit &&
        rel.reverseFlags.useRemoteGateways
      ) {
        const spokeHasLocalGatewayOrArs =
          other.gateways.some((g) => g.enabled) || Boolean(other.routeServer?.enabled)
        if (!hubHasGatewayOrArs) {
          warnings.push(
            `Peering "${rel.peering.name}": "${vnet.name}" sets allowGatewayTransit=true, but "${vnet.name}" has no enabled Virtual Network Gateway or Route Server.`,
          )
          continue
        }
        if (spokeHasLocalGatewayOrArs) {
          warnings.push(
            `Peering "${rel.peering.name}": "${other.name}" sets useRemoteGateways=true while also hosting its own Virtual Network Gateway or Route Server. Azure blocks useRemoteGateways when a local gateway/ARS exists.`,
          )
          continue
        }
        if (vnet.routeServer?.enabled && processSpokes) {
          result.push(...(receivedPeerRoutes(vnet)[`vnet:${other.id}`] ?? []).filter((route) => route.originProtocol === 'VNet')
            .map((route) => ({ ...route, sourceName: `${other.name} (via Gateway Transit)` })))
        } else for (const p of other.prefixes) result.push({ prefix: p, asPath: [65515], sourceName: `${other.name} (via Gateway Transit)` })
      }
    }
    return result
  }
  const advertisedVnetPrefixes = (vnet: AzVNet, connectionId: string): VnetAdvertisement[] => {
    const peerOutbound = vnet.routeServer?.enabled && connectionId.startsWith('nva:')
      ? routeServerOutbound[vnet.routeServer.id]?.[connectionId] : undefined
    if (peerOutbound) return peerOutbound.map((route) => ({
      ...route, sourceName: route.nextHopName, asPath: route.originProtocol === 'VNet' ? route.asPath : [65515, ...route.asPath],
    }))
    let result = connectedVnetPrefixes(vnet)
    const summaries = connectionId.startsWith('gateway:') && vnet.gateways.some((g) => g.enabled) && vnet.subnets.some((s) => s.name === 'GatewaySubnet')
      ? (vnet.summarizedGatewayPrefixes ?? []).filter((prefix) => typeof prefix === 'string' && cidr(prefix))
      : []
    if (summaries.length) {
      result = [
        ...summaries.map((prefix) => ({ prefix, asPath: [65515], sourceName: `${vnet.name} (Advertised gateway summary)`, advertisedSummaryFrom: vnet.name, protectedVnet: true })),
        ...result.filter((route) => {
          const prefix = cidr(route.prefix)
          return !prefix || !summaries.some((summary) => cidr(summary)!.length <= prefix.length && contains(summary, prefix.network))
        }),
      ]
    }
    // Summaries replace VNet address-space advertisements, not NVA routes learned through ARS.
    // If ARS is present with branchToBranchTraffic, include NVA-advertised BGP prefixes
    if (vnet.routeServer?.enabled && vnet.routeServer.branchToBranchTraffic) {
      const received = chooseBgpWinners(Object.values(receivedPeerRoutes(vnet)).flat().filter((route) => route.originProtocol === 'BGP-NVA'), vnet.routeServer.hubRoutingPreference)
      result.push(...received.filter((route) => route.preferred).map((route) => ({
        ...route, nvaRoute: true, sourceName: `${route.nextHopName} (via ARS Branch-to-Branch)`,
      })))
    }
    const advertised = vnet.routeServer?.enabled ? applyAzArsRouteMap(vnet.routeServer, connectionId, 'outbound', result) : result
    return advertised.map((route) => route.nvaRoute ? { ...route, asPath: [65515, ...route.asPath] } : route)
  }

  // 2. Populate ExpressRoute Locations (MSEE) from connected Sites, VNet ER Gateways, and vWAN Hubs
  for (const loc of topology.erLocations) {
    const entries: AzBgpRibEntry[] = []
    const attachedLinks = topology.erLinks.filter((l) => l.enabled && l.locationId === loc.id)
    for (const link of attachedLinks) {
      if (link.targetKind === 'site') {
        const site = topology.sites.find((s) => s.id === link.targetId)
        if (!site) continue
        const siteRoutes = sitePolicy(site.id, link.id, 'outbound', (siteRibs[site.id] ?? []).filter((r) => r.preferred))
        for (const sr of siteRoutes) {
          const stripped = stripPrivateAsnsForMsee(sr.asPath)
          const prepended = stripPrivateAsnsForMsee(link.prepend ?? [])
          entries.push({
            ...sr,
            id: `erloc:${loc.id}:site:${link.id}:${sr.prefix}`,
            connectionId: link.id,
            prefix: sr.prefix,
            asPath: [12076, ...prepended, ...(stripped.length ? stripped : [site.asn])],
            nextHopName: `${site.name} (${link.name})`,
            nextHopKind: 'site',
            nextHopId: site.id,
            originProtocol: 'ExpressRoute',
            preferred: true,
            weight: link.weight ?? 0,
            explanation: `Advertised by on-premises site ${site.name} to MSEE ${loc.name} (private ASNs stripped by MSEE)`,
          })
        }
      } else if (link.targetKind === 'vnet-gateway') {
        const ownerVnet = topology.vnets.find((v) => v.gateways.some((g) => g.id === link.targetId && g.enabled && g.kind === 'ExpressRoute'))
        const gw = ownerVnet?.gateways.find((g) => g.id === link.targetId)
        if (!ownerVnet || !gw) continue
        const skuCompat = checkErLocationAzureRegionAccess(loc, ownerVnet.region)
        if (!skuCompat.allowed) {
          warnings.push(
            `ExpressRoute circuit "${loc.name}" (${loc.sku ?? 'Standard'} SKU) cannot link to ExpressRoute Gateway "${gw.name}" in "${ownerVnet.name}" (${ownerVnet.region}): ${skuCompat.reason}`,
          )
          continue
        }
        for (const adv of advertisedVnetPrefixes(ownerVnet, `gateway:${gw.id}`)) {
          entries.push({
            id: `erloc:${loc.id}:vng:${link.id}:${adv.prefix}`,
            prefix: adv.prefix,
            asPath: adv.asPath,
            nextHopName: `${gw.name} (${ownerVnet.name})`,
            nextHopKind: 'vnet-gateway',
            nextHopId: gw.id,
            originProtocol: 'ExpressRoute',
            preferred: true,
            weight: link.weight ?? 0,
            explanation: `Advertised by ${gw.name} from ${adv.sourceName}`,
            advertisedSummaryFrom: adv.advertisedSummaryFrom,
            routeMapTrace: adv.routeMapTrace,
            communities: adv.communities,
          })
        }
      } else if (link.targetKind === 'vwan-hub') {
        const hub = topology.vwanHubs.find((h) => h.id === link.targetId)
        if (!hub) continue
        const skuCompat = checkErLocationAzureRegionAccess(loc, hub.region)
        if (!skuCompat.allowed) {
          warnings.push(
            `ExpressRoute circuit "${loc.name}" (${loc.sku ?? 'Standard'} SKU) cannot link to Virtual WAN Hub "${hub.name}" (${hub.region}): ${skuCompat.reason}`,
          )
          continue
        }
        const seeds = azHubVnetExports(topology, hub, link.hubRouting).flatMap((vnet) =>
          applyAzHubRouteMap(topology, hub.id, vnet.id, 'inbound', vnet.prefixes.map((prefix): AzBgpRibEntry => ({
            id: `vhub:${hub.id}:vnet:${vnet.id}:${prefix}`, prefix, asPath: [], nextHopName: vnet.name,
            nextHopKind: 'local', nextHopId: vnet.id, originProtocol: 'VNet', preferred: true,
            connectionId: `vhub-attach:${vnet.id}:${hub.id}`, explanation: `Directly attached VNet ${vnet.name}`,
          }))))
        const routes = previous?.vwanHubTables[hub.id]?.[azHubAssociation(link.hubRouting)] ?? seeds
        const exported = hubAdvertisements(topology, hub.id, link.id,
          routes.filter((route) => !route.vpnStatic && route.connectionId !== link.id), link.propagateDefaultRoute, true)
        for (const route of exported) {
            entries.push({
              ...route,
              id: `erloc:${loc.id}:vhub:${link.id}:${route.nextHopId}:${route.prefix}`,
              connectionId: link.id,
              asPath: [12076, ...stripPrivateAsnsForMsee(route.asPath)],
              hubPath: [...new Set([...(route.hubPath ?? []), hub.id])],
              nextHopName: `${hub.name} (${link.name})`,
              nextHopKind: 'vwan-hub',
              nextHopId: hub.id,
              originProtocol: 'ExpressRoute',
              preferred: true,
              weight: link.weight ?? 0,
              explanation: `Advertised by Virtual WAN hub ${hub.name} from associated table ${azHubAssociation(link.hubRouting)}`,
            })
        }
      }
    }
    erLocationRibs[loc.id] = chooseBgpWinners(entries, 'ASPath')
  }

  // 2b. Propagate On-Premises Site routes across ExpressRoute Global Reach circuit-to-circuit links
  for (let round = 0; round < 4; round++) {
    for (const grLink of topology.erGlobalReachLinks ?? []) {
      if (!grLink.enabled) continue
      const locA = topology.erLocations.find((l) => l.id === grLink.locationAId)
      const locB = topology.erLocations.find((l) => l.id === grLink.locationBId)
      if (!locA || !locB) continue
      for (const [srcLoc, dstLoc] of [
        [locA, locB],
        [locB, locA],
      ] as const) {
        const srcSiteRoutes = (erLocationRibs[srcLoc.id] ?? []).filter(
          (r) =>
            r.preferred &&
            (r.nextHopKind === 'site' ||
              (r.nextHopKind === 'er-location' && !r.id.includes(`:${dstLoc.id}:`))),
        )
        for (const sr of srcSiteRoutes) {
          const id = `erloc-gr:${grLink.id}:${srcLoc.id}->${dstLoc.id}:${sr.prefix}`
          if (!erLocationRibs[dstLoc.id].some((existing) => existing.id === id)) {
            erLocationRibs[dstLoc.id].push({
              ...sr,
              id,
              prefix: sr.prefix,
              asPath: [12076, ...sr.asPath],
              nextHopName: `${srcLoc.name} via Global Reach (${grLink.name}) → ${sr.nextHopName}`,
              nextHopKind: 'er-location',
              nextHopId: srcLoc.id,
              originProtocol: 'ExpressRoute',
              preferred: false,
              weight: sr.weight ?? 0,
              explanation: `Learned over ExpressRoute Global Reach link "${grLink.name}" from ${srcLoc.name} (${sr.nextHopName})`,
            })
          }
        }
      }
    }
    for (const loc of topology.erLocations) {
      erLocationRibs[loc.id] = chooseBgpWinners(erLocationRibs[loc.id], 'ASPath')
    }
  }

  // 3. Populate Standalone VNet Gateways (ExpressRoute & VPN)
  for (const vnet of topology.vnets) {
    for (const gw of vnet.gateways) {
      if (!gw.enabled) {
        gatewayRibs[gw.id] = []
        continue
      }
      const entries: AzBgpRibEntry[] = []
      if (gw.kind === 'ExpressRoute') {
        const erLinks = topology.erLinks.filter(
          (l) => l.enabled && l.targetKind === 'vnet-gateway' && l.targetId === gw.id,
        )
        for (const link of erLinks) {
          const loc = topology.erLocations.find((l) => l.id === link.locationId)
          if (!loc) continue
          if (!checkErLocationAzureRegionAccess(loc, vnet.region).allowed) continue
          const locRoutes = (erLocationRibs[loc.id] ?? []).filter(
            (r) =>
              r.preferred &&
              !(r.nextHopKind === 'vnet-gateway' && r.nextHopId === gw.id) &&
              r.nextHopKind !== 'er-location',
          )
          for (const lr of locRoutes) {
            // Standalone ExpressRoute VNet Gateways connected to the same ExpressRoute circuit (MSEE) always
            // exchange VNet/spoke routes via MSEE ASN 12076; Virtual WAN Hub inter-hub ER transit requires Global Reach
            const isVwanToAzure = lr.nextHopKind === 'vwan-hub'
            if (isVwanToAzure && !loc.globalReachEnabled) continue
            entries.push({
              ...lr,
              id: `gw:${gw.id}:er:${link.id}:${lr.prefix}:${lr.nextHopId}`,
              connectionId: link.id,
              prefix: lr.prefix,
              asPath: mseeAdvertisedAsPath(lr, true),
              nextHopName: `${loc.name} → ${lr.nextHopName}`,
              nextHopKind: lr.nextHopKind,
              nextHopId: lr.nextHopId,
              originProtocol: 'ExpressRoute',
              preferred: true,
              weight: link.weight ?? 0,
              explanation: `Learned via ExpressRoute connection ${link.name} at ${loc.name}`,
              advertisedSummaryFrom: lr.advertisedSummaryFrom,
            })
          }
        }
      } else {
        // VPN Gateway
        const vpnConns = topology.vpnConnections.filter(
          (c) => c.enabled && c.targetKind === 'vnet-gateway' && c.targetId === gw.id,
        )
        for (const conn of vpnConns) {
          const site = topology.sites.find((s) => s.id === conn.siteId)
          if (!site) continue
          if (conn.bgpEnabled && gw.bgpEnabled) {
            const siteRoutes = translateVpnRoutes(topology, conn,
              sitePolicy(site.id, conn.id, 'outbound', (siteRibs[site.id] ?? []).filter((r) => r.preferred)), 'IngressSNAT')
            for (const sr of siteRoutes) {
              entries.push({
                ...sr,
                id: `gw:${gw.id}:vpn:${conn.id}:${sr.prefix}`,
                connectionId: conn.id,
                prefix: sr.prefix,
                asPath: [...(conn.inboundPrepend ?? []), ...sr.asPath],
                nextHopName: `${site.name} (${conn.name})`,
                nextHopKind: 'site',
                nextHopId: site.id,
                originProtocol: 'VPN',
                preferred: true,
                explanation: `Learned via BGP over S2S VPN ${conn.name} from ${site.name}${sr.natOriginalPrefix ? `. ${sr.explanation}` : ''}`,
              })
            }
          } else {
            const statics = conn.staticPrefixes?.length ? conn.staticPrefixes : site.prefixes
            for (const prefix of statics) {
              entries.push({
                id: `gw:${gw.id}:vpn-static:${conn.id}:${prefix}`,
                connectionId: conn.id,
                prefix,
                asPath: [],
                nextHopName: `${site.name} (${conn.name})`,
                nextHopKind: 'site',
                nextHopId: site.id,
                originProtocol: 'VPN',
                preferred: true,
                explanation: `Static S2S VPN route via ${conn.name} to ${site.name}`,
              })
            }
          }
        }
      }
      gatewayRibs[gw.id] = chooseBgpWinners(entries, 'ExpressRoute')
    }
  }

  // 4. Populate Azure Route Servers (ARS) and exchange with Gateways when branchToBranchTraffic is enabled
  for (const vnet of topology.vnets) {
    const ars = vnet.routeServer
    if (!ars) continue
    const resolvedPeers = azArsPeers(vnet, topology)
    const policyLinks = azArsPolicyLinks(vnet, topology)
    const peerViews: AzNvaBgpPeer[] = []
    for (const id of new Set(ars.peerApplianceIds)) {
      const owner = topology.vnets.find((host) => host.appliances.some((app) => app.id === id))
      const app = owner?.appliances.find((app) => app.id === id)
      if (!owner || !app) continue
      const connectionId = owner.id === vnet.id ? `nva:${id}` : `vnet:${owner.id}`
      const state: AzNvaBgpPeer['state'] = !ars.enabled ? 'ars-disabled'
        : app.kind !== 'nva-vm' ? 'unsupported-appliance'
          : !app.bgpEnabled ? 'bgp-disabled'
            : app.asn === 65515 || app.asn === 12076 ? 'unsupported-asn'
              : getActivePeeringBetween(topology, vnet.id, owner.id)?.peering.scope?.type === 'subnets' ? 'subnet-peering-not-assessed'
                : !resolvedPeers.some(({ peer }) => peer.id === id) ? 'unreachable' : 'available'
      const view: AzNvaBgpPeer = {
        applianceId: id, applianceVnetId: owner.id, routeServerId: ars.id, routeServerVnetId: vnet.id,
        connectionId, ...(policyLinks.some((link) => link.id === connectionId) ? { policyConnectionId: connectionId } : {}),
        state, routes: [],
        ...(vnet.summarizedGatewayPrefixes?.length ? { gatewaySummaryAssessment: {
          status: 'not-assessed' as const,
          configuredPrefixes: [...vnet.summarizedGatewayPrefixes],
          gatewayIds: vnet.gateways.filter((gateway) => gateway.enabled).map((gateway) => gateway.id),
          gatewaySubnetId: vnet.subnets.find((subnet) => subnet.name === 'GatewaySubnet')?.id,
          branchToBranch: ars.branchToBranchTraffic,
        } } : {}),
      }
      ;(nvaBgpPeers[id] ??= []).push(view)
      peerViews.push(view)
    }
    if (!ars.enabled) continue
    if (ars.peerApplianceIds.length > ARS_MAX_BGP_PEERS) {
      warnings.push(
        `Azure Route Server "${ars.name}" in "${vnet.name}" has ${ars.peerApplianceIds.length} BGP peers configured (maximum supported by Azure is ${ARS_MAX_BGP_PEERS}).`,
      )
    }
    const entries: AzBgpRibEntry[] = []
    routeServerInbound[ars.id] = {}
    routeServerOutbound[ars.id] = {}
    for (const { peer: app } of azArsPeers(vnet, topology)) {
      if (app.asn === 65515 || app.asn === 12076) warnings.push(`Azure Route Server "${ars.name}" in "${vnet.name}" cannot peer with "${app.name}" using Azure-reserved ASN ${app.asn}.`)
    }
    for (const [connectionId, received] of Object.entries(receivedPeerRoutes(vnet))) {
      routeServerInbound[ars.id][connectionId] = received
      entries.push(...received.filter((route) => route.originProtocol !== 'VNet'))
    }

    if (ars.branchToBranchTraffic) {
      for (const gw of vnet.gateways.filter((g) => g.enabled && g.bgpEnabled)) {
        const received = applyAzArsRouteMap(ars, `gateway:${gw.id}`, 'inbound',
          (gatewayRibs[gw.id] ?? []).filter((r) => r.preferred).map((gRoute): AzBgpRibEntry => ({
            ...gRoute,
            id: `ars:${ars.id}:gw:${gw.id}:${gRoute.id}`,
            prefix: gRoute.prefix,
            asPath: gRoute.asPath,
            nextHopName: `${gw.name} (Branch-to-Branch)`,
            nextHopKind: 'vnet-gateway',
            nextHopId: gw.id,
            originProtocol: gw.kind === 'ExpressRoute' ? 'ExpressRoute' : 'VPN',
            preferred: true,
            weight: gRoute.weight,
            explanation: `Exchanged with ${gw.name} via ARS Branch-to-Branch`,
          })))
        routeServerInbound[ars.id][`gateway:${gw.id}`] = received
        entries.push(...received)
      }
    }

    routeServerRibs[ars.id] = chooseBgpWinners(entries, ars.hubRoutingPreference)
    const connected: AzBgpRibEntry[] = connectedVnetPrefixes(vnet).map((route) => ({
      ...route, id: `ars:${ars.id}:connected:${route.prefix}`, nextHopName: route.sourceName,
      nextHopKind: 'local', nextHopId: vnet.id, originProtocol: 'VNet', preferred: true,
      explanation: 'Connected virtual network advertisement',
    }))
    const onLink: AzBgpRibEntry[] = connectedVnetPrefixes(vnet, false).map((route) => ({
      ...route, id: `ars:${ars.id}:on-link:${route.prefix}`, nextHopName: `${route.sourceName} (On-link)`,
      nextHopKind: 'local', nextHopId: vnet.id, originProtocol: 'VNet', preferred: true,
      explanation: 'Local On-link address space is independent of route-map propagation',
    }))
    routeServerRibs[ars.id].push(...onLink)
    for (const view of peerViews.filter((peer) => peer.state === 'available')) {
      const { peer, host } = resolvedPeers.find(({ peer }) => peer.id === view.applianceId)!
      const candidates = [
        ...connected.filter((route) => host.id === vnet.id || !host.prefixes.includes(route.prefix)),
        ...routeServerRibs[ars.id].filter((route) => route.preferred && route.originProtocol !== 'VNet' && route.nextHopId !== peer.id),
      ]
      // BGP eligibility does not grant a new policy-assignment scope or inject subnet routes.
      const exported = view.policyConnectionId
        ? applyAzArsRouteMap(ars, view.policyConnectionId, 'outbound', candidates) : candidates
      view.routes = exported.filter((route) => !route.asPath.includes(peer.asn ?? 65501))
        .map(({ preferred, ...route }) => ({ ...route, selectedByArs: preferred }))
    }
    for (const link of policyLinks) {
      const isGateway = link.id.startsWith('gateway:')
      const isSpoke = link.id.startsWith('vnet:')
      const peer = azArsPeers(vnet, topology).find(({ peer }) => peer.id === link.targetId)?.peer
      if (isGateway && (!ars.branchToBranchTraffic || !vnet.gateways.some((gateway) => gateway.id === link.targetId && gateway.enabled && gateway.bgpEnabled))) continue
      if (isSpoke ? !link.bgp : !isGateway && (!peer?.bgpEnabled || !peer.enableIpForwarding || peer.asn === 65515 || peer.asn === 12076)) continue
      const candidates = routeServerRibs[ars.id].filter((route) => route.preferred && route.originProtocol !== 'VNet' && route.nextHopId !== link.targetId && (!isSpoke || route.sourceVnetId !== link.targetId) &&
        (!isGateway || ars.branchToBranchTraffic && route.nextHopKind === 'appliance'))
      const advertised = applyAzArsRouteMap(ars, link.id, 'outbound', [...connected.filter((route) => !isSpoke || !topology.vnets.find((spoke) => spoke.id === link.targetId)?.prefixes.includes(route.prefix)), ...candidates])
        .filter((route) => !peer?.asn || !route.asPath.includes(peer.asn))
      routeServerOutbound[ars.id][link.id] = advertised
      if (isGateway && ars.branchToBranchTraffic) {
        const gw = vnet.gateways.find((gateway) => gateway.id === link.targetId && gateway.enabled && gateway.bgpEnabled)
        if (!gw) continue
        const gwEntries = [...(gatewayRibs[gw.id] ?? [])]
        for (const nvaRoute of advertised.filter((route) => route.nextHopKind === 'appliance')) {
          gwEntries.push({
            ...nvaRoute,
            id: `gw:${gw.id}:ars:${ars.id}:${nvaRoute.id}`,
            prefix: nvaRoute.prefix,
            asPath: nvaRoute.asPath,
            nextHopName: `${ars.name} → ${nvaRoute.nextHopName}`,
            nextHopIp: nvaRoute.nextHopIp,
            nextHopKind: 'appliance',
            nextHopId: nvaRoute.nextHopId,
            originProtocol: 'BGP-NVA',
            preferred: true,
            explanation: `Learned from ${ars.name} via ARS Branch-to-Branch`,
          })
        }
        gatewayRibs[gw.id] = chooseBgpWinners(gwEntries, 'ASPath')
      }
    }
  }

  // Firewall onward routing uses local connection routes, independently of ingress propagation.
  const vwanFirewallRibs: Record<string, AzBgpRibEntry[]> = {}
  // 5. Populate Virtual WAN Hubs (for Hybrid topologies)
  for (const hub of topology.vwanHubs) {
    const entries: AzBgpRibEntry[] = []
    for (const vnet of topology.vnets) {
      if (vnet.vwanHubAttachment?.enabled && vnet.vwanHubAttachment.hubId === hub.id) {
        for (const prefix of vnet.prefixes) {
          entries.push({
            id: `vhub:${hub.id}:vnet:${vnet.id}:${prefix}`,
            prefix,
            asPath: [],
            nextHopName: `VNet connection: ${vnet.name}`,
            nextHopKind: 'local',
            nextHopId: vnet.id,
            originProtocol: 'VNet',
            preferred: true,
            explanation: `Directly attached VNet ${vnet.name}`,
            connectionId: `vhub-attach:${vnet.id}:${hub.id}`,
          })
        }
      }
    }
    for (const link of topology.erLinks.filter(
      (l) => l.enabled && l.targetKind === 'vwan-hub' && l.targetId === hub.id,
    )) {
      const loc = topology.erLocations.find((l) => l.id === link.locationId)
      if (!loc) continue
      if (!checkErLocationAzureRegionAccess(loc, hub.region).allowed) continue
      for (const lr of (erLocationRibs[loc.id] ?? []).filter(
        (r) =>
          r.preferred &&
          link.learnSiteRoutes !== false &&
          !r.hubPath?.includes(hub.id) &&
          !(r.nextHopKind === 'vwan-hub' && r.nextHopId === hub.id) &&
          r.nextHopKind !== 'er-location',
      )) {
        entries.push({
          ...lr,
          id: `vhub:${hub.id}:er:${link.id}:${lr.prefix}:${lr.nextHopId}`,
          connectionId: link.id,
          prefix: lr.prefix,
          asPath: [...(link.prepend ?? []), ...mseeAdvertisedAsPath(lr)],
          nextHopName: `${loc.name} → ${lr.nextHopName}`,
          nextHopKind: lr.nextHopKind,
          nextHopId: lr.nextHopId,
          originProtocol: 'ExpressRoute',
          preferred: true,
          weight: link.weight ?? 0,
          explanation: `Learned by vWAN Hub ${hub.name} via ExpressRoute at ${loc.name}`,
        })
      }
    }
    for (const conn of topology.vpnConnections.filter(
      (c) => c.enabled && c.targetKind === 'vwan-hub' && c.targetId === hub.id,
    )) {
      const site = topology.sites.find((s) => s.id === conn.siteId)
      if (!site) continue
      const received = conn.bgpEnabled && conn.learnSiteRoutes === false ? [] : conn.bgpEnabled
        ? sitePolicy(site.id, conn.id, 'outbound', (siteRibs[site.id] ?? []).filter((r) => r.preferred))
        : (conn.staticPrefixes?.length ? conn.staticPrefixes : site.prefixes).map((prefix): AzBgpRibEntry => ({
          id: `vpn-static:${conn.id}:${prefix}`, prefix, asPath: [], nextHopName: site.name,
          nextHopKind: 'site', nextHopId: site.id, originProtocol: 'VPN', preferred: true,
          explanation: `Static VPN route over ${conn.name}`, vpnStatic: true,
        }))
      for (const sr of translateVpnRoutes(topology, conn, received, 'IngressSNAT')) {
        entries.push({
          ...sr,
          id: `vhub:${hub.id}:vpn:${conn.id}:${sr.prefix}`,
          connectionId: conn.id,
          prefix: sr.prefix,
          asPath: sr.vpnStatic ? [] : [...(conn.inboundPrepend ?? []), ...sr.asPath],
          nextHopName: `${site.name} (${conn.name})`,
          nextHopKind: 'site',
          nextHopId: site.id,
          originProtocol: 'VPN',
          hubTransport: conn.transport ?? 'VPN',
          preferred: true,
          explanation: `Learned by vWAN Hub ${hub.name} via VPN ${conn.name}${sr.natOriginalPrefix ? `. ${sr.explanation}` : ''}`,
        })
      }
    }
    for (const vnet of topology.vnets.filter((vnet) => vnet.vwanHubAttachment?.enabled && vnet.vwanHubAttachment.hubId === hub.id)) {
      for (const app of vnet.appliances.filter((app) => app.vwanBgpEnabled && app.bgpEnabled && app.enableIpForwarding)) {
        const asn = app.asn ?? 65501
        const originate = (prefix: string, asPath: number[], communities?: string[]): AzBgpRibEntry => ({
          id: `vhub:${hub.id}:nva:${app.id}:${prefix}`, prefix, asPath: [asn, ...asPath], communities,
          nextHopKind: 'appliance', nextHopId: app.id, nextHopName: app.name, nextHopIp: app.privateIp,
          originProtocol: 'BGP-NVA', hubTransport: 'SpokeNVA', preferred: true,
          connectionId: `vhub-attach:${vnet.id}:${hub.id}`, sourceVnetId: vnet.id,
          explanation: `Learned from spoke BGP NVA ${app.name}`,
        })
        for (const prefix of app.advertisedPrefixes ?? []) {
          const attributes = app.advertisedRouteAttributes?.find((attributes) => attributes.prefix === prefix)
          entries.push(originate(prefix, attributes?.asPath ?? [], attributes?.communities))
        }
        for (const connection of topology.vpnConnections.filter((connection) => connection.enabled && connection.bgpEnabled
          && connection.targetKind === 'appliance' && connection.targetId === app.id)) {
          for (const route of sitePolicy(connection.siteId, connection.id, 'outbound',
            (siteRibs[connection.siteId] ?? []).filter((route) => route.preferred && !route.asPath.includes(asn)))) {
            entries.push({ ...originate(route.prefix, route.asPath, route.communities),
              id: `vhub:${hub.id}:nva:${app.id}:${connection.id}:${route.prefix}`, routeMapTrace: route.routeMapTrace })
          }
        }
      }
    }
    const attachments = azHubAttachments(topology, hub.id)
    const imported = [...new Set(entries.map((route) => route.connectionId!))].flatMap((connectionId) => {
      const routes = entries.filter((route) => route.connectionId === connectionId)
      return [...routes.filter((route) => route.vpnStatic), ...applyAzHubRouteMap(
        topology, hub.id, connectionId, 'inbound', routes.filter((route) => !route.vpnStatic))]
    })
    vwanFirewallRibs[hub.id] = chooseHubWinners(hub, imported)
    vwanHubTables[hub.id] = Object.fromEntries(hubRouteTables(hub).map((table) => [
      table.id, chooseHubWinners(hub, imported.filter((route) =>
        propagatesLocally(azHubRouting(attachments.find((attachment) => attachment.id === route.connectionId)?.hubRouting), table))),
    ]))
  }

  const localHubTables = structuredClone(vwanHubTables)
  for (const hub of topology.vwanHubs) {
    for (const table of hubRouteTables(hub)) {
      const remote = topology.vwanHubs.filter((origin) => origin.id !== hub.id).flatMap((origin) => {
        const attachments = azHubAttachments(topology, origin.id)
        const originTables = hubRouteTables(origin)
        return originTables.flatMap((originTable) => (localHubTables[origin.id][originTable.id] ?? [])
          .filter((route) => route.preferred && !route.hubPath?.includes(hub.id) && route.prefix !== '0.0.0.0/0'
            && propagatesRemotely(azHubRouting(attachments.find((attachment) => attachment.id === route.connectionId)?.hubRouting), originTable, table, originTables))
          .map((route): AzBgpRibEntry => ({
            ...route, id: JSON.stringify(['inter-hub', hub.id, table.id, origin.id, originTable.id, route.id]),
            originHubTableId: originTable.id, originHubRouteId: route.id, connectionId: undefined,
            nextHopKind: 'vwan-hub', nextHopId: origin.id, nextHopName: origin.name,
            originProtocol: 'InterHub', asPath: [65520, 65520, ...route.asPath],
            hubTransport: route.hubTransport ?? (route.originProtocol === 'VNet' ? 'VNet' : route.originProtocol === 'VPN' ? 'VPN' : route.originProtocol === 'BGP-NVA' ? 'SpokeNVA' : 'ExpressRoute'),
            secureOrigin: origin.routingIntent.private,
            hubPath: [...new Set([...(route.hubPath ?? []), origin.id, hub.id])],
            explanation: `Learned from ${origin.name} table ${originTable.name}`,
          })))
      })
      vwanHubTables[hub.id][table.id] = chooseHubWinners(hub, [...localHubTables[hub.id][table.id], ...remote])
    }
    vwanHubRibs[hub.id] = vwanHubTables[hub.id][DEFAULT_HUB_TABLE]
  }

  for (const hub of topology.vwanHubs) for (const table of hubRouteTables(hub)) {
    const statics = hubStaticPrefixes(hub, table, topology.vwanHubs.length).map(({ prefix, name, index }): AzBgpRibEntry => ({
      id: JSON.stringify(['hub-static', hub.id, table.id, index, prefix]), prefix, asPath: [],
      nextHopKind: 'hub-firewall', nextHopId: hub.firewall!.id, nextHopName: hub.firewall!.name,
      originProtocol: 'Static', preferred: true, explanation: `Static hub route ${name}`,
      staticRouteName: name,
    }))
    if (statics.length) vwanHubTables[hub.id][table.id] = chooseHubWinners(hub, [...vwanHubTables[hub.id][table.id], ...statics])
    vwanHubRibs[hub.id] = vwanHubTables[hub.id][DEFAULT_HUB_TABLE]
  }

  for (const [hubId, tables] of Object.entries(vwanHubTableCoverage)) {
    for (const [tableId, coverage] of Object.entries(tables)) {
      const routes = vwanHubTables[hubId][tableId]
      const remote = routes.filter((route) => route.preferred && route.originHubTableId)
      const ambiguous = remote.some((route) => !(vwanHubTables[route.nextHopId]?.[route.originHubTableId!] ?? [])
        .some((origin) => origin.id === route.originHubRouteId && origin.preferred))
        || remote.some((route) => remote.some((other) => other.nextHopId === route.nextHopId && other.prefix === route.prefix
          && other.originHubTableId !== route.originHubTableId && other.originHubRouteId !== route.originHubRouteId))
      if (ambiguous) {
        coverage.complete = false
        coverage.limitations = ['Remote table forwarding does not have a unique stable origin decision.']
      }
      if (!coverage.complete) warnings.push(`Virtual hub ${hubId} table ${tableId}: ${coverage.limitations.join(' ')}`)
    }
  }

  // 6. Push Azure routes back to On-Premises Sites (over ER and VPN)
  if (siteFeedback) for (const site of topology.sites) siteRibs[site.id] = initialSiteRibs[site.id]
  for (const site of topology.sites) {
    const learnedFromAzure: AzBgpRibEntry[] = []
    for (const link of topology.erLinks.filter(
      (l) => l.enabled && l.targetKind === 'site' && l.targetId === site.id,
    )) {
      const loc = topology.erLocations.find((l) => l.id === link.locationId)
      if (!loc) continue
      const received = (erLocationRibs[loc.id] ?? []).filter(
        (r) =>
          r.preferred &&
          !(r.nextHopKind === 'site' && r.nextHopId === site.id) &&
          (r.nextHopKind !== 'site' || Boolean(loc.globalReachEnabled)),
      ).map((lr): AzBgpRibEntry => ({
          ...lr,
          id: `site:${site.id}:er:${link.id}:${lr.prefix}`,
          connectionId: link.id,
          prefix: lr.prefix,
          asPath: mseeAdvertisedAsPath(lr),
          nextHopName: `${loc.name} (${link.name})`,
          nextHopKind: 'er-location',
          nextHopId: loc.id,
          originProtocol: 'ExpressRoute',
          preferred: false,
          explanation: `Learned from Azure over ExpressRoute circuit at ${loc.name}. ${lr.explanation}`,
          advertisedSummaryFrom: lr.advertisedSummaryFrom,
      }))
      learnedFromAzure.push(...sitePolicy(site.id, link.id, 'inbound', received))
    }
    for (const conn of topology.vpnConnections.filter((c) => c.enabled && c.siteId === site.id)) {
      if (conn.targetKind === 'vnet-gateway') {
        const ownerVnet = topology.vnets.find((v) => v.gateways.some((g) => g.id === conn.targetId && g.enabled))
        const gw = ownerVnet?.gateways.find((g) => g.id === conn.targetId)
        if (!ownerVnet || !gw) continue
        const received = (conn.nat && !conn.bgpEnabled ? [] : advertisedVnetPrefixes(ownerVnet, `gateway:${gw.id}`)).map((adv): AzBgpRibEntry => ({
            id: `site:${site.id}:vpn:${conn.id}:${adv.prefix}`,
            connectionId: conn.id,
            prefix: adv.prefix,
            asPath: [...(conn.outboundPrepend ?? []), ...adv.asPath],
            nextHopName: `${gw.name} (${conn.name})`,
            nextHopKind: 'vnet-gateway',
            nextHopId: gw.id,
            originProtocol: 'VPN',
            preferred: false,
            explanation: `Learned from ${gw.name} over S2S VPN ${conn.name} from ${adv.sourceName}`,
            advertisedSummaryFrom: adv.advertisedSummaryFrom,
            routeMapTrace: adv.routeMapTrace,
            communities: adv.communities,
        }))
        learnedFromAzure.push(...sitePolicy(site.id, conn.id, 'inbound', translateVpnRoutes(topology, conn, received, 'EgressSNAT')))
      } else if (conn.bgpEnabled && conn.targetKind === 'appliance') {
        const ownerVnet = topology.vnets.find((vnet) => vnet.appliances.some((app) => app.id === conn.targetId))
        const app = ownerVnet?.appliances.find((app) => app.id === conn.targetId && app.bgpEnabled && app.enableIpForwarding)
        if (!ownerVnet || !app) continue
        const originated = (app.advertisedPrefixes ?? []).map((prefix): VnetAdvertisement => {
          const attributes = app.advertisedRouteAttributes?.find((route) => route.prefix === prefix)
          return { prefix, asPath: attributes?.asPath ?? [], communities: attributes?.communities, sourceName: app.name }
        })
        const received = [
          ...originated,
          ...advertisedVnetPrefixes(ownerVnet, `nva:${app.id}`).filter((route) => !originated.some((origin) => origin.prefix === route.prefix)),
          ...(app.vwanBgpEnabled && ownerVnet.vwanHubAttachment?.enabled
            ? hubAdvertisements(topology, ownerVnet.vwanHubAttachment.hubId, ownerVnet.id,
              (vwanHubTables[ownerVnet.vwanHubAttachment.hubId]?.[azHubAssociation(ownerVnet.vwanHubAttachment.hubRouting)] ?? [])
                .filter((route) => route.nextHopId !== app.id), ownerVnet.vwanHubAttachment.propagateDefaultRoute, true)
              .map((route): VnetAdvertisement => ({
                prefix: route.prefix, asPath: route.asPath, sourceName: route.nextHopName,
                communities: route.communities, routeMapTrace: route.routeMapTrace,
              })) : []),
        ].map((adv): AzBgpRibEntry => ({
          id: `site:${site.id}:nva:${conn.id}:${adv.prefix}`, connectionId: conn.id,
          prefix: adv.prefix, asPath: [...(conn.outboundPrepend ?? []), app.asn ?? 65501, ...adv.asPath],
          nextHopName: `${app.name} (${conn.name})`, nextHopKind: 'appliance', nextHopId: app.id,
          originProtocol: 'VPN', preferred: false, explanation: `Learned from BGP NVA ${app.name} over ${conn.name}`,
          routeMapTrace: adv.routeMapTrace,
          communities: adv.communities,
        }))
        learnedFromAzure.push(...sitePolicy(site.id, conn.id, 'inbound', received))
      } else if (conn.targetKind === 'vwan-hub') {
        const routes = (vwanHubTables[conn.targetId]?.[azHubAssociation(conn.hubRouting)] ?? []).filter((route) =>
          route.preferred && !(route.nextHopKind === 'site' && route.nextHopId === site.id))
        const received = (conn.nat && !conn.bgpEnabled ? [] : hubAdvertisements(topology, conn.targetId, conn.id, routes, conn.propagateDefaultRoute, true))
          .map((route): AzBgpRibEntry => ({
            ...route, id: `site:${site.id}:vhub:${conn.id}:${route.prefix}`, connectionId: conn.id,
            asPath: conn.bgpEnabled ? [...(conn.outboundPrepend ?? []), ...route.asPath] : [],
            nextHopName: `${conn.targetId} (${conn.name})`, nextHopKind: 'vwan-hub', nextHopId: conn.targetId,
            originProtocol: 'VPN', preferred: false,
          }))
        learnedFromAzure.push(...(conn.bgpEnabled ? sitePolicy(site.id, conn.id, 'inbound', translateVpnRoutes(topology, conn, received, 'EgressSNAT')) : received))
      }
      if (conn.nat && (conn.targetKind !== 'vnet-gateway' || topology.vnets.some((vnet) =>
        vnet.gateways.some((gateway) => gateway.id === conn.targetId && gateway.enabled)))) {
        learnedFromAzure.push(...(conn.nat.onPremisesRoutes ?? []).map((prefix): AzBgpRibEntry => ({
          id: `site:${site.id}:vpn-manual:${conn.id}:${prefix}`, prefix, asPath: [], connectionId: conn.id,
          nextHopName: conn.name, nextHopKind: conn.targetKind, nextHopId: conn.targetId, originProtocol: 'Static',
          preferred: false, vpnStatic: true, explanation: `Explicit on-premises static post-NAT route via ${conn.name}; not a BGP translation.`,
        })))
      }
    }
    siteRibs[site.id] = chooseBgpWinners([...siteRibs[site.id], ...learnedFromAzure], 'ASPath', true)
  }

  // Azure withdrawals/backup advertisements must also reach sites behind a transit site.
  propagateSiteLinks()

  // 7. Compile Subnet Effective Route Tables for every Subnet in every VNet
  const subnetTables: Record<string, AzSubnetRouteTableResult> = {}
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      subnetTables[subnet.id] = compileSingleSubnetEffectiveRoutes(
        topology,
        vnet,
        subnet,
        gatewayRibs,
        routeServerRibs,
        routeServerOutbound,
        vwanHubTables,
      )
    }
  }

  return {
    controlPlaneComplete: peeringLimitations.length === 0,
    subnetTables,
    gatewayRibs,
    routeServerRibs,
    routeServerInbound,
    routeServerOutbound,
    nvaBgpPeers,
    vwanHubRibs,
    vwanFirewallRibs,
    vwanHubTables,
    vwanHubTableCoverage,
    erLocationRibs,
    siteRibs,
    warnings,
  }
}

function compileSingleSubnetEffectiveRoutes(
  topology: AzNetTopology,
  vnet: AzVNet,
  subnet: AzSubnet,
  gatewayRibs: Record<string, AzBgpRibEntry[]>,
  routeServerRibs: Record<string, AzBgpRibEntry[]>,
  routeServerOutbound: Record<string, Record<string, AzBgpRibEntry[]>>,
  vwanHubTables: Record<string, Record<string, AzBgpRibEntry[]>>,
): AzSubnetRouteTableResult {
  const udrTable = subnet.routeTableId
    ? topology.udrTables.find((t) => t.id === subnet.routeTableId)
    : undefined
  const bgpPropagationDisabled = Boolean(udrTable?.disableBgpRoutePropagation)
  const peeringPropagationDisabled = Boolean(udrTable?.disablePeeringRoutePropagation)

  const candidates: AzEffectiveRoute[] = []
  const suppressedBgpRoutes: AzEffectiveRoute[] = []
  const suppressedPeeringRoutes: AzEffectiveRoute[] = []
  const privateEndpointVnetPrefixes = new Map<string, string[]>()

  // A. System Routes: Local VNet prefixes
  for (const prefix of vnet.prefixes) {
    candidates.push({
      id: `sys:local:${subnet.id}:${prefix}`,
      prefix,
      source: 'System',
      nextHopType: 'VnetLocal',
      nextHopResourceId: vnet.id,
      nextHopName: vnet.name,
      originLabel: `System · Local VNet address space (${vnet.name})`,
      asPath: [],
      active: true,
    })
  }

  // B. System Routes: Default Internet route
  candidates.push({
    id: `sys:internet:${subnet.id}:0.0.0.0/0`,
    prefix: '0.0.0.0/0',
    source: 'System',
    nextHopType: 'Internet',
    nextHopName: 'Internet',
    originLabel: 'System · Default Internet egress',
    asPath: [],
    active: true,
  })

  // C. System Routes: Direct VNet Peerings (Non-Transitive!) & Private Endpoints (/32)
  const addPeRoutesFromVnet = (targetVnet: AzVNet, viaPeeringName?: string, participatingIds?: string[]) => {
    for (const s of targetVnet.subnets) {
      if (participatingIds && !participatingIds.includes(s.id)) continue
      for (const pe of s.privateEndpoints ?? []) {
        const pePolicy = s.privateEndpointNetworkPolicies ?? 'Disabled'
        const id = `sys:pe:${subnet.id}:${pe.id}`
        privateEndpointVnetPrefixes.set(id, targetVnet.prefixes)
        candidates.push({
          id,
          prefix: `${pe.ipAddress}/32`,
          source: 'System',
          nextHopType: 'InterfaceEndpoint',
          nextHopIp: pe.ipAddress,
          nextHopResourceId: pe.id,
          nextHopName: `${pe.name} (${pe.serviceName})`,
          originLabel: `System · Private Endpoint ${pe.name}${viaPeeringName ? ` via ${viaPeeringName}` : ''} (NetworkPolicies: ${pePolicy})`,
          asPath: [],
          active: true,
          privateEndpointRouteTableEnabled: pePolicy === 'RouteTableEnabled' || pePolicy === 'Enabled',
        })
      }
    }
  }

  addPeRoutesFromVnet(vnet)

  for (const otherVnet of topology.vnets) {
    if (otherVnet.id === vnet.id) continue
    const rel = getActivePeeringBetween(topology, vnet.id, otherVnet.id)
    if (!rel) continue
    // Connected peerings retain address-space routes even when access blocks forwarding.
    for (const prefix of peeringPrefixes(rel.peering, otherVnet)) {
      const peeringRoute: AzEffectiveRoute = {
        id: `sys:peering:${subnet.id}:${rel.peering.id}:${prefix}`,
        prefix,
        source: 'System',
        nextHopType: 'VNetPeering',
        nextHopResourceId: otherVnet.id,
        nextHopName: otherVnet.name,
        originLabel: rel.peering.scope?.type === 'subnets'
          ? `System · Subnet Peering (${rel.peering.name}); current preview also exposes routes in nonparticipating local subnets; forwarding still requires participation on both ends`
          : `System · VNet Peering (${rel.peering.name})`,
        asPath: [],
        active: true,
      }
      candidates.push(peeringRoute)
    }
    if (rel.forwardFlags.allowVirtualNetworkAccess && rel.reverseFlags.allowVirtualNetworkAccess) {
      addPeRoutesFromVnet(otherVnet, rel.peering.name, peeringSubnetIds(rel.peering, otherVnet.id))
    }
  }

  // D. BGP / Gateway-Propagated Routes (Local Gateways, Local ARS, Remote Peered Hub Gateways/ARS, or Attached vWAN Hub)
  const rawBgpRoutes: AzEffectiveRoute[] = []
  const vpnCoexistenceBackups = new Set<string>()

  const collectFromVnetControlPlane = (controlVnet: AzVNet, isRemoteGatewayTransit: boolean) => {
    const scopeLabel = isRemoteGatewayTransit ? `Remote Hub ${controlVnet.name}` : `Local ${controlVnet.name}`
    // If ARS is enabled and branchToBranch is active, ARS arbitrates preferences; otherwise read each gateway RIB
    const ars = controlVnet.routeServer?.enabled ? controlVnet.routeServer : undefined
    const erPrefixes = new Set(ars ? [] : controlVnet.gateways
      .filter((gateway) => gateway.enabled && gateway.kind === 'ExpressRoute')
      .flatMap((gateway) => (gatewayRibs[gateway.id] ?? []).filter((route) => route.preferred).map((route) => route.prefix)))
    if (ars) {
      const arsWinners = (isRemoteGatewayTransit ? routeServerOutbound[ars.id]?.[`vnet:${vnet.id}`] ?? [] : routeServerRibs[ars.id] ?? []).filter((r) => r.preferred)
      for (const r of arsWinners) {
        if (r.nextHopKind === 'appliance') {
          rawBgpRoutes.push({
            id: `bgp:ars:${subnet.id}:${ars.id}:${r.id}`,
            prefix: r.prefix,
            source: 'RouteServer',
            nextHopType: 'VirtualAppliance',
            nextHopIp: r.nextHopIp,
            nextHopResourceId: r.nextHopId,
            nextHopName: r.nextHopName,
            originLabel: `BGP · ${scopeLabel} ARS (${ars.name}) from ${r.nextHopName}`,
            asPath: r.asPath,
            active: true,
          })
        } else if (r.nextHopKind === 'vnet-gateway') {
          rawBgpRoutes.push({
            id: `bgp:ars-gw:${subnet.id}:${ars.id}:${r.id}`,
            prefix: r.prefix,
            source: 'VirtualNetworkGateway',
            nextHopType: 'VirtualNetworkGateway',
            nextHopResourceId: r.nextHopId,
            nextHopName: r.nextHopName,
            originLabel: `BGP · ${scopeLabel} Gateway via ARS (${ars.name})`,
            asPath: r.asPath,
            active: true,
          })
        }
      }
    }

    for (const gw of controlVnet.gateways.filter((g) => g.enabled)) {
      const gwWinners = (isRemoteGatewayTransit && ars?.branchToBranchTraffic
        ? (routeServerOutbound[ars.id]?.[`vnet:${vnet.id}`] ?? []).filter((route) => route.nextHopKind === 'vnet-gateway' && route.nextHopId === gw.id)
        : gatewayRibs[gw.id] ?? []).filter((r) => r.preferred)
      for (const r of gwWinners) {
        // ARS-learned NVA routes are already injected by the ARS loop above
        if (r.nextHopKind === 'appliance') {
          continue
        }
        // Avoid duplicating if ARS already injected a preferred route for the same gateway & prefix
        if (rawBgpRoutes.some((existing) => existing.prefix === r.prefix && existing.nextHopResourceId === gw.id)) {
          continue
        }
        const id = `bgp:gw:${subnet.id}:${gw.id}:${r.id}`
        // Without ARS, coexisting ER wins identical prefixes before comparing AS-path lengths.
        if (!ars && gw.kind === 'Vpn' && erPrefixes.has(r.prefix)) vpnCoexistenceBackups.add(id)
        rawBgpRoutes.push({
          id,
          prefix: r.prefix,
          source: 'VirtualNetworkGateway',
          nextHopType: 'VirtualNetworkGateway',
          nextHopResourceId: gw.id,
          nextHopName: `${gw.name} (${controlVnet.name})`,
          originLabel: `BGP · ${scopeLabel} ${gw.kind} Gateway (${gw.name})`,
          asPath: r.asPath,
          weight: r.weight,
          active: true,
        })
      }
    }
  }

  collectFromVnetControlPlane(vnet, false)

  // Remote Gateways / ARS via VNet Peering (`useRemoteGateways` on this VNet + `allowGatewayTransit` on peer)
  // Azure prohibits `useRemoteGateways=true` if this VNet already has a local Gateway or Route Server.
  const localHasGatewayOrArs =
    vnet.gateways.some((g) => g.enabled) || Boolean(vnet.routeServer?.enabled)
  if (!localHasGatewayOrArs) {
    for (const peerVnet of topology.vnets) {
      if (peerVnet.id === vnet.id) continue
      const rel = getActivePeeringBetween(topology, vnet.id, peerVnet.id)
      if (!rel) continue
      if (rel.peering.scope?.type === 'subnets') continue
      if (
        rel.forwardFlags.allowVirtualNetworkAccess &&
        rel.reverseFlags.allowVirtualNetworkAccess &&
        rel.forwardFlags.useRemoteGateways &&
        rel.reverseFlags.allowGatewayTransit
      ) {
        collectFromVnetControlPlane(peerVnet, true)
      }
    }
  }

  // Attached Virtual WAN Hub routes (Hybrid mode)
  if (vnet.vwanHubAttachment?.enabled) {
    const hub = topology.vwanHubs.find((h) => h.id === vnet.vwanHubAttachment!.hubId)
    if (hub) {
      const tableId = azHubAssociation(vnet.vwanHubAttachment.hubRouting)
      const hubWinners = hubAdvertisements(topology, hub.id, vnet.id,
        vwanHubTables[hub.id]?.[tableId] ?? [], vnet.vwanHubAttachment.propagateDefaultRoute, false)
      for (const r of hubWinners) {
        if (r.nextHopKind === 'local' && r.nextHopId === vnet.id) continue
        const viaSecuredFirewall = hub.routingIntent.private
        rawBgpRoutes.push({
          id: `bgp:vhub:${subnet.id}:${hub.id}:${r.id}`,
          prefix: r.prefix,
          source: 'VirtualNetworkGateway',
          nextHopType: 'VirtualNetworkGateway',
          nextHopResourceId: hub.id,
          nextHopName: viaSecuredFirewall ? `${hub.name} (Secured Hub Firewall)` : hub.name,
          originLabel: `BGP · Virtual WAN Hub ${hub.name}${viaSecuredFirewall ? ' (Routing Intent Private)' : ''}`,
          asPath: r.asPath,
          active: true,
        })
      }
    }
  }

  if (bgpPropagationDisabled && subnet.name !== 'GatewaySubnet') {
    for (const bgpRoute of rawBgpRoutes) {
      suppressedBgpRoutes.push({
        ...bgpRoute,
        active: false,
        suppressedReason: `Suppressed by disableBgpRoutePropagation=true on Route Table "${udrTable?.name}"`,
      })
    }
  } else {
    candidates.push(...rawBgpRoutes)
  }

  // E. User-Defined Routes (UDRs) from the Subnet's associated Route Table
  if (udrTable) {
    for (const udr of udrTable.routes) {
      if (!udr.enabled) continue
      const targetAppliance =
        udr.nextHopType === 'VirtualAppliance' ? findApplianceByIp(topology, udr.nextHopIp) : undefined
      candidates.push({
        id: `udr:${subnet.id}:${udr.id}`,
        prefix: udr.prefix,
        source: 'User',
        nextHopType: mapUdrNextHop(udr.nextHopType),
        nextHopIp: udr.nextHopIp,
        nextHopResourceId: targetAppliance?.appliance.id,
        nextHopName:
          udr.nextHopType === 'VirtualAppliance'
            ? targetAppliance
              ? `${targetAppliance.appliance.name} (${udr.nextHopIp})`
              : `VirtualAppliance (${udr.nextHopIp})`
            : udr.nextHopType,
        originLabel: `User · UDR "${udr.name}" in ${udrTable.name}`,
        asPath: [],
        active: true,
      })
    }
  }

  const overridesReservedDefaults = candidates.some((route) =>
    route.prefix === '0.0.0.0/0' && (route.source === 'User' || route.nextHopType === 'VirtualNetworkGateway'))
  if (!overridesReservedDefaults) {
    for (const prefix of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '198.18.0.0/15']) {
      const reserved = cidr(prefix)!
      if (vnet.prefixes.some((local) => (cidr(local)?.length ?? 33) <= reserved.length && contains(local, reserved.network))) continue
      candidates.push({
        id: `sys:reserved:${subnet.id}:${prefix}`, prefix, source: 'System', nextHopType: 'None',
        nextHopName: 'Discard', originLabel: 'System · Reserved address space', asPath: [], active: true,
      })
    }
  }

  // F. Resolve exact-prefix precedence; PE routes need route-table policies before UDRs can override them.
  const byPrefix = new Map<string, AzEffectiveRoute[]>()
  for (const route of candidates) {
    const group = byPrefix.get(route.prefix) ?? []
    group.push(route)
    byPrefix.set(route.prefix, group)
  }

  const resolved: AzEffectiveRoute[] = []
  for (const [, group] of byPrefix) {
    if (group.length === 1) {
      resolved.push({ ...group[0], active: true })
      continue
    }
    const sourceRank = (r: AzEffectiveRoute): number => {
      if (
        r.nextHopType === 'InterfaceEndpoint' &&
        !r.privateEndpointRouteTableEnabled
      ) {
        return 0
      }
      if (r.source === 'User') return 1
      if (r.source === 'RouteServer' || r.source === 'VirtualNetworkGateway') return 2
      return 3 // System
    }
    const minRank = Math.min(...group.map(sourceRank))
    const topRanked = group.filter((r) => sourceRank(r) === minRank && !vpnCoexistenceBackups.has(r.id))
    const minAsPath = Math.min(...topRanked.map((r) => r.asPath.length || 999))
    const shortest = topRanked.filter((r) => (r.asPath.length || 999) === minAsPath)
    // ARS installs all equal-cost NVA next hops; retain other sources' existing tie handling.
    const winners = shortest[0]?.source === 'RouteServer' && shortest[0].nextHopType === 'VirtualAppliance'
      ? shortest.filter((r) => r.source === 'RouteServer' && r.nextHopType === 'VirtualAppliance')
      : shortest.slice(0, 1)
    const winnerIds = new Set(winners.map((r) => r.id))
    const winner = group.find((r) => winnerIds.has(r.id))!
    for (const r of group) {
      if (winnerIds.has(r.id)) {
        resolved.push({ ...r, active: true })
      } else {
        resolved.push({
          ...r,
          active: false,
          suppressedReason: `Overridden by ${winner.source} route (${winner.originLabel})`,
        })
      }
    }
  }

  // Suppression needs an active replacement covering the entire peering prefix.
  if (peeringPropagationDisabled) {
    for (let i = resolved.length - 1; i >= 0; i--) {
      const route = resolved[i]
      if (route.nextHopType !== 'VNetPeering' || route.source !== 'System') continue
      const prefix = cidr(route.prefix)
      const replacement = prefix && resolved.find((udr) => udr.active && udr.source === 'User' &&
        (cidr(udr.prefix)?.length ?? 33) <= prefix.length && contains(udr.prefix, prefix.network))
      if (!replacement) continue
      suppressedPeeringRoutes.push({
        ...route,
        active: false,
        suppressedReason: `Suppressed by disablePeeringRoutePropagation=true (Preview) with active covering UDR ${replacement.prefix} (${replacement.originLabel})`,
      })
      resolved.splice(i, 1)
    }
  }

  // G. PE overrides need route-table policies and a UDR at least as specific as the PE-owning VNet space.
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]
    if (
      r.active &&
      r.nextHopType === 'InterfaceEndpoint' &&
      r.privateEndpointRouteTableEnabled
    ) {
      const peIpStr = r.nextHopIp ?? r.prefix.split('/')[0]
      const peIpNum = ipv4(peIpStr)
      if (peIpNum !== undefined) {
        const ownerPrefixLengths = (privateEndpointVnetPrefixes.get(r.id) ?? [])
          .filter((prefix) => cidr(prefix) && contains(prefix, peIpNum))
          .map((prefix) => cidr(prefix)!.length)
        if (!ownerPrefixLengths.length) continue
        const ownerPrefixLength = Math.max(...ownerPrefixLengths)
        const coveringUdr = resolved.find(
          (u) => u.active && u.source === 'User' &&
            (cidr(u.prefix)?.length ?? -1) >= ownerPrefixLength && contains(u.prefix, peIpNum),
        )
        if (coveringUdr) {
          resolved[i] = {
            ...r,
            active: false,
            suppressedReason: `Invalidated by covering User UDR ${coveringUdr.prefix} (${coveringUdr.originLabel}) under PrivateEndpointNetworkPolicies`,
          }
        }
      }
    }
  }

  resolved.sort((a, b) => {
    const ca = cidr(a.prefix)
    const cb = cidr(b.prefix)
    if (ca && cb && ca.length !== cb.length) return cb.length - ca.length
    if (ca && cb && ca.network !== cb.network) return ca.network - cb.network
    return Number(b.active) - Number(a.active)
  })

  return {
    vnetId: vnet.id,
    vnetName: vnet.name,
    subnetId: subnet.id,
    subnetName: subnet.name,
    subnetPrefix: subnet.prefix,
    udrTableId: udrTable?.id,
    udrTableName: udrTable?.name,
    bgpPropagationDisabled,
    peeringPropagationDisabled,
    routes: resolved,
    suppressedBgpRoutes,
    suppressedPeeringRoutes,
  }
}

function mapUdrNextHop(nextHopType: AzUdrNextHopType): AzEffectiveNextHopType {
  switch (nextHopType) {
    case 'VirtualAppliance':
      return 'VirtualAppliance'
    case 'VirtualNetworkGateway':
      return 'VirtualNetworkGateway'
    case 'VnetLocal':
      return 'VnetLocal'
    case 'Internet':
      return 'Internet'
    case 'None':
      return 'None'
  }
}

/**
 * Evaluates Longest Prefix Match (LPM) across all active routes in a Subnet's Effective Route Table,
 * respecting Private Endpoint `/32` Network Policies vs. UDRs.
 */
export function lookupSubnetEffectiveRoute(
  table: AzSubnetRouteTableResult,
  destinationIp: string,
): AzEffectiveRoute | undefined {
  const ipNum = ipv4(destinationIp)
  if (ipNum === undefined) return undefined

  // Also check if a Private Endpoint /32 route is present even if a broader UDR exists
  const matchingActive = table.routes.filter((r) => {
    if (!r.active) return false
    const parsed = cidr(r.prefix)
    return parsed ? contains(r.prefix, ipNum) : false
  })
  if (!matchingActive.length) return undefined

  const maxPrefixLen = Math.max(...matchingActive.map((r) => cidr(r.prefix)!.length))
  const longestMatches = matchingActive.filter((r) => cidr(r.prefix)!.length === maxPrefixLen)

  // If multiple active routes share the longest prefix, User > BGP > System
  const rank = (r: AzEffectiveRoute) => {
    if (r.nextHopType === 'InterfaceEndpoint' && !r.privateEndpointRouteTableEnabled) return 0
    if (r.source === 'User') return 1
    if (r.source === 'RouteServer' || r.source === 'VirtualNetworkGateway') return 2
    return 3
  }
  return [...longestMatches].sort((a, b) => rank(a) - rank(b))[0]
}

export function locateDestinationIp(
  topology: AzNetTopology,
  destinationIp: string,
): {
  label: string
  endpoint?: AzEndpointRef
  vnet?: AzVNet
  subnet?: AzSubnet
  site?: AzNetTopology['sites'][number]
} {
  const ipNum = ipv4(destinationIp)
  if (ipNum === undefined) return { label: destinationIp }

  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      for (const pe of subnet.privateEndpoints ?? []) {
        if (pe.ipAddress === destinationIp) {
          return {
            label: `${pe.name} (${destinationIp}) in ${vnet.name}/${subnet.name}`,
            endpoint: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
            vnet,
            subnet,
          }
        }
      }
      if (cidr(subnet.prefix) && contains(subnet.prefix, ipNum)) {
        return {
          label: `${vnet.name} / ${subnet.name} (${destinationIp})`,
          endpoint: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
          vnet,
          subnet,
        }
      }
    }
    for (const prefix of vnet.prefixes) {
      if (cidr(prefix) && contains(prefix, ipNum)) {
        const defaultSubnet = vnet.subnets[0]
        return {
          label: `${vnet.name} (${destinationIp})`,
          endpoint: defaultSubnet ? { kind: 'subnet', vnetId: vnet.id, subnetId: defaultSubnet.id } : undefined,
          vnet,
          subnet: defaultSubnet,
        }
      }
    }
  }

  for (const site of topology.sites) {
    for (const prefix of site.prefixes) {
      if (cidr(prefix) && contains(prefix, ipNum)) {
        return {
          label: `${site.name} (${destinationIp})`,
          endpoint: { kind: 'site', siteId: site.id },
          site,
        }
      }
    }
  }

  for (const connection of topology.vpnConnections) {
    const rule = connection.nat?.rules.find((rule) => contains(rule.externalMapping, ipNum))
    if (!rule) continue
    if (rule.mode === 'IngressSNAT') {
      const site = topology.sites.find((site) => site.id === connection.siteId)
      if (site) return { label: `${site.name} VPN NAT (${destinationIp})`, endpoint: { kind: 'site', siteId: site.id }, site }
    } else if (rule.type === 'Static') {
      const original = mappedVpnAddress(destinationIp, rule.externalMapping, rule.internalMapping)
      const vnet = topology.vnets.find((vnet) => vnet.prefixes.some((prefix) => contains(prefix, ipv4(original)!)))
      const subnet = vnet?.subnets.find((subnet) => contains(subnet.prefix, ipv4(original)!))
      if (vnet && subnet) return { label: `${vnet.name} VPN NAT (${destinationIp})`,
        endpoint: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id }, vnet, subnet }
    }
  }
  return { label: `External / Internet (${destinationIp})` }
}

/**
 * Traces the exact hop-by-hop packet path from a source endpoint (Subnet, Site, or vWAN Hub)
 * to a destination IPv4 address, validating every VNet peering flag, GatewaySubnet UDR,
 * NVA IP forwarding setting, and Private Endpoint override along the way.
 */
export function traceAzNetFlow(
  topology: AzNetTopology,
  simulation: AzSimulationResult,
  source: AzEndpointRef,
  destinationIp: string,
  options?: { sourceAddress?: string; sourceApplianceId?: string
    vpnTranslation?: (connectionId: string, direction: 'ingress' | 'egress', destinationAddress: string) =>
      { destinationAddress: string; detail: string; blocked?: string } },
): AzFlowTrace {
  let targetInfo = locateDestinationIp(topology, destinationIp)
  const hops: AzTraceHop[] = []
  const traversedApplianceIds: string[] = []
  const traversedEdgeIds: string[] = []
  const traversedVnetIds: string[] = []
  const visitedStates = new Set<string>()

  const pushHop = (hop: Omit<AzTraceHop, 'index'>) => {
    hops.push({ ...hop, index: hops.length + 1 })
    if (hop.vnetId && !traversedVnetIds.includes(hop.vnetId)) {
      traversedVnetIds.push(hop.vnetId)
    }
    if (hop.edgeId && !traversedEdgeIds.includes(hop.edgeId)) {
      traversedEdgeIds.push(hop.edgeId)
    }
  }

  const unsupportedNvaHaHop = (vnet: AzVNet, app: AzAppliance, address?: string): AzFlowTrace | undefined => {
    const haPorts = resolveHaPortsNextHop(topology, simulation, address)
    if (!haPorts) return
    const reason = 'NVA-originated or chained HA-ports steering is outside the single workload-UDR boundary; no onward forwarding is inferred.'
    pushHop({ nodeKind: 'appliance', nodeId: app.id, vnetId: vnet.id, nodeName: app.name, subnetId: app.subnetId,
      action: 'dropped', haPorts: { ...haPorts, status: 'not-assessed', selected: undefined, applianceId: undefined, reason }, detail: reason })
    return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed',
      hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: reason }
  }

  let ipNum = ipv4(destinationIp)!
  if (ipNum === undefined) {
    return {
      source,
      destinationIp,
      destinationLabel: destinationIp,
      status: 'dropped-no-route',
      hops: [],
      traversedApplianceIds: [],
      traversedEdgeIds: [],
      traversedVnetIds: [],
      summaryReason: `Invalid destination IPv4 address "${destinationIp}".`,
    }
  }

  if (simulation.controlPlaneComplete === false || Object.values(simulation.vwanHubTableCoverage).some((tables) => Object.values(tables).some((coverage) => !coverage.complete))) {
    return {
      source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed',
      hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds,
      summaryReason: simulation.controlPlaneComplete === false
        ? 'Control-plane selection is incomplete; reachability and isolation are not established.'
        : 'Virtual hub routing scope is unknown or unsupported; reachability and isolation are not established.',
    }
  }

  let privateDestination = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((prefix) => contains(prefix, ipNum))
  let vpnSiteDelivery: { siteId: string; internalPrefixes: string[] } | undefined
  const crossVpn = (connectionId: string, direction: 'ingress' | 'egress'): AzFlowTrace | undefined => {
    const connection = topology.vpnConnections.find((connection) => connection.id === connectionId)!
    if (!connection.nat) return
    const translated = options?.vpnTranslation?.(connectionId, direction, destinationIp)
    if (!translated || translated.blocked) {
      const reason = translated?.blocked ?? 'VPN NAT needs an explicit five-tuple and bounded reply assessment in the connection inspector.'
      pushHop({ nodeKind: 'site', nodeId: connection.siteId, nodeName: connection.name, edgeId: connection.id, action: 'dropped', detail: reason })
      return { source, destinationIp, destinationLabel: targetInfo.label, status: translated?.blocked ? 'dropped-no-route' : 'not-assessed',
        hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: reason }
    }
    destinationIp = translated.destinationAddress
    ipNum = ipv4(destinationIp)!
    targetInfo = locateDestinationIp(topology, destinationIp)
    privateDestination = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((prefix) => contains(prefix, ipNum))
    if (direction === 'egress') {
      vpnSiteDelivery = { siteId: connection.siteId,
        internalPrefixes: connection.nat.rules.filter((rule) => rule.mode === 'IngressSNAT').map((rule) => rule.internalMapping) }
      const site = topology.sites.find((site) => site.id === connection.siteId)
      if (site) targetInfo = { label: `${site.name} VPN internal (${destinationIp})`, endpoint: { kind: 'site', siteId: site.id }, site }
    }
    pushHop({ nodeKind: connection.targetKind === 'vwan-hub' ? 'vwan-hub' : 'vnet-gateway',
      nodeId: connection.targetId, nodeName: connection.name, edgeId: connection.id, action: 'gateway-transit', detail: translated.detail })
  }

  type Cursor =
    | { kind: 'subnet'; vnetId: string; subnetId: string; fromExternalVnet: boolean; viaVnra: boolean }
    | { kind: 'appliance'; vnetId: string; applianceId: string }
    | { kind: 'vnet-gateway'; vnetId: string; gatewayId: string; direction: 'egress' | 'ingress' }
    | { kind: 'vwan-hub'; hubId: string; tableId: string }
    | { kind: 'er-location'; locationId: string; fromTargetId: string }
    | { kind: 'site'; siteId: string }

  let cursor: Cursor
  let originVnetId: string | undefined

  if (source.kind === 'subnet') {
    originVnetId = source.vnetId
    const vnet = topology.vnets.find((v) => v.id === source.vnetId)
    const subnet = vnet?.subnets.find((s) => s.id === source.subnetId)
    pushHop({
      nodeKind: 'subnet',
      nodeId: source.subnetId,
      vnetId: source.vnetId,
      nodeName: vnet?.name ?? source.vnetId,
      subnetId: source.subnetId,
      subnetName: subnet?.name ?? source.subnetId,
      action: 'origin',
      detail: `Packet originates in ${vnet?.name ?? source.vnetId} / ${subnet?.name ?? source.subnetId}`,
    })
    if (options?.sourceApplianceId) {
      const appliance = vnet?.appliances.find((entry) => entry.id === options.sourceApplianceId && entry.subnetId === source.subnetId
        && entry.privateIp === options.sourceAddress)
      if (!appliance) return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed', hops,
        traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: 'Conditional return source does not match its original appliance interface.' }
      cursor = { kind: 'appliance', vnetId: source.vnetId, applianceId: appliance.id }
    } else cursor = { kind: 'subnet', vnetId: source.vnetId, subnetId: source.subnetId, fromExternalVnet: false, viaVnra: false }
  } else if (source.kind === 'site') {
    const site = topology.sites.find((s) => s.id === source.siteId)
    pushHop({
      nodeKind: 'site',
      nodeId: source.siteId,
      nodeName: site?.name ?? source.siteId,
      action: 'origin',
      detail: `Packet originates at on-premises site ${site?.name ?? source.siteId}`,
    })
    cursor = { kind: 'site', siteId: source.siteId }
  } else if (source.kind === 'internet') {
    const internetIp = source.ip ?? '20.50.60.70'
    pushHop({
      nodeKind: 'internet',
      nodeId: 'internet',
      nodeName: `Internet (${internetIp})`,
      action: 'origin',
      detail: `Packet originates from public Internet (${internetIp})`,
    })
    if (targetInfo.endpoint?.kind === 'subnet') {
      const hubFw = topology.vnets
        .flatMap((v) => v.appliances.map((a) => ({ vnet: v, app: a })))
        .find(({ app }) => app.kind === 'azure-firewall' && app.enableIpForwarding)
      if (hubFw) {
        cursor = { kind: 'appliance', vnetId: hubFw.vnet.id, applianceId: hubFw.app.id }
      } else {
        cursor = {
          kind: 'subnet',
          vnetId: targetInfo.endpoint.vnetId,
          subnetId: targetInfo.endpoint.subnetId,
          fromExternalVnet: false,
          viaVnra: false,
        }
      }
    } else {
      pushHop({
        nodeKind: 'internet',
        nodeId: 'internet',
        nodeName: `Internet (${internetIp})`,
        action: 'dropped',
        detail: `No inbound public IP / DNAT path configured from Internet to ${destinationIp} (${targetInfo.label}).`,
      })
      return {
        source,
        destinationIp,
        destinationLabel: targetInfo.label,
        status: 'dropped-no-route',
        hops,
        traversedApplianceIds,
        traversedEdgeIds,
        traversedVnetIds,
        summaryReason: `No inbound Internet route to ${destinationIp}.`,
      }
    }
  } else {
    const hub = topology.vwanHubs.find((h) => h.id === source.hubId)
    pushHop({
      nodeKind: 'vwan-hub',
      nodeId: source.hubId,
      nodeName: hub?.name ?? source.hubId,
      action: 'origin',
      detail: `Packet originates at Virtual WAN Hub ${hub?.name ?? source.hubId}`,
    })
    cursor = { kind: 'vwan-hub', hubId: source.hubId, tableId: DEFAULT_HUB_TABLE }
  }

  // Helper to check VNet Peering traversal gates when crossing from `fromVnet` to `toVnet`
  const validatePeeringTransition = (
    fromVnet: AzVNet,
    toVnet: AzVNet,
    isForwardedPacket: boolean,
    involvesVnra: boolean,
    fromSubnetId?: string,
    toSubnetId?: string,
  ): { ok: true; peering: AzVnetPeering } | { ok: false; status: AzTraceStatus; reason: string; peeringId?: string } => {
    const rel = getActivePeeringBetween(topology, fromVnet.id, toVnet.id)
    if (!rel) {
      return {
        ok: false,
        status: 'dropped-peering-non-transitive',
        reason: `No active VNet peering between "${fromVnet.name}" and "${toVnet.name}". VNet peering is non-transitive.`,
      }
    }
    if (rel.peering.scope?.type === 'subnets') {
      if (!fromSubnetId || !toSubnetId || isForwardedPacket || involvesVnra) {
        return { ok: false, status: 'not-assessed', peeringId: rel.peering.id,
          reason: `Subnet peering "${rel.peering.name}": only direct owned-subnet forwarding is assessed; transit and ambiguous subnet handoffs are not assessed.` }
      }
      if (!peeringSubnetIds(rel.peering, fromVnet.id)!.includes(fromSubnetId) ||
        !peeringSubnetIds(rel.peering, toVnet.id)!.includes(toSubnetId)) {
        return { ok: false, status: 'dropped-peering-access', peeringId: rel.peering.id,
          reason: `Subnet peering "${rel.peering.name}" drops traffic unless both source and destination subnets participate. Effective-route visibility alone does not grant forwarding.` }
      }
    }
    if (!rel.forwardFlags.allowVirtualNetworkAccess || !rel.reverseFlags.allowVirtualNetworkAccess) {
      return {
        ok: false,
        status: 'dropped-peering-access',
        peeringId: rel.peering.id,
        reason: involvesVnra
          ? `Dropped on peering "${rel.peering.name}": Managed VNRA transit requires allowVirtualNetworkAccess=true on both peering directions.`
          : `Dropped on peering "${rel.peering.name}": allowVirtualNetworkAccess is disabled between "${fromVnet.name}" and "${toVnet.name}".`,
      }
    }
    if (isForwardedPacket && !rel.reverseFlags.allowForwardedTraffic) {
      const arsGatewayTransitAllows =
        rel.forwardFlags.allowGatewayTransit &&
        rel.reverseFlags.useRemoteGateways &&
        Boolean(fromVnet.routeServer?.enabled)
      if (!arsGatewayTransitAllows) {
        return {
          ok: false,
          status: 'dropped-peering-forwarded-traffic',
          peeringId: rel.peering.id,
          reason: `Dropped on peering "${rel.peering.name}": "${toVnet.name}" has allowForwardedTraffic=false and rejects transit packets forwarded by "${fromVnet.name}".`,
        }
      }
    }
    return { ok: true, peering: rel.peering }
  }

  for (let step = 0; step < 24; step++) {
    const stepCursor = cursor as Cursor
    const stateKey = JSON.stringify(stepCursor)
    if (visitedStates.has(stateKey)) {
      pushHop({
        nodeKind: 'subnet',
        nodeId: 'loop',
        nodeName: 'Routing Loop Detected',
        action: 'loop',
        detail: `Forwarding loop detected when revisiting ${stateKey}`,
      })
      return {
        source,
        destinationIp,
        destinationLabel: targetInfo.label,
        status: 'loop',
        hops,
        traversedApplianceIds,
        traversedEdgeIds,
        traversedVnetIds,
        summaryReason: 'Packet entered a forwarding loop across subnet/appliance route tables.',
      }
    }
    visitedStates.add(stateKey)

    if (stepCursor.kind === 'subnet') {
      const vnet = topology.vnets.find((v) => v.id === stepCursor.vnetId)
      const subnet = vnet?.subnets.find((s) => s.id === stepCursor.subnetId)
      if (!vnet || !subnet) {
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: 'Subnet or VNet not found.',
        }
      }

      // Check if destination IP is right here in this subnet (or Private Endpoint in this subnet)
      const localPe = (subnet.privateEndpoints ?? []).find((pe) => pe.ipAddress === destinationIp)
      if (localPe) {
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'delivered',
          detail: `Delivered to Private Endpoint ${localPe.name} (${destinationIp}) in ${vnet.name}/${subnet.name}`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'delivered',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Delivered to Private Endpoint ${localPe.name} (${destinationIp}).`,
        }
      }

      if (cidr(subnet.prefix) && contains(subnet.prefix, ipNum)) {
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'delivered',
          detail: `Delivered to destination workload (${destinationIp}) in ${vnet.name}/${subnet.name}`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'delivered',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Delivered to ${vnet.name}/${subnet.name} (${destinationIp}).`,
        }
      }

      // Look up the Effective Route Table for this subnet
      const table = simulation.subnetTables[subnet.id]
      const matched = table ? lookupSubnetEffectiveRoute(table, destinationIp) : undefined
      if (!matched) {
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'dropped',
          detail: `No matching active route in ${vnet.name}/${subnet.name} for ${destinationIp}`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Dropped at ${vnet.name}/${subnet.name}: no active route matches ${destinationIp}.`,
        }
      }

      if (matched.nextHopType === 'None') {
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'dropped',
          matchedRoute: matched,
          detail: `Blackholed by ${matched.originLabel} (NextHopType = None)`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-blackhole',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Dropped by NextHopType=None route (${matched.prefix}) in ${vnet.name}/${subnet.name}.`,
        }
      }

      if (matched.nextHopType === 'VnetLocal') {
        const destSub = vnet.subnets.find((s) => cidr(s.prefix) && contains(s.prefix, ipNum))
        if (destSub && destSub.id !== subnet.id) {
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'subnet-lookup',
            matchedRoute: matched,
            detail: `${vnet.name}/${subnet.name} routes intra-VNet via VnetLocal (${matched.prefix}) to ${destSub.name}`,
          })
          cursor = { kind: 'subnet', vnetId: vnet.id, subnetId: destSub.id, fromExternalVnet: false, viaVnra: stepCursor.viaVnra }
          continue
        }
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'dropped',
          matchedRoute: matched,
          detail: `Matched VnetLocal route (${matched.prefix}) in ${vnet.name}/${subnet.name}, but ${destinationIp} is outside ${vnet.name}'s subnets.`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `VnetLocal route (${matched.prefix}) matched in ${vnet.name}/${subnet.name}, but destination ${destinationIp} is not hosted in ${vnet.name}.`,
        }
      }

      if (matched.nextHopType === 'InterfaceEndpoint') {
        // Private Endpoint /32 system route!
        for (const candidateVnet of topology.vnets) {
          for (const candidateSub of candidateVnet.subnets) {
            const pe = (candidateSub.privateEndpoints ?? []).find((p) => p.id === matched.nextHopResourceId || p.ipAddress === destinationIp)
            if (pe) {
              if (candidateVnet.id !== vnet.id) {
                const check = validatePeeringTransition(vnet, candidateVnet, stepCursor.fromExternalVnet, stepCursor.viaVnra)
                if (!check.ok) {
                  pushHop({
                    nodeKind: 'subnet',
                    nodeId: subnet.id,
                    vnetId: vnet.id,
                    nodeName: vnet.name,
                    subnetId: subnet.id,
                    subnetName: subnet.name,
                    action: 'dropped',
                    matchedRoute: matched,
                    edgeId: check.peeringId,
                    detail: check.reason,
                  })
                  return {
                    source,
                    destinationIp,
                    destinationLabel: targetInfo.label,
                    status: check.status,
                    hops,
                    traversedApplianceIds,
                    traversedEdgeIds,
                    traversedVnetIds,
                    summaryReason: check.reason,
                  }
                }
                pushHop({
                  nodeKind: 'subnet',
                  nodeId: subnet.id,
                  vnetId: vnet.id,
                  nodeName: vnet.name,
                  subnetId: subnet.id,
                  subnetName: subnet.name,
                  action: 'peering-cross',
                  matchedRoute: matched,
                  edgeId: check.peering.id,
                  detail: `System /32 InterfaceEndpoint route (${pe.name}) crosses peering ${check.peering.name} directly to ${candidateVnet.name}/${candidateSub.name}`,
                })
              }
              cursor = { kind: 'subnet', vnetId: candidateVnet.id, subnetId: candidateSub.id, fromExternalVnet: candidateVnet.id !== vnet.id, viaVnra: stepCursor.viaVnra }
              break
            }
          }
        }
        continue
      }

      if (matched.nextHopType === 'VNetPeering') {
        const peerVnet = topology.vnets.find((v) => v.id === matched.nextHopResourceId)
        if (!peerVnet) {
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: 'dropped-no-route',
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: 'Target peered VNet not found.',
          }
        }
        const targetSubnet = peerVnet.subnets.find((s) => cidr(s.prefix) && contains(s.prefix, ipNum))
        const check = validatePeeringTransition(vnet, peerVnet, stepCursor.fromExternalVnet, stepCursor.viaVnra, subnet.id, targetSubnet?.id)
        if (!check.ok) {
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'dropped',
            matchedRoute: matched,
            edgeId: check.peeringId,
            detail: check.reason,
          })
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: check.status,
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: check.reason,
          }
        }
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'peering-cross',
          matchedRoute: matched,
          edgeId: check.peering.id,
          detail: `Crosses VNet Peering "${check.peering.name}" from ${vnet.name} to ${peerVnet.name}`,
        })
        cursor = {
          kind: 'subnet',
          vnetId: peerVnet.id,
          subnetId: (targetSubnet ?? peerVnet.subnets[0]).id,
          fromExternalVnet: true,
          viaVnra: stepCursor.viaVnra,
        }
        continue
      }

      if (matched.nextHopType === 'VirtualAppliance') {
        const haPorts = resolveHaPortsNextHop(topology, simulation, matched.nextHopIp)
        const outsideHaScope = !targetInfo.endpoint || destinationIp === haPorts?.frontendAddress || hops.some((hop) => hop.haPorts)
        if (haPorts && (outsideHaScope || haPorts.status !== 'selected')) {
          const reason = outsideHaScope
            ? 'HA ports supports one steering boundary per leg toward an independently owned destination; direct VIP destinations, Internet and chained LB steering are not assessed.' : haPorts.reason
          const assessment: HaPortsAssessment = outsideHaScope
            ? { ...haPorts, status: 'not-assessed', selected: undefined, applianceId: undefined, reason } : haPorts
          pushHop({ nodeKind: 'subnet', nodeId: subnet.id, vnetId: vnet.id, nodeName: vnet.name,
            subnetId: subnet.id, action: 'dropped', matchedRoute: matched, haPorts: assessment, detail: reason })
          return { source, destinationIp, destinationLabel: targetInfo.label,
            status: assessment.status === 'blocked' ? 'dropped-no-route' : 'not-assessed',
            hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: reason }
        }
        const found = findApplianceByIp(topology, haPorts?.backendAddress ?? matched.nextHopIp)
        if (!found) {
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'dropped',
            matchedRoute: matched,
            detail: `NextHop VirtualAppliance IP ${matched.nextHopIp} does not match any appliance in the topology.`,
          })
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: 'dropped-no-route',
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: `VirtualAppliance IP ${matched.nextHopIp} could not be resolved.`,
          }
        }

        // If appliance is in another VNet, it MUST be directly peered (1-hop rule) and pass peering gates
        if (found.vnet.id !== vnet.id) {
          const involvesVnra = stepCursor.viaVnra || found.appliance.kind === 'vnra'
          const check = validatePeeringTransition(vnet, found.vnet, true, involvesVnra)
          if (!check.ok) {
            pushHop({
              nodeKind: 'subnet',
              nodeId: subnet.id,
              vnetId: vnet.id,
              nodeName: vnet.name,
              subnetId: subnet.id,
              subnetName: subnet.name,
              action: 'dropped',
              matchedRoute: matched,
              edgeId: check.peeringId,
              detail: check.reason,
            })
            return {
              source,
              destinationIp,
              destinationLabel: targetInfo.label,
              status: check.status,
              hops,
              traversedApplianceIds,
              traversedEdgeIds,
              traversedVnetIds,
              summaryReason: check.reason,
            }
          }
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'peering-cross',
            matchedRoute: matched,
            edgeId: check.peering.id,
            ...(haPorts ? { haPorts } : {}),
            detail: `Steered by ${matched.originLabel} across peering "${check.peering.name}" to ${found.appliance.name} (${found.appliance.privateIp})${haPorts ? `. ${haPorts.reason}` : ''}`,
          })
        } else {
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'subnet-lookup',
            matchedRoute: matched,
            ...(haPorts ? { haPorts } : {}),
            detail: `Steered by ${matched.originLabel} to ${found.appliance.name} (${found.appliance.privateIp})${haPorts ? `. ${haPorts.reason}` : ''}`,
          })
        }

        cursor = { kind: 'appliance', vnetId: found.vnet.id, applianceId: found.appliance.id }
        continue
      }

      if (matched.nextHopType === 'VirtualNetworkGateway') {
        // Could be a standalone VNetGateway (in local or peered Hub VNet) or an attached vWAN Hub
        const vwanHub = topology.vwanHubs.find((h) => h.id === matched.nextHopResourceId)
        if (vwanHub) {
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'vwan-transit',
            matchedRoute: matched,
            edgeId: `vhub-attach:${vnet.id}:${vwanHub.id}`,
            detail: `Forwards to attached Virtual WAN Hub ${vwanHub.name}`,
          })
          cursor = { kind: 'vwan-hub', hubId: vwanHub.id, tableId: azHubAssociation(vnet.vwanHubAttachment?.hubRouting) }
          continue
        }

        const gwOwnerVnet = topology.vnets.find((v) => v.gateways.some((g) => g.id === matched.nextHopResourceId))
        const gw = gwOwnerVnet?.gateways.find((g) => g.id === matched.nextHopResourceId)
        if (!gwOwnerVnet || !gw || !gw.enabled) {
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: 'dropped-no-route',
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: 'Target Virtual Network Gateway is missing or disabled.',
          }
        }
        if (gwOwnerVnet.id !== vnet.id) {
          const check = validatePeeringTransition(vnet, gwOwnerVnet, true, stepCursor.viaVnra)
          if (!check.ok) {
            pushHop({
              nodeKind: 'subnet',
              nodeId: subnet.id,
              vnetId: vnet.id,
              nodeName: vnet.name,
              subnetId: subnet.id,
              subnetName: subnet.name,
              action: 'dropped',
              matchedRoute: matched,
              edgeId: check.peeringId,
              detail: check.reason,
            })
            return {
              source,
              destinationIp,
              destinationLabel: targetInfo.label,
              status: check.status,
              hops,
              traversedApplianceIds,
              traversedEdgeIds,
              traversedVnetIds,
              summaryReason: check.reason,
            }
          }
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'peering-cross',
            matchedRoute: matched,
            edgeId: check.peering.id,
            detail: `Uses Remote Gateway Transit across "${check.peering.name}" to ${gw.name} in ${gwOwnerVnet.name}`,
          })
        } else {
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'gateway-transit',
            matchedRoute: matched,
            detail: `Forwards to local ${gw.kind} Gateway ${gw.name}`,
          })
        }
        cursor = { kind: 'vnet-gateway', vnetId: gwOwnerVnet.id, gatewayId: gw.id, direction: 'egress' }
        continue
      }

      if (matched.nextHopType === 'Internet') {
        const gatewayInternetFallback = subnet.name === 'GatewaySubnet' && stepCursor.fromExternalVnet && matched.source === 'System'
        if (!targetInfo.endpoint && !privateDestination && !gatewayInternetFallback) {
          const natGateway = natGatewayForSubnet(topology, { kind: 'vnet', id: vnet.id }, subnet.id)
          const instancePublicIp = source.kind === 'subnet' && source.vnetId === vnet.id && source.subnetId === subnet.id
            && options?.sourceAddress && namedEndpoints(topology).some(({ nic, config }) => nic.owner.id === vnet.id
              && config.subnetId === subnet.id && config.privateIp === options.sourceAddress && config.publicIpId)
          const lbEndpoint = source.kind === 'subnet' && source.vnetId === vnet.id && source.subnetId === subnet.id
            && options?.sourceAddress ? namedEndpoints(topology).find(({ nic, config }) => nic.owner.id === vnet.id
              && config.subnetId === subnet.id && config.privateIp === options.sourceAddress) : undefined
          const loadBalancerOutbound = lbEndpoint && loadBalancerOutboundCandidates(topology, {
            workloadId: lbEndpoint.workload.id, nicId: lbEndpoint.nic.id, ipConfigurationId: lbEndpoint.config.id,
          }).some((candidate) => candidate.primaryKnown && !candidate.unsupported && candidate.lb.rulesStatus !== 'unknown' && candidate.pool.membersStatus !== 'unknown')
          if (subnet.internetEgressStatus === 'unknown' && !natGateway && !instancePublicIp && !loadBalancerOutbound) {
            const reason = 'Captured Internet egress association is incomplete or unsupported; its absence is not proof of no outbound method.'
            pushHop({ nodeKind: 'subnet', nodeId: subnet.id, vnetId: vnet.id, nodeName: subnet.name, subnetId: subnet.id,
              action: 'subnet-lookup', matchedRoute: matched, detail: reason })
            return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed', hops,
              traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: reason }
          }
          if (subnet.defaultOutboundAccess === false && !natGateway && !instancePublicIp && !loadBalancerOutbound) {
            pushHop({
              nodeKind: 'subnet',
              nodeId: subnet.id,
              vnetId: vnet.id,
              nodeName: vnet.name,
              subnetId: subnet.id,
              subnetName: subnet.name,
              action: 'dropped',
              matchedRoute: matched,
              detail: `Dropped in ${vnet.name}/${subnet.name}: subnet has defaultOutboundAccess=false (private subnet without NAT Gateway / Public IP) and matched System 0.0.0.0/0 → Internet without an explicit NVA/Firewall UDR.`,
            })
            return {
              source,
              destinationIp,
              destinationLabel: targetInfo.label,
              status: 'dropped-no-outbound-access',
              hops,
              traversedApplianceIds,
              traversedEdgeIds,
              traversedVnetIds,
              summaryReason: `Dropped in ${vnet.name}/${subnet.name}: defaultOutboundAccess=false blocks implicit Internet breakout; add a 0.0.0.0/0 UDR to Azure Firewall/NVA or enable outbound access.`,
            }
          }
          pushHop({
            nodeKind: 'subnet',
            nodeId: subnet.id,
            vnetId: vnet.id,
            nodeName: vnet.name,
            subnetId: subnet.id,
            subnetName: subnet.name,
            action: 'delivered',
            matchedRoute: matched,
            detail: `Egresses directly to Internet from ${vnet.name}/${subnet.name} (${natGateway ? 'explicit NAT Gateway' : instancePublicIp ? 'explicit instance public IP' : loadBalancerOutbound ? 'Load Balancer outbound configuration (packet protocol not assessed)' : 'legacy default outbound access'}); this route probe does not assess translation or security.`,
          })
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: 'delivered',
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: `Egresses directly to Internet from ${vnet.name}/${subnet.name}.`,
          }
        }
        pushHop({
          nodeKind: 'subnet',
          nodeId: subnet.id,
          vnetId: vnet.id,
          nodeName: vnet.name,
          subnetId: subnet.id,
          subnetName: subnet.name,
          action: 'dropped',
          matchedRoute: matched,
          detail: `Destination ${destinationIp} (${targetInfo.label}) has no private forwarding route and fell back to the Internet route; private addresses and gateway-ingress traffic cannot use implicit Internet breakout.`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Destination ${destinationIp} matched only the Internet route in ${vnet.name}/${subnet.name} (missing private forwarding route, summary hole, or BGP propagation disabled).`,
        }
      }
    }

    if (stepCursor.kind === 'appliance') {
      const vnet = topology.vnets.find((v) => v.id === stepCursor.vnetId)!
      const app = vnet.appliances.find((a) => a.id === stepCursor.applianceId)!
      if (!app.enableIpForwarding) {
        pushHop({
          nodeKind: 'appliance',
          nodeId: app.id,
          vnetId: vnet.id,
          nodeName: app.name,
          subnetId: app.subnetId,
          action: 'dropped',
          detail: `Dropped at ${app.name} (${app.privateIp}): NIC IP Forwarding is disabled.`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-ip-forwarding-disabled',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Dropped at ${app.name}: IP Forwarding is disabled.`,
        }
      }

      if (!traversedApplianceIds.includes(app.id)) {
        traversedApplianceIds.push(app.id)
      }

      const actionKind =
        app.kind === 'azure-firewall'
          ? 'inspect-firewall'
          : app.kind === 'vnra'
            ? 'vnra-transit'
            : 'inspect-nva'

      if (options?.sourceApplianceId === app.id && app.staticRoutes.some((route) => route.enabled && !cidr(route.prefix))) {
        return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed',
          hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: 'Conditional return contains an invalid enabled static prefix; reachability is not inferred.' }
      }
      const conditionalStatics = options?.sourceApplianceId === app.id
        ? app.staticRoutes.filter((route) => route.enabled && cidr(route.prefix) && contains(route.prefix, ipNum))
          .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length) : []
      const conditionalStatic = conditionalStatics[0]
      const nestedHaStatic = app.staticRoutes.find((route) => route.enabled && route.nextHopKind === 'appliance'
        && cidr(route.prefix) && contains(route.prefix, ipNum)
        && resolveHaPortsNextHop(topology, simulation, route.nextHopIp))
      if (nestedHaStatic) {
        const unsupportedHa = unsupportedNvaHaHop(vnet, app, nestedHaStatic.nextHopIp)
        if (unsupportedHa) return unsupportedHa
      }
      if (conditionalStatic && conditionalStatics.filter((route) => cidr(route.prefix)!.length === cidr(conditionalStatic.prefix)!.length).length > 1) {
        return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed',
          hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: 'Equal-prefix conditional return static routes are ambiguous.' }
      }
      if (conditionalStatic && conditionalStatic.nextHopKind !== 'subnet' && conditionalStatic.nextHopKind !== 'appliance') {
        const dropped = conditionalStatic.nextHopKind === 'drop'
        const reason = dropped ? `Conditional return is discarded by original appliance static route ${conditionalStatic.id} (${conditionalStatic.prefix}).`
          : `Conditional return static route ${conditionalStatic.id} selects ${conditionalStatic.nextHopKind}; this return next-hop configuration is not assessed.`
        pushHop({ nodeKind: 'appliance', nodeId: app.id, vnetId: vnet.id, nodeName: app.name, subnetId: app.subnetId,
          action: dropped ? 'dropped' : actionKind, detail: reason })
        return { source, destinationIp, destinationLabel: targetInfo.label, status: dropped ? 'dropped-blackhole' : 'not-assessed',
          hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: reason }
      }
      if (conditionalStatic?.nextHopKind === 'appliance' && !findApplianceByIp(topology, conditionalStatic.nextHopIp)) {
        return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed',
          hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds, summaryReason: 'Conditional return static next-hop appliance is unknown.' }
      }
      if (conditionalStatic?.nextHopKind === 'appliance' && conditionalStatic.nextHopIp === app.privateIp) {
        cursor = { kind: 'appliance', vnetId: vnet.id, applianceId: app.id }
        continue
      }

      // Check if this appliance has a direct S2S VPN / SD-WAN overlay tunnel to the destination site
      const directVpn = topology.vpnConnections.find((c) => {
        if (!c.enabled || c.targetKind !== 'appliance' || c.targetId !== app.id) return false
        const site = topology.sites.find((s) => s.id === c.siteId)
        return site?.prefixes.some((p) => cidr(p) && contains(p, ipNum))
      })
      if (directVpn) {
        pushHop({
          nodeKind: 'appliance',
          nodeId: app.id,
          vnetId: vnet.id,
          nodeName: app.name,
          subnetId: app.subnetId,
          action: actionKind,
          edgeId: directVpn.id,
          detail: `${app.name} forwards over overlay tunnel "${directVpn.name}"`,
        })
        cursor = { kind: 'site', siteId: directVpn.siteId }
        continue
      }

      const hostingTable = simulation.subnetTables[app.subnetId]
      const hostingRoute = hostingTable ? lookupSubnetEffectiveRoute(hostingTable, destinationIp) : undefined
      const explicitSubnetPolicy = hostingRoute?.source === 'User'

      // An explicit selected subnet policy must be consulted before topology shortcuts.
      if (!explicitSubnetPolicy && conditionalStatic?.nextHopKind !== 'appliance' && targetInfo.vnet?.id === vnet.id && targetInfo.subnet) {
        pushHop({
          nodeKind: 'appliance',
          nodeId: app.id,
          vnetId: vnet.id,
          nodeName: app.name,
          subnetId: app.subnetId,
          action: actionKind,
          detail: `${app.name} inspects/forwards packet to local subnet ${targetInfo.subnet.name} in ${vnet.name}`,
        })
        cursor = {
          kind: 'subnet',
          vnetId: vnet.id,
          subnetId: targetInfo.subnet.id,
          fromExternalVnet: originVnetId !== vnet.id,
          viaVnra: app.kind === 'vnra',
        }
        continue
      }

      // Check if Destination is in a DIRECTLY peered VNet
      if (!explicitSubnetPolicy && conditionalStatic?.nextHopKind !== 'appliance' && targetInfo.vnet && targetInfo.subnet) {
        const directRel = getActivePeeringBetween(topology, vnet.id, targetInfo.vnet.id)
        if (directRel) {
          const check = validatePeeringTransition(vnet, targetInfo.vnet, true, app.kind === 'vnra')
          if (!check.ok) {
            pushHop({
              nodeKind: 'appliance',
              nodeId: app.id,
              vnetId: vnet.id,
              nodeName: app.name,
              subnetId: app.subnetId,
              action: 'dropped',
              edgeId: check.peeringId,
              detail: check.reason,
            })
            return {
              source,
              destinationIp,
              destinationLabel: targetInfo.label,
              status: check.status,
              hops,
              traversedApplianceIds,
              traversedEdgeIds,
              traversedVnetIds,
              summaryReason: check.reason,
            }
          }
          pushHop({
            nodeKind: 'appliance',
            nodeId: app.id,
            vnetId: vnet.id,
            nodeName: app.name,
            subnetId: app.subnetId,
            action: actionKind,
            edgeId: check.peering.id,
            detail: `${app.name} (${app.privateIp}) forwards across peering "${check.peering.name}" to ${targetInfo.vnet.name}/${targetInfo.subnet.name}`,
          })
          cursor = {
            kind: 'subnet',
            vnetId: targetInfo.vnet.id,
            subnetId: targetInfo.subnet.id,
            fromExternalVnet: true,
            viaVnra: app.kind === 'vnra',
          }
          continue
        }

        // Check if there is a chained Hub-to-Hub peering with a next-hop appliance in the remote hub!
        let chainedAcrossHubs = false
        for (const candidateHub of topology.vnets) {
          if (candidateHub.id === vnet.id) continue
          const hubPeering = getActivePeeringBetween(topology, vnet.id, candidateHub.id)
          const remoteSpokePeering = getActivePeeringBetween(topology, candidateHub.id, targetInfo.vnet.id)
          if (hubPeering && remoteSpokePeering && candidateHub.appliances.length > 0) {
            const remoteApp = candidateHub.appliances[0]
            const check = validatePeeringTransition(
              vnet,
              candidateHub,
              true,
              app.kind === 'vnra' || remoteApp.kind === 'vnra',
            )
            if (!check.ok) {
              pushHop({
                nodeKind: 'appliance',
                nodeId: app.id,
                vnetId: vnet.id,
                nodeName: app.name,
                subnetId: app.subnetId,
                action: 'dropped',
                edgeId: check.peeringId,
                detail: check.reason,
              })
              return {
                source,
                destinationIp,
                destinationLabel: targetInfo.label,
                status: check.status,
                hops,
                traversedApplianceIds,
                traversedEdgeIds,
                traversedVnetIds,
                summaryReason: check.reason,
              }
            }
            pushHop({
              nodeKind: 'appliance',
              nodeId: app.id,
              vnetId: vnet.id,
              nodeName: app.name,
              subnetId: app.subnetId,
              action: actionKind,
              edgeId: check.peering.id,
              detail: `${app.name} chains transit across global peering "${check.peering.name}" to ${remoteApp.name} (${remoteApp.privateIp})`,
            })
            cursor = { kind: 'appliance', vnetId: candidateHub.id, applianceId: remoteApp.id }
            chainedAcrossHubs = true
            break
          }
        }
        if (chainedAcrossHubs) {
          continue
        }
      }

      // Check explicit appliance static routes (e.g., cross-hub NVA next hop)
      const matchingStaticRoutes = (app.staticRoutes ?? [])
        .filter((sr) => (options?.sourceApplianceId !== app.id || sr.enabled) && cidr(sr.prefix) && contains(sr.prefix, ipNum))
        .sort((a, b) => (cidr(b.prefix)?.length ?? 0) - (cidr(a.prefix)?.length ?? 0))
      if (matchingStaticRoutes.length > 0) {
        const sr = matchingStaticRoutes[0]
        const staticTargetApp = findApplianceByIp(topology, sr.nextHopIp)
        if (staticTargetApp && staticTargetApp.appliance.id !== app.id) {
          if (staticTargetApp.vnet.id !== vnet.id) {
            const check = validatePeeringTransition(
              vnet,
              staticTargetApp.vnet,
              true,
              app.kind === 'vnra' || staticTargetApp.appliance.kind === 'vnra',
            )
            if (!check.ok) {
              pushHop({
                nodeKind: 'appliance',
                nodeId: app.id,
                vnetId: vnet.id,
                nodeName: app.name,
                subnetId: app.subnetId,
                action: 'dropped',
                edgeId: check.peeringId,
                detail: check.reason,
              })
              return {
                source,
                destinationIp,
                destinationLabel: targetInfo.label,
                status: check.status,
                hops,
                traversedApplianceIds,
                traversedEdgeIds,
                traversedVnetIds,
                summaryReason: check.reason,
              }
            }
            pushHop({
              nodeKind: 'appliance',
              nodeId: app.id,
              vnetId: vnet.id,
              nodeName: app.name,
              subnetId: app.subnetId,
              action: actionKind,
              edgeId: check.peering.id,
              detail: `${app.name} forwards via static route ${sr.prefix} across peering "${check.peering.name}" to ${staticTargetApp.appliance.name} (${staticTargetApp.appliance.privateIp})`,
            })
          } else {
            pushHop({
              nodeKind: 'appliance',
              nodeId: app.id,
              vnetId: vnet.id,
              nodeName: app.name,
              subnetId: app.subnetId,
              action: actionKind,
              detail: `${app.name} forwards via static route ${sr.prefix} to ${staticTargetApp.appliance.name} (${staticTargetApp.appliance.privateIp})`,
            })
          }
          cursor = {
            kind: 'appliance',
            vnetId: staticTargetApp.vnet.id,
            applianceId: staticTargetApp.appliance.id,
          }
          continue
        }
      }

      // Consult the appliance's hosting subnet Effective Route Table (for Gateway egress to on-prem / Internet).
      const appSubTable = simulation.subnetTables[app.subnetId]
      const rawSubnetWin = appSubTable ? lookupSubnetEffectiveRoute(appSubTable, destinationIp) : undefined

      // Detect ARS 0.0.0.0/0 self-blackhole loop: if the NVA advertises 0.0.0.0/0 to ARS and its own subnet lacks
      // a 0.0.0.0/0 -> Internet UDR (or disableBgpRoutePropagation=true), ARS injects 0.0.0.0/0 -> NVA into the NVA's
      // own subnet, overriding System 0.0.0.0/0 -> Internet and hairpining Internet egress back to the NVA NIC.
      if (
        rawSubnetWin &&
        (rawSubnetWin.nextHopResourceId === app.id || rawSubnetWin.nextHopIp === app.privateIp) &&
        rawSubnetWin.prefix === '0.0.0.0/0' &&
        !targetInfo.endpoint
      ) {
        const appSubName = vnet.subnets.find((s) => s.id === app.subnetId)?.name ?? app.subnetId
        pushHop({
          nodeKind: 'appliance',
          nodeId: app.id,
          vnetId: vnet.id,
          nodeName: app.name,
          subnetId: app.subnetId,
          subnetName: appSubName,
          action: 'loop',
          matchedRoute: rawSubnetWin,
          detail: `${app.name} advertised 0.0.0.0/0 to ${vnet.routeServer?.name ?? 'Route Server'}, which injected 0.0.0.0/0 → ${app.privateIp} into ${vnet.name}/${appSubName} and overrode System 0.0.0.0/0 → Internet (self-loop).`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'loop',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Self-loop in ${vnet.name}/${appSubName}: ARS-injected 0.0.0.0/0 → ${app.privateIp} overrides System Internet route on ${app.name}'s own subnet.`,
        }
      }

      const filteredAppTable: AzSubnetRouteTableResult | undefined = appSubTable
        ? {
            ...appSubTable,
            routes: appSubTable.routes.filter(
              (r) => r.nextHopResourceId !== app.id && r.nextHopIp !== app.privateIp,
            ),
          }
        : undefined
      const nextRoute = filteredAppTable ? lookupSubnetEffectiveRoute(filteredAppTable, destinationIp) : undefined
      if (nextRoute?.nextHopType === 'VirtualAppliance') {
        const unsupportedHa = unsupportedNvaHaHop(vnet, app, nextRoute.nextHopIp)
        if (unsupportedHa) return unsupportedHa
        const target = findApplianceByIp(topology, nextRoute.nextHopIp)
        const transition = target && target.vnet.id !== vnet.id
          ? validatePeeringTransition(vnet, target.vnet, true, app.kind === 'vnra' || target.appliance.kind === 'vnra') : undefined
        if (target && (!transition || transition.ok)) {
          pushHop({
            nodeKind: 'appliance', nodeId: app.id, vnetId: vnet.id, nodeName: app.name, subnetId: app.subnetId,
            action: actionKind, matchedRoute: nextRoute, edgeId: transition?.ok ? transition.peering.id : undefined,
            detail: `${app.name} forwards using subnet route ${nextRoute.prefix} to ${target.appliance.name} (${target.appliance.privateIp})`,
          })
          cursor = { kind: 'appliance', vnetId: target.vnet.id, applianceId: target.appliance.id }
          continue
        }
      }
      if (nextRoute?.nextHopType === 'VirtualNetworkGateway' && nextRoute.nextHopResourceId) {
        const hub = topology.vwanHubs.find((hub) => hub.id === nextRoute.nextHopResourceId
          && vnet.vwanHubAttachment?.enabled && vnet.vwanHubAttachment.hubId === hub.id)
        if (hub) {
          pushHop({
            nodeKind: 'appliance', nodeId: app.id, vnetId: vnet.id, nodeName: app.name, subnetId: app.subnetId,
            action: actionKind, matchedRoute: nextRoute, edgeId: `vhub-attach:${vnet.id}:${hub.id}`,
            detail: `${app.name} forwards using its subnet route over the original VNet connection to ${hub.name}`,
          })
          cursor = { kind: 'vwan-hub', hubId: hub.id, tableId: azHubAssociation(vnet.vwanHubAttachment?.hubRouting) }
          continue
        }
        const gw = vnet.gateways.find((g) => g.id === nextRoute.nextHopResourceId)
        if (gw) {
          pushHop({
            nodeKind: 'appliance',
            nodeId: app.id,
            vnetId: vnet.id,
            nodeName: app.name,
            subnetId: app.subnetId,
            action: actionKind,
            matchedRoute: nextRoute,
            detail: `${app.name} inspects packet and forwards to ${gw.name} (${gw.kind})`,
          })
          cursor = { kind: 'vnet-gateway', vnetId: vnet.id, gatewayId: gw.id, direction: 'egress' }
          continue
        }
      }

      // Non-default prefixes originated directly by this NVA (e.g., loopback or NVA-terminated branch prefix)
      const selfAdvertised = (app.advertisedPrefixes ?? []).find(
        (p) => p !== '0.0.0.0/0' && cidr(p) && contains(p, ipNum),
      )
      if (selfAdvertised) {
        const transitGw =
          vnet.routeServer?.branchToBranchTraffic !== false
            ? vnet.gateways.find(
                (g) =>
                  g.enabled &&
                  topology.vpnConnections.some((c) => {
                    if (!c.enabled || c.targetKind !== 'vnet-gateway' || c.targetId !== g.id) return false
                    const site = topology.sites.find((s) => s.id === c.siteId)
                    return Boolean(site?.prefixes.some((sp) => cidr(sp) && contains(sp, ipNum)))
                  }),
              )
            : undefined
        if (transitGw) {
          pushHop({
            nodeKind: 'appliance',
            nodeId: app.id,
            vnetId: vnet.id,
            nodeName: app.name,
            subnetId: app.subnetId,
            action: actionKind,
            detail: `${app.name} inspects packet for advertised prefix ${selfAdvertised} and forwards to ${transitGw.name}`,
          })
          cursor = { kind: 'vnet-gateway', vnetId: vnet.id, gatewayId: transitGw.id, direction: 'egress' }
          continue
        }
        if (!targetInfo.endpoint) {
          pushHop({
            nodeKind: 'appliance',
            nodeId: app.id,
            vnetId: vnet.id,
            nodeName: app.name,
            subnetId: app.subnetId,
            action: 'delivered',
            detail: `Delivered to ${app.name}-originated prefix ${selfAdvertised} (${destinationIp})`,
          })
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: 'delivered',
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: `Delivered to ${app.name} advertised prefix ${selfAdvertised}.`,
          }
        }
      }

      if (nextRoute?.nextHopType === 'Internet' && !targetInfo.endpoint && !privateDestination) {
        pushHop({
          nodeKind: 'appliance',
          nodeId: app.id,
          vnetId: vnet.id,
          nodeName: app.name,
          subnetId: app.subnetId,
          action: 'delivered',
          matchedRoute: nextRoute,
          detail: `${app.name} forwards toward Internet; translation and security are not assessed by this route probe.`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'delivered',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Inspected by ${app.name} and delivered to Internet.`,
        }
      }

      pushHop({
        nodeKind: 'appliance',
        nodeId: app.id,
        vnetId: vnet.id,
        nodeName: app.name,
        subnetId: app.subnetId,
        action: 'dropped',
        detail: `${app.name} has no valid next hop to reach ${destinationIp} (${targetInfo.label}).`,
      })
      return {
        source,
        destinationIp,
        destinationLabel: targetInfo.label,
        status: 'dropped-no-route',
        hops,
        traversedApplianceIds,
        traversedEdgeIds,
        traversedVnetIds,
        summaryReason: `${app.name} has no route to ${destinationIp}.`,
      }
    }

    if (stepCursor.kind === 'vnet-gateway') {
      const vnet = topology.vnets.find((v) => v.id === stepCursor.vnetId)!
      const gw = vnet.gateways.find((g) => g.id === stepCursor.gatewayId)!

      if (stepCursor.direction === 'egress') {
        // Standalone Virtual Network Gateways cannot route Spoke-to-Spoke traffic between peered Azure VNets
        const gwRibMatches = (simulation.gatewayRibs[gw.id] ?? []).filter(
          (r) => r.preferred && cidr(r.prefix) && contains(r.prefix, ipNum),
        )
        const selectedGatewayRoute = [...gwRibMatches].sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
        if (targetInfo.vnet && gwRibMatches.length === 0) {
          pushHop({
            nodeKind: 'vnet-gateway',
            nodeId: gw.id,
            vnetId: vnet.id,
            nodeName: gw.name,
            action: 'dropped',
            detail: `Standalone Virtual Network Gateway ${gw.name} (${gw.kind}) does not route traffic between peered Azure VNets (${targetInfo.vnet.name}); an NVA/Firewall or Virtual WAN Hub is required for Spoke-to-Spoke transit.`,
          })
          return {
            source,
            destinationIp,
            destinationLabel: targetInfo.label,
            status: 'dropped-no-route',
            hops,
            traversedApplianceIds,
            traversedEdgeIds,
            traversedVnetIds,
            summaryReason: `Dropped at ${gw.name}: standalone Virtual Network Gateways do not transit traffic between Azure VNets (${targetInfo.vnet.name}).`,
          }
        }

        if (gw.kind === 'ExpressRoute') {
          const erLink = topology.erLinks.find(
            (l) => l.enabled && l.targetKind === 'vnet-gateway' && l.targetId === gw.id &&
              (!selectedGatewayRoute?.connectionId || l.id === selectedGatewayRoute.connectionId),
          )
          if (erLink) {
            const loc = topology.erLocations.find((l) => l.id === erLink.locationId)
            pushHop({
              nodeKind: 'vnet-gateway',
              nodeId: gw.id,
              vnetId: vnet.id,
              nodeName: gw.name,
              action: 'gateway-transit',
              edgeId: erLink.id,
              detail: `${gw.name} transmits over ExpressRoute connection "${erLink.name}" to ${loc?.name ?? erLink.locationId}`,
            })
            cursor = { kind: 'er-location', locationId: erLink.locationId, fromTargetId: gw.id }
            continue
          }
        } else {
          // VPN Gateway egress to Site matching destinationIp (or default 0.0.0.0/0 site)
          const vpnConn = topology.vpnConnections.find((c) => {
            if (!c.enabled || c.targetKind !== 'vnet-gateway' || c.targetId !== gw.id) return false
            if (selectedGatewayRoute?.connectionId) return c.id === selectedGatewayRoute.connectionId
            if (c.bgpEnabled && gw.bgpEnabled) return false
            const site = topology.sites.find((s) => s.id === c.siteId)
            const prefixes = c.staticPrefixes?.length ? c.staticPrefixes : (site?.prefixes ?? [])
            return prefixes.some((p) => cidr(p) && contains(p, ipNum))
          })
          if (vpnConn) {
            const blocked = crossVpn(vpnConn.id, 'egress')
            if (blocked) return blocked
            pushHop({
              nodeKind: 'vnet-gateway',
              nodeId: gw.id,
              vnetId: vnet.id,
              nodeName: gw.name,
              action: 'gateway-transit',
              edgeId: vpnConn.id,
              detail: `${gw.name} encrypts packet over S2S IPsec tunnel "${vpnConn.name}"`,
            })
            cursor = { kind: 'site', siteId: vpnConn.siteId }
            continue
          }
        }

        pushHop({
          nodeKind: 'vnet-gateway',
          nodeId: gw.id,
          vnetId: vnet.id,
          nodeName: gw.name,
          action: 'dropped',
          detail: `${gw.name} has no active ${gw.kind} tunnel/route matching ${destinationIp} (${targetInfo.label}).`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Dropped at ${gw.name}: no tunnel or route matches ${destinationIp}.`,
        }
      } else {
        // Ingress from On-Premises into `GatewaySubnet`!
        const gwSubnet = vnet.subnets.find((s) => s.name === 'GatewaySubnet') ?? vnet.subnets[0]
        pushHop({
          nodeKind: 'vnet-gateway',
          nodeId: gw.id,
          vnetId: vnet.id,
          nodeName: gw.name,
          subnetId: gwSubnet?.id,
          subnetName: gwSubnet?.name,
          action: 'gateway-transit',
          detail: `${gw.name} receives packet in ${vnet.name}/${gwSubnet?.name ?? 'GatewaySubnet'} and evaluates GatewaySubnet Effective Route Table`,
        })
        if (gwSubnet) {
          cursor = {
            kind: 'subnet',
            vnetId: vnet.id,
            subnetId: gwSubnet.id,
            fromExternalVnet: true,
            viaVnra: false,
          }
          continue
        }
      }
    }

    if (stepCursor.kind === 'vwan-hub') {
      const hub = topology.vwanHubs.find((h) => h.id === stepCursor.hubId)!
      const tableId = stepCursor.tableId
      const coverage = simulation.vwanHubTableCoverage[hub.id]?.[tableId]
      if (!coverage?.complete) {
        return {
          source, destinationIp, destinationLabel: targetInfo.label,
          status: 'not-assessed', hops, traversedApplianceIds, traversedEdgeIds, traversedVnetIds,
          summaryReason: `Routing scope ${hub.name}/${tableId} is unknown or unsupported; reachability and isolation are not established.`,
        }
      }
      let selectedHubRoute = (simulation.vwanHubTables[hub.id]?.[tableId] ?? [])
        .filter((route) => route.preferred && cidr(route.prefix) && contains(route.prefix, ipNum))
        .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
      while (selectedHubRoute?.forwardingRoutes && selectedHubRoute.nextHopKind !== 'vwan-hub') {
        selectedHubRoute = selectedHubRoute.forwardingRoutes.filter((route) => contains(route.prefix, ipNum))
          .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
      }
      if (selectedHubRoute?.nextHopKind === 'hub-firewall') {
        if (source.kind === 'site' && targetInfo.endpoint?.kind === 'site') {
          return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed', hops,
            traversedApplianceIds, traversedEdgeIds, traversedVnetIds,
            summaryReason: 'Static hub Firewall branch-to-branch inspection is not supported; use routing intent.' }
        }
        const firewall = hub.firewall!
        traversedApplianceIds.push(firewall.id)
        pushHop({ nodeKind: 'vwan-hub', nodeId: hub.id, nodeName: firewall.name, action: 'inspect-firewall',
          hubTableId: tableId, detail: `Static hub route ${selectedHubRoute.staticRouteName} (${selectedHubRoute.prefix}) selects ${firewall.name} [${firewall.id}]. Firewall policy and delivery are not assessed.` })
        let onward = (simulation.vwanFirewallRibs[hub.id] ?? [])
          .filter((route) => route.preferred && contains(route.prefix, ipNum))
          .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)
        const onwardContexts = new Set<AzBgpRibEntry>()
        while (true) {
          const longest = onward[0] ? cidr(onward[0].prefix)!.length : -1
          if (new Set(onward.filter((route) => cidr(route.prefix)!.length === longest)
            .map((route) => JSON.stringify([route.nextHopKind, route.nextHopId, route.connectionId]))).size > 1
            || onward[0] && onwardContexts.has(onward[0])) {
            return { source, destinationIp, destinationLabel: targetInfo.label, status: 'not-assessed', hops,
              traversedApplianceIds, traversedEdgeIds, traversedVnetIds,
              summaryReason: 'Ambiguous or cyclic Firewall onward paths require exhaustive assessment; no single traffic hash or passing route is selected.' }
          }
          selectedHubRoute = onward[0]
          if (!selectedHubRoute?.forwardingRoutes) break
          onwardContexts.add(selectedHubRoute)
          onward = selectedHubRoute.forwardingRoutes.filter((route) => contains(route.prefix, ipNum))
            .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)
        }
        pushHop({ nodeKind: 'vwan-hub', nodeId: hub.id, nodeName: firewall.name,
          action: selectedHubRoute ? 'vwan-transit' : 'dropped', hubTableId: 'firewall-onward',
          detail: selectedHubRoute ? `Separate Firewall onward lookup selects ${selectedHubRoute.prefix} via ${selectedHubRoute.nextHopName}.`
            : 'No matching Firewall onward route; the ingress static route is not reused.' })
      }
      const intentPrivateDestination = privateDestination || hub.routingIntent.privatePrefixes?.some((prefix) => contains(prefix, ipNum))
      if (hub.routingIntent.private && intentPrivateDestination) {
        const fwId = hub.firewall?.id ?? `vhub-fw:${hub.id}`
        if (!traversedApplianceIds.includes(fwId)) {
          traversedApplianceIds.push(fwId)
          pushHop({
            nodeKind: 'vwan-hub',
            nodeId: hub.id,
            nodeName: `${hub.name} · Secured Hub Azure Firewall`,
            action: 'inspect-firewall',
            detail: `Virtual WAN Routing Intent steers private traffic through Secured Hub Firewall in ${hub.name}`,
          })
        }
      }

      // Check attached VNets
      const attachedTargetVnet = selectedHubRoute?.nextHopKind === 'local' ? topology.vnets.find(
        (v) =>
          v.id === selectedHubRoute.nextHopId &&
          v.vwanHubAttachment?.enabled &&
          v.vwanHubAttachment.hubId === hub.id &&
          v.prefixes.some((p) => cidr(p) && contains(p, ipNum)),
      ) : undefined
      if (attachedTargetVnet && attachedTargetVnet.subnets[0]) {
        pushHop({
          nodeKind: 'vwan-hub',
          nodeId: hub.id,
          nodeName: hub.name,
          action: 'vwan-transit',
          hubTableId: tableId,
          edgeId: `vhub-attach:${attachedTargetVnet.id}:${hub.id}`,
          detail: `${hub.name} forwards over VNet connection to ${attachedTargetVnet.name}`,
        })
        cursor = {
          kind: 'subnet',
          vnetId: attachedTargetVnet.id,
          subnetId: attachedTargetVnet.subnets[0].id,
          fromExternalVnet: true,
          viaVnra: false,
        }
        continue
      }

      // Check if attached vWAN Hub has Internet Routing Intent for public Internet destinations
      if (!targetInfo.endpoint && !intentPrivateDestination && hub.routingIntent.internet) {
        const fwId = hub.firewall?.id ?? `vhub-fw:${hub.id}`
        if (!traversedApplianceIds.includes(fwId)) {
          traversedApplianceIds.push(fwId)
        }
        pushHop({
          nodeKind: 'vwan-hub',
          nodeId: hub.id,
          nodeName: `${hub.name} · Secured Hub Internet Breakout`,
          action: 'delivered',
          detail: `Virtual WAN Internet Routing Intent inspects and breaks out ${destinationIp} to Internet via ${hub.name} Secured Hub Firewall`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'delivered',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Inspected by ${hub.name} Secured Hub Firewall (Internet Routing Intent) and delivered to Internet.`,
        }
      }

      if (selectedHubRoute?.nextHopKind === 'vwan-hub' && selectedHubRoute.originHubTableId) {
        const remoteHub = topology.vwanHubs.find((candidate) => candidate.id === selectedHubRoute.nextHopId)!
        pushHop({
          nodeKind: 'vwan-hub', nodeId: hub.id, nodeName: hub.name, action: 'vwan-transit',
          hubTableId: tableId, edgeId: azInterHubId(hub.id, remoteHub.id),
          detail: `${hub.name} table ${tableId} forwards to ${remoteHub.name} table ${selectedHubRoute.originHubTableId}`,
        })
        cursor = { kind: 'vwan-hub', hubId: remoteHub.id, tableId: selectedHubRoute.originHubTableId }
        continue
      }
      if (selectedHubRoute?.nextHopKind === 'appliance') {
        const owner = topology.vnets.find((vnet) => vnet.appliances.some((app) => app.id === selectedHubRoute!.nextHopId))
        if (owner) {
          pushHop({
            nodeKind: 'vwan-hub', nodeId: hub.id, nodeName: hub.name, action: 'vwan-transit',
            edgeId: selectedHubRoute.connectionId, hubTableId: tableId,
            detail: `${hub.name} forwards over the original VNet connection to BGP NVA ${selectedHubRoute.nextHopName}`,
          })
          cursor = { kind: 'appliance', vnetId: owner.id, applianceId: selectedHubRoute.nextHopId }
          continue
        }
      }
      const vpn = topology.vpnConnections.find((connection) => connection.enabled &&
        connection.targetKind === 'vwan-hub' && connection.targetId === hub.id && connection.id === selectedHubRoute?.connectionId)
      if (vpn) {
        const blocked = crossVpn(vpn.id, 'egress')
        if (blocked) return blocked
        pushHop({
          nodeKind: 'vwan-hub', nodeId: hub.id, nodeName: hub.name, action: 'vwan-transit',
          edgeId: vpn.id, hubTableId: tableId, detail: `${hub.name} forwards over ${vpn.transport === 'SDWAN' ? 'SD-WAN' : 'S2S VPN'} "${vpn.name}"`,
        })
        cursor = { kind: 'site', siteId: vpn.siteId }
        continue
      }

      // Check ER Links from vWAN Hub
      const erLink = topology.erLinks.find(
        (l) => l.enabled && l.targetKind === 'vwan-hub' && l.targetId === hub.id &&
          l.id === selectedHubRoute?.connectionId,
      )
      if (erLink) {
        pushHop({
          nodeKind: 'vwan-hub',
          nodeId: hub.id,
          nodeName: hub.name,
          action: 'vwan-transit',
          hubTableId: tableId,
          edgeId: erLink.id,
          detail: `${hub.name} forwards over ExpressRoute connection "${erLink.name}"`,
        })
        cursor = { kind: 'er-location', locationId: erLink.locationId, fromTargetId: hub.id }
        continue
      }
    }

    if (stepCursor.kind === 'er-location') {
      const loc = topology.erLocations.find((l) => l.id === stepCursor.locationId)!
      const matchingEntry = (simulation.erLocationRibs[loc.id] ?? []).filter(
        (r) => r.preferred && cidr(r.prefix) && contains(r.prefix, ipNum),
      ).sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
      if (!matchingEntry) {
        pushHop({
          nodeKind: 'er-location',
          nodeId: loc.id,
          nodeName: loc.name,
          action: 'dropped',
          detail: `MSEE ${loc.name} has no BGP route matching ${destinationIp}`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Dropped at ExpressRoute location ${loc.name}: no route to ${destinationIp}.`,
        }
      }

      const outLink = topology.erLinks.find(
        (l) =>
          l.enabled &&
          (!matchingEntry.connectionId || l.id === matchingEntry.connectionId) &&
          l.locationId === loc.id &&
          l.targetKind === matchingEntry.nextHopKind &&
          l.targetId === matchingEntry.nextHopId,
      )

      if (matchingEntry.nextHopKind === 'er-location') {
        const remoteLoc = topology.erLocations.find((l) => l.id === matchingEntry.nextHopId)
        const grLink = (topology.erGlobalReachLinks ?? []).find(
          (g) =>
            g.enabled &&
            ((g.locationAId === loc.id && g.locationBId === matchingEntry.nextHopId) ||
              (g.locationBId === loc.id && g.locationAId === matchingEntry.nextHopId)),
        )
        if (remoteLoc && grLink) {
          pushHop({
            nodeKind: 'er-location',
            nodeId: loc.id,
            nodeName: loc.name,
            action: 'er-transit',
            edgeId: grLink.id,
            detail: `MSEE ${loc.name} forwards over ExpressRoute Global Reach "${grLink.name}" to ${remoteLoc.name}`,
          })
          cursor = { kind: 'er-location', locationId: remoteLoc.id, fromTargetId: loc.id }
          continue
        }
      }

      if (matchingEntry.nextHopKind === 'site') {
        pushHop({
          nodeKind: 'er-location',
          nodeId: loc.id,
          nodeName: loc.name,
          action: 'er-transit',
          edgeId: outLink?.id,
          detail: `MSEE ${loc.name} switches traffic onto "${outLink?.name ?? matchingEntry.nextHopName}"`,
        })
        cursor = { kind: 'site', siteId: matchingEntry.nextHopId }
        continue
      }

      if (matchingEntry.nextHopKind === 'vnet-gateway') {
        const ownerVnet = topology.vnets.find((v) => v.gateways.some((g) => g.id === matchingEntry.nextHopId))
        if (ownerVnet) {
          pushHop({
            nodeKind: 'er-location',
            nodeId: loc.id,
            nodeName: loc.name,
            action: 'er-transit',
            edgeId: outLink?.id,
            detail: `MSEE ${loc.name} forwards to ExpressRoute Gateway in ${ownerVnet.name}`,
          })
          cursor = {
            kind: 'vnet-gateway',
            vnetId: ownerVnet.id,
            gatewayId: matchingEntry.nextHopId,
            direction: 'ingress',
          }
          continue
        }
      }

      if (matchingEntry.nextHopKind === 'vwan-hub') {
        pushHop({
          nodeKind: 'er-location',
          nodeId: loc.id,
          nodeName: loc.name,
          action: 'er-transit',
          edgeId: outLink?.id,
          detail: `MSEE ${loc.name} forwards to Virtual WAN Hub ${matchingEntry.nextHopName}`,
        })
        if (!outLink) break
        cursor = { kind: 'vwan-hub', hubId: matchingEntry.nextHopId, tableId: azHubAssociation(outLink.hubRouting) }
        continue
      }
    }

    if (stepCursor.kind === 'site') {
      const site = topology.sites.find((s) => s.id === stepCursor.siteId)!
      if ([...site.prefixes, ...(vpnSiteDelivery?.siteId === site.id ? vpnSiteDelivery.internalPrefixes : [])].some((p) => cidr(p) && contains(p, ipNum))) {
        pushHop({
          nodeKind: 'site',
          nodeId: site.id,
          nodeName: site.name,
          action: 'delivered',
          detail: `Delivered to on-premises site ${site.name} (${destinationIp})`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'delivered',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `Delivered to on-premises site ${site.name} (${destinationIp}).`,
        }
      }

      // Site is originating or transiting toward Azure / another site
      const siteRoutes = (simulation.siteRibs[site.id] ?? []).filter(
        (r) => r.preferred && cidr(r.prefix) && contains(r.prefix, ipNum),
      )
      const best = siteRoutes.sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
      if (!best) {
        pushHop({
          nodeKind: 'site',
          nodeId: site.id,
          nodeName: site.name,
          action: 'dropped',
          detail: `Site ${site.name} has no BGP/static route to ${destinationIp}`,
        })
        return {
          source,
          destinationIp,
          destinationLabel: targetInfo.label,
          status: 'dropped-no-route',
          hops,
          traversedApplianceIds,
          traversedEdgeIds,
          traversedVnetIds,
          summaryReason: `On-premises site ${site.name} has no route to ${destinationIp} (check BGP propagation or Advertised Gateway Prefixes).`,
        }
      }

      if (best.nextHopKind === 'er-location') {
        const erLink = topology.erLinks.find(
          (l) => l.enabled && l.locationId === best.nextHopId && l.targetKind === 'site' && l.targetId === site.id &&
            (!best.connectionId || l.id === best.connectionId),
        )
        pushHop({
          nodeKind: 'site',
          nodeId: site.id,
          nodeName: site.name,
          action: 'er-transit',
          edgeId: erLink?.id,
          detail: `${site.name} sends packet over ExpressRoute circuit "${erLink?.name ?? best.nextHopName}"`,
        })
        cursor = { kind: 'er-location', locationId: best.nextHopId, fromTargetId: site.id }
        continue
      }

      if (best.nextHopKind === 'vnet-gateway') {
        const ownerVnet = topology.vnets.find((v) => v.gateways.some((g) => g.id === best.nextHopId))
        const vpnConn = topology.vpnConnections.find(
          (c) => c.enabled && c.siteId === site.id && c.targetKind === 'vnet-gateway' && c.targetId === best.nextHopId &&
            (!best.connectionId || c.id === best.connectionId),
        )
        if (ownerVnet) {
          if (vpnConn) {
            const blocked = crossVpn(vpnConn.id, 'ingress')
            if (blocked) return blocked
          }
          pushHop({
            nodeKind: 'site',
            nodeId: site.id,
            nodeName: site.name,
            action: 'gateway-transit',
            edgeId: vpnConn?.id,
            detail: `${site.name} sends packet over S2S VPN "${vpnConn?.name ?? best.nextHopName}" to ${ownerVnet.name}`,
          })
          cursor = { kind: 'vnet-gateway', vnetId: ownerVnet.id, gatewayId: best.nextHopId, direction: 'ingress' }
          continue
        }
      }

      if (best.nextHopKind === 'appliance' || best.nextHopKind === 'vwan-hub') {
        const connection = topology.vpnConnections.find((connection) => connection.enabled && connection.id === best.connectionId && connection.siteId === site.id)
        const ownerVnet = topology.vnets.find((vnet) => vnet.appliances.some((app) => app.id === best.nextHopId))
        if (connection && (best.nextHopKind === 'vwan-hub' || ownerVnet)) {
          const blocked = crossVpn(connection.id, 'ingress')
          if (blocked) return blocked
          pushHop({
            nodeKind: 'site', nodeId: site.id, nodeName: site.name, action: 'gateway-transit',
            edgeId: connection.id, detail: `${site.name} sends packet over ${connection.transport === 'SDWAN' ? 'SD-WAN' : 'S2S VPN'} "${connection.name}" to ${best.nextHopName}`,
          })
          cursor = best.nextHopKind === 'vwan-hub' ? { kind: 'vwan-hub', hubId: best.nextHopId, tableId: azHubAssociation(connection.hubRouting) }
            : { kind: 'appliance', vnetId: ownerVnet!.id, applianceId: best.nextHopId }
          continue
        }
      }
      if (best.nextHopKind === 'site') {
        const sLink = topology.siteLinks.find(
          (l) =>
            l.enabled &&
            (!best.connectionId || l.id === best.connectionId) &&
            ((l.siteAId === site.id && l.siteBId === best.nextHopId) ||
              (l.siteBId === site.id && l.siteAId === best.nextHopId)),
        )
        pushHop({
          nodeKind: 'site',
          nodeId: site.id,
          nodeName: site.name,
          action: 'er-transit',
          edgeId: sLink?.id,
          detail: `${site.name} forwards over site-to-site link "${sLink?.name ?? best.nextHopName}"`,
        })
        cursor = { kind: 'site', siteId: best.nextHopId }
        continue
      }
    }

    break
  }

  return {
    source,
    destinationIp,
    destinationLabel: targetInfo.label,
    status: 'dropped-no-route',
    hops,
    traversedApplianceIds,
    traversedEdgeIds,
    traversedVnetIds,
    summaryReason: `No complete forwarding path to ${destinationIp}.`,
  }
}

export function traceAzNetPair(
  topology: AzNetTopology,
  simulation: AzSimulationResult,
  source: AzEndpointRef,
  sourceIp: string,
  destination: AzEndpointRef,
  destinationIp: string,
): AzPairFlowAnalysis {
  const forward = traceAzNetFlow(topology, simulation, source, destinationIp)
  const reverse = traceAzNetFlow(topology, simulation, destination, sourceIp)

  const statefulIds = new Set<string>()
  const applianceNames = new Map<string, string>()
  for (const vnet of topology.vnets) {
    for (const app of vnet.appliances) {
      if (app.inspectsTraffic || app.kind === 'azure-firewall') {
        statefulIds.add(app.id)
        applianceNames.set(app.id, `${app.name} (${vnet.name})`)
      }
    }
  }
  for (const hub of topology.vwanHubs) {
    if (hub.firewall || hub.routingIntent.private) {
      const id = hub.firewall?.id ?? `vhub-fw:${hub.id}`
      statefulIds.add(id)
      applianceNames.set(id, hub.firewall?.name ?? `${hub.name} Secured Hub Firewall`)
    }
  }

  const fStateful = forward.traversedApplianceIds.filter((id) => statefulIds.has(id))
  const rStateful = reverse.traversedApplianceIds.filter((id) => statefulIds.has(id))

  const asymmetricIds = new Set<string>([
    ...fStateful.filter((id) => !rStateful.includes(id)),
    ...rStateful.filter((id) => !fStateful.includes(id)),
  ])

  const symmetricInspection =
    forward.status === 'delivered' &&
    reverse.status === 'delivered' &&
    asymmetricIds.size === 0

  return {
    forward,
    reverse,
    symmetricInspection,
    asymmetricBypassApplianceNames: [...asymmetricIds].map((id) => applianceNames.get(id) ?? id),
  }
}
