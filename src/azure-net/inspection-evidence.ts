import { cidr, contains, ipv4 } from '../validation'
import { getActivePeeringBetween, type AzFlowTrace, type AzPairFlowAnalysis, type AzSimulationResult } from './engine'
import type { AzEndpointOption } from './endpoints'
import type { AzNetTopology } from './model'
import { udrAssociationError, udrRegionKey } from './udr-regions'

export function inspectionEvidence(
  topology: AzNetTopology, simulation: AzSimulationResult, pair: AzPairFlowAnalysis,
  source: AzEndpointOption, destination: AzEndpointOption,
) {
  const appliances = topology.vnets.flatMap((vnet) => vnet.appliances.map((appliance) => ({ vnet, appliance })))
  const name = (id: string) => appliances.find((entry) => entry.appliance.id === id)?.appliance.name
    ?? topology.vwanHubs.find((hub) => (hub.firewall?.id ?? `vhub-fw:${hub.id}`) === id)?.name ?? id
  const differing = [...new Set([...pair.forward.traversedApplianceIds, ...pair.reverse.traversedApplianceIds])]
    .filter((id) => pair.forward.traversedApplianceIds.includes(id) !== pair.reverse.traversedApplianceIds.includes(id))
  const direction = (trace: AzFlowTrace, from: AzEndpointOption, to: AzEndpointOption) => ({
    from: from.label, to: to.label, sourceIp: from.defaultIp, destinationIp: to.defaultIp, status: trace.status,
    path: trace.hops.map((hop) => hop.subnetName ? `${hop.nodeName}/${hop.subnetName}` : hop.nodeName)
      .filter((label, index, labels) => label !== labels[index - 1]),
    inspected: trace.traversedApplianceIds.map(name),
    bypassed: differing.filter((id) => !trace.traversedApplianceIds.includes(id)).map(name),
    routes: trace.hops.filter((hop) => hop.matchedRoute && hop.subnetId).map((hop) => {
      const table = simulation.subnetTables[hop.subnetId!]
      return { vnetId: table.vnetId, subnetId: table.subnetId, vnetName: table.vnetName, subnetName: table.subnetName,
        prefix: hop.matchedRoute!.prefix, source: hop.matchedRoute!.source,
        nextHop: hop.matchedRoute!.nextHopIp ?? hop.matchedRoute!.nextHopName ?? hop.matchedRoute!.nextHopType,
        routeTable: table.udrTableName }
    }),
  })
  const repairs: {
    direction: 'forward' | 'reverse'; vnetId: string; subnetId: string; vnetName: string; subnetName: string;
    tableName?: string; prefix: string; nextHopIp: string; applianceName: string; replacing: boolean; sharedSubnets: number
  }[] = []
  // A proposal is not a verified repair. Multiple missing appliances require a service-chain design.
  for (const [label, trace, target] of [
    ['forward', pair.forward, destination], ['reverse', pair.reverse, source],
  ] as const) {
    const missing = differing.filter((id) => !trace.traversedApplianceIds.includes(id))
    if (differing.length !== 1 || missing.length !== 1 || trace.status !== 'delivered') continue
    const owner = appliances.find((entry) => entry.appliance.id === missing[0])
    const ip = ipv4(owner?.appliance.privateIp ?? '')
    if (!owner || ip === undefined || !owner.appliance.enableIpForwarding || !cidr(target.prefix) || contains(target.prefix, ip)) continue
    for (const hop of trace.hops) {
      if (!hop.matchedRoute || !hop.subnetId ||
        !['VNetPeering', 'VirtualNetworkGateway', 'Internet'].includes(hop.matchedRoute.nextHopType)) continue
      const vnet = topology.vnets.find((entry) => entry.id === hop.vnetId)
      const subnet = vnet?.subnets.find((entry) => entry.id === hop.subnetId)
      if (!vnet || !subnet || !udrRegionKey(vnet.region) ||
        vnet.id === owner.vnet.id && subnet.id === owner.appliance.subnetId ||
        ['AzureFirewallSubnet', 'RouteServerSubnet', 'AzureFirewallManagementSubnet', 'VirtualNetworkApplianceSubnet'].includes(subnet.name)) continue
      const peering = getActivePeeringBetween(topology, vnet.id, owner.vnet.id)
      if (vnet.id !== owner.vnet.id && (!peering || peering.peering.scope?.type === 'subnets' ||
        !peering.forwardFlags.allowVirtualNetworkAccess || !peering.reverseFlags.allowVirtualNetworkAccess)) continue
      const table = topology.udrTables.find((entry) => entry.id === subnet.routeTableId)
      if (subnet.routeTableId && udrAssociationError(topology, vnet, table)) continue
      repairs.push({
        direction: label, vnetId: vnet.id, subnetId: subnet.id, vnetName: vnet.name, subnetName: subnet.name,
        tableName: table?.name, prefix: target.prefix, nextHopIp: owner.appliance.privateIp,
        applianceName: owner.appliance.name, replacing: table?.routes.some((route) => route.prefix === target.prefix) ?? false,
        sharedSubnets: table ? topology.vnets.flatMap((entry) => entry.subnets).filter((entry) => entry.routeTableId === table.id).length : 1,
      })
      break
    }
  }
  return { forward: direction(pair.forward, source, destination), reverse: direction(pair.reverse, destination, source), repairs }
}

export type InspectionEvidence = ReturnType<typeof inspectionEvidence>
