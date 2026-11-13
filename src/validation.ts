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

export function formatIpv4(address: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(address / 2 ** shift) % 256).join('.')
}

export function defaultSpokeNvaPeerIp(prefixes: string[], existingPeerIps: string[] = []): string | undefined {
  const first = prefixes.map(cidr).find((parsed) => parsed !== undefined)
  if (!first) return undefined
  const used = new Set(existingPeerIps)
  const hostCount = 2 ** (32 - first.length)
  const maxOffset = Math.max(4, Math.min(254, hostCount - 2))
  for (let offset = 4; offset <= maxOffset; offset++) {
    const candidate = formatIpv4(first.network + offset)
    if (contains(prefixes[0], first.network + offset) && !used.has(candidate)) return candidate
  }
  for (let offset = 1; offset < Math.min(256, hostCount); offset++) {
    const candidate = formatIpv4(first.network + offset)
    if (contains(prefixes[0], first.network + offset) && !used.has(candidate)) return candidate
  }
  return undefined
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

const validHubPrependAsn = (asn: number) =>
  asn >= 1 && asn <= 64511 && ![8074, 8075, 12076, 23456].includes(asn)

export function parseHubPrependAsPath(value: string): number[] {
  const path = parseAsPath(value)
  if (!path.length || path.some((asn) => !validHubPrependAsn(asn))) {
    throw new Error('Hub AS-path prepending requires non-private 2-byte ASNs (1-64511), excluding 8074, 8075, 12076 and AS_TRANS 23456. Documentation ASNs 64496-64511 are accepted for lab simulation, not as production ASN guidance.')
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
  if (root.allowBranchToBranchTraffic !== undefined && typeof root.allowBranchToBranchTraffic !== 'boolean') fail('WAN branch-to-branch traffic must be a boolean.')
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
    if (prepend.some((n) => !validHubPrependAsn(n))) fail('Azure prepend rules require public 2-byte ASNs, excluding Azure-reserved ASNs. Use your own public ASN; documentation ASNs 64496-64511 are also accepted for simulation.')
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
  const optionalLabel = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'string') return fail('Diagram label must be a string.')
    if (value.length > 120) return fail('Diagram label must contain at most 120 characters.')
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }
  const hubs = array(root.hubs, 20, 'Hubs').map((value) => {
    const hub = record(value)
    if (!['ExpressRoute', 'VPN', 'ASPath'].includes(hub.preference as string)) fail('Invalid hub routing preference.')
    const intent = record(hub.routingIntent ?? { private: false, internet: false, privatePrefixes: [] })
    if (typeof intent.private !== 'boolean' || typeof intent.internet !== 'boolean') fail('Routing intent policies must be boolean.')
    const label = optionalLabel(hub.label)
    return { id: id(hub.id), name: text(hub.name, 'Hub name'),
      ...(label === undefined ? {} : { label }),
      region: text(hub.region, 'Region'), preference: hub.preference,
      routingIntent: { private: intent.private, internet: intent.internet, privatePrefixes: prefixes(intent.privatePrefixes, 'Private traffic prefixes') },
      ...(hub.routeMapAssignments === undefined ? {} : { routeMapAssignments: assignments(hub.routeMapAssignments) }) } as Topology['hubs'][number]
  })
  const sites = array(root.sites, 60, 'Sites').map((value) => {
    const site = record(value)
    const asn = asns([site.asn ?? 65001])[0]
    if (asn === 65520 || asn === 65515 || asn === 12076) fail('Use a non-Azure site ASN.')
    const originated = array(site.prefixes ?? [], 30, 'Site originated prefixes')
    const vpnStaticRoutes = array(site.vpnStaticRoutes ?? [], 12000, 'Site VPN static routes').map((value) => {
      const route = record(value)
      const prefix = text(route.prefix, 'Static prefix')
      if (!cidr(prefix)) fail(`Invalid static IPv4 network CIDR: ${prefix}`)
      return { id: id(route.id), prefix, connectionId: text(route.connectionId, 'Static route VPN connection') }
    })
    const label = optionalLabel(site.label)
    return { id: id(site.id), name: text(site.name, 'Site name'),
      ...(label === undefined ? {} : { label }),
      asn, prefixes: [...new Set(prefixes(originated, 'Site originated prefix'))],
      ...(site.role === 'spoke-nva' ? { role: 'spoke-nva' as const } : {}),
      ...(site.vpnStaticRoutes === undefined ? {} : { vpnStaticRoutes }),
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
    const rawHubId = typeof spoke.hubId === 'string' && !spoke.hubId.trim() ? undefined : spoke.hubId
    const hubId = rawHubId === undefined ? undefined : text(rawHubId, 'Spoke hub')
    if (hubId !== undefined && !hubs.some((h) => h.id === hubId)) fail('Spoke references a missing hub.')
    if (spoke.propagateDefaultRoute !== undefined && typeof spoke.propagateDefaultRoute !== 'boolean') fail('Spoke default-route propagation must be boolean.')
    if (spoke.propagateDefaultRoute === true && hubId === undefined) fail('Standalone VNets cannot enable hub default-route propagation.')
    const prefixes = array(spoke.prefixes, 30, 'Spoke prefixes').map((value) => {
      const prefix = text(value, 'Spoke prefix')
      if (!cidr(prefix)) fail(`Invalid spoke IPv4 network CIDR: ${prefix}`)
      return prefix
    })
    if (!prefixes.length) fail('A spoke needs at least one prefix.')
    const nvaSpokeIds = spoke.nvaSpokeIds === undefined
      ? undefined
      : [...new Set(array(spoke.nvaSpokeIds, 50, 'Spoke NVA attachments').map((entry) => text(entry, 'Spoke NVA id')))]
    const label = optionalLabel(spoke.label)
    return {
      id: id(spoke.id),
      name: text(spoke.name, 'Spoke name'),
      ...(spoke.region === undefined || spoke.region === '' ? {} : { region: text(spoke.region, 'VNet region') }),
      ...(label === undefined ? {} : { label }),
      ...(hubId === undefined ? {} : { hubId }),
      prefixes,
      ...(nvaSpokeIds?.length ? { nvaSpokeIds } : {}),
      ...(spoke.propagateDefaultRoute === true ? { propagateDefaultRoute: true } : {}),
    }
  })
  for (const spoke of spokes) {
    for (const nvaSpokeId of spoke.nvaSpokeIds ?? []) {
      const host = spokes.find((candidate) => candidate.id === nvaSpokeId)
      if (!host || host.id === spoke.id || !host.hubId) fail('Downstream VNet references an invalid hosting spoke.')
    }
  }
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
        if (rule.modifications !== undefined) fail('Attribute modifications are supported only on Azure Route Server route maps.')
        const conditionIds = new Set<string>()
        const matchConditions = rule.matchConditions === undefined ? undefined
          : array(rule.matchConditions, 40, 'Route-map match conditions').map((value) => {
            const condition = record(value)
            if (Object.keys(condition).some((key) => !['id', 'property', 'match', 'values'].includes(key))) fail('Unknown route-map match-condition fields.')
            if (condition.property !== 'asPath') fail('VWAN and site attribute conditions support AS-path matching only.')
            if (!['equals', 'contains'].includes(condition.match as string)) fail('AS-path conditions require equals or contains.')
            const values = array(condition.values, 100, 'AS-path match values').map((value) => {
              const max = map.hubId === undefined ? 4294967294 : 65534
              if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) fail(map.hubId === undefined
                ? 'Site AS-path conditions require ASN strings (1-4294967294).'
                : 'VWAN AS-path conditions require 2-byte ASN strings (1-65534).')
              return value as string
            })
            if (!values.length) fail('An AS-path match condition requires values; remove the condition to match all routes.')
            const conditionId = condition.id === undefined ? undefined : text(condition.id, 'Condition ID')
            if (conditionId !== undefined && conditionIds.has(conditionId)) fail('Duplicate route-map condition ID.')
            if (conditionId !== undefined) conditionIds.add(conditionId)
            return { ...(conditionId === undefined ? {} : { id: conditionId }), property: 'asPath' as const,
              match: condition.match as 'equals' | 'contains', values }
          })
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
          action: rule.action as RouteMapRule['action'], summaryPrefixes, prepend, nextStep: rule.nextStep as RouteMapRule['nextStep'],
          ...(matchConditions === undefined ? {} : { matchConditions }) }
      }),
    }
  })
  const rawErLocations = array(root.erLocations ?? [], 60, 'ER locations').map((value) => {
    const location = record(value)
    const label = optionalLabel(location.label)
    const peeringLocation = typeof location.peeringLocation === 'string' && location.peeringLocation.trim()
      ? text(location.peeringLocation, 'ER peering location')
      : undefined
    const sku = location.sku === undefined
      ? undefined
      : (['Local', 'Standard', 'Premium'].includes(location.sku as string)
        ? (location.sku as 'Local' | 'Standard' | 'Premium')
        : fail('Invalid ER circuit SKU.'))
    if (location.globalReachEnabled !== undefined && typeof location.globalReachEnabled !== 'boolean') {
      fail('ER Global Reach enabled must be boolean.')
    }
    const globalReachLocationIds = location.globalReachLocationIds === undefined
      ? undefined
      : [...new Set(array(location.globalReachLocationIds, 60, 'ER Global Reach peer locations').map((entry) => text(entry, 'ER Global Reach peer location id')))]
    return {
      id: id(location.id),
      name: text(location.name, 'ER location name'),
      ...(label === undefined ? {} : { label }),
      ...(peeringLocation === undefined ? {} : { peeringLocation }),
      ...(sku === undefined ? {} : { sku }),
      ...(location.globalReachEnabled === true ? { globalReachEnabled: true } : {}),
      ...(globalReachLocationIds?.length ? { globalReachLocationIds } : {}),
    }
  })
  const erLocationIds = new Set(rawErLocations.map((loc) => loc.id))
  const erLocations = rawErLocations.map((loc) => {
    const validPeers = loc.globalReachLocationIds?.filter((peerId) => peerId !== loc.id && erLocationIds.has(peerId))
    const { globalReachLocationIds: _, ...rest } = loc
    return validPeers?.length ? { ...rest, globalReachLocationIds: validPeers } : rest
  })
  const erLinks: NonNullable<Topology['erLinks']> = array(root.erLinks ?? [], 240, 'ER connections').map((value) => {
    const link = record(value)
    if (!erLocations.some((location) => location.id === link.locationId)) fail('ER connection references a missing ER location.')
    if ((link.hubId === undefined) === (link.siteId === undefined)) fail('An ER connection needs exactly one hub or site endpoint.')
    if (link.hubId !== undefined && !hubs.some((hub) => hub.id === link.hubId)) fail('ER connection references a missing hub.')
    if (link.siteId !== undefined && !sites.some((site) => site.id === link.siteId)) fail('ER connection references a missing site.')
    if (typeof link.enabled !== 'boolean') fail('ER connection enabled must be boolean.')
    if (link.learnSiteRoutes !== undefined && typeof link.learnSiteRoutes !== 'boolean') fail('ER learn site routes must be boolean.')
    if (link.propagateDefaultRoute !== undefined && typeof link.propagateDefaultRoute !== 'boolean') fail('ER default-route propagation must be boolean.')
    if (link.propagateDefaultRoute === true && link.hubId === undefined) fail('Configure ER default-route propagation on the hub attachment, not the site attachment.')
    if (link.hubId !== undefined && link.learnSiteRoutes) fail('Configure ER advertisements on the site attachment, not the hub attachment.')
    return { id: id(link.id), name: text(link.name, 'ER connection name'), locationId: link.locationId as string,
      ...(link.hubId === undefined ? { siteId: link.siteId as string } : { hubId: link.hubId as string }),
      enabled: link.enabled as boolean, learnSiteRoutes: link.learnSiteRoutes === true,
      ...(link.propagateDefaultRoute === true ? { propagateDefaultRoute: true } : {}) }
  })
  const usedHubNvaPeerIps = new Map<string, string[]>()
  for (const raw of Array.isArray(root.connections) ? root.connections : []) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const c = raw as Record<string, unknown>
      if (c.transport === 'SpokeNVA' && typeof c.hubId === 'string' && typeof c.peerIp === 'string' && c.peerIp.trim()) {
        usedHubNvaPeerIps.set(c.hubId, [...(usedHubNvaPeerIps.get(c.hubId) ?? []), c.peerIp.trim()])
      }
    }
  }
  const connections = array(root.connections, 120, 'Connections').map((value) => {
    const connection = record(value)
    if (!hubs.some((h) => h.id === connection.hubId) || !sites.some((s) => s.id === connection.siteId)) fail('Connection references a missing hub or site.')
    if (!['ExpressRoute', 'VPN', 'SDWAN', 'SpokeNVA'].includes(connection.transport as string)) fail('Invalid transport.')
    let resolvedPeerIp: string | undefined
    if (connection.transport === 'SpokeNVA') {
      const spoke = spokes.find((spoke) => spoke.id === connection.spokeId)
      const site = sites.find((site) => site.id === connection.siteId)!
      if (!spoke || spoke.hubId !== connection.hubId) fail('A spoke BGP NVA must peer with the hub directly connected to its hosting spoke.')
      const existingIps = usedHubNvaPeerIps.get(connection.hubId as string) ?? []
      const rawPeerIp = typeof connection.peerIp === 'string' ? connection.peerIp.trim() : connection.peerIp
      resolvedPeerIp = rawPeerIp === undefined || rawPeerIp === ''
        ? defaultSpokeNvaPeerIp(spoke!.prefixes, existingIps)
        : text(rawPeerIp, 'NVA BGP interface IPv4')
      const address = resolvedPeerIp === undefined ? undefined : ipv4(resolvedPeerIp)
      if (address === undefined || !spoke!.prefixes.some((prefix) => contains(prefix, address))) fail('The NVA BGP interface IPv4 address must be inside its hosting spoke address space.')
      usedHubNvaPeerIps.set(connection.hubId as string, [...existingIps, resolvedPeerIp!])
      if (site.asn > 65534 || [8074, 8075, 12076, 23456, 65515, 65517, 65518, 65519, 65520].includes(site.asn)
        || site.asn >= 64496 && site.asn <= 64511) fail('Spoke NVA peering requires a non-reserved public or private 2-byte ASN, different from the Azure hub ASN.')
    } else if (connection.spokeId !== undefined || connection.peerIp !== undefined) fail('Spoke and NVA peer IP fields are supported only on spoke BGP NVA connections.')
    if (typeof connection.enabled !== 'boolean') fail('Connection enabled must be boolean.')
    if (connection.learnSiteRoutes !== undefined && typeof connection.learnSiteRoutes !== 'boolean') fail('Learn site routes must be boolean.')
    if (connection.propagateDefaultRoute !== undefined && typeof connection.propagateDefaultRoute !== 'boolean') fail('Connection default-route propagation must be boolean.')
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
    if (connection.transport === 'SpokeNVA' && (inbound.length || outbound.length || inboundMapId || outboundMapId)) fail('Assign hub route maps to the hosting VNet connection, not the spoke NVA BGP peer.')
    return { id: connectionId, name: text(connection.name, 'Connection name'), hubId: connection.hubId,
      siteId: connection.siteId, transport: connection.transport, enabled: connection.enabled,
      inbound, outbound,
      ...(inboundMapId !== undefined ? { inboundMapId } : {}),
      ...(outboundMapId !== undefined ? { outboundMapId } : {}),
      ...(connection.transport === 'SpokeNVA' ? { spokeId: connection.spokeId, peerIp: resolvedPeerIp } : {}),
      learnSiteRoutes: connection.learnSiteRoutes ?? false,
      ...(connection.propagateDefaultRoute === true ? { propagateDefaultRoute: true } : {}) } as Topology['connections'][number]
  })
  for (const hub of hubs) {
    const peers = connections.filter((connection) => connection.hubId === hub.id && connection.transport === 'SpokeNVA')
    if (peers.length > 8) fail('A Virtual WAN hub supports at most 8 spoke NVA BGP peers.')
    if (new Set(peers.map((peer) => peer.peerIp)).size !== peers.length) fail('NVA BGP peer interface addresses must be unique within a hub.')
  }
  for (const site of sites) {
    const peers = connections.filter((connection) => connection.siteId === site.id && connection.transport === 'SpokeNVA')
    if (new Set(peers.map((peer) => peer.spokeId)).size > 1) fail('An NVA router must belong to one hosting spoke.')
  }
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
  for (const site of sites) {
    const counts = new Map<string, number>()
    for (const route of site.vpnStaticRoutes ?? []) {
      const connection = connections.find((c) => c.id === route.connectionId)
      if (!connection || connection.siteId !== site.id || connection.transport !== 'VPN') fail('Site static routes require an attached S2S VPN connection. Remove or reassign them before changing the connection.')
      const count = (counts.get(route.connectionId) ?? 0) + 1
      if (count > 100) fail('At most 100 static routes are supported per VPN connection.')
      counts.set(route.connectionId, count)
    }
  }
  for (const router of [...hubs, ...sites]) {
    const isHub = hubs.some((h) => h.id === router.id)
    for (const assignment of router.routeMapAssignments ?? []) {
      const connection = connections.find((c) => c.id === assignment.connectionId)
      const peer = siteLinks.find((link) => link.id === assignment.connectionId)
      const er = erLinks.find((link) => link.id === assignment.connectionId)
      const spoke = spokes.find((spoke) => spoke.id === assignment.connectionId)
      if (isHub ? connection?.hubId !== router.id && er?.hubId !== router.id && spoke?.hubId !== router.id : connection?.siteId !== router.id && er?.siteId !== router.id && peer?.a !== router.id && peer?.b !== router.id) {
        fail('Route-map assignment references a connection not attached to this router.')
      }
      if (isHub && connection?.transport === 'SDWAN' && (assignment.inboundMapId || assignment.outboundMapId)) fail('Azure route maps are not supported on integrated SD-WAN NVA branch connections.')
      if (isHub && connection?.transport === 'SpokeNVA' && (assignment.inboundMapId || assignment.outboundMapId)) fail('Assign hub route maps to the hosting VNet connection, not the spoke NVA BGP peer.')
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
    const nodeIds = new Set([...hubs, ...sites, ...spokes, ...erLocations].map((node) => node.id))
    layout = { mode: value.mode as LayoutMode, positions: {} }
    for (const mode of ['layered', 'constellation'] as const) {
      if (positions[mode] === undefined) continue
      const entries = Object.entries(record(positions[mode]))
      if (entries.length > 200) fail('Node positions must contain at most 200 entries per layout.')
      layout.positions[mode] = Object.fromEntries(entries.map(([id, value]) => {
        const point = record(value)
        if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 120 || point.y < 65 || point.x > 20000 || point.y > 20000) fail('Node positions must be finite canvas coordinates within bounds.')
        return [id, { x: point.x as number, y: point.y as number }] as const
      }).filter(([id]) => nodeIds.has(id)))
    }
  }
  let azureImport: Topology['azureImport']
  if (root.azureImport !== undefined) {
    const source = record(root.azureImport)
    const sourceText = (value: unknown, label: string, limit: number) => {
      if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`Invalid ${label}.`)
      return value as string
    }
    const messages = (value: unknown) => array(value, 200, 'Azure import warnings').map((item) => sourceText(item, 'Azure import warning', 500))
    const resourceId = (value: unknown) => {
      const result = sourceText(value, 'Azure resource ID', 2048)
      if (!/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/?#\r\n]+\/providers\/Microsoft\.Network\/[^?#\r\n]+$/i.test(result)) fail('Invalid Azure resource ID.')
      return result
    }
    const capturedAt = sourceText(source.capturedAt, 'Azure capture timestamp', 40)
    if (!/^\d{4}-\d\d-\d\dT/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) fail('Invalid Azure capture timestamp.')
    const seen = new Set<string>()
    const seenSpokes = new Set<string>()
    const seenTables = new Set<string>()
    let totalRows = 0
    let expandedRoutes = 0
    const freeText = (value: unknown, label: string, limit: number) => {
      if (typeof value !== 'string' || value.length > limit || /[\r\n\0]/.test(value)) fail(`Invalid ${label}.`)
      return value as string
    }
    const timestamp = (value: unknown, label: string) => {
      const result = sourceText(value, label, 40)
      if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) fail(`Invalid ${label}.`)
      return result
    }
    const sourceSpokes = source.spokes === undefined ? undefined : array(source.spokes, 1200, 'Azure source spokes').map((value) => {
      const spoke = record(value)
      const spokeId = sourceText(spoke.spokeId, 'Azure source spoke', 120)
      if (seenSpokes.has(spokeId)) fail('Duplicate Azure source spoke.')
      seenSpokes.add(spokeId)
      return { spokeId, resourceId: resourceId(spoke.resourceId), virtualNetworkId: resourceId(spoke.virtualNetworkId) }
    }).filter((entry) => spokes.some((spoke) => spoke.id === entry.spokeId))
    const sourceTables = source.tables === undefined ? undefined : array(source.tables, 20, 'Azure observed route tables').map((value) => {
      const table = record(value)
      const hubId = sourceText(table.hubId, 'Azure observed table hub', 120)
      const hubResourceId = resourceId(table.hubResourceId)
      const tableResourceId = resourceId(table.resourceId)
      if (seenTables.has(tableResourceId.toLowerCase())) fail('Duplicate Azure observed route table.')
      seenTables.add(tableResourceId.toLowerCase())
      if (!tableResourceId.toLowerCase().startsWith(`${hubResourceId.toLowerCase()}/hubroutetables/`)
        || tableResourceId.slice(hubResourceId.length + '/hubroutetables/'.length).includes('/')) fail('Invalid Azure observed route table resource ID.')
      const resourceType = sourceText(table.resourceType, 'Azure observed route table type', 120)
      if (resourceType !== 'RouteTable' && resourceType !== 'Microsoft.Network/virtualHubs/hubRouteTables') fail('Invalid Azure observed route table resource type.')
      const status = sourceText(table.status, 'Azure observed route table status', 30)
      if (!['complete', 'empty', 'denied', 'failed', 'truncated', 'unsupported'].includes(status)) fail('Invalid Azure observed route table status.')
      const routes = array(table.routes, 10_000, 'Azure observed routes').map((item) => {
        const route = record(item)
        const addressPrefixes = array(route.addressPrefixes, 100, 'Azure observed route prefixes').map((prefix) => sourceText(prefix, 'Azure observed route prefix', 256))
        const nextHops = array(route.nextHops, 128, 'Azure observed route next hops').map((hop) => sourceText(hop, 'Azure observed route next hop', 2048))
        totalRows += 1
        expandedRoutes += addressPrefixes.length * Math.max(1, nextHops.length)
        if (totalRows > 20_000 || expandedRoutes > 100_000) fail('Azure observed route table exceeds the safety limit.')
        return {
          addressPrefixes,
          nextHopType: freeText(route.nextHopType, 'Azure observed next-hop type', 120),
          nextHops,
          routeOrigin: freeText(route.routeOrigin ?? '', 'Azure observed route origin', 2048),
          asPath: freeText(route.asPath ?? '', 'Azure observed AS path', 2048),
        }
      })
      if ((status === 'empty' && routes.length > 0) || (status === 'complete' && !routes.length)) fail('Azure observed route table status does not match its routes.')
      return {
        hubId,
        hubResourceId,
        resourceId: tableResourceId,
        resourceType,
        status: status as NonNullable<Topology['azureImport']>['tables'] extends (infer T)[] | undefined ? T extends { status: infer S } ? S : never : never,
        capturedAt: timestamp(table.capturedAt, 'Azure observed route table timestamp'),
        apiVersion: sourceText(table.apiVersion, 'Azure observed route table API version', 120),
        routes,
        warnings: messages(table.warnings),
      }
    }).filter((entry) => hubs.some((hub) => hub.id === entry.hubId))
    azureImport = {
      capturedAt, collectorVersion: sourceText(source.collectorVersion, 'Azure collector version', 40),
      wanId: resourceId(source.wanId), warnings: messages(source.warnings),
      hubs: array(source.hubs, 20, 'Azure source hubs').map((value) => {
        const hub = record(value)
        const hubId = sourceText(hub.hubId, 'Azure source hub', 120)
        if (seen.has(hubId)) fail('Duplicate Azure source hub.')
        seen.add(hubId)
        const addressPrefix = sourceText(hub.addressPrefix, 'Azure hub prefix', 40)
        if (!cidr(addressPrefix)) fail('Invalid Azure hub IPv4 prefix.')
        return { hubId, resourceId: resourceId(hub.resourceId), addressPrefix, limitations: messages(hub.limitations) }
      }).filter((entry) => hubs.some((hub) => hub.id === entry.hubId)),
      ...(sourceSpokes === undefined ? {} : { spokes: sourceSpokes }),
      ...(sourceTables === undefined ? {} : { tables: sourceTables }),
    }
  }
  return { version: 1, name: text(root.name, 'Topology name'), hubs, sites, spokes, connections, siteLinks, routeMaps,
    ...(root.allowBranchToBranchTraffic === undefined ? {} : { allowBranchToBranchTraffic: root.allowBranchToBranchTraffic as boolean }),
    ...(root.erLocations === undefined && root.erLinks === undefined ? {} : { erLocations, erLinks }), ...(layout ? { layout } : {}), ...(azureImport ? { azureImport } : {}) }
}
