import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { simulateAzNet, traceAzNetFlow } from './azure-net/engine'
import { pruneDeletedInventory, validateInventory, type NetworkLoadBalancer } from './inventory'
import { tracePacket, type PacketRequest } from './packet-flow'
import { validateTopology } from './validation'
import { privateLinkTopology, privateLinkRequest } from '../tests/fixtures/private-link'

const owner = { kind: 'vnet' as const, id: 'network' }
const backend = { workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' }
const client = { workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' }
const request: PacketRequest = { source: { kind: 'external', address: '8.8.8.8' }, target: { kind: 'public-ip', publicIpId: 'public' },
  protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }
function network(internal = false) {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false },
      { id: 'front', name: 'Frontend', prefix: '10.1.2.0/24', defaultOutboundAccess: false }], gateways: [], appliances: [] }]
  const lb: NetworkLoadBalancer = { id: 'lb', name: 'Application LB', sku: 'Standard', owner,
    frontends: [internal ? { id: 'lb-front', name: 'Internal', kind: 'private', subnetId: 'front', privateIp: '10.1.2.10' }
      : { id: 'lb-front', name: 'Public', kind: 'public', publicIpId: 'public' }],
    pools: [{ id: 'lb-pool', name: 'Servers', members: [backend] }],
    probes: [{ id: 'lb-probe', name: 'Health', protocol: 'tcp', port: 8080, health: [{ target: backend, status: 'healthy' }] }],
    rules: [{ id: 'lb-rule', name: 'Web', frontendId: 'lb-front', poolId: 'lb-pool', probeId: 'lb-probe', protocol: 'tcp',
      frontendPort: 443, backendPort: 8443, disableOutboundSnat: true }],
    inboundNatRules: [], outboundRules: [] }
  topology.inventory = { publicIps: [{ id: 'public', name: 'LB public', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' }],
    workloads: [{ id: 'server', name: 'Server', nicIds: ['server-nic'] }, { id: 'client', name: 'Client', nicIds: ['client-nic'] }],
    nics: [{ id: 'server-nic', name: 'Server NIC', owner, ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] },
      { id: 'client-nic', name: 'Client NIC', owner, ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.5' }] }],
    networkSecurityGroups: [{ id: 'nsg', name: 'Backend NSG', rules: internal ? [] : [{
      id: 'web', name: 'AllowWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['8.8.8.8/32'], destinations: ['10.1.1.0/24'], sourcePorts: ['*'], destinationPorts: ['8443'],
    }] }], nsgAssociations: [{ owner, target: { kind: 'nic', id: 'server-nic' }, nsgId: 'nsg' }], loadBalancers: [lb] }
  return topology
}
const privateRequest: PacketRequest = { ...request, source: { kind: 'workload', ...client },
  target: { kind: 'load-balancer', loadBalancerId: 'lb', frontendId: 'lb-front' } }

describe('original Private Endpoint to provider service forwarding', () => {
  it.each(['tcp', 'udp'] as const)('maps overlapping %s consumers through separate approved connections without peering', (protocol) => {
    const topology = parseAzNetTopology(privateLinkTopology())
    const original = structuredClone(topology)
    for (const id of ['a', 'b']) {
      const result = tracePacket(topology, { ...privateLinkRequest(id), protocol })
      expect(result).toMatchObject({ ingress: 'configured', translation: 'snat-dnat',
        forward: { routing: 'reachable' }, reply: { routing: 'reachable', session: 'conditional-response' },
        nsg: { forward: { outcome: 'allowed' }, reply: { outcome: 'allowed' } },
        loadBalancer: { selected: { workloadId: 'provider-vm' } } })
      const stages = result.forward.steps.filter((step) => step.after
        && (step.before.sourceAddress !== step.after.sourceAddress || step.before.destinationAddress !== step.after.destinationAddress))
      expect(stages.map((step) => [step.entity.id, step.before.sourceAddress, step.after!.sourceAddress, step.after!.destinationAddress]))
        .toEqual([['pls', '100.64.1.4', '10.91.1.4', '10.91.2.10'], ['provider-lb', '10.91.1.4', '10.91.1.4', '10.91.3.4']])
      expect(result.forward.steps.find((step) => step.entity.kind === 'private-endpoint')?.routeId).toBe(`${id}-connection`)
      expect(result.reply.steps.find((step) => step.entity.kind === 'private-link-service')?.after).toMatchObject({
        sourceAddress: '100.64.2.10', destinationAddress: '100.64.1.4', destinationPort: 49152,
      })
      expect(result.nsg!.forward.checks.find((check) => check.target.id === 'provider-nic')?.tuple).toMatchObject({
        sourceAddress: '10.91.1.4', destinationAddress: '10.91.3.4', destinationPort: 8443,
      })
      const direct = tracePacket(topology, { ...privateLinkRequest(id),
        target: { kind: 'workload', workloadId: 'provider-vm', nicId: 'provider-nic', ipConfigurationId: 'provider-ip' } })
      expect(direct.forward.routing).not.toBe('reachable')
      const other = tracePacket(topology, { ...privateLinkRequest(id),
        target: { kind: 'private-endpoint', privateEndpointId: `${id === 'a' ? 'b' : 'a'}-pe` } })
      expect(other.forward.routing).not.toBe('reachable')
    }
    expect(topology).toEqual(original)
  })

  it('distinguishes known rejected connections from unknown binding, provisioning and unsupported provider features', () => {
    const topology = privateLinkTopology()
    topology.inventory!.privateEndpointConnections![0].state = 'pending'
    expect(tracePacket(parseAzNetTopology(topology), privateLinkRequest('a')).ingress).toBe('blocked')
    topology.inventory!.privateEndpointConnections![0].state = 'unknown'
    expect(tracePacket(topology, privateLinkRequest('a')).ingress).toBe('not-assessed')
    topology.inventory!.privateEndpointConnections![0].state = 'approved'
    topology.inventory!.privateLinkServices![0].proxyProtocol = true
    expect(tracePacket(topology, privateLinkRequest('a')).ingress).toBe('not-assessed')
    topology.inventory!.privateLinkServices![0].proxyProtocol = false
    topology.inventory!.privateLinkServices![0].provisioningState = 'unknown'
    expect(tracePacket(topology, privateLinkRequest('a')).ingress).toBe('not-assessed')
    topology.inventory!.privateLinkServices![0].provisioningState = 'succeeded'
    delete topology.vnets[2].subnets[0].privateLinkServiceNetworkPolicies
    expect(tracePacket(topology, privateLinkRequest('a')).ingress).toBe('not-assessed')
    topology.inventory!.privateEndpointConnections = []
    expect(tracePacket(topology, privateLinkRequest('a')).translation).toBe('not-assessed')
  })

  it('does not infer backend eligibility or inverse service mapping through a discarded provider return', () => {
    const topology = privateLinkTopology()
    topology.inventory!.loadBalancers![0].probes[0].health = []
    expect(tracePacket(parseAzNetTopology(topology), privateLinkRequest('a')).ingress).toBe('not-assessed')
    topology.inventory!.loadBalancers![0].probes[0].health = [{ target: topology.inventory!.loadBalancers![0].pools[0].members[0], status: 'healthy' }]
    topology.vnets[2].subnets[2].routeTableId = 'drop-nat'
    topology.udrTables.push({ id: 'drop-nat', name: 'Drop provider response', disableBgpRoutePropagation: false,
      routes: [{ id: 'drop-service-nat', name: 'DropNat', prefix: '10.91.1.0/24', nextHopType: 'None', enabled: true }] })
    const result = tracePacket(parseAzNetTopology(topology), privateLinkRequest('a'))
    expect(result.reply.routing).toBe('unreachable')
    expect(result.reply.session).toBeUndefined()
    expect(result.reply.steps.some((step) => step.entity.kind === 'private-link-service' && step.after)).toBe(false)
  })

  it('rejects invalid original bindings and provider NAT allocations at admission', () => {
    for (const edit of [
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateLinkServices![0].frontendId = 'missing' },
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateLinkServices![0].natIpConfigurations[0].privateIp = '100.64.1.4' },
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateEndpointConnections![0].serviceId = 'missing' },
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateEndpointConnections!.push(structuredClone(topology.inventory!.privateEndpointConnections![0])) },
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateLinkServices![0].id = 'a-pe' },
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateLinkServices![0].natIpConfigurations[0].id = 'b-pe' },
      (topology: ReturnType<typeof privateLinkTopology>) => { topology.inventory!.privateLinkServices![0].natIpConfigurations[0] = { id: 'nat-conflict', subnetId: 'provider-backend', privateIp: '10.91.3.4' } },
    ]) {
      const topology = privateLinkTopology(); edit(topology)
      expect(() => parseAzNetTopology(topology)).toThrow(/Inventory:/)
    }
  })

  it('keeps provider-side ownership even when provider addresses repeat the consumer workloads and endpoints', () => {
    const topology = privateLinkTopology(), provider = topology.vnets[2]
    provider.prefixes = ['100.64.0.0/16']
    provider.subnets[0].prefix = '100.64.3.0/24'
    provider.subnets[1].prefix = '100.64.2.0/24'
    provider.subnets[2].prefix = '100.64.1.0/24'
    topology.inventory!.privateLinkServices![0].natIpConfigurations[0].privateIp = '100.64.3.4'
    topology.inventory!.loadBalancers![0].frontends[0] = { id: 'provider-frontend', name: 'Repeated frontend',
      kind: 'private', subnetId: 'provider-front', privateIp: '100.64.2.10' }
    topology.inventory!.nics.find((nic) => nic.id === 'provider-nic')!.ipConfigurations[0].privateIp = '100.64.1.4'
    topology.inventory!.networkSecurityGroups![0].rules[1].sources = ['100.64.3.4']
    const result = tracePacket(parseAzNetTopology(topology), privateLinkRequest('b'))
    expect(result).toMatchObject({ ingress: 'configured', reply: { routing: 'reachable', session: 'conditional-response' },
      loadBalancer: { selected: { workloadId: 'provider-vm' } } })
    expect(result.forward.steps.find((step) => step.entity.id === 'pls')!.after).toMatchObject({
      sourceAddress: '100.64.3.4', destinationAddress: '100.64.2.10',
    })
  })

  it('evaluates enabled consumer filtering and refuses port-specific certainty about a provider NAT allocation', () => {
    const topology = privateLinkTopology()
    topology.vnets[0].subnets[1].privateEndpointNetworkPolicies = 'NetworkSecurityGroupEnabled'
    topology.inventory!.networkSecurityGroups!.push({ id: 'consumer-nsg', name: 'Consumer filtering', rules: [{
      id: 'deny-consumer', name: 'DenyConsumer', priority: 100, direction: 'inbound', action: 'deny', protocol: 'any',
      sources: ['*'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['443'],
    }] })
    topology.inventory!.nsgAssociations!.push({ owner: { kind: 'vnet', id: 'a' }, target: { kind: 'subnet', id: 'a-data' }, nsgId: 'consumer-nsg' })
    const denied = tracePacket(parseAzNetTopology(topology), privateLinkRequest('a'))
    expect(denied).toMatchObject({ ingress: 'blocked', security: 'denied' })
    expect(denied.forward.steps.some((step) => step.entity.kind === 'private-link-service')).toBe(false)
    topology.vnets[0].subnets[1].privateEndpointNetworkPolicies = 'Disabled'
    topology.inventory!.networkSecurityGroups![0].rules[1].sourcePorts = ['49152']
    const unknown = tracePacket(topology, privateLinkRequest('a'))
    expect(unknown.ingress).toBe('not-assessed')
    expect(unknown.reply.session).toBeUndefined()
    expect(unknown.reply.steps.some((step) => step.entity.kind === 'private-link-service' && step.after)).toBe(false)
  })

  it('does not silently use inbound NAT rules or remove unrelated connections when original provider attachments are deleted', () => {
    const topology = privateLinkTopology(), lb = topology.inventory!.loadBalancers![0]
    lb.inboundNatRules = [{ id: 'unsupported-inbound', name: 'Inbound NAT only', frontendId: 'provider-frontend', poolId: 'provider-pool',
      target: lb.pools[0].members[0], protocol: 'tcp', frontendPort: 443, backendPort: 8443 }]
    lb.rules = lb.rules.filter((rule) => rule.protocol !== 'tcp')
    expect(tracePacket(parseAzNetTopology(topology), privateLinkRequest('a')).ingress).toBe('not-assessed')
    const next = structuredClone(topology)
    next.vnets[0].subnets[1].privateEndpoints = []
    pruneDeletedInventory(next, topology)
    expect(next.inventory!.privateEndpointConnections!.map((connection) => connection.privateEndpointId)).toEqual(['b-pe'])
    next.vnets[2].subnets = next.vnets[2].subnets.filter((subnet) => subnet.id !== 'provider-nat')
    pruneDeletedInventory(next, topology)
    expect(next.inventory!.privateLinkServices).toEqual([])
    expect(next.inventory!.privateEndpointConnections).toEqual([])
    expect(() => parseAzNetTopology(next)).not.toThrow()
  })
})
const outbound: PacketRequest = { ...request, source: { kind: 'workload', ...backend }, target: { kind: 'external', address: '8.8.8.8' } }
function addOutbound(topology: ReturnType<typeof network>) {
  topology.inventory!.loadBalancers![0].outboundRules = [{ id: 'lb-out', name: 'Outbound', frontendIds: ['lb-front'], poolId: 'lb-pool', protocol: 'any' }]
}

describe('original regional Standard Load Balancer', () => {
  it('maps public ingress to a backend without its own public IP and inverses only the conditional LB response', () => {
    const topology = parseAzNetTopology(network()), simulation = simulateAzNet(topology), before = JSON.stringify(simulation)
    const result = tracePacket(topology, request, simulation)
    expect(result).toMatchObject({ ingress: 'configured', translation: 'dnat', delivery: 'not-assessed',
      loadBalancer: { kind: 'load-balancing', selected: backend, eligible: [backend] }, reply: { routing: 'reachable', session: 'conditional-response' } })
    expect(result.nsg!.forward.checks.find((check) => check.ruleId === 'web')!.tuple).toMatchObject({
      sourceAddress: '8.8.8.8', destinationAddress: '10.1.1.4', destinationPort: 8443,
    })
    expect(result.reply.steps.at(-1)!.after).toMatchObject({ sourceAddress: '20.40.50.60', sourcePort: 443, destinationAddress: '8.8.8.8' })
    expect(JSON.stringify(simulation)).toBe(before)
  })

  it('keeps probe filtering separate from data filtering and does not call a listener reachable', () => {
    const topology = network()
    topology.inventory!.networkSecurityGroups![0].rules = []
    const dataDenied = tracePacket(topology, request)
    expect(dataDenied.loadBalancer!.probes[0].eligibility).toBe('eligible')
    expect(dataDenied).toMatchObject({ ingress: 'blocked', security: 'denied', delivery: 'not-assessed' })
    expect(dataDenied.reply.session).toBeUndefined()
    topology.inventory!.networkSecurityGroups![0].rules.push({ id: 'deny-probe', name: 'DenyProbe', priority: 100, direction: 'inbound',
      action: 'deny', protocol: 'tcp', sources: ['AzureLoadBalancer'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['8080'] })
    const probeDenied = tracePacket(topology, request)
    expect(probeDenied).toMatchObject({ ingress: 'blocked', loadBalancer: { eligible: [] } })
    expect(probeDenied.loadBalancer!.probes[0].checks.some((check) => check.ruleId === 'deny-probe')).toBe(true)
  })

  it.each(['unhealthy', 'unknown'] as const)('preserves %s declared health without inventing a selected backend', (status) => {
    const topology = network(); topology.inventory!.loadBalancers![0].probes[0].health[0].status = status
    const result = tracePacket(topology, request)
    expect(result.ingress).toBe(status === 'unhealthy' ? 'blocked' : 'not-assessed')
    expect(result.loadBalancer!.selected).toBeUndefined()
    expect(result.forward.steps.some((step) => step.entity.kind === 'workload')).toBe(false)
  })

  it('makes illustrative selection stable across pool ordering and declared client-IP affinity', () => {
    const topology = network(), lb = topology.inventory!.loadBalancers![0]
    const second = { workloadId: 'second', nicId: 'second-nic', ipConfigurationId: 'second-ip' }
    topology.inventory!.workloads.push({ id: 'second', name: 'Second', nicIds: ['second-nic'] })
    topology.inventory!.nics.push({ id: 'second-nic', name: 'Second NIC', owner,
      ipConfigurations: [{ id: 'second-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.6' }] })
    topology.inventory!.nsgAssociations!.push({ owner, target: { kind: 'nic', id: 'second-nic' }, nsgId: 'nsg' })
    lb.pools[0].members.push(second); lb.probes[0].health.push({ target: second, status: 'healthy' })
    lb.rules[0].affinity = 'client-ip'
    validateInventory(topology)
    const selected = tracePacket(topology, request).loadBalancer!.selected
    lb.pools[0].members.reverse()
    expect(tracePacket(topology, { ...request, sourcePort: 50123 }).loadBalancer!.selected).toEqual(selected)
    lb.probes[0].health.forEach((entry) => { if (entry.target.workloadId === selected!.workloadId) entry.status = 'unhealthy' })
    expect(tracePacket(topology, request).loadBalancer!.selected).not.toEqual(selected)
    lb.pools[0].membersStatus = 'unknown'
    expect(tracePacket(topology, request).ingress).toBe('not-assessed')
  })

  it('requires a valid private frontend path and rejects Internet initiation or backend internal hairpin', () => {
    const topology = parseAzNetTopology(network(true)), result = tracePacket(topology, privateRequest)
    expect(result).toMatchObject({ ingress: 'configured', translation: 'dnat', reply: { routing: 'reachable', session: 'conditional-response' } })
    expect(result.reply.steps.at(-1)!.after!.sourceAddress).toBe('10.1.2.10')
    expect(tracePacket(topology, { ...privateRequest, source: request.source }).ingress).toBe('not-assessed')
    expect(tracePacket(topology, { ...privateRequest, source: { kind: 'workload', ...backend } }).ingress).toBe('blocked')
    expect(tracePacket(topology, outbound).egress).toBe('blocked')
  })

  it('retains original native-v1 spoke ownership and private frontend response routing', () => {
    const mixed = network(true), inventory = structuredClone(mixed.inventory!)
    inventory.nics.forEach((nic) => { nic.owner = { kind: 'spoke', id: owner.id } })
    inventory.nsgAssociations!.forEach((binding) => { binding.owner = { kind: 'spoke', id: owner.id } })
    inventory.loadBalancers![0].owner = { kind: 'spoke', id: owner.id }
    const topology = validateTopology({ version: 1, name: 'Original native LB',
      hubs: [{ id: 'hub', name: 'Hub', region: 'westeurope', preference: 'ExpressRoute',
        routingIntent: { internet: false, private: false, privatePrefixes: [] } }],
      spokes: [{ id: owner.id, name: 'Network', hubId: 'hub', prefixes: mixed.vnets[0].prefixes, subnets: mixed.vnets[0].subnets }],
      sites: [], connections: [], siteLinks: [], inventory })
    expect(tracePacket(topology, privateRequest)).toMatchObject({ ingress: 'configured', loadBalancer: { selected: backend },
      reply: { routing: 'reachable', session: 'conditional-response' } })
    expect(topology.inventory!.loadBalancers![0].owner).toEqual({ kind: 'spoke', id: owner.id })
  })

  it('retains a configured forward mapping but does not inverse-map a black-holed backend response', () => {
    const topology = network(true)
    topology.inventory!.nics[1].ipConfigurations[0].subnetId = 'front'
    topology.inventory!.nics[1].ipConfigurations[0].privateIp = '10.1.2.5'
    topology.vnets[0].subnets[0].routeTableId = 'drop-table'
    topology.udrTables = [{ id: 'drop-table', name: 'Drop client', disableBgpRoutePropagation: false,
      routes: [{ id: 'drop', name: 'Drop response', prefix: '10.1.2.5/32', nextHopType: 'None', enabled: true }] }]
    const result = tracePacket(parseAzNetTopology(topology), privateRequest)
    expect(result).toMatchObject({ ingress: 'configured', forward: { routing: 'reachable' }, reply: { routing: 'unreachable' } })
    expect(result.reply.session).toBeUndefined()
    expect(result.reply.steps.some((step) => step.after?.sourceAddress === '10.1.2.10')).toBe(false)
  })

  it('keeps a specific inbound NAT identity and target independent of probe health', () => {
    const topology = network(), lb = topology.inventory!.loadBalancers![0]
    lb.rules = []; lb.probes[0].health[0].status = 'unhealthy'
    lb.inboundNatRules = [{ id: 'admin-nat', name: 'Admin', frontendId: 'lb-front', poolId: 'lb-pool', target: backend,
      protocol: 'tcp', frontendPort: 50022, backendPort: 22 }]
    topology.inventory!.networkSecurityGroups![0].rules[0].destinationPorts = ['22']
    const result = tracePacket(parseAzNetTopology(topology), { ...request, destinationPort: 50022 })
    expect(result).toMatchObject({ ingress: 'configured', loadBalancer: { kind: 'inbound-nat', ruleId: 'admin-nat', selected: backend, probes: [] } })
    expect(result.reply.steps.at(-1)!.after!.sourcePort).toBe(50022)
    topology.inventory!.nsgAssociations = []
    expect(tracePacket(topology, { ...request, destinationPort: 50022 })).toMatchObject({ ingress: 'blocked', security: 'denied' })
  })

  it('uses public LB outbound configuration only after routing, below instance public IP and NAT Gateway precedence', () => {
    const topology = network(); addOutbound(topology)
    const simulation = simulateAzNet(parseAzNetTopology(topology))
    expect(traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: owner.id, subnetId: 'app' }, '8.8.8.8',
      { sourceAddress: '10.1.1.4' }).status).toBe('delivered')
    expect(tracePacket(topology, outbound)).toMatchObject({ egress: 'configured', translation: 'snat', reply: { session: 'conditional-response' } })
    expect(tracePacket(topology, outbound).forward.steps.at(-1)!.entity).toEqual({ kind: 'load-balancer', id: 'lb' })
    topology.inventory!.publicIps.push({ id: 'instance', name: 'Instance', sku: 'Standard', allocation: 'Static', address: '20.40.50.61' })
    topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'instance'
    expect(tracePacket(parseAzNetTopology(topology), outbound).forward.steps.at(-1)!.entity.kind).toBe('public-ip')
    topology.inventory!.publicIps.push({ id: 'nat-public', name: 'NAT public', sku: 'Standard', allocation: 'Static', address: '20.40.50.62' })
    topology.inventory!.natGateways = [{ id: 'nat', name: 'NAT Gateway', sku: 'Standard', owner, subnetIds: ['app'], publicIpIds: ['nat-public'] }]
    expect(tracePacket(parseAzNetTopology(topology), outbound).forward.steps.at(-1)!.entity.kind).toBe('nat-gateway')
    expect(tracePacket(topology, request).reply.steps.at(-1)!.after!.sourceAddress).toBe('20.40.50.60')
  })

  it('does not treat an unmatched outbound protocol, unknown primary association or unknown allocation as successful SNAT', () => {
    const topology = network(); addOutbound(topology)
    topology.inventory!.loadBalancers![0].outboundRules[0].protocol = 'tcp'
    expect(tracePacket(topology, { ...outbound, protocol: 'udp' }).egress).toBe('blocked')
    topology.inventory!.nics[0].ipConfigurations.push({ id: 'secondary', name: 'Secondary', subnetId: 'app', privateIp: '10.1.1.7' })
    expect(tracePacket(topology, outbound).egress).toBe('not-assessed')
    topology.inventory!.nics[0].ipConfigurations[0].primary = true
    delete topology.inventory!.publicIps[0].address
    expect(tracePacket(topology, outbound).translation).toBe('not-assessed')
    expect(tracePacket(topology, request).loadBalancer?.selected).toBeUndefined()
  })

  it('does not let implicit outbound declaration ordering hide unsupported coverage or alter the selected rule', () => {
    const topology = network(), lb = topology.inventory!.loadBalancers![0]
    lb.rules[0].disableOutboundSnat = false
    lb.rules.push({ ...lb.rules[0], id: 'other-rule', frontendPort: 444 })
    validateInventory(topology)
    const before = tracePacket(topology, outbound)
    expect(before.egress).toBe('configured')
    lb.rules.reverse()
    expect(tracePacket(topology, outbound)).toEqual(before)
    lb.rules[0].floatingIp = true
    expect(tracePacket(topology, outbound).egress).toBe('not-assessed')
    lb.rules.reverse()
    expect(tracePacket(topology, outbound).egress).toBe('not-assessed')
  })

  it('rejects original ownership/match/address errors and explicitly gates HA ports/Floating IP without rewriting them', () => {
    const collision = network(true)
    collision.inventory!.loadBalancers![0].frontends = [{ id: 'lb-front', name: 'Internal', kind: 'private', subnetId: 'app', privateIp: '10.1.1.4' }]
    expect(() => validateInventory(collision)).toThrow(/colliding/)
    const secondary = network(); addOutbound(secondary); secondary.inventory!.nics[0].ipConfigurations[0].primary = false
    expect(() => validateInventory(secondary)).toThrow(/secondary/)
    const publicHa = network(), rule = publicHa.inventory!.loadBalancers![0].rules[0]
    rule.haPorts = true; rule.protocol = 'all'; rule.frontendPort = 0; rule.backendPort = 0
    expect(() => validateInventory(publicHa)).toThrow(/HA ports/)
    const floating = network(); floating.inventory!.loadBalancers![0].rules[0].floatingIp = true
    const result = tracePacket(parseAzNetTopology(floating), request)
    expect(result).toMatchObject({ ingress: 'not-assessed', translation: 'not-assessed' })
    expect(result.forward.steps.some((step) => step.after && step.after.destinationAddress !== step.before.destinationAddress)).toBe(false)
    const invalid = network(); invalid.inventory!.loadBalancers![0].pools[0].members[0] = { ...backend, ipConfigurationId: 'missing' }
    expect(() => validateInventory(invalid)).toThrow(/original workload/)
  })

  it.each([false, true])('keeps internal HA ports with Floating IP %s explicitly unassessed', (floatingIp) => {
    const topology = network(true), rule = topology.inventory!.loadBalancers![0].rules[0]
    rule.haPorts = true; rule.floatingIp = floatingIp
    rule.protocol = 'all'; rule.frontendPort = 0; rule.backendPort = 0
    const native = parseAzNetTopology(topology)
    const result = tracePacket(native, privateRequest)
    expect(result).toMatchObject({ ingress: 'not-assessed', translation: 'not-assessed', delivery: 'not-assessed' })
    expect(result.forward.reasons).toContainEqual(expect.stringMatching(/HA ports and Floating IP\/DSR require separate/))
    expect(native.inventory!.loadBalancers![0].rules[0]).toMatchObject({ haPorts: true, floatingIp })
  })

  it('prunes deleted original backends and internal subnets without deleting shared LB identities or public allocations', () => {
    const before = network(), next = structuredClone(before)
    next.inventory!.workloads = next.inventory!.workloads.filter((workload) => workload.id !== backend.workloadId)
    next.inventory!.nics = next.inventory!.nics.filter((nic) => nic.id !== backend.nicId)
    pruneDeletedInventory(next, before); validateInventory(next)
    expect(next.inventory!.loadBalancers![0].pools[0].members).toEqual([])
    expect(next.inventory!.loadBalancers![0].probes[0].health).toEqual([])
    expect(tracePacket(next, request).ingress).toBe('blocked')
    expect(next.inventory!.publicIps[0].id).toBe('public')
    const internal = network(true), removed = structuredClone(internal)
    removed.vnets[0].subnets = removed.vnets[0].subnets.filter((subnet) => subnet.id !== 'front')
    pruneDeletedInventory(removed, internal); validateInventory(removed)
    expect(removed.inventory!.loadBalancers![0].frontends).toEqual([])
    expect(removed.inventory!.loadBalancers![0].rules).toEqual([])
  })
})
