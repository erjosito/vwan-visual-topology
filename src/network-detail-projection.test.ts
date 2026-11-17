import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './azure-net/model'
import type { Topology } from './model'
import { networkDetailProjection } from './network-detail-projection'
import type { ApplicationReference, ApplicationService } from './application'

describe('network detail identity projection', () => {
  it('bounds shared application graph traversal while retaining every reachable owner subnet through cycles', () => {
    const topology = createEmptyAzNetTopology(), owner = { kind: 'vnet' as const, id: 'net' }
    topology.vnets = [
      { id: 'net', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.0.0.0/16'], gateways: [], appliances: [],
        subnets: [{ id: 'one', name: 'One', prefix: '10.0.1.0/24' }, { id: 'two', name: 'Two', prefix: '10.0.2.0/24' }] },
      { id: 'other', name: 'Other network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'], gateways: [], appliances: [],
        subnets: [{ id: 'foreign', name: 'Foreign', prefix: '10.1.1.0/24' }] },
    ]
    const services: ApplicationService[] = [{ id: 'base', name: 'Base', kind: 'application-gateway', unsupportedFeatures: [], references: [
      { kind: 'subnet', owner, id: 'one' }, { kind: 'subnet', owner: { kind: 'vnet', id: 'other' }, id: 'foreign' },
      { kind: 'dns-profile', id: 'root' },
    ] }]
    let previous = ['base']
    for (let layer = 0; layer < 24; layer++) {
      const current = [`left-${layer}`, `right-${layer}`]
      for (const id of current) services.push({ id, name: id, kind: 'application-gateway', unsupportedFeatures: [],
        references: previous.map((id) => ({ kind: 'service' as const, id })) })
      previous = current
    }
    services.push({ id: 'cycle', name: 'Cycle', kind: 'application-gateway', unsupportedFeatures: [], references: [
      { kind: 'dns-profile', id: 'root' }, { kind: 'subnet', owner, id: 'two' },
    ] })
    topology.application = { version: 1, services, dnsProfiles: [{ id: 'root', name: 'Root', kind: 'traffic-manager', unsupportedFeatures: [],
      references: [...previous, 'cycle'].map((id) => ({ kind: 'service' as const, id })) }] }
    const applications = [...services, ...topology.application.dnsProfiles]
    let expansions = 0
    for (const application of applications) {
      const references: ApplicationReference[] = application.references
      Object.defineProperty(application, 'references', { get: () => {
        if (++expansions > applications.length ** 2) throw new Error('Shared graph expanded more than once per application root')
        return references
      } })
    }
    const entities = networkDetailProjection(topology, owner)
    expect(entities).toHaveLength(applications.length)
    for (const entity of entities) expect([...entity.subnetIds].sort()).toEqual(['one', 'two'])
    expect(expansions).toBeLessThanOrEqual(applications.length ** 2)
    expect(entities.find((entity) => entity.id === 'root')!.original).toBe(topology.application.dnsProfiles[0])
  })

  it('shares originals across explicit associations without inventing a gateway subnet or changing coordinates', () => {
    const topology = createEmptyAzNetTopology()
    topology.vnets = [{ id: 'net', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.0.0.0/16'], x: 123, y: 456,
      subnets: [{ id: 'one', name: 'One', prefix: '10.0.1.0/24', privateEndpoints: [{ id: 'pe', name: 'Private service', ipAddress: '10.0.1.9', serviceName: 'storage' }] },
        { id: 'two', name: 'Two', prefix: '10.0.2.0/24' }],
      gateways: [{ id: 'gw', name: 'VPN', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true }],
      routeServer: { id: 'ars', name: 'ARS', subnetId: 'two', enabled: true, branchToBranchTraffic: false, hubRoutingPreference: 'ASPath', peerApplianceIds: [] },
      appliances: [{ id: 'router', name: 'Router', kind: 'vnra', subnetId: 'one', privateIp: '10.0.1.8', enableIpForwarding: true, staticRoutes: [] }] }]
    const owner = { kind: 'vnet' as const, id: 'net' }
    topology.inventory = {
      workloads: [{ id: 'vm', name: 'Original VM', nicIds: ['nic'], backingDeviceId: 'router' }],
      nics: [{ id: 'nic', name: 'Original NIC', owner, ipConfigurations: [{ id: 'ip1', name: 'One', subnetId: 'one', privateIp: '10.0.1.4' }, { id: 'ip2', name: 'Two', subnetId: 'two', privateIp: '10.0.2.4' }] }],
      publicIps: [], natGateways: [{ id: 'nat', name: 'Original NAT', owner, sku: 'Standard', subnetIds: ['one', 'two'], publicIpIds: [] }],
      loadBalancers: [{ id: 'lb', name: 'Original LB', owner, sku: 'Standard', frontends: [{ id: 'front', name: 'Frontend', kind: 'private', subnetId: 'two' }],
        pools: [{ id: 'pool', name: 'Backends', members: [{ workloadId: 'vm', nicId: 'nic', ipConfigurationId: 'ip1' }] }], probes: [], rules: [], inboundNatRules: [], outboundRules: [] }],
    }
    topology.application = { version: 1, services: [{ id: 'app', name: 'Application', kind: 'application-gateway', references: [
      { kind: 'workload', workloadId: 'vm', nicId: 'nic', ipConfigurationId: 'ip2' },
    ], unsupportedFeatures: [] }], dnsProfiles: [] }
    const before = structuredClone(topology)
    const entities = networkDetailProjection(topology, owner)
    expect(entities.find((entity) => entity.id === 'nic')).toMatchObject({ original: topology.inventory.nics[0], subnetIds: ['one', 'two'], workloadIds: ['vm'] })
    expect(entities.find((entity) => entity.id === 'nic')!.original).toBe(topology.inventory.nics[0])
    expect(entities.find((entity) => entity.id === 'nat')!.original).toBe(topology.inventory.natGateways![0])
    expect(entities.find((entity) => entity.id === 'gw')!.subnetIds).toEqual([])
    expect(entities.find((entity) => entity.id === 'ars')!.subnetIds).toEqual(['two'])
    expect(entities.find((entity) => entity.id === 'pe')!.subnetIds).toEqual(['one'])
    expect(entities.find((entity) => entity.id === 'router')!.workloadIds).toEqual(['vm'])
    expect(entities.find((entity) => entity.id === 'lb')!.subnetIds).toEqual(['two', 'one'])
    expect(entities.find((entity) => entity.id === 'app')!.subnetIds).toEqual(['two'])
    expect(topology).toEqual(before)
    topology.vnets[0].routeServer!.subnetId = undefined
    expect(networkDetailProjection(topology, owner).find((entity) => entity.id === 'ars')!.subnetIds).toEqual([])
  })

  it('scopes VWAN inventory by original owner, not matching names, prefixes or unrelated workload references', () => {
    const owner = { kind: 'spoke' as const, id: 'net' }, other = { kind: 'spoke' as const, id: 'other' }
    const topology: Topology = { version: 1, name: 'WAN', hubs: [], sites: [], connections: [], siteLinks: [],
      spokes: [{ id: 'net', name: 'Same', prefixes: ['10.0.0.0/16'] }, { id: 'other', name: 'Same', prefixes: ['10.0.0.0/16'] }],
      inventory: { workloads: [{ id: 'vm', name: 'VM', nicIds: ['remote'] }], publicIps: [],
        nics: [{ id: 'remote', name: 'NIC', owner: other, ipConfigurations: [{ id: 'ip', name: 'IP', subnetId: 'sub', privateIp: '10.0.1.4' }] }],
        natGateways: [{ id: 'nat', name: 'NAT', owner: other, sku: 'Standard', subnetIds: ['sub'], publicIpIds: [] }] },
      application: { version: 1, services: [{ id: 'app', name: 'App', kind: 'application-gateway', references: [
        { kind: 'workload', workloadId: 'vm', nicId: 'remote', ipConfigurationId: 'ip' },
      ], unsupportedFeatures: [] }], dnsProfiles: [] },
    }
    expect(networkDetailProjection(topology, owner)).toEqual([])
    expect(networkDetailProjection(topology, other).map((entity) => entity.id)).toEqual(['remote', 'nat', 'app'])
    expect(topology.spokes[0].subnets).toBeUndefined()
  })

  it('keeps explicitly hosted VWAN NVAs at network level even when a peer address falls within a declared subnet', () => {
    const topology: Topology = { version: 1, name: 'WAN', hubs: [], siteLinks: [],
      spokes: [{ id: 'net', name: 'Network', prefixes: ['10.0.0.0/16'], subnets: [{ id: 'sub', name: 'Subnet', prefix: '10.0.1.0/24' }] }],
      sites: [{ id: 'nva', name: 'Original NVA', asn: 65001, role: 'spoke-nva', prefixes: [] }],
      connections: [{ id: 'connection', name: 'Attachment', siteId: 'nva', spokeId: 'net', hubId: 'hub', transport: 'SpokeNVA',
        peerIp: '10.0.1.4', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] }],
    }
    const [entity] = networkDetailProjection(topology, { kind: 'spoke', id: 'net' })
    expect(entity.original).toBe(topology.sites[0])
    expect(entity.target).toEqual({ kind: 'site', id: 'nva' })
    expect(entity.addresses).toEqual(['10.0.1.4'])
    expect(entity.subnetIds).toEqual([])
  })
})
