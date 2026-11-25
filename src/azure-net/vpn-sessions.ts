import { contains, ipv4 } from '../validation'
import type { AzBgpRibEntry, AzSimulationResult } from './engine'
import type { AzNetTopology, AzVpnConnection, AzVpnTunnel } from './model'
import { usableSubnetAddress } from './addressing'
import { lookupCpeRoutes } from './cpe-routing'
import { assessVpnEr, type VpnErAssessment } from './vpn-er'

type State = 'available' | 'unavailable' | 'not-assessed'
export type { CpeRouteLookup as VpnPeerLookup } from './cpe-routing'
import type { CpeRouteLookup as VpnPeerLookup } from './cpe-routing'

export interface VpnTunnelAssessment {
  connectionId: string
  tunnelId: string
  azureResourceId: string
  azureInstanceId: string
  ipConfigurationId?: string
  cpeResourceId: string
  cpeInstanceRole: 'router'
  routingContextId?: string
  state: State
  administration: { connectionEnabled: boolean; tunnelEnabled: boolean; gatewayEnabled?: boolean; instanceEnabled?: boolean }
  transportState: State
  code: string
  reason: string
  transport: AzVpnTunnel['transport']
  underlay?: VpnErAssessment
  ipsecAssumption: AzVpnTunnel['ipsec']
  bgp: {
    state: State | 'disabled'
    azureAddress?: string
    cpeAddress?: string
    azureAsn?: number
    cpeAsn?: number
    initiator: 'cpe-required' | 'either' | 'not-assessed'
    cpeToAzure?: VpnPeerLookup
    cpeReturn?: VpnPeerLookup
    azureToCpe?: { address: string; tunnelId: string; provenance: 'configured-peer-host-route' }
  }
  observations: { observation: NonNullable<AzVpnTunnel['observations']>[number]; comparison: 'match' | 'mismatch' | 'not-assessed' }[]
  routeProvenance: { gateway: AzBgpRibEntry[]; cpe: AzBgpRibEntry[] }
  limitations: string[]
}

export const vpnTunnelKey = (connectionId: string, tunnelId: string) => JSON.stringify([connectionId, tunnelId])
const apipa = (address: string) => contains('169.254.0.0/16', ipv4(address) ?? -1)
const azureApipa = (address: string) => ['169.254.21.0/24', '169.254.22.0/24'].some((prefix) => contains(prefix, ipv4(address) ?? -1))

export function assessVpnTunnel(
  topology: AzNetTopology, connection: AzVpnConnection, tunnel: AzVpnTunnel,
  underlaySimulation: AzSimulationResult, peerSimulation?: AzSimulationResult,
): VpnTunnelAssessment {
  const owner = topology.vnets.find((vnet) => vnet.gateways.some((gateway) => gateway.id === connection.targetId))
  const gateway = owner?.gateways.find((gateway) => gateway.id === connection.targetId)
  const instance = gateway?.vpnInstances?.find((instance) => instance.id === tunnel.gatewayInstanceId)
  const site = topology.sites.find((site) => site.id === connection.siteId)
  const peer = connection.bgpPeer
  const custom = connection.gatewayCustomBgpIpAddresses?.find((entry) => entry.ipConfigurationId.toLowerCase() === instance?.ipConfigurationId.toLowerCase())
  const addresses = peer && instance ? apipa(peer.address) ? instance.customBgpIpAddresses : instance.defaultBgpIpAddresses : []
  const selected = peer && apipa(peer.address) && custom ? custom.customBgpIpAddress : addresses.length === 1 ? addresses[0] : undefined
  const result: VpnTunnelAssessment = {
    connectionId: connection.id, tunnelId: tunnel.id, azureResourceId: connection.targetId,
    azureInstanceId: tunnel.gatewayInstanceId, ipConfigurationId: instance?.ipConfigurationId,
    cpeResourceId: connection.siteId, cpeInstanceRole: 'router', routingContextId: tunnel.bgp?.routingContextId,
    state: 'not-assessed', code: 'UNASSESSED', reason: '', transport: tunnel.transport, ipsecAssumption: tunnel.ipsec,
    administration: { connectionEnabled: connection.enabled, tunnelEnabled: tunnel.enabled, gatewayEnabled: gateway?.enabled, instanceEnabled: instance?.enabled },
    transportState: 'not-assessed',
    bgp: { state: connection.bgpEnabled ? 'not-assessed' : 'disabled', initiator: peer ? apipa(peer.address) ? 'cpe-required' : 'either' : 'not-assessed',
      azureAddress: selected,
      azureAsn: gateway?.asn, cpeAsn: connection.bgpPeer?.asn, cpeAddress: connection.bgpPeer?.address },
    observations: [], routeProvenance: { gateway: [], cpe: [] },
    limitations: ['Configuration eligibility is not BGP Established, IKE/SA verification or packet delivery.',
      'Transition history, SA persistence, TCP FSM, vendor internals and unexplained collateral failures are not assessed.'],
  }
  const finish = (state: State, code: string, reason: string) => {
    result.state = state
    result.code = code
    result.reason = reason
    if (result.bgp.state !== 'disabled') result.bgp.state = state
    result.observations = (tunnel.observations ?? []).map((observation) => ({
      observation: { ...observation },
      comparison: !result.bgp.azureAddress || !result.bgp.cpeAddress ? 'not-assessed'
        : observation.azureAddress === result.bgp.azureAddress && observation.cpeAddress === result.bgp.cpeAddress
          && (result.bgp.initiator !== 'cpe-required' || observation.initiator === 'cpe') ? 'match' : 'mismatch',
    }))
    return result
  }
  if (!connection.enabled || !tunnel.enabled || gateway?.enabled === false || instance?.enabled === false) {
    return finish('unavailable', 'ADMIN_DISABLED', 'Connection, tunnel, gateway or explicitly mapped instance is disabled.')
  }
  if (!instance || !site || gateway?.kind !== 'Vpn' || gateway.activeActive === undefined
    || gateway.vpnInstances?.length !== (gateway.activeActive ? 2 : 1)) {
    return finish('not-assessed', 'INSTANCE_MAPPING_UNKNOWN', 'Declare the gateway mode and complete explicit IP-configuration instance mapping; no array-order or subnet-offset mapping is inferred.')
  }
  const outerOwners = gateway.vpnInstances.filter((candidate) =>
    (tunnel.transport.kind === 'express-route' ? candidate.privateIpAddress : candidate.publicIpAddress) === tunnel.transport.azureEndpoint)
  if (outerOwners.length > 1) return finish('unavailable', 'OUTER_MAPPING_AMBIGUOUS', 'The selected outer address is assigned to multiple gateway instances; ownership is not unique.')
  if (tunnel.transport.kind === 'express-route') {
    result.underlay = assessVpnEr(topology, { ...connection, underlay: tunnel.transport }, underlaySimulation, instance)
    result.transportState = result.underlay.state
    if (result.underlay.state !== 'available') return finish(result.underlay.state, 'ER_UNDERLAY_INELIGIBLE', result.underlay.reason)
  } else {
    if (connection.useLocalAzureIpAddress) return finish('unavailable', 'TRANSPORT_MISMATCH', 'Use Azure Private IP Address cannot be modeled as an independent Internet tunnel.')
    if (!instance.publicIpAddress) return finish('not-assessed', 'OUTER_MAPPING_UNKNOWN', 'The selected instance has no explicit public outer address.')
    if (instance.publicIpAddress !== tunnel.transport.azureEndpoint) return finish('unavailable', 'OUTER_MAPPING_MISMATCH', 'The Internet outer endpoint is not owned by the selected gateway instance.')
    result.transportState = tunnel.transport.availability === 'unknown' ? 'not-assessed' : tunnel.transport.availability
    if (tunnel.transport.availability !== 'available') return finish(tunnel.transport.availability === 'unknown' ? 'not-assessed' : 'unavailable',
      'INTERNET_UNDERLAY_INELIGIBLE', 'Internet transport availability is an explicit assumption, not inferred from a selected VPN route.')
  }
  result.transportState = 'available'
  if (tunnel.ipsec !== 'available') return finish(tunnel.ipsec === 'unknown' ? 'not-assessed' : 'unavailable',
    'IPSEC_ASSUMPTION', 'Abstract IPsec availability is unknown or unavailable; BGP configuration does not establish an SA.')
  if (!connection.bgpEnabled) {
    if (connection.staticPrefixes === undefined || connection.staticAzurePrefixes === undefined) {
      return finish('not-assessed', 'STATIC_ROUTING_UNKNOWN', 'Declare both Azure-side staticPrefixes and CPE-side staticAzurePrefixes explicitly; [] means no static workload routes.')
    }
    return finish('available', 'STATIC_ELIGIBLE', 'Declared static tunnel is eligible under the explicit transport and IPsec assumptions; no BGP session is inferred.')
  }
  if (!gateway.bgpEnabled) return finish('unavailable', 'GATEWAY_BGP_DISABLED', 'BGP is enabled on the connection but disabled on the gateway; static routes are not substituted.')
  if (!peer) return finish('not-assessed', 'BGP_PEER_UNKNOWN', 'An effective LNG BGP peer address and ASN are required.')
  if (apipa(peer.address) && connection.gatewayCustomBgpIpAddresses !== undefined && !custom) {
    return finish('unavailable', 'CUSTOM_BGP_MAPPING_MISSING', 'The explicit connection-local custom selection has no entry for this gateway IP configuration.')
  }
  if (!selected) return finish('not-assessed', 'BGP_ADDRESS_SELECTION_UNKNOWN', 'The selected instance requires one unambiguous default/custom BGP address or an explicit connection-local custom selection.')
  if (!addresses.includes(selected) || apipa(peer.address) && !azureApipa(selected)) {
    return finish('unavailable', 'CUSTOM_BGP_MAPPING_INVALID', 'The selected custom Azure APIPA address must belong to this IP configuration and fall in 169.254.21.0 through 169.254.22.255.')
  }
  if (!apipa(peer.address) && !owner!.subnets.some((subnet) => subnet.name.toLowerCase() === 'gatewaysubnet' && usableSubnetAddress(subnet.prefix, selected))) {
    return finish('unavailable', 'DEFAULT_BGP_MAPPING_INVALID', 'The default Azure BGP address must belong to the owning GatewaySubnet.')
  }
  if (!apipa(peer.address) && gateway.vpnInstances.filter((candidate) => candidate.defaultBgpIpAddresses.includes(selected)).length !== 1) {
    return finish('unavailable', 'DEFAULT_BGP_MAPPING_AMBIGUOUS', 'The default Azure BGP address must be uniquely owned by the mapped gateway instance.')
  }
  const sameCustom = topology.vnets.flatMap((vnet) => vnet.gateways.flatMap((gateway) => gateway.vpnInstances ?? []))
    .filter((candidate) => candidate.customBgpIpAddresses.includes(selected))
  if (apipa(peer.address) && (selected === peer.address || sameCustom.length !== 1
    || topology.vpnConnections.some((candidate) => candidate.id !== connection.id && candidate.bgpPeer?.address === selected)
    || topology.vnets.some((vnet) => vnet.gateways.some((gateway) => gateway.vpnInstances?.some((candidate) => candidate.customBgpIpAddresses.includes(peer.address)))))) {
    return finish('unavailable', 'APIPA_ADDRESS_COLLISION', 'Custom Azure APIPA and CPE addresses must be distinct across the declared connected gateways and CPE peers.')
  }
  const binding = tunnel.bgp
  if (!binding || !site.vpnRouting) return finish('not-assessed', 'CPE_BINDING_UNKNOWN', 'Explicit CPE source/listener binding and shared routing context/FIB are required.')
  if (binding.cpeLocalAddress !== peer.address || binding.cpePeerAddress !== selected || binding.cpeRemoteAsn !== gateway.asn || peer.asn !== site.asn) {
    return finish('unavailable', 'BGP_BINDING_MISMATCH', `Expected Azure ${selected} AS ${gateway.asn} <-> CPE ${peer.address} AS ${site.asn}; the declared CPE listener/peer/source or ASN does not match.`)
  }
  if (!site.vpnRouting.localAddresses.includes(binding.cpeLocalAddress) || binding.routingContextId !== site.vpnRouting.contextId) {
    return finish('unavailable', 'CPE_LOCAL_ADDRESS_UNREACHABLE', 'The CPE BGP local address is not owned in the declared shared routing context.')
  }
  if (apipa(peer.address) && !binding.cpeInitiates) return finish('unavailable', 'CPE_INITIATION_REQUIRED',
    'The CPE must initiate APIPA BGP. IKE initiation/ResponderOnly is independent and is not a BGP-passive fix.')
  result.bgp.azureToCpe = { address: peer.address, tunnelId: tunnel.id, provenance: 'configured-peer-host-route' }
  if (peerSimulation) {
    if (peerSimulation.controlPlaneComplete === false) return finish('not-assessed', 'PEER_FIB_INCOMPLETE', 'The shared CPE peer-route control plane is incomplete.')
    result.bgp.cpeToAzure = lookupCpeRoutes(site, peerSimulation, selected, binding.cpeLocalAddress)
    result.bgp.cpeReturn = lookupCpeRoutes(site, peerSimulation, selected, peer.address)
    for (const lookup of [result.bgp.cpeToAzure, result.bgp.cpeReturn]) {
      if (!lookup.routes.length) return finish('unavailable', 'PEER_NO_ROUTE', `Shared CPE FIB has no route to Azure BGP peer ${selected} from ${lookup.sourceAddress} in ${lookup.contextId}.`)
      if (lookup.routes.some((route) => route.provenance.startsWith('derived:') && route.kind === 'VPN')) {
        return finish('not-assessed', 'PEER_ROUTE_RECURSION', `BGP peer ${selected} depends on overlay-learned routes; self/cross-tunnel control-plane feedback is not resolved.`)
      }
      if (lookup.routes.length !== 1 || lookup.routes[0].kind !== 'tunnel'
        || lookup.routes[0].connectionId !== connection.id || lookup.routes[0].tunnelId !== tunnel.id) {
        return finish('unavailable', 'PEER_WRONG_TUNNEL', `Shared CPE FIB lookup for ${selected} from ${lookup.sourceAddress} in ${lookup.contextId} does not uniquely select intended tunnel ${connection.id}/${tunnel.id}; see selected forward/return routes.`)
      }
    }
  }
  return finish('available', 'BGP_ELIGIBLE', 'Expected source/peer pair and declared routing bindings are eligible under the transport/IPsec assumptions; actual TCP/BGP establishment is not assessed.')
}

export function vpnConnectionEligible(connection: AzVpnConnection, assessments?: Record<string, VpnTunnelAssessment>): boolean {
  return connection.tunnels === undefined || connection.tunnels.some((tunnel) =>
    assessments?.[vpnTunnelKey(connection.id, tunnel.id)]?.state === 'available')
}
