import type { AzNetTopology } from '../../src/azure-net/model'

export function vpnInstanceTopology(): AzNetTopology {
  return {
    version: 2, kind: 'azure-network-topology', name: 'Synthetic three-tunnel VPN migration',
    vnets: [{
      id: 'hub', name: 'Synthetic Azure hub', role: 'hub', region: 'West Europe', prefixes: ['10.244.0.0/16'],
      subnets: [{ id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.244.255.0/27' },
        { id: 'app', name: 'Workloads', prefix: '10.244.1.0/24' }],
      appliances: [],
      gateways: [
        { id: 'vpn', name: 'Active-active VPN', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true,
          activeActive: true, vpnType: 'RouteBased', publicIpSku: 'Standard', enablePrivateIpAddress: true,
          vpnInstances: [
            { id: 'instance-west', ipConfigurationId: 'vpn/ipConfigurations/west', enabled: true,
              privateIpAddress: '10.244.255.4', publicIpAddress: '198.51.100.10', defaultBgpIpAddresses: ['10.244.255.30'],
              customBgpIpAddresses: ['169.254.21.2'], provenance: { kind: 'authored', source: 'synthetic explicit mapping west' } },
            { id: 'instance-east', ipConfigurationId: 'vpn/ipConfigurations/east', enabled: true,
              privateIpAddress: '10.244.255.5', publicIpAddress: '198.51.100.11', defaultBgpIpAddresses: ['10.244.255.29'],
              customBgpIpAddresses: ['169.254.22.2'], provenance: { kind: 'authored', source: 'synthetic explicit mapping east' } },
          ] },
        { id: 'er-gw', name: 'ExpressRoute gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true },
      ],
    }],
    vnetPeerings: [], udrTables: [], vwanHubs: [], siteLinks: [],
    erLocations: [{ id: 'circuit', name: 'London', peeringLocation: 'London', sku: 'Standard' }],
    erLinks: [
      { id: 'er-azure', name: 'Azure ER', enabled: true, locationId: 'circuit', targetKind: 'vnet-gateway', targetId: 'er-gw' },
      { id: 'er-cpe', name: 'CPE ER', enabled: true, locationId: 'circuit', targetKind: 'site', targetId: 'cpe',
        advertisedPrefixes: ['10.245.0.10/32'] },
    ],
    sites: [{
      id: 'cpe', name: 'One logical CPE and FIB', asn: 64513, prefixes: ['10.245.0.10/32', '10.245.254.6/32', '10.246.1.0/24'],
      vpnRouting: { contextId: 'shared-fib', localAddresses: ['10.245.254.6', '169.254.21.1'], peerRoutes: [
        { id: 'peer-west', prefix: '10.244.255.30/32', enabled: true, nextHop: { kind: 'tunnel', connectionId: 'private', tunnelId: 'private-west' } },
        { id: 'peer-east', prefix: '10.244.255.29/32', enabled: true, nextHop: { kind: 'tunnel', connectionId: 'private', tunnelId: 'private-east' } },
        { id: 'peer-internet', prefix: '169.254.21.2/32', enabled: true, nextHop: { kind: 'tunnel', connectionId: 'backup', tunnelId: 'internet-west' } },
      ] },
      routeMapAssignments: [{ connectionId: 'private', inboundMapId: 'prefer-private' }],
    }],
    routeMaps: [{ id: 'prefer-private', name: 'Independent CPE workload import preference', siteId: 'cpe', rules: [{
      id: 'prefer-workload', prefixes: ['10.244.0.0/16'], match: 'equals', action: 'permit', prepend: [],
      summaryPrefixes: [], localPreference: 200, nextStep: 'terminate',
    }] }],
    vpnConnections: [
      { id: 'private', name: 'Private connection, two configured tunnels', enabled: true, siteId: 'cpe', targetKind: 'vnet-gateway', targetId: 'vpn',
        bgpEnabled: true, useLocalAzureIpAddress: true, advertisedPrefixes: ['10.246.1.0/24'],
        bgpPeer: { address: '10.245.254.6', asn: 64513, provenance: { kind: 'authored', source: 'synthetic private LNG' } },
        tunnels: [
          { id: 'private-west', gatewayInstanceId: 'instance-west', enabled: true, ipsec: 'available',
            transport: { kind: 'express-route', azureLinkId: 'er-azure', siteLinkId: 'er-cpe', azureEndpoint: '10.244.255.4', onPremEndpoint: '10.245.0.10' },
            bgp: { cpeLocalAddress: '10.245.254.6', cpePeerAddress: '10.244.255.30', cpeRemoteAsn: 65515, cpeInitiates: true, routingContextId: 'shared-fib' } },
          { id: 'private-east', gatewayInstanceId: 'instance-east', enabled: true, ipsec: 'available',
            transport: { kind: 'express-route', azureLinkId: 'er-azure', siteLinkId: 'er-cpe', azureEndpoint: '10.244.255.5', onPremEndpoint: '10.245.0.10' },
            bgp: { cpeLocalAddress: '10.245.254.6', cpePeerAddress: '10.244.255.29', cpeRemoteAsn: 65515, cpeInitiates: true, routingContextId: 'shared-fib' } },
        ] },
      { id: 'backup', name: 'Existing Internet backup', enabled: true, siteId: 'cpe', targetKind: 'vnet-gateway', targetId: 'vpn',
        bgpEnabled: true, advertisedPrefixes: ['10.246.1.0/24'], inboundPrepend: [64513, 64513], staticPrefixes: [], staticAzurePrefixes: [],
        bgpPeer: { address: '169.254.21.1', asn: 64513, provenance: { kind: 'authored', source: 'synthetic Internet LNG' } },
        gatewayCustomBgpIpAddresses: [{ ipConfigurationId: 'vpn/ipConfigurations/west', customBgpIpAddress: '169.254.21.2' }],
        tunnels: [{
          id: 'internet-west', gatewayInstanceId: 'instance-west', enabled: true, ipsec: 'available',
          transport: { kind: 'internet', azureEndpoint: '198.51.100.10', onPremEndpoint: '203.0.113.20', availability: 'available' },
          bgp: { cpeLocalAddress: '169.254.21.1', cpePeerAddress: '169.254.21.2', cpeRemoteAsn: 65515, cpeInitiates: true, routingContextId: 'shared-fib' },
        }] },
    ],
  }
}

/** Ordered authored snapshots, not captured transition history or SA continuity evidence. */
export function vpnMigrationSnapshots() {
  const baseline = vpnInstanceTopology()
  const staticBackup = structuredClone(baseline)
  staticBackup.vpnConnections[0].enabled = false
  staticBackup.vpnConnections[1].bgpEnabled = false
  staticBackup.vpnConnections[1].staticPrefixes = ['10.246.1.0/24']
  staticBackup.vpnConnections[1].staticAzurePrefixes = ['10.244.0.0/16']
  const firstPrivate = structuredClone(staticBackup)
  firstPrivate.vpnConnections[0].enabled = true
  firstPrivate.vpnConnections[0].tunnels![1].enabled = false
  const twoPrivate = structuredClone(baseline)
  twoPrivate.vpnConnections[1].bgpEnabled = false
  const rollback = structuredClone(baseline)
  rollback.vpnConnections[1].bgpEnabled = false
  const erFailed = structuredClone(baseline)
  erFailed.erLinks[0].enabled = false
  return [
    { id: 'static-backup', event: 'Existing Internet connection with static workload prefixes', topology: staticBackup },
    { id: 'first-private', event: 'Add first private default-address BGP tunnel; retain static backup', topology: firstPrivate },
    { id: 'two-private', event: 'Remove Internet static prefixes; enable second private tunnel', topology: twoPrivate },
    { id: 'enable-backup-bgp', event: 'Enable APIPA BGP on the same Internet connection and tunnel; declared IPsec state unchanged', topology: baseline },
    { id: 'rollback-bgp-only', event: 'Disable only Internet BGP; no static prefixes restored and no SA restart event', topology: rollback },
    { id: 'healthy-baseline', event: 'Return to healthy coexistence baseline', topology: structuredClone(baseline) },
    { id: 'er-only-failure', event: 'Fail only the Azure ER link; do not edit private tunnels', topology: erFailed },
    { id: 'er-restored', event: 'Restore only the Azure ER link', topology: structuredClone(baseline) },
  ]
}
