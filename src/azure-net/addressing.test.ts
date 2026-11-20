import { describe, expect, it } from 'vitest'
import { cloneAzNetTopology, sampleHubSpokeFirewallUdr, validateAzNetTopology } from './model'
import { parseAzNetTopology } from './admission'
import { validateInventory } from '../inventory'
import {
  subnetAddressError, usableSubnetAddress, vnetAddressError,
} from './addressing'
import { resizeAzSubnet, subnetNeedsReaddressing } from './subnet-address-editing'
import { addAzureFirewall, addNva, availableSubnetPrefix, nextSubnetAddress } from './subnet-allocation'
import { simulateAzNet } from './engine'
import { runAzNetDiagnostics } from './diagnostics'
import { generateAzNetBicep } from './bicep-export'

describe('VNet and subnet address consistency', () => {
  it('distinguishes malformed CIDRs, containment failures and valid secondary address spaces', () => {
    const subnets = [{ prefix: '10.2.0.64/26' }]
    expect(vnetAddressError({ prefixes: ['10.2.0.0/24'], subnets })).toBeUndefined()
    expect(vnetAddressError({ prefixes: ['10.1.0.0/24'], subnets })).toContain('outside')
    expect(vnetAddressError({ prefixes: ['10.2.0.7/24'], subnets })).toContain('valid')
    expect(vnetAddressError({ prefixes: [], subnets })).toContain('valid')
    expect(subnetAddressError(['10.2.0.0/24'], '10.2.0.65/26')).toContain('valid')
    expect(subnetAddressError(['10.2.0.64/26'], '10.2.0.0/24')).toContain('outside')
    expect(subnetAddressError(['10.1.0.0/24', '10.2.0.0/24'], subnets[0].prefix)).toBeUndefined()
  })

  describe('Firewall and NVA authoring', () => {
    it('enforces the Firewall singleton even when its modeled forwarding is disabled', () => {
      const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
      const vnet = topology.vnets[0]
      vnet.appliances[0].enableIpForwarding = false
      const before = cloneAzNetTopology(topology)
      expect(() => addAzureFirewall(topology, vnet.id)).toThrow('Only one Azure Firewall')
      expect(topology).toEqual(before)
      vnet.appliances = []
      const id = addAzureFirewall(topology, vnet.id)
      expect(vnet.appliances).toMatchObject([{ id, kind: 'azure-firewall', privateIp: '10.0.1.4', bgpEnabled: false }])
      expect(vnet.subnets).toEqual(before.vnets[0].subnets)
      expect(() => addAzureFirewall(topology, vnet.id)).toThrow('Only one Azure Firewall')
    })

    it('creates a dedicated Firewall subnet and rejects an unusable existing service subnet atomically', () => {
      const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
      const vnet = topology.vnets[1]
      addAzureFirewall(topology, vnet.id)
      const subnet = vnet.subnets.find((subnet) => subnet.name === 'AzureFirewallSubnet')!
      expect(subnet.prefix).toBe('10.1.0.0/26')
      expect(vnet.appliances[0].privateIp).toBe('10.1.0.4')
      vnet.appliances = []
      subnet.prefix = '10.1.0.0/29'
      const before = cloneAzNetTopology(topology)
      expect(() => addAzureFirewall(topology, vnet.id)).toThrow('/26 or larger')
      expect(topology).toEqual(before)
    })

    it('keeps imported duplicate Firewalls for diagnosis but does not export an invalid Azure deployment', () => {
      const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
      const vnet = topology.vnets[0]
      vnet.appliances.push({ ...vnet.appliances[0], id: 'extra-fw', privateIp: '10.0.1.5', enableIpForwarding: false })
      expect(parseAzNetTopology(topology)).toEqual(topology)
      expect(validateAzNetTopology(topology)).toContain(`VNet "${vnet.name}" supports only one Azure Firewall.`)
      expect(runAzNetDiagnostics(topology, simulateAzNet(topology), { includePairAnalysis: false }))
        .toContainEqual(expect.objectContaining({ id: `diag:firewall-singleton:${vnet.id}`, severity: 'error', vnetId: vnet.id }))
      expect(() => generateAzNetBicep(topology)).toThrow('supports only one Azure Firewall')
      expect(topology.vnets[0].appliances).toHaveLength(2)
    })

    it('creates multiple NVAs in the chosen subnet without changing BGP, ARS peers, subnets or UDRs', () => {
      const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
      const vnet = topology.vnets[0]
      vnet.subnets.push({ id: 'nva-subnet', name: 'NVAs', prefix: '10.0.3.0/29',
        privateEndpoints: [{ id: 'used', name: 'Used', serviceName: 'service', ipAddress: '10.0.3.4' }] })
      vnet.subnets.push({ id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.0.3.64/27' })
      vnet.routeServer = { id: 'ars', name: 'ARS', subnetId: 'ars-subnet', enabled: true,
        branchToBranchTraffic: true, hubRoutingPreference: 'ExpressRoute', peerApplianceIds: [] }
      const before = cloneAzNetTopology(topology)
      addNva(topology, vnet.id, { id: 'nva-a', name: ' First NVA ', subnetId: 'nva-subnet' })
      addNva(topology, vnet.id, { id: 'nva-b', name: 'Second NVA', subnetId: 'nva-subnet' })
      expect(vnet.appliances.slice(1)).toMatchObject([
        { id: 'nva-a', name: 'First NVA', kind: 'nva-vm', subnetId: 'nva-subnet', privateIp: '10.0.3.5', bgpEnabled: false },
        { id: 'nva-b', kind: 'nva-vm', subnetId: 'nva-subnet', privateIp: '10.0.3.6', bgpEnabled: false },
      ])
      expect(vnet.subnets).toEqual(before.vnets[0].subnets)
      expect(vnet.routeServer).toEqual(before.vnets[0].routeServer)
      expect(topology.udrTables).toEqual(before.udrTables)
      const full = cloneAzNetTopology(topology)
      expect(() => addNva(topology, vnet.id, { id: 'nva-c', name: 'Third', subnetId: 'nva-subnet' })).toThrow('no available')
      expect(topology).toEqual(full)
    })

    it('rejects missing, reserved, delegated, malformed, outside and overlapping NVA subnets without mutation', () => {
      const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
      const vnet = topology.vnets[0]
      for (const subnetId of ['', 'missing', 'sub-hub-gw', 'sub-hub-fw']) {
        const before = cloneAzNetTopology(topology)
        expect(() => addNva(topology, vnet.id, { id: 'new', name: 'NVA', subnetId })).toThrow()
        expect(topology).toEqual(before)
      }
      for (const subnet of [
        { name: 'App', prefix: 'not-a-cidr' },
        { name: 'App', prefix: '192.0.2.0/26' },
        { name: 'App', prefix: '10.0.2.0/26' },
        { name: 'App', prefix: '10.0.3.0/26', delegations: ['Microsoft.Web/serverFarms'] },
        { name: 'RouteServerSubnet', prefix: '10.0.3.0/26' },
        { name: 'VirtualNetworkApplianceSubnet', prefix: '10.0.3.0/26' },
      ]) {
        vnet.subnets.push({ id: 'bad', ...subnet })
        const before = cloneAzNetTopology(topology)
        expect(() => addNva(topology, vnet.id, { id: 'new', name: 'NVA', subnetId: 'bad' })).toThrow()
        expect(topology).toEqual(before)
        vnet.subnets.pop()
      }
    })
  })

  it('allocates from the actual non-/24 subnet, excluding occupied and Azure-reserved addresses', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0]
    vnet.appliances[0].privateIp = '10.2.0.68'
    expect(nextSubnetAddress(topology, vnet, '10.2.0.64/26')).toBe('10.2.0.69')
    expect(usableSubnetAddress('10.2.0.64/26', '10.2.0.67')).toBe(false)
    expect(usableSubnetAddress('10.2.0.64/26', '10.2.0.127')).toBe(false)
    expect(() => nextSubnetAddress(topology, vnet, '10.2.0.64/30')).toThrow('no available')
  })

  it('finds an aligned non-overlapping service subnet inside any valid VNet space', () => {
    const vnet = cloneAzNetTopology(sampleHubSpokeFirewallUdr).vnets[0]
    vnet.prefixes = ['10.2.0.0/24']
    vnet.subnets = vnet.subnets.map((subnet, index) => ({ ...subnet, prefix: `10.2.0.${index * 64}/26` }))
    expect(availableSubnetPrefix(vnet)).toBe('10.2.0.192/26')
    vnet.subnets.push({ id: 'last', name: 'last', prefix: '10.2.0.192/26' })
    expect(() => availableSubnetPrefix(vnet)).toThrow('No non-overlapping')
    vnet.prefixes.push('10.3.0.0/24')
    expect(availableSubnetPrefix(vnet)).toBe('10.3.0.0/26')
  })

  it('moves stored resource IPs and exact appliance next-hop references in one edit', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0]
    const app = vnet.appliances[0]
    const subnet = vnet.subnets.find((subnet) => subnet.id === app.subnetId)!
    subnet.privateEndpoints = [{ id: 'endpoint', name: 'endpoint', serviceName: 'service', ipAddress: '10.0.1.5' }]
    app.staticRoutes.push({ id: 'via-self', prefix: '192.0.2.0/24', nextHopKind: 'appliance', nextHopIp: app.privateIp, enabled: true })
    const old = app.privateIp
    resizeAzSubnet(topology, vnet.id, subnet.id, '10.2.0.64/26')
    expect(app.privateIp).toBe('10.2.0.68')
    expect(subnet.privateEndpoints[0].ipAddress).toBe('10.2.0.69')
    expect(app.staticRoutes[0].nextHopIp).toBe(app.privateIp)
    expect(topology.udrTables.flatMap((table) => table.routes).some((route) => route.nextHopIp === old)).toBe(false)
    expect(subnetNeedsReaddressing(topology, vnet, subnet.id)).toBe(false)
    expect(vnet.gateways).toEqual(sampleHubSpokeFirewallUdr.vnets[0].gateways)
  })

  it('repairs stale imported resource addresses only when explicitly requested', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0]
    const app = vnet.appliances[0]
    const subnet = vnet.subnets.find((subnet) => subnet.id === app.subnetId)!
    subnet.prefix = '10.2.0.64/26'
    app.privateIp = '10.2.202.4'
    expect(subnetNeedsReaddressing(topology, vnet, subnet.id)).toBe(true)
    resizeAzSubnet(topology, vnet.id, subnet.id, subnet.prefix)
    expect(app.privateIp).toBe('10.2.0.68')
  })

  it('retains resource IPs during invalid CIDR drafts and recovers when the CIDR becomes valid', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0]
    const app = vnet.appliances[0]
    const old = app.privateIp
    resizeAzSubnet(topology, vnet.id, app.subnetId, '10.2.')
    expect(app.privateIp).toBe(old)
    resizeAzSubnet(topology, vnet.id, app.subnetId, '10.2.0.64/26')
    expect(app.privateIp).toBe('10.2.0.68')
  })

  it('rejects exhausted subnets and ambiguous appliance references without partially applying edits', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0]
    const app = vnet.appliances[0]
    let before = cloneAzNetTopology(topology)
    expect(() => resizeAzSubnet(topology, vnet.id, app.subnetId, '10.2.0.64/30')).toThrow('no available')
    expect(topology).toEqual(before)
    topology.vnets[1].appliances.push({ ...app, id: 'ambiguous', subnetId: topology.vnets[1].subnets[0].id })
    before = cloneAzNetTopology(topology)
    expect(() => resizeAzSubnet(topology, vnet.id, app.subnetId, '10.2.0.64/26')).toThrow('duplicate resource')
    expect(topology).toEqual(before)
  })

  it('keeps already usable addresses and allocates around collisions when shrinking a subnet', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0], app = vnet.appliances[0]
    const subnet = vnet.subnets.find((subnet) => subnet.id === app.subnetId)!
    subnet.privateEndpoints = [
      { id: 'keep', name: 'Keep', serviceName: 'service', ipAddress: '10.0.1.4' },
      { id: 'move', name: 'Move', serviceName: 'service', ipAddress: '10.0.1.200' },
    ]
    app.privateIp = '10.0.1.100'
    resizeAzSubnet(topology, vnet.id, subnet.id, '10.0.1.0/29')
    expect(app.privateIp).toBe('10.0.1.5')
    expect(subnet.privateEndpoints.map((endpoint) => endpoint.ipAddress)).toEqual(['10.0.1.4', '10.0.1.6'])
  })

  it('moves modeled NICs, backing router aliases and LB frontends without breaking inventory ownership', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0], app = vnet.appliances[0]
    const subnet = vnet.subnets.find((subnet) => subnet.id === app.subnetId)!
    subnet.name = 'Appliances'
    topology.inventory = {
      workloads: [{ id: 'router-vm', name: 'Router', nicIds: ['router-nic'], backingDeviceId: app.id }],
      nics: [
        { id: 'router-nic', name: 'Router NIC', owner: { kind: 'vnet', id: vnet.id },
          ipConfigurations: [{ id: 'router-ip', name: 'Primary', subnetId: subnet.id, privateIp: app.privateIp }] },
        { id: 'vm-nic', name: 'VM NIC', owner: { kind: 'vnet', id: vnet.id },
          ipConfigurations: [{ id: 'vm-ip', name: 'Primary', subnetId: subnet.id, privateIp: '10.0.1.5' }] },
      ],
      publicIps: [],
      loadBalancers: [{ id: 'lb', name: 'LB', sku: 'Standard', owner: { kind: 'vnet', id: vnet.id },
        frontends: [{ id: 'fe', name: 'Frontend', kind: 'private', subnetId: subnet.id, privateIp: '10.0.1.6' }],
        pools: [], probes: [], rules: [], inboundNatRules: [], outboundRules: [] }],
    }
    validateInventory(topology)
    expect(nextSubnetAddress(topology, vnet, subnet.prefix)).toBe('10.0.1.7')
    resizeAzSubnet(topology, vnet.id, subnet.id, '10.0.3.64/26')
    expect(topology.inventory.nics.map((nic) => nic.ipConfigurations[0].privateIp)).toEqual(['10.0.3.68', '10.0.3.69'])
    expect(topology.inventory.loadBalancers![0].frontends[0]).toMatchObject({ privateIp: '10.0.3.70', subnetId: subnet.id })
    expect(app.privateIp).toBe('10.0.3.68')
    expect(() => validateInventory(topology)).not.toThrow()
  })

  it('admits inconsistent editable designs but reports containment and resource-address errors', () => {
    const topology = cloneAzNetTopology(sampleHubSpokeFirewallUdr)
    const vnet = topology.vnets[0], app = vnet.appliances[0]
    const subnet = vnet.subnets.find((subnet) => subnet.id === app.subnetId)!
    vnet.prefixes = ['192.0.2.0/24']
    app.privateIp = '10.0.1.2'
    subnet.privateEndpoints = [{ id: 'pe', name: 'PE', serviceName: 'service', ipAddress: '10.200.0.4' }]
    expect(parseAzNetTopology(topology)).toEqual(topology)
    const errors = validateAzNetTopology(topology)
    expect(errors.some((error) => error.includes('outside VNet'))).toBe(true)
    expect(errors.some((error) => error.includes('Appliance') && error.includes('reserved'))).toBe(true)
    expect(errors.some((error) => error.includes('Private Endpoint') && error.includes('non-reserved'))).toBe(true)
  })
})
