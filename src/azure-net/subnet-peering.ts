import { cidr, contains } from '../validation'
import type { AzNetTopology, AzVnetPeering, AzVNet } from './model'

export function peeringSubnetIds(peering: AzVnetPeering, vnetId: string): string[] | undefined {
  if (peering.scope?.type !== 'subnets') return undefined
  return vnetId === peering.vnetAId ? peering.scope.subnetAIds : vnetId === peering.vnetBId ? peering.scope.subnetBIds : []
}

export function peeringPrefixes(peering: AzVnetPeering, vnet: AzVNet): string[] {
  const ids = peeringSubnetIds(peering, vnet.id)
  return ids === undefined ? vnet.prefixes : vnet.subnets.filter((subnet) => ids.includes(subnet.id)).map((subnet) => subnet.prefix)
}

const overlaps = (a: string, b: string) => {
  const left = cidr(a), right = cidr(b)
  return Boolean(left && right && (contains(a, right.network) || contains(b, left.network)))
}

export function validateSubnetPeeringScopes(topology: AzNetTopology): string[] {
  const errors: string[] = []
  const pairs = new Set<string>()
  const remoteSpaces = new Map<string, { peeringId: string; prefix: string; selected: boolean }[]>()
  const counts = new Map<string, number>()
  for (const peering of topology.vnetPeerings) {
    const pair = JSON.stringify([peering.vnetAId, peering.vnetBId].sort())
    if (peering.vnetAId === peering.vnetBId || pairs.has(pair)) errors.push(`Peering "${peering.name}": only one peering link per distinct VNet pair is allowed.`)
    pairs.add(pair)
    if (peering.scope?.type !== 'subnets') {
      for (const [localId, remoteId] of [[peering.vnetAId, peering.vnetBId], [peering.vnetBId, peering.vnetAId]]) {
        const seen = remoteSpaces.get(remoteId) ?? []
        seen.push(...(topology.vnets.find((vnet) => vnet.id === localId)?.prefixes ?? [])
          .map((prefix) => ({ peeringId: peering.id, prefix, selected: false })))
        remoteSpaces.set(remoteId, seen)
      }
      continue
    }
    for (const [localId, remoteId] of [[peering.vnetAId, peering.vnetBId], [peering.vnetBId, peering.vnetAId]]) {
      const local = topology.vnets.find((vnet) => vnet.id === localId)
      const remote = topology.vnets.find((vnet) => vnet.id === remoteId)
      if (!local || !remote) continue
      const ids = peeringSubnetIds(peering, localId)!
      if (!ids.length || ids.length > 200 || new Set(ids).size !== ids.length) {
        errors.push(`Peering "${peering.name}": each side requires 1-200 unique participating subnet IDs.`)
      }
      const parents = new Set<string>()
      for (const id of ids) {
        const subnet = local.subnets.find((subnet) => subnet.id === id)
        if (!subnet) { errors.push(`Peering "${peering.name}": subnet "${id}" does not belong to VNet "${local.name}" (deleted or mismatched reference).`); continue }
        const prefix = cidr(subnet.prefix)
        if (local.subnets.some((other) => other.id !== subnet.id && overlaps(subnet.prefix, other.prefix))) {
          errors.push(`Peering "${peering.name}": participating subnet "${subnet.id}" overlaps another local subnet.`)
        }
        const spaces = prefix ? local.prefixes.filter((space) => {
          const parsed = cidr(space)
          return parsed && parsed.length <= prefix.length && contains(space, prefix.network)
        }) : []
        if (!prefix || spaces.length !== 1) errors.push(`Peering "${peering.name}": participating subnets require IPv4 prefixes within one owning VNet address space; IPv6 is not supported.`)
        for (const parent of spaces) {
          parents.add(parent)
          if (remote.prefixes.some((other) => overlaps(parent, other))) errors.push(`Peering "${peering.name}": participating address space "${parent}" overlaps the remote VNet address space.`)
        }
      }
      const seen = remoteSpaces.get(remoteId) ?? []
      for (const prefix of parents) {
        seen.push({ peeringId: peering.id, prefix, selected: true })
      }
      remoteSpaces.set(remoteId, seen)
      counts.set(remoteId, (counts.get(remoteId) ?? 0) + ids.length)
    }
  }
  for (const [vnetId, spaces] of remoteSpaces) if (spaces.some((entry, index) => spaces.slice(index + 1).some((other) =>
    entry.peeringId !== other.peeringId && (entry.selected || other.selected) && overlaps(entry.prefix, other.prefix)))) {
    errors.push(`VNet "${vnetId}": participating remote address spaces overlap across peering links.`)
  }
  for (const [vnetId, count] of counts) if (count > 1000) errors.push(`VNet "${vnetId}": at most 1,000 remote subnets may participate across subnet-peering links.`)
  return [...new Set(errors)]
}

export function subnetPeeringLimitations(topology: AzNetTopology): string[] {
  return topology.vnetPeerings.filter((peering) => peering.enabled && peering.scope?.type === 'subnets').flatMap((peering) => {
    const owners = topology.vnets.filter((vnet) => vnet.id === peering.vnetAId || vnet.id === peering.vnetBId)
    return owners.some((vnet) => vnet.routeServer || vnet.gateways.length || vnet.appliances.length || vnet.vwanHubAttachment ||
      vnet.subnets.some((subnet) => subnet.delegations?.length || subnet.privateEndpoints?.length)) ||
      [peering.aToB, peering.bToA].some((flags) => flags.allowGatewayTransit || flags.useRemoteGateways)
      ? [`Subnet peering "${peering.name}": gateway/ARS/VWAN/appliance transit, private endpoints and delegated-subnet over-advertisement are not assessed. Only direct IPv4 subnet routing is supported.`] : []
  })
}
