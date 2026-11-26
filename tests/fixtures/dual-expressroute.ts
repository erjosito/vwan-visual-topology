import { createEmptyAzNetTopology } from '../../src/azure-net/model'

export function dualExpressRouteTopology(asn = 65010) {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Synthetic dual ExpressRoute'
  topology.vnets = [{
    id: 'azure', name: 'Azure network', role: 'hub', region: 'westeurope', prefixes: ['10.254.0.0/16'],
    subnets: [
      { id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.254.255.0/27' },
      { id: 'workload', name: 'Workload', prefix: '10.254.1.0/24' },
    ],
    gateways: [{ id: 'gateway', name: 'ER gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true }],
    appliances: [],
  }]
  topology.sites = [{ id: 'site', name: 'Synthetic site', asn, prefixes: ['172.31.100.0/24'] }]
  for (const circuit of ['a', 'b']) {
    topology.erLocations.push({ id: `circuit-${circuit}`, name: `Circuit ${circuit.toUpperCase()}`, peeringLocation: 'Amsterdam', sku: 'Standard' })
    topology.erLinks.push(
      { id: `azure-${circuit}`, name: `Azure connection ${circuit.toUpperCase()}`, locationId: `circuit-${circuit}`, targetKind: 'vnet-gateway', targetId: 'gateway', enabled: true, weight: 0 },
      { id: `site-${circuit}`, name: `Site advertisement ${circuit.toUpperCase()}`, locationId: `circuit-${circuit}`, targetKind: 'site', targetId: 'site', enabled: true },
    )
  }
  return topology
}
