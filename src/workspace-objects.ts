import { siteLabel, transportLabels } from './model'
import type { ObjectSelection, Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import type { AzSelectedEntity } from './azure-net/AzureNetDiagram'

export interface WorkspaceIdentity {
  readonly family: 'vwan' | 'azure-net'
  readonly kind: ObjectSelection['kind'] | AzSelectedEntity['kind']
  readonly id: string
  readonly ownerId?: string
}

export interface WorkspaceObject<Selection> {
  readonly identity: WorkspaceIdentity
  readonly selection: Selection
  readonly name: string
  readonly label?: string
  readonly kindLabel: string
  readonly parents: readonly string[]
  readonly searchTerms: readonly string[]
  readonly enabled?: boolean
}

export function workspaceIdentityKey(identity: WorkspaceIdentity) {
  return JSON.stringify([identity.family, identity.kind, identity.ownerId ?? null, identity.id])
}

export function vwanWorkspaceIdentity(selection: ObjectSelection): WorkspaceIdentity {
  return { family: 'vwan', kind: selection.kind, id: selection.id }
}

export function azWorkspaceIdentity(selection: AzSelectedEntity): WorkspaceIdentity {
  let id: string
  switch (selection.kind) {
    case 'subnet': id = selection.subnetId; break
    case 'vnet': id = selection.vnetId; break
    case 'gateway': id = selection.gatewayId; break
    case 'route-server': id = selection.routeServerId; break
    case 'appliance': id = selection.applianceId; break
    case 'peering': id = selection.peeringId; break
    case 'er-link': case 'er-global-reach-link': id = selection.linkId; break
    case 'vpn-connection': id = selection.connectionId; break
    case 'site-link': id = selection.siteLinkId; break
    case 'vwan-hub': id = selection.hubId; break
    case 'er-location': id = selection.locationId; break
    case 'site': id = selection.siteId; break
  }
  return { family: 'azure-net', kind: selection.kind, id,
    ownerId: 'vnetId' in selection && selection.kind !== 'vnet' ? selection.vnetId : undefined }
}

type NamedObject = { id: string; name: string; label?: string }

function inventoryBuilder<Selection>(identity: (selection: Selection) => WorkspaceIdentity) {
  const objects: WorkspaceObject<Selection>[] = []
  const add = (object: NamedObject, selection: Selection, kindLabel: string, parents: string[] = [], searchTerms: string[] = [], enabled?: boolean) => {
    objects.push({ identity: identity(selection), selection, name: object.name, label: object.label,
      kindLabel, parents, searchTerms, enabled })
  }
  return { objects, add }
}

export function vwanWorkspaceObjects(topology: Topology): readonly WorkspaceObject<ObjectSelection>[] {
  const { objects, add } = inventoryBuilder(vwanWorkspaceIdentity)
  const hubNames = new Map(topology.hubs.map((hub) => [hub.id, hub.label ?? hub.name]))
  const siteNames = new Map(topology.sites.map((site) => [site.id, site.label ?? site.name]))
  const locationNames = new Map((topology.erLocations ?? []).map((location) => [location.id, location.label ?? location.name]))
  const names = (...values: (string | undefined)[]) => values.filter((value): value is string => !!value)
  for (const hub of topology.hubs) add(hub, { kind: 'hub', id: hub.id }, 'Virtual WAN hub')
  for (const spoke of topology.spokes) add(spoke, { kind: 'spoke', id: spoke.id }, 'VNet', names(hubNames.get(spoke.hubId ?? '')))
  for (const site of topology.sites) add(site, { kind: 'site', id: site.id }, siteLabel(topology, site.id))
  for (const location of topology.erLocations ?? []) add(location, { kind: 'erLocation', id: location.id }, 'ER location')
  for (const connection of topology.connections) add(connection, { kind: 'connection', id: connection.id }, 'Connection',
    names(hubNames.get(connection.hubId), siteNames.get(connection.siteId)), [connection.transport, transportLabels[connection.transport]], connection.enabled)
  for (const link of topology.siteLinks) add(link, { kind: 'siteLink', id: link.id }, 'Site link',
    names(siteNames.get(link.a), siteNames.get(link.b)), [], link.enabled)
  for (const link of topology.erLinks ?? []) add(link, { kind: 'erLink', id: link.id }, 'ER connection',
    names(locationNames.get(link.locationId), hubNames.get(link.hubId ?? ''), siteNames.get(link.siteId ?? '')), [], link.enabled)
  return objects
}

export function azWorkspaceObjects(topology: AzNetTopology): readonly WorkspaceObject<AzSelectedEntity>[] {
  const { objects, add } = inventoryBuilder(azWorkspaceIdentity)
  const nodeNames = new Map([...topology.vnets, ...topology.vwanHubs, ...topology.sites, ...topology.erLocations]
    .map((node) => [node.id, node.label ?? node.name]))
  const names = (...ids: string[]) => ids.flatMap((id) => nodeNames.has(id) ? [nodeNames.get(id)!] : [])
  for (const vnet of topology.vnets) {
    const parents = [...new Set([vnet.name, vnet.label ?? vnet.name])]
    const subnets = new Map(vnet.subnets.map((subnet) => [subnet.id, subnet]))
    add(vnet, { kind: 'vnet', vnetId: vnet.id }, 'VNet', [], [vnet.role, vnet.region])
    for (const subnet of vnet.subnets) add(subnet, { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id }, 'Subnet', parents)
    for (const gateway of vnet.gateways) {
      nodeNames.set(gateway.id, gateway.name)
      add(gateway, { kind: 'gateway', vnetId: vnet.id, gatewayId: gateway.id },
        gateway.kind === 'Vpn' ? 'VPN gateway' : 'ExpressRoute gateway', parents, [], gateway.enabled)
    }
    if (vnet.routeServer) add(vnet.routeServer, { kind: 'route-server', vnetId: vnet.id, routeServerId: vnet.routeServer.id }, 'Azure Route Server', parents, [], vnet.routeServer.enabled)
    for (const appliance of vnet.appliances) {
      nodeNames.set(appliance.id, appliance.name)
      const subnet = subnets.get(appliance.subnetId)
      add(appliance, { kind: 'appliance', vnetId: vnet.id, applianceId: appliance.id },
        appliance.kind === 'azure-firewall' ? 'Azure Firewall' : appliance.kind === 'vnra' ? 'VNRA' : 'NVA',
        [...parents, ...(subnet ? [subnet.name] : [])])
    }
  }
  for (const hub of topology.vwanHubs) add(hub, { kind: 'vwan-hub', hubId: hub.id }, 'Virtual WAN hub')
  for (const site of topology.sites) add(site, { kind: 'site', siteId: site.id }, 'site')
  for (const location of topology.erLocations) add(location, { kind: 'er-location', locationId: location.id }, 'ER location')
  for (const peering of topology.vnetPeerings) add(peering, { kind: 'peering', peeringId: peering.id }, 'VNet peering',
    names(peering.vnetAId, peering.vnetBId), [], peering.enabled)
  for (const link of topology.erLinks) add(link, { kind: 'er-link', linkId: link.id }, 'ER connection', names(link.locationId, link.targetId), [], link.enabled)
  for (const link of topology.erGlobalReachLinks ?? []) add(link, { kind: 'er-global-reach-link', linkId: link.id }, 'Global Reach link',
    names(link.locationAId, link.locationBId), [], link.enabled)
  for (const connection of topology.vpnConnections) add(connection, { kind: 'vpn-connection', connectionId: connection.id }, connection.transport === 'SDWAN' ? 'SD-WAN connection' : 'VPN connection',
    names(connection.siteId, connection.targetId), [], connection.enabled)
  for (const link of topology.siteLinks) add(link, { kind: 'site-link', siteLinkId: link.id }, 'Site link', names(link.siteAId, link.siteBId), [], link.enabled)
  return objects
}
