import type { Topology } from '../src/model'

export const azureBase = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network'
export const hubArm = `${azureBase}/virtualHubs/west`
export const spokeArm = (name: string) => `${hubArm}/hubVirtualNetworkConnections/${name}`
export const gatewayArm = `${azureBase}/vpnGateways/west-vpn`
export function observationFixture() {
  const capturedAt = new Date().toISOString()
  return {
    kind: 'azure-vwan-capture', version: 2, collectorVersion: '2', capturedAt, complete: true, warnings: [] as string[],
    context: { cloud: 'AzureCloud', subscriptionId: '11111111-1111-1111-1111-111111111111', tenantId: '22222222-2222-2222-2222-222222222222', azureCliVersion: '2.85.0' },
    wan: { id: `${azureBase}/virtualWans/wan`, name: 'Observed WAN', type: 'Standard', allowBranchToBranchTraffic: true, allowVnetToVnetTraffic: true },
    hubs: [{
      id: hubArm, name: 'Observed west', location: 'westeurope', virtualWanId: `${azureBase}/virtualWans/wan`,
      addressPrefix: '10.250.0.0/23', hubRoutingPreference: 'VpnGateway', unsupportedFeatures: [] as string[],
      routingPolicies: [] as { destinations: string[]; nextHop: string }[], gatewayTypes: [] as string[],
      connections: ['a', 'b'].map((name, index) => ({ id: spokeArm(name), name: `Observed ${name}`, virtualNetworkId: `${azureBase}/virtualNetworks/${name}`,
        addressPrefixes: [`10.${index + 1}.0.0/24`] as string[] | null, defaultRouting: true, enableInternetSecurity: false })),
    }],
    observations: { version: 1, startedAt: capturedAt, completedAt: capturedAt, tables: [{
      hubResourceId: hubArm, resourceId: `${hubArm}/hubRouteTables/defaultRouteTable`, resourceType: 'RouteTable', status: 'complete',
      capturedAt, apiVersion: 'az network vhub get-effective-routes', warnings: [] as string[],
      routes: ['a', 'b'].map((name, index) => ({ addressPrefixes: [`10.${index + 1}.0.0/24`], nextHopType: 'Virtual Network Connection',
        nextHops: [spokeArm(name)], routeOrigin: spokeArm(name), asPath: '' })),
    }] },
  }
}
export function comparisonDesign(): Topology {
  return {
    version: 1, name: 'Existing desired design',
    hubs: [{ id: 'h', name: 'Desired hub', region: 'westeurope', preference: 'VPN', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    spokes: ['a', 'b'].map((id, index) => ({ id, name: `Desired ${id}`, hubId: 'h', prefixes: [`10.${index + 1}.0.0/24`] })),
    sites: [], connections: [], siteLinks: [],
  }
}
