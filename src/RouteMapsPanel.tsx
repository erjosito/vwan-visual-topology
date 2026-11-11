import { t, localizeDiagnostic } from './i18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { RouteMap, RouteMapRule, RouterSelection, Topology, Transport } from './model'
import type { Simulation } from './routing'
import { parseAsPath, parseHubPrependAsPath, validateTopology } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

const prefixes = (text: string) => text.trim() === '*' ? [] : text.split(/[,\s]+/).filter(Boolean)

export function MapDefinition({ map, onSave }: { map: RouteMap; onSave: (map: RouteMap) => void }) {
  const [rules, setRules] = useState(map.rules)
  const [error, setError] = useState('')
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const data = new FormData(event.currentTarget)
      const text = (name: string) => String(data.get(name) ?? '').trim()
      onSave({
        ...map, name: text('mapName'),
        rules: rules.map((r) => ({
          id: r.id, prefixes: prefixes(text(`${r.id}-prefixes`)), match: text(`${r.id}-match`) as RouteMapRule['match'],
          action: r.action, summaryPrefixes: r.action === 'summarize' ? prefixes(text(`${r.id}-summary`)) : [],
          prepend: r.action === 'prepend' ? (map.hubId ? parseHubPrependAsPath : parseAsPath)(text(`${r.id}-prepend`)) : [],
          nextStep: text(`${r.id}-next`) as RouteMapRule['nextStep'],
        })),
      })
      setError('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid route map.') }
  }
  return <form className="map-definition" onSubmit={save}>
    <label className="field"><span>{t("Route map name")}</span><input aria-label={t("Route map name")} name="mapName" required maxLength={120} defaultValue={map.name} /></label>
    {rules.map((r, index) => <fieldset className="map-rule" key={r.id}><legend>{t("Rule")} {index + 1}</legend>
      <label className="field"><span>{t("Match prefixes (* = all)")}</span><textarea rows={2} aria-label={t("Rule {0} prefixes", index + 1)} name={`${r.id}-prefixes`} defaultValue={r.prefixes.join('\n') || '*'} /></label>
      <div className="form-grid"><label className="field"><span>{t("Match mode")}</span><select aria-label={t("Rule {0} match", index + 1)} name={`${r.id}-match`} defaultValue={r.match}><option value="equals">{t("Equals")}</option><option value="contains">{t("Contains")}</option></select></label>
        <label className="field"><span>{t("Action")}</span><select aria-label={t("Rule {0} action", index + 1)} value={r.action} onChange={(e) => setRules(rules.map((rule) => rule.id === r.id ? { ...rule, action: e.target.value as RouteMapRule['action'] } : rule))}><option value="permit">{t("Permit unchanged")}</option><option value="drop">{t("Block / drop")}</option><option value="summarize">{t("Summarize")}</option><option value="prepend">{t("Prepend ASNs")}</option></select></label></div>
      {r.action === 'summarize' && <label className="field"><span>{t("Summary prefixes")}</span><textarea aria-label={t("Rule {0} summary prefixes", index + 1)} name={`${r.id}-summary`} rows={2} defaultValue={r.summaryPrefixes.join('\n')} placeholder="10.0.0.0/8" /></label>}
      {r.action === 'prepend' && <><label className="field"><span>{t("Prepend ASNs")}</span><input aria-label={t("Rule {0} prepend ASNs", index + 1)} aria-describedby={map.hubId ? `${r.id}-asn-help` : undefined} name={`${r.id}-prepend`} required={!!map.hubId} defaultValue={r.prepend.join(' ')} placeholder={map.hubId ? t('Your public ASN, repeated as needed') : '65001 65001'} /></label>
        {map.hubId && <p id={`${r.id}-asn-help`} className="muted">{t('Use your own public 2-byte ASN in production. Private ASNs (64512-65534), Azure-reserved 8074, 8075 and 12076, 65535 and 4-byte ASNs are not allowed. The app also excludes AS_TRANS 23456. Documentation ASNs (64496-64511) are accepted for lab simulation; Microsoft does not explicitly ban that range in its route-map documentation, and Azure acceptance has not been verified. Repeating a valid ASN is allowed.')}
          {' '}<a href="https://learn.microsoft.com/azure/virtual-wan/route-maps-about#considerations-and-limitations" target="_blank" rel="noreferrer">{t('Microsoft hub route-map ASN restrictions')}</a>
          {' '}<a href="https://www.iana.org/assignments/iana-as-numbers-special-registry/" target="_blank" rel="noreferrer">{t('IANA special-purpose ASN registry')}</a></p>}
      </>}
      <label className="field"><span>{t("After a match")}</span><select aria-label={t("Rule {0} next step", index + 1)} name={`${r.id}-next`} defaultValue={r.nextStep}><option value="terminate">{t("Terminate")}</option><option value="continue">{t("Continue to next rule")}</option></select></label>
      <div className="row"><button type="button" disabled={index === 0} onClick={() => setRules((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>{t("Move rule")} {index + 1}  {t("up")}</button><button type="button" className="danger" onClick={() => setRules(rules.filter((rule) => rule.id !== r.id))}>{t("Remove rule")} {index + 1}</button></div>
    </fieldset>)}
    <div className="row"><button type="button" disabled={rules.length >= 20} onClick={() => setRules([...rules, { id: crypto.randomUUID(), prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }])}>{t("Add rule")}</button><button className="primary">{t("Save route map")}</button></div>
    {error && <p role="alert" className="notice error">{localizeDiagnostic(error)}</p>}
  </form>
}

export function RouteMapsPanel({ topology, simulation, router, connectionId, onRouter, onSave, onClose }: {
  topology: Topology; simulation: Simulation; router?: RouterSelection; connectionId?: string; onRouter: (router: RouterSelection) => void; onSave: (topology: Topology) => void; onClose: () => void
}) {
  const owner: RouterSelection = router ?? (topology.hubs[0] ? { kind: 'hub', id: topology.hubs[0].id } : { kind: 'site', id: topology.sites[0]?.id ?? '' })
  const routerKey = owner.id ? `${owner.kind}:${owner.id}` : ''
  const node = (owner.kind === 'hub' ? topology.hubs : topology.sites).find((n) => n.id === owner.id)
  const owned = (map: RouteMap) => (owner.kind === 'hub' ? map.hubId : map.siteId) === owner.id
  const links: { id: string; name: string; transport?: Transport }[] = [
    ...topology.connections.filter((c) => (owner.kind === 'hub' ? c.hubId === owner.id && c.transport !== 'SpokeNVA' : c.siteId === owner.id)),
    ...(topology.erLinks ?? []).filter((link) => (owner.kind === 'hub' ? link.hubId : link.siteId) === owner.id),
    ...(owner.kind === 'site' ? topology.siteLinks.filter((l) => l.a === owner.id || l.b === owner.id) : []),
    ...(owner.kind === 'hub' ? topology.spokes.filter((spoke) => spoke.hubId === owner.id) : []),
  ]
  const [linkId, setLinkId] = useState(connectionId ?? '')
  const link = links.find((l) => l.id === linkId) ?? links[0]
  const binding = node?.routeMapAssignments?.find((a) => a.connectionId === link?.id)
  const [mapId, setMapId] = useState('')
  const [draft, setDraft] = useState<RouteMap>()
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const map = draft ?? topology.routeMaps?.find((m) => m.id === mapId)
  const mapAttachments = !draft && map
    ? (node?.routeMapAssignments ?? []).flatMap((a) => {
        const linkName = links.find((l) => l.id === a.connectionId)?.name ?? a.connectionId
        const directions = [
          ...(a.inboundMapId === map.id ? [t('Inbound')] : []),
          ...(a.outboundMapId === map.id ? [t('Outbound')] : []),
        ]
        return directions.length ? [`${linkName} (${directions.join(', ')})`] : []
      })
    : []
  const commit = (next: Topology) => onSave(validateTopology(next))
  const assign = (direction: 'inboundMapId' | 'outboundMapId', id: string) => {
    try {
      const next = structuredClone(topology)
      const target = (owner.kind === 'hub' ? next.hubs : next.sites).find((n) => n.id === owner.id)!
      const assignment = { ...binding, connectionId: link.id, [direction]: id || undefined }
      target.routeMapAssignments = [...(target.routeMapAssignments ?? []).filter((a) => a.connectionId !== link.id),
        ...(assignment.inboundMapId || assignment.outboundMapId ? [assignment] : [])]
      commit(next); setError('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid assignment.') }
  }
  return <CanvasOverlay title={node ? t("Route maps · {0}", node.name) : t("Route maps")} className="route-map-panel" onClose={onClose}>
    <p className="muted">{t("Policies belong to this router, with independent assignments on each connection. Inbound means learned by")} {node?.name ?? t("the router")}{t("; outbound means advertised by it. A shared map updates every assignment on this router. Unmatched routes are allowed.")}</p>
    <div className="inspector-controls"><label className="field"><span>{t("Route map router")}</span><select aria-label={t("Route map router")} value={routerKey} onChange={(e) => onRouter({ kind: e.target.value.startsWith('site:') ? 'site' : 'hub', id: e.target.value.slice(e.target.value.indexOf(':') + 1) })}>
      {!topology.hubs.length && !topology.sites.length && <option value="">{t("Add a hub or site first")}</option>}
      <optgroup label={t("Virtual hubs")}>{topology.hubs.map((h) => <option key={h.id} value={`hub:${h.id}`}>{h.name}</option>)}</optgroup><optgroup label={t("On-premises sites")}>{topology.sites.map((s) => <option key={s.id} value={`site:${s.id}`}>{s.name}</option>)}</optgroup>
    </select></label><button disabled={!node} onClick={() => { setDraft({ id: crypto.randomUUID(), name: 'New route map', [owner.kind === 'hub' ? 'hubId' : 'siteId']: owner.id, rules: [] }); setMapId(''); setConfirmDelete(false) }}>{t("Create route map")}</button></div>
    {link && <section className="assignment-panel"><h3>{t("Router connection policies")}</h3>
      <label className="field"><span>{t("Connection")}</span><select aria-label={t("Route map connection")} value={link.id} onChange={(e) => { setLinkId(e.target.value); setError('') }}>{links.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <div className="form-grid">{(['inboundMapId', 'outboundMapId'] as const).map((direction) => <label className="field" key={direction}><span>{direction === 'inboundMapId' ? t("Inbound to {0}", node?.name) : t("Outbound from {0}", node?.name)}</span><select aria-label={direction === 'inboundMapId' ? t("Inbound route map") : t("Outbound route map")} disabled={owner.kind === 'hub' && link.transport === 'SDWAN'} value={binding?.[direction] ?? ''} onChange={(e) => assign(direction, e.target.value)}><option value="">{t("None")}</option>{topology.routeMaps?.filter(owned).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}</div>
      {owner.kind === 'hub' && link.transport === 'SDWAN' && <p className="notice">{t("Azure route maps are unsupported on integrated SD-WAN NVA connections. Site-side policies are separate.")}</p>}
      {owner.kind === 'hub' && topology.spokes.some((spoke) => spoke.id === link.id) && <p className="muted">{t("VNet connection route maps apply to its address spaces and advertisements from all BGP NVAs in that spoke.")}</p>}
      {owner.kind === 'hub' && <details><summary>{t("Outbound advertisement preview (")}{simulation.outbound[link.id]?.length ?? 0})</summary><div className="table-scroll"><table><thead><tr><th>{t("Prefix")}</th><th>{t("AS path")}</th></tr></thead><tbody>{simulation.outbound[link.id]?.map((r, i) => <tr key={`${r.key}:${i}`}><td>{r.prefix}</td><td>{r.asPath.join(' ') || '—'}</td></tr>)}</tbody></table></div></details>}
    </section>}
    <div className="resource-list">{topology.routeMaps?.filter(owned).map((m) => <button key={m.id} aria-pressed={map?.id === m.id} onClick={() => { setMapId(m.id); setDraft(undefined); setConfirmDelete(false) }}>{m.name}<small>{m.rules.length}  {t("rules ·")} {node?.routeMapAssignments?.filter((a) => a.inboundMapId === m.id || a.outboundMapId === m.id).length ?? 0}  {t("connections")}</small></button>)}</div>
    {map && <>
      {!draft && (
        <p className="muted" data-route-map-attachments>
          {mapAttachments.length
            ? `${t("Applied to:")} ${mapAttachments.join(' · ')}`
            : t("Not applied to any connection on this router.")}
        </p>
      )}
      <MapDefinition key={map.id} map={map} onSave={(value) => {
      const next = structuredClone(topology)
      next.routeMaps ??= []
      const index = next.routeMaps.findIndex((m) => m.id === value.id)
      if (index < 0) next.routeMaps.push(value)
      else next.routeMaps[index] = value
      commit(next); setDraft(undefined); setMapId(value.id)
    }} />
      {!draft && <div className="delete-resource">{confirmDelete ? <><p>{mapAttachments.length ? t("Delete route map {0} and remove it from {1}?", map.name, mapAttachments.join(', ')) : t("Delete this route map and remove all of its connection assignments?")}</p><div className="row"><button onClick={() => setConfirmDelete(false)}>{t("Cancel deletion")}</button><button className="danger" onClick={() => {
        const next = structuredClone(topology)
        next.routeMaps = next.routeMaps?.filter((m) => m.id !== map.id)
        for (const router of [...next.hubs, ...next.sites]) {
          router.routeMapAssignments?.forEach((a) => { if (a.inboundMapId === map.id) delete a.inboundMapId; if (a.outboundMapId === map.id) delete a.outboundMapId })
          if (router.routeMapAssignments) router.routeMapAssignments = router.routeMapAssignments.filter((a) => a.inboundMapId || a.outboundMapId)
        }
        commit(next); setMapId(''); setConfirmDelete(false)
      }}>{t("Confirm route map deletion")}</button></div></> : <button className="danger" onClick={() => setConfirmDelete(true)}>{t("Delete route map")}</button>}</div>}
    </>}
    {!map && <p className="empty">{t("Select a route map or create a reusable policy.")}</p>}
    {error && <p role="alert" className="notice error">{localizeDiagnostic(error)}</p>}
    <p className="muted">{owner.kind === 'hub' ? t("Hub prepend rules use non-private 2-byte ASNs, excluding Azure-reserved ASNs and AS_TRANS. Documentation ASNs are available for simulation, not production ASN guidance. VNet connection policies include spoke NVA advertisements; inter-hub policies are not simulated.") : t("Site policies accept private and 32-bit ASNs, and apply to hub connections and on-premises links. They are independent of Azure-side policies.")}  {t("Summaries retain known forwarding destinations; aggregate holes are not treated as reachable. Static VPN entries bypass BGP policies.")}</p>
  </CanvasOverlay>
}
