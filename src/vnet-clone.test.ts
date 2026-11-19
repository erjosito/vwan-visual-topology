import { describe, expect, it } from 'vitest'
import { cloneVnetStructure } from './vnet-clone'
import { createEmptyAzNetTopology, validateAzNetTopology } from './azure-net/model'
import { validateTopology } from './validation'
import { vpnGatewayModeTopology } from '../tests/fixtures/vpn-gateway-mode'
import type { Topology } from './model'

describe('structure-only VNet cloning', () => {
  it('remaps native subnets without copying devices, policies, endpoints, layout or unknown retained fields', () => {
    const topology = vpnGatewayModeTopology()
    const source = topology.vnets[0]
    source.prefixes.push('172.16.0.0/20')
    source.subnets.push({ id: 'extra', name: 'Delegated', prefix: '172.16.2.0/24', delegations: ['Microsoft.Web/serverFarms'],
      defaultOutboundAccess: false, internetEgressStatus: 'unknown', privateEndpointNetworkPolicies: 'Enabled',
      routeTableId: 'original-policy', privateEndpoints: [{ id: 'pe', name: 'Endpoint', ipAddress: '172.16.2.10', serviceName: 'service' }] })
    Object.assign(source, { x: 100, y: 200, label: 'Original label', futureBinding: { resourceId: 'captured' },
      bgpCommunities: { virtualNetworkCommunity: '12076:20010' }, summarizedGatewayPrefixes: ['10.0.0.0/8'] })
    const before = structuredClone(topology)
    const clone = cloneVnetStructure(topology, source.id, ' New network ', ['10.8.0.0/16', '192.168.0.0/20'])
    expect(clone).toEqual({ id: expect.any(String), name: 'New network', prefixes: ['10.8.0.0/16', '192.168.0.0/20'],
      region: source.region, role: source.role, gateways: [], appliances: [], subnets: [
        { id: expect.any(String), name: 'GatewaySubnet', prefix: '10.8.255.0/27' },
        { id: expect.any(String), name: 'RouteServerSubnet', prefix: '10.8.254.0/27' },
        { id: expect.any(String), name: 'Application', prefix: '10.8.1.0/24' },
        { id: expect.any(String), name: 'Delegated', prefix: '192.168.2.0/24', delegations: ['Microsoft.Web/serverFarms'],
          defaultOutboundAccess: false, internetEgressStatus: 'unknown', privateEndpointNetworkPolicies: 'Enabled' },
      ] })
    const ids = [clone.id, ...clone.subnets!.map(subnet => subnet.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => ![source.id, ...source.subnets.map(subnet => subnet.id)].includes(id))).toBe(true)
    expect(cloneVnetStructure(topology, source.id, 'Another', ['10.9.0.0/16', '192.168.0.0/20']).id).not.toBe(clone.id)
    if ('gateways' in clone) clone.subnets.at(-1)!.delegations!.push('Other')
    clone.prefixes.push('203.0.113.0/24')
    expect(topology).toEqual(before)
  })

  it('creates an admissible disconnected VWAN VNet without changing the source or its attachments', () => {
    const topology: Topology = { version: 1, name: 'Clone test', hubs: [], sites: [], connections: [], siteLinks: [],
      spokes: [{ id: 'source', name: 'Source', prefixes: ['10.1.0.0/16'], region: 'westeurope',
        subnets: [{ id: 'subnet', name: 'Application', prefix: '10.1.2.0/24' }], nvaSpokeIds: ['original-nva'],
        hubRouting: { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] },
        propagateDefaultRoute: true, bgpCommunities: { virtualNetworkCommunity: '12076:20010' } }] }
    const before = structuredClone(topology)
    const clone = cloneVnetStructure(topology, 'source', 'Copy', ['10.2.0.0/16'])
    expect(clone).toEqual({ id: expect.any(String), name: 'Copy', region: 'westeurope', prefixes: ['10.2.0.0/16'],
      subnets: [{ id: expect.any(String), name: 'Application', prefix: '10.2.2.0/24' }] })
    expect(topology).toEqual(before)
    expect(validateTopology({ ...topology, spokes: [clone] }).spokes).toEqual([clone])
    const native = vpnGatewayModeTopology()
    const nativeClone = cloneVnetStructure(native, 'hub', 'Native copy', ['10.8.0.0/16'])
    expect(validateAzNetTopology({ ...native, vnets: [...native.vnets, nativeClone] })).toEqual([])
  })

  it.each([
    ['', ['10.8.0.0/16'], /name must contain/],
    ['x'.repeat(121), ['10.8.0.0/16'], /name must contain/],
    ['vpn MODE hub', ['10.8.0.0/16'], /not already/],
    ['Copy', [], /one canonical/],
    ['Copy', ['10.8.0.0/16', '10.9.0.0/16'], /one canonical/],
    ['Copy', ['10.8.1.0/16'], /one canonical/],
    ['Copy', ['10.8.0.0/17'], /one canonical/],
    ['Copy', ['256.8.0.0/16'], /one canonical/],
    ['Copy', ['10.0.0.0/16'], /overlap/],
  ] as const)('rejects invalid names/ranges without changing the source (%s, %j)', (name, prefixes, error) => {
    const topology = vpnGatewayModeTopology(), before = structuredClone(topology)
    expect(() => cloneVnetStructure(topology, 'hub', name, [...prefixes])).toThrow(error)
    expect(topology).toEqual(before)
  })

  it('checks other VNets and virtual hub ownership, not on-premises default/aggregate advertisements', () => {
    const topology = vpnGatewayModeTopology()
    topology.sites[0].prefixes = ['0.0.0.0/0', '10.0.0.0/8']
    expect(cloneVnetStructure(topology, 'hub', 'Copy', ['10.8.0.0/16']).prefixes).toEqual(['10.8.0.0/16'])
    topology.vnets.push({ id: 'other', name: 'Other', region: '', role: 'spoke', prefixes: ['10.9.0.0/16'], subnets: [], gateways: [], appliances: [] })
    topology.vwanHubs.push({ id: 'virtual-hub', name: 'Virtual hub', region: '', prefix: '10.10.0.0/23',
      preference: 'ExpressRoute', routingIntent: { private: false, internet: false } })
    for (const prefix of ['10.9.0.0/16', '10.10.0.0/16']) {
      expect(() => cloneVnetStructure(topology, 'hub', 'Copy', [prefix])).toThrow(/overlap/)
    }
  })

  it('rejects overlapping mappings, missing sources and source subnets outside their owning ranges', () => {
    const topology = vpnGatewayModeTopology()
    expect(() => cloneVnetStructure(topology, 'deleted', 'Copy', ['10.8.0.0/16'])).toThrow(/no longer available/)
    topology.vnets[0].prefixes.push('172.16.0.0/16')
    expect(() => cloneVnetStructure(topology, 'hub', 'Copy', ['10.8.0.0/16', '10.8.0.0/16'])).toThrow(/overlap/)
    topology.vnets[0].subnets[0].prefix = '192.168.0.0/24'
    expect(() => cloneVnetStructure(topology, 'hub', 'Copy', ['10.8.0.0/16', '10.9.0.0/16'])).toThrow(/Every source subnet/)
    topology.vnets[0].prefixes[1] = '10.0.0.0/24'
    expect(() => cloneVnetStructure(topology, 'hub', 'Copy', ['10.8.0.0/16', '10.9.0.0/24'])).toThrow(/Source address spaces overlap/)
  })

  it('handles unsigned IPv4 boundaries and empty subnet structures', () => {
    const topology = createEmptyAzNetTopology()
    topology.vnets.push({ id: 'edge', name: 'Edge', region: '', role: 'spoke', prefixes: ['128.0.0.0/1'],
      subnets: [{ id: 'last', name: 'Last block', prefix: '255.255.255.0/24' }], gateways: [], appliances: [] })
    expect(cloneVnetStructure(topology, 'edge', 'Copy', ['0.0.0.0/1']).subnets![0].prefix).toBe('127.255.255.0/24')
    topology.vnets[0].subnets = []
    expect(cloneVnetStructure(topology, 'edge', 'Empty copy', ['0.0.0.0/1']).subnets).toEqual([])
  })
})
