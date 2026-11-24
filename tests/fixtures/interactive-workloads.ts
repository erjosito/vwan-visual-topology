import { sampleHubSpokeFirewallUdr, type AzNetTopology } from '../../src/azure-net/model'
import { importAzureCapture } from '../../src/azure-import'
import { diagramLayout } from '../../src/diagram-layout'
import { largeVwanCapture } from '../large-vwan-fixture'

export const interactiveTiers = ['small', 'dense', 'near-limit'] as const
export type InteractiveTier = typeof interactiveTiers[number]

export function vwanInteractiveTopology(tier: InteractiveTier) {
  const [vnets, hubs, prefixes] = tier === 'small' ? [3, 1, 1] : tier === 'dense' ? [200, 4, 4] : [1000, 4, 1]
  const topology = importAzureCapture(largeVwanCapture(vnets, hubs, prefixes))
  topology.layout = { mode: 'layered', positions: {} }
  topology.layout.positions.layered = Object.fromEntries(diagramLayout(topology, 'layered').positions)
  return topology
}

export function mixedInteractiveTopology(tier: InteractiveTier): AzNetTopology {
  if (tier === 'near-limit') {
    const topology: AzNetTopology = {
      version: 2, kind: 'azure-network-topology', name: 'Synthetic native-limit sparse topology',
      vnets: [], vnetPeerings: [], udrTables: [], vwanHubs: [], erLocations: [], erLinks: [],
      sites: [], vpnConnections: [], siteLinks: [],
    }
    for (let index = 0; index < 1000; index++) {
      const prefix = `10.${Math.floor(index / 256)}.${index % 256}.0/24`
      topology.vnets.push({
        id: `bench-vnet-${index}`, name: `Benchmark spoke ${index}`, region: 'westeurope', role: 'spoke-vnet',
        prefixes: [prefix], x: index === 0 ? 80 : 1600 + index % 40 * 200, y: index === 0 ? 45 : 100 + Math.floor(index / 40) * 180,
        subnets: [{ id: `bench-subnet-${index}`, name: 'workload', prefix }], gateways: [], appliances: [],
      })
    }
    const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
    topology.vnetPeerings.push({ id: 'bench-peer-0', name: 'Explicit first-to-last native peering',
      vnetAId: topology.vnets[0].id, vnetBId: topology.vnets.at(-1)!.id, enabled: true, aToB: { ...flags }, bToA: { ...flags } })
    return topology
  }
  const size = tier === 'small' ? 3 : 61
  const prefixCount = tier === 'small' ? 4 : 500
  const topology = structuredClone(sampleHubSpokeFirewallUdr)
  const template = topology.vnets[1]
  topology.vnets = [topology.vnets[0], ...Array.from({ length: size - 1 }, (_, index) => ({
    ...structuredClone(template), id: `bench-vnet-${index}`, name: `Benchmark spoke ${index}`,
    prefixes: [`10.${index + 20}.0.0/16`], x: index === 0 ? 80 : 1600 + index * 320, y: 45,
    subnets: [{ id: `bench-subnet-${index}`, name: 'workload', prefix: `10.${index + 20}.1.0/24` }],
  }))]
  const peering = topology.vnetPeerings.find(peer => peer.vnetAId === topology.vnets[0].id)!
  topology.vnetPeerings = topology.vnets.slice(1).map((vnet, index) => ({
    ...structuredClone(peering), id: `bench-peer-${index}`, vnetAId: topology.vnets[0].id, vnetBId: vnet.id,
  }))
  topology.sites = [topology.sites[0]]
  topology.sites[0].prefixes = Array.from({ length: prefixCount }, (_, index) => `172.${16 + Math.floor(index / 256)}.${index % 256}.0/24`)
  topology.erLinks = topology.erLinks.filter(link => link.targetKind !== 'site' || link.targetId === topology.sites[0].id)
  topology.vpnConnections = topology.vpnConnections.filter(link => link.siteId === topology.sites[0].id)
  topology.siteLinks = []
  return topology
}
