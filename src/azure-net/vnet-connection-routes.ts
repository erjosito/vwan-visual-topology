import { cidr, contains, formatIpv4, ipv4 } from '../validation'
import type { AzNetTopology, AzVNet } from './model'

export function connectionStaticLimitations(topology: AzNetTopology, vnet: AzVNet): string[] {
  const attachment = vnet.vwanHubAttachment
  if (!attachment?.enabled || !attachment.staticRoutes?.length) return []
  const hub = topology.vwanHubs.find((hub) => hub.id === attachment.hubId)
  const reasons = new Set<string>()
  if (attachment.propagateStaticRoutes !== true) reasons.add('Connection static routes require explicit propagation into BGP; the non-propagating model is not assessed.')
  if (hub?.routeMapAssignments?.some((assignment) => assignment.connectionId === vnet.id && (assignment.inboundMapId || assignment.outboundMapId))) {
    reasons.add('Route maps on a connection with static routes are not assessed.')
  }
  for (const route of attachment.staticRoutes) {
    const nextHop = ipv4(route.nextHopIpAddress)
    if (!route.name.trim() || !route.addressPrefixes.length || nextHop === undefined ||
      vnet.appliances.filter((app) => app.privateIp === route.nextHopIpAddress && app.kind !== 'vnra' &&
        vnet.subnets.some((subnet) => subnet.id === app.subnetId && nextHop !== undefined && contains(subnet.prefix, nextHop))).length !== 1) {
      reasons.add('Connection static routes require a named route with prefixes and an original Firewall/NVA next hop in the attached VNet.')
    }
    for (const prefix of route.addressPrefixes) {
      const network = cidr(prefix)
      if (!network || !network.length || prefix !== `${formatIpv4(network.network)}/${network.length}` ||
        topology.vnets.filter((owner) => owner.vwanHubAttachment?.enabled).flatMap((owner) => owner.prefixes).some((local) => {
        const owner = cidr(local)
        return owner && network && (contains(local, network.network) || contains(prefix, owner.network))
      })) {
        reasons.add('Default, invalid and directly attached VNet-overlapping connection static routes are not assessed; bypass-next-hop and connection-to-connection inspection are not inferred.')
      }
    }
  }
  return [...reasons]
}

export function connectionStaticRoutes(topology: AzNetTopology, vnet: AzVNet) {
  if (!vnet.vwanHubAttachment?.enabled || connectionStaticLimitations(topology, vnet).length) return []
  return (vnet.vwanHubAttachment.staticRoutes ?? []).flatMap((route) => {
    const appliance = vnet.appliances.find((app) => app.privateIp === route.nextHopIpAddress)!
    return route.addressPrefixes.map((prefix) => ({ prefix, name: route.name, appliance }))
  })
}
