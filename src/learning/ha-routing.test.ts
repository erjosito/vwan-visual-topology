import { describe, expect, it } from 'vitest'
import { executePlatform } from '../platform/service'
import { simulateAzNet, lookupSubnetEffectiveRoute, traceAzNetFlow } from '../azure-net/engine'
import { haRoutingRequirements, haRoutingTopology, withdrawHaPrimary } from '../../tests/fixtures/ha-routing'

function assess(topology = haRoutingTopology(), applianceId: 'primary' | 'standby' = 'primary') {
  return executePlatform({
    contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
    requirements: haRoutingRequirements(applianceId),
  })
}

describe('bounded NVA HA routing qualification', () => {
  it('selects the preferred NVA in both directions and keeps an unrelated local conversation', () => {
    const topology = haRoutingTopology()
    const result = assess(topology)
    expect(result.errors).toEqual([])
    expect(result.status).toBe('complete')
    expect(result.assessments.map((entry) => entry.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied'])
    expect(result.assessments[0].evidence).toMatchObject({
      forward: { status: 'delivered', traversedApplianceIds: ['primary'],
        traversedEdgeIds: expect.arrayContaining(['primary-overlay']) },
      reverse: { status: 'delivered', traversedApplianceIds: ['primary'] },
    })
    const simulation = simulateAzNet(topology)
    expect(simulation.routeServerRibs.ars.filter((route) => route.prefix === '172.31.80.0/24'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ nextHopId: 'primary', asPath: [65080], preferred: true }),
        expect.objectContaining({ nextHopId: 'standby', asPath: [65081, 65081, 65081], preferred: false }),
      ]))
    expect(lookupSubnetEffectiveRoute(simulation.subnetTables.work, '172.31.80.10'))
      .toMatchObject({ source: 'RouteServer', nextHopIp: '10.80.1.4' })
  })

  it('qualifies the declared primary withdrawal and restored snapshots, not elapsed failover', () => {
    const topology = haRoutingTopology()
    withdrawHaPrimary(topology)
    const result = assess(topology, 'standby')
    expect(result.errors).toEqual([])
    expect(result.assessments.map((entry) => entry.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied'])
    expect(result.assessments[0].evidence).toMatchObject({
      forward: { status: 'delivered', traversedApplianceIds: ['standby'],
        traversedEdgeIds: expect.arrayContaining(['standby-overlay']) },
      reverse: { status: 'delivered', traversedApplianceIds: ['standby'] },
    })
    const simulation = simulateAzNet(topology)
    expect(simulation.routeServerRibs.ars.filter((route) => route.prefix === '172.31.80.0/24'))
      .toEqual([expect.objectContaining({ nextHopId: 'standby', preferred: true })])
    expect(assess(topology).assessments[0].outcome).toBe('violated')
    topology.vpnConnections[0].enabled = true
    topology.vnets[0].appliances[0].advertisedPrefixes = ['172.31.80.0/24']
    expect(assess(topology).assessments.every((entry) => entry.outcome === 'satisfied')).toBe(true)
  })

  it('does not equate an available standby or a retained BGP advertisement with usable forwarding', () => {
    const topology = haRoutingTopology()
    topology.vpnConnections[0].enabled = false
    const result = assess(topology)
    expect(result.assessments[0].outcome).toBe('violated')
    expect(result.assessments[0].evidence).toMatchObject({
      forward: { status: 'dropped-no-route' }, reverse: { status: 'delivered' },
    })
    expect(result.assessments.slice(1).map((entry) => entry.outcome)).toEqual(['satisfied', 'satisfied'])
    const connectivityOnly = haRoutingRequirements('primary')
    if (connectivityOnly[0].kind !== 'flow') throw new Error('Flow required')
    delete connectivityOnly[0].applianceChain
    expect(executePlatform({
      contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: connectivityOnly,
    }).assessments[0].outcome).toBe('violated')
    withdrawHaPrimary(topology)
    expect(assess(topology, 'standby').assessments.every((entry) => entry.outcome === 'satisfied')).toBe(true)
  })

  it('requires a UDR repair when User policy pins an NVA with explicitly disabled forwarding', () => {
    const topology = haRoutingTopology()
    withdrawHaPrimary(topology)
    topology.vnets[0].appliances[0].enableIpForwarding = false
    topology.vnets[1].subnets[0].routeTableId = 'manual-steering'
    topology.udrTables.push({
      id: 'manual-steering', name: 'Manual branch steering', disableBgpRoutePropagation: false,
      routes: [{ id: 'branch-path', name: 'Branch path', prefix: '172.31.80.0/24',
        nextHopType: 'VirtualAppliance', nextHopIp: '10.80.1.4', enabled: true }],
    })
    expect(assess(topology, 'standby').assessments[0].outcome).toBe('violated')
    expect(lookupSubnetEffectiveRoute(simulateAzNet(topology).subnetTables.work, '172.31.80.10'))
      .toMatchObject({ source: 'User', nextHopIp: '10.80.1.4' })
    topology.udrTables[0].routes[0].nextHopIp = '10.80.2.4'
    expect(assess(topology, 'standby').assessments.every((entry) => entry.outcome === 'satisfied')).toBe(true)
    topology.udrTables[0].routes = []
    expect(assess(topology, 'standby').assessments.every((entry) => entry.outcome === 'satisfied')).toBe(true)
  })

  it('checks the return independently after the forward path has reached the branch', () => {
    const topology = haRoutingTopology()
    withdrawHaPrimary(topology)
    topology.vnets[0].subnets[1].routeTableId = 'broken-return'
    topology.udrTables.push({
      id: 'broken-return', name: 'Independent return fault', disableBgpRoutePropagation: false,
      routes: [{ id: 'return-loop', name: 'Application return', prefix: '10.81.0.0/16',
        nextHopType: 'VirtualAppliance', nextHopIp: '10.80.2.4', enabled: true }],
    })
    const result = assess(topology, 'standby')
    expect(result.assessments[0]).toMatchObject({
      outcome: 'violated', evidence: { forward: { status: 'delivered' } },
    })
    expect(result.assessments.slice(1).every((entry) => entry.outcome === 'satisfied')).toBe(true)
    topology.udrTables[0].routes = []
    expect(assess(topology, 'standby').assessments.every((entry) => entry.outcome === 'satisfied')).toBe(true)
  })

  it('does not certify unknown ownership or a repair that withdraws both available paths', () => {
    const topology = haRoutingTopology()
    const requirements = haRoutingRequirements('standby')
    const flow = requirements[0]
    if (flow.kind !== 'flow') throw new Error('Flow required')
    flow.applianceChain!.forward[0] = 'unknown-nva'
    const unknown = executePlatform({
      contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements,
    })
    expect(unknown.status).toBe('not assessed')
    expect(unknown.assessments[0].outcome).toBe('not assessed')
    withdrawHaPrimary(topology)
    topology.vpnConnections[1].enabled = false
    topology.vnets[0].appliances[1].advertisedPrefixes = []
    topology.vnets[0].appliances[1].advertisedRouteAttributes = []
    const stopped = assess(topology, 'standby')
    expect(stopped.errors).toEqual([])
    expect(stopped.assessments.map((entry) => entry.outcome))
      .toEqual(['violated', 'violated', 'satisfied'])
  })

  it('retains abstract NVA-origin delivery when no separate destination endpoint owns the prefix', () => {
    const topology = haRoutingTopology()
    topology.vnets[0].appliances[0].advertisedPrefixes!.push('198.18.80.0/24')
    const result = traceAzNetFlow(topology, simulateAzNet(topology),
      { kind: 'subnet', vnetId: 'application', subnetId: 'work' }, '198.18.80.10')
    expect(result).toMatchObject({ status: 'delivered', traversedApplianceIds: ['primary'] })
    expect(result.hops.at(-1)).toMatchObject({ nodeKind: 'appliance', nodeId: 'primary', action: 'delivered' })
  })
})
