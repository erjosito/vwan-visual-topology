import { useState } from 'react'
import { CanvasOverlay } from '../CanvasOverlay'
import { MapDefinition } from '../RouteMapsPanel'
import type { RouteMap } from '../model'
import type { AzNetTopology } from './model'
import { azSitePolicyLinks, pruneAzSiteRouteMaps, validateAzSiteRouteMaps } from './route-maps'

export function SiteRouteMapsPanel({ topology, siteId, onSave, onClose }: {
  topology: AzNetTopology; siteId: string; onSave: (topology: AzNetTopology) => void; onClose: () => void
}) {
  const [mapId, setMapId] = useState('')
  const [draft, setDraft] = useState<RouteMap>()
  const [connectionId, setConnectionId] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const site = topology.sites.find((site) => site.id === siteId)
  if (!site) return null
  const maps = topology.routeMaps?.filter((map) => map.siteId === siteId) ?? []
  const map = draft ?? maps.find((map) => map.id === mapId)
  const links = azSitePolicyLinks(topology, siteId)
  const link = links.find((link) => link.id === connectionId) ?? links[0]
  const binding = site.routeMapAssignments?.find((assignment) => assignment.connectionId === link?.id)
  const commit = (next: AzNetTopology) => {
    validateAzSiteRouteMaps(next)
    onSave(next)
    setError('')
  }
  const assign = (direction: 'inboundMapId' | 'outboundMapId', id: string) => {
    try {
      if (!link) return
      const next = structuredClone(topology)
      const target = next.sites.find((site) => site.id === siteId)!
      const assignment = { ...binding, connectionId: link.id, [direction]: id || undefined }
      target.routeMapAssignments = [
        ...(target.routeMapAssignments ?? []).filter((assignment) => assignment.connectionId !== link.id),
        ...(assignment.inboundMapId || assignment.outboundMapId ? [assignment] : []),
      ]
      commit(next)
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid assignment.') }
  }
  return <CanvasOverlay title={`Route maps · ${site.name}`} className="route-map-panel" onClose={onClose}>
    <p className="muted">Policies belong to this site, with independent assignments on each connection. Inbound means learned by {site.name}; outbound means advertised by it. A shared map updates every assignment on this site. Unmatched routes are allowed.</p>
    <button onClick={() => {
      setDraft({ id: crypto.randomUUID(), name: 'New route map', siteId, rules: [] })
      setMapId(''); setConfirmDelete(false)
    }}>Create route map</button>
    {link && <section className="assignment-panel">
      <h3>Router connection policies</h3>
      <label className="field"><span>Connection</span><select aria-label="Route map connection" value={link.id} onChange={(event) => setConnectionId(event.target.value)}>
        {links.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}
      </select></label>
      <div className="form-grid">{(['inboundMapId', 'outboundMapId'] as const).map((direction) => <label className="field" key={direction}>
        <span>{direction === 'inboundMapId' ? `Inbound to ${site.name}` : `Outbound from ${site.name}`}</span>
        <select aria-label={direction === 'inboundMapId' ? 'Inbound route map' : 'Outbound route map'} value={binding?.[direction] ?? ''} disabled={!link.bgp} onChange={(event) => assign(direction, event.target.value)}>
          <option value="">None</option>{maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
        </select>
      </label>)}</div>
      {!link.bgp && <p className="notice">Static VPN routes bypass BGP route maps. Enable BGP on the connection and gateway to apply policies.</p>}
    </section>}
    {!links.length && <p className="notice">Connect this site to a gateway, ExpressRoute location, NVA or another site to assign policies.</p>}
    <div className="resource-list">{maps.map((map) => <button key={map.id} aria-pressed={!draft && map.id === mapId} onClick={() => { setMapId(map.id); setDraft(undefined); setConfirmDelete(false) }}>
      {map.name}<small>{map.rules.length} rules · {site.routeMapAssignments?.filter((assignment) => assignment.inboundMapId === map.id || assignment.outboundMapId === map.id).length ?? 0} connections</small>
    </button>)}</div>
    {map && <>
      {!draft && <p className="muted" data-route-map-attachments>Applied to: {site.routeMapAssignments?.flatMap((assignment) => {
        const directions = [assignment.inboundMapId === map.id ? 'Inbound' : '', assignment.outboundMapId === map.id ? 'Outbound' : ''].filter(Boolean)
        return directions.length ? [`${links.find((link) => link.id === assignment.connectionId)?.name ?? assignment.connectionId} (${directions.join(', ')})`] : []
      }).join(' · ') || 'No connections'}</p>}
      <MapDefinition key={map.id} map={map} onSave={(value) => {
        const next = structuredClone(topology)
        next.routeMaps = [...(next.routeMaps ?? []).filter((map) => map.id !== value.id), value]
        commit(next); setDraft(undefined); setMapId(value.id)
      }} />
      {!draft && <div className="delete-resource">{confirmDelete ? <>
        <p>Delete route map {map.name} and remove all of its connection assignments?</p>
        <button onClick={() => setConfirmDelete(false)}>Cancel deletion</button>
        <button className="danger" onClick={() => {
          const next = structuredClone(topology)
          next.routeMaps = next.routeMaps?.filter((entry) => entry.id !== map.id)
          pruneAzSiteRouteMaps(next)
          commit(next); setMapId(''); setConfirmDelete(false)
        }}>Confirm route map deletion</button>
      </> : <button className="danger" onClick={() => setConfirmDelete(true)}>Delete route map</button>}</div>}
    </>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <p className="muted">Uses the same ordered prefix matching, permit, drop, summarize and AS-path prepend rules as VWAN site policies. Site policies accept private and 32-bit ASNs. Summaries do not create reachability in aggregate holes. Azure Route Server policies are a separate feature.</p>
  </CanvasOverlay>
}
