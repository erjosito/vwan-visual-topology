import { describe, it, expect } from 'vitest'
import { executePlatform } from '../src/platform/service'
import type { FlowRequirement } from '../src/platform/contract'
import type { Topology } from '../src/model'
import { createEmptyAzNetTopology } from '../src/azure-net/model'

function topology(): Topology {
  return {
    version: 1, name: 'Owned requirement endpoints',
    hubs: [{ id: 'a', name: 'A', region: 'swedencentral', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    spokes: [{ id: 's', name: 'S', hubId: 'a', prefixes: ['10.1.0.0/16'] }, { id: 't', name: 'T', hubId: 'a', prefixes: ['10.2.0.0/16'] }],
    sites: [], connections: [], siteLinks: [],
  }
}
const requirement: FlowRequirement = {
  id: 'connect', kind: 'flow', source: { kind: 'spoke', id: 's' }, target: { kind: 'spoke', id: 't' },
  sourceAddress: '10.1.0.4', destinationAddress: '10.2.0.4', expectation: 'allow',
}
function evaluate(input = topology(), requirements: unknown[] = [requirement]) {
  return executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'vwan', topology: input }, requirements })
}

describe('engine-backed explicit requirement assessment', () => {
  it('accepts different valid designs and detects forbidden reachability, without comparing reference IDs', () => {
    expect(evaluate().assessments[0].outcome).toBe('satisfied')
    const alternate = topology()
    alternate.hubs.push({ ...alternate.hubs[0], id: 'b', name: 'Different design' })
    alternate.spokes[1].hubId = 'b'
    expect(evaluate(alternate).assessments[0].outcome).toBe('satisfied')
    expect(evaluate(topology(), [{ ...requirement, expectation: 'deny' }]).assessments[0].outcome).toBe('violated')
  })
  it('never awards a pass for missing/ambiguous ownership or unknown imported table scope', () => {
    expect(evaluate(topology(), [{ ...requirement, destinationAddress: '10.99.0.4' }]).assessments[0].outcome).toBe('not assessed')
    const partial = topology()
    partial.spokes[0].hubRouting = { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] }
    expect(evaluate(partial).assessments[0].outcome).toBe('not assessed')
    const ambiguous = topology()
    ambiguous.spokes.push({ ...ambiguous.spokes[1], id: 'duplicate-owner' })
    expect(evaluate(ambiguous).assessments[0].outcome).toBe('not assessed')
  })
  it('requires explicit known route contexts for both presence and absence', () => {
    const route = { id: 'route', kind: 'route', table: 'a', prefix: '10.2.0.0/16', expectation: 'present' }
    expect(evaluate(topology(), [route]).assessments[0].outcome).toBe('satisfied')
    expect(evaluate(topology(), [{ ...route, table: 'missing', expectation: 'absent' }]).assessments[0].outcome).toBe('not assessed')
    expect(evaluate(topology(), [{ ...route, expectation: 'absent' }]).assessments[0].outcome).toBe('violated')
  })
  it('rejects duplicate assertions and unknown requirements instead of silently dropping user goals', () => {
    expect(evaluate(topology(), [requirement, requirement]).status).toBe('invalid')
    expect(evaluate(topology(), [{ ...requirement, minimumBandwidth: 1000 }]).status).toBe('invalid')
  })
  it('grades owned Azure-network flows and return paths, while unknown endpoint claims stay unassessed', () => {
    const network = createEmptyAzNetTopology()
    network.vnets.push({
      id: 'v', name: 'V', region: 'swedencentral', prefixes: ['10.1.0.0/16'], role: 'spoke',
      subnets: [{ id: 's', name: 'S', prefix: '10.1.1.0/24' }, { id: 't', name: 'T', prefix: '10.1.2.0/24' }],
      gateways: [], appliances: [],
    })
    const flow = {
      ...requirement, source: { kind: 'subnet', vnetId: 'v', subnetId: 's' }, target: { kind: 'subnet', vnetId: 'v', subnetId: 't' },
      sourceAddress: '10.1.1.4', destinationAddress: '10.1.2.4',
    }
    const run = (requirements: unknown[]) => executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'hub-spoke', topology: network }, requirements })
    expect(run([flow]).assessments[0].outcome).toBe('satisfied')
    expect(run([{ ...flow, target: { ...flow.target, subnetId: 'unknown' } }]).assessments[0].outcome).toBe('not assessed')
    expect(run([{ ...flow, expectation: 'deny' }]).assessments[0].outcome).toBe('violated')
  })
  it.each(['hub-spoke', 'full'])('does not grade a hub-scoped goal from a subnet table in %s', (mode) => {
    const network = createEmptyAzNetTopology()
    network.vnets.push({
      id: 'v', name: 'V', region: 'swedencentral', prefixes: ['10.1.0.0/16'], role: 'spoke',
      subnets: [{ id: 's', name: 'S', prefix: '10.1.1.0/24' }], gateways: [], appliances: [],
    })
    const route = { id: 'route', kind: 'route', table: 's', hubTableId: 'defaultRouteTable', prefix: '10.1.0.0/16', expectation: 'present' }
    const run = (goal: unknown) => executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode, topology: network }, requirements: [goal] })
    expect(run(route).assessments[0].outcome).toBe('not assessed')
    expect(run({ ...route, prefix: '10.99.0.0/16', expectation: 'absent' }).assessments[0].outcome).toBe('not assessed')
    const { hubTableId: _scope, ...subnetRoute } = route
    expect(run(subnetRoute).assessments[0].outcome).toBe('satisfied')
  })
  it('grades the owned mixed hub default RIB without inventing custom tables or missing-table absence', () => {
    const network = createEmptyAzNetTopology()
    network.vwanHubs.push({
      id: 'hub:original', name: 'Hub', region: 'swedencentral', preference: 'ASPath',
      routingIntent: { private: false, internet: false },
    })
    network.vnets.push({
      id: 'v', name: 'V', region: 'swedencentral', prefixes: ['10.1.0.0/16'], role: 'spoke',
      subnets: [{ id: 's', name: 'S', prefix: '10.1.1.0/24' }], gateways: [], appliances: [],
      vwanHubAttachment: { hubId: 'hub:original', enabled: true },
    })
    const original = JSON.stringify(network)
    const route = { id: 'route', kind: 'route', table: 'hub:original', hubTableId: 'defaultRouteTable', prefix: '10.1.0.0/16', expectation: 'present' }
    const run = (goal: unknown) => executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology: network }, requirements: [goal] })
    const result = run(route)
    expect(result.assessments[0]).toMatchObject({ outcome: 'satisfied', evidence: [{ nextHopId: 'v', prefix: '10.1.0.0/16', preferred: true }] })
    expect(result.document).toEqual({ mode: 'full', topology: network })
    expect(run({ ...route, prefix: '10.99.0.0/16', expectation: 'absent' }).assessments[0].outcome).toBe('satisfied')
    expect(run({ ...route, expectation: 'absent' }).assessments[0].outcome).toBe('violated')
    for (const scope of [{ hubTableId: 'custom' }, { table: 'missing' }]) {
      expect(run({ ...route, ...scope, expectation: 'absent' }).assessments[0].outcome).toBe('not assessed')
    }
    expect(run({ ...route, hubTableId: 'noneRouteTable', expectation: 'absent' }).assessments[0].outcome).toBe('satisfied')
    for (const field of ['routeTablesStatus', 'routeMapAssignments']) {
      const retained = structuredClone(network)
      Object.assign(retained.vwanHubs[0], { [field]: field === 'routeTablesStatus' ? 'unknown' : [] })
      const result = executePlatform({
        contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology: retained },
        requirements: [route, { ...route, id: 'absent', prefix: '10.99.0.0/16', expectation: 'absent' }],
      })
      expect(result.assessments.map((goal) => goal.outcome)).toEqual(field === 'routeTablesStatus'
        ? ['not assessed', 'not assessed'] : ['satisfied', 'satisfied'])
      expect(result.document).toEqual({ mode: 'full', topology: retained })
    }
    Object.assign(network.vnets[0].vwanHubAttachment!, {
      hubRouting: { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] },
    })
    expect(run(route).assessments[0].outcome).toBe('not assessed')
    delete (network.vnets[0].vwanHubAttachment as unknown as Record<string, unknown>).hubRouting
    expect(JSON.stringify(network)).toBe(original)
  })
  it('assesses an owned explicit mixed custom table without using the default RIB', () => {
    const topology = createEmptyAzNetTopology()
    topology.vwanHubs.push({
      id: 'hub', name: 'Hub', region: 'swedencentral', preference: 'ASPath',
      routingIntent: { private: false, internet: false },
      routeTables: [{ id: 'private', name: 'Private', labels: ['private'] }],
    })
    topology.vnets.push({
      id: 'v', name: 'V', region: 'swedencentral', prefixes: ['10.1.0.0/16'], role: 'spoke',
      subnets: [{ id: 's', name: 'S', prefix: '10.1.1.0/24' }], gateways: [], appliances: [],
      vwanHubAttachment: {
        hubId: 'hub', enabled: true,
        hubRouting: { status: 'configured', associatedTableId: 'private', propagatedTableIds: ['private'], labels: ['private'] },
      },
    })
    const result = executePlatform({
      contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
      requirements: ['private', 'defaultRouteTable'].map((hubTableId) => ({
        id: hubTableId, kind: 'route', table: 'hub', hubTableId, prefix: '10.1.0.0/16', expectation: 'present',
      })),
    })
    expect(result.assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied', 'violated'])
  })
})
