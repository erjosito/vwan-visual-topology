import type { HubRoutingConfiguration, Topology } from '../../src/model'
import { createEmptyAzNetTopology, type AzNetTopology } from '../../src/azure-net/model'

export type FirewallDesign = 'published-vnet' | 'published-branch' | 'separate-untrusted'
export const firewallHubId = 'hub-local'
export const localFirewallId = 'fw-local'
export const firewallAddresses = {
  'trusted-a': '10.10.0.4', 'trusted-b': '10.20.0.4',
  'untrusted-a': '10.30.0.4', 'untrusted-b': '10.40.0.4',
  'branch-a': '10.50.0.4', 'branch-b': '10.60.0.4',
} as const
export type FirewallEndpoint = keyof typeof firewallAddresses

const config = (associatedTableId: string, propagatedTableIds: string[]): HubRoutingConfiguration => ({
  status: 'configured', associatedTableId, propagatedTableIds,
  labels: propagatedTableIds.map((id) => id === 'defaultRouteTable' ? 'default' : id === 'noneRouteTable' ? 'none' : id),
})

export function hubFirewallTopology(design: FirewallDesign = 'separate-untrusted'): Topology {
  const inspection = { name: 'inspect-private', destinationType: 'CIDR', destinations: ['10.0.0.0/8'],
    nextHopType: 'ResourceId', nextHop: localFirewallId }
  const prefixes = ['10.10.0.0/16', '10.20.0.0/16', '10.30.0.0/16', '10.40.0.0/16']
  const branchBypass = design !== 'published-vnet'
  return {
    version: 1, name: `Selective Firewall: ${design}`,
    hubs: [{ id: firewallHubId, name: 'Local secure hub', region: 'swedencentral', preference: 'ExpressRoute',
      firewall: { id: localFirewallId, name: 'Original local Firewall' },
      routingIntent: { private: false, internet: false, privatePrefixes: [] },
      routeTables: [
        { id: 'defaultRouteTable', name: 'Default', labels: ['default'], staticRoutes: [structuredClone(inspection)] },
        { id: 'trusted', name: 'Trusted', labels: ['trusted'], staticRoutes: [structuredClone(inspection)] },
        { id: 'untrusted', name: 'Untrusted', labels: ['untrusted'], staticRoutes: [structuredClone(inspection)] },
      ] }],
    spokes: (['trusted-a', 'trusted-b', 'untrusted-a', 'untrusted-b'] as const).map((id, index) => ({
      id, name: id, hubId: firewallHubId, prefixes: [prefixes[index]],
      hubRouting: id.startsWith('trusted')
        ? config('trusted', branchBypass ? ['trusted', 'defaultRouteTable'] : ['trusted'])
        : config(design === 'separate-untrusted' ? 'untrusted' : 'defaultRouteTable', ['noneRouteTable']),
    })),
    sites: ['branch-a', 'branch-b'].map((id, index) => ({
      id, name: id, asn: 65001 + index, prefixes: [index ? '10.60.0.0/16' : '10.50.0.0/16'],
    })),
    connections: ['branch-a', 'branch-b'].map((id) => ({
      id: `vpn-${id}`, name: `VPN ${id}`, hubId: firewallHubId, siteId: id, transport: 'VPN',
      enabled: true, learnSiteRoutes: true, inbound: [], outbound: [],
      hubRouting: config('defaultRouteTable', branchBypass ? ['trusted', 'defaultRouteTable'] : ['noneRouteTable']),
    })),
    siteLinks: [],
  }
}

export function azHubFirewallTopology(design: FirewallDesign = 'separate-untrusted'): AzNetTopology {
  const source = hubFirewallTopology(design)
  return {
    ...createEmptyAzNetTopology(), name: source.name,
    vwanHubs: structuredClone(source.hubs),
    vnets: source.spokes.map((spoke) => ({
      id: spoke.id, name: spoke.name, region: 'swedencentral', role: 'spoke-vnet',
      prefixes: [...spoke.prefixes], subnets: [{ id: `sub-${spoke.id}`, name: 'Workloads', prefix: spoke.prefixes[0].replace('/16', '/24') }],
      gateways: [], appliances: [], vwanHubAttachment: { hubId: firewallHubId, enabled: true, hubRouting: structuredClone(spoke.hubRouting) },
    })),
    sites: structuredClone(source.sites),
    vpnConnections: source.connections.map((connection) => ({
      id: connection.id, name: connection.name, siteId: connection.siteId, targetKind: 'vwan-hub',
      targetId: firewallHubId, enabled: true, bgpEnabled: true, hubRouting: structuredClone(connection.hubRouting),
    })),
  }
}
