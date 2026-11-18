export interface VnetBgpCommunities {
  virtualNetworkCommunity?: string
  /** Azure-returned metadata, never inferred from the VNet region or exported as configuration. */
  regionalCommunity?: string
}

export const vnetCommunityHelp = 'VNet communities are advertised over classic ExpressRoute private peering only, not Virtual WAN, VPN, VNet peering or NVA BGP. Regional communities are captured metadata; no regional tag is generated.'
export const vnetCommunityError = 'Use one community in the form 12076:0–65535 (no spaces or leading zeros).'

export function isVnetCommunity(value: unknown): value is string {
  return typeof value === 'string' && /^12076:(0|[1-9]\d{0,4})$/.test(value) && Number(value.split(':')[1]) <= 65535
}

export function parseVnetBgpCommunities(value: unknown): VnetBgpCommunities | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(vnetCommunityError)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'virtualNetworkCommunity' && key !== 'regionalCommunity')) {
    throw new Error('Unknown VNet BGP community property.')
  }
  for (const field of ['virtualNetworkCommunity', 'regionalCommunity'] as const) {
    if (record[field] !== undefined && !isVnetCommunity(record[field])) throw new Error(vnetCommunityError)
  }
  return {
    ...(record.virtualNetworkCommunity === undefined ? {} : { virtualNetworkCommunity: record.virtualNetworkCommunity as string }),
    ...(record.regionalCommunity === undefined ? {} : { regionalCommunity: record.regionalCommunity as string }),
  }
}

export function vnetCommunityValues(communities?: VnetBgpCommunities): string[] {
  return [...new Set([communities?.virtualNetworkCommunity, communities?.regionalCommunity].filter((value): value is string => value !== undefined))]
}
