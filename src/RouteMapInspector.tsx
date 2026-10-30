import { t } from './i18n'
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
  return <CanvasOverlay title={t("Route map rules · {0}", node?.name ?? t('Router'))} className="policy-inspector" onClose={onClose}>
    <p className="muted">{t("Inbound means learned by")} {node?.name}{t("; outbound means advertised by it. Rules run in order; unmatched routes pass unchanged. Static VPN routes bypass BGP policies.")}</p>
    <div className="inspector-controls">
      <label className="field"><span>{t("Connection")}</span><select aria-label={t("Policy connection")} value={selectedConnection ?? ''} onChange={(e) => onConnection(e.target.value || undefined)}><option value="">{t("All connections")}</option>{links.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}</select></label>
      <label className="field"><span>{t("Policy direction")}</span><select aria-label={t("Policy direction")} value={direction ?? 'all'} onChange={(e) => onDirection(e.target.value === 'all' ? undefined : e.target.value as RouteMapDirection)}><option value="all">{t("Inbound and outbound")}</option><option value="inbound">{t("Inbound only")}</option><option value="outbound">{t("Outbound only")}</option></select></label>
      <button onClick={() => onConfigure(router, selectedConnection)}>{t("Configure route maps")}</button>
    </div>
    {assignments.map(({ link, other, maps }) => <section key={link.id} className="policy-connection" aria-label={t("Policies on {0}", link.name)}>
      <h3>{link.name}</h3><p className="muted">{t("To")} {other?.name}{!link.enabled && t(" · Connection down; policies are configured but inactive")}</p>
      {maps.map(({ direction, map }) => <section key={direction} className="policy-assignment" data-direction={direction} aria-label={t("{0} policy on {1}", t(direction === 'inbound' ? 'Inbound' : 'Outbound'), link.name)}>
        <h4><span className={`policy-tag ${direction}`}>{t(direction === 'inbound' ? 'IN' : 'OUT')}</span>{map.name}</h4>
        <RouteMapRules map={map} label={t("Rules for {0} on {1}, {2}", map.name, link.name, t(direction))} />
      </section>)}
    </section>)}
    {!assignments.length && <p className="empty">{t('No {0}route maps assigned to {1}.', direction ? `${t(direction)} ` : '', selectedConnection ? t("this connection") : t("this router"))}</p>}
  </CanvasOverlay>
}
