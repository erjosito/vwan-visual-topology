import { cidr, contains, ipv4 } from '../validation'
import { usableSubnetAddress } from './addressing'
import type { AzBgpRibEntry, AzSimulationResult } from './engine'
import type { AzNetTopology, AzVpnConnection } from './model'

export interface VpnErAssessment {
  state: 'available' | 'unavailable' | 'not-assessed'
  reason: string
  azureEndpoint: string
  onPremEndpoint: string
  azureLinkId: string
  siteLinkId: string
  outwardRoute?: string
  returnRoute?: string
}

export function selectedAdvertisements<T extends { prefix: string }>(routes: T[], selection?: string[]): T[] {
  return selection === undefined ? routes : routes.filter((route) => selection.includes(route.prefix))
}

function longest(routes: AzBgpRibEntry[], address: string): AzBgpRibEntry[] {
  const ip = ipv4(address)
  const matching = ip === undefined ? [] : routes.filter((route) => route.preferred && contains(route.prefix, ip))
  const length = Math.max(...matching.map((route) => cidr(route.prefix)?.length ?? -1))
  return matching.filter((route) => cidr(route.prefix)?.length === length)
}

export function assessVpnEr(topology: AzNetTopology, connection: AzVpnConnection, underlay: AzSimulationResult): VpnErAssessment {
  const path = connection.underlay ?? { kind: 'express-route', azureLinkId: '', siteLinkId: '', azureEndpoint: '', onPremEndpoint: '' }
  const result = (state: VpnErAssessment['state'], reason: string, routes = {}): VpnErAssessment => ({
    ...path, state, reason, ...routes,
  })
  if (!connection.enabled) return result('unavailable', 'VPN connection is disabled.')
  if (!connection.underlay) return result('not-assessed', 'Captured Use Azure Private IP Address requires explicit ER links and owned private endpoint declarations; no Internet VPN shortcut is inferred.')
  const owner = topology.vnets.find((vnet) => vnet.gateways.some((gateway) => gateway.id === connection.targetId))
  const gateway = owner?.gateways.find((gateway) => gateway.id === connection.targetId)
  if (connection.targetKind !== 'vnet-gateway' || gateway?.kind !== 'Vpn' || connection.transport === 'SDWAN') {
    return result('not-assessed', 'VPN over ER supports classic VPN gateways only, not Virtual WAN, SD-WAN or NVA endpoints.')
  }
  if (!gateway.enabled) return result('unavailable', 'VPN gateway is disabled.')
  if (gateway.activeActive !== false || gateway.vpnType !== 'RouteBased' || gateway.publicIpSku !== 'Standard') {
    return result('not-assessed', 'Declare active/standby, RouteBased and Standard public-IP capability explicitly. Active/active endpoint ownership is not assessed.')
  }
  if (!connection.bgpEnabled || !gateway.bgpEnabled || connection.nat) {
    return result('not-assessed', 'Static routing and VPN NAT combined with this private-peering overlay are not assessed; BGP is not an Azure prerequisite.')
  }
  const subnet = owner!.subnets.find((subnet) => subnet.name.toLowerCase() === 'gatewaysubnet')
  const privateAddress = (address: string) => {
    const ip = ipv4(address)
    return ip !== undefined && ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((prefix) => contains(prefix, ip))
  }
  if (!gateway.enablePrivateIpAddress || !connection.useLocalAzureIpAddress
    || !gateway.privateIpAddresses?.includes(path.azureEndpoint) || !subnet
    || !usableSubnetAddress(subnet.prefix, path.azureEndpoint)
    || !privateAddress(path.azureEndpoint) || !privateAddress(path.onPremEndpoint)) {
    return result('unavailable', 'Enable private gateway IPs and Use Azure Private IP Address; declare RFC1918 endpoints with the Azure endpoint owned by GatewaySubnet.')
  }
  const azureLink = topology.erLinks.find((link) => link.id === path.azureLinkId)
  const siteLink = topology.erLinks.find((link) => link.id === path.siteLinkId)
  const erGateway = owner!.gateways.find((gateway) => gateway.id === azureLink?.targetId && gateway.kind === 'ExpressRoute')
  if (!azureLink?.enabled || !siteLink?.enabled || !erGateway?.enabled || azureLink.targetKind !== 'vnet-gateway'
    || siteLink.targetKind !== 'site' || siteLink.targetId !== connection.siteId || siteLink.locationId !== azureLink.locationId) {
    return result('unavailable', 'Both selected ER links must be enabled on one circuit, connecting this site and an enabled ER gateway in the VPN VNet.')
  }
  if (underlay.controlPlaneComplete === false) return result('not-assessed', 'The independent ER underlay control plane is incomplete.')
  const outward = longest(underlay.siteRibs[connection.siteId] ?? [], path.azureEndpoint)
  const inward = longest(underlay.gatewayRibs[erGateway.id] ?? [], path.onPremEndpoint)
  const table = underlay.subnetTables[subnet.id]
  const ip = ipv4(path.onPremEndpoint)!
  const matches = table?.routes.filter((route) => route.active && contains(route.prefix, ip)) ?? []
  const max = Math.max(...matches.map((route) => cidr(route.prefix)?.length ?? -1))
  const candidates = matches.filter((route) => cidr(route.prefix)?.length === max)
  if (outward.length !== 1 || outward[0].connectionId !== siteLink.id
    || outward[0].originProtocol !== 'ExpressRoute'
    || inward.length !== 1 || inward[0].connectionId !== azureLink.id || inward[0].nextHopId !== connection.siteId
    || candidates.length !== 1 || candidates[0].nextHopResourceId !== erGateway.id || candidates[0].source === 'User') {
    return result('unavailable', 'Both outer endpoints require unique routes over the selected ER path, independent of all private VPN overlays; missing, recursive or overridden routes disable this tunnel.')
  }
  return result('available', 'Outer endpoints resolve in both directions over the selected ER circuit without private VPN overlay routes. Intended IPsec path only; IKE/SAs and delivery are not verified.', {
    outwardRoute: outward[0].prefix, returnRoute: inward[0].prefix,
  })
}
