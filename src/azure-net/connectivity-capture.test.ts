import { describe, expect, it } from 'vitest'
import { importAzNetCapture } from './azure-import'
import { parseAzNetTopology } from './admission'
import { executePlatform } from '../platform/service'
import type { PacketRequirement } from '../platform/contract'
import { azureObjectId } from '../azure-import'
import { generateAzNetBicep } from './bicep-export'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const subscription = '11111111-1111-1111-1111-111111111111'
const prefix = `/subscriptions/${subscription}/resourceGroups/network/providers/Microsoft.Network`
const vnet = `${prefix}/virtualNetworks/network`, subnet = `${vnet}/subnets/app`, nic = `${prefix}/networkInterfaces/server`
const ip = `${nic}/ipConfigurations/primary`, vm = `/subscriptions/${subscription}/resourceGroups/network/providers/Microsoft.Compute/virtualMachines/server`
const nsg = `${prefix}/networkSecurityGroups/backend`, pip = `${prefix}/publicIPAddresses/frontend`
const lb = `${prefix}/loadBalancers/service`, frontend = `${lb}/frontendIPConfigurations/public`, pool = `${lb}/backendAddressPools/servers`
const probe = `${lb}/probes/health`
function saveBicep(name: string, text: string) {
  const directory = resolve('test-artifacts', 'azure-files', 'bicep')
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, name), text)
}
function capture() {
  const sections = Object.fromEntries(['account', 'vnets', 'routeTables', 'vnetGateways', 'localNetworkGateways', 'vpnConnections', 'routeServers',
    'privateEndpoints', 'networkInterfaces', 'publicIpAddresses', 'publicIpPrefixes', 'natGateways', 'virtualMachines', 'networkSecurityGroups',
    'loadBalancers', 'azureFirewalls', 'firewallPolicies'].map((key) => [key, { state: 'succeeded', complete: true }]))
  return { kind: 'azure-network-capture', version: 2, observationVersion: 1, connectivityVersion: 1,
    subscriptionId: subscription, resourceGroup: 'network', context: { cloud: 'AzureCloud', subscriptionId: subscription },
    configurationComplete: true, sections, warnings: [],
    vnets: [{ id: vnet, name: 'Original network', location: 'westeurope', addressSpace: { addressPrefixes: ['10.1.0.0/16'] },
      subnets: [{ id: subnet, name: 'Application', addressPrefix: '10.1.1.0/24', defaultOutboundAccess: false }] }],
    networkInterfaces: [{ id: nic, name: 'Original NIC', virtualMachine: { id: vm }, networkSecurityGroup: { id: nsg },
      ipConfigurations: [{ id: ip, name: 'Primary', subnet: { id: subnet }, privateIPAddress: '10.1.1.4', primary: true }] }],
    virtualMachines: [{ id: vm, name: 'Original server', networkProfile: { networkInterfaces: [{ id: nic }] } }],
    networkSecurityGroups: [{ id: nsg, name: 'Backend', securityRules: [{ id: `${nsg}/securityRules/AllowWeb`, name: 'AllowWeb', priority: 100,
      direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '8.8.8.8/32', destinationAddressPrefix: '10.1.1.4',
      sourcePortRange: '*', destinationPortRange: '8443' }] }],
    publicIpAddresses: [{ id: pip, name: 'Frontend allocation', sku: { name: 'Standard' }, publicIPAllocationMethod: 'Static',
      ipAddress: '20.40.50.60', ipConfiguration: { id: frontend } }],
    loadBalancers: [{ id: lb, name: 'Original service', sku: { name: 'Standard' },
      frontendIPConfigurations: [{ id: frontend, name: 'Public', publicIPAddress: { id: pip } }],
      backendAddressPools: [{ id: pool, name: 'Original servers', backendIPConfigurations: [{ id: ip }] }],
      probes: [{ id: probe, name: 'Health', protocol: 'Tcp', port: 8080 }],
      loadBalancingRules: [{ id: `${lb}/loadBalancingRules/web`, name: 'Web', frontendIPConfiguration: { id: frontend },
        backendAddressPool: { id: pool }, probe: { id: probe }, protocol: 'Tcp', frontendPort: 443, backendPort: 8443, disableOutboundSnat: true }],
      inboundNatRules: [], outboundRules: [] }],
    publicIpPrefixes: [], natGateways: [], azureFirewalls: [], firewallPolicies: [] as Record<string, unknown>[],
    firewallPolicyRuleCollectionGroups: [] as Record<string, unknown>[] }
}
function requirements(): PacketRequirement[] {
  const packet = { source: { kind: 'external' as const, address: '8.8.8.8' }, target: { kind: 'public-ip' as const, publicIpId: azureObjectId('pip', pip) },
    protocol: 'tcp' as const, sourcePort: 49152, destinationPort: 443 }
  return ['configured', 'blocked'].map((expectation) => ({ id: expectation, kind: 'packet', packet,
    sourceAddress: '8.8.8.8', destinationAddress: '20.40.50.60', expectation: expectation as PacketRequirement['expectation'] }))
}
function firewallCapture() {
  const root = capture(), firewall = `${prefix}/azureFirewalls/service`
  root.loadBalancers = []
  root.vnets[0].subnets.push({ id: `${vnet}/subnets/AzureFirewallSubnet`, name: 'AzureFirewallSubnet', addressPrefix: '10.1.2.0/24', defaultOutboundAccess: false })
  root.networkSecurityGroups[0].securityRules[0].sourceAddressPrefix = '10.1.2.0/24'
  root.publicIpAddresses[0].ipConfiguration.id = `${firewall}/azureFirewallIpConfigurations/public`
  return { ...root, azureFirewalls: [{ id: firewall, name: 'Original Firewall', sku: { name: 'AZFW_VNet', tier: 'Standard' },
    ipConfigurations: [{ id: `${firewall}/azureFirewallIpConfigurations/public`, name: 'Public',
      subnet: { id: `${vnet}/subnets/AzureFirewallSubnet` }, privateIPAddress: '10.1.2.4', publicIPAddress: { id: pip } }],
    natRuleCollections: [{ name: 'OriginalInbound', priority: 200, action: { type: 'Dnat' },
      rules: [{ name: 'OriginalWeb', protocols: ['TCP'], sourceAddresses: ['8.8.8.8'], destinationAddresses: ['20.40.50.60'],
        destinationPorts: ['443'], translatedAddress: '10.1.1.4', translatedPort: '8443' }] }] }] }
}

describe('original configuration-only connectivity capture admission', () => {
  it('preserves real VM/NIC/PIP/NSG/LB identity and native provenance without inventing health', () => {
    const imported = importAzNetCapture(capture())
    expect(imported.unknownAddressing).toEqual([])
    const topology = imported.topology, inventory = topology.inventory!
    expect(inventory.capture?.configurationComplete).toBe(true)
    expect(inventory.capture?.resourceIds[azureObjectId('vm', vm)]).toBe(vm)
    expect(inventory.capture?.resourceIds[azureObjectId('ipconfig', ip)]).toBe(ip)
    expect(inventory.capture?.resourceIds[topology.vnets[0].id]).toBe(vnet)
    expect(inventory.capture?.resourceIds[topology.vnets[0].subnets[0].id]).toBe(subnet)
    expect(inventory.workloads[0]).toMatchObject({ id: azureObjectId('vm', vm), name: 'Original server', nicIds: [azureObjectId('nic', nic)] })
    expect(inventory.loadBalancers![0].pools[0].members[0]).toEqual({ workloadId: azureObjectId('vm', vm),
      nicId: azureObjectId('nic', nic), ipConfigurationId: azureObjectId('ipconfig', ip) })
    expect(inventory.loadBalancers![0].probes[0].health[0].status).toBe('unknown')
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology))).inventory).toEqual(inventory)
    const request = { contractVersion: 1 as const, operation: 'evaluate' as const, document: { mode: 'full' as const, topology }, requirements: requirements() }
    expect(executePlatform(request).assessments.map((assessment) => assessment.outcome)).toEqual(['not assessed', 'not assessed'])
    inventory.loadBalancers![0].probes[0].health[0].status = 'healthy'
    expect(executePlatform(request).assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied', 'violated'])
  })

  it.each(['networkInterfaces', 'virtualMachines', 'networkSecurityGroups', 'loadBalancers'])('never turns denied %s capture into proven no ingress or no egress', (section) => {
    const root = capture()
    root.sections[section] = { state: 'denied', complete: false }
    ;(root as Record<string, unknown>)[section] = []
    root.configurationComplete = false
    const topology = importAzNetCapture(root).topology
    expect(topology.inventory!.capture!.configurationComplete).toBe(false)
    const assessments = executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: requirements() }).assessments
    expect(assessments.map((assessment) => assessment.outcome)).toEqual(['not assessed', 'not assessed'])
    if (section !== 'virtualMachines' && section !== 'networkInterfaces') {
      const inventory = topology.inventory!, egress: PacketRequirement = { id: 'egress-not-isolation', kind: 'packet', expectation: 'blocked',
        sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8', packet: { source: { kind: 'workload', workloadId: inventory.workloads[0].id,
          nicId: inventory.nics[0].id, ipConfigurationId: inventory.nics[0].ipConfigurations[0].id }, target: { kind: 'external', address: '8.8.8.8' },
          protocol: 'tcp', sourcePort: 49152, destinationPort: 443 } }
      expect(executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: [egress] }).assessments[0].outcome).toBe('not assessed')
    }
  })

  it('rejects future support versions and retains legacy archives without newly fabricating workloads', () => {
    const root = capture()
    root.connectivityVersion = 2
    expect(() => importAzNetCapture(root)).toThrow('Unsupported connectivity capture version')
    const legacy = { ...root, connectivityVersion: undefined }
    const inventory = importAzNetCapture(legacy).topology.inventory!
    expect(inventory.workloads).toEqual([])
    expect(inventory.nics).toEqual([])
    expect(inventory.capture).toBeUndefined()
  })

  it('requires an actual correctly typed VM observation, not a NIC reference or a differently typed resource', () => {
    const root = capture()
    root.virtualMachines[0].id = `${prefix}/networkSecurityGroups/not-a-vm`
    const inventory = importAzNetCapture(root).topology.inventory!
    expect(inventory.workloads).toEqual([])
    expect(inventory.capture!.configurationComplete).toBe(false)
  })

  it('imports original legacy Firewall DNAT configuration and its backend/response without inventing a VM for the Firewall', () => {
    const imported = importAzNetCapture(firewallCapture()), inventory = imported.topology.inventory!
    expect(imported.unknownAddressing).toEqual([])
    expect(inventory.workloads).toHaveLength(1)
    expect(imported.topology.vnets[0].appliances[0]).toMatchObject({ id: azureObjectId('fw', `${prefix}/azureFirewalls/service`), kind: 'azure-firewall' })
    const policy = inventory.routerDnatPolicies![0]
    expect(policy.rules[0]).toMatchObject({ target: {
      workloadId: azureObjectId('vm', vm), nicId: azureObjectId('nic', nic), ipConfigurationId: azureObjectId('ipconfig', ip) },
      frontendPort: 443, translatedPort: 8443 })
    expect(inventory.capture!.resourceIds[policy.rules[0].id]).toBe(`${prefix}/azureFirewalls/service`)
    const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology: imported.topology }, requirements: requirements() })
    expect(result.errors).toEqual([])
    expect(result.assessments.map((assessment) => assessment.outcome), JSON.stringify(result.assessments)).toEqual(['satisfied', 'violated'])
  })

  it('keeps unobserved inherited Firewall policy unknown instead of importing a local empty allow/deny conclusion', () => {
    const root = firewallCapture(), policy = `${prefix}/firewallPolicies/original`
    ;(root.azureFirewalls[0] as Record<string, unknown>).firewallPolicy = { id: policy }
    ;(root as Record<string, unknown>).firewallPolicies = [{ id: policy, name: 'Original', basePolicy: { id: `${prefix}/firewallPolicies/parent` } }]
    const topology = importAzNetCapture(root).topology
    expect(topology.inventory!.capture!.configurationComplete).toBe(false)
    expect(topology.inventory!.routerDnatPolicies![0].rulesStatus).toBe('unknown')
    expect(executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: requirements() })
      .assessments.map((assessment) => assessment.outcome)).toEqual(['not assessed', 'not assessed'])
  })

  it('imports non-inherited policy groups in original priority order and retains group provenance', () => {
    const root = firewallCapture(), policy = `${prefix}/firewallPolicies/original`, group = `${policy}/ruleCollectionGroups/inbound`
    ;(root.azureFirewalls[0] as Record<string, unknown>).firewallPolicy = { id: policy }
    root.firewallPolicies = [{ id: policy, name: 'original' }]
    root.sections['firewallPolicyRuleCollectionGroups:original'] = { state: 'succeeded', complete: true }
    root.firewallPolicyRuleCollectionGroups = [{ policyId: policy, groups: [
      { id: `${policy}/ruleCollectionGroups/later`, name: 'later', priority: 300, ruleCollections: [{
        ...root.azureFirewalls[0].natRuleCollections[0], ruleCollectionType: 'FirewallPolicyNatRuleCollection',
        rules: [{ ...root.azureFirewalls[0].natRuleCollections[0].rules[0], translatedPort: '8444' }] }] },
      { id: group, name: 'inbound', priority: 200,
        ruleCollections: [{ ...root.azureFirewalls[0].natRuleCollections[0], ruleCollectionType: 'FirewallPolicyNatRuleCollection' }] }] }]
    const topology = importAzNetCapture(root).topology, inventory = topology.inventory!
    expect(inventory.capture!.configurationComplete).toBe(true)
    expect(inventory.capture!.resourceIds[inventory.routerDnatPolicies![0].rules[0].id]).toBe(group)
    expect(executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: requirements() })
      .assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied', 'violated'])
    root.sections['firewallPolicyRuleCollectionGroups:original'] = { state: 'denied', complete: false }
    expect(importAzNetCapture(root).topology.inventory!.routerDnatPolicies![0].rulesStatus).toBe('unknown')
  })

  it.each(['Basic', 'unknown'])('keeps unsupported Firewall tier %s unassessed', (tier) => {
    const root = firewallCapture()
    root.azureFirewalls[0].sku.tier = tier
    const topology = importAzNetCapture(root).topology
    expect(topology.inventory!.capture!.configurationComplete).toBe(false)
    expect(topology.vnets[0].appliances).toEqual([])
  })

  it('retains reserved-subnet NSG references as explicitly unsupported instead of failing inventory admission', () => {
    const root = firewallCapture()
    ;(root.vnets[0].subnets[1] as Record<string, unknown>).networkSecurityGroup = { id: nsg }
    const inventory = importAzNetCapture(root).topology.inventory!
    expect(inventory.capture!.configurationComplete).toBe(false)
    expect(inventory.nsgAssociations!.find((association) => association.target.kind === 'subnet')).toMatchObject({
      nsgId: azureObjectId('nsg', nsg), status: 'unknown' })
  })

  it('does not interpret a missing new-schema configuration list as successful empty capture', () => {
    const root = capture()
    delete (root as Record<string, unknown>).loadBalancers
    expect(importAzNetCapture(root).topology.inventory!.capture!.configurationComplete).toBe(false)
  })

  it('rejects a valid child identity attached to a different original NIC parent', () => {
    const root = capture()
    root.networkInterfaces[0].ipConfigurations[0].id = `${prefix}/networkInterfaces/other/ipConfigurations/primary`
    const inventory = importAzNetCapture(root).topology.inventory!
    expect(inventory.capture!.configurationComplete).toBe(false)
    expect(inventory.nics).toEqual([])
    expect(inventory.workloads).toEqual([])
  })

  it('exports supported NSG/NIC/LB declarations without read-only membership, health, source public address or invented VM configuration', () => {
    const topology = importAzNetCapture(capture()).topology
    const lb = topology.inventory!.loadBalancers![0], target = lb.pools[0].members[0]
    lb.inboundNatRules.push({ id: 'admin', name: 'Admin', frontendId: lb.frontends[0].id, poolId: lb.pools[0].id,
      target, protocol: 'tcp', frontendPort: 2222, backendPort: 22 })
    lb.outboundRules.push({ id: 'outbound', name: 'Outbound', frontendIds: [lb.frontends[0].id], poolId: lb.pools[0].id, protocol: 'any' })
    topology.inventory!.networkSecurityGroups![0].rules[0].sourcePorts = ['49152', '50000-51000']
    topology.inventory!.nsgAssociations!.push({ owner: topology.inventory!.nics[0].owner,
      target: { kind: 'subnet', id: topology.inventory!.nics[0].ipConfigurations[0].subnetId }, nsgId: topology.inventory!.networkSecurityGroups![0].id })
    const exported = generateAzNetBicep(topology)
    expect(exported.text).toContain("Microsoft.Network/networkInterfaces@2024-07-01")
    expect(exported.text).toContain('loadBalancerBackendAddressPools: [')
    expect(exported.text).toContain('loadBalancerInboundNatRules: [')
    expect(exported.text).toContain('disableOutboundSnat: true')
    expect(exported.text).toContain('networkSecurityGroup: { id:')
    expect(exported.text).toContain('sourcePortRanges: [')
    expect(exported.text).not.toMatch(/backendIPConfigurations:|backendIPConfiguration:|virtualMachines@|osProfile:|20\.40\.50\.60|health:/)
    expect(exported.warnings.join(' ')).toContain('without VM image, OS, guest rules or VM attachments')
    saveBicep('connectivity-public-lb.bicep', exported.text)
    lb.frontends = [{ id: lb.frontends[0].id, name: 'Private', kind: 'private', subnetId: topology.inventory!.nics[0].ipConfigurations[0].subnetId, privateIp: '10.1.1.10' }]
    lb.outboundRules = []
    lb.inboundNatRules = []
    saveBicep('connectivity-private-lb.bicep', generateAzNetBicep(topology).text)
    topology.inventory!.capture!.configurationComplete = false
    const incomplete = generateAzNetBicep(topology)
    expect(incomplete.text).not.toMatch(/networkInterfaces@|networkSecurityGroups@|loadBalancers@/)
    expect(incomplete.warnings.join(' ')).toContain('Incomplete connectivity capture')
  })

  it('exports ordered Firewall DNAT against newly allocated public IP without pretending to deploy private allocation or guest NVA rules', () => {
    const topology = importAzNetCapture(firewallCapture()).topology
    const exported = generateAzNetBicep(topology)
    expect(exported.text).toContain("Microsoft.Network/azureFirewalls@2024-07-01")
    expect(exported.text).toContain('natRuleCollections: [')
    expect(exported.text).toContain("translatedAddress: '10.1.1.4'")
    expect(exported.text).toContain('.properties.ipAddress ]')
    expect(exported.text).not.toContain("privateIPAddress: '10.1.2.4'")
    expect(exported.warnings.join(' ')).toContain('review UDR next hops after deployment')
    saveBicep('connectivity-firewall-dnat.bicep', exported.text)
    topology.inventory!.routerDnatPolicies![0].rulesStatus = 'unknown'
    expect(generateAzNetBicep(topology).text).not.toContain('azureFirewalls@')
  })

  it('disambiguates same-named NAT and LB public allocations without merging their original ownership', () => {
    const topology = importAzNetCapture(capture()).topology, inventory = topology.inventory!
    inventory.publicIps.push({ ...inventory.publicIps[0], id: 'nat-public', address: '20.40.50.61' })
    inventory.natGateways = [{ id: 'nat', name: 'NAT', sku: 'Standard', owner: inventory.nics[0].owner,
      subnetIds: [inventory.nics[0].ipConfigurations[0].subnetId], publicIpIds: ['nat-public'] }]
    const exported = generateAzNetBicep(topology)
    expect(exported.text).toContain("name: 'Frontend-allocation'")
    expect(exported.text).toContain("name: 'Frontend-allocation-2'")
    saveBicep('connectivity-nat-lb.bicep', exported.text)
  })

  it('never interprets an omitted NSG rule list as observed absence of custom filtering', () => {
    const root = capture()
    delete (root.networkSecurityGroups[0] as Record<string, unknown>).securityRules
    const inventory = importAzNetCapture(root).topology.inventory!
    expect(inventory.capture!.configurationComplete).toBe(false)
    expect(inventory.networkSecurityGroups![0].rulesStatus).toBe('unknown')
  })
})
