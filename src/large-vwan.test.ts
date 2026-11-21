import { describe, expect, it } from 'vitest'
import { largeVwanCapture } from '../tests/large-vwan-fixture'
import { importAzureCapture } from './azure-import'
import { parseAzureObservation } from './azure-observation'
import { validateTopology } from './validation'
import { diagramLayout } from './diagram-layout'
import { simulate } from './routing'
import { executePlatform } from './platform/service'

describe('bounded large Virtual WAN import (synthetic captures)', () => {
  it.each([1, 2])('imports 61 connections in capture v%i without losing stable identities or provenance', (version) => {
    const capture = { ...largeVwanCapture(61), version }
    const topology = importAzureCapture(capture)
    expect(topology.spokes).toHaveLength(61)
    expect(new Set(topology.spokes.map((spoke) => spoke.id)).size).toBe(61)
    expect(validateTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    if (version === 2) {
      expect(parseAzureObservation(capture).hubs[0].spokes).toHaveLength(61)
      expect(topology.azureImport?.spokes).toHaveLength(61)
      expect(topology.azureImport?.spokes?.[60].virtualNetworkId).toBe(capture.hubs[0].connections[60].virtualNetworkId)
    }
  })

  it.each([1, 4, 20])('round-trips 200 spokes, layouts and modeled routes across %i hubs in one WAN', (hubCount) => {
    const topology = importAzureCapture(largeVwanCapture(200, hubCount))
    for (const mode of ['layered', 'constellation'] as const) {
      const layout = diagramLayout(topology, mode)
      expect(layout.positions.size).toBe(200 + hubCount)
      expect(layout.width).toBeLessThan(20000)
      expect(layout.height).toBeLessThan(20000)
      topology.layout = { mode, positions: { [mode]: Object.fromEntries(layout.positions) } }
      expect(validateTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    }
    const result = executePlatform({ contractVersion: 1, operation: 'validate', document: { mode: 'vwan', topology } })
    expect(result.errors).toEqual([])
    expect(result.status).toBe('complete')
    const simulation = simulate(topology)
    expect(result.document).toEqual({ mode: 'vwan', topology })
    for (const hub of topology.hubs) {
      expect(simulation.tables[hub.id].some((row) => row.prefix === '10.200.3.0/24' && row.selected.length > 0)).toBe(true)
    }
  }, 15000)

  it('rejects aggregate over-budget references, including unread VNets, without flattening WAN scope', () => {
    const over = largeVwanCapture(1001, 4, 1)
    expect(() => importAzureCapture(over)).toThrow(/1000/)
    for (const hub of over.hubs) for (const connection of hub.connections) connection.addressPrefixes = null as never
    expect(() => importAzureCapture(over)).toThrow(/1000/)
    const mixed = largeVwanCapture(61, 2)
    mixed.hubs[1].virtualWanId = mixed.wan.id.replace('/wan', '/another-wan')
    expect(() => importAzureCapture(mixed)).toThrow(/different WAN/)
    const duplicate = largeVwanCapture(61, 2)
    duplicate.hubs[1].connections[0].virtualNetworkId = duplicate.hubs[0].connections[0].virtualNetworkId
    expect(() => importAzureCapture(duplicate)).toThrow(/ambiguous attachments/)
  })

  it('bounds large prefix workloads while preserving the previous 60-spoke envelope', () => {
    const topology = importAzureCapture(largeVwanCapture(200, 1, 5))
    expect(topology.spokes.reduce((sum, spoke) => sum + spoke.prefixes.length, 0)).toBe(1000)
    topology.spokes[0].prefixes.push('10.1.5.0/24')
    expect(() => validateTopology(topology)).toThrow(/1000 total spoke IPv4 prefixes/)
    expect(() => importAzureCapture(largeVwanCapture(61, 1, 17))).toThrow(/1000 total spoke IPv4 prefixes/)
    expect(importAzureCapture(largeVwanCapture(60, 1, 30)).spokes).toHaveLength(60)
    expect(() => validateTopology({ ...topology, spokes: Array.from({ length: 1001 }, () => topology.spokes[0]) })).toThrow(/at most 1000/)
  })

  it('only wraps large layered views and keeps explicit saved positions authoritative', () => {
    const medium = importAzureCapture(largeVwanCapture(60))
    const large = importAzureCapture(largeVwanCapture(61))
    const mediumLayout = diagramLayout(medium, 'layered')
    const largeLayout = diagramLayout(large, 'layered')
    expect(new Set(medium.spokes.map((spoke) => mediumLayout.positions.get(spoke.id)!.y))).toEqual(new Set([85]))
    expect(new Set(large.spokes.map((spoke) => largeLayout.positions.get(spoke.id)!.y)).size).toBeGreaterThan(1)
    expect(largeLayout.width).toBeLessThan(mediumLayout.width)
    large.layout = { mode: 'layered', positions: { layered: { [large.spokes[0].id]: { x: 14000, y: 1200 } } } }
    const moved = diagramLayout(validateTopology(large), 'layered')
    expect(moved.positions.get(large.spokes[0].id)).toEqual({ x: 14000, y: 1200 })
    expect(moved.width).toBeGreaterThan(14000)
  })
})
