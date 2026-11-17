import { describe, expect, it } from 'vitest'
import { executePlatform, validateRequest } from '../platform/service'
import { scenarioBundle } from './scenario-course'
import { validateCourse } from './course-validation'
import { scenarioTopologies } from './scenario-topologies'
import type { CourseCheck } from './course-contract'
import { hubFirewallTopology } from '../../tests/fixtures/hub-firewall'

const check = (id: string) => scenarioBundle.checks.find((entry) => entry.id === `${id}.repair-check`)! as Extract<CourseCheck, { kind: 'requirements.satisfied' }>
const document = (id: string) => ({ mode: 'full' as const, topology: structuredClone(scenarioTopologies[id]) })
const assess = (id: string, input = document(id)) => executePlatform({ contractVersion: 1, operation: 'evaluate', document: input, requirements: check(id).params.requirements })

function repaired(id: string) {
  const input = document(id), topology = input.topology
  if (id === 'private-link') topology.vnetPeerings.push({
    id: 'learner-link', name: 'Application to Partner', vnetAId: 'a', vnetBId: 'b', enabled: true,
    aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
  })
  if (id === 'inspection-bypass') {
    for (const [index, prefix] of ['10.22.0.0/16', '10.21.0.0/16'].entries()) {
      topology.udrTables[index].routes.push({ id: `learner-specific-${index}`, name: 'Partner inspection',
        prefix, nextHopType: 'VirtualAppliance', nextHopIp: '10.20.1.4', enabled: true })
    }
  }
  if (id === 'colocated-chain') topology.udrTables.find((table) => table.id === 'inspection-onward')!.routes[0].enabled = true
  if (id === 'dedicated-chain') topology.vnets.find((vnet) => vnet.id === 'transport')!.appliances[0].enableIpForwarding = true
  if (id === 'branch-advertisement') topology.udrTables[0].disableBgpRoutePropagation = false
  if (id === 'wan-isolation') topology.vnets.find((vnet) => vnet.id === 'b')!.vwanHubAttachment!.hubRouting!.propagatedTableIds = ['defaultRouteTable']
  if (id === 'tiered-incident') {
    topology.udrTables.find((table) => table.id === 'indirect-egress')!.routes[0].enabled = true
    topology.udrTables.find((table) => table.id === 'inspection-onward')!.routes[1].nextHopIp = '10.21.3.4'
  }
  return input
}

describe('scenario edition routing qualification', () => {
  it('validates every owned native scenario and all check/guidance scopes', () => {
    expect(validateCourse(scenarioBundle)).toEqual(scenarioBundle)
  })
  it.each(Object.keys(scenarioTopologies))('qualifies the starter, real repair and witness for %s', (id) => {
    const starter = assess(id)
    expect(starter.errors).toEqual([])
    expect(starter.status).toBe('complete')
    expect(starter.assessments[0].outcome).toBe('violated')
    expect(starter.assessments.slice(1).every((entry) => entry.outcome === 'satisfied')).toBe(id !== 'wan-isolation')
    const result = assess(id, repaired(id))
    expect(result.errors).toEqual([])
    expect(result.status).toBe('complete')
    expect(result.assessments.map((entry) => entry.outcome)).toEqual(check(id).params.requirements.map(() => 'satisfied'))
  })
  it('rejects delivered bypasses and the wrong order even when both appliances appear', () => {
    const input = repaired('colocated-chain')
    const requirements = structuredClone(check('colocated-chain').params.requirements)
    const chain = requirements[0]
    if (chain.kind !== 'flow') throw new Error('Flow required')
    chain.applianceChain!.forward.reverse()
    const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document: input, requirements })
    expect(result.assessments[0].outcome).toBe('violated')
    expect(result.assessments[0].evidence).toMatchObject({
      forward: { status: 'delivered', traversedApplianceIds: ['fw', 'sdwan'] },
      reverse: { status: 'delivered', traversedApplianceIds: ['sdwan', 'fw'] },
    })
    chain.applianceChain!.forward.reverse()
    chain.applianceChain!.reverse.reverse()
    expect(executePlatform({ contractVersion: 1, operation: 'evaluate', document: input, requirements }).assessments[0].outcome).toBe('violated')
  })
  it('preserves independent capstone faults and the pre-existing partner conversation', () => {
    const input = document('tiered-incident')
    input.topology.udrTables.find((table) => table.id === 'indirect-egress')!.routes[0].enabled = true
    const partial = assess('tiered-incident', input)
    expect(partial.assessments[0]).toMatchObject({ outcome: 'violated', evidence: { forward: { status: 'delivered' } } })
    expect(partial.assessments[1].outcome).toBe('satisfied')
    const returnOnly = document('tiered-incident')
    returnOnly.topology.udrTables.find((table) => table.id === 'inspection-onward')!.routes[1].nextHopIp = '10.21.3.4'
    expect(assess('tiered-incident', returnOnly).assessments[0].outcome).toBe('violated')
  })
  it('accepts a second supported gateway repair and refuses unknown chain owners', () => {
    const input = document('branch-advertisement')
    delete input.topology.vnets[0].subnets[0].routeTableId
    expect(assess('branch-advertisement', input).assessments.every((entry) => entry.outcome === 'satisfied')).toBe(true)
    const requirements = structuredClone(check('colocated-chain').params.requirements)
    const flow = requirements[0]
    if (flow.kind !== 'flow') throw new Error('Flow required')
    flow.applianceChain!.forward[0] = 'unowned'
    expect(executePlatform({ contractVersion: 1, operation: 'evaluate', document: repaired('colocated-chain'), requirements }).assessments[0].outcome).toBe('not assessed')
    flow.applianceChain!.forward = ['fw', 'fw']
    expect(() => validateRequest({ contractVersion: 1, operation: 'evaluate', document: repaired('colocated-chain'), requirements })).toThrow()
  })
  it('rejects malformed, deny and mixed-policy chains before evaluation', () => {
    const flow = check('colocated-chain').params.requirements[0]
    for (const patch of [
      { applianceChain: { forward: [], reverse: ['sdwan', 'fw'] } },
      { applianceChain: { forward: ['fw', 'sdwan'] } },
      { applianceChain: { forward: ['fw', 'sdwan'], reverse: ['fw', 'fw'] } },
      { expectation: 'deny' }, { requiredApplianceId: 'fw' }, { requiredFirewallHubId: 'wan' },
    ]) expect(() => validateRequest({ contractVersion: 1, operation: 'evaluate',
      document: repaired('colocated-chain'), requirements: [{ ...flow, ...patch }] })).toThrow()
    const unsupported = executePlatform({ contractVersion: 1, operation: 'evaluate',
      document: { mode: 'vwan', topology: hubFirewallTopology() },
      requirements: [{ ...flow, source: { kind: 'spoke', id: 'trusted-a' }, target: { kind: 'spoke', id: 'trusted-b' },
        sourceAddress: '10.10.0.4', destinationAddress: '10.20.0.4' }] })
    expect(unsupported.errors).toEqual([])
    expect(unsupported.status).toBe('not assessed')
    expect(unsupported.assessments).toHaveLength(1)
    expect(unsupported.assessments[0].outcome).toBe('not assessed')
  })
})
