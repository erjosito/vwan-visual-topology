import { useState } from 'react'
import { t } from '../i18n'
import { CanvasOverlay } from '../CanvasOverlay'
import { MapDefinition } from '../RouteMapsPanel'
import type { RouteMap, RouteMapDirection } from '../model'
import type { AzAppliance, AzNetTopology } from './model'
import { parseAsPath } from '../validation'
import { azHubPolicyLinks, azSitePolicyLinks, pruneAzSiteRouteMaps, validateAzSiteRouteMaps } from './route-maps'
import { ARS_MAX_BGP_PEERS, azArsPeerHosts, azArsPolicyLinks, parseArsPrependAsPath, parseBgpCommunities, pruneAzArsRouteMaps, validateAzArsRouteMaps } from './ars-route-maps'
import { BgpRouteTable } from './BgpRouteTable'
import type { AzBgpRibEntry } from './engine'

export function PeerRouteAttributes({ app, onSave }: { app: AzAppliance; onSave: (attributes: AzAppliance['advertisedRouteAttributes']) => void }) {
  const [error, setError] = useState('')
  if (!app.advertisedPrefixes?.length) return null
  return <details><summary>{t('Advertised route attributes · {0}', app.name)}</summary>
    <p className="muted">{t('AS-path suffixes follow the peer ASN. These are source advertisements, before inbound ARS policies.')}</p>
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
          <label className="field"><span>{t('AS-path suffix')}</span><input name={`path-${index}`} aria-label={`${app.name} ${prefix} ${t('AS-path suffix')}`} defaultValue={attributes?.asPath?.join(' ') ?? ''} /></label>
          <label className="field"><span>{t('Communities')}</span><input name={`communities-${index}`} aria-label={`${app.name} ${prefix} ${t('Communities').toLowerCase()}`} defaultValue={attributes?.communities?.join(' ') ?? ''} /></label>
        </fieldset>
      })}
      <button>{t('Save peer route attributes')}</button>
      {error && <p role="alert" className="notice error">{error}</p>}
    </form>
  </details>
}

export function AzRouteMapsPanel({ topology, siteId, hubId, routeServerId, inbound, outbound, initialConnectionId, initialDirection, onSave, onClose }: {
  topology: AzNetTopology; siteId?: string; hubId?: string; routeServerId?: string;
  inbound?: Record<string, AzBgpRibEntry[]>; outbound?: Record<string, AzBgpRibEntry[]>;
  initialConnectionId?: string; initialDirection?: RouteMapDirection;
  onSave: (topology: AzNetTopology) => boolean | void; onClose: () => void
}) {
  const arsVnet = topology.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)
  const ars = routeServerId ? arsVnet?.routeServer : undefined
  const hub = topology.vwanHubs.find((hub) => hub.id === hubId)
  const site = ars ?? hub ?? topology.sites.find((site) => site.id === siteId)
  const [mapId, setMapId] = useState(() => initialDirection
    ? site?.routeMapAssignments?.find((assignment) => assignment.connectionId === initialConnectionId)?.[`${initialDirection}MapId`] ?? ''
    : '')
  const [draft, setDraft] = useState<RouteMap>()
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? '')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!site) return null
  const maps = ars ? ars.routeMaps ?? [] : topology.routeMaps?.filter((map) => hub ? map.hubId === hubId : map.siteId === siteId) ?? []
  const map = draft ?? maps.find((map) => map.id === mapId)
  const links = ars && arsVnet ? azArsPolicyLinks(arsVnet, topology) : hub ? azHubPolicyLinks(topology, hub.id) : azSitePolicyLinks(topology, site.id)
  const link = links.find((link) => link.id === connectionId) ?? links[0]
  const binding = site.routeMapAssignments?.find((assignment) => assignment.connectionId === link?.id)
  const commit = (next: AzNetTopology) => {
    if (ars) validateAzArsRouteMaps(next)
    else validateAzSiteRouteMaps(next)
    if (onSave(next) === false) throw new Error(t('Route map changes were not applied. Review the workspace notice.'))
    setError('')
  }
  const assign = (direction: 'inboundMapId' | 'outboundMapId', id: string) => {
    try {
      if (!link) return
      const next = structuredClone(topology)
      const target = ars ? next.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)!.routeServer!
        : hub ? next.vwanHubs.find((hub) => hub.id === hubId)! : next.sites.find((site) => site.id === siteId)!
      const assignment = { ...binding, connectionId: link.id, [direction]: id || undefined }
      target.routeMapAssignments = [
        ...(target.routeMapAssignments ?? []).filter((assignment) => assignment.connectionId !== link.id),
        ...(assignment.inboundMapId || assignment.outboundMapId ? [assignment] : []),
      ]
      commit(next)
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid assignment.') }
  }
  return <CanvasOverlay title={t('Route maps · {0}', site.name)} className="route-map-panel" onClose={onClose}>
    <p className="muted">{t('Policies belong to this {0}, with independent assignments on each connection. Inbound means learned by {1}; outbound means advertised by it. Unmatched routes are allowed.', t(ars ? 'Azure Route Server' : hub ? 'Virtual WAN hub' : 'site'), site.name)}</p>
    {ars && arsVnet && <details><summary>{t('BGP peers (local or directly peered VNets)')}</summary>
      <p className="muted">{t('BGP peering requires VNet access, not gateway transit. Injecting routes into spokes still requires gateway-transit settings. Remote policy assignments remain limited to eligible spoke virtual network connections. Enabling a BGP peer here does not create VNet peering or packet connectivity.')}</p>
      {azArsPeerHosts(arsVnet, topology).flatMap((host) => host.appliances.filter((app) => app.bgpEnabled).map((app) => <div key={app.id}><label className="aznet-hover-toggle">
        <input type="checkbox" aria-label={t('BGP peer {0} / {1}', host.name, app.name)}
          checked={ars.peerApplianceIds.includes(app.id)} disabled={!ars.peerApplianceIds.includes(app.id) && ars.peerApplianceIds.length >= ARS_MAX_BGP_PEERS}
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
      setDraft({ id: crypto.randomUUID(), name: t('New route map'), ...(ars ? {} : hub ? { hubId } : { siteId }), rules: [] })
      setMapId(''); setConfirmDelete(false)
    }}>{t('Create route map')}</button>
    {link && <section className="assignment-panel">
      <h3>{t('Router connection policies')}</h3>
      <p className="muted">{t('Connection assignments apply immediately to this workspace. Saving a definition is a separate action.')}</p>
      <label className="field"><span>{t('Connection')}</span><select aria-label={t('Route map connection')} value={link.id} onChange={(event) => setConnectionId(event.target.value)}>
        {links.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}
      </select></label>
      <div className="form-grid">{(['inboundMapId', 'outboundMapId'] as const).map((direction) => <label className="field" key={direction}>
        <span>{t(direction === 'inboundMapId' ? 'Inbound to {0}' : 'Outbound from {0}', site.name)}</span>
        <select aria-label={t(direction === 'inboundMapId' ? 'Inbound route map' : 'Outbound route map')} autoFocus={direction === `${initialDirection}MapId`} value={binding?.[direction] ?? ''} disabled={!link.bgp} onChange={(event) => assign(direction, event.target.value)}>
          <option value="">{t('None')}</option>{maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
        </select>
      </label>)}</div>
      {!link.bgp && <p className="notice">{t(ars ? 'Enable BGP on this peer or gateway to exchange BGP routes.' : hub ? 'Hub route maps are unsupported on integrated SD-WAN and static VPN connections.' : 'Static VPN routes bypass BGP route maps. Enable BGP on the connection and gateway to apply policies.')}</p>}
    </section>}
    {!links.length && <p className="notice">{t(ars ? 'Add a local NVA BGP peer or gateway to assign ARS policies.' : 'Connect this site to a gateway, ExpressRoute location, NVA or another site to assign policies.')}</p>}
    <div className="resource-list">{maps.map((map) => <button key={map.id} aria-pressed={!draft && map.id === mapId} onClick={() => { setMapId(map.id); setDraft(undefined); setConfirmDelete(false) }}>
      {map.name}<small>{t('{0} rules · {1} connections', map.rules.length, site.routeMapAssignments?.filter((assignment) => assignment.inboundMapId === map.id || assignment.outboundMapId === map.id).length ?? 0)}</small>
    </button>)}</div>
    {map && <>
      {!draft && <p className="muted" data-route-map-attachments>{t('Applied to:')}{' '}{site.routeMapAssignments?.flatMap((assignment) => {
        const directions = [assignment.inboundMapId === map.id ? t('Inbound') : '', assignment.outboundMapId === map.id ? t('Outbound') : ''].filter(Boolean)
        return directions.length ? [`${links.find((link) => link.id === assignment.connectionId)?.name ?? assignment.connectionId} (${directions.join(', ')})`] : []
      }).join(' · ') || t('No connections')}</p>}
      <MapDefinition key={map.id} map={map} isNew={!!draft} advanced={!!ars} asPathMatching={!ars} siteLocalPreference={!ars && !hub} parsePrepend={ars ? parseArsPrependAsPath : undefined} onSave={(value) => {
        const next = structuredClone(topology)
        if (ars) {
          const target = next.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)!.routeServer!
          target.routeMaps = [...(target.routeMaps ?? []).filter((map) => map.id !== value.id), value]
        } else next.routeMaps = [...(next.routeMaps ?? []).filter((map) => map.id !== value.id), value]
        commit(next); setDraft(undefined); setMapId(value.id)
      }} />
      {!draft && <div className="delete-resource">{confirmDelete ? <>
        <p>{t('Delete route map {0} and remove all of its connection assignments?', map.name)}</p>
        <button onClick={() => setConfirmDelete(false)}>{t('Cancel deletion')}</button>
        <button className="danger" onClick={() => {
          const next = structuredClone(topology)
          if (ars) {
            const target = next.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)!.routeServer!
            target.routeMaps = target.routeMaps?.filter((entry) => entry.id !== map.id)
          } else next.routeMaps = next.routeMaps?.filter((entry) => entry.id !== map.id)
          pruneAzSiteRouteMaps(next)
          pruneAzArsRouteMaps(next)
          commit(next); setMapId(''); setConfirmDelete(false)
        }}>{t('Confirm route map deletion')}</button>
      </> : <button className="danger" onClick={() => setConfirmDelete(true)}>{t('Delete route map')}</button>}</div>}
    </>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {ars && link && inbound && <details data-testid="aznet-policy-inbound"><summary>{t('Inbound routes after route maps')}</summary>
      <BgpRouteTable key={link.id} entries={inbound[link.id] ?? []} available={ars.enabled} />
    </details>}
    {ars && link && outbound && <details open data-testid="aznet-policy-outbound"><summary>{t('Outbound advertisements after route maps')}</summary>
      <BgpRouteTable key={link.id} entries={outbound[link.id] ?? []} available={ars.enabled} />
    </details>}
    <p className="muted">{t('Policies change route advertisements, not packet ACLs. Summaries do not make aggregate holes reachable.')}</p>
    <details><summary>{t('Route-map behavior and limits')}</summary><p className="muted">{t(ars
      ? 'ARS maps support prefix, AS-path and community conditions combined with AND; AS-path add/replace/clear; community add/replace/remove/clear; and summarization with attribute stripping. Only 2-byte ASNs are supported; modifications exclude Azure-reserved ASNs and preserve Azure-reserved communities. Inbound policies precede ARS selection. Outbound policies change advertisements only. Peered-spoke policies require allowGatewayTransit/useRemoteGateways and no local gateway/ARS in the spoke. Local On-link routes remain even when propagation is filtered. ARS own-VNet advertisements stay protected. Private ASNs are stripped over ExpressRoute. Policies are not packet ACLs and do not fill aggregate holes.'
      : hub ? 'Hub prepend rules use non-private 2-byte ASNs, excluding Azure-reserved ASNs and AS_TRANS. Documentation ASNs are available for simulation, not production ASN guidance. VNet connection policies include spoke NVA advertisements; inter-hub policies are not simulated.'
      : 'Uses the same ordered prefix matching, permit, drop, summarize and AS-path prepend rules as VWAN site policies. Site policies accept private and 32-bit ASNs. Summaries do not create reachability in aggregate holes.')}
      {ars && <> <a href="https://learn.microsoft.com/azure/route-server/route-maps-about" target="_blank" rel="noreferrer">{t('Microsoft ARS route-map capabilities and limits')}</a></>}
    </p></details>
  </CanvasOverlay>
}
