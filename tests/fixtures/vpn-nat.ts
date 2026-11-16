import type { AzNetTopology } from '../../src/azure-net/model'

export function vpnNatFixture(provider: 'classic' | 'vwan' = 'classic'): AzNetTopology {
  const classic = provider === 'classic'
  return {
    version: 2, kind: 'azure-network-topology', name: 'Overlapping VPN networks',
    vnets: [{ id: 'azure', name: 'Azure', region: 'westeurope', role: 'hub-vnet', prefixes: ['10.0.0.0/24'],
      subnets: [{ id: 'work', name: 'workloads', prefix: '10.0.0.0/25' }, { id: 'gwsub', name: 'GatewaySubnet', prefix: '10.0.0.128/26' }],
      gateways: classic ? [{ id: 'gw', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true,
        vpnNat: { sku: 'VpnGw2AZ', bgpRouteTranslation: true } }] : [],
      appliances: [], ...(classic ? {} : { vwanHubAttachment: { hubId: 'hub', enabled: true } }) }],
    vwanHubs: classic ? [] : [{ id: 'hub', name: 'Hub', region: 'westeurope', preference: 'VPN',
      routingIntent: { private: false, internet: false }, vpnNat: { bgpRouteTranslation: true } }],
    sites: [{ id: 'branch', name: 'Branch', asn: 65001, prefixes: ['10.0.0.0/24'] }],
    vpnConnections: [{ id: 'vpn', name: 'VPN link', siteId: 'branch', targetKind: classic ? 'vnet-gateway' : 'vwan-hub', targetId: classic ? 'gw' : 'hub',
      enabled: true, bgpEnabled: true, nat: { purpose: 'overlap', connectionType: 'IPsec', trafficSelectors: 'route-based',
        bgpPeerIp: '172.20.0.1', bgpPeerTranslatedIp: '172.20.0.1',
        rules: [
          { id: 'in', name: 'Branch ingress', type: 'Static', mode: 'IngressSNAT', internalMapping: '10.0.0.0/24', externalMapping: '192.168.1.0/24',
            ...(classic ? { ipConfigurationId: 'default' as const } : {}) },
          { id: 'out', name: 'Azure egress', type: 'Static', mode: 'EgressSNAT', internalMapping: '10.0.0.0/24', externalMapping: '192.168.2.0/24',
            ...(classic ? { ipConfigurationId: 'default' as const } : {}) },
        ] } }],
    vnetPeerings: [], udrTables: [], erLocations: [], erLinks: [], siteLinks: [],
  }
}
