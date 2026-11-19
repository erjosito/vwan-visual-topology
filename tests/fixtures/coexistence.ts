import { vpnGatewayModeTopology } from './vpn-gateway-mode'

export function coexistenceTopology() {
  const topology = vpnGatewayModeTopology()
  topology.name = 'Synthetic ER/VPN coexistence'
  Object.assign(topology.vnets[0].gateways[0], { activeActive: true, vpnType: 'RouteBased', sku: 'VpnGw2AZ' })
  topology.vnets[0].gateways.push({
    id: 'er-gw', name: 'Standalone ER', kind: 'ExpressRoute', asn: 65515,
    enabled: true, bgpEnabled: true, sku: 'ErGw1AZ',
  })
  topology.sites.push({ id: 'er-site', name: 'ER-only site', asn: 65010, prefixes: ['198.51.100.0/24'] })
  topology.erLocations = [{ id: 'msee', name: 'London', peeringLocation: 'London', sku: 'Standard' }]
  topology.erLinks = [
    { id: 'er-azure', name: 'ER Azure link', locationId: 'msee', targetKind: 'vnet-gateway', targetId: 'er-gw', enabled: true },
    { id: 'er-site-link', name: 'ER site link', locationId: 'msee', targetKind: 'site', targetId: 'er-site', enabled: true },
  ]
  return topology
}
