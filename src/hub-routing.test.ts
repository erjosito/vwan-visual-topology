import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HubRoutingConfiguration, Topology } from './model'
import { simulate } from './routing'
import { traceNodePath } from './paths'
import { validateTopology } from './validation'
import { analyzeRouting } from './diagnostics'
import { bicepDefaults, generateBicep } from './bicep-export'
import { importAzureCapture } from './azure-import'
import { contextObservationFixture } from '../tests/azure-observation-fixture'

const routing = (associatedTableId: string, label: string): HubRoutingConfiguration => ({
  status: 'configured', associatedTableId, propagatedTableIds: [], labels: [label],
})
function fixture(): Topology {
  return {
    version: 1, name: 'Table-context controls', sites: [], connections: [], siteLinks: [],
    hubs: ['a', 'b'].map((id) => ({
      id, name: id, region: 'swedencentral', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false, privatePrefixes: [] },
      routeTables: [
        { id: 'red', name: 'Red', labels: ['red'] },
        { id: 'blue', name: 'Blue', labels: ['blue'] },
      ],
    })),
    spokes: [
      { id: 'red-a', name: 'Red A', hubId: 'a', prefixes: ['10.1.0.0/16'], hubRouting: routing('red', 'red') },
      { id: 'red-b', name: 'Red B', hubId: 'b', prefixes: ['10.2.0.0/16'], hubRouting: routing('red', 'red') },
      { id: 'blue-b', name: 'Blue B', hubId: 'b', prefixes: ['10.3.0.0/16'], hubRouting: routing('blue', 'blue') },
      { id: 'default-a', name: 'Default A', hubId: 'a', prefixes: ['10.4.0.0/16'] },
    ],
  }
}

describe('hub route-table contexts', () => {
  it('replays published native and synthetic captures without promoting unknown scope or losing None isolation', () => {
    const load = (name: string) => importAzureCapture({
      ...JSON.parse(readFileSync(new URL(`../tests/fixtures/azure-vwan-contexts/${name}.json`, import.meta.url), 'utf8')),
      version: 1,
    })
    const native = load('native-default')
    expect(native.hubs).toHaveLength(2)
    expect(native.spokes).toHaveLength(4)
    expect(native.sites).toEqual([])
    expect(native.connections).toEqual([])
    expect(native.azureImport?.hubs.every((hub) => hub.routingScopeComplete === false)).toBe(true)
    expect(traceNodePath(native, simulate(native), { kind: 'spoke', id: native.spokes[0].id }, '10.210.1.4')[0].status).toBe('unknown')

    const custom = load('synthetic-custom')
    expect(traceNodePath(custom, simulate(custom), { kind: 'spoke', id: custom.spokes[0].id }, '10.2.0.4')[0].status).toBe('delivered')
    const isolated = load('synthetic-isolated'), isolatedSimulation = simulate(isolated)
    expect(traceNodePath(isolated, isolatedSimulation, { kind: 'spoke', id: isolated.spokes[0].id }, '10.2.0.4')[0].status).toBe('delivered')
    expect(traceNodePath(isolated, isolatedSimulation, { kind: 'spoke', id: isolated.spokes[1].id }, '10.1.0.4')[0].status).toBe('unreachable')
    const mixed = load('synthetic-mixed-intent')
    expect(traceNodePath(mixed, simulate(mixed), { kind: 'spoke', id: mixed.spokes[0].id }, '10.2.0.4')[0].status).toBe('unknown')
  })

  it('does not certify modern imported paths while branch inputs or WAN transit controls remain unobserved', () => {
    const capture = contextObservationFixture()
    capture.hubs[0].gatewayTypes = ['VPN']
    const imported = importAzureCapture({ ...capture, version: 1 })
    expect(imported.azureImport?.hubs[0].routingScopeComplete).toBe(false)
    expect(traceNodePath(imported, simulate(imported), { kind: 'spoke', id: imported.spokes[0].id }, '10.2.0.4')[0].status).toBe('unknown')

    capture.hubs[0].gatewayTypes = []
    const unconfirmed = importAzureCapture({ ...capture, version: 1, wan: { ...capture.wan, allowVnetToVnetTraffic: undefined } })
    expect(traceNodePath(unconfirmed, simulate(unconfirmed), { kind: 'spoke', id: unconfirmed.spokes[0].id }, '10.2.0.4')[0].status).toBe('unknown')
  })

  it('canonicalizes reserved table identities without folding case-sensitive labels', () => {
    const topology = fixture()
    topology.hubs[0].routeTables!.push({ id: 'DEFAULTROUTETABLE', name: 'Default', labels: ['default', 'Default'] })
    topology.spokes[0].hubRouting = { status: 'configured', associatedTableId: 'DefaultRouteTable',
      propagatedTableIds: ['DEFAULTROUTETABLE'], labels: ['Default'] }
    const validated = validateTopology(topology)
    expect(validated.spokes[0].hubRouting).toMatchObject({ associatedTableId: 'defaultRouteTable',
      propagatedTableIds: ['defaultRouteTable'], labels: ['Default'] })
    expect(validated.hubs[0].routeTables?.at(-1)?.id).toBe('defaultRouteTable')
    topology.hubs[0].routeTables!.push({ id: 'defaultRouteTable', name: 'duplicate', labels: [] })
    expect(() => validateTopology(topology)).toThrow(/Duplicate route-table ID/)
  })

  it('enforces uniform branch propagation by effective destinations rather than raw array identity', () => {
    const topology = fixture()
    topology.sites = [{ id: 'site', name: 'Branch', asn: 65001, prefixes: ['10.90.0.0/16'] }]
    topology.connections = ['one', 'two'].map((id) => ({
      id, name: id, hubId: 'a', siteId: 'site', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [],
      hubRouting: routing('defaultRouteTable', 'red'),
    }))
    topology.connections[0].hubRouting!.propagatedTableIds = ['red']
    expect(() => validateTopology(topology)).not.toThrow()
    topology.connections[1].hubRouting = routing('defaultRouteTable', 'blue')
    expect(() => validateTopology(topology)).toThrow(/same effective route-table destinations/)
    topology.connections[1].hubRouting = routing('blue', 'red')
    expect(() => validateTopology(topology)).toThrow(/associate with the Default/)
    topology.connections[1].hubRouting = { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] }
    expect(() => validateTopology(topology)).not.toThrow()
    expect(simulate(validateTopology(topology)).hubTableCoverage?.a.red.complete).toBe(false)
  })

  it('preserves independent table winners and longest-prefix lookup rather than filtering a global winner', () => {
    const topology = fixture()
    topology.spokes.push(
      { id: 'blue-a', name: 'Overlapping Blue', hubId: 'a', prefixes: ['10.2.0.0/16'], hubRouting: routing('blue', 'blue') },
      { id: 'red-narrow', name: 'Red more-specific', hubId: 'a', prefixes: ['10.2.2.0/24'], hubRouting: routing('red', 'red') },
    )
    const simulation = simulate(validateTopology(topology))
    expect(simulation.hubTables?.a.red.find((row) => row.prefix === '10.2.0.0/16')?.selected[0]).toMatchObject({ remote: true, connectionId: 'red-b' })
    expect(simulation.hubTables?.a.blue.find((row) => row.prefix === '10.2.0.0/16')?.selected[0]).toMatchObject({ remote: false, connectionId: 'blue-a' })
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.2.4')[0]).toMatchObject({ status: 'delivered', siteId: 'red-narrow' })
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.3.4')[0]).toMatchObject({ status: 'delivered', siteId: 'red-b' })
    expect(traceNodePath(topology, simulation, { kind: 'hub', id: 'a' }, '10.2.3.4', undefined, 'red')[0].siteId).toBe('red-b')
  })

  it('uses case-sensitive target labels without requiring the same label on an origin table', () => {
    const topology = fixture()
    topology.spokes = ['a', 'b'].map((hubId, index) => ({
      id: `spoke-${hubId}`, name: hubId, hubId, prefixes: [`10.${index + 1}.0.0/16`],
      hubRouting: { status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['defaultRouteTable'], labels: ['Default'] },
    }))
    topology.hubs[0].routeTables!.push({ id: 'defaultRouteTable', name: 'Default', labels: ['default', 'Default'] })
    const simulation = simulate(validateTopology(topology))
    expect(simulation.tables.a.map((row) => row.prefix)).toEqual(['10.1.0.0/16', '10.2.0.0/16'])
    expect(simulation.tables.b.map((row) => row.prefix)).toEqual(['10.2.0.0/16'])
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'spoke-a' }, '10.2.0.4')[0].status).toBe('delivered')
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'spoke-b' }, '10.1.0.4')[0].status).toBe('unreachable')
  })

  it('keeps remote-only export and secured/custom context boundaries explicitly unassessed', () => {
    const topology = fixture()
    topology.spokes[1].hubRouting = routing('red', 'remote-only')
    topology.hubs[0].routeTables![0].labels.push('remote-only')
    expect(traceNodePath(topology, simulate(topology), { kind: 'spoke', id: 'red-a' }, '10.2.0.4')[0].status).toBe('unknown')
    const mixed = fixture()
    mixed.hubs[0].routeTables = undefined; mixed.hubs[0].routingIntent.private = true
    mixed.spokes = mixed.spokes.filter((spoke) => spoke.hubId !== 'a')
    const simulation = simulate(validateTopology(mixed))
    expect(simulation.hubTableCoverage?.b.red.complete).toBe(false)
    expect(simulation.warnings.join(' ')).toContain('See #22')
  })

  it('does not extend the live Default origin-label exception to an uncalibrated custom origin', () => {
    const topology = fixture()
    topology.spokes[1].hubRouting!.propagatedTableIds = ['red']
    topology.hubs[1].routeTables![0].labels = ['orphan']
    const simulation = simulate(validateTopology(topology))
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.0.4')[0].status).toBe('unknown')
    expect(simulation.hubTableCoverage?.b.red.complete).toBe(true)
  })

  it('inherits NVA host controls and enforces the documented Default/branch propagation constraints', () => {
    const topology = fixture()
    const host = topology.spokes.find((spoke) => spoke.id === 'default-a')!
    host.hubRouting = routing('defaultRouteTable', 'red')
    topology.sites = [
      { id: 'branch', name: 'Branch', asn: 65001, prefixes: ['10.90.0.0/16'] },
      { id: 'nva', name: 'NVA', asn: 65002, prefixes: ['10.90.0.0/16'] },
    ]
    topology.connections = [
      { id: 'vpn', name: 'VPN', hubId: 'a', siteId: 'branch', transport: 'VPN', enabled: true, learnSiteRoutes: true,
        inbound: [], outbound: [],
        hubRouting: routing('defaultRouteTable', 'red') },
      { id: 'nva-peer', name: 'NVA', hubId: 'a', siteId: 'nva', transport: 'SpokeNVA', enabled: true, learnSiteRoutes: true,
        spokeId: 'default-a', peerIp: '10.4.0.4', inbound: [], outbound: [] },
    ]
    const simulation = simulate(validateTopology(topology))
    expect(simulation.hubTables?.a.red.some((row) => row.candidates.some((route) => route.connectionId === 'nva-peer'))).toBe(true)
    expect(simulation.hubTables?.a.blue.some((row) => row.prefix === '10.90.0.0/16')).toBe(false)
    host.hubRouting = routing('blue', 'red')
    expect(() => validateTopology(topology)).toThrow(/spoke NVA hosting connections.*Default/)
    host.hubRouting = routing('defaultRouteTable', 'blue')
    expect(() => validateTopology(topology)).toThrow(/same effective route-table destinations/)
    topology.connections[1].hubRouting = routing('defaultRouteTable', 'red')
    expect(() => validateTopology(topology)).toThrow(/inherited from its hosting VNet/)
  })

  it('keeps intentional isolation distinct from an explicitly required bidirectional connection', () => {
    const topology = fixture()
    topology.spokes[0].hubRouting = { ...routing('red', 'none'), propagatedTableIds: ['noneRouteTable'] }
    const intent = { id: 'pair', source: { kind: 'spoke' as const, id: 'red-a' }, target: { kind: 'spoke' as const, id: 'red-b' },
      sourcePrefix: '10.1.0.1', destinationPrefix: '10.2.0.1', expectation: 'allow' as const }
    const report = analyzeRouting(validateTopology(topology), { version: 1, intents: [intent], failureAnalysis: false })
    expect(report.findings.some((finding) => finding.rule === 'missing-return')).toBe(true)
    topology.spokes[0].hubRouting = { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] }
    const unknown = analyzeRouting(validateTopology(topology), { version: 1, intents: [intent], failureAnalysis: false })
    expect(unknown.findings.every((finding) => finding.confidence === 'unknown')).toBe(true)
    expect(unknown.limitations.join(' ')).not.toContain('128')
  })

  it('does not silently drop supported model context when exporting an unsupported Bicep subset', () => {
    const topology = validateTopology(fixture())
    const settings = bicepDefaults(topology)
    settings.location = 'swedencentral'
    settings.hubs.forEach((hub, index) => { hub.addressPrefix = `10.250.${index * 2}.0/23` })
    expect(() => generateBicep(topology, settings)).toThrow(/rather than discard.*#22/)
  })

  it('selects ingress association and preserves the remote custom context without Default leakage', () => {
    const topology = validateTopology(fixture()), simulation = simulate(topology)
    expect(simulation.tables.a.map((row) => row.prefix)).toEqual(['10.4.0.0/16'])
    expect(simulation.hubTables?.a.red.map((row) => row.prefix)).toEqual(['10.1.0.0/16', '10.2.0.0/16'])
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.0.4')).toMatchObject([
      { status: 'delivered', siteId: 'red-b', hubs: ['a', 'b'], traceComplete: true },
    ])
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.3.0.4')).toMatchObject([
      { status: 'unreachable', termination: 'no-route', hubs: ['a'] },
    ])
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'default-a' }, '10.2.0.4')[0].status).toBe('unreachable')
  })

  it('keeps association independent from propagation and verifies the return direction', () => {
    const topology = fixture()
    topology.spokes[0].hubRouting = routing('defaultRouteTable', 'red')
    const simulation = simulate(topology)
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.0.4')[0].status).toBe('unreachable')
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-b' }, '10.1.0.4')[0]).toMatchObject({
      status: 'delivered', siteId: 'red-a',
    })
  })

  it('treats None as no propagation, not as removal of the source association', () => {
    const topology = fixture()
    topology.spokes[0].hubRouting = { ...routing('red', 'none'), propagatedTableIds: ['noneRouteTable'] }
    const simulation = simulate(validateTopology(topology))
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.0.4')[0].status).toBe('delivered')
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-b' }, '10.1.0.4')[0].status).toBe('unreachable')
    topology.spokes[0].hubRouting = routing('red', 'none')
    expect(simulate(validateTopology(topology)).hubTables?.a.red.some((row) => row.prefix === '10.1.0.0/16')).toBe(false)
  })

  it('does not manufacture a network failure from unknown imported propagation', () => {
    const topology = fixture()
    topology.spokes[0].hubRouting = { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] }
    const simulation = simulate(validateTopology(topology))
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-b' }, '10.1.0.4')[0]).toMatchObject({
      status: 'unknown', termination: 'unknown-context', traceComplete: false,
    })
    expect(simulation.warnings.join(' ')).toContain('See #22')
  })

  it('retains static controls but refuses to certify an unsupported static next-hop context', () => {
    const topology = fixture()
    topology.hubs[1].routeTables![0].staticRoutes = [{
      name: 'NVA', destinationType: 'CIDR', destinations: ['10.1.0.0/16'], nextHopType: 'ResourceId', nextHop: '/unmodeled/nva',
    }]
    const simulation = simulate(validateTopology(topology))
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'red-a' }, '10.2.0.4')[0].status).toBe('unknown')
    expect(traceNodePath(topology, simulation, { kind: 'spoke', id: 'default-a' }, '10.2.0.4')[0].status).toBe('unreachable')
  })
})
