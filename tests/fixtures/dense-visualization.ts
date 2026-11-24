import type { AzNetTopology, AzPeeringDirectionFlags } from '../../src/azure-net/model'

export const visualizationVariants = ['saved', 'circular', 'geographic', 'lanes', 'focus', 'matrix', 'regions', 'neighborhood'] as const
export type VisualizationVariant = typeof visualizationVariants[number]
export const researchRegions = ['westeurope', 'northeurope', 'eastus', 'westus2', 'southeastasia', 'australiaeast', 'japaneast', 'brazilsouth']

// Independently authored from the issue's counts, never from the private topology.
export function denseVisualizationTopology(count = 8): AzNetTopology {
  const topology: AzNetTopology = {
    version: 2, kind: 'azure-network-topology', name: `Synthetic ${count}-region visualization comparison`,
    vnets: [], vnetPeerings: [], udrTables: [], vwanHubs: [], erLocations: [], erLinks: [],
    sites: [{ id: 'site', name: 'Synthetic on-premises', asn: 65090, prefixes: ['172.20.0.0/16'], x: 1500, y: 1200 }],
    vpnConnections: [], siteLinks: [],
  }
  const flags: AzPeeringDirectionFlags = {
    allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false,
  }
  const peers = Array.from({ length: count }, (_, i) => [`nva-${i}-0`, `nva-${i}-1`]).flat()
  for (let i = 0; i < count; i++) {
    const region = researchRegions[i]
    const maps = Array.from({ length: i === 0 ? 4 : 3 }, (_, m) => ({
      id: `map-${i}-${m}`, name: `Synthetic policy ${i + 1}.${m + 1}`,
      rules: Array.from({ length: i === 0 && m === 0 ? 2 : 4 }, (_, r) => ({
        id: `rule-${i}-${m}-${r}`, prefixes: [`10.${40 + r}.0.0/16`], match: 'equals' as const,
        action: 'permit' as const, summaryPrefixes: [], prepend: [], nextStep: 'continue' as const,
      })),
    }))
    const angle = -Math.PI / 2 + i * Math.PI * 2 / count
    topology.vnets.push({
      id: `hub-${i}`, name: `Regional hub ${i + 1}`, region, prefixes: [`10.${i}.0.0/16`], role: 'hub',
      x: 1500 + Math.cos(angle) * 1250, y: 1050 + Math.sin(angle) * 800,
      subnets: [
        { id: `gateway-subnet-${i}`, name: 'GatewaySubnet', prefix: `10.${i}.0.0/26` },
        { id: `ars-subnet-${i}`, name: 'RouteServerSubnet', prefix: `10.${i}.1.0/26` },
        { id: `nva-subnet-${i}`, name: 'Routing appliances', prefix: `10.${i}.2.0/24` },
      ],
      gateways: [{ id: `gateway-${i}`, name: `ER gateway ${i + 1}`, kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true }],
      appliances: [0, 1].map(n => ({
        id: `nva-${i}-${n}`, name: `Routing appliance ${i + 1}.${n + 1}`, kind: 'nva-vm',
        subnetId: `nva-subnet-${i}`, privateIp: `10.${i}.2.${n + 4}`, asn: 65100 + i * 2 + n,
        bgpEnabled: true, enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [],
      })),
      routeServer: {
        id: `ars-${i}`, name: `Route Server ${i + 1}`, subnetId: `ars-subnet-${i}`, enabled: true,
        branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: [...peers], routeMaps: maps,
        routeMapAssignments: [
          { connectionId: `nva:nva-${i}-0`, inboundMapId: maps[0].id, outboundMapId: maps[1].id },
          { connectionId: `nva:nva-${i}-1`, inboundMapId: maps[2].id, outboundMapId: maps.at(-1)!.id },
          ...(i < count / 2 ? [{ connectionId: `gateway:gateway-${i}`, inboundMapId: maps[0].id, outboundMapId: maps[1].id }] : []),
        ],
      },
    }, {
      id: `spoke-${i}`, name: `Workload spoke ${i + 1}`, region, role: 'spoke', prefixes: [`10.${40 + i}.0.0/16`],
      x: 1500 + Math.cos(angle) * 1700, y: 1050 + Math.sin(angle) * 1150,
      subnets: [{ id: `app-${i}`, name: 'Application', prefix: `10.${40 + i}.1.0/24` }], gateways: [], appliances: [],
    })
    topology.vnetPeerings.push({
      id: `spoke-peering-${i}`, name: `Hub ${i + 1} to spoke ${i + 1}`, vnetAId: `hub-${i}`, vnetBId: `spoke-${i}`,
      enabled: true, aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags, useRemoteGateways: true },
    })
    for (let j = 0; j < i; j++) topology.vnetPeerings.push({
      id: `mesh-${j}-${i}`, name: `Hub ${j + 1} to hub ${i + 1}`, vnetAId: `hub-${j}`, vnetBId: `hub-${i}`,
      enabled: true, aToB: { ...flags }, bToA: { ...flags },
    })
    topology.erLocations.push({ id: `location-${i}`, name: `ER location ${i + 1}`, sku: 'Premium', globalReachEnabled: false,
      x: 1500 + Math.cos(angle) * 600, y: 1050 + Math.sin(angle) * 400 })
    topology.erLinks.push(
      { id: `er-hub-${i}`, name: `Regional ER attachment ${i + 1}`, locationId: `location-${i}`, targetKind: 'vnet-gateway', targetId: `gateway-${i}`, enabled: true },
      { id: `er-site-${i}`, name: `On-premises ER attachment ${i + 1}`, locationId: `location-${i}`, targetKind: 'site', targetId: 'site', enabled: i !== 0 },
    )
  }
  return topology
}

export function visualizationLayout(original: AzNetTopology, variant: VisualizationVariant): AzNetTopology {
  const copy = structuredClone(original)
  if (['saved', 'focus', 'matrix', 'regions', 'neighborhood'].includes(variant)) return copy
  const hubs = copy.vnets.filter(v => v.role === 'hub')
  const order = variant === 'geographic' ? [3, 2, 7, 0, 1, 4, 6, 5].filter(i => i < hubs.length) : hubs.map((_, i) => i)
  for (const [position, i] of order.entries()) {
    const angle = -Math.PI / 2 + position * Math.PI * 2 / hubs.length
    const hub = copy.vnets.find(v => v.id === `hub-${i}`)!
    const spoke = copy.vnets.find(v => v.id === `spoke-${i}`)!
    const location = copy.erLocations[i]
    if (variant === 'lanes') {
      Object.assign(spoke, { x: 80 + position * 400, y: 50 })
      Object.assign(hub, { x: 80 + position * 400, y: 250 })
      Object.assign(location, { x: 120 + position * 400, y: 750 })
    } else {
      Object.assign(hub, { x: 1700 + Math.cos(angle) * 1150, y: 1400 + Math.sin(angle) * 900 })
      Object.assign(spoke, { x: 1700 + Math.cos(angle) * 1700, y: 1400 + Math.sin(angle) * 1350 })
      Object.assign(location, { x: 1700 + Math.cos(angle) * 550, y: 1400 + Math.sin(angle) * 450 })
    }
  }
  Object.assign(copy.sites[0], variant === 'lanes' ? { x: hubs.length * 200, y: 1000 } : { x: 1700, y: 1400 })
  return copy
}
