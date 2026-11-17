import { describe, expect, it } from 'vitest'
import { executePlatform } from '../platform/service'
import { exampleCourse } from './course-examples'
import { validateCourse } from './course-validation'

function document(id: string) {
  const result = structuredClone(exampleCourse.scenarios.find((item) => item.id === id)!.document)
  if (result.mode === 'vwan') throw new Error('Mixed provider required')
  return result
}

function assess(input: ReturnType<typeof document>, id: string) {
  const check = exampleCourse.checks.find((item) => item.id === id)!
  if (check.kind !== 'requirements.satisfied') throw new Error('Engine check required')
  return executePlatform({ contractVersion: 1, operation: 'evaluate', document: input, requirements: check.params.requirements })
}

function outcomes(input: ReturnType<typeof document>, id: string) {
  const result = assess(input, id)
  expect(result.status).toBe('complete')
  expect(result.errors).toEqual([])
  return result.assessments.map((item) => item.outcome)
}

describe('secured WAN and hybrid transfer content', () => {
  it('requires both-direction inspection, not just delivered traffic or a route in a table', () => {
    expect(validateCourse(exampleCourse)).toEqual(exampleCourse)
    const input = document('secured-wan')
    expect(outcomes(input, 'wan-evidence')).toEqual(['satisfied', 'violated'])
    input.topology.udrTables[0].routes[0].enabled = false
    expect(outcomes(input, 'wan-evidence')).toEqual(['satisfied', 'satisfied'])
    input.topology.vwanHubs[0].routingIntent.private = false
    expect(outcomes(input, 'secured-workload-path')).toEqual(['violated'])
    expect(assess(input, 'secured-workload-path').assessments[0].evidence).toMatchObject({
      forward: { status: 'delivered', traversedApplianceIds: [] },
      reverse: { status: 'delivered', traversedApplianceIds: [] },
    })
  })

  it('keeps inspection with active intent and rejects a delivered peering bypass when intent is disabled', () => {
    const input = document('secured-wan')
    input.topology.udrTables[0].routes[0].enabled = false
    const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
    input.topology.vnetPeerings.push({
      id: 'shortcut', name: 'Shortcut', vnetAId: 'a', vnetBId: 'b', enabled: true, aToB: flags, bToA: { ...flags },
    })
    expect(outcomes(input, 'secured-workload-path')).toEqual(['satisfied'])
    input.topology.vwanHubs[0].routingIntent.private = false
    expect(outcomes(input, 'secured-workload-path')).toEqual(['violated'])
    expect(assess(input, 'secured-workload-path').assessments[0].evidence).toMatchObject({
      forward: { status: 'delivered', traversedApplianceIds: [] },
      reverse: { status: 'delivered', traversedApplianceIds: [] },
    })
  })

  it('localizes independent forward/return faults and requires both repairs to survive together', () => {
    const input = document('hybrid-incident')
    expect(outcomes(input, 'hybrid-complete')).toEqual(['satisfied', 'violated', 'violated'])
    const before = assess(input, 'hybrid-complete').assessments
    expect(before[1].evidence).toMatchObject({ forward: { status: 'dropped-blackhole' }, reverse: { status: 'delivered' } })
    expect(before[2].evidence).toMatchObject({ forward: { status: 'delivered' }, reverse: { status: 'dropped-blackhole' } })
    const branch = input.topology.udrTables.find((table) => table.id === 'branch-policy')!.routes[0]
    branch.enabled = false
    expect(outcomes(input, 'hybrid-complete')).toEqual(['satisfied', 'satisfied', 'violated'])
    input.topology.udrTables.find((table) => table.id === 'return-policy')!.routes[0].enabled = false
    expect(outcomes(input, 'hybrid-complete')).toEqual(['satisfied', 'satisfied', 'satisfied'])
    for (const assessment of assess(input, 'hybrid-complete').assessments.slice(1)) {
      const trace = { status: 'delivered', traversedApplianceIds: ['vhub-fw:wan'],
        traversedEdgeIds: expect.arrayContaining(['gateway-transit', 'classic-er', 'wan-er']) }
      expect(assessment.evidence).toMatchObject({ forward: trace, reverse: trace })
    }
    branch.enabled = true
    expect(outcomes(input, 'hybrid-complete')).toEqual(['satisfied', 'violated', 'satisfied'])
  })

  it.each(['secured-wan', 'hybrid-incident'])('accepts supported alternatives for %s without relaxing the inspected path', (id) => {
    for (const repair of ['disable-routes', 'remove-associations']) {
      const input = document(id)
      if (repair === 'disable-routes') {
        for (const table of input.topology.udrTables) for (const route of table.routes) route.enabled = false
      } else {
        for (const vnet of input.topology.vnets) for (const subnet of vnet.subnets) delete subnet.routeTableId
      }
      expect(outcomes(input, id === 'secured-wan' ? 'wan-evidence' : 'hybrid-complete').every((item) => item === 'satisfied')).toBe(true)
    }
  })

  it('refuses unknown hub capture coverage rather than admitting it as a valid mandatory checkpoint', () => {
    const bundle = structuredClone(exampleCourse)
    const scenario = bundle.scenarios.find((item) => item.id === 'secured-wan')!
    if (scenario.document.mode === 'vwan') throw new Error('Mixed provider required')
    scenario.document.topology.vwanHubs[0].routeTablesStatus = 'unknown'
    expect(assess(scenario.document, 'wan-evidence').status).toBe('not assessed')
    expect(() => validateCourse(bundle)).toThrow()
  })
})
