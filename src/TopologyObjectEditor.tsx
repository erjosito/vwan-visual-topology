import { cloneElement, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { objectLabels, preferenceLabels, topologyObject, transportLabels } from './model'
import type { Connection, ObjectKind, ObjectSelection, Preference, Topology, Transport } from './model'
import { parseAsPath, validateTopology } from './validation'

export interface EditorRequest { kind: ObjectKind; id?: string; hubId?: string; siteId?: string; deleting?: boolean; routeMaps?: boolean }

function Field({ title, children }: { title: string; children: ReactElement<{ 'aria-label'?: string }> }) {
  return <label className="field"><span>{title}</span>{cloneElement(children, { 'aria-label': title })}</label>
}

const prefixes = (value: string) => value.trim() === '*' ? [] : value.split(/[,\s]+/).filter(Boolean)

export function TopologyObjectEditor({ topology, request, onSave, onClose }: {
  topology: Topology; request: EditorRequest; onSave: (next: Topology, selection: ObjectSelection) => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  const item = request.id ? topologyObject(topology, { kind: request.kind, id: request.id }) : undefined
  const hub = topology.hubs.find((h) => h.id === request.id)
  const spoke = topology.spokes.find((s) => s.id === request.id)
  const site = topology.sites.find((s) => s.id === request.id)
  const connection = topology.connections.find((c) => c.id === request.id)
  const [maps, setMaps] = useState<Pick<Connection, 'inbound' | 'outbound'>>(() => ({
    inbound: structuredClone(connection?.inbound ?? []), outbound: structuredClone(connection?.outbound ?? []),
  }))
  const [transportValue, setTransportValue] = useState<Transport>(connection?.transport ?? 'ExpressRoute')
  const link = topology.siteLinks.find((l) => l.id === request.id)
  const label = objectLabels[request.kind]
  const connectedSite = request.kind === 'site' && !item && !!request.hubId
  const title = request.deleting ? `Delete ${label}` : request.routeMaps ? `Route maps · ${item?.name}` : `${item ? 'Edit' : 'Add'} ${connectedSite ? 'connected site' : label}`
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

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
        } else if (request.kind === 'site') {
          next.sites = next.sites.filter((s) => s.id !== id)
          next.connections = next.connections.filter((c) => c.siteId !== id)
          next.siteLinks = next.siteLinks.filter((l) => l.a !== id && l.b !== id)
        } else if (request.kind === 'spoke') next.spokes = next.spokes.filter((s) => s.id !== id)
        else if (request.kind === 'connection') next.connections = next.connections.filter((c) => c.id !== id)
        else next.siteLinks = next.siteLinks.filter((l) => l.id !== id)
      } else {
        const data = new FormData(event.currentTarget)
        const text = (name: string) => String(data.get(name) ?? '').trim()
        const name = text('name')
        if (request.kind === 'hub') {
          const value = {
            id, name, region: text('region'), preference: text('preference') as Preference,
            routingIntent: { private: data.has('privateIntent'), internet: data.has('internetIntent'), privatePrefixes: prefixes(text('privatePrefixes')) },
          }
          if (hub) next.hubs[next.hubs.findIndex((h) => h.id === id)] = value
          else next.hubs.push(value)
        } else if (request.kind === 'spoke') {
          const value = { id, name, hubId: text('hub'), prefixes: prefixes(text('prefixes')) }
          if (spoke) next.spokes[next.spokes.findIndex((s) => s.id === id)] = value
          else next.spokes.push(value)
        } else if (request.kind === 'site') {
          const value = { id, name, asn: Number(text('asn')), prefixes: prefixes(text('prefixes')) }
          if (site) next.sites[next.sites.findIndex((s) => s.id === id)] = value
          else next.sites.push(value)
          if (connectedSite) next.connections.push({
            id: crypto.randomUUID(), name: text('connectionName') || `${name} connection`, hubId: request.hubId!, siteId: id,
            transport: text('transport') as Transport, enabled: true, routes: [], inbound: [], outbound: [], learnSiteRoutes: true,
          })
        } else if (request.kind === 'connection') {
          const routeMap = (direction: 'inbound' | 'outbound') => maps[direction].map((rule) => ({
            id: rule.id, prefixes: prefixes(text(`${direction}-${rule.id}-prefixes`)),
            match: text(`${direction}-${rule.id}-match`) as 'equals' | 'contains',
            prepend: parseAsPath(text(`${direction}-${rule.id}-prepend`)),
          }))
          const value = {
            ...(connection ?? { id, routes: [], inbound: [], outbound: [] }),
            name, hubId: text('hub'), siteId: text('site'), transport: text('transport') as Transport,
            enabled: data.has('enabled'), learnSiteRoutes: data.has('learnSiteRoutes'),
            inbound: routeMap('inbound'), outbound: routeMap('outbound'),
          }
          if (connection) next.connections[next.connections.findIndex((c) => c.id === id)] = value
          else next.connections.push(value)
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
  const transport = <Field title="Transport"><select name="transport" value={transportValue} onChange={(event) => setTransportValue(event.target.value as Transport)}>{Object.entries(transportLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
  const removedSpokes = topology.spokes.filter((s) => s.hubId === request.id).length
  const removedConnections = topology.connections.filter((c) => request.kind === 'hub' ? c.hubId === request.id : c.siteId === request.id).length
  const removedPeers = topology.siteLinks.filter((l) => l.a === request.id || l.b === request.id).length

  return <dialog ref={dialog} className="object-dialog" aria-labelledby="object-dialog-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <form onSubmit={save}>
      <div className="row dialog-heading"><h2 id="object-dialog-title">{title}</h2><button type="button" aria-label="Close object editor" onClick={onClose}>Close</button></div>
      {request.deleting ? <>
        <p>Delete <strong>{item?.name}</strong>? This cannot be undone. Export JSON first if you need a backup.</p>
        {request.kind === 'hub' && <p>This also removes {removedSpokes} attached spoke{removedSpokes === 1 ? '' : 's'} and {removedConnections} connection{removedConnections === 1 ? '' : 's'}. On-premises sites are kept.</p>}
        {request.kind === 'site' && <p>This also removes {removedConnections} hub connection{removedConnections === 1 ? '' : 's'} and {removedPeers} on-premises link{removedPeers === 1 ? '' : 's'}.</p>}
      </> : <>
        <div hidden={request.routeMaps}><Field title="Name"><input name="name" required maxLength={120} defaultValue={item?.name ?? ''} autoFocus={!request.routeMaps} /></Field></div>
        {request.kind === 'hub' && <>
          <Field title="Region"><input name="region" required maxLength={120} defaultValue={hub?.region ?? ''} placeholder="West Europe" /></Field>
          <Field title="Routing preference"><select name="preference" defaultValue={hub?.preference ?? 'ExpressRoute'}>{Object.entries(preferenceLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
          <fieldset><legend>Routing intent</legend>
            <label className="checkbox-field"><input type="checkbox" name="privateIntent" aria-label="Private traffic routing intent" defaultChecked={hub?.routingIntent.private ?? false} />Private traffic via Azure Firewall</label>
            <label className="checkbox-field"><input type="checkbox" name="internetIntent" aria-label="Internet traffic routing intent" defaultChecked={hub?.routingIntent.internet ?? false} />Internet traffic via Azure Firewall</label>
            <Field title="Additional private traffic prefixes"><input name="privatePrefixes" defaultValue={hub?.routingIntent.privatePrefixes.join(', ') ?? ''} placeholder="100.64.0.0/10" /></Field>
            <p className="muted">RFC1918 prefixes are included automatically with private intent. Firewall nodes and effective route views update when you save.</p>
          </fieldset>
        </>}
        {(request.kind === 'spoke' || request.kind === 'connection') && <div hidden={request.routeMaps}><Field title="Hub"><select name="hub" required defaultValue={spoke?.hubId ?? connection?.hubId ?? request.hubId ?? topology.hubs[0]?.id}>{hubOptions}</select></Field></div>}
        {request.kind === 'spoke' && <Field title="Prefixes"><input name="prefixes" required defaultValue={spoke?.prefixes.join(', ') ?? ''} placeholder="10.50.0.0/16" /></Field>}
        {request.kind === 'site' && <>
          <Field title="Site ASN"><input name="asn" type="number" required min={1} max={4294967294} defaultValue={site?.asn ?? 65001} /></Field>
          <Field title="Originated prefixes"><input name="prefixes" defaultValue={site?.prefixes.join(', ') ?? ''} placeholder="10.80.0.0/16" /></Field>
          {connectedSite && <>
            <p className="muted">A connection to {topology.hubs.find((h) => h.id === request.hubId)?.name} is created with site-prefix advertisements enabled.</p>
            <Field title="Connection name"><input name="connectionName" maxLength={120} placeholder="Defaults to site name + connection" /></Field>{transport}
          </>}
        </>}
        {request.kind === 'connection' && <>
          <div className="connection-configuration" hidden={request.routeMaps}>
          <Field title="On-premises site"><select name="site" required defaultValue={connection?.siteId ?? request.siteId ?? topology.sites[0]?.id}>{siteOptions}</select></Field>{transport}
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={connection?.enabled ?? true} />Connection enabled</label>
          <label className="checkbox-field"><input type="checkbox" name="learnSiteRoutes" defaultChecked={connection?.learnSiteRoutes ?? true} />Advertise site-originated and learned routes</label>
          <p className="muted">Existing advertisements and route maps are preserved. Incompatible transport changes are rejected; remove VPN static routes or unsupported route maps explicitly first.</p>
          </div>
          {request.routeMaps && connection && <p className="muted">{transportLabels[connection.transport]} · {topology.sites.find((s) => s.id === connection.siteId)?.name} ↔ {topology.hubs.find((h) => h.id === connection.hubId)?.name}. Connection configuration and advertisements are unchanged.</p>}
          <details open={request.routeMaps}><summary>Inbound and outbound route maps</summary>
            <p className="muted">Rules run in order; the first prefix match wins. * matches all prefixes. Use public 2-byte prepend ASNs, excluding Azure-reserved ASNs. 64496-64511 are simulation-only documentation ASNs. Outbound maps affect advertisements, not Azure best paths.</p>
            {transportValue === 'SDWAN' && <p className="notice">Azure route maps are not supported on integrated SD-WAN NVA branch connections.</p>}
            {(['inbound', 'outbound'] as const).map((direction) => <fieldset key={direction}><legend>{direction === 'inbound' ? 'Inbound: site to hub' : 'Outbound: hub to site'}</legend>
              {maps[direction].map((rule, index) => <div className="map-rule" key={rule.id}>
                <strong>Rule {index + 1}</strong>
                <Field title={`${direction} match prefixes ${index + 1}`}><input name={`${direction}-${rule.id}-prefixes`} defaultValue={rule.prefixes.join(', ') || '*'} /></Field>
                <Field title={`${direction} match mode ${index + 1}`}><select name={`${direction}-${rule.id}-match`} defaultValue={rule.match}><option value="equals">Equals</option><option value="contains">Contains (including more specific)</option></select></Field>
                <Field title={`${direction} prepend ASNs ${index + 1}`}><input name={`${direction}-${rule.id}-prepend`} defaultValue={rule.prepend.join(' ')} /></Field>
                <button type="button" className="danger small" onClick={() => setMaps((current) => ({ ...current, [direction]: current[direction].filter((r) => r.id !== rule.id) }))}>Remove {direction} rule {index + 1}</button>
              </div>)}
              <button type="button" autoFocus={request.routeMaps && direction === 'inbound'} disabled={transportValue === 'SDWAN' || maps[direction].length >= 20} onClick={() => setMaps((current) => ({
                ...current, [direction]: [...current[direction], { id: crypto.randomUUID(), prefixes: [], match: 'equals', prepend: [64496] }],
              }))}>Add {direction} rule</button>
            </fieldset>)}
          </details>
        </>}
        {request.kind === 'siteLink' && <>
          <Field title="Site A"><select name="a" required defaultValue={link?.a ?? request.siteId ?? topology.sites[0]?.id}>{siteOptions}</select></Field>
          <Field title="Site B"><select name="b" required defaultValue={link?.b ?? topology.sites.find((s) => s.id !== (request.siteId ?? topology.sites[0]?.id))?.id}>{siteOptions}</select></Field>
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={link?.enabled ?? true} />Link enabled</label>
          {(['aToB', 'bToA'] as const).map((direction) => <fieldset key={direction}><legend>{direction === 'aToB' ? 'Site A to Site B' : 'Site B to Site A'}</legend>
            <Field title={`${direction} export prefixes`}><input name={`${direction}Prefixes`} defaultValue={link?.[direction].prefixes.join(', ') || '*'} /></Field>
            <Field title={`${direction} outbound prepend ASNs`}><input name={`${direction}Prepend`} defaultValue={link?.[direction].prepend.join(' ') ?? ''} /></Field>
            <Field title={`${direction} inbound prepend ASNs`}><input name={`${direction}Receive`} defaultValue={link?.[direction].receivePrepend?.join(' ') ?? ''} /></Field>
          </fieldset>)}
        </>}
      </>}
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="row dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className={request.deleting ? 'danger' : 'primary'}>{request.deleting ? 'Confirm deletion' : item ? 'Save changes' : 'Create object'}</button></div>
    </form>
  </dialog>
}
