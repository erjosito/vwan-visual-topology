import { useState } from 'react'
import type { FormEvent } from 'react'
import type { RouteMap, RouteMapRule, Topology } from './model'
import type { Simulation } from './routing'
import { parseAsPath, validateTopology } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

const prefixes = (text: string) => text.trim() === '*' ? [] : text.split(/[,\s]+/).filter(Boolean)

function MapDefinition({ map, onSave }: { map: RouteMap; onSave: (map: RouteMap) => void }) {
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
          prepend: r.action === 'prepend' ? parseAsPath(text(`${r.id}-prepend`)) : [],
          nextStep: text(`${r.id}-next`) as RouteMapRule['nextStep'],
        })),
      })
      setError('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid route map.') }
  }
  return <form className="map-definition" onSubmit={save}>
    <label className="field"><span>Route map name</span><input aria-label="Route map name" name="mapName" required maxLength={120} defaultValue={map.name} /></label>
    {rules.map((r, index) => <fieldset className="map-rule" key={r.id}><legend>Rule {index + 1}</legend>
      <label className="field"><span>Match prefixes (* = all)</span><textarea rows={2} aria-label={`Rule ${index + 1} prefixes`} name={`${r.id}-prefixes`} defaultValue={r.prefixes.join('\n') || '*'} /></label>
      <div className="form-grid"><label className="field"><span>Match mode</span><select aria-label={`Rule ${index + 1} match`} name={`${r.id}-match`} defaultValue={r.match}><option value="equals">Equals</option><option value="contains">Contains</option></select></label>
        <label className="field"><span>Action</span><select aria-label={`Rule ${index + 1} action`} value={r.action} onChange={(e) => setRules(rules.map((rule) => rule.id === r.id ? { ...rule, action: e.target.value as RouteMapRule['action'] } : rule))}><option value="permit">Permit unchanged</option><option value="drop">Block / drop</option><option value="summarize">Summarize</option><option value="prepend">Prepend ASNs</option></select></label></div>
      {r.action === 'summarize' && <label className="field"><span>Summary prefixes</span><textarea aria-label={`Rule ${index + 1} summary prefixes`} name={`${r.id}-summary`} rows={2} defaultValue={r.summaryPrefixes.join('\n')} placeholder="10.0.0.0/8" /></label>}
      {r.action === 'prepend' && <label className="field"><span>Prepend ASNs</span><input aria-label={`Rule ${index + 1} prepend ASNs`} name={`${r.id}-prepend`} defaultValue={r.prepend.join(' ')} placeholder="64496 64496" /></label>}
      <label className="field"><span>After a match</span><select aria-label={`Rule ${index + 1} next step`} name={`${r.id}-next`} defaultValue={r.nextStep}><option value="terminate">Terminate</option><option value="continue">Continue to next rule</option></select></label>
      <div className="row"><button type="button" disabled={index === 0} onClick={() => setRules((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>Move rule {index + 1} up</button><button type="button" className="danger" onClick={() => setRules(rules.filter((rule) => rule.id !== r.id))}>Remove rule {index + 1}</button></div>
    </fieldset>)}
    <div className="row"><button type="button" disabled={rules.length >= 20} onClick={() => setRules([...rules, { id: crypto.randomUUID(), prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }])}>Add rule</button><button className="primary">Save route map</button></div>
    {error && <p role="alert" className="notice error">{error}</p>}
  </form>
}

export function RouteMapsPanel({ topology, simulation, connectionId, onSave, onClose }: {
  topology: Topology; simulation: Simulation; connectionId?: string; onSave: (topology: Topology) => void; onClose: () => void
}) {
  const connection = topology.connections.find((c) => c.id === connectionId)
  const [hubId, setHubId] = useState(connection?.hubId ?? topology.hubs[0]?.id ?? '')
  const [mapId, setMapId] = useState(connection?.inboundMapId ?? connection?.outboundMapId ?? '')
  const [draft, setDraft] = useState<RouteMap>()
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const map = draft ?? topology.routeMaps?.find((m) => m.id === mapId)
  const commit = (next: Topology) => onSave(validateTopology(next))
  const assign = (direction: 'inboundMapId' | 'outboundMapId', id: string) => {
    try {
      const next = structuredClone(topology)
      next.connections.find((c) => c.id === connectionId)![direction] = id || undefined
      commit(next); setError('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid assignment.') }
  }
  return <CanvasOverlay title={connection ? `Route maps · ${connection.name}` : 'Route maps'} className="route-map-panel" onClose={onClose}>
    <p className="muted">Reusable, hub-scoped resources. One map per connection direction; editing a shared map updates every assignment. Unmatched routes are allowed. Summaries clear AS paths; use a following prepend rule to add one. Only prefix matching is modeled.</p>
    {connection && <section className="assignment-panel"><h3>Connection assignments</h3><div className="form-grid">{(['inboundMapId', 'outboundMapId'] as const).map((direction) => <label className="field" key={direction}><span>{direction === 'inboundMapId' ? 'Inbound route map' : 'Outbound route map'}</span><select aria-label={direction === 'inboundMapId' ? 'Inbound route map' : 'Outbound route map'} disabled={connection.transport === 'SDWAN'} value={connection[direction] ?? ''} onChange={(e) => assign(direction, e.target.value)}><option value="">None</option>{topology.routeMaps?.filter((m) => m.hubId === connection.hubId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}</div>
      {connection.transport === 'SDWAN' && <p className="notice">Azure route maps are unsupported on integrated SD-WAN NVA connections.</p>}
      <details><summary>Outbound advertisement preview ({simulation.outbound[connection.id]?.length ?? 0})</summary><div className="table-scroll"><table><thead><tr><th>Prefix</th><th>AS path</th></tr></thead><tbody>{simulation.outbound[connection.id]?.map((r, i) => <tr key={`${r.key}:${i}`}><td>{r.prefix}</td><td>{r.asPath.join(' ') || '—'}</td></tr>)}</tbody></table></div></details>
    </section>}
    <div className="inspector-controls"><label className="field"><span>Route map hub</span><select aria-label="Route map hub" disabled={!!connection} value={hubId} onChange={(e) => { setHubId(e.target.value); setMapId(''); setDraft(undefined); setConfirmDelete(false) }}>{topology.hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <button disabled={!hubId} onClick={() => { setDraft({ id: crypto.randomUUID(), name: 'New route map', hubId, rules: [] }); setMapId(''); setConfirmDelete(false) }}>Create route map</button></div>
    <div className="resource-list">{topology.routeMaps?.filter((m) => m.hubId === hubId).map((m) => <button key={m.id} aria-pressed={map?.id === m.id} onClick={() => { setMapId(m.id); setDraft(undefined); setConfirmDelete(false) }}>{m.name}<small>{m.rules.length} rules · {topology.connections.filter((c) => c.inboundMapId === m.id || c.outboundMapId === m.id).length} connections</small></button>)}</div>
    {map && <><MapDefinition key={map.id} map={map} onSave={(value) => {
      const next = structuredClone(topology)
      next.routeMaps ??= []
      const index = next.routeMaps.findIndex((m) => m.id === value.id)
      if (index < 0) next.routeMaps.push(value)
      else next.routeMaps[index] = value
      commit(next); setDraft(undefined); setMapId(value.id)
    }} />
      {!draft && <div className="delete-resource">{confirmDelete ? <><p>Delete this route map and remove all of its connection assignments?</p><div className="row"><button onClick={() => setConfirmDelete(false)}>Cancel deletion</button><button className="danger" onClick={() => {
        const next = structuredClone(topology)
        next.routeMaps = next.routeMaps?.filter((m) => m.id !== map.id)
        next.connections.forEach((c) => { if (c.inboundMapId === map.id) delete c.inboundMapId; if (c.outboundMapId === map.id) delete c.outboundMapId })
        commit(next); setMapId(''); setConfirmDelete(false)
      }}>Confirm route map deletion</button></div></> : <button className="danger" onClick={() => setConfirmDelete(true)}>Delete route map</button>}</div>}
    </>}
    {!map && <p className="empty">Select a route map or create a reusable policy.</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <p className="muted">Prepend public 2-byte ASNs, excluding Azure-reserved ASNs. 64496–64511 are accepted only for simulation. Outbound maps affect advertisements, not Azure best-path selection.</p>
  </CanvasOverlay>
}
