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
})
