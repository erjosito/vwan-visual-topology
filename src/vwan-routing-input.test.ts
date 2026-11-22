import { expect, it } from 'vitest'
import { example, type Topology } from './model'
import { traceNodePath } from './paths'
import { simulate } from './routing'
import { vwanDisplayResult, vwanRoutingInput } from './vwan-routing-input'

it('reuses semantic input on rename while refreshing native route warnings and trace prose without changing IDs', () => {
  const original = structuredClone(example)
  const input = vwanRoutingInput(original)
  const routing = JSON.parse(input.revision) as Topology
  const cached = simulate(routing)
  const renamed = structuredClone(original)
  renamed.hubs[0].name = 'Renamed hub'
  renamed.spokes[0].name = 'Renamed workload'
  renamed.connections[0].name = 'Renamed connection'
  renamed.hubs[0].label = 'Short label'
  renamed.layout = { mode: 'layered', positions: {} }
  const next = vwanRoutingInput(renamed)
  const names = JSON.parse(next.nameRevision) as string[]
  expect(next.revision).toBe(input.revision)
  const fresh = simulate(renamed)
  expect(vwanDisplayResult(cached, names)).toEqual(fresh)
  const source = { kind: 'spoke' as const, id: original.spokes[0].id }
  const destination = original.spokes.at(-1)!.prefixes[0].split('/')[0]
  expect(vwanDisplayResult(traceNodePath(routing, cached, source, destination), names))
    .toEqual(traceNodePath(renamed, fresh, source, destination))
  renamed.spokes[0].prefixes = ['10.250.0.0/16']
  expect(vwanRoutingInput(renamed).revision).not.toBe(input.revision)
  expect(original).toEqual(example)
})

it('retains inferred ER location names, hub regions and static route identities as routing inputs', () => {
  const topology = structuredClone(example)
  topology.erLocations = [{ id: 'location', name: 'Amsterdam', sku: 'Local' }]
  topology.hubs[0].routeTables = [{ id: 'custom', name: 'Display table', labels: [],
    staticRoutes: [{ name: 'Original route identity', destinationType: 'CIDR', destinations: ['10.0.0.0/8'],
      nextHopType: 'ResourceId', nextHop: 'firewall' }] }]
  const input = vwanRoutingInput(topology)
  const routing = JSON.parse(input.revision) as Topology
  expect(routing.erLocations![0].name).toBe('Amsterdam')
  expect(routing.hubs[0].routeTables![0].staticRoutes![0].name).toBe('Original route identity')
  topology.erLocations[0].name = 'Tokyo'
  expect(vwanRoutingInput(topology).revision).not.toBe(input.revision)
  topology.erLocations[0].name = 'Amsterdam'
  topology.hubs[0].region = 'Japan East'
  expect(vwanRoutingInput(topology).revision).not.toBe(input.revision)
})

it('falls back to fresh native input when a document contains reserved display tokens', () => {
  const topology = structuredClone(example)
  topology.spokes[0].id = '\0aznet-name:0\0'
  const input = vwanRoutingInput(topology)
  const routing = JSON.parse(input.revision) as Topology
  const simulation = simulate(routing)
  const path = traceNodePath(routing, simulation, { kind: 'spoke', id: topology.spokes[0].id }, topology.spokes[0].prefixes[0].split('/')[0])
  expect(vwanDisplayResult(path, JSON.parse(input.nameRevision))).toEqual(
    traceNodePath(topology, simulate(topology), { kind: 'spoke', id: topology.spokes[0].id }, topology.spokes[0].prefixes[0].split('/')[0]))
  expect(path[0].siteId).toBe(topology.spokes[0].id)
})

it('rebinds display references without copying untouched route branches or mutating cached results', () => {
  const routes = [{ prefix: '10.0.0.0/8', active: true }]
  const shared = { step: 'At \0aznet-name:0\0' }
  const cached = { routes, steps: ['At \0aznet-name:0\0'], untouched: ['plain route prose'], shared: [shared, shared] }
  const result = vwanDisplayResult(cached, ['Current hub'])
  expect(result).toEqual({ routes, steps: ['At Current hub'], untouched: ['plain route prose'],
    shared: [{ step: 'At Current hub' }, { step: 'At Current hub' }] })
  expect(result.routes).toBe(routes)
  expect(result.untouched).toBe(cached.untouched)
  expect(result.shared[0]).toBe(result.shared[1])
  expect(cached.steps).toEqual(['At \0aznet-name:0\0'])
  expect(vwanDisplayResult(cached, ['Restored hub']).steps).toEqual(['At Restored hub'])
})

it('retains unknown native fields as semantic inputs', () => {
  const topology = Object.assign(structuredClone(example), { futureRouting: { policy: 'initial' } })
  const initial = vwanRoutingInput(topology)
  topology.futureRouting.policy = 'changed'
  expect(vwanRoutingInput(topology).revision).not.toBe(initial.revision)
})
