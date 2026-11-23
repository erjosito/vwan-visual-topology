import { t, localizeDiagnostic, useLanguage, documentTitles } from './i18n'
import { vwanWarningToken } from './warning-triage'
import { canAcknowledgeWarning, setWarningAcknowledgement } from './warning-acknowledgements'
import { LearningTools } from './learning/LearningTools'
import { WorkspaceAccountStatus, WorkspaceMenu } from './WorkspaceSession'
import { PresentationGroup, PresentationToggle } from './WorkspacePresentation'
import { previewVnetActions } from './context-actions'
import { confirmConfigurationSwitch } from './configuration-selection'
import { useWorkspaceEditorState, useWorkspaceSession, useWorkspaceStorage } from './workspace-context'
import { WorkspaceCanvasTabs, WorkspaceTabPanel } from './WorkspaceTabs'
import { DocumentActions } from './DocumentActions'
import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { example, objectLabels, topologyObject } from './model'
import type { LayoutMode, ObjectSelection, RouteMapDirection, RouterSelection, Topology } from './model'
import { simulate } from './routing'
import { vwanDisplayResult, vwanDisplaySimulation, vwanRoutingInput } from './vwan-routing-input'
import { ipv4, validateTopology } from './validation'
import { TopologyDiagram } from './TopologyDiagram'
import type { DiagramContextMenu } from './TopologyDiagram'
import type { ContextAction } from './TopologyContextMenu'
import type { EditorRequest } from './TopologyObjectEditor'
import type { ErCircuitSku } from './er-locations-catalog'
import { CanvasOverlay } from './CanvasOverlay'
import { hubGatewayConnections } from './hub-gateways'
import { WorkspaceTools } from './WorkspaceTools'
import { vwanWorkspaceIdentity, vwanWorkspaceObjects } from './workspace-objects'
import { RouteInspector } from './RouteInspector'
import { RouteMapInspector } from './RouteMapInspector'
import { StaticRoutingPanel } from './StaticRoutingPanel'
import type { RouteMode } from './route-views'
import { erLocationBgpTable } from './route-views'
import type { ComparisonSession } from './AzureComparisonPanel'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { RoutingIssuesPanel } from './RoutingIssuesPanel'
import { describeDiagnosticsProgress, diagnosticFlowCount, routingRevision, summarizeCoverage, validateDiagnosticsProfile } from './diagnostics'
import type { DiagnosticsFinding, DiagnosticsReport } from './diagnostics'
import { importAzureCapture } from './azure-import'
import { vpnRoutingMode } from './vpn-routing'
import type { VpnRoutingMode } from './vpn-routing'
import { azureRoutesAtSites, nodePrefixes, traceGroupedPaths, traceNodePath } from './paths'
import { DEFAULT_HUB_TABLE, attachmentHubRouting, hubRouteTables } from './hub-routing'
import type { GroupPath, NodePath, PathDirection, PathGroup, PathNode } from './paths'
import { embeddedSpokeNvaSiteIds } from './topology-graph'
import { assignSitePrefixes } from './topology-mutations'
import { useTopologyHistory } from './useTopologyHistory'
import { routingIntentConfiguration, routingIntentManaged } from './routing-intent'
import { applyRoutingIntentEdit } from './native-routing-intent'
import { useDeleteShortcut } from './useDeleteShortcut'
import './App.css'
import { projectVwanFailures, regionKey, failureKey, failureLabel, type FailureDomain } from './failures'
import { analyzeVwanResilience, resilienceMarkers, type ResilienceReport } from './failure-analysis'
import { FailurePanel } from './FailurePanel'
import { pruneDeletedInventory } from './inventory'
import { measureAzWork, useMeasuredRender } from './azure-net/performance'

const NetworkDetail = lazy(() => import('./NetworkDetail').then((module) => ({ default: module.NetworkDetail })))
const VwanVnetConnectionPanel = lazy(() => import('./VwanVnetConnectionPanel'))
const VpnRoutingWizard = lazy(() => import('./VpnRoutingWizard').then((module) => ({ default: module.VpnRoutingWizard })))
const RouteMapsPanel = lazy(() => import('./RouteMapsPanel').then((module) => ({ default: module.RouteMapsPanel })))
const BgpNeighborsPanel = lazy(() => import('./BgpNeighborsPanel'))
const AzureComparisonPanel = lazy(() => import('./AzureComparisonPanel').then(module => ({ default: module.AzureComparisonPanel })))
const FlowExportControls = lazy(() => import('./FlowExportControls').then(module => ({ default: module.FlowExportControls })))
const ErLocationInfoModal = lazy(() => import('./ErLocationInfoModal').then(module => ({ default: module.ErLocationInfoModal })))
const SampleGallery = lazy(() => import('./SampleGallery').then((module) => ({ default: module.VwanSampleGallery })))
const HubCapabilitiesDialog = lazy(() => import('./HubCapabilitiesDialog'))
const ClearTopologyDialog = lazy(() => import('./ClearTopologyDialog').then((module) => ({ default: module.ClearTopologyDialog })))
const CloneVnetDialog = lazy(() => import('./CloneVnetDialog').then((module) => ({ default: module.CloneVnetDialog })))
const TopologyContextMenu = lazy(() => import('./TopologyContextMenu').then((module) => ({ default: module.TopologyContextMenu })))
const AzureFilesPanel = lazy(() => import('./AzureFilesPanel').then((module) => ({ default: module.AzureFilesPanel })))
const TopologyObjectEditor = lazy(() => import('./TopologyObjectEditor').then((module) => ({ default: module.TopologyObjectEditor })))
const RouterSnatDialog = lazy(() => import('./RouterSnatEditor').then((module) => ({ default: module.RouterSnatDialog })))
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

function App() {
  useMeasuredRender()
  const workspaceSession = useWorkspaceSession()
  const workspaceStorage = useWorkspaceStorage()
  const [toolsOpenRequest, setToolsOpenRequest] = useState(0)
  const language = useLanguage()
  useEffect(() => {
    document.documentElement.lang = language
    document.title = documentTitles[language]
  }, [language])
  const [selection, setSelection] = useWorkspaceEditorState<ObjectSelection>('vwan.selection')
  const [detailOwner, setDetailOwner] = useWorkspaceEditorState<string>('vwan.detail')
  const [inventorySelection, setInventorySelection] = useWorkspaceEditorState<string>('vwan.inventory')
  const [vnetConnectionId, setVnetConnectionId] = useWorkspaceEditorState<string>('vwan.vnetConnection')
  const [routerState, setRouter] = useWorkspaceEditorState<ObjectSelection>('vwan.router')
  const [contextMenu, setContextMenu] = useState<DiagramContextMenu>()
  const [editorRequest, setEditorRequestState] = useState<EditorRequest>()
  const setEditorRequest = (request?: EditorRequest) => {
    if (request && vnetConnectionId && !confirmConfigurationSwitch('.app.mode-vwan .object-editor')) return false
    if (editorRequest && request && (editorRequest.kind !== request.kind || editorRequest.id !== request.id || !!editorRequest.deleting !== !!request.deleting)
      && !confirmConfigurationSwitch('.app.mode-vwan .object-editor')) return false
    setEditorRequestState(request)
    if (request) setVnetConnectionId(undefined)
    return true
  }
  const [snatHubId, setSnatHubId] = useState<string>()
  const openVnetConnection = (spokeId: string) => {
    if (!confirmConfigurationSwitch('.app.mode-vwan .object-editor')) return
    setEditorRequestState(undefined)
    setVnetConnectionId(spokeId)
    setSelection({ kind: 'spoke', id: spokeId })
  }
  const [bgpInspection, setBgpInspection] = useState<{ resource?: import('./bgp-neighbors').BgpResourceRef; revision: number }>()
  const [clearRequested, setClearRequested] = useState(false)
  const [cloneVnetId, setCloneVnetId] = useState<string>()
  const [capabilitiesHubId, setCapabilitiesHubId] = useState<string>()
  const [erLocationModal, setErLocationModal] = useState<{ open: boolean; hasOpened?: boolean; peeringLocation?: string; sku?: ErCircuitSku; targetAzureRegion?: string; erLocationId?: string }>({ open: false })
  const [panel, setPanel] = useWorkspaceEditorState<'routes' | 'maps' | 'rules' | 'static' | 'vpnWizard' | 'paths' | 'notes' | 'azure' | 'diagnostics' | 'issues' | 'comparison' | 'samples'>('vwan.panel')
  const [comparisonSession, setComparisonSession] = useState<ComparisonSession>()
  const [diagnosticHighlight, setDiagnosticHighlight] = useWorkspaceEditorState<{ revision: string; findingId: string; paths: GroupPath[] }>('vwan.diagnosticHighlight')
  const [routingCheck, setRoutingCheck] = useWorkspaceEditorState<{ revision: string; status: 'running' | 'complete' | 'cancelled' | 'failed'; report?: DiagnosticsReport } | undefined>(
    'vwan.routingCheck', undefined, value => value && (value.status === 'running' || value.report?.continuation?.status === 'paused')
      ? { ...value, status: 'cancelled', report: value.report ? { ...value.report, complete: false,
        ...(value.report.continuation ? { continuation: { ...value.report.continuation, status: 'cancelled' } } : {}) } : undefined } : value)
  const [routingIssueId, setRoutingIssueId] = useWorkspaceEditorState<string>('vwan.routingIssue')
  const [reviewCoverage, setReviewCoverage] = useWorkspaceEditorState('vwan.reviewCoverage', false)
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
  const [faults, setFaults] = useWorkspaceEditorState<FailureDomain[]>('vwan.faults', [])
  const [resilience, setResilience] = useWorkspaceEditorState<{ revision: string; report: ResilienceReport }>('vwan.resilience')
  const [resilienceEndpoint, setResilienceEndpoint] = useWorkspaceEditorState<string>('vwan.resilienceEndpoint')
  const baselineRevision = measureAzWork('routing-projection', () => routingRevision(topology))
  const risks = resilienceMarkers(resilience?.revision === baselineRevision ? resilience.report : undefined)
  const scenario = useMemo(() => projectVwanFailures(topology, faults), [topology, faults])
  const activeTopology = scenario.active
  const addFault = (fault: FailureDomain) => {
    const next = [...faults.filter((f) => failureKey(f) !== failureKey(fault)), fault]
    setFaults(next)
    setEditorRequest(undefined)
    setPanel(undefined)
    setDiagnosticHighlight(undefined)
    if (routingCheck) runRoutingCheck(projectVwanFailures(topology, next).active, true)
  }
  const restoreFault = (fault?: FailureDomain) => {
    const next = fault ? faults.filter((f) => failureKey(f) !== failureKey(fault)) : []
    setFaults(next)
    if (routingCheck) runRoutingCheck(projectVwanFailures(topology, next).active, true)
  }
  const router = useMemo<ObjectSelection>(
    () => (routerState && topologyObject(topology, routerState) ? routerState : { kind: 'hub', id: topology.hubs[0]?.id ?? '' }),
    [routerState, topology],
  )
  const routingKey = useMemo(() => measureAzWork('routing-projection', () => routingRevision(activeTopology)), [activeTopology])
  const currentCheck = routingCheck?.revision === routingKey ? routingCheck : undefined
  const acknowledgedTokens = useMemo(() => new Set(topology.warningAcknowledgements ?? []), [topology.warningAcknowledgements])
  const warningToken = (finding: DiagnosticsFinding) => vwanWarningToken(activeTopology, finding)
  const isAcknowledged = (finding: DiagnosticsFinding) => canAcknowledgeWarning(finding)
    && acknowledgedTokens.size > 0 && acknowledgedTokens.has(warningToken(finding))
  const allRoutingIssues = currentCheck?.report?.findings.filter((finding) => finding.severity === 'error' || finding.severity === 'warning') ?? []
  const routingIssues = allRoutingIssues.filter((finding) => !isAcknowledged(finding))
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
  const runRoutingCheck = (targetTopology = activeTopology, preservePanel = false) => {
    checkWorker.current?.worker.terminate(); checkWorker.current = undefined
    setDiagnosticHighlight(undefined); setHighlighting(false); setTracing(false)
    if (!preservePanel) setPanel(undefined)
    let profile = { version: 1 as const, intents: [], failureAnalysis: false } as ReturnType<typeof validateDiagnosticsProfile>
    let requirementsUnavailable = false
    try {
      const saved = workspaceStorage.getItem('vwan-visual-topology:diagnostics:v1')
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
        if (data.report?.continuation?.status !== 'paused') { next.terminate(); checkWorker.current = undefined }
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
  const checkRouting = () => runRoutingCheck(activeTopology, false)
  const continueRoutingCheck = () => {
    if (!checkWorker.current || checkWorker.current.revision !== routingKey || currentCheck?.status === 'running' || currentCheck?.report?.continuation?.status !== 'paused') return
    setRoutingCheck({ ...currentCheck, status: 'running' })
    checkWorker.current.worker.postMessage({ type: 'continue' })
  }
  const [pendingAzureImport, setPendingAzureImport] = useWorkspaceEditorState<{ revision: number; topology: Topology }>('vwan.pendingCapture')
  const [vpnConversion, setVpnConversion] = useState<{ connectionId: string; mode: VpnRoutingMode }>()
  const [routeView, setRouteView] = useWorkspaceEditorState<'bgp' | 'hub' | 'firewall'>('vwan.routeView', 'bgp')
  const [routeMode, setRouteMode] = useWorkspaceEditorState<RouteMode>('vwan.routeMode', 'bgp')
  const [mapRouter, setMapRouter] = useWorkspaceEditorState<RouterSelection>('vwan.mapRouter')
  const [mapDirection, setMapDirection] = useWorkspaceEditorState<RouteMapDirection>('vwan.mapDirection')
  const [mapConnectionId, setMapConnectionId] = useWorkspaceEditorState<string>('vwan.mapConnection')
  const [prefix, setPrefix] = useWorkspaceEditorState('vwan.prefix', '')
  const [highlightTableId, setHighlightTableId] = useWorkspaceEditorState('vwan.highlightTable', DEFAULT_HUB_TABLE)
  const [highlighting, setHighlighting] = useWorkspaceEditorState('vwan.highlighting', false)
  const layout = topology.layout?.mode ?? 'layered'
  const [zoom, setZoom] = useWorkspaceEditorState('vwan.zoom', 1)
  const [source, setSource] = useWorkspaceEditorState('vwan.source', '')
  const [sourceTableId, setSourceTableId] = useWorkspaceEditorState('vwan.sourceTable', DEFAULT_HUB_TABLE)
  const [target, setTarget] = useWorkspaceEditorState('vwan.target', '')
  const [destination, setDestination] = useWorkspaceEditorState('vwan.destination', '')
  const [destinationPrefix, setDestinationPrefix] = useWorkspaceEditorState('vwan.destinationPrefix', '')
  const [tracing, setTracing] = useWorkspaceEditorState('vwan.tracing', false)
  const [groupTrace, setGroupTrace] = useWorkspaceEditorState<{ group: PathGroup; direction: PathDirection }>('vwan.groupTrace')
  const importer = useRef<HTMLInputElement>(null)
  const importRequest = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const routingInput = useMemo(() => measureAzWork('routing-projection', () => vwanRoutingInput(activeTopology)), [activeTopology])
  const routingTopology = useMemo(() => JSON.parse(routingInput.revision) as Topology, [routingInput.revision])
  const displayNames = useMemo(() => JSON.parse(routingInput.nameRevision) as string[], [routingInput.nameRevision])
  const rawSimulation = useMemo(() => measureAzWork('simulation', () => simulate(routingTopology)), [routingTopology])
  const simulation = useMemo(() => measureAzWork('display-binding', () => vwanDisplaySimulation(rawSimulation, displayNames)), [rawSimulation, displayNames])
  const nvaSiteIds = useMemo(() => embeddedSpokeNvaSiteIds(topology), [topology])
  const nodes: (PathNode & { name: string })[] = [
    ...topology.hubs.map((n) => ({ kind: 'hub' as const, id: n.id, name: n.name })),
    ...topology.spokes.map((n) => ({ kind: 'spoke' as const, id: n.id, name: n.name })),
    ...topology.sites.filter((n) => !nvaSiteIds.has(n.id)).map((n) => ({ kind: 'site' as const, id: n.id, name: n.name })),
  ]
  const sourceNode = nodes.find((n) => nodeKey(n) === source)
  const sourceHub = sourceNode?.kind === 'hub' ? topology.hubs.find((hub) => hub.id === sourceNode.id) : undefined
  const sourceTables = sourceHub ? hubRouteTables(sourceHub).filter((table) => table.id !== 'noneRouteTable') : []
  const sourceContextId = sourceTables.some((table) => table.id === sourceTableId) ? sourceTableId : DEFAULT_HUB_TABLE
  const targetNode = nodes.find((n) => nodeKey(n) === target)
  const rawPaths = useMemo(() => {
    if (!tracing || groupTrace) return []
    return measureAzWork('trace', () => source && topologyObject(routingTopology, parseNode(source))
      ? traceNodePath(routingTopology, rawSimulation, parseNode(source), destination, undefined, sourceContextId) : [])
  }, [tracing, source, routingTopology, rawSimulation, destination, groupTrace, sourceContextId])
  const groupedPaths = useMemo(() => {
    if (!tracing || !groupTrace) return []
    return measureAzWork('trace', () => traceGroupedPaths(activeTopology, simulation,
      parseNode(groupTrace.direction === 'to' ? source : target), groupTrace.direction, groupTrace.group))
  }, [tracing, groupTrace, activeTopology, simulation, source, target])
  const paths: (NodePath | GroupPath)[] = useMemo(() => groupTrace ? groupedPaths : vwanDisplayResult(rawPaths, displayNames),
    [groupTrace, groupedPaths, rawPaths, displayNames])
  const inspected = topologyObject(topology, router)
  const hub = router.kind === 'hub' ? topology.hubs.find((h) => h.id === router.id) : undefined
  const activeView = routeView === 'firewall' && !hub?.firewall && !hub?.routingIntent.private && !hub?.routingIntent.internet ? 'bgp' : routeView
  const erRouting = useMemo(() => router.kind === 'erLocation' ? erLocationBgpTable(activeTopology, simulation, router.id) : [],
    [activeTopology, simulation, router.kind, router.id])
  const decisions = router.kind === 'erLocation' ? erRouting
    : router.kind === 'hub' && highlightTableId !== DEFAULT_HUB_TABLE ? simulation.hubTables?.[router.id]?.[highlightTableId] ?? []
    : (activeView === 'bgp' ? simulation.bgpTables : activeView === 'firewall' ? simulation.firewallTables : simulation.tables)[router.id] ?? []
  const selectedRoutes = highlighting && (router.kind === 'hub' || router.kind === 'erLocation') ? [
    ...decisions.filter((d) => !prefix || d.prefix === prefix).flatMap((d) => d.selected),
    ...(activeView === 'hub' && hub?.routingIntent.private ? (simulation.firewallTables[hub.id] ?? []).filter((d) => !prefix || d.prefix === prefix).flatMap((d) => d.selected) : []),
  ] : []
  const siteHighlight = useMemo(() => {
    if (!highlighting || router.kind !== 'site') return []
    const routing = azureRoutesAtSites(activeTopology, simulation)
    const prefixes = [...new Set((routing.tables[router.id] ?? []).filter((route) => !prefix || route.prefix === prefix).map((route) => route.prefix))]
    return prefixes.flatMap((prefix) => traceNodePath(activeTopology, simulation, { kind: 'site', id: router.id }, prefix.split('/')[0], routing))
  }, [highlighting, router.kind, router.id, activeTopology, simulation, prefix])
  const diagnosticPaths = (panel === 'diagnostics' || panel === 'issues') && diagnosticHighlight?.revision === routingKey ? diagnosticHighlight.paths : undefined
  const diagramPaths = diagnosticPaths ?? (tracing ? paths : siteHighlight)
  const showDiagnostic = (finding: DiagnosticsFinding) => {
    const name = (node?: PathNode) => node ? topologyObject(topology, node)?.name ?? node.id : ''
    setDiagnosticHighlight({ revision: routingKey, findingId: finding.id, paths: [
      ...finding.forward.map((path) => ({ ...path, sourceNode: finding.source, targetNode: finding.target, direction: 'forward' as const, sourceName: name(finding.source), destinationName: name(finding.target), destinationPrefix: finding.destinationAddress ?? finding.prefix ?? '' })),
      ...finding.reverse.map((path) => ({ ...path, sourceNode: finding.target, targetNode: finding.source, direction: 'return' as const, sourceName: name(finding.target), destinationName: name(finding.source), destinationPrefix: finding.sourceAddress ?? '' })),
    ] })
    setTracing(false); setHighlighting(false); setSelection(finding.related[0])
  }
  const openDiagnostics = () => { setDiagnosticHighlight(undefined); setHighlighting(false); setTracing(false); setPanel('diagnostics') }
  const update = (mutate: (next: Topology) => void) => {
    try {
      const next = measureAzWork('commit', () => {
        const draft = structuredClone(topology)
        mutate(draft)
        pruneDeletedInventory(draft, topology)
        applyRoutingIntentEdit(topology, draft)
        return validateTopology(draft)
      })
      save(next)
    }
    catch (error) { setError(message(error)) }
  }
  const acknowledgeWarning = (finding: DiagnosticsFinding, acknowledged: boolean) => {
    if (!canAcknowledgeWarning(finding)) return
    update((next) => setWarningAcknowledgement(next, warningToken(finding), acknowledged))
    if (acknowledged && diagnosticHighlight?.findingId === finding.id) setDiagnosticHighlight(undefined)
  }
  const restoreWarningAttention = () => update((next) => { delete next.warningAcknowledgements })
  const assignPrefixToSite = (siteId: string, prefixesToAdd: string[]) => {
    try {
      const next = assignSitePrefixes(topology, siteId, prefixesToAdd)
      const validated = validateTopology(next)
      save(validated)
      if (routingCheck) runRoutingCheck(validated, panel === 'issues')
    } catch (error) { setError(message(error)) }
  }
  const reset = (next: Topology) => {
    workspaceSession?.documentSave?.reset()
    importRequest.current++
    cancelRoutingCheck()
    setPendingAzureImport(undefined)
    clearHistory()
    save(next, false); setSelection(undefined); setPanel(undefined); setEditorRequest(undefined); setContextMenu(undefined); setClearRequested(false)
    setTracing(false); setGroupTrace(undefined); setHighlighting(false); setPrefix(''); setVpnConversion(undefined)
    setRouter({ kind: 'hub', id: next.hubs[0]?.id ?? '' })
  }
  const loadGallerySample = async (id: string, signal: AbortSignal) => {
    const request = ++importRequest.current
    const scope = workspaceSession?.getRequestVersion()
    const { VWAN_SAMPLE_GALLERY } = await import('./sample-catalog')
    if (signal.aborted || request !== importRequest.current) return false
    const entry = VWAN_SAMPLE_GALLERY.find((sample) => sample.id === id)
    if (!entry) return false
    try {
      const loaded = entry.file ? await fetch(entry.file, { signal }).then(async (res) => {
        if (!res.ok) throw new Error(`Sample topology "${entry.id}" not found.`)
        return validateTopology(await res.json())
      }) : validateTopology(structuredClone(example))
      if (signal.aborted || !mounted.current || request !== importRequest.current || workspaceSession && scope !== workspaceSession.getRequestVersion()) return false
      if (workspaceSession && !workspaceSession.practice) await workspaceSession.openDocument(loaded)
      else reset(loaded)
      return true
    } catch (err) {
      if (!signal.aborted) setError(`Sample load failed: ${message(err)}`)
      return false
    }
  }
  const sampleLoaded = useRef(false)
  useEffect(() => {
    if (workspaceSession?.practice) return
    if (sampleLoaded.current) return
    const sample = new URLSearchParams(location.search).get('sample')?.trim() ?? ''
    if (!/^[a-z0-9-]+$/.test(sample)) return
    sampleLoaded.current = true
    void import('./sample-catalog').then(async ({ VWAN_SAMPLE_GALLERY, resolveSampleIdAlias }) => {
      const id = resolveSampleIdAlias(sample)
      const entry = VWAN_SAMPLE_GALLERY.find((item) => item.id === id)
      if (entry && !entry.file) return validateTopology(structuredClone(example))
      const res = await fetch(entry?.file ?? `/docs/samples/${id}.json`)
      if (!res.ok) throw new Error(`Sample topology "${sample}" not found.`)
      return validateTopology(await res.json())
    })
      .then((loaded) => {
        if (!mounted.current) return
        clearHistory()
        save(loaded, false)
        setRouter({ kind: 'hub', id: loaded.hubs[0]?.id ?? '' })
        const url = new URL(location.href)
        url.searchParams.delete('sample')
        window.history.replaceState(null, '', url)
      })
      .catch((err) => setError(`Sample load failed: ${message(err)}`))
  }, [clearHistory, save, setError, setRouter, workspaceSession?.practice])
  const selectRouter = (value: ObjectSelection) => { setRouter(value); setRouteView('bgp'); setPrefix(''); setHighlightTableId(DEFAULT_HUB_TABLE); setHighlighting(false) }
  const openRouteMaps = (value?: RouterSelection, connectionId?: string) => { setMapRouter(value); setMapConnectionId(connectionId); setEditorRequest(undefined); setPanel('maps') }
  const showRouteMapRules = (value: RouterSelection, direction?: RouteMapDirection, connectionId?: string) => { setMapRouter(value); setMapDirection(direction); setMapConnectionId(connectionId); setSelection(value); setEditorRequest(undefined); setPanel('rules') }
  const openStaticRouting = (value: RouterSelection) => { setMapRouter(value); setEditorRequest(undefined); setPanel('static') }
  const selectObject = (value: ObjectSelection) => {
    if (editorRequest && !editorRequest.deleting && (editorRequest.kind !== value.kind || editorRequest.id !== value.id)) {
      if (!setEditorRequest(value)) return false
    }
    setSelection(value)
    return true
  }
  useDeleteShortcut(selection && !scenario.affected[selection.id] && topologyObject(topology, selection) && !editorRequest &&
    !clearRequested && !capabilitiesHubId && !erLocationModal.open ? () => {
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
  const pathStatus = !paths.length ? t("No trace available") : paths.some((path) => path.status === 'unknown') ? t("Not assessed") : paths.every((path) => path.status === 'delivered') ? t("Reachable")
    : paths.some((path) => path.status === 'delivered') ? t("Partially reachable")
      : paths.some((path) => path.status === 'loop') ? t("Forwarding loop") : t("No route")
  const groupLabel = t(pathGroups.find(({ group }) => group === groupTrace?.group)?.label ?? '')
  const groupSummary = groupTrace && (groupTrace.direction === 'to'
    ? t("Paths from {0} to {1}", sourceNode?.name ?? t('source'), groupLabel)
    : t("Paths from {0} to {1}", groupLabel, targetNode?.name ?? t('destination')))
  const canvasActions: ContextAction[] = [
    { label: t("Add hub"), run: () => setEditorRequest({ kind: 'hub' }) },
    { label: t("Add Azure VNet"), run: () => setEditorRequest({ kind: 'spoke' }) },
    { label: t("Add site"), run: () => setEditorRequest({ kind: 'site' }) },
    { label: t("Add ER location"), run: () => setEditorRequest({ kind: 'erLocation' }) },
    { label: t("Route maps"), run: () => openRouteMaps() },
    { label: t("Check routing"), run: checkRouting },
    { label: t("Model notes and warnings"), run: () => setPanel('notes') },
  ]
  const bgpResourceFor = (target?: ObjectSelection): import('./bgp-neighbors').BgpResourceRef | undefined =>
    target?.kind === 'hub' ? { kind: 'vwan-hub', id: target.id }
      : target?.kind === 'site' ? { kind: 'site', id: target.id }
        : target?.kind === 'erLocation' ? { kind: 'er-location', id: target.id } : undefined
  const openBgpNeighbors = (target?: ObjectSelection) => setBgpInspection((previous) => ({
    resource: bgpResourceFor(target), revision: (previous?.revision ?? 0) + 1,
  }))
  const getContextActions = (contextSelection?: ObjectSelection, routeMap?: DiagramContextMenu['routeMap'], fullActions = false): ContextAction[] => {
    const contextConnection = contextSelection?.kind === 'connection' ? topology.connections.find((connection) => connection.id === contextSelection.id) : undefined
    const vpnActions: ContextAction[] = contextConnection?.transport === 'VPN'
      ? (['static', 'bgp'] as const).map((mode) => ({
        label: mode === 'static' ? t("Change to static routing") : t("Change to BGP routing"),
        disabled: vpnRoutingMode(topology, contextConnection) === mode,
        run: () => { setVpnConversion({ connectionId: contextConnection.id, mode }); setEditorRequest(undefined); setPanel('vpnWizard') },
      })) : []
    const spokeObj = contextSelection?.kind === 'spoke' ? topology.spokes.find((spoke) => spoke.id === contextSelection.id) : undefined
    const spokeNvaConn = spokeObj ? topology.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === spokeObj.id) : undefined
    const spokeNvaSite = spokeNvaConn ? topology.sites.find((s) => s.id === spokeNvaConn.siteId) : undefined
    const ordinaryContextActions: ContextAction[] = contextSelection ? [
      ...(routeMap ? [{
        label: t("Remove route map association"),
        run: () => {
          const association = routeMap
          update((next) => {
            const router = (association.router.kind === 'hub' ? next.hubs : next.sites).find((router) => router.id === association.router.id)
            const binding = router?.routeMapAssignments?.find((binding) => binding.connectionId === association.connectionId)
            if (!router || !binding) return
            delete binding[`${association.direction}MapId`]
            router.routeMapAssignments = router.routeMapAssignments?.filter((binding) => binding.inboundMapId || binding.outboundMapId)
          })
        },
      }] : []),
      { label: t("Edit configuration"), previewPrimary: true, run: () => setEditorRequest(contextSelection) },
      ...(contextSelection.kind === 'spoke' ? [{ label: t('Open VNet detail'), previewPrimary: true, run: () => setDetailOwner(contextSelection.id) }] : []),
      ...(['hub', 'site', 'erLocation'].includes(contextSelection.kind) ? [
        { label: t('BGP neighbors'), run: () => openBgpNeighbors(contextSelection) },
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
        { label: t("Open path explorer"), previewPrimary: true, run: () => openPath(contextSelection as PathNode, 'to') },
      ] : []),
      ...(contextSelection.kind === 'hub' ? [
        { label: t(topology.hubs.find((hub) => hub.id === contextSelection.id)?.firewall ? 'Configure Azure Firewall' : 'Add Azure Firewall'),
          run: () => setEditorRequest({ kind: 'hub', id: contextSelection.id, focusFirewall: true }) },
        { label: t('Gateway capabilities (modeled)'), run: () => setCapabilitiesHubId(contextSelection.id) },
        {
          label: t('Connect to spoke'), allowDisabledChildren: true,
          children: topology.spokes.length ? topology.spokes.map((spoke) => ({
            label: spoke.hubId ? t('{0} (connected to {1})', spoke.name, topology.hubs.find((hub) => hub.id === spoke.hubId)?.name ?? spoke.hubId)
              : spoke.nvaSpokeIds?.length ? t('{0} (connected through an NVA)', spoke.name) : spoke.name,
            disabled: !!spoke.hubId && spoke.hubId !== contextSelection.id || !!spoke.nvaSpokeIds?.length,
            run: () => {
              if (!spoke.hubId) update((next) => {
                const original = next.spokes.find((entry) => entry.id === spoke.id)
                if (original && !original.hubId && !original.nvaSpokeIds?.length) {
                  original.hubId = contextSelection.id
                  original.propagateDefaultRoute = true
                }
              })
              setEditorRequest({ kind: 'spoke', id: spoke.id })
            },
          })) : [{ label: t('No VNets. Add a VNet first.'), disabled: true }],
        },
        ...(topology.hubs.find((h) => h.id === contextSelection.id)?.firewall || topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.private || topology.hubs.find((h) => h.id === contextSelection.id)?.routingIntent.internet ? [{ label: t("Show firewall routes"), run: () => showRoutes(contextSelection, true) }] : []),
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
        { label: t('Clone VNet...'), previewPrimary: true, run: () => setCloneVnetId(contextSelection.id) },
        ...(spokeObj?.hubId || spokeObj?.nvaSpokeIds?.length ? [{
          label: t('Configure virtual hub connection'), previewPrimary: true, run: () => spokeObj?.hubId
            ? openVnetConnection(spokeObj.id) : setEditorRequest(contextSelection),
        }] : [{
          label: t('Connect to virtual hub'), previewPrimary: true, allowDisabledChildren: true,
          children: topology.hubs.length ? topology.hubs.map((hub) => ({
            label: hub.name,
            run: () => {
              update((next) => {
                const original = next.spokes.find((entry) => entry.id === contextSelection.id)
                if (original && !original.hubId && !original.nvaSpokeIds?.length) {
                  original.hubId = hub.id
                  original.propagateDefaultRoute = true
                }
              })
              setEditorRequest(contextSelection)
            },
          })) : [{ label: t('No virtual hubs. Add a virtual hub first.'), disabled: true }],
        }]),
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
            setErLocationModal({ open: true, hasOpened: true, peeringLocation: loc?.peeringLocation ?? loc?.name, sku: loc?.sku ?? 'Standard', targetAzureRegion: hub?.region, erLocationId: loc?.id })
          } },
        { label: t("Connect to hub"), disabled: !topology.hubs.length, run: () => setEditorRequest({ kind: 'erLink', locationId: contextSelection.id }) },
        { label: t("Connect to site"), disabled: !topology.sites.length, run: () => setEditorRequest({ kind: 'erLink', locationId: contextSelection.id, siteId: topology.sites[0]?.id }) },
      ] : []),
      ...(contextSelection.kind === 'erLink' ? [
        { label: t("Show ER Location Info"), run: () => {
            const link = topology.erLinks?.find((l) => l.id === contextSelection.id)
            const loc = link ? topology.erLocations?.find((l) => l.id === link.locationId) : undefined
            const hub = link?.hubId ? topology.hubs.find((h) => h.id === link.hubId) : undefined
            setErLocationModal({ open: true, hasOpened: true, peeringLocation: loc?.peeringLocation ?? loc?.name, sku: loc?.sku ?? 'Standard', targetAzureRegion: hub?.region, erLocationId: loc?.id })
          } },
        { label: topology.erLinks?.find((link) => link.id === contextSelection.id)?.enabled ? t("Disable connection") : t("Enable connection"), run: () => update((next) => { const link = next.erLinks!.find((link) => link.id === contextSelection.id)!; link.enabled = !link.enabled }) },
      ] : []),
      ...(contextSelection.kind === 'connection' ? [
        ...vpnActions,
        { label: topology.connections.find((c) => c.id === contextSelection.id)?.enabled ? t("Disable connection") : t("Enable connection"), run: () => update((next) => { const c = next.connections.find((c) => c.id === contextSelection.id)!; c.enabled = !c.enabled }) },
      ] : []),
      { label: t("Delete {0}", t(objectLabels[contextSelection.kind])), danger: true, run: () => setEditorRequest({ ...contextSelection, deleting: true }) },
    ] : canvasActions
    const contextFaults = contextSelection ? scenario.affected[contextSelection.id] ?? [] : []
    const presented = workspaceSession?.presentationPreview && !fullActions && contextSelection?.kind === 'spoke'
      ? previewVnetActions(ordinaryContextActions, () => setToolsOpenRequest((request) => request + 1)) : ordinaryContextActions
    const contextDomain = contextSelection && scenario.domains.find((domain) =>
      (domain.kind === 'site' && contextSelection.kind === 'site' || domain.kind === 'er-location' && contextSelection.kind === 'erLocation') && domain.id === contextSelection.id ||
      domain.kind === 'region' && (contextSelection.kind === 'hub' || contextSelection.kind === 'spoke') &&
      domain.id === regionKey((contextSelection.kind === 'hub' ? topology.hubs : topology.spokes).find((n) => n.id === contextSelection.id)?.region))
    return contextFaults.length
      ? contextFaults.map((fault) => ({ label: `Restore ${failureLabel(fault)}`, run: () => restoreFault(fault) }))
      : [...(contextDomain ? [{ label: `Simulate failure of ${failureLabel(contextDomain)}`, run: () => addFault(contextDomain) }]
        : contextSelection && ['hub', 'spoke'].includes(contextSelection.kind) ? [{ label: 'Azure region failure unassessed — set an explicit recognized region', disabled: true }] : []), ...presented]
  }
  const contextSelection = contextMenu?.selection
  const contextObject = contextSelection && topologyObject(topology, contextSelection)
  const contextActions = getContextActions(contextSelection, contextMenu?.routeMap)
  const selectedObject = selection && topologyObject(topology, selection)
  const exportTopology = (original = '') => {
    const url = URL.createObjectURL(new Blob([original || JSON.stringify(topology, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vwan-topology.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importTopology = async (file?: File) => {
    if (!file) return
    const revision = ++importRequest.current
    const workspaceRequest = workspaceSession?.getRequestVersion()
    setPendingAzureImport(undefined)
    try {
      if (file.size > 2_000_000) throw new Error('Topology files must be smaller than 2 MB.')
      const input: unknown = JSON.parse(await file.text())
      if (!mounted.current || revision !== importRequest.current || workspaceRequest !== workspaceSession?.getRequestVersion()) return
      if (workspaceSession && !workspaceSession.practice) {
        await workspaceSession.openDocument(input)
        return
      }
      if (input && typeof input === 'object' && 'kind' in input
        && ['azure-network-topology', 'azure-network-capture'].includes(String(input.kind)) && workspaceSession) {
        await workspaceSession.openDocument(input)
        return
      }
      if (input && typeof input === 'object' && 'kind' in input && ['azure-vwan-capture', 'azure-vwan-federation'].includes(String(input.kind))) {
        const next = importAzureCapture(input)
        setPendingAzureImport({ revision, topology: next }); setError(''); setPanel('azure')
      } else reset(validateTopology(input))
    } catch (error) { if (revision === importRequest.current) setError(`Import rejected: ${message(error)}`) }
  }
  const importSessionCapture = useEffectEvent(() => {
    if (!workspaceSession?.capture) return
    const next = importAzureCapture(workspaceSession.capture)
    setPendingAzureImport({ revision: ++importRequest.current, topology: next })
    setError(''); setPanel('azure')
  })
  useEffect(() => { if (workspaceSession?.capture) importSessionCapture() }, [workspaceSession?.capture])
  const finishCaptureImport = () => {
    workspaceSession?.consumeCapture?.()
    setPendingAzureImport(undefined)
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

  return <div className="app canvas-app mode-vwan" data-testid="vwan-app" data-inventory-selection={inventorySelection} data-revision={import.meta.env.VITE_APP_REVISION || 'development'}>
    {snatHubId && <Suspense fallback={null}><RouterSnatDialog topology={topology} owner={{ kind: 'hub', id: snatHubId }}
      name={topology.hubs.find((hub) => hub.id === snatHubId)?.name ?? snatHubId} commit={(mutate) => update((next) => mutate(next))}
      onClose={() => setSnatHubId(undefined)} /></Suspense>}
    {detailOwner && <Suspense fallback={null}><NetworkDetail topology={topology} owner={{ kind: 'spoke', id: detailOwner }} simulation={simulation}
      selectedId={inventorySelection} onSelect={setInventorySelection} commit={(mutate) => update((next) => mutate(next))}
      selectedTargetId={selection?.id}
      onSelectTarget={(target) => { if (target.kind === 'network' || target.kind === 'site') selectObject({ kind: target.kind === 'site' ? 'site' : 'spoke', id: target.id }) }}
      getContextActions={(target) => target.kind === 'network' || target.kind === 'site' ? getContextActions({ kind: target.kind === 'site' ? 'site' : 'spoke', id: target.id }, undefined, true).map(function wrap(action): ContextAction {
        return { ...action, children: action.children?.map(wrap), ...(action.run ? { run: () => { selectObject({ kind: target.kind === 'site' ? 'site' : 'spoke', id: target.id }); action.run?.() } } : {}) }
      }) : []}
      boundaries={diagramPaths.slice(0, 16).map((path) => ({ direction: 'direction' in path && path.direction === 'return' ? 'reply' : 'forward',
        destination, evidence: path.steps.join(' '), subnetIds: [] }))}
      onClose={() => setDetailOwner(undefined)} /></Suspense>}
    <FailurePanel faults={faults} unassessed={scenario.unassessed} onRestore={restoreFault} onRestoreAll={() => restoreFault()}
      revision={baselineRevision} onReport={(report) => setResilience({ revision: baselineRevision, report })} focusEndpoint={resilience?.revision === baselineRevision ? resilienceEndpoint : undefined} onSimulate={addFault} analyze={() => {
        let intents: ReturnType<typeof validateDiagnosticsProfile>['intents'] = []
        try { const saved = workspaceStorage.getItem('vwan-visual-topology:diagnostics:v1'); if (saved) intents = validateDiagnosticsProfile(JSON.parse(saved)).intents }
        catch { const report = analyzeVwanResilience(topology, [], { maxPairs: 0 }); report.complete = false; report.limitations.push('Saved connectivity requirements could not be read; intent coverage is unassessed.'); return report }
        return analyzeVwanResilience(topology, intents)
      }} />
    <header className="topbar unified-topbar unified-topbar-vwan" data-testid="unified-topbar">
      <div className="unified-topbar-left">
        <div className="brand unified-brand">
          <div className="brand-icon unified-brand-icon" aria-hidden="true">AzNetSim</div>
          <h1>Azure Network Simulator</h1>
        </div>
        <WorkspaceMenu />
      </div>
      <div className="actions unified-topbar-controls">
        <WorkspaceTools openRequest={toolsOpenRequest} creationActions={[
          { label: t('+ Hub'), run: () => setEditorRequest({ kind: 'hub' }) },
          { label: t('+ VNet'), run: () => setEditorRequest({ kind: 'spoke' }) },
          { label: t('+ Site'), run: () => setEditorRequest({ kind: 'site' }) },
          { label: t('+ ER location'), run: () => setEditorRequest({ kind: 'erLocation' }) },
        ]} getSelection={() => selectedObject && selection ? {
          title: t("{0} actions: {1}", t(objectLabels[selection.kind]), selectedObject.name),
          actions: getContextActions(selection, undefined, true),
        } : undefined} inventory={{
          getObjects: () => vwanWorkspaceObjects(topology),
          selected: selection ? vwanWorkspaceIdentity(selection) : undefined,
          onSelect: selectObject,
        }} />
        <LearningTools document={{ mode: 'vwan', topology }} />
        {selection?.kind === 'spoke' && <button type="button" onClick={() => setDetailOwner(selection.id)}>{t('VNet detail')}</button>}
        {selection?.kind === 'hub' && <button type="button" onClick={() => setSnatHubId(selection.id)}>{t('Firewall SNAT')}</button>}
        <PresentationGroup label={t('Explore')}>
          <span className="local-badge">{t("Local-first · no Azure credentials")}</span>
          <button onClick={() => setErLocationModal({ open: true, hasOpened: true })} data-testid="vwan-topbar-er-locations-btn">{t("ER Locations")}</button>
          <button onClick={() => setPanel('samples')}>{t("Sample topologies")}</button>
          {!workspaceSession?.presentationPreview && <button onClick={() => window.open(language === 'ja' ? '/docs/index.html?lang=ja' : '/docs/index.html', '_blank', 'noopener,noreferrer')}>{t("Docs")}</button>}
        </PresentationGroup>
        {workspaceSession?.presentationPreview && <PresentationGroup label={t('Routing checks')}>
          <button disabled={currentCheck?.status === 'running'} onClick={checkRouting}
            title={t('Check connectivity across the modeled landscape')}>{t('Check routing')}</button>
          <button onClick={openDiagnostics} title={t('Inspect findings and assess declared connectivity requirements')}>{t('Advanced checks')}</button>
        </PresentationGroup>}
        <PresentationGroup label={t('File')}>
          <DocumentActions />
          <button onClick={() => setPanel('azure')}>{t("Azure files")}</button>
          <button onClick={() => setClearRequested(true)}>{t("Clear topology")}</button>
        </PresentationGroup>
        <PresentationToggle />
        <input data-desktop-import ref={importer} hidden type="file" accept=".json,application/json" aria-label={t("Import topology file")} onChange={(e) => { void importTopology(e.target.files?.[0]); e.target.value = '' }} /></div>
      <WorkspaceAccountStatus />
    </header>
    {panel === 'samples' && <Suspense fallback={null}><SampleGallery testIdPrefix="vwan"
      hasWorkspace={topology.name !== 'New topology' || !!(topology.hubs.length || topology.spokes.length || topology.sites.length || topology.connections.length || topology.routeMaps?.length || topology.erLocations?.length)}
      onLoad={loadGallerySample} onExport={() => exportTopology()}
      onOpenCurriculum={workspaceSession?.setLearningView ? () => workspaceSession.setLearningView?.({ open: true }) : undefined}
      onClose={closePanel} /></Suspense>}
    {erLocationModal.hasOpened && <Suspense fallback={null}><ErLocationInfoModal
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
    /></Suspense>}
    <main>
    <WorkspaceTabPanel>
      <section className="workspace-heading"><div><p className="eyebrow">{t("NETWORK WORKSPACE")}</p><input className="topology-name" aria-label={t("Topology name")} maxLength={120} value={topology.name} onChange={(e) => update((next) => { next.name = e.target.value })} /></div><div className="stats"><span><strong>{topology.hubs.length}</strong>  {t("hubs")}</span><span><strong>{topology.spokes.length}</strong>  {t("spokes")}</span><span><strong>{topology.sites.length - nvaSiteIds.size}</strong>  {t("sites")}</span>{nvaSiteIds.size > 0 && <span><strong>{nvaSiteIds.size}</strong>  {t("spoke NVAs")}</span>}{!!topology.erLocations?.length && <span><strong>{topology.erLocations.length}</strong>  {t("ER locations")}</span>}</div></section>
      {error && <div role="alert" className="notice error">{localizeDiagnostic(error)}<button aria-label={t("Dismiss error")} onClick={() => setError('')}>{t("Dismiss")}</button></div>}
      {initialBackup && <div className="notice">{t("The saved workspace could not be loaded. Download the original before editing or closing this page.")} <button onClick={() => exportTopology(initialBackup)}>{t("Download original saved topology")}</button></div>}
      {saveError && <p role="alert" className="notice error">{localizeDiagnostic(saveError)}</p>}
      {topology.azureImport && <div className="notice" role="status">{t("Azure structure-only import · simulated routes are not verified Azure effective routes.")} <button onClick={() => setPanel('azure')}>{t("Review import limitations")}</button></div>}
      <section className="canvas-workspace panel" aria-label={t("Topology workspace")}>
        <div className="canvas-toolbar"><div><h2>{t("Network topology")}</h2><p className="muted">{t("Drag blank canvas to pan; drag nodes to arrange. Right-click for actions. Alt+Arrow moves a focused node.")}</p></div>
          <div className="canvas-tools"><label className="checkbox-field"><input type="checkbox" checked={topology.allowBranchToBranchTraffic !== false} onChange={(event) => update((next) => { next.allowBranchToBranchTraffic = event.target.checked })} />{t('Allow branch-to-branch traffic (WAN-wide)')}</label>
            <button disabled={!canUndo} title={t("Undo last topology change (Ctrl+Z)")} onClick={undo}>{t("Undo")}</button><button disabled={!canRedo} title={t("Redo topology change (Ctrl+Y)")} onClick={redo}>{t("Redo")}</button>
            <button onClick={() => openRouteMaps()}>{t("Route maps")}</button>{!workspaceSession?.presentationPreview && <button disabled={currentCheck?.status === 'running'} onClick={checkRouting}>{t("Check routing")}</button>}<button aria-label={t("Open model notes and warnings")} onClick={() => setPanel('notes')}>{t("Notes")}{simulation.warnings.length ? ` (${simulation.warnings.length})` : ''}</button></div>
        </div>
        {routingCheck && <div className="routing-check-status" role="status">
          <span>{t(!currentCheck ? 'Routing changed. Check routing again.' : currentCheck.status === 'running' ? 'Checking all modeled networks…'
            : currentCheck.status === 'cancelled' ? 'Routing check cancelled. No complete result is available.'
            : currentCheck.status === 'failed' ? 'Routing check failed. No complete result is available.'
            : checkCoverage?.scanIncomplete ? 'Routing check is incomplete. Some networks or scenarios could not be assessed.'
            : allRoutingIssues.length ? 'Routing check completed.'
            : checkCoverage?.noCheckablePairs || checkCoverage?.unassignedPrefixes.length
              ? 'Advertised networks have no declared owner. Assign site or VNet prefixes to verify end-to-end reachability.'
              : 'No routing issues found within the checked model scope.')}</span>
          {currentCheck?.report && checkCoverage && <><span>{[
            t('{0} routing issues', routingIssues.length),
            ...(acknowledgedTokens.size ? [t('{0} findings need attention · {1} acknowledged · {2} total', routingIssues.length, allRoutingIssues.length - routingIssues.length, currentCheck.report.findings.length)] : []),
            t('{0} root-cause issues affecting {1} flow pairs', routingIssues.length, diagnosticFlowCount(routingIssues)),
            ...(checkCoverage.unassignedPrefixes.length ? [checkCoverage.unassignedPrefixes.length === 1 ? t('1 unassigned advertised prefix') : t('{0} unassigned advertised prefixes', checkCoverage.unassignedPrefixes.length)] : []),
            ...(checkCoverage.unsupportedFlowCount ? [checkCoverage.unsupportedFlowCount === 1 ? t('1 model-limited flow pair') : t('{0} model-limited flow pairs', checkCoverage.unsupportedFlowCount)] : []),
            ...(checkCoverage.otherUnknownFindings.length ? [checkCoverage.otherUnknownFindings.length === 1 ? t('1 incomplete check') : t('{0} incomplete checks', checkCoverage.otherUnknownFindings.length)] : []),
          ].join(' · ')}</span>
            <button onClick={() => { setRoutingIssueId(undefined); setReviewCoverage(false); setPanel('issues') }}>{t('Review routing issues')}</button>
            {checkCoverage.hasNotes && <button onClick={() => { setRoutingIssueId(undefined); setReviewCoverage(true); setPanel('issues') }}>{t('Review analysis coverage')}</button>}</>}
          {currentCheck?.report?.continuation && <span>{describeDiagnosticsProgress(currentCheck.report, t)}</span>}
          {currentCheck?.status !== 'running' && currentCheck?.report?.continuation?.status === 'paused' && <button onClick={continueRoutingCheck}>{t('Continue analysis')}</button>}
          {(currentCheck?.status === 'running' || currentCheck?.report?.continuation?.status === 'paused') && <button onClick={() => { checkWorker.current?.worker.terminate(); checkWorker.current = undefined; setRoutingCheck({ revision: routingKey, status: 'cancelled' }) }}>{t('Cancel analysis')}</button>}
          {!workspaceSession?.presentationPreview && <button onClick={openDiagnostics}>{t('Advanced checks')}</button>}
        </div>}
        <WorkspaceCanvasTabs />
        <div className="canvas-stage">
          {bgpInspection && <Suspense fallback={null}><BgpNeighborsPanel key={bgpInspection.revision} topology={topology}
            initialResource={bgpInspection.resource} unavailableIds={Object.keys(scenario.affected)}
            onClose={() => setBgpInspection(undefined)} /></Suspense>}
          {panel === 'diagnostics' && <DiagnosticsPanel topology={activeTopology} isAcknowledged={isAcknowledged} onAcknowledge={acknowledgeWarning} onRestoreAll={restoreWarningAttention} onFinding={showDiagnostic} onInspect={(node) => showRoutes(node)} onEditObject={editCoveredObject} onOpenStaticRouting={(router) => { setEditorRequest(undefined); openStaticRouting(router) }} onAssignPrefixToSite={assignPrefixToSite} onClearHighlight={() => setDiagnosticHighlight(undefined)} onProfileChange={cancelRoutingCheck} onClose={closePanel} />}
          {panel === 'issues' && currentCheck?.report && <RoutingIssuesPanel key={`${routingKey}:${routingIssueId ?? ''}:${reviewCoverage}`} topology={topology} report={currentCheck.report} isAcknowledged={isAcknowledged} onAcknowledge={acknowledgeWarning} onRestoreAll={restoreWarningAttention} findingId={routingIssueId} coverageOpen={reviewCoverage} selectedFindingId={diagnosticPaths ? diagnosticHighlight?.findingId : undefined} onFinding={showDiagnostic} onShowAll={() => setRoutingIssueId(undefined)} onInspect={showRoutes} onEditObject={editCoveredObject} onOpenStaticRouting={(router) => { setEditorRequest(undefined); openStaticRouting(router) }} onAssignPrefixToSite={assignPrefixToSite} onClose={closePanel} />}
          {panel === 'comparison' && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}><AzureComparisonPanel topology={topology} session={comparisonSession} onSession={setComparisonSession} onSelect={setSelection} onClose={closePanel} /></Suspense>}
          {panel === 'azure' && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}><AzureFilesPanel key={pendingAzureImport?.revision ?? 'workspace'} topology={topology} pendingImport={pendingAzureImport?.topology} onImportFile={() => importer.current?.click()} onCompare={() => { finishCaptureImport(); setHighlighting(false); setTracing(false); setPanel('comparison') }} onConfirmImport={() => { if (pendingAzureImport) { reset(validateTopology(pendingAzureImport.topology)); finishCaptureImport() } }} onCancelImport={() => { finishCaptureImport(); setPanel(undefined) }} onClose={() => { finishCaptureImport(); closePanel() }} /></Suspense>}
          <TopologyDiagram topology={topology} faults={scenario.affected} risks={risks} onRisk={setResilienceEndpoint} onClearSelection={() => setSelection(undefined)}
            canvasStatus={(highlighting || tracing || !!diagnosticPaths?.length || routingIssues.length > 0) && <div className="highlight-status" role="status">{(highlighting || tracing || !!diagnosticPaths?.length) ? (diagnosticPaths?.length ? t('Diagnostic path evidence') : tracing ? groupTrace ? `${groupSummary} · ${paths.length ? pathStatus : t("No matching sources or destination prefixes configured")}` : t('Path: {0} → {1} · {2} · {3}', sourceNode?.name ?? t('source'), targetNode?.name ?? destination, destinationPrefix || destination, pathStatus) : prefix ? t("Preferred routes to {0}", prefix) : t("Preferred routes · {0}", inspected?.name ?? t('Router'))) : t('{0} routing issues', routingIssues.length)}{tracing && <button onClick={() => setPanel('paths')}>{t("Path details")}</button>}{(highlighting || tracing || !!diagnosticPaths?.length) && <button onClick={() => { setDiagnosticHighlight(undefined); setHighlighting(false); setTracing(false); setPrefix('') }}>{t("Clear highlighting")}</button>}{routingIssues.length > 0 && <button onClick={clearHighlightsAndIcons}>{t("Clear highlights & icons")}</button>}</div>}
            onZoom={setZoom} layoutControls={<>
              <select aria-label={t("Visualization mode")} value={layout} onChange={(e) => update((next) => { next.layout ??= { mode: 'layered', positions: {} }; next.layout.mode = e.target.value as LayoutMode })}>
                <option value="layered">{t("Layered topology")}</option><option value="constellation">{t("Network constellation")}</option>
              </select>
              <button disabled={!Object.keys(topology.layout?.positions[layout] ?? {}).length} title={t("Restore automatic positions in the current visualization only")} onClick={() => update((next) => { if (next.layout) delete next.layout.positions[layout] })}>{t("Reset layout")}</button>
            </>}
            issues={routingIssues} onShowIssues={(finding) => { setRoutingIssueId(finding.id); setReviewCoverage(false); setPanel('issues'); showDiagnostic(finding) }} hubId={highlighting && router.kind === 'hub' ? router.id : ''} erLocationId={highlighting && router.kind === 'erLocation' ? router.id : undefined} selected={selectedRoutes} selectedSiteRoutes={highlighting && router.kind === 'site' ? simulation.siteTables[router.id]?.filter((r) => !prefix || r.prefix === prefix) : undefined} sourceConnectionIds={diagramPaths.flatMap((p) => p.sourceConnectionId ? [p.sourceConnectionId] : [])} sourceSiteLinkIds={diagramPaths.flatMap((p) => p.sourceSiteLinkIds ?? [])} sourceErLinkIds={diagramPaths.flatMap((path) => path.sourceErLinkIds ?? [])} paths={diagramPaths} sourceSpokeIds={diagramPaths.flatMap((path) => path.sourceSpokeId ? [path.sourceSpokeId] : [])} tracing={tracing || siteHighlight.length > 0 || !!diagnosticPaths?.length} layout={layout} zoom={zoom} selection={selection} onObjectClick={selectObject} onVnetConnectionClick={openVnetConnection} onShowRouteMapRules={showRouteMapRules} onNodeMove={(id, position) => update((next) => { next.layout ??= { mode: layout, positions: {} }; next.layout.positions[layout] ??= {}; next.layout.positions[layout]![id] = position })} onObjectContextMenu={(value) => { if (value.selection) selectObject(value.selection); setContextMenu(value) }} />
          {panel === 'routes' && inspected && !scenario.affected[router.id] && <RouteInspector key={`${router.kind}:${router.id}:${routeMode}`} topology={activeTopology} simulation={simulation} comparisonSession={comparisonSession} router={router} view={activeView} mode={routeMode} onRouter={selectRouter} onView={(view) => { setRouteView(view); setPrefix(''); setHighlighting(false) }} onPreference={(preference) => update((next) => { next.hubs.find((h) => h.id === router.id)!.preference = preference })} onPrefix={(value, tableId) => { setPrefix(value); setHighlightTableId(tableId ?? DEFAULT_HUB_TABLE); setHighlighting(true); setTracing(false) }} onClose={closePanel} />}
          {panel === 'maps' && <Suspense fallback={null}><RouteMapsPanel key={mapRouter ? nodeKey(mapRouter) : 'resources'} topology={topology} simulation={simulation} router={mapRouter} connectionId={mapConnectionId} onRouter={(value) => { setMapRouter(value); setMapConnectionId(undefined) }} onSave={save} onClose={closePanel} /></Suspense>}
          {panel === 'rules' && mapRouter && <RouteMapInspector topology={topology} router={mapRouter} direction={mapDirection} connectionId={mapConnectionId} onDirection={setMapDirection} onConnection={setMapConnectionId} onConfigure={openRouteMaps} onClose={closePanel} />}
          {panel === 'static' && mapRouter && <StaticRoutingPanel key={nodeKey(mapRouter)} topology={topology} router={mapRouter} onSave={save} onClose={closePanel} />}
          {panel === 'vpnWizard' && vpnConversion && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}><VpnRoutingWizard key={`${vpnConversion.connectionId}:${vpnConversion.mode}`} topology={topology} connectionId={vpnConversion.connectionId} mode={vpnConversion.mode} onSave={save} onClose={closePanel} /></Suspense>}
          {panel === 'paths' && <CanvasOverlay title={t("Path explorer")} className="path-panel" onClose={closePanel}>
            {tracing && groupTrace && <p><strong>{groupSummary}</strong>{t(". Each source is traced independently to the destination prefixes; reverse-path symmetry is not assumed.")}</p>}
            <p className="muted">{t("Longest-prefix forwarding and preferred BGP paths, not shortest graphical distance. ECMP paths remain highlighted together. Hub destinations use attached-spoke prefixes. Sites without assigned prefixes offer explicit connection advertisements as destination choices; these can be transit prefixes.")}</p>
            <form className="path-form" onSubmit={submitPath}><div className="form-grid"><label className="field"><span>{t("Source node")}</span><select aria-label={t("Source node")} value={source} onChange={(e) => { setSource(e.target.value); setTracing(false) }}><option value="">{t("Select source")}</option>{nodes.map((n) => <option key={nodeKey(n)} value={nodeKey(n)}>{n.name} ({t(n.kind)})</option>)}</select></label><label className="field"><span>{t("Destination node")}</span><select aria-label={t("Destination node")} value={target} onChange={(e) => { const prefixes = nodePrefixes(topology, parseNode(e.target.value)); setTarget(e.target.value); setDestination(prefixes[0]?.split('/')[0] ?? ''); setDestinationPrefix(prefixes[0] ?? ''); setTracing(false) }}><option value="">{t("Select destination")}</option>{nodes.map((n) => <option key={nodeKey(n)} value={nodeKey(n)}>{n.name} ({t(n.kind)})</option>)}</select></label></div>
              {sourceHub && !groupTrace && <label className="field"><span>{t('Source hub route table')}</span><select aria-label={t('Source hub route table')} value={sourceContextId} onChange={(event) => { setSourceTableId(event.target.value); setTracing(false) }}>{sourceTables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.id}</option>)}</select></label>}
              <label className="field"><span>{t("Destination prefix")}</span><select aria-label={t("Destination prefix")} value={destinationPrefix} onChange={(e) => { setDestinationPrefix(e.target.value); setDestination(e.target.value.split('/')[0]); setTracing(false) }}><option value="">{t("Custom IPv4 address")}</option>{targetNode && nodePrefixes(topology, targetNode).map((p) => <option key={p}>{p}</option>)}</select></label>
              {!destinationPrefix && <label className="field"><span>{t("Destination IPv4")}</span><input aria-label={t("Destination IPv4")} value={destination} onChange={(e) => { setDestination(e.target.value); setTracing(false) }} required /></label>}<p className="muted">{t("A prefix selection traces its network address. Choose Custom IPv4 address to test a more-specific destination within that range.")}</p><button className="primary" disabled={!sourceNode || !targetNode || ipv4(destination) === undefined || !simulation.converged}>{t("Show preferred path")}</button>
            </form>
            <p className="muted">{t("Routes may terminate at another advertiser of the same prefix. Reverse paths are calculated independently; symmetry, firewall permissions and host reachability are not assumed. Site ingress uses advertised AS paths.")}</p>
            {tracing && !groupTrace && sourceNode && targetNode && sourceNode.kind !== 'hub' && targetNode.kind !== 'hub' && nodePrefixes(activeTopology, sourceNode)[0] && <Suspense fallback={null}><FlowExportControls
              document={{ mode: 'vwan', topology: activeTopology }}
              flow={{ id: 'selected-flow', kind: 'flow', source: parseNode(source), target: parseNode(target),
                sourceAddress: nodePrefixes(activeTopology, sourceNode)[0].split('/')[0], destinationAddress: destination, expectation: 'allow' }} /></Suspense>}
            {tracing && <div className="flow-results" aria-live="polite">{paths.map((path, i) => <article key={i} className={`flow-result ${path.status}`}><strong>{'destinationPrefix' in path && `${path.sourceName} → ${path.destinationName} · ${path.destinationPrefix} · `}{path.status === 'unknown' ? t("Not assessed") : path.status === 'delivered' ? t("Reachable") : path.status === 'loop' ? t("Forwarding loop") : t("No route")}{paths.length > 1 ? t(" · path {0}", i + 1) : ''}</strong><p>{pathTitle(path)}</p><details><summary>{t("Why this path?")}</summary><ol>{path.steps.map((step, index) => <li key={index}>{localizeDiagnostic(step)}</li>)}</ol></details></article>)}{!paths.length && <p className="empty">{groupTrace ? t("No matching sources or destination prefixes configured.") : t("No trace available for this source or provisional routing state.")}</p>}</div>}
          </CanvasOverlay>}
          {panel === 'notes' && <CanvasOverlay title={t("Model notes and warnings")} className="model-notes" onClose={closePanel}>
            <h3>{t("Planning model, not an Azure control plane")}</h3><p>{t("One Standard Virtual WAN with table-local route selection and connection association/propagation. Legacy authored designs use Default. Labels are case-sensitive; unsupported static and ambiguous contexts remain unassessed. See #22.")} <a href="https://github.com/erjosito/vwan-visual-topology/issues/22" target="_blank" rel="noreferrer">#22</a></p><p>{t("Routing intent uses separate hub policy and firewall forwarding tables. Firewall rules, NAT, sessions, communities, MED, Global Reach, shared-circuit reflection and arrival/failback timing are not simulated. Custom contexts involving secured hubs remain unassessed.")}</p>
            {simulation.warnings.map((warning) => <p className="notice" key={warning}>{localizeDiagnostic(warning)}</p>)}
            <p><a href="https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference" target="_blank" rel="noreferrer">{t("Microsoft hub routing preference")}</a></p><p><a href="https://learn.microsoft.com/azure/virtual-wan/route-maps-about" target="_blank" rel="noreferrer">{t("Microsoft route-map behavior and limitations")}</a></p>
            <button onClick={() => reset(validateTopology(structuredClone(example)))}>{t("Load example (replaces workspace)")}</button>
          </CanvasOverlay>}
          {vnetConnectionId && (() => {
            const spoke = topology.spokes.find((entry) => entry.id === vnetConnectionId)
            const hub = topology.hubs.find((entry) => entry.id === spoke?.hubId)
            if (!spoke || !hub) return null
            return <Suspense fallback={null}><VwanVnetConnectionPanel key={spoke.id}
              vnetName={spoke.name} hubName={hub.name} tables={hubRouteTables(hub)}
              managedConfig={routingIntentManaged(hub) ? routingIntentConfiguration(hub) : undefined}
              config={attachmentHubRouting(topology, spoke.id)} propagateDefaultRoute={spoke.propagateDefaultRoute === true}
              onRoutingChange={(config) => update((next) => { next.spokes.find((entry) => entry.id === spoke.id)!.hubRouting = config })}
              onDefaultRouteChange={(enabled) => update((next) => { next.spokes.find((entry) => entry.id === spoke.id)!.propagateDefaultRoute = enabled })}
              onClose={() => setVnetConnectionId(undefined)} /></Suspense>
          })()}
          {editorRequest && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}><TopologyObjectEditor key={`${editorRequest.kind}:${editorRequest.id ?? 'new'}:${!!editorRequest.deleting}`} topology={topology} request={editorRequest} onClose={() => setEditorRequest(undefined)} onRouteMaps={openRouteMaps} onStaticRouting={openStaticRouting} onOpenErLocationInfo={(peeringLocation, sku, hubRegion, erLocationId) => setErLocationModal({ open: true, hasOpened: true, peeringLocation, sku, targetAzureRegion: hubRegion, erLocationId })} onAddNva={(spokeId) => {
            const existing = topology.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === spokeId)
            setEditorRequest({ kind: 'site', id: existing?.siteId, spokeId })
          }} onSave={(next, value) => {
            save(next); setSelection(editorRequest.deleting ? undefined : value); setEditorRequest(undefined)
            if (editorRequest.deleting && nodeKey(value) === nodeKey(router)) { setPanel(undefined); setHighlighting(false) }
            else if (editorRequest.deleting && mapRouter && nodeKey(value) === nodeKey(mapRouter) && (panel === 'maps' || panel === 'rules' || panel === 'static')) setPanel(undefined)
          }} /></Suspense>}
          {topology.hubs.filter((hub) => hub.id === capabilitiesHubId).map((hub) => <Suspense key={hub.id} fallback={null}>
            <HubCapabilitiesDialog hub={hub} connections={hubGatewayConnections(topology, hub.id)} onClose={() => setCapabilitiesHubId(undefined)} />
          </Suspense>)}
          {clearRequested && <Suspense fallback={null}><ClearTopologyDialog
            workspace="vwan"
            onClose={() => setClearRequested(false)}
            onConfirm={() => {
              setClearRequested(false)
              if (workspaceSession?.clearDocument && !workspaceSession.practice) workspaceSession.clearDocument()
              else { reset(validateTopology({ version: 1, name: 'New topology', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [] })); setZoom(1) }
            }} /></Suspense>}
          {cloneVnetId && <Suspense fallback={null}><CloneVnetDialog key={cloneVnetId} topology={topology} sourceId={cloneVnetId}
            onClose={() => setCloneVnetId(undefined)} onClone={copy => {
              if ('gateways' in copy) return false
              save(validateTopology({ ...topology, spokes: [...topology.spokes, copy] }))
              setSelection({ kind: 'spoke', id: copy.id })
            }} /></Suspense>}
        </div>
        <div className="legend"><span><i className="legend-line er" />ExpressRoute</span><span><i className="legend-line vpn" />VPN</span><span><i className="legend-line sdwan" />SD-WAN</span><span><i className="legend-line preferred" />{t("Preferred / flow path")}</span><span><b className="policy-tag inbound">{t("IN")}</b><b className="policy-tag outbound">{t("OUT")}</b>{t("Per-connection maps · near owning router · click for rules")}</span><span className="live-dot">{simulation.converged ? t("Routes calculated") : t("Provisional routes")}</span></div>
      </section>
    </WorkspaceTabPanel>
    </main>
    {contextMenu && <Suspense fallback={null}><TopologyContextMenu key={contextSelection ? nodeKey(contextSelection) : 'canvas'} x={contextMenu.x} y={contextMenu.y} title={contextSelection ? t("{0} actions: {1}", t(objectLabels[contextSelection.kind]), contextObject?.name ?? '') : t("Canvas actions")} actions={contextActions} onClose={() => { contextMenu.invoker.focus({ preventScroll: true }); setContextMenu(undefined) }} /></Suspense>}
    <footer>{t("Calculated locally in your browser · Use Save As for portable backups")}</footer>
  </div>
}

export default App
