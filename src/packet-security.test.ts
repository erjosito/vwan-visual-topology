import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { pruneDeletedInventory, validateInventory, type NetworkSecurityRule } from './inventory'
import { assessEndpointNsg, assessNsg, type NsgContext } from './packet-security'
import type { FiveTuple } from './packet-flow'

const owner = { kind: 'vnet' as const, id: 'network' }
const tuple: FiveTuple = { sourceAddress: '8.8.8.8', destinationAddress: '10.1.1.4', sourcePort: 49152, destinationPort: 443, protocol: 'tcp' }
const context: NsgContext = { virtualNetworkPrefixes: ['10.1.0.0/16'], virtualNetworkComplete: true }
function rule(edit: Partial<NetworkSecurityRule> = {}): NetworkSecurityRule {
  return { id: 'allow-web', name: 'AllowWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
    sources: ['*'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['443'], ...edit }
}
function network() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] }]
  topology.inventory = { workloads: [{ id: 'client', name: 'Client', nicIds: ['nic'] }],
    nics: [{ id: 'nic', name: 'NIC', owner, ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] }],
    publicIps: [], networkSecurityGroups: [{ id: 'subnet-nsg', name: 'Subnet NSG', rules: [rule()] }, { id: 'nic-nsg', name: 'NIC NSG', rules: [] }],
    nsgAssociations: [{ owner, target: { kind: 'subnet', id: 'app' }, nsgId: 'subnet-nsg' }, { owner, target: { kind: 'nic', id: 'nic' }, nsgId: 'nic-nsg' }] }
  return topology
}

describe('scoped NSG new-flow enforcement', () => {
  it('intersects subnet and NIC permission at their ordered original enforcement points', () => {
    const topology = parseAzNetTopology(network())
    const blocked = assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context)
    expect(blocked).toMatchObject({ outcome: 'denied', checks: [
      { target: { kind: 'subnet', id: 'app' }, outcome: 'allowed', ruleId: 'allow-web', tuple },
      { target: { kind: 'nic', id: 'nic' }, outcome: 'denied', ruleId: 'DenyAllInbound' },
    ] })
    topology.inventory!.networkSecurityGroups![1].rules.push(rule())
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context).outcome).toBe('allowed')
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'outbound', { ...tuple, sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8' }, context))
      .toMatchObject({ outcome: 'allowed', checks: [{ target: { kind: 'nic' } }, { target: { kind: 'subnet' } }] })
  })

  it('uses first priority, direction and augmented port matching rather than a later allow', () => {
    const rules = [rule({ id: 'later', name: 'Later', priority: 200 }), rule({ action: 'deny', destinationPorts: ['80-100', '440-450'] })]
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules }, 'inbound', tuple, context)).toMatchObject({ outcome: 'denied', priority: 100 })
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules }, 'outbound',
      { ...tuple, sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8' }, context).outcome).toBe('allowed')
  })

  it('does not generalize Standard public ingress absence to internal or outbound flows', () => {
    const topology = network()
    delete topology.inventory!.nsgAssociations
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context).outcome).toBe('allowed')
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, { ...context, standardPublicIngress: true }).outcome).toBe('denied')
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'outbound', tuple, context).outcome).toBe('allowed')
    expect(assessNsg({ id: 'nsg', name: 'Default-only', rules: [] }, 'inbound', tuple, context).outcome).toBe('denied')
  })

  it('resolves VirtualNetwork from its scoped prefix set, not RFC1918, and preserves incomplete scope', () => {
    const group = { id: 'nsg', name: 'NSG', rules: [] }
    expect(assessNsg(group, 'inbound', { ...tuple, sourceAddress: '10.1.2.4' }, context).outcome).toBe('allowed')
    expect(assessNsg(group, 'inbound', { ...tuple, sourceAddress: '10.90.2.4' }, context).outcome).toBe('denied')
    expect(assessNsg(group, 'inbound', tuple, { ...context, virtualNetworkPrefixes: ['0.0.0.0/0'] }).outcome).toBe('allowed')
    expect(assessNsg(group, 'inbound', tuple, { ...context, virtualNetworkComplete: false }).outcome).toBe('not-assessed')
  })

  it('does not allow public clients because an AzureLoadBalancer probe rule allows probes', () => {
    const group = { id: 'nsg', name: 'NSG', rules: [rule({ sources: ['AzureLoadBalancer'] })] }
    expect(assessNsg(group, 'inbound', tuple, context).outcome).toBe('denied')
    expect(assessNsg(group, 'inbound', { ...tuple, sourceAddress: '168.63.129.16' }, { ...context, purpose: 'health-probe' }))
      .toMatchObject({ outcome: 'allowed', ruleId: 'allow-web' })
  })

  it('never treats unknown capture, dynamic tags, ASGs or unsupported protocol as wildcard permission', () => {
    for (const change of [
      { sources: ['Storage.WestEurope'] }, { sources: ['asg:original-group'] }, { protocol: 'icmp' as const },
    ]) {
      expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule(change)] }, 'inbound', tuple, context).outcome).toBe('not-assessed')
    }
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule()], rulesStatus: 'unknown' }, 'inbound', tuple, context).outcome).toBe('not-assessed')
    const topology = network()
    topology.inventory!.nsgAssociations![1].status = 'unknown'
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context).outcome).toBe('not-assessed')
  })

  it('does not compare illustrative private SNAT addresses/ports as exact values', () => {
    const translated = { ...tuple, sourceAddress: '10.1.2.4', sourcePort: 12345 }
    const uncertain: NsgContext = { ...context, uncertainty: { sourceAddressPrefixes: ['10.1.2.0/24'], sourcePorts: [0, 65535] } }
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule({ sources: ['10.1.2.4'], sourcePorts: ['12345'] })] },
      'inbound', translated, uncertain).outcome).toBe('not-assessed')
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule({ sources: ['10.1.2.0/24'] })] }, 'inbound', translated, uncertain).outcome).toBe('allowed')
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule({ sources: ['192.0.2.0/24'] })] }, 'inbound', translated, uncertain).ruleId).toBe('AllowVNetInBound')
  })

  it('rejects malformed/duplicate rules and associations while preserving supported original serialization', () => {
    const topology = network(), raw = JSON.stringify(topology)
    expect(JSON.stringify(parseAzNetTopology(topology))).toBe(raw)
    for (const mutate of [
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules.push(rule({ id: 'other', name: 'Other' })) },
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules[0].destinationPorts = ['65535-65536'] },
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules[0].sources = ['10.999.0.0/24'] },
      (topology: ReturnType<typeof network>) => { topology.inventory!.nsgAssociations![0].target.id = 'missing' },
      (topology: ReturnType<typeof network>) => { topology.inventory!.nsgAssociations!.push(structuredClone(topology.inventory!.nsgAssociations![0])) },
    ]) {
      const next = network(); mutate(next)
      expect(() => validateInventory(next)).toThrow(/Inventory:/)
    }
    const next = structuredClone(topology)
    next.inventory!.nics = []
    pruneDeletedInventory(next, topology)
    expect(next.inventory!.nsgAssociations!.map((binding) => binding.target.kind)).toEqual(['subnet'])
    expect(next.inventory!.networkSecurityGroups).toHaveLength(2)
  })
})
