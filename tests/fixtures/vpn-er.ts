import { coexistenceTopology } from './coexistence'

export function vpnErTopology() {
  const topology = coexistenceTopology()
  topology.name = 'VPN over ER private peering'
  delete topology.vnets[0].routeServer
  Object.assign(topology.vnets[0].gateways[0], {
    activeActive: false, publicIpSku: 'Standard', enablePrivateIpAddress: true,
    privateIpAddresses: ['10.0.255.4'],
  })
  topology.sites = [{ id: 'site', name: 'One logical site', asn: 65001, prefixes: ['172.16.0.0/24', '192.168.10.0/24'],
    routeMapAssignments: [{ connectionId: 's2s', inboundMapId: 'prefer-vpn' }] }]
  Object.assign(topology.erLinks[1], { targetId: 'site', advertisedPrefixes: ['172.16.0.0/24'] })
  Object.assign(topology.vpnConnections[0], {
    useLocalAzureIpAddress: true, advertisedPrefixes: ['192.168.10.0/24'],
    underlay: { kind: 'express-route', azureLinkId: 'er-azure', siteLinkId: 'er-site-link',
      azureEndpoint: '10.0.255.4', onPremEndpoint: '172.16.0.4' },
  })
  topology.routeMaps = [{ id: 'prefer-vpn', name: 'Prefer overlay for Azure workloads', siteId: 'site', rules: [{
    id: 'prefer', prefixes: ['10.0.0.0/16'], match: 'equals', action: 'permit',
    prepend: [], summaryPrefixes: [], localPreference: 200, nextStep: 'terminate',
  }] }]
  return topology
}
