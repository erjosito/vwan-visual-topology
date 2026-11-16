import { canonicalLocation } from './bicep-export'
import type { NetworkInventory } from './inventory'
import type { AzVNet } from './azure-net/model'

const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('${', '\\${').replaceAll('\r', '\\r').replaceAll('\n', '\\n')}'`

export function generateConnectivityBicep(topology: { inventory?: NetworkInventory; vnets: Pick<AzVNet, 'id' | 'name' | 'region' | 'subnets' | 'appliances'>[] },
  vnetSymbols: Map<string, string>, symbol: (base: string, prefix: string) => string, defaultLocation: string,
  reservedPublicNames: Set<string>, locationParameter = 'location') {
  const lines: string[] = [], warnings: string[] = [], nsgSymbols = new Map<string, string>()
  const inventory = topology.inventory
  let resourceCount = 0
  if (!inventory) return { lines, warnings, nsgSymbols, resourceCount }
  if (inventory.capture?.configurationComplete === false) {
    warnings.push('Incomplete connectivity capture: NIC, NSG, non-NAT public IP, LB and DNAT resources are not exported. Preserve native JSON and resolve missing or unsupported configuration before deployment.')
    return { lines, warnings, nsgSymbols, resourceCount }
  }
  const nameSets = new Map<string, Set<string>>([['pip', new Set(reservedPublicNames)]])
  const name = (kind: string, value: string) => {
    const used = nameSets.get(kind) ?? new Set<string>()
    nameSets.set(kind, used)
    const base = value.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || kind
    let result = base, suffix = 2
    while (used.has(result.toLowerCase())) result = `${base}-${suffix++}`
    used.add(result.toLowerCase())
    if (result !== value) warnings.push(`${kind} name '${value}' is exported as '${result}' for a new deployment.`)
    return quote(result)
  }
  const location = (ownerId?: string, region?: string) => {
    const resolved = canonicalLocation(region ?? topology.vnets.find((vnet) => vnet.id === ownerId)?.region ?? '') || defaultLocation
    return resolved === defaultLocation ? locationParameter : quote(resolved)
  }
  const subnetReference = (ownerId: string, subnetId: string) => {
    const subnet = topology.vnets.find((vnet) => vnet.id === ownerId)?.subnets.find((subnet) => subnet.id === subnetId)
    return `format('{0}/subnets/{1}', ${vnetSymbols.get(ownerId)}.id, ${quote(subnet!.name)})`
  }
  for (const group of inventory.networkSecurityGroups ?? []) {
    const ownerRegions = new Set(inventory.nsgAssociations?.filter((binding) => binding.nsgId === group.id).map((binding) =>
      canonicalLocation(topology.vnets.find((vnet) => vnet.id === binding.owner.id)?.region ?? '') || defaultLocation))
    if (group.rulesStatus === 'unknown' || group.rules.some((rule) => rule.protocol === 'unknown'
      || [...rule.sources, ...rule.destinations].some((selector) => selector.startsWith('asg:'))) || ownerRegions.size > 1) {
      warnings.push(`NSG '${group.name}' and its associations are omitted because rule coverage is unknown or unsupported.`)
      continue
    }
    const sym = symbol(`nsg_${group.id}`, 'nsg')
    nsgSymbols.set(group.id, sym); resourceCount++
    lines.push(`resource ${sym} 'Microsoft.Network/networkSecurityGroups@2024-07-01' = {`,
      `  name: ${name('nsg', group.name)}`, `  location: ${location(inventory.nsgAssociations?.find((binding) => binding.nsgId === group.id)?.owner.id, group.region)}`, `  properties: {`, `    securityRules: [`)
    for (const rule of group.rules) {
      lines.push(`      {`, `        name: ${quote(rule.name)}`, `        properties: {`,
        `          priority: ${rule.priority}`, `          direction: '${rule.direction === 'inbound' ? 'Inbound' : 'Outbound'}'`,
        `          access: '${rule.action === 'allow' ? 'Allow' : 'Deny'}'`,
        `          protocol: ${quote(rule.protocol === 'any' ? '*' : rule.protocol === 'icmp' ? 'Icmp' : rule.protocol === 'tcp' ? 'Tcp' : rule.protocol === 'udp' ? 'Udp' : rule.protocol === 'esp' ? 'Esp' : 'Ah')}`)
      for (const [field, values] of [['sourceAddress', rule.sources], ['destinationAddress', rule.destinations],
        ['sourcePort', rule.sourcePorts], ['destinationPort', rule.destinationPorts]] as const) {
        const suffix = field.endsWith('Address') ? 'Prefix' : 'Range'
        if (values.length === 1) lines.push(`          ${field}${suffix}: ${quote(values[0])}`)
        else lines.push(`          ${field}${suffix}${suffix === 'Range' ? 's' : 'es'}: [`, ...values.map((value) => `            ${quote(value)}`), `          ]`)
      }
      lines.push(`        }`, `      }`)
    }
    lines.push(`    ]`, `  }`, `}`, '')
  }
  const publicSymbols = new Map<string, string>()
  const natPublicIds = new Set(inventory.natGateways?.flatMap((gateway) => gateway.publicIpIds))
  for (const ip of inventory.publicIps.filter((ip) => !natPublicIds.has(ip.id))) {
    if (ip.sku !== 'Standard' || ip.allocation !== 'Static') {
      warnings.push(`Public IP '${ip.name}' is omitted because only declared Standard static allocations are supported.`)
      continue
    }
    const ownerId = inventory.nics.find((nic) => nic.ipConfigurations.some((config) => config.publicIpId === ip.id))?.owner.id
      ?? inventory.loadBalancers?.find((lb) => lb.frontends.some((frontend) => frontend.kind === 'public' && frontend.publicIpId === ip.id))?.owner.id
      ?? topology.vnets.find((vnet) => vnet.appliances.some((app) => inventory.routerDnatPolicies?.some((policy) =>
        policy.owner.kind === 'appliance' && policy.owner.id === app.id && policy.publicIpIds.includes(ip.id))))?.id
    const sym = symbol(`inventory_pip_${ip.id}`, 'pip')
    publicSymbols.set(ip.id, sym); resourceCount++
    lines.push(`resource ${sym} 'Microsoft.Network/publicIPAddresses@2024-07-01' = {`, `  name: ${name('pip', ip.name)}`,
      `  location: ${location(ownerId)}`, `  sku: { name: 'Standard' }`,
      `  properties: { publicIPAllocationMethod: 'Static', publicIPAddressVersion: 'IPv4' }`, `}`, '')
  }
  const nicSymbols = new Map<string, string>()
  for (const nic of inventory.nics) {
    const binding = inventory.nsgAssociations?.find((binding) => binding.target.kind === 'nic' && binding.target.id === nic.id)
    if (binding && (binding.status === 'unknown' || !nsgSymbols.has(binding.nsgId!))
      || inventory.nsgAssociations?.some((binding) => binding.owner.id === nic.owner.id && binding.target.kind === 'subnet'
        && nic.ipConfigurations.some((config) => config.subnetId === binding.target.id)
        && (binding.status === 'unknown' || !nsgSymbols.has(binding.nsgId!)))
      || nic.ipConfigurations.some((config) => config.publicIpId && !publicSymbols.has(config.publicIpId))) {
      warnings.push(`NIC '${nic.name}' is omitted because its NSG or public-IP association cannot be reproduced.`)
      continue
    }
    nicSymbols.set(nic.id, symbol(`nic_${nic.id}`, 'nic'))
  }
  const lbSymbols = new Map<string, string>()
  const childNames = new Map<string, string>()
  for (const lb of inventory.loadBalancers ?? []) {
    if (lb.rulesStatus === 'unknown' || lb.pools.some((pool) => pool.membersStatus === 'unknown'
      || pool.members.some((member) => !nicSymbols.has(member.nicId)))
      || lb.frontends.some((frontend) => frontend.kind === 'public' && !publicSymbols.has(frontend.publicIpId))) {
      warnings.push(`Load Balancer '${lb.name}' is omitted because original rule, frontend or backend coverage is unknown or unsupported.`)
      continue
    }
    const sym = symbol(`lb_${lb.id}`, 'lb')
    const lbName = name('lb', lb.name)
    lbSymbols.set(lb.id, sym); resourceCount++
    for (const [kind, children] of [['frontends', lb.frontends], ['pools', lb.pools], ['probes', lb.probes],
      ['rules', lb.rules], ['nat', lb.inboundNatRules], ['outbound', lb.outboundRules]] as const) {
      for (const child of children) childNames.set(child.id, name(`${lb.id}-${kind}`, child.name))
    }
    const frontendId = (id: string) => `resourceId('Microsoft.Network/loadBalancers/frontendIPConfigurations', ${lbName}, ${childNames.get(id)})`
    const poolId = (id: string) => `resourceId('Microsoft.Network/loadBalancers/backendAddressPools', ${lbName}, ${childNames.get(id)})`
    lines.push(`resource ${sym} 'Microsoft.Network/loadBalancers@2024-07-01' = {`, `  name: ${lbName}`,
      `  location: ${location(lb.owner.id)}`, `  sku: { name: 'Standard', tier: 'Regional' }`,
      `  properties: {`, `    frontendIPConfigurations: [`)
    for (const frontend of lb.frontends) {
      lines.push(`      {`, `        name: ${childNames.get(frontend.id)}`, `        properties: {`)
      if (frontend.kind === 'public') lines.push(`          publicIPAddress: { id: ${publicSymbols.get(frontend.publicIpId)}.id }`)
      else {
        lines.push(`          subnet: { id: ${subnetReference(lb.owner.id, frontend.subnetId)} }`,
          `          privateIPAllocationMethod: '${frontend.privateIp ? 'Static' : 'Dynamic'}'`)
        if (frontend.privateIp) lines.push(`          privateIPAddress: ${quote(frontend.privateIp)}`)
      }
      lines.push(`        }`, `      }`)
    }
    lines.push(`    ]`, `    backendAddressPools: [`, ...lb.pools.map((pool) => `      { name: ${childNames.get(pool.id)} }`),
      `    ]`, `    probes: [`)
    for (const probe of lb.probes) {
      lines.push(`      {`, `        name: ${childNames.get(probe.id)}`, `        properties: {`,
        `          protocol: '${probe.protocol === 'tcp' ? 'Tcp' : probe.protocol === 'http' ? 'Http' : 'Https'}'`, `          port: ${probe.port}`)
      if (probe.requestPath) lines.push(`          requestPath: ${quote(probe.requestPath)}`)
      lines.push(`        }`, `      }`)
    }
    lines.push(`    ]`, `    loadBalancingRules: [`)
    for (const rule of lb.rules) {
      lines.push(`      {`, `        name: ${childNames.get(rule.id)}`, `        properties: {`,
        `          frontendIPConfiguration: { id: ${frontendId(rule.frontendId)} }`,
        `          backendAddressPool: { id: ${poolId(rule.poolId)} }`,
        `          probe: { id: resourceId('Microsoft.Network/loadBalancers/probes', ${lbName}, ${childNames.get(rule.probeId)}) }`,
        `          protocol: '${rule.protocol === 'all' ? 'All' : rule.protocol === 'tcp' ? 'Tcp' : 'Udp'}'`,
        `          frontendPort: ${rule.frontendPort}`, `          backendPort: ${rule.backendPort}`,
        `          loadDistribution: '${rule.affinity === 'client-ip' ? 'SourceIP' : rule.affinity === 'client-ip-protocol' ? 'SourceIPProtocol' : 'Default'}'`)
      if (rule.disableOutboundSnat !== undefined) lines.push(`          disableOutboundSnat: ${rule.disableOutboundSnat}`)
      if (rule.floatingIp !== undefined) lines.push(`          enableFloatingIP: ${rule.floatingIp}`)
      lines.push(`        }`, `      }`)
    }
    lines.push(`    ]`, `    inboundNatRules: [`)
    for (const rule of lb.inboundNatRules) {
      lines.push(`      { name: ${childNames.get(rule.id)}, properties: {`,
        `        frontendIPConfiguration: { id: ${frontendId(rule.frontendId)} }`,
        `        protocol: '${rule.protocol === 'tcp' ? 'Tcp' : 'Udp'}'`, `        frontendPort: ${rule.frontendPort}`,
        `        backendPort: ${rule.backendPort}`, `      } }`)
    }
    lines.push(`    ]`, `    outboundRules: [`)
    for (const rule of lb.outboundRules) {
      lines.push(`      { name: ${childNames.get(rule.id)}, properties: {`, `        backendAddressPool: { id: ${poolId(rule.poolId)} }`,
        `        protocol: '${rule.protocol === 'any' ? 'All' : rule.protocol === 'tcp' ? 'Tcp' : 'Udp'}'`,
        `        frontendIPConfigurations: [`, ...rule.frontendIds.map((id) => `          { id: ${frontendId(id)} }`), `        ]`, `      } }`)
    }
    lines.push(`    ]`, `  }`, `}`, '')
  }
  for (const nic of inventory.nics) {
    const sym = nicSymbols.get(nic.id)
    if (!sym) continue
    resourceCount++
    const binding = inventory.nsgAssociations?.find((binding) => binding.target.kind === 'nic' && binding.target.id === nic.id)
    const deviceId = inventory.workloads.find((workload) => workload.nicIds.includes(nic.id))?.backingDeviceId
    const device = topology.vnets.flatMap((vnet) => vnet.appliances).find((app) => app.id === deviceId)
    lines.push(`resource ${sym} 'Microsoft.Network/networkInterfaces@2024-07-01' = {`, `  name: ${name('nic', nic.name)}`,
      `  location: ${location(nic.owner.id)}`, `  properties: {`)
    if (device) lines.push(`    enableIPForwarding: ${device.enableIpForwarding}`)
    if (binding) lines.push(`    networkSecurityGroup: { id: ${nsgSymbols.get(binding.nsgId!)}.id }`)
    lines.push(`    ipConfigurations: [`)
    for (const config of nic.ipConfigurations) {
      lines.push(`      {`, `        name: ${name(`nic-${nic.id}-ipconfigs`, config.name)}`, `        properties: {`,
        `          subnet: { id: ${subnetReference(nic.owner.id, config.subnetId)} }`,
        `          privateIPAllocationMethod: '${config.privateIp ? 'Static' : 'Dynamic'}'`, `          privateIPAddressVersion: 'IPv4'`)
      if (config.privateIp) lines.push(`          privateIPAddress: ${quote(config.privateIp)}`)
      if (config.primary !== undefined) lines.push(`          primary: ${config.primary}`)
      if (config.publicIpId) lines.push(`          publicIPAddress: { id: ${publicSymbols.get(config.publicIpId)}.id }`)
      const pools: string[] = [], natRules: string[] = []
      for (const lb of inventory.loadBalancers ?? []) {
        const sym = lbSymbols.get(lb.id)
        if (!sym) continue
        for (const pool of lb.pools) if (pool.members.some((member) => member.nicId === nic.id && member.ipConfigurationId === config.id)) {
          pools.push(`            { id: format('{0}/backendAddressPools/{1}', ${sym}.id, ${childNames.get(pool.id)}) }`)
        }
        for (const rule of lb.inboundNatRules) if (rule.target.nicId === nic.id && rule.target.ipConfigurationId === config.id) {
          natRules.push(`            { id: format('{0}/inboundNatRules/{1}', ${sym}.id, ${childNames.get(rule.id)}) }`)
        }
      }
      if (pools.length) lines.push(`          loadBalancerBackendAddressPools: [`, ...pools, `          ]`)
      if (natRules.length) lines.push(`          loadBalancerInboundNatRules: [`, ...natRules, `          ]`)
      lines.push(`        }`, `      }`)
    }
    lines.push(`    ]`, `  }`, `}`, '')
  }
  for (const policy of inventory.routerDnatPolicies ?? []) {
    const vnet = topology.vnets.find((vnet) => vnet.appliances.some((app) => app.id === policy.owner.id))
    const device = vnet?.appliances.find((app) => app.id === policy.owner.id)
    if (policy.kind !== 'firewall-dnat' || policy.owner.kind !== 'appliance' || device?.kind !== 'azure-firewall'
      || policy.rulesStatus === 'unknown' || !policy.publicIpIds.length || policy.publicIpIds.some((id) => !publicSymbols.has(id))
      || policy.rules.some((rule) => !nicSymbols.has(rule.target.nicId)
        || !inventory.nics.find((nic) => nic.id === rule.target.nicId)?.ipConfigurations.find((config) => config.id === rule.target.ipConfigurationId)?.privateIp)) {
      warnings.push('Router DNAT is omitted unless a complete supported Azure Firewall interface, public pool and original addressed NIC backend are declared. NVA guest rules and unknown policy are retained only in native JSON.')
      continue
    }
    const sym = symbol(`firewall_${device.id}`, 'firewall'); resourceCount++
    lines.push(`resource ${sym} 'Microsoft.Network/azureFirewalls@2024-07-01' = {`, `  name: ${name('firewall', device.name)}`,
      `  location: ${location(vnet!.id)}`, `  properties: {`, `    sku: { name: 'AZFW_VNet', tier: 'Standard' }`, `    ipConfigurations: [`)
    policy.publicIpIds.forEach((id, index) => lines.push(`      { name: 'public-${index + 1}', properties: {`,
      ...(index === 0 ? [`        subnet: { id: ${subnetReference(vnet!.id, device.subnetId)} }`] : []),
      `        publicIPAddress: { id: ${publicSymbols.get(id)}.id }`, `      } }`))
    lines.push(`    ]`, `    natRuleCollections: [`)
    for (const [index, rule] of [...policy.rules].sort((a, b) => a.priority - b.priority).entries()) {
      const privateIp = inventory.nics.find((nic) => nic.id === rule.target.nicId)!.ipConfigurations.find((config) => config.id === rule.target.ipConfigurationId)!.privateIp!
      lines.push(`      { name: 'dnat-${index + 1}', properties: {`, `        priority: ${100 + index}`, `        action: { type: 'Dnat' }`,
        `        rules: [`, `          { name: 'rule-${index + 1}', protocols: [ '${rule.protocol.toUpperCase()}' ]`,
        `            sourceAddresses: [`, ...rule.sourcePrefixes.map((prefix) => `              ${quote(prefix)}`), `            ]`,
        `            destinationAddresses: [ ${publicSymbols.get(rule.publicIpId)}.properties.ipAddress ]`,
        `            destinationPorts: [ '${rule.frontendPort}' ]`, `            translatedAddress: ${quote(privateIp)}`,
        `            translatedPort: '${rule.translatedPort}'`, `          }`, `        ]`, `      } }`)
    }
    lines.push(`    ]`, `  }`, `}`, '')
    warnings.push('Azure Firewall DNAT is exported as ordered Standard inline collections, not a clone of an inherited policy, Premium features or network/application-rule enforcement. Azure assigns its private address; review UDR next hops after deployment.')
  }
  if (nicSymbols.size) warnings.push('Standalone NIC configuration is exported without VM image, OS, guest rules or VM attachments. Attach original workload NICs explicitly before expecting usable LB/DNAT backends. Unknown private addresses use new dynamic allocations.')
  if (lbSymbols.size) warnings.push('Standard LB frontend, NIC-backed pool, probe, inbound-NAT and outbound declarations are exported. Model probe health, listener readiness, sessions and SNAT capacity are not deployable configuration or certified runtime connectivity.')
  if (publicSymbols.size) warnings.push('Azure allocates new public addresses; recorded public IPv4 addresses and illustrative translated ports are not pinned by this starter.')
  for (const binding of inventory.nsgAssociations ?? []) if (binding.status === 'unknown' || !nsgSymbols.has(binding.nsgId!)) {
    warnings.push('Unknown or unsupported NSG associations are omitted, not reproduced as known unfiltered access. Resolve captured filtering before deploying the starter.')
  }
  return { lines, warnings, nsgSymbols, resourceCount }
}
