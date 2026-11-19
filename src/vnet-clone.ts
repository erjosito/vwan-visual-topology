import type { Spoke, Topology } from './model'
import type { AzNetTopology, AzVNet, AzSubnet } from './azure-net/model'
import { cidr, formatIpv4 } from './validation'

export type CloneTopology = Topology | AzNetTopology

export function vnetCloneSource(topology: CloneTopology, id: string) {
  return topology.version === 1 ? topology.spokes.find(vnet => vnet.id === id) : topology.vnets.find(vnet => vnet.id === id)
}

export function cloneVnetStructure(topology: CloneTopology, sourceId: string, name: string, prefixes: string[]): Spoke | AzVNet {
  const source = vnetCloneSource(topology, sourceId)
  if (!source) throw new Error('The source VNet is no longer available.')
  const vnets = topology.version === 1 ? topology.spokes : topology.vnets
  name = name.trim()
  if (!name || name.length > 120) throw new Error('The new VNet name must contain 1-120 characters.')
  if (vnets.some(vnet => vnet.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Choose a VNet name that is not already in this design.')
  }
  const oldRanges = source.prefixes.map(cidr), newRanges = prefixes.map(cidr)
  if (!prefixes.length || prefixes.length !== source.prefixes.length || oldRanges.some(range => !range)
    || newRanges.some((range, index) => !range || range.length !== oldRanges[index]?.length)) {
    throw new Error('Enter one canonical IPv4 CIDR per source address space, in the same order and with the same prefix lengths.')
  }
  const overlaps = (a: NonNullable<ReturnType<typeof cidr>>, b: NonNullable<ReturnType<typeof cidr>>) =>
    a.network < b.network + 2 ** (32 - b.length) && b.network < a.network + 2 ** (32 - a.length)
  const ranges = newRanges as NonNullable<ReturnType<typeof cidr>>[]
  const originals = oldRanges as NonNullable<ReturnType<typeof cidr>>[]
  if (originals.some((range, index) => originals.slice(0, index).some(other => overlaps(range, other)))) {
    throw new Error('Source address spaces overlap. Resolve them before cloning.')
  }
  // Site advertisements can include aggregates/default routes; they do not declare VNet address-space ownership.
  const occupied = [...vnets.flatMap(vnet => vnet.prefixes),
    ...(topology.version === 1 ? [] : topology.vwanHubs.flatMap(hub => hub.prefix ? [hub.prefix] : []))]
    .map(cidr).filter((range): range is NonNullable<typeof range> => !!range)
  if (ranges.some((range, index) => occupied.some(other => overlaps(range, other))
    || ranges.slice(0, index).some(other => overlaps(range, other)))) {
    throw new Error('New address spaces must not overlap each other or existing VNet or virtual hub address spaces.')
  }
  const id = crypto.randomUUID()
  const subnets = source.subnets?.map((subnet, index) => {
    const parsed = cidr(subnet.prefix)
    const parent = parsed ? originals.findIndex(range => parsed.length >= range.length
      && parsed.network >= range.network && parsed.network + 2 ** (32 - parsed.length) <= range.network + 2 ** (32 - range.length)) : -1
    if (!parsed || parent < 0) throw new Error('Every source subnet must fit within a source VNet address space.')
    const basic = {
      id: `${id}-subnet-${index + 1}`, name: subnet.name,
      prefix: `${formatIpv4(ranges[parent].network + parsed.network - originals[parent].network)}/${parsed.length}`,
    }
    if (!('gateways' in source)) return basic
    const settings = subnet as AzSubnet
    return { ...basic,
      ...(settings.delegations ? { delegations: [...settings.delegations] } : {}),
      ...(settings.defaultOutboundAccess !== undefined ? { defaultOutboundAccess: settings.defaultOutboundAccess } : {}),
      ...(settings.internetEgressStatus ? { internetEgressStatus: settings.internetEgressStatus } : {}),
      ...(settings.privateEndpointNetworkPolicies ? { privateEndpointNetworkPolicies: settings.privateEndpointNetworkPolicies } : {}),
    }
  })
  const basic = { id, name, prefixes: [...prefixes], region: source.region }
  return 'gateways' in source
    ? { ...basic, region: source.region, role: source.role, subnets: subnets ?? [], gateways: [], appliances: [] }
    : { ...basic, ...(subnets ? { subnets } : {}) }
}
