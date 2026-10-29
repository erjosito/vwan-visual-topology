import type { DiagramLayout, LayoutMode, PrependRule, RouteMap, RouteMapAssignment, RouteMapRule, Topology } from './model'

export function ipv4(value: string): number | undefined {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return undefined
  const octets = value.split('.').map(Number)
  if (octets.some((n) => n > 255)) return undefined
  return octets.reduce((result, n) => result * 256 + n, 0)
}

export function cidr(value: string): { network: number; length: number } | undefined {
  const parts = value.split('/')
  if (parts.length !== 2 || !/^(0|[1-9]\d?)$/.test(parts[1])) return undefined
  const address = ipv4(parts[0])
  const length = Number(parts[1])
  if (address === undefined || length > 32) return undefined
  const block = 2 ** (32 - length)
  const network = Math.floor(address / block) * block
  if (address !== network) return undefined
  return { network, length }
}

export function contains(prefix: string, address: number): boolean {
  const parsed = cidr(prefix)
  return !!parsed && Math.floor(address / 2 ** (32 - parsed.length)) * 2 ** (32 - parsed.length) === parsed.network
}

export function parseAsPath(value: string): number[] {
  if (!value.trim()) return []
  if (!/^\d+(?:[\s,]+\d+)*$/.test(value.trim())) throw new Error('Use space-separated numeric ASNs.')
  const path = value.trim().split(/[\s,]+/).map(Number)
  if (path.length > 64 || path.some((n) => !Number.isInteger(n) || n < 1 || n > 4294967294)) {
    throw new Error('Use up to 64 ASNs between 1 and 4294967294.')
  }
  return path
}

export function validateTopology(input: unknown): Topology {
  const fail = (message: string): never => { throw new Error(message) }
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a JSON object.')
    return value as Record<string, unknown>
  }
  const text = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 120) fail(`${label} must contain 1-120 characters.`)
    return value as string
  }
  const array = (value: unknown, limit: number, label: string): unknown[] => {
    if (!Array.isArray(value) || value.length > limit) fail(`${label} must be an array with at most ${limit} entries.`)
    return value as unknown[]
  }
  const ids = new Set<string>()
  const id = (value: unknown): string => {
    const result = text(value, 'ID')
    if (ids.has(result)) fail(`Duplicate ID: ${result}`)
    ids.add(result)
    return result
  }
  const root = record(input)
  if (root.version !== 1) fail('Unsupported topology version (expected 1).')
  const prefixes = (value: unknown, label: string) => array(value, 100, label).map((value) => {
    const prefix = text(value, label)
    if (!cidr(prefix)) fail(`Invalid IPv4 network CIDR: ${prefix}`)
    return prefix
  })
  const asns = (value: unknown) => array(value, 64, 'AS path').map((n) => {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 4294967294) fail('Invalid ASN.')
    return n as number
  })
  const prependAsns = (value: unknown) => {
    const prepend = asns(value)
    if (prepend.some((n) => n > 64511 || [8074, 8075, 12076, 23456].includes(n))) fail('Azure prepend rules require public 2-byte ASNs, excluding Azure-reserved ASNs. Use your own public ASN; documentation ASNs 64496-64511 are also accepted for simulation.')
    return prepend
  }
  const maps = (value: unknown): PrependRule[] => array(value ?? [], 20, 'Route-map rules').map((value) => {
    const rule = record(value)
    const prepend = prependAsns(rule.prepend)
    if (!['equals', 'contains'].includes(rule.match as string)) fail('Invalid prefix match mode.')
    return { id: id(rule.id), prefixes: prefixes(rule.prefixes, 'Rule prefixes'), match: rule.match as 'equals' | 'contains', prepend }
  })
  const assignments = (value: unknown): RouteMapAssignment[] => {
    const seen = new Set<string>()
    return array(value, 240, 'Router route-map assignments').map((value) => {
      const entry = record(value)
      const connectionId = text(entry.connectionId, 'Assignment connection')
      if (seen.has(connectionId)) fail('Duplicate router route-map assignment for a connection.')
      seen.add(connectionId)
      return { connectionId,
        ...(entry.inboundMapId === undefined ? {} : { inboundMapId: text(entry.inboundMapId, 'Inbound route map') }),
        ...(entry.outboundMapId === undefined ? {} : { outboundMapId: text(entry.outboundMapId, 'Outbound route map') }) }
    })
  }
  const hubs = array(root.hubs, 20, 'Hubs').map((value) => {
    const hub = record(value)
    if (!['ExpressRoute', 'VPN', 'ASPath'].includes(hub.preference as string)) fail('Invalid hub routing preference.')
    const intent = record(hub.routingIntent ?? { private: false, internet: false, privatePrefixes: [] })
    if (typeof intent.private !== 'boolean' || typeof intent.internet !== 'boolean') fail('Routing intent policies must be boolean.')
    return { id: id(hub.id), name: text(hub.name, 'Hub name'), region: text(hub.region, 'Region'), preference: hub.preference,
      routingIntent: { private: intent.private, internet: intent.internet, privatePrefixes: prefixes(intent.privatePrefixes, 'Private traffic prefixes') },
      ...(hub.routeMapAssignments === undefined ? {} : { routeMapAssignments: assignments(hub.routeMapAssignments) }) } as Topology['hubs'][number]
  })
  const sites = array(root.sites, 60, 'Sites').map((value) => {
    const site = record(value)
    const asn = asns([site.asn ?? 65001])[0]
    if (asn === 65520 || asn === 65515 || asn === 12076) fail('Use a non-Azure site ASN.')
    const originated = array(site.prefixes ?? [], 100, 'Site originated prefixes')
    if (originated.length > 1) fail(`Site "${text(site.name, 'Site name')}" supports only one originated prefix. Reduce its prefixes to one before importing; no networks have been discarded.`)
    return { id: id(site.id), name: text(site.name, 'Site name'), asn, prefixes: prefixes(originated, 'Site originated prefix'),
      ...(site.routeMapAssignments === undefined ? {} : { routeMapAssignments: assignments(site.routeMapAssignments) }) }
  })
  const siteLinks = array(root.siteLinks ?? [], 120, 'On-premises links').map((value) => {
    const link = record(value)
    if (link.a === link.b || !sites.some((s) => s.id === link.a) || !sites.some((s) => s.id === link.b)) fail('On-premises links need two different existing sites.')
    const policy = (value: unknown) => {
      const p = record(value)
      return { prefixes: prefixes(p.prefixes, 'Peer export prefixes'), prepend: asns(p.prepend), receivePrepend: asns(p.receivePrepend ?? []) }
    }
    if (typeof link.enabled !== 'boolean') fail('On-premises link enabled must be boolean.')
    return { id: id(link.id), name: text(link.name, 'Link name'), a: link.a as string, b: link.b as string,
      enabled: link.enabled as boolean, aToB: policy(link.aToB), bToA: policy(link.bToA) }
  })
  const spokes = array(root.spokes, 60, 'Spokes').map((value) => {
    const spoke = record(value)
    if (!hubs.some((h) => h.id === spoke.hubId)) fail('Spoke references a missing hub.')
    const prefixes = array(spoke.prefixes, 30, 'Spoke prefixes').map((value) => {
      const prefix = text(value, 'Spoke prefix')
      if (!cidr(prefix)) fail(`Invalid spoke IPv4 network CIDR: ${prefix}`)
      return prefix
    })
    if (!prefixes.length) fail('A spoke needs at least one prefix.')
    return { id: id(spoke.id), name: text(spoke.name, 'Spoke name'), hubId: spoke.hubId as string, prefixes }
  })
  const routeMaps: RouteMap[] = array(root.routeMaps ?? [], 240, 'Route maps').map((value) => {
    const map = record(value)
    if ((map.hubId === undefined) === (map.siteId === undefined)) fail('A route map must belong to exactly one hub or site.')
    if (map.hubId !== undefined && !hubs.some((hub) => hub.id === map.hubId)) fail('Route map references a missing hub.')
    if (map.siteId !== undefined && !sites.some((site) => site.id === map.siteId)) fail('Route map references a missing site.')
    return {
      id: id(map.id), name: text(map.name, 'Route map name'),
      ...(map.hubId === undefined ? { siteId: map.siteId as string } : { hubId: map.hubId as string }),
      rules: array(map.rules, 20, 'Route-map rules').map((value): RouteMapRule => {
        const rule = record(value)
        if (!['equals', 'contains'].includes(rule.match as string)) fail('Invalid prefix match mode.')
        if (!['permit', 'drop', 'summarize', 'prepend'].includes(rule.action as string)) fail('Invalid route-map action.')
        if (!['continue', 'terminate'].includes(rule.nextStep as string)) fail('Invalid route-map next step.')
        const matchPrefixes = prefixes(rule.prefixes, 'Rule prefixes')
        const summaryPrefixes = prefixes(rule.summaryPrefixes, 'Summary prefixes')
        const prepend = map.hubId === undefined ? asns(rule.prepend) : prependAsns(rule.prepend)
        if (rule.action === 'summarize') {
          if (!summaryPrefixes.length) fail('A summarize action needs summary prefixes.')
          const covered = (prefix: string, summary: string) => cidr(summary)!.length <= cidr(prefix)!.length && contains(summary, cidr(prefix)!.network)
          const matched = matchPrefixes.length ? matchPrefixes : ['0.0.0.0/0']
          if (matched.some((prefix) => !summaryPrefixes.some((summary) => covered(prefix, summary)))
            || summaryPrefixes.some((summary) => !matched.some((prefix) => covered(prefix, summary)))) {
            fail('Summary prefixes must cover matched prefixes; route maps cannot create more-specific or unrelated routes.')
          }
        }
        return { id: id(rule.id), prefixes: matchPrefixes, match: rule.match as RouteMapRule['match'],
          action: rule.action as RouteMapRule['action'], summaryPrefixes, prepend, nextStep: rule.nextStep as RouteMapRule['nextStep'] }
      }),
    }
  })
  const connections = array(root.connections, 120, 'Connections').map((value) => {
    const connection = record(value)
    if (!hubs.some((h) => h.id === connection.hubId) || !sites.some((s) => s.id === connection.siteId)) fail('Connection references a missing hub or site.')
    if (!['ExpressRoute', 'VPN', 'SDWAN'].includes(connection.transport as string)) fail('Invalid transport.')
    if (typeof connection.enabled !== 'boolean') fail('Connection enabled must be boolean.')
    if (connection.learnSiteRoutes !== undefined && typeof connection.learnSiteRoutes !== 'boolean') fail('Learn site routes must be boolean.')
    const connectionId = id(connection.id)
    const inbound = maps(connection.inbound)
    const outbound = maps(connection.outbound)
    const reference = (direction: 'inbound' | 'outbound'): string | undefined => {
      const value = connection[`${direction}MapId`]
      if (value === undefined) return undefined
      const mapId = text(value, 'Route map reference')
      const map = routeMaps.find((map) => map.id === mapId)
      if (!map) fail('Connection references a missing route map.')
      if (map!.hubId !== connection.hubId) fail('Connection route map must belong to the same hub.')
      return mapId
    }
    const inboundMapId = reference('inbound')
    const outboundMapId = reference('outbound')
    if (connection.transport === 'SDWAN' && (inbound.length || outbound.length || inboundMapId || outboundMapId)) fail('Azure route maps are not supported on integrated SD-WAN NVA branch connections.')
    const routes = array(connection.routes, 100, 'Routes per connection').map((value) => {
      const route = record(value)
      const prefix = text(route.prefix, 'Prefix')
      if (!cidr(prefix)) fail(`Invalid IPv4 network CIDR: ${prefix}. Use the network address, not a host address.`)
      if (!['bgp', 'vpn-static'].includes(route.kind as string)) fail('Invalid route kind.')
      if (route.kind !== 'bgp' && connection.transport !== 'VPN') fail('Static routes are supported only on VPN connections.')
      const path = array(route.asPath, 64, 'AS path')
      if (path.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 4294967294)) fail('Invalid ASN.')
      if (route.kind === 'bgp' && path.length === 0) fail('BGP routes need an AS path as received by the hub.')
      if (route.kind === 'bgp' && path.includes(65520)) fail('65520 is reserved for inter-hub propagation in this simulator.')
      if (route.kind !== 'bgp' && path.length !== 0) fail('Static routes must have an empty AS path.')
      return { id: id(route.id), prefix, asPath: path, kind: route.kind } as Topology['connections'][number]['routes'][number]
    })
    return { id: connectionId, name: text(connection.name, 'Connection name'), hubId: connection.hubId,
      siteId: connection.siteId, transport: connection.transport, enabled: connection.enabled, routes,
      inbound, outbound,
      ...(inboundMapId !== undefined ? { inboundMapId } : {}),
      ...(outboundMapId !== undefined ? { outboundMapId } : {}),
      learnSiteRoutes: connection.learnSiteRoutes ?? false } as Topology['connections'][number]
  })
  const uniqueId = (base: string) => {
    base = base.slice(0, 110)
    let result = base
    for (let suffix = 2; ids.has(result); suffix++) result = `${base}-${suffix}`
    ids.add(result)
    return result
  }
  for (const connection of connections) {
    for (const direction of ['inbound', 'outbound'] as const) {
      const legacy = connection[direction]
      if (!legacy.length) continue
      if (connection[`${direction}MapId`] === undefined) {
        const mapId = uniqueId(`migrated-${connection.id}-${direction}`)
        routeMaps.push({ id: mapId, name: `${connection.name} ${direction}`.slice(0, 120), hubId: connection.hubId,
          rules: legacy.map((rule) => ({ ...rule, action: 'prepend', summaryPrefixes: [], nextStep: 'terminate' })) })
        connection[`${direction}MapId`] = mapId
      }
      connection[direction] = []
    }
    const hub = hubs.find((h) => h.id === connection.hubId)!
    for (const direction of ['inboundMapId', 'outboundMapId'] as const) {
      const reference = connection[direction]
      if (reference === undefined) continue
      hub.routeMapAssignments ??= []
      let binding = hub.routeMapAssignments.find((a) => a.connectionId === connection.id)
      if (!binding) { binding = { connectionId: connection.id }; hub.routeMapAssignments.push(binding) }
      if (binding[direction] !== undefined && binding[direction] !== reference) fail('Conflicting legacy and hub route-map assignments.')
      binding[direction] = reference
      delete connection[direction]
    }
  }
  for (const router of [...hubs, ...sites]) {
    const isHub = hubs.some((h) => h.id === router.id)
    for (const assignment of router.routeMapAssignments ?? []) {
      const connection = connections.find((c) => c.id === assignment.connectionId)
      const peer = siteLinks.find((link) => link.id === assignment.connectionId)
      if (isHub ? connection?.hubId !== router.id : connection?.siteId !== router.id && peer?.a !== router.id && peer?.b !== router.id) {
        fail('Route-map assignment references a connection not attached to this router.')
      }
      if (isHub && connection?.transport === 'SDWAN' && (assignment.inboundMapId || assignment.outboundMapId)) fail('Azure route maps are not supported on integrated SD-WAN NVA branch connections.')
      for (const reference of [assignment.inboundMapId, assignment.outboundMapId]) {
        if (reference === undefined) continue
        const map = routeMaps.find((m) => m.id === reference)
        if (!map) fail('Router assignment references a missing route map.')
        if ((isHub ? map!.hubId : map!.siteId) !== router.id) fail('Route map must belong to the same hub or site as the assignment.')
      }
    }
  }
  if (routeMaps.length > 240) fail('Route maps must be an array with at most 240 entries.')
  let layout: DiagramLayout | undefined
  if (root.layout !== undefined) {
    const value = record(root.layout)
    if (!['layered', 'constellation'].includes(value.mode as string)) fail('Invalid visualization mode.')
    const positions = record(value.positions ?? {})
    if (Object.keys(positions).some((key) => !['layered', 'constellation'].includes(key))) fail('Invalid position layout.')
    const nodeIds = new Set([...hubs, ...sites, ...spokes].map((node) => node.id))
    layout = { mode: value.mode as LayoutMode, positions: {} }
    for (const mode of ['layered', 'constellation'] as const) {
      if (positions[mode] === undefined) continue
      const entries = Object.entries(record(positions[mode]))
      if (entries.length > 140) fail('Node positions must contain at most 140 entries per layout.')
      layout.positions[mode] = Object.fromEntries(entries.map(([id, value]) => {
        const point = record(value)
        if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 120 || point.y < 65 || point.x > 20000 || point.y > 20000) fail('Node positions must be finite canvas coordinates within bounds.')
        return [id, { x: point.x as number, y: point.y as number }] as const
      }).filter(([id]) => nodeIds.has(id)))
    }
  }
  return { version: 1, name: text(root.name, 'Topology name'), hubs, sites, spokes, connections, siteLinks, routeMaps, ...(layout ? { layout } : {}) }
}
