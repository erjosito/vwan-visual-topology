import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import { t } from './i18n'

export interface HubGatewayConnection { id: string; name: string; transport: 'VPN' | 'ExpressRoute'; enabled: boolean }

export function hubGatewayConnections(topology: Topology, hubId: string): HubGatewayConnection[] {
  return [
    ...topology.connections.filter((connection) => connection.hubId === hubId && (connection.transport === 'VPN' || connection.transport === 'ExpressRoute'))
      .map((connection) => ({ id: connection.id, name: connection.name, transport: connection.transport as 'VPN' | 'ExpressRoute', enabled: connection.enabled })),
    ...(topology.erLinks ?? []).filter((link) => link.hubId === hubId)
      .map((link) => ({ id: link.id, name: link.name, transport: 'ExpressRoute' as const, enabled: link.enabled })),
  ]
}

export function azHubGatewayConnections(topology: AzNetTopology, hubId: string): HubGatewayConnection[] {
  return [
    ...topology.vpnConnections.filter((link) => link.transport !== 'SDWAN' && link.targetKind === 'vwan-hub' && link.targetId === hubId)
      .map((link) => ({ id: link.id, name: link.name, transport: 'VPN' as const, enabled: link.enabled })),
    ...topology.erLinks.filter((link) => link.targetKind === 'vwan-hub' && link.targetId === hubId)
      .map((link) => ({ id: link.id, name: link.name, transport: 'ExpressRoute' as const, enabled: link.enabled })),
  ]
}

export function hubGatewayLabel(connections: HubGatewayConnection[]) {
  const vpn = connections.filter((connection) => connection.transport === 'VPN')
  const er = connections.filter((connection) => connection.transport === 'ExpressRoute')
  return t('Modeled VPN {0}/{1} · ER {2}/{3}', vpn.filter((connection) => connection.enabled).length, vpn.length,
    er.filter((connection) => connection.enabled).length, er.length)
}
