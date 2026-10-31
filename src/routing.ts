import type { Connection, Hub, RouteKind, RouteMapDirection, RouterSelection, Topology, Transport } from './model'
import { cidr, contains, ipv4 } from './validation'
import { applyRouteMapRules, connectionMapRules, propagateSites, routerMapRules, siteExports } from './bgp'
import type { SiteRoute } from './bgp'

const RFC1918_PREFIXES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']

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
  nvaSpokeId?: string
}

export interface Decision {
  prefix: string
  candidates: Candidate[]
  selected: Candidate[]
  explanation: string[]
}

export interface Simulation {
  bgpTables: Record<string, Decision[]>
  tables: Record<string, Decision[]>
  firewallTables: Record<string, Decision[]>
  siteTables: Record<string, SiteRoute[]>
  siteCandidates: Record<string, SiteRoute[]>
  outbound: Record<string, Candidate[]>
  erAdvertisements: Record<string, Candidate[]>
  routePolicies: RoutePolicySnapshot[]
  converged: boolean
  warnings: string[]
  siteSelectionComplete?: boolean
}

export interface RoutePolicySnapshot {
  router: RouterSelection
  connectionId: string
  direction: RouteMapDirection
  before: Candidate[]
  after: Candidate[]
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
    const shortest = Math.min(...selected.map((r) => r.asPath.length))
    filter(`Shortest learned AS path (${shortest} ASNs, including inter-hub prepends).`, (r) => r.asPath.length === shortest)
  }
  filter('Local connections are preferred over remote-hub connections.', (r) => !r.remote)
  // HRP compares ER and S2S VPN explicitly. An NVA is not classified as a VPN gateway.
  if (selected.some((r) => r.transport === 'ExpressRoute') && selected.some((r) => r.transport === 'VPN')) {
    const preferred = hub.preference === 'VPN' || selected.every((r) => r.remote) ? 'VPN' : 'ExpressRoute'
    filter(`${preferred} wins the ExpressRoute versus S2S VPN comparison.`, (r) => r.transport !== (preferred === 'VPN' ? 'ExpressRoute' : 'VPN'))
  }
  if (hub.preference !== 'ASPath') {
    const shortest = Math.min(...selected.map((r) => r.asPath.length))
    filter(`Shortest learned AS path (${shortest} ASNs).`, (r) => r.asPath.length === shortest)
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
    ...(connection.spokeId ? { nvaSpokeId: connection.spokeId } : {}),
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
  const routePolicies: RoutePolicySnapshot[] = []
  const policy = (router: RouterSelection, connectionId: string, direction: RouteMapDirection, before: Candidate[], after: Candidate[]) => {
    routePolicies.push({ router, connectionId, direction, before, after })
    return after
  }
  const mapRoutes = (connection: Connection, routes: Candidate[], direction: RouteMapDirection) => policy(
    { kind: 'hub', id: connection.hubId }, connection.id, direction, routes, [
      ...applyRouteMapRules(routes.filter((route) => route.kind !== 'vpn-static'), connectionMapRules(topology, connection, direction)),
      ...routes.filter((route) => route.kind === 'vpn-static'),
    ])
  const fromSite = (connection: Connection, routes: Candidate[]) => {
    const bgp = routes.filter((route) => route.kind !== 'vpn-static')
    const provider = new Map(bgp.map((route) => [route.key, connection.transport === 'ExpressRoute' && route.asPath[0] === 12076]))
    const before = bgp.map((route) => ({ ...route, asPath: provider.get(route.key) ? route.asPath.slice(1) : route.asPath }))
    const after = policy({ kind: 'site', id: connection.siteId }, connection.id, 'outbound', before,
      siteExports(topology, connection.siteId, connection.id, before))
    return [
      ...after.map((route) => ({ ...route, asPath: provider.get(route.key) ? [12076, ...route.asPath]
        : connection.transport === 'SpokeNVA' && route.asPath[0] !== topology.sites.find((site) => site.id === connection.siteId)!.asn
          ? [topology.sites.find((site) => site.id === connection.siteId)!.asn, ...route.asPath] : route.asPath })),
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
      ...(connection.spokeId ? { nvaSpokeId: connection.spokeId } : {}),
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
    const routes = [
      ...link.routes.map((route) => candidate({ ...route, key: route.id, sitePath: [site.id], siteLinkIds: [] })),
      ...(link.learnSiteRoutes ? siteRouting.tables[site.id].filter((route) => !route.key.startsWith(`${link.id}:`)).map(candidate) : []),
    ]
    erAdvertisements[link.id] = policy({ kind: 'site', id: site.id }, link.id, 'outbound', routes,
      siteExports(topology, site.id, link.id, routes))
  }
  const erImports = (hubId: string) => erLinks.filter((link) => link.hubId === hubId).flatMap((hubLink) => {
    const receive = (route: Candidate): Candidate => ({
      ...route, key: `${hubLink.id}:${route.key}`, asPath: [12076, ...route.asPath],
      connectionId: hubLink.id, originHubId: hubId, erHubLinkId: hubLink.id,
      ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map(receive) } : {}),
    })
    const routes = erLinks.filter((link) => link.siteId && link.locationId === hubLink.locationId)
      .flatMap((link) => (erAdvertisements[link.id] ?? []).map(receive))
    return policy({ kind: 'hub', id: hubId }, hubLink.id, 'inbound', routes,
      applyRouteMapRules(routes, routerMapRules(topology, { kind: 'hub', id: hubId }, hubLink.id, 'inbound')))
  })
  const local = Object.fromEntries(topology.hubs.map((hub) => [
    hub.id, [
      ...erImports(hub.id),
      ...topology.connections.filter((c) => c.enabled && c.hubId === hub.id && c.transport !== 'SpokeNVA').flatMap((connection) => mapRoutes(connection, fromSite(connection, [
        ...localRoutes(connection, topology),
        ...(connection.learnSiteRoutes ? siteRouting.tables[connection.siteId].map((route) => learnedRoute(connection, route)) : []),
      ]), 'inbound')),
      ...topology.spokes.filter((s) => s.hubId === hub.id).flatMap((spoke) => {
        const routes: Candidate[] = [
          ...spoke.prefixes.map((prefix): Candidate => ({
            key: `${spoke.id}:${prefix}`, prefix, asPath: [], kind: 'system', transport: 'VNet',
            connectionId: spoke.id, siteId: spoke.id, originHubId: hub.id, remote: false,
          })),
          ...topology.connections.filter((connection) => connection.enabled && connection.transport === 'SpokeNVA' && connection.spokeId === spoke.id)
            .flatMap((connection) => fromSite(connection, [
              ...localRoutes(connection, topology).map((route) => {
                const contributions = siteRouting.tables[connection.siteId]
                  .filter((child) => child.sitePath.length > 1 && cidr(route.prefix)!.length <= cidr(child.prefix)!.length
                    && contains(route.prefix, cidr(child.prefix)!.network))
                  .map((child) => learnedRoute(connection, child))
                return contributions.length ? { ...route, forwardingRoutes: contributions } : route
              }),
              ...siteRouting.tables[connection.siteId]
                .filter((route) => !route.key.startsWith(`${connection.id}:`) && (connection.learnSiteRoutes
                  || topology.spokes.some((s) => s.nvaSpokeIds?.includes(spoke.id) && route.key.startsWith(`${s.id}:`))))
                .map((route) => learnedRoute(connection, route)),
            ]))
            .filter((route) => !route.asPath.includes(65515) && !topology.spokes.some((owner) => owner.hubId === hub.id
              && owner.prefixes.some((prefix) => cidr(prefix)!.length <= cidr(route.prefix)!.length && contains(prefix, cidr(route.prefix)!.network)))),
        ]
        return policy({ kind: 'hub', id: hub.id }, spoke.id, 'inbound', routes,
          applyRouteMapRules(routes, routerMapRules(topology, { kind: 'hub', id: hub.id }, spoke.id, 'inbound')))
      }),
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
    const policies = intent.private ? [...RFC1918_PREFIXES, ...intent.privatePrefixes] : []
    if (intent.internet) policies.push('0.0.0.0/0')
    const unique = [...new Set(policies)]
    const effective: Decision[] = unique.map((prefix) => {
      const route = policyRoute(hub, prefix)
      return { prefix, candidates: [route], selected: [route], explanation: ['Routing intent redirects this prefix to Azure Firewall. The firewall uses its separate routing table.'] }
    })
    if (!intent.private) effective.push(...tables[hub.id].filter((d) => !unique.includes(d.prefix)))
    if (intent.internet || (intent.private && !firewallTables[hub.id].some((d) => d.prefix === '0.0.0.0/0'))) {
      const route = policyRoute(hub, '0.0.0.0/0', true)
      firewallTables[hub.id] = [
        ...firewallTables[hub.id].filter((d) => d.prefix !== '0.0.0.0/0'),
        { prefix: route.prefix, candidates: [route], selected: [route], explanation: [intent.internet
          ? 'Internet routing intent uses direct Internet egress from Azure Firewall.'
          : 'Azure Firewall has a direct Internet fallback when no default is learned. This does not install a hub default route.'] },
      ]
    }
    return [hub.id, effective.length || intent.private ? effective : tables[hub.id]]
  }))
  const branchExportEligible = (route: Candidate) => route.transport !== 'SpokeNVA' || !topology.spokes.some((spoke) =>
    spoke.prefixes.some((prefix) => cidr(prefix)!.length < cidr(route.prefix)!.length && contains(prefix, cidr(route.prefix)!.network)))
  const hubOutboundCandidates = (hubId: string, propagateDefaultRoute?: boolean): Candidate[] => {
    const hub = topology.hubs.find((h) => h.id === hubId)!
    const selected = tables[hubId].flatMap((decision) => decision.selected)
    if (!propagateDefaultRoute) return selected.filter((route) => route.prefix !== '0.0.0.0/0')
    if (!hub.routingIntent.internet) return selected
    return [policyRoute(hub, '0.0.0.0/0'), ...selected.filter((route) => route.prefix !== '0.0.0.0/0')]
  }
  const outbound: Record<string, Candidate[]> = Object.fromEntries(topology.connections.map((connection) => {
    if (!connection.enabled || connection.transport === 'SDWAN') return [connection.id, []]
    const hostingSpoke = connection.spokeId ? topology.spokes.find((s) => s.id === connection.spokeId) : undefined
    const propagateDefault = Boolean(connection.propagateDefaultRoute || hostingSpoke?.propagateDefaultRoute)
    const before = hubOutboundCandidates(connection.hubId, propagateDefault)
      .filter((r) => branchExportEligible(r) && r.connectionId !== connection.id && !r.sitePath?.includes(connection.siteId)
        && !(connection.transport === 'ExpressRoute' && r.transport === 'ExpressRoute'))
      .map((r) => ({ ...r, asPath: connection.transport === 'ExpressRoute' ? r.asPath : [65515, ...r.asPath] }))
    const routes = connection.transport === 'SpokeNVA'
      ? applyRouteMapRules(before, routerMapRules(topology, { kind: 'hub', id: connection.hubId }, connection.spokeId!, 'outbound'))
      : mapRoutes(connection, before, 'outbound')
    return [connection.id, connection.transport === 'ExpressRoute' ? routes.map(erCustomerExport) : routes]
  }))
  for (const spoke of topology.spokes) {
    if (!spoke.hubId) {
      outbound[spoke.id] = []
      continue
    }
    const propagateDefault = Boolean(spoke.propagateDefaultRoute
      || topology.connections.some((c) => c.enabled && c.transport === 'SpokeNVA' && c.spokeId === spoke.id && c.propagateDefaultRoute))
    const before = hubOutboundCandidates(spoke.hubId, propagateDefault)
      .filter((route) => route.connectionId !== spoke.id)
      .map((route) => ({ ...route, asPath: [65515, ...route.asPath] }))
    const after = policy({ kind: 'hub', id: spoke.hubId }, spoke.id, 'outbound', before,
      applyRouteMapRules(before, routerMapRules(topology, { kind: 'hub', id: spoke.hubId }, spoke.id, 'outbound')))
    outbound[spoke.id] = after
  }
  if (topology.connections.some((connection) => connection.transport === 'SpokeNVA')) {
    warnings.push('Spoke BGP NVAs use one logical peering representing identical advertisements to both Azure hub router instances (AS65515), Default association/propagation and branch-to-branch enabled. NIC reachability, UDRs, sessions, vendor policies, load-balancer next hops and physical redundancy are not verified. Advertisements contained in directly attached local VNet address spaces are suppressed; those networks use system routes.')
  }
  for (const link of erLinks.filter((link) => link.hubId)) {
    const routes = hubOutboundCandidates(link.hubId!, link.propagateDefaultRoute)
      .filter((route) => branchExportEligible(route) && route.transport !== 'ExpressRoute')
    const mapped = policy({ kind: 'hub', id: link.hubId! }, link.id, 'outbound', routes, [
      ...applyRouteMapRules(routes.filter((route) => route.kind !== 'vpn-static'), routerMapRules(topology, { kind: 'hub', id: link.hubId! }, link.id, 'outbound')),
      ...routes.filter((route) => route.kind === 'vpn-static'),
    ])
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
  return { bgpTables: tables, tables: forwardingTables, firewallTables, siteTables: siteRouting.tables, siteCandidates: siteRouting.candidates, outbound, erAdvertisements, routePolicies, converged, warnings, siteSelectionComplete: siteRouting.selectionComplete }
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
  termination?: 'owner' | 'internet' | 'no-route' | 'firewall-no-route' | 'summary-hole' | 'attachment-unavailable' | 'downstream-no-route' | 'loop' | 'nonconverged'
  terminalKind?: 'spoke' | 'site'
  traceComplete?: boolean
  lookupPrefix?: string
  nvaSpokeId?: string
}

export function traceFlow(topology: Topology, simulation: Simulation, hubId: string, destination: string): FlowPath[] {
  const address = ipv4(destination)
  if (address === undefined || !topology.hubs.some((h) => h.id === hubId) || !simulation.converged) return []
  const paths: FlowPath[] = []
  let traceComplete = true
  const walk = (current: string, visited: string[], steps: string[], firewalls: string[]) => {
    const name = topology.hubs.find((h) => h.id === current)!.name
    if (visited.includes(current)) {
      paths.push({ hubs: [...visited, current], firewalls, steps: [...steps, `Forwarding loop at ${name}.`], status: 'loop', termination: 'loop' })
      return
    }
    const hubs = [...visited, current]
    const lookup = (table: Decision[]) => table.filter((d) => contains(d.prefix, address))
      .sort((a, b) => cidr(b.prefix)!.length - cidr(a.prefix)!.length)[0]
    let decision = lookup(simulation.tables[current])
    if (!decision) {
      paths.push({ hubs, firewalls, steps: [...steps, `${name}: no matching hub route for ${destination}. Check routing-intent private prefixes if enabled.`], status: 'unreachable', termination: 'no-route' })
      return
    }
    const details = [...steps, `${name}: longest prefix ${decision.prefix}. ${decision.explanation.join(' ')}`]
    let inspected = firewalls
    if (decision.selected[0]?.transport === 'Firewall') {
      inspected = [...firewalls, current]
      const policyPrefix = decision.prefix
      decision = lookup(simulation.firewallTables[current])
      if (!decision) {
        paths.push({ hubs, firewalls: inspected, steps: [...details, `Azure Firewall in ${name}: no matching forwarding route.`], status: 'unreachable', termination: 'firewall-no-route', lookupPrefix: policyPrefix })
        return
      }
      details.push(`Azure Firewall in ${name}: longest prefix ${decision.prefix}. ${decision.explanation.join(' ')}`)
    }
    const resolve = <T extends { prefix: string; remote?: boolean; forwardingRoutes?: T[] }>(route: T): T[] => {
      if (route.remote || !route.forwardingRoutes) return [route]
      const matching = route.forwardingRoutes.filter((r) => contains(r.prefix, address))
      const longest = Math.max(...matching.map((r) => cidr(r.prefix)!.length))
      return matching.filter((r) => cidr(r.prefix)!.length === longest).flatMap(resolve)
    }
    const forwarding = decision.selected.flatMap((route) => {
      const resolved = resolve(route)
      if (!resolved.length) {
        if (paths.length >= 128) traceComplete = false
        else paths.push({ hubs, firewalls: inspected, connectionId: route.connectionId,
          steps: [...details, 'The summary has no contributing route for this destination.'], status: 'unreachable', termination: 'summary-hole', lookupPrefix: decision.prefix })
      }
      return resolved
    })
    for (const route of forwarding) {
      if (paths.length >= 128) { traceComplete = false; return }
      if (route.remote) walk(route.originHubId, hubs, details, inspected)
      else if (route.transport === 'Internet') {
        const privateDestination = RFC1918_PREFIXES.some((prefix) => contains(prefix, address))
        paths.push({ hubs, firewalls: inspected,
          steps: [...details, privateDestination
            ? 'Internet egress does not provide reachability to an RFC1918 destination without a private forwarding route.'
            : 'Direct Internet egress. Firewall allow/deny and SNAT policies are not simulated.'],
          status: privateDestination ? 'unreachable' : 'delivered', termination: 'internet', lookupPrefix: decision.prefix })
      }
      else {
        const matching = route.kind === 'vpn-static'
          ? (simulation.siteTables[route.siteId] ?? []).filter((r) => contains(r.prefix, address)) : []
        const longest = Math.max(...matching.map((r) => cidr(r.prefix)!.length))
        const onward = matching.filter((r) => cidr(r.prefix)!.length === longest).flatMap(resolve)
        const missing = route.kind === 'vpn-static' && !onward.length && (matching.length > 0
          || topology.sites.some((site) => site.id !== route.siteId && site.prefixes.some((prefix) => contains(prefix, address))))
        for (const tail of onward.length ? onward : [route]) {
          if (paths.length >= 128) { traceComplete = false; return }
          const terminalSiteId = tail.sitePath?.[tail.sitePath.length - 1] ?? route.siteId
          const terminalNvaSpokeId = topology.connections.find((c) => c.transport === 'SpokeNVA' && c.siteId === terminalSiteId && c.spokeId)?.spokeId
          const downstreamVnet = terminalNvaSpokeId
            ? topology.spokes.find((s) => s.nvaSpokeIds?.includes(terminalNvaSpokeId) && s.prefixes.some((p) => contains(p, address)))
            : undefined
          paths.push({ hubs, firewalls: inspected, siteHops: tail.sitePath, siteLinkIds: tail.siteLinkIds,
            connectionId: route.connectionId, siteId: downstreamVnet?.id ?? terminalSiteId,
            ...(route.erHubLinkId && route.erSiteLinkId ? { erLinkIds: [route.erHubLinkId, route.erSiteLinkId] } : {}),
            ...(route.nvaSpokeId ? { nvaSpokeId: route.nvaSpokeId } : {}),
            steps: [...details, `Exit via ${(topology.connections.find((c) => c.id === route.connectionId) ?? topology.spokes.find((s) => s.id === route.connectionId) ?? topology.erLinks?.find((link) => link.id === route.connectionId))?.name ?? route.connectionId}.`,
              ...(route.erLocationId ? [`ExpressRoute location: ${topology.erLocations?.find((location) => location.id === route.erLocationId)?.name}.`] : []),
              ...(route.nvaSpokeId ? [`BGP next hop is NVA interface ${topology.connections.find((connection) => connection.id === route.connectionId)?.peerIp} in spoke ${topology.spokes.find((spoke) => spoke.id === route.nvaSpokeId)?.name}.`] : []),
              ...(tail.sitePath && tail.sitePath.length > 1 ? [`On-premises transit: ${tail.sitePath.map((id) => topology.sites.find((s) => s.id === id)!.name).join(' → ')}.`] : []),
              ...(downstreamVnet ? [`Downstream VNet: ${downstreamVnet.name}.`] : []),
              ...(missing ? ['No known on-premises forwarding route to the destination site.'] : [])],
            status: missing ? 'unreachable' : 'delivered', termination: missing ? 'downstream-no-route' : 'owner',
            terminalKind: downstreamVnet || route.transport === 'VNet' ? 'spoke' : 'site', lookupPrefix: decision.prefix })
        }
      }
    }
  }
  walk(hubId, [], [], [])
  return paths.map((path) => ({ ...path, traceComplete }))
}
