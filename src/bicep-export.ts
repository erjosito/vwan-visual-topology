import type { Topology } from './model'
import { cidr, contains, validateTopology } from './validation'

export interface HubDeployment {
  hubId: string
  selected: boolean
  name: string
  location: string
  addressPrefix: string
  firewallName?: string
  firewallTier?: 'Standard' | 'Premium'
  firewallPolicyId?: string
  publicIpCount?: number
}
export interface SpokeAttachmentDeployment {
  spokeId: string
  selected: boolean
  name: string
  existingVnetId: string
  enableInternetSecurity: boolean
}
export interface BicepSettings {
  wanName: string
  location: string
  hubs: HubDeployment[]
  spokes?: SpokeAttachmentDeployment[]
}
export interface BicepExport { text: string; warnings: string[]; resourceCount: number }
const apiVersion = '2024-10-01'
const vnetArmPattern = /^\/subscriptions\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/resourceGroups\/[^/?#\r\n]+\/providers\/Microsoft\.Network\/virtualNetworks\/[^/?#\r\n]+$/i
const firewallPolicyArmPattern = /^\/subscriptions\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/resourceGroups\/[^/?#\r\n]+\/providers\/Microsoft\.Network\/firewallPolicies\/[^/?#\r\n]+$/i
const knownLocations: Record<string, string> = {
  'West Europe': 'westeurope', 'North Europe': 'northeurope', 'East US': 'eastus', 'East US 2': 'eastus2',
  'West US': 'westus', 'West US 2': 'westus2', 'West US 3': 'westus3', 'Central US': 'centralus',
  'South Central US': 'southcentralus', 'North Central US': 'northcentralus', 'UK South': 'uksouth', 'UK West': 'ukwest',
  'France Central': 'francecentral', 'Germany West Central': 'germanywestcentral', 'Sweden Central': 'swedencentral',
  'Switzerland North': 'switzerlandnorth', 'Canada Central': 'canadacentral', 'Australia East': 'australiaeast',
  'Southeast Asia': 'southeastasia', 'East Asia': 'eastasia', 'Japan East': 'japaneast', 'Central India': 'centralindia',
  'South Africa North': 'southafricanorth', 'Brazil South': 'brazilsouth', 'UAE North': 'uaenorth',
}
export const canonicalLocation = (value: string) => knownLocations[value] ?? (/^[a-z][a-z0-9]{1,39}$/.test(value) ? value : '')
const suggestName = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 45).replace(/-+$/g, '') || 'vwan'

export function bicepDefaults(topology: Topology): BicepSettings {
  const used = new Set<string>()
  const usedSpokesByHub = new Map<string, Set<string>>()
  return {
    wanName: suggestName(topology.name), location: canonicalLocation(topology.hubs[0]?.region ?? ''),
    hubs: topology.hubs.map((hub) => {
      const base = suggestName(hub.name)
      let name = base, suffix = 2
      while (used.has(name)) name = `${base}-${suffix++}`
      used.add(name)
      const isSecured = hub.routingIntent.private || hub.routingIntent.internet
      return {
        hubId: hub.id,
        selected: true,
        name,
        location: canonicalLocation(hub.region),
        addressPrefix: topology.azureImport?.hubs.find((source) => source.hubId === hub.id)?.addressPrefix ?? '',
        ...(isSecured ? { firewallName: `${name.slice(0, 42)}-fw`, firewallTier: 'Standard' as const, firewallPolicyId: '', publicIpCount: 1 } : {}),
      }
    }),
    spokes: topology.spokes.map((spoke) => {
      const hubKey = spoke.hubId ?? ''
      const hubNames = usedSpokesByHub.get(hubKey) ?? new Set<string>()
      usedSpokesByHub.set(hubKey, hubNames)
      const base = suggestName(spoke.name)
      let name = base, suffix = 2
      while (hubNames.has(name)) name = `${base}-${suffix++}`
      hubNames.add(name)
      return {
        spokeId: spoke.id,
        selected: false,
        name,
        existingVnetId: '',
        enableInternetSecurity: Boolean(spoke.propagateDefaultRoute),
      }
    }),
  }
}

export function hubExportBlocker(topology: Topology, hubId: string, entry?: HubDeployment): string | undefined {
  const hub = topology.hubs.find((hub) => hub.id === hubId)
  if (!hub) return 'This hub no longer exists.'
  if (hub.routeMapAssignments?.length) return 'Assigned hub route maps are not exportable; exclude this hub.'
  if (topology.azureImport?.hubs.find((item) => item.hubId === hubId)?.limitations.length) return 'This imported hub has unsupported or incompletely captured configuration; exclude it.'
  if (hub.routingIntent.private || hub.routingIntent.internet) {
    if (hub.routingIntent.privatePrefixes.length > 0) {
      return 'Secured hubs with custom non-RFC1918 private prefixes cannot be exported because Azure Routing Intent PrivateTraffic covers RFC 1918 only; remove custom private prefixes or exclude this hub.'
    }
    if (!entry?.firewallPolicyId?.trim()) {
      return 'Secured hubs require firewall deployment support (#4): enter an existing Firewall Policy ARM resource ID or exclude this hub rather than export it unsecured.'
    }
  }
}

export function spokeExportBlocker(topology: Topology, spokeId: string): string | undefined {
  const spoke = topology.spokes.find((item) => item.id === spokeId)
  if (!spoke) return 'This spoke no longer exists.'
  if (!spoke.hubId) return 'Standalone VNets not attached to a Virtual WAN hub are not exportable as hub VNet connections; exclude this VNet.'
  if (topology.connections.some((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === spoke.id)) {
    return 'Spoke NVA BGP peers and static routes are not exportable; exclude this spoke attachment.'
  }
  if (topology.azureImport?.hubs.find((item) => item.hubId === spoke.hubId)?.limitations.some((text) => text.includes('VNet connection has custom'))) {
    return 'This imported spoke has custom or unknown route table association/propagation settings; exclude this spoke attachment.'
  }
}

export function generateBicep(input: Topology, settings: BicepSettings): BicepExport {
  const topology = validateTopology(input)
  const name = (value: string) => {
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,48}[a-zA-Z0-9])?$/.test(value)) throw new Error('Resource names must be 1-50 letters/digits/hyphens/underscores, starting and ending with a letter or digit.')
    return value
  }
  const location = (value: string) => {
    if (!/^[a-z][a-z0-9]{1,39}$/.test(value)) throw new Error('Enter canonical Azure location names, such as westeurope. Availability must be checked outside the app.')
    return value
  }
  name(settings.wanName); location(settings.location)
  if (settings.hubs.length > 20 || new Set(settings.hubs.map((hub) => hub.hubId)).size !== settings.hubs.length) throw new Error('Invalid or duplicate deployment hubs.')
  if (settings.spokes && (settings.spokes.length > 1200 || new Set(settings.spokes.map((spoke) => spoke.spokeId)).size !== settings.spokes.length)) {
    throw new Error('Invalid or duplicate deployment spoke attachments.')
  }
  const selected = settings.hubs.filter((hub) => hub.selected)
  if (!selected.length) throw new Error('Select at least one supported hub.')
  const names = new Set<string>()
  const firewallNames = new Set<string>()
  const knownPrefixes = [...topology.spokes.flatMap((spoke) => spoke.prefixes), ...topology.sites.flatMap((site) => site.prefixes)]
  for (const hub of selected) {
    const blocker = hubExportBlocker(topology, hub.hubId, hub)
    if (blocker) throw new Error(blocker)
    name(hub.name); location(hub.location)
    if (names.has(hub.name.toLowerCase())) throw new Error('Deployment hub names must be unique (case-insensitive).')
    names.add(hub.name.toLowerCase())
    const parsed = cidr(hub.addressPrefix)
    if (!parsed || parsed.length > 24) throw new Error('Each hub needs an explicit IPv4 network CIDR of /24 or larger; /23 or larger is recommended. Do not reuse a destination prefix.')
    const overlaps = (other: string) => contains(other, parsed.network) || contains(hub.addressPrefix, cidr(other)!.network)
    if (knownPrefixes.some(overlaps) || selected.some((other) => other !== hub && !!cidr(other.addressPrefix) && overlaps(other.addressPrefix))) throw new Error('Hub infrastructure prefixes must not overlap each other or known spoke/site networks.')
    const modelHub = topology.hubs.find((item) => item.id === hub.hubId)!
    if (modelHub.routingIntent.private || modelHub.routingIntent.internet) {
      const fwName = (hub.firewallName ?? `${hub.name.slice(0, 42)}-fw`).trim()
      name(fwName)
      if (firewallNames.has(fwName.toLowerCase())) throw new Error('Deployment firewall names must be unique (case-insensitive).')
      firewallNames.add(fwName.toLowerCase())
      const fwTier = hub.firewallTier ?? 'Standard'
      if (fwTier !== 'Standard' && fwTier !== 'Premium') throw new Error('Firewall tier must be Standard or Premium.')
      const policyId = (hub.firewallPolicyId ?? '').trim()
      if (!firewallPolicyArmPattern.test(policyId)) throw new Error('Secured hubs require a valid existing Microsoft.Network/firewallPolicies ARM resource ID.')
      const ipCount = hub.publicIpCount ?? 1
      if (!Number.isInteger(ipCount) || ipCount < 1 || ipCount > 100) throw new Error('Firewall public IP count must be an integer between 1 and 100.')
    }
  }
  const selectedSpokes = (settings.spokes ?? []).filter((spoke) => spoke.selected)
  const spokeNamesByHub = new Map<string, Set<string>>()
  const targetVnetIds = new Set<string>()
  for (const spokeEntry of selectedSpokes) {
    const blocker = spokeExportBlocker(topology, spokeEntry.spokeId)
    if (blocker) throw new Error(blocker)
    const modelSpoke = topology.spokes.find((item) => item.id === spokeEntry.spokeId)!
    const parentHubId = modelSpoke.hubId!
    if (!selected.some((hub) => hub.hubId === parentHubId)) {
      throw new Error('Selected spoke attachments require their parent hub to be included in the export.')
    }
    name(spokeEntry.name)
    const hubNames = spokeNamesByHub.get(parentHubId) ?? new Set<string>()
    spokeNamesByHub.set(parentHubId, hubNames)
    if (hubNames.has(spokeEntry.name.toLowerCase())) throw new Error('Spoke connection names must be unique per hub (case-insensitive).')
    hubNames.add(spokeEntry.name.toLowerCase())
    const vnetId = spokeEntry.existingVnetId.trim()
    if (!vnetArmPattern.test(vnetId)) {
      throw new Error('Each selected spoke attachment requires a valid target existing Microsoft.Network/virtualNetworks ARM resource ID.')
    }
    if (targetVnetIds.has(vnetId.toLowerCase())) {
      throw new Error('Target existing VNet resource IDs must be unique across selected spoke attachments.')
    }
    targetVnetIds.add(vnetId.toLowerCase())
  }
  const sortedHubs = [...selected].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const hubIndexById = new Map(sortedHubs.map((hub, index) => [hub.hubId, index]))
  const securedHubs = sortedHubs.filter((entry) => {
    const hub = topology.hubs.find((item) => item.id === entry.hubId)!
    return hub.routingIntent.private || hub.routingIntent.internet
  })
  const sortedSpokes = [...selectedSpokes].sort((a, b) => {
    const hubA = hubIndexById.get(topology.spokes.find((item) => item.id === a.spokeId)!.hubId ?? '') ?? 0
    const hubB = hubIndexById.get(topology.spokes.find((item) => item.id === b.spokeId)!.hubId ?? '') ?? 0
    return hubA !== hubB ? hubA - hubB : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  const omittedSpokesCount = topology.spokes.length - sortedSpokes.length
  const excludedSpokes = topology.spokes.filter((spoke) => !sortedSpokes.some((entry) => entry.spokeId === spoke.id)).map((spoke) => spoke.name)
  const warnings = [
    'NEW-DEPLOYMENT STARTER ONLY: not an Azure clone or lossless topology export. Review target names and run Bicep build and Azure what-if externally before deployment.',
    securedHubs.length || sortedSpokes.length
      ? 'Creates one Standard Virtual WAN, selected hubs, and explicitly configured AZFW_Hub firewalls / routingIntent / existing-VNet connections. No VNets, gateways, ER resources, VPN/on-premises sites, NVAs, route maps, firewall policies or observed routes are created.'
      : 'Only one Standard Virtual WAN and selected bare hubs are created. No gateways, ER resources, VPN/on-premises sites, NVAs, VNet attachments, route maps, firewall policies or observed routes are emitted.',
    `Omitted simulator objects: ${omittedSpokesCount} spokes, ${topology.sites.length} sites, ${topology.connections.length} hub/site connections, ${topology.siteLinks.length} site links, ${topology.erLocations?.length ?? 0} ER locations, ${topology.erLinks?.length ?? 0} ER attachments, ${topology.routeMaps?.length ?? 0} route maps.`,
    `Excluded hubs: ${topology.hubs.filter((hub) => !selected.some((entry) => entry.hubId === hub.id)).map((hub) => hub.name).join(', ') || 'none'}.`,
    ...(sortedSpokes.length ? [`Excluded spoke attachments: ${excludedSpokes.join(', ') || 'none'}.`] : []),
    'Hub router minimum capacity defaults to 2 routing infrastructure units. Deployed resources incur Azure charges; quotas, regions, target resources and address ownership are not verified offline.',
    ...(securedHubs.length || sortedSpokes.length ? ['Existing target ARM resource IDs (VNets and Firewall Policies) are referenced by ID only; target existence, RBAC permissions, peering state and address-space compatibility are not verified offline.'] : []),
    ...(topology.azureImport ? ['Imported source resource IDs are not used in the template. Capture limitations remain in the native JSON, not in Azure deployment configuration.'] : []),
    ...(topology.connections.some((connection) => connection.transport === 'SpokeNVA') ? ['Spoke NVA BGP peers, interface addresses, advertisements, appliance routing and downstream connections are omitted. This template does not enable BGP on a spoke.'] : []),
  ]
  const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('${', '\\${').replaceAll('\r', '\\r').replaceAll('\n', '\\n')}'`
  const comment = (value: string) => value.replace(/[\r\n\u2028\u2029]/g, ' ')
  const hubs = sortedHubs.map((entry) => {
    const hub = topology.hubs.find((hub) => hub.id === entry.hubId)!
    return `  {\n    name: ${quote(entry.name)}\n    location: ${quote(entry.location)}\n    addressPrefix: ${quote(entry.addressPrefix)}\n    routingPreference: ${quote(hub.preference === 'VPN' ? 'VpnGateway' : hub.preference)}\n  }`
  }).join('\n')
  const securedSettingsText = securedHubs.map((entry) => {
    const hub = topology.hubs.find((item) => item.id === entry.hubId)!
    const fwName = (entry.firewallName ?? `${entry.name.slice(0, 42)}-fw`).trim()
    const fwTier = entry.firewallTier ?? 'Standard'
    const policyId = entry.firewallPolicyId!.trim()
    const ipCount = entry.publicIpCount ?? 1
    return `  {\n    hubIndex: ${hubIndexById.get(entry.hubId)!}\n    location: ${quote(entry.location)}\n    firewallName: ${quote(fwName)}\n    firewallTier: ${quote(fwTier)}\n    firewallPolicyId: ${quote(policyId)}\n    publicIpCount: ${ipCount}\n    routingIntentName: ${quote(`${entry.name.slice(0, 35)}-routing-intent`)}\n    privateTraffic: ${hub.routingIntent.private}\n    internetTraffic: ${hub.routingIntent.internet}\n  }`
  }).join('\n')
  const spokeSettingsText = sortedSpokes.map((entry) => {
    const spoke = topology.spokes.find((item) => item.id === entry.spokeId)!
    return `  {\n    hubIndex: ${hubIndexById.get(spoke.hubId ?? '')!}\n    name: ${quote(entry.name)}\n    remoteVirtualNetworkId: ${quote(entry.existingVnetId.trim())}\n    enableInternetSecurity: ${entry.enableInternetSecurity}\n  }`
  }).join('\n')
  const securedParamsBlock = securedHubs.length ? `\nparam securedHubSettings array = [\n${securedSettingsText}\n]` : ''
  const spokeParamsBlock = sortedSpokes.length ? `\nparam spokeConnectionSettings array = [\n${spokeSettingsText}\n]` : ''
  const securedResourcesBlock = securedHubs.length ? `

resource hubFirewalls 'Microsoft.Network/azureFirewalls@${apiVersion}' = [for sec in securedHubSettings: {
  name: sec.firewallName
  location: sec.location
  properties: {
    sku: {
      name: 'AZFW_Hub'
      tier: sec.firewallTier
    }
    virtualHub: {
      id: hubs[sec.hubIndex].id
    }
    hubIPAddresses: {
      publicIPs: {
        count: sec.publicIpCount
      }
    }
    firewallPolicy: {
      id: sec.firewallPolicyId
    }
  }
}]

resource hubRoutingIntents 'Microsoft.Network/virtualHubs/routingIntent@${apiVersion}' = [for (sec, i) in securedHubSettings: {
  parent: hubs[sec.hubIndex]
  name: sec.routingIntentName
  properties: {
    routingPolicies: concat(
      sec.privateTraffic ? [
        {
          name: 'PrivateTrafficPolicy'
          destinations: [
            'PrivateTraffic'
          ]
          nextHop: hubFirewalls[i].id
        }
      ] : [],
      sec.internetTraffic ? [
        {
          name: 'InternetTrafficPolicy'
          destinations: [
            'Internet'
          ]
          nextHop: hubFirewalls[i].id
        }
      ] : []
    )
  }
}]` : ''
  const spokeResourcesBlock = sortedSpokes.length ? `

resource spokeConnections 'Microsoft.Network/virtualHubs/hubVirtualNetworkConnections@${apiVersion}' = [for conn in spokeConnectionSettings: {
  parent: hubs[conn.hubIndex]
  name: conn.name
  properties: {
    remoteVirtualNetwork: {
      id: conn.remoteVirtualNetworkId
    }
    allowHubToRemoteVnetTransit: true
    allowRemoteVnetToUseHubVnetGateways: true
    enableInternetSecurity: conn.enableInternetSecurity
  }
}]` : ''
  return {
    resourceCount: sortedHubs.length + 1 + securedHubs.length * 2 + sortedSpokes.length,
    warnings,
    text: `${warnings.map((warning) => `// ${comment(warning)}`).join('\n')}
targetScope = 'resourceGroup'

param wanName string = ${quote(settings.wanName)}
param wanLocation string = ${quote(settings.location)}
@minValue(2)
@maxValue(50)
param hubMinimumCapacity int = 2
param hubSettings array = [
${hubs}
]${securedParamsBlock}${spokeParamsBlock}

resource wan 'Microsoft.Network/virtualWans@${apiVersion}' = {
  name: wanName
  location: wanLocation
  properties: {
    type: 'Standard'
    allowBranchToBranchTraffic: true
    allowVnetToVnetTraffic: true
    disableVpnEncryption: false
  }
}

resource hubs 'Microsoft.Network/virtualHubs@${apiVersion}' = [for hub in hubSettings: {
  name: hub.name
  location: hub.location
  properties: {
    addressPrefix: hub.addressPrefix
    hubRoutingPreference: hub.routingPreference
    sku: 'Standard'
    virtualRouterAutoScaleConfiguration: {
      minCapacity: hubMinimumCapacity
    }
    virtualWan: {
      id: wan.id
    }
  }
}]${securedResourcesBlock}${spokeResourcesBlock}

output wanResourceId string = wan.id
output hubResourceIds array = [for (hub, i) in hubSettings: hubs[i].id]
`,
  }
}
