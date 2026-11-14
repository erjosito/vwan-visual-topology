import { describe, it, expect } from 'vitest'
import { executePlatform } from '../platform/service'
import { engineVersion } from '../platform/contract'
import type { PlatformDocument } from '../platform/contract'
import type { AzNetTopology } from '../azure-net/model'
import { exercises } from './exercises'
import { emptyProgress, entryFor, outcomeFor, parseProgress, recordAttempt } from './progress'

function peering(topology: AzNetTopology, a = 'a', b = 'b') {
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings.push({ id: `peer-${a}-${b}`, name: 'Practice peering', vnetAId: a, vnetBId: b, enabled: true, aToB: flags, bToA: { ...flags } })
}
function solution(index: number, alternate = false): PlatformDocument {
  const document = structuredClone(exercises[index].starter)
  if (document.mode === 'vwan') {
    if (alternate) {
      document.topology.hubs[1].routeTables![0].labels = ['default']
      document.topology.spokes[1].hubRouting = {
        status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['defaultRouteTable'], labels: ['default'],
      }
    } else {
      document.topology.spokes[1].hubId = 'one'
      delete document.topology.spokes[1].hubRouting
    }
  } else if (document.mode === 'full' && !alternate) {
    document.topology.vnets[1].vwanHubAttachment = { hubId: 'hub', enabled: true }
  } else if (!alternate || document.mode === 'full') {
    peering(document.topology)
  } else {
    const topology = document.topology
    topology.vnets.push({
      id: 'transit', name: 'Transit NVA', region: 'swedencentral', role: 'hub', prefixes: ['10.3.0.0/16'],
      subnets: [{ id: 'nva-subnet', name: 'NVA', prefix: '10.3.1.0/24' }], gateways: [],
      appliances: [{ id: 'nva', name: 'Forwarder', kind: 'nva-vm', subnetId: 'nva-subnet', privateIp: '10.3.1.4', enableIpForwarding: true, staticRoutes: [] }],
    })
    peering(topology, 'a', 'transit'); peering(topology, 'b', 'transit')
    topology.udrTables.push({ id: 'via-nva', name: 'Via transit', disableBgpRoutePropagation: false, routes: [
      { id: 'to-a', name: 'To A', prefix: '10.1.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.3.1.4', enabled: true },
      { id: 'to-b', name: 'To B', prefix: '10.2.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.3.1.4', enabled: true },
    ] })
    topology.vnets[0].subnets[0].routeTableId = 'via-nva'
    topology.vnets[1].subnets[0].routeTableId = 'via-nva'
  }
  return document
}
const evaluate = (index: number, document: PlatformDocument) => executePlatform({
  contractVersion: 1, operation: 'evaluate', document, requirements: exercises[index].requirements,
})

describe('reviewed local practice rubrics', () => {
  it.each([0, 1, 2])('starts exercise %i unmet and accepts materially different forwarding solutions', (index) => {
    const starter = evaluate(index, exercises[index].starter)
    expect(starter.errors).toEqual([])
    expect(outcomeFor(exercises[index], starter)).toBe(index === 0 ? 'not assessed' : 'violated')
    for (const alternate of [false, true]) {
      const result = evaluate(index, solution(index, alternate))
      expect(result.errors).toEqual([])
      expect(outcomeFor(exercises[index], result)).toBe('satisfied')
    }
  })
  it('does not award a pass for ambiguous endpoints, invalid input, missing/duplicate assertions or incomplete jobs', () => {
    const document = solution(1)
    if (document.mode === 'vwan') throw new Error('Wrong fixture')
    document.topology.vnets.push({ ...structuredClone(document.topology.vnets[1]), id: 'duplicate-owner' })
    expect(outcomeFor(exercises[1], evaluate(1, document))).toBe('not assessed')
    const result = evaluate(1, solution(1))
    for (const change of [
      { status: 'not assessed' as const }, { status: 'invalid' as const }, { assessments: [] },
      { assessments: [...result.assessments, ...result.assessments] }, { engineVersion: 'older' },
      { assessments: [{ ...result.assessments[0], id: 'different-goal' }] },
    ]) expect(outcomeFor(exercises[1], { ...result, ...change })).toBe('not assessed')
    expect(outcomeFor(exercises[1], evaluate(1, { mode: 'hub-spoke', topology: {} as AzNetTopology }))).toBe('not assessed')
  })
  it('pins attempt history to the rubric/grader and records assistance without claiming certification', () => {
    const exercise = exercises[1], document = solution(1), draft = JSON.stringify(document.topology)
    let progress = emptyProgress()
    progress.entries.push({ ...entryFor(progress, exercise), hints: 1 })
    for (let index = 0; index < 25; index++) progress = recordAttempt(progress, exercise, evaluate(1, document), draft)
    const restored = parseProgress(JSON.stringify(progress))
    expect(restored.entries[0].draft).toBe(draft)
    expect(restored.entries[0].attempts).toHaveLength(20)
    expect(restored.entries[0].attempts[0]).toMatchObject({ outcome: 'satisfied', engine: engineVersion, exerciseVersion: exercise.version, hints: 1 })
    for (let index = 0; index < 25; index++) progress = recordAttempt(progress, exercise, evaluate(1, exercise.starter), draft)
    expect(progress.entries[0].attempts.every((attempt) => attempt.outcome === 'violated')).toBe(true)
    expect(parseProgress(JSON.stringify(progress)).entries[0].achievement?.outcome).toBe('satisfied')
  })
  it('rejects damaged, unknown, duplicate or oversized local progress instead of treating it as authoritative', () => {
    const entry = entryFor(emptyProgress(), exercises[0])
    for (const raw of ['not json', '{"version":2,"entries":[]}', JSON.stringify({ version: 1, entries: [entry, entry] }),
      JSON.stringify({ version: 1, entries: [{ ...entry, id: 'unknown' }] }),
      JSON.stringify({ version: 1, entries: [{ ...entry, draft: 'x'.repeat(200_001) }] })]) {
      expect(() => parseProgress(raw)).toThrow()
    }
  })
})
