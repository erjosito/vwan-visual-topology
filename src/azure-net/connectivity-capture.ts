import { azureObjectId } from '../azure-import'
import { cidr, contains, ipv4 } from '../validation'
import type { InventoryOwner, NetworkInventory, NetworkLoadBalancer, NetworkSecurityRule, RouterDnatPolicy, WorkloadIpReference } from '../inventory'
import type { AzNetTopology } from './model'

type Row = Record<string, unknown>
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const field = (row: Row, name: string) => {
  const values = Object.keys(row).filter((key) => key.toLowerCase() === name.toLowerCase()).map((key) => row[key])
  return values.find((value) => value !== undefined && value !== null
    && (!Array.isArray(value) || value.length > 0) && (typeof value !== 'object' || Object.keys(value).length > 0)) ?? values[0]
}
const props = (row: Row) => row.properties === undefined ? row : object(row.properties)
const rows = (value: unknown): Row[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 512 || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new Error('Connectivity capture lists require at most 512 resource objects.')
  }
  return value as Row[]
}
const strings = (value: unknown): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 512 || value.some((entry) => typeof entry !== 'string')) throw new Error('Invalid connectivity capture value list.')
  return value as string[]
}
const reference = (value: unknown) => text(object(value).id).toLowerCase()
const port = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535

export function importConnectivityCapture(root: Row, topology: AzNetTopology, subnetsByArmId: Map<string, string>,
  report: (resourceId: string, resourceName: string, field: string) => void): void {
  if (root.connectivityVersion === undefined) return
  if (root.connectivityVersion !== 1) throw new Error('Unsupported connectivity capture version.')
  const inventory: NetworkInventory = topology.inventory ?? { workloads: [], nics: [], publicIps: [] }
  topology.inventory = inventory
  const sections = object(root.sections), subscription = text(root.subscriptionId).toLowerCase()
  const capture = inventory.capture = { version: 1 as const, configurationComplete: root.observationVersion === 1
    && root.configurationComplete === true && object(root.context).cloud === 'AzureCloud'
    && ['publicIpAddresses', 'publicIpPrefixes', 'natGateways', 'networkInterfaces', 'virtualMachines', 'networkSecurityGroups', 'loadBalancers', 'azureFirewalls', 'firewallPolicies']
      .every((key) => object(sections[key]).complete === true), resourceIds: {} as Record<string, string> }
  const unknown = (arm: string, name: string, detail: string) => {
    capture.configurationComplete = false
    report(arm, name, detail)
  }
  for (const key of ['publicIpAddresses', 'publicIpPrefixes', 'natGateways', 'networkInterfaces', 'virtualMachines',
    'networkSecurityGroups', 'loadBalancers', 'azureFirewalls', 'firewallPolicies', 'firewallPolicyRuleCollectionGroups']) {
    if (!Array.isArray(root[key])) unknown('', key, 'explicit captured configuration list')
  }
  const identity = (kind: string, arm: string, name: string) => {
    const types: Record<string, string> = { vm: 'Compute/virtualMachines', nic: 'Network/networkInterfaces',
      ipconfig: 'Network/networkInterfaces/[^/]+/ipConfigurations', pip: 'Network/publicIPAddresses',
      prefix: 'Network/publicIPPrefixes', nat: 'Network/natGateways', nsg: 'Network/networkSecurityGroups',
      'nsg-rule': 'Network/networkSecurityGroups/[^/]+/securityRules', lb: 'Network/loadBalancers',
      'lb-pool': 'Network/loadBalancers/[^/]+/backendAddressPools', 'lb-front': 'Network/loadBalancers/[^/]+/frontendIPConfigurations',
      'lb-probe': 'Network/loadBalancers/[^/]+/probes', 'lb-rule': 'Network/loadBalancers/[^/]+/loadBalancingRules',
      'lb-outbound': 'Network/loadBalancers/[^/]+/outboundRules', 'lb-nat': 'Network/loadBalancers/[^/]+/inboundNatRules',
      vnet: 'Network/virtualNetworks', subnet: 'Network/virtualNetworks/[^/]+/subnets',
      fw: 'Network/azureFirewalls', 'fw-ipconfig': 'Network/azureFirewalls/[^/]+/azureFirewallIpConfigurations',
      policy: 'Network/firewallPolicies', 'fw-group': 'Network/firewallPolicies/[^/]+/ruleCollectionGroups' }
    if (!types[kind] || !new RegExp(`^/subscriptions/[a-f0-9-]{36}/resourceGroups/[^/?#\\r\\n]+/providers/Microsoft\\.${types[kind]}/[^/?#\\r\\n]+$`, 'i').test(arm)
      || arm.split('/')[2].toLowerCase() !== subscription) {
      unknown(arm, name, 'original in-subscription resource identity')
      return undefined
    }
    const id = azureObjectId(kind, arm)
    capture.resourceIds[id] = arm
    return id
  }
  const named = (kind: string, row: Row, parentArm?: string) => {
    const arm = text(row.id), name = text(row.name) || arm.split('/').at(-1) || kind
    if (parentArm && !arm.toLowerCase().startsWith(`${parentArm.toLowerCase()}/`)) {
      unknown(arm, name, 'original child-resource parent identity')
      return undefined
    }
    const id = identity(kind, arm, name)
    return id ? { id, name, arm } : undefined
  }
  const ownerOf = (subnetId: string) => {
    const vnet = topology.vnets.find((vnet) => vnet.subnets.some((subnet) => subnet.id === subnetId))
    return vnet && { kind: 'vnet' as const, id: vnet.id }
  }
  for (const row of rows(root.vnets)) {
    const original = named('vnet', row)
    if (!original) continue
    for (const subnet of rows(props(row).subnets)) {
      const captured = named('subnet', subnet, original.arm), id = subnetsByArmId.get(text(subnet.id).toLowerCase())
      if (captured && id) capture.resourceIds[id] = captured.arm
    }
  }
  for (const [key, kind] of [['publicIpAddresses', 'pip'], ['publicIpPrefixes', 'prefix'], ['natGateways', 'nat']] as const) {
    for (const row of rows(root[key])) named(kind, row)
  }
  const nicByArm = new Map<string, string>(), configByArm = new Map<string, string>(), vmByNic = new Map<string, string>()
  const rawNics = rows(root.networkInterfaces)
  for (const row of rawNics) {
    const entry = named('nic', row)
    if (!entry) continue
    const configurations = rows(field(props(row), 'ipConfigurations'))
    let owner: InventoryOwner | undefined
    const ipConfigurations = configurations.flatMap((configuration) => {
      const config = named('ipconfig', configuration, entry.arm), properties = props(configuration)
      const subnetId = subnetsByArmId.get(reference(properties.subnet)), nextOwner = subnetId && ownerOf(subnetId)
      if (!config || !subnetId || !nextOwner || owner && owner.id !== nextOwner.id) {
        unknown(entry.arm, entry.name, 'NIC IP-configuration identity or single original VNet/subnet owner')
        return []
      }
      owner = nextOwner
      const address = text(field(properties, 'privateIPAddress')), subnet = topology.vnets.find((vnet) => vnet.id === owner!.id)!.subnets.find((subnet) => subnet.id === subnetId)!
      const ip = ipv4(address)
      if (address && (ip === undefined || !contains(subnet.prefix, ip))) {
        unknown(config.arm, config.name, 'original private IPv4 allocation')
        return []
      }
      const publicArm = reference(field(properties, 'publicIPAddress')), publicIpId = publicArm && azureObjectId('pip', publicArm)
      if (publicIpId && !inventory.publicIps.some((ip) => ip.id === publicIpId)) unknown(config.arm, config.name, 'captured instance public-IP association')
      configByArm.set(config.arm.toLowerCase(), config.id)
      return [{ id: config.id, name: config.name, subnetId, ...(address ? { privateIp: address } : {}),
        ...(publicIpId && inventory.publicIps.some((ip) => ip.id === publicIpId) ? { publicIpId } : {}),
        ...(typeof properties.primary === 'boolean' ? { primary: properties.primary } : {}) }]
    })
    if (!owner || !ipConfigurations.length) { unknown(entry.arm, entry.name, 'captured NIC addressing'); continue }
    nicByArm.set(entry.arm.toLowerCase(), entry.id)
    inventory.nics.push({ id: entry.id, name: entry.name, owner, ipConfigurations })
  }
  for (const row of rows(root.virtualMachines)) {
    const entry = named('vm', row)
    if (!entry) continue
    const refs = rows(object(props(row).networkProfile).networkInterfaces).map((nic) => reference(nic))
    const nicIds = refs.flatMap((arm) => {
      const id = nicByArm.get(arm), nic = rawNics.find((row) => text(row.id).toLowerCase() === arm)
      if (!id || reference(props(nic ?? {}).virtualMachine) !== entry.arm.toLowerCase() || vmByNic.has(id)) {
        unknown(entry.arm, entry.name, 'observed VM/NIC ownership'); return []
      }
      vmByNic.set(id, entry.id)
      return [id]
    })
    if (!nicIds.length) { unknown(entry.arm, entry.name, 'captured VM NICs'); continue }
    const device = topology.vnets.flatMap((vnet) => vnet.appliances).find((device) => inventory.nics.some((nic) =>
      nicIds.includes(nic.id) && nic.ipConfigurations.some((config) => config.privateIp === device.privateIp && config.subnetId === device.subnetId)))
    if (device) capture.resourceIds[device.id] = entry.arm
    inventory.workloads.push({ id: entry.id, name: entry.name, nicIds, ...(device ? { backingDeviceId: device.id } : {}) })
  }
  const nsgByArm = new Map<string, string>()
  for (const row of rows(root.networkSecurityGroups)) {
    const entry = named('nsg', row)
    if (!entry) continue
    let rulesStatus: 'unknown' | undefined
    if (!Array.isArray(props(row).securityRules)) {
      rulesStatus = 'unknown'; unknown(entry.arm, entry.name, 'explicit captured NSG custom-rule list')
    }
    const rules = rows(props(row).securityRules).flatMap((row): NetworkSecurityRule[] => {
      const ruleName = text(row.name), arm = text(row.id) || `${entry.arm}/securityRules/${ruleName}`, id = ruleName && identity('nsg-rule', arm, ruleName)
      const properties = props(row), direction = text(properties.direction).toLowerCase(), action = text(properties.access).toLowerCase()
      const protocol = text(properties.protocol).toLowerCase()
      const values = (singular: string, plural: string) => strings(properties[plural]).length ? strings(properties[plural]) : text(properties[singular]) ? [text(properties[singular])] : []
      const sources = values('sourceAddressPrefix', 'sourceAddressPrefixes'), destinations = values('destinationAddressPrefix', 'destinationAddressPrefixes')
      const sourcePorts = values('sourcePortRange', 'sourcePortRanges'), destinationPorts = values('destinationPortRange', 'destinationPortRanges')
      if (!id || !arm.toLowerCase().startsWith(`${entry.arm.toLowerCase()}/securityrules/`)
        || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(ruleName) || !['inbound', 'outbound'].includes(direction)
        || !['allow', 'deny'].includes(action) || !Number.isInteger(properties.priority) || Number(properties.priority) < 100 || Number(properties.priority) > 4096
        || !sources.length || !destinations.length || !sourcePorts.length || !destinationPorts.length
        || rows(properties.sourceApplicationSecurityGroups).length || rows(properties.destinationApplicationSecurityGroups).length) {
        rulesStatus = 'unknown'; unknown(arm, ruleName, 'NSG rule fields or ASG scope'); return []
      }
      if (!['*', 'tcp', 'udp', 'icmp', 'esp', 'ah'].includes(protocol)) {
        rulesStatus = 'unknown'; unknown(arm, ruleName, 'supported NSG protocol')
      }
      return [{ id, name: ruleName, priority: Number(properties.priority), direction: direction as NetworkSecurityRule['direction'],
        action: action as NetworkSecurityRule['action'], protocol: protocol === '*' ? 'any'
          : ['tcp', 'udp', 'icmp', 'esp', 'ah'].includes(protocol) ? protocol as NetworkSecurityRule['protocol'] : 'unknown',
        sources, destinations, sourcePorts, destinationPorts }]
    })
    nsgByArm.set(entry.arm.toLowerCase(), entry.id)
    ;(inventory.networkSecurityGroups ??= []).push({ id: entry.id, name: entry.name, rules, ...(rulesStatus ? { rulesStatus } : {}),
      ...(text(row.location) ? { region: text(row.location) } : {}) })
  }
  const association = (owner: InventoryOwner, target: { kind: 'subnet' | 'nic'; id: string }, value: unknown) => {
    const arm = reference(value)
    if (!arm) return
    const nsgId = nsgByArm.get(arm)
    if (!nsgId) unknown(arm, arm.split('/').at(-1) ?? 'NSG', 'captured NSG association')
    const reserved = target.kind === 'subnet' && topology.vnets.find((vnet) => vnet.id === owner.id)?.subnets.some((subnet) =>
      subnet.id === target.id && ['gatewaysubnet', 'azurefirewallsubnet'].includes(subnet.name.toLowerCase()))
    if (reserved) unknown(arm, arm.split('/').at(-1) ?? 'NSG', 'unsupported reserved-subnet NSG association')
    ;(inventory.nsgAssociations ??= []).push({ owner, target, ...(nsgId ? { nsgId } : {}),
      ...(!nsgId || reserved ? { status: 'unknown' as const } : {}) })
  }
  for (const row of rawNics) {
    const id = nicByArm.get(text(row.id).toLowerCase()), nic = inventory.nics.find((nic) => nic.id === id)
    if (nic && reference(props(row).virtualMachine) && !vmByNic.has(nic.id)) unknown(text(row.id), text(row.name), 'unobserved original VM owner')
    if (nic) association(nic.owner, { kind: 'nic', id: nic.id }, props(row).networkSecurityGroup)
  }
  for (const vnet of rows(root.vnets)) for (const row of rows(props(vnet).subnets)) {
    const id = subnetsByArmId.get(text(row.id).toLowerCase()), owner = id && ownerOf(id)
    if (id && owner) association(owner, { kind: 'subnet', id }, props(row).networkSecurityGroup)
  }
  const backendByArm = new Map<string, WorkloadIpReference>()
  for (const [arm, id] of configByArm) {
    const nic = inventory.nics.find((nic) => nic.ipConfigurations.some((config) => config.id === id)), workloadId = nic && vmByNic.get(nic.id)
    if (nic && workloadId) backendByArm.set(arm, { workloadId, nicId: nic.id, ipConfigurationId: id })
  }
  for (const row of rows(root.loadBalancers)) {
    const entry = named('lb', row), properties = props(row)
    if (!entry) continue
    const ownerIds = new Set<string>()
    const pools = rows(properties.backendAddressPools).flatMap((row) => {
      const pool = named('lb-pool', row, entry.arm)
      if (!pool) return []
      let membersStatus: 'unknown' | undefined
      const members = rows(field(props(row), 'backendIPConfigurations')).flatMap((ref) => {
        const member = backendByArm.get(reference(ref))
        if (!member) { membersStatus = 'unknown'; unknown(pool.arm, pool.name, 'original NIC-backed pool membership'); return [] }
        ownerIds.add(inventory.nics.find((nic) => nic.id === member.nicId)!.owner.id)
        return [member]
      })
      if (rows(props(row).loadBalancerBackendAddresses).length || rows(props(row).tunnelInterfaces).length) {
        membersStatus = 'unknown'; unknown(pool.arm, pool.name, 'IP-backed or gateway-LB pool')
      }
      return [{ id: pool.id, name: pool.name, members, ...(membersStatus ? { membersStatus } : {}) }]
    })
    const frontends = rows(field(properties, 'frontendIPConfigurations')).flatMap((row): NetworkLoadBalancer['frontends'] => {
      const frontend = named('lb-front', row, entry.arm), properties = props(row)
      if (!frontend) return []
      const publicArm = reference(field(properties, 'publicIPAddress'))
      if (publicArm) {
        const publicIpId = azureObjectId('pip', publicArm)
        if (!inventory.publicIps.some((ip) => ip.id === publicIpId && ip.sku === 'Standard' && ip.allocation === 'Static')) {
          unknown(frontend.arm, frontend.name, 'Standard public frontend allocation'); return []
        }
        return [{ id: frontend.id, name: frontend.name, kind: 'public', publicIpId }]
      }
      const subnetId = subnetsByArmId.get(reference(properties.subnet)), owner = subnetId && ownerOf(subnetId)
      if (!subnetId || !owner) { unknown(frontend.arm, frontend.name, 'private frontend subnet'); return [] }
      ownerIds.add(owner.id)
      const privateIp = text(field(properties, 'privateIPAddress'))
      return [{ id: frontend.id, name: frontend.name, kind: 'private', subnetId, ...(privateIp ? { privateIp } : {}) }]
    })
    if (object(row.sku).name !== 'Standard' || object(row.sku).tier && object(row.sku).tier !== 'Regional'
      || ownerIds.size !== 1 || !frontends.length
      || frontends.some((frontend) => frontend.kind !== frontends[0].kind) || rows(properties.inboundNatPools).length) {
      unknown(entry.arm, entry.name, 'regional Standard LB ownership, frontend family or NAT pool'); continue
    }
    const owner = { kind: 'vnet' as const, id: [...ownerIds][0] }
    const probes = rows(properties.probes).flatMap((row): NetworkLoadBalancer['probes'] => {
      const probe = named('lb-probe', row, entry.arm), properties = props(row), protocol = text(properties.protocol).toLowerCase()
      if (!probe || !['tcp', 'http', 'https'].includes(protocol) || !port(properties.port)
        || protocol !== 'tcp' && !text(properties.requestPath).startsWith('/')
        || properties.noHealthyBackendsBehavior && properties.noHealthyBackendsBehavior !== 'AllProbedDown') {
        unknown(text(row.id), text(row.name), 'supported LB probe configuration'); return []
      }
      return [{ id: probe.id, name: probe.name, protocol: protocol as 'tcp' | 'http' | 'https', port: properties.port,
        ...(protocol !== 'tcp' ? { requestPath: text(properties.requestPath) } : {}),
        health: pools.flatMap((pool) => pool.members.map((target) => ({ target, status: 'unknown' as const }))) }]
    })
    const lb: NetworkLoadBalancer = { id: entry.id, name: entry.name, sku: 'Standard', owner, frontends, pools, probes,
      rules: [], inboundNatRules: [], outboundRules: [] }
    for (const row of rows(properties.loadBalancingRules)) {
      const rule = named('lb-rule', row, entry.arm), properties = props(row), protocol = text(properties.protocol).toLowerCase()
      const frontendId = azureObjectId('lb-front', reference(field(properties, 'frontendIPConfiguration'))),
        poolId = azureObjectId('lb-pool', reference(properties.backendAddressPool)), probeId = azureObjectId('lb-probe', reference(properties.probe))
      const haPorts = protocol === 'all' && properties.frontendPort === 0 && properties.backendPort === 0
      if (!rule || !frontends.some((entry) => entry.id === frontendId) || !pools.some((entry) => entry.id === poolId)
        || !probes.some((entry) => entry.id === probeId) || !['tcp', 'udp', 'all'].includes(protocol)
        || !haPorts && (!port(properties.frontendPort) || !port(properties.backendPort))
        || haPorts && frontends.some((frontend) => frontend.kind === 'public') || properties.enableConnectionTracking === false
        || rows(properties.backendAddressPools).length) {
        lb.rulesStatus = 'unknown'; unknown(text(row.id), text(row.name), 'supported LB forwarding rule'); continue
      }
      const affinity = text(properties.loadDistribution)
      if (affinity && !['Default', 'SourceIP', 'SourceIPProtocol'].includes(affinity)) {
        lb.rulesStatus = 'unknown'; unknown(rule.arm, rule.name, 'LB affinity'); continue
      }
      lb.rules.push({ id: rule.id, name: rule.name, frontendId, poolId, probeId, protocol: protocol as 'tcp' | 'udp' | 'all',
        frontendPort: Number(properties.frontendPort), backendPort: Number(properties.backendPort),
        affinity: affinity === 'SourceIP' ? 'client-ip' : affinity === 'SourceIPProtocol' ? 'client-ip-protocol' : 'none',
        ...(typeof properties.disableOutboundSnat === 'boolean' ? { disableOutboundSnat: properties.disableOutboundSnat } : {}),
        ...(typeof field(properties, 'enableFloatingIP') === 'boolean' ? { floatingIp: field(properties, 'enableFloatingIP') as boolean } : {}),
        ...(haPorts ? { haPorts: true } : {}) })
    }
    for (const row of rows(properties.outboundRules)) {
      const rule = named('lb-outbound', row, entry.arm), properties = props(row), protocol = text(properties.protocol).toLowerCase()
      const frontendIds = rows(field(properties, 'frontendIPConfigurations')).map((ref) => azureObjectId('lb-front', reference(ref)))
      const poolId = azureObjectId('lb-pool', reference(properties.backendAddressPool))
      if (!rule || !['tcp', 'udp', 'all'].includes(protocol) || !frontendIds.length
        || !frontendIds.every((id) => frontends.some((entry) => entry.id === id && entry.kind === 'public'))
        || !pools.some((entry) => entry.id === poolId)) {
        lb.rulesStatus = 'unknown'; unknown(text(row.id), text(row.name), 'supported LB outbound rule'); continue
      }
      lb.outboundRules.push({ id: rule.id, name: rule.name, frontendIds, poolId, protocol: protocol === 'all' ? 'any' : protocol as 'tcp' | 'udp' })
    }
    for (const row of rows(properties.inboundNatRules)) {
      const rule = named('lb-nat', row, entry.arm), properties = props(row), protocol = text(properties.protocol).toLowerCase()
      const target = backendByArm.get(reference(field(properties, 'backendIPConfiguration')))
      const frontendId = azureObjectId('lb-front', reference(field(properties, 'frontendIPConfiguration')))
      const pool = target && pools.find((pool) => pool.members.some((member) => member.workloadId === target.workloadId
        && member.nicId === target.nicId && member.ipConfigurationId === target.ipConfigurationId))
      if (!rule || !target || !pool || !frontends.some((entry) => entry.id === frontendId) || !['tcp', 'udp'].includes(protocol)
        || !port(properties.frontendPort) || !port(properties.backendPort) || field(properties, 'enableFloatingIP') === true
        || properties.frontendPortRangeStart !== undefined && properties.frontendPortRangeStart !== null
        || properties.frontendPortRangeEnd !== undefined && properties.frontendPortRangeEnd !== null) {
        lb.rulesStatus = 'unknown'; unknown(text(row.id), text(row.name), 'specific original inbound NAT rule binding'); continue
      }
      lb.inboundNatRules.push({ id: rule.id, name: rule.name, frontendId, poolId: pool.id, target,
        protocol: protocol as 'tcp' | 'udp', frontendPort: properties.frontendPort, backendPort: properties.backendPort })
    }
    ;(inventory.loadBalancers ??= []).push(lb)
  }
  const firewallConfigArms = new Set<string>()
  for (const row of rows(root.azureFirewalls)) {
    const firewall = named('fw', row), properties = props(row)
    if (!firewall) continue
    const configurations = rows(field(properties, 'ipConfigurations')), configuration = configurations[0], interfaceProperties = props(configuration ?? {})
    if (configurations.some((configuration) => !named('fw-ipconfig', configuration, firewall.arm))) continue
    const subnetId = subnetsByArmId.get(reference(interfaceProperties.subnet)), owner = subnetId && ownerOf(subnetId)
    const vnet = owner ? topology.vnets.find((vnet) => vnet.id === owner.id) : undefined, subnet = vnet?.subnets.find((subnet) => subnet.id === subnetId)
    const privateIp = text(field(interfaceProperties, 'privateIPAddress')), address = ipv4(privateIp)
    const publicIpIds = configurations.map((row) => azureObjectId('pip', reference(field(props(row), 'publicIPAddress'))))
    const sku = object(properties.sku ?? row.sku)
    if (!vnet || !subnet || subnet.name.toLowerCase() !== 'azurefirewallsubnet' || address === undefined || !contains(subnet.prefix, address)
      || !publicIpIds.length || publicIpIds.length > 16 || !publicIpIds.every((id) => inventory.publicIps.some((ip) =>
        ip.id === id && ip.sku === 'Standard' && ip.allocation === 'Static')) || configurations.some((row) =>
          reference(props(row).subnet) && reference(props(row).subnet) !== reference(interfaceProperties.subnet)
          || text(field(props(row), 'privateIPAddress')) && text(field(props(row), 'privateIPAddress')) !== privateIp)
      || Object.keys(object(field(properties, 'managementIpConfiguration'))).length || sku.name !== 'AZFW_VNet'
      || !['Standard', 'Premium'].includes(text(sku.tier))) {
      unknown(firewall.arm, firewall.name, 'supported original Firewall private interface, public pool or forced-tunnel posture'); continue
    }
    vnet.appliances.push({ id: firewall.id, name: firewall.name, kind: 'azure-firewall', subnetId: subnet.id, privateIp,
      enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [], advertisedPrefixes: [] })
    for (const configuration of configurations) if (text(configuration.id)) firewallConfigArms.add(text(configuration.id).toLowerCase())
    const policy: RouterDnatPolicy = { owner: { kind: 'appliance', id: firewall.id }, kind: 'firewall-dnat', publicIpIds, rules: [] }
    const policyArm = reference(properties.firewallPolicy)
    let collections = rows(properties.natRuleCollections).map((collection) => ({ collection, groupPriority: 0, sourceArm: firewall.arm }))
    if (policyArm) {
      const observed = rows(root.firewallPolicies).find((row) => text(row.id).toLowerCase() === policyArm)
      const groups = rows(root.firewallPolicyRuleCollectionGroups).find((row) => text(row.policyId).toLowerCase() === policyArm)
      if (!observed || !named('policy', observed) || reference(props(observed).basePolicy) || !groups
        || object(sections[`firewallPolicyRuleCollectionGroups:${text(observed.name)}`]).complete !== true) {
        policy.rulesStatus = 'unknown'; unknown(policyArm, firewall.name, 'complete non-inherited original Firewall policy')
        collections = []
      } else {
        collections = rows(groups.groups).flatMap((group) => {
          const original = named('fw-group', group)
          if (!original || !original.arm.toLowerCase().startsWith(`${policyArm}/rulecollectiongroups/`)
            || !Number.isInteger(props(group).priority) || Number(props(group).priority) < 100 || Number(props(group).priority) > 65000) {
            policy.rulesStatus = 'unknown'; unknown(text(group.id), text(group.name), 'original Firewall group scope or priority'); return []
          }
          return rows(props(group).ruleCollections).filter((row) => props(row).ruleCollectionType === 'FirewallPolicyNatRuleCollection')
            .map((collection) => ({ collection, groupPriority: Number(props(group).priority), sourceArm: original.arm }))
        })
      }
    }
    collections.sort((a, b) => a.groupPriority - b.groupPriority || Number(props(a.collection).priority) - Number(props(b.collection).priority))
    for (const { collection, sourceArm } of collections) {
      const properties = props(collection)
      if (object(properties.action).type !== 'Dnat' && object(properties.action).type !== 'DNAT'
        || !Number.isInteger(properties.priority) || Number(properties.priority) < 100 || Number(properties.priority) > 65000) {
        policy.rulesStatus = 'unknown'; unknown(sourceArm, text(collection.name), 'Firewall DNAT collection action or priority'); continue
      }
      for (const row of rows(properties.rules)) {
        const rule = props(row), name = text(row.name)
        const protocols = strings(rule.ipProtocols ?? rule.protocols).map((protocol) => protocol.toLowerCase())
        const sources = strings(rule.sourceAddresses).map((source) => source === '*' ? '0.0.0.0/0'
          : ipv4(source) !== undefined ? `${source}/32` : source)
        const destinations = strings(rule.destinationAddresses), ports = strings(rule.destinationPorts).map(Number), translatedPort = Number(rule.translatedPort)
        const targets = inventory.workloads.flatMap((workload) => workload.backingDeviceId ? [] : inventory.nics.filter((nic) => workload.nicIds.includes(nic.id))
          .flatMap((nic) => nic.ipConfigurations.filter((configuration) => configuration.privateIp === rule.translatedAddress)
            .map((configuration) => ({ workloadId: workload.id, nicId: nic.id, ipConfigurationId: configuration.id }))))
        const publicIps = inventory.publicIps.filter((ip) => publicIpIds.includes(ip.id) && ip.address && destinations.includes(ip.address))
        if (!name || !protocols.length || protocols.some((protocol) => !['tcp', 'udp'].includes(protocol))
          || !sources.length || sources.some((source) => !cidr(source)) || !ports.length || ports.some((value) => !port(value))
          || !port(translatedPort) || targets.length !== 1 || !publicIps.length
          || destinations.some((destination) => !publicIps.some((ip) => ip.address === destination))
          || strings(rule.sourceIpGroups).length || text(rule.translatedFqdn)
          || policy.rules.length + publicIps.length * protocols.length * ports.length > 512) {
          policy.rulesStatus = 'unknown'; unknown(sourceArm, name, 'bounded original IPv4 Firewall DNAT rule or unique backend'); continue
        }
        for (const ip of publicIps) for (const protocol of protocols) for (const frontendPort of ports) {
          const id = azureObjectId('dnat-rule', JSON.stringify([sourceArm, collection.name, name, ip.id, protocol, frontendPort]))
          capture.resourceIds[id] = sourceArm
          policy.rules.push({ id, name, priority: 100 + policy.rules.length, protocol: protocol as 'tcp' | 'udp', sourcePrefixes: sources,
            publicIpId: ip.id, frontendPort, target: targets[0], translatedPort })
        }
      }
    }
    ;(inventory.routerDnatPolicies ??= []).push(policy)
  }
  for (const row of rows(root.publicIpAddresses)) {
    const arm = reference(props(row).ipConfiguration), nat = reference(props(row).natGateway)
    const configId = arm && configByArm.get(arm), frontendId = arm && azureObjectId('lb-front', arm)
    const nic = configId && inventory.nics.find((nic) => nic.ipConfigurations.some((config) => config.id === configId))
    if (nic && inventory.workloads.some((workload) => workload.nicIds.includes(nic.id) && workload.backingDeviceId)) {
      unknown(text(row.id), text(row.name), 'unobserved NVA guest ingress mapping')
    }
    if (arm && !configId && !firewallConfigArms.has(arm) && !inventory.loadBalancers?.some((lb) => lb.frontends.some((frontend) => frontend.id === frontendId))
      || nat && !inventory.natGateways?.some((gateway) => gateway.id === azureObjectId('nat', nat))) {
      unknown(text(row.id), text(row.name), 'unobserved original public-IP mapping owner')
    }
  }
}
