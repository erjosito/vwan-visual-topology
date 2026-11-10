import { cidr, contains, ipv4 } from '../validation'
import { evaluateErSkuRegionalCompatibility, type ErSkuCompatibilityResult } from '../er-locations-catalog'
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
  weight?: number
}

export interface AzBgpRibEntry {
  id: string
  prefix: string
  asPath: number[]
  nextHopName: string
  nextHopIp?: string
  nextHopKind: 'er-location' | 'site' | 'vnet-gateway' | 'appliance' | 'vwan-hub' | 'local'
  nextHopId: string
  originProtocol: 'ExpressRoute' | 'VPN' | 'BGP-NVA' | 'VNet' | 'InterHub' | 'Static'
  preferred: boolean
  weight?: number
  explanation: string
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

export interface AzSimulationResult {
  subnetTables: Record<string, AzSubnetRouteTableResult>
  gatewayRibs: Record<string, AzBgpRibEntry[]>
  routeServerRibs: Record<string, AzBgpRibEntry[]>
  vwanHubRibs: Record<string, AzBgpRibEntry[]>
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
    const minProto = Math.min(...candidates.map(protocolRank))
    const protoFiltered = candidates.filter((c) => protocolRank(c) === minProto)
    const maxWeight = Math.max(...protoFiltered.map((c) => c.weight ?? 0))
    const weightFiltered = protoFiltered.filter((c) => (c.weight ?? 0) === maxWeight)
    const minAsLen = Math.min(...weightFiltered.map((c) => c.asPath.length))
    const winners = new Set(
      weightFiltered.filter((c) => c.asPath.length === minAsLen).map((c) => c.id),
    )

    for (const c of candidates) {
      const isWinner = winners.has(c.id)
      let explanation = 'Selected as best BGP route'
      if (!isWinner) {
        if (protocolRank(c) > minProto) {
          explanation = `Not preferred under routing preference (${normalizedPref})`
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

export function simulateAzNet(topology: AzNetTopology): AzSimulationResult {
  const warnings: string[] = []
  const siteRibs: Record<string, AzBgpRibEntry[]> = {}
  const erLocationRibs: Record<string, AzBgpRibEntry[]> = {}
  const gatewayRibs: Record<string, AzBgpRibEntry[]> = {}
  const routeServerRibs: Record<string, AzBgpRibEntry[]> = {}
  const vwanHubRibs: Record<string, AzBgpRibEntry[]> = {}

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

  for (let round = 0; round < 8; round++) {
    for (const link of topology.siteLinks) {
      if (!link.enabled) continue
      const siteA = topology.sites.find((s) => s.id === link.siteAId)
      const siteB = topology.sites.find((s) => s.id === link.siteBId)
      if (!siteA || !siteB) continue
      for (const [sender, receiver] of [
        [siteA, siteB],
        [siteB, siteA],
      ] as const) {
        const current = siteRibs[sender.id]?.filter((r) => r.preferred) ?? []
        for (const r of current) {
          if (r.asPath.includes(receiver.asn)) continue
          const id = `sitelink:${link.id}:${sender.id}->${receiver.id}:${r.prefix}`
          if (!siteRibs[receiver.id].some((existing) => existing.id === id)) {
            siteRibs[receiver.id].push({
              id,
              prefix: r.prefix,
              asPath: [receiver.asn, ...r.asPath],
              nextHopName: sender.name,
              nextHopKind: 'site',
              nextHopId: sender.id,
              originProtocol: 'VPN',
              preferred: false,
              explanation: `Learned over site link ${link.name} from ${sender.name}`,
            })
          }
        }
      }
    }
    for (const site of topology.sites) {
      siteRibs[site.id] = chooseBgpWinners(siteRibs[site.id], 'ASPath')
    }
  }

  // Helper: compute what prefixes a VNet advertises through its attached Gateways
  const advertisedVnetPrefixes = (vnet: AzVNet): { prefix: string; asPath: number[]; sourceName: string }[] => {
    if (vnet.summarizedGatewayPrefixes && vnet.summarizedGatewayPrefixes.length > 0) {
      if (vnet.summarizedGatewayPrefixes.length > 1000) {
        warnings.push(
          `VNet "${vnet.name}" configures ${vnet.summarizedGatewayPrefixes.length} summarizedGatewayPrefixes (> 1,000 Azure limit). Advertisements collapse to zero routes.`,
        )
        return []
      }
      return vnet.summarizedGatewayPrefixes.map((prefix) => ({
        prefix,
        asPath: [65515],
        sourceName: `${vnet.name} (Advertised gateway summary)`,
      }))
    }
    const result: { prefix: string; asPath: number[]; sourceName: string }[] = vnet.prefixes.map((prefix) => ({
      prefix,
      asPath: [65515],
      sourceName: vnet.name,
    }))
    // Include peered spokes that have allowGatewayTransit (from this hub) + useRemoteGateways (from spoke)
    // Azure rules: hub must have an enabled Gateway/ARS, and spoke cannot have its own Gateway/ARS.
    const hubHasGatewayOrArs = vnet.gateways.some((g) => g.enabled) || Boolean(vnet.routeServer?.enabled)
    for (const other of topology.vnets) {
      if (other.id === vnet.id) continue
      const rel = getActivePeeringBetween(topology, vnet.id, other.id)
      if (!rel) continue
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
        for (const p of other.prefixes) {
          result.push({ prefix: p, asPath: [65515], sourceName: `${other.name} (via Gateway Transit)` })
        }
      }
    }
    // If ARS is present with branchToBranchTraffic, include NVA-advertised BGP prefixes
    if (vnet.routeServer?.enabled && vnet.routeServer.branchToBranchTraffic) {
      for (const peerAppId of vnet.routeServer.peerApplianceIds.slice(0, 8)) {
        const app = vnet.appliances.find((a) => a.id === peerAppId && a.bgpEnabled && a.enableIpForwarding)
        if (!app) continue
        for (const p of app.advertisedPrefixes ?? []) {
          result.push({
            prefix: p,
            asPath: [65515, app.asn ?? 65501],
            sourceName: `${app.name} (via ARS Branch-to-Branch)`,
          })
        }
      }
    }
    return result
  }

  // 2. Populate ExpressRoute Locations (MSEE) from connected Sites, VNet ER Gateways, and vWAN Hubs
  for (const loc of topology.erLocations) {
    const entries: AzBgpRibEntry[] = []
    const attachedLinks = topology.erLinks.filter((l) => l.enabled && l.locationId === loc.id)
    for (const link of attachedLinks) {
      if (link.targetKind === 'site') {
        const site = topology.sites.find((s) => s.id === link.targetId)
        if (!site) continue
        const siteRoutes = (siteRibs[site.id] ?? []).filter((r) => r.preferred)
        for (const sr of siteRoutes) {
          const stripped = stripPrivateAsnsForMsee(sr.asPath)
          const prepended = stripPrivateAsnsForMsee(link.prepend ?? [])
          entries.push({
            id: `erloc:${loc.id}:site:${link.id}:${sr.prefix}`,
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
        for (const adv of advertisedVnetPrefixes(ownerVnet)) {
          entries.push({
            id: `erloc:${loc.id}:vng:${link.id}:${adv.prefix}`,
            prefix: adv.prefix,
            asPath: [12076, ...stripPrivateAsnsForMsee(adv.asPath)],
            nextHopName: `${gw.name} (${ownerVnet.name})`,
            nextHopKind: 'vnet-gateway',
            nextHopId: gw.id,
            originProtocol: 'ExpressRoute',
            preferred: true,
            weight: link.weight ?? 0,
            explanation: `Advertised by ${gw.name} from ${adv.sourceName}`,
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
        const attachedVnets = topology.vnets.filter(
          (v) => v.vwanHubAttachment?.enabled && v.vwanHubAttachment.hubId === hub.id,
        )
        for (const vnet of attachedVnets) {
          for (const prefix of vnet.prefixes) {
            entries.push({
              id: `erloc:${loc.id}:vhub:${link.id}:${vnet.id}:${prefix}`,
              prefix,
              asPath: [12076],
              nextHopName: `${hub.name} (${link.name})`,
              nextHopKind: 'vwan-hub',
              nextHopId: hub.id,
              originProtocol: 'ExpressRoute',
              preferred: true,
              weight: link.weight ?? 0,
              explanation: `Advertised by Virtual WAN hub ${hub.name} for attached spoke ${vnet.name}`,
            })
          }
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
              id: `gw:${gw.id}:er:${link.id}:${lr.prefix}:${lr.nextHopId}`,
              prefix: lr.prefix,
              asPath: lr.asPath,
              nextHopName: `${loc.name} → ${lr.nextHopName}`,
              nextHopKind: lr.nextHopKind,
              nextHopId: lr.nextHopId,
              originProtocol: 'ExpressRoute',
              preferred: true,
              weight: link.weight ?? 0,
              explanation: `Learned via ExpressRoute connection ${link.name} at ${loc.name}`,
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
            const siteRoutes = (siteRibs[site.id] ?? []).filter((r) => r.preferred)
            for (const sr of siteRoutes) {
              entries.push({
                id: `gw:${gw.id}:vpn:${conn.id}:${sr.prefix}`,
                prefix: sr.prefix,
                asPath: [...(conn.inboundPrepend ?? []), ...sr.asPath],
                nextHopName: `${site.name} (${conn.name})`,
                nextHopKind: 'site',
                nextHopId: site.id,
                originProtocol: 'VPN',
                preferred: true,
                explanation: `Learned via BGP over S2S VPN ${conn.name} from ${site.name}`,
              })
            }
          } else {
            const statics = conn.staticPrefixes?.length ? conn.staticPrefixes : site.prefixes
            for (const prefix of statics) {
              entries.push({
                id: `gw:${gw.id}:vpn-static:${conn.id}:${prefix}`,
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
    if (!ars || !ars.enabled) continue
    if (ars.peerApplianceIds.length > 8) {
      warnings.push(
        `Azure Route Server "${ars.name}" in "${vnet.name}" has ${ars.peerApplianceIds.length} BGP peers configured (maximum supported by Azure is 8).`,
      )
    }
    const entries: AzBgpRibEntry[] = []
    for (const appId of ars.peerApplianceIds.slice(0, 8)) {
      const app = vnet.appliances.find((a) => a.id === appId)
      if (!app || !app.bgpEnabled || !app.enableIpForwarding) continue
      const appAsn = app.asn ?? 65501
      if (appAsn === 65515 || appAsn === 12076) {
        warnings.push(
          `Azure Route Server "${ars.name}" in "${vnet.name}" cannot peer with "${app.name}" using Azure-reserved ASN ${appAsn}.`,
        )
        continue
      }
      for (const prefix of app.advertisedPrefixes ?? []) {
        entries.push({
          id: `ars:${ars.id}:nva:${app.id}:${prefix}`,
          prefix,
          asPath: [appAsn],
          nextHopName: `${app.name} (${app.privateIp})`,
          nextHopIp: app.privateIp,
          nextHopKind: 'appliance',
          nextHopId: app.id,
          originProtocol: 'BGP-NVA',
          preferred: true,
          explanation: `Learned by Azure Route Server ${ars.name} from BGP NVA peer ${app.name} (${app.privateIp}, AS ${appAsn})`,
        })
      }
      // Also include any VPN connections terminating directly on this NVA
      for (const conn of topology.vpnConnections.filter(
        (c) => c.enabled && c.targetKind === 'appliance' && c.targetId === app.id,
      )) {
        const site = topology.sites.find((s) => s.id === conn.siteId)
        if (!site) continue
        for (const sr of (siteRibs[site.id] ?? []).filter((r) => r.preferred)) {
          if (entries.some((e) => e.prefix === sr.prefix && e.nextHopId === app.id)) continue
          entries.push({
            id: `ars:${ars.id}:nva-vpn:${app.id}:${conn.id}:${sr.prefix}`,
            prefix: sr.prefix,
            asPath: [appAsn, ...sr.asPath],
            nextHopName: `${app.name} (${app.privateIp}) → ${site.name}`,
            nextHopIp: app.privateIp,
            nextHopKind: 'appliance',
            nextHopId: app.id,
            originProtocol: 'BGP-NVA',
            preferred: true,
            explanation: `Learned by ARS ${ars.name} from ${app.name} via overlay tunnel ${conn.name}`,
          })
        }
      }
    }

    if (ars.branchToBranchTraffic) {
      const nvaEntries = [...entries]
      for (const gw of vnet.gateways.filter((g) => g.enabled && g.bgpEnabled)) {
        for (const gRoute of (gatewayRibs[gw.id] ?? []).filter((r) => r.preferred)) {
          entries.push({
            id: `ars:${ars.id}:gw:${gw.id}:${gRoute.prefix}`,
            prefix: gRoute.prefix,
            asPath: gRoute.asPath,
            nextHopName: `${gw.name} (Branch-to-Branch)`,
            nextHopKind: 'vnet-gateway',
            nextHopId: gw.id,
            originProtocol: gw.kind === 'ExpressRoute' ? 'ExpressRoute' : 'VPN',
            preferred: true,
            weight: gRoute.weight,
            explanation: `Exchanged with ${gw.name} via ARS Branch-to-Branch`,
          })
        }
        const gwEntries = [...(gatewayRibs[gw.id] ?? [])]
        for (const nvaRoute of nvaEntries) {
          gwEntries.push({
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

    routeServerRibs[ars.id] = chooseBgpWinners(entries, ars.hubRoutingPreference)
  }

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
          !(r.nextHopKind === 'vwan-hub' && r.nextHopId === hub.id) &&
          r.nextHopKind !== 'er-location',
      )) {
        entries.push({
          id: `vhub:${hub.id}:er:${link.id}:${lr.prefix}:${lr.nextHopId}`,
          prefix: lr.prefix,
          asPath: lr.asPath,
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
      for (const sr of (siteRibs[site.id] ?? []).filter((r) => r.preferred)) {
        entries.push({
          id: `vhub:${hub.id}:vpn:${conn.id}:${sr.prefix}`,
          prefix: sr.prefix,
          asPath: [...(conn.inboundPrepend ?? []), ...sr.asPath],
          nextHopName: `${site.name} (${conn.name})`,
          nextHopKind: 'site',
          nextHopId: site.id,
          originProtocol: 'VPN',
          preferred: true,
          explanation: `Learned by vWAN Hub ${hub.name} via VPN ${conn.name}`,
        })
      }
    }
    vwanHubRibs[hub.id] = chooseBgpWinners(entries, hub.preference)
  }

  // 6. Push Azure routes back to On-Premises Sites (over ER and VPN)
  for (const site of topology.sites) {
    const learnedFromAzure: AzBgpRibEntry[] = []
    for (const link of topology.erLinks.filter(
      (l) => l.enabled && l.targetKind === 'site' && l.targetId === site.id,
    )) {
      const loc = topology.erLocations.find((l) => l.id === link.locationId)
      if (!loc) continue
      for (const lr of (erLocationRibs[loc.id] ?? []).filter(
        (r) =>
          r.preferred &&
          !(r.nextHopKind === 'site' && r.nextHopId === site.id) &&
          (r.nextHopKind !== 'site' || Boolean(loc.globalReachEnabled)),
      )) {
        learnedFromAzure.push({
          id: `site:${site.id}:er:${link.id}:${lr.prefix}`,
          prefix: lr.prefix,
          asPath: lr.asPath,
          nextHopName: `${loc.name} (${link.name})`,
          nextHopKind: 'er-location',
          nextHopId: loc.id,
          originProtocol: 'ExpressRoute',
          preferred: false,
          explanation: `Learned from Azure over ExpressRoute circuit at ${loc.name}`,
        })
      }
    }
    for (const conn of topology.vpnConnections.filter((c) => c.enabled && c.siteId === site.id)) {
      if (conn.targetKind === 'vnet-gateway') {
        const ownerVnet = topology.vnets.find((v) => v.gateways.some((g) => g.id === conn.targetId && g.enabled))
        const gw = ownerVnet?.gateways.find((g) => g.id === conn.targetId)
        if (!ownerVnet || !gw) continue
        for (const adv of advertisedVnetPrefixes(ownerVnet)) {
          learnedFromAzure.push({
            id: `site:${site.id}:vpn:${conn.id}:${adv.prefix}`,
            prefix: adv.prefix,
            asPath: [...(conn.outboundPrepend ?? []), ...adv.asPath],
            nextHopName: `${gw.name} (${conn.name})`,
            nextHopKind: 'vnet-gateway',
            nextHopId: gw.id,
            originProtocol: 'VPN',
            preferred: false,
            explanation: `Learned from ${gw.name} over S2S VPN ${conn.name}`,
          })
        }
      }
    }
    siteRibs[site.id] = chooseBgpWinners([...siteRibs[site.id], ...learnedFromAzure], 'ASPath')
  }

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
        vwanHubRibs,
      )
    }
  }

  return {
    subnetTables,
    gatewayRibs,
    routeServerRibs,
    vwanHubRibs,
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
  vwanHubRibs: Record<string, AzBgpRibEntry[]>,
): AzSubnetRouteTableResult {
  const udrTable = subnet.routeTableId
    ? topology.udrTables.find((t) => t.id === subnet.routeTableId)
    : undefined
  const bgpPropagationDisabled = Boolean(udrTable?.disableBgpRoutePropagation)
  const peeringPropagationDisabled = Boolean(udrTable?.disablePeeringRoutePropagation)

  const candidates: AzEffectiveRoute[] = []
  const suppressedBgpRoutes: AzEffectiveRoute[] = []
  const suppressedPeeringRoutes: AzEffectiveRoute[] = []

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
  const addPeRoutesFromVnet = (targetVnet: AzVNet, viaPeeringName?: string) => {
    for (const s of targetVnet.subnets) {
      for (const pe of s.privateEndpoints ?? []) {
        const pePolicy = s.privateEndpointNetworkPolicies ?? 'Disabled'
        candidates.push({
          id: `sys:pe:${subnet.id}:${pe.id}`,
          prefix: `${pe.ipAddress}/32`,
          source: 'System',
          nextHopType: 'InterfaceEndpoint',
          nextHopIp: pe.ipAddress,
          nextHopResourceId: pe.id,
          nextHopName: `${pe.name} (${pe.serviceName})`,
          originLabel: `System · Private Endpoint ${pe.name}${viaPeeringName ? ` via ${viaPeeringName}` : ''} (NetworkPolicies: ${pePolicy})`,
          asPath: [],
          active: true,
        })
      }
    }
  }

  addPeRoutesFromVnet(vnet)

  for (const otherVnet of topology.vnets) {
    if (otherVnet.id === vnet.id) continue
    const rel = getActivePeeringBetween(topology, vnet.id, otherVnet.id)
    if (!rel) continue
    if (rel.forwardFlags.allowVirtualNetworkAccess && rel.reverseFlags.allowVirtualNetworkAccess) {
      for (const prefix of otherVnet.prefixes) {
        const peeringRoute: AzEffectiveRoute = {
          id: `sys:peering:${subnet.id}:${rel.peering.id}:${prefix}`,
          prefix,
          source: 'System',
          nextHopType: 'VNetPeering',
          nextHopResourceId: otherVnet.id,
          nextHopName: otherVnet.name,
          originLabel: `System · VNet Peering (${rel.peering.name})`,
          asPath: [],
          active: !peeringPropagationDisabled,
          suppressedReason: peeringPropagationDisabled
            ? `Suppressed by disablePeeringRoutePropagation=true (Preview) on Route Table "${udrTable?.name}"`
            : undefined,
        }
        if (peeringPropagationDisabled) {
          suppressedPeeringRoutes.push(peeringRoute)
        } else {
          candidates.push(peeringRoute)
        }
      }
      addPeRoutesFromVnet(otherVnet, rel.peering.name)
    }
  }

  // D. BGP / Gateway-Propagated Routes (Local Gateways, Local ARS, Remote Peered Hub Gateways/ARS, or Attached vWAN Hub)
  const rawBgpRoutes: AzEffectiveRoute[] = []

  const collectFromVnetControlPlane = (controlVnet: AzVNet, isRemoteGatewayTransit: boolean) => {
    const scopeLabel = isRemoteGatewayTransit ? `Remote Hub ${controlVnet.name}` : `Local ${controlVnet.name}`
    // If ARS is enabled and branchToBranch is active, ARS arbitrates preferences; otherwise read each gateway RIB
    const ars = controlVnet.routeServer?.enabled ? controlVnet.routeServer : undefined
    if (ars) {
      const arsWinners = (routeServerRibs[ars.id] ?? []).filter((r) => r.preferred)
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
      const gwWinners = (gatewayRibs[gw.id] ?? []).filter((r) => r.preferred)
      for (const r of gwWinners) {
        // ARS-learned NVA routes are already injected by the ARS loop above
        if (r.nextHopKind === 'appliance') {
          continue
        }
        // Avoid duplicating if ARS already injected a preferred route for the same gateway & prefix
        if (rawBgpRoutes.some((existing) => existing.prefix === r.prefix && existing.nextHopResourceId === gw.id)) {
          continue
        }
        rawBgpRoutes.push({
          id: `bgp:gw:${subnet.id}:${gw.id}:${r.id}`,
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
      const hubWinners = (vwanHubRibs[hub.id] ?? []).filter((r) => r.preferred)
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
      if (hub.routingIntent.internet && vnet.vwanHubAttachment.propagateDefaultRoute) {
        rawBgpRoutes.push({
          id: `bgp:vhub-default:${subnet.id}:${hub.id}`,
          prefix: '0.0.0.0/0',
          source: 'VirtualNetworkGateway',
          nextHopType: 'VirtualNetworkGateway',
          nextHopResourceId: hub.id,
          nextHopName: `${hub.name} (Secured Hub Firewall)`,
          originLabel: `BGP · Virtual WAN Hub ${hub.name} (Routing Intent Internet 0.0.0.0/0)`,
          asPath: [],
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

  // F. Resolve Active vs. Suppressed per Exact Prefix (`PE /32 (Disabled policy) > User (UDR) > BGP > System`)
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
        r.originLabel.includes('NetworkPolicies: Disabled')
      ) {
        return 0 // Beats even a /32 UDR when Private Endpoint Network Policies are Disabled
      }
      if (r.source === 'User') return 1
      if (r.source === 'RouteServer' || r.source === 'VirtualNetworkGateway') return 2
      return 3 // System
    }
    const minRank = Math.min(...group.map(sourceRank))
    const topRanked = group.filter((r) => sourceRank(r) === minRank)
    const minAsPath = Math.min(...topRanked.map((r) => r.asPath.length || 999))
    const winnerIds = new Set(
      topRanked
        .filter((r) => (r.asPath.length || 999) === minAsPath)
        .slice(0, 1)
        .map((r) => r.id),
    )
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

  // G. When PrivateEndpointNetworkPolicies is RouteTableEnabled or Enabled, ANY covering User UDR
  // (e.g., /16, /24, or /32) invalidates the /32 InterfaceEndpoint system route in Azure SDN.
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]
    if (
      r.active &&
      r.nextHopType === 'InterfaceEndpoint' &&
      !r.originLabel.includes('NetworkPolicies: Disabled')
    ) {
      const peIpStr = r.nextHopIp ?? r.prefix.split('/')[0]
      const peIpNum = ipv4(peIpStr)
      if (peIpNum !== undefined) {
        const coveringUdr = resolved.find(
          (u) => u.active && u.source === 'User' && contains(u.prefix, peIpNum),
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
    if (r.nextHopType === 'InterfaceEndpoint' && r.originLabel.includes('NetworkPolicies: Disabled')) return 0
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
): AzFlowTrace {
  const targetInfo = locateDestinationIp(topology, destinationIp)
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

  const ipNum = ipv4(destinationIp)
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

  type Cursor =
    | { kind: 'subnet'; vnetId: string; subnetId: string; fromExternalVnet: boolean; viaVnra: boolean }
    | { kind: 'appliance'; vnetId: string; applianceId: string }
    | { kind: 'vnet-gateway'; vnetId: string; gatewayId: string; direction: 'egress' | 'ingress' }
    | { kind: 'vwan-hub'; hubId: string }
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
    cursor = { kind: 'subnet', vnetId: source.vnetId, subnetId: source.subnetId, fromExternalVnet: false, viaVnra: false }
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
    cursor = { kind: 'vwan-hub', hubId: source.hubId }
  }

  // Helper to check VNet Peering traversal gates when crossing from `fromVnet` to `toVnet`
  const validatePeeringTransition = (
    fromVnet: AzVNet,
    toVnet: AzVNet,
    isForwardedPacket: boolean,
    involvesVnra: boolean,
  ): { ok: true; peering: AzVnetPeering } | { ok: false; status: AzTraceStatus; reason: string; peeringId?: string } => {
    const rel = getActivePeeringBetween(topology, fromVnet.id, toVnet.id)
    if (!rel) {
      return {
        ok: false,
        status: 'dropped-peering-non-transitive',
        reason: `No active VNet peering between "${fromVnet.name}" and "${toVnet.name}". VNet peering is non-transitive.`,
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
        const check = validatePeeringTransition(vnet, peerVnet, stepCursor.fromExternalVnet, stepCursor.viaVnra)
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
        const targetSubnet =
          peerVnet.subnets.find((s) => cidr(s.prefix) && contains(s.prefix, ipNum)) ?? peerVnet.subnets[0]
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
          subnetId: targetSubnet.id,
          fromExternalVnet: true,
          viaVnra: stepCursor.viaVnra,
        }
        continue
      }

      if (matched.nextHopType === 'VirtualAppliance') {
        const found = findApplianceByIp(topology, matched.nextHopIp)
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
            detail: `Steered by ${matched.originLabel} across peering "${check.peering.name}" to ${found.appliance.name} (${found.appliance.privateIp})`,
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
            detail: `Steered by ${matched.originLabel} to ${found.appliance.name} (${found.appliance.privateIp})`,
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
          cursor = { kind: 'vwan-hub', hubId: vwanHub.id }
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
        if (!targetInfo.endpoint) {
          if (subnet.defaultOutboundAccess === false) {
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
            detail: `Egresses directly to Internet from ${vnet.name}/${subnet.name} (defaultOutboundAccess=true)`,
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
          detail: `Private destination ${destinationIp} (${targetInfo.label}) fell back to System 0.0.0.0/0 Internet route and was dropped.`,
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
          summaryReason: `Private destination ${destinationIp} matched only the 0.0.0.0/0 Internet system route in ${vnet.name}/${subnet.name} (missing private route or BGP propagation disabled).`,
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

      // Check if Destination is in the SAME VNet as the appliance
      if (targetInfo.vnet?.id === vnet.id && targetInfo.subnet) {
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
      if (targetInfo.vnet && targetInfo.subnet) {
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
        .filter((sr) => cidr(sr.prefix) && contains(sr.prefix, ipNum))
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
      if (nextRoute?.nextHopType === 'VirtualNetworkGateway' && nextRoute.nextHopResourceId) {
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

      if (nextRoute?.nextHopType === 'Internet' && !targetInfo.endpoint) {
        pushHop({
          nodeKind: 'appliance',
          nodeId: app.id,
          vnetId: vnet.id,
          nodeName: app.name,
          subnetId: app.subnetId,
          action: 'delivered',
          matchedRoute: nextRoute,
          detail: `${app.name} SNATs and egresses packet to Internet`,
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
            (l) => l.enabled && l.targetKind === 'vnet-gateway' && l.targetId === gw.id,
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
            const site = topology.sites.find((s) => s.id === c.siteId)
            const prefixes = c.staticPrefixes?.length ? c.staticPrefixes : (site?.prefixes ?? [])
            return prefixes.some((p) => cidr(p) && contains(p, ipNum))
          })
          if (vpnConn) {
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
      if (hub.routingIntent.private) {
        const fwId = `vhub-fw:${hub.id}`
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
      const attachedTargetVnet = topology.vnets.find(
        (v) =>
          v.vwanHubAttachment?.enabled &&
          v.vwanHubAttachment.hubId === hub.id &&
          v.prefixes.some((p) => cidr(p) && contains(p, ipNum)),
      )
      if (attachedTargetVnet && attachedTargetVnet.subnets[0]) {
        pushHop({
          nodeKind: 'vwan-hub',
          nodeId: hub.id,
          nodeName: hub.name,
          action: 'vwan-transit',
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
      if (!targetInfo.endpoint && hub.routingIntent.internet) {
        const fwId = `vhub-fw:${hub.id}`
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

      // Check ER Links from vWAN Hub
      const erLink = topology.erLinks.find(
        (l) => l.enabled && l.targetKind === 'vwan-hub' && l.targetId === hub.id,
      )
      if (erLink) {
        pushHop({
          nodeKind: 'vwan-hub',
          nodeId: hub.id,
          nodeName: hub.name,
          action: 'vwan-transit',
          edgeId: erLink.id,
          detail: `${hub.name} forwards over ExpressRoute connection "${erLink.name}"`,
        })
        cursor = { kind: 'er-location', locationId: erLink.locationId, fromTargetId: hub.id }
        continue
      }
    }

    if (stepCursor.kind === 'er-location') {
      const loc = topology.erLocations.find((l) => l.id === stepCursor.locationId)!
      const matchingEntry = (simulation.erLocationRibs[loc.id] ?? []).find(
        (r) => r.preferred && cidr(r.prefix) && contains(r.prefix, ipNum),
      )
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
        cursor = { kind: 'vwan-hub', hubId: matchingEntry.nextHopId }
        continue
      }
    }

    if (stepCursor.kind === 'site') {
      const site = topology.sites.find((s) => s.id === stepCursor.siteId)!
      if (site.prefixes.some((p) => cidr(p) && contains(p, ipNum))) {
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
          (l) => l.enabled && l.locationId === best.nextHopId && l.targetKind === 'site' && l.targetId === site.id,
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
          (c) => c.enabled && c.siteId === site.id && c.targetKind === 'vnet-gateway' && c.targetId === best.nextHopId,
        )
        if (ownerVnet) {
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

      if (best.nextHopKind === 'site') {
        const sLink = topology.siteLinks.find(
          (l) =>
            l.enabled &&
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
    if (hub.routingIntent.private) {
      const id = `vhub-fw:${hub.id}`
      statefulIds.add(id)
      applianceNames.set(id, `${hub.name} Secured Hub Firewall`)
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
