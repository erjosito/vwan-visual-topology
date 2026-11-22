import { describe, expect, it } from 'vitest'
import { exampleCourse } from './course-examples'
import { guidanceAnchor, resolveGuidance } from './guidance'
import { selectPrimaryGuidance } from './task-guidance'
import type { CourseGuidance } from './course-contract'
import { scenarioBundle } from './scenario-course'
import { hybridLessonTopology } from './hybrid-scenario'
import { haLessonTopology } from './ha-scenario'

describe('semantic guidance admission', () => {
  it('reveals only the original peering without changing directional gateway settings', () => {
    const input = { mode: 'full' as const, topology: hybridLessonTopology() }
    const before = structuredClone(input)
    const peeringId = input.topology.vnetPeerings[0].id
    const cue: CourseGuidance = { id: 'peering-guide', action: 'peering.configure', params: { peeringId },
      instruction: { en: 'Inspect the original peering', ja: '元のピアリングを確認' } }
    expect(resolveGuidance(input, cue)).toEqual({ anchors: [guidanceAnchor('peering-editor', peeringId)] })
    expect(input).toEqual(before)
    expect(resolveGuidance(input, { ...cue, params: { peeringId: 'missing' } })).toEqual({ reason: 'entity' })
  })
  it('reveals the original Load Balancer health editor only in its owned VNet', () => {
    const input = { mode: 'full' as const, topology: haLessonTopology() }
    const before = structuredClone(input)
    const cue: CourseGuidance = { id: 'ha-health-guide', action: 'load-balancer.configure',
      params: { vnetId: 'hub', loadBalancerId: 'transit-lb' },
      instruction: { en: 'Edit declared health for the prepared NVAs', ja: '準備済み NVA の宣言された正常性を編集' } }
    expect(resolveGuidance(input, cue)).toEqual({ anchors: [guidanceAnchor('load-balancer-health', 'hub', 'transit-lb')] })
    expect(input).toEqual(before)
    expect(resolveGuidance(input, { ...cue, params: { ...cue.params, vnetId: 'application' } })).toEqual({ reason: 'entity' })
  })
  it('scopes gateway and aggregate MSEE navigation to their original owners without changing routing', () => {
    const input = { mode: 'full' as const, topology: hybridLessonTopology() }
    const before = structuredClone(input)
    const gateway: CourseGuidance = { id: 'gateway-guide', action: 'gateway-routes.open',
      params: { vnetId: 'hybrid-hub', gatewayId: 'primary-er', prefix: '172.28.0.0/16' },
      instruction: { en: 'Inspect the gateway routes', ja: 'ゲートウェイのルートを確認' } }
    const msee: CourseGuidance = { id: 'msee-guide', action: 'er-routes.open',
      params: { locationId: 'hybrid-location', prefix: '10.91.0.0/16' },
      instruction: { en: 'Inspect aggregate location routes', ja: '拠点の集約ルートを確認' } }
    expect(resolveGuidance(input, gateway)).toEqual({ anchors: [
      guidanceAnchor('gateway-effective-prefix', 'hybrid-hub', 'primary-er', '172.28.0.0/16'),
      guidanceAnchor('gateway-effective-table', 'hybrid-hub', 'primary-er'),
    ] })
    expect(resolveGuidance(input, msee)).toEqual({ anchors: [
      guidanceAnchor('er-effective-prefix', 'hybrid-location', '10.91.0.0/16'),
      guidanceAnchor('er-effective-table', 'hybrid-location'),
    ] })
    expect(input).toEqual(before)
    expect(resolveGuidance(input, { ...gateway, params: { ...gateway.params, vnetId: 'hybrid-app' } })).toEqual({ reason: 'entity' })
    expect(resolveGuidance(input, { ...msee, params: { ...msee.params, locationId: 'missing' } })).toEqual({ reason: 'entity' })
  })
  it('moves staged peering guidance to the next unfinished pair without editing or granting evidence', () => {
    const input = structuredClone(scenarioBundle.scenarios.find((scenario) => scenario.id === 'inspection-bypass')!.document)
    if (input.mode === 'vwan') throw new Error('Mixed topology required')
    const check = scenarioBundle.checks.find((entry) => entry.id === 'inspection-bypass.connect-check')!
    const cues = ['a', 'b'].map((side) => scenarioBundle.guidance.find((cue) => cue.id === `inspection-bypass.peer-${side}`)!)
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[0])
    const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
    input.topology.vnetPeerings.push({ id: 'learner', name: 'Learner', vnetAId: 'hub', vnetBId: 'a', enabled: true, aToB: { ...flags }, bToA: { ...flags } })
    const before = structuredClone(input)
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[1])
    expect(input).toEqual(before)
    input.topology.vnetPeerings.at(-1)!.bToA.allowVirtualNetworkAccess = false
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[0])
  })
  it('moves staged UDR guidance only for an enabled matching rule on the actual subnet table', () => {
    const input = structuredClone(scenarioBundle.scenarios.find((scenario) => scenario.id === 'inspection-bypass')!.document)
    if (input.mode === 'vwan') throw new Error('Mixed topology required')
    const check = scenarioBundle.checks.find((entry) => entry.id === 'inspection-bypass.summary-check')!
    const cues = ['a', 'b'].map((side) => scenarioBundle.guidance.find((cue) => cue.id === `inspection-bypass.table-${side}-work`)!)
    const rule = { id: 'learner', name: 'Learner', enabled: false, prefix: '10.0.0.0/8', nextHopType: 'VirtualAppliance' as const, nextHopIp: '10.20.1.4' }
    input.topology.udrTables[0].routes.push(rule)
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[0])
    rule.enabled = true
    const before = structuredClone(input)
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[1])
    expect(input).toEqual(before)
    input.topology.vnets[0].subnets[0].routeTableId = 'unrelated'
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[0])
  })
  it('retains authored guidance order for outcome-based repairs instead of choosing a solution', () => {
    const input = scenarioBundle.scenarios.find((scenario) => scenario.id === 'tiered-incident')!.document
    const check = scenarioBundle.checks.find((entry) => entry.id === 'tiered-incident.repair-check')!
    const cues = scenarioBundle.guidance.filter((cue) => cue.id.startsWith('tiered-incident.table-'))
    expect(selectPrimaryGuidance(input, check, cues)).toBe(cues[0])
    expect(selectPrimaryGuidance(input, check, [])).toBeUndefined()
  })
  it('scopes every hub prefix candidate before its exact table, and rejects missing or uncaptured tables', () => {
    const input = structuredClone(exampleCourse.scenarios.find((scenario) => scenario.id === 'secured-wan')!.document)
    if (input.mode === 'vwan') throw new Error('Mixed topology required')
    const cue: CourseGuidance = { id: 'exact-hub', action: 'hub-routes.open',
      params: { hubId: 'wan', tableId: 'defaultRouteTable', prefix: '10.2.0.0/16' },
      instruction: { en: 'Inspect', ja: '確認' } }
    const before = structuredClone(input)
    expect(resolveGuidance(input, cue)).toEqual({ anchors: [
      guidanceAnchor('hub-effective-prefix', 'wan', 'defaultRouteTable', '10.2.0.0/16'),
      guidanceAnchor('hub-effective-table', 'wan', 'defaultRouteTable'),
    ] })
    expect(input).toEqual(before)
    expect(resolveGuidance(input, { ...cue, params: { ...cue.params, tableId: 'missing' } })).toEqual({ reason: 'entity' })
    input.topology.vwanHubs[0].routeTablesStatus = 'unknown'
    expect(resolveGuidance(input, cue)).toEqual({ reason: 'capture' })
    input.topology.vwanHubs = []
    expect(resolveGuidance(input, cue)).toEqual({ reason: 'entity' })
  })
  it('reveals original hybrid connections and branch routes without editing them, and rejects missing owners', () => {
    const input = structuredClone(scenarioBundle.scenarios.find((scenario) => scenario.id === 'hybrid-preference')!.document)
    const before = structuredClone(input)
    const cues = scenarioBundle.guidance.filter((cue) => cue.id.startsWith('hybrid-preference.'))
    for (const cue of cues) expect(resolveGuidance(input, cue).anchors?.length, cue.id).toBeGreaterThan(0)
    expect(input).toEqual(before)
    if (input.mode === 'vwan') throw new Error('Mixed topology required')
    input.topology.vpnConnections = []
    expect(resolveGuidance(input, cues.find((cue) => cue.id.endsWith('.vpn-guide'))!)).toEqual({ reason: 'entity' })
    input.topology.sites = []
    expect(resolveGuidance(input, cues.find((cue) => cue.id.endsWith('.return-guide'))!)).toEqual({ reason: 'entity' })
  })
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
