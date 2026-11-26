import { describe, expect, it } from 'vitest'
import { overlappingVnets, overlapEndpoint } from '../../tests/fixtures/overlapping-vnets'
import { parseAzNetTopology } from './admission'
import { simulateAzNet, traceAzNetFlow } from './engine'
import { validateAzNetTopology } from './model'
import { packetEndpointOptions, tracePacket, type PacketRequest } from '../packet-flow'

const request = (from: string, to = from): PacketRequest => ({
  source: overlapEndpoint(from), target: overlapEndpoint(to, 'server'), protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
})
const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }

describe('isolated overlapping VNet addresses', () => {
  it.each([false, true])('preserves local forward/reply routing and NSG context regardless of VNet order: %s', (reversed) => {
    const topology = overlappingVnets()
    if (reversed) topology.vnets.reverse()
    topology.inventory!.networkSecurityGroups = [{ id: 'deny-b', name: 'Deny B', rules: [{
      id: 'deny-web', name: 'DenyWeb', priority: 100, direction: 'inbound', action: 'deny', protocol: 'tcp',
      sources: ['*'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['443'],
    }] }]
    topology.inventory!.nsgAssociations = [{ owner: { kind: 'vnet', id: 'b' }, target: { kind: 'subnet', id: 'b-data' }, nsgId: 'deny-b' }]
    const restored = parseAzNetTopology(JSON.parse(JSON.stringify(topology)))
    expect(restored).toEqual(topology)
    expect(validateAzNetTopology(restored)).toEqual([])
    const simulation = simulateAzNet(restored)
    expect(simulation.controlPlaneComplete).toBe(true)
    for (const network of ['a', 'b']) {
      const packet = tracePacket(restored, request(network), simulation)
      expect(packet.forward.routing).toBe('reachable')
      expect(packet.reply.routing).toBe('reachable')
      expect(packet.nsg!.forward.outcome).toBe(network === 'a' ? 'allowed' : 'denied')
      const trace = traceAzNetFlow(restored, simulation, { kind: 'subnet', vnetId: network, subnetId: `${network}-app` }, '100.64.2.4')
      expect(trace.status).toBe('delivered')
      expect(trace.destinationLabel).toContain(`Network ${network.toUpperCase()}`)
      expect(trace.traversedVnetIds).toEqual([network])
    }
    const options = packetEndpointOptions(restored)
    expect(options.find((option) => option.ref.workloadId === 'a-client')?.label).toContain('[Network A / a]')
    expect(options.find((option) => option.ref.workloadId === 'b-client')?.label).toContain('[Network B / b]')
  })

  it('does not use a selected remote workload identity to override a local address route', () => {
    const topology = overlappingVnets()
    for (const [source, target] of [['a', 'b'], ['b', 'a']]) {
      const packet = tracePacket(topology, request(source, target))
      expect(packet.forward.routing).toBe('unreachable')
      expect(packet.forward.reasons.join()).toContain('different network')
      expect(packet.forward.steps.some((step) => step.entity.kind === 'workload' && step.entity.id === `${target}-server`)).toBe(false)
    }
  })

  it('rejects direct whole-VNet overlap and diagnoses conflicting remote prefixes across a common peering hub', () => {
    const topology = overlappingVnets()
    topology.vnetPeerings.push({ id: 'a-b', name: 'Invalid overlap', vnetAId: 'a', vnetBId: 'b', enabled: true, aToB: flags, bToA: flags })
    expect(validateAzNetTopology(topology).join()).toMatch(/Network A.*100\.64\.0\.0\/16.*overlaps.*Network B/)
    expect(simulateAzNet(topology).controlPlaneComplete).toBe(false)
    topology.vnets.push({ id: 'hub', name: 'Shared hub', role: 'hub', region: 'westeurope', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'hub-app', name: 'Hub', prefix: '10.0.1.0/24' }], gateways: [], appliances: [] })
    topology.vnetPeerings = ['a', 'b'].map((id) => ({
      id: `hub-${id}`, name: `Hub to ${id}`, vnetAId: 'hub', vnetBId: id, enabled: true, aToB: flags, bToA: flags,
    }))
    const trace = traceAzNetFlow(topology, simulateAzNet(topology), { kind: 'subnet', vnetId: 'hub', subnetId: 'hub-app' }, '100.64.2.4')
    expect(trace.status).toBe('not-assessed')
    expect(trace.summaryReason).toContain('Overlapping remote peering destinations')
  })

  it('leaves unresolved shared-transit ownership unassessed instead of selecting the first matching VNet', () => {
    const topology = overlappingVnets()
    topology.vwanHubs.push({ id: 'hub', name: 'Transit hub', preference: 'ExpressRoute', routingIntent: { private: false, internet: false } })
    for (const vnet of topology.vnets) vnet.vwanHubAttachment = { hubId: 'hub', enabled: true }
    const simulation = simulateAzNet(topology)
    const trace = traceAzNetFlow(topology, simulation, { kind: 'vwanHub', hubId: 'hub' }, '100.64.2.4')
    expect(trace.status).toBe('not-assessed')
    expect(trace.summaryReason).toContain('shared-transit destination is ambiguous')
    expect(trace.summaryReason).toContain('Network A')
    expect(trace.summaryReason).toContain('Network B')
  })

  it('retains independently owned NAT Gateway mappings for repeated private client addresses', () => {
    const topology = overlappingVnets()
    topology.inventory!.publicIps = ['a', 'b'].map((id, index) => ({
      id: `${id}-pip`, name: `${id} public`, sku: 'Standard', allocation: 'Static', address: `20.40.50.${60 + index}`,
    }))
    topology.inventory!.natGateways = ['a', 'b'].map((id) => ({
      id: `${id}-nat`, name: `${id} NAT`, sku: 'Standard', owner: { kind: 'vnet', id },
      subnetIds: [`${id}-app`], publicIpIds: [`${id}-pip`],
    }))
    for (const [index, id] of ['a', 'b'].entries()) {
      const packet = tracePacket(parseAzNetTopology(topology), { ...request(id), target: { kind: 'external', address: '8.8.8.8' } })
      expect(packet).toMatchObject({ translation: 'snat', egress: 'configured', reply: { routing: 'reachable' } })
      expect(packet.forward.steps.find((step) => step.entity.kind === 'nat-gateway')?.after?.sourceAddress).toBe(`20.40.50.${60 + index}`)
    }
  })

  it('resolves repeated Firewall next-hop addresses within the source VNet rather than topology order', () => {
    const topology = overlappingVnets()
    for (const vnet of topology.vnets) {
      vnet.subnets.push({ id: `${vnet.id}-fw`, name: 'AzureFirewallSubnet', prefix: '100.64.3.0/26' })
      vnet.subnets[0].routeTableId = `${vnet.id}-routes`
      vnet.appliances.push({ id: `${vnet.id}-firewall`, name: `${vnet.name} Firewall`, kind: 'azure-firewall',
        subnetId: `${vnet.id}-fw`, privateIp: '100.64.3.4', enableIpForwarding: true, staticRoutes: [] })
      topology.udrTables.push({ id: `${vnet.id}-routes`, name: `${vnet.name} routes`, disableBgpRoutePropagation: false,
        routes: [{ id: `${vnet.id}-inspect`, name: 'Inspect', prefix: '100.64.2.0/24', nextHopType: 'VirtualAppliance', nextHopIp: '100.64.3.4', enabled: true }] })
    }
    const simulation = simulateAzNet(parseAzNetTopology(topology))
    for (const id of ['a', 'b']) {
      expect(simulation.subnetTables[`${id}-app`].routes.find((route) => route.source === 'User')?.nextHopResourceId).toBe(`${id}-firewall`)
      const packet = tracePacket(topology, request(id), simulation)
      expect(packet.forward.routing).toBe('reachable')
      expect(packet.forward.steps.filter((step) => step.entity.kind === 'appliance').map((step) => step.entity.id)).toEqual([`${id}-firewall`])
    }
  })

  it('keeps instance-public-IP ingress bound to the selected original NIC despite reused private addresses', () => {
    const topology = overlappingVnets()
    topology.inventory!.publicIps = ['a', 'b'].map((id, index) => ({
      id: `${id}-pip`, name: `${id} public`, sku: 'Standard', allocation: 'Static', address: `20.40.50.${60 + index}`,
    }))
    topology.inventory!.networkSecurityGroups = [{ id: 'public-web', name: 'Public web', rules: [{
      id: 'allow-web', name: 'AllowWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['Internet'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['443'],
    }] }]
    topology.inventory!.nsgAssociations = ['a', 'b'].map((id) => ({
      owner: { kind: 'vnet', id }, target: { kind: 'subnet', id: `${id}-app` }, nsgId: 'public-web',
    }))
    for (const id of ['a', 'b']) {
      topology.inventory!.nics.find((nic) => nic.id === `${id}-client-nic`)!.ipConfigurations[0].publicIpId = `${id}-pip`
    }
    for (const id of ['a', 'b']) {
      const packet = tracePacket(parseAzNetTopology(topology), { ...request(id),
        source: { kind: 'external', address: '8.8.8.8' }, target: { kind: 'public-ip', publicIpId: `${id}-pip` } })
      expect(packet).toMatchObject({ ingress: 'configured', forward: { routing: 'reachable' }, reply: { routing: 'reachable' } })
      expect(packet.forward.steps.filter((step) => step.entity.kind === 'workload').map((step) => step.entity.id)).toEqual([`${id}-client`])
    }
  })

  it('retains explicit internal LB frontend, backend and response owners across isolated overlapping VNets', () => {
    const topology = overlappingVnets()
    topology.inventory!.networkSecurityGroups = [{ id: 'probe', name: 'Probe', rules: [{
      id: 'allow-probe', name: 'AllowProbe', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['AzureLoadBalancer'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['8080'],
    }] }]
    topology.inventory!.nsgAssociations = ['a', 'b'].map((id) => ({
      owner: { kind: 'vnet', id }, target: { kind: 'subnet', id: `${id}-data` }, nsgId: 'probe',
    }))
    topology.inventory!.loadBalancers = ['a', 'b'].map((id) => {
      const { workloadId, nicId, ipConfigurationId } = overlapEndpoint(id, 'server')
      const backend = { workloadId, nicId, ipConfigurationId }
      return { id: `${id}-lb`, name: `${id} LB`, sku: 'Standard', owner: { kind: 'vnet', id },
        frontends: [{ id: `${id}-front`, name: 'Frontend', kind: 'private', subnetId: `${id}-app`, privateIp: '100.64.1.10' }],
        pools: [{ id: `${id}-pool`, name: 'Servers', members: [backend] }],
        probes: [{ id: `${id}-probe`, name: 'Probe', protocol: 'tcp', port: 8080, health: [{ target: backend, status: 'healthy' }] }],
        rules: [{ id: `${id}-rule`, name: 'Web', frontendId: `${id}-front`, poolId: `${id}-pool`, probeId: `${id}-probe`,
          protocol: 'tcp', frontendPort: 443, backendPort: 443 }], inboundNatRules: [], outboundRules: [] }
    })
    for (const id of ['a', 'b']) {
      const packet = tracePacket(parseAzNetTopology(topology), { ...request(id),
        target: { kind: 'load-balancer', loadBalancerId: `${id}-lb`, frontendId: `${id}-front` } })
      expect(packet).toMatchObject({ ingress: 'configured', forward: { routing: 'reachable' }, reply: { routing: 'reachable' },
        loadBalancer: { selected: { workloadId: `${id}-server` } } })
    }
    const remote = tracePacket(topology, { ...request('a'),
      target: { kind: 'load-balancer', loadBalancerId: 'b-lb', frontendId: 'b-front' } })
    expect(remote.forward.routing).toBe('unreachable')
    expect(remote.loadBalancer).toBeUndefined()
  })
})
