import { describe, expect, it } from 'vitest'
import { parseAzNetTopology } from './admission'
import { generateAzNetBicep } from './bicep-export'
import { simulateAzNet, traceAzNetPair } from './engine'
import { sampleDualHubVnraGlobalPeering } from './model'
import { saveManagedVnra } from './vnra-authoring'

const original = () => structuredClone(sampleDualHubVnraGlobalPeering)
const input = { id: 'authored-vnra', name: 'Authored VNRA', privateIp: '10.10.2.4', subnetId: 'sub-r1-vnra' }

describe('Managed VNRA authoring', () => {
  it('creates only the explicitly requested subnet and appliance, with no BGP or inspection configuration', () => {
    const topology = original()
    const hub = topology.vnets[0]
    hub.appliances = []
    hub.subnets = []
    const before = structuredClone(topology)
    saveManagedVnra(topology, hub.id, { ...input, subnetId: undefined, newSubnetPrefix: '10.10.2.0/27' })
    expect(hub.subnets).toEqual([{ id: `${input.id}-subnet`, name: 'VirtualNetworkApplianceSubnet', prefix: '10.10.2.0/27' }])
    expect(hub.appliances).toEqual([{
      id: input.id, name: input.name, kind: 'vnra', subnetId: `${input.id}-subnet`, privateIp: input.privateIp,
      enableIpForwarding: true, inspectsTraffic: false, staticRoutes: [],
    }])
    expect({ ...topology, vnets: before.vnets }).toEqual(before)
    expect(topology.vnets.slice(1)).toEqual(before.vnets.slice(1))
  })

  it.each([
    { ...input, subnetId: 'sub-r2-vnra' },
    { ...input, privateIp: '10.10.3.4' },
    { ...input, privateIp: '10.10.2.3' },
    { ...input, privateIp: '10.10.2.255' },
    { ...input, privateIp: 'not-an-address' },
    { ...input, privateIp: '10.10.2.4' },
    { ...input, subnetId: undefined, newSubnetPrefix: '10.10.3.0/27' },
  ])('rejects invalid ownership, reserved/duplicate addresses and duplicate dedicated subnets atomically: %j', (value) => {
    const topology = original()
    const before = structuredClone(topology)
    expect(() => saveManagedVnra(topology, topology.vnets[0].id, value)).toThrow()
    expect(topology).toEqual(before)
  })

  it.each(['10.11.2.0/27', '10.10.2.4/27', '10.10.2.0/30', '10.10.0.0/22'])('rejects outside, malformed, too-small and overlapping new subnets: %s', (prefix) => {
    const topology = original()
    topology.vnets[0].appliances = []
    topology.vnets[0].subnets = [{ id: 'work', name: 'Workloads', prefix: '10.10.1.0/24' }]
    const before = structuredClone(topology)
    expect(() => saveManagedVnra(topology, topology.vnets[0].id, { ...input, subnetId: undefined, newSubnetPrefix: prefix })).toThrow()
    expect(topology).toEqual(before)
  })

  it('rejects a service subnet shared with an unrelated appliance', () => {
    const topology = original()
    topology.vnets[0].appliances[0].kind = 'nva-vm'
    expect(() => saveManagedVnra(topology, topology.vnets[0].id, { ...input, privateIp: '10.10.2.5' })).toThrow('dedicated')
  })

  it('edits the original identity without enabling disabled forwarding or changing kind and routes', () => {
    const topology = original()
    const app = topology.vnets[0].appliances[0]
    app.enableIpForwarding = false
    const before = structuredClone(topology)
    saveManagedVnra(topology, topology.vnets[0].id, { ...input, id: app.id, name: 'Renamed VNRA', privateIp: '10.10.2.5' })
    expect(app).toEqual({ ...before.vnets[0].appliances[0], name: 'Renamed VNRA', privateIp: '10.10.2.5' })
    expect(topology.vnets[0].subnets).toEqual(before.vnets[0].subnets)
    expect(topology.udrTables).toEqual(before.udrTables)
  })

  it('round-trips authored VNRAs through admission and traces both directions with original appliance witnesses', () => {
    const topology = original()
    for (const [index, vnet] of topology.vnets.slice(0, 2).entries()) {
      const source = vnet.appliances[0]
      vnet.appliances = []
      saveManagedVnra(topology, vnet.id, { id: `authored-${index}`, name: source.name, privateIp: source.privateIp, subnetId: source.subnetId })
    }
    const restored = parseAzNetTopology(JSON.parse(JSON.stringify(topology)))
    expect(restored).toEqual(topology)
    const pair = traceAzNetPair(restored, simulateAzNet(restored),
      { kind: 'subnet', vnetId: 'vnet-spoke-r1-a', subnetId: 'sub-r1a-work' }, '10.11.1.4',
      { kind: 'subnet', vnetId: 'vnet-spoke-r2-b', subnetId: 'sub-r2b-work' }, '10.21.1.4')
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).toBe('delivered')
    expect(pair.forward.traversedApplianceIds).toEqual(['authored-0', 'authored-1'])
    expect(pair.reverse.traversedApplianceIds).toEqual(['authored-1', 'authored-0'])
    expect(generateAzNetBicep(restored).warnings).toContainEqual(expect.stringContaining('Managed VNRA appliances are not deployed'))
  })
})
