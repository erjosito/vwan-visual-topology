import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { example, objectLabels, topologyObject, transportLabels } from './model'
import type { LayoutMode, ObjectSelection, RouteMapDirection, RouterSelection, Topology } from './model'
import { simulate } from './routing'
import { ipv4, parseAsPath, validateTopology } from './validation'
import { TopologyDiagram } from './TopologyDiagram'
import type { DiagramContextMenu } from './TopologyDiagram'
import { TopologyContextMenu } from './TopologyContextMenu'
import type { ContextAction } from './TopologyContextMenu'
import { TopologyObjectEditor } from './TopologyObjectEditor'
import type { EditorRequest } from './TopologyObjectEditor'
import { CanvasOverlay } from './CanvasOverlay'
import { RouteInspector } from './RouteInspector'
import { RouteMapsPanel } from './RouteMapsPanel'
import { RouteMapInspector } from './RouteMapInspector'
import { StaticRoutingPanel } from './StaticRoutingPanel'
import { ErLocationInspector } from './ErLocationInspector'
import { VpnRoutingWizard } from './VpnRoutingWizard'
import { vpnRoutingMode } from './vpn-routing'
import type { VpnRoutingMode } from './vpn-routing'
import { nodePrefixes, traceGroupedPaths, traceNodePath } from './paths'
import type { GroupPath, NodePath, PathDirection, PathGroup, PathNode } from './paths'
import './App.css'

const storageKey = 'vwan-visual-topology:v1'
const pathGroups: { group: PathGroup; label: string }[] = [
  { group: 'vnets', label: 'All Azure VNets' },
  { group: 'sites', label: 'All onprem sites' },
  { group: 'everywhere', label: 'Everywhere' },
]
const message = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error.'
const nodeKey = (node: ObjectSelection) => `${node.kind}:${node.id}`
const parseNode = (key: string): PathNode => {
  const index = key.indexOf(':')
  return { kind: key.slice(0, index) as PathNode['kind'], id: key.slice(index + 1) }
}

function App() {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(storageKey)
      return { topology: validateTopology(saved ? JSON.parse(saved) : structuredClone(example)), error: '', backup: '' }
    } catch (error) {
      return { topology: validateTopology(structuredClone(example)), error: `Saved topology could not be loaded: ${message(error)}. The saved data has not been overwritten.`, backup: saved ?? '' }
    }
  })
  const [topology, setTopology] = useState(initial.topology)
  const [error, setError] = useState(initial.error)
  const [saveError, setSaveError] = useState('')
  const [selection, setSelection] = useState<ObjectSelection>()
  const [contextMenu, setContextMenu] = useState<DiagramContextMenu>()
  const [editorRequest, setEditorRequest] = useState<EditorRequest>()
  const [clearRequested, setClearRequested] = useState(false)
  const [panel, setPanel] = useState<'routes' | 'ads' | 'maps' | 'rules' | 'static' | 'vpnWizard' | 'paths' | 'notes'>()
  const [vpnConversion, setVpnConversion] = useState<{ connectionId: string; mode: VpnRoutingMode }>()
  const [router, setRouter] = useState<ObjectSelection>({ kind: 'hub', id: topology.hubs[0]?.id ?? '' })
  const [routeView, setRouteView] = useState<'hub' | 'firewall'>('hub')
  const [connectionId, setConnectionId] = useState('')
  const [mapRouter, setMapRouter] = useState<RouterSelection>()
  const [mapDirection, setMapDirection] = useState<RouteMapDirection>()
  const [mapConnectionId, setMapConnectionId] = useState<string>()
  const [prefix, setPrefix] = useState('')
  const [highlighting, setHighlighting] = useState(false)
  const layout = topology.layout?.mode ?? 'layered'
  const [zoom, setZoom] = useState(1)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [destination, setDestination] = useState('')
  const [destinationPrefix, setDestinationPrefix] = useState('')
  const [tracing, setTracing] = useState(false)
  const [groupTrace, setGroupTrace] = useState<{ group: PathGroup; direction: PathDirection }>()
  const importer = useRef<HTMLInputElement>(null)
  const simulation = useMemo(() => simulate(topology), [topology])
  const nodes: (PathNode & { name: string })[] = [
    ...topology.hubs.map((n) => ({ kind: 'hub' as const, id: n.id, name: n.name })),
    ...topology.spokes.map((n) => ({ kind: 'spoke' as const, id: n.id, name: n.name })),
    ...topology.sites.map((n) => ({ kind: 'site' as const, id: n.id, name: n.name })),
  ]
  const sourceNode = nodes.find((n) => nodeKey(n) === source)
  const targetNode = nodes.find((n) => nodeKey(n) === target)
  const paths: (NodePath | GroupPath)[] = useMemo(() => {
    if (!tracing) return []
    if (groupTrace) return traceGroupedPaths(topology, simulation, parseNode(groupTrace.direction === 'to' ? source : target), groupTrace.direction, groupTrace.group)
    return source && topologyObject(topology, parseNode(source)) ? traceNodePath(topology, simulation, parseNode(source), destination) : []
  }, [tracing, source, target, topology, simulation, destination, groupTrace])
  const connection = topology.connections.find((c) => c.id === connectionId)
  const inspected = topologyObject(topology, router)
  const hub = router.kind === 'hub' ? topology.hubs.find((h) => h.id === router.id) : undefined
  const activeView = routeView === 'firewall' && (hub?.routingIntent.private || hub?.routingIntent.internet) ? 'firewall' : 'hub'
  const decisions = (activeView === 'firewall' ? simulation.firewallTables : simulation.tables)[router.id] ?? []
  const selectedRoutes = highlighting && router.kind === 'hub' ? [
    ...decisions.filter((d) => !prefix || d.prefix === prefix).flatMap((d) => d.selected),
    ...(activeView === 'hub' && hub?.routingIntent.private ? (simulation.firewallTables[hub.id] ?? []).filter((d) => !prefix || d.prefix === prefix).flatMap((d) => d.selected) : []),
  ] : []
  const persist = (next: Topology) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaveError('') }
    catch { setSaveError('Browser storage is unavailable or full. Export JSON to preserve your topology.') }
  }
  const save = (next: Topology) => { setTopology(next); persist(next); setError('') }
  const update = (mutate: (next: Topology) => void) => {
    try { const next = structuredClone(topology); mutate(next); save(validateTopology(next)) }
    catch (error) { setError(message(error)) }
  }
  const reset = (next: Topology) => {
    save(next); setSelection(undefined); setPanel(undefined); setEditorRequest(undefined); setContextMenu(undefined); setClearRequested(false)
    setTracing(false); setGroupTrace(undefined); setHighlighting(false); setPrefix(''); setConnectionId(''); setVpnConversion(undefined)
    setRouter({ kind: 'hub', id: next.hubs[0]?.id ?? '' })
  }
  const selectRouter = (value: ObjectSelection) => { setRouter(value); setRouteView('hub'); setPrefix(''); setHighlighting(true); setTracing(false) }
  const openRouteMaps = (value?: RouterSelection, connectionId?: string) => { setMapRouter(value); setMapConnectionId(connectionId); setEditorRequest(undefined); setPanel('maps') }
  const showRouteMapRules = (value: RouterSelection, direction?: RouteMapDirection, connectionId?: string) => { setMapRouter(value); setMapDirection(direction); setMapConnectionId(connectionId); setSelection(value); setEditorRequest(undefined); setPanel('rules') }
  const openStaticRouting = (value: RouterSelection) => { setMapRouter(value); setEditorRequest(undefined); setPanel('static') }
  const selectObject = (value: ObjectSelection) => {
    setSelection(value)
    if (!panel && !tracing && (value.kind === 'hub' || value.kind === 'site')) selectRouter(value)
  }
  const showRoutes = (value: ObjectSelection, firewall = false) => { selectRouter(value); setRouteView(firewall ? 'firewall' : 'hub'); setPanel('routes') }
  const openPath = (value: PathNode, direction: 'to' | 'from') => {
    setGroupTrace(undefined)
    const other = nodes.find((n) => nodeKey(n) !== nodeKey(value) && (direction === 'from' || nodePrefixes(topology, n).length))
    const src = direction === 'to' ? value : other
    const dst = direction === 'to' ? other : value
    setSource(src ? nodeKey(src) : ''); setTarget(dst ? nodeKey(dst) : '')
    setDestination(dst ? nodePrefixes(topology, dst)[0]?.split('/')[0] ?? '' : '')
    setDestinationPrefix(dst ? nodePrefixes(topology, dst)[0] ?? '' : '')
    setTracing(false); setHighlighting(false); setPanel('paths')
  }
  const pathActions = (value: PathNode, direction: 'to' | 'from'): ContextAction[] => {
    const others = nodes.filter((node) => nodeKey(node) !== nodeKey(value))
    return [...pathGroups.map(({ group, label }) => ({
      label,
      run: () => {
        setGroupTrace({ group, direction })
        setSource(direction === 'to' ? nodeKey(value) : ''); setTarget(direction === 'from' ? nodeKey(value) : '')
        setDestination(''); setDestinationPrefix(''); setHighlighting(false); setTracing(true)
        if (panel === 'paths') setPanel(undefined)
      },
    })), ...(others.length ? others.map((other) => {
      const src = direction === 'to' ? value : other
      const dst = direction === 'to' ? other : value
      const prefixes = [...new Set(nodePrefixes(topology, dst))]
      return {
        label: `${other.name} (${other.kind})`,
        children: prefixes.length ? prefixes.map((prefix) => ({
          label: prefix,
          run: () => {
            setGroupTrace(undefined)
            setSource(nodeKey(src)); setTarget(nodeKey(dst)); setDestinationPrefix(prefix); setDestination(prefix.split('/')[0])
            setHighlighting(false); setTracing(true)
            if (panel === 'paths') setPanel(undefined)
          },
        })) : [{ label: 'No destination prefixes configured', disabled: true }],
      }
    }) : [{ label: 'No other nodes available', disabled: true }])]
  }
  const pathStatus = !paths.length ? 'No trace available' : paths.every((path) => path.status === 'delivered') ? 'Reachable'
    : paths.some((path) => path.status === 'delivered') ? 'Partially reachable'
      : paths.some((path) => path.status === 'loop') ? 'Forwarding loop' : 'No route'
  const groupLabel = pathGroups.find(({ group }) => group === groupTrace?.group)?.label
  const groupSummary = groupTrace && (groupTrace.direction === 'to'
    ? `Paths from ${sourceNode?.name ?? 'source'} to ${groupLabel}`
    : `Paths from ${groupLabel} to ${targetNode?.name ?? 'destination'}`)
  const contextSelection = contextMenu?.selection
  const contextObject = contextSelection && topologyObject(topology, contextSelection)
  const contextConnection = contextSelection?.kind === 'connection' ? topology.connections.find((connection) => connection.id === contextSelection.id) : undefined
  const vpnActions: ContextAction[] = contextConnection?.transport === 'VPN'
    ? (['static', 'bgp'] as const).filter((mode) => vpnRoutingMode(topology, contextConnection) !== mode).map((mode) => ({
      label: mode === 'static' ? 'Change to static routing' : 'Change to BGP routing',
      run: () => { setVpnConversion({ connectionId: contextConnection.id, mode }); setEditorRequest(undefined); setPanel('vpnWizard') },
    })) : []
  const canvasActions: ContextAction[] = [
    { label: 'Add hub', run: () => setEditorRequest({ kind: 'hub' }) },
    { label: 'Add site', run: () => setEditorRequest({ kind: 'site' }) },
    { label: 'Add ER location', run: () => setEditorRequest({ kind: 'erLocation' }) },
    { label: 'Route maps', run: () => openRouteMaps() },
    { label: 'Model notes and warnings', run: () => setPanel('notes') },
  ]
  const contextActions: ContextAction[] = contextSelection ? [
    { label: 'Edit configuration', run: () => setEditorRequest(contextSelection) },
    ...(['hub', 'site', 'erLocation'].includes(contextSelection.kind) ? [{ label: 'Show BGP routes', run: () => showRoutes(contextSelection) }] : []),
    ...(['hub', 'site'].includes(contextSelection.kind) ? [{ label: 'Route maps', run: () => openRouteMaps(contextSelection as RouterSelection) }] : []),
    ...(['hub', 'site'].includes(contextSelection.kind) ? [{ label: 'Show route map rules', run: () => showRouteMapRules(contextSelection as RouterSelection) }] : []),
    ...(['hub', 'site'].includes(contextSelection.kind) ? [{ label: 'Static routing', run: () => openStaticRouting(contextSelection as RouterSelection) }] : []),
    ...(['hub', 'site', 'spoke'].includes(contextSelection.kind) ? [
      { label: 'Show path to', disabled: !simulation.converged, children: pathActions(contextSelection as PathNode, 'to') },
      { label: 'Show path from', disabled: !simulation.converged, children: pathActions(contextSelection as PathNode, 'from') },
      { label: 'Open path explorer', run: () => openPath(contextSelection as PathNode, 'to') },
    ] : []),
    ...(contextSelection.kind === 'hub' ? [
      ...(topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.private || topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.internet ? [{ label: 'Show firewall routes', run: () => showRoutes(contextSelection, true) }] : []),
      { label: 'Add spoke', run: () => setEditorRequest({ kind: 'spoke', hubId: contextSelection.id }) },
      { label: 'Add connected site', run: () => setEditorRequest({ kind: 'site', hubId: contextSelection.id }) },
      { label: 'Connect existing site', disabled: !topology.sites.length, run: () => setEditorRequest({ kind: 'connection', hubId: contextSelection.id }) },
      { label: 'Connect to ER location', disabled: !topology.erLocations?.length, run: () => setEditorRequest({ kind: 'erLink', hubId: contextSelection.id }) },
    ] : []),
    ...(contextSelection.kind === 'site' ? [
      { label: 'Connect to hub', disabled: !topology.hubs.length, run: () => setEditorRequest({ kind: 'connection', siteId: contextSelection.id }) },
      { label: 'Link to another site', disabled: topology.sites.length < 2, run: () => setEditorRequest({ kind: 'siteLink', siteId: contextSelection.id }) },
      { label: 'Connect to ER location', disabled: !topology.erLocations?.length, run: () => setEditorRequest({ kind: 'erLink', siteId: contextSelection.id }) },
    ] : []),
    ...(contextSelection.kind === 'erLocation' ? [
      { label: 'Connect to hub', disabled: !topology.hubs.length, run: () => setEditorRequest({ kind: 'erLink', locationId: contextSelection.id }) },
      { label: 'Connect to site', disabled: !topology.sites.length, run: () => setEditorRequest({ kind: 'erLink', locationId: contextSelection.id, siteId: topology.sites[0]?.id }) },
    ] : []),
    ...(contextSelection.kind === 'erLink' ? [
      { label: topology.erLinks?.find((link) => link.id === contextSelection.id)?.enabled ? 'Disable connection' : 'Enable connection', run: () => update((next) => { const link = next.erLinks!.find((link) => link.id === contextSelection.id)!; link.enabled = !link.enabled }) },
    ] : []),
    ...(contextSelection.kind === 'connection' ? [
      { label: 'Edit advertisements', run: () => { setConnectionId(contextSelection.id); setPanel('ads') } },
      ...vpnActions,
      { label: topology.connections.find((c) => c.id === contextSelection.id)?.enabled ? 'Disable connection' : 'Enable connection', run: () => update((next) => { const c = next.connections.find((c) => c.id === contextSelection.id)!; c.enabled = !c.enabled }) },
    ] : []),
    { label: `Delete ${objectLabels[contextSelection.kind]}`, danger: true, run: () => setEditorRequest({ ...contextSelection, deleting: true }) },
  ] : canvasActions
  const exportTopology = (original = '') => {
    const url = URL.createObjectURL(new Blob([original || JSON.stringify(topology, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vwan-topology.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importTopology = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('Topology files must be smaller than 2 MB.')
      reset(validateTopology(JSON.parse(await file.text())))
    } catch (error) { setError(`Import rejected: ${message(error)}`) }
  }
  const pathTitle = (path: NodePath) => [
    'sourceName' in path ? path.sourceName : sourceNode?.name, ...(path.sourceSiteHops?.slice(1).map((id) => topology.sites.find((s) => s.id === id)?.name) ?? []),
    topology.connections.find((c) => c.id === path.sourceConnectionId)?.name,
    ...(path.sourceErLinkIds?.map((id) => topology.erLinks?.find((link) => link.id === id)?.name) ?? []),
    ...path.hubs.flatMap((id) => [topology.hubs.find((h) => h.id === id)?.name, ...(path.firewalls?.includes(id) ? ['Azure Firewall'] : [])]),
    topology.connections.find((c) => c.id === path.connectionId)?.name,
    ...(path.erLinkIds?.map((id) => topology.erLinks?.find((link) => link.id === id)?.name) ?? []),
    ...(path.siteHops?.map((id) => topology.sites.find((s) => s.id === id)?.name) ?? [topology.spokes.find((s) => s.id === path.siteId)?.name]),
  ].filter((name, index, all) => !!name && name !== all[index - 1]).join(' → ')
  const submitPath = (event: FormEvent) => { event.preventDefault(); setGroupTrace(undefined); setHighlighting(false); setTracing(true) }
  const closePanel = () => setPanel(undefined)

  return <div className="app canvas-app">
    <header className="topbar"><div className="brand"><div className="brand-icon" aria-hidden="true">W</div><div><h1>Virtual WAN <span>Topology Lab</span></h1><p>Design the network. Understand the path.</p></div></div>
      <div className="actions"><span className="local-badge">Local-first · no Azure credentials</span><button onClick={() => exportTopology()}>Export JSON</button><button onClick={() => importer.current?.click()}>Import JSON</button><button onClick={() => setClearRequested(true)}>Clear topology</button><a className="button-link" href="https://github.com/erjosito/vwan-visual-topology/issues/new" target="_blank" rel="noopener noreferrer">File issue</a><input ref={importer} hidden type="file" accept=".json,application/json" aria-label="Import topology file" onChange={(e) => { void importTopology(e.target.files?.[0]); e.target.value = '' }} /></div>
    </header>
    <main>
      <section className="workspace-heading"><div><p className="eyebrow">NETWORK WORKSPACE</p><input className="topology-name" aria-label="Topology name" maxLength={120} value={topology.name} onChange={(e) => update((next) => { next.name = e.target.value })} /></div><div className="stats"><span><strong>{topology.hubs.length}</strong> hubs</span><span><strong>{topology.spokes.length}</strong> spokes</span><span><strong>{topology.sites.length}</strong> sites</span>{!!topology.erLocations?.length && <span><strong>{topology.erLocations.length}</strong> ER locations</span>}</div></section>
      {error && <div role="alert" className="notice error">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>Dismiss</button></div>}
      {initial.backup && <div className="notice">The example is displayed because the saved workspace could not be loaded. Download the original before editing or closing this page. <button onClick={() => exportTopology(initial.backup)}>Download original saved topology</button></div>}
      {saveError && <p role="alert" className="notice error">{saveError}</p>}
      <section className="canvas-workspace panel" aria-label="Topology workspace">
        <div className="canvas-toolbar"><div><h2>Network topology</h2><p className="muted">Drag nodes to arrange. Right-click for actions. Alt+Arrow moves a focused node.</p></div>
          <div className="canvas-tools"><label className="field"><span>Visualization</span><select aria-label="Visualization mode" value={layout} onChange={(e) => update((next) => { next.layout ??= { mode: 'layered', positions: {} }; next.layout.mode = e.target.value as LayoutMode })}><option value="layered">Layered topology</option><option value="constellation">Network constellation</option></select></label><div className="zoom-controls"><button aria-label="Zoom out" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}>-</button><label className="field"><span>Zoom</span><select aria-label="Canvas zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}><option value={0.75}>75%</option><option value={1}>100%</option><option value={1.25}>125%</option><option value={1.5}>150%</option></select></label><button aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + 0.25))}>+</button></div><button disabled={!Object.keys(topology.layout?.positions[layout] ?? {}).length} title="Restore automatic positions in the current visualization only" onClick={() => update((next) => { if (next.layout) delete next.layout.positions[layout] })}>Reset layout</button>
            <button onClick={() => setEditorRequest({ kind: 'hub' })}>+ Hub</button><button onClick={() => setEditorRequest({ kind: 'site' })}>+ Site</button><button onClick={() => setEditorRequest({ kind: 'erLocation' })}>+ ER location</button><button onClick={() => openRouteMaps()}>Route maps</button><button aria-label="Open model notes and warnings" onClick={() => setPanel('notes')}>Notes{simulation.warnings.length ? ` (${simulation.warnings.length})` : ''}</button></div>
        </div>
        <div className="canvas-stage">
          <TopologyDiagram topology={topology} hubId={highlighting && router.kind === 'hub' ? router.id : ''} selected={selectedRoutes} preferredSiteLinkIds={highlighting && router.kind === 'site' ? simulation.siteTables[router.id]?.filter((r) => !prefix || r.prefix === prefix).flatMap((r) => r.siteLinkIds ?? []) : undefined} sourceConnectionIds={paths.flatMap((p) => p.sourceConnectionId ? [p.sourceConnectionId] : [])} sourceSiteLinkIds={paths.flatMap((p) => p.sourceSiteLinkIds ?? [])} sourceErLinkIds={paths.flatMap((path) => path.sourceErLinkIds ?? [])} paths={paths} sourceSpokeIds={paths.flatMap((path) => path.sourceSpokeId ? [path.sourceSpokeId] : [])} tracing={tracing} layout={layout} zoom={zoom} selection={selection} onObjectClick={selectObject} onShowRouteMapRules={showRouteMapRules} onNodeMove={(id, position) => update((next) => { next.layout ??= { mode: layout, positions: {} }; next.layout.positions[layout] ??= {}; next.layout.positions[layout]![id] = position })} onObjectContextMenu={(value) => { if (value.selection) selectObject(value.selection); setContextMenu(value) }} />
          {(highlighting || tracing) && <div className="highlight-status" role="status">{tracing ? groupTrace ? `${groupSummary} · ${paths.length ? pathStatus : 'No matching sources or destination prefixes configured'}` : `Path: ${sourceNode?.name ?? 'source'} → ${targetNode?.name ?? destination} · ${destinationPrefix || destination} · ${pathStatus}` : prefix ? `Preferred routes to ${prefix}` : `Preferred routes · ${inspected?.name ?? 'router'}`}{tracing && <button onClick={() => setPanel('paths')}>Path details</button>}<button onClick={() => { setHighlighting(false); setTracing(false); setPrefix('') }}>Clear highlighting</button></div>}
          {panel === 'routes' && inspected && (router.kind === 'erLocation' ? <ErLocationInspector topology={topology} simulation={simulation} locationId={router.id} onClose={closePanel} /> : <RouteInspector topology={topology} simulation={simulation} router={router} view={activeView} onRouter={selectRouter} onView={(view) => { setRouteView(view); setPrefix('') }} onPreference={(preference) => update((next) => { next.hubs.find((h) => h.id === router.id)!.preference = preference })} onPrefix={(value) => { setPrefix(value); setHighlighting(true); setTracing(false) }} onClose={closePanel} />)}
          {panel === 'maps' && <RouteMapsPanel key={mapRouter ? nodeKey(mapRouter) : 'resources'} topology={topology} simulation={simulation} router={mapRouter} connectionId={mapConnectionId} onRouter={(value) => { setMapRouter(value); setMapConnectionId(undefined) }} onSave={save} onClose={closePanel} />}
          {panel === 'rules' && mapRouter && <RouteMapInspector topology={topology} router={mapRouter} direction={mapDirection} connectionId={mapConnectionId} onDirection={setMapDirection} onConnection={setMapConnectionId} onConfigure={openRouteMaps} onClose={closePanel} />}
          {panel === 'static' && mapRouter && <StaticRoutingPanel key={nodeKey(mapRouter)} topology={topology} router={mapRouter} onSave={save} onClose={closePanel} />}
          {panel === 'vpnWizard' && vpnConversion && <VpnRoutingWizard key={`${vpnConversion.connectionId}:${vpnConversion.mode}`} topology={topology} connectionId={vpnConversion.connectionId} mode={vpnConversion.mode} onSave={save} onClose={closePanel} />}
          {panel === 'ads' && connection && <CanvasOverlay title={`Advertisements · ${connection.name}`} className="advertisements" onClose={closePanel}>
            <p className="muted">{transportLabels[connection.transport]} · BGP advertisements only. AS paths are entered as received by the hub, including provider ASNs. Configure non-BGP VPN prefixes through Static routing on the site or hub.</p>
            <label className="checkbox-field"><input type="checkbox" aria-label="Import site mesh routes" checked={connection.learnSiteRoutes} onChange={(e) => update((next) => { next.connections.find((c) => c.id === connection.id)!.learnSiteRoutes = e.target.checked })} />Advertise site-originated and learned routes</label>
            <div className="route-editor">{connection.routes.map((route) => <div className="route-edit-row" key={route.id}>
              <label className="field"><span>Advertised prefix</span><input aria-label="Advertised prefix" key={route.prefix} defaultValue={route.prefix} onBlur={(e) => update((next) => { next.connections.find((c) => c.id === connection.id)!.routes.find((r) => r.id === route.id)!.prefix = e.target.value })} /></label>
              <label className="field"><span>Received AS path</span><input aria-label="Received AS path" key={route.asPath.join(' ')} disabled={route.kind !== 'bgp'} defaultValue={route.asPath.join(' ')} onBlur={(e) => { try { const asPath = parseAsPath(e.target.value); update((next) => { next.connections.find((c) => c.id === connection.id)!.routes.find((r) => r.id === route.id)!.asPath = asPath }) } catch (error) { setError(message(error)) } }} /></label>
              <button className="danger" aria-label={`Remove route ${route.prefix}`} onClick={() => update((next) => { const c = next.connections.find((c) => c.id === connection.id)!; c.routes = c.routes.filter((r) => r.id !== route.id) })}>Remove</button>
            </div>)}<button onClick={() => update((next) => { next.connections.find((c) => c.id === connection.id)!.routes.push({ id: crypto.randomUUID(), prefix: '10.99.0.0/16', kind: 'bgp', asPath: [65001] }) })}>Add advertised route</button></div>
          </CanvasOverlay>}
          {panel === 'paths' && <CanvasOverlay title="Path explorer" className="path-panel" onClose={closePanel}>
            {tracing && groupTrace && <p><strong>{groupSummary}</strong>. Each source is traced independently to the destination prefixes; reverse-path symmetry is not assumed.</p>}
            <p className="muted">Longest-prefix forwarding and preferred BGP paths, not shortest graphical distance. ECMP paths remain highlighted together. Hub destinations use attached-spoke prefixes. Sites without assigned prefixes offer explicit connection advertisements as destination choices; these can be transit prefixes.</p>
            <form className="path-form" onSubmit={submitPath}><div className="form-grid"><label className="field"><span>Source node</span><select aria-label="Source node" value={source} onChange={(e) => { setSource(e.target.value); setTracing(false) }}><option value="">Select source</option>{nodes.map((n) => <option key={nodeKey(n)} value={nodeKey(n)}>{n.name} ({n.kind})</option>)}</select></label><label className="field"><span>Destination node</span><select aria-label="Destination node" value={target} onChange={(e) => { const prefixes = nodePrefixes(topology, parseNode(e.target.value)); setTarget(e.target.value); setDestination(prefixes[0]?.split('/')[0] ?? ''); setDestinationPrefix(prefixes[0] ?? ''); setTracing(false) }}><option value="">Select destination</option>{nodes.map((n) => <option key={nodeKey(n)} value={nodeKey(n)}>{n.name} ({n.kind})</option>)}</select></label></div>
              <label className="field"><span>Destination prefix</span><select aria-label="Destination prefix" value={destinationPrefix} onChange={(e) => { setDestinationPrefix(e.target.value); setDestination(e.target.value.split('/')[0]); setTracing(false) }}><option value="">Custom IPv4 address</option>{targetNode && nodePrefixes(topology, targetNode).map((p) => <option key={p}>{p}</option>)}</select></label>
              {!destinationPrefix && <label className="field"><span>Destination IPv4</span><input aria-label="Destination IPv4" value={destination} onChange={(e) => { setDestination(e.target.value); setTracing(false) }} required /></label>}<p className="muted">A prefix selection traces its network address. Choose Custom IPv4 address to test a more-specific destination within that range.</p><button className="primary" disabled={!sourceNode || !targetNode || ipv4(destination) === undefined || !simulation.converged}>Show preferred path</button>
            </form>
            <p className="muted">Routes may terminate at another advertiser of the same prefix. Reverse paths are calculated independently; symmetry, firewall permissions and host reachability are not assumed. Site ingress uses advertised AS paths; SD-WAN outbound learning is not modeled.</p>
            {tracing && <div className="flow-results" aria-live="polite">{paths.map((path, i) => <article key={i} className={`flow-result ${path.status}`}><strong>{'destinationPrefix' in path && `${path.sourceName} → ${path.destinationName} · ${path.destinationPrefix} · `}{path.status === 'delivered' ? 'Reachable' : path.status === 'loop' ? 'Forwarding loop' : 'No route'}{paths.length > 1 ? ` · path ${i + 1}` : ''}</strong><p>{pathTitle(path)}</p><details><summary>Why this path?</summary><ol>{path.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details></article>)}{!paths.length && <p className="empty">{groupTrace ? 'No matching sources or destination prefixes configured.' : 'No trace available for this source or provisional routing state.'}</p>}</div>}
          </CanvasOverlay>}
          {panel === 'notes' && <CanvasOverlay title="Model notes and warnings" className="model-notes" onClose={closePanel}>
            <h3>Planning model, not an Azure control plane</h3><p>One Standard Virtual WAN, fully meshed hubs and Default propagation. HRP follows Microsoft's documented local/remote, transport and AS-path ordering. Hub-table static overrides are not configurable; VPN site static routes do not get hub-static precedence.</p><p>Routing intent uses separate hub policy and firewall forwarding tables. Firewall rules, SNAT, return-flow symmetry, custom route tables, communities, MED, Global Reach, shared-circuit reflection and arrival/failback timing are not simulated.</p>
            {simulation.warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}
            <p><a href="https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference" target="_blank" rel="noreferrer">Microsoft hub routing preference</a></p><p><a href="https://learn.microsoft.com/azure/virtual-wan/route-maps-about" target="_blank" rel="noreferrer">Microsoft route-map behavior and limitations</a></p>
            <button onClick={() => reset(validateTopology(structuredClone(example)))}>Load example (replaces workspace)</button>
          </CanvasOverlay>}
          {editorRequest && <TopologyObjectEditor key={`${editorRequest.kind}:${editorRequest.id ?? 'new'}:${!!editorRequest.deleting}`} topology={topology} request={editorRequest} onClose={() => setEditorRequest(undefined)} onRouteMaps={openRouteMaps} onStaticRouting={openStaticRouting} onSave={(next, value) => {
            save(next); setSelection(editorRequest.deleting ? undefined : value); setEditorRequest(undefined)
            if (editorRequest.deleting && nodeKey(value) === nodeKey(router)) { setPanel(undefined); setHighlighting(false) }
            else if (editorRequest.deleting && mapRouter && nodeKey(value) === nodeKey(mapRouter) && (panel === 'maps' || panel === 'rules' || panel === 'static')) setPanel(undefined)
            else if (!panel && !tracing && (value.kind === 'hub' || value.kind === 'site')) selectRouter(value)
          }} />}
          {clearRequested && <CanvasOverlay title="Clear topology" className="object-editor" onClose={() => setClearRequested(false)}>
            <p>Remove all hubs, sites, spokes, ER locations, connections, route maps and saved layouts? This replaces the workspace saved in this browser and cannot be undone. Export JSON first if you need a backup.</p>
            <div className="row dialog-actions"><button onClick={() => setClearRequested(false)}>Cancel clearing</button><button className="danger" onClick={() => { reset(validateTopology({ version: 1, name: 'New topology', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [] })); setZoom(1) }}>Clear all objects</button></div>
          </CanvasOverlay>}
        </div>
        <div className="legend"><span><i className="legend-line er" />ExpressRoute</span><span><i className="legend-line vpn" />VPN</span><span><i className="legend-line sdwan" />SD-WAN</span><span><i className="legend-line preferred" />Preferred / flow path</span><span><b className="policy-tag inbound">IN</b><b className="policy-tag outbound">OUT</b>Per-connection maps · near owning router · click for rules</span><span className="live-dot">{simulation.converged ? 'Routes calculated' : 'Provisional routes'}</span></div>
      </section>
    </main>
    {contextMenu && <TopologyContextMenu key={contextSelection ? nodeKey(contextSelection) : 'canvas'} x={contextMenu.x} y={contextMenu.y} title={contextSelection ? `${objectLabels[contextSelection.kind]} actions: ${contextObject?.name ?? ''}` : 'Canvas actions'} actions={contextActions} onClose={() => { contextMenu.invoker.focus({ preventScroll: true }); setContextMenu(undefined) }} />}
    <footer>Calculated locally in your browser · Export JSON for portable backups</footer>
  </div>
}

export default App
