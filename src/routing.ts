import type { Connection, Hub, RouteKind, Topology, Transport } from './model'
import { cidr, contains, ipv4 } from './validation'
import { applyRouteMapRules, connectionMapRules, propagateSites, routerMapRules, siteExports } from './bgp'
import type { SiteRoute } from './bgp'

export interface Candidate {
  key: string
  prefix: string
  asPath: number[]
  kind: RouteKind | 'system' | 'policy'
  transport: Transport | 'VNet' | 'Firewall' | 'Internet'
  connectionId: string
  siteId: string
  originHubId: string
  remote: boolean
  sitePath?: string[]
  siteLinkIds?: string[]
  secureOrigin?: boolean
  forwardingRoutes?: Candidate[]
  erLocationId?: string
  erSiteLinkId?: string
  erHubLinkId?: string
}

export interface Decision {
  prefix: string
  candidates: Candidate[]
  selected: Candidate[]
  explanation: string[]
}

export interface Simulation {
  tables: Record<string, Decision[]>
  firewallTables: Record<string, Decision[]>
  siteTables: Record<string, SiteRoute[]>
  siteCandidates: Record<string, SiteRoute[]>
  outbound: Record<string, Candidate[]>
  erAdvertisements: Record<string, Candidate[]>
  converged: boolean
  warnings: string[]
}

function choose(hub: Hub, prefix: string, candidates: Candidate[]): Decision {
  let selected = candidates
  const explanation: string[] = []
  const filter = (reason: string, predicate: (route: Candidate) => boolean) => {
    const next = selected.filter(predicate)
    if (next.length && next.length < selected.length) {
      selected = next
      explanation.push(reason)
    }
  }
  filter('Directly connected spoke system routes override BGP routes for the same prefix.', (r) => r.kind === 'system' && !r.remote)
  if (selected.some((r) => r.remote && r.secureOrigin)) {
    filter('Remote routes from private-routing-intent hubs take precedence over unsecured remote ExpressRoute paths.',
      (r) => !r.remote || r.secureOrigin || r.transport !== 'ExpressRoute')
  }
  if (hub.preference === 'ASPath') {
    filter('Remote ExpressRoute routes are considered last under AS Path preference.', (r) => !(r.remote && r.transport === 'ExpressRoute'))
    const shortest = Math.min(...selected.map((r) => r.asPath.length))
    filter(`Shortest received AS path (${shortest} ASNs, including inter-hub prepends).`, (r) => r.asPath.length === shortest)
  }
  filter('Local connections are preferred over remote-hub connections.', (r) => !r.remote)
  // HRP compares ER and S2S VPN explicitly. An NVA is not classified as a VPN gateway.
  if (selected.some((r) => r.transport === 'ExpressRoute') && selected.some((r) => r.transport === 'VPN')) {
    const preferred = hub.preference === 'VPN' || selected.every((r) => r.remote) ? 'VPN' : 'ExpressRoute'
    filter(`${preferred} wins the ExpressRoute versus S2S VPN comparison.`, (r) => r.transport !== (preferred === 'VPN' ? 'ExpressRoute' : 'VPN'))
  }
  if (hub.preference !== 'ASPath') {
    const shortest = Math.min(...selected.map((r) => r.asPath.length))
    filter(`Shortest received AS path (${shortest} ASNs).`, (r) => r.asPath.length === shortest)
  }
  if (explanation.length === 0) explanation.push('Only available path, or all paths have equal modeled preference.')
  if (selected.length > 1) explanation.push(`${selected.length} equal-cost paths remain; no single traffic hash is predicted.`)
  return { prefix, candidates, selected, explanation }
}

function localRoutes(connection: Connection, topology: Topology): Candidate[] {
  if (!connection.enabled) return []
  const staticRoutes = topology.sites.find((site) => site.id === connection.siteId)?.vpnStaticRoutes?.filter((route) => route.connectionId === connection.id) ?? []
  return [...connection.routes, ...staticRoutes.map((route) => ({ ...route, asPath: [], kind: 'vpn-static' as const }))].map((route) => ({
    key: `${connection.id}:${route.id}`,
    prefix: route.prefix,
    asPath: [...route.asPath],
    kind: route.kind,
    transport: connection.transport,
    connectionId: connection.id,
    siteId: connection.siteId,
    originHubId: connection.hubId,
    remote: false,
    sitePath: [connection.siteId],
    siteLinkIds: [],
  }))
}

function decide(hub: Hub, candidates: Candidate[]): Decision[] {
  return [...new Set(candidates.map((r) => r.prefix))]
    .sort((a, b) => cidr(a)!.network - cidr(b)!.network || cidr(a)!.length - cidr(b)!.length)
    .map((prefix) => choose(hub, prefix, candidates.filter((r) => r.prefix === prefix)))
}

function erCustomerExport(route: Candidate): Candidate {
  // MSEE removes RFC 6996 private ASNs at the customer boundary, after hub policies.
  return { ...route, asPath: [12076, ...route.asPath.filter((asn) =>
    !(asn >= 64512 && asn <= 65534) && !(asn >= 4200000000 && asn <= 4294967294))] }
}

export function simulate(topology: Topology): Simulation {
  const siteRouting = propagateSites(topology)
  const mapRoutes = (connection: Connection, routes: Candidate[], direction: 'inbound' | 'outbound') => [
    ...applyRouteMapRules(routes.filter((route) => route.kind !== 'vpn-static'), connectionMapRules(topology, connection, direction)),
    ...routes.filter((route) => route.kind === 'vpn-static'),
  ]
  const fromSite = (connection: Connection, routes: Candidate[]) => {
    const bgp = routes.filter((route) => route.kind !== 'vpn-static')
    const provider = new Map(bgp.map((route) => [route.key, connection.transport === 'ExpressRoute' && route.asPath[0] === 12076]))
    return [
      ...siteExports(topology, connection.siteId, connection.id, bgp.map((route) => ({
        ...route, asPath: provider.get(route.key) ? route.asPath.slice(1) : route.asPath,
      }))).map((route) => ({ ...route, asPath: provider.get(route.key) ? [12076, ...route.asPath] : route.asPath })),
      ...routes.filter((route) => route.kind === 'vpn-static'),
    ]
  }
  const learnedRoute = (connection: Connection, route: SiteRoute): Candidate => {
    const site = topology.sites.find((s) => s.id === connection.siteId)!
    const path = route.asPath[0] === site.asn ? route.asPath : [site.asn, ...route.asPath]
    return {
      key: `${connection.id}:learned:${route.key}`, prefix: route.prefix,
      asPath: connection.transport === 'ExpressRoute' ? [12076, ...path] : path,
      kind: 'bgp', transport: connection.transport, connectionId: connection.id,
      siteId: route.sitePath.at(-1)!, sitePath: route.sitePath, siteLinkIds: route.siteLinkIds, originHubId: connection.hubId, remote: false,
      ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map((child) => learnedRoute(connection, child)) } : {}),
    }
  }
  const erLinks = (topology.erLinks ?? []).filter((link) => link.enabled)
  const erAdvertisements: Record<string, Candidate[]> = {}
  for (const link of erLinks.filter((link) => link.siteId)) {
    const site = topology.sites.find((site) => site.id === link.siteId)!
    const candidate = (route: SiteRoute): Candidate => ({
      key: `${link.id}:${route.key}`, prefix: route.prefix, asPath: route.asPath[0] === site.asn ? route.asPath : [site.asn, ...route.asPath],
      kind: 'bgp', transport: 'ExpressRoute', connectionId: link.id, siteId: route.sitePath.at(-1)!,
      sitePath: route.sitePath, siteLinkIds: route.siteLinkIds, originHubId: '', remote: false,
      erLocationId: link.locationId, erSiteLinkId: link.id,
      ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map(candidate) } : {}),
    })
    erAdvertisements[link.id] = siteExports(topology, site.id, link.id, [
      ...link.routes.map((route) => candidate({ ...route, key: route.id, sitePath: [site.id], siteLinkIds: [] })),
      ...(link.learnSiteRoutes ? siteRouting.tables[site.id].filter((route) => !route.key.startsWith(`${link.id}:`)).map(candidate) : []),
    ])
  }
  const erImports = (hubId: string) => erLinks.filter((link) => link.hubId === hubId).flatMap((hubLink) => {
    const receive = (route: Candidate): Candidate => ({
      ...route, key: `${hubLink.id}:${route.key}`, asPath: [12076, ...route.asPath],
      connectionId: hubLink.id, originHubId: hubId, erHubLinkId: hubLink.id,
      ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map(receive) } : {}),
    })
    const routes = erLinks.filter((link) => link.siteId && link.locationId === hubLink.locationId)
      .flatMap((link) => (erAdvertisements[link.id] ?? []).map(receive))
    return applyRouteMapRules(routes, routerMapRules(topology, { kind: 'hub', id: hubId }, hubLink.id, 'inbound'))
  })
  const local = Object.fromEntries(topology.hubs.map((hub) => [
    hub.id, [
      ...erImports(hub.id),
      ...topology.connections.filter((c) => c.enabled && c.hubId === hub.id).flatMap((connection) => mapRoutes(connection, fromSite(connection, [
        ...localRoutes(connection, topology),
        ...(connection.learnSiteRoutes ? siteRouting.tables[connection.siteId].map((route) => learnedRoute(connection, route)) : []),
      ]), 'inbound')),
      ...topology.spokes.filter((s) => s.hubId === hub.id).flatMap((spoke) => spoke.prefixes.map((prefix): Candidate => ({
        key: `${spoke.id}:${prefix}`, prefix, asPath: [], kind: 'system', transport: 'VNet',
        connectionId: spoke.id, siteId: spoke.id, originHubId: hub.id, remote: false,
      }))),
    ],
  ]))
  let tables = Object.fromEntries(topology.hubs.map((hub) => [hub.id, decide(hub, local[hub.id])]))
  const signature = (value: typeof tables) => JSON.stringify(topology.hubs.map((hub) =>
    value[hub.id].map((d) => [d.prefix, d.selected.map((r) => r.key).sort()]),
  ))
  const seen = new Set([signature(tables)])
  const warnings: string[] = []
  let converged = topology.hubs.length < 2
  for (let round = 0; round < 64 && !converged; round++) {
    const next = Object.fromEntries(topology.hubs.map((hub) => {
      const remote = topology.hubs.filter((h) => h.id !== hub.id).flatMap((origin) =>
        tables[origin.id].flatMap((d) => d.selected)
          .filter((r) => !r.remote && r.prefix !== '0.0.0.0/0')
          .map((r) => ({ ...r, asPath: [65520, 65520, ...r.asPath], remote: true, secureOrigin: origin.routingIntent.private })),
      )
      return [hub.id, decide(hub, [...local[hub.id], ...remote])]
    }))
    const previousSignature = signature(tables)
    const nextSignature = signature(next)
    tables = next
    if (nextSignature === previousSignature) converged = true
    else if (seen.has(nextSignature)) break
    seen.add(nextSignature)
  }
  if (!converged) warnings.push('The best-path advertisement model did not converge. Tables are provisional; flow tracing is disabled.')
  if (topology.routeMaps?.length || topology.connections.some((c) => c.inbound.length || c.outbound.length)) {
    warnings.push('Route maps model IPv4 prefix conditions and permit, drop, summarize, and prepend actions only. Community and AS-path matching, NAT interactions, and other attribute modifications are not simulated.')
  }
  if (Object.values(tables).some((table) => table.some((d) => d.candidates.some((r) => r.forwardingRoutes)))) {
    warnings.push('Summary forwarding retains known contributing destinations only; aggregate holes are reported as unreachable. Gateway discard-route behavior is not simulated.')
  }
  if (topology.connections.some((c) => c.enabled && c.transport === 'SDWAN')) {
    warnings.push('SD-WAN is modeled as an independent NVA BGP source, not a VPN gateway. After the documented ER/VPN comparison, NVA candidates compete on AS path. Vendor-specific and undocumented NVA tie-breaks are not predicted.')
  }
  if (topology.connections.some((c) => c.enabled && c.routes.some((r) => r.kind === 'vpn-static'))) {
    warnings.push('VPN site static routes use a simplified gateway import: empty local AS path, VPN transport, and inter-hub propagation. They do not receive hub-table static priority. Validate gateway redistribution and BGP/static coexistence in Azure.')
  }
  for (const hub of topology.hubs) {
    if (tables[hub.id].some((d) => d.candidates.some((r) => !r.remote && r.transport === 'ExpressRoute')
      && d.candidates.some((r) => !r.remote && (r.transport === 'VPN' || r.transport === 'SDWAN')))) {
      warnings.push(`${hub.name}: nominal converged HRP is modeled; dynamic failback timing and withdrawal/recovery history after an ExpressRoute recovery are not simulated.`)
    }
    if (hub.preference === 'ASPath') continue
    // Remote candidates already include the two inter-hub ASNs.
    if (tables[hub.id].some((d) => d.candidates.some((a) => !a.remote && d.candidates.some((b) =>
      a.kind === 'bgp' && b.kind === 'bgp' && b.remote && a.asPath.length >= b.asPath.length,
    )))) warnings.push(`${hub.name}: a local AS path is at least two ASNs longer than a remote hub's selected path before inter-hub prepends. Azure documents possible arrival-order races; the nominal HRP result shown here is not guaranteed.`)
  }
  if (!siteRouting.converged) {
    converged = false
    warnings.push('On-premises BGP did not converge within 64 rounds. Flow tracing is disabled.')
  }
  if (topology.siteLinks.length) warnings.push('On-premises links use shortest-AS-path BGP, exact-prefix export allowlists, ASN loop prevention, and up to 32 equal paths per prefix. Azure-originated routes are shown as outbound advertisements but are not reimported into Azure through the site mesh. Local preference, MED, communities, and vendor export rules are not simulated.')
  const privateHubs = topology.hubs.filter((h) => h.routingIntent.private)
  if (privateHubs.length > 0 && privateHubs.length !== topology.hubs.length) warnings.push('Mixed private-routing-intent and unsecured hubs can produce asymmetric paths in Azure. The model assumes Default propagation from unsecured hubs; validate all return paths.')
  const firewallTables = Object.fromEntries(topology.hubs.map((hub) => [hub.id, tables[hub.id]]))
  const policyRoute = (hub: Hub, prefix: string, internet = false): Candidate => ({
    key: `${hub.id}:policy:${prefix}`, prefix, asPath: [], kind: 'policy',
    transport: internet ? 'Internet' : 'Firewall', connectionId: `firewall:${hub.id}`,
    siteId: '', originHubId: hub.id, remote: false,
  })
  const forwardingTables = Object.fromEntries(topology.hubs.map((hub) => {
    const intent = hub.routingIntent
    const policies = intent.private ? ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', ...intent.privatePrefixes] : []
    if (intent.internet) policies.push('0.0.0.0/0')
    const unique = [...new Set(policies)]
    const effective: Decision[] = unique.map((prefix) => {
      const route = policyRoute(hub, prefix)
      return { prefix, candidates: [route], selected: [route], explanation: ['Routing intent redirects this prefix to Azure Firewall. The firewall uses its separate routing table.'] }
    })
    if (!intent.private) effective.push(...tables[hub.id].filter((d) => !unique.includes(d.prefix)))
    if (intent.internet) {
      const route = policyRoute(hub, '0.0.0.0/0', true)
      firewallTables[hub.id] = [
        ...firewallTables[hub.id].filter((d) => d.prefix !== '0.0.0.0/0'),
        { prefix: route.prefix, candidates: [route], selected: [route], explanation: ['Internet routing intent uses direct Internet egress from Azure Firewall.'] },
      ]
    }
    return [hub.id, effective.length || intent.private ? effective : tables[hub.id]]
  }))
  const outbound: Record<string, Candidate[]> = Object.fromEntries(topology.connections.map((connection) => {
    if (!connection.enabled || connection.transport === 'SDWAN') return [connection.id, []]
    const routes = mapRoutes(connection, tables[connection.hubId].flatMap((d) => d.selected)
      .filter((r) => r.connectionId !== connection.id && !r.sitePath?.includes(connection.siteId)
        && !(connection.transport === 'ExpressRoute' && r.transport === 'ExpressRoute'))
      .map((r) => ({ ...r, asPath: connection.transport === 'ExpressRoute' ? r.asPath : [65515, ...r.asPath] })), 'outbound')
    return [connection.id, connection.transport === 'ExpressRoute' ? routes.map(erCustomerExport) : routes]
  }))
  for (const link of erLinks.filter((link) => link.hubId)) {
    const routes = tables[link.hubId!].flatMap((decision) => decision.selected)
      .filter((route) => route.transport !== 'ExpressRoute' && route.prefix !== '0.0.0.0/0')
    const mapped = [
      ...applyRouteMapRules(routes.filter((route) => route.kind !== 'vpn-static'), routerMapRules(topology, { kind: 'hub', id: link.hubId! }, link.id, 'outbound')),
      ...routes.filter((route) => route.kind === 'vpn-static'),
    ]
    outbound[link.id] = mapped
      .map((route) => ({ ...erCustomerExport(route), erHubLinkId: link.id, erLocationId: link.locationId }))
    erAdvertisements[link.id] = outbound[link.id]
  }
  for (const link of erLinks.filter((link) => link.siteId)) {
    outbound[link.id] = erLinks.filter((hubLink) => hubLink.hubId && hubLink.locationId === link.locationId)
      .flatMap((hubLink) => outbound[hubLink.id] ?? [])
      .filter((route) => !route.sitePath?.includes(link.siteId!))
  }
  if ((topology.erLocations ?? []).length) warnings.push('ER locations group private-peering attachments: each site attachment is an independent circuit. Azure advertises selected VNet, VPN and NVA routes, but not ER-learned routes, to those circuits. Global Reach, shared-circuit hub-to-hub reflection, redundant MSEE sessions, circuit bandwidth and gateway limits are not simulated.')
  return { tables: forwardingTables, firewallTables, siteTables: siteRouting.tables, siteCandidates: siteRouting.candidates, outbound, erAdvertisements, converged, warnings }
}

export interface FlowPath {
  hubs: string[]
  connectionId?: string
  siteId?: string
  steps: string[]
  firewalls?: string[]
  siteHops?: string[]
  siteLinkIds?: string[]
  erLinkIds?: string[]
  status: 'delivered' | 'unreachable' | 'loop'
}

export function traceFlow(topology: Topology, simulation: Simulation, hubId: string, destination: string): FlowPath[] {
  const address = ipv4(destination)
  if (address === undefined || !topology.hubs.some((h) => h.id === hubId) || !simulation.converged) return []
  const paths: FlowPath[] = []
  const walk = (current: string, visited: string[], steps: string[], firewalls: string[]) => {
    const name = topology.hubs.find((h) => h.id === current)!.name
    if (visited.includes(current)) {
      paths.push({ hubs: [...visited, current], firewalls, steps: [...steps, `Forwarding loop at ${name}.`], status: 'loop' })
      return
    }
    const hubs = [...visited, current]
    const lookup = (table: Decision[]) => table.filter((d) => contains(d.prefix, address))
      .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
    let decision = lookup(simulation.tables[current])
    if (!decision) {
      paths.push({ hubs, firewalls, steps: [...steps, `${name}: no matching hub route for ${destination}. Check routing-intent private prefixes if enabled.`], status: 'unreachable' })
      return
    }
    const details = [...steps, `${name}: longest prefix ${decision.prefix}. ${decision.explanation.join(' ')}`]
    let inspected = firewalls
    if (decision.selected[0]?.transport === 'Firewall') {
      inspected = [...firewalls, current]
      decision = lookup(simulation.firewallTables[current])
      if (!decision) {
        paths.push({ hubs, firewalls: inspected, steps: [...details, `Azure Firewall in ${name}: no matching forwarding route.`], status: 'unreachable' })
        return
      }
      details.push(`Azure Firewall in ${name}: longest prefix ${decision.prefix}. ${decision.explanation.join(' ')}`)
    }
    const resolve = (route: Candidate): Candidate[] => {
      if (route.remote || !route.forwardingRoutes) return [route]
      const matching = route.forwardingRoutes.filter((r) => contains(r.prefix, address))
      const longest = Math.max(...matching.map((r) => cidr(r.prefix)!.length))
      return matching.filter((r) => cidr(r.prefix)!.length === longest).flatMap(resolve)
    }
    const forwarding = decision.selected.flatMap((route) => {
      const resolved = resolve(route)
      if (!resolved.length && paths.length < 128) {
        paths.push({ hubs, firewalls: inspected, connectionId: route.connectionId,
          steps: [...details, 'The summary has no contributing route for this destination.'], status: 'unreachable' })
      }
      return resolved
    })
    for (const route of forwarding) {
      if (paths.length >= 128) return
      if (route.remote) walk(route.originHubId, hubs, details, inspected)
      else if (route.transport === 'Internet') paths.push({ hubs, firewalls: inspected, steps: [...details, 'Direct Internet egress. Firewall allow/deny and SNAT policies are not simulated.'], status: 'delivered' })
      else paths.push({ hubs, firewalls: inspected, siteHops: route.sitePath, siteLinkIds: route.siteLinkIds, connectionId: route.connectionId, siteId: route.siteId,
        ...(route.erHubLinkId && route.erSiteLinkId ? { erLinkIds: [route.erHubLinkId, route.erSiteLinkId] } : {}),
        steps: [...details, `Exit via ${(topology.connections.find((c) => c.id === route.connectionId) ?? topology.spokes.find((s) => s.id === route.connectionId) ?? topology.erLinks?.find((link) => link.id === route.connectionId))?.name ?? route.connectionId}.`,
          ...(route.erLocationId ? [`ExpressRoute location: ${topology.erLocations?.find((location) => location.id === route.erLocationId)?.name}.`] : []),
          ...(route.sitePath && route.sitePath.length > 1 ? [`On-premises transit: ${route.sitePath.map((id) => topology.sites.find((s) => s.id === id)!.name).join(' → ')}.`] : [])],
        status: 'delivered' })
    }
  }
  walk(hubId, [], [], [])
  return paths
}
