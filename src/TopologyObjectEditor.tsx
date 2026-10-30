import { t, localizeDiagnostic } from './i18n'
import { cloneElement, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { objectLabels, preferenceLabels, topologyObject, transportLabels } from './model'
import type { ObjectKind, ObjectSelection, Preference, RouterSelection, Topology, Transport } from './model'
import { parseAsPath, validateTopology } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

export interface EditorRequest { kind: ObjectKind; id?: string; hubId?: string; siteId?: string; locationId?: string; deleting?: boolean }

function Field({ title, children }: { title: string; children: ReactElement<{ 'aria-label'?: string }> }) {
  return <label className="field"><span>{title}</span>{cloneElement(children, { 'aria-label': title })}</label>
}

const prefixes = (value: string) => value.trim() === '*' ? [] : value.split(/[,\s]+/).filter(Boolean)

export function TopologyObjectEditor({ topology, request, onSave, onClose, onRouteMaps, onStaticRouting }: {
  topology: Topology; request: EditorRequest; onSave: (next: Topology, selection: ObjectSelection) => void; onClose: () => void; onRouteMaps: (router: RouterSelection) => void; onStaticRouting: (router: RouterSelection) => void
}) {
  const [error, setError] = useState('')
  const item = request.id ? topologyObject(topology, { kind: request.kind, id: request.id }) : undefined
  const hub = topology.hubs.find((h) => h.id === request.id)
  const spoke = topology.spokes.find((s) => s.id === request.id)
  const site = topology.sites.find((s) => s.id === request.id)
  const connection = topology.connections.find((c) => c.id === request.id)
  const erLink = topology.erLinks?.find((link) => link.id === request.id)
  const [erEndpoint, setErEndpoint] = useState<'hub' | 'site'>(erLink?.siteId || request.siteId ? 'site' : 'hub')
  const [transportValue, setTransportValue] = useState<Transport>(connection?.transport ?? 'ExpressRoute')
  const link = topology.siteLinks.find((l) => l.id === request.id)
  const label = t(objectLabels[request.kind])
  const connectedSite = request.kind === 'site' && !item && !!request.hubId
  const title = request.deleting ? t("Delete {0}", label) : t(item ? 'Edit {0}' : 'Add {0}', connectedSite ? t('connected site') : label)

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const next = structuredClone(topology)
      const id = request.id ?? crypto.randomUUID()
      if (request.id && !item) throw new Error('This object no longer exists.')
      if (request.deleting) {
        if (request.kind === 'hub') {
          next.hubs = next.hubs.filter((h) => h.id !== id)
          next.spokes = next.spokes.filter((s) => s.hubId !== id)
          next.connections = next.connections.filter((c) => c.hubId !== id)
          next.erLinks = next.erLinks?.filter((link) => link.hubId !== id)
          next.routeMaps = next.routeMaps?.filter((m) => m.hubId !== id)
        } else if (request.kind === 'site') {
          next.sites = next.sites.filter((s) => s.id !== id)
          next.connections = next.connections.filter((c) => c.siteId !== id)
          next.siteLinks = next.siteLinks.filter((l) => l.a !== id && l.b !== id)
          next.erLinks = next.erLinks?.filter((link) => link.siteId !== id)
          next.routeMaps = next.routeMaps?.filter((map) => map.siteId !== id)
        } else if (request.kind === 'spoke') next.spokes = next.spokes.filter((s) => s.id !== id)
        else if (request.kind === 'connection') next.connections = next.connections.filter((c) => c.id !== id)
        else if (request.kind === 'erLocation') {
          next.erLocations = next.erLocations?.filter((location) => location.id !== id)
          next.erLinks = next.erLinks?.filter((link) => link.locationId !== id)
        } else if (request.kind === 'erLink') next.erLinks = next.erLinks?.filter((link) => link.id !== id)
        else next.siteLinks = next.siteLinks.filter((l) => l.id !== id)
        const remaining = new Set([...next.connections, ...next.siteLinks, ...(next.erLinks ?? [])].map((link) => link.id))
        for (const router of [...next.hubs, ...next.sites]) {
          if (router.routeMapAssignments) router.routeMapAssignments = router.routeMapAssignments.filter((a) => remaining.has(a.connectionId))
        }
        for (const site of next.sites) {
          if (site.vpnStaticRoutes) site.vpnStaticRoutes = site.vpnStaticRoutes.filter((r) => remaining.has(r.connectionId))
        }
      } else {
        const data = new FormData(event.currentTarget)
        const text = (name: string) => String(data.get(name) ?? '').trim()
        const name = text('name')
        if (request.kind === 'hub') {
          const value = {
            ...hub, id, name, region: text('region'), preference: text('preference') as Preference,
            routingIntent: { private: data.has('privateIntent'), internet: data.has('internetIntent'), privatePrefixes: prefixes(text('privatePrefixes')) },
          }
          if (hub) next.hubs[next.hubs.findIndex((h) => h.id === id)] = value
          else next.hubs.push(value)
        } else if (request.kind === 'spoke') {
          const value = { id, name, hubId: text('hub'), prefixes: prefixes(text('prefixes')) }
          if (spoke) next.spokes[next.spokes.findIndex((s) => s.id === id)] = value
          else next.spokes.push(value)
        } else if (request.kind === 'site') {
          const value = { ...site, id, name, asn: Number(text('asn')), prefixes: text('prefix') ? [text('prefix')] : [] }
          if (site) next.sites[next.sites.findIndex((s) => s.id === id)] = value
          else next.sites.push(value)
          if (connectedSite) next.connections.push({
            id: crypto.randomUUID(), name: text('connectionName') || `${name} connection`, hubId: request.hubId!, siteId: id,
            transport: text('transport') as Transport, enabled: true, routes: [], inbound: [], outbound: [], learnSiteRoutes: true,
          })
        } else if (request.kind === 'connection') {
          const value = {
            ...(connection ?? { id, routes: [], inbound: [], outbound: [] }),
            name, hubId: text('hub'), siteId: text('site'), transport: text('transport') as Transport,
            enabled: data.has('enabled'), learnSiteRoutes: data.has('learnSiteRoutes'),
          }
          if (connection) next.connections[next.connections.findIndex((c) => c.id === id)] = value
          else next.connections.push(value)
        } else if (request.kind === 'erLocation') {
          next.erLocations ??= []
          const index = next.erLocations.findIndex((location) => location.id === id)
          if (index < 0) next.erLocations.push({ id, name })
          else next.erLocations[index] = { id, name }
        } else if (request.kind === 'erLink') {
          const routes = erEndpoint === 'site' ? text('advertisements').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
            const [prefix, ...path] = line.trim().split(/\s+/)
            return { id: erLink?.routes[index]?.id ?? crypto.randomUUID(), prefix, asPath: parseAsPath(path.join(' ')), kind: 'bgp' as const }
          }) : []
          const value = { id, name, locationId: text('location'), enabled: data.has('enabled'),
            ...(erEndpoint === 'hub' ? { hubId: text('endpoint') } : { siteId: text('endpoint') }),
            routes, learnSiteRoutes: erEndpoint === 'site' && data.has('learnSiteRoutes') }
          next.erLinks ??= []
          const index = next.erLinks.findIndex((link) => link.id === id)
          if (index < 0) next.erLinks.push(value)
          else next.erLinks[index] = value
        } else {
          const policy = (direction: string) => ({
            prefixes: prefixes(text(`${direction}Prefixes`)), prepend: parseAsPath(text(`${direction}Prepend`)),
            receivePrepend: parseAsPath(text(`${direction}Receive`)),
          })
          const value = { id, name, a: text('a'), b: text('b'), enabled: data.has('enabled'), aToB: policy('aToB'), bToA: policy('bToA') }
          if (link) next.siteLinks[next.siteLinks.findIndex((l) => l.id === id)] = value
          else next.siteLinks.push(value)
        }
      }
      onSave(validateTopology(next), { kind: request.kind, id })
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid input.') }
  }
  const hubOptions = topology.hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)
  const siteOptions = topology.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
  const transport = <Field title={t("Transport")}><select name="transport" value={transportValue} onChange={(event) => setTransportValue(event.target.value as Transport)}>{Object.entries(transportLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
  const removedSpokes = topology.spokes.filter((s) => s.hubId === request.id).length
  const removedConnections = topology.connections.filter((c) => request.kind === 'hub' ? c.hubId === request.id : c.siteId === request.id).length
  const removedPeers = topology.siteLinks.filter((l) => l.a === request.id || l.b === request.id).length

  return <CanvasOverlay title={title} className="object-editor" onClose={onClose}>
    <form onSubmit={save}>
      {request.deleting ? <>
        <p>{t("Delete")} <strong>{item?.name}</strong>{t("? This cannot be undone. Export JSON first if you need a backup.")}</p>
        {request.kind === 'hub' && <p>{t('This also removes {0} attached spoke{1} and {2} connection{3}. On-premises sites are kept.', removedSpokes, removedSpokes === 1 ? '' : 's', removedConnections, removedConnections === 1 ? '' : 's')}</p>}
        {request.kind === 'site' && <p>{t('This also removes {0} hub connection{1} and {2} on-premises link{3}.', removedConnections, removedConnections === 1 ? '' : 's', removedPeers, removedPeers === 1 ? '' : 's')}</p>}
        {(request.kind === 'hub' || request.kind === 'site' || request.kind === 'erLocation') && <p>{t("Attached ER connections are also removed; the other endpoints are kept.")}</p>}
      </> : <>
        <Field title={t("Name")}><input name="name" required maxLength={120} defaultValue={item?.name ?? ''} autoFocus /></Field>
        {request.kind === 'erLocation' && <p className="muted">{t("An ExpressRoute peering location groups site circuit attachments and their hub connections. Connect sites and hubs after creating it. ER-to-ER transit and Global Reach are not enabled.")}</p>}
        {request.kind === 'erLink' && <>
          <Field title={t("ER location")}><select name="location" required defaultValue={erLink?.locationId ?? request.locationId ?? topology.erLocations?.[0]?.id}>{topology.erLocations?.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <Field title={t("Endpoint type")}><select value={erEndpoint} onChange={(event) => setErEndpoint(event.target.value as 'hub' | 'site')}><option value="hub">{t("Virtual WAN hub")}</option><option value="site">{t("On-premises site")}</option></select></Field>
          <Field title={erEndpoint === 'hub' ? t("Hub") : t("On-premises site")}><select key={erEndpoint} name="endpoint" required defaultValue={erEndpoint === 'hub' ? erLink?.hubId ?? request.hubId ?? topology.hubs[0]?.id : erLink?.siteId ?? request.siteId ?? topology.sites[0]?.id}>{erEndpoint === 'hub' ? hubOptions : siteOptions}</select></Field>
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={erLink?.enabled ?? true} />{t("Connection enabled")}</label>
          {erEndpoint === 'site' ? <>
            <label className="checkbox-field"><input type="checkbox" name="learnSiteRoutes" defaultChecked={erLink?.learnSiteRoutes ?? true} />{t("Advertise site-originated and learned routes")}</label>
            <Field title={t("ER BGP advertisements")}><textarea name="advertisements" rows={4} defaultValue={erLink?.routes.map((route) => `${route.prefix} ${route.asPath.join(' ')}`).join('\n') ?? ''} placeholder={'10.80.0.0/16 65001\n10.81.0.0/16 65001 65002'} /></Field>
            <p className="muted">{t("Optional explicit advertisements: one prefix and site-side AS path per line. Provider ASN 12076 is added automatically. Each site attachment represents an independent private-peering circuit; other ER circuits are not advertised to it.")}</p>
          </> : <p className="muted">{t("This attachment imports site advertisements from the location and exports selected Azure, VPN and NVA routes. ER-learned routes and default routes are not exported. Configure advertisements on site attachments and route maps on the hub/site.")}</p>}
        </>}
        {request.kind === 'hub' && <>
          <Field title={t("Region")}><input name="region" required maxLength={120} defaultValue={hub?.region ?? ''} placeholder="West Europe" /></Field>
          <Field title={t("Routing preference")}><select name="preference" defaultValue={hub?.preference ?? 'ExpressRoute'}>{Object.entries(preferenceLabels).map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}</select></Field>
          <fieldset><legend>{t("Routing intent")}</legend>
            <label className="checkbox-field"><input type="checkbox" name="privateIntent" aria-label={t("Private traffic routing intent")} defaultChecked={hub?.routingIntent.private ?? false} />{t("Private traffic via Azure Firewall")}</label>
            <label className="checkbox-field"><input type="checkbox" name="internetIntent" aria-label={t("Internet traffic routing intent")} defaultChecked={hub?.routingIntent.internet ?? false} />{t("Internet traffic via Azure Firewall")}</label>
            <Field title={t("Additional private traffic prefixes")}><input name="privatePrefixes" defaultValue={hub?.routingIntent.privatePrefixes.join(', ') ?? ''} placeholder="100.64.0.0/10" /></Field>
            <p className="muted">{t("RFC1918 prefixes are included automatically with private intent. Firewall nodes and route views update when you save.")}</p>
          </fieldset>
        </>}
        {(request.kind === 'spoke' || request.kind === 'connection') && <Field title={t("Hub")}><select name="hub" required defaultValue={spoke?.hubId ?? connection?.hubId ?? request.hubId ?? topology.hubs[0]?.id}>{hubOptions}</select></Field>}
        {request.kind === 'spoke' && <Field title={t("Prefixes")}><input name="prefixes" required defaultValue={spoke?.prefixes.join(', ') ?? ''} placeholder="10.50.0.0/16" /></Field>}
        {request.kind === 'site' && <>
          <Field title={t("Site ASN")}><input name="asn" type="number" required min={1} max={4294967294} defaultValue={site?.asn ?? 65001} /></Field>
          <Field title={t("Originated prefix")}><input name="prefix" defaultValue={site?.prefixes[0] ?? ''} placeholder="10.80.0.0/16" /></Field>
          <p className="muted">{t("One optional IPv4 network for this site. Leave blank for a transit-only site or explicit connection advertisements.")}</p>
          {connectedSite && <>
            <p className="muted">{t("A connection to")} {topology.hubs.find((h) => h.id === request.hubId)?.name}  {t("is created with site-prefix advertisements enabled.")}</p>
            <Field title={t("Connection name")}><input name="connectionName" maxLength={120} placeholder={t("Defaults to site name + connection")} /></Field>{transport}
          </>}
        </>}
        {request.kind === 'connection' && <>
          <div className="connection-configuration">
          <Field title={t("On-premises site")}><select name="site" required defaultValue={connection?.siteId ?? request.siteId ?? topology.sites[0]?.id}>{siteOptions}</select></Field>{transport}
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={connection?.enabled ?? true} />{t("Connection enabled")}</label>
          <label className="checkbox-field"><input type="checkbox" name="learnSiteRoutes" defaultChecked={connection?.learnSiteRoutes ?? true} />{t("Advertise site-originated and learned routes")}</label>
          <p className="muted">{t("Advertisements are preserved. Route maps belong to the attached hub and site. Unassign their policies before retargeting a connection or making an incompatible transport change.")}</p>
          </div>
          <p className="muted">{t("Use Route maps on either endpoint to configure inbound/outbound policies for this connection.")}</p>
          <p className="muted">{t("Configure VPN static prefixes through Static routing on the site or hub. Remove or reassign site static routes before changing this VPN connection's site or transport.")}</p>
        </>}
        {item && (request.kind === 'hub' || request.kind === 'site') && <fieldset><legend>{t("Connection route maps")}</legend>
          <p>{t("Inbound/outbound policies belong to this router and are assigned per connection. Save any configuration changes before opening its policies.")}</p>
          <button type="button" onClick={() => onRouteMaps({ kind: request.kind as RouterSelection['kind'], id: item.id })}>{t("Configure route maps")}</button>
        </fieldset>}
        {item && (request.kind === 'hub' || request.kind === 'site') && <fieldset><legend>{t("S2S VPN static routing")}</legend>
          <p>{t("VPN static prefixes belong to the site and are associated with its VPN connections. Save configuration changes before opening static routing.")}</p>
          <button type="button" onClick={() => onStaticRouting({ kind: request.kind as RouterSelection['kind'], id: item.id })}>{t("Configure static routing")}</button>
        </fieldset>}
        {request.kind === 'siteLink' && <>
          <Field title={t("Site A")}><select name="a" required defaultValue={link?.a ?? request.siteId ?? topology.sites[0]?.id}>{siteOptions}</select></Field>
          <Field title={t("Site B")}><select name="b" required defaultValue={link?.b ?? topology.sites.find((s) => s.id !== (request.siteId ?? topology.sites[0]?.id))?.id}>{siteOptions}</select></Field>
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={link?.enabled ?? true} />{t("Link enabled")}</label>
          {(['aToB', 'bToA'] as const).map((direction) => <fieldset key={direction}><legend>{direction === 'aToB' ? t("Site A to Site B") : t("Site B to Site A")}</legend>
            <Field title={t("{0} export prefixes", t(direction))}><input name={`${direction}Prefixes`} defaultValue={link?.[direction].prefixes.join(', ') || '*'} /></Field>
            <Field title={t("{0} outbound prepend ASNs", t(direction))}><input name={`${direction}Prepend`} defaultValue={link?.[direction].prepend.join(' ') ?? ''} /></Field>
            <Field title={t("{0} inbound prepend ASNs", t(direction))}><input name={`${direction}Receive`} defaultValue={link?.[direction].receivePrepend?.join(' ') ?? ''} /></Field>
          </fieldset>)}
        </>}
      </>}
      {error && <p role="alert" className="notice error">{localizeDiagnostic(error)}</p>}
      <div className="row dialog-actions"><button type="button" onClick={onClose}>{t("Cancel")}</button><button className={request.deleting ? 'danger' : 'primary'}>{request.deleting ? t("Confirm deletion") : item ? t("Save changes") : t("Create object")}</button></div>
    </form>
  </CanvasOverlay>
}
