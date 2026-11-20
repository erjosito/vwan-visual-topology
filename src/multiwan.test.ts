import { beforeAll, describe, expect, it } from 'vitest'
import { largeVwanCapture } from '../tests/large-vwan-fixture'
import { federationFixture } from '../tests/federation-fixture'
import { importAzureCapture } from './azure-import'
import { validateTopology } from './validation'
import { simulate, traceFlow } from './routing'
import { bicepDefaults, generateBicep } from './bicep-export'
import { executePlatform } from './platform/service'
import { diagramLayout } from './diagram-layout'
import type { Topology } from './model'

function native() {
  return importAzureCapture(federationFixture())
}
function forward(topology: Topology, hub = topology.hubs[1].id) {
  return traceFlow(topology, simulate(topology), hub, '10.102.0.4')
}

describe('explicit bounded two-WAN S2S composition', () => {
  it('preserves ownership, both provenance inventories and gateway hops on forward and return paths', () => {
    const topology = native()
    expect(topology.wans).toHaveLength(2)
    expect(topology.azureImport?.wanIds).toHaveLength(2)
    expect(topology.azureImport?.tables).toHaveLength(4)
    expect(JSON.stringify(validateTopology(JSON.parse(JSON.stringify(topology))))).toBe(JSON.stringify(topology))
    const simulation = simulate(topology)
    expect(simulation.converged).toBe(true)
    expect(forward(topology)).toMatchObject([{ status: 'delivered', hubs: [topology.hubs[1].id, topology.hubs[0].id, topology.hubs[2].id, topology.hubs[3].id] }])
    expect(traceFlow(topology, simulation, topology.hubs[3].id, '10.2.0.4')).toMatchObject([
      { status: 'delivered', hubs: [topology.hubs[3].id, topology.hubs[2].id, topology.hubs[0].id, topology.hubs[1].id] },
    ])
    expect(simulation.warnings.join(' ')).toContain('P2S')
  })

  it('has no implicit inter-WAN mesh and respects disabled tunnels and directional exports', () => {
    const topology = native()
    topology.interWanVpns = []
    expect(forward(topology)[0].status).toBe('unreachable')
    topology.interWanVpns = native().interWanVpns
    topology.interWanVpns![0].enabled = false
    expect(forward(topology)[0].status).toBe('unreachable')
    topology.interWanVpns![0].enabled = true
    topology.interWanVpns![0].bToA = []
    expect(forward(topology)[0].status).toBe('unreachable')
    expect(traceFlow(topology, simulate(topology), topology.hubs[3].id, '10.2.0.4')[0].status).toBe('delivered')
  })

  it('does not re-export VPN routes or invent P2S/unknown capture reachability', () => {
    const p2s = federationFixture()
    p2s.captures[1].hubs[0].gatewayTypes = ['P2S']
    const importedP2s = importAzureCapture(p2s)
    expect(forward(importedP2s)[0].status).toBe('unknown')
    expect(importedP2s.azureImport?.warnings.join(' ')).toContain('P2S gateway connectivity is not reconstructed')
    const topology = native()
    topology.interWanVpns![0].status = 'unknown'
    expect(forward(topology)[0]).toMatchObject({ status: 'unknown', traceComplete: false })
    topology.interWanVpns![0].status = 'configured'
    topology.azureImport!.hubs[2].routingScopeComplete = false
    expect(forward(topology)[0].status).toBe('unknown')
    expect(simulate(native()).tables[native().hubs[0].id].find((row) => row.prefix === '10.2.0.0/24')?.selected[0].interWanVpnId).toBeUndefined()
  })

  it('scopes branch transit independently without suppressing VNet-to-VPN traffic', () => {
    const topology = native()
    topology.sites.push({ id: 'branch', name: 'Declared branch', asn: 65001, prefixes: ['192.0.2.0/24'] })
    topology.connections.push({ id: 'branch-vpn', name: 'Branch VPN', hubId: topology.hubs[0].id,
      siteId: 'branch', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] })
    topology.interWanVpns![0].aToB.push('192.0.2.0/24')
    const branch = () => traceFlow(topology, simulate(topology), topology.hubs[3].id, '192.0.2.4')[0].status
    expect(branch()).toBe('delivered')
    topology.wans![0].allowBranchToBranchTraffic = false
    expect(branch()).toBe('unreachable')
    expect(forward(topology)[0].status).toBe('delivered')
    topology.wans![0].allowBranchToBranchTraffic = true
    topology.wans![1].allowBranchToBranchTraffic = false
    expect(branch()).toBe('delivered')
  })

  it('rejects invalid ownership, peer bindings, ambiguous duplicate captures and unsupported default export', () => {
    const topology = native()
    expect(() => validateTopology({ ...topology, hubs: topology.hubs.map((hub, i) => i ? hub : { ...hub, wanId: undefined }) })).toThrow(/scoped hub/)
    expect(() => validateTopology({ ...topology, interWanVpns: [{ ...topology.interWanVpns![0], bHubId: topology.hubs[1].id }] })).toThrow(/different explicit WAN/)
    expect(() => validateTopology({ ...topology, interWanVpns: [{ ...topology.interWanVpns![0], aToB: ['0.0.0.0/0'] }] })).toThrow(/default-route/)
    const fixture = federationFixture()
    fixture.captures[1] = fixture.captures[0]
    expect(() => importAzureCapture(fixture)).toThrow(/different WANs/)
    expect(() => generateBicep(topology, bicepDefaults(topology))).toThrow(/Federated WAN/)
  })

  it('preserves future scope/hub/VPN fields through native reload', () => {
    const topology = native()
    Object.assign(topology.wans![0], { futureScope: { value: 1 } })
    Object.assign(topology.hubs[0], { futureHub: 'retained' })
    Object.assign(topology.interWanVpns![0], { futureTunnel: ['retained'] })
    const reloaded = validateTopology(JSON.parse(JSON.stringify(topology)))
    expect(reloaded.wans![0]).toHaveProperty('futureScope.value', 1)
    expect(reloaded.hubs[0]).toHaveProperty('futureHub', 'retained')
    expect(reloaded.interWanVpns![0]).toHaveProperty('futureTunnel', ['retained'])
  })
})

describe.each([501, 1000])('greater than 500 VNet envelope (%i references)', (count) => {
  let topology: Topology
  beforeAll(() => { topology = importAzureCapture(largeVwanCapture(count, 4, 1)) })
  it('retains the complete inventory and bounded layouts on native reload', () => {
    expect(topology.spokes).toHaveLength(count)
    for (const mode of ['layered', 'constellation'] as const) {
      const layout = diagramLayout(topology, mode)
      expect(layout.positions.size).toBe(count + 4)
      expect(Math.max(layout.width, layout.height)).toBeLessThan(20000)
      topology.layout = { mode, positions: { [mode]: Object.fromEntries(layout.positions) } }
      expect(validateTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    }
  })
  it('respects the independent unchanged headless node admission', () => {
    const validation = executePlatform({ contractVersion: 1, operation: 'validate', document: { mode: 'vwan', topology } })
    if (count === 501) {
      expect(validation.errors).toEqual([])
      expect(validation.status).toBe('complete')
    } else {
      expect(validation.status).toBe('invalid')
      expect(validation.errors[0].message).toContain('Topology node limit')
    }
  })
  it('forwards a representative cross-hub route without dropping the additional VNets', () => {
    const simulation = simulate(topology)
    expect(simulation.converged).toBe(true)
    expect(traceFlow(topology, simulation, topology.hubs[0].id, '172.20.1.4')[0].status).toBe('delivered')
  })
})
