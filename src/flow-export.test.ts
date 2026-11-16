import { describe, expect, it } from 'vitest'
import { hubFirewallTopology, azHubFirewallTopology, firewallAddresses } from '../tests/fixtures/hub-firewall'
import type { FirewallEndpoint } from '../tests/fixtures/hub-firewall'
import { executePlatform } from './platform/service'
import { createFlowExportScene, flowSceneSvg } from './flow-export'
import type { FlowRequirement, PlatformMode } from './platform/contract'

function evaluate(mode: PlatformMode, source: FirewallEndpoint, target: FirewallEndpoint, published = false) {
  const endpoint = (id: FirewallEndpoint) => mode === 'vwan'
    ? { kind: id.startsWith('branch') ? 'site' as const : 'spoke' as const, id }
    : id.startsWith('branch') ? { kind: 'site' as const, siteId: id } : { kind: 'subnet' as const, vnetId: id, subnetId: `sub-${id}` }
  const topology = mode === 'vwan' ? hubFirewallTopology(published ? 'published-branch' : undefined) : azHubFirewallTopology(published ? 'published-branch' : undefined)
  const requirement: FlowRequirement = {
    kind: 'flow', id: 'selected-flow', source: endpoint(source), target: endpoint(target),
    sourceAddress: firewallAddresses[source], destinationAddress: firewallAddresses[target], expectation: 'allow',
  }
  return executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode, topology }, requirements: [requirement] })
}

describe.each(['vwan', 'full'] as const)('evidence-backed flow export (%s)', mode => {
  it.each([
    ['trusted-a', 'branch-a', false], ['trusted-a', 'trusted-b', false],
    ['untrusted-a', 'branch-a', true], ['trusted-a', 'untrusted-a', true],
  ] as const)('exports %s -> %s with independently evidenced inspection=%s', (source, target, inspection) => {
    const result = evaluate(mode, source, target)
    const scene = createFlowExportScene(result, 'selected-flow')
    expect(scene.revision).toBe(result.revision)
    expect(scene.lanes.map(lane => lane.direction).sort()).toEqual(['forward', 'return'])
    expect(scene.lanes.every(lane => lane.status === 'delivered')).toBe(true)
    for (const lane of scene.lanes) {
      expect(lane.nodes.some(node => node.kind === 'firewall')).toBe(inspection)
      expect(lane.nodes[0].label).toBe(lane.direction === 'forward' ? source : target)
      expect(lane.nodes.at(-1)?.label).toBe(lane.direction === 'forward' ? target : source)
      expect(lane.nodes.filter(node => node.label === source)).toHaveLength(1)
      expect(lane.nodes.filter(node => node.label === target)).toHaveLength(1)
    }
    expect(flowSceneSvg(scene, 250)).not.toBe(flowSceneSvg(scene, 1000))
  })

  it('does not mirror the forward route when the actual return crosses a Firewall', () => {
    const scene = createFlowExportScene(evaluate(mode, 'untrusted-a', 'trusted-a', true), 'selected-flow')
    expect(scene.lanes.find(lane => lane.direction === 'forward')?.nodes.some(node => node.kind === 'firewall')).toBe(false)
    expect(scene.lanes.find(lane => lane.direction === 'return')?.nodes.some(node => node.kind === 'firewall')).toBe(true)
  })
})

it('marks unknown evidence without moving traffic and rejects routes or missing evidence', () => {
  const result = evaluate('vwan', 'trusted-a', 'branch-a')
  result.assessments[0].outcome = 'not assessed'
  const scene = createFlowExportScene(result, 'selected-flow')
  expect(scene.lanes.every(lane => lane.status === 'unknown')).toBe(true)
  expect(flowSceneSvg(scene, 0, true)).not.toContain('animateMotion')
  expect(() => createFlowExportScene(result, 'missing')).toThrow('flow')
  result.assessments[0].evidence = []
  expect(() => createFlowExportScene(result, 'selected-flow')).toThrow('flow')
})

it('renders a blocked flow only up to the last evidenced node, without inventing target delivery', () => {
  const topology = hubFirewallTopology()
  topology.hubs[0].routeTables!.find(table => table.id === 'untrusted')!.staticRoutes = []
  const result = executePlatform({
    contractVersion: 1, operation: 'evaluate', document: { mode: 'vwan', topology },
    requirements: [{ id: 'blocked', kind: 'flow', source: { kind: 'spoke', id: 'untrusted-a' }, target: { kind: 'site', id: 'branch-a' },
      sourceAddress: '10.30.0.4', destinationAddress: '10.50.0.4', expectation: 'allow' }],
  })
  const lane = createFlowExportScene(result, 'blocked').lanes.find(lane => lane.direction === 'forward')!
  expect(lane.status).toBe('stopped')
  expect(lane.nodes.map(node => node.id)).not.toContain('branch-a')
})

it('escapes labels and bounds render options instead of accepting arbitrary SVG or unbounded output', () => {
  const scene = createFlowExportScene(evaluate('vwan', 'trusted-a', 'branch-a'), 'selected-flow')
  scene.lanes[0].nodes[0].label = '<script>&'
  const svg = flowSceneSvg(scene)
  expect(svg).toContain('&lt;script&gt;&amp;')
  expect(svg).not.toContain('<script>')
  expect(() => createFlowExportScene(evaluate('vwan', 'trusted-a', 'branch-a'), 'selected-flow', { width: 9000 })).toThrow()
})
