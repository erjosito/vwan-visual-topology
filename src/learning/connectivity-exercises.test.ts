import { describe, expect, it } from 'vitest'
import { executePlatform } from '../platform/service'
import { connectivityExercises } from './connectivity-exercises'
import { emptyProgress, entryFor, outcomeFor, parseProgress } from './progress'
import { exercises } from './exercises'
import type { PlatformDocument } from '../platform/contract'

function evaluate(index: number, document: PlatformDocument) {
  return executePlatform({ contractVersion: 1, operation: 'evaluate', document, requirements: connectivityExercises[index].requirements })
}
function solution(index: number) {
  const document = structuredClone(connectivityExercises[index].starter)
  if (document.mode === 'vwan') throw new Error('Wrong fixture')
  const topology = document.topology, inventory = topology.inventory!
  if (index === 0) {
    inventory.publicIps.push({ id: 'instance', name: 'Instance public', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' })
    inventory.nics[0].ipConfigurations[0].publicIpId = 'instance'
  } else if (index === 1) {
    topology.udrTables[0].routes[0].nextHopType = 'Internet'
  } else if (index === 2) {
    inventory.networkSecurityGroups![0].rules = inventory.networkSecurityGroups![0].rules.filter((rule) => rule.id !== 'deny-probe')
  } else if (index === 3) {
    inventory.networkSecurityGroups![0].rules.push({ id: 'allow-client', name: 'AllowClient', priority: 100, direction: 'inbound', action: 'allow',
      protocol: 'tcp', sources: ['8.8.8.8/32'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['443'] })
  } else if (index === 4) {
    topology.udrTables.push({ id: 'reply', name: 'Original response owner', disableBgpRoutePropagation: false,
      routes: [{ id: 'client', name: 'Return client', prefix: '8.8.8.8/32', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] })
    topology.vnets[0].subnets[0].routeTableId = 'reply'
  } else {
    const lb = inventory.loadBalancers![0]
    lb.probes[0].health[0].status = 'healthy'
  }
  return document
}

describe('reviewed connectivity configuration lessons', () => {
  it('round-trips all course drafts while retaining older routing achievements', () => {
    const progress = emptyProgress()
    progress.entries = exercises.map((exercise) => entryFor(progress, exercise))
    progress.entries[0].achievement = { at: '2026-11-15T00:00:00Z', outcome: 'satisfied', engine: '2026.11.16.4',
      exerciseVersion: 1, revision: 'historical', hints: 1 }
    expect(parseProgress(JSON.stringify(progress))).toEqual(progress)
  })

  it.each([0, 1, 2, 3, 4, 5])('starts lesson %i unmet/unknown and accepts its supported repair without claiming runtime readiness', (index) => {
    const exercise = connectivityExercises[index]
    const before = JSON.stringify(exercise.starter)
    const starter = evaluate(index, exercise.starter)
    expect(starter.errors).toEqual([])
    expect(outcomeFor(exercise, starter)).not.toBe('satisfied')
    const repaired = evaluate(index, solution(index))
    expect(repaired.errors).toEqual([])
    expect(outcomeFor(exercise, repaired), JSON.stringify(repaired.assessments)).toBe('satisfied')
    expect(repaired.assessments.every((assessment) => assessment.reasons.join(' ').includes('not observed connectivity'))).toBe(true)
    expect(JSON.stringify(exercise.starter)).toBe(before)
    expect(exercise.title.ja).not.toBe(exercise.title.en)
  })

  it('does not pass private-egress practice by enabling legacy defaults or public-ingress practice by allowing every client', () => {
    const egress = structuredClone(connectivityExercises[0].starter)
    if (egress.mode === 'vwan') throw new Error('Wrong fixture')
    egress.topology.vnets[0].subnets[0].defaultOutboundAccess = true
    expect(outcomeFor(connectivityExercises[0], evaluate(0, egress))).not.toBe('satisfied')
    const ingress = solution(3)
    ingress.topology.inventory!.networkSecurityGroups![0].rules[0].sources = ['Internet']
    expect(outcomeFor(connectivityExercises[3], evaluate(3, ingress))).toBe('violated')
  })
})
