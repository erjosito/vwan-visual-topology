import type { RouteMapDirection, RouteMapRule, RouterSelection, Topology } from './model'
import { CanvasOverlay } from './CanvasOverlay'

function RuleAction({ rule }: { rule: RouteMapRule }) {
  if (rule.action === 'drop') return <strong className="policy-drop">Drop route</strong>
  if (rule.action === 'prepend') return <>Prepend ASNs<code>{rule.prepend.join(' ') || 'None'}</code></>
  if (rule.action === 'summarize') return <>Summarize to{rule.summaryPrefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}</>
  return <>Permit unchanged</>
}

export function RouteMapInspector({ topology, router, direction, connectionId, onDirection, onConnection, onConfigure, onClose }: {
  topology: Topology; router: RouterSelection; direction?: RouteMapDirection; connectionId?: string
  onDirection: (direction?: RouteMapDirection) => void; onConnection: (connectionId?: string) => void; onConfigure: (router: RouterSelection, connectionId?: string) => void; onClose: () => void
}) {
  const node = (router.kind === 'hub' ? topology.hubs : topology.sites).find((n) => n.id === router.id)
  const links = [
    ...topology.connections.filter((c) => (router.kind === 'hub' ? c.hubId : c.siteId) === router.id),
    ...(router.kind === 'site' ? topology.siteLinks.filter((l) => l.a === router.id || l.b === router.id) : []),
  ]
  const selectedConnection = links.some((link) => link.id === connectionId) ? connectionId : undefined
  const assignments = (node?.routeMapAssignments ?? []).filter((a) => !selectedConnection || a.connectionId === selectedConnection).flatMap((binding) => {
    const connection = topology.connections.find((c) => c.id === binding.connectionId)
    const peer = topology.siteLinks.find((l) => l.id === binding.connectionId)
    const link = connection ?? peer
    const other = connection
      ? (router.kind === 'hub' ? topology.sites.find((s) => s.id === connection.siteId) : topology.hubs.find((h) => h.id === connection.hubId))
      : topology.sites.find((s) => s.id === (peer?.a === router.id ? peer.b : peer?.a))
    const maps = (['inbound', 'outbound'] as const).flatMap((value) => {
      if (direction && direction !== value) return []
      const map = topology.routeMaps?.find((m) => m.id === binding[`${value}MapId`])
      return map ? [{ direction: value, map }] : []
    })
    return link && maps.length ? [{ link, other, maps }] : []
  })
  return <CanvasOverlay title={`Route map rules · ${node?.name ?? 'Router'}`} className="policy-inspector" onClose={onClose}>
    <p className="muted">Inbound means received by {node?.name}; outbound means advertised by it. Rules run in order; unmatched routes pass unchanged. Static VPN routes bypass BGP policies.</p>
    <div className="inspector-controls">
      <label className="field"><span>Connection</span><select aria-label="Policy connection" value={selectedConnection ?? ''} onChange={(e) => onConnection(e.target.value || undefined)}><option value="">All connections</option>{links.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}</select></label>
      <label className="field"><span>Policy direction</span><select aria-label="Policy direction" value={direction ?? 'all'} onChange={(e) => onDirection(e.target.value === 'all' ? undefined : e.target.value as RouteMapDirection)}><option value="all">Inbound and outbound</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option></select></label>
      <button onClick={() => onConfigure(router, selectedConnection)}>Configure route maps</button>
    </div>
    {assignments.map(({ link, other, maps }) => <section key={link.id} className="policy-connection" aria-label={`Policies on ${link.name}`}>
      <h3>{link.name}</h3><p className="muted">To {other?.name}{!link.enabled && ' · Connection down; policies are configured but inactive'}</p>
      {maps.map(({ direction, map }) => <section key={direction} className="policy-assignment" data-direction={direction} aria-label={`${direction === 'inbound' ? 'Inbound' : 'Outbound'} policy on ${link.name}`}>
        <h4><span className={`policy-tag ${direction}`}>{direction === 'inbound' ? 'IN' : 'OUT'}</span>{map.name}</h4>
        {map.rules.length ? <div className="table-scroll"><table aria-label={`Rules for ${map.name} on ${link.name}, ${direction}`}>
          <thead><tr><th scope="col">#</th><th scope="col">Match</th><th scope="col">Action</th><th scope="col">Then</th></tr></thead>
          <tbody>{map.rules.map((rule, index) => <tr key={rule.id}>
            <td>{index + 1}</td>
            <td>{!rule.prefixes.length ? 'All prefixes' : <>{rule.match === 'equals' ? 'Equals' : 'Contains (including more specific)'}{rule.prefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}</>}</td>
            <td><RuleAction rule={rule} /></td>
            <td>{rule.action === 'drop' ? 'Stop (drop)' : rule.nextStep === 'continue' ? 'Continue' : 'Stop'}</td>
          </tr>)}</tbody>
        </table></div> : <p className="muted">No rules; all routes pass unchanged.</p>}
      </section>)}
    </section>)}
    {!assignments.length && <p className="empty">No {direction ? `${direction} ` : ''}route maps assigned to {selectedConnection ? 'this connection' : 'this router'}.</p>}
  </CanvasOverlay>
}
