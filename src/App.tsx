import { cloneElement, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { example, objectLabels, preferenceLabels, routeLabels, topologyObject, transportLabels } from './model'
import type { Advertisement, ObjectSelection, Preference, RouteKind, Topology, Transport } from './model'
import { simulate, traceFlow } from './routing'
import type { Candidate, FlowPath } from './routing'
import { cidr, ipv4, parseAsPath, validateTopology } from './validation'
import { TopologyDiagram } from './TopologyDiagram'
import type { DiagramContextMenu } from './TopologyDiagram'
import { AdvancedEditor } from './AdvancedEditor'
import { TopologyObjectEditor } from './TopologyObjectEditor'
import type { EditorRequest } from './TopologyObjectEditor'
import { TopologyContextMenu } from './TopologyContextMenu'
import type { ContextAction } from './TopologyContextMenu'
import './App.css'

const storageKey = 'vwan-visual-topology:v1'
const uid = () => crypto.randomUUID()
const message = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error.'
const label = (route: Candidate) => route.transport === 'VNet' ? 'VNet connection' : route.transport === 'Firewall' ? 'Azure Firewall' : route.transport === 'Internet' ? 'Internet' : transportLabels[route.transport]
const kindLabel = (route: Candidate) => route.kind === 'system' ? 'System route' : route.kind === 'policy' ? 'Routing intent' : routeLabels[route.kind]

function Field({ title, children }: { title: string; children: ReactElement<{ 'aria-label'?: string }> }) {
  return <label className="field"><span>{title}</span>{cloneElement(children, { 'aria-label': title })}</label>
}

interface RouteRow {
  key: string; asPath: number[]; preferred: boolean; nextHop?: string; via?: string; source: string; kind: string
}
interface RouteGroup { prefix: string; candidates: RouteRow[]; preferredCount: number; explanation: string[] }

function App() {
  const [initial] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return { topology: saved ? validateTopology(JSON.parse(saved)) : structuredClone(example), error: '' }
    } catch (error) {
      return { topology: structuredClone(example), error: `Saved topology could not be loaded: ${message(error)}. The example is shown; the saved data has not been overwritten.` }
    }
  })
  const [topology, setTopology] = useState(initial.topology)
  const [error, setError] = useState(initial.error)
  const [saveError, setSaveError] = useState('')
  const [selectedHub, setSelectedHub] = useState(initial.topology.hubs[0]?.id ?? '')
  const [inspectedSiteId, setInspectedSiteId] = useState('')
  const [selectedPrefix, setSelectedPrefix] = useState('')
  const [activeTab, setActiveTab] = useState<'hubs' | 'sites' | 'spokes' | 'connections'>('connections')
  const [showRoutes, setShowRoutes] = useState(true)
  const [routeView, setRouteView] = useState<'hub' | 'firewall'>('hub')
  const [destination, setDestination] = useState('10.30.0.25')
  const [source, setSource] = useState('')
  const [tracing, setTracing] = useState(false)
  const [editingConnection, setEditingConnection] = useState('')
  const [selection, setSelection] = useState<ObjectSelection | undefined>(initial.topology.hubs[0] ? { kind: 'hub', id: initial.topology.hubs[0].id } : undefined)
  const [editorRequest, setEditorRequest] = useState<EditorRequest>()
  const [contextMenu, setContextMenu] = useState<DiagramContextMenu>()
  const [status, setStatus] = useState('')
  const importer = useRef<HTMLInputElement>(null)

  const simulation = useMemo(() => simulate(topology), [topology])
  const hubId = topology.hubs.some((h) => h.id === selectedHub) ? selectedHub : topology.hubs[0]?.id ?? ''
  const hub = topology.hubs.find((h) => h.id === hubId)
  const inspectedSite = topology.sites.find((site) => site.id === inspectedSiteId) ?? (!hub ? topology.sites[0] : undefined)
  const activeRouteView = routeView === 'firewall' && (hub?.routingIntent.private || hub?.routingIntent.internet) ? 'firewall' : 'hub'
  const decisions = (activeRouteView === 'firewall' ? simulation.firewallTables : simulation.tables)[hubId] ?? []
  const routeGroups: RouteGroup[] = inspectedSite ? [...new Set(simulation.siteCandidates[inspectedSite.id].map((route) => route.prefix))]
    .sort((a, b) => cidr(a)!.network - cidr(b)!.network || cidr(a)!.length - cidr(b)!.length)
    .map((prefix) => {
      const candidates = simulation.siteCandidates[inspectedSite.id].filter((route) => route.prefix === prefix)
      const preferred = simulation.siteTables[inspectedSite.id].filter((route) => route.prefix === prefix)
      const selectedKeys = new Set(preferred.map((route) => `${route.key}:${route.sitePath.join(':')}`))
      const shortest = Math.min(...preferred.map((route) => route.asPath.length))
      return {
        prefix, preferredCount: preferred.length,
        candidates: candidates.map((route) => {
          const key = `${route.key}:${route.sitePath.join(':')}`
          const hops = route.sitePath.slice(1).map((id) => topology.sites.find((site) => site.id === id)?.name)
          return {
            key, asPath: route.asPath, preferred: selectedKeys.has(key), nextHop: hops[0] ?? 'Local origin',
            via: hops.length ? hops.join(' → ') : topology.connections.find((c) => route.key.startsWith(`${c.id}:`))?.name,
            source: hops.length ? 'On-premises BGP' : 'Originated at site', kind: 'BGP',
          }
        }),
        explanation: candidates.length === 1 ? ['Only available path.'] : [
          `Shortest site AS path (${shortest} ASNs).`,
          ...(preferred.length > 1 ? [`${preferred.length} equal-cost paths remain.`] : []),
          ...(candidates.filter((route) => route.asPath.length === shortest).length > preferred.length ? ['The model selects up to 32 equal-cost site paths.'] : []),
        ],
      }
    }) : decisions.map((decision) => ({
      prefix: decision.prefix, preferredCount: decision.selected.length, explanation: decision.explanation,
      candidates: decision.candidates.map((route) => {
        const nextHop = (topology.connections.find((c) => c.id === route.connectionId) ?? topology.spokes.find((s) => s.id === route.connectionId))?.name
        return {
          key: route.key, asPath: route.asPath, preferred: decision.selected.some((selected) => selected.key === route.key),
          nextHop: route.remote ? topology.hubs.find((h) => h.id === route.originHubId)?.name : route.transport === 'Firewall' ? 'Azure Firewall' : route.transport === 'Internet' ? 'Internet egress' : nextHop,
          via: route.remote ? nextHop : undefined, source: route.remote ? `Remote hub · ${label(route)}` : label(route), kind: kindLabel(route),
        }
      }),
    }))
  const highlightPrefixes = inspectedSite ? routeGroups.map((group) => group.prefix) : [...new Set([...(simulation.tables[hubId] ?? []), ...(simulation.firewallTables[hubId] ?? [])].map((d) => d.prefix))]
  const validSource = topology.spokes.find((s) => s.id === source)
  const paths = tracing ? traceFlow(topology, simulation, validSource?.hubId ?? hubId, destination) : []
  const connection = topology.connections.find((c) => c.id === editingConnection)
  const selectedObject = selection && topologyObject(topology, selection)
  const highlightedRoutes = [
    ...decisions.filter((d) => !selectedPrefix || d.prefix === selectedPrefix).flatMap((d) => d.selected),
    ...(activeRouteView === 'hub' && hub?.routingIntent.private ? (simulation.firewallTables[hubId] ?? []).filter((d) => !selectedPrefix || d.prefix === selectedPrefix).flatMap((d) => d.selected) : []),
  ]
  const persist = (next: Topology) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setSaveError('')
    } catch {
      setSaveError('Browser storage is unavailable or full. Export JSON to preserve your topology.')
    }
  }

  const saveTopology = (next: Topology) => {
    setTopology(next)
    persist(next)
    setError('')
    setStatus('')
  }
  const update = (mutate: (next: Topology) => void) => {
    try {
      const next = structuredClone(topology)
      mutate(next)
      saveTopology(validateTopology(next))
    } catch (error) { setError(message(error)) }
  }
  const submit = (event: FormEvent<HTMLFormElement>, action: (data: FormData) => void) => {
    event.preventDefault()
    try {
      action(new FormData(event.currentTarget))
    } catch (error) { setError(message(error)) }
  }
  const chooseHub = (id: string) => {
    setSelectedHub(id)
    setInspectedSiteId('')
    setSelection({ kind: 'hub', id })
    setSelectedPrefix('')
    setRouteView('hub')
    setTracing(false)
  }
  const chooseSite = (id: string) => {
    setInspectedSiteId(id)
    setSelection({ kind: 'site', id })
    setSelectedPrefix('')
    setTracing(false)
  }
  const selectObject = (value: ObjectSelection) => {
    if (value.kind === 'hub') chooseHub(value.id)
    if (value.kind === 'spoke') chooseHub(topology.spokes.find((s) => s.id === value.id)!.hubId)
    if (value.kind === 'connection') {
      chooseHub(topology.connections.find((c) => c.id === value.id)!.hubId)
      setActiveTab('connections')
      setEditingConnection(value.id)
    }
    setSelection(value)
  }
  const showSettings = (id: string) => {
    const element = document.getElementById(id)
    if (element instanceof HTMLDetailsElement) element.open = true
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const showBgpRoutes = (kind: 'hub' | 'site', id: string, firewall = false) => {
    if (kind === 'hub') chooseHub(id)
    else chooseSite(id)
    setShowRoutes(true)
    setRouteView(firewall ? 'firewall' : 'hub')
    requestAnimationFrame(() => showSettings('bgp-routes'))
  }
  const contextSelection = contextMenu?.selection
  const contextObject = contextSelection && topologyObject(topology, contextSelection)
  const contextActions: ContextAction[] = contextSelection ? [
    { label: 'Edit configuration', run: () => setEditorRequest(contextSelection) },
    ...(contextSelection.kind === 'hub' ? [
      { label: 'Show BGP routes', run: () => showBgpRoutes('hub', contextSelection.id) },
      ...(topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.private || topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.internet ? [
        { label: 'Show firewall routes', run: () => showBgpRoutes('hub', contextSelection.id, true) },
      ] : []),
      { label: 'Add spoke', run: () => setEditorRequest({ kind: 'spoke', hubId: contextSelection.id }) },
      { label: 'Add connected site', run: () => setEditorRequest({ kind: 'site', hubId: contextSelection.id }) },
      { label: 'Connect existing site', disabled: !topology.sites.length, run: () => setEditorRequest({ kind: 'connection', hubId: contextSelection.id }) },
    ] : []),
    ...(contextSelection.kind === 'site' ? [
      { label: 'Show BGP routes', run: () => showBgpRoutes('site', contextSelection.id) },
      { label: 'Connect to hub', disabled: !topology.hubs.length, run: () => setEditorRequest({ kind: 'connection', siteId: contextSelection.id }) },
      { label: 'Link to another site', disabled: topology.sites.length < 2, run: () => setEditorRequest({ kind: 'siteLink', siteId: contextSelection.id }) },
    ] : []),
    ...(contextSelection.kind === 'connection' ? [
      { label: 'Route maps', run: () => setEditorRequest({ ...contextSelection, routeMaps: true }) },
      { label: 'Edit advertisements', run: () => requestAnimationFrame(() => showSettings('connection-advertisements')) },
    ] : []),
    { label: `Delete ${objectLabels[contextSelection.kind]}`, danger: true, run: () => setEditorRequest({ ...contextSelection, deleting: true }) },
  ] : []
  const exportTopology = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(topology, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'vwan-topology.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importTopology = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('Topology files must be smaller than 2 MB.')
      const next = validateTopology(JSON.parse(await file.text()))
      setTopology(next)
      setSelectedHub(next.hubs[0]?.id ?? '')
      setInspectedSiteId('')
      setSelectedPrefix('')
      setEditingConnection('')
      setSelection(undefined)
      setEditorRequest(undefined)
      setSource('')
      setTracing(false)
      persist(next)
      setError('')
      setStatus('Topology imported.')
    } catch (error) { setError(`Import rejected: ${message(error)}`) }
  }
  const editRoute = (route: Advertisement, key: 'prefix' | 'asPath', value: string) => {
    try {
      const parsed = key === 'asPath' ? parseAsPath(value) : value
      update((next) => {
        const target = next.connections.find((c) => c.id === connection!.id)!.routes.find((r) => r.id === route.id)!
        if (key === 'prefix') target.prefix = parsed as string
        else target.asPath = parsed as number[]
      })
    } catch (error) { setError(message(error)) }
  }
  const pathTitle = (path: FlowPath) => [
    validSource?.name ?? 'Azure source',
    ...path.hubs.flatMap((id) => [topology.hubs.find((h) => h.id === id)?.name, ...(path.firewalls?.includes(id) ? ['Azure Firewall'] : [])]),
    topology.connections.find((c) => c.id === path.connectionId)?.name,
    ...(path.siteHops?.map((id) => topology.sites.find((s) => s.id === id)?.name) ?? [topology.sites.find((s) => s.id === path.siteId)?.name ?? topology.spokes.find((s) => s.id === path.siteId)?.name]),
  ].filter(Boolean).join(' → ')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><div className="brand-icon" aria-hidden="true">W</div><div><h1>Virtual WAN <span>Topology Lab</span></h1><p>Design the network. Understand the path.</p></div></div>
        <div className="actions">
          <span className="local-badge">Local-first · no Azure credentials</span>
          <button onClick={exportTopology}>Export JSON</button>
          <button onClick={() => importer.current?.click()}>Import JSON</button>
          <input ref={importer} hidden type="file" accept=".json,application/json" aria-label="Import topology file" onChange={(e) => { void importTopology(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </header>
      <main>
        <section className="workspace-heading">
          <div><p className="eyebrow">NETWORK WORKSPACE</p><input className="topology-name" aria-label="Topology name" value={topology.name} maxLength={120} onChange={(e) => update((next) => { next.name = e.target.value })} /></div>
          <div className="stats"><span><strong>{topology.hubs.length}</strong> hubs</span><span><strong>{topology.spokes.length}</strong> spokes</span><span><strong>{topology.sites.length}</strong> sites</span><span><strong>{topology.connections.filter((c) => c.enabled).length}</strong> active links</span></div>
        </section>
        {error && <div role="alert" className="notice error">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>Dismiss</button></div>}
        {saveError && <div role="alert" className="notice error">{saveError}</div>}
        {status && <div role="status" className="notice">{status}</div>}
        <div className="workspace">
          <aside className="panel editor">
            <div className="panel-heading"><div><p className="eyebrow">BUILD</p><h2>Topology editor</h2></div><span className="count-badge">01</span></div>
            <div className="tabs" role="tablist" aria-label="Topology editor">
              {(['hubs', 'spokes', 'sites', 'connections'] as const).map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab === 'connections' ? 'Links' : tab[0].toUpperCase() + tab.slice(1)}</button>)}
            </div>
            <div className="editor-content">
              {activeTab === 'hubs' && <>
                <p className="muted">Standard VWAN hubs are fully meshed. Removing a hub also removes its spokes and links.</p>
                {topology.hubs.map((item) => <div className={`entity-card ${item.id === hubId ? 'selected' : ''}`} key={item.id}>
                  <button className="entity-title" onClick={() => { chooseHub(item.id); setEditorRequest({ kind: 'hub', id: item.id }) }}>{item.name}</button><span className="muted">{item.region}</span>
                  <span className="muted">Routing intent: {[item.routingIntent.private && 'Private', item.routingIntent.internet && 'Internet'].filter(Boolean).join(' + ') || 'Off'}</span>
                  <button className="small" aria-label={`Edit configuration ${item.name}`} onClick={() => { chooseHub(item.id); setEditorRequest({ kind: 'hub', id: item.id }) }}>Edit configuration</button>
                  <Field title={`Routing preference: ${item.name}`}><select value={item.preference} onChange={(e) => update((next) => { next.hubs.find((h) => h.id === item.id)!.preference = e.target.value as Preference })}>{Object.entries(preferenceLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
                  <button className="danger small" onClick={() => setEditorRequest({ kind: 'hub', id: item.id, deleting: true })}>Remove hub</button>
                </div>)}
                <form onSubmit={(e) => submit(e, (data) => update((next) => { next.hubs.push({ id: uid(), name: String(data.get('name')), region: String(data.get('region')), preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }) }))}>
                  <h3>Add a hub</h3><Field title="Hub name"><input name="name" required maxLength={120} placeholder="Asia Pacific hub" /></Field>
                  <Field title="Region"><input name="region" required maxLength={120} placeholder="Southeast Asia" /></Field><button className="primary">Add hub</button>
                </form>
              </>}
              {activeTab === 'sites' && <>
                <p className="muted">Each site can have multiple connections, including links to different hubs.</p>
                {topology.sites.map((site) => <div className="entity-card" key={site.id}><button className="entity-title" onClick={() => setEditorRequest({ kind: 'site', id: site.id })}>{site.name}</button><span className="muted">ASN {site.asn}</span><button className="small" aria-label={`Edit configuration ${site.name}`} onClick={() => setEditorRequest({ kind: 'site', id: site.id })}>Edit configuration</button><button className="danger small" onClick={() => setEditorRequest({ kind: 'site', id: site.id, deleting: true })}>Remove site and links</button></div>)}
                <form onSubmit={(e) => submit(e, (data) => update((next) => { next.sites.push({ id: uid(), name: String(data.get('name')), asn: Number(data.get('asn')), prefixes: String(data.get('prefixes')).split(/[,\s]+/).filter(Boolean) }) }))}><h3>Add on-premises site</h3><Field title="Site name"><input name="name" required maxLength={120} placeholder="Singapore office" /></Field><Field title="Site ASN"><input name="asn" type="number" min={1} max={4294967294} required defaultValue={65001} /></Field><Field title="Originated prefixes"><textarea name="prefixes" rows={3} placeholder={'10.80.0.0/16\n10.81.0.0/16'} /></Field><p className="muted">One IPv4 prefix per line; commas or spaces also work.</p><button className="primary">Add site</button></form>
              </>}
              {activeTab === 'spokes' && <>
                <p className="muted">Spoke prefixes become system routes and propagate between hubs.</p>
                {topology.spokes.map((spoke) => <div className="entity-card" key={spoke.id}><button className="entity-title" onClick={() => setEditorRequest({ kind: 'spoke', id: spoke.id })}>{spoke.name}</button><span className="muted">{topology.hubs.find((h) => h.id === spoke.hubId)?.name}</span>
                  <Field title={`Prefixes: ${spoke.name}`}><input key={spoke.prefixes.join(',')} defaultValue={spoke.prefixes.join(', ')} onBlur={(e) => update((next) => { next.spokes.find((s) => s.id === spoke.id)!.prefixes = e.target.value.split(/[,\s]+/).filter(Boolean) })} /></Field>
                  <button className="danger small" onClick={() => setEditorRequest({ kind: 'spoke', id: spoke.id, deleting: true })}>Remove spoke</button>
                </div>)}
                <form onSubmit={(e) => submit(e, (data) => update((next) => { next.spokes.push({ id: uid(), name: String(data.get('name')), hubId: String(data.get('hub')), prefixes: String(data.get('prefixes')).split(/[,\s]+/).filter(Boolean) }) }))}>
                  <h3>Add a spoke VNet</h3><Field title="Spoke name"><input name="name" required maxLength={120} placeholder="Production VNet" /></Field>
                  <Field title="Spoke hub"><select name="hub" required>{topology.hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
                  <Field title="Spoke prefixes"><input name="prefixes" required placeholder="10.50.0.0/16, 10.51.0.0/16" /></Field><button className="primary" disabled={!topology.hubs.length}>Add spoke</button>
                </form>
              </>}
              {activeTab === 'connections' && <>
                <p className="muted">Select a link to edit its advertisements. Toggle it off to simulate a failure.</p>
                {topology.connections.map((item) => <div className={`entity-card ${connection?.id === item.id ? 'selected' : ''}`} key={item.id}>
                  <div className="row"><button className="entity-title" onClick={() => selectObject({ kind: 'connection', id: item.id })}>{item.name}</button><label className="switch"><input type="checkbox" aria-label={`Enable ${item.name}`} checked={item.enabled} onChange={(e) => update((next) => { next.connections.find((c) => c.id === item.id)!.enabled = e.target.checked })} /><span>{item.enabled ? 'Up' : 'Down'}</span></label></div>
                  <span className={`transport ${item.transport}`}>{transportLabels[item.transport]}</span><span className="muted">{topology.hubs.find((h) => h.id === item.hubId)?.name} · {item.routes.length} routes</span>
                </div>)}
                <form onSubmit={(e) => submit(e, (data) => {
                  const id = uid()
                  update((next) => { next.connections.push({ id, name: String(data.get('name')), hubId: String(data.get('hub')), siteId: String(data.get('site')), transport: String(data.get('transport')) as Transport, enabled: true, routes: [], learnSiteRoutes: false, inbound: [], outbound: [] }) })
                  setEditingConnection(id)
                })}>
                  <h3>Add a connection</h3><Field title="Connection name"><input name="name" required maxLength={120} placeholder="Branch primary" /></Field>
                  <Field title="Connection hub"><select name="hub" required>{topology.hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
                  <Field title="On-premises site"><select name="site" required>{topology.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                  <Field title="Transport"><select name="transport">{Object.entries(transportLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
                  <button className="primary" disabled={!topology.hubs.length || !topology.sites.length}>Add connection</button>
                </form>
              </>}
            </div>
          </aside>
          <div className="main-column">
            <section className="panel topology-panel">
              <div className="panel-heading"><div><p className="eyebrow">EXPLORE</p><h2>Network topology</h2></div><span className="live-dot">{simulation.converged ? 'Routes calculated' : 'Not converged'}</span></div>
              <div className="diagram-toolbar">
                <span>Right-click for object actions, or select an object below</span>
                <label>Highlight prefix <select aria-label="Highlight prefix" value={highlightPrefixes.includes(selectedPrefix) ? selectedPrefix : ''} onChange={(e) => { setSelectedPrefix(e.target.value); setTracing(false) }}><option value="">All routes</option>{highlightPrefixes.map((prefix) => <option key={prefix}>{prefix}</option>)}</select></label>
              </div>
              <div className="topology-actions">
                <button aria-label="Add hub from topology" onClick={() => setEditorRequest({ kind: 'hub' })}>+ Add hub</button>
                <button aria-label="Add site from topology" onClick={() => setEditorRequest({ kind: 'site' })}>+ Add site</button>
                {selectedObject && selection ? <div className="object-actions" role="region" aria-label="Selected topology object">
                  <strong>{selectedObject.name}</strong>
                  <button onClick={() => setEditorRequest(selection)}>Edit {objectLabels[selection.kind]}</button>
                  <button className="danger" onClick={() => setEditorRequest({ ...selection, deleting: true })}>Delete {objectLabels[selection.kind]}</button>
                  {selection.kind === 'hub' && <>
                    <button onClick={() => setEditorRequest({ kind: 'spoke', hubId: selection.id })}>+ Add spoke</button>
                    <button onClick={() => setEditorRequest({ kind: 'site', hubId: selection.id })}>+ Add connected site</button>
                    <button disabled={!topology.sites.length} onClick={() => setEditorRequest({ kind: 'connection', hubId: selection.id })}>+ Connect existing site</button>
                    <button onClick={() => setEditorRequest(selection)}>Routing intent</button>
                  </>}
                  {selection.kind === 'site' && <>
                    <button disabled={!topology.hubs.length} onClick={() => setEditorRequest({ kind: 'connection', siteId: selection.id })}>+ Connect to hub</button>
                    <button disabled={topology.sites.length < 2} onClick={() => setEditorRequest({ kind: 'siteLink', siteId: selection.id })}>+ Link to another site</button>
                  </>}
                  {selection.kind === 'connection' && <><button onClick={() => showSettings('connection-advertisements')}>Advertisements</button><button onClick={() => setEditorRequest({ ...selection, routeMaps: true })}>Route maps</button></>}
                </div> : <span className="muted">Select a node or link for more actions. Enter and Space work too.</span>}
              </div>
              <TopologyDiagram topology={topology} hubId={inspectedSite && !tracing ? '' : hubId} selected={inspectedSite ? [] : highlightedRoutes} preferredSitePaths={inspectedSite ? simulation.siteTables[inspectedSite.id].filter((route) => !selectedPrefix || route.prefix === selectedPrefix).map((route) => route.sitePath) : undefined} paths={paths} sourceSpokeId={tracing ? validSource?.id : undefined} tracing={tracing} selection={selectedObject ? selection : undefined} onObjectClick={selectObject} onObjectContextMenu={(value) => { selectObject(value.selection); setContextMenu(value) }} />
              <div className="legend"><span><i className="legend-line er" />ExpressRoute</span><span><i className="legend-line vpn" />VPN</span><span><i className="legend-line sdwan" />SD-WAN</span><span><i className="legend-line preferred" />Preferred / flow path</span><span><i className="legend-line alternative" />Alternative / idle</span></div>
            </section>
            <AdvancedEditor topology={topology} hubId={hubId} connectionId={connection?.id} simulation={simulation} update={update} onError={setError} />
            {connection && <section id="connection-advertisements" className="panel advertisements">
              <div className="panel-heading"><div><p className="eyebrow">ADVERTISEMENTS</p><h2>{connection.name}</h2><p className="muted">{transportLabels[connection.transport]} · Enter AS paths exactly as received by the hub, including provider ASNs.</p></div><button onClick={() => setEditingConnection('')}>Close</button></div>
              <div className="route-editor">
                {connection.routes.map((route) => <div className="route-edit-row" key={route.id}>
                  <Field title="Advertised prefix"><input key={route.prefix} defaultValue={route.prefix} onBlur={(e) => editRoute(route, 'prefix', e.target.value)} /></Field>
                  <Field title="Route type"><select value={route.kind} onChange={(e) => update((next) => {
                    const target = next.connections.find((c) => c.id === connection.id)!.routes.find((r) => r.id === route.id)!
                    target.kind = e.target.value as RouteKind
                    target.asPath = target.kind === 'bgp' ? [65001] : []
                  })}>{Object.entries(routeLabels).filter(([key]) => key === 'bgp' || connection.transport === 'VPN').map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
                  <Field title="Received AS path"><input key={route.asPath.join(' ')} disabled={route.kind !== 'bgp'} defaultValue={route.asPath.join(' ')} placeholder={route.kind === 'bgp' ? '12076 65001' : 'Not applicable'} onBlur={(e) => editRoute(route, 'asPath', e.target.value)} /></Field>
                  <button className="danger small" aria-label={`Remove route ${route.prefix}`} onClick={() => update((next) => { const c = next.connections.find((c) => c.id === connection.id)!; c.routes = c.routes.filter((r) => r.id !== route.id) })}>Remove</button>
                </div>)}
                {!connection.routes.length && <p className="muted">No routes yet. This link is visible but cannot carry routed traffic.</p>}
                <div className="row"><button onClick={() => update((next) => { next.connections.find((c) => c.id === connection.id)!.routes.push({ id: uid(), prefix: '10.99.0.0/16', kind: 'bgp', asPath: [65001] }) })}>Add advertised route</button><button onClick={() => setEditorRequest({ kind: 'connection', id: connection.id })}>Edit connection details</button><button className="danger" onClick={() => setEditorRequest({ kind: 'connection', id: connection.id, deleting: true })}>Delete connection</button></div>
              </div>
            </section>}
            <section className="panel flow-panel">
              <div className="panel-heading"><div><p className="eyebrow">FOLLOW THE PACKET</p><h2>Azure-to-on-premises flow</h2></div><span className="count-badge">02</span></div>
              <form className="flow-form" onSubmit={(e) => { e.preventDefault(); setTracing(true) }}>
                <Field title="Azure source"><select aria-label="Azure source" value={validSource?.id ?? ''} onChange={(e) => { setSource(e.target.value); setTracing(false) }}><option value="">Selected hub: {hub?.name ?? 'none'}</option>{topology.spokes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field title="Destination IPv4"><input aria-label="Destination IPv4" value={destination} onChange={(e) => { setDestination(e.target.value); setTracing(false) }} placeholder="10.30.0.25" /></Field>
                <button className="primary" disabled={ipv4(destination) === undefined || !hub || !simulation.converged}>Trace flow</button>
              </form>
              {ipv4(destination) === undefined && <p role="status" className="error-text">Enter a valid IPv4 address.</p>}
              {tracing && <div className="flow-results" aria-live="polite">
                {paths.map((path, i) => <article className={`flow-result ${path.status}`} key={i}><strong>{path.status === 'delivered' ? 'Reachable' : path.status === 'loop' ? 'Forwarding loop' : 'No route'}{paths.length > 1 ? ` · path ${i + 1}` : ''}</strong><p>{pathTitle(path)}</p><details><summary>Why this path?</summary><ol>{path.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details></article>)}
                {paths.length >= 128 && <p className="notice">Showing the first 128 ECMP branches. Additional combinations may exist.</p>}
              </div>}
            </section>
            <section id="bgp-routes" className="panel effective-routes">
              <div className="panel-heading"><div><p className="eyebrow">INSPECT</p><h2>BGP routes{inspectedSite || hub ? ` · ${inspectedSite?.name ?? hub?.name}` : ''}</h2></div><button aria-expanded={showRoutes} onClick={() => setShowRoutes(!showRoutes)}>{showRoutes ? 'Hide BGP routes' : 'Show BGP routes'}</button></div>
              {showRoutes && <>
                <div className="route-controls"><Field title="Inspect router"><select value={inspectedSite ? `site:${inspectedSite.id}` : hub ? `hub:${hubId}` : ''} onChange={(e) => { if (e.target.value.startsWith('hub:')) chooseHub(e.target.value.slice(4)); else chooseSite(e.target.value.slice(5)) }}><optgroup label="Virtual hubs">{topology.hubs.map((h) => <option key={h.id} value={`hub:${h.id}`}>{h.name}</option>)}</optgroup><optgroup label="On-premises sites">{topology.sites.map((site) => <option key={site.id} value={`site:${site.id}`}>{site.name}</option>)}</optgroup>{!topology.hubs.length && !topology.sites.length && <option value="">No routers</option>}</select></Field>
                  {hub && !inspectedSite && <Field title="Hub routing preference"><select aria-label="Hub routing preference" value={hub.preference} onChange={(e) => update((next) => { next.hubs.find((h) => h.id === hubId)!.preference = e.target.value as Preference })}>{Object.entries(preferenceLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>}
                  {!inspectedSite && <Field title="Route view"><select value={activeRouteView} onChange={(e) => { setRouteView(e.target.value as 'hub' | 'firewall'); setSelectedPrefix('') }}><option value="hub">Hub routing table</option><option value="firewall" disabled={!hub?.routingIntent.private && !hub?.routingIntent.internet}>Azure Firewall</option></select></Field>}
                  <span className="muted">{inspectedSite ? 'Site' : activeRouteView === 'hub' ? 'Hub' : 'Firewall'} · {routeGroups.length} prefixes · {routeGroups.reduce((count, decision) => count + decision.candidates.length, 0)} paths</span>
                </div>
                <p className="route-legend"><strong>* Preferred</strong> · Unmarked paths are alternatives. All equal-cost preferred paths are marked.</p>
                {!inspectedSite && <p className="route-legend">Includes BGP candidates and applicable spoke/system, VPN static and routing-intent entries, identified in the Source column.</p>}
                <div className="table-scroll"><table><thead><tr><th>State</th><th>Destination</th><th>Next hop</th><th>Source</th><th>AS path</th><th>Selection reason (per prefix)</th></tr></thead><tbody>
                  {routeGroups.flatMap((decision) => {
                    const candidates = [...decision.candidates].sort((a, b) => Number(b.preferred) - Number(a.preferred))
                    return candidates.map((route, index) => {
                      const preferred = route.preferred
                      return <tr key={`${decision.prefix}:${route.key}`} data-prefix={decision.prefix} data-preferred={preferred} className={`${preferred ? 'preferred-route' : 'alternative-route'} ${selectedPrefix === decision.prefix ? 'active-route' : ''}`}>
                        <td className="route-state">{preferred ? '* Preferred' : 'Alternative'}{preferred && decision.preferredCount > 1 && <span className="ecmp">ECMP ×{decision.preferredCount}</span>}</td>
                        <td><button className="prefix-button" onClick={() => { setSelectedPrefix(decision.prefix); setTracing(false) }}>{decision.prefix}</button></td>
                        <td>{route.nextHop}{route.via && <small>Via {route.via}</small>}</td>
                        <td>{route.source}<small>{route.kind}</small></td>
                        <td className="as-path">{route.asPath.join(' ') || '—'}</td>
                        {index === 0 && <td className="selection-reason" rowSpan={candidates.length}><strong>{candidates.length} candidate{candidates.length === 1 ? '' : 's'} · {decision.preferredCount} preferred</strong><p>{decision.explanation.join(' ')}</p></td>}
                      </tr>
                    })
                  })}
                </tbody></table>{!routeGroups.length && <p className="empty">Add a hub or site with advertised prefixes to begin.</p>}</div>
              </>}
            </section>
            <section className="panel model-notes">
              <h2>Planning model, not an Azure control plane</h2><p>One Standard Virtual WAN with fully meshed hubs. Without routing intent, connections associate and propagate to Default. Private routing intent uses separate hub policy and firewall forwarding tables. Firewall rules, SNAT, return-flow symmetry, custom route tables, Global Reach, shared-circuit reflection, and failback timing are not simulated. Default routes are not propagated inter-hub. Route maps support ordered, first-match prefix rules and AS-path prepend only; outbound maps affect advertisements, not Azure best-path selection.</p>
              {simulation.warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}
              <p><a href="https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference" target="_blank" rel="noreferrer">Hub routing preference reference ↗</a><a href="https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive" target="_blank" rel="noreferrer">Routing deep dive ↗</a></p>
              <p><a href="https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies" target="_blank" rel="noreferrer">Routing intent reference ↗</a><a href="https://learn.microsoft.com/azure/virtual-wan/route-maps-about" target="_blank" rel="noreferrer">Route-map limitations ↗</a></p>
              <button onClick={() => { const next = structuredClone(example); setTopology(next); persist(next); setSelectedHub(example.hubs[0].id); setInspectedSiteId(''); setSelectedPrefix(''); setSource(''); setEditingConnection(''); setSelection(undefined); setEditorRequest(undefined); setTracing(false); setError(''); setStatus('Example loaded. Import an exported JSON file to restore a different topology.') }}>Load example (replaces workspace)</button>
            </section>
          </div>
        </div>
      </main>
      {contextMenu && contextObject && <TopologyContextMenu key={`${contextMenu.selection.kind}:${contextMenu.selection.id}`} x={contextMenu.x} y={contextMenu.y} title={`${objectLabels[contextMenu.selection.kind]} actions: ${contextObject.name}`} actions={contextActions} onClose={() => { contextMenu.invoker.focus({ preventScroll: true }); setContextMenu(undefined) }} />}
      {editorRequest && <TopologyObjectEditor key={`${editorRequest.kind}:${editorRequest.id ?? 'new'}:${!!editorRequest.deleting}:${!!editorRequest.routeMaps}`} topology={topology} request={editorRequest} onClose={() => setEditorRequest(undefined)} onSave={(next, value) => {
        saveTopology(next)
        if (editorRequest.deleting) setSelection(undefined)
        else {
          if (value.kind === 'hub') chooseHub(value.id)
          if (value.kind === 'spoke') chooseHub(next.spokes.find((s) => s.id === value.id)!.hubId)
          if (value.kind === 'connection') { chooseHub(next.connections.find((c) => c.id === value.id)!.hubId); setEditingConnection(value.id) }
          setSelection(value)
        }
        setTracing(false)
        setEditorRequest(undefined)
        setStatus(`${objectLabels[value.kind]} ${editorRequest.deleting ? 'deleted' : editorRequest.id ? 'updated' : 'created'}.`)
      }} />}
      <footer>Virtual WAN Topology Lab · Calculated locally in your browser · Export JSON for portable backups</footer>
    </div>
  )
}

export default App
