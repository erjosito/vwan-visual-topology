import { cloneElement, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { objectLabels, preferenceLabels, topologyObject, transportLabels } from './model'
import type { ObjectKind, ObjectSelection, Preference, Topology, Transport } from './model'
import { parseAsPath, validateTopology } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

export interface EditorRequest { kind: ObjectKind; id?: string; hubId?: string; siteId?: string; deleting?: boolean }

function Field({ title, children }: { title: string; children: ReactElement<{ 'aria-label'?: string }> }) {
  return <label className="field"><span>{title}</span>{cloneElement(children, { 'aria-label': title })}</label>
}

const prefixes = (value: string) => value.trim() === '*' ? [] : value.split(/[,\s]+/).filter(Boolean)

export function TopologyObjectEditor({ topology, request, onSave, onClose }: {
  topology: Topology; request: EditorRequest; onSave: (next: Topology, selection: ObjectSelection) => void; onClose: () => void
}) {
  const [error, setError] = useState('')
  const item = request.id ? topologyObject(topology, { kind: request.kind, id: request.id }) : undefined
  const hub = topology.hubs.find((h) => h.id === request.id)
  const spoke = topology.spokes.find((s) => s.id === request.id)
  const site = topology.sites.find((s) => s.id === request.id)
  const connection = topology.connections.find((c) => c.id === request.id)
  const [transportValue, setTransportValue] = useState<Transport>(connection?.transport ?? 'ExpressRoute')
  const link = topology.siteLinks.find((l) => l.id === request.id)
  const label = objectLabels[request.kind]
  const connectedSite = request.kind === 'site' && !item && !!request.hubId
  const title = request.deleting ? `Delete ${label}` : `${item ? 'Edit' : 'Add'} ${connectedSite ? 'connected site' : label}`

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
          next.routeMaps = next.routeMaps?.filter((m) => m.hubId !== id)
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
          const value = {
            ...(connection ?? { id, routes: [], inbound: [], outbound: [] }),
            name, hubId: text('hub'), siteId: text('site'), transport: text('transport') as Transport,
            enabled: data.has('enabled'), learnSiteRoutes: data.has('learnSiteRoutes'),
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

  return <CanvasOverlay title={title} className="object-editor" onClose={onClose}>
    <form onSubmit={save}>
      {request.deleting ? <>
        <p>Delete <strong>{item?.name}</strong>? This cannot be undone. Export JSON first if you need a backup.</p>
        {request.kind === 'hub' && <p>This also removes {removedSpokes} attached spoke{removedSpokes === 1 ? '' : 's'} and {removedConnections} connection{removedConnections === 1 ? '' : 's'}. On-premises sites are kept.</p>}
        {request.kind === 'site' && <p>This also removes {removedConnections} hub connection{removedConnections === 1 ? '' : 's'} and {removedPeers} on-premises link{removedPeers === 1 ? '' : 's'}.</p>}
      </> : <>
        <Field title="Name"><input name="name" required maxLength={120} defaultValue={item?.name ?? ''} autoFocus /></Field>
        {request.kind === 'hub' && <>
          <Field title="Region"><input name="region" required maxLength={120} defaultValue={hub?.region ?? ''} placeholder="West Europe" /></Field>
          <Field title="Routing preference"><select name="preference" defaultValue={hub?.preference ?? 'ExpressRoute'}>{Object.entries(preferenceLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
          <fieldset><legend>Routing intent</legend>
            <label className="checkbox-field"><input type="checkbox" name="privateIntent" aria-label="Private traffic routing intent" defaultChecked={hub?.routingIntent.private ?? false} />Private traffic via Azure Firewall</label>
            <label className="checkbox-field"><input type="checkbox" name="internetIntent" aria-label="Internet traffic routing intent" defaultChecked={hub?.routingIntent.internet ?? false} />Internet traffic via Azure Firewall</label>
            <Field title="Additional private traffic prefixes"><input name="privatePrefixes" defaultValue={hub?.routingIntent.privatePrefixes.join(', ') ?? ''} placeholder="100.64.0.0/10" /></Field>
            <p className="muted">RFC1918 prefixes are included automatically with private intent. Firewall nodes and route views update when you save.</p>
          </fieldset>
        </>}
        {(request.kind === 'spoke' || request.kind === 'connection') && <Field title="Hub"><select name="hub" required defaultValue={spoke?.hubId ?? connection?.hubId ?? request.hubId ?? topology.hubs[0]?.id}>{hubOptions}</select></Field>}
        {request.kind === 'spoke' && <Field title="Prefixes"><input name="prefixes" required defaultValue={spoke?.prefixes.join(', ') ?? ''} placeholder="10.50.0.0/16" /></Field>}
        {request.kind === 'site' && <>
          <Field title="Site ASN"><input name="asn" type="number" required min={1} max={4294967294} defaultValue={site?.asn ?? 65001} /></Field>
          <Field title="Originated prefixes"><textarea name="prefixes" rows={3} defaultValue={site?.prefixes.join('\n') ?? ''} placeholder={'10.80.0.0/16\n10.81.0.0/16'} /></Field>
          <p className="muted">One IPv4 prefix per line; commas or spaces also work. All prefixes originate from this site.</p>
          {connectedSite && <>
            <p className="muted">A connection to {topology.hubs.find((h) => h.id === request.hubId)?.name} is created with site-prefix advertisements enabled.</p>
            <Field title="Connection name"><input name="connectionName" maxLength={120} placeholder="Defaults to site name + connection" /></Field>{transport}
          </>}
        </>}
        {request.kind === 'connection' && <>
          <div className="connection-configuration">
          <Field title="On-premises site"><select name="site" required defaultValue={connection?.siteId ?? request.siteId ?? topology.sites[0]?.id}>{siteOptions}</select></Field>{transport}
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={connection?.enabled ?? true} />Connection enabled</label>
          <label className="checkbox-field"><input type="checkbox" name="learnSiteRoutes" defaultChecked={connection?.learnSiteRoutes ?? true} />Advertise site-originated and learned routes</label>
          <p className="muted">Existing advertisements and route maps are preserved. Incompatible transport changes are rejected; remove VPN static routes or unsupported route maps explicitly first.</p>
          </div>
          <p className="muted">Create and assign reusable policies through the connection's Route maps action. Unassign maps before moving a connection to another hub or changing it to SD-WAN.</p>
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
  </CanvasOverlay>
}
