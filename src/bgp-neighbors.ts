import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import { gatewayArsExchange } from './azure-net/ars-route-maps'
import type { AzBgpRibEntry, AzNvaBgpPeer, AzNvaReceivedRoute, AzSimulationResult } from './azure-net/engine'
import { sameWan } from './wan-scopes'
import { vpnRoutingMode } from './model'
import { vpnTunnelKey, type VpnTunnelAssessment } from './azure-net/vpn-sessions'

export type BgpResourceKind = 'appliance' | 'route-server' | 'gateway' | 'site' | 'er-location' | 'vwan-hub'
export interface BgpResourceRef { kind: BgpResourceKind; id: string }
export interface BgpInstance {
  id: string
  originalId?: string
  ipConfigurationId?: string
  role: 'router' | 'ars-1' | 'ars-2' | 'vpn-active' | 'vpn-1' | 'vpn-2'
  address?: string
}
export interface BgpResource extends BgpResourceRef {
  key: string
  name: string
  ownerId?: string
  asn?: number
  enabled: boolean
  instances: BgpInstance[]
  limitations: string[]
}
export interface BgpNeighborRoute {
  id: string
  prefix: string
  asPath?: number[]
  nextHop?: string
  evidence: AzBgpRibEntry | AzNvaReceivedRoute
}
export interface BgpRouteEvidence {
  scope: 'received-post-policy' | 'advertised' | 'peer-received-post-policy'
  routes: BgpNeighborRoute[]
}
export interface BgpNeighbor {
  vpnTunnel?: VpnTunnelAssessment
  id: string
  relationshipId: string
  connectionId: string
  localResourceKey: string
  localInstanceId: string
  remoteResourceKey: string
  remoteInstanceId: string
  availability: 'available' | 'unavailable' | 'not-assessed'
  reason: string
  received?: BgpRouteEvidence
  advertised?: BgpRouteEvidence
  peerReceived?: BgpRouteEvidence
  limitations: string[]
}
export interface BgpManagedRelationship {
  id: string
  resourceKeys: [string, string]
  connectionId: string
  enabled: boolean
  reason: string
  name?: string
  kind?: 'inter-hub' | 'vpn' | 'vpn-static' | 'express-route' | 'express-route-logical' | 'nva' | 'route-exchange'
  peerAddress?: string
}
export interface BgpInspection {
  version: 1
  provenance: 'simulation'
  resources: BgpResource[]
  neighbors: BgpNeighbor[]
  managedRelationships: BgpManagedRelationship[]
}

export const bgpResourceKey = (ref: BgpResourceRef) => JSON.stringify([ref.kind, ref.id])
const identity = (...parts: string[]) => JSON.stringify(parts)
const logicalScope = 'Route counts and routes describe the logical relationship, not measured per-instance advertisements or counters.'
const opaqueMapping = 'Managed endpoint addresses, instance mapping and session multiplicity are not assessed. This relationship is not an established BGP session.'
const vpnUnknownMode = 'VPN gateway mode is unspecified. The number of active BGP speakers is not assessed; no standby or second active session is inferred.'
function addInterHubRelationships(result: BgpInspection, hubs: { id: string; wanId?: string }[]) {
  for (let i = 0; i < hubs.length; i++) for (const other of hubs.slice(i + 1)) {
    const hub = hubs[i]
    if (!sameWan(hub, other)) continue
    const a = result.resources.find((resource) => resource.kind === 'vwan-hub' && resource.id === hub.id)!
    const b = result.resources.find((resource) => resource.kind === 'vwan-hub' && resource.id === other.id)!
    const id = identity('inter-hub', ...[hub.id, other.id].sort())
    result.managedRelationships.push({
      id, connectionId: id, resourceKeys: [a.key, b.key], enabled: a.enabled && b.enabled,
      kind: 'inter-hub', name: 'Automatic inter-hub routing',
      reason: 'Same-WAN managed routing relationship; physical BGP speakers, endpoint addresses and session state are not exposed.',
    })
  }
}
const peerReasons: Record<Exclude<AzNvaBgpPeer['state'], 'available'>, string> = {
  'ars-disabled': 'ARS disabled',
  'bgp-disabled': 'NVA BGP disabled',
  'unsupported-asn': 'Unsupported Azure-reserved peer ASN',
  'unsupported-appliance': 'Unsupported appliance kind',
  unreachable: 'No active direct VNet peering with bidirectional VNet access',
  'subnet-peering-not-assessed': 'BGP over subnet peering is not assessed',
}
const evidence = (scope: BgpRouteEvidence['scope'], routes: (AzBgpRibEntry | AzNvaReceivedRoute)[] | undefined): BgpRouteEvidence | undefined =>
  routes === undefined ? undefined : {
    scope, routes: routes.map((route) => ({
      id: route.id, prefix: route.prefix, asPath: route.asPath,
      nextHop: 'wireAttributes' in route && route.wireAttributes.nextHop === 'not-assessed'
        ? undefined : route.nextHopIp ?? route.nextHopName, evidence: route,
    })),
  }

export function inspectAzBgp(topology: AzNetTopology, simulation?: AzSimulationResult, unavailableIds: string[] = []): BgpInspection {
  const result: BgpInspection = { version: 1, provenance: 'simulation', resources: [], neighbors: [], managedRelationships: [] }
  const unavailable = new Set(unavailableIds)
  const add = (kind: BgpResourceKind, id: string, name: string, roles: BgpInstance['role'][], options: {
    asn?: number; address?: string; enabled?: boolean; ownerId?: string; limitations?: string[]
  } = {}) => {
    const ref = { kind, id }
    const resource: BgpResource = {
      ...ref, key: bgpResourceKey(ref), name, asn: options.asn, ownerId: options.ownerId,
      enabled: options.enabled !== false && !unavailable.has(id) && !unavailable.has(options.ownerId ?? ''),
      instances: roles.map((role) => ({ id: identity(kind, id, role), role, address: options.address })),
      limitations: options.limitations ?? [],
    }
    result.resources.push(resource)
    return resource
  }
  const find = (kind: BgpResourceKind, id: string) => result.resources.find((resource) => resource.kind === kind && resource.id === id)
  const managed = (id: string, connectionId: string, a: BgpResource | undefined, b: BgpResource | undefined, enabled: boolean, reason = opaqueMapping,
    metadata: Pick<BgpManagedRelationship, 'name' | 'kind' | 'peerAddress'> = {}) => {
    if (a && b) result.managedRelationships.push({
      id, connectionId, resourceKeys: [a.key, b.key], enabled: enabled && a.enabled && b.enabled, reason, ...metadata,
    })
  }
  const pair = (relationshipId: string, connectionId: string, a: BgpResource, ai: BgpInstance, b: BgpResource, bi: BgpInstance,
    availability: BgpNeighbor['availability'], reason: string, received?: BgpRouteEvidence, advertised?: BgpRouteEvidence,
    reverseReceived?: BgpRouteEvidence, reverseAdvertised?: BgpRouteEvidence, limitations: string[] = []) => {
    if (availability === 'available' && simulation?.controlPlaneComplete === false) {
      availability = 'not-assessed'
      reason = 'Control-plane result is incomplete; neighbor route evidence is not assessed.'
    }
    for (const [local, localInstance, remote, remoteInstance, rx, tx, peerRx] of [
      [a, ai, b, bi, received, advertised, reverseReceived],
      [b, bi, a, ai, reverseReceived, reverseAdvertised, received],
    ] as const) {
      result.neighbors.push({
        id: identity(relationshipId, localInstance.id, remoteInstance.id), relationshipId, connectionId,
        localResourceKey: local.key, localInstanceId: localInstance.id,
        remoteResourceKey: remote.key, remoteInstanceId: remoteInstance.id,
        availability, reason,
        ...(availability === 'available' ? { received: rx, advertised: tx, peerReceived: peerRx } : {}),
        limitations: [logicalScope, ...limitations],
      })
    }
  }
  for (const vnet of topology.vnets) {
    for (const app of vnet.appliances.filter((app) => app.kind === 'nva-vm')) add('appliance', app.id, app.name, ['router'], {
      asn: app.asn, address: app.privateIp, enabled: !!app.bgpEnabled, ownerId: vnet.id,
    })
    if (vnet.routeServer) add('route-server', vnet.routeServer.id, vnet.routeServer.name, ['ars-1', 'ars-2'], {
      asn: 65515, enabled: vnet.routeServer.enabled, ownerId: vnet.id,
      limitations: ['ARS speaker 1 and 2 are stable modeled roles, not a mapping of captured role arrays or physical instance IDs. Endpoint IPs are not inferred from subnet addresses.'],
    })
    for (const gw of vnet.gateways) {
      const resource = add('gateway', gw.id, gw.name,
      gw.kind !== 'Vpn' || gw.activeActive === undefined ? [] : gw.activeActive ? ['vpn-1', 'vpn-2'] : ['vpn-active'], {
        asn: gw.asn, enabled: gw.enabled, ownerId: vnet.id,
        limitations: gw.kind === 'ExpressRoute' ? [opaqueMapping] : gw.activeActive === undefined ? [vpnUnknownMode]
          : [gw.activeActive ? 'Two active modeled VPN speakers; endpoint IPs and physical instance mappings are not exposed.'
            : 'One active modeled VPN speaker. A standby physical instance exists; its failure, failover timing and BGP session are not modeled.'],
      })
      if (gw.vpnInstances !== undefined) {
        resource.instances = gw.vpnInstances.map((instance) => ({
          id: identity('gateway', gw.id, instance.id), originalId: instance.id, ipConfigurationId: instance.ipConfigurationId,
          role: 'vpn-active', address: instance.defaultBgpIpAddresses.length === 1 ? instance.defaultBgpIpAddresses[0] : undefined,
        }))
        resource.limitations = ['Explicit authored/captured IP-configuration mapping, not capture-array order. Tunnel eligibility and historical observations remain separate; no Established session is inferred.']
      }
    }
  }
  for (const site of topology.sites) add('site', site.id, site.name, ['router'], { asn: site.asn })
  for (const location of topology.erLocations) add('er-location', location.id, location.name, [], {
    asn: 12076,
    limitations: ['ExpressRoute has primary and secondary private-peering edge paths. This topology models a location aggregate, not circuit-specific MSEE instances; no primary/secondary session mapping is inferred.', opaqueMapping],
  })
  for (const hub of topology.vwanHubs) add('vwan-hub', hub.id, hub.name, [], {
    asn: 65515,
    limitations: ['VWAN hub routing and managed gateways are not a single BGP speaker. Standalone VPN active/standby controls do not apply.', opaqueMapping],
  })
  addInterHubRelationships(result, topology.vwanHubs)
  for (const vnet of topology.vnets) {
    const ars = vnet.routeServer
    if (!ars) continue
    const local = find('route-server', ars.id)!
    for (const appId of new Set(ars.peerApplianceIds)) {
      const remote = find('appliance', appId)
      if (!remote) continue
      const peer = simulation?.nvaBgpPeers?.[appId]?.find((peer) => peer.routeServerId === ars.id)
      const connectionId = remote.ownerId === vnet.id ? `nva:${appId}` : `vnet:${remote.ownerId}`
      const availability = !local.enabled || !remote.enabled ? 'unavailable'
        : peer?.state === 'available' ? 'available' : peer ? peer.state === 'subnet-peering-not-assessed' ? 'not-assessed' : 'unavailable' : 'not-assessed'
      const reason = !local.enabled || !remote.enabled ? 'Resource or BGP disabled, or unavailable in the selected failure scenario.'
        : peer?.state === 'available' ? 'Configured ARS/NVA relationship is available in the steady-state model; actual BGP establishment is not assessed.'
          : peer ? peerReasons[peer.state] : 'No engine relationship evidence is available.'
      const sent = evidence('advertised', simulation?.routeServerInboundPrePolicy?.[ars.id]?.[connectionId]?.filter((route) => route.nextHopId === appId))
      const received = evidence('received-post-policy', simulation?.routeServerInbound?.[ars.id]?.[connectionId]?.filter((route) => route.nextHopId === appId))
      const exported = peer ? evidence('advertised', peer.routes) : undefined
      const peerReceived = peer ? evidence('received-post-policy', peer.routes) : undefined
      const limitations = peer?.gatewaySummaryAssessment ? [
        'Gateway summary impact on ARS-to-NVA exports is not assessed. Shown candidates do not prove presence or absence of configured gateway summaries.',
      ] : []
      if (peer?.nvaReflection) limitations.push(
        'Different-VNet NVA reflection requires branch-to-branch exchange. Same-VNet flag behavior and wire attributes are not assessed. Source learning and local NIC routes are separate.',
        'ARS wire next-hop IP is not assessed; captured endpoints remain separate observations and are not assigned to modeled speaker roles.',
      )
      for (const instance of local.instances) pair(identity('ars-nva', ars.id, appId), connectionId,
        local, instance, remote, remote.instances[0], availability, reason, received, exported, peerReceived, sent, limitations)
    }
    for (const gateway of vnet.gateways) {
      const eligible = gatewayArsExchange(gateway)
      managed(identity('ars-gateway', ars.id, gateway.id), `gateway:${gateway.id}`, local, find('gateway', gateway.id),
        ars.enabled && ars.branchToBranchTraffic && eligible,
        !eligible ? 'ARS/VPN route exchange requires an enabled supported gateway, explicit active/active mode and VPN ASN 65515; VPN BGP enablement is not required.'
          : !ars.branchToBranchTraffic ? 'Branch-to-branch exchange is disabled. Managed session existence is not inferred from that setting.' : opaqueMapping)
    }
  }
  for (const conn of topology.vpnConnections) {
    const site = find('site', conn.siteId)
    const target = find(conn.targetKind === 'vnet-gateway' ? 'gateway' : conn.targetKind === 'appliance' ? 'appliance' : 'vwan-hub', conn.targetId)
    if (!site || !target) continue
    const targetBgpEnabled = conn.targetKind !== 'vnet-gateway' ||
      topology.vnets.some((vnet) => vnet.gateways.some((gateway) => gateway.id === conn.targetId && gateway.bgpEnabled))
    if (conn.tunnels !== undefined) {
      if (!conn.bgpEnabled || !conn.tunnels.length) {
        managed(identity('vpn', conn.id), conn.id, target, site,
          conn.enabled && conn.tunnels.some((tunnel) => simulation?.vpnTunnels?.[vpnTunnelKey(conn.id, tunnel.id)]?.state === 'available'),
          conn.bgpEnabled ? 'Configured CPE tunnel membership has not been mapped; no full mesh is inferred.'
            : 'Static VPN routing; no BGP peering is configured on this connection.',
          { name: conn.name, kind: conn.bgpEnabled ? 'vpn' : 'vpn-static' })
        continue
      }
      for (const tunnel of conn.tunnels) {
        const instance = target.instances.find((instance) => instance.originalId === tunnel.gatewayInstanceId)
        const assessment = simulation?.vpnTunnels?.[vpnTunnelKey(conn.id, tunnel.id)]
        if (!instance) {
          managed(identity('vpn', conn.id, tunnel.id), conn.id, target, site, false,
            assessment?.reason ?? 'Gateway instance mapping is not assessed.', { name: `${conn.name} / ${tunnel.id}`, kind: 'vpn' })
          continue
        }
        const start = result.neighbors.length
        pair(identity('vpn', conn.id, tunnel.id), conn.id, target, instance, site, site.instances[0],
          !target.enabled || !site.enabled ? 'unavailable' : assessment?.state ?? 'not-assessed',
          assessment?.reason ?? 'Per-tunnel eligibility has not been assessed.',
          evidence('received-post-policy', simulation?.gatewayRibs[conn.targetId]?.filter((route) => route.connectionId === conn.id && route.vpnTunnelId === tunnel.id)),
          undefined, evidence('received-post-policy', simulation?.siteRibs[conn.siteId]?.filter((route) => route.connectionId === conn.id && route.vpnTunnelId === tunnel.id)),
          undefined, assessment?.limitations)
        for (const neighbor of result.neighbors.slice(start)) neighbor.vpnTunnel = assessment
      }
      continue
    }
    const underlay = conn.underlay || conn.useLocalAzureIpAddress
      ? simulation?.vpnUnderlays?.[conn.id] ?? { state: 'not-assessed', reason: 'Private VPN underlay has not been assessed.' } : undefined
    if (!target.instances.length) {
      const staticVpn = !conn.bgpEnabled && conn.targetKind !== 'appliance' && conn.transport !== 'SDWAN'
      managed(identity('vpn', conn.id), conn.id, target, site, conn.enabled && (staticVpn || conn.bgpEnabled && targetBgpEnabled) && (!underlay || underlay.state === 'available'),
        underlay && underlay.state !== 'available' ? underlay.reason
          : staticVpn ? 'Static VPN routing; no BGP peering is configured on this connection.'
          : !conn.bgpEnabled || !targetBgpEnabled ? 'BGP is disabled on this connection or gateway; static routes do not establish BGP neighbors.' : opaqueMapping,
        { name: conn.name, kind: staticVpn ? 'vpn-static' : conn.targetKind === 'appliance' || conn.transport === 'SDWAN' ? 'nva' : 'vpn' })
      continue
    }
    const availability = conn.enabled && conn.bgpEnabled && targetBgpEnabled && site.enabled && target.enabled ? underlay?.state ?? 'available' : 'unavailable'
    const gatewayRoutes = conn.targetKind === 'vnet-gateway' ? simulation?.gatewayRibs[conn.targetId] : undefined
    const siteRoutes = simulation?.siteRibs[conn.siteId]
    for (const instance of target.instances) pair(identity('vpn', conn.id), conn.id, target, instance, site, site.instances[0],
      availability, availability === 'available'
        ? 'Configured BGP relationship is available in the steady-state model; actual BGP establishment is not assessed.'
        : underlay?.reason ?? 'Connection, resource or BGP is disabled, or unavailable in the selected failure scenario.',
      evidence('received-post-policy', gatewayRoutes?.filter((route) => route.connectionId === conn.id)),
      undefined, evidence('received-post-policy', siteRoutes?.filter((route) => route.connectionId === conn.id)), undefined)
  }
  for (const link of topology.erLinks) managed(identity('er', link.id), link.id, find('er-location', link.locationId),
    find(link.targetKind === 'site' ? 'site' : link.targetKind === 'vnet-gateway' ? 'gateway' : 'vwan-hub', link.targetId), link.enabled,
    opaqueMapping, { name: link.name, kind: 'express-route' })
  for (const link of topology.siteLinks) {
    const a = find('site', link.siteAId)
    const b = find('site', link.siteBId)
    if (!a || !b) continue
    pair(identity('site-link', link.id), link.id, a, a.instances[0], b, b.instances[0],
      link.enabled && a.enabled && b.enabled ? 'available' : 'unavailable',
      'Logical site-to-site relationship; vendor sessions and actual establishment are not assessed.',
      evidence('received-post-policy', simulation?.siteRibs[a.id]?.filter((route) => route.connectionId === link.id)),
      undefined, evidence('received-post-policy', simulation?.siteRibs[b.id]?.filter((route) => route.connectionId === link.id)), undefined)
  }
  result.resources.sort((a, b) => a.key.localeCompare(b.key))
  result.neighbors.sort((a, b) => a.id.localeCompare(b.id))
  result.managedRelationships.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

export function inspectVwanBgp(topology: Topology, unavailableIds: string[] = []): BgpInspection {
  const result = inspectAzBgp({
    version: 2, kind: 'azure-network-topology', name: topology.name,
    vnets: [], vnetPeerings: [], udrTables: [], sites: topology.sites,
    vwanHubs: topology.hubs.map((hub) => ({ ...hub, routingIntent: hub.routingIntent })),
    erLocations: topology.erLocations ?? [],
    erLinks: (topology.erLinks ?? []).map((link) => ({
      ...link, targetKind: link.siteId ? 'site' as const : 'vwan-hub' as const, targetId: link.siteId ?? link.hubId ?? '',
    })),
    vpnConnections: [], siteLinks: topology.siteLinks.map((link) => ({
      ...link, siteAId: link.a, siteBId: link.b,
    })),
  }, undefined, unavailableIds)
  for (const conn of topology.connections) {
    const hub = result.resources.find((resource) => resource.kind === 'vwan-hub' && resource.id === conn.hubId)
    const site = result.resources.find((resource) => resource.kind === 'site' && resource.id === conn.siteId)
    if (!hub || !site) continue
    const staticVpn = conn.transport === 'VPN' && vpnRoutingMode(topology, conn) === 'static'
    result.managedRelationships.push({
      id: identity('vwan-connection', conn.id), connectionId: conn.id, resourceKeys: [hub.key, site.key],
      name: conn.name, peerAddress: conn.peerIp,
      kind: staticVpn ? 'vpn-static' : conn.transport === 'ExpressRoute' ? 'express-route-logical' : conn.transport === 'VPN' ? 'vpn' : 'nva',
      enabled: conn.enabled && hub.enabled && site.enabled,
      reason: staticVpn ? 'Static VPN routing; no BGP peering is configured on this connection.'
        : conn.transport === 'ExpressRoute'
        ? 'A logical ExpressRoute connection is not a direct site-to-hub BGP session. Circuit and primary/secondary edge mappings are not assessed.'
        : conn.transport === 'SpokeNVA'
          ? 'VWAN BGP NVA attachment: managed hub instance and session mappings are not assessed.'
          : opaqueMapping,
    })
  }
  for (const vpn of topology.interWanVpns ?? []) {
    const endpoints = [vpn.aHubId, vpn.bHubId].map((id) => result.resources.find((resource) => resource.kind === 'vwan-hub' && resource.id === id))
    if (endpoints.some((endpoint) => !endpoint)) continue
    result.managedRelationships.push({
      id: identity('inter-wan-vpn', vpn.id), connectionId: vpn.id, resourceKeys: [endpoints[0]!.key, endpoints[1]!.key],
      name: vpn.name, kind: 'vpn-static',
      enabled: vpn.enabled && vpn.status === 'configured' && endpoints.every((endpoint) => endpoint!.enabled),
      reason: 'Explicit inter-WAN S2S route-export model. Gateway BGP instances, negotiated sessions, shared-ASN handling and P2S clients are not assessed.',
    })
  }
  result.managedRelationships.sort((a, b) => a.id.localeCompare(b.id))
  return result
}
