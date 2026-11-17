import { describe, expect, it } from 'vitest'
import { haBackend, haPacket, haPortsTopology } from '../tests/fixtures/ha-ports'
import { haRoutingRequirements, withdrawHaPrimary } from '../tests/fixtures/ha-routing'
import { parseAzNetTopology } from './azure-net/admission'
import { lookupSubnetEffectiveRoute, simulateAzNet, traceAzNetFlow } from './azure-net/engine'
import { tracePacket } from './packet-flow'
import { executePlatform } from './platform/service'
import type { Requirement } from './platform/contract'

function assess(topology = haPortsTopology(), backend: 'primary' | 'standby' = 'primary') {
  const requirements: Requirement[] = [{ id: 'original-workload-conversation', kind: 'packet', packet: haPacket,
    sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10', expectation: 'configured',
    requiredBackend: { ...haBackend(backend), address: backend === 'primary' ? '10.80.1.4' : '10.80.2.4' } },
  ...haRoutingRequirements(backend)]
  return executePlatform({ contractVersion: 2, operation: 'evaluate', document: { mode: 'full', topology }, requirements })
}
describe('owned internal HA-ports NVA forwarding', () => {
  it.each(['tcp', 'udp'] as const)('preserves the original %s tuple and VIP route while independently traversing the original NVA in both legs', (protocol) => {
    const topology = parseAzNetTopology(haPortsTopology()), simulation = simulateAzNet(topology)
    const request = { ...haPacket, protocol, sourcePort: 41000, destinationPort: 65000 }
    const before = JSON.stringify(topology), packet = tracePacket(topology, request, simulation)
    expect(lookupSubnetEffectiveRoute(simulation.subnetTables.work, '10.82.1.10')).toMatchObject({ source: 'User', nextHopIp: '10.80.3.10' })
    const native = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'application', subnetId: 'work' }, '10.82.1.10')
    expect(native.hops.find((hop) => hop.haPorts)).toMatchObject({ nodeId: 'work', subnetId: 'work',
      matchedRoute: { nextHopIp: '10.80.3.10' }, haPorts: { frontendSubnetId: 'frontend-subnet' } })
    expect(native.hops.some((hop) => hop.nodeId === 'frontend-subnet')).toBe(false)
    expect(packet).toMatchObject({ translation: 'none', delivery: 'not-assessed',
      forward: { routing: 'reachable' }, reply: { routing: 'reachable' },
      haPorts: { symmetry: 'symmetric', forward: [{ loadBalancerId: 'transit-lb', frontendId: 'transit-vip',
        ruleId: 'transit-rule', poolId: 'transit-pool', selected: haBackend('primary'), applianceId: 'primary' }] } })
    for (const leg of [packet.forward, packet.reply]) {
      expect(leg.steps.filter((step) => step.entity.kind === 'load-balancer')).toHaveLength(1)
      expect(leg.steps.every((step) => JSON.stringify(step.before) === JSON.stringify(step.after))).toBe(true)
    }
    expect(packet.forward.tuple).toMatchObject({ protocol, sourcePort: 41000, destinationPort: 65000,
      sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10' })
    expect(assess(topology).errors).toEqual([])
    expect(assess(topology).assessments.map((entry) => entry.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied', 'satisfied'])
    expect(JSON.stringify(topology)).toBe(before)
  })

  it('selects only the declared standby snapshot and does not infer a healthy return from forward selection', () => {
    const topology = haPortsTopology(), health = topology.inventory!.loadBalancers![0].probes[0].health
    health[0].status = 'unhealthy'; health[1].status = 'healthy'
    expect(assess(topology, 'standby').assessments[1].outcome).toBe('violated')
    withdrawHaPrimary(topology)
    expect(assess(topology, 'standby').assessments.map((entry) => entry.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied', 'satisfied'])
    expect(tracePacket(topology, haPacket).haPorts?.forward[0].selected).toEqual(haBackend('standby'))
  })

  it('does not silently replace disabled forwarding with another backend or conceal an independent return fault', () => {
    const topology = haPortsTopology()
    topology.vnets[0].appliances[0].enableIpForwarding = false
    expect(assess(topology).assessments[0].outcome).toBe('violated')
    topology.vnets[0].appliances[0].enableIpForwarding = true
    topology.udrTables[1].routes[0].nextHopIp = '10.80.2.4'
    const packet = tracePacket(topology, haPacket)
    expect(packet).toMatchObject({ forward: { routing: 'reachable' }, reply: { routing: 'reachable' }, haPorts: { symmetry: 'asymmetric' } })
    expect(packet.reply.session).toBeUndefined()
    expect(assess(topology).assessments[0].outcome).toBe('violated')
    topology.udrTables[1].routes[0].nextHopType = 'None'
    expect(assess(topology).assessments[0].outcome).toBe('violated')
  })

  it.each(['unhealthy', 'unknown'] as const)('does not pass with %s backend eligibility and retains the unrelated witness', (status) => {
    const topology = haPortsTopology()
    topology.inventory!.loadBalancers![0].probes[0].health.forEach((state) => { state.status = status })
    const result = assess(topology)
    expect(result.errors).toEqual([])
    expect(result.assessments[0].outcome).toBe(status === 'unknown' ? 'not assessed' : 'violated')
    expect(result.assessments.at(-1)?.outcome).toBe('satisfied')
    expect(tracePacket(topology, haPacket).haPorts?.forward[0].selected).toBeUndefined()
  })

  it.each(['nonfloating', 'undeclared', 'unknown-pool', 'unknown-backend', 'multi-ip', 'multi-lb'] as const)(
    'keeps %s ownership/layout explicitly unassessed', (fault) => {
      const topology = haPortsTopology(), lb = topology.inventory!.loadBalancers![0]
      if (fault === 'nonfloating') { lb.rules[0].floatingIp = false; delete lb.rules[0].haPortsForwarding }
      if (fault === 'undeclared') delete lb.rules[0].haPortsForwarding
      if (fault === 'unknown-pool') lb.pools[0].membersStatus = 'unknown'
      if (fault === 'unknown-backend') {
        delete topology.inventory!.workloads[0].backingDeviceId
        delete topology.inventory!.nics[0].ipConfigurations[0].privateIp
      }
      if (fault === 'multi-ip') topology.inventory!.nics[0].ipConfigurations.push({ id: 'secondary-ip', name: 'Secondary',
        subnetId: 'primary-subnet', privateIp: '10.80.1.5' })
      if (fault === 'multi-lb') {
        const second = structuredClone(lb); second.id = 'second-lb'
        second.frontends[0] = { id: 'second-front', name: 'Second VIP', kind: 'private', subnetId: 'frontend-subnet', privateIp: '10.80.3.11' }
        second.pools[0].id = 'second-pool'; second.probes[0].id = 'second-probe'
        second.rules[0] = { ...second.rules[0], id: 'second-rule', frontendId: 'second-front', poolId: 'second-pool', probeId: 'second-probe' }
        topology.inventory!.loadBalancers!.push(second)
      }
      const parsed = parseAzNetTopology(topology)
      expect(tracePacket(parsed, haPacket).forward.routing).toBe('not-assessed')
      expect(assess(parsed).assessments[0].outcome).toBe('not assessed')
      expect(assess(parsed).assessments.at(-1)?.outcome).toBe('satisfied')
    })

  it('does not treat probe permission as data permission or denied probes as eligible', () => {
    const topology = haPortsTopology(), owner = { kind: 'vnet' as const, id: 'hub' }
    topology.inventory!.networkSecurityGroups = [{ id: 'backend-nsg', name: 'Backend NSG', rules: [{
      id: 'deny-data', name: 'Deny original client data', priority: 100, direction: 'inbound', action: 'deny', protocol: 'tcp',
      sources: ['10.81.0.0/16'], destinations: ['10.82.0.0/16'], sourcePorts: ['*'], destinationPorts: ['443'],
    }] }]
    topology.inventory!.nsgAssociations = [{ owner, target: { kind: 'nic', id: 'primary-nic' }, nsgId: 'backend-nsg' }]
    expect(tracePacket(topology, haPacket)).toMatchObject({ security: 'denied', haPorts: { forward: [{ status: 'selected' }] } })
    topology.inventory!.networkSecurityGroups[0].rules[0].sources = ['AzureLoadBalancer']
    topology.inventory!.networkSecurityGroups[0].rules[0].destinations = ['*']
    topology.inventory!.networkSecurityGroups[0].rules[0].destinationPorts = ['8080']
    expect(tracePacket(topology, haPacket).haPorts?.forward[0].status).toBe('blocked')
    expect(tracePacket(topology, haPacket).haPorts?.forward[0].selected).toBeUndefined()
  })

  it('does not invent a frontend mapping from a direct-IP UDR or an unknown VIP allocation', () => {
    const topology = haPortsTopology()
    topology.udrTables[0].routes[0].nextHopIp = '10.80.1.4'
    const trace = traceAzNetFlow(topology, simulateAzNet(topology), { kind: 'subnet', vnetId: 'application', subnetId: 'work' }, '172.31.80.10')
    expect(trace.hops.some((hop) => hop.haPorts)).toBe(false)
    const frontend = topology.inventory!.loadBalancers![0].frontends[0]
    if (frontend.kind === 'private') delete frontend.privateIp
    expect(assess(topology).assessments[0].outcome).toBe('not assessed')
  })

  it('keeps illustrative selection stable across pool order and does not assume an unknown alternate is ineligible', () => {
    const topology = haPortsTopology(), lb = topology.inventory!.loadBalancers![0]
    lb.probes[0].health[1].status = 'healthy'
    const selected = tracePacket(topology, haPacket).haPorts?.forward[0].selected
    lb.pools[0].members.reverse()
    expect(tracePacket(topology, haPacket).haPorts?.forward[0].selected).toEqual(selected)
    lb.probes[0].health[1].status = 'unknown'
    expect(assess(topology).assessments[0].outcome).toBe('not assessed')
  })

  it('keeps direct VIP destinations and nested NVA-to-LB forwarding outside the assessed slice', () => {
    const topology = haPortsTopology()
    topology.udrTables[0].routes.push({ id: 'to-vip', name: 'Direct VIP', prefix: '10.80.3.10/32',
      nextHopType: 'VirtualAppliance', nextHopIp: '10.80.3.10', enabled: true })
    const vip = traceAzNetFlow(topology, simulateAzNet(topology),
      { kind: 'subnet', vnetId: 'application', subnetId: 'work' }, '10.80.3.10')
    expect(vip.status).toBe('not-assessed')
    expect(vip.hops.find((hop) => hop.haPorts)?.haPorts?.selected).toBeUndefined()
    topology.vnets[0].appliances[0].staticRoutes = [{ id: 'nested-lb', prefix: '10.82.0.0/16',
      nextHopKind: 'appliance', nextHopIp: '10.80.3.10', enabled: true }]
    const result = assess(topology)
    expect(result.errors).toEqual([])
    expect(result.assessments[0].outcome).toBe('not assessed')
  })
})
