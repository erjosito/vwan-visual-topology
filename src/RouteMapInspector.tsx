import type { RouteMapDirection, RouterSelection, Topology } from './model'
import { CanvasOverlay } from './CanvasOverlay'
import { RouteMapRules } from './RouteMapRules'

export function RouteMapInspector({ topology, router, direction, connectionId, onDirection, onConnection, onConfigure, onClose }: {
  topology: Topology; router: RouterSelection; direction?: RouteMapDirection; connectionId?: string
  onDirection: (direction?: RouteMapDirection) => void; onConnection: (connectionId?: string) => void; onConfigure: (router: RouterSelection, connectionId?: string) => void; onClose: () => void
}) {
  const node = (router.kind === 'hub' ? topology.hubs : topology.sites).find((n) => n.id === router.id)
  const links = [
    ...topology.connections.filter((c) => (router.kind === 'hub' ? c.hubId : c.siteId) === router.id),
    ...(topology.erLinks ?? []).filter((link) => (router.kind === 'hub' ? link.hubId : link.siteId) === router.id),
    ...(router.kind === 'site' ? topology.siteLinks.filter((l) => l.a === router.id || l.b === router.id) : []),
  ]
  const selectedConnection = links.some((link) => link.id === connectionId) ? connectionId : undefined
  const assignments = (node?.routeMapAssignments ?? []).filter((a) => !selectedConnection || a.connectionId === selectedConnection).flatMap((binding) => {
    const connection = topology.connections.find((c) => c.id === binding.connectionId)
    const peer = topology.siteLinks.find((l) => l.id === binding.connectionId)
    const er = topology.erLinks?.find((link) => link.id === binding.connectionId)
    const link = connection ?? peer ?? er
    const other = connection
      ? (router.kind === 'hub' ? topology.sites.find((s) => s.id === connection.siteId) : topology.hubs.find((h) => h.id === connection.hubId))
      : er ? topology.erLocations?.find((location) => location.id === er.locationId) : topology.sites.find((s) => s.id === (peer?.a === router.id ? peer.b : peer?.a))
    const maps = (['inbound', 'outbound'] as const).flatMap((value) => {
      if (direction && direction !== value) return []
      const map = topology.routeMaps?.find((m) => m.id === binding[`${value}MapId`])
      return map ? [{ direction: value, map }] : []
    })
    return link && maps.length ? [{ link, other, maps }] : []
  })
  return <CanvasOverlay title={`Route map rules · ${node?.name ?? 'Router'}`} className="policy-inspector" onClose={onClose}>
    <p className="muted">Inbound means learned by {node?.name}; outbound means advertised by it. Rules run in order; unmatched routes pass unchanged. Static VPN routes bypass BGP policies.</p>
    <div className="inspector-controls">
      <label className="field"><span>Connection</span><select aria-label="Policy connection" value={selectedConnection ?? ''} onChange={(e) => onConnection(e.target.value || undefined)}><option value="">All connections</option>{links.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}</select></label>
      <label className="field"><span>Policy direction</span><select aria-label="Policy direction" value={direction ?? 'all'} onChange={(e) => onDirection(e.target.value === 'all' ? undefined : e.target.value as RouteMapDirection)}><option value="all">Inbound and outbound</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option></select></label>
      <button onClick={() => onConfigure(router, selectedConnection)}>Configure route maps</button>
    </div>
    {assignments.map(({ link, other, maps }) => <section key={link.id} className="policy-connection" aria-label={`Policies on ${link.name}`}>
      <h3>{link.name}</h3><p className="muted">To {other?.name}{!link.enabled && ' · Connection down; policies are configured but inactive'}</p>
      {maps.map(({ direction, map }) => <section key={direction} className="policy-assignment" data-direction={direction} aria-label={`${direction === 'inbound' ? 'Inbound' : 'Outbound'} policy on ${link.name}`}>
        <h4><span className={`policy-tag ${direction}`}>{direction === 'inbound' ? 'IN' : 'OUT'}</span>{map.name}</h4>
        <RouteMapRules map={map} label={`Rules for ${map.name} on ${link.name}, ${direction}`} />
      </section>)}
    </section>)}
    {!assignments.length && <p className="empty">No {direction ? `${direction} ` : ''}route maps assigned to {selectedConnection ? 'this connection' : 'this router'}.</p>}
  </CanvasOverlay>
}
