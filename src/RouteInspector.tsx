import type { ObjectSelection, Preference, Topology } from './model'
import { preferenceLabels, routeLabels, transportLabels } from './model'
import type { Candidate, Simulation } from './routing'
import { cidr } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

interface Row { key: string; asPath: number[]; preferred: boolean; nextHop?: string; via?: string; source: string }
interface Group { prefix: string; candidates: Row[]; preferredCount: number; explanation: string[] }

export function RouteInspector({ topology, simulation, router, view, onRouter, onView, onPreference, onPrefix, onClose }: {
  topology: Topology; simulation: Simulation; router: ObjectSelection; view: 'hub' | 'firewall'
  onRouter: (router: ObjectSelection) => void; onView: (view: 'hub' | 'firewall') => void
  onPreference: (preference: Preference) => void; onPrefix: (prefix: string) => void; onClose: () => void
}) {
  const site = router.kind === 'site' ? topology.sites.find((s) => s.id === router.id) : undefined
  const hub = router.kind === 'hub' ? topology.hubs.find((h) => h.id === router.id) : undefined
  const label = (route: Candidate) => `${route.remote ? 'Remote hub · ' : ''}${route.transport === 'VNet' ? 'VNet connection' : route.transport === 'Firewall' ? 'Azure Firewall' : route.transport === 'Internet' ? 'Internet' : transportLabels[route.transport]} · ${route.kind === 'system' ? 'System' : route.kind === 'policy' ? 'Routing intent' : routeLabels[route.kind]}`
  const groups: Group[] = site ? [...new Set((simulation.siteCandidates[site.id] ?? []).map((r) => r.prefix))]
    .sort((a, b) => cidr(a)!.network - cidr(b)!.network || cidr(a)!.length - cidr(b)!.length)
    .map((prefix) => {
      const candidates = simulation.siteCandidates[site.id].filter((r) => r.prefix === prefix)
      const preferred = simulation.siteTables[site.id].filter((r) => r.prefix === prefix)
      const keys = new Set(preferred.map((r) => `${r.key}:${r.sitePath.join(':')}`))
      const shortest = Math.min(...preferred.map((r) => r.asPath.length))
      return {
        prefix, preferredCount: preferred.length,
        candidates: candidates.map((r) => {
          const key = `${r.key}:${r.sitePath.join(':')}`
          const hops = r.sitePath.slice(1).map((id) => topology.sites.find((s) => s.id === id)?.name)
          return {
            key, asPath: r.asPath, preferred: keys.has(key), nextHop: hops[0] ?? 'Local origin',
            via: hops.length > 1 ? hops.join(' → ') : hops.length ? undefined : topology.connections.find((c) => r.key.startsWith(`${c.id}:`))?.name,
            source: hops.length ? 'On-premises BGP' : 'Originated at site',
          }
        }),
        explanation: candidates.length === 1 ? ['Only available path.'] : [
          `Shortest site AS path (${shortest} ASN${shortest === 1 ? '' : 's'}).`,
          ...(preferred.length > 1 ? [`${preferred.length} equal-cost paths remain (maximum 32).`] : []),
        ],
      }
    }) : ((view === 'firewall' ? simulation.firewallTables : simulation.tables)[router.id] ?? []).map((d) => ({
      prefix: d.prefix, preferredCount: d.selected.length, explanation: d.explanation,
      candidates: d.candidates.map((r) => {
        const exit = (topology.connections.find((c) => c.id === r.connectionId) ?? topology.spokes.find((s) => s.id === r.connectionId))?.name
        return {
          key: r.key, asPath: r.asPath, preferred: d.selected.some((s) => s.key === r.key), source: label(r),
          nextHop: r.remote ? topology.hubs.find((h) => h.id === r.originHubId)?.name : r.transport === 'Firewall' ? 'Azure Firewall' : r.transport === 'Internet' ? 'Internet egress' : exit,
          via: r.remote ? exit : undefined,
        }
      }),
    }))
  return <CanvasOverlay title={`BGP routes · ${site?.name ?? hub?.name ?? 'Router'}`} className="effective-routes" onClose={onClose}>
    <div className="inspector-controls">
      <label className="field"><span>Inspect router</span><select aria-label="Inspect router" value={`${router.kind}:${router.id}`} onChange={(e) => {
        const kind = e.target.value.startsWith('site:') ? 'site' : 'hub'
        onRouter({ kind, id: e.target.value.slice(kind.length + 1) })
      }}><optgroup label="Virtual hubs">{topology.hubs.map((h) => <option key={h.id} value={`hub:${h.id}`}>{h.name}</option>)}</optgroup><optgroup label="On-premises sites">{topology.sites.map((s) => <option key={s.id} value={`site:${s.id}`}>{s.name}</option>)}</optgroup></select></label>
      {hub && <><label className="field"><span>Hub routing preference</span><select aria-label="Hub routing preference" value={hub.preference} onChange={(e) => onPreference(e.target.value as Preference)}>{Object.entries(preferenceLabels).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></label>
        <label className="field"><span>Route view</span><select aria-label="Route view" value={view} onChange={(e) => onView(e.target.value as 'hub' | 'firewall')}><option value="hub">Hub routing table</option><option value="firewall" disabled={!hub.routingIntent.private && !hub.routingIntent.internet}>Azure Firewall</option></select></label></>}
    </div>
    <p className="route-legend"><strong>* Preferred</strong> · {groups.length} prefixes · {groups.reduce((n, d) => n + d.candidates.length, 0)} paths. Click a prefix to highlight its preferred links.</p>
    {hub && <p className="muted inspector-note">Includes labeled system, VPN-static and routing-intent entries alongside BGP routes.</p>}
    <div className="table-scroll"><table><thead><tr><th>State</th><th>Destination</th><th>Next hop / source</th><th>AS path</th></tr></thead><tbody>
      {groups.flatMap((d) => [...[...d.candidates].sort((a, b) => Number(b.preferred) - Number(a.preferred)).map((r) => <tr key={`${d.prefix}:${r.key}`} data-prefix={d.prefix} data-preferred={r.preferred} className={r.preferred ? 'preferred-route' : 'alternative-route'}>
        <td className="route-state">{r.preferred ? '* Preferred' : 'Alternative'}{r.preferred && d.preferredCount > 1 && <span className="ecmp">ECMP ×{d.preferredCount}</span>}</td>
        <td><button className="prefix-button" onClick={() => onPrefix(d.prefix)}>{d.prefix}</button></td>
        <td>{r.nextHop}{r.via && <small>Via {r.via}</small>}<small>{r.source}</small></td>
        <td className="as-path">{r.asPath.join(' ') || '—'}</td>
      </tr>), <tr key={`${d.prefix}:reason`} data-reason-prefix={d.prefix}><td className="selection-reason" colSpan={4}><strong>{d.candidates.length} candidate{d.candidates.length === 1 ? '' : 's'} · {d.preferredCount} preferred</strong><p>{d.explanation.join(' ')}</p></td></tr>])}
    </tbody></table></div>
    {!groups.length && <p className="empty">No routes available on this router.</p>}
  </CanvasOverlay>
}
