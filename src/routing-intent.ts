import type { Hub, HubRoutingConfiguration } from './model'

export type IntentHub = Pick<Hub, 'id' | 'name' | 'routeTables' | 'firewall'> & {
  routingIntent: { private: boolean; internet: boolean; privatePrefixes?: string[] }
}
const defaultRouting = (): HubRoutingConfiguration => ({
  status: 'configured', associatedTableId: 'defaultRouteTable',
  propagatedTableIds: ['defaultRouteTable'], labels: ['default'],
})

export function routingIntentManaged(hub: Pick<IntentHub, 'routingIntent'>): boolean {
  return hub.routingIntent.private || hub.routingIntent.internet
}

export function routingIntentConfiguration(hub: Pick<IntentHub, 'routingIntent'>): HubRoutingConfiguration {
  return hub.routingIntent.private
    ? { status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['noneRouteTable'], labels: [] }
    : defaultRouting()
}

export function routingIntentConflicts(hub: IntentHub): string[] {
  return (hub.routeTables ?? []).flatMap((table) => {
    if (!['defaultRouteTable', 'noneRouteTable'].includes(table.id)) return [`Custom hub table: ${table.name} (${table.id})`]
    return (table.staticRoutes ?? []).filter((route) =>
      table.id !== 'defaultRouteTable' || !hub.firewall || route.destinationType !== 'CIDR' ||
      route.nextHopType !== 'ResourceId' || route.nextHop !== hub.firewall.id)
      .map((route) => `Incompatible hub static route: ${route.name}`)
  })
}

export function routingIntentConfigurationMatches(hub: IntentHub, config?: HubRoutingConfiguration): boolean {
  if (!config || !routingIntentManaged(hub)) return true
  const expected = routingIntentConfiguration(hub)
  return config.status === 'configured' && config.associatedTableId === expected.associatedTableId &&
    config.propagatedTableIds.length === 1 && config.propagatedTableIds[0] === expected.propagatedTableIds[0] &&
    (hub.routingIntent.private ? config.labels.length === 0 || config.labels.length === 1 && config.labels[0] === 'none'
      : config.labels.length === 1 && config.labels[0] === 'default')
}

// Private intent uses the security appliance's routing domain, not manual None-table isolation.
export function routingIntentForwarding(hub: Pick<IntentHub, 'routingIntent'>, config: HubRoutingConfiguration): HubRoutingConfiguration {
  return routingIntentManaged(hub) && config.status !== 'unknown' ? defaultRouting() : config
}

export interface RoutingIntentScope {
  hubs: IntentHub[]
  attachments: { key: string; hubId: string; owner: { hubRouting?: HubRoutingConfiguration } }[]
}

export function applyHubRoutingIntentEdit(before: RoutingIntentScope, after: RoutingIntentScope): void {
  for (const hub of after.hubs) {
    const oldHub = before.hubs.find((entry) => entry.id === hub.id)
    const changed = oldHub?.routingIntent.private !== hub.routingIntent.private ||
      oldHub?.routingIntent.internet !== hub.routingIntent.internet
    if (routingIntentManaged(hub)) {
      const oldConflicts = oldHub ? routingIntentConflicts(oldHub) : []
      const conflicts = routingIntentConflicts(hub).filter((conflict) => changed || !oldConflicts.includes(conflict))
      if (conflicts.length) throw new Error(`Routing intent cannot be enabled or extended on ${hub.name}. Resolve these conflicts first: ${conflicts.join('; ')}. No tables or routes were deleted.`)
    }
    for (const attachment of after.attachments.filter((entry) => entry.hubId === hub.id)) {
      const old = before.attachments.find((entry) => entry.key === attachment.key && entry.hubId === hub.id)
      if (routingIntentManaged(hub) && (changed || !old ||
        JSON.stringify(old.owner.hubRouting) !== JSON.stringify(attachment.owner.hubRouting))) {
        attachment.owner.hubRouting = routingIntentConfiguration(hub)
      } else if (changed && oldHub && routingIntentManaged(oldHub) && !routingIntentManaged(hub)) {
        attachment.owner.hubRouting = defaultRouting()
      }
    }
  }
}
