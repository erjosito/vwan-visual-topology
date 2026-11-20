import { describe, expect, it } from 'vitest'
import { analyzeRouting, routingRevision, type DiagnosticsFinding } from './diagnostics'
import { example } from './model'
import { validateTopology } from './validation'
import { simulate } from './routing'
import { canAcknowledgeWarning, orderWarningFindings, vwanWarningToken } from './warning-triage'
import { parseWarningAcknowledgements, setWarningAcknowledgement, warningFingerprint } from './warning-acknowledgements'
import { parseAzNetTopology } from './azure-net/admission'
import { createEmptyAzNetTopology, AZURE_NET_SAMPLES } from './azure-net/model'
import { analyzeAzNetConnectivity, runAzNetDiagnostics, groupAzNetFindings } from './azure-net/diagnostics'
import { simulateAzNet } from './azure-net/engine'
import { azWarningToken } from './azure-net/warning-triage'
import { azRoutingInput } from './azure-net/routing-input'
import { parseCloudTopology } from './cloud/contracts'

function warning(id = 'accepted'): DiagnosticsFinding {
  return {
    id, rule: 'asymmetric', severity: 'warning', confidence: 'risk', title: 'Warning', detail: 'Explanation',
    source: { kind: 'spoke', id: example.spokes[0].id }, related: [{ kind: 'hub', id: example.hubs[0].id }],
    evidence: [{ code: 'route-selection', nodeId: example.hubs[0].id, prefix: '10.1.0.0/16' }],
    forward: [{ hubs: [example.hubs[0].id], connectionId: example.connections[0].id, status: 'delivered', steps: ['Display text'] }],
    reverse: [],
  }
}

describe('warning triage identity and admission', () => {
  it('is warning-only and refuses failures and unassessed evidence', () => {
    expect(canAcknowledgeWarning(warning())).toBe(true)
    for (const severity of ['error', 'info', 'unknown']) expect(canAcknowledgeWarning({ ...warning(), severity })).toBe(false)
    for (const category of ['network-unreachable', 'unreachable', 'connectivity-failure', 'routing-not-assessed', 'scale-limit']) {
      expect(canAcknowledgeWarning({ severity: 'warning', category })).toBe(false)
    }
    expect(canAcknowledgeWarning({ ...warning(), confidence: 'unknown' })).toBe(false)
    expect(canAcknowledgeWarning({ ...warning(), forward: [{ status: 'unknown', traceComplete: false }] })).toBe(false)
  })

  it('keeps grouped VWAN warnings stable across prose, presentation and member order, but not changed evidence', () => {
    const topology = structuredClone(example)
    const first = warning()
    const second = { ...warning('second'), destinationAddress: '10.2.0.1' }
    const grouped = { ...first, occurrences: [first, second] }
    const token = vwanWarningToken(topology, grouped)
    topology.name = '別の表示名'
    topology.hubs[0].name = '日本語のハブ'
    topology.hubs[0].label = 'Presentation'
    const renamed = { ...grouped, title: '別のタイトル', detail: '別の説明',
      occurrences: [second, { ...first, forward: first.forward.map((path) => ({ ...path, steps: ['翻訳された表示'] })) }] }
    expect(vwanWarningToken(topology, renamed)).toBe(token)
    expect(vwanWarningToken(topology, { ...grouped, occurrences: [first] })).not.toBe(token)
    expect(vwanWarningToken(topology, { ...grouped, occurrences: [first, { ...second, evidence: [{ code: 'new-cause', prefix: '10.3.0.0/16' }] }] })).not.toBe(token)
    topology.hubs[0].preference = topology.hubs[0].preference === 'ASPath' ? 'VPN' : 'ASPath'
    expect(vwanWarningToken(topology, grouped)).not.toBe(token)
  })

  it('invalidates changed referenced route-map rules, but not unrelated resource edits', () => {
    const topology = structuredClone(example)
    const finding = warning()
    topology.hubs[0].routeMapAssignments = [{ connectionId: topology.connections[0].id, inboundMapId: 'policy' }]
    topology.routeMaps = [{ id: 'policy', name: 'Shared policy', rules: [] }]
    const token = vwanWarningToken(topology, finding)
    topology.spokes[0].prefixes.push('172.31.0.0/24')
    expect(vwanWarningToken(topology, finding)).toBe(token)
    topology.routeMaps[0].rules.push({ id: 'rule', prefixes: ['10.0.0.0/8'], match: 'contains', action: 'drop',
      summaryPrefixes: [], prepend: [], nextStep: 'terminate' })
    expect(vwanWarningToken(topology, finding)).not.toBe(token)
  })

  it('persists only bounded design metadata and leaves native and VWAN routing/assessment unchanged', () => {
    const topology = structuredClone(example)
    const revision = routingRevision(topology)
    const routes = simulate(topology)
    const report = analyzeRouting(topology, { version: 1, intents: [], failureAnalysis: false })
    const token = vwanWarningToken(topology, warning())
    setWarningAcknowledgement(topology, token, true)
    setWarningAcknowledgement(topology, token, true)
    const restored = validateTopology(JSON.parse(JSON.stringify(topology)))
    expect(restored.warningAcknowledgements).toEqual([token])
    expect((parseCloudTopology({ version: 1, name: 'Saved', topology }).topology as typeof topology).warningAcknowledgements).toEqual([token])
    expect(routingRevision(topology)).toBe(revision)
    expect(simulate(topology)).toEqual(routes)
    expect(analyzeRouting(topology, { version: 1, intents: [], failureAnalysis: false })).toEqual(report)
    expect(validateTopology(example).warningAcknowledgements).toBeUndefined()
    setWarningAcknowledgement(topology, token, false)
    expect(topology.warningAcknowledgements).toBeUndefined()
    const native = createEmptyAzNetTopology()
    const nativeInput = azRoutingInput(native)
    const nativeToken = warningFingerprint('aznet', { id: 'native', route: '10.0.0.0/24' })
    setWarningAcknowledgement(native, nativeToken, true)
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(native))).warningAcknowledgements).toEqual([nativeToken])
    expect((parseCloudTopology({ version: 1, name: 'Saved native', topology: native }).topology as typeof native).warningAcknowledgements).toEqual([nativeToken])
    expect(azRoutingInput(native)).toEqual(nativeInput)
    expect(warningFingerprint('vwan', { id: 'native', route: '10.0.0.0/24' })).not.toBe(nativeToken)
  })

  it.each([{}, ['wrong'], ['warning:v1:aznet:bad'], Array(4097).fill('x')])('rejects malformed acknowledgement metadata (%j)', (value) => {
    expect(() => parseWarningAcknowledgements(value)).toThrow('Invalid warning acknowledgements')
    expect(() => validateTopology({ ...example, warningAcknowledgements: value })).toThrow()
    expect(() => parseAzNetTopology({ ...createEmptyAzNetTopology(), warningAcknowledgements: value })).toThrow()
  })

  it('rejects duplicate metadata and maintains active-before-acknowledged ordering', () => {
    const token = warningFingerprint('vwan', warning())
    expect(() => parseWarningAcknowledgements([token, token])).toThrow()
    const findings = [warning('acknowledged'), { ...warning('error'), severity: 'error' as const }, warning('active')]
    expect(orderWarningFindings(findings, (finding) => finding.id === 'acknowledged').map((finding) => finding.id)).toEqual(['error', 'active', 'acknowledged'])
    expect(findings[0].id).toBe('acknowledged')
  })
})

describe('native warning evidence', () => {
  it('preserves grouped flow acknowledgement across unchanged reanalysis and reordered occurrences', () => {
    const topology = structuredClone(AZURE_NET_SAMPLES.find((sample) => sample.id === 'hub-spoke-firewall-udr')!.topology)
    topology.sites[0].prefixes.push('172.16.11.0/24')
    const simulation = simulateAzNet(topology)
    const analysis = () => groupAzNetFindings(analyzeAzNetConnectivity(topology, simulation, { scope: 'all' }).findings)
    const finding = analysis().find((entry) => entry.category === 'asymmetric-firewall-bypass' && (entry.occurrences?.length ?? 0) > 1)!
    expect(finding).toBeDefined()
    expect(finding.occurrences!.length).toBeGreaterThan(1)
    const token = azWarningToken(topology, simulation, finding)
    expect(azWarningToken(topology, simulation, analysis().find((entry) => entry.id === finding.id)!)).toBe(token)
    expect(azWarningToken(topology, simulation, { ...finding, occurrences: [...finding.occurrences!].reverse() })).toBe(token)
    expect(azWarningToken(topology, simulation, { ...finding, occurrences: finding.occurrences!.slice(1) })).not.toBe(token)
  })

  it('keeps real warnings stable across names/order and reanalysis, but notices next-hop changes', () => {
    const topology = structuredClone(AZURE_NET_SAMPLES.find((sample) => sample.id === 'hub-spoke-firewall-udr')!.topology)
    topology.vnetPeerings[0].bToA.allowGatewayTransit = true
    topology.vnetPeerings[1].bToA.allowGatewayTransit = true
    const simulation = simulateAzNet(topology)
    const findings = groupAzNetFindings(runAzNetDiagnostics(topology, simulation, { includePairAnalysis: false }))
    const finding = findings.find((entry) => entry.severity === 'warning' && entry.id.includes('peering-agt-no-gw'))!
    expect(finding).toBeDefined()
    const token = azWarningToken(topology, simulation, finding)
    const renamed = structuredClone(topology)
    renamed.name = 'Renamed'
    for (const vnet of renamed.vnets) { vnet.name = `Renamed ${vnet.id}`; for (const subnet of vnet.subnets) {
      if (!['GatewaySubnet', 'AzureFirewallSubnet', 'RouteServerSubnet'].includes(subnet.name)) subnet.name = `Renamed ${subnet.id}`
    } }
    renamed.vnets.reverse()
    const renamedSimulation = simulateAzNet(renamed)
    const renamedFinding = groupAzNetFindings(runAzNetDiagnostics(renamed, renamedSimulation, { includePairAnalysis: false })).find((entry) => entry.id === finding.id)!
    expect(renamedFinding).toBeDefined()
    expect(azWarningToken(renamed, renamedSimulation, renamedFinding)).toBe(token)
    const other = findings.find((entry) => entry.severity === 'warning' && entry.id !== finding.id)!
    expect(other).toBeDefined()
    expect(azWarningToken(topology, simulation, other)).not.toBe(token)
    const changedSimulation = structuredClone(simulation)
    const table = Object.values(changedSimulation.subnetTables).find((entry) => entry.vnetId === finding.vnetId)!
    expect(table).toBeDefined()
    table.routes[0].nextHopIp = '10.0.1.99'
    expect(azWarningToken(topology, changedSimulation, finding)).not.toBe(token)
  })
})
