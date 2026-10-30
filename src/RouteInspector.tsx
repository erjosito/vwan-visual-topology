import { t, localizeDiagnostic } from './i18n'
import { useMemo, useState } from 'react'
import type { ObjectSelection, Preference, Topology } from './model'
import { preferenceLabels, routeLabels, transportLabels } from './model'
import type { Candidate, Simulation } from './routing'
import { cidr } from './validation'
import { CanvasOverlay } from './CanvasOverlay'
import { azureRoutesAtSites } from './paths'
import { erLocationBgpTable, neighborRoutes } from './route-views'
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
  const erRouting = useMemo(() => location && mode === 'bgp' ? erLocationBgpTable(topology, simulation, location.id) : [],
    [topology, simulation, location, mode])
  const peers = useMemo(() => mode === 'bgp' ? [] : neighborRoutes(topology, simulation, router, mode, siteRouting),
    [topology, simulation, router, mode, siteRouting])
  const peerName = (peer: typeof peers[number]) => {
    if (peer.id.startsWith('interhub:')) {
      return `${topology.hubs.find((hub) => hub.id === peer.id.slice(9))?.name} · ${t('Inter-hub')}`
    }
    const link = [...topology.connections, ...topology.siteLinks, ...(topology.erLinks ?? [])].find((link) => link.id === peer.id)
    return link && !link.enabled ? peer.name.slice(0, -7) + t(' (down)') : peer.name
  }
  const label = (route: Candidate) => `${route.remote ? t("Remote hub · ") : ''}${route.transport === 'VNet' ? t("VNet connection") : route.transport === 'Firewall' ? 'Azure Firewall' : route.transport === 'Internet' ? t('Internet') : transportLabels[route.transport]} · ${route.kind === 'system' ? t("System") : route.kind === 'policy' ? t("Routing intent") : t(routeLabels[route.kind])}`
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
            key, asPath: r.asPath, preferred: keys.has(key), nextHop: hops[0] ?? azure ?? t("Local origin"),
            via: hops.length > 1 ? hops.join(' → ') : connection?.name ?? erLink?.name
              ?? topology.connections.find((connection) => r.key.startsWith(`${connection.id}:`))?.name,
            source: hops.length ? t("On-premises BGP") : azure ? t("Azure BGP") : t("Originated at site"),
          }
        }),
        explanation: candidates.length === 1 ? [t("Only available path.")] : [
          t("Shortest site AS path ({0} ASN{1}).", shortest, shortest === 1 ? '' : 's'),
          ...(preferred.length > 1 ? [t("{0} equal-cost paths remain (maximum 32).", preferred.length)] : []),
        ],
      }
    }) : (location ? erRouting : (view === 'bgp' ? simulation.bgpTables : view === 'firewall' ? simulation.firewallTables : simulation.tables)[router.id] ?? []).map((d) => ({
      prefix: d.prefix, explanation: d.explanation,
      candidates: d.candidates.map((r) => {
        const exit = (topology.connections.find((c) => c.id === r.connectionId) ?? topology.spokes.find((s) => s.id === r.connectionId) ?? topology.erLinks?.find((link) => link.id === r.connectionId))?.name
        const attachment = location ? topology.erLinks?.find((link) => link.id === r.connectionId) : undefined
        const peer = attachment?.hubId ? topology.hubs.find((hub) => hub.id === attachment.hubId)
          : attachment?.siteId ? topology.sites.find((site) => site.id === attachment.siteId) : undefined
        return {
          key: r.key, asPath: r.asPath, preferred: d.selected.some((s) => s.key === r.key), source: label(r),
          nextHop: location ? peer?.name : r.remote ? topology.hubs.find((h) => h.id === r.originHubId)?.name : r.transport === 'Firewall' ? 'Azure Firewall' : r.transport === 'Internet' ? t("Internet egress") : exit,
          via: location || r.remote ? exit : r.erLocationId ? topology.erLocations?.find((location) => location.id === r.erLocationId)?.name : undefined,
        }
      }),
    }))
  const rows = peers.filter((peer) => !neighbor || peer.id === neighbor).flatMap((peer) => peer[stage].map((route, index) => ({
    prefix: route.prefix, key: `${peer.id}:${route.key}:${index}`, asPath: route.asPath, preferred: false,
    nextHop: peerName(peer), source: 'transport' in route ? label(route) : t("On-premises BGP"),
  })))
  const groups: Group[] = (mode === 'bgp' ? bgpGroups : [...new Set(rows.map((row) => row.prefix))]
    .sort((a, b) => cidr(a)!.network - cidr(b)!.network || cidr(a)!.length - cidr(b)!.length)
    .map((prefix) => ({ prefix, explanation: [], candidates: rows.filter((row) => row.prefix === prefix) })))
    .filter((group) => group.prefix.includes(filter.trim()))
  const title = mode !== 'bgp' ? mode === 'learned' ? t("Learned routes") : t("Advertised routes")
    : hub && view === 'hub' ? t("Hub forwarding table") : hub && view === 'firewall' ? t("Firewall forwarding table") : t("BGP table")
  return <CanvasOverlay title={`${title} · ${site?.name ?? hub?.name ?? location?.name ?? t("Router")}`} className="effective-routes" onClose={onClose}>
    <div className="inspector-controls">
      <label className="field"><span>{t("Inspect router")}</span><select aria-label={t("Inspect router")} value={`${router.kind}:${router.id}`} onChange={(e) => {
        const kind = e.target.value.split(':')[0] as ObjectSelection['kind']
        onRouter({ kind, id: e.target.value.slice(kind.length + 1) })
      }}><optgroup label={t("Virtual hubs")}>{topology.hubs.map((h) => <option key={h.id} value={`hub:${h.id}`}>{h.name}</option>)}</optgroup><optgroup label={t("On-premises sites")}>{topology.sites.map((s) => <option key={s.id} value={`site:${s.id}`}>{s.name}</option>)}</optgroup><optgroup label={t("ER locations")}>{topology.erLocations?.map((node) => <option key={node.id} value={`erLocation:${node.id}`}>{node.name}</option>)}</optgroup></select></label>
      <label className="field"><span>{t("Filter by prefix")}</span><input type="search" aria-label={t("Filter by prefix")} placeholder={t("e.g. 10.80 or /24")} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      {mode !== 'bgp' && <>
        <label className="field"><span>{t("Neighbor")}</span><select aria-label={t("Neighbor")} value={neighbor} onChange={(e) => setNeighbor(e.target.value)}><option value="">{t("All neighbors")}</option>{peers.map((peer) => <option key={peer.id} value={peer.id}>{peerName(peer)}</option>)}</select></label>
        {!location && <label className="field"><span>{t("Route-map stage")}</span><select aria-label={t("Route-map stage")} value={stage} onChange={(e) => setStage(e.target.value as RouteStage)}><option value="after">{t('After {0} route maps', t(mode === 'learned' ? 'inbound' : 'outbound'))}</option><option value="before">{t('Before {0} route maps', t(mode === 'learned' ? 'inbound' : 'outbound'))}</option></select></label>}
      </>}
      {hub && mode === 'bgp' && <><label className="field"><span>{t("Hub routing preference")}</span><select aria-label={t("Hub routing preference")} value={hub.preference} onChange={(e) => onPreference(e.target.value as Preference)}>{Object.entries(preferenceLabels).map(([v, name]) => <option key={v} value={v}>{t(name)}</option>)}</select></label>
        <label className="field"><span>{t("Route view")}</span><select aria-label={t("Route view")} value={view} onChange={(e) => onView(e.target.value as 'bgp' | 'hub' | 'firewall')}><option value="bgp">{t("BGP table (before routing intent)")}</option><option value="hub">{t("Hub forwarding table")}</option><option value="firewall" disabled={!hub.routingIntent.private && !hub.routingIntent.internet}>Azure Firewall</option></select></label></>}
    </div>
    {mode === 'bgp' && <p className="route-legend"><strong>{t("* Preferred")}</strong>  {t("· Click a prefix to highlight its paths.")}</p>}
    {hub && mode === 'bgp' && <p className="muted inspector-note">{t("Post-inbound candidates and preferred routes, including labeled system and VPN-static entries. Routing-intent redirection is separate in the hub forwarding table.")}</p>}
    {site && <p className="muted inspector-note">{t("Shortest-AS-path site routing includes Azure advertisements. Azure-originated routes are not re-exported to Azure; SD-WAN outbound learning is not modeled.")}</p>}
    {mode !== 'bgp' && !location && <p className="muted inspector-note">{t("{0} {1} route maps; not best-path selection. VPN-static entries bypass BGP route maps. ER provider AS-path processing and inter-hub prepends occur in transit, outside the router's route maps.", t(stage === 'after' ? 'After' : 'Before'), t(mode === 'learned' ? 'inbound' : 'outbound'))}</p>}
    {location && mode === 'bgp' && <p className="muted inspector-note">{t("Candidates learned from enabled attachments after neighbor outbound maps. Shortest AS paths are preferred; equal-cost paths are retained. Click a prefix to highlight its preferred next hops.")}</p>}
    {location && <p className="muted inspector-note">{t("Circuit export rules still apply. Global Reach and shared-circuit hub reflection are not modeled.")}{mode !== 'bgp' && t(" Routes are shown from the ER location's perspective; it has no configurable route maps.")}</p>}
    <div className="table-scroll"><table><thead><tr>{mode === 'bgp' && <th className="route-state" aria-label={t("Preferred route")}>*</th>}<th>{mode === 'bgp' ? t("Next hop / source") : t("Neighbor / source")}</th><th>{t("AS path")}</th></tr></thead>
      {groups.map((d) => <tbody key={d.prefix}>
        <tr data-reason-prefix={d.prefix}><th scope="rowgroup" colSpan={mode === 'bgp' ? 3 : 2} className="route-prefix-heading">{mode === 'bgp' ? <button className="prefix-button" onClick={() => onPrefix(d.prefix)}>{d.prefix}</button> : d.prefix}<span className="selection-reason">{d.explanation.map((explanation) => localizeDiagnostic(explanation)).join(' ')}</span></th></tr>
        {[...d.candidates].sort((a, b) => Number(b.preferred) - Number(a.preferred)).map((r) => <tr key={r.key} data-prefix={d.prefix} data-preferred={mode === 'bgp' ? r.preferred : undefined} className={mode === 'bgp' ? r.preferred ? 'preferred-route' : 'alternative-route' : undefined}>
        {mode === 'bgp' && <td className="route-state" aria-label={r.preferred ? t("Preferred") : t("Alternative")}>{r.preferred ? '*' : ''}</td>}
        <td>{r.nextHop}{r.via && <small>{t("Via")} {r.via}</small>}<small>{r.source}</small></td>
        <td className="as-path">{r.asPath.join(' ') || '—'}</td>
      </tr>)}</tbody>)}
    </table></div>
    {!groups.length && <p className="empty">{filter || neighbor ? t("No routes match the current filters.") : t("No routes available on this router.")}</p>}
  </CanvasOverlay>
}
