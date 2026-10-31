import type { Topology } from './model'
import { cidr, contains, validateTopology } from './validation'

export interface HubDeployment { hubId: string; selected: boolean; name: string; location: string; addressPrefix: string }
export interface BicepSettings { wanName: string; location: string; hubs: HubDeployment[] }
export interface BicepExport { text: string; warnings: string[]; resourceCount: number }
const apiVersion = '2024-10-01'
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
  return {
    wanName: suggestName(topology.name), location: canonicalLocation(topology.hubs[0]?.region ?? ''),
    hubs: topology.hubs.map((hub) => {
      const base = suggestName(hub.name)
      let name = base, suffix = 2
      while (used.has(name)) name = `${base}-${suffix++}`
      used.add(name)
      return { hubId: hub.id, selected: true, name, location: canonicalLocation(hub.region), addressPrefix: topology.azureImport?.hubs.find((source) => source.hubId === hub.id)?.addressPrefix ?? '' }
    }),
  }
}

export function hubExportBlocker(topology: Topology, hubId: string): string | undefined {
  const hub = topology.hubs.find((hub) => hub.id === hubId)
  if (!hub) return 'This hub no longer exists.'
  if (hub.routingIntent.private || hub.routingIntent.internet) return 'Secured hubs require firewall deployment support (#4); exclude this hub rather than export it unsecured.'
  if (hub.routeMapAssignments?.length) return 'Assigned hub route maps are not exportable; exclude this hub.'
  if (topology.azureImport?.hubs.find((entry) => entry.hubId === hubId)?.limitations.length) return 'This imported hub has unsupported or incompletely captured configuration; exclude it.'
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
  const selected = settings.hubs.filter((hub) => hub.selected)
  if (!selected.length) throw new Error('Select at least one supported hub.')
  const names = new Set<string>()
  const knownPrefixes = [...topology.spokes.flatMap((spoke) => spoke.prefixes), ...topology.sites.flatMap((site) => site.prefixes)]
  for (const hub of selected) {
    const blocker = hubExportBlocker(topology, hub.hubId)
    if (blocker) throw new Error(blocker)
    name(hub.name); location(hub.location)
    if (names.has(hub.name.toLowerCase())) throw new Error('Deployment hub names must be unique (case-insensitive).')
    names.add(hub.name.toLowerCase())
    const parsed = cidr(hub.addressPrefix)
    if (!parsed || parsed.length > 24) throw new Error('Each hub needs an explicit IPv4 network CIDR of /24 or larger; /23 or larger is recommended. Do not reuse a destination prefix.')
    const overlaps = (other: string) => contains(other, parsed.network) || contains(hub.addressPrefix, cidr(other)!.network)
    if (knownPrefixes.some(overlaps) || selected.some((other) => other !== hub && !!cidr(other.addressPrefix) && overlaps(other.addressPrefix))) throw new Error('Hub infrastructure prefixes must not overlap each other or known spoke/site networks.')
  }
  const warnings = [
    'NEW-DEPLOYMENT STARTER ONLY: not an Azure clone or lossless topology export. Review target names and run Bicep build and Azure what-if externally before deployment.',
    'Only one Standard Virtual WAN and selected bare hubs are created. No gateways, ER resources, VPN/on-premises sites, NVAs, VNet attachments, route maps, firewall policies or observed routes are emitted.',
    `Omitted simulator objects: ${topology.spokes.length} spokes, ${topology.sites.length} sites, ${topology.connections.length} hub/site connections, ${topology.siteLinks.length} site links, ${topology.erLocations?.length ?? 0} ER locations, ${topology.erLinks?.length ?? 0} ER attachments, ${topology.routeMaps?.length ?? 0} route maps.`,
    `Excluded hubs: ${topology.hubs.filter((hub) => !selected.some((entry) => entry.hubId === hub.id)).map((hub) => hub.name).join(', ') || 'none'}.`,
    'Hub router minimum capacity defaults to 2 routing infrastructure units. Deployed resources incur Azure charges; quotas, regions, target resources and address ownership are not verified offline.',
    ...(topology.azureImport ? ['Imported source resource IDs are not used in the template. Capture limitations remain in the native JSON, not in Azure deployment configuration.'] : []),
    ...(topology.connections.some((connection) => connection.transport === 'SpokeNVA') ? ['Spoke NVA BGP peers, interface addresses, advertisements, appliance routing and downstream connections are omitted. This template does not enable BGP on a spoke.'] : []),
  ]
  const quote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('${', '\\${').replaceAll('\r', '\\r').replaceAll('\n', '\\n')}'`
  const comment = (value: string) => value.replace(/[\r\n\u2028\u2029]/g, ' ')
  const hubs = [...selected].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((entry) => {
    const hub = topology.hubs.find((hub) => hub.id === entry.hubId)!
    return `  {\n    name: ${quote(entry.name)}\n    location: ${quote(entry.location)}\n    addressPrefix: ${quote(entry.addressPrefix)}\n    routingPreference: ${quote(hub.preference === 'VPN' ? 'VpnGateway' : hub.preference)}\n  }`
  }).join('\n')
  return { resourceCount: selected.length + 1, warnings, text: `${warnings.map((warning) => `// ${comment(warning)}`).join('\n')}
targetScope = 'resourceGroup'

param wanName string = ${quote(settings.wanName)}
param wanLocation string = ${quote(settings.location)}
@minValue(2)
@maxValue(50)
param hubMinimumCapacity int = 2
param hubSettings array = [
${hubs}
]

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
}]

output wanResourceId string = wan.id
output hubResourceIds array = [for (hub, i) in hubSettings: hubs[i].id]
` }
}
