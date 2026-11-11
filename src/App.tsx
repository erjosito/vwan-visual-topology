import { t, localizeDiagnostic, useLanguage, documentTitles } from './i18n'
import { LanguageSelector } from './LanguageSelector'
import { SimulatorModeSwitch } from './SimulatorModeSwitch'
import type { SimulatorMode } from './SimulatorModeSwitch'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { example, objectLabels, topologyObject } from './model'
import type { LayoutMode, ObjectSelection, RouteMapDirection, RouterSelection, Topology } from './model'
import { simulate } from './routing'
import { ipv4, validateTopology } from './validation'
import { TopologyDiagram } from './TopologyDiagram'
import type { DiagramContextMenu } from './TopologyDiagram'
import { TopologyContextMenu } from './TopologyContextMenu'
import type { ContextAction } from './TopologyContextMenu'
import { TopologyObjectEditor } from './TopologyObjectEditor'
import type { EditorRequest } from './TopologyObjectEditor'
import { ErLocationInfoModal } from './ErLocationInfoModal'
import type { ErCircuitSku } from './er-locations-catalog'
import { CanvasOverlay } from './CanvasOverlay'
import { RouteInspector } from './RouteInspector'
import { RouteMapsPanel } from './RouteMapsPanel'
import { RouteMapInspector } from './RouteMapInspector'
import { StaticRoutingPanel } from './StaticRoutingPanel'
import type { RouteMode } from './route-views'
import { erLocationBgpTable } from './route-views'
import { VpnRoutingWizard } from './VpnRoutingWizard'
import { AzureFilesPanel } from './AzureFilesPanel'
import { AzureComparisonPanel } from './AzureComparisonPanel'
import type { ComparisonSession } from './AzureComparisonPanel'
import { FeedbackDialog } from './FeedbackDialog'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { RoutingIssuesPanel } from './RoutingIssuesPanel'
import { routingRevision, summarizeCoverage, validateDiagnosticsProfile } from './diagnostics'
import type { DiagnosticsFinding, DiagnosticsReport } from './diagnostics'
import { importAzureCapture } from './azure-import'
import { vpnRoutingMode } from './vpn-routing'
import type { VpnRoutingMode } from './vpn-routing'
import { azureRoutesAtSites, nodePrefixes, traceGroupedPaths, traceNodePath } from './paths'
import type { GroupPath, NodePath, PathDirection, PathGroup, PathNode } from './paths'
import { embeddedSpokeNvaSiteIds } from './topology-graph'
import { assignSitePrefixes } from './topology-mutations'
import { useTopologyHistory } from './useTopologyHistory'
import { useDeleteShortcut } from './useDeleteShortcut'
import './App.css'

const storageKey = 'vwan-visual-topology:v1'
const pathGroups: { group: PathGroup; label: string }[] = [
  { group: 'vnets', label: 'All Azure VNets' },
  { group: 'sites', label: 'All onprem sites' },
  { group: 'everywhere', label: 'Everywhere' },
]
const message = (error: unknown) => error instanceof SyntaxError ? 'Invalid JSON. Check the file syntax.'
  : error instanceof Error ? error.message : 'Unexpected error.'
const nodeKey = (node: ObjectSelection) => `${node.kind}:${node.id}`
const parseNode = (key: string): PathNode => {
  const index = key.slice(0, key.indexOf(':'))
  return { kind: index as PathNode['kind'], id: key.slice(key.indexOf(':') + 1) }
}

const VWAN_SAMPLE_GALLERY: Array<{
  id: string
  title: string
  summary: string
  file?: string
}> = [
  {
    id: 'default-example',
    title: 'Dual-Hub Enterprise Virtual WAN (Default Workspace)',
    summary: 'Two regional Virtual Hubs (Europe & US) with ExpressRoute, S2S VPN, SD-WAN, Route Maps, and Spoke VNets.',
  },
  {
    id: 'hub-routing-preferences',
    title: 'Hub Routing Preferences (ExpressRoute vs VPN vs AS Path)',
    summary: 'Three hubs connected to the same dual-homed branch site, each configured with a different Hub Routing Preference (ExpressRoute, VpnGateway, ASPath).',
    file: '/docs/samples/hub-routing-preferences.json',
  },
  {
    id: 'secured-hub-routing-intent',
    title: 'Secured Virtual Hub with Private & Internet Routing Intent',
    summary: 'Two hubs where West Europe enforces Private + Internet Routing Intent through Azure Firewall while North Europe remains unsecured.',
    file: '/docs/samples/secured-hub-routing-intent.json',
  },
  {
    id: 'spoke-bgp-nva-transit',
    title: 'Spoke BGP NVA Transit & Indirect Spoke/Branch Reachability',
    summary: 'A transit spoke hosting a BGP NVA peering with the Virtual Hub (ASN 65515) and advertising downstream peered VNet and SD-WAN branch prefixes.',
    file: '/docs/samples/spoke-bgp-nva-transit.json',
  },
  {
    id: 'three-hub-all-features-asymmetric',
    title: 'Three-Hub Enterprise Showcase (All Features & Asymmetric Bypass)',
    summary: 'Exercises all Virtual WAN features across 3 regional hubs and intentionally triggers asymmetric Firewall bypass & route-map findings for Check routing.',
    file: '/docs/samples/three-hub-all-features-asymmetric.json',
  },
]

interface AppProps {
  simulatorMode?: SimulatorMode
  onChangeSimulatorMode?: (mode: SimulatorMode) => void
}

function App({ simulatorMode = 'vwan', onChangeSimulatorMode }: AppProps = {}) {
  const language = useLanguage()
  useEffect(() => {
    document.documentElement.lang = language
    document.title = documentTitles[language]
  }, [language])
  const [selection, setSelection] = useState<ObjectSelection>()
  const [routerState, setRouter] = useState<ObjectSelection>()
  const [contextMenu, setContextMenu] = useState<DiagramContextMenu>()
  const [editorRequest, setEditorRequest] = useState<EditorRequest>()
  const [clearRequested, setClearRequested] = useState(false)
  const [erLocationModal, setErLocationModal] = useState<{ open: boolean; peeringLocation?: string; sku?: ErCircuitSku; targetAzureRegion?: string; erLocationId?: string }>({ open: false })
  const [feedbackOpen, setFeedbackOpen] = useState(() => new URLSearchParams(location.search).get('feedback') === '1')
  const [panel, setPanel] = useState<'routes' | 'maps' | 'rules' | 'static' | 'vpnWizard' | 'paths' | 'notes' | 'azure' | 'diagnostics' | 'issues' | 'comparison' | 'samples'>()
  const [comparisonSession, setComparisonSession] = useState<ComparisonSession>()
  const [diagnosticHighlight, setDiagnosticHighlight] = useState<{ revision: string; findingId: string; paths: GroupPath[] }>()
  const [routingCheck, setRoutingCheck] = useState<{ revision: string; status: 'running' | 'complete' | 'cancelled' | 'failed'; report?: DiagnosticsReport }>()
  const [routingIssueId, setRoutingIssueId] = useState<string>()
  const [reviewCoverage, setReviewCoverage] = useState(false)
  const checkWorker = useRef<{ worker: Worker; revision: string } | undefined>(undefined)
  const {
    topology,
    backup: initialBackup,
    error,
    setError,
    saveError,
    save,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
  } = useTopologyHistory({
    storageKey,
    onBeforeUndoRedo: () => {
      setEditorRequest(undefined)
      setContextMenu(undefined)
    },
    onAfterChange: (next) => {
      if (selection && !topologyObject(next, selection)) setSelection(undefined)
    },
  })
  const router = useMemo<ObjectSelection>(
    () => (routerState && topologyObject(topology, routerState) ? routerState : { kind: 'hub', id: topology.hubs[0]?.id ?? '' }),
    [routerState, topology],
  )
  const routingKey = useMemo(() => routingRevision(topology), [topology])
  const currentCheck = routingCheck?.revision === routingKey ? routingCheck : undefined
  const routingIssues = currentCheck?.report?.findings.filter((finding) => finding.severity === 'error' || finding.severity === 'warning') ?? []
  const checkCoverage = currentCheck?.report ? summarizeCoverage(currentCheck.report) : undefined
  const editCoveredObject = (node: ObjectSelection) => {
    closePanel()
    setSelection(node)
    setEditorRequest(node)
  }
  useEffect(() => {
    if (checkWorker.current && checkWorker.current.revision !== routingKey) {
      checkWorker.current.worker.terminate()
      checkWorker.current = undefined
    }
  }, [routingKey])
  useEffect(() => () => { checkWorker.current?.worker.terminate(); checkWorker.current = undefined }, [])
  const cancelRoutingCheck = () => {
    checkWorker.current?.worker.terminate(); checkWorker.current = undefined
    setRoutingCheck(undefined)
  }
  const clearHighlightsAndIcons = () => {
    cancelRoutingCheck()
    setDiagnosticHighlight(undefined)
    setHighlighting(false)
    setTracing(false)
    setPrefix('')
    setRoutingIssueId(undefined)
    if (panel === 'issues') setPanel(undefined)
  }
  const runRoutingCheck = (targetTopology = topology, preservePanel = false) => {
    checkWorker.current?.worker.terminate(); checkWorker.current = undefined
    setDiagnosticHighlight(undefined); setHighlighting(false); setTracing(false)
    if (!preservePanel) setPanel(undefined)
    let profile = { version: 1 as const, intents: [], failureAnalysis: false } as ReturnType<typeof validateDiagnosticsProfile>
    let requirementsUnavailable = false
    try {
      const saved = localStorage.getItem('vwan-visual-topology:diagnostics:v1')
      if (saved) profile = validateDiagnosticsProfile(JSON.parse(saved))
    } catch { requirementsUnavailable = true }
    const targetRevision = routingRevision(targetTopology)
    try {
      const next = new Worker(new URL('./diagnostics-worker.ts', import.meta.url), { type: 'module' })
      checkWorker.current = { worker: next, revision: targetRevision }
      setRoutingCheck({ revision: targetRevision, status: 'running', report: preservePanel ? currentCheck?.report : undefined })
      next.onmessage = ({ data }: MessageEvent<{ report?: DiagnosticsReport }>) => {
        if (checkWorker.current?.worker !== next) return
        if (data.report && requirementsUnavailable) {
          data.report.complete = false
          data.report.limitations.push('Saved requirements could not be read. Automatic checks ran without them.')
        }
        setRoutingCheck({ revision: targetRevision, status: data.report ? 'complete' : 'failed', report: data.report })
        next.terminate(); checkWorker.current = undefined
      }
      next.onerror = () => {
        if (checkWorker.current?.worker !== next) return
        setRoutingCheck({ revision: targetRevision, status: 'failed' })
        next.terminate(); checkWorker.current = undefined
      }
      next.postMessage({ topology: targetTopology, profile, automatic: true })
    } catch {
      checkWorker.current?.worker.terminate(); checkWorker.current = undefined
      setRoutingCheck({ revision: targetRevision, status: 'failed' })
    }
  }
  const checkRouting = () => runRoutingCheck(topology, false)
  const [pendingAzureImport, setPendingAzureImport] = useState<{ revision: number; topology: Topology }>()
  const [vpnConversion, setVpnConversion] = useState<{ connectionId: string; mode: VpnRoutingMode }>()
  const [routeView, setRouteView] = useState<'bgp' | 'hub' | 'firewall'>('bgp')
  const [routeMode, setRouteMode] = useState<RouteMode>('bgp')
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
  const importRequest = useRef(0)
  const simulation = useMemo(() => simulate(topology), [topology])
  const nvaSiteIds = useMemo(() => embeddedSpokeNvaSiteIds(topology), [topology])
  const nodes: (PathNode & { name: string })[] = [
    ...topology.hubs.map((n) => ({ kind: 'hub' as const, id: n.id, name: n.name })),
    ...topology.spokes.map((n) => ({ kind: 'spoke' as const, id: n.id, name: n.name })),
    ...topology.sites.filter((n) => !nvaSiteIds.has(n.id)).map((n) => ({ kind: 'site' as const, id: n.id, name: n.name })),
  ]
  const sourceNode = nodes.find((n) => nodeKey(n) === source)
  const targetNode = nodes.find((n) => nodeKey(n) === target)
  const paths: (NodePath | GroupPath)[] = useMemo(() => {
    if (!tracing) return []
    if (groupTrace) return traceGroupedPaths(topology, simulation, parseNode(groupTrace.direction === 'to' ? source : target), groupTrace.direction, groupTrace.group)
    return source && topologyObject(topology, parseNode(source)) ? traceNodePath(topology, simulation, parseNode(source), destination) : []
  }, [tracing, source, target, topology, simulation, destination, groupTrace])
  const inspected = topologyObject(topology, router)
  const hub = router.kind === 'hub' ? topology.hubs.find((h) => h.id === router.id) : undefined
  const activeView = routeView === 'firewall' && !hub?.routingIntent.private && !hub?.routingIntent.internet ? 'bgp' : routeView
  const erRouting = useMemo(() => router.kind === 'erLocation' ? erLocationBgpTable(topology, simulation, router.id) : [],
    [topology, simulation, router.kind, router.id])
  const decisions = router.kind === 'erLocation' ? erRouting
    : (activeView === 'bgp' ? simulation.bgpTables : activeView === 'firewall' ? simulation.firewallTables : simulation.tables)[router.id] ?? []
  const selectedRoutes = highlighting && (router.kind === 'hub' || router.kind === 'erLocation') ? [
    ...decisions.filter((d) => !prefix || d.prefix === prefix).flatMap((d) => d.selected),
    ...(activeView === 'hub' && hub?.routingIntent.private ? (simulation.firewallTables[hub.id] ?? []).filter((d) => !prefix || d.prefix === prefix).flatMap((d) => d.selected) : []),
  ] : []
  const siteHighlight = useMemo(() => {
    if (!highlighting || router.kind !== 'site') return []
    const routing = azureRoutesAtSites(topology, simulation)
    const prefixes = [...new Set((routing.tables[router.id] ?? []).filter((route) => !prefix || route.prefix === prefix).map((route) => route.prefix))]
    return prefixes.flatMap((prefix) => traceNodePath(topology, simulation, { kind: 'site', id: router.id }, prefix.split('/')[0], routing))
  }, [highlighting, router.kind, router.id, topology, simulation, prefix])
  const diagnosticPaths = (panel === 'diagnostics' || panel === 'issues') && diagnosticHighlight?.revision === routingKey ? diagnosticHighlight.paths : undefined
  const diagramPaths = diagnosticPaths ?? (tracing ? paths : siteHighlight)
  const showDiagnostic = (finding: DiagnosticsFinding) => {
    const name = (node?: PathNode) => node ? topologyObject(topology, node)?.name ?? node.id : ''
    setDiagnosticHighlight({ revision: routingRevision(topology), findingId: finding.id, paths: [
      ...finding.forward.map((path) => ({ ...path, sourceNode: finding.source, targetNode: finding.target, direction: 'forward' as const, sourceName: name(finding.source), destinationName: name(finding.target), destinationPrefix: finding.destinationAddress ?? finding.prefix ?? '' })),
      ...finding.reverse.map((path) => ({ ...path, sourceNode: finding.target, targetNode: finding.source, direction: 'return' as const, sourceName: name(finding.target), destinationName: name(finding.source), destinationPrefix: finding.sourceAddress ?? '' })),
    ] })
    setTracing(false); setHighlighting(false); setSelection(finding.related[0])
  }
  const openDiagnostics = () => { setDiagnosticHighlight(undefined); setHighlighting(false); setTracing(false); setPanel('diagnostics') }
  const update = (mutate: (next: Topology) => void) => {
    try { const next = structuredClone(topology); mutate(next); save(validateTopology(next)) }
    catch (error) { setError(message(error)) }
  }
  const assignPrefixToSite = (siteId: string, prefixesToAdd: string[]) => {
    try {
      const next = assignSitePrefixes(topology, siteId, prefixesToAdd)
      const validated = validateTopology(next)
      save(validated)
      if (routingCheck) runRoutingCheck(validated, panel === 'issues')
    } catch (error) { setError(message(error)) }
  }
  const reset = (next: Topology) => {
    importRequest.current++
    cancelRoutingCheck()
    setPendingAzureImport(undefined)
    clearHistory()
    save(next, false); setSelection(undefined); setPanel(undefined); setEditorRequest(undefined); setContextMenu(undefined); setClearRequested(false)
    setTracing(false); setGroupTrace(undefined); setHighlighting(false); setPrefix(''); setVpnConversion(undefined)
    setRouter({ kind: 'hub', id: next.hubs[0]?.id ?? '' })
  }
  const loadGallerySample = (entry: (typeof VWAN_SAMPLE_GALLERY)[number]) => {
    if (!entry.file) {
      reset(validateTopology(structuredClone(example)))
      return
    }
    void fetch(entry.file)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sample topology "${entry.id}" not found.`)
        return validateTopology(await res.json())
      })
      .then((loaded) => {
        reset(loaded)
      })
      .catch((err) => setError(`Sample load failed: ${message(err)}`))
  }
  const sampleLoaded = useRef(false)
  useEffect(() => {
    if (sampleLoaded.current) return
    const sample = new URLSearchParams(location.search).get('sample')?.trim() ?? ''
    if (!/^[a-z0-9-]+$/.test(sample)) return
    sampleLoaded.current = true
    void fetch(`/docs/samples/${sample}.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sample topology "${sample}" not found.`)
        return validateTopology(await res.json())
      })
      .then((loaded) => {
        clearHistory()
        save(loaded, false)
        setRouter({ kind: 'hub', id: loaded.hubs[0]?.id ?? '' })
      })
      .catch((err) => setError(`Sample load failed: ${message(err)}`))
  }, [clearHistory, save, setError])
  const selectRouter = (value: ObjectSelection) => { setRouter(value); setRouteView('bgp'); setPrefix(''); setHighlighting(false) }
  const openRouteMaps = (value?: RouterSelection, connectionId?: string) => { setMapRouter(value); setMapConnectionId(connectionId); setEditorRequest(undefined); setPanel('maps') }
  const showRouteMapRules = (value: RouterSelection, direction?: RouteMapDirection, connectionId?: string) => { setMapRouter(value); setMapDirection(direction); setMapConnectionId(connectionId); setSelection(value); setEditorRequest(undefined); setPanel('rules') }
  const openStaticRouting = (value: RouterSelection) => { setMapRouter(value); setEditorRequest(undefined); setPanel('static') }
  const selectObject = (value: ObjectSelection) => {
    setSelection(value)
  }
  useDeleteShortcut(selection && topologyObject(topology, selection) && !editorRequest &&
    !clearRequested && !feedbackOpen && !erLocationModal.open ? () => {
      setContextMenu(undefined)
      setEditorRequest({ ...selection, deleting: true })
    } : undefined)
  const showRoutes = (value: ObjectSelection, firewall = false, mode: RouteMode = 'bgp') => { selectRouter(value); setRouteView(firewall ? 'firewall' : 'bgp'); setRouteMode(mode); setPanel('routes') }
  const openPath = (value: PathNode, direction: 'to' | 'from') => {
    setDiagnosticHighlight(undefined)
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
      label: t(label),
      run: () => {
        setDiagnosticHighlight(undefined)
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
        label: `${other.name} (${t(other.kind)})`,
        allowDisabledChildren: !prefixes.length,
        children: prefixes.length ? prefixes.map((prefix) => ({
          label: prefix,
          run: () => {
            setDiagnosticHighlight(undefined)
            setGroupTrace(undefined)
            setSource(nodeKey(src)); setTarget(nodeKey(dst)); setDestinationPrefix(prefix); setDestination(prefix.split('/')[0])
            setHighlighting(false); setTracing(true)
            if (panel === 'paths') setPanel(undefined)
          },
        })) : [{ label: t("No destination prefixes configured"), disabled: true }],
      }
    }) : [{ label: t("No other nodes available"), disabled: true }])]
  }
  const pathStatus = !paths.length ? t("No trace available") : paths.every((path) => path.status === 'delivered') ? t("Reachable")
    : paths.some((path) => path.status === 'delivered') ? t("Partially reachable")
      : paths.some((path) => path.status === 'loop') ? t("Forwarding loop") : t("No route")
  const groupLabel = t(pathGroups.find(({ group }) => group === groupTrace?.group)?.label ?? '')
  const groupSummary = groupTrace && (groupTrace.direction === 'to'
    ? t("Paths from {0} to {1}", sourceNode?.name ?? t('source'), groupLabel)
    : t("Paths from {0} to {1}", groupLabel, targetNode?.name ?? t('destination')))
  const contextSelection = contextMenu?.selection
  const contextObject = contextSelection && topologyObject(topology, contextSelection)
  const contextConnection = contextSelection?.kind === 'connection' ? topology.connections.find((connection) => connection.id === contextSelection.id) : undefined
  const vpnActions: ContextAction[] = contextConnection?.transport === 'VPN'
    ? (['static', 'bgp'] as const).map((mode) => ({
      label: mode === 'static' ? t("Change to static routing") : t("Change to BGP routing"),
      disabled: vpnRoutingMode(topology, contextConnection) === mode,
      run: () => { setVpnConversion({ connectionId: contextConnection.id, mode }); setEditorRequest(undefined); setPanel('vpnWizard') },
    })) : []
  const canvasActions: ContextAction[] = [
    { label: t("Add hub"), run: () => setEditorRequest({ kind: 'hub' }) },
    { label: t("Add Azure VNet"), run: () => setEditorRequest({ kind: 'spoke' }) },
    { label: t("Add site"), run: () => setEditorRequest({ kind: 'site' }) },
    { label: t("Add ER location"), run: () => setEditorRequest({ kind: 'erLocation' }) },
    { label: t("Route maps"), run: () => openRouteMaps() },
    { label: t("Check routing"), run: checkRouting },
    { label: t("Model notes and warnings"), run: () => setPanel('notes') },
  ]
  const spokeObj = contextSelection?.kind === 'spoke' ? topology.spokes.find((spoke) => spoke.id === contextSelection.id) : undefined
  const spokeNvaConn = spokeObj ? topology.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === spokeObj.id) : undefined
  const spokeNvaSite = spokeNvaConn ? topology.sites.find((s) => s.id === spokeNvaConn.siteId) : undefined
  const contextActions: ContextAction[] = contextSelection ? [
    ...(contextMenu?.routeMap ? [{
      label: t("Remove route map association"),
      run: () => {
        const association = contextMenu.routeMap!
        update((next) => {
          const router = (association.router.kind === 'hub' ? next.hubs : next.sites).find((router) => router.id === association.router.id)
          const binding = router?.routeMapAssignments?.find((binding) => binding.connectionId === association.connectionId)
          if (!router || !binding) return
          delete binding[`${association.direction}MapId`]
          router.routeMapAssignments = router.routeMapAssignments?.filter((binding) => binding.inboundMapId || binding.outboundMapId)
        })
      },
    }] : []),
    { label: t("Edit configuration"), run: () => setEditorRequest(contextSelection) },
    ...(['hub', 'site', 'erLocation'].includes(contextSelection.kind) ? [
      { label: t("BGP table"), run: () => showRoutes(contextSelection) },
      { label: t("Learned routes"), run: () => showRoutes(contextSelection, false, 'learned') },
      { label: t("Advertised routes"), run: () => showRoutes(contextSelection, false, 'advertised') },
      { label: t('Highlight preferred routes'), run: () => { selectRouter(contextSelection); setDiagnosticHighlight(undefined); setHighlighting(true); setTracing(false) } },
    ] : []),
    ...(['hub', 'site'].includes(contextSelection.kind) ? [{ label: t("Route maps"), run: () => openRouteMaps(contextSelection as RouterSelection) }] : []),
    ...(['hub', 'site'].includes(contextSelection.kind) ? [{ label: t("Show route map rules"), run: () => showRouteMapRules(contextSelection as RouterSelection) }] : []),
    ...(['hub', 'site'].includes(contextSelection.kind) ? [{ label: t("Static routing"), run: () => openStaticRouting(contextSelection as RouterSelection) }] : []),
    ...(['hub', 'site', 'spoke'].includes(contextSelection.kind) ? [
      { label: t("Show path to"), disabled: !simulation.converged, children: pathActions(contextSelection as PathNode, 'to') },
      { label: t("Show path from"), disabled: !simulation.converged, children: pathActions(contextSelection as PathNode, 'from') },
      { label: t("Open path explorer"), run: () => openPath(contextSelection as PathNode, 'to') },
    ] : []),
    ...(contextSelection.kind === 'hub' ? [
      ...(topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.private || topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.internet ? [{ label: t("Show firewall routes"), run: () => showRoutes(contextSelection, true) }] : []),
      { label: t("Add spoke"), run: () => setEditorRequest({ kind: 'spoke', hubId: contextSelection.id }) },
      { label: t("Add connected site"), run: () => setEditorRequest({ kind: 'site', hubId: contextSelection.id }) },
      { label: t("Connect existing site"), disabled: !topology.sites.length, run: () => setEditorRequest({ kind: 'connection', hubId: contextSelection.id }) },
      { label: t("Connect to ER location"), disabled: !topology.erLocations?.length, run: () => setEditorRequest({ kind: 'erLink', hubId: contextSelection.id }) },
    ] : []),
    ...(contextSelection.kind === 'site' ? [
      { label: t("Connect to hub"), disabled: !topology.hubs.length, run: () => setEditorRequest({ kind: 'connection', siteId: contextSelection.id }) },
      { label: t("Link to another site"), disabled: topology.sites.length < 2, run: () => setEditorRequest({ kind: 'siteLink', siteId: contextSelection.id }) },
      { label: t("Connect to ER location"), disabled: !topology.erLocations?.length, run: () => setEditorRequest({ kind: 'erLink', siteId: contextSelection.id }) },
    ] : []),
    ...(contextSelection.kind === 'spoke' ? [
      ...(spokeObj?.hubId ? [
        ...(spokeNvaConn && spokeNvaSite ? [
          { label: t("Configure BGP NVA"), run: () => setEditorRequest({ kind: 'site', id: spokeNvaSite.id, spokeId: spokeObj.id }) },
          { label: t("Add downstream VNet"), run: () => setEditorRequest({ kind: 'spoke', nvaSpokeId: spokeObj.id }) },
          { label: t("Add downstream site"), run: () => setEditorRequest({ kind: 'site', nvaSpokeId: spokeObj.id }) },
          { label: t("NVA BGP table"), run: () => showRoutes({ kind: 'site', id: spokeNvaSite.id }) },
          { label: t("NVA learned routes"), run: () => showRoutes({ kind: 'site', id: spokeNvaSite.id }, false, 'learned') },
          { label: t("NVA advertised routes"), run: () => showRoutes({ kind: 'site', id: spokeNvaSite.id }, false, 'advertised') },
          { label: t("NVA route maps"), run: () => openRouteMaps({ kind: 'site', id: spokeNvaSite.id }) },
          { label: spokeNvaConn.enabled ? t("Disable BGP NVA") : t("Enable BGP NVA"), run: () => update((next) => { const c = next.connections.find((c) => c.id === spokeNvaConn.id)!; c.enabled = !c.enabled }) },
          { label: t("Remove BGP NVA"), danger: true, run: () => setEditorRequest({ kind: 'site', id: spokeNvaSite.id, spokeId: spokeObj.id, deleting: true }) },
        ] : [
          { label: t("Add BGP NVA"), run: () => setEditorRequest({ kind: 'site', spokeId: contextSelection.id }) },
        ]),
        { label: t("Spoke connection route maps"), run: () => { openRouteMaps({ kind: 'hub', id: spokeObj.hubId! }, contextSelection.id) } },
      ] : []),
    ] : []),
    ...(contextSelection.kind === 'erLocation' ? [
      { label: t("Show ER Location Info"), run: () => {
        const loc = topology.erLocations?.find((l) => l.id === contextSelection.id)
        const hubLink = topology.erLinks?.find((l) => l.locationId === contextSelection.id && l.hubId)
        const hub = hubLink ? topology.hubs.find((h) => h.id === hubLink.hubId) : undefined
        setErLocationModal({ open: true, peeringLocation: loc?.peeringLocation ?? loc?.name, sku: loc?.sku ?? 'Standard', targetAzureRegion: hub?.region, erLocationId: loc?.id })
      } },
      { label: t("Connect to hub"), disabled: !topology.hubs.length, run: () => setEditorRequest({ kind: 'erLink', locationId: contextSelection.id }) },
      { label: t("Connect to site"), disabled: !topology.sites.length, run: () => setEditorRequest({ kind: 'erLink', locationId: contextSelection.id, siteId: topology.sites[0]?.id }) },
    ] : []),
    ...(contextSelection.kind === 'erLink' ? [
      { label: t("Show ER Location Info"), run: () => {
        const link = topology.erLinks?.find((l) => l.id === contextSelection.id)
        const loc = link ? topology.erLocations?.find((l) => l.id === link.locationId) : undefined
        const hub = link?.hubId ? topology.hubs.find((h) => h.id === link.hubId) : undefined
        setErLocationModal({ open: true, peeringLocation: loc?.peeringLocation ?? loc?.name, sku: loc?.sku ?? 'Standard', targetAzureRegion: hub?.region, erLocationId: loc?.id })
      } },
      { label: topology.erLinks?.find((link) => link.id === contextSelection.id)?.enabled ? t("Disable connection") : t("Enable connection"), run: () => update((next) => { const link = next.erLinks!.find((link) => link.id === contextSelection.id)!; link.enabled = !link.enabled }) },
    ] : []),
    ...(contextSelection.kind === 'connection' ? [
      ...vpnActions,
      { label: topology.connections.find((c) => c.id === contextSelection.id)?.enabled ? t("Disable connection") : t("Enable connection"), run: () => update((next) => { const c = next.connections.find((c) => c.id === contextSelection.id)!; c.enabled = !c.enabled }) },
    ] : []),
    { label: t("Delete {0}", t(objectLabels[contextSelection.kind])), danger: true, run: () => setEditorRequest({ ...contextSelection, deleting: true }) },
  ] : canvasActions
  const exportTopology = (original = '') => {
    const url = URL.createObjectURL(new Blob([original || JSON.stringify(topology, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vwan-topology.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importTopology = async (file?: File) => {
    if (!file) return
    const revision = ++importRequest.current
    setPendingAzureImport(undefined)
    try {
      if (file.size > 2_000_000) throw new Error('Topology files must be smaller than 2 MB.')
      const input: unknown = JSON.parse(await file.text())
      if (revision !== importRequest.current) return
      if (input && typeof input === 'object' && 'kind' in input && input.kind === 'azure-vwan-capture') {
        const next = importAzureCapture(input)
        setPendingAzureImport({ revision, topology: next }); setError(''); setPanel('azure')
      } else reset(validateTopology(input))
    } catch (error) { if (revision === importRequest.current) setError(`Import rejected: ${message(error)}`) }
  }
  const pathTitle = (path: NodePath) => [
    'sourceName' in path ? path.sourceName : sourceNode?.name, ...(path.sourceSiteHops?.slice(1).map((id) => topology.sites.find((s) => s.id === id)?.name) ?? []),
    topology.connections.find((c) => c.id === path.sourceConnectionId)?.name,
    topology.spokes.find((spoke) => spoke.id === path.sourceNvaSpokeId)?.name,
    ...(path.sourceErLinkIds?.map((id) => topology.erLinks?.find((link) => link.id === id)?.name) ?? []),
    ...path.hubs.flatMap((id) => [topology.hubs.find((h) => h.id === id)?.name, ...(path.firewalls?.includes(id) ? ['Azure Firewall'] : [])]),
    topology.spokes.find((spoke) => spoke.id === path.nvaSpokeId)?.name,
    topology.connections.find((c) => c.id === path.connectionId)?.name,
    ...(path.erLinkIds?.map((id) => topology.erLinks?.find((link) => link.id === id)?.name) ?? []),
    ...(path.siteHops?.map((id) => topology.sites.find((s) => s.id === id)?.name) ?? [topology.spokes.find((s) => s.id === path.siteId)?.name]),
  ].filter((name, index, all) => !!name && name !== all[index - 1]).join(' → ')
  const submitPath = (event: FormEvent) => { event.preventDefault(); setGroupTrace(undefined); setHighlighting(false); setTracing(true) }
  const closePanel = () => setPanel(undefined)

  return <div className="app canvas-app mode-vwan" data-testid="vwan-app" data-revision={import.meta.env.VITE_APP_REVISION || 'development'}>
    <header className="topbar unified-topbar unified-topbar-vwan" data-testid="unified-topbar">
      <div className="unified-topbar-left">
        <div className="brand unified-brand">
          <div className="brand-icon unified-brand-icon" aria-hidden="true">Az</div>
          <h1>AzNet Simulator</h1>
          <span className="unified-mode-pill unified-mode-pill-vwan" data-testid="unified-mode-pill">Virtual WAN</span>
        </div>
        {onChangeSimulatorMode && <SimulatorModeSwitch mode={simulatorMode} onChange={onChangeSimulatorMode} variant="vwan" />}
      </div>
      <div className="actions unified-topbar-controls"><LanguageSelector /><span className="local-badge">{t("Local-first · no Azure credentials")}</span><button onClick={() => setErLocationModal({ open: true })} data-testid="vwan-topbar-er-locations-btn">{t("ER Locations")}</button><button onClick={() => setPanel('samples')}>{t("Sample topologies")}</button><button onClick={() => exportTopology()}>{t("Export JSON")}</button><button onClick={() => importer.current?.click()}>{t("Import JSON")}</button><button onClick={() => setPanel('azure')}>{t("Azure files")}</button><button onClick={() => setClearRequested(true)}>{t("Clear topology")}</button><button onClick={() => window.open(language === 'ja' ? '/docs/index.html?lang=ja' : '/docs/index.html', '_blank', 'noopener,noreferrer')}>{t("Docs")}</button><button onClick={() => setFeedbackOpen(true)}>{t("Feedback")}</button><input ref={importer} hidden type="file" accept=".json,application/json" aria-label={t("Import topology file")} onChange={(e) => { void importTopology(e.target.files?.[0]); e.target.value = '' }} /></div>
    </header>
    {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    <ErLocationInfoModal
      isOpen={erLocationModal.open}
      initialLocationName={erLocationModal.peeringLocation}
      currentSku={erLocationModal.sku}
      connectedAzureRegions={erLocationModal.targetAzureRegion ? [{ name: 'Virtual WAN Hub', region: erLocationModal.targetAzureRegion }] : []}
      onClose={() => setErLocationModal((prev) => ({ ...prev, open: false }))}
      onSelectLocationAndSku={erLocationModal.erLocationId ? (peeringLocation: string, sku: ErCircuitSku) => {
        update((next) => {
          const loc = next.erLocations?.find((l) => l.id === erLocationModal.erLocationId)
          if (loc) {
            loc.peeringLocation = peeringLocation
            loc.sku = sku
          }
        })
      } : undefined}
    />
    <main>
      <section className="workspace-heading"><div><p className="eyebrow">{t("NETWORK WORKSPACE")}</p><input className="topology-name" aria-label={t("Topology name")} maxLength={120} value={topology.name} onChange={(e) => update((next) => { next.name = e.target.value })} /></div><div className="stats"><span><strong>{topology.hubs.length}</strong>  {t("hubs")}</span><span><strong>{topology.spokes.length}</strong>  {t("spokes")}</span><span><strong>{topology.sites.length - nvaSiteIds.size}</strong>  {t("sites")}</span>{nvaSiteIds.size > 0 && <span><strong>{nvaSiteIds.size}</strong>  {t("spoke NVAs")}</span>}{!!topology.erLocations?.length && <span><strong>{topology.erLocations.length}</strong>  {t("ER locations")}</span>}</div></section>
      {error && <div role="alert" className="notice error">{localizeDiagnostic(error)}<button aria-label={t("Dismiss error")} onClick={() => setError('')}>{t("Dismiss")}</button></div>}
      {initialBackup && <div className="notice">{t("The example is displayed because the saved workspace could not be loaded. Download the original before editing or closing this page.")} <button onClick={() => exportTopology(initialBackup)}>{t("Download original saved topology")}</button></div>}
      {saveError && <p role="alert" className="notice error">{localizeDiagnostic(saveError)}</p>}
      {topology.azureImport && <div className="notice" role="status">{t("Azure structure-only import · simulated routes are not verified Azure effective routes.")} <button onClick={() => setPanel('azure')}>{t("Review import limitations")}</button></div>}
      <section className="canvas-workspace panel" aria-label={t("Topology workspace")}>
        <div className="canvas-toolbar"><div><h2>{t("Network topology")}</h2><p className="muted">{t("Drag blank canvas to pan; drag nodes to arrange. Right-click for actions. Alt+Arrow moves a focused node.")}</p></div>
          <div className="canvas-tools"><label className="field"><span>{t("Visualization")}</span><select aria-label={t("Visualization mode")} value={layout} onChange={(e) => update((next) => { next.layout ??= { mode: 'layered', positions: {} }; next.layout.mode = e.target.value as LayoutMode })}><option value="layered">{t("Layered topology")}</option><option value="constellation">{t("Network constellation")}</option></select></label><div className="zoom-controls"><button aria-label={t("Zoom out")} disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}>-</button><label className="field"><span>{t("Zoom")}</span><select aria-label={t("Canvas zoom")} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}><option value={0.75}>75%</option><option value={1}>100%</option><option value={1.25}>125%</option><option value={1.5}>150%</option></select></label><button aria-label={t("Zoom in")} disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, value + 0.25))}>+</button></div><button disabled={!canUndo} title={t("Undo last topology change (Ctrl+Z)")} onClick={undo}>{t("Undo")}</button><button disabled={!canRedo} title={t("Redo topology change (Ctrl+Y)")} onClick={redo}>{t("Redo")}</button><button disabled={!Object.keys(topology.layout?.positions[layout] ?? {}).length} title={t("Restore automatic positions in the current visualization only")} onClick={() => update((next) => { if (next.layout) delete next.layout.positions[layout] })}>{t("Reset layout")}</button>
            <button onClick={() => setEditorRequest({ kind: 'hub' })}>{t("+ Hub")}</button><button onClick={() => setEditorRequest({ kind: 'spoke' })}>{t("+ VNet")}</button><button onClick={() => setEditorRequest({ kind: 'site' })}>{t("+ Site")}</button><button onClick={() => setEditorRequest({ kind: 'erLocation' })}>{t("+ ER location")}</button><button onClick={() => openRouteMaps()}>{t("Route maps")}</button><button disabled={currentCheck?.status === 'running'} onClick={checkRouting}>{t("Check routing")}</button><button aria-label={t("Open model notes and warnings")} onClick={() => setPanel('notes')}>{t("Notes")}{simulation.warnings.length ? ` (${simulation.warnings.length})` : ''}</button></div>
        </div>
        {routingCheck && <div className="routing-check-status" role="status">
          <span>{t(!currentCheck ? 'Routing changed. Check routing again.' : currentCheck.status === 'running' ? 'Checking all modeled networks…'
            : currentCheck.status === 'cancelled' ? 'Routing check cancelled. No complete result is available.'
            : currentCheck.status === 'failed' ? 'Routing check failed. No complete result is available.'
            : checkCoverage?.scanIncomplete ? 'Routing check is incomplete. Some networks or scenarios could not be assessed.'
            : routingIssues.length ? 'Routing check completed.'
            : checkCoverage?.noCheckablePairs || checkCoverage?.unassignedPrefixes.length
              ? 'Advertised networks have no declared owner. Assign site or VNet prefixes to verify end-to-end reachability.'
              : 'No routing issues found within the checked model scope.')}</span>
          {currentCheck?.report && checkCoverage && <><span>{[
            t('{0} routing issues', routingIssues.length),
            ...(checkCoverage.unassignedPrefixes.length ? [checkCoverage.unassignedPrefixes.length === 1 ? t('1 unassigned advertised prefix') : t('{0} unassigned advertised prefixes', checkCoverage.unassignedPrefixes.length)] : []),
            ...(checkCoverage.unsupportedFlowCount ? [checkCoverage.unsupportedFlowCount === 1 ? t('1 model-limited flow pair') : t('{0} model-limited flow pairs', checkCoverage.unsupportedFlowCount)] : []),
            ...(checkCoverage.otherUnknownFindings.length ? [checkCoverage.otherUnknownFindings.length === 1 ? t('1 incomplete check') : t('{0} incomplete checks', checkCoverage.otherUnknownFindings.length)] : []),
          ].join(' · ')}</span>
            <button onClick={() => { setRoutingIssueId(undefined); setReviewCoverage(false); setPanel('issues') }}>{t('Review routing issues')}</button>
            {checkCoverage.hasNotes && <button onClick={() => { setRoutingIssueId(undefined); setReviewCoverage(true); setPanel('issues') }}>{t('Review analysis coverage')}</button>}</>}
          {currentCheck?.status === 'running' && <button onClick={() => { checkWorker.current?.worker.terminate(); checkWorker.current = undefined; setRoutingCheck({ revision: routingKey, status: 'cancelled' }) }}>{t('Cancel analysis')}</button>}
          <button onClick={openDiagnostics}>{t('Advanced checks')}</button>
        </div>}
        <div className="canvas-stage">
          {panel === 'diagnostics' && <DiagnosticsPanel topology={topology} onFinding={showDiagnostic} onInspect={(node) => showRoutes(node)} onEditObject={editCoveredObject} onOpenStaticRouting={(router) => { setEditorRequest(undefined); openStaticRouting(router) }} onAssignPrefixToSite={assignPrefixToSite} onClearHighlight={() => setDiagnosticHighlight(undefined)} onProfileChange={cancelRoutingCheck} onClose={closePanel} />}
          {panel === 'issues' && currentCheck?.report && <RoutingIssuesPanel key={`${routingKey}:${routingIssueId ?? ''}:${reviewCoverage}`} topology={topology} report={currentCheck.report} findingId={routingIssueId} coverageOpen={reviewCoverage} selectedFindingId={diagnosticPaths ? diagnosticHighlight?.findingId : undefined} onFinding={showDiagnostic} onShowAll={() => setRoutingIssueId(undefined)} onInspect={showRoutes} onEditObject={editCoveredObject} onOpenStaticRouting={(router) => { setEditorRequest(undefined); openStaticRouting(router) }} onAssignPrefixToSite={assignPrefixToSite} onClose={closePanel} />}
          {panel === 'comparison' && <AzureComparisonPanel topology={topology} session={comparisonSession} onSession={setComparisonSession} onSelect={setSelection} onClose={closePanel} />}
          {panel === 'azure' && <AzureFilesPanel key={pendingAzureImport?.revision ?? 'workspace'} topology={topology} pendingImport={pendingAzureImport?.topology} onImportFile={() => importer.current?.click()} onCompare={() => { setPendingAzureImport(undefined); setHighlighting(false); setTracing(false); setPanel('comparison') }} onConfirmImport={() => { if (pendingAzureImport) reset(validateTopology(pendingAzureImport.topology)) }} onCancelImport={() => { setPendingAzureImport(undefined); setPanel(undefined) }} onClose={() => { setPendingAzureImport(undefined); closePanel() }} />}
          <TopologyDiagram topology={topology} issues={routingIssues} onShowIssues={(finding) => { setRoutingIssueId(finding.id); setReviewCoverage(false); setPanel('issues'); showDiagnostic(finding) }} hubId={highlighting && router.kind === 'hub' ? router.id : ''} erLocationId={highlighting && router.kind === 'erLocation' ? router.id : undefined} selected={selectedRoutes} selectedSiteRoutes={highlighting && router.kind === 'site' ? simulation.siteTables[router.id]?.filter((r) => !prefix || r.prefix === prefix) : undefined} sourceConnectionIds={diagramPaths.flatMap((p) => p.sourceConnectionId ? [p.sourceConnectionId] : [])} sourceSiteLinkIds={diagramPaths.flatMap((p) => p.sourceSiteLinkIds ?? [])} sourceErLinkIds={diagramPaths.flatMap((path) => path.sourceErLinkIds ?? [])} paths={diagramPaths} sourceSpokeIds={diagramPaths.flatMap((path) => path.sourceSpokeId ? [path.sourceSpokeId] : [])} tracing={tracing || siteHighlight.length > 0 || !!diagnosticPaths?.length} layout={layout} zoom={zoom} selection={selection} onObjectClick={selectObject} onShowRouteMapRules={showRouteMapRules} onNodeMove={(id, position) => update((next) => { next.layout ??= { mode: layout, positions: {} }; next.layout.positions[layout] ??= {}; next.layout.positions[layout]![id] = position })} onObjectContextMenu={(value) => { if (value.selection) selectObject(value.selection); setContextMenu(value) }} />
          {(highlighting || tracing || !!diagnosticPaths?.length || routingIssues.length > 0) && <div className="highlight-status" role="status">{(highlighting || tracing || !!diagnosticPaths?.length) ? (diagnosticPaths?.length ? t('Diagnostic path evidence') : tracing ? groupTrace ? `${groupSummary} · ${paths.length ? pathStatus : t("No matching sources or destination prefixes configured")}` : t('Path: {0} → {1} · {2} · {3}', sourceNode?.name ?? t('source'), targetNode?.name ?? destination, destinationPrefix || destination, pathStatus) : prefix ? t("Preferred routes to {0}", prefix) : t("Preferred routes · {0}", inspected?.name ?? t('Router'))) : t('{0} routing issues', routingIssues.length)}{tracing && <button onClick={() => setPanel('paths')}>{t("Path details")}</button>}{(highlighting || tracing || !!diagnosticPaths?.length) && <button onClick={() => { setDiagnosticHighlight(undefined); setHighlighting(false); setTracing(false); setPrefix('') }}>{t("Clear highlighting")}</button>}{routingIssues.length > 0 && <button onClick={clearHighlightsAndIcons}>{t("Clear highlights & icons")}</button>}</div>}
          {panel === 'routes' && inspected && <RouteInspector key={`${router.kind}:${router.id}:${routeMode}`} topology={topology} simulation={simulation} comparisonSession={comparisonSession} router={router} view={activeView} mode={routeMode} onRouter={selectRouter} onView={(view) => { setRouteView(view); setPrefix(''); setHighlighting(false) }} onPreference={(preference) => update((next) => { next.hubs.find((h) => h.id === router.id)!.preference = preference })} onPrefix={(value) => { setPrefix(value); setHighlighting(true); setTracing(false) }} onClose={closePanel} />}
          {panel === 'maps' && <RouteMapsPanel key={mapRouter ? nodeKey(mapRouter) : 'resources'} topology={topology} simulation={simulation} router={mapRouter} connectionId={mapConnectionId} onRouter={(value) => { setMapRouter(value); setMapConnectionId(undefined) }} onSave={save} onClose={closePanel} />}
          {panel === 'rules' && mapRouter && <RouteMapInspector topology={topology} router={mapRouter} direction={mapDirection} connectionId={mapConnectionId} onDirection={setMapDirection} onConnection={setMapConnectionId} onConfigure={openRouteMaps} onClose={closePanel} />}
          {panel === 'static' && mapRouter && <StaticRoutingPanel key={nodeKey(mapRouter)} topology={topology} router={mapRouter} onSave={save} onClose={closePanel} />}
          {panel === 'vpnWizard' && vpnConversion && <VpnRoutingWizard key={`${vpnConversion.connectionId}:${vpnConversion.mode}`} topology={topology} connectionId={vpnConversion.connectionId} mode={vpnConversion.mode} onSave={save} onClose={closePanel} />}
          {panel === 'paths' && <CanvasOverlay title={t("Path explorer")} className="path-panel" onClose={closePanel}>
            {tracing && groupTrace && <p><strong>{groupSummary}</strong>{t(". Each source is traced independently to the destination prefixes; reverse-path symmetry is not assumed.")}</p>}
            <p className="muted">{t("Longest-prefix forwarding and preferred BGP paths, not shortest graphical distance. ECMP paths remain highlighted together. Hub destinations use attached-spoke prefixes. Sites without assigned prefixes offer explicit connection advertisements as destination choices; these can be transit prefixes.")}</p>
            <form className="path-form" onSubmit={submitPath}><div className="form-grid"><label className="field"><span>{t("Source node")}</span><select aria-label={t("Source node")} value={source} onChange={(e) => { setSource(e.target.value); setTracing(false) }}><option value="">{t("Select source")}</option>{nodes.map((n) => <option key={nodeKey(n)} value={nodeKey(n)}>{n.name} ({t(n.kind)})</option>)}</select></label><label className="field"><span>{t("Destination node")}</span><select aria-label={t("Destination node")} value={target} onChange={(e) => { const prefixes = nodePrefixes(topology, parseNode(e.target.value)); setTarget(e.target.value); setDestination(prefixes[0]?.split('/')[0] ?? ''); setDestinationPrefix(prefixes[0] ?? ''); setTracing(false) }}><option value="">{t("Select destination")}</option>{nodes.map((n) => <option key={nodeKey(n)} value={nodeKey(n)}>{n.name} ({t(n.kind)})</option>)}</select></label></div>
              <label className="field"><span>{t("Destination prefix")}</span><select aria-label={t("Destination prefix")} value={destinationPrefix} onChange={(e) => { setDestinationPrefix(e.target.value); setDestination(e.target.value.split('/')[0]); setTracing(false) }}><option value="">{t("Custom IPv4 address")}</option>{targetNode && nodePrefixes(topology, targetNode).map((p) => <option key={p}>{p}</option>)}</select></label>
              {!destinationPrefix && <label className="field"><span>{t("Destination IPv4")}</span><input aria-label={t("Destination IPv4")} value={destination} onChange={(e) => { setDestination(e.target.value); setTracing(false) }} required /></label>}<p className="muted">{t("A prefix selection traces its network address. Choose Custom IPv4 address to test a more-specific destination within that range.")}</p><button className="primary" disabled={!sourceNode || !targetNode || ipv4(destination) === undefined || !simulation.converged}>{t("Show preferred path")}</button>
            </form>
            <p className="muted">{t("Routes may terminate at another advertiser of the same prefix. Reverse paths are calculated independently; symmetry, firewall permissions and host reachability are not assumed. Site ingress uses advertised AS paths.")}</p>
            {tracing && <div className="flow-results" aria-live="polite">{paths.map((path, i) => <article key={i} className={`flow-result ${path.status}`}><strong>{'destinationPrefix' in path && `${path.sourceName} → ${path.destinationName} · ${path.destinationPrefix} · `}{path.status === 'delivered' ? t("Reachable") : path.status === 'loop' ? t("Forwarding loop") : t("No route")}{paths.length > 1 ? t(" · path {0}", i + 1) : ''}</strong><p>{pathTitle(path)}</p><details><summary>{t("Why this path?")}</summary><ol>{path.steps.map((step, index) => <li key={index}>{localizeDiagnostic(step)}</li>)}</ol></details></article>)}{!paths.length && <p className="empty">{groupTrace ? t("No matching sources or destination prefixes configured.") : t("No trace available for this source or provisional routing state.")}</p>}</div>}
          </CanvasOverlay>}
          {panel === 'notes' && <CanvasOverlay title={t("Model notes and warnings")} className="model-notes" onClose={closePanel}>
            <h3>{t("Planning model, not an Azure control plane")}</h3><p>{t("One Standard Virtual WAN, fully meshed hubs and Default propagation. HRP follows Microsoft's documented local/remote, transport and AS-path ordering. Hub-table static overrides are not configurable; VPN site static routes do not get hub-static precedence.")}</p><p>{t("Routing intent uses separate hub policy and firewall forwarding tables. Firewall rules, SNAT, return-flow symmetry, custom route tables, communities, MED, Global Reach, shared-circuit reflection and arrival/failback timing are not simulated.")}</p>
            {simulation.warnings.map((warning) => <p className="notice" key={warning}>{localizeDiagnostic(warning)}</p>)}
            <p><a href="https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference" target="_blank" rel="noreferrer">{t("Microsoft hub routing preference")}</a></p><p><a href="https://learn.microsoft.com/azure/virtual-wan/route-maps-about" target="_blank" rel="noreferrer">{t("Microsoft route-map behavior and limitations")}</a></p>
            <button onClick={() => reset(validateTopology(structuredClone(example)))}>{t("Load example (replaces workspace)")}</button>
          </CanvasOverlay>}
          {panel === 'samples' && <CanvasOverlay title={t("Sample topologies")} className="model-notes" onClose={closePanel}>
            <p className="muted">{t("Choose a ready-made Virtual WAN topology below to replace the current workspace and immediately explore effective routes, path traces, and routing diagnostics.")}</p>
            <div className="flow-results">
              {VWAN_SAMPLE_GALLERY.map((sample) => (
                <article key={sample.id} className="flow-result">
                  <strong>{t(sample.title)}</strong>
                  <p>{t(sample.summary)}</p>
                  <button className="primary" onClick={() => loadGallerySample(sample)}>
                    {t("Load sample topology")}
                  </button>
                </article>
              ))}
            </div>
          </CanvasOverlay>}
          {editorRequest && <TopologyObjectEditor key={`${editorRequest.kind}:${editorRequest.id ?? 'new'}:${!!editorRequest.deleting}`} topology={topology} request={editorRequest} onClose={() => setEditorRequest(undefined)} onRouteMaps={openRouteMaps} onStaticRouting={openStaticRouting} onOpenErLocationInfo={(peeringLocation, sku, hubRegion, erLocationId) => setErLocationModal({ open: true, peeringLocation, sku, targetAzureRegion: hubRegion, erLocationId })} onAddNva={(spokeId) => {
            const existing = topology.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === spokeId)
            setEditorRequest({ kind: 'site', id: existing?.siteId, spokeId })
          }} onSave={(next, value) => {
            save(next); setSelection(editorRequest.deleting ? undefined : value); setEditorRequest(undefined)
            if (editorRequest.deleting && nodeKey(value) === nodeKey(router)) { setPanel(undefined); setHighlighting(false) }
            else if (editorRequest.deleting && mapRouter && nodeKey(value) === nodeKey(mapRouter) && (panel === 'maps' || panel === 'rules' || panel === 'static')) setPanel(undefined)
          }} />}
          {clearRequested && <CanvasOverlay title={t("Clear topology")} className="object-editor" onClose={() => setClearRequested(false)}>
            <p>{t("Remove all hubs, sites, spokes, ER locations, connections, route maps and saved layouts? This replaces the workspace saved in this browser and cannot be undone. Export JSON first if you need a backup.")}</p>
            <div className="row dialog-actions"><button onClick={() => setClearRequested(false)}>{t("Cancel clearing")}</button><button className="danger" onClick={() => { reset(validateTopology({ version: 1, name: 'New topology', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [] })); setZoom(1) }}>{t("Clear all objects")}</button></div>
          </CanvasOverlay>}
        </div>
        <div className="legend"><span><i className="legend-line er" />ExpressRoute</span><span><i className="legend-line vpn" />VPN</span><span><i className="legend-line sdwan" />SD-WAN</span><span><i className="legend-line preferred" />{t("Preferred / flow path")}</span><span><b className="policy-tag inbound">{t("IN")}</b><b className="policy-tag outbound">{t("OUT")}</b>{t("Per-connection maps · near owning router · click for rules")}</span><span className="live-dot">{simulation.converged ? t("Routes calculated") : t("Provisional routes")}</span></div>
      </section>
    </main>
    {contextMenu && <TopologyContextMenu key={contextSelection ? nodeKey(contextSelection) : 'canvas'} x={contextMenu.x} y={contextMenu.y} title={contextSelection ? t("{0} actions: {1}", t(objectLabels[contextSelection.kind]), contextObject?.name ?? '') : t("Canvas actions")} actions={contextActions} onClose={() => { contextMenu.invoker.focus({ preventScroll: true }); setContextMenu(undefined) }} />}
    <footer>{t("Calculated locally in your browser · Export JSON for portable backups")}</footer>
  </div>
}

export default App
