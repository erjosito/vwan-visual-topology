import { azureObjectId } from '../azure-import'
import { publicIpv4, type NetworkInventory } from '../inventory'
import { cidr } from '../validation'
import type { AzVNet } from './model'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const records = (value: unknown): Record<string, unknown>[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 512) throw new Error('NAT capture resource list must contain at most 512 entries.')
  return value.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NAT capture resource must be an object.')
    return value as Record<string, unknown>
  })
}
const properties = (entry: Record<string, unknown>) => entry.properties === undefined ? entry : object(entry.properties)
const references = (value: unknown) => records(value).map((entry) => text(entry.id).toLowerCase())

export function importNatCapture(root: Record<string, unknown>, vnets: AzVNet[], subnetsByArmId: Map<string, string>,
  gatewayBySubnet: Map<string, string>, unknown: (resourceId: string, resourceName: string, field: string) => void): NetworkInventory | undefined {
  const inventory: NetworkInventory = { workloads: [], nics: [], publicIps: [] }
  const ipsByArm = new Map<string, string>(), prefixesByArm = new Map<string, string>()
  for (const entry of records(root.publicIpAddresses)) {
    const arm = text(entry.id), name = text(entry.name) || arm.split('/').at(-1) || 'Public IP', props = properties(entry)
    if (!arm) { unknown('', name, 'public IP identity'); continue }
    const id = azureObjectId('pip', arm), sku = text(object(entry.sku).name), allocation = text(props.publicIPAllocationMethod)
    const address = text(props.ipAddress)
    if (address && !publicIpv4(address)) unknown(arm, name, 'public IPv4 address')
    ipsByArm.set(arm.toLowerCase(), id)
    inventory.publicIps.push({ id, name, ...(address && publicIpv4(address) ? { address } : {}),
      ...(sku === 'Basic' || sku === 'Standard' || sku === 'StandardV2' ? { sku } : {}),
      ...(allocation === 'Static' || allocation === 'Dynamic' ? { allocation } : {}) })
  }
  for (const entry of records(root.publicIpPrefixes)) {
    const arm = text(entry.id), name = text(entry.name) || arm.split('/').at(-1) || 'Public prefix', props = properties(entry)
    const prefixLength = props.prefixLength, prefix = text(props.ipPrefix)
    if (!arm || object(entry.sku).name !== 'Standard' || !Number.isInteger(prefixLength) || Number(prefixLength) < 28 || Number(prefixLength) > 31
      || prefix && (!cidr(prefix) || cidr(prefix)!.length !== prefixLength)) {
      unknown(arm, name, 'Standard IPv4 public prefix'); continue
    }
    const id = azureObjectId('prefix', arm)
    prefixesByArm.set(arm.toLowerCase(), id)
    ;(inventory.publicIpPrefixes ??= []).push({ id, name, sku: 'Standard', prefixLength: Number(prefixLength), ...(prefix ? { prefix } : {}) })
  }
  for (const entry of records(root.natGateways)) {
    const arm = text(entry.id), name = text(entry.name) || arm.split('/').at(-1) || 'NAT Gateway', props = properties(entry)
    const subnetReferences = references(props.subnets)
    const subnetIds = [...new Set([...subnetReferences.map((id) => subnetsByArmId.get(id)),
      ...[...gatewayBySubnet].filter(([, id]) => id === arm.toLowerCase()).map(([id]) => id)].filter((id): id is string => !!id))]
    const owner = vnets.find((vnet) => subnetIds.some((id) => vnet.subnets.some((subnet) => subnet.id === id)))
    const ipReferences = references(props.publicIpAddresses), prefixReferences = references(props.publicIpPrefixes)
    const publicIpIds = ipReferences.map((id) => ipsByArm.get(id)), publicIpPrefixIds = prefixReferences.map((id) => prefixesByArm.get(id))
    for (const subnet of vnets.flatMap((vnet) => vnet.subnets).filter((subnet) => subnetIds.includes(subnet.id))) subnet.internetEgressStatus = 'unknown'
    const supported = arm && object(entry.sku).name === 'Standard' && owner && subnetIds.length
      && subnetReferences.every((id) => subnetsByArmId.has(id))
      && subnetIds.every((id) => !gatewayBySubnet.has(id) || gatewayBySubnet.get(id) === arm.toLowerCase())
      && subnetIds.every((id) => owner.subnets.some((subnet) => subnet.id === id && subnet.name.toLowerCase() !== 'gatewaysubnet'))
      && publicIpIds.every((id) => id && inventory.publicIps.some((ip) => ip.id === id && ip.sku === 'Standard' && ip.allocation === 'Static'))
      && publicIpPrefixIds.every((id) => !!id) && (publicIpIds.length || publicIpPrefixIds.length)
    if (!supported) { unknown(arm, name, 'NAT Gateway owner, Standard SKU or public pool'); continue }
    ;(inventory.natGateways ??= []).push({ id: azureObjectId('nat', arm), name, sku: 'Standard', owner: { kind: 'vnet', id: owner!.id },
      subnetIds, publicIpIds: publicIpIds as string[], ...(publicIpPrefixIds.length ? { publicIpPrefixIds: publicIpPrefixIds as string[] } : {}) })
    for (const subnet of owner!.subnets.filter((subnet) => subnetIds.includes(subnet.id))) delete subnet.internetEgressStatus
  }
  for (const [subnetId, arm] of gatewayBySubnet) {
    const subnet = vnets.flatMap((vnet) => vnet.subnets).find((subnet) => subnet.id === subnetId)
    if (subnet?.internetEgressStatus) unknown(arm, subnet.name, 'captured NAT Gateway association')
  }
  return inventory.publicIps.length || inventory.publicIpPrefixes?.length || inventory.natGateways?.length ? inventory : undefined
}
