import { describe, expect, it } from 'vitest'
import { hubFirewallTopology, azHubFirewallTopology, firewallAddresses, type FirewallEndpoint } from '../tests/fixtures/hub-firewall'
import { simulate, traceFlow } from './routing'
import { traceNodePath } from './paths'
import { parseAzNetTopology } from './azure-net/admission'
import { simulateAzNet, traceAzNetFlow } from './azure-net/engine'
import { validateTopology } from './validation'
import { executePlatform } from './platform/service'

// Hand-authored destination/inspection expectations, not engine-generated expected paths.
const repairedMatrix: [FirewallEndpoint, FirewallEndpoint, boolean][] = [
  ['trusted-a', 'branch-a', false], ['branch-a', 'trusted-a', false],
  ['untrusted-a', 'branch-a', true], ['branch-a', 'untrusted-a', true],
  ['trusted-a', 'untrusted-a', true], ['untrusted-a', 'trusted-a', true],
  ['trusted-a', 'trusted-b', false], ['untrusted-a', 'untrusted-b', true],
  ['branch-a', 'branch-b', false],
]

describe.each(['vwan', 'full'] as const)('single-hub Firewall static forwarding (%s)', (mode) => {
  const endpoint = (id: FirewallEndpoint) => mode === 'vwan'
    ? { kind: id.startsWith('branch') ? 'site' : 'spoke', id }
    : id.startsWith('branch') ? { kind: 'site', siteId: id } : { kind: 'subnet', vnetId: id, subnetId: `sub-${id}` }
  const fixture = () => mode === 'vwan' ? hubFirewallTopology() : azHubFirewallTopology()
  const evaluate = (source: FirewallEndpoint, target: FirewallEndpoint, forward: string, reverse = forward, topology = fixture()) =>
    executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode, topology }, requirements: [{
      id: 'inspection', kind: 'flow', source: endpoint(source), target: endpoint(target),
      sourceAddress: firewallAddresses[source], destinationAddress: firewallAddresses[target], expectation: 'allow',
      firewallPolicy: { hubId: 'hub-local', forward, reverse },
    }] })

  it.each(repairedMatrix)('assesses %s to %s with inspected=%s and an independent reverse lookup', (source, target, inspected) => {
    const result = evaluate(source, target, inspected ? 'required' : 'bypassed')
    expect(result.errors).toEqual([])
    expect(result.assessments[0]?.outcome, JSON.stringify(result.assessments)).toBe('satisfied')
    expect(evaluate(source, target, inspected ? 'bypassed' : 'required').assessments[0]?.outcome).toBe('violated')
  })

  it('exposes the published branch design contradiction rather than assuming the stated matrix is an oracle', () => {
    const topology = mode === 'vwan' ? hubFirewallTopology('published-branch') : azHubFirewallTopology('published-branch')
    expect(evaluate('untrusted-a', 'trusted-a', 'required', 'required', topology).assessments[0]?.outcome).toBe('violated')
    expect(evaluate('untrusted-a', 'trusted-a', 'bypassed', 'required', topology).assessments[0]?.outcome).toBe('satisfied')
    expect(evaluate('branch-a', 'trusted-a', 'bypassed', 'bypassed', topology).assessments[0]?.outcome).toBe('satisfied')
  })

  it.each(['missing-firewall', 'unknown-target', 'host-bits', 'unknown-type', 'routing-intent', 'multi-hub'] as const)(
    'keeps %s unassessed instead of certifying bypass', (variant) => {
      const topology = fixture()
      const hubs = 'hubs' in topology ? topology.hubs : topology.vwanHubs
      const hub = hubs[0]
      if (variant === 'missing-firewall') delete hub.firewall
      if (variant === 'unknown-target') hub.routeTables![0].staticRoutes![0].nextHop = 'unresolved'
      if (variant === 'host-bits') hub.routeTables![0].staticRoutes![0].destinations = ['10.1.0.1/8']
      if (variant === 'unknown-type') hub.routeTables![0].staticRoutes![0].nextHopType = 'IPAddress'
      if (variant === 'routing-intent') hub.routingIntent.private = true
      if (variant === 'multi-hub') hubs.push({ ...structuredClone(hub), id: 'remote', name: 'Remote', routeTables: [],
        firewall: { id: 'fw-remote', name: 'Remote Firewall' },
        routingIntent: { ...hub.routingIntent, privatePrefixes: hub.routingIntent.privatePrefixes ?? [] } })
      const result = evaluate('branch-a', 'untrusted-a', 'bypassed', 'bypassed', topology)
      expect(result.errors).toEqual([])
      expect(result.assessments[0]?.outcome).toBe('not assessed')
    })

  it('rejects misspelled or conflicting per-leg predicates and unknown Firewall ownership cannot pass', () => {
    expect(evaluate('trusted-a', 'branch-a', 'bypass').status).toBe('invalid')
    const topology = fixture()
    const hubs = 'hubs' in topology ? topology.hubs : topology.vwanHubs
    delete hubs[0].firewall
    for (const table of hubs[0].routeTables!) delete table.staticRoutes
    expect(evaluate('trusted-a', 'branch-a', 'bypassed', 'bypassed', topology).assessments[0]?.outcome).toBe('not assessed')
  })

  it('does not repair the published untrusted-to-trusted bypass merely by removing branch propagation from Default', () => {
    const topology = mode === 'vwan' ? hubFirewallTopology('published-branch') : azHubFirewallTopology('published-branch')
    const branches = 'connections' in topology ? topology.connections : topology.vpnConnections
    for (const branch of branches) branch.hubRouting = { status: 'configured', associatedTableId: 'defaultRouteTable',
      propagatedTableIds: ['trusted'], labels: ['trusted'] }
    expect(evaluate('untrusted-a', 'trusted-a', 'required', 'required', topology).assessments[0]?.outcome).toBe('violated')
  })

  it('does not certify a forward-only route when the independent reply lacks a route', () => {
    const topology = fixture()
    const hubs = 'hubs' in topology ? topology.hubs : topology.vwanHubs
    delete hubs[0].routeTables!.find((table) => table.id === 'untrusted')!.staticRoutes
    const result = evaluate('branch-a', 'untrusted-a', 'required', 'required', topology)
    expect(result.errors).toEqual([])
    expect(result.assessments[0]?.outcome).toBe('violated')
  })

  it('models the published VNet-selective contract without promoting static branch inspection', () => {
    const topology = mode === 'vwan' ? hubFirewallTopology('published-vnet') : azHubFirewallTopology('published-vnet')
    for (const [source, target] of repairedMatrix.slice(0, 6)) {
      expect(evaluate(source, target, 'required', 'required', topology).assessments[0]?.outcome).toBe('satisfied')
    }
    expect(evaluate('trusted-a', 'trusted-b', 'bypassed', 'bypassed', topology).assessments[0]?.outcome).toBe('satisfied')
    expect(evaluate('branch-a', 'branch-b', 'required', 'required', topology).assessments[0]?.outcome).toBe('not assessed')
  })

  it('does not add Default propagation to explicit custom-table IDs when labels are empty', () => {
    const topology = mode === 'vwan' ? hubFirewallTopology('published-vnet') : azHubFirewallTopology('published-vnet')
    const attachments = 'spokes' in topology ? topology.spokes
      : topology.vnets.map((vnet) => vnet.vwanHubAttachment!)
    for (const attachment of attachments) attachment.hubRouting!.labels = []
    expect(evaluate('trusted-a', 'untrusted-a', 'required', 'required', topology).assessments[0]?.outcome).toBe('satisfied')
    expect(evaluate('trusted-a', 'trusted-b', 'bypassed', 'bypassed', topology).assessments[0]?.outcome).toBe('satisfied')
  })
})

describe('hub static route precedence and onward context', () => {
  it('preserves both native declarations through admission and uses all local routes for Firewall onward forwarding', () => {
    const legacy = validateTopology(hubFirewallTopology())
    const mixed = parseAzNetTopology(azHubFirewallTopology())
    expect(legacy.hubs[0].firewall).toEqual(mixed.vwanHubs[0].firewall)
    const simulation = simulate(legacy)
    const path = traceNodePath(legacy, simulation, { kind: 'spoke', id: 'trusted-a' }, '10.30.0.4')[0]
    expect(path).toMatchObject({ status: 'delivered', firewalls: ['hub-local'], siteId: 'untrusted-a' })
    expect(simulation.hubTables!['hub-local'].trusted.some((row) => row.prefix === '10.30.0.0/16')).toBe(false)
    expect(simulation.firewallTables['hub-local'].some((row) => row.prefix === '10.30.0.0/16')).toBe(true)
    const mixedSimulation = simulateAzNet(mixed)
    const trace = traceAzNetFlow(mixed, mixedSimulation, { kind: 'subnet', vnetId: 'trusted-a', subnetId: 'sub-trusted-a' }, '10.30.0.4')
    expect(trace.status).toBe('delivered')
    expect(trace.traversedApplianceIds).toEqual(['fw-local'])
    expect(trace.hops.filter((hop) => hop.action === 'inspect-firewall')).toHaveLength(1)
  })

  it('selects a more-specific learned route before an aggregate static, but static wins an equal prefix', () => {
    const topology = hubFirewallTopology()
    const hub = topology.hubs[0]
    expect(traceFlow(topology, simulate(topology), hub.id, '10.10.0.4')[0].firewalls).toEqual([])
    hub.routeTables![0].staticRoutes![0].destinations = ['10.10.0.0/16']
    const decision = simulate(topology).hubTables![hub.id].defaultRouteTable.find((row) => row.prefix === '10.10.0.0/16')!
    expect(decision.candidates).toHaveLength(2)
    expect(decision.selected.map((route) => route.kind)).toEqual(['hub-static'])
    expect(traceFlow(topology, simulate(topology), hub.id, '10.10.0.4')[0].firewalls).toEqual([hub.id])
    const mixed = azHubFirewallTopology()
    mixed.vwanHubs[0].routeTables![0].staticRoutes![0].destinations = ['10.10.0.0/16']
    expect(simulateAzNet(mixed).vwanHubRibs[hub.id].filter((route) => route.prefix === '10.10.0.0/16' && route.preferred)
      .map((route) => route.nextHopKind)).toEqual(['hub-firewall'])
  })

  it('reports a missing onward route without recursively reusing the ingress static aggregate', () => {
    const topology = hubFirewallTopology()
    expect(traceFlow(topology, simulate(topology), 'hub-local', '10.99.0.4')[0])
      .toMatchObject({ status: 'unreachable', termination: 'firewall-no-route' })
    const mixed = azHubFirewallTopology()
    const trace = traceAzNetFlow(mixed, simulateAzNet(mixed), { kind: 'subnet', vnetId: 'trusted-a', subnetId: 'sub-trusted-a' }, '10.99.0.4')
    expect(trace.status).toBe('dropped-no-route')
    expect(trace.hops.filter((hop) => hop.action === 'inspect-firewall')).toHaveLength(1)
  })

  it('does not silently select a favorable mixed-provider Firewall onward ECMP path', () => {
    const topology = azHubFirewallTopology()
    topology.vpnConnections.push({ ...structuredClone(topology.vpnConnections[0]), id: 'alternate-vpn', name: 'Alternate VPN' })
    const simulation = simulateAzNet(topology)
    expect(simulation.vwanFirewallRibs['hub-local'].filter((route) => route.prefix === '10.50.0.0/16' && route.preferred)).toHaveLength(2)
    const trace = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'untrusted-a', subnetId: 'sub-untrusted-a' }, '10.50.0.4')
    expect(trace.status).toBe('not-assessed')
    expect(trace.summaryReason).toContain('exhaustive assessment')
  })

  it('preserves routing-intent-only branch behavior when original Firewall metadata is declared', () => {
    const topology = hubFirewallTopology()
    delete topology.hubs[0].routeTables
    topology.hubs[0].routingIntent.private = true
    for (const attachment of [...topology.spokes, ...topology.connections]) delete attachment.hubRouting
    const trace = () => traceNodePath(topology, simulate(topology), { kind: 'site', id: 'branch-a' }, '10.60.0.4')
      .map(({ status, termination, firewalls }) => ({ status, termination, firewalls }))
    const declared = trace()
    delete topology.hubs[0].firewall
    expect(declared).toEqual(trace())
    expect(declared.some((path) => path.termination === 'unknown-context')).toBe(false)
  })

  it.each([null, false, 0, ''])('rejects malformed explicit Firewall declarations: %s', (firewall) => {
    expect(() => validateTopology({ ...hubFirewallTopology(), hubs: hubFirewallTopology().hubs.map((hub) => ({ ...hub, firewall })) })).toThrow()
    expect(() => parseAzNetTopology({ ...azHubFirewallTopology(), vwanHubs: azHubFirewallTopology().vwanHubs.map((hub) => ({ ...hub, firewall })) })).toThrow()
  })
})
