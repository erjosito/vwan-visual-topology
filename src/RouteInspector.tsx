import { useMemo, useState } from 'react'
import type { ObjectSelection, Preference, Topology } from './model'
import { preferenceLabels, routeLabels, transportLabels } from './model'
import type { Candidate, Simulation } from './routing'
import { cidr } from './validation'
import { CanvasOverlay } from './CanvasOverlay'
import { azureRoutesAtSites } from './paths'
import { neighborRoutes } from './route-views'
import type { RouteMode, RouteStage } from './route-views'

interface Row { key: string; asPath: number[]; preferred: boolean; nextHop?: string; via?: string; source: string }
interface Group { prefix: string; candidates: Row[]; explanation: string[] }

export function RouteInspector({ topology, simulation, router, view, mode, onRouter, onView, onPreference, onPrefix, onClose }: {
  topology: Topology; simulation: Simulation; router: ObjectSelection; view: 'bgp' | 'hub' | 'firewall'; mode: RouteMode
  onRouter: (router: ObjectSelection) => void; onView: (view: 'bgp' | 'hub' | 'firewall') => void
  onPreference: (preference: Preference) => void; onPrefix: (prefix: string) => void; onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [neighbor, setNeighbor] = useState('')
  const [stage, setStage] = useState<RouteStage>('after')
  const site = router.kind === 'site' ? topology.sites.find((s) => s.id === router.id) : undefined
  const hub = router.kind === 'hub' ? topology.hubs.find((h) => h.id === router.id) : undefined
  const location = router.kind === 'erLocation' ? topology.erLocations?.find((node) => node.id === router.id) : undefined
  const siteRouting = useMemo(() => site ? azureRoutesAtSites(topology, simulation) : undefined, [topology, simulation, site])
  const peers = useMemo(() => mode === 'bgp' ? [] : neighborRoutes(topology, simulation, router, mode, siteRouting),
    [topology, simulation, router, mode, siteRouting])
  const label = (route: Candidate) => `${route.remote ? 'Remote hub · ' : ''}${route.transport === 'VNet' ? 'VNet connection' : route.transport === 'Firewall' ? 'Azure Firewall' : route.transport === 'Internet' ? 'Internet' : transportLabels[route.transport]} · ${route.kind === 'system' ? 'System' : route.kind === 'policy' ? 'Routing intent' : routeLabels[route.kind]}`
  const bgpGroups: Group[] = site ? [...new Set((siteRouting?.candidates[site.id] ?? []).map((r) => r.prefix))]
    .sort((a, b) => cidr(a)!.network - cidr(b)!.network || cidr(a)!.length - cidr(b)!.length)
    .map((prefix) => {
      const candidates = siteRouting!.candidates[site.id].filter((r) => r.prefix === prefix)
      const preferred = siteRouting!.tables[site.id].filter((r) => r.prefix === prefix)
      const keys = new Set(preferred.map((r) => `${r.key}:${r.sitePath.join(':')}`))
      const shortest = Math.min(...preferred.map((r) => r.asPath.length))
      return {
        prefix,
        candidates: candidates.map((r) => {
          const key = `${r.key}:${r.sitePath.join(':')}`
          const hops = r.sitePath.slice(1).map((id) => topology.sites.find((s) => s.id === id)?.name)
          const connection = topology.connections.find((c) => c.id === r.connectionId)
          const erLink = topology.erLinks?.find((link) => link.id === r.connectionId)
          const azure = connection ? topology.hubs.find((hub) => hub.id === connection.hubId)?.name
            : erLink ? topology.erLocations?.find((location) => location.id === erLink.locationId)?.name : undefined
          return {
            key, asPath: r.asPath, preferred: keys.has(key), nextHop: hops[0] ?? azure ?? 'Local origin',
            via: hops.length > 1 ? hops.join(' → ') : connection?.name ?? erLink?.name
              ?? topology.connections.find((connection) => r.key.startsWith(`${connection.id}:`))?.name,
            source: hops.length ? 'On-premises BGP' : azure ? 'Azure BGP' : 'Originated at site',
          }
        }),
        explanation: candidates.length === 1 ? ['Only available path.'] : [
          `Shortest site AS path (${shortest} ASN${shortest === 1 ? '' : 's'}).`,
          ...(preferred.length > 1 ? [`${preferred.length} equal-cost paths remain (maximum 32).`] : []),
        ],
      }
    }) : ((view === 'bgp' ? simulation.bgpTables : view === 'firewall' ? simulation.firewallTables : simulation.tables)[router.id] ?? []).map((d) => ({
      prefix: d.prefix, explanation: d.explanation,
      candidates: d.candidates.map((r) => {
        const exit = (topology.connections.find((c) => c.id === r.connectionId) ?? topology.spokes.find((s) => s.id === r.connectionId) ?? topology.erLinks?.find((link) => link.id === r.connectionId))?.name
        return {
          key: r.key, asPath: r.asPath, preferred: d.selected.some((s) => s.key === r.key), source: label(r),
          nextHop: r.remote ? topology.hubs.find((h) => h.id === r.originHubId)?.name : r.transport === 'Firewall' ? 'Azure Firewall' : r.transport === 'Internet' ? 'Internet egress' : exit,
          via: r.remote ? exit : r.erLocationId ? topology.erLocations?.find((location) => location.id === r.erLocationId)?.name : undefined,
        }
      }),
    }))
  const rows = peers.filter((peer) => !neighbor || peer.id === neighbor).flatMap((peer) => peer[stage].map((route, index) => ({
    prefix: route.prefix, key: `${peer.id}:${route.key}:${index}`, asPath: route.asPath, preferred: false,
    nextHop: peer.name, source: 'transport' in route ? label(route) : 'On-premises BGP',
  })))
  const groups: Group[] = (mode === 'bgp' ? bgpGroups : [...new Set(rows.map((row) => row.prefix))]
    .sort((a, b) => cidr(a)!.network - cidr(b)!.network || cidr(a)!.length - cidr(b)!.length)
    .map((prefix) => ({ prefix, explanation: [], candidates: rows.filter((row) => row.prefix === prefix) })))
    .filter((group) => group.prefix.includes(filter.trim()))
  const title = mode !== 'bgp' ? mode === 'learned' ? 'Learned routes' : 'Advertised routes'
    : hub && view === 'hub' ? 'Hub forwarding table' : hub && view === 'firewall' ? 'Firewall forwarding table' : 'BGP table'
  return <CanvasOverlay title={`${title} · ${site?.name ?? hub?.name ?? location?.name ?? 'Router'}`} className="effective-routes" onClose={onClose}>
    <div className="inspector-controls">
      <label className="field"><span>Inspect router</span><select aria-label="Inspect router" value={`${router.kind}:${router.id}`} onChange={(e) => {
        const kind = e.target.value.split(':')[0] as ObjectSelection['kind']
        onRouter({ kind, id: e.target.value.slice(kind.length + 1) })
      }}><optgroup label="Virtual hubs">{topology.hubs.map((h) => <option key={h.id} value={`hub:${h.id}`}>{h.name}</option>)}</optgroup><optgroup label="On-premises sites">{topology.sites.map((s) => <option key={s.id} value={`site:${s.id}`}>{s.name}</option>)}</optgroup><optgroup label="ER locations">{topology.erLocations?.map((node) => <option key={node.id} value={`erLocation:${node.id}`}>{node.name}</option>)}</optgroup></select></label>
      <label className="field"><span>Filter by prefix</span><input type="search" aria-label="Filter by prefix" placeholder="e.g. 10.80 or /24" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      {mode !== 'bgp' && <>
        <label className="field"><span>Neighbor</span><select aria-label="Neighbor" value={neighbor} onChange={(e) => setNeighbor(e.target.value)}><option value="">All neighbors</option>{peers.map((peer) => <option key={peer.id} value={peer.id}>{peer.name}</option>)}</select></label>
        {!location && <label className="field"><span>Route-map stage</span><select aria-label="Route-map stage" value={stage} onChange={(e) => setStage(e.target.value as RouteStage)}><option value="after">After {mode === 'learned' ? 'inbound' : 'outbound'} route maps</option><option value="before">Before {mode === 'learned' ? 'inbound' : 'outbound'} route maps</option></select></label>}
      </>}
      {hub && mode === 'bgp' && <><label className="field"><span>Hub routing preference</span><select aria-label="Hub routing preference" value={hub.preference} onChange={(e) => onPreference(e.target.value as Preference)}>{Object.entries(preferenceLabels).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></label>
        <label className="field"><span>Route view</span><select aria-label="Route view" value={view} onChange={(e) => onView(e.target.value as 'bgp' | 'hub' | 'firewall')}><option value="bgp">BGP table (before routing intent)</option><option value="hub">Hub forwarding table</option><option value="firewall" disabled={!hub.routingIntent.private && !hub.routingIntent.internet}>Azure Firewall</option></select></label></>}
    </div>
    {mode === 'bgp' && !location && <p className="route-legend"><strong>* Preferred</strong> · Click a prefix to highlight its paths.</p>}
    {hub && mode === 'bgp' && <p className="muted inspector-note">Post-inbound candidates and preferred routes, including labeled system and VPN-static entries. Routing-intent redirection is separate in the hub forwarding table.</p>}
    {site && <p className="muted inspector-note">Shortest-AS-path site routing includes Azure advertisements. Azure-originated routes are not re-exported to Azure; SD-WAN outbound learning is not modeled.</p>}
    {mode !== 'bgp' && !location && <p className="muted inspector-note">{stage === 'after' ? 'After' : 'Before'} {mode === 'learned' ? 'inbound' : 'outbound'} route maps; not best-path selection. VPN-static entries bypass BGP route maps. ER provider AS-path processing and inter-hub prepends occur in transit, outside the router's route maps.</p>}
    {location && <p className="muted">Each attachment represents an independent private-peering circuit. A location-wide MSEE BGP best-path table, Global Reach and shared-circuit hub reflection are not modeled.{mode !== 'bgp' && " Routes are shown from the ER location's perspective; it has no configurable route maps."}</p>}
    {location && mode === 'bgp' && <div className="inspector-controls">{(topology.erLinks ?? []).filter((link) => link.locationId === location.id).map((link) => {
      const kind = link.hubId ? 'hub' : 'site', id = link.hubId ?? link.siteId!
      const name = (kind === 'hub' ? topology.hubs : topology.sites).find((node) => node.id === id)?.name
      return <button key={link.id} onClick={() => onRouter({ kind, id })}>BGP table · {name} · {link.name}</button>
    })}</div>}
    {(!location || mode !== 'bgp') && <div className="table-scroll"><table><thead><tr>{mode === 'bgp' && <th className="route-state" aria-label="Preferred route">*</th>}<th>{mode === 'bgp' ? 'Next hop / source' : 'Neighbor / source'}</th><th>AS path</th></tr></thead>
      {groups.map((d) => <tbody key={d.prefix}>
        <tr data-reason-prefix={d.prefix}><th scope="rowgroup" colSpan={mode === 'bgp' ? 3 : 2} className="route-prefix-heading">{mode === 'bgp' ? <button className="prefix-button" onClick={() => onPrefix(d.prefix)}>{d.prefix}</button> : d.prefix}<span className="selection-reason">{d.explanation.join(' ')}</span></th></tr>
        {[...d.candidates].sort((a, b) => Number(b.preferred) - Number(a.preferred)).map((r) => <tr key={r.key} data-prefix={d.prefix} data-preferred={mode === 'bgp' ? r.preferred : undefined} className={mode === 'bgp' ? r.preferred ? 'preferred-route' : 'alternative-route' : undefined}>
        {mode === 'bgp' && <td className="route-state" aria-label={r.preferred ? 'Preferred' : 'Alternative'}>{r.preferred ? '*' : ''}</td>}
        <td>{r.nextHop}{r.via && <small>Via {r.via}</small>}<small>{r.source}</small></td>
        <td className="as-path">{r.asPath.join(' ') || '—'}</td>
      </tr>)}</tbody>)}
    </table></div>}
    {!groups.length && !(location && mode === 'bgp') && <p className="empty">{filter || neighbor ? 'No routes match the current filters.' : 'No routes available on this router.'}</p>}
  </CanvasOverlay>
}
