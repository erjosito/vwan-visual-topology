import { describe, expect, it } from 'vitest'
import { exampleCourse } from './course-examples'
import { guidanceAnchor, resolveGuidance } from './guidance'
import type { CourseGuidance } from './course-contract'
import { scenarioBundle } from './scenario-course'

describe('semantic guidance admission', () => {
  it('scopes packet guidance to an owned VNet without applying a probe or modifying topology', () => {
    const input = structuredClone(scenarioBundle.scenarios.find((scenario) => scenario.id === 'ha-return-path')!.document)
    const before = structuredClone(input)
    const cue = scenarioBundle.guidance.find((cue) => cue.id === 'ha-return-path.packet')!
    expect(resolveGuidance(input, cue)).toEqual({ anchors: [guidanceAnchor('packet-probe', 'hub')] })
    expect(input).toEqual(before)
    if (input.mode === 'vwan') throw new Error('Mixed topology required')
    input.topology.vnets = input.topology.vnets.filter((vnet) => vnet.id !== 'hub')
    expect(resolveGuidance(input, cue)).toEqual({ reason: 'entity' })
  })
  const document = () => structuredClone(exampleCourse.scenarios[1].document)
  const cue = (id: string) => exampleCourse.guidance.find((item) => item.id === id)!
  it('resolves owned hub scopes, VNet configuration and empty associated UDR tables without mutation', () => {
    for (const id of ['branch-advertisement', 'wan-isolation']) {
      const input = structuredClone(scenarioBundle.scenarios.find((scenario) => scenario.id === id)!.document)
      const before = structuredClone(input)
      for (const cue of scenarioBundle.guidance.filter((cue) => cue.id.startsWith(`${id}.`))) {
        expect(resolveGuidance(input, cue).anchors?.length, cue.id).toBeGreaterThan(0)
      }
      expect(input).toEqual(before)
      const hubCue = scenarioBundle.guidance.find((cue) => cue.id === 'wan-isolation.hub')!
      if (id === 'wan-isolation' && input.mode !== 'vwan') {
        input.topology.vwanHubs[0].id = 'another-hub'
        expect(resolveGuidance(input, hubCue)).toEqual({ reason: 'entity' })
      }
    }
  })
  it('resolves exact subnet/prefix and nested directional peering identities without mutation', () => {
    const topology = structuredClone(exampleCourse.scenarios[0].document)
    const original = structuredClone(topology)
    expect(resolveGuidance(topology, cue('routes-a'))).toEqual({ anchors: [
      guidanceAnchor('effective-prefix', 'a', 'work-a', '10.2.0.0/16'), guidanceAnchor('effective-table', 'a', 'work-a'),
    ] })
    expect(resolveGuidance(topology, cue('peer-command'))).toEqual({ anchors: [
      guidanceAnchor('peer-target', 'a', 'b'), guidanceAnchor('peer-menu', 'a'),
    ] })
    expect(topology).toEqual(original)
  })
  it('requires the named subnet association and route, not a similarly named table', () => {
    const topology = document()
    if (topology.mode === 'vwan') throw new Error('Wrong fixture')
    expect(resolveGuidance(topology, cue('repair-drop'))).toEqual({ anchors: [guidanceAnchor('udr-route', 'a', 'work-a', 'blocking', 'drop-b')] })
    topology.topology.vnets[0].subnets[0].routeTableId = 'other'
    expect(resolveGuidance(topology, cue('repair-drop'))).toEqual({ reason: 'association' })
    topology.topology.vnets[0].subnets[0].routeTableId = 'blocking'
    topology.topology.udrTables[0].routes = []
    expect(resolveGuidance(topology, cue('repair-drop'))).toEqual({ reason: 'entity' })
  })
  it('reports absent objects, foreign providers and disabled create commands without claiming success', () => {
    const topology = document()
    expect(resolveGuidance(topology, cue('peer-command'))).toEqual({ reason: 'peered' })
    if (topology.mode === 'vwan') throw new Error('Wrong fixture')
    topology.topology.vnets[0].subnets = []
    expect(resolveGuidance(topology, cue('routes-a'))).toEqual({ reason: 'entity' })
    const foreign = { mode: 'vwan', topology: {} } as unknown as Parameters<typeof resolveGuidance>[0]
    expect(resolveGuidance(foreign, cue('routes-a'))).toEqual({ reason: 'provider' })
    const wrongEntity: CourseGuidance = { ...cue('routes-a'), action: 'routes.open', params: { vnetId: 'b', subnetId: 'work-a', prefix: '10.2.0.0/16' } }
    expect(resolveGuidance(topology, wrongEntity)).toEqual({ reason: 'entity' })
  })
})
