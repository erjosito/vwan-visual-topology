import { describe, expect, it } from 'vitest'
import { executePlatform } from '../platform/service'
import type { AzNetTopology, AzVnetPeering } from '../azure-net/model'
import { lookupSubnetEffectiveRoute, simulateAzNet } from '../azure-net/engine'
import { applyAzRoutingIntentEdit } from '../azure-net/routing-intent'
import { curriculumV2Bundle } from './curriculum-v2'
import { curriculumV2Assessments } from './curriculum-v2-profile'
import { curriculumV2Stages } from './curriculum-v2-stages'
import { validateCourse } from './course-validation'
import { matchesConfiguration } from './configuration-check'
import { createCourseRunner, orderedTasks, type LearningWorkspace } from './runner'
import {
  curriculumV2LessonIds, curriculumV2Topologies, curriculumV2Requirements,
  curriculumV2HaRequirements, curriculumV2Packet, type CurriculumV2LessonId,
} from './curriculum-v2-topologies'

/** Reference recipes are test fixtures, not runtime course mutations. Native journeys must execute the corresponding controls. */
export type CurriculumV2Repair = { task: string; apply: (topology: AzNetTopology) => void }
const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
const peer = (a: string, b: string): AzVnetPeering => ({
  id: `peer-${a}-${b}`, name: `${a} — ${b}`, vnetAId: a, vnetBId: b, enabled: true,
  scope: { type: 'whole-vnet' }, aToB: { ...flags }, bToA: { ...flags },
})
const toggleLink = (id: string, enabled: boolean, task: string): CurriculumV2Repair => ({
  task, apply: (t) => { t.erLinks.find((l) => l.id === id)!.enabled = enabled },
})
const vpnState = (state: Record<string, unknown>, task: string): CurriculumV2Repair => ({
  task, apply: (t) => { Object.assign(t.vpnConnections[0], structuredClone(state)) },
})
const policy = (table: string, route: string, task: string): CurriculumV2Repair => ({
  task, apply: (t) => { t.udrTables.find((u) => u.id === table)!.routes.find((r) => r.id === route)!.enabled = true },
})
const attach = (id: string, task: string): CurriculumV2Repair => ({
  task, apply: (t) => { t.vnets.find((v) => v.id === id)!.vwanHubAttachment!.enabled = true },
})
const publish = (id: string, property: 'labels' | 'propagatedTableIds', values: string[], task: string): CurriculumV2Repair => ({
  task, apply: (t) => { t.vnets.find((v) => v.id === id)!.vwanHubAttachment!.hubRouting![property] = [...values] },
})
export const curriculumV2Repairs: Record<CurriculumV2LessonId, CurriculumV2Repair[]> = {
  'v2-peering': [{ task: 'connect', apply: (t) => { t.vnetPeerings.push(peer('app', 'partner')) } }],
  'v2-firewall': [
    { task: 'connect-hub', apply: (t) => { t.vnetPeerings.push(peer('app', 'hub')) } },
    policy('app-policy', 'private-summary', 'summary'), policy('app-policy', 'partner-inspection', 'forward'),
    policy('partner-policy', 'application-return', 'return'),
  ],
  'v2-wan': [attach('app', 'attach-application'), attach('shared', 'checkpoint')],
  'v2-secured-wan': [{ task: 'private-intent', apply: (t) => {
    const before = structuredClone(t)
    t.vwanHubs[0].routingIntent.private = true
    applyAzRoutingIntentEdit(before, t)
  } }, attach('shared', 'attach-service')],
  'v2-static-vpn': [
    vpnState({ staticPrefixes: ['172.22.0.0/24'], bgpEnabled: false }, 'prefix'),
    vpnState({ enabled: true, bgpEnabled: false }, 'enable'),
    { task: 'share-gateway', apply: (t) => { t.vnetPeerings[0].bToA.useRemoteGateways = true } },
  ],
  'v2-bgp': [vpnState({ enabled: true, bgpEnabled: true }, 'enable-bgp'),
    { task: 'propagate', apply: (t) => { t.udrTables[0].disableBgpRoutePropagation = false } }],
  'v2-expressroute': [toggleLink('warehouse-er-a', true, 'attach-warehouse'), toggleLink('azure-er-a', true, 'attach-azure')],
  'v2-er-locations': [toggleLink('warehouse-er-b', true, 'attach-location-b'), toggleLink('warehouse-er-a', false, 'withdraw-warehouse-a'),
    toggleLink('azure-er-a', false, 'withdraw-azure-a')],
  'v2-vpn-backup': [vpnState({ enabled: true, bgpEnabled: true }, 'enable-backup'), toggleLink('warehouse-er-a', false, 'withdraw-er')],
  'v2-nva-ha': [
    { task: 'repair-return', apply: (t) => { t.udrTables[1].routes[0].nextHopIp = '10.80.3.10' } },
    { task: 'standby-snapshot', apply: (t) => { const health = t.inventory!.loadBalancers![0].probes[0].health!
      health[0].status = 'unhealthy'; health[1].status = 'healthy' } },
  ],
  'v2-segmentation': [publish('west-local', 'propagatedTableIds', ['local-services', 'workloads'], 'publish-local'),
    { task: 'regional-label', apply: (t) => { t.vwanHubs[0].routeTables![0].labels = ['shared'] } }],
  'v2-handover': [publish('east-service', 'labels', ['shared'], 'repair-forward'), publish('west-app', 'labels', ['shared'], 'repair-reply')],
}
export function curriculumV2Reference(id: CurriculumV2LessonId, throughTask?: string): AzNetTopology {
  if (throughTask && !curriculumV2Repairs[id].some((repair) => repair.task === throughTask)) throw new Error(`Unknown reference repair ${id}.${throughTask}`)
  const topology = structuredClone(curriculumV2Topologies[id])
  for (const repair of curriculumV2Repairs[id]) {
    repair.apply(topology)
    if (repair.task === throughTask) break
  }
  return topology
}

describe('curriculum v2 native routing references', () => {
  it('requires a fresh exact C04 inspection before evaluating the already-working private paths', async () => {
    const taskId = 'v2-secured-wan.verify-original', tasks = orderedTasks(curriculumV2Bundle)
    const position = tasks.findIndex(({ task }) => task.id === taskId)
    const topology = curriculumV2Reference('v2-secured-wan', 'private-intent')
    const workspace: LearningWorkspace = { revision: 1, scope: 1, practice: { version: 1, active: true,
      returnProvider: 'azure-net', courseId: curriculumV2Bundle.course.id, scenarioId: 'v2-secured-wan',
      document: { mode: 'full', topology } } }
    const runner = createCourseRunner(curriculumV2Bundle, { workspace: () => workspace, changed: () => {},
      completions: tasks.slice(0, position).map(({ lesson, task }, revision) => ({
        courseId: curriculumV2Bundle.course.id, contentVersion: 1, lessonId: lesson.id, taskId: task.id,
        assessmentVersion: task.assessmentVersion, checkId: task.checkId, awardId: task.awardId, points: task.points,
        title: task.title, sessionId: 'prior-v2-steps', revision, scope: 1, engineVersion: '2026.11.20.1',
        completedAt: '2026-11-22T18:00:00.000Z',
      })), evaluate: async (request) => executePlatform(request) })
    expect(runner.getSnapshot().taskId).toBe(taskId)
    await runner.assess()
    expect(runner.getSnapshot().feedback).toBe('inspect')
    expect(runner.getSnapshot().completions).toHaveLength(position)
    const stale = runner.getSnapshot().observation!
    workspace.revision++
    runner.workspaceChanged()
    runner.observe(stale)
    runner.observe({ ...runner.getSnapshot().observation!, prefix: '10.24.0.0/16' })
    await runner.assess()
    expect(runner.getSnapshot().feedback).toBe('inspect')
    topology.vwanHubs[0].routingIntent.private = false
    workspace.revision++
    runner.workspaceChanged()
    runner.observe(runner.getSnapshot().observation!)
    await runner.assess()
    expect(runner.getSnapshot().feedback).toBe('requirements')
    topology.vwanHubs[0].routingIntent.private = true
    workspace.revision++
    runner.workspaceChanged()
    await runner.assess()
    expect(runner.getSnapshot().feedback).toBe('inspect')
    runner.observe(runner.getSnapshot().observation!)
    await runner.assess()
    expect(runner.getSnapshot().feedback).toBe('passed')
    expect(runner.advance()).toBe(true)
    expect(runner.getSnapshot().completions.at(-1)?.taskId).toBe(taskId)
  })
  it('publishes 72 substantive bilingual tasks, twelve checkpoints and isolated new awards', () => {
    const bundle = validateCourse(curriculumV2Bundle)
    expect(bundle.course.preparation).toBe('ungraded')
    expect(bundle.lessons.map((lesson) => lesson.id)).toEqual([...curriculumV2LessonIds])
    const tasks = bundle.lessons.flatMap((lesson) => lesson.tasks)
    expect(tasks).toHaveLength(72)
    expect(bundle.checks.some((check) => check.kind === 'scenario.loaded')).toBe(false)
    expect(new Set(tasks.map((t) => t.awardId)).size).toBe(72)
    let xp = 0
    for (const [index, lesson] of bundle.lessons.entries()) {
      const checkpoint = lesson.tasks.at(-1)!
      expect(curriculumV2Assessments[index]).toEqual({ taskId: checkpoint.id, checkId: checkpoint.checkId, assessmentVersion: checkpoint.assessmentVersion })
      expect(curriculumV2Stages[index].lessonIds).toEqual([lesson.id])
      expect(curriculumV2Stages[index].beltId).toBe(bundle.course.belts[index + 1].id)
      xp += lesson.tasks.reduce((sum, t) => sum + t.points, 0)
      expect(bundle.course.belts[index + 1].pointsRequired).toBe(xp)
      for (const t of lesson.tasks) {
        expect(t.points).toBeGreaterThan(0)
        expect(t.debrief?.paragraphs[0].en.length).toBeGreaterThan(40)
        expect(t.debrief?.paragraphs[0].ja.length).toBeGreaterThan(20)
      }
    }
  })
  it.each(curriculumV2LessonIds)('qualifies every staged native check, rejecting the preceding wrong state in %s', (id) => {
    const lesson = curriculumV2Bundle.lessons.find((l) => l.id === id)!
    const topology = structuredClone(curriculumV2Topologies[id])
    for (const task of lesson.tasks) {
      const check = curriculumV2Bundle.checks.find((c) => c.id === task.checkId)!
      const repair = curriculumV2Repairs[id].find((r) => `${id}.${r.task}` === task.id)
      if (repair) {
        if (check.kind === 'topology.configured') expect(matchesConfiguration(topology, check.params.expected), task.id).toBe(false)
        repair.apply(topology)
      }
      if (check.kind === 'topology.configured') expect(matchesConfiguration(topology, check.params.expected), task.id).toBe(true)
      if ('selectedRoutes' in check.params && check.params.selectedRoutes) {
        const simulation = simulateAzNet(topology)
        for (const scope of check.params.selectedRoutes) expect(lookupSubnetEffectiveRoute(simulation.subnetTables[scope.subnetId],
          scope.destinationAddress ?? scope.prefix.split('/')[0]), task.id).toMatchObject({
          prefix: scope.prefix, nextHopResourceId: scope.nextHopResourceId,
        })
      }
      if ('requirements' in check.params && check.params.requirements) {
        const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: check.params.requirements })
        expect(result.errors, task.id).toEqual([])
        expect(result.assessments.map((a) => [a.id, a.outcome]), task.id).toEqual(check.params.requirements.map((r) => [r.id, 'satisfied']))
      }
    }
  })
  it.each(curriculumV2LessonIds)('admits starter and qualifies original repaired conversations for %s', (id) => {
    const evaluate = (topology = curriculumV2Topologies[id]) => executePlatform({
      contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: curriculumV2Requirements[id],
    })
    const starter = evaluate()
    expect(starter.errors).toEqual([])
    expect(starter.status).toBe('complete')
    expect(starter.assessments.every((a) => a.outcome !== 'not assessed')).toBe(true)
    if (!['v2-er-locations', 'v2-vpn-backup'].includes(id)) expect(starter.assessments.some((a) => a.outcome === 'violated')).toBe(true)
    const repaired = evaluate(curriculumV2Reference(id))
    expect(repaired.errors).toEqual([])
    expect(repaired.assessments.map((a) => [a.id, a.outcome])).toEqual(
      curriculumV2Requirements[id].map((r) => [r.id, 'satisfied']),
    )
  })
  it('qualifies the primary HA state before changing health', () => {
    const primary = curriculumV2Reference('v2-nva-ha', 'repair-return'), standby = curriculumV2Reference('v2-nva-ha')
    expect(standby.udrTables).toEqual(primary.udrTables)
    const result = executePlatform({ contractVersion: 1, operation: 'evaluate',
      document: { mode: 'full', topology: primary }, requirements: curriculumV2HaRequirements('primary') })
    expect(result.assessments.map((a) => [a.id, a.outcome])).toEqual(curriculumV2HaRequirements('primary').map((r) => [r.id, 'satisfied']))
  })
  it('grounds the sole prefix lesson and subsequent equal-prefix transport lesson in native selection', () => {
    const broad = simulateAzNet(curriculumV2Reference('v2-firewall', 'summary'))
    expect(lookupSubnetEffectiveRoute(broad.subnetTables['app-work'], '10.22.1.10')).toMatchObject({
      prefix: '10.22.0.0/16', nextHopType: 'VNetPeering',
    })
    const specific = simulateAzNet(curriculumV2Reference('v2-firewall', 'forward'))
    expect(lookupSubnetEffectiveRoute(specific.subnetTables['app-work'], '10.22.1.10')).toMatchObject({
      prefix: '10.22.0.0/16', source: 'User', nextHopIp: '10.20.1.4',
    })
    const primary = simulateAzNet(curriculumV2Reference('v2-vpn-backup', 'enable-backup'))
    expect(lookupSubnetEffectiveRoute(primary.subnetTables['app-work'], '172.22.0.10')).toMatchObject({
      prefix: '172.22.0.0/24', nextHopResourceId: 'er-gateway',
    })
    const backup = simulateAzNet(curriculumV2Reference('v2-vpn-backup'))
    expect(lookupSubnetEffectiveRoute(backup.subnetTables['app-work'], '172.22.0.10')).toMatchObject({
      prefix: '172.22.0.0/24', nextHopResourceId: 'vpn-gateway',
    })
  })
  it('distinguishes static VPN origin, learned gateway routes and suppressed workload publication', () => {
    const statics = simulateAzNet(curriculumV2Reference('v2-static-vpn'))
    expect(statics.gatewayRibs['vpn-gateway']).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.22.0.0/24', id: expect.stringContaining('vpn-static:warehouse-vpn:'), asPath: [], nextHopId: 'warehouse' }),
    ]))
    const learned = simulateAzNet(curriculumV2Reference('v2-bgp', 'enable-bgp'))
    expect(learned.gatewayRibs['vpn-gateway']).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.22.1.0/24', nextHopId: 'warehouse' }),
    ]))
    expect(learned.subnetTables['app-work'].suppressedBgpRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.22.1.0/24' }),
    ]))
    expect(lookupSubnetEffectiveRoute(learned.subnetTables['app-work'], '172.22.1.10')?.prefix).not.toBe('172.22.1.0/24')
    const published = simulateAzNet(curriculumV2Reference('v2-bgp'))
    expect(lookupSubnetEffectiveRoute(published.subnetTables['app-work'], '172.22.1.10')).toMatchObject({ prefix: '172.22.1.0/24', nextHopResourceId: 'vpn-gateway' })
  })
  it('uses prepared gateway BGP capability and edits only connection BGP in C06', () => {
    const topology = structuredClone(curriculumV2Topologies['v2-bgp'])
    const originalGateways = structuredClone(topology.vnets.find((vnet) => vnet.id === 'hybrid-hub')!.gateways)
    curriculumV2Repairs['v2-bgp'][0].apply(topology)
    expect(topology.vnets.find((vnet) => vnet.id === 'hybrid-hub')!.gateways).toEqual(originalGateways)
    const check = curriculumV2Bundle.checks.find((entry) => entry.id === 'v2-bgp.enable-bgp.check')!
    if (check.kind !== 'topology.configured') throw new Error('Expected connection configuration qualification')
    expect(matchesConfiguration(topology, check.params.expected)).toBe(true)
    topology.vnets.find((vnet) => vnet.id === 'hybrid-hub')!.gateways[0].bgpEnabled = false
    expect(matchesConfiguration(topology, check.params.expected)).toBe(false)
    const task = curriculumV2Bundle.lessons.find((lesson) => lesson.id === 'v2-bgp')!.tasks[0]
    expect(task.guidanceIds.map((id) => curriculumV2Bundle.guidance.find((guide) => guide.id === id))).toEqual([
      expect.objectContaining({ action: 'connection.configure', params: { kind: 'vpn-connection', connectionId: 'warehouse-vpn' } }),
    ])
  })
  it('walks the original prefix through aggregate location and gateway scopes and retains only B after declaration', () => {
    const first = simulateAzNet(curriculumV2Reference('v2-expressroute'))
    expect(first.erLocationRibs['location-a']).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.22.0.0/24', nextHopId: 'warehouse' }),
      expect.objectContaining({ prefix: '10.21.0.0/16', nextHopId: 'er-gateway' }),
    ]))
    expect(first.gatewayRibs['er-gateway']).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.22.0.0/24', connectionId: 'azure-er-a', nextHopId: 'warehouse' }),
    ]))
    const dual = simulateAzNet(curriculumV2Reference('v2-er-locations', 'attach-location-b'))
    expect(dual.gatewayRibs['er-gateway'].filter((r) => r.prefix === '172.22.0.0/24').map((r) => r.connectionId).sort()).toEqual(['azure-er-a', 'azure-er-b'])
    const surviving = simulateAzNet(curriculumV2Reference('v2-er-locations'))
    expect(surviving.gatewayRibs['er-gateway'].filter((r) => r.prefix === '172.22.0.0/24').map((r) => r.connectionId)).toEqual(['azure-er-b'])
    expect(surviving.erLocationRibs['location-a']).toEqual([])
  })
  it('rejects a primary reply IP pin in the second HA state and retains original packet identities', () => {
    const topology = curriculumV2Reference('v2-nva-ha', 'repair-return')
    topology.udrTables[1].routes[0].nextHopIp = '10.80.1.4'
    const evaluate = (backend: 'primary' | 'standby') => executePlatform({ contractVersion: 1, operation: 'evaluate',
      document: { mode: 'full', topology }, requirements: curriculumV2HaRequirements(backend) })
    expect(evaluate('primary').assessments.every((a) => a.outcome === 'satisfied')).toBe(true)
    curriculumV2Repairs['v2-nva-ha'][1].apply(topology)
    const wrong = evaluate('standby')
    expect(wrong.errors).toEqual([])
    expect(wrong.assessments.find((a) => a.id === 'same-backend-both-directions')?.outcome).toBe('violated')
    const secondCheck = curriculumV2Bundle.checks.find((c) => c.id === 'v2-nva-ha.standby-snapshot.check')!
    if (secondCheck.kind !== 'topology.configured') throw new Error('Expected a native configuration check')
    expect(matchesConfiguration(topology, secondCheck.params.expected)).toBe(false)
    topology.udrTables[1].routes[0].nextHopIp = '10.80.3.10'
    expect(evaluate('standby').assessments.every((a) => a.outcome === 'satisfied')).toBe(true)
    const fresh = executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology }, packet: curriculumV2Packet })
    expect(fresh.errors).toEqual([])
    expect(fresh.packet).toMatchObject({ source: curriculumV2Packet.source, target: curriculumV2Packet.target,
      forward: { tuple: { sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10', protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } },
      haPorts: { symmetry: 'symmetric', forward: [expect.objectContaining({ applianceId: 'standby' })], reply: [expect.objectContaining({ applianceId: 'standby' })] } })
    expect(topology.inventory!.workloads!.find((w) => w.id === 'client')?.nicIds).toEqual(['client-nic'])
    expect(topology.inventory!.nics!.find((n) => n.id === 'server-nic')?.ipConfigurations[0]).toMatchObject({
      id: 'server-ip', subnetId: 'remote-work', privateIp: '10.82.1.10',
    })
  })
  it('does not qualify replacing the original packet endpoint address', () => {
    const topology = curriculumV2Reference('v2-nva-ha')
    topology.inventory!.nics!.find((nic) => nic.id === 'server-nic')!.ipConfigurations[0].privateIp = '10.82.1.11'
    const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
      requirements: curriculumV2HaRequirements('standby') })
    expect(result.assessments.find((a) => a.id === 'original-ha-packet')).toMatchObject({ outcome: 'not assessed',
      reasons: ['Original packet endpoint identity/address binding is missing or changed; no passing or isolation assessment.'] })
  })
  it('rejects each capstone fault independently and preserves working service witnesses', () => {
    const topology = structuredClone(curriculumV2Topologies['v2-handover'])
    const evaluate = () => executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
      requirements: curriculumV2Requirements['v2-handover'] })
    const original = evaluate()
    expect(original.assessments.filter((a) => ['operations', 'local-service', 'working-warehouse', 'application-to-tenant', 'tenant-to-application'].includes(a.id))
      .every((a) => a.outcome === 'satisfied')).toBe(true)
    curriculumV2Repairs['v2-handover'][0].apply(topology)
    const forwardOnly = evaluate()
    expect(forwardOnly.assessments.find((a) => a.id === 'source-regional-route')?.outcome).toBe('satisfied')
    expect(forwardOnly.assessments.find((a) => a.id === 'independent-reply-route')?.outcome).toBe('violated')
    expect(forwardOnly.assessments.find((a) => a.id === 'original-regional-service')?.outcome).toBe('violated')
    curriculumV2Repairs['v2-handover'][1].apply(topology)
    expect(evaluate().assessments.every((a) => a.outcome === 'satisfied')).toBe(true)
    topology.vnets.find((v) => v.id === 'east-service')!.vwanHubAttachment!.hubRouting!.labels = []
    expect(evaluate().assessments.find((a) => a.id === 'source-regional-route')?.outcome).toBe('violated')
    expect(evaluate().assessments.find((a) => a.id === 'independent-reply-route')?.outcome).toBe('satisfied')
  })
})
