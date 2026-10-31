import { t, localizeDiagnostic } from './i18n'
import { cloneElement, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { objectLabels, preferenceLabels, siteLabel, topologyObject, transportLabels } from './model'
import type { ObjectKind, ObjectSelection, Preference, RouterSelection, Topology, Transport } from './model'
import { defaultSpokeNvaPeerIp, parseAsPath, validateTopology } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

export interface EditorRequest { kind: ObjectKind; id?: string; hubId?: string; siteId?: string; locationId?: string; spokeId?: string; nvaSpokeId?: string; deleting?: boolean }

function Field({ title, children }: { title: string; children: ReactElement<{ 'aria-label'?: string }> }) {
  return <label className="field"><span>{title}</span>{cloneElement(children, { 'aria-label': title })}</label>
}

const prefixes = (value: string) => value.trim() === '*' ? [] : value.split(/[,\s]+/).filter(Boolean)

export function TopologyObjectEditor({ topology, request, onSave, onClose, onRouteMaps, onStaticRouting, onAddNva }: {
  topology: Topology; request: EditorRequest; onSave: (next: Topology, selection: ObjectSelection) => void; onClose: () => void; onRouteMaps: (router: RouterSelection) => void; onStaticRouting: (router: RouterSelection) => void; onAddNva: (spokeId: string) => void
}) {
  const [error, setError] = useState('')
  const item = request.id ? topologyObject(topology, { kind: request.kind, id: request.id }) : undefined
  const hub = topology.hubs.find((h) => h.id === request.id)
  const spoke = topology.spokes.find((s) => s.id === request.id)
  const site = topology.sites.find((s) => s.id === request.id)
  const connection = topology.connections.find((c) => c.id === request.id)
  const erLink = topology.erLinks?.find((link) => link.id === request.id)
  const [erEndpoint, setErEndpoint] = useState<'hub' | 'site'>(erLink?.siteId || request.siteId ? 'site' : 'hub')
  const existingNvaConn = request.kind === 'site'
    ? topology.connections.find((c) => c.transport === 'SpokeNVA' && (request.id ? c.siteId === request.id : c.spokeId === request.spokeId))
    : undefined
  const isSpokeNva = request.kind === 'site' && (Boolean(request.spokeId) || Boolean(existingNvaConn))
  const [selectedHostSpokeId, setSelectedHostSpokeId] = useState(existingNvaConn?.spokeId ?? request.spokeId ?? topology.spokes.find((s) => Boolean(s.hubId))?.id ?? '')
  const [selectedSpokeHubId, setSelectedSpokeHubId] = useState(spoke ? (spoke.hubId ?? '') : (request.nvaSpokeId ? '' : request.hubId ?? topology.hubs[0]?.id ?? ''))
  const hostSpoke = topology.spokes.find((s) => s.id === selectedHostSpokeId)
  const inferredPeerIp = hostSpoke ? defaultSpokeNvaPeerIp(hostSpoke.prefixes) ?? '' : ''
  const [transportValue, setTransportValue] = useState<Transport>(connection?.transport ?? (isSpokeNva ? 'SpokeNVA' : 'ExpressRoute'))
  const link = topology.siteLinks.find((l) => l.id === request.id)
  const label = t(request.kind === 'site' ? isSpokeNva ? 'Spoke BGP NVA' : siteLabel(topology, request.id ?? '') : objectLabels[request.kind])
  const connectedSite = request.kind === 'site' && !item && !!request.hubId && !isSpokeNva
  const nvaSpokes = topology.spokes.filter((s) => s.id !== request.id && Boolean(s.hubId) && topology.connections.some((c) => c.transport === 'SpokeNVA' && c.spokeId === s.id))
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
          if (existingNvaConn?.spokeId) {
            next.spokes = next.spokes.map((s) => s.nvaSpokeIds ? { ...s, nvaSpokeIds: s.nvaSpokeIds.filter((nvaId) => nvaId !== existingNvaConn.spokeId) } : s)
          }
        } else if (request.kind === 'spoke') {
          next.spokes = next.spokes.filter((s) => s.id !== id).map((s) => s.nvaSpokeIds ? { ...s, nvaSpokeIds: s.nvaSpokeIds.filter((nvaId) => nvaId !== id) } : s)
          next.connections = next.connections.filter((connection) => connection.spokeId !== id)
        }
        else if (request.kind === 'connection') next.connections = next.connections.filter((c) => c.id !== id)
        else if (request.kind === 'erLocation') {
          next.erLocations = next.erLocations?.filter((location) => location.id !== id)
          next.erLinks = next.erLinks?.filter((link) => link.locationId !== id)
        } else if (request.kind === 'erLink') next.erLinks = next.erLinks?.filter((link) => link.id !== id)
        else next.siteLinks = next.siteLinks.filter((l) => l.id !== id)
        const activeSpokeIds = new Set(next.spokes.filter((s) => Boolean(s.hubId)).map((s) => s.id))
        const activeNvaSiteIds = new Set(next.connections.filter((c) => c.transport === 'SpokeNVA' && c.spokeId && activeSpokeIds.has(c.spokeId)).map((c) => c.siteId))
        const orphanedNvaSiteIds = new Set(next.sites.filter((s) => s.role === 'spoke-nva' && !activeNvaSiteIds.has(s.id)).map((s) => s.id))
        if (orphanedNvaSiteIds.size) {
          next.sites = next.sites.filter((s) => !orphanedNvaSiteIds.has(s.id))
          next.connections = next.connections.filter((c) => !orphanedNvaSiteIds.has(c.siteId))
          next.siteLinks = next.siteLinks.filter((l) => !orphanedNvaSiteIds.has(l.a) && !orphanedNvaSiteIds.has(l.b))
          next.erLinks = next.erLinks?.filter((link) => !link.siteId || !orphanedNvaSiteIds.has(link.siteId))
          next.routeMaps = next.routeMaps?.filter((map) => !map.siteId || !orphanedNvaSiteIds.has(map.siteId))
        }
        next.spokes = next.spokes.map((s) => s.nvaSpokeIds ? { ...s, nvaSpokeIds: s.nvaSpokeIds.filter((nvaId) => activeSpokeIds.has(nvaId)) } : s)
        const remaining = new Set([...next.connections, ...next.siteLinks, ...next.spokes, ...(next.erLinks ?? [])].map((link) => link.id))
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
          const hubIdValue = text('hub') || undefined
          const selectedNvaSpokes = data.getAll('nvaSpokeIds').map(String).filter(Boolean)
          const value = {
            id,
            name,
            ...(hubIdValue ? { hubId: hubIdValue } : {}),
            prefixes: prefixes(text('prefixes')),
            ...(selectedNvaSpokes.length ? { nvaSpokeIds: selectedNvaSpokes } : {}),
            ...(hubIdValue && data.has('propagateDefaultRoute') ? { propagateDefaultRoute: true } : {}),
          }
          if (hubIdValue) {
            for (const connection of next.connections.filter((connection) => connection.spokeId === id)) connection.hubId = hubIdValue
          }
          if (spoke) next.spokes[next.spokes.findIndex((s) => s.id === id)] = value
          else next.spokes.push(value)
        } else if (request.kind === 'site') {
          if (isSpokeNva) {
            const targetSpokeId = text('spoke') || selectedHostSpokeId
            const targetSpoke = next.spokes.find((s) => s.id === targetSpokeId)
            if (!targetSpoke?.hubId) throw new Error('Spoke BGP NVA requires a hub-attached hosting spoke.')
            const peerIp = text('peerIp') || defaultSpokeNvaPeerIp(targetSpoke.prefixes) || ''
            const value = { ...site, id, name, asn: Number(text('asn')), prefixes: site?.prefixes ?? [], role: 'spoke-nva' as const }
            if (site) next.sites[next.sites.findIndex((s) => s.id === id)] = value
            else next.sites.push(value)
            const connValue = {
              ...(existingNvaConn ?? { id: crypto.randomUUID(), inbound: [], outbound: [], enabled: true, learnSiteRoutes: true }),
              name: existingNvaConn?.name || `${name} peering`,
              hubId: targetSpoke.hubId,
              siteId: id,
              spokeId: targetSpoke.id,
              peerIp,
              transport: 'SpokeNVA' as const,
              propagateDefaultRoute: data.has('propagateDefaultRoute') ? true : undefined,
            }
            if (existingNvaConn) next.connections[next.connections.findIndex((c) => c.id === existingNvaConn.id)] = connValue
            else next.connections.push(connValue)
            const checkedVnets = new Set(data.getAll('downstreamVnets').map(String))
            next.spokes = next.spokes.map((s) => {
              if (s.id === targetSpoke.id) return s
              const current = new Set(s.nvaSpokeIds ?? [])
              if (checkedVnets.has(s.id)) current.add(targetSpoke.id)
              else current.delete(targetSpoke.id)
              return { ...s, nvaSpokeIds: current.size ? [...current] : undefined }
            })
            const checkedSites = new Set(data.getAll('downstreamSites').map(String))
            for (const otherSite of next.sites) {
              if (otherSite.id === id || next.connections.some((c) => c.transport === 'SpokeNVA' && c.siteId === otherSite.id)) continue
              const existingLink = next.siteLinks.find((l) => (l.a === id && l.b === otherSite.id) || (l.b === id && l.a === otherSite.id))
              if (checkedSites.has(otherSite.id) && !existingLink) {
                next.siteLinks.push({
                  id: crypto.randomUUID(),
                  name: `${name} - ${otherSite.name}`,
                  a: id,
                  b: otherSite.id,
                  enabled: true,
                  aToB: { prefixes: [], prepend: [], receivePrepend: [] },
                  bToA: { prefixes: [], prepend: [], receivePrepend: [] },
                })
              } else if (!checkedSites.has(otherSite.id) && existingLink) {
                next.siteLinks = next.siteLinks.filter((l) => l.id !== existingLink.id)
              }
            }
          } else {
            const value = { ...site, id, name, asn: Number(text('asn')), prefixes: prefixes(text('prefix')) }
            if (site) next.sites[next.sites.findIndex((s) => s.id === id)] = value
            else next.sites.push(value)
            if (connectedSite) next.connections.push({
              id: crypto.randomUUID(), name: text('connectionName') || `${name} connection`, hubId: request.hubId!, siteId: id,
              transport: transportValue, enabled: true, inbound: [], outbound: [], learnSiteRoutes: true,
            })
            const checkedNvaSpokes = new Set(data.getAll('nvaSpokeIds').map(String))
            for (const nvaSpoke of nvaSpokes) {
              const peerSiteId = next.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === nvaSpoke.id)?.siteId
              if (!peerSiteId) continue
              const existingLink = next.siteLinks.find((l) => (l.a === id && l.b === peerSiteId) || (l.b === id && l.a === peerSiteId))
              if (checkedNvaSpokes.has(nvaSpoke.id) && !existingLink) {
                next.siteLinks.push({
                  id: crypto.randomUUID(),
                  name: `${nvaSpoke.name} - ${name}`,
                  a: peerSiteId,
                  b: id,
                  enabled: true,
                  aToB: { prefixes: [], prepend: [], receivePrepend: [] },
                  bToA: { prefixes: [], prepend: [], receivePrepend: [] },
                })
              } else if (!checkedNvaSpokes.has(nvaSpoke.id) && existingLink) {
                next.siteLinks = next.siteLinks.filter((l) => l.id !== existingLink.id)
              }
            }
          }
        } else if (request.kind === 'connection') {
          const value = {
            ...(connection ?? { id, inbound: [], outbound: [] }),
            name, hubId: text('hub'), siteId: text('site'), transport: text('transport') as Transport,
            enabled: data.has('enabled'), learnSiteRoutes: data.has('learnSiteRoutes'),
            propagateDefaultRoute: data.has('propagateDefaultRoute') ? true : undefined,
            spokeId: undefined, peerIp: undefined,
            ...(transportValue === 'SpokeNVA' ? {
              spokeId: text('spoke'), peerIp: text('peerIp'), hubId: topology.spokes.find((spoke) => spoke.id === text('spoke'))!.hubId,
            } : {}),
          }
          if (connection) next.connections[next.connections.findIndex((c) => c.id === id)] = value
          else next.connections.push(value)
        } else if (request.kind === 'erLocation') {
          next.erLocations ??= []
          const index = next.erLocations.findIndex((location) => location.id === id)
          if (index < 0) next.erLocations.push({ id, name })
          else next.erLocations[index] = { id, name }
        } else if (request.kind === 'erLink') {
          const value = { id, name, locationId: text('location'), enabled: data.has('enabled'),
            ...(erEndpoint === 'hub' ? { hubId: text('endpoint'), ...(data.has('propagateDefaultRoute') ? { propagateDefaultRoute: true } : {}) } : { siteId: text('endpoint') }),
            learnSiteRoutes: erEndpoint === 'site' && data.has('learnSiteRoutes') }
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
        <Field title={t("Name")}><input name="name" required maxLength={120} defaultValue={item?.name ?? (isSpokeNva && hostSpoke ? `${hostSpoke.name} NVA` : '')} autoFocus /></Field>
        {request.kind === 'erLocation' && <p className="muted">{t("An ExpressRoute peering location groups site circuit attachments and their hub connections. Connect sites and hubs after creating it. ER-to-ER transit and Global Reach are not enabled.")}</p>}
        {request.kind === 'erLink' && <>
          <Field title={t("ER location")}><select name="location" required defaultValue={erLink?.locationId ?? request.locationId ?? topology.erLocations?.[0]?.id}>{topology.erLocations?.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <Field title={t("Endpoint type")}><select value={erEndpoint} onChange={(event) => setErEndpoint(event.target.value as 'hub' | 'site')}><option value="hub">{t("Virtual WAN hub")}</option><option value="site">{t("On-premises site")}</option></select></Field>
          <Field title={erEndpoint === 'hub' ? t("Hub") : t("On-premises site")}><select key={erEndpoint} name="endpoint" required defaultValue={erEndpoint === 'hub' ? erLink?.hubId ?? request.hubId ?? topology.hubs[0]?.id : erLink?.siteId ?? request.siteId ?? topology.sites[0]?.id}>{erEndpoint === 'hub' ? hubOptions : siteOptions}</select></Field>
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={erLink?.enabled ?? true} />{t("Connection enabled")}</label>
          {erEndpoint === 'site' ? <>
            <label className="checkbox-field"><input type="checkbox" name="learnSiteRoutes" defaultChecked={erLink?.learnSiteRoutes ?? true} />{t("Advertise site-originated and learned routes")}</label>
            <p className="muted">{t("Provider ASN 12076 is added automatically. Each site attachment represents an independent private-peering circuit; other ER circuits are not advertised to it.")}</p>
          </> : <>
            <label className="checkbox-field"><input type="checkbox" name="propagateDefaultRoute" defaultChecked={erLink?.propagateDefaultRoute ?? false} />{t("Propagate default route (0.0.0.0/0)")}</label>
            <p className="muted">{t("This attachment imports site advertisements from the location and exports selected Azure, VPN and NVA routes. ER-learned routes and default routes are not exported unless default-route propagation is enabled. Configure advertisements on site attachments and route maps on the hub/site.")}</p>
          </>}
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
        {request.kind === 'spoke' && <Field title={t("Hub")}><select name="hub" value={selectedSpokeHubId} onChange={(e) => setSelectedSpokeHubId(e.target.value)}>{hubOptions}<option value="">{t("None (standalone / behind spoke NVA)")}</option></select></Field>}
        {request.kind === 'connection' && transportValue !== 'SpokeNVA' && <Field title={t("Hub")}><select name="hub" required defaultValue={connection?.hubId ?? request.hubId ?? topology.hubs[0]?.id}>{hubOptions}</select></Field>}
        {request.kind === 'spoke' && <>
          <Field title={t("Prefixes")}><input name="prefixes" required defaultValue={spoke?.prefixes.join(', ') ?? ''} placeholder="10.50.0.0/16" /></Field>
          {selectedSpokeHubId && <label className="checkbox-field"><input type="checkbox" name="propagateDefaultRoute" defaultChecked={spoke?.propagateDefaultRoute ?? false} />{t("Propagate default route (0.0.0.0/0)")}</label>}
          {nvaSpokes.length > 0 && <fieldset><legend>{t("Connected NVA spokes")}</legend>
            <p className="muted">{t("Attach this VNet behind one or more spoke BGP NVAs so those NVAs advertise its prefixes to Virtual WAN.")}</p>
            {nvaSpokes.map((nvaSpoke) => <label key={nvaSpoke.id} className="checkbox-field"><input type="checkbox" name="nvaSpokeIds" value={nvaSpoke.id} defaultChecked={spoke?.nvaSpokeIds?.includes(nvaSpoke.id) || request.nvaSpokeId === nvaSpoke.id} />{nvaSpoke.name} ({nvaSpoke.prefixes.join(', ')})</label>)}
          </fieldset>}
          {(!spoke || spoke.hubId) && <fieldset><legend>{t("BGP NVAs in this spoke")}</legend><p className="muted">{t("VNet address spaces remain system routes. Add an NVA to exchange downstream VNet or site prefixes with the hub over BGP; this is separate from integrated SD-WAN.")}</p>
            {spoke && <><p>{t("{0} configured BGP peers", topology.connections.filter((connection) => connection.spokeId === spoke.id).length)}</p><button type="button" onClick={() => onAddNva(spoke.id)}>{topology.connections.some((connection) => connection.spokeId === spoke.id && connection.transport === 'SpokeNVA') ? t("Configure BGP NVA") : t("Add BGP NVA")}</button><p className="muted">{t("Save spoke changes before adding an NVA.")}</p></>}
            {!spoke && <p className="muted">{t("Create the spoke first, then use Add BGP NVA from its menu or editor.")}</p>}
          </fieldset>}
        </>}
        {request.kind === 'site' && isSpokeNva && <>
          <Field title={t("NVA ASN")}><input name="asn" type="number" required min={1} max={65534} defaultValue={site?.asn ?? 65001} /></Field>
          <fieldset><legend>{t("Spoke NVA BGP peering")}</legend>
            <Field title={t("Hosting spoke")}><select name="spoke" required value={selectedHostSpokeId} onChange={(e) => setSelectedHostSpokeId(e.target.value)}>{topology.spokes.filter((s) => Boolean(s.hubId)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field title={t("NVA BGP interface IPv4")}><input name="peerIp" defaultValue={existingNvaConn?.peerIp ?? inferredPeerIp} placeholder={inferredPeerIp || '10.50.0.4'} /></Field>
            <label className="checkbox-field"><input type="checkbox" name="propagateDefaultRoute" defaultChecked={Boolean(existingNvaConn?.propagateDefaultRoute || hostSpoke?.propagateDefaultRoute)} />{t("Propagate default route (0.0.0.0/0)")}</label>
            <p className="muted">{t("Optional — automatically inferred from the hosting spoke's range ({0}) if left blank. Must be an IPv4 address inside the hosting spoke.", inferredPeerIp || '.4')}</p>
            <p className="muted">{t("Use a public or private 2-byte NVA ASN, excluding Azure/IANA reserved ASNs. One logical peer represents identical advertisements to both hub router IPs (AS65515).")}</p>
            <a href="https://learn.microsoft.com/azure/virtual-wan/scenario-bgp-peering-hub#benefits-and-considerations" target="_blank" rel="noreferrer">{t("Microsoft spoke NVA BGP requirements")}</a>
          </fieldset>
          <fieldset><legend>{t("Attached downstream networks")}</legend>
            <p className="muted">{t("This NVA automatically advertises any attached downstream Azure VNets and on-premises sites over BGP to the Virtual WAN hub.")}</p>
            {topology.spokes.filter((s) => s.id !== selectedHostSpokeId).map((s) => <label key={s.id} className="checkbox-field"><input type="checkbox" name="downstreamVnets" value={s.id} defaultChecked={Boolean(selectedHostSpokeId && s.nvaSpokeIds?.includes(selectedHostSpokeId))} />{t("Azure VNet:")} {s.name} ({s.prefixes.join(', ')})</label>)}
            {topology.sites.filter((s) => s.id !== request.id && !topology.connections.some((c) => c.transport === 'SpokeNVA' && c.siteId === s.id)).map((s) => <label key={s.id} className="checkbox-field"><input type="checkbox" name="downstreamSites" value={s.id} defaultChecked={Boolean(site && topology.siteLinks.some((l) => (l.a === site.id && l.b === s.id) || (l.b === site.id && l.a === s.id)))} />{t("On-premises site:")} {s.name} (AS{s.asn}{s.prefixes.length ? ` · ${s.prefixes.join(', ')}` : ''})</label>)}
          </fieldset>
        </>}
        {request.kind === 'site' && !isSpokeNva && <>
          <Field title={t("Site ASN")}><input name="asn" type="number" required min={1} max={4294967294} defaultValue={site?.asn ?? 65001} /></Field>
          <Field title={t("Originated prefix")}><input name="prefix" defaultValue={site?.prefixes.join(', ') ?? ''} placeholder="10.80.0.0/16, 10.81.0.0/16" /></Field>
          <p className="muted">{t("One or more optional comma-separated IPv4 networks for this site. Leave blank for a transit-only site or explicit connection advertisements.")}</p>
          {connectedSite && <>
            <p className="muted">{t("A connection to")} {topology.hubs.find((h) => h.id === request.hubId)?.name}  {t("is created with site-prefix advertisements enabled.")}</p>
            <Field title={t("Connection name")}><input name="connectionName" maxLength={120} placeholder={t("Defaults to site name + connection")} /></Field>{transport}
          </>}
          {nvaSpokes.length > 0 && <fieldset><legend>{t("Connected NVA spokes")}</legend>
            <p className="muted">{t("Link this on-premises site to one or more spoke BGP NVAs so they exchange BGP routes with it.")}</p>
            {nvaSpokes.map((nvaSpoke) => {
              const peerSiteId = topology.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === nvaSpoke.id)?.siteId
              const linked = Boolean(site && peerSiteId && topology.siteLinks.some((l) => (l.a === site.id && l.b === peerSiteId) || (l.b === site.id && l.a === peerSiteId)))
              return <label key={nvaSpoke.id} className="checkbox-field"><input type="checkbox" name="nvaSpokeIds" value={nvaSpoke.id} defaultChecked={linked || request.nvaSpokeId === nvaSpoke.id} />{nvaSpoke.name}</label>
            })}
          </fieldset>}
        </>}
        {request.kind === 'connection' && <>
          <div className="connection-configuration">
          <Field title={t("On-premises site")}><select name="site" required defaultValue={connection?.siteId ?? request.siteId ?? topology.sites[0]?.id}>{siteOptions}</select></Field>{transport}
          <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={connection?.enabled ?? true} />{t("Connection enabled")}</label>
          <label className="checkbox-field"><input type="checkbox" name="learnSiteRoutes" defaultChecked={connection?.learnSiteRoutes ?? true} />{t("Advertise site-originated and learned routes")}</label>
          <label className="checkbox-field"><input type="checkbox" name="propagateDefaultRoute" defaultChecked={connection?.propagateDefaultRoute ?? false} />{t("Propagate default route (0.0.0.0/0)")}</label>
          <p className="muted">{t("Advertisements are preserved. Route maps belong to the attached hub and site. Unassign their policies before retargeting a connection or making an incompatible transport change.")}</p>
          </div>
          <p className="muted">{t("Use Route maps on either endpoint to configure inbound/outbound policies for this connection.")}</p>
          <p className="muted">{t("Configure VPN static prefixes through Static routing on the site or hub. Remove or reassign site static routes before changing this VPN connection's site or transport.")}</p>
        </>}
        {transportValue === 'SpokeNVA' && request.kind === 'connection' && <fieldset><legend>{t("Spoke NVA BGP peering")}</legend>
          <Field title={t("Hosting spoke")}><select name="spoke" required defaultValue={connection?.spokeId ?? request.spokeId ?? topology.spokes[0]?.id}>{topology.spokes.filter((s) => Boolean(s.hubId)).map((spoke) => <option key={spoke.id} value={spoke.id}>{spoke.name}</option>)}</select></Field>
          <Field title={t("NVA BGP interface IPv4")}><input name="peerIp" defaultValue={connection?.peerIp ?? ''} placeholder="10.50.0.4" /></Field>
          <p className="muted">{t("Use a public or private 2-byte NVA ASN, excluding Azure/IANA reserved ASNs. The peer must be an actual NVA NIC IP in this directly attached spoke, not a loopback. One logical peer represents identical advertisements to both hub router IPs (AS65515); the app does not configure live BGP sessions.")}</p>
          <p className="muted">{t("NVA advertisements start with the NVA ASN. To model downstream networks and return routing, add sites or VNets with owned prefixes and link them to this NVA. Default association/propagation and branch-to-branch enabled are assumed. Apply hub route maps to the hosting VNet connection.")}</p>
          <a href="https://learn.microsoft.com/azure/virtual-wan/scenario-bgp-peering-hub#benefits-and-considerations" target="_blank" rel="noreferrer">{t("Microsoft spoke NVA BGP requirements")}</a>
        </fieldset>}
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
