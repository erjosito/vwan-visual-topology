export function arsRouteCapture() {
  return {
    kind: 'azure-network-capture', version: 2, fixture: 'Synthetic, not recorded Azure evidence.',
    capturedAt: '2026-11-18T00:00:00Z', collectorVersion: 'test', resourceGroup: 'synthetic-ars',
    vnets: [], routeTables: [], vnetGateways: [], localNetworkGateways: [], vpnConnections: [],
    routeServers: [], networkInterfaces: [],
    arsLearnedRoutes: {
      'ars-a/same-peer': [
        { network: '172.16.0.0/16', localRole: 'RouteServiceRole_IN_0', localAddress: '10.1.0.4', sourcePeer: '10.2.0.4', asPath: '65001', weight: 0 },
        { network: '192.168.0.0/24', localRole: 'RouteServiceRole_IN_1', localAddress: '10.1.0.5', sourcePeer: '10.2.0.4', asPath: '65002' },
        { network: '203.0.113.0/24' },
      ],
      'ars-b/same-peer': [{ network: '198.51.100.0/24', localRole: 'RouteServiceRole_IN_0', localAddress: '10.3.0.4' }],
    },
    arsAdvertisedRoutes: {
      'ars-a/same-peer': [{ network: '10.20.0.0/16', localRole: 'RouteServiceRole_IN_0', nextHop: '10.1.0.4', asPath: '65515-65050', weight: 0 }],
    },
  }
}
