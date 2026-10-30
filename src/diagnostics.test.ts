import { describe, expect, it, vi } from 'vitest'
import type { Topology } from './model'
import { analyzeRouting, diagnosticMessages, routingRevision, validateDiagnosticsProfile } from './diagnostics'
import type { DiagnosticIntent, DiagnosticsProfile } from './diagnostics'
import { azureRoutesAtSites, traceNodePath } from './paths'
import { propagateSites } from './bgp'
import { simulate, traceFlow } from './routing'
import * as routing from './routing'

function fixture(): Topology {
  return {
    version: 1, name: 'Diagnostics',
    hubs: [{ id: 'h', name: 'Hub', region: '', preference: 'ASPath', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    spokes: [{ id: 'a', name: 'Source', hubId: 'h', prefixes: ['10.1.0.0/16'] }],
    sites: [{ id: 'b', name: 'Destination', asn: 65002, prefixes: ['10.2.0.0/16'] }],
    connections: [{ id: 'vpn', name: 'VPN', hubId: 'h', siteId: 'b', transport: 'VPN', enabled: true, routes: [], learnSiteRoutes: true, inbound: [], outbound: [] }],
    siteLinks: [],
  }
}
const flow = (overrides: Partial<DiagnosticIntent> = {}): DiagnosticIntent => ({
  id: 'flow', source: { kind: 'spoke', id: 'a' }, target: { kind: 'site', id: 'b' },
  sourcePrefix: '10.1.0.1', destinationPrefix: '10.2.0.1', expectation: 'allow', ...overrides,
})
const profile = (intent = flow(), failureAnalysis = false): DiagnosticsProfile => ({ version: 1, intents: [intent], failureAnalysis })
const rules = (t: Topology, p = profile()) => analyzeRouting(t, p).findings.map((finding) => finding.rule)
function dropReturn(t: Topology) {
  t.routeMaps = [{ id: 'drop', name: 'Drop return', hubId: 'h', rules: [{ id: 'd', prefixes: ['10.1.0.0/16'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] }]
  t.connections[0].outboundMapId = 'drop'
}

describe('routing diagnostic intent and evidence', () => {
  it('automatically checks all assigned endpoint networks without a configured flow profile', () => {
    const t = fixture(), empty: DiagnosticsProfile = { version: 1, intents: [], failureAnalysis: false }
    const original = JSON.stringify(t)
    const healthy = analyzeRouting(t, empty, { automatic: true })
    expect(healthy).toMatchObject({ complete: true, probes: 2, cells: 1 })
    expect(healthy.findings.filter((finding) => finding.rule !== 'link-isolation')).toEqual([])
    expect(healthy.findings.filter((finding) => finding.rule === 'link-isolation')).toHaveLength(2)
    expect(JSON.stringify(t)).toBe(original)
    t.connections[0].enabled = false
    const failed = analyzeRouting(t, empty, { automatic: true })
    expect(failed.findings.find((finding) => finding.rule === 'network-unreachable')).toMatchObject({ severity: 'warning' })
    expect(failed.findings.find((finding) => finding.rule === 'network-unreachable')?.related).toContainEqual({ kind: 'site', id: 'b' })
  })

  it('lets explicit isolation override automatic connectivity checks only within its address scope', () => {
    const t = fixture()
    t.connections[0].enabled = false
    const deny = profile(flow({ sourcePrefix: '10.1.0.0/16', destinationPrefix: '10.2.0.0/16', expectation: 'deny' }))
    const isolated = analyzeRouting(t, deny, { automatic: true })
    expect(isolated.complete).toBe(true)
    expect(isolated.findings.filter((finding) => finding.rule !== 'link-isolation').map((finding) => finding.rule)).toEqual(['denied'])
    deny.intents[0].destinationPrefix = '10.2.0.0/24'
    const partial = analyzeRouting(t, deny, { automatic: true })
    expect(partial.findings.some((finding) => finding.rule === 'network-unreachable')).toBe(true)
    expect(partial.findings.filter((finding) => finding.rule === 'network-unreachable').every((finding) => !finding.sourceAddress?.startsWith('10.2.0.'))).toBe(true)
  })

  it('does not present unowned advertisements or exhausted automatic coverage as a healthy result', () => {
    const t = fixture(), empty: DiagnosticsProfile = { version: 1, intents: [], failureAnalysis: false }
    t.sites[0].prefixes = []
    t.connections[0].routes = [{ id: 'advertisement', prefix: '10.2.0.0/16', asPath: [65002], kind: 'bgp' }]
    const report = analyzeRouting(t, empty, { automatic: true })
    expect(report.complete).toBe(false)
    expect(report.findings.find((finding) => finding.rule === 'unowned-advertisement')).toMatchObject({ severity: 'unknown', related: [{ kind: 'site', id: 'b' }] })
    expect(analyzeRouting(fixture(), empty, { automatic: true, maxCells: 0 }).complete).toBe(false)
  })

  it('checks hundreds of prefixes without healthy finding spam and bounds larger meshes honestly', () => {
    const t = fixture(), empty: DiagnosticsProfile = { version: 1, intents: [], failureAnalysis: false }
    t.sites = []; t.connections = []
    t.spokes = Array.from({ length: 10 }, (_, i) => ({
      id: `spoke-${i}`, name: `Spoke ${i}`, hubId: 'h',
      prefixes: Array.from({ length: 20 }, (_, j) => `10.${i + 1}.${j}.0/24`),
    }))
    const report = analyzeRouting(t, empty, { automatic: true, maxCells: 50000, maxProbes: 20000, maxMillis: 15000 })
    expect(report).toMatchObject({ complete: true, cells: 18000 })
    expect(report.findings.filter((finding) => finding.rule !== 'link-isolation')).toEqual([])
    expect(report.findings).toHaveLength(10)
    expect(report.probes).toBeLessThan(report.cells)
    t.spokes = Array.from({ length: 40 }, (_, i) => ({
      id: `spoke-${i}`, name: `Spoke ${i}`, hubId: 'h',
      prefixes: Array.from({ length: 25 }, (_, j) => `10.${i + 1}.${j}.0/24`),
    }))
    const bounded = analyzeRouting(t, empty, { automatic: true, maxCells: 100, maxMillis: 15000 })
    expect(bounded).toMatchObject({ complete: false, cells: 100 })
    expect(bounded.limitations).toContain('Analysis budget reached; some declared cases were not assessed.')
    expect(bounded.limitsReached).toContain('maxCells')
  }, 20000)

  it('assesses a declared flow bidirectionally with stable results and no unrestricted mesh', () => {
    const t = fixture()
    const report = analyzeRouting(t, profile())
    expect(report).toMatchObject({ complete: true, probes: 2, cells: 1, failureCases: 0, limitations: [] })
    expect(report.findings.map((f) => f.rule)).toEqual(['reachable'])
    expect(report.findings[0]).toMatchObject({ severity: 'info', confidence: 'modeled', sourceAddress: '10.1.0.1', destinationAddress: '10.2.0.1' })
    expect(report.findings[0].related).toContainEqual({ kind: 'connection', id: 'vpn' })
    expect(analyzeRouting(t, profile())).toEqual(report)
    expect(analyzeRouting(t, { version: 1, intents: [], failureAnalysis: false }).probes).toBe(0)
    expect(analyzeRouting(t, profile(), { maxCells: 1, maxProbes: 2 }).complete).toBe(true)
  })

  it('handles local-spoke browser fixtures, including source attachment evidence for a failed flow', () => {
    const t = fixture()
    t.spokes.push({ id: 'local', name: 'Local', hubId: 'h', prefixes: ['10.4.0.0/24'] })
    t.connections = []
    const healthy = analyzeRouting(t, profile(flow({ target: { kind: 'spoke', id: 'local' }, destinationPrefix: '10.4.0.0/31' })))
    expect(healthy).toMatchObject({ complete: true, cells: 1, probes: 2 })
    expect(healthy.findings.map((f) => f.rule)).toEqual(['reachable'])
    const failed = analyzeRouting(t, profile())
    expect(failed.complete).toBe(true)
    expect(failed.findings.find((f) => f.rule === 'unreachable')?.forward[0]).toMatchObject({ sourceSpokeId: 'a', termination: 'no-route' })
  })

  it('distinguishes intentional isolation from required reachability and forbidden delivery', () => {
    const t = fixture()
    expect(rules(t, profile(flow({ expectation: 'deny' })))).toContain('deny-violation')
    t.connections[0].enabled = false
    expect(rules(t)).toContain('unreachable')
    expect(rules(t, profile(flow({ expectation: 'deny' })))).toEqual(['denied'])
  })

  it('finds missing return routes independently and records typed termination evidence', () => {
    const t = fixture()
    dropReturn(t)
    const report = analyzeRouting(t, profile())
    expect(report.complete).toBe(true)
    expect(report.findings.map((f) => f.rule)).toEqual(['missing-return'])
    expect(report.findings[0].evidence).toContainEqual({ code: 'reverse:no-route', nodeId: undefined, connectionId: undefined })
  })

  it('rejects apparent public Internet delivery to a declared public-addressed site', () => {
    const t = fixture()
    t.sites[0].prefixes = ['203.0.113.0/24']
    t.connections[0].learnSiteRoutes = false
    t.hubs[0].routingIntent = { private: true, internet: true, privatePrefixes: [] }
    const report = analyzeRouting(t, profile(flow({ destinationPrefix: '203.0.113.8' })))
    expect(report.findings.map((f) => f.rule)).toContain('wrong-exit')
    expect(report.findings.find((f) => f.rule === 'wrong-exit')?.forward[0]).toMatchObject({ status: 'delivered', termination: 'internet' })
    expect(report.findings.some((f) => f.rule === 'reachable')).toBe(false)
  })

  it('partitions destination /16 at nested /24 boundaries instead of just testing its base', () => {
    const t = fixture()
    t.sites.push({ id: 'c', name: 'Wrong exit', asn: 65003, prefixes: ['10.3.0.0/16'] })
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'wrong', siteId: 'c', learnSiteRoutes: false, routes: [{ id: 'specific', prefix: '10.2.7.0/24', asPath: [65003], kind: 'bgp' }] })
    const report = analyzeRouting(t, profile(flow({ destinationPrefix: '10.2.0.0/16' })))
    expect(report.complete).toBe(true)
    expect(report.cells).toBeGreaterThan(1)
    expect(report.findings.find((f) => f.rule === 'wrong-exit')).toMatchObject({ prefix: '10.2.7.0/24', destinationAddress: '10.2.7.0' })
    expect(report.probes).toBeLessThan(report.cells * 2)
  })

  it('partitions source addresses to detect only a subprefix taking a wrong return exit', () => {
    const t = fixture()
    t.sites.push({ id: 'c', name: 'Wrong return', asn: 65003, prefixes: ['10.3.0.0/16'] })
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'wrong', siteId: 'c', learnSiteRoutes: false, routes: [{ id: 'return', prefix: '10.1.9.0/24', asPath: [65003], kind: 'bgp' }] })
    const report = analyzeRouting(t, profile(flow({ sourcePrefix: '10.1.0.0/16' })))
    const wrong = report.findings.find((f) => f.rule === 'wrong-exit')
    expect(wrong?.sourceAddress).toBe('10.1.9.0')
    expect(wrong?.evidence).toContainEqual({ code: 'source-cell', prefix: '10.1.9.0/24' })
    expect(report.findings.some((f) => f.rule === 'reachable')).toBe(true)
  })

  it('checks nested summary contributors and partial ECMP rather than counting any delivery as success', () => {
    const t = fixture()
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'summary', learnSiteRoutes: false, routes: [{ id: 'contributor', prefix: '10.2.1.0/24', asPath: [65002], kind: 'bgp' }] })
    t.routeMaps = [{ id: 'summary-map', name: 'Summary', siteId: 'b', rules: [{ id: 's', match: 'contains', prefixes: ['10.2.0.0/16'], action: 'summarize', summaryPrefixes: ['10.2.0.0/16'], prepend: [], nextStep: 'terminate' }] }]
    t.sites[0].routeMapAssignments = [{ connectionId: 'summary', outboundMapId: 'summary-map' }]
    const report = analyzeRouting(t, profile(flow({ destinationPrefix: '10.2.0.0/16' })))
    expect(report.complete).toBe(true)
    const mixed = report.findings.find((f) => f.rule === 'partial-ecmp')
    expect(mixed).toBeDefined()
    expect(mixed?.forward.map((p) => p.status).sort()).toEqual(['delivered', 'unreachable'])
    expect(report.findings.some((f) => f.rule === 'summary-hole')).toBe(true)
    expect(report.findings.some((f) => f.rule === 'reachable' && f.prefix === '10.2.1.0/24')).toBe(true)
  })

  it('compares physical sets including parallel attachments without predicting ECMP hashes', () => {
    const t = fixture()
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'parallel' })
    expect(rules(t)).toEqual(['reachable'])
    dropReturn(t)
    const report = analyzeRouting(t, profile())
    expect(report.findings.map((f) => f.rule)).toContain('asymmetric')
    expect(report.findings.find((f) => f.rule === 'asymmetric')?.severity).toBe('warning')
    expect(report.findings.some((f) => f.severity === 'error')).toBe(false)
  })

  it('retains both physical ER legs and exact parallel hub attachments when comparing path sets', () => {
    const t = fixture()
    t.connections = []
    t.erLocations = [{ id: 'location', name: 'ER' }]
    t.erLinks = [
      { id: 'hub-leg', name: 'Hub leg', locationId: 'location', hubId: 'h', enabled: true, routes: [], learnSiteRoutes: false },
      { id: 'parallel-hub-leg', name: 'Parallel hub leg', locationId: 'location', hubId: 'h', enabled: true, routes: [], learnSiteRoutes: false },
      { id: 'site-leg', name: 'Site leg', locationId: 'location', siteId: 'b', enabled: true, routes: [], learnSiteRoutes: true },
    ]
    const report = analyzeRouting(t, profile())
    expect(report.complete).toBe(true)
    expect(report.findings.map((f) => f.rule)).toEqual(['reachable'])
    expect(report.findings[0].forward.map((p) => p.erLinkIds).sort()).toEqual([['hub-leg', 'site-leg'], ['parallel-hub-leg', 'site-leg']])
    expect(report.findings[0].related).toContainEqual({ kind: 'erLink', id: 'site-leg' })
    expect(report.findings[0].reverse.map((p) => p.sourceErLinkIds).sort()).toEqual([['site-leg', 'hub-leg'], ['site-leg', 'parallel-hub-leg']])
  })

  it('compares exact site-transit paths and does not infer a forwarding loop from BGP own-AS rejection', () => {
    const t = fixture()
    t.sites.push({ id: 'c', name: 'Peer', asn: 65003, prefixes: ['10.3.0.0/16'] })
    t.siteLinks.push({ id: 'peer', name: 'Peer', a: 'b', b: 'c', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } })
    const p = profile(flow({ source: { kind: 'site', id: 'b' }, sourcePrefix: '10.2.0.1', target: { kind: 'site', id: 'c' }, destinationPrefix: '10.3.0.1' }))
    const report = analyzeRouting(t, p)
    expect(report.findings.map((f) => f.rule)).toEqual(['reachable'])
    expect(report.findings[0].forward[0]).toMatchObject({ siteHops: ['b', 'c'], siteLinkIds: ['peer'] })
    t.siteLinks[0].bToA.prepend = [65002]
    const blocked = analyzeRouting(t, p)
    expect(blocked.findings.map((f) => f.rule)).not.toContain('loop')
  })

  it('enforces explicit firewall intent and treats matching inspection as symmetric', () => {
    const t = fixture()
    expect(rules(t, profile(flow({ requiredFirewallHubId: 'h' })))).toContain('firewall')
    t.hubs[0].routingIntent.private = true
    expect(rules(t, profile(flow({ requiredFirewallHubId: 'h' })))).toEqual(['reachable'])
    expect(analyzeRouting(t, profile(flow({ requiredFirewallHubId: 'missing' }))).complete).toBe(false)
  })

  it('warns about declared ownership overlap but not repeated reachability advertisements', () => {
    const t = fixture()
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'duplicate' })
    expect(rules(t)).not.toContain('ownership')
    t.spokes.push({ id: 'overlap', name: 'Overlap', hubId: 'h', prefixes: ['10.2.0.0/24'] })
    const report = analyzeRouting(t, profile())
    expect(report.findings.map((f) => f.rule)).toContain('ownership')
    expect(report.findings.map((f) => f.rule)).toContain('unknown')
    expect(report.complete).toBe(false)
  })

  it('does not infer site ownership from advertisements or hub-owned host addresses', () => {
    const t = fixture()
    t.sites[0].prefixes = []
    t.connections[0].routes = [{ id: 'advertisement', prefix: '10.2.0.0/16', asPath: [65002], kind: 'bgp' }]
    expect(rules(t)).toEqual(['unknown'])
    expect(rules(fixture(), profile(flow({ source: { kind: 'hub', id: 'h' } })))).toEqual(['unknown'])
  })

  it('reports typed forwarding loops and gates provisional simulations without parsing steps', () => {
    const t = fixture()
    const simulation = simulate(t)
    const decision = simulation.tables.h.find((d) => d.prefix === '10.2.0.0/16')!
    decision.selected = decision.selected.map((route) => ({ ...route, remote: true, originHubId: 'h' }))
    const spy = vi.spyOn(routing, 'simulate').mockReturnValue(simulation)
    try {
      const report = analyzeRouting(t, profile())
      expect(report.findings.find((f) => f.rule === 'loop')).toMatchObject({ severity: 'error', forward: [{ hubs: ['h', 'h'], termination: 'loop' }] })
      simulation.converged = false
      const provisional = analyzeRouting(t, profile())
      expect(provisional.complete).toBe(false)
      expect(provisional.findings.map((f) => f.rule)).toEqual(['unknown'])
      expect(provisional.findings.some((f) => f.severity === 'error')).toBe(false)
    } finally { spy.mockRestore() }
  })

  it('gates unsupported SDWAN, ER defaults and hub own-AS inputs instead of declaring reachability failures', () => {
    const t = fixture()
    t.connections[0].transport = 'SDWAN'
    let report = analyzeRouting(t, profile())
    expect(report.complete).toBe(false)
    expect(report.findings.map((f) => f.rule)).toEqual(['unknown'])
    t.connections[0].transport = 'ExpressRoute'
    t.connections[0].learnSiteRoutes = false
    t.connections[0].routes = [{ id: 'default', prefix: '0.0.0.0/0', asPath: [12076, 65002], kind: 'bgp' }]
    report = analyzeRouting(t, profile())
    expect(report.findings.map((f) => f.rule)).toEqual(['unknown'])
    t.connections[0].transport = 'VPN'
    t.connections[0].routes[0] = { id: 'own-as', prefix: '10.2.0.0/16', asPath: [65515, 65002], kind: 'bgp' }
    expect(rules(t)).toEqual(['unknown'])
  })

  it('does not let an unrelated SDWAN input disable an otherwise supported spoke flow', () => {
    const t = fixture()
    t.spokes.push({ id: 'local', name: 'Local', hubId: 'h', prefixes: ['10.4.0.0/24'] })
    t.connections[0].transport = 'SDWAN'
    const report = analyzeRouting(t, profile(flow({ target: { kind: 'spoke', id: 'local' }, destinationPrefix: '10.4.0.1' })))
    expect(report.complete).toBe(true)
    expect(report.findings.map((f) => f.rule)).toEqual(['reachable'])
  })
})

describe('diagnostic contracts, policies and bounds', () => {
  it('validates bounded strict profiles and IPv4/CIDR inputs', () => {
    expect(validateDiagnosticsProfile(profile())).toEqual(profile())
    expect(validateDiagnosticsProfile(profile(flow({ sourcePrefix: '0.0.0.0/0', destinationPrefix: '255.255.255.255' })))).toBeDefined()
    for (const bad of [null, { ...profile(), version: 2 }, { ...profile(), extra: true }, profile(flow({ sourcePrefix: '10.1.0.1/16' })), profile(flow({ destinationPrefix: '::1' })), { ...profile(), intents: [flow(), flow()] }, { ...profile(), intents: Array.from({ length: 101 }, (_, i) => flow({ id: `${i}` })) }]) {
      expect(() => validateDiagnosticsProfile(bad)).toThrow('Invalid diagnostics profile.')
    }
    expect(() => analyzeRouting(fixture(), profile(), { maxCells: NaN })).toThrow()
    expect(() => analyzeRouting(fixture(), profile(), { maxProbes: -1 })).toThrow()
    expect(() => analyzeRouting(fixture(), profile(), { maxMillis: 0.1 })).toThrow()
  })

  it('changes revision for routing or coverage but not names, layout, region or locale', () => {
    const t = fixture()
    const revision = routingRevision(t)
    t.name = '名前'; t.hubs[0].name = '新しいハブ'; t.hubs[0].region = 'New region'
    t.layout = { mode: 'layered', positions: { layered: { h: { x: 90, y: 80 } } } }
    expect(routingRevision(t)).toBe(revision)
    t.connections[0].enabled = false
    expect(routingRevision(t)).not.toBe(revision)
    const withImport = fixture()
    withImport.azureImport = { capturedAt: '', collectorVersion: '', wanId: '', hubs: [], warnings: ['Unobserved'] }
    expect(routingRevision(withImport)).not.toBe(revision)
  })

  it('bounds cell, probe, finding, time and failure budgets honestly', () => {
    const t = fixture()
    for (const options of [{ maxCells: 0 }, { maxProbes: 1 }, { maxFindings: 0 }, { maxMillis: 0 }]) {
      const report = analyzeRouting(t, profile(), options)
      expect(report.complete).toBe(false)
      expect(report.limitations).toContain('Analysis budget reached; some declared cases were not assessed.')
      expect(report.limitsReached).toContain(Object.keys(options)[0])
    }
    const prefix = analyzeRouting(t, profile(flow({ sourcePrefix: '10.0.0.0/8', destinationPrefix: '10.0.0.0/8' })), { maxCells: 2, maxFindings: 2 })
    expect(prefix.cells).toBeLessThanOrEqual(2)
    expect(prefix.findings.length).toBeLessThanOrEqual(2)
    const failure = analyzeRouting(t, profile(flow(), true), { maxFailureCases: 0 })
    expect(failure.complete).toBe(false)
    expect(failure.failureCases).toBe(0)
    expect(failure.limitsReached).toContain('maxFailureCases')
  })

  it('tests single-link loss on immutable clones and finds a missing backup', () => {
    const t = fixture()
    const original = JSON.stringify(t)
    const report = analyzeRouting(t, profile(flow(), true))
    expect(JSON.stringify(t)).toBe(original)
    expect(report).toMatchObject({ complete: true, failureCases: 1 })
    expect(report.findings.find((f) => f.rule === 'failure')?.evidence).toContainEqual({ code: 'disabled-link', connectionId: 'vpn' })
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'backup' })
    const redundant = analyzeRouting(t, profile(flow(), true))
    expect(redundant.failureCases).toBe(2)
    expect(redundant.findings.some((f) => f.rule === 'failure')).toBe(false)
  })

  it('checks router/neighbor/direction-scoped before and after route-policy stages', () => {
    const t = fixture()
    dropReturn(t)
    const p: DiagnosticsProfile = { version: 1, intents: [], failureAnalysis: false, exportConstraints: [
      { id: 'required', router: { kind: 'hub', id: 'h' }, connectionId: 'vpn', direction: 'outbound', prefix: '10.1.0.0/16', expectation: 'present' },
      { id: 'forbidden', router: { kind: 'hub', id: 'h' }, connectionId: 'vpn', direction: 'outbound', prefix: '10.1.0.0/16', expectation: 'absent' },
      { id: 'site-in', router: { kind: 'site', id: 'b' }, connectionId: 'vpn', direction: 'inbound', prefix: '10.1.0.0/16', expectation: 'absent' },
      { id: 'missing', router: { kind: 'hub', id: 'no' }, connectionId: 'vpn', direction: 'outbound', prefix: '10.1.0.0/16', expectation: 'absent' },
    ] }
    const report = analyzeRouting(t, p)
    expect(report.findings.filter((f) => f.rule === 'export-ok')).toHaveLength(2)
    expect(report.findings.find((f) => f.rule === 'export')?.evidence.map((e) => e.code)).toEqual(['constraint:outbound:present', 'before:present', 'after:absent'])
    expect(report.findings.filter((f) => f.rule === 'unknown')).toHaveLength(1)
  })

  it('exports every static message used by reports and validation', () => {
    const t = fixture()
    for (const report of [analyzeRouting(t, profile()), analyzeRouting(t, profile(flow(), true), { maxProbes: 1 })]) {
      for (const finding of report.findings) {
        expect(diagnosticMessages).toContain(finding.title)
        expect(diagnosticMessages).toContain(finding.detail)
      }
      report.limitations.forEach((limitation) => expect(diagnosticMessages).toContain(limitation))
    }
    expect(diagnosticMessages).toContain('Invalid diagnostics profile.')
  })
})

describe('typed engine coverage and shared site-plane behavior', () => {
  it('keeps the same locally originated site route AS path in both site learning planes', () => {
    const t = fixture()
    t.sites.push({ id: 'c', name: 'Peer', asn: 65003, prefixes: ['10.3.0.0/16'] })
    t.siteLinks.push({ id: 'peer', name: 'Peer', a: 'b', b: 'c', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } })
    t.connections[0].routes = [{ id: 'origin', prefix: '192.0.2.0/24', asPath: [65002], kind: 'bgp' }]
    const simulation = simulate(t)
    const combined = azureRoutesAtSites(t, simulation)
    expect(combined.tables.c.find((r) => r.prefix === '192.0.2.0/24')?.asPath).toEqual(simulation.siteTables.c.find((r) => r.prefix === '192.0.2.0/24')?.asPath)
    expect(combined.tables.c.find((r) => r.prefix === '192.0.2.0/24')?.asPath).toEqual([65002])
    expect(combined.tables.c.find((r) => r.prefix === '10.1.0.0/16')?.asPath).toEqual([65002, 65515])
    t.sites.push({ id: 'd', name: 'Other origin', asn: 65004, prefixes: ['192.0.2.0/24'] })
    t.siteLinks.push({ ...structuredClone(t.siteLinks[0]), id: 'other-peer', a: 'd', b: 'c' })
    const ecmp = simulate(t)
    expect(azureRoutesAtSites(t, ecmp).tables.c.filter((r) => r.prefix === '192.0.2.0/24').map((r) => r.asPath).sort()).toEqual([[65002], [65004]])
    expect(ecmp.siteTables.c.filter((r) => r.prefix === '192.0.2.0/24').map((r) => r.asPath).sort()).toEqual([[65002], [65004]])
  })

  it('exposes 32-path site-selection truncation and prevents a false all-clear', () => {
    const t = fixture()
    for (let i = 0; i < 33; i++) t.connections.push({ ...structuredClone(t.connections[0]), id: `parallel${i}` })
    const simulation = simulate(t)
    expect(azureRoutesAtSites(t, simulation).selectionComplete).toBe(false)
    const report = analyzeRouting(t, profile())
    expect(report.complete).toBe(false)
    expect(report.findings.map((f) => f.rule)).toEqual(['unknown'])
  })

  it('exposes 128-branch trace truncation without altering existing statuses', () => {
    const t = fixture()
    for (let i = 0; i < 129; i++) t.connections.push({ ...structuredClone(t.connections[0]), id: `parallel${i}` })
    const simulation = simulate(t)
    const paths = traceFlow(t, simulation, 'h', '10.2.0.1')
    expect(paths).toHaveLength(128)
    expect(paths.every((path) => path.status === 'delivered' && path.traceComplete === false)).toBe(true)
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'b' }, '10.1.0.1').every((path) => path.traceComplete === false)).toBe(true)
    expect(propagateSites(t).selectionComplete).toBe(true)
  })
})
