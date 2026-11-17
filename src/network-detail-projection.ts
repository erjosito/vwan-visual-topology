import { sameInventoryOwner, type InventoryOwner, type InventoryTopology } from './inventory'
import type { ApplicationReference } from './application'

export type DetailTarget =
  | { kind: 'network' | 'subnet' | 'appliance' | 'gateway' | 'route-server' | 'site'; id: string }

export interface DetailEntity {
  id: string
  name: string
  kind: 'nic' | 'appliance' | 'gateway' | 'route-server' | 'nat' | 'load-balancer' | 'private-endpoint' | 'application'
  label: string
  subnetIds: string[]
  addresses: string[]
  subnetAddresses?: { subnetId: string; address: string }[]
  workloadIds: string[]
  target?: DetailTarget
  original: object
}

/** Project declared references only. In particular, gateways have no subnet association. */
export function networkDetailProjection(topology: InventoryTopology, owner: InventoryOwner): DetailEntity[] {
  const inventory = topology.inventory
  const nics = (inventory?.nics ?? []).filter((nic) => sameInventoryOwner(nic.owner, owner))
  const workloads = inventory?.workloads ?? []
  const vnet = topology.version === 2 && owner.kind === 'vnet' ? topology.vnets.find((entry) => entry.id === owner.id) : undefined
  const entities: DetailEntity[] = nics.map((nic) => ({
    id: nic.id, name: nic.name, kind: 'nic', label: 'NIC',
    subnetIds: [...new Set(nic.ipConfigurations.map((config) => config.subnetId))],
    addresses: nic.ipConfigurations.flatMap((config) => config.privateIp ? [config.privateIp] : []),
    subnetAddresses: nic.ipConfigurations.flatMap((config) => config.privateIp ? [{ subnetId: config.subnetId, address: config.privateIp }] : []),
    workloadIds: workloads.filter((workload) => workload.nicIds.includes(nic.id)).map((workload) => workload.id),
    original: nic,
  }))
  if (topology.version === 1 && owner.kind === 'spoke') {
    const siteIds = new Set(topology.connections.filter((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === owner.id).map((connection) => connection.siteId))
    for (const site of topology.sites.filter((site) => siteIds.has(site.id))) entities.push({
      id: site.id, name: site.name, kind: 'appliance', label: 'NVA', subnetIds: [],
      addresses: [...new Set(topology.connections.filter((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === owner.id && connection.siteId === site.id)
        .flatMap((connection) => connection.peerIp ? [connection.peerIp] : []))],
      workloadIds: workloads.filter((workload) => workload.backingDeviceId === site.id).map((workload) => workload.id),
      target: { kind: 'site', id: site.id }, original: site,
    })
  }
  for (const device of vnet?.appliances ?? []) entities.push({
    id: device.id, name: device.name, kind: 'appliance',
    label: device.kind === 'vnra' ? 'Managed VNRA' : device.kind === 'azure-firewall' ? 'Azure Firewall' : 'NVA',
    subnetIds: [device.subnetId], addresses: [device.privateIp],
    workloadIds: workloads.filter((workload) => workload.backingDeviceId === device.id).map((workload) => workload.id),
    target: { kind: 'appliance', id: device.id }, original: device,
  })
  for (const gateway of vnet?.gateways ?? []) entities.push({
    id: gateway.id, name: gateway.name, kind: 'gateway', label: gateway.kind === 'Vpn' ? 'VPN Gateway' : 'ExpressRoute Gateway',
    subnetIds: [], addresses: [], workloadIds: [], target: { kind: 'gateway', id: gateway.id }, original: gateway,
  })
  if (vnet?.routeServer) {
    const server = vnet.routeServer
    entities.push({ id: server.id, name: server.name, kind: 'route-server', label: 'Azure Route Server',
      subnetIds: server.subnetId ? [server.subnetId] : [], addresses: [], workloadIds: [],
      target: { kind: 'route-server', id: server.id }, original: server })
  }
  for (const subnet of vnet?.subnets ?? []) for (const endpoint of subnet.privateEndpoints ?? []) entities.push({
    id: endpoint.id, name: endpoint.name, kind: 'private-endpoint', label: 'Private endpoint',
    subnetIds: [subnet.id], addresses: [endpoint.ipAddress, endpoint.serviceName], workloadIds: [], original: endpoint,
  })
  for (const nat of inventory?.natGateways ?? []) if (sameInventoryOwner(nat.owner, owner)) entities.push({
    id: nat.id, name: nat.name, kind: 'nat', label: 'NAT Gateway', subnetIds: nat.subnetIds, addresses: [], workloadIds: [], original: nat,
  })
  const memberSubnets = (ref: { workloadId: string; nicId: string; ipConfigurationId: string }) =>
    workloads.find((workload) => workload.id === ref.workloadId)?.nicIds.includes(ref.nicId)
      ? nics.find((nic) => nic.id === ref.nicId)?.ipConfigurations.filter((config) => config.id === ref.ipConfigurationId).map((config) => config.subnetId) ?? [] : []
  for (const lb of inventory?.loadBalancers ?? []) if (sameInventoryOwner(lb.owner, owner)) entities.push({
    id: lb.id, name: lb.name, kind: 'load-balancer', label: 'Standard Load Balancer',
    subnetIds: [...new Set([...lb.frontends.flatMap((frontend) => frontend.kind === 'private' ? [frontend.subnetId] : []),
      ...lb.pools.flatMap((pool) => pool.members.flatMap(memberSubnets))])],
    addresses: [], workloadIds: [], original: lb,
  })
  const applications = [...(topology.application?.services ?? []), ...(topology.application?.dnsProfiles ?? [])]
  const applicationsById = new Map(applications.map((application) => [application.id, application]))
  const referenceSubnets = (ref: ApplicationReference): string[] => {
    if (ref.kind === 'subnet') return sameInventoryOwner(ref.owner, owner) ? [ref.id] : []
    if (ref.kind === 'workload') return memberSubnets(ref)
    if (ref.kind === 'public-ip') return [...new Set(nics.flatMap((nic) =>
      nic.ipConfigurations.filter((config) => config.publicIpId === ref.id).map((config) => config.subnetId)))]
    if (ref.kind === 'load-balancer-frontend' || ref.kind === 'load-balancer-pool') {
      const lb = inventory?.loadBalancers?.find((lb) => lb.id === ref.loadBalancerId && sameInventoryOwner(lb.owner, owner))
      if (ref.kind === 'load-balancer-pool') return lb?.pools.find((pool) => pool.id === ref.id)?.members.flatMap(memberSubnets) ?? []
      const frontend = lb?.frontends.find((frontend) => frontend.id === ref.id)
      return frontend?.kind === 'private' ? [frontend.subnetId] : []
    }
    return []
  }
  for (const application of applications) {
    const subnets = new Set<string>(), seen = new Set([application.id])
    const pending = [...application.references].reverse()
    // Visit shared services once per root, including cycles, rather than once per path through a DAG.
    while (pending.length) {
      const ref = pending.pop()!
      if (ref.kind === 'service' || ref.kind === 'dns-profile') {
        if (seen.has(ref.id)) continue
        seen.add(ref.id)
        const references = applicationsById.get(ref.id)?.references ?? []
        for (let index = references.length - 1; index >= 0; index--) pending.push(references[index])
      } else for (const subnetId of referenceSubnets(ref)) subnets.add(subnetId)
    }
    const subnetIds = [...subnets]
    if (subnetIds.length || ('owner' in application && application.owner && sameInventoryOwner(application.owner, owner))) entities.push({
      id: application.id, name: application.name, kind: 'application', label: 'Application reference',
      subnetIds, addresses: [], workloadIds: [], original: application,
    })
  }
  return entities
}
