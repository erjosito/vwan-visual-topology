import { useState } from 'react'
import { CanvasOverlay } from '../CanvasOverlay'
import { MapDefinition } from '../RouteMapsPanel'
import type { RouteMap, RouteMapDirection } from '../model'
import type { AzAppliance, AzNetTopology } from './model'
import { parseAsPath } from '../validation'
import { azSitePolicyLinks, pruneAzSiteRouteMaps, validateAzSiteRouteMaps } from './route-maps'
import { azArsPolicyLinks, azArsSpokes, parseArsPrependAsPath, parseBgpCommunities, pruneAzArsRouteMaps, validateAzArsRouteMaps } from './ars-route-maps'
import { BgpRouteTable } from './BgpRouteTable'
import type { AzBgpRibEntry } from './engine'

function PeerRouteAttributes({ app, onSave }: { app: AzAppliance; onSave: (attributes: AzAppliance['advertisedRouteAttributes']) => void }) {
  const [error, setError] = useState('')
  if (!app.advertisedPrefixes?.length) return null
  return <details><summary>Advertised route attributes · {app.name}</summary>
    <p className="muted">AS-path suffixes follow the peer ASN. These are source advertisements, before inbound ARS policies.</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      try {
        const data = new FormData(event.currentTarget)
        onSave(app.advertisedPrefixes!.map((prefix, index) => ({
          prefix, asPath: parseAsPath(String(data.get(`path-${index}`) ?? '')),
          communities: parseBgpCommunities(String(data.get(`communities-${index}`) ?? '')),
        })))
        setError('')
      } catch (error) { setError(error instanceof Error ? error.message : 'Invalid route attributes.') }
    }}>
      {app.advertisedPrefixes.map((prefix, index) => {
        const attributes = app.advertisedRouteAttributes?.find((attributes) => attributes.prefix === prefix)
        return <fieldset key={prefix}><legend>{prefix}</legend>
          <label className="field"><span>AS-path suffix</span><input name={`path-${index}`} aria-label={`${app.name} ${prefix} AS-path suffix`} defaultValue={attributes?.asPath?.join(' ') ?? ''} /></label>
          <label className="field"><span>Communities</span><input name={`communities-${index}`} aria-label={`${app.name} ${prefix} communities`} defaultValue={attributes?.communities?.join(' ') ?? ''} /></label>
        </fieldset>
      })}
      <button>Save peer route attributes</button>
      {error && <p role="alert" className="notice error">{error}</p>}
    </form>
  </details>
}

export function AzRouteMapsPanel({ topology, siteId, routeServerId, inbound, outbound, initialConnectionId, initialDirection, onSave, onClose }: {
  topology: AzNetTopology; siteId?: string; routeServerId?: string;
  inbound?: Record<string, AzBgpRibEntry[]>; outbound?: Record<string, AzBgpRibEntry[]>;
  initialConnectionId?: string; initialDirection?: RouteMapDirection;
  onSave: (topology: AzNetTopology) => void; onClose: () => void
}) {
  const arsVnet = topology.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)
  const ars = routeServerId ? arsVnet?.routeServer : undefined
  const site = ars ?? topology.sites.find((site) => site.id === siteId)
  const [mapId, setMapId] = useState(() => initialDirection
    ? site?.routeMapAssignments?.find((assignment) => assignment.connectionId === initialConnectionId)?.[`${initialDirection}MapId`] ?? ''
    : '')
  const [draft, setDraft] = useState<RouteMap>()
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? '')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!site) return null
  const maps = ars ? ars.routeMaps ?? [] : topology.routeMaps?.filter((map) => map.siteId === siteId) ?? []
  const map = draft ?? maps.find((map) => map.id === mapId)
  const links = ars && arsVnet ? azArsPolicyLinks(arsVnet, topology) : azSitePolicyLinks(topology, site.id)
  const link = links.find((link) => link.id === connectionId) ?? links[0]
  const binding = site.routeMapAssignments?.find((assignment) => assignment.connectionId === link?.id)
  const commit = (next: AzNetTopology) => {
    if (ars) validateAzArsRouteMaps(next)
    else validateAzSiteRouteMaps(next)
    onSave(next)
    setError('')
  }
  const assign = (direction: 'inboundMapId' | 'outboundMapId', id: string) => {
    try {
      if (!link) return
      const next = structuredClone(topology)
      const target = ars ? next.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)!.routeServer!
        : next.sites.find((site) => site.id === siteId)!
      const assignment = { ...binding, connectionId: link.id, [direction]: id || undefined }
      target.routeMapAssignments = [
        ...(target.routeMapAssignments ?? []).filter((assignment) => assignment.connectionId !== link.id),
        ...(assignment.inboundMapId || assignment.outboundMapId ? [assignment] : []),
      ]
      commit(next)
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid assignment.') }
  }
  return <CanvasOverlay title={`Route maps · ${site.name}`} className="route-map-panel" onClose={onClose}>
    <p className="muted">Policies belong to this {ars ? 'Azure Route Server' : 'site'}, with independent assignments on each connection. Inbound means learned by {site.name}; outbound means advertised by it. Unmatched routes are allowed.</p>
    {ars && arsVnet && <details><summary>BGP peers (local or gateway-transit peered spokes)</summary>
      <p className="muted">Remote NVA policies belong to the spoke virtual network connection, not a local BGP-peer association. Enabling a peering here does not create virtual network peering or packet connectivity.</p>
      {[arsVnet, ...azArsSpokes(arsVnet, topology).map((spoke) => spoke.vnet)].flatMap((host) => host.appliances.filter((app) => app.bgpEnabled).map((app) => <div key={app.id}><label className="aznet-hover-toggle">
        <input type="checkbox" aria-label={`BGP peer ${host.name} / ${app.name}`}
          checked={ars.peerApplianceIds.includes(app.id)} disabled={!ars.peerApplianceIds.includes(app.id) && ars.peerApplianceIds.length >= 8}
          onChange={(event) => {
            try {
              const next = structuredClone(topology)
              const target = next.vnets.find((vnet) => vnet.id === arsVnet.id)!.routeServer!
              target.peerApplianceIds = event.target.checked ? [...target.peerApplianceIds, app.id] : target.peerApplianceIds.filter((id) => id !== app.id)
              pruneAzArsRouteMaps(next); commit(next)
            } catch (error) { setError(error instanceof Error ? error.message : 'Invalid BGP peer.') }
          }} />{host.name} / {app.name}
      </label><PeerRouteAttributes app={app} onSave={(attributes) => {
        const next = structuredClone(topology)
        next.vnets.find((vnet) => vnet.id === host.id)!.appliances.find((peer) => peer.id === app.id)!.advertisedRouteAttributes = attributes
        commit(next)
      }} /></div>))}
    </details>}
    <button onClick={() => {
      setDraft({ id: crypto.randomUUID(), name: 'New route map', ...(ars ? {} : { siteId }), rules: [] })
      setMapId(''); setConfirmDelete(false)
    }}>Create route map</button>
    {link && <section className="assignment-panel">
      <h3>Router connection policies</h3>
      <label className="field"><span>Connection</span><select aria-label="Route map connection" value={link.id} onChange={(event) => setConnectionId(event.target.value)}>
        {links.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}
      </select></label>
      <div className="form-grid">{(['inboundMapId', 'outboundMapId'] as const).map((direction) => <label className="field" key={direction}>
        <span>{direction === 'inboundMapId' ? `Inbound to ${site.name}` : `Outbound from ${site.name}`}</span>
        <select aria-label={direction === 'inboundMapId' ? 'Inbound route map' : 'Outbound route map'} autoFocus={direction === `${initialDirection}MapId`} value={binding?.[direction] ?? ''} disabled={!link.bgp} onChange={(event) => assign(direction, event.target.value)}>
          <option value="">None</option>{maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
        </select>
      </label>)}</div>
      {!link.bgp && <p className="notice">{ars ? 'Enable BGP on this peer or gateway to exchange BGP routes.' : 'Static VPN routes bypass BGP route maps. Enable BGP on the connection and gateway to apply policies.'}</p>}
    </section>}
    {!links.length && <p className="notice">{ars ? 'Add a local NVA BGP peer or gateway to assign ARS policies.' : 'Connect this site to a gateway, ExpressRoute location, NVA or another site to assign policies.'}</p>}
    <div className="resource-list">{maps.map((map) => <button key={map.id} aria-pressed={!draft && map.id === mapId} onClick={() => { setMapId(map.id); setDraft(undefined); setConfirmDelete(false) }}>
      {map.name}<small>{map.rules.length} rules · {site.routeMapAssignments?.filter((assignment) => assignment.inboundMapId === map.id || assignment.outboundMapId === map.id).length ?? 0} connections</small>
    </button>)}</div>
    {map && <>
      {!draft && <p className="muted" data-route-map-attachments>Applied to: {site.routeMapAssignments?.flatMap((assignment) => {
        const directions = [assignment.inboundMapId === map.id ? 'Inbound' : '', assignment.outboundMapId === map.id ? 'Outbound' : ''].filter(Boolean)
        return directions.length ? [`${links.find((link) => link.id === assignment.connectionId)?.name ?? assignment.connectionId} (${directions.join(', ')})`] : []
      }).join(' · ') || 'No connections'}</p>}
      <MapDefinition key={map.id} map={map} advanced={!!ars} parsePrepend={ars ? parseArsPrependAsPath : undefined} onSave={(value) => {
        const next = structuredClone(topology)
        if (ars) {
          const target = next.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)!.routeServer!
          target.routeMaps = [...(target.routeMaps ?? []).filter((map) => map.id !== value.id), value]
        } else next.routeMaps = [...(next.routeMaps ?? []).filter((map) => map.id !== value.id), value]
        commit(next); setDraft(undefined); setMapId(value.id)
      }} />
      {!draft && <div className="delete-resource">{confirmDelete ? <>
        <p>Delete route map {map.name} and remove all of its connection assignments?</p>
        <button onClick={() => setConfirmDelete(false)}>Cancel deletion</button>
        <button className="danger" onClick={() => {
          const next = structuredClone(topology)
          if (ars) {
            const target = next.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)!.routeServer!
            target.routeMaps = target.routeMaps?.filter((entry) => entry.id !== map.id)
          } else next.routeMaps = next.routeMaps?.filter((entry) => entry.id !== map.id)
          pruneAzSiteRouteMaps(next)
          pruneAzArsRouteMaps(next)
          commit(next); setMapId(''); setConfirmDelete(false)
        }}>Confirm route map deletion</button>
      </> : <button className="danger" onClick={() => setConfirmDelete(true)}>Delete route map</button>}</div>}
    </>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {ars && link && inbound && <details data-testid="aznet-policy-inbound"><summary>Inbound routes after route maps</summary>
      <BgpRouteTable key={link.id} entries={inbound[link.id] ?? []} available={ars.enabled} />
    </details>}
    {ars && link && outbound && <details open data-testid="aznet-policy-outbound"><summary>Outbound advertisements after route maps</summary>
      <BgpRouteTable key={link.id} entries={outbound[link.id] ?? []} available={ars.enabled} />
    </details>}
    <p className="muted">{ars
      ? 'ARS maps support prefix, AS-path and community conditions combined with AND; AS-path add/replace/clear; community add/replace/remove/clear; and summarization with attribute stripping. Only 2-byte ASNs are supported; modifications exclude Azure-reserved ASNs and preserve Azure-reserved communities. Inbound policies precede ARS selection. Outbound policies change advertisements only. Peered-spoke policies require allowGatewayTransit/useRemoteGateways and no local gateway/ARS in the spoke. Local On-link routes remain even when propagation is filtered. ARS own-VNet advertisements stay protected. Private ASNs are stripped over ExpressRoute. Policies are not packet ACLs and do not fill aggregate holes.'
      : 'Uses the same ordered prefix matching, permit, drop, summarize and AS-path prepend rules as VWAN site policies. Site policies accept private and 32-bit ASNs. Summaries do not create reachability in aggregate holes.'}
      {ars && <> <a href="https://learn.microsoft.com/azure/route-server/route-maps-about" target="_blank" rel="noreferrer">Microsoft ARS route-map capabilities and limits</a></>}
    </p>
  </CanvasOverlay>
}
