import { lazy, Suspense, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { projectAzFailures, regionKey, failureKey, failureLabel, resilienceMarkers, type FailureDomain } from '../failures'
import type { ResilienceReport } from '../failure-analysis'
import { FailurePanel } from '../FailurePanel'
import './azure-net.css'
import { AZNET_MAX_JSON_LENGTH, parseAzNetJson, parseAzNetTopology } from './admission'
import { downloadAzText, workspaceError } from './workspace'
import { useAzDocument } from './useAzDocument'
import { useAzTraceSession } from './useAzTraceSession'
import { useAzDiagnosisSession } from './useAzDiagnosisSession'
import { defaultSelected, useAzSelection } from './useAzSelection'
import { azDisplayResult, azRoutingInput } from './routing-input'
import { canAcknowledgeWarning, orderWarningFindings, setWarningAcknowledgement } from '../warning-acknowledgements'
import { measureAzWork, useMeasuredRender } from './performance'
import { t, translate, useLanguage, documentTitles, localizeDiagnostic } from '../i18n'
import { LearningTools } from '../learning/LearningTools'
import { AZURE_NET_SAMPLE_GALLERY, resolveSampleIdAlias } from '../sample-catalog'
import { guidanceAnchor, resolveGuidance } from '../learning/guidance'
import type { SimulatorMode } from '../SimulatorModeSwitch'
import { WorkspaceAccountStatus, WorkspaceMenu } from '../WorkspaceSession'
import { ConfigurationEditStatus, InspectorSection, PresentationGroup, PresentationToggle } from '../WorkspacePresentation'
import { previewSubnetActions, previewVnetActions } from '../context-actions'
import { useWorkspaceEditorState, useWorkspaceSession } from '../workspace-context'
import { DocumentActions } from '../DocumentActions'
import { WorkspaceCanvasTabs, WorkspaceTabPanel } from '../WorkspaceTabs'
import type { ContextAction } from '../TopologyContextMenu'
import type { DetailTarget } from '../network-detail-projection'
import { WorkspaceTools } from '../WorkspaceTools'
import { CanvasStartActions } from '../CanvasPresentation'
import { CanvasSelectionActions } from '../CanvasSelectionActions'
import { azWorkspaceIdentity, azWorkspaceObjects, workspaceIdentityKey } from '../workspace-objects'
import { udrAssociationError } from './udr-regions'
import type { UdrManagerRequest } from './UdrTableManager'
import { CanvasOverlay } from '../CanvasOverlay'
import { azHubGatewayConnections } from '../hub-gateways'
import { useDeleteShortcut } from '../useDeleteShortcut'
import {
  ALL_KNOWN_AZURE_REGIONS,
  ER_PEERING_LOCATIONS_CATALOG,
  findErPeeringLocationEntry,
} from '../er-locations-catalog'
import {
  AzureNetDiagram,
  type AzRouteMapSelection,
  type AzContextMenuTarget,
  type AzSelectedEntity,
} from './AzureNetDiagram'
import type {
  AzCapturedObservations,
  AzNetComparisonReport,
} from './azure-import'
import { DEFAULT_HUB_TABLE, hubRouteTables } from '../hub-routing'
import { pruneAzArsRouteMaps } from './ars-route-maps'
import { confirmConfigurationSwitch } from '../configuration-selection'

import {
  AZ_NET_PAIR_LIMIT,
  azFindingImpact,
  groupAzNetFindings,
  runAzNetStaticDiagnostics,
  type AzDiagnosticFinding,
} from './diagnostics'
import { azEndpointKey, type AzEndpointOption } from './endpoints'
import { contains, ipv4 } from '../validation'
import {
  checkErLocationAzureRegionAccess,
  lookupSubnetEffectiveRoute,
  simulateAzNet,
  type AzBgpRibEntry,
} from './engine'
import {
  AZURE_NET_SAMPLES,
  cloneAzNetTopology,
  createEmptyAzNetTopology,
  validateAzNetTopology,
  type AzErCircuitSku,
  type AzNetTopology,
  type AzPeeringDirectionFlags,
} from './model'

interface AzureNetAppProps {
  simulatorMode?: SimulatorMode
  onChangeSimulatorMode?: (mode: SimulatorMode) => void
}

const NetworkDetail = lazy(() => import('../NetworkDetail').then((module) => ({ default: module.NetworkDetail })))
const AzurePanel = lazy(() => import('./AzurePanel').then((module) => ({ default: module.AzurePanel })))
const Explain = lazy(() => import('../learning/Explain').then((module) => ({ default: module.Explain })))
const WarningAcknowledgement = lazy(() => import('../WarningAcknowledgement').then((module) => ({ default: module.WarningAcknowledgement })))
const FlowExportControls = lazy(() => import('../FlowExportControls').then(module => ({ default: module.FlowExportControls }))
  .catch(() => ({ default: () => <p role="status">{t('Flow export controls unavailable. Reconnect and reload to retry; routing results remain available.')}</p> })))
const VpnNatGatewayEditor = lazy(() => import('../VpnNatEditor').then((module) => ({ default: module.VpnNatGatewayEditor })))
const BgpRouteTable = lazy(() => import('./BgpRouteTable').then((module) => ({ default: module.BgpRouteTable })))
const SampleGallery = lazy(() => import('../SampleGallery').then((module) => ({ default: module.SampleGallery })))
const ErLocationInfoModal = lazy(() => import('../ErLocationInfoModal').then((module) => ({ default: module.ErLocationInfoModal })))
const RouterSnatDialog = lazy(() => import('../RouterSnatEditor').then((module) => ({ default: module.RouterSnatDialog })))
const VnetConnectionEditor = lazy(() => import('./VnetConnectionEditor'))
const GatewayCoexistenceAutoFix = lazy(() => import('./GatewayCoexistenceAutoFix'))
const HubConfiguration = lazy(() => import('./HubConfiguration').then((module) => ({ default: module.HubConfiguration })))
const HubCapabilitiesDialog = lazy(() => import('../HubCapabilitiesDialog'))
const ClearTopologyDialog = lazy(() => import('../ClearTopologyDialog').then((module) => ({ default: module.ClearTopologyDialog })))
const CloneVnetDialog = lazy(() => import('../CloneVnetDialog').then((module) => ({ default: module.CloneVnetDialog })))
const UdrTableManager = lazy(() => import('./UdrTableManager'))
const UdrTablesEditor = lazy(() => import('./UdrTableEditor').then((module) => ({ default: module.UdrTablesEditor })))
const TopologyContextMenu = lazy(() => import('../TopologyContextMenu').then((module) => ({ default: module.TopologyContextMenu })))
const HybridConnectionEditor = lazy(() => import('./HybridRoutingEditor').then((module) => ({ default: module.HybridConnectionEditor })))
const HybridNvaEditor = lazy(() => import('./HybridRoutingEditor').then((module) => ({ default: module.HybridNvaEditor })))
const ManagedVnraEditor = lazy(() => import('./HybridRoutingEditor').then((module) => ({ default: module.ManagedVnraEditor })))
const NvaCreationEditor = lazy(() => import('./VnetRoutingSettings').then((module) => ({ default: module.NvaCreationEditor })))
const AzRouteMapsPanel = lazy(() => import('./RouteMapsPanel').then((module) => ({ default: module.AzRouteMapsPanel })))
const NvaBgpPanel = lazy(() => import('./NvaBgpPanel'))
const BgpNeighborsPanel = lazy(() => import('../BgpNeighborsPanel'))
const PeeringScopeEditor = lazy(() => import('./PeeringScopeEditor'))
const VnetRoutingSettings = lazy(() => import('./VnetRoutingSettings'))
const SubnetPrefixEditor = lazy(() => import('./AddressPrefixEditors').then((module) => ({ default: module.SubnetPrefixEditor })))
const SitePrefixEditor = lazy(() => import('./AddressPrefixEditors').then((module) => ({ default: module.SitePrefixEditor })))
const LearningInspection = lazy(() => import('../learning/LearningInspection').then(module => ({ default: module.LearningInspection })))
const FindingEvidence = lazy(() => import('./FindingEvidence'))

function useSubnetAddressEditing(commit: (updater: (draft: AzNetTopology) => void) => boolean, onError: (message: string) => void) {
  const commitRef = useRef(commit)
  useLayoutEffect(() => { commitRef.current = commit })
  return async (updater: (draft: AzNetTopology, tools: typeof import('./subnet-allocation')) => void) => {
    try {
      const tools = await import('./subnet-allocation')
      // Apply against the latest workspace, including another action queued while tools loaded.
      return flushSync(() => commitRef.current((draft) => updater(draft, tools)))
    } catch (error) {
      onError(workspaceError(error))
      return false
    }
  }
}

export function AzureNetApp({ simulatorMode = 'full' }: AzureNetAppProps = {}) {
  useMeasuredRender()
  const language = useLanguage()
  const workspaceSession = useWorkspaceSession()
  const [toolsOpenRequest, setToolsOpenRequest] = useState(0)
  const [toolsDismissRequest, setToolsDismissRequest] = useState(0)
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const {
    topology, sampleId, history, future, recoveryEntries, recoveryAcknowledged, setRecoveryAcknowledged,
    saveError, pendingUrlSample, setPendingUrlSample, commitTopology, handleUndo, handleRedo, replaceTopology,
  } = useAzDocument(setWorkspaceNotice, onTopologyChange)
  const [vnraCreationVnetId, setVnraCreationVnetId] = useState<string>()
  const [nvaCreationVnetId, setNvaCreationVnetId] = useState<string>()
  const [guidanceNavigation, setGuidanceNavigation] = useState(false)
  const [guidanceRevision, setGuidanceRevision] = useState(0)
  const [frameRequest, setFrameRequest] = useState<{ vnetId: string; revision: number }>()
  const guidanceRoot = useRef<HTMLDivElement>(null)
  const {
    activeTab, setActiveTab, selected, setSelected, canvasSelection, setCanvasSelection,
    routeInspection, routeSelection, selectCanvasObject, inspectRoutes, selectCreatedEntity, selectedExists,
  } = useAzSelection(topology, () => {
    setVnraCreationVnetId(undefined)
    setNvaCreationVnetId(undefined)
  }, () => setGuidanceNavigation(false))
  const [detailOwner, setDetailOwner] = useWorkspaceEditorState<string>('aznet.detail')
  const [detailLoadBalancer, setDetailLoadBalancer] = useState<string>()
  const [snatHubId, setSnatHubId] = useState<string>()
  const [detailReturnFocus, setDetailReturnFocus] = useState<Element | null>(null)
  const [contextReturnFocus, setContextReturnFocus] = useState<Element | null>(null)
  const openDetail = (id: string) => {
    setDetailLoadBalancer(undefined)
    setDetailReturnFocus(document.activeElement?.closest('[role="menu"]') ? contextReturnFocus : document.activeElement)
    setContextReturnFocus(null)
    setDetailOwner(id)
  }
  const [inventorySelection, setInventorySelection] = useWorkspaceEditorState<string>('aznet.inventory')
  const [vnetConnectionId, setVnetConnectionId] = useWorkspaceEditorState<string>('aznet.vnetConnection')
  const [deleteTarget, setDeleteTarget] = useState<AzSelectedEntity | null>(null)
  const [clearRequested, setClearRequested] = useState(false)
  const [cloneVnetId, setCloneVnetId] = useState<string>()
  const [udrManager, setUdrManager] = useState<UdrManagerRequest>()
  const [capabilitiesHubId, setCapabilitiesHubId] = useState<string>()
  const [firewallEditorHubId, setFirewallEditorHubId] = useState<string>()
  const [routeMapSiteId, setRouteMapSiteId] = useState<string>()
  const [routeMapArsId, setRouteMapArsId] = useState<string>()
  const [routeMapHubId, setRouteMapHubId] = useState<string>()
  const [routeMapInspection, setRouteMapInspection] = useState<AzRouteMapSelection>()
  const [nvaBgpInspection, setNvaBgpInspection] = useState<{ vnetId: string; applianceId: string }>()
  const [bgpInspection, setBgpInspection] = useState<{ resource?: import('../bgp-neighbors').BgpResourceRef; revision: number }>()
  const [erLocationModalState, setErLocationModalState] = useState<{
    open: boolean
    hasOpened?: boolean
    locationName?: string
    sku?: AzErCircuitSku
    targetLocationId?: string
  }>({ open: false })

  const [testIpQuery, setTestIpQuery] = useWorkspaceEditorState('aznet.testIp', '')
  const [hubTableInspection, setHubTableInspection] = useWorkspaceEditorState<{ hubId: string; tableId: string; prefix?: string; firewall?: boolean }>('aznet.hubTable')
  const [showDiagnosticBadges, setShowDiagnosticBadges] = useWorkspaceEditorState('aznet.diagnosticBadges', true)
  const [captureComparison, setCaptureComparison] = useWorkspaceEditorState<AzNetComparisonReport | null>('aznet.captureComparison', null)
  const [captureRevision, setCaptureRevision] = useWorkspaceEditorState<string>('aznet.captureRevision')
  const [captureNotices, setCaptureNotices] = useWorkspaceEditorState<string[]>('aznet.captureNotices', [])
  const [captureObservations, setCaptureObservations] = useWorkspaceEditorState<AzCapturedObservations | null>('aznet.captureObservations', null)
  const [originalCapture, setOriginalCapture] = useWorkspaceEditorState<unknown>('aznet.originalCapture')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const compareFileInputRef = useRef<HTMLInputElement | null>(null)

  const [faults, setFaults] = useWorkspaceEditorState<FailureDomain[]>('aznet.faults', [])
  const [resilience, setResilience] = useWorkspaceEditorState<{ revision: string; report: ResilienceReport }>('aznet.resilience')
  const [resilienceEndpoint, setResilienceEndpoint] = useWorkspaceEditorState<string>('aznet.resilienceEndpoint')
  const routingInput = useMemo(() => measureAzWork('routing-projection', () => azRoutingInput(topology)), [topology])
  const baselineRevision = routingInput.revision
  const risks = resilienceMarkers(resilience?.revision === baselineRevision ? resilience.report : undefined)
  // The revision is deliberately exhaustive except the documented presentation fields.
  const routingTopology = useMemo(() => JSON.parse(routingInput.revision) as AzNetTopology, [routingInput.revision])
  const displayNames = useMemo(() => JSON.parse(routingInput.nameRevision) as string[], [routingInput.nameRevision])
  const scenario = useMemo(() => projectAzFailures(routingTopology, faults), [routingTopology, faults])
  const unassessedFailures = useMemo(() => azDisplayResult(scenario.unassessed, displayNames), [scenario.unassessed, displayNames])
  const failureDomains = useMemo(() => azDisplayResult(scenario.domains, displayNames), [scenario.domains, displayNames])
  const activeTopology = scenario.active
  const activeRevision = useMemo(() => azRoutingInput(activeTopology).revision, [activeTopology])
  const addFault = (fault: FailureDomain) => {
    if (analysisRequest) setAnalysisEnabled(true)
    setFaults((current) => [...current.filter((f) => failureKey(f) !== failureKey(fault)), fault])
    setActiveTab(null)
    setDeleteTarget(null)
  }
  const restoreFault = (fault: FailureDomain) => {
    if (analysisRequest) setAnalysisEnabled(true)
    setFaults((current) => current.filter((f) => failureKey(f) !== failureKey(fault)))
  }
  const rawSimulation = useMemo(() => measureAzWork('simulation', () => simulateAzNet(activeTopology)), [activeTopology])
  const simulation = useMemo(() => azDisplayResult(rawSimulation, displayNames), [rawSimulation, displayNames])
  const validationErrors = useMemo(() => validateAzNetTopology(topology), [topology])

  const {
    endpointOptions, setTraceSourceKey, setTraceDestKey,
    customDestIp, setCustomDestIp, setTraceActive, groupTrace, setGroupTrace,
    resolvedSourceOpt, resolvedDestOpt, hasInvalidCustomIp, pairAnalysis, singleFlowForCustomIp, groupedPaths,
  } = useAzTraceSession(routingTopology, activeTopology, rawSimulation, displayNames)
  const {
    analysisScope, setAnalysisScope, analysisRequest, setAnalysisRequest, setAnalysisEnabled,
    currentAnalysisRun, rawAnalysis, analysisRunning, continueAnalysis, cancelAnalysis, analysis,
  } = useAzDiagnosisSession(activeTopology, activeRevision, displayNames)
  function onTopologyChange(next: AzNetTopology) {
    if (analysisRequest && azRoutingInput(next).revision !== routingInput.revision) setAnalysisEnabled(true)
  }
  const [reviewFindingIds, setReviewFindingIds] = useWorkspaceEditorState<string[] | null>('aznet.reviewFindings', null)
  const [sampleGalleryOpen, setSampleGalleryOpen] = useState<boolean>(false)
  const sampleRequest = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const [contextMenu, setContextMenu] = useState<AzContextMenuTarget | null>(null)

  const editSubnetAddresses = useSubnetAddressEditing(commitTopology, setWorkspaceNotice)

  const handleShareUrl = () => {
    if (window.desktopSimulator) return
    window.dispatchEvent(new Event('aznet-open-cloud-sharing'))
    setWorkspaceNotice(language === 'ja'
      ? '共有リンクはクラウドの保存から作成します。クラウド アカウントでサインインし、保存したバージョンを共有してください。この環境でサインインを利用できない場合は「名前を付けて保存」でコピーをダウンロードしてください。未保存の編集は共有されません。'
      : 'Create shared links from a cloud save: sign in through Cloud account, then Share saved version. If sign-in is unavailable in this build, use Save As to download a copy instead. Unsaved edits are not shared.')
  }

  const rawDiagnostics = useMemo(() => {
    const staticFindings = measureAzWork('diagnostics', () => runAzNetStaticDiagnostics(activeTopology, rawSimulation))
    const flowFindings = rawAnalysis?.findings ?? []
    return groupAzNetFindings([...staticFindings, ...flowFindings])
  }, [activeTopology, rawSimulation, rawAnalysis])
  const diagnostics = useMemo(() => azDisplayResult(rawDiagnostics, displayNames), [rawDiagnostics, displayNames])
  const rawFindingById = useMemo(() => new Map(rawDiagnostics.map((finding) => [finding.id, finding])), [rawDiagnostics])
  const [warningTriage, setWarningTriage] = useState<typeof import('./warning-triage')>()
  useEffect(() => {
    if (warningTriage || (activeTab !== 'diagnostics' && !topology.warningAcknowledgements?.length)) return
    let active = true
    void import('./warning-triage').then((module) => { if (active) setWarningTriage(module) })
      .catch(() => { if (active) setWorkspaceNotice(t('Could not load warning triage. Reopen diagnostics to retry.')) })
    return () => { active = false }
  }, [activeTab, topology.warningAcknowledgements?.length, warningTriage])
  const warningTokens = new Map<string, string>()
  const acknowledgedTokens = useMemo(() => new Set(topology.warningAcknowledgements ?? []), [topology.warningAcknowledgements])
  const warningToken = (finding: AzDiagnosticFinding) => {
    if (!warningTriage) return undefined
    let token = warningTokens.get(finding.id)
    if (!token) {
      token = warningTriage.azWarningToken(activeTopology, rawSimulation, rawFindingById.get(finding.id) ?? finding)
      warningTokens.set(finding.id, token)
    }
    return token
  }
  const isAcknowledged = (finding: AzDiagnosticFinding) => canAcknowledgeWarning(finding)
    && acknowledgedTokens.size > 0 && acknowledgedTokens.has(warningToken(finding) ?? '')
  const attentionDiagnostics = diagnostics.filter((finding) => !isAcknowledged(finding))
  const actionableCount = attentionDiagnostics.filter((f) => f.severity !== 'info').length
  const visibleDiagnostics = orderWarningFindings(reviewFindingIds
    ? diagnostics.filter((finding) => reviewFindingIds.includes(finding.id)) : diagnostics, isAcknowledged)
  const connectivityFailures = attentionDiagnostics.filter((f) => f.category === 'connectivity-failure').length
  const statefulAsymmetries = attentionDiagnostics.filter((f) => f.category === 'asymmetric-firewall-bypass').length
  const affectedFlowCount = azFindingImpact(attentionDiagnostics.filter((f) => f.severity !== 'info'), endpointOptions).pairs
  const acknowledgeWarning = (finding: AzDiagnosticFinding, acknowledged: boolean) => {
    if (!canAcknowledgeWarning(finding)) return
    const token = warningToken(finding)
    if (token) commitTopology((draft) => setWarningAcknowledgement(draft, token, acknowledged))
  }
  const traceFinding = (finding: AzDiagnosticFinding) => {
    const sf = finding.sampleFlow
    if (!sf) return
    const source = endpointOptions.find((e) => e.key === finding.sourceKey) ??
      endpointOptions.find((e) => azEndpointKey(e.ref) === azEndpointKey(sf.source) && contains(e.prefix, ipv4(sf.sourceIp) ?? -1))
    const destination = endpointOptions.find((e) => e.key === finding.destinationKey) ??
      endpointOptions.find((e) => azEndpointKey(e.ref) === azEndpointKey(sf.destination) && contains(e.prefix, ipv4(sf.destinationIp) ?? -1))
    setTraceSourceKey(source?.key ?? azEndpointKey(sf.source))
    setTraceDestKey(destination?.key ?? azEndpointKey(sf.destination))
    setCustomDestIp(destination?.defaultIp === sf.destinationIp ? '' : sf.destinationIp)
    setGroupTrace(null)
    setTraceActive(true)
    setActiveTab('tracer')
  }

  const startPath = (source: AzEndpointOption, destination: AzEndpointOption) => {
    setTraceSourceKey(source.key)
    setTraceDestKey(destination.key)
    setCustomDestIp('')
    setGroupTrace(null)
    setTraceActive(true)
    setShowDiagnosticBadges(false)
    setActiveTab('tracer')
  }

  const startAnalysis = () => {
    setAnalysisRequest(analysisScope === 'pair'
      ? { scope: 'pair', sourceKey: resolvedSourceOpt?.key ?? '', destinationKey: resolvedDestOpt?.key ?? '' }
      : { scope: analysisScope })
    setShowDiagnosticBadges(true)
    setReviewFindingIds(null)
  }

  const checkRouting = () => {
    setAnalysisScope('landscape')
    setAnalysisRequest({ scope: 'landscape' })
    setReviewFindingIds(null)
    setShowDiagnosticBadges(true)
    setTraceActive(false)
    setGroupTrace(null)
    setActiveTab(null)
  }

  const applyLoadedTopology = (id: string, nextTopology: AzNetTopology) => {
    nextTopology = replaceTopology(id, nextTopology)
    setCaptureObservations(null)
    setOriginalCapture(undefined)
    sampleRequest.current++
    setTraceActive(false)
    setGroupTrace(null)
    setAnalysisRequest(null)
    setReviewFindingIds(null)
    setCustomDestIp('')
    setShowDiagnosticBadges(true)
    setSampleGalleryOpen(false)
    const defaultVnet = nextTopology.vnets[1] ?? nextTopology.vnets[0]
    if (defaultVnet && defaultVnet.subnets[0]) {
      setSelected({
        kind: 'subnet',
        vnetId: defaultVnet.id,
        subnetId: defaultVnet.subnets[0].id,
      })
    }
  }
  const applyCapture = (raw: unknown, { importAzNetCapture, compareAzNetWithObservations }: typeof import('./azure-import')) => {
    const imported = importAzNetCapture(raw)
    const admitted = parseAzNetTopology(imported.topology)
    const importedComparison = imported.observations
      ? compareAzNetWithObservations(admitted, simulateAzNet(admitted), imported.observations) : null
    applyLoadedTopology('', admitted)
    setCaptureNotices(imported.warnings)
    setCaptureComparison(importedComparison)
    setCaptureRevision(azRoutingInput(imported.topology).revision)
    setCaptureObservations(imported.observations ?? null)
    setOriginalCapture(raw)
    setWorkspaceNotice('')
    setActiveTab('azure')
  }
  const importSessionCapture = useEffectEvent((module: typeof import('./azure-import')) => {
    if (workspaceSession?.capture) {
      applyCapture(workspaceSession.capture, module)
      workspaceSession.consumeCapture?.()
    }
  })
  useEffect(() => {
    if (!workspaceSession?.capture) return
    let cancelled = false
    void import('./azure-import').then((module) => {
      if (!cancelled) importSessionCapture(module)
    }).catch((error) => {
      if (!cancelled) setWorkspaceNotice(`Import rejected; the active design is unchanged. ${workspaceError(error)}`)
    })
    return () => { cancelled = true }
  }, [workspaceSession?.capture])

  const loadSample = async (id: string, signal?: AbortSignal) => {
    id = resolveSampleIdAlias(id)
    const request = ++sampleRequest.current
    const scope = workspaceSession?.getRequestVersion()
    try {
      if (id && !/^[a-z0-9-]+$/.test(id)) return false
      const found = AZURE_NET_SAMPLES.find((s) => s.id === id)
      const next = !id ? createEmptyAzNetTopology()
        : found ? cloneAzNetTopology(found.topology)
        : await fetch(`/docs/samples/azure-net/${id}.json`, { signal }).then(async (res) => {
          if (!res.ok) throw new Error(`Sample "${id}" not found.`)
          return parseAzNetJson(await res.text())
        })
      if (signal?.aborted || !mounted.current || request !== sampleRequest.current || workspaceSession && scope !== workspaceSession.getRequestVersion()) return false
      if (id && workspaceSession && !workspaceSession.practice) await workspaceSession.openDocument(next, undefined, { sampleId: id })
      else applyLoadedTopology(id, next)
      return true
    } catch (error) {
      if (!signal?.aborted && request === sampleRequest.current) setWorkspaceNotice(`Sample rejected: ${workspaceError(error)}`)
      return false
    }
  }

  const urlSampleLoaded = useRef(false)
  useEffect(() => {
    const prevTitle = document.title
    document.title = documentTitles[language]
    return () => { document.title = prevTitle }
  }, [language])

  useEffect(() => {
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const prevIconHref = iconLink?.getAttribute('href')
    if (iconLink) {
      iconLink.setAttribute('href', '/favicon-aznet.svg')
    }
    return () => {
      if (iconLink && prevIconHref) iconLink.setAttribute('href', prevIconHref)
    }
  }, [])

  const applyUrlSample = useEffectEvent((requested: string, loaded: AzNetTopology) => {
    applyLoadedTopology(requested, loaded)
  })
  useEffect(() => {
    if (urlSampleLoaded.current) return
    const requested = pendingUrlSample
    if (!/^[a-z0-9-]+$/.test(requested)) return
    urlSampleLoaded.current = true
    if (AZURE_NET_SAMPLES.some((s) => s.id === requested)) {
      return
    }
    const controller = new AbortController()
    void fetch(`/docs/samples/azure-net/${requested}.json`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sample "${requested}" not found.`)
        return parseAzNetJson(await res.text())
      })
      .then((loaded) => {
        if (!controller.signal.aborted) applyUrlSample(requested, loaded)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setWorkspaceNotice(`Sample rejected: ${workspaceError(err)}`)
      })
      .finally(() => { if (!controller.signal.aborted) setPendingUrlSample('') })
    return () => { controller.abort(); urlSampleLoaded.current = false }
  }, [pendingUrlSample, setPendingUrlSample])

  // One-click Auto-Remediation for diagnostic findings
  const applyAutoFix = (finding: AzDiagnosticFinding) => {
    commitTopology((draft) => {
      if (finding.category === 'gateway-subnet-missing-udr' && finding.vnetId) {
        const hubVnet = draft.vnets.find((v) => v.id === finding.vnetId)
        const gwSubnet = hubVnet?.subnets.find((s) => s.name === 'GatewaySubnet')
        const fw = hubVnet?.appliances.find(
          (a) => a.inspectsTraffic || a.kind === 'azure-firewall',
        )
        if (!hubVnet || !gwSubnet || !fw) return
        let rt = gwSubnet.routeTableId
          ? draft.udrTables.find((t) => t.id === gwSubnet.routeTableId)
          : undefined
        if (!rt) {
          rt = {
            id: `rt-gw-${hubVnet.id}`,
            name: `RT-${hubVnet.name}-GatewaySubnet`,
            region: hubVnet.region,
            disableBgpRoutePropagation: false,
            routes: [],
          }
          draft.udrTables.push(rt)
          gwSubnet.routeTableId = rt.id
        }
        for (const spoke of draft.vnets) {
          if (spoke.id === hubVnet.id) continue
          for (const prefix of spoke.prefixes) {
            const existing = rt.routes.find((r) => r.prefix === prefix)
            if (existing) {
              existing.enabled = true
              existing.nextHopType = 'VirtualAppliance'
              existing.nextHopIp = fw.privateIp
            } else {
              rt.routes.push({
                id: `udr-autofix-${spoke.id}-${prefix}`,
                name: `to-${spoke.name}-via-${fw.name}`,
                prefix,
                nextHopType: 'VirtualAppliance',
                nextHopIp: fw.privateIp,
                enabled: true,
              })
            }
          }
        }
      } else if (
        finding.category === 'gateway-subnet-bgp-disabled' &&
        finding.subnetId
      ) {
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) rt.disableBgpRoutePropagation = false
          }
        }
      } else if (finding.category === 'vnra-peering-access-disabled' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          p.aToB.allowVirtualNetworkAccess = true
          p.bToA.allowVirtualNetworkAccess = true
        }
      } else if (finding.category === 'peering-forwarded-traffic-blocked' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          p.aToB.allowForwardedTraffic = true
          p.bToA.allowForwardedTraffic = true
        }
      } else if (finding.category === 'remote-gateway-transit-mismatch' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          if (p.aToB.useRemoteGateways) p.bToA.allowGatewayTransit = true
          if (p.bToA.useRemoteGateways) p.aToB.allowGatewayTransit = true
        }
      } else if (finding.category === 'peering-use-remote-gateways-conflict' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          const vA = draft.vnets.find((v) => v.id === p.vnetAId)
          const vB = draft.vnets.find((v) => v.id === p.vnetBId)
          if (vA && (vA.gateways.length > 0 || Boolean(vA.routeServer?.enabled))) {
            p.aToB.useRemoteGateways = false
          }
          if (vB && (vB.gateways.length > 0 || Boolean(vB.routeServer?.enabled))) {
            p.bToA.useRemoteGateways = false
          }
        }
      } else if (finding.category === 'spoke-onprem-gateway-transit-disabled' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          const vA = draft.vnets.find((v) => v.id === p.vnetAId)
          const vB = draft.vnets.find((v) => v.id === p.vnetBId)
          const vAHasGwOrArs = Boolean(vA && (vA.gateways.length > 0 || vA.routeServer?.enabled))
          const vBHasGwOrArs = Boolean(vB && (vB.gateways.length > 0 || vB.routeServer?.enabled))
          if (vAHasGwOrArs && !vBHasGwOrArs) {
            p.aToB.allowGatewayTransit = true
            p.bToA.useRemoteGateways = true
          } else if (vBHasGwOrArs && !vAHasGwOrArs) {
            p.bToA.allowGatewayTransit = true
            p.aToB.useRemoteGateways = true
          }
        }
      } else if (finding.category === 'er-sku-regional-mismatch' && finding.erLocationId) {
        const loc = draft.erLocations.find((l) => l.id === finding.erLocationId)
        if (loc) {
          const nextSku: AzErCircuitSku = loc.sku === 'Local' ? 'Standard' : 'Premium'
          loc.sku = nextSku
          if (finding.vnetId) {
            const vnet = draft.vnets.find((v) => v.id === finding.vnetId)
            if (vnet && !checkErLocationAzureRegionAccess(loc, vnet.region).allowed) {
              loc.sku = 'Premium'
            }
          }
        }
      } else if (finding.category === 'appliance-ip-forwarding-disabled' && finding.applianceId) {
        for (const v of draft.vnets) {
          const app = v.appliances.find((a) => a.id === finding.applianceId)
          if (app) app.enableIpForwarding = true
        }
      } else if (finding.category === 'ars-configuration' && finding.vnetId) {
        const v = draft.vnets.find((vn) => vn.id === finding.vnetId)
        if (v?.routeServer) v.routeServer.branchToBranchTraffic = true
      } else if (finding.category === 'ars-default-route-self-loop' && finding.vnetId && finding.subnetId) {
        const vnet = draft.vnets.find((v) => v.id === finding.vnetId)
        const sub = vnet?.subnets.find((s) => s.id === finding.subnetId)
        if (!vnet || !sub) return
        let rt = sub.routeTableId
          ? draft.udrTables.find((t) => t.id === sub.routeTableId)
          : undefined
        if (!rt) {
          rt = {
            id: `rt-nva-egress-${sub.id}`,
            name: `RT-${vnet.name}-${sub.name}`,
            region: vnet.region,
            disableBgpRoutePropagation: false,
            routes: [],
          }
          draft.udrTables.push(rt)
          sub.routeTableId = rt.id
        }
        const existingDefault = rt.routes.find((r) => r.prefix === '0.0.0.0/0')
        if (existingDefault) {
          existingDefault.enabled = true
          existingDefault.nextHopType = 'Internet'
          existingDefault.nextHopIp = undefined
        } else {
          rt.routes.push({
            id: `udr-autofix-nva-internet-${sub.id}`,
            name: 'default-to-internet',
            prefix: '0.0.0.0/0',
            nextHopType: 'Internet',
            enabled: true,
          })
        }
      } else if (finding.category === 'bgp-lpm-bypasses-udr' && finding.subnetId) {
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) rt.disableBgpRoutePropagation = true
          }
        }
      } else if (finding.category === 'udr-vng-vnet-transit' && finding.subnetId) {
        const hubFw = draft.vnets
          .flatMap((v) => v.appliances)
          .find((a) => a.inspectsTraffic || a.kind === 'azure-firewall' || a.enableIpForwarding)
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) {
              for (const r of rt.routes) {
                if (r.nextHopType === 'VirtualNetworkGateway' && hubFw) {
                  r.nextHopType = 'VirtualAppliance'
                  r.nextHopIp = hubFw.privateIp
                }
              }
            }
          }
        }
      } else if (finding.category === 'peering-lpm-bypasses-udr' && finding.subnetId) {
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) rt.disablePeeringRoutePropagation = true
          }
        }
      } else if (finding.category === 'expressroute-msee-hairpin') {
        const parts = finding.id.split(':')
        const vnetAId = parts[3]
        const vnetBId = parts[4]
        const vA = draft.vnets.find((v) => v.id === vnetAId)
        const vB = draft.vnets.find((v) => v.id === vnetBId)
        if (vA && vB) {
          const existing = draft.vnetPeerings.find(
            (p) =>
              (p.vnetAId === vA.id && p.vnetBId === vB.id) ||
              (p.vnetAId === vB.id && p.vnetBId === vA.id),
          )
          if (existing) {
            existing.enabled = true
            existing.aToB.allowVirtualNetworkAccess = true
            existing.bToA.allowVirtualNetworkAccess = true
          } else {
            draft.vnetPeerings.push({
              id: `peer-autofix-${vA.id}-${vB.id}`,
              name: `${vA.name}-to-${vB.name}`,
              vnetAId: vA.id,
              vnetBId: vB.id,
              enabled: true,
              aToB: {
                allowVirtualNetworkAccess: true,
                allowForwardedTraffic: true,
                allowGatewayTransit: false,
                useRemoteGateways: false,
              },
              bToA: {
                allowVirtualNetworkAccess: true,
                allowForwardedTraffic: true,
                allowGatewayTransit: false,
                useRemoteGateways: false,
              },
            })
          }
        }
      } else if (
        (finding.category === 'subnet-default-outbound-disabled' ||
          finding.category === 'subnet-internet-bypasses-firewall') &&
        finding.subnetId
      ) {
        const hubFw = draft.vnets
          .flatMap((v) => v.appliances)
          .find((a) => a.inspectsTraffic || a.kind === 'azure-firewall' || a.enableIpForwarding)
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (!sub) continue
          if (hubFw) {
            let rt = sub.routeTableId
              ? draft.udrTables.find((t) => t.id === sub.routeTableId)
              : undefined
            if (!rt) {
              rt = {
                id: `rt-egress-${sub.id}`,
                name: `RT-${vnet.name}-${sub.name}`,
                region: vnet.region,
                disableBgpRoutePropagation: false,
                routes: [],
              }
              draft.udrTables.push(rt)
              sub.routeTableId = rt.id
            }
            const existingDefault = rt.routes.find((r) => r.prefix === '0.0.0.0/0')
            if (existingDefault) {
              existingDefault.enabled = true
              existingDefault.nextHopType = 'VirtualAppliance'
              existingDefault.nextHopIp = hubFw.privateIp
            } else {
              rt.routes.push({
                id: `udr-autofix-default-${sub.id}`,
                name: `default-via-${hubFw.name}`,
                prefix: '0.0.0.0/0',
                nextHopType: 'VirtualAppliance',
                nextHopIp: hubFw.privateIp,
                enabled: true,
              })
            }
          } else {
            sub.defaultOutboundAccess = true
          }
        }
      }
    })
  }

  // Resolve currently viewed Subnet Effective Route table (defaulting to selected subnet or first subnet of selected VNet)
  const inspectedSubnetTable = useMemo(() => {
    const selected = routeSelection
    if (selected.kind === 'subnet') {
      return simulation.subnetTables[selected.subnetId]
    }
    if (selected.kind === 'vnet') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const sub = vnet?.subnets[0]
      return sub ? simulation.subnetTables[sub.id] : undefined
    }
    if (selected.kind === 'appliance') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const app = vnet?.appliances.find((a) => a.id === selected.applianceId)
      return app ? simulation.subnetTables[app.subnetId] : undefined
    }
    const fallbackVnet = topology.vnets[0]
    const fallbackSub = fallbackVnet?.subnets[0]
    return fallbackSub ? simulation.subnetTables[fallbackSub.id] : undefined
  }, [routeSelection, simulation, topology])

  const lpmMatchedRouteId = useMemo(() => {
    if (!inspectedSubnetTable || !testIpQuery.trim()) return undefined
    return lookupSubnetEffectiveRoute(inspectedSubnetTable, testIpQuery.trim())?.id
  }, [inspectedSubnetTable, testIpQuery])

  // Resolve control-plane RIB if a Gateway, Route Server, vWAN Hub, ER Location, or Site is selected
  const inspectedControlRib = useMemo<{ title: string; entries: AzBgpRibEntry[]; available: boolean; staticRouting?: boolean } | null>(() => {
    const selected = routeSelection
    if (selected.kind === 'gateway') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const gw = vnet?.gateways.find((g) => g.id === selected.gatewayId)
      return {
        title: `${translate(language, gw?.kind === 'Vpn' && gw.bgpEnabled === false ? 'Effective routes' : 'Virtual Network Gateway BGP table')} · ${gw?.name ?? selected.gatewayId}`,
        entries: simulation.gatewayRibs[selected.gatewayId] ?? [],
        available: Boolean(gw) && !scenario.affected[selected.gatewayId],
        staticRouting: gw?.kind === 'Vpn' && gw.bgpEnabled === false,
      }
    }
    if (selected.kind === 'route-server') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const ars = vnet?.routeServer
      return {
        title: `${translate(language, 'Azure Route Server BGP table (ASN 65515)')} · ${ars?.name ?? selected.routeServerId}`,
        entries: simulation.routeServerRibs[selected.routeServerId] ?? [],
        available: ars?.id === selected.routeServerId && !scenario.affected[selected.routeServerId],
      }
    }
    if (selected.kind === 'vwan-hub') {
      const hub = topology.vwanHubs.find((h) => h.id === selected.hubId)
      const tableId = hubTableInspection?.hubId === selected.hubId ? hubTableInspection.tableId : DEFAULT_HUB_TABLE
      const firewall = hubTableInspection?.hubId === selected.hubId && hubTableInspection.firewall && hub?.firewall
      return {
        title: `${translate(language, 'Virtual WAN Hub BGP table')} · ${hub?.name ?? selected.hubId} · ${firewall ? translate(language, 'Firewall onward routes') : tableId}`,
        entries: firewall ? simulation.vwanFirewallRibs[selected.hubId] ?? [] : simulation.vwanHubTables[selected.hubId]?.[tableId] ?? [],
        available: Boolean(hub && simulation.vwanHubTables[hub.id]?.[tableId]) && !scenario.affected[selected.hubId],
      }
    }
    if (selected.kind === 'er-location') {
      const loc = topology.erLocations.find((l) => l.id === selected.locationId)
      return {
        title: `${translate(language, 'ExpressRoute location BGP table (ASN 12076)')} · ${loc?.name ?? selected.locationId}`,
        entries: simulation.erLocationRibs[selected.locationId] ?? [],
        available: Boolean(loc) && !scenario.affected[selected.locationId],
      }
    }
    if (selected.kind === 'site') {
      const site = topology.sites.find((s) => s.id === selected.siteId)
      return {
        title: `${translate(language, 'On-premises site BGP table')} · ${site?.name ?? selected.siteId}`,
        entries: simulation.siteRibs[selected.siteId] ?? [],
        available: Boolean(site) && !scenario.affected[selected.siteId],
      }
    }
    return null
  }, [routeSelection, topology, simulation, scenario.affected, hubTableInspection, language])

  const visibleCatalogEntries = useMemo(
    () =>
      simulatorMode === 'hub-spoke'
        ? AZURE_NET_SAMPLE_GALLERY.filter((s) => !s.fullHybridOnly)
        : AZURE_NET_SAMPLE_GALLERY,
    [simulatorMode],
  )
  const currentSampleMeta = AZURE_NET_SAMPLE_GALLERY.find((s) => s.id === sampleId)

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(topology, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sampleId || 'azure-net-topology'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addSpokeVnet = (x?: number, y?: number) => {
    commitTopology((draft) => {
      const idx = draft.vnets.length + 1
      const vId = `vnet-custom-${idx}`
      const sId = `snet-custom-${idx}`
      draft.vnets.push({
        id: vId,
        name: `Spoke-VNet-${idx}`,
        region: 'West Europe',
        role: 'spoke',
        prefixes: [`10.${50 + idx}.0.0/16`],
        subnets: [
          {
            id: sId,
            name: 'snet-workload',
            prefix: `10.${50 + idx}.1.0/24`,
          },
        ],
        gateways: [],
        appliances: [],
        ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      })
    })
  }

  const addSiteNode = (x?: number, y?: number) => {
    const newId = `site-custom-${topology.sites.length + 1}`
    commitTopology((draft) => {
      const idx = draft.sites.length + 1
      draft.sites.push({
        id: `site-custom-${idx}`,
        name: `Branch-Site-${idx}`,
        asn: 65100 + idx,
        prefixes: [`172.16.${50 + idx}.0/24`],
        ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      })
    })
    setSelected({ kind: 'site', siteId: newId })
  }

  const addErLocationNode = (x?: number, y?: number) => {
    const newId = `erloc-custom-${topology.erLocations.length + 1}`
    commitTopology((draft) => {
      const idx = draft.erLocations.length + 1
      draft.erLocations.push({
        id: `erloc-custom-${idx}`,
        name: `ER-Location-${idx}`,
        globalReachEnabled: false,
        ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      })
    })
    setSelected({ kind: 'er-location', locationId: newId })
  }

  const deleteSiteById = (siteId: string) => {
    commitTopology((draft) => {
      draft.sites = draft.sites.filter((s) => s.id !== siteId)
      draft.vpnConnections = draft.vpnConnections.filter((c) => c.siteId !== siteId)
      draft.erLinks = draft.erLinks.filter(
        (l) => !(l.targetKind === 'site' && l.targetId === siteId),
      )
      draft.siteLinks = draft.siteLinks.filter(
        (l) => l.siteAId !== siteId && l.siteBId !== siteId,
      )
    })
    if (selected?.kind === 'site' && selected.siteId === siteId) {
      setSelected(defaultSelected(topology))
      setActiveTab(null)
    }
  }

  const deleteErLocationById = (locationId: string) => {
    commitTopology((draft) => {
      draft.erLocations = draft.erLocations.filter((l) => l.id !== locationId)
      draft.erLinks = draft.erLinks.filter((l) => l.locationId !== locationId)
      if (draft.erGlobalReachLinks) {
        draft.erGlobalReachLinks = draft.erGlobalReachLinks.filter(
          (gr) => gr.locationAId !== locationId && gr.locationBId !== locationId,
        )
      }
    })
    if (selected?.kind === 'er-location' && selected.locationId === locationId) {
      setSelected(defaultSelected(topology))
      setActiveTab(null)
    }
  }

  const vnetUsesRemoteGateways = (vnetId: string, topo: AzNetTopology = topology): boolean =>
    topo.vnetPeerings.some(
      (p) =>
        p.enabled &&
        ((p.vnetAId === vnetId && p.aToB.useRemoteGateways) ||
          (p.vnetBId === vnetId && p.bToA.useRemoteGateways)),
    )

  const addSubnetToVnet = async (vnetId: string) => {
    let createdId = ''
    const committed = await editSubnetAddresses((draft, { availableSubnetPrefix }) => {
      const v = draft.vnets.find((x) => x.id === vnetId)
      if (!v) return
      let idx = v.subnets.length + 1
      let candidateId = `snet-${v.id}-${idx}`
      while (v.subnets.some((s) => s.id === candidateId)) {
        idx += 1
        candidateId = `snet-${v.id}-${idx}`
      }
      const prefix = availableSubnetPrefix(v)
      createdId = candidateId
      v.subnets.push({
        id: createdId,
        name: `snet-tier-${idx}`,
        prefix,
      })
    })
    if (committed && createdId) {
      setSelected({ kind: 'subnet', vnetId, subnetId: createdId })
    }
  }

  const deleteSubnetFromVnet = (vnetId: string, subnetId: string) => {
    commitTopology((draft) => {
      const v = draft.vnets.find((x) => x.id === vnetId)
      if (!v) return
      v.subnets = v.subnets.filter((s) => s.id !== subnetId)
      v.appliances = v.appliances.filter((a) => a.subnetId !== subnetId)
      if (v.routeServer?.subnetId === subnetId) {
        v.routeServer = undefined
      }
    })
    if (selected.kind === 'subnet' && selected.subnetId === subnetId) {
      setSelected({ kind: 'vnet', vnetId })
    }
  }

  const deleteVnetById = (vnetId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      const gwIds = new Set((target?.gateways ?? []).map((g) => g.id))
      draft.vnets = draft.vnets.filter((v) => v.id !== vnetId)
      draft.vnetPeerings = draft.vnetPeerings.filter(
        (p) => p.vnetAId !== vnetId && p.vnetBId !== vnetId,
      )
      draft.vpnConnections = draft.vpnConnections.filter(
        (c) => !(c.targetKind === 'vnet-gateway' && gwIds.has(c.targetId)),
      )
      draft.erLinks = draft.erLinks.filter(
        (l) => !(l.targetKind === 'vnet-gateway' && gwIds.has(l.targetId)),
      )
    })
    setSelected(defaultSelected(topology))
    setActiveTab(null)
  }

  const addFirewallToVnet = (vnetId: string) => {
    void editSubnetAddresses((draft, tools) => { tools.addAzureFirewall(draft, vnetId) })
  }

  const openNvaCreation = (vnetId: string) => {
    if (!setSelected({ kind: 'vnet', vnetId })) return
    setVnraCreationVnetId(undefined)
    setNvaCreationVnetId(vnetId)
    setActiveTab('editor')
  }

  const openVnraCreation = (vnetId: string) => {
    if (!setSelected({ kind: 'vnet', vnetId })) return
    setNvaCreationVnetId(undefined)
    setVnraCreationVnetId(vnetId)
    setActiveTab('editor')
  }

  const removeApplianceFromVnet = (vnetId: string, applianceId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      target.appliances = target.appliances.filter((a) => a.id !== applianceId)
      for (const vnet of draft.vnets) {
        if (vnet.routeServer) vnet.routeServer.peerApplianceIds = vnet.routeServer.peerApplianceIds.filter((id) => id !== applianceId)
      }
      draft.vpnConnections = draft.vpnConnections.filter(
        (c) => !(c.targetKind === 'appliance' && c.targetId === applianceId),
      )
    })
  }

  const addGatewayToVnet = (vnetId: string, kind: 'ExpressRoute' | 'Vpn') => {
    void editSubnetAddresses((draft, { availableSubnetPrefix }) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      if (vnetUsesRemoteGateways(vnetId, draft)) return
      if (target.gateways.some((g) => g.kind === kind)) return
      if (!target.subnets.some((s) => s.name === 'GatewaySubnet')) {
        target.subnets.push({
          id: `${target.id}-gw-snet`,
          name: 'GatewaySubnet',
          prefix: availableSubnetPrefix(target),
        })
      }
      target.gateways.push({
        id: `${target.id}-${kind === 'ExpressRoute' ? 'ergw' : 'vpngw'}`,
        name: `${target.name}-${kind === 'ExpressRoute' ? 'er-gw' : 'vpn-gw'}`,
        kind,
        asn: 65515,
        bgpEnabled: true,
        enabled: true,
        sku: kind === 'Vpn' ? 'VpnGw1AZ' : 'ErGw1AZ',
        ...(kind === 'Vpn' ? { activeActive: false, vpnType: 'RouteBased', vpnGatewayGeneration: 'Generation1' } : {}),
      })
    })
  }

  const removeGatewayFromVnet = (vnetId: string, gatewayId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      target.gateways = target.gateways.filter((g) => g.id !== gatewayId)
      draft.erLinks = draft.erLinks.filter(
        (l) => !(l.targetKind === 'vnet-gateway' && l.targetId === gatewayId),
      )
      draft.vpnConnections = draft.vpnConnections.filter(
        (c) => !(c.targetKind === 'vnet-gateway' && c.targetId === gatewayId),
      )
    })
  }

  const addRouteServerToVnet = (vnetId: string) => {
    void editSubnetAddresses((draft, { availableSubnetPrefix }) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target || target.routeServer) return
      if (vnetUsesRemoteGateways(vnetId, draft)) return
      let rsSubnet = target.subnets.find((s) => s.name === 'RouteServerSubnet')
      if (!rsSubnet) {
        rsSubnet = {
          id: `${target.id}-rs-snet`,
          name: 'RouteServerSubnet',
          prefix: availableSubnetPrefix(target),
        }
        target.subnets.push(rsSubnet)
      }
      target.routeServer = {
        id: `${target.id}-ars`,
        name: `${target.name}-ars`,
        subnetId: rsSubnet.id,
        enabled: true,
        branchToBranchTraffic: true,
        hubRoutingPreference: 'ExpressRoute',
        peerApplianceIds: target.appliances.filter((a) => a.bgpEnabled).map((a) => a.id),
      }
    })
  }

  const removeRouteServerFromVnet = (vnetId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      target.routeServer = undefined
    })
  }

  const createAndAssociateRouteTable = (vnetId?: string, subnetId?: string) => {
    setToolsDismissRequest((request) => request + 1)
    setContextMenu(null)
    setUdrManager({ create: true, associate: vnetId && subnetId ? { vnetId, subnetId } : undefined })
  }

  const pathContextActions = (anchors: AzEndpointOption[]): ContextAction[] => {
    const forAnchor = (anchor: AzEndpointOption, direction: 'to' | 'from'): ContextAction[] => {
      const peers = endpointOptions.filter((e) => azEndpointKey(e.ref) !== azEndpointKey(anchor.ref))
      return [
        ...(['workload', 'site'] as const).map((group) => ({
          label: group === 'workload' ? 'All workload subnets' : 'All on-premises sites',
          disabled: !peers.some((e) => e.group === group),
          onSelect: () => {
            setGroupTrace({ anchorKey: anchor.key, direction, group })
            setTraceSourceKey(direction === 'to' ? anchor.key : '')
            setTraceDestKey(direction === 'from' ? anchor.key : '')
            setCustomDestIp('')
            setTraceActive(true)
            setShowDiagnosticBadges(false)
            setActiveTab('tracer')
          },
        })),
        ...peers.map((peer) => ({
          label: peer.label,
          onSelect: () => direction === 'to' ? startPath(anchor, peer) : startPath(peer, anchor),
        })),
        ...(!peers.length ? [{ label: 'No other endpoints configured', disabled: true }] : []),
      ]
    }
    return [
      ...(['to', 'from'] as const).map((direction) => ({
        label: `Show path ${direction}`,
        disabled: anchors.length === 0,
        children: anchors.length === 1 ? forAnchor(anchors[0], direction) :
          anchors.map((anchor) => ({ label: anchor.label, children: forAnchor(anchor, direction) })),
      })),
      {
        label: 'Open path explorer',
        selectionAction: 'trace',
        previewPrimary: true,
        disabled: anchors.length === 0,
        onSelect: () => {
          setTraceSourceKey(anchors[0].key)
          setTraceDestKey('')
          setGroupTrace(null)
          setCustomDestIp('')
          setTraceActive(false)
          setActiveTab('tracer')
        },
      },
    ]
  }

  const addDefaultVnet = () => {
    const newId = `vnet-custom-${topology.vnets.length + 1}`
    commitTopology((draft) => {
      const idx = draft.vnets.length + 1
      draft.vnets.push({
        id: `vnet-custom-${idx}`,
        name: `Spoke-VNet-${idx}`,
        region: 'West Europe',
        role: 'spoke',
        prefixes: [`10.${50 + idx}.0.0/16`],
        subnets: [{ id: `snet-custom-${idx}`, name: 'snet-workload', prefix: `10.${50 + idx}.1.0/24` }],
        gateways: [],
        appliances: [],
      })
    })
    setSelected({ kind: 'vnet', vnetId: newId })
  }
  const addVwanHub = (x?: number, y?: number) => {
    const id = `vhub-custom-${topology.vwanHubs.length + 1}`
    const created = commitTopology((draft) => {
      const idx = draft.vwanHubs.length + 1
      draft.vwanHubs.push({
        id,
        name: `vWAN-Hub-${idx}`,
        region: 'West Europe',
        prefix: `10.${190 + idx}.0.0/23`,
        preference: 'ExpressRoute',
        routingIntent: { private: false, internet: false },
        ...(x === undefined || y === undefined ? {} : { x, y }),
      })
    })
    if (created && setSelected({ kind: 'vwan-hub', hubId: id })) setActiveTab('editor')
  }
  const attachVnetToHub = (vnetId: string, hubId: string) => {
    commitTopology((draft) => {
      const vnet = draft.vnets.find((entry) => entry.id === vnetId)
      if (vnet && !vnet.vwanHubAttachment && draft.vwanHubs.some((hub) => hub.id === hubId)) {
        vnet.vwanHubAttachment = { hubId, enabled: true, propagateDefaultRoute: true }
      }
    })
  }
  const openHubConnections = (hubId: string, focusFirewall = false) => {
    setFirewallEditorHubId(focusFirewall ? hubId : undefined)
    setSelected({ kind: 'vwan-hub', hubId })
    setActiveTab('editor')
  }
  const openVnetConnection = (vnetId: string) => {
    if (!confirmConfigurationSwitch('.aznet-app .object-editor')) return
    if (!setSelected({ kind: 'vnet', vnetId })) return
    setActiveTab(null)
    setVnetConnectionId(vnetId)
  }
  const getOrdinaryContextMenuSpec = (
    target: AzSelectedEntity | { kind: 'canvas'; svgX: number; svgY: number },
  ): { title: string; actions: ContextAction[] } | null => {

    if (target.kind === 'canvas') {
      return {
        title: 'Canvas Actions',
        actions: [
          {
            label: t('Add VNet here'),
            onSelect: () => addSpokeVnet(target.svgX, target.svgY),
          },
          ...(simulatorMode === 'full'
            ? [
                {
                  label: 'Add Virtual WAN Hub here',
                  onSelect: () => addVwanHub(target.svgX, target.svgY),
                },
              ]
            : []),
          {
            label: 'Add On-Premises Site here',
            onSelect: () => addSiteNode(target.svgX, target.svgY),
          },
          {
            label: 'Add ExpressRoute Location here',
            onSelect: () => addErLocationNode(target.svgX, target.svgY),
          },
          {
            label: 'Create Independent Route Table',
            onSelect: () => createAndAssociateRouteTable(),
          },
          {
            label: 'Run Root-Cause Diagnostics',
            onSelect: () => {
              setShowDiagnosticBadges(true)
              setActiveTab('diagnostics')
            },
          },
          {
            label: 'Open Sample Topology Gallery',
            onSelect: () => setSampleGalleryOpen(true),
          },
          {
            label: 'Clear Path & Diagnostic Highlights',
            onSelect: () => {
              setTraceActive(false)
              setGroupTrace(null)
              setShowDiagnosticBadges(false)
            },
          },
        ],
      }
    }

    if (target.kind === 'vnet') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      if (!vnet) return null
      const firstSub = vnet.subnets[0]
      const peerableVnets = topology.vnets.filter(
        (other) =>
          other.id !== vnet.id &&
          !topology.vnetPeerings.some(
            (p) =>
              (p.vnetAId === vnet.id && p.vnetBId === other.id) ||
              (p.vnetAId === other.id && p.vnetBId === vnet.id),
          ),
      )
      const hasErGw = vnet.gateways.some((g) => g.kind === 'ExpressRoute')
      const hasVpnGw = vnet.gateways.some((g) => g.kind === 'Vpn')
      const usesRemoteGw = vnetUsesRemoteGateways(vnet.id)

      return {
        title: `VNet · ${vnet.name} (${vnet.region})`,
        actions: [
          { label: t('Open VNet detail'), previewPrimary: true, onSelect: () => openDetail(vnet.id) },
          { label: t('Clone VNet...'), previewPrimary: true, onSelect: () => setCloneVnetId(vnet.id) },
          ...(vnet.vwanHubAttachment ? [{
            label: t('Configure virtual hub connection'),
            previewPrimary: true,
            selectionAction: 'connect' as const,
            onSelect: () => openVnetConnection(vnet.id),
          }] : [{
            label: t('Connect to virtual hub'), previewPrimary: true, selectionAction: 'connect' as const, allowDisabledChildren: true,
            children: topology.vwanHubs.length ? topology.vwanHubs.map((hub) => ({
              label: hub.name,
              onSelect: () => { attachVnetToHub(vnet.id, hub.id); openHubConnections(hub.id) },
            })) : [{ label: t('No virtual hubs. Add a virtual hub first.'), disabled: true }],
          }]),
          ...pathContextActions(endpointOptions.filter((e) => e.ref.kind === 'subnet' &&
            e.ref.vnetId === vnet.id && e.group === 'workload')),
          {
            label: 'Inspect Effective Routes',
            previewPrimary: true,
            selectionAction: 'inspect',
            disabled: !firstSub,
            onSelect: () => {
              if (!firstSub) return
              inspectRoutes({ kind: 'subnet', vnetId: vnet.id, subnetId: firstSub.id })
            },
          },
          ...(vnet.subnets.length > 1
            ? [
                {
                  label: 'Inspect Subnet',
                  children: vnet.subnets.map((sub) => ({
                    label: `${sub.name} (${sub.prefix})`,
                    onSelect: () => {
                      inspectRoutes({ kind: 'subnet', vnetId: vnet.id, subnetId: sub.id })
                    },
                  })),
                },
              ]
            : []),
          {
            label: 'Add Subnet to VNet',
            onSelect: () => {
              addSubnetToVnet(vnet.id)
              setActiveTab('editor')
            },
          },
          {
            label: `Change Azure Region (${vnet.region})`,
            children: ALL_KNOWN_AZURE_REGIONS.slice(0, 24).map((reg) => ({
              label: `${reg}${vnet.region === reg ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const v = draft.vnets.find((x) => x.id === vnet.id)
                  if (v) v.region = reg
                })
              },
            })),
          },
          {
            label: 'Add / Remove VNet Elements',
            children: [
              {
                label: '+ Add Azure Firewall',
                disabled: vnet.appliances.some((app) => app.kind === 'azure-firewall'),
                onSelect: () => addFirewallToVnet(vnet.id),
              },
              {
                label: '+ Add NVA',
                onSelect: () => openNvaCreation(vnet.id),
              },
              {
                label: 'Add Managed VNRA',
                onSelect: () => openVnraCreation(vnet.id),
              },
              ...(!hasErGw
                ? [
                    {
                      label: usesRemoteGw
                        ? '+ Add ExpressRoute Gateway (Disable useRemoteGateways first)'
                        : '+ Add ExpressRoute Gateway',
                      disabled: usesRemoteGw,
                      onSelect: () => addGatewayToVnet(vnet.id, 'ExpressRoute'),
                    },
                  ]
                : []),
              ...(!hasVpnGw
                ? [
                    {
                      label: usesRemoteGw
                        ? '+ Add VPN Gateway (Disable useRemoteGateways first)'
                        : '+ Add VPN Gateway',
                      disabled: usesRemoteGw,
                      onSelect: () => addGatewayToVnet(vnet.id, 'Vpn'),
                    },
                  ]
                : []),
              ...(!vnet.routeServer
                ? [
                    {
                      label: usesRemoteGw
                        ? '+ Add Azure Route Server (Disable useRemoteGateways first)'
                        : '+ Add Azure Route Server (ARS)',
                      disabled: usesRemoteGw,
                      onSelect: () => addRouteServerToVnet(vnet.id),
                    },
                  ]
                : [
                    {
                      label: 'Remove Azure Route Server (ARS)',
                      danger: true,
                      onSelect: () => removeRouteServerFromVnet(vnet.id),
                    },
                  ]),
              ...vnet.gateways.map((gw) => ({
                label: `Remove ${gw.kind} Gateway (${gw.name})`,
                danger: true,
                onSelect: () => removeGatewayFromVnet(vnet.id, gw.id),
              })),
              ...vnet.appliances.map((app) => ({
                label: `Remove Appliance (${app.name})`,
                danger: true,
                onSelect: () => removeApplianceFromVnet(vnet.id, app.id),
              })),
            ],
          },
          {
            label: 'Peer with VNet',
            previewPrimary: true,
            selectionAction: 'peer',
            guidanceAnchor: guidanceAnchor('peer-menu', vnet.id),
            disabled: peerableVnets.length === 0,
            children: peerableVnets.map((other) => ({
              guidanceAnchor: guidanceAnchor('peer-target', vnet.id, other.id),
              label: `${other.name} (${other.region})`,
              onSelect: () => {
                commitTopology((draft) => {
                  const vAHasGwOrArs = vnet.gateways.length > 0 || Boolean(vnet.routeServer?.enabled)
                  const vBHasGwOrArs = other.gateways.length > 0 || Boolean(other.routeServer?.enabled)
                  const isVnetHub = (vnet.role === 'hub' || vnet.role === 'hub-vnet') || vAHasGwOrArs
                  const isOtherHub = (other.role === 'hub' || other.role === 'hub-vnet') || vBHasGwOrArs
                  draft.vnetPeerings.push({
                    id: `peer-${vnet.id}-${other.id}`,
                    name: `${vnet.name}-to-${other.name}`,
                    vnetAId: vnet.id,
                    vnetBId: other.id,
                    enabled: true,
                    aToB: {
                      allowVirtualNetworkAccess: true,
                      allowForwardedTraffic: true,
                      allowGatewayTransit: isVnetHub,
                      useRemoteGateways: !vAHasGwOrArs && isOtherHub,
                    },
                    bToA: {
                      allowVirtualNetworkAccess: true,
                      allowForwardedTraffic: true,
                      allowGatewayTransit: isOtherHub,
                      useRemoteGateways: !vBHasGwOrArs && isVnetHub,
                    },
                  })
                })
              },
            })),
          },
          {
            label: 'Configure VNet & Elements',
            previewPrimary: true,
            selectionAction: 'configure',
            onSelect: () => {
              setSelected({ kind: 'vnet', vnetId: vnet.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete VNet',
            danger: true,
            onSelect: () => deleteVnetById(vnet.id),
          },
        ],
      }
    }

    if (target.kind === 'subnet') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const subnet = vnet?.subnets.find((s) => s.id === target.subnetId)
      if (!vnet || !subnet) return null
      const rt = subnet.routeTableId
        ? topology.udrTables.find((t) => t.id === subnet.routeTableId)
        : undefined
      return {
        title: `Subnet · ${vnet.name} / ${subnet.name}`,
        actions: [
          { label: t('Open VNet detail'), previewPrimary: true, onSelect: () => openDetail(vnet.id) },
          ...pathContextActions(endpointOptions.filter((e) => e.key === `subnet:${vnet.id}:${subnet.id}`)).map((action) => ({ ...action, previewPrimary: true })),
          {
            label: 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...',
            previewPrimary: true,
            selectionAction: 'configure',
            onSelect: () => {
              setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Inspect Subnet Effective Routes',
            previewPrimary: true,
            selectionAction: 'inspect',
            onSelect: () => {
              inspectRoutes({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
            },
          },
          {
            label: rt ? `Route Table (${rt.name})` : 'Associate Route Table',
            children: [
              {
                label: `+ Create & Associate New Route Table`,
                onSelect: () => createAndAssociateRouteTable(vnet.id, subnet.id),
              },
              ...(rt
                ? [
                    {
                      label: 'Detach Route Table (None)',
                      danger: true,
                      onSelect: () => {
                        commitTopology((draft) => {
                          const targetV = draft.vnets.find((v) => v.id === vnet.id)
                          const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                          if (targetS) targetS.routeTableId = undefined
                        })
                      },
                    },
                  ]
                : []),
              ...topology.udrTables.map((candidateRt) => ({
                label: `${candidateRt.name}${candidateRt.id === subnet.routeTableId ? ' (Associated)' : ''}`,
                disabled: !!udrAssociationError(topology, vnet, candidateRt),
                onSelect: () => {
                  commitTopology((draft) => {
                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                    const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                    if (targetS) targetS.routeTableId = candidateRt.id
                  })
                },
              })),
            ],
          },
          ...(rt
            ? [
                {
                  label: rt.disableBgpRoutePropagation
                    ? 'Enable GWroutes Propagation on Route Table'
                    : 'Disable GWroutes Propagation on Route Table (GWroutes:OFF)',
                  onSelect: () => {
                    commitTopology((draft) => {
                      const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                      if (targetRt) {
                        targetRt.disableBgpRoutePropagation = !targetRt.disableBgpRoutePropagation
                      }
                    })
                  },
                },
                {
                  label: rt.disablePeeringRoutePropagation
                    ? 'Enable Peering Route Propagation on Route Table'
                    : 'Disable Peering Route Propagation on Route Table',
                  onSelect: () => {
                    commitTopology((draft) => {
                      const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                      if (targetRt) {
                        targetRt.disablePeeringRoutePropagation =
                          !targetRt.disablePeeringRoutePropagation
                      }
                    })
                  },
                },
              ]
            : []),
          {
            label:
              subnet.defaultOutboundAccess === false
                ? 'Enable Default Outbound Access'
                : 'Disable Default Outbound Access (Private Subnet)',
            onSelect: () => {
              commitTopology((draft) => {
                const targetV = draft.vnets.find((v) => v.id === vnet.id)
                const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                if (targetS) {
                  targetS.defaultOutboundAccess = targetS.defaultOutboundAccess === false
                }
              })
            },
          },
          {
            label: 'Configure Route Table & Subnet Policies',
            onSelect: () => {
              setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete Subnet',
            danger: true,
            onSelect: () => deleteSubnetFromVnet(vnet.id, subnet.id),
          },
        ],
      }
    }

    if (target.kind === 'gateway') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const gw = vnet?.gateways.find((g) => g.id === target.gatewayId)
      if (!vnet || !gw) return null
      return {
        title: `Gateway · ${gw.name} (${gw.kind.toUpperCase()})`,
        actions: [
          ...(workspaceSession?.presentationPreview ? [{ label: t('Open VNet detail'), onSelect: () => openDetail(vnet.id) }] : []),
          {
            label: t('Inspect Gateway BGP table'),
            onSelect: () => {
              inspectRoutes({ kind: 'gateway', vnetId: vnet.id, gatewayId: gw.id })
            },
          },
          {
            label: 'Configure Gateway & Peerings',
            onSelect: () => {
              setSelected({ kind: 'gateway', vnetId: vnet.id, gatewayId: gw.id })
              setActiveTab('editor')
            },
          },
          {
            label: `Remove ${gw.kind} Gateway`,
            danger: true,
            onSelect: () => removeGatewayFromVnet(vnet.id, gw.id),
          },
        ],
      }
    }

    if (target.kind === 'route-server') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const ars = vnet?.routeServer
      if (!vnet || !ars) return null
      return {
        title: `Azure Route Server · ${ars.name}`,
        actions: [
          { label: 'Manage ARS Route Maps', onSelect: () => { setActiveTab(null); setRouteMapInspection(undefined); setRouteMapHubId(undefined); setRouteMapSiteId(undefined); setRouteMapArsId(ars.id) } },
          {
            label: t('Inspect Route Server BGP table (ASN 65515)'),
            onSelect: () => {
              inspectRoutes({ kind: 'route-server', vnetId: vnet.id, routeServerId: ars.id })
            },
          },
          {
            label: ars.branchToBranchTraffic
              ? 'Disable Branch-to-Branch Traffic'
              : 'Enable Branch-to-Branch Traffic',
            onSelect: () => {
              commitTopology((draft) => {
                const targetV = draft.vnets.find((v) => v.id === vnet.id)
                if (targetV?.routeServer) {
                  targetV.routeServer.branchToBranchTraffic =
                    !targetV.routeServer.branchToBranchTraffic
                }
              })
            },
          },
          {
            label: 'Set Routing Preference',
            children: (['ExpressRoute', 'VpnGateway', 'ASPath'] as const).map((pref) => ({
              label: `${pref}${ars.hubRoutingPreference === pref ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const targetV = draft.vnets.find((v) => v.id === vnet.id)
                  if (targetV?.routeServer) {
                    targetV.routeServer.hubRoutingPreference = pref
                  }
                })
              },
            })),
          },
          {
            label: 'Configure Route Server',
            onSelect: () => {
              setSelected({ kind: 'route-server', vnetId: vnet.id, routeServerId: ars.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Remove Azure Route Server',
            danger: true,
            onSelect: () => removeRouteServerFromVnet(vnet.id),
          },
        ],
      }
    }

    if (target.kind === 'appliance') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const app = vnet?.appliances.find((a) => a.id === target.applianceId)
      if (!vnet || !app) return null
      return {
        title: `Appliance · ${app.name} (${app.privateIp})`,
        actions: [
          ...(app.kind === 'nva-vm' ? [{
            label: t('Inspect NVA Learned BGP Routes'),
            onSelect: () => {
              setToolsDismissRequest((request) => request + 1)
              setActiveTab(null)
              setNvaBgpInspection({ vnetId: vnet.id, applianceId: app.id })
            },
          }] : []),
          {
            label: 'Inspect Appliance Subnet Effective Routes',
            onSelect: () => {
              inspectRoutes({ kind: 'appliance', vnetId: vnet.id, applianceId: app.id })
            },
          },
          ...(app.kind === 'vnra' ? [] : [{
            label: app.enableIpForwarding
              ? 'Disable NIC IP Forwarding'
              : 'Enable NIC IP Forwarding',
            onSelect: () => {
              commitTopology((draft) => {
                const targetV = draft.vnets.find((v) => v.id === vnet.id)
                const targetA = targetV?.appliances.find((a) => a.id === app.id)
                if (targetA) targetA.enableIpForwarding = !targetA.enableIpForwarding
              })
            },
          }]),
          {
            label: 'Configure Appliance',
            onSelect: () => {
              setSelected({ kind: 'appliance', vnetId: vnet.id, applianceId: app.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Remove Appliance',
            danger: true,
            onSelect: () => removeApplianceFromVnet(vnet.id, app.id),
          },
        ],
      }
    }

    if (target.kind === 'peering') {
      const peering = topology.vnetPeerings.find((p) => p.id === target.peeringId)
      if (!peering) return null
      const vA = topology.vnets.find((v) => v.id === peering.vnetAId)
      const vB = topology.vnets.find((v) => v.id === peering.vnetBId)
      return {
        title: `VNet Peering · ${vA?.name ?? peering.vnetAId} ↔ ${vB?.name ?? peering.vnetBId}`,
        actions: [
          {
            label: 'Configure Peering State & Flags',
            onSelect: () => {
              setSelected({ kind: 'peering', peeringId: peering.id })
              setActiveTab('editor')
            },
          },
          {
            label: peering.enabled ? 'Disable VNet Peering' : 'Enable VNet Peering',
            onSelect: () => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                if (p) p.enabled = !p.enabled
              })
            },
          },
          {
            label: `${vA?.name ?? 'VNet A'} → ${vB?.name ?? 'VNet B'} Flags`,
            children: (
              [
                ['allowVirtualNetworkAccess', 'Allow VNet Access'],
                ['allowForwardedTraffic', 'Allow Forwarded Traffic'],
                ['allowGatewayTransit', 'Allow Gateway Transit'],
                ['useRemoteGateways', 'Use Remote Gateways'],
              ] as const
            ).map(([flagKey, flagLabel]) => {
              const aHasGwOrArs = Boolean((vA?.gateways.length ?? 0) > 0 || vA?.routeServer)
              const bHasGwOrArs = Boolean((vB?.gateways.length ?? 0) > 0 || vB?.routeServer)
              const disabledReason =
                flagKey === 'allowGatewayTransit' && !aHasGwOrArs
                  ? `Requires VNet Gateway or Route Server in ${vA?.name ?? 'VNet A'}`
                  : flagKey === 'useRemoteGateways' && aHasGwOrArs
                    ? `Cannot enable Use Remote Gateways on ${vA?.name ?? 'VNet A'} while it hosts its own Gateway or Route Server`
                    : flagKey === 'useRemoteGateways' && !bHasGwOrArs
                      ? `Remote VNet ${vB?.name ?? 'VNet B'} has no Gateway or Route Server`
                      : flagKey === 'useRemoteGateways' && !peering.bToA.allowGatewayTransit
                        ? `Requires Allow Gateway Transit on ${vB?.name ?? 'VNet B'} → ${vA?.name ?? 'VNet A'}`
                        : null
              return {
                label: `${peering.aToB[flagKey] ? '✓ ' : ''}${flagLabel}${disabledReason && !peering.aToB[flagKey] ? ' (Unavailable)' : ''}`,
                disabled: Boolean(disabledReason && !peering.aToB[flagKey]),
                onSelect: () => {
                  if (disabledReason && !peering.aToB[flagKey]) return
                  commitTopology((draft) => {
                    const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                    if (p) {
                      p.aToB[flagKey] = !p.aToB[flagKey]
                      if (flagKey === 'allowGatewayTransit' && !p.aToB.allowGatewayTransit) {
                        p.bToA.useRemoteGateways = false
                      }
                    }
                  })
                },
              }
            }),
          },
          {
            label: `${vB?.name ?? 'VNet B'} → ${vA?.name ?? 'VNet A'} Flags`,
            children: (
              [
                ['allowVirtualNetworkAccess', 'Allow VNet Access'],
                ['allowForwardedTraffic', 'Allow Forwarded Traffic'],
                ['allowGatewayTransit', 'Allow Gateway Transit'],
                ['useRemoteGateways', 'Use Remote Gateways'],
              ] as const
            ).map(([flagKey, flagLabel]) => {
              const aHasGwOrArs = Boolean((vA?.gateways.length ?? 0) > 0 || vA?.routeServer)
              const bHasGwOrArs = Boolean((vB?.gateways.length ?? 0) > 0 || vB?.routeServer)
              const disabledReason =
                flagKey === 'allowGatewayTransit' && !bHasGwOrArs
                  ? `Requires VNet Gateway or Route Server in ${vB?.name ?? 'VNet B'}`
                  : flagKey === 'useRemoteGateways' && bHasGwOrArs
                    ? `Cannot enable Use Remote Gateways on ${vB?.name ?? 'VNet B'} while it hosts its own Gateway or Route Server`
                    : flagKey === 'useRemoteGateways' && !aHasGwOrArs
                      ? `Remote VNet ${vA?.name ?? 'VNet A'} has no Gateway or Route Server`
                      : flagKey === 'useRemoteGateways' && !peering.aToB.allowGatewayTransit
                        ? `Requires Allow Gateway Transit on ${vA?.name ?? 'VNet A'} → ${vB?.name ?? 'VNet B'}`
                        : null
              return {
                label: `${peering.bToA[flagKey] ? '✓ ' : ''}${flagLabel}${disabledReason && !peering.bToA[flagKey] ? ' (Unavailable)' : ''}`,
                disabled: Boolean(disabledReason && !peering.bToA[flagKey]),
                onSelect: () => {
                  if (disabledReason && !peering.bToA[flagKey]) return
                  commitTopology((draft) => {
                    const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                    if (p) {
                      p.bToA[flagKey] = !p.bToA[flagKey]
                      if (flagKey === 'allowGatewayTransit' && !p.bToA.allowGatewayTransit) {
                        p.aToB.useRemoteGateways = false
                      }
                    }
                  })
                },
              }
            }),
          },
          {
            label: 'Enable Forwarded Traffic (Both Directions)',
            onSelect: () => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                if (p) {
                  p.aToB.allowForwardedTraffic = true
                  p.bToA.allowForwardedTraffic = true
                }
              })
            },
          },
          {
            label: 'Delete VNet Peering',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.vnetPeerings = draft.vnetPeerings.filter((p) => p.id !== peering.id)
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'vwan-hub') {
      const hub = topology.vwanHubs.find((h) => h.id === target.hubId)
      if (!hub) return null
      return {
        title: `Virtual WAN Hub · ${hub.name}`,
        actions: [
          { label: t(hub.firewall ? 'Configure Azure Firewall' : 'Add Azure Firewall'), onSelect: () => openHubConnections(hub.id, true) },
          { label: t('Gateway capabilities (modeled)'), onSelect: () => setCapabilitiesHubId(hub.id) },
          {
            label: t('Connect to spoke'), allowDisabledChildren: true,
            children: topology.vnets.length ? topology.vnets.map((vnet) => ({
              label: vnet.vwanHubAttachment
                ? t('{0} (connected to {1})', vnet.name, topology.vwanHubs.find((entry) => entry.id === vnet.vwanHubAttachment!.hubId)?.name ?? vnet.vwanHubAttachment.hubId)
                : vnet.name,
              disabled: !!vnet.vwanHubAttachment && vnet.vwanHubAttachment.hubId !== hub.id,
              onSelect: () => { if (!vnet.vwanHubAttachment) attachVnetToHub(vnet.id, hub.id); openHubConnections(hub.id) },
            })) : [{ label: t('No VNets. Add a VNet first.'), disabled: true }],
          },
          {
            label: t('Edit Hub Route Maps'),
            onSelect: () => { setActiveTab(null); setRouteMapInspection(undefined); setRouteMapSiteId(undefined); setRouteMapArsId(undefined); setRouteMapHubId(hub.id) },
          },
          {
            label: t('Inspect Virtual WAN Hub BGP table'),
            onSelect: () => {
              inspectRoutes({ kind: 'vwan-hub', hubId: hub.id })
            },
          },
          {
            label: hub.routingIntent.private
              ? 'Disable Private Traffic Routing Intent'
              : 'Enable Private Traffic Routing Intent',
            onSelect: () => {
              commitTopology((draft) => {
                const h = draft.vwanHubs.find((x) => x.id === hub.id)
                if (h) h.routingIntent.private = !h.routingIntent.private
              })
            },
          },
          {
            label: hub.routingIntent.internet
              ? 'Disable Internet Traffic Routing Intent'
              : 'Enable Internet Traffic Routing Intent',
            onSelect: () => {
              commitTopology((draft) => {
                const h = draft.vwanHubs.find((x) => x.id === hub.id)
                if (h) h.routingIntent.internet = !h.routingIntent.internet
              })
            },
          },
          {
            label: 'Set Hub Routing Preference',
            children: (['ExpressRoute', 'VPN', 'ASPath'] as const).map((pref) => ({
              label: `${pref}${hub.preference === pref ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const h = draft.vwanHubs.find((x) => x.id === hub.id)
                  if (h) h.preference = pref
                })
              },
            })),
          },
          {
            label: 'Configure Hub & Labels',
            onSelect: () => openHubConnections(hub.id),
          },
          {
            label: 'Delete Virtual WAN Hub',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.vwanHubs = draft.vwanHubs.filter((h) => h.id !== hub.id)
                draft.erLinks = draft.erLinks.filter((l) => !(l.targetKind === 'vwan-hub' && l.targetId === hub.id))
                draft.vpnConnections = draft.vpnConnections.filter((c) => !(c.targetKind === 'vwan-hub' && c.targetId === hub.id))
                for (const vnet of draft.vnets) {
                  if (vnet.vwanHubAttachment?.hubId === hub.id) vnet.vwanHubAttachment = undefined
                }
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'er-global-reach-link') {
      const gr = (topology.erGlobalReachLinks ?? []).find((l) => l.id === target.linkId)
      if (!gr) return null
      const locA = topology.erLocations.find((l) => l.id === gr.locationAId)
      const locB = topology.erLocations.find((l) => l.id === gr.locationBId)
      return {
        title: `ExpressRoute Global Reach · ${locA?.name ?? gr.locationAId} ↔ ${locB?.name ?? gr.locationBId}`,
        actions: [
          {
            label: gr.enabled ? 'Disable Global Reach Link' : 'Enable Global Reach Link',
            onSelect: () => {
              commitTopology((draft) => {
                const l = (draft.erGlobalReachLinks ?? []).find((x) => x.id === gr.id)
                if (l) l.enabled = !l.enabled
              })
            },
          },
          {
            label: 'Delete Global Reach Link',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.erGlobalReachLinks = (draft.erGlobalReachLinks ?? []).filter(
                  (x) => x.id !== gr.id,
                )
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'er-location') {
      const loc = topology.erLocations.find((l) => l.id === target.locationId)
      if (!loc) return null
      const currentSku: AzErCircuitSku = loc.sku ?? 'Standard'
      return {
        title: `ER location · ${loc.name} (${currentSku})`,
        actions: [
          {
            label: 'Show ER Location Info & Providers...',
            onSelect: () => {
              setErLocationModalState({
                open: true,
                hasOpened: true,
                targetLocationId: loc.id,
                locationName: loc.peeringLocation ?? loc.name,
                sku: currentSku,
              })
            },
          },
          {
            label: t('Inspect ExpressRoute Location BGP table'),
            onSelect: () => {
              inspectRoutes({ kind: 'er-location', locationId: loc.id })
            },
          },
          {
            label: 'Set Circuit SKU (Local / Standard / Premium)',
            children: (['Local', 'Standard', 'Premium'] as const).map((skuOption) => ({
              label: `${currentSku === skuOption ? '✓ ' : ''}ER ${skuOption}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const l = draft.erLocations.find((x) => x.id === loc.id)
                  if (l) l.sku = skuOption
                })
              },
            })),
          },
          {
            label: loc.globalReachEnabled
              ? 'Disable ExpressRoute Global Reach (Intra-Location)'
              : 'Enable ExpressRoute Global Reach (Intra-Location)',
            onSelect: () => {
              commitTopology((draft) => {
                const l = draft.erLocations.find((x) => x.id === loc.id)
                if (l) l.globalReachEnabled = !l.globalReachEnabled
              })
            },
          },
          {
            label: 'Configure ER Location & Labels',
            onSelect: () => {
              setSelected({ kind: 'er-location', locationId: loc.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Establish ExpressRoute Global Reach to...',
            children: topology.erLocations
              .filter(
                (other) =>
                  other.id !== loc.id &&
                  !(topology.erGlobalReachLinks ?? []).some(
                    (gr) =>
                      (gr.locationAId === loc.id && gr.locationBId === other.id) ||
                      (gr.locationAId === other.id && gr.locationBId === loc.id),
                  ),
              )
              .map((other) => ({
                label: `ER location: ${other.name}`,
                onSelect: () => {
                  commitTopology((draft) => {
                    draft.erGlobalReachLinks = draft.erGlobalReachLinks ?? []
                    draft.erGlobalReachLinks.push({
                      id: `ergr-${loc.id}-${other.id}-${Date.now().toString(36).slice(-3)}`,
                      name: `${loc.name}-gr-${other.name}`,
                      locationAId: loc.id,
                      locationBId: other.id,
                      enabled: true,
                    })
                  })
                },
              })),
          },
          {
            label: 'Connect ExpressRoute to...',
            children: [
              ...topology.sites
                .filter(
                  (site) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'site' &&
                        l.targetId === site.id,
                    ),
                )
                .map((site) => ({
                  label: `Site: ${site.name} (ASN ${site.asn})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${site.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${site.name}`,
                        locationId: loc.id,
                        targetKind: 'site',
                        targetId: site.id,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vnets
                .flatMap((v) =>
                  v.gateways
                    .filter((g) => g.kind === 'ExpressRoute')
                    .map((g) => ({ vnet: v, gw: g })),
                )
                .filter(
                  ({ gw }) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'vnet-gateway' &&
                        l.targetId === gw.id,
                    ),
                )
                .map(({ vnet, gw }) => ({
                  label: `VNet ER Gateway: ${vnet.name} (${gw.name})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${gw.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${gw.name}`,
                        locationId: loc.id,
                        targetKind: 'vnet-gateway',
                        targetId: gw.id,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vwanHubs
                .filter(
                  (hub) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'vwan-hub' &&
                        l.targetId === hub.id,
                    ),
                )
                .map((hub) => ({
                  label: `vWAN Hub: ${hub.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${hub.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${hub.name}`,
                        locationId: loc.id,
                        targetKind: 'vwan-hub',
                        targetId: hub.id,
                        enabled: true,
                      })
                    })
                  },
                })),
            ],
          },
          {
            label: 'Delete ExpressRoute Location',
            danger: true,
            onSelect: () => deleteErLocationById(loc.id),
          },
        ],
      }
    }

    if (target.kind === 'site') {
      const site = topology.sites.find((s) => s.id === target.siteId)
      if (!site) return null
      return {
        title: `On-Premises Site · ${site.name} (ASN ${site.asn})`,
        actions: [
          { label: 'Manage Site Route Maps', onSelect: () => { setActiveTab(null); setRouteMapInspection(undefined); setRouteMapHubId(undefined); setRouteMapArsId(undefined); setRouteMapSiteId(site.id) } },
          ...pathContextActions(endpointOptions.filter((e) => e.ref.kind === 'site' && e.ref.siteId === site.id)),
          {
            label: 'Inspect Site BGP Route Table',
            onSelect: () => {
              inspectRoutes({ kind: 'site', siteId: site.id })
            },
          },
          {
            label: 'Connect Site to...',
            children: [
              ...topology.erLocations
                .filter(
                  (loc) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'site' &&
                        l.targetId === site.id,
                    ),
                )
                .map((loc) => ({
                  label: `ExpressRoute location: ${loc.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${site.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${site.name}`,
                        locationId: loc.id,
                        targetKind: 'site',
                        targetId: site.id,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vnets
                .flatMap((v) =>
                  v.gateways
                    .filter((g) => g.kind === 'Vpn')
                    .map((g) => ({ vnet: v, gw: g })),
                )
                .filter(
                  ({ gw }) =>
                    !topology.vpnConnections.some(
                      (c) =>
                        c.siteId === site.id &&
                        c.targetKind === 'vnet-gateway' &&
                        c.targetId === gw.id,
                    ),
                )
                .map(({ vnet, gw }) => ({
                  label: `S2S VPN to VNet GW: ${vnet.name} (${gw.name})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.vpnConnections.push({
                        id: `vpn-${site.id}-${gw.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${site.name}-to-${gw.name}`,
                        siteId: site.id,
                        targetKind: 'vnet-gateway',
                        targetId: gw.id,
                        bgpEnabled: true,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vnets
                .flatMap((v) => v.appliances.map((a) => ({ vnet: v, app: a })))
                .filter(
                  ({ app }) =>
                    !topology.vpnConnections.some(
                      (c) =>
                        c.siteId === site.id &&
                        c.targetKind === 'appliance' &&
                        c.targetId === app.id,
                    ),
                )
                .map(({ vnet, app }) => ({
                  label: `S2S VPN to NVA/Firewall: ${vnet.name} (${app.name})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.vpnConnections.push({
                        id: `vpn-${site.id}-${app.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${site.name}-to-${app.name}`,
                        siteId: site.id,
                        targetKind: 'appliance',
                        targetId: app.id,
                        bgpEnabled: Boolean(app.bgpEnabled),
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vwanHubs.flatMap((hub) => (['VPN', 'SDWAN'] as const)
                .filter((transport) => !topology.vpnConnections.some((connection) => connection.siteId === site.id
                  && connection.targetKind === 'vwan-hub' && connection.targetId === hub.id && (connection.transport ?? 'VPN') === transport))
                .map((transport) => ({
                  label: `${transport === 'SDWAN' ? 'SD-WAN' : 'S2S VPN'} to vWAN Hub: ${hub.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.vpnConnections.push({
                        id: crypto.randomUUID(),
                        name: `${site.name}-to-${hub.name}`,
                        siteId: site.id,
                        targetKind: 'vwan-hub',
                        targetId: hub.id,
                        bgpEnabled: true,
                        enabled: true,
                        transport,
                        propagateDefaultRoute: true,
                      })
                    })
                  },
                }))),
              ...topology.sites
                .filter(
                  (other) =>
                    other.id !== site.id &&
                    !topology.siteLinks.some(
                      (l) =>
                        (l.siteAId === site.id && l.siteBId === other.id) ||
                        (l.siteAId === other.id && l.siteBId === site.id),
                    ),
                )
                .map((other) => ({
                  label: `Site-to-Site WAN Link: ${other.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.siteLinks.push({
                        id: `sitelink-${site.id}-${other.id}`,
                        name: `${site.name}-to-${other.name}`,
                        siteAId: site.id,
                        siteBId: other.id,
                        enabled: true,
                      })
                    })
                  },
                })),
            ],
          },
          {
            label: 'Configure Site & Labels',
            onSelect: () => {
              setSelected({ kind: 'site', siteId: site.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete On-Premises Site',
            danger: true,
            onSelect: () => deleteSiteById(site.id),
          },
        ],
      }
    }

    if (target.kind === 'er-link') {
      const link = topology.erLinks.find((l) => l.id === target.linkId)
      if (!link) return null
      const loc = topology.erLocations.find((l) => l.id === link.locationId)
      const label = link.targetKind === 'site' ? 'ExpressRoute Link' : 'ER connection'
      return {
        title: `${label} · ${link.name}`,
        actions: [
          {
            label: `${link.enabled ? 'Disable' : 'Enable'} ${label}`,
            onSelect: () => {
              commitTopology((draft) => {
                const l = draft.erLinks.find((x) => x.id === link.id)
                if (l) l.enabled = !l.enabled
              })
            },
          },
          {
            label: 'Set Routing Weight',
            children: [0, 10, 50, 100, 200].map((w) => ({
              label: `Weight ${w}${(link.weight ?? 0) === w ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const l = draft.erLinks.find((x) => x.id === link.id)
                  if (l) l.weight = w || undefined
                })
              },
            })),
          },
          {
            label: `Configure ${label} (${loc?.name ?? link.locationId})`,
            onSelect: () => {
              setSelected({ kind: 'er-link', linkId: link.id })
              setActiveTab('editor')
            },
          },
          {
            label: `Delete ${label}`,
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.erLinks = draft.erLinks.filter((l) => l.id !== link.id)
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'vpn-connection') {
      const conn = topology.vpnConnections.find((c) => c.id === target.connectionId)
      if (!conn) return null
      return {
        title: `${conn.transport === 'SDWAN' ? 'SD-WAN' : 'S2S VPN'} Connection · ${conn.name}`,
        actions: [
          {
            label: conn.enabled ? 'Disable VPN Connection' : 'Enable VPN Connection',
            onSelect: () => {
              commitTopology((draft) => {
                const c = draft.vpnConnections.find((x) => x.id === conn.id)
                if (c) c.enabled = !c.enabled
              })
            },
          },
          {
            label: conn.bgpEnabled ? 'Switch to Static Routing (BGP Off)' : 'Enable BGP on VPN Connection',
            disabled: conn.transport === 'SDWAN',
            onSelect: () => {
              commitTopology((draft) => {
                const c = draft.vpnConnections.find((x) => x.id === conn.id)
                if (c && c.transport !== 'SDWAN') c.bgpEnabled = !c.bgpEnabled
              })
            },
          },
          {
            label: 'Configure VPN Connection',
            onSelect: () => {
              setSelected({ kind: 'vpn-connection', connectionId: conn.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete VPN Connection',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.vpnConnections = draft.vpnConnections.filter((c) => c.id !== conn.id)
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'site-link') {
      const sLink = topology.siteLinks.find((l) => l.id === target.siteLinkId)
      if (!sLink) return null
      return {
        title: `Site-to-Site Link · ${sLink.name}`,
        actions: [
          {
            label: sLink.enabled ? 'Disable Site-to-Site Link' : 'Enable Site-to-Site Link',
            onSelect: () => {
              commitTopology((draft) => {
                const l = draft.siteLinks.find((x) => x.id === sLink.id)
                if (l) l.enabled = !l.enabled
              })
            },
          },
          {
            label: 'Delete Site-to-Site Link',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.siteLinks = draft.siteLinks.filter((l) => l.id !== sLink.id)
              })
            },
          },
        ],
      }
    }

    return null
  }
  const entityId = (target: AzSelectedEntity) => 'vnetId' in target ? target.vnetId
    : 'siteId' in target ? target.siteId : 'hubId' in target ? target.hubId
      : 'locationId' in target ? target.locationId : 'linkId' in target ? target.linkId
        : 'peeringId' in target ? target.peeringId : 'connectionId' in target ? target.connectionId : target.siteLinkId
  const bgpResourceFor = (target?: AzSelectedEntity): import('../bgp-neighbors').BgpResourceRef | undefined =>
    target?.kind === 'gateway' ? { kind: 'gateway', id: target.gatewayId }
      : target?.kind === 'route-server' ? { kind: 'route-server', id: target.routeServerId }
        : target?.kind === 'site' ? { kind: 'site', id: target.siteId }
          : target?.kind === 'er-location' ? { kind: 'er-location', id: target.locationId }
            : target?.kind === 'vwan-hub' ? { kind: 'vwan-hub', id: target.hubId }
              : target?.kind === 'appliance' && topology.vnets.find((vnet) => vnet.id === target.vnetId)?.appliances.some((app) => app.id === target.applianceId && app.kind === 'nva-vm')
                ? { kind: 'appliance', id: target.applianceId } : undefined
  const openBgpNeighbors = (target?: AzSelectedEntity) => {
    setActiveTab(null)
    setToolsDismissRequest((request) => request + 1)
    setBgpInspection((previous) => ({ resource: bgpResourceFor(target), revision: (previous?.revision ?? 0) + 1 }))
  }
  const getContextMenuSpec = (target: AzSelectedEntity | { kind: 'canvas'; svgX: number; svgY: number }, fullActions = false): { title: string; actions: ContextAction[] } | null => {
    if (target.kind === 'canvas') return getOrdinaryContextMenuSpec(target)
    const id = entityId(target)
    const applicable = scenario.affected[id] ?? []
    if (applicable.length) return { title: 'Simulated failure — restore only', actions: applicable.map((fault) => ({
      label: `Restore ${failureLabel(fault)}`, onSelect: () => restoreFault(fault),
    })) }
    const ordinary = getOrdinaryContextMenuSpec(target)
    let presented = ordinary ? [
      ...(bgpResourceFor(target) ? [{ label: t('BGP neighbors'), onSelect: () => openBgpNeighbors(target) }] : []),
      ...ordinary.actions,
    ] : []
    if (ordinary && workspaceSession?.presentationPreview && !fullActions) {
      if (target.kind === 'vnet') presented = previewVnetActions(ordinary.actions, () => setToolsOpenRequest((request) => request + 1))
      if (target.kind === 'subnet') presented = previewSubnetActions(ordinary.actions)
    }
    const domain = failureDomains.find((f) =>
      (f.kind === 'site' && target.kind === 'site' || f.kind === 'er-location' && target.kind === 'er-location') && f.id === id ||
      f.kind === 'region' && ['vnet', 'subnet', 'gateway', 'route-server', 'appliance', 'vwan-hub'].includes(target.kind) &&
        f.id === regionKey([...topology.vnets, ...topology.vwanHubs].find((n) => n.id === id)?.region))
    return ordinary && { ...ordinary, actions: [...(domain ? [{ label: `Simulate failure of ${failureLabel(domain)}`, onSelect: () => addFault(domain) }]
      : ['vnet', 'subnet', 'gateway', 'route-server', 'appliance', 'vwan-hub'].includes(target.kind) ? [{ label: 'Azure region failure unassessed — set an explicit recognized region', disabled: true }] : []), ...presented] }
  }
  const openRouteMapRules = (selection: AzRouteMapSelection) => {
    setActiveTab(null)
    setRouteMapHubId(selection.owner.kind === 'vwan-hub' ? selection.owner.hubId : undefined)
    setCanvasSelection(selection.owner)
    setRouteMapInspection(selection)
    setRouteMapSiteId(selection.owner.kind === 'site' ? selection.owner.siteId : undefined)
    setRouteMapArsId(selection.owner.kind === 'route-server' ? selection.owner.routeServerId : undefined)
  }
  const ordinaryContextMenuSpec = contextMenu && getContextMenuSpec(
    contextMenu.kind === 'canvas' ? contextMenu : contextMenu.entity,
  )
  const policyContext = contextMenu?.kind === 'entity' ? contextMenu.routeMap : undefined
  const contextMenuSpec = ordinaryContextMenuSpec && policyContext ? {
    ...ordinaryContextMenuSpec,
    actions: [{ label: 'Show route map rules', onSelect: () => openRouteMapRules(policyContext) }, ...ordinaryContextMenuSpec.actions],
  } : ordinaryContextMenuSpec
  const deletionSpec = deleteTarget && getContextMenuSpec(deleteTarget)
  const deletionAction = deletionSpec?.actions.find((action) => action.danger && !action.disabled && action.onSelect)
  useDeleteShortcut(canvasSelection && !deletionAction && !sampleGalleryOpen && !erLocationModalState.open ? () => {
    const spec = getContextMenuSpec(canvasSelection)
    if (!spec?.actions.some((action) => action.danger && !action.disabled && action.onSelect)) return
    setContextMenu(null)
    setDeleteTarget(canvasSelection)
  } : undefined)

  const detailEntity = (target: DetailTarget): AzSelectedEntity => {
    const vnetId = detailOwner!
    return target.kind === 'network' ? { kind: 'vnet', vnetId }
      : target.kind === 'subnet' ? { kind: 'subnet', vnetId, subnetId: target.id }
        : target.kind === 'appliance' ? { kind: 'appliance', vnetId, applianceId: target.id }
          : target.kind === 'gateway' ? { kind: 'gateway', vnetId, gatewayId: target.id }
            : target.kind === 'site' ? { kind: 'site', siteId: target.id }
              : { kind: 'route-server', vnetId, routeServerId: target.id }
  }
  return (
    <div ref={guidanceRoot} className="aznet-app" data-testid="aznet-app" data-learning-scope="azure-net" data-inventory-selection={inventorySelection}>
      {snatHubId && <Suspense fallback={null}><RouterSnatDialog topology={topology} owner={{ kind: 'hub', id: snatHubId }}
        name={topology.vwanHubs.find((hub) => hub.id === snatHubId)?.name ?? snatHubId}
        commit={(mutate) => commitTopology((next) => mutate(next))} onClose={() => setSnatHubId(undefined)} /></Suspense>}
      {detailOwner && <Suspense fallback={null}><NetworkDetail topology={topology} owner={{ kind: 'vnet', id: detailOwner }} simulation={simulation} returnFocus={detailReturnFocus}
        initialLoadBalancerId={detailLoadBalancer}
        selectedId={inventorySelection} onSelect={setInventorySelection} commit={(mutate) => commitTopology((next) => mutate(next))}
        selectedTargetId={canvasSelection && ('subnetId' in canvasSelection ? canvasSelection.subnetId
          : 'applianceId' in canvasSelection ? canvasSelection.applianceId : 'gatewayId' in canvasSelection ? canvasSelection.gatewayId
            : 'routeServerId' in canvasSelection ? canvasSelection.routeServerId : entityId(canvasSelection))}
        onSelectTarget={(target) => selectCanvasObject(detailEntity(target))}
        getContextActions={(target) => {
          const entity = detailEntity(target)
          return (getContextMenuSpec(entity, true)?.actions ?? []).map(function wrap(action): ContextAction {
            return { ...action, children: action.children?.map(wrap), ...(action.onSelect || action.run ? { onSelect: () => {
              setCanvasSelection(entity)
              ;(action.run ?? action.onSelect)?.()
            }, run: undefined } : {}) }
          })
        }}
        onApplianceAction={(vnetId, applianceId, action) => {
          const entity = { kind: 'appliance' as const, vnetId, applianceId }
          setCanvasSelection(entity)
          getContextMenuSpec(entity)?.actions.find((entry) => entry.label === (action === 'routes' ? 'Inspect Appliance Subnet Effective Routes' : 'Configure Appliance'))?.onSelect?.()
        }}
        boundaries={[
          ...(singleFlowForCustomIp ?? pairAnalysis?.forward ? [{ direction: 'forward' as const,
            destination: (singleFlowForCustomIp ?? pairAnalysis!.forward)!.destinationIp,
            evidence: (singleFlowForCustomIp ?? pairAnalysis!.forward)!.summaryReason,
            subnetIds: (singleFlowForCustomIp ?? pairAnalysis!.forward)!.hops.flatMap((hop) => hop.subnetId ? [hop.subnetId] : []) }] : []),
          ...(!singleFlowForCustomIp && pairAnalysis?.reverse ? [{ direction: 'reply' as const, destination: pairAnalysis.reverse.destinationIp,
            evidence: pairAnalysis.reverse.summaryReason, subnetIds: pairAnalysis.reverse.hops.flatMap((hop) => hop.subnetId ? [hop.subnetId] : []) }] : []),
        ]}
        onClose={() => { setDetailOwner(undefined); setDetailReturnFocus(null); setDetailLoadBalancer(undefined) }} /></Suspense>}
      {!recoveryAcknowledged && <div role="alert" data-testid="aznet-recovery-notice">
        <strong>Saved input could not be loaded. Originals have not been overwritten.</strong>
        {recoveryEntries.map((entry, index) => <div key={index}>
          {entry.source}: {entry.message}
          {entry.raw && <button type="button" onClick={() => downloadAzText(entry.raw, `aznet-recovery-${index}.json`)}>Export original {entry.source}</button>}
        </div>)}
        <button type="button" onClick={() => setRecoveryAcknowledged(true)}>Acknowledge recovery and enable saving</button>
      </div>}
      {saveError && <div role="alert" data-testid="aznet-save-error">{saveError}</div>}
      {workspaceNotice && <div role="alert" data-testid="aznet-workspace-notice">{workspaceNotice}
        <button type="button" onClick={() => setWorkspaceNotice('')}>Dismiss</button>
      </div>}
      <FailurePanel faults={faults} unassessed={unassessedFailures} onRestore={restoreFault} onRestoreAll={() => setFaults([])}
        revision={baselineRevision} onReport={(report) => setResilience({ revision: baselineRevision, report })} focusEndpoint={resilience?.revision === baselineRevision ? resilienceEndpoint : undefined} onSimulate={addFault}
        presentReport={(report) => azDisplayResult(report, displayNames)}
        analyze={async () => {
          const { analyzeAzResilience } = await import('../failure-analysis')
          return measureAzWork('resilience', () => analyzeAzResilience(routingTopology, {}, validationErrors))
        }} />
      {/* Top Navigation & Actions Bar */}
      <header
        className={`aznet-topbar ${
          simulatorMode === 'hub-spoke' ? 'aznet-topbar-hubspoke' : 'aznet-topbar-full'
        }`}
      >
        <div className="unified-topbar-left">
          <div className="aznet-brand unified-brand">
            <div className="aznet-brand-icon" aria-hidden="true">
              AzNetSim
            </div>
            <h1>Azure Network Simulator</h1>
          </div>

          <WorkspaceMenu />
          <button type="button" className="aznet-btn" data-testid="workspace-azure-button" onClick={() => setActiveTab('azure')}>{t('Azure')}</button>
        </div>

        <div className="aznet-topbar-controls">
          {canvasSelection && 'vnetId' in canvasSelection && <button type="button" className="aznet-btn"
            onClick={() => openDetail(canvasSelection.vnetId)}>{t('VNet detail')}</button>}
          <WorkspaceTools openRequest={toolsOpenRequest} dismissRequest={guidanceRevision + toolsDismissRequest}
            resourceActions={[{ label: t('Route-table library'), testId: 'aznet-route-table-library-btn', run: () => {
              setToolsDismissRequest((request) => request + 1); setUdrManager({})
            } }]} creationActions={[
            { label: t('+ VNet'), testId: 'aznet-add-vnet-btn', run: addDefaultVnet },
            { label: t('+ Site'), testId: 'aznet-add-site-btn', run: () => addSiteNode() },
            { label: t('+ ER location'), testId: 'aznet-add-erloc-btn', run: () => addErLocationNode() },
            { label: t('+ Route Table'), testId: 'aznet-add-rt-topbar-btn', run: () => createAndAssociateRouteTable() },
            ...(simulatorMode === 'full' ? [{ label: t('+ Virtual WAN hub'), testId: 'aznet-add-vwan-hub-btn', run: () => addVwanHub() }] : []),
          ]} getSelection={() => {
            if (!canvasSelection) return
            const spec = getContextMenuSpec(canvasSelection, true)
            const deletion = spec?.actions.find((action) => action.danger && !action.disabled && action.onSelect)
            return spec && { ...spec, actions: spec.actions.map((action) => action === deletion
              ? { ...action, onSelect: () => setDeleteTarget(canvasSelection) } : action) }
          }} inventory={{
            getObjects: () => azWorkspaceObjects(topology),
            selected: canvasSelection ? azWorkspaceIdentity(canvasSelection) : undefined,
            onSelect: selectCanvasObject,
          }} />
          <LearningTools key={simulatorMode} document={{ mode: simulatorMode === 'hub-spoke' ? 'hub-spoke' : 'full', topology }}
            onGuide={(cue) => {
              if (resolveGuidance({ mode: 'full', topology }, cue).reason) return
              setContextMenu(null)
              if (cue.action === 'connection.configure') {
                if (!setSelected(cue.params.kind === 'er-link' ? { kind: 'er-link', linkId: cue.params.connectionId }
                  : { kind: 'vpn-connection', connectionId: cue.params.connectionId })) return
                setActiveTab('editor')
              } else if (cue.action === 'site-routes.open') {
                if (!inspectRoutes({ kind: 'site', siteId: cue.params.siteId })) return
              } else if (cue.action === 'gateway-routes.open') {
                if (!inspectRoutes({ kind: 'gateway', vnetId: cue.params.vnetId, gatewayId: cue.params.gatewayId })) return
              } else if (cue.action === 'er-routes.open') {
                if (!inspectRoutes({ kind: 'er-location', locationId: cue.params.locationId })) return
              } else if (cue.action === 'packet-probe.open') {
                openDetail(cue.params.vnetId)
              } else if (cue.action === 'load-balancer.configure') {
                openDetail(cue.params.vnetId)
                setDetailLoadBalancer(cue.params.loadBalancerId)
              } else if (cue.action === 'hub.configure') {
                if (!setSelected({ kind: 'vwan-hub', hubId: cue.params.hubId })) return
                setActiveTab('editor')
              } else if (cue.action === 'hub-routes.open') {
                if (!inspectRoutes({ kind: 'vwan-hub', hubId: cue.params.hubId })) return
                setHubTableInspection({ ...cue.params })
              } else if (cue.action === 'peering.configure') {
                if (!setSelected({ kind: 'peering', peeringId: cue.params.peeringId })) return
                setActiveTab('editor')
              } else if (cue.action === 'network.configure') {
                if (!setSelected({ kind: 'vnet', vnetId: cue.params.vnetId })) return
                setActiveTab('editor')
                setFrameRequest({ vnetId: cue.params.vnetId, revision: guidanceRevision + 1 })
              } else if (cue.action === 'peering.command') {
                const entity = { kind: 'vnet' as const, vnetId: cue.params.vnetAId }
                if (!setSelected(entity)) return
                setActiveTab(null)
                setContextReturnFocus(null)
                const bounds = guidanceRoot.current?.querySelector('[data-learning-canvas]')?.getBoundingClientRect()
                setContextMenu({ kind: 'entity', entity, x: (bounds?.left ?? 0) + 60, y: (bounds?.top ?? 0) + 60 })
                setFrameRequest({ vnetId: cue.params.vnetAId, revision: guidanceRevision + 1 })
              } else {
                const entity = { kind: 'subnet' as const, vnetId: cue.params.vnetId, subnetId: cue.params.subnetId }
                if (cue.action === 'routes.open') { if (!inspectRoutes(entity)) return }
                else { if (!setSelected(entity)) return; setActiveTab('editor') }
                setFrameRequest({ vnetId: cue.params.vnetId, revision: guidanceRevision + 1 })
              }
              setGuidanceRevision((revision) => revision + 1)
              setGuidanceNavigation(true)
            }} />
          <PresentationGroup label={t('Explore')}>
          <button
            type="button"
            className="aznet-btn aznet-btn-gallery"
            data-testid="aznet-open-sample-gallery-btn"
            onClick={() => setSampleGalleryOpen(true)}
            title="Browse built-in Azure VNet & Hybrid sample topologies"
          >
            {t('Sample topologies')}
          </button>

          <button
            type="button"
            className="aznet-btn"
            data-testid="aznet-open-er-locations-btn"
            onClick={() =>
              setErLocationModalState({
                open: true,
                hasOpened: true,
                locationName: topology.erLocations[0]?.peeringLocation ?? topology.erLocations[0]?.name,
                sku: topology.erLocations[0]?.sku ?? 'Standard',
                targetLocationId: topology.erLocations[0]?.id,
              })
            }
            title="Inspect Microsoft ExpressRoute Peering Locations, Providers & SKU Regional Reachability"
          >
            🌍 ER Locations
          </button>

          <label style={{ fontSize: 12, color: 'var(--text-muted)' }} htmlFor="aznet-sample-select">
            Sample Topology:
          </label>
          <select
            id="aznet-sample-select"
            data-testid="aznet-sample-select"
            className="aznet-select aznet-sample-select"
            title={currentSampleMeta?.title ?? (sampleId === 'shared-topology' ? 'Shared URL Topology' : 'No sample loaded (Custom / Blank)')}
            value={sampleId}
            onChange={(e) => loadSample(e.target.value)}
          >
            <option value="">— No sample loaded (Custom / Blank) —</option>
            {sampleId === 'shared-topology' && (
              <option value="shared-topology">🔗 Shared URL Topology</option>
            )}
            {(['flagship', 'validation'] as const).map((category) =>
              <optgroup key={category} label={t(category === 'flagship' ? 'Reference topologies' : 'Validation scenarios')}>
                {visibleCatalogEntries.filter((s) => s.category === category).map((s) =>
                  <option key={s.id} value={s.id}>{t(s.title)}</option>)}
              </optgroup>)}
          </select>
          </PresentationGroup>

          <button
            type="button"
            onClick={handleUndo}
            disabled={!history.length}
            title={t('Undo')}
            aria-label={workspaceSession?.presentationPreview ? t('Undo') : '↶ Undo'}
            className="aznet-btn workspace-history-action"
          >
            <span aria-hidden="true">↶</span><span className="workspace-history-label"> {workspaceSession?.presentationPreview ? t('Undo') : 'Undo'}</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!future.length}
            title={t('Redo')}
            aria-label={workspaceSession?.presentationPreview ? t('Redo') : '↷ Redo'}
            className="aznet-btn workspace-history-action"
          >
            <span aria-hidden="true">↷</span><span className="workspace-history-label"> {workspaceSession?.presentationPreview ? t('Redo') : 'Redo'}</span>
          </button>

          <PresentationGroup label={t('Checks')} title={t('Routing checks')}>
          <button
            type="button"
            className={`aznet-btn${workspaceSession?.presentationPreview ? '' : ' aznet-btn-primary'}`}
            data-testid="aznet-check-routing-btn"
            onClick={checkRouting}
            title={t('Check connectivity across the modeled landscape')}
          >
            {t('Check routing')}
          </button>
          <button
            type="button"
            className="aznet-btn"
            data-testid="aznet-run-diagnostics-btn"
            title={t('Inspect findings and assess declared connectivity requirements')}
            onClick={() => {
              setShowDiagnosticBadges(true)
              setReviewFindingIds(null)
              setActiveTab('diagnostics')
            }}
          >
            {t('Advanced checks')} ({actionableCount})
          </button>
          </PresentationGroup>

          <PresentationGroup label={t('File')}>
          <button
            type="button"
            className="aznet-btn"
            data-testid="aznet-open-azure-tab-btn"
            onClick={() => setActiveTab('azure')}
          >
            ☁ Azure & Bicep
          </button>

          <button
            type="button"
            className="aznet-btn"
            data-testid="aznet-share-url-btn"
            disabled={!!window.desktopSimulator}
            onClick={handleShareUrl}
            title={language === 'ja' ? 'クラウドの保存から取り消し可能な 30 日間のリンクを作成します。' : 'Create a revocable 30-day link from a cloud save. Unsaved edits are not shared.'}
          >
            {language === 'ja' ? 'クラウドの保存を共有' : 'Share cloud save'}
          </button>

          <DocumentActions />
          <button type="button" className="aznet-btn" data-testid="aznet-clear-topology-btn"
            onClick={() => setClearRequested(true)} title={t('Clear canvas to an empty topology')}>{t('Clear')}</button>
          </PresentationGroup>
          {!workspaceSession?.presentationPreview && <PresentationToggle />}
          <input
            data-desktop-import
            ref={fileInputRef}
            aria-label={t('Import topology file')}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const request = ++sampleRequest.current
              try {
                if (file.size > AZNET_MAX_JSON_LENGTH) throw new Error('JSON exceeds 4 MB limit.')
                const workspaceRequest = workspaceSession?.getRequestVersion()
                const text = await file.text()
                if (!mounted.current || request !== sampleRequest.current || workspaceRequest !== workspaceSession?.getRequestVersion()) return
                const raw: unknown = JSON.parse(text)
                if (workspaceSession && !workspaceSession.practice) {
                  await workspaceSession.openDocument(raw)
                  return
                }
                if (raw && typeof raw === 'object' && 'kind' in raw && raw.kind === 'azure-vwan-capture' && workspaceSession) {
                  await workspaceSession.openDocument(raw)
                  return
                }
                if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 1 && !('kind' in raw) && workspaceSession) {
                  await workspaceSession.openDocument(raw)
                  return
                }
                if (raw && typeof raw === 'object' && 'kind' in raw && raw.kind === 'azure-network-capture') {
                  applyCapture(raw, await import('./azure-import'))
                  return
                }
                applyLoadedTopology('', parseAzNetJson(text))
                setWorkspaceNotice('')
              } catch (error) {
                setWorkspaceNotice(`Import rejected; the active design is unchanged. ${workspaceError(error)}`)
              }
            }}
          />
          <input
            ref={compareFileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                if (file.size > AZNET_MAX_JSON_LENGTH) throw new Error('JSON exceeds 4 MB limit.')
                const raw = JSON.parse(await file.text()) as Record<string, unknown>
                if (raw.kind === 'azure-network-capture') {
                  const { importAzNetCapture, compareAzNetWithObservations } = await import('./azure-import')
                  const imported = importAzNetCapture(raw)
                  setCaptureNotices(imported.warnings)
                  setCaptureObservations(imported.observations ?? null)
                  setOriginalCapture(raw)
                  if (imported.observations) {
                    const report = compareAzNetWithObservations(
                      topology,
                      simulation,
                      imported.observations,
                    )
                    setCaptureComparison(report)
                    setCaptureRevision(baselineRevision)
                    setActiveTab('azure')
                  }
                }
              } catch (error) {
                setWorkspaceNotice(`Comparison import rejected: ${workspaceError(error)}`)
              }
            }}
          />
        </div>
        <WorkspaceAccountStatus />
      </header>

      {/* Main Split Workspace */}
      <div className="aznet-workspace" role="main">
        <WorkspaceTabPanel>
        {/* Left: Interactive Compound Topology Canvas */}
        <section className="aznet-canvas-column">
          <div className="aznet-scenario-banner">
            <div>
              <strong>{topology.name}</strong> —{' '}
              <span>{currentSampleMeta?.summary ?? topology.subtitle}</span>
            </div>
            <div style={{ whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--accent)' }}>
              Right-click a node for routes, paths, or configuration
            </div>
          </div>

          {!analysis && analysisRequest && <div className="routing-check-status" role="status">
            {t(analysisRunning ? 'Checking all modeled networks…' : currentAnalysisRun?.status === 'cancelled'
              ? 'Analysis cancelled; unassessed cases remain unverified.' : 'Routing check failed. No complete result is available.')}
            {analysisRunning && <button type="button" className="aznet-btn" onClick={cancelAnalysis}>{t('Cancel analysis')}</button>}
          </div>}
          {analysis && <div className="routing-check-status" data-testid="aznet-routing-check-status" role="status">
            <span>{analysisRunning ? t('Checking all modeled networks…') : analysis.continuation.status === 'cancelled'
              ? t('Analysis cancelled; unassessed cases remain unverified.') : validationErrors.length ? 'Routing check incomplete: fix topology validation errors.'
              : !analysis.checked ? 'No eligible endpoint pairs were checked; connectivity has not been verified.'
                : !analysis.complete ? 'Routing check incomplete; unchecked pairs are not verified.'
                  : diagnostics.some((finding) => finding.severity !== 'info') ? 'Routing check completed.'
                    : 'No routing issues found within the checked model scope.'}</span>
            <span>{actionableCount} routing issues: {connectivityFailures} connectivity failures, {statefulAsymmetries} stateful asymmetries.
              {' '}{actionableCount} root-cause issue{actionableCount === 1 ? '' : 's'} affecting {affectedFlowCount} sampled flow pairs.
              {' '}Checked {analysis.checked} of {analysis.total} representative pairs ({analysis.checked * 2} directional traces).
              {' '}Results update when routing changes.</span>
            {acknowledgedTokens.size > 0 && <span>{t('{0} findings need attention · {1} acknowledged · {2} total', actionableCount, diagnostics.filter(isAcknowledged).length, diagnostics.length)}</span>}
            <span>{t('{0} representative pairs remain unassessed.', analysis.continuation.remainingPairs)}
              {analysis.limitsReached.length > 0 && ` ${t('Reached limit: {0}', analysis.limitsReached.map((limit) => t(limit === 'maxPairs' ? 'Representative pairs per batch' : limit === 'maxMillis' ? 'Elapsed time' : 'Stored findings')).join(', '))}`}</span>
            {analysis.continuation.status === 'capacity' && <span>{t('Stored evidence capacity reached. Narrow the scope before starting another run.')}</span>}
            {!analysisRunning && analysis.continuation.status === 'paused' && <button type="button" className="aznet-btn" data-testid="aznet-continue-routing-check" onClick={continueAnalysis}>{t('Continue analysis')}</button>}
            {(analysisRunning || analysis.continuation.status === 'paused') && <button type="button" className="aznet-btn" onClick={cancelAnalysis}>{t('Cancel analysis')}</button>}
            <button type="button" className="aznet-btn" data-testid="aznet-review-routing-issues"
              onClick={() => { setReviewFindingIds(null); setActiveTab('diagnostics'); setShowDiagnosticBadges(true) }}>
              Review routing issues
            </button>
            <button type="button" className="aznet-btn" onClick={() => {
              setAnalysisRequest(null)
              setReviewFindingIds(null)
              setShowDiagnosticBadges(false)
            }}>Clear routing check</button>
            {analysisRequest?.scope === 'landscape' && <p>
              Assumes connectivity is required between all workload subnets and distinct on-premises sites; intentional isolation may appear as disconnected pairs.
              {' '}One representative IP per subnet/site prefix, at most {AZ_NET_PAIR_LIMIT} pairs per batch. Infrastructure-only subnets, Internet availability,
              exhaustive address-space/ECMP coverage, firewall rules, NSGs and host/service availability are not verified.
            </p>}
          </div>}

          <WorkspaceCanvasTabs />
          <AzureNetDiagram
            selectionActions={canvasSelection && (() => {
              const spec = getContextMenuSpec(canvasSelection, true)
              return spec && <CanvasSelectionActions key={JSON.stringify(canvasSelection)} title={spec.title} actions={spec.actions}
                onRun={() => { setContextMenu(null); setToolsDismissRequest(request => request + 1) }}
                onAll={() => setToolsOpenRequest(request => request + 1)} />
            })()}
            emptyActions={<CanvasStartActions onAdd={() => setToolsOpenRequest(request => request + 1)} onExamples={() => setSampleGalleryOpen(true)} />}
            frameRequest={frameRequest}
            topology={topology}
            vpnUnderlays={simulation.vpnUnderlays}
            onResetLayout={() => commitTopology((next) => {
              for (const node of [...next.vnets, ...next.vwanHubs, ...next.erLocations, ...next.sites]) {
                delete node.x; delete node.y
              }
            })}
            onShowRouteMapRules={openRouteMapRules}
            faults={scenario.affected}
            risks={risks}
            onRisk={setResilienceEndpoint}
            selected={canvasSelection}
            onSelect={selectCanvasObject}
            onClearSelection={() => setCanvasSelection(undefined)}
            onMoveNode={(nodeKind, nodeId, x, y) => {
              commitTopology((next) => {
                if (nodeKind === 'vnet') {
                  const v = next.vnets.find((n) => n.id === nodeId)
                  if (v) {
                    v.x = x
                    v.y = y
                  }
                } else if (nodeKind === 'vwan-hub') {
                  const h = next.vwanHubs.find((n) => n.id === nodeId)
                  if (h) {
                    h.x = x
                    h.y = y
                  }
                } else if (nodeKind === 'er-location') {
                  const l = next.erLocations.find((n) => n.id === nodeId)
                  if (l) {
                    l.x = x
                    l.y = y
                  }
                } else if (nodeKind === 'site') {
                  const s = next.sites.find((n) => n.id === nodeId)
                  if (s) {
                    s.x = x
                    s.y = y
                  }
                }
              })
            }}
            forwardTrace={singleFlowForCustomIp ?? pairAnalysis?.forward ?? null}
            reverseTrace={singleFlowForCustomIp ? null : (pairAnalysis?.reverse ?? null)}
            additionalForwardTraces={groupedPaths?.paths.map((path) => path.pair.forward)}
            additionalReverseTraces={groupedPaths?.paths.map((path) => path.pair.reverse)}
            diagnostics={attentionDiagnostics}
            showDiagnosticBadges={showDiagnosticBadges}
            onShowIssues={(findings) => {
              setReviewFindingIds(findings.map((finding) => finding.id))
              setActiveTab('diagnostics')
            }}
            onClearHighlights={() => {
              setCanvasSelection(undefined)
              setTraceActive(false)
              setGroupTrace(null)
              setShowDiagnosticBadges(false)
            }}
            onContextMenu={(target) => { setGuidanceNavigation(false); setContextReturnFocus(document.activeElement); setContextMenu(target) }}
            onTogglePeeringEnabled={(peeringId, enabled) => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peeringId)
                if (p) p.enabled = enabled
              })
            }}
            onUpdatePeeringFlag={(peeringId, direction, flag, value) => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peeringId)
                if (p) p[direction][flag] = value
              })
            }}
            onUpdateRouteTable={(routeTableId, patch) => {
              commitTopology((draft) => {
                const rt = draft.udrTables.find((t) => t.id === routeTableId)
                if (!rt) return
                if (patch.disableBgpRoutePropagation !== undefined) {
                  rt.disableBgpRoutePropagation = patch.disableBgpRoutePropagation
                }
                if (patch.disablePeeringRoutePropagation !== undefined) {
                  rt.disablePeeringRoutePropagation = patch.disablePeeringRoutePropagation
                }
              })
            }}
            onAssociateSubnetRouteTable={(vnetId, subnetId, routeTableId) => {
              commitTopology((draft) => {
                const vnet = draft.vnets.find((v) => v.id === vnetId)
                const subnet = vnet?.subnets.find((s) => s.id === subnetId)
                if (subnet) {
                  subnet.routeTableId = routeTableId
                }
              })
            }}
            onOpenEditorForEntity={(entity) => {
              setSelected(entity)
              setActiveTab('editor')
            }}
            onOpenVnetConnection={openVnetConnection}
          />

          {contextMenu && contextMenuSpec && (
            <Suspense fallback={null}><TopologyContextMenu
              focusOnOpen={!guidanceNavigation}
              x={contextMenu.x}
              y={contextMenu.y}
              title={contextMenuSpec.title}
              actions={contextMenuSpec.actions}
              onClose={() => {
                setGuidanceNavigation(false)
                if (contextReturnFocus?.isConnected && 'focus' in contextReturnFocus) (contextReturnFocus as HTMLElement).focus({ preventScroll: true })
                setContextReturnFocus(null)
                setContextMenu(null)
              }}
            /></Suspense>
          )}
          {topology.vwanHubs.filter((hub) => hub.id === capabilitiesHubId).map((hub) => <Suspense key={hub.id} fallback={null}>
            <HubCapabilitiesDialog hub={hub} connections={azHubGatewayConnections(topology, hub.id)} onClose={() => setCapabilitiesHubId(undefined)} />
          </Suspense>)}
          {clearRequested && <Suspense fallback={null}><ClearTopologyDialog
            workspace="azure-net"
            onClose={() => setClearRequested(false)}
            onConfirm={() => {
              setClearRequested(false)
              if (workspaceSession?.clearDocument && !workspaceSession.practice) workspaceSession.clearDocument()
              else void loadSample('')
            }} /></Suspense>}
          {deletionSpec && deletionAction && (
            <CanvasOverlay title={deletionAction.label} className="object-editor" onClose={() => setDeleteTarget(null)}>
              <p>Delete <strong>{deletionSpec.title}</strong>? Associated elements and connections may also be removed. Other endpoint nodes are kept.</p>
              <div className="row dialog-actions">
                <button autoFocus onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="danger" onClick={() => {
                  deletionAction.onSelect?.()
                  setDeleteTarget(null)
                  setCanvasSelection(undefined)
                  setActiveTab(activeTab === 'routes' && inspectedControlRib ? 'routes' : null)
                }}>Confirm deletion</button>
              </div>
            </CanvasOverlay>
          )}
        </section>

        {bgpInspection && <Suspense fallback={null}><BgpNeighborsPanel key={bgpInspection.revision}
          topology={topology} simulation={simulation} initialResource={bgpInspection.resource}
          unavailableIds={Object.keys(scenario.affected)} onClose={() => setBgpInspection(undefined)} /></Suspense>}
        {nvaBgpInspection && <Suspense fallback={null}><NvaBgpPanel key={`${nvaBgpInspection.vnetId}:${nvaBgpInspection.applianceId}`}
          topology={topology} simulation={simulation} {...nvaBgpInspection}
          onPeerChange={(routeServerId, checked) => commitTopology((draft) => {
            const ars = draft.vnets.find((vnet) => vnet.routeServer?.id === routeServerId)?.routeServer
            if (!ars) return
            ars.peerApplianceIds = checked ? [...new Set([...ars.peerApplianceIds, nvaBgpInspection.applianceId])]
              : ars.peerApplianceIds.filter((id) => id !== nvaBgpInspection.applianceId)
            pruneAzArsRouteMaps(draft)
          })} onClose={() => setNvaBgpInspection(undefined)} /></Suspense>}
        {(routeMapSiteId || routeMapArsId || routeMapHubId) && <Suspense fallback={null}><AzRouteMapsPanel key={`${routeMapHubId ? `hub:${routeMapHubId}` : routeMapArsId ? `ars:${routeMapArsId}` : `site:${routeMapSiteId}`}:${routeMapInspection?.connectionId ?? ''}:${routeMapInspection?.direction ?? ''}`} topology={topology}
          initialConnectionId={routeMapInspection?.connectionId} initialDirection={routeMapInspection?.direction}
          siteId={routeMapSiteId} hubId={routeMapHubId} routeServerId={routeMapArsId} outbound={routeMapArsId ? simulation.routeServerOutbound?.[routeMapArsId] : undefined}
          inbound={routeMapArsId ? simulation.routeServerInbound?.[routeMapArsId] : undefined}
          onSave={(next) => commitTopology((draft) => Object.assign(draft, next))} onClose={() => { setRouteMapSiteId(undefined); setRouteMapArsId(undefined); setRouteMapHubId(undefined) }} /></Suspense>}
        {vnetConnectionId && <Suspense fallback={null}><VnetConnectionEditor key={vnetConnectionId}
          topology={topology} vnetId={vnetConnectionId} commit={commitTopology} onClose={() => setVnetConnectionId(undefined)} /></Suspense>}
        {activeTab && (selectedExists || activeTab === 'routes' && routeInspection || activeTab === 'diagnostics' || activeTab === 'tracer' || activeTab === 'azure') && <CanvasOverlay restoreFocus={activeTab === 'azure'}
          key={guidanceRevision}
          focusOnOpen={!guidanceNavigation}
          title={{
            routes: t(inspectedControlRib && !inspectedControlRib.staticRouting ? 'BGP table' : 'Effective routes'),
            tracer: 'Path explorer',
            diagnostics: 'Topology analysis',
            editor: 'Configure selected object',
            azure: 'Azure & Bicep',
          }[activeTab]}
          className={`aznet-inspector-window${activeTab === 'routes' ? ' aznet-routes-window' : ''}`}
          onClose={() => { setActiveTab(null); setGuidanceNavigation(false) }}
        >
          <nav className="aznet-tabs">
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'routes' ? 'active' : ''}`}
              data-testid="aznet-tab-routes"
              onClick={() => setActiveTab('routes')}
            >
              {t(inspectedControlRib && !inspectedControlRib.staticRouting ? 'BGP table' : 'Effective routes')}
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'tracer' ? 'active' : ''}`}
              data-testid="aznet-tab-tracer"
              onClick={() => setActiveTab('tracer')}
            >
              Path & Symmetry
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'diagnostics' ? 'active' : ''}`}
              data-testid="aznet-tab-diagnostics"
              onClick={() => setActiveTab('diagnostics')}
            >
              Diagnostics ({actionableCount})
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'editor' ? 'active' : ''}`}
              data-testid="aznet-tab-editor"
              onClick={() => setActiveTab('editor')}
            >
              Configure
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'azure' ? 'active' : ''}`}
              data-testid="aznet-tab-azure"
              onClick={() => setActiveTab('azure')}
            >
              ☁ Azure & Bicep
            </button>
          </nav>

          <div className="aznet-panel-body">
            {/* TAB 1: SUBNET EFFECTIVE ROUTES & BGP CONTROL-PLANE RIBS */}
            {activeTab === 'routes' && (
              <>
                {!inspectedControlRib && <div className="aznet-card" data-testid="aznet-subnet-routes-card">
                  <h3>Inspect Subnet Effective Route Table</h3>
                  <div className="aznet-field-grid">
                    <label className="aznet-field">
                      <span>Subnet</span>
                      <select
                        className="aznet-select"
                        data-testid="aznet-subnet-selector"
                        value={inspectedSubnetTable?.subnetId ?? ''}
                        onChange={(e) => {
                          const subId = e.target.value
                          const vnet = topology.vnets.find((v) =>
                            v.subnets.some((s) => s.id === subId),
                          )
                          if (vnet) {
                            inspectRoutes({ kind: 'subnet', vnetId: vnet.id, subnetId: subId })
                          }
                        }}
                      >
                        {topology.vnets.map((v) => (
                          <optgroup key={v.id} label={`${v.name} (${v.region})`}>
                            {v.subnets.map((s) => (
                              <option key={s.id} value={s.id}>
                                {v.name} / {s.name} ({s.prefix})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>

                    <label className="aznet-field">
                      <span>Test Destination IP (LPM Winner)</span>
                      <input
                        type="text"
                        className="aznet-input"
                        data-testid="aznet-lpm-input"
                        placeholder="e.g. 10.10.2.25 or 172.16.1.10"
                        value={testIpQuery}
                        onChange={(e) => setTestIpQuery(e.target.value)}
                      />
                    </label>
                  </div>

                  {inspectedSubnetTable && (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginBottom: 8,
                          fontSize: 11.5,
                        }}
                      >
                        <span>
                          Route Table:{' '}
                          <strong>{inspectedSubnetTable.udrTableName ?? 'None (System + BGP)'}</strong>
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            className={`aznet-badge ${
                              inspectedSubnetTable.bgpPropagationDisabled ? 'info' : 'active'
                            }`}
                          >
                            BGP Propagation:{' '}
                            {inspectedSubnetTable.bgpPropagationDisabled ? 'Disabled' : 'Enabled'}
                          </span>
                          {inspectedSubnetTable.peeringPropagationDisabled && (
                            <span
                              className="aznet-badge info"
                              data-testid="aznet-peering-propagation-badge"
                            >
                              Peering suppression configured (Preview; requires an active covering UDR)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="table-scroll"><table className="aznet-route-table" data-testid="aznet-effective-route-table"
                        data-learning-anchor={routeSelection.kind === 'subnet' ? guidanceAnchor('effective-table', routeSelection.vnetId, routeSelection.subnetId) : undefined}>
                        <thead>
                          <tr>
                            <th>State</th>
                            <th>Source</th>
                            <th>Prefix</th>
                            <th>Next Hop</th>
                            <th>AS path</th>
                            <th>Origin / Tie-Breaker</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectedSubnetTable.routes.map((route) => {
                            const isLpmWinner = lpmMatchedRouteId === route.id
                            const fwdFlow = singleFlowForCustomIp ?? pairAnalysis?.forward
                            const retFlow = singleFlowForCustomIp ? null : pairAnalysis?.reverse
                            const isFwdMatch = Boolean(
                              fwdFlow?.hops.some(
                                (h) =>
                                  h.subnetId === inspectedSubnetTable.subnetId &&
                                  h.matchedRoute?.id === route.id,
                              ),
                            )
                            const isRetMatch = Boolean(
                              retFlow?.hops.some(
                                (h) =>
                                  h.subnetId === inspectedSubnetTable.subnetId &&
                                  h.matchedRoute?.id === route.id,
                              ),
                            )
                            return (
                              <tr
                                key={route.id}
                                data-learning-anchor={routeSelection.kind === 'subnet' ? guidanceAnchor('effective-prefix', routeSelection.vnetId, routeSelection.subnetId, route.prefix) : undefined}
                                className={`aznet-route-row ${
                                  route.active ? '' : 'suppressed'
                                } ${isLpmWinner || isFwdMatch || isRetMatch ? 'lpm-winner' : ''}`}
                                data-testid={`aznet-route-row-${route.prefix}-${route.source}`}
                              >
                                <td>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span
                                      className={`aznet-badge ${
                                        route.active ? 'active' : 'suppressed'
                                      }`}
                                    >
                                      {isLpmWinner
                                        ? '★ LPM Winner'
                                        : route.active
                                          ? 'Active'
                                          : 'Invalid'}
                                    </span>
                                    {isFwdMatch && (
                                      <span
                                        className="aznet-badge info"
                                        data-testid="aznet-route-trace-badge-fwd"
                                        title="Matched by active Forward Trace on this subnet"
                                      >
                                        FWD
                                      </span>
                                    )}
                                    {isRetMatch && (
                                      <span
                                        className="aznet-badge warning"
                                        data-testid="aznet-route-trace-badge-ret"
                                        title="Matched by active Return Trace on this subnet"
                                      >
                                        RET
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>{route.source}</td>
                                <td>
                                  <code>{route.prefix}</code>
                                </td>
                                <td>
                                  <strong>{route.nextHopType}</strong>
                                  {route.nextHopName && route.nextHopName !== route.nextHopType ? (
                                    <div style={{ fontSize: 10.5, color: 'var(--text)' }}>
                                      {route.nextHopName}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="as-path">{route.asPath.join(' ') || '—'}</td>
                                <td>
                                  <div>{route.originLabel}</div>
                                  {route.suppressedReason && (
                                    <div style={{ fontSize: 10.5, color: 'var(--error)' }}>
                                      {route.suppressedReason}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table></div>

                      {workspaceSession?.learningView?.open && workspaceSession.learningState?.automatic && !workspaceSession.learningState.reviewId
                        && workspaceSession.learningState?.observation
                        && routeSelection.kind === 'subnet'
                        && routeSelection.vnetId === workspaceSession.learningState.observation.vnetId
                        && routeSelection.subnetId === workspaceSession.learningState.observation.subnetId
                        && inspectedSubnetTable.subnetId === workspaceSession.learningState.observation.subnetId
                        && <Suspense fallback={null}><LearningInspection observation={workspaceSession.learningState.observation}
                          prefixPresent={inspectedSubnetTable.routes.some((route) => route.prefix === workspaceSession.learningState!.observation!.prefix)}
                          onObserve={workspaceSession.reportLearningObservation} /></Suspense>}

                      {inspectedSubnetTable.suppressedBgpRoutes.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 8,
                            borderRadius: 6,
                            background: 'var(--surface-muted)',
                            border: '1px solid var(--border)',
                            fontSize: 11.5,
                          }}
                          data-testid="aznet-suppressed-bgp-banner"
                        >
                          <strong style={{ color: 'var(--text)' }}>
                            {inspectedSubnetTable.suppressedBgpRoutes.length} BGP route(s) suppressed by configuration:
                            {' '}
                            disableBgpRoutePropagation=true:
                          </strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {inspectedSubnetTable.suppressedBgpRoutes.map((sr) => (
                              <li key={sr.id}>
                                <code>{sr.prefix}</code> via {sr.nextHopName} ({sr.originLabel})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {inspectedSubnetTable.suppressedPeeringRoutes.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 8,
                            borderRadius: 6,
                            background: 'var(--surface-muted)',
                            border: '1px solid var(--border)',
                            fontSize: 11.5,
                          }}
                          data-testid="aznet-suppressed-peering-banner"
                        >
                          <strong style={{ color: 'var(--text)' }}>
                            {inspectedSubnetTable.suppressedPeeringRoutes.length} VNetPeering
                            route(s) suppressed by disablePeeringRoutePropagation=true (Preview) with active covering UDRs:
                          </strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {inspectedSubnetTable.suppressedPeeringRoutes.map((sr) => (
                              <li key={sr.id}>
                                <code>{sr.prefix}</code> via {sr.nextHopName} ({sr.originLabel})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>}

                {inspectedControlRib && (
                  <div className="aznet-card" data-testid="aznet-control-rib-card"
                    data-learning-anchor={routeSelection.kind === 'vwan-hub' && !(hubTableInspection?.hubId === routeSelection.hubId && hubTableInspection.firewall)
                      ? guidanceAnchor('hub-effective-table', routeSelection.hubId, hubTableInspection?.hubId === routeSelection.hubId ? hubTableInspection.tableId : DEFAULT_HUB_TABLE)
                      : routeSelection.kind === 'site' ? guidanceAnchor('site-effective-table', routeSelection.siteId)
                      : routeSelection.kind === 'gateway' ? guidanceAnchor('gateway-effective-table', routeSelection.vnetId, routeSelection.gatewayId)
                      : routeSelection.kind === 'er-location' ? guidanceAnchor('er-effective-table', routeSelection.locationId) : undefined}>
                    <h3>{inspectedControlRib.title}</h3>
                    {routeSelection.kind === 'vwan-hub' && (() => {
                      const hub = topology.vwanHubs.find((hub) => hub.id === routeSelection.hubId)
                      if (!hub) return null
                      const tableId = hubTableInspection?.hubId === hub.id ? hubTableInspection.tableId : DEFAULT_HUB_TABLE
                      const coverage = simulation.vwanHubTableCoverage[hub.id]?.[tableId]
                      return <><label>{t('Hub routing table')} <select className="aznet-select" aria-label={t('Hub routing table')}
                        value={hubTableInspection?.hubId === hub.id && hubTableInspection.firewall ? '' : tableId}
                        onChange={(event) => setHubTableInspection({ hubId: hub.id, tableId: event.target.value || DEFAULT_HUB_TABLE, firewall: event.target.value === '' })}>
                        {hub.firewall && <option value="">{t('Firewall onward routes')}</option>}
                        {hubRouteTables(hub).map((table) => <option key={table.id} value={table.id}>{table.name} · {table.id}</option>)}
                      </select></label>{!coverage?.complete && <p role="status">{t('Routing not assessed')}: {coverage?.limitations.join(' ')}</p>}</>
                    })()}
                    <Suspense fallback={null}><BgpRouteTable key={JSON.stringify([routeSelection, hubTableInspection, guidanceRevision])}
                      entries={inspectedControlRib.entries} available={inspectedControlRib.available}
                      staticRouting={inspectedControlRib.staticRouting}
                      learningScope={routeSelection.kind === 'vwan-hub' && !hubTableInspection?.firewall ? {
                        hubId: routeSelection.hubId,
                        tableId: hubTableInspection?.hubId === routeSelection.hubId ? hubTableInspection.tableId : DEFAULT_HUB_TABLE,
                        prefix: hubTableInspection?.hubId === routeSelection.hubId ? hubTableInspection.prefix : undefined,
                      } : routeSelection.kind === 'site' ? {
                        siteId: routeSelection.siteId,
                        prefix: workspaceSession?.learningState?.observation?.siteId === routeSelection.siteId
                          ? workspaceSession.learningState.observation.prefix : undefined,
                      } : routeSelection.kind === 'gateway' ? {
                        vnetId: routeSelection.vnetId, gatewayId: routeSelection.gatewayId,
                        prefix: workspaceSession?.learningState?.observation?.gatewayId === routeSelection.gatewayId
                          ? workspaceSession.learningState.observation.prefix : undefined,
                      } : routeSelection.kind === 'er-location' ? {
                        locationId: routeSelection.locationId,
                        prefix: workspaceSession?.learningState?.observation?.locationId === routeSelection.locationId
                          ? workspaceSession.learningState.observation.prefix : undefined,
                      } : undefined} />
                    {workspaceSession?.learningView?.open && workspaceSession.learningState?.automatic && !workspaceSession.learningState.reviewId
                      && workspaceSession.learningState?.observation && inspectedControlRib.available
                      && ((routeSelection.kind === 'site' && routeSelection.siteId === workspaceSession.learningState.observation.siteId)
                        || (routeSelection.kind === 'gateway' && routeSelection.vnetId === workspaceSession.learningState.observation.vnetId
                          && routeSelection.gatewayId === workspaceSession.learningState.observation.gatewayId)
                        || (routeSelection.kind === 'er-location' && routeSelection.locationId === workspaceSession.learningState.observation.locationId)
                        || (routeSelection.kind === 'vwan-hub' && routeSelection.hubId === workspaceSession.learningState.observation.hubId
                          && !(hubTableInspection?.hubId === routeSelection.hubId && hubTableInspection.firewall)
                          && (hubTableInspection?.hubId === routeSelection.hubId ? hubTableInspection.tableId : DEFAULT_HUB_TABLE)
                            === workspaceSession.learningState.observation.tableId
                          && simulation.vwanHubTableCoverage[routeSelection.hubId]?.[workspaceSession.learningState.observation.tableId!]?.complete))
                      && <LearningInspection observation={workspaceSession.learningState.observation}
                        prefixPresent={inspectedControlRib.entries.some((route) => route.prefix === workspaceSession.learningState!.observation!.prefix)}
                        onObserve={workspaceSession.reportLearningObservation} />}</Suspense>
                  </div>
                )}
              </>
            )}

            {/* TAB 2: HOP-BY-HOP PACKET & STATEFUL SYMMETRY TRACER */}
            {activeTab === 'tracer' && (
              <div className="aznet-card" data-testid="aznet-path-tracer-panel">
                <h3>End-to-End Packet & Stateful Symmetry Tracer</h3>
                <p className="aznet-path-legend">Forward: green · Return: amber/dashed. Representative IP per prefix; firewall policy and exhaustive ECMP are not simulated.</p>
                {groupedPaths && (
                  <div data-testid="aznet-group-path-results">
                    <strong>
                      {groupTrace?.direction === 'to' ? 'Paths from' : 'Paths to'}{' '}
                      {endpointOptions.find((e) => e.key === groupTrace?.anchorKey)?.label ?? 'Removed endpoint'}
                    </strong>
                    <p>{groupedPaths.paths.length} of {groupedPaths.total} paths shown
                      {groupedPaths.total > AZ_NET_PAIR_LIMIT ? ' — incomplete; choose an individual endpoint for remaining paths.' : '.'}
                    </p>
                    {groupedPaths.paths.length === 0 && <p>No matching endpoints or prefixes configured.</p>}
                    {groupedPaths.paths.map(({ source, destination, pair }) => (
                      <button key={`${source.key}:${destination.key}`} type="button" className="aznet-group-path aznet-btn"
                        onClick={() => startPath(source, destination)}>
                        {source.label} → {destination.label}: Forward {pair.forward.status}, Return {pair.reverse.status}
                        {!pair.symmetricInspection && pair.forward.status === 'delivered' && pair.reverse.status === 'delivered' ? ' — asymmetric inspection' : ''}
                      </button>
                    ))}
                  </div>
                )}
                <div className="aznet-field-grid">
                  <label className="aznet-field">
                    <span>Source Endpoint</span>
                    <select
                      className="aznet-select"
                      data-testid="aznet-trace-source-select"
                      value={resolvedSourceOpt?.key ?? ''}
                      onChange={(e) => {
                        setTraceSourceKey(e.target.value)
                        setGroupTrace(null)
                        setTraceActive(true)
                      }}
                    >
                      {endpointOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="aznet-field">
                    <span>Destination Endpoint</span>
                    <select
                      className="aznet-select"
                      data-testid="aznet-trace-dest-select"
                      value={resolvedDestOpt?.key ?? ''}
                      onChange={(e) => {
                        setTraceDestKey(e.target.value)
                        setGroupTrace(null)
                        setCustomDestIp('')
                        setTraceActive(true)
                      }}
                    >
                      {endpointOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-end',
                    marginTop: 8,
                  }}
                >
                  <label className="aznet-field" style={{ flex: 1 }}>
                    <span>Optional Override Destination IP (e.g. Private Endpoint /32)</span>
                    <input
                      type="text"
                      className="aznet-input"
                      data-testid="aznet-trace-custom-ip"
                      placeholder="Leave blank to use selected endpoint IP"
                      value={customDestIp}
                      onChange={(e) => setCustomDestIp(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="aznet-btn aznet-btn-primary"
                    data-testid="aznet-run-trace-btn"
                    disabled={hasInvalidCustomIp || !resolvedSourceOpt || !resolvedDestOpt}
                    onClick={() => { setGroupTrace(null); setTraceActive(true) }}
                  >
                    ▶ Trace Flow
                  </button>
                </div>
                {hasInvalidCustomIp && <p role="alert">Enter a valid IPv4 destination address.</p>}
                {(!resolvedSourceOpt || !resolvedDestOpt) && <p>Choose existing source and destination endpoints. A previously selected endpoint may have been removed.</p>}
                {singleFlowForCustomIp && <p>Custom IP is outside the selected destination prefix. Only the forward route is known; select the owning endpoint to analyze the return path.</p>}
                {pairAnalysis && !singleFlowForCustomIp && resolvedSourceOpt && resolvedDestOpt
                  && ['subnet', 'site'].includes(resolvedSourceOpt.ref.kind) && ['subnet', 'site'].includes(resolvedDestOpt.ref.kind) && <Suspense fallback={null}><FlowExportControls
                  document={{ mode: simulatorMode === 'hub-spoke' ? 'hub-spoke' : 'full', topology: azDisplayResult(activeTopology, displayNames) }}
                  flow={{ id: 'selected-flow', kind: 'flow', source: resolvedSourceOpt.ref, target: resolvedDestOpt.ref,
                    sourceAddress: resolvedSourceOpt.defaultIp, destinationAddress: customDestIp.trim() || resolvedDestOpt.defaultIp, expectation: 'allow' }} /></Suspense>}

                {pairAnalysis && resolvedSourceOpt && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Symmetry Banner */}
                    {!singleFlowForCustomIp && (
                      <div
                        data-testid="aznet-symmetry-verdict"
                        style={{
                          padding: 10,
                          borderRadius: 6,
                          fontWeight: 600,
                          fontSize: 12,
                          background:
                            pairAnalysis.forward.status !== 'delivered' ||
                            pairAnalysis.reverse.status !== 'delivered'
                              ? 'var(--surface-muted)'
                              : pairAnalysis.symmetricInspection
                                ? 'var(--surface-muted)'
                                : 'var(--surface-muted)',
                          color:
                            pairAnalysis.forward.status !== 'delivered' ||
                            pairAnalysis.reverse.status !== 'delivered'
                              ? 'var(--error)'
                              : pairAnalysis.symmetricInspection
                                ? 'var(--success)'
                                : 'var(--warning)',
                          border: '1px solid currentColor',
                        }}
                      >
                        {pairAnalysis.forward.status !== 'delivered' ||
                        pairAnalysis.reverse.status !== 'delivered'
                          ? `✕ Flow Blocked — Forward: ${pairAnalysis.forward.status}, Reverse: ${pairAnalysis.reverse.status}`
                          : pairAnalysis.symmetricInspection
                            ? '✓ Symmetric Path — Forward and Return flows use the same stateful inspection appliances (if any); graphical paths may differ.'
                            : `⚠ Asymmetric Firewall Bypass Detected — ${pairAnalysis.asymmetricBypassApplianceNames.join(', ')} is traversed in only one direction!`}
                      </div>
                    )}

                    {/* Forward Hops */}
                    <div>
                      <h4 style={{ margin: '4px 0 6px 0', fontSize: 12.5 }}>
                        Forward Path ({resolvedSourceOpt.defaultIp} →{' '}
                        { (singleFlowForCustomIp ?? pairAnalysis.forward).destinationIp })
                      </h4>
                      <div className="aznet-hop-list" data-testid="aznet-forward-hops">
                        {(singleFlowForCustomIp ?? pairAnalysis.forward).hops.map((hop) => (
                          <div
                            key={hop.index}
                            className={`aznet-hop-item ${
                              hop.action === 'dropped'
                                ? 'dropped'
                                : hop.action === 'delivered'
                                  ? 'delivered'
                                  : ''
                            }`}
                          >
                            <strong>
                              Hop {hop.index}: {hop.nodeName}
                              {hop.subnetName ? ` / ${hop.subnetName}` : ''}
                            </strong>
                            <div style={{ marginTop: 2 }}>{localizeDiagnostic(hop.detail)}</div>
                            {hop.matchedRoute && (
                              <div style={{ fontSize: 10.5, color: 'var(--text)', marginTop: 2 }}>
                                Matched: <code>{hop.matchedRoute.prefix}</code> →{' '}
                                {hop.matchedRoute.nextHopType} ({hop.matchedRoute.source})
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Reverse Hops */}
                    {!singleFlowForCustomIp && (
                      <div>
                        <h4 style={{ margin: '6px 0 6px 0', fontSize: 12.5 }}>
                          Return Path ({pairAnalysis.forward.destinationIp} →{' '}
                          {resolvedSourceOpt.defaultIp})
                        </h4>
                        <div className="aznet-hop-list" data-testid="aznet-reverse-hops">
                          {pairAnalysis.reverse.hops.map((hop) => (
                            <div
                              key={hop.index}
                              className={`aznet-hop-item ${
                                hop.action === 'dropped'
                                  ? 'dropped'
                                  : hop.action === 'delivered'
                                    ? 'delivered'
                                    : ''
                              }`}
                            >
                              <strong>
                                Hop {hop.index}: {hop.nodeName}
                                {hop.subnetName ? ` / ${hop.subnetName}` : ''}
                              </strong>
                              <div style={{ marginTop: 2 }}>{localizeDiagnostic(hop.detail)}</div>
                              {hop.matchedRoute && (
                                <div style={{ fontSize: 10.5, color: 'var(--text)', marginTop: 2 }}>
                                  Matched: <code>{hop.matchedRoute.prefix}</code> →{' '}
                                  {hop.matchedRoute.nextHopType} ({hop.matchedRoute.source})
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: AUTOMATED ROOT-CAUSE DIAGNOSTICS */}
            {activeTab === 'diagnostics' && (
              <div className="aznet-card" data-testid="aznet-diagnostics-panel">
                <h3>Root-Cause Azure Networking Diagnostics ({actionableCount} actionable)</h3>
                <p>Use Check routing above the canvas for the whole landscape, or choose the flows that are expected to communicate below. Results update when the topology changes.</p>
                {reviewFindingIds && <div data-testid="aznet-review-finding-scope">
                  Showing {visibleDiagnostics.length} current findings for the selected canvas marker.
                  <button type="button" className="aznet-btn" onClick={() => setReviewFindingIds(null)}>Show all findings</button>
                </div>}
                <label className="aznet-field">
                  <span>Expected connectivity scope</span>
                  <select className="aznet-select" data-testid="aznet-analysis-scope" value={analysisScope}
                    onChange={(e) => { setAnalysisScope(e.target.value as typeof analysisScope); setAnalysisRequest(null) }}>
                    <option value="pair">Selected source / destination pair</option>
                    <option value="onprem">All workload subnets ↔ on-premises prefixes</option>
                    <option value="all">All workload pairs and workload ↔ on-premises prefixes</option>
                    <option value="landscape">Whole landscape, including distinct on-premises site pairs</option>
                  </select>
                </label>
                {analysisScope === 'pair' && <div className="aznet-field-grid">
                  <label className="aznet-field"><span>Expected source</span>
                    <select className="aznet-select" data-testid="aznet-analysis-source" value={resolvedSourceOpt?.key ?? ''}
                      onChange={(e) => { setTraceSourceKey(e.target.value); setGroupTrace(null); setTraceActive(false); setAnalysisRequest(null) }}>
                      <option value="">Select endpoint</option>
                      {endpointOptions.filter((e) => e.group !== 'internet').map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                    </select>
                  </label>
                  <label className="aznet-field"><span>Expected destination</span>
                    <select className="aznet-select" data-testid="aznet-analysis-destination" value={resolvedDestOpt?.group === 'internet' ? '' : resolvedDestOpt?.key ?? ''}
                      onChange={(e) => { setTraceDestKey(e.target.value); setCustomDestIp(''); setGroupTrace(null); setTraceActive(false); setAnalysisRequest(null) }}>
                      <option value="">Select endpoint</option>
                      {endpointOptions.filter((e) => e.group !== 'internet').map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                    </select>
                  </label>
                </div>}
                <div className="aznet-analysis-actions">
                  <button type="button" className="aznet-btn aznet-btn-primary" data-testid="aznet-analyze-connectivity"
                    disabled={analysisScope === 'pair' && (!resolvedSourceOpt || !resolvedDestOpt ||
                      resolvedSourceOpt.group === 'internet' || resolvedDestOpt.group === 'internet' ||
                      azEndpointKey(resolvedSourceOpt.ref) === azEndpointKey(resolvedDestOpt.ref))}
                    onClick={startAnalysis}>Analyze expected connectivity</button>
                  {!analysisRunning && analysis?.continuation.status === 'paused' && <button type="button" className="aznet-btn" data-testid="aznet-continue-connectivity" onClick={continueAnalysis}>{t('Continue analysis')}</button>}
                  {(analysisRunning || analysis?.continuation.status === 'paused') && <button type="button" className="aznet-btn" onClick={cancelAnalysis}>{t('Cancel analysis')}</button>}
                  {analysis && <button type="button" className="aznet-btn" onClick={() => setAnalysisRequest(null)}>Clear analysis scope</button>}
                </div>
                {analysis ? <div data-testid="aznet-analysis-coverage" role="status">
                  <p>Analyzed scope: {analysisRequest?.scope === 'pair'
                    ? `${endpointOptions.find((e) => e.key === analysisRequest.sourceKey)?.label ?? 'Removed source'} ↔ ${endpointOptions.find((e) => e.key === analysisRequest.destinationKey)?.label ?? 'Removed destination'}`
                    : analysisRequest?.scope === 'onprem' ? 'All workload / on-premises pairs'
                      : analysisRequest?.scope === 'landscape' ? 'Whole landscape, including distinct on-premises site pairs'
                        : 'All workload and on-premises pairs'}.</p>
                  {analysis.complete && !validationErrors.length ? 'Analysis complete' : 'Analysis incomplete'}: checked {analysis.checked} of {analysis.total} representative pairs
                  {' '}({analysis.checked * 2} directional traces; limit {AZ_NET_PAIR_LIMIT} pairs per batch).
                  {analysis.checked === 0 ? ' No eligible endpoint pairs were checked; connectivity has not been verified.' :
                    analysis.findings.length === 0 && analysis.complete && !validationErrors.length ? ' No connectivity failures or stateful-inspection asymmetry found in this scope.' : ''}
                  {analysis.continuation.status === 'paused' && t('Continue analysis or narrow the scope; unchecked pairs are not verified.')}
                  {analysis.continuation.status === 'cancelled' && <p>{t('Analysis cancelled; unassessed cases remain unverified.')}</p>}
                  <p>{t('{0} representative pairs remain unassessed.', analysis.continuation.remainingPairs)}</p>
                  {analysis.continuation.status === 'capacity' && <p>{t('Stored evidence capacity reached. Narrow the scope before starting another run.')}</p>}
                  <p>One representative IP per subnet/site prefix. Not exhaustive address-space or ECMP coverage; firewall rules, NSGs, and host/service availability are outside this routing model.</p>
                </div> : <p data-testid="aznet-analysis-not-run">Connectivity has not been analyzed. Configuration information below does not prove a connectivity failure.</p>}
                {validationErrors.length > 0 && (
                  <div
                    style={{
                      padding: 8,
                      marginBottom: 8,
                      background: 'var(--surface-muted)',
                      color: 'var(--error)',
                      borderRadius: 6,
                      fontSize: 11.5,
                    }}
                  >
                    {validationErrors.map((err, idx) => (
                      <div key={idx}>• {err}</div>
                    ))}
                  </div>
                )}
                <p data-testid="warning-attention-count" role="status">{t('{0} findings need attention · {1} acknowledged · {2} total', actionableCount, diagnostics.filter(isAcknowledged).length, diagnostics.length)}</p>
                <p className="muted">{t('Acknowledgement is saved with this design. It does not fix a warning or change routing checks; changed evidence needs attention again.')}</p>
                {!!topology.warningAcknowledgements?.length && <button className="aznet-btn" onClick={() => commitTopology((draft) => { delete draft.warningAcknowledgements })}>{t('Restore all warning attention')}</button>}
                {visibleDiagnostics.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      background: 'var(--surface-muted)',
                      color: 'var(--success)',
                      fontWeight: 600,
                      fontSize: 12.5,
                    }}
                    data-testid="aznet-diagnostics-clean"
                  >
                    {reviewFindingIds ? 'No current findings for this selection.'
                      : analysis ? 'No routing or configuration findings in the checked scope. See analysis coverage above.'
                        : 'No configuration findings. Use Check routing to verify landscape connectivity.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {visibleDiagnostics.map((finding, index) => (
                      <div key={finding.id}>
                      {isAcknowledged(finding) && (index === 0 || !isAcknowledged(visibleDiagnostics[index - 1])) && <h3 className="warning-acknowledged-heading">{t('Acknowledged warnings')}</h3>}
                      <div
                        className={`aznet-card${isAcknowledged(finding) ? ' acknowledged-warning' : ''}`}
                        data-finding-id={finding.id}
                        data-testid={`aznet-finding-${finding.category}`}
                        style={{ background: 'var(--surface)' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <span className={`aznet-badge ${finding.severity}`}>
                            {finding.severity.toUpperCase()} · {finding.category}
                          </span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {finding.sampleFlow && (
                              <button
                                type="button"
                                className="aznet-btn"
                                onClick={() => traceFinding(finding)}
                              >
                                🔍 Trace Flow
                              </button>
                            )}
                            {finding.severity !== 'info' && finding.category === 'gateway-coexistence' &&
                              <Suspense fallback={null}><GatewayCoexistenceAutoFix topology={topology} finding={finding} commit={commitTopology} /></Suspense>}
                            {finding.severity !== 'info' &&
                              finding.category !== 'gateway-coexistence' &&
                              finding.category !== 'connectivity-failure' &&
                              finding.category !== 'private-endpoint-udr-bypass' &&
                              finding.category !== 'peering-non-transitive-next-hop' &&
                              finding.category !== 'asymmetric-firewall-bypass' && (
                                <button
                                  type="button"
                                  className="aznet-btn aznet-btn-fix"
                                  data-testid={`aznet-autofix-${finding.category}`}
                                  onClick={() => applyAutoFix(finding)}
                                >
                                  ⚡ Auto-Fix
                                </button>
                              )}
                          </div>
                        </div>
                        <h4 style={{ margin: '8px 0 4px 0', fontSize: 13 }}>{finding.title}</h4>
                        {canAcknowledgeWarning(finding) && <Suspense fallback={null}><WarningAcknowledgement disabled={!warningTriage} acknowledged={isAcknowledged(finding)} onChange={(acknowledged) => acknowledgeWarning(finding, acknowledged)} /></Suspense>}
                        <p data-testid="aznet-root-impact">
                          {(() => {
                            const impact = azFindingImpact([finding], endpointOptions)
                            return `1 root-cause issue; ${impact.pairs} affected flow pairs, ${impact.workloads} workload subnets, ${impact.sites} sites, ${impact.prefixes} prefixes.`
                          })()}
                        </p>
                        <p style={{ margin: '0 0 6px 0', fontSize: 11.5, color: 'var(--text)' }}>
                          {finding.summary}
                        </p>
                        <Suspense fallback={null}><Explain concept="coverage" evidence={[finding.summary]} /></Suspense>
                        <Suspense fallback={<p role="status">{t('Loading...')}</p>}>
                          <FindingEvidence finding={finding} onTrace={traceFinding} onConfigure={(vnetId, subnetId) => {
                            if (!setSelected({ kind: 'subnet', vnetId, subnetId })) return
                            setActiveTab('editor')
                          }} />
                        </Suspense>
                      </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CONFIGURATION EDITOR (SCOPED TO SELECTED NODE/CONNECTION #46, #47, #48, #49) */}
            {activeTab === 'editor' && (() => {
              const selectedVnetId =
                selected.kind === 'vnet' ||
                selected.kind === 'subnet' ||
                selected.kind === 'gateway' ||
                selected.kind === 'route-server' ||
                selected.kind === 'appliance'
                  ? selected.vnetId
                  : null
              const showPeeringEditor =
                selected.kind === 'peering' ||
                selectedVnetId !== null
              const showVnetEditor = selectedVnetId !== null
              const showSiteEditor = selected.kind === 'site'
              const showErEditor = selected.kind === 'er-location'
              const showVwanHubEditor = selected.kind === 'vwan-hub'
              const filteredVnets = selectedVnetId
                ? topology.vnets.filter((v) => v.id === selectedVnetId)
                : topology.vnets
              const filteredPeerings =
                selected.kind === 'peering'
                  ? topology.vnetPeerings.filter((p) => p.id === selected.peeringId)
                  : selectedVnetId
                    ? topology.vnetPeerings.filter(
                        (p) => p.vnetAId === selectedVnetId || p.vnetBId === selectedVnetId,
                      )
                    : topology.vnetPeerings

              const context = (
              <>
                <div
                  className="aznet-card"
                  data-testid="aznet-editor-scope-banner"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>
                    <strong>Scoped Configuration:</strong>{' '}
                    {selected.kind === 'vnet' &&
                      `VNet ${topology.vnets.find((v) => v.id === selected.vnetId)?.name ?? selected.vnetId}`}
                    {selected.kind === 'subnet' &&
                      (() => {
                        const v = topology.vnets.find((x) => x.id === selected.vnetId)
                        const s = v?.subnets.find((x) => x.id === selected.subnetId)
                        return `Subnet ${v?.name ?? selected.vnetId}/${s?.name ?? selected.subnetId}`
                      })()}
                    {selected.kind === 'gateway' &&
                      (() => {
                        const v = topology.vnets.find((x) => x.id === selected.vnetId)
                        const g = v?.gateways.find((x) => x.id === selected.gatewayId)
                        return `Gateway ${g?.name ?? selected.gatewayId} (in ${v?.name ?? selected.vnetId})`
                      })()}
                    {selected.kind === 'route-server' &&
                      (() => {
                        const v = topology.vnets.find((x) => x.id === selected.vnetId)
                        return `Route Server ${v?.routeServer?.name ?? 'ARS'} (in ${v?.name ?? selected.vnetId})`
                      })()}
                    {selected.kind === 'appliance' &&
                      (() => {
                        const v = topology.vnets.find((x) => x.id === selected.vnetId)
                        const a = v?.appliances.find((x) => x.id === selected.applianceId)
                        return `Appliance ${a?.name ?? selected.applianceId} (in ${v?.name ?? selected.vnetId})`
                      })()}
                    {selected.kind === 'peering' &&
                      (() => {
                        const p = topology.vnetPeerings.find((x) => x.id === selected.peeringId)
                        return `VNet Peering ${p?.name ?? selected.peeringId}`
                      })()}
                    {selected.kind === 'er-location' &&
                      `ExpressRoute location ${topology.erLocations.find((l) => l.id === selected.locationId)?.name ?? selected.locationId}`}
                    {selected.kind === 'site' &&
                      `On-Premises Site ${topology.sites.find((s) => s.id === selected.siteId)?.name ?? selected.siteId}`}
                    {selected.kind === 'vwan-hub' &&
                      `Virtual WAN Hub ${topology.vwanHubs.find((h) => h.id === selected.hubId)?.name ?? selected.hubId}`}
                    {selected.kind === 'er-link' &&
                      `ExpressRoute connection ${topology.erLinks.find(link => link.id === selected.linkId)?.name ?? selected.linkId}`}
                    {selected.kind === 'vpn-connection' &&
                      `VPN/SD-WAN connection ${topology.vpnConnections.find(connection => connection.id === selected.connectionId)?.name ?? selected.connectionId}`}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Click any node or connection on the diagram to configure it
                  </span>
                </div>

                <Suspense fallback={null}>
                {selected.kind === 'gateway' && <VpnNatGatewayEditor key={selected.gatewayId} topology={topology} targetKind="vnet-gateway" targetId={selected.gatewayId} commit={commitTopology} showGatewaySettings={false} />}
                {selected.kind === 'vpn-connection' && <HybridConnectionEditor key={selected.connectionId} topology={topology} simulation={simulation} connectionId={selected.connectionId} commit={commitTopology} />}
                {selected.kind === 'er-link' && <HybridConnectionEditor key={selected.linkId} topology={topology} connectionId={selected.linkId} commit={commitTopology} />}
                {selected.kind === 'appliance' && <HybridNvaEditor key={selected.applianceId} topology={topology} applianceId={selected.applianceId} commit={commitTopology} />}
                {nvaCreationVnetId && selectedVnetId === nvaCreationVnetId && <NvaCreationEditor key={nvaCreationVnetId}
                  topology={topology} vnetId={nvaCreationVnetId} commit={commitTopology}
                  onCancel={() => setNvaCreationVnetId(undefined)} onSaved={(applianceId) => {
                    const entity = { kind: 'appliance' as const, vnetId: nvaCreationVnetId, applianceId }
                    selectCreatedEntity(entity)
                    setNvaCreationVnetId(undefined)
                  }} />}
                {vnraCreationVnetId && selectedVnetId === vnraCreationVnetId && <ManagedVnraEditor key={`create-${vnraCreationVnetId}`}
                  topology={topology} vnetId={vnraCreationVnetId} commit={commitTopology}
                  onCancel={() => setVnraCreationVnetId(undefined)} onSaved={(applianceId) => {
                    const entity = { kind: 'appliance' as const, vnetId: vnraCreationVnetId, applianceId }
                    selectCreatedEntity(entity)
                    setVnraCreationVnetId(undefined)
                  }} />}
                </Suspense>
              </>
              )
              const peeringEditor = showPeeringEditor && (
                <InspectorSection key={guidanceNavigation && selected.kind === 'peering' ? `peerings-${guidanceRevision}` : 'peerings'} title={t('VNet peerings')}
                  summary={t('{0} peerings', filteredPeerings.length)} initialOpen={guidanceNavigation && selected.kind === 'peering'}>
                <div className="aznet-card" data-testid="aznet-peering-editor">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <h3 hidden={workspaceSession?.presentationPreview} style={{ margin: 0 }}>VNet Peerings & Hybrid Connections</h3>
                    {topology.vnets.length >= 2 && (
                      <button
                        type="button"
                        className="aznet-btn"
                        data-testid="aznet-create-peering-btn"
                        onClick={() => {
                          commitTopology((draft) => {
                            for (let i = 0; i < draft.vnets.length; i++) {
                              for (let j = i + 1; j < draft.vnets.length; j++) {
                                const a = draft.vnets[i]
                                const b = draft.vnets[j]
                                if (selectedVnetId && a.id !== selectedVnetId && b.id !== selectedVnetId) {
                                  continue
                                }
                                const exists = draft.vnetPeerings.some(
                                  (p) =>
                                    (p.vnetAId === a.id && p.vnetBId === b.id) ||
                                    (p.vnetAId === b.id && p.vnetBId === a.id),
                                )
                                if (!exists) {
                                  const newId = `peer-${a.id}-${b.id}-${Date.now().toString(36).slice(-3)}`
                                  const aHasGw = a.gateways.length > 0 || Boolean(a.routeServer)
                                  const bHasGw = b.gateways.length > 0 || Boolean(b.routeServer)
                                  draft.vnetPeerings.push({
                                    id: newId,
                                    name: `${a.name}-to-${b.name}`,
                                    vnetAId: a.id,
                                    vnetBId: b.id,
                                    enabled: true,
                                    aToB: {
                                      allowVirtualNetworkAccess: true,
                                      allowForwardedTraffic: true,
                                      allowGatewayTransit: a.role === 'hub' && aHasGw,
                                      useRemoteGateways: b.role === 'hub' && bHasGw && !aHasGw,
                                    },
                                    bToA: {
                                      allowVirtualNetworkAccess: true,
                                      allowForwardedTraffic: true,
                                      allowGatewayTransit: b.role === 'hub' && bHasGw,
                                      useRemoteGateways: a.role === 'hub' && aHasGw && !bHasGw,
                                    },
                                  })
                                  setSelected({ kind: 'peering', peeringId: newId })
                                  return
                                }
                              }
                            }
                          })
                        }}
                      >
                        + Add VNet Peering
                      </button>
                    )}
                  </div>

                  <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: 'var(--text)' }}>
                    💡 Hover over, click, or right-click any VNet peering line on the diagram to
                    inspect and toggle directional flags directly on the line, or select a peering
                    below:
                  </p>

                  {filteredPeerings.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      No VNet peerings configured for this selection. Right-click a VNet on the diagram and choose{' '}
                      <strong>Create VNet Peering to...</strong>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          marginBottom: 8,
                        }}
                      >
                        {filteredPeerings.map((p) => {
                          const vA = topology.vnets.find((v) => v.id === p.vnetAId)
                          const vB = topology.vnets.find((v) => v.id === p.vnetBId)
                          const isFocused =
                            (selected.kind === 'peering' && selected.peeringId === p.id) ||
                            (selected.kind !== 'peering' &&
                              filteredPeerings[0]?.id === p.id)
                          return (
                            <button
                              key={p.id}
                              type="button"
                              className={`aznet-btn ${isFocused ? 'aznet-btn-primary' : ''}`}
                              data-testid={`aznet-select-peering-${p.id}`}
                              onClick={() => setSelected({ kind: 'peering', peeringId: p.id })}
                              style={{ fontSize: 11.5, padding: '4px 8px' }}
                            >
                              {vA?.name ?? p.vnetAId} ↔ {vB?.name ?? p.vnetBId}
                              {!p.enabled ? ' (OFF)' : ''}
                            </button>
                          )
                        })}
                      </div>

                      {(() => {
                        const activePeering =
                          (selected.kind === 'peering'
                            ? filteredPeerings.find((p) => p.id === selected.peeringId)
                            : undefined) ?? filteredPeerings[0]
                        if (!activePeering) return null
                        const vA = topology.vnets.find((v) => v.id === activePeering.vnetAId)
                        const vB = topology.vnets.find((v) => v.id === activePeering.vnetBId)
                        const aHasGwOrArs = Boolean((vA?.gateways.length ?? 0) > 0 || vA?.routeServer)
                        const bHasGwOrArs = Boolean((vB?.gateways.length ?? 0) > 0 || vB?.routeServer)
                        const renderDirFlags = (
                          label: string,
                          dirKey: 'aToB' | 'bToA',
                          flags: AzPeeringDirectionFlags,
                        ) => {
                          const localHasGwOrArs = dirKey === 'aToB' ? aHasGwOrArs : bHasGwOrArs
                          const remoteHasGwOrArs = dirKey === 'aToB' ? bHasGwOrArs : aHasGwOrArs
                          const remoteFlags = dirKey === 'aToB' ? activePeering.bToA : activePeering.aToB
                          return (
                            <div
                              style={{
                                padding: 8,
                                background: 'var(--surface)',
                                borderRadius: 6,
                                border: '1px solid var(--border)',
                              }}
                            >
                              <div style={{ fontWeight: 700, fontSize: 11.5, marginBottom: 4 }}>
                                {label}
                              </div>
                              {(
                                [
                                  ['allowVirtualNetworkAccess', 'Allow VNet Access'],
                                  ['allowForwardedTraffic', 'Allow Forwarded Traffic'],
                                  ['allowGatewayTransit', 'Allow Gateway Transit'],
                                  ['useRemoteGateways', 'Use Remote Gateways'],
                                ] as const
                              ).map(([flagName, flagLabel]) => {
                                const disabledReason =
                                  flagName === 'allowGatewayTransit' && !localHasGwOrArs
                                    ? 'Requires a VNet Gateway or Route Server in the local VNet'
                                    : flagName === 'useRemoteGateways' && localHasGwOrArs
                                      ? 'Cannot enable Use Remote Gateways on a VNet that has its own Gateway or Route Server'
                                      : flagName === 'useRemoteGateways' && !remoteHasGwOrArs
                                        ? 'Remote VNet has no Gateway or Route Server'
                                        : flagName === 'useRemoteGateways' && !remoteFlags.allowGatewayTransit
                                          ? 'Requires Allow Gateway Transit on the remote peering direction'
                                          : null
                                const isDisabled = Boolean(disabledReason && !flags[flagName])
                                return (
                                  <label
                                    key={flagName}
                                    className="aznet-checkbox-row"
                                    title={disabledReason ?? undefined}
                                    style={isDisabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={isDisabled}
                                      checked={flags[flagName]}
                                      onChange={(e) => {
                                        const checked = e.target.checked
                                        commitTopology((draft) => {
                                          const p = draft.vnetPeerings.find(
                                            (x) => x.id === activePeering.id,
                                          )
                                          if (p) {
                                            p[dirKey][flagName] = checked
                                            if (flagName === 'allowGatewayTransit' && !checked) {
                                              const oppositeKey = dirKey === 'aToB' ? 'bToA' : 'aToB'
                                              p[oppositeKey].useRemoteGateways = false
                                            }
                                          }
                                        })
                                      }}
                                    />
                                    <span>{flagLabel}</span>
                                  </label>
                                )
                              })}
                            </div>
                          )
                        }
                        return (
                          <div
                            key={activePeering.id}
                            data-testid={`aznet-peering-card-${activePeering.id}`}
                            data-learning-anchor={guidanceAnchor('peering-editor', activePeering.id)}
                            style={{
                              padding: 10,
                              background: 'var(--surface)',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <strong>
                                {activePeering.name} ({vA?.name} ↔ {vB?.name})
                              </strong>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label className="aznet-checkbox-row">
                                  <input
                                    type="checkbox"
                                    checked={activePeering.enabled}
                                    onChange={(e) => {
                                      const checked = e.target.checked
                                      commitTopology((draft) => {
                                        const p = draft.vnetPeerings.find(
                                          (x) => x.id === activePeering.id,
                                        )
                                        if (p) p.enabled = checked
                                      })
                                    }}
                                  />
                                  <span>Peering Enabled</span>
                                </label>
                                <button
                                  type="button"
                                  className="aznet-btn"
                                  data-testid={`aznet-delete-peering-${activePeering.id}`}
                                  style={{
                                    padding: '2px 8px',
                                    fontSize: 11,
                                    color: 'var(--error)',
                                    borderColor: 'var(--border)',
                                  }}
                                  onClick={() => {
                                    commitTopology((draft) => {
                                      draft.vnetPeerings = draft.vnetPeerings.filter(
                                        (p) => p.id !== activePeering.id,
                                      )
                                    })
                                  }}
                                >
                                  Delete Peering
                                </button>
                              </div>
                            </div>
                            <Suspense fallback={null}><PeeringScopeEditor
                              key={`${activePeering.id}:${JSON.stringify(activePeering.scope)}:${JSON.stringify([vA?.subnets.map((subnet) => subnet.id), vB?.subnets.map((subnet) => subnet.id)])}`}
                              topology={topology} peering={activePeering} onApply={(scope) => commitTopology((draft) => {
                                const peering = draft.vnetPeerings.find((item) => item.id === activePeering.id)
                                if (peering) peering.scope = scope
                                pruneAzArsRouteMaps(draft)
                              })} /></Suspense>
                            <div className="aznet-field-grid">
                              {renderDirFlags(
                                `${vA?.name} → ${vB?.name}`,
                                'aToB',
                                activePeering.aToB,
                              )}
                              {renderDirFlags(
                                `${vB?.name} → ${vA?.name}`,
                                'bToA',
                                activePeering.bToA,
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>
                </InspectorSection>
              )
              const vnetEditor = showVnetEditor && (
                <InspectorSection key={`vnet-${selectedVnetId}`} title={t('VNet configuration')}
                  summary={filteredVnets.map(vnet => `${vnet.name} · ${vnet.prefixes.join(', ')}`).join('; ')}
                  initialOpen={guidanceNavigation && selected.kind === 'vnet' || selected.kind === 'gateway' || selected.kind === 'route-server'}>
                <div className="aznet-card" data-testid="aznet-vnet-elements-editor">
                  <h3 hidden={workspaceSession?.presentationPreview}>VNets & VNet Elements (Region, Gateways, ARS, Firewall/NVA, Subnets)</h3>
                  {filteredVnets.map((vnet) => {
                    const usesRemoteGw = vnetUsesRemoteGateways(vnet.id)
                    return (
                      <div
                        key={vnet.id}
                        data-testid={`aznet-vnet-config-${vnet.id}`}
                        data-learning-anchor={guidanceAnchor('network-editor', vnet.id)}
                        style={{
                          marginBottom: 10,
                          padding: 10,
                          background: 'var(--surface)',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                        }}
                      >
                        <Suspense fallback={null}>
                          <VnetRoutingSettings topology={topology} vnet={vnet} preview={workspaceSession?.presentationPreview}
                            usesRemoteGateways={usesRemoteGw} onTopologyChange={commitTopology}
                            onDeleteVnet={() => deleteVnetById(vnet.id)}
                            onAddGateway={(kind) => addGatewayToVnet(vnet.id, kind)}
                            onRemoveGateway={(id) => removeGatewayFromVnet(vnet.id, id)}
                            onAddRouteServer={() => addRouteServerToVnet(vnet.id)}
                            onRemoveRouteServer={() => removeRouteServerFromVnet(vnet.id)}
                            onAddFirewall={() => addFirewallToVnet(vnet.id)}
                            onAddNva={() => openNvaCreation(vnet.id)}
                            onAddVnra={() => openVnraCreation(vnet.id)}
                            onConfigureVnra={(id) => {
                              setSelected({ kind: 'appliance', vnetId: vnet.id, applianceId: id })
                              setActiveTab('editor')
                            }}
                            onRemoveAppliance={(id) => removeApplianceFromVnet(vnet.id, id)} />
                        </Suspense>
                      </div>
                    )
                  })}
                </div>
                </InspectorSection>
              )
              const routeTableEditor = showVnetEditor && (
                <Suspense key={`routes-${selectedVnetId}`} fallback={null}><UdrTablesEditor topology={topology}
                  selected={selected} selectedVnetId={selectedVnetId} initialOpen={guidanceNavigation && selected.kind === 'subnet'}
                  commit={commitTopology} onClone={(cloneId) => setUdrManager({ cloneId })}
                  onLibrary={(tableId) => setUdrManager(tableId ? { tableId } : {})}
                  onCreate={() => selected.kind === 'subnet'
                    ? createAndAssociateRouteTable(selected.vnetId, selected.subnetId)
                    : createAndAssociateRouteTable()}
                  anchor={selected.kind === 'subnet' ? { vnetId: selected.vnetId, subnetId: selected.subnetId } : undefined} /></Suspense>
              )
              const subnetEditor = showVnetEditor && (
                <InspectorSection key={`subnets-${selectedVnetId}`} title={t('Subnet configuration')}
                  summary={t('{0} subnets', selected.kind === 'subnet' ? 1 : filteredVnets.reduce((count, vnet) => count + vnet.subnets.length, 0))}
                  initialOpen={!guidanceNavigation && selected.kind === 'subnet'}>
                <div className="aznet-card" data-testid="aznet-subnet-security-editor">
                  <h3 hidden={workspaceSession?.presentationPreview}>Subnets: Create, Rename, Route Table, Private Endpoint & Outbound Policies</h3>
                  <p className="aznet-muted" style={{ fontSize: 11.5 }}>{t('These settings do not prove Internet or private-service reachability.')}</p>
                  {filteredVnets.map((vnet) => {
                    const subnetsToShow =
                      selected.kind === 'subnet' && selected.vnetId === vnet.id
                        ? vnet.subnets.filter((s) => s.id === selected.subnetId)
                        : vnet.subnets
                    return (
                    <div
                      key={vnet.id}
                      style={{
                        marginBottom: 8,
                        padding: 8,
                        background: 'var(--surface)',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong>{vnet.name}</strong>
                          {selected.kind === 'subnet' && selected.vnetId === vnet.id && vnet.subnets.length > 1 && (
                            <button
                              type="button"
                              className="aznet-btn"
                              style={{ fontSize: 10.5, padding: '1px 6px' }}
                              onClick={() => setSelected({ kind: 'vnet', vnetId: vnet.id })}
                            >
                              Show All {vnet.subnets.length} Subnets in {vnet.name}
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          className="aznet-btn"
                          data-testid={`aznet-add-subnet-${vnet.id}`}
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => addSubnetToVnet(vnet.id)}
                        >
                          + Add Subnet
                        </button>
                      </div>
                      {subnetsToShow.map((subnet) => (
                        <div
                          key={subnet.id}
                          data-testid={`aznet-subnet-row-${subnet.id}`}
                          style={{
                            marginTop: 8,
                            padding: 8,
                            background: 'var(--surface)',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            fontSize: 12,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}
                          >
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <label className="presentation-vnet-field"><span hidden={!workspaceSession?.presentationPreview}>{t('Subnet name')}</span>
                              <input
                                type="text"
                                className="aznet-input"
                                data-testid={`aznet-subnet-name-${subnet.id}`}
                                aria-label={t('Subnet name {0}', subnet.name)}
                                value={subnet.name}
                                onChange={(e) => {
                                  const val = e.target.value
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                                    if (targetS) targetS.name = val
                                  })
                                }}
                                style={{ fontWeight: 700, width: 145 }}
                              />
                              </label>
                              <Suspense fallback={null}><SubnetPrefixEditor topology={topology} vnet={vnet} subnet={subnet}
                                preview={workspaceSession?.presentationPreview} onChange={commitTopology} /></Suspense>
                              <label
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5 }}
                              >
                                <span>{t('Route Table:')}</span>
                                <select
                                  className="aznet-select"
                                  data-testid={`aznet-subnet-rt-select-${subnet.id}`}
                                  value={subnet.routeTableId ?? ''}
                                  onChange={(e) => {
                                    const nextVal = e.target.value
                                    if (nextVal === '__create__') {
                                      createAndAssociateRouteTable(vnet.id, subnet.id)
                                      return
                                    }
                                    commitTopology((draft) => {
                                      const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                      const targetS = targetV?.subnets.find(
                                        (s) => s.id === subnet.id,
                                      )
                                      if (targetS) {
                                        targetS.routeTableId = nextVal || undefined
                                      }
                                    })
                                  }}
                                >
                                  <option value="">None (No Route Table)</option>
                                  {topology.udrTables.map((rt) => (
                                    <option key={rt.id} value={rt.id} disabled={!!udrAssociationError(topology, vnet, rt)}>
                                      {rt.name}
                                    </option>
                                  ))}
                                  <option value="__create__">+ Create & Associate New RT...</option>
                                </select>
                              </label>
                            </div>
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-delete-subnet-${subnet.id}`}
                              style={{ fontSize: 11, padding: '2px 7px', color: 'var(--error)', borderColor: 'var(--border)' }}
                              onClick={() => deleteSubnetFromVnet(vnet.id, subnet.id)}
                            >
                              Delete Subnet
                            </button>
                          </div>
                          <InspectorSection title={t('Outbound and private endpoint settings')}
                            summary={t('Default outbound: {0}; PE policies: {1}; endpoints: {2}',
                              subnet.defaultOutboundAccess === undefined ? t('Not specified') : t(subnet.defaultOutboundAccess ? 'Enabled' : 'Disabled'),
                              t(subnet.privateEndpointNetworkPolicies ?? 'Disabled'), subnet.privateEndpoints?.length ?? 0)}
                            initialOpen={subnet.defaultOutboundAccess !== undefined || subnet.internetEgressStatus === 'unknown' ||
                              !!subnet.privateEndpointNetworkPolicies && subnet.privateEndpointNetworkPolicies !== 'Disabled' || !!subnet.privateEndpoints?.length}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
                              <label className="aznet-checkbox-row">
                                <input
                                  type="checkbox"
                                  data-testid={`aznet-subnet-outbound-${subnet.id}`}
                                  checked={subnet.defaultOutboundAccess !== false}
                                  onChange={(e) => {
                                    const checked = e.target.checked
                                    commitTopology((draft) => {
                                      const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                      const targetS = targetV?.subnets.find(
                                        (s) => s.id === subnet.id,
                                      )
                                      if (targetS) targetS.defaultOutboundAccess = checked
                                    })
                                  }}
                                />
                                <span>{t('Default Outbound')}</span>
                              </label>
                              <label
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5 }}
                              >
                                <span>{t('PE Route Policies:')}</span>
                                <select
                                  className="aznet-select"
                                  data-testid={`aznet-subnet-pe-policy-${subnet.id}`}
                                  value={subnet.privateEndpointNetworkPolicies ?? 'Disabled'}
                                  onChange={(e) => {
                                    const val = e.target.value as
                                      | 'Disabled'
                                      | 'Enabled'
                                      | 'RouteTableEnabled'
                                      | 'NetworkSecurityGroupEnabled'
                                    commitTopology((draft) => {
                                      const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                      const targetS = targetV?.subnets.find(
                                        (s) => s.id === subnet.id,
                                      )
                                      if (targetS) targetS.privateEndpointNetworkPolicies = val
                                    })
                                  }}
                                >
                                  <option value="Disabled">Disabled (Default)</option>
                                  <option value="RouteTableEnabled">RouteTableEnabled</option>
                                  <option value="NetworkSecurityGroupEnabled">NetworkSecurityGroupEnabled</option>
                                  <option value="Enabled">Enabled (UDR + NSG)</option>
                                </select>
                              </label>
                              <button
                                type="button"
                                className="aznet-btn"
                                data-testid={`aznet-subnet-add-pe-${subnet.id}`}
                                style={{ fontSize: 11, padding: '2px 7px' }}
                                onClick={() => {
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    const targetS = targetV?.subnets.find(
                                      (s) => s.id === subnet.id,
                                    )
                                    if (!targetS) return
                                    targetS.privateEndpoints = targetS.privateEndpoints ?? []
                                    const peIdx = targetS.privateEndpoints.length + 1
                                    const baseIp = targetS.prefix.split('/')[0].split('.')
                                    const peIp = `${baseIp[0] ?? '10'}.${baseIp[1] ?? '0'}.${baseIp[2] ?? '1'}.${50 + peIdx}`
                                    targetS.privateEndpoints.push({
                                      id: `${targetS.id}-pe-${peIdx}-${Date.now().toString(36).slice(-3)}`,
                                      name: `pe-service-${peIdx}`,
                                      ipAddress: peIp,
                                      serviceName: `paas-${peIdx}.privatelink.azure.net`,
                                    })
                                  })
                                }}
                              >
                                {t('+ Private Endpoint')}
                              </button>
                            </div>

                          {(subnet.privateEndpoints ?? []).length > 0 && (
                            <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
                              {(subnet.privateEndpoints ?? []).map((pe) => (
                                <div
                                  key={pe.id}
                                  style={{
                                    display: 'flex',
                                    gap: 6,
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    marginTop: 4,
                                    fontSize: 11.5,
                                  }}
                                >
                                  <span>🔒 PE:</span>
                                  <input
                                    type="text"
                                    className="aznet-input"
                                    aria-label={t('Private endpoint name {0}', pe.name)}
                                    value={pe.name}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      commitTopology((draft) => {
                                        const s = draft.vnets
                                          .find((v) => v.id === vnet.id)
                                          ?.subnets.find((x) => x.id === subnet.id)
                                        const targetPe = s?.privateEndpoints?.find((x) => x.id === pe.id)
                                        if (targetPe) targetPe.name = val
                                      })
                                    }}
                                    style={{ width: 120 }}
                                  />
                                  <input
                                    type="text"
                                    className="aznet-input"
                                    aria-label={t('Private endpoint address {0}', pe.name)}
                                    value={pe.ipAddress}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      commitTopology((draft) => {
                                        const s = draft.vnets
                                          .find((v) => v.id === vnet.id)
                                          ?.subnets.find((x) => x.id === subnet.id)
                                        const targetPe = s?.privateEndpoints?.find((x) => x.id === pe.id)
                                        if (targetPe) targetPe.ipAddress = val
                                      })
                                    }}
                                    style={{ width: 105, fontFamily: 'monospace' }}
                                  />
                                  <button
                                    type="button"
                                    className="aznet-btn"
                                    aria-label={t('Remove private endpoint {0}', pe.name)}
                                    style={{ fontSize: 10.5, padding: '1px 6px', color: 'var(--error)' }}
                                    onClick={() => {
                                      commitTopology((draft) => {
                                        const s = draft.vnets
                                          .find((v) => v.id === vnet.id)
                                          ?.subnets.find((x) => x.id === subnet.id)
                                        if (s?.privateEndpoints) {
                                          s.privateEndpoints = s.privateEndpoints.filter(
                                            (x) => x.id !== pe.id,
                                          )
                                        }
                                      })
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          </InspectorSection>
                          {subnet.internetEgressStatus === 'unknown' && <p role="status">{t('Outbound capture is incomplete. Internet access is not assessed.')}</p>}
                        </div>
                      ))}
                    </div>
                  )})}
                </div>
                </InspectorSection>
              )
              return (
              <div key={workspaceIdentityKey(azWorkspaceIdentity(selected))} data-configuration-scope>
                <Suspense fallback={null}><ConfigurationEditStatus /></Suspense>
                {context}
                {vnetEditor}
                {subnetEditor}
                {peeringEditor}
                {routeTableEditor}
                {(showSiteEditor || showErEditor) && (
                <InspectorSection key={selected.kind} title={t(showSiteEditor ? 'On-premises site configuration' : 'ExpressRoute location configuration')}
                  summary={selected.kind === 'site' ? topology.sites.find(site => site.id === selected.siteId)?.name ?? ''
                    : selected.kind === 'er-location' ? topology.erLocations.find(location => location.id === selected.locationId)?.name ?? '' : ''} initialOpen={false}>
                <div className="aznet-card" data-testid="aznet-sites-er-editor">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <h3 hidden={workspaceSession?.presentationPreview} style={{ margin: 0 }}>
                      {showSiteEditor
                        ? 'On-Premises Site Configuration'
                        : 'ExpressRoute Peering Location Configuration'}
                    </h3>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {showSiteEditor && (
                        <button
                          type="button"
                          className="aznet-btn"
                          data-testid="aznet-editor-add-site-btn"
                          onClick={() => addSiteNode()}
                        >
                          + Add Site
                        </button>
                      )}
                      {showErEditor && (
                        <button
                          type="button"
                          className="aznet-btn"
                          data-testid="aznet-editor-add-erloc-btn"
                          onClick={() => addErLocationNode()}
                        >
                          + Add ER location
                        </button>
                      )}
                    </div>
                  </div>

                  {showSiteEditor &&
                    topology.sites
                      .filter((s) => selected.kind !== 'site' || s.id === selected.siteId)
                      .map((site) => (
                        <div
                          key={site.id}
                          data-testid={`aznet-site-config-${site.id}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 8,
                            padding: 8,
                            marginBottom: 6,
                            background: 'var(--surface)',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              className="aznet-input"
                              value={site.name}
                              aria-label={`Site name ${site.name}`}
                              onChange={(e) => {
                                const val = e.target.value
                                commitTopology((draft) => {
                                  const s = draft.sites.find((x) => x.id === site.id)
                                  if (s) s.name = val
                                })
                              }}
                              style={{ fontWeight: 700, width: 145 }}
                            />
                            <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                              ASN:
                              <input
                                type="number"
                                className="aznet-input"
                                key={`${site.id}:${site.asn}`}
                                defaultValue={site.asn}
                                data-configuration-saved={String(site.asn)}
                                required min={1} max={4294967294} step={1}
                                onBlur={(e) => {
                                  if (!e.currentTarget.reportValidity()) return
                                  const asn = e.currentTarget.valueAsNumber
                                  if (asn === site.asn) return
                                  commitTopology((draft) => {
                                    const s = draft.sites.find((x) => x.id === site.id)
                                    if (s) s.asn = asn
                                  })
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                style={{ width: 75 }}
                              />
                              <small className="configuration-save-hint">{t('Save on blur')}</small>
                            </label>
                            <Suspense fallback={null}><SitePrefixEditor site={site} onChange={commitTopology} /></Suspense>
                          </div>
                          <button
                            type="button"
                            className="aznet-btn"
                            data-testid={`aznet-delete-site-${site.id}`}
                            style={{
                              padding: '2px 8px',
                              fontSize: 11,
                              color: 'var(--error)',
                              borderColor: 'var(--border)',
                            }}
                            onClick={() => deleteSiteById(site.id)}
                          >
                            Delete Site
                          </button>
                        </div>
                      ))}

                  {showErEditor &&
                    topology.erLocations
                      .filter((l) => selected.kind !== 'er-location' || l.id === selected.locationId)
                      .map((loc) => (
                        <div
                          key={loc.id}
                          data-testid={`aznet-erloc-config-${loc.id}`}
                          style={{
                            padding: 10,
                            marginBottom: 6,
                            background: 'var(--surface)',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                type="text"
                                className="aznet-input"
                                value={loc.name}
                                aria-label={`ER Location name ${loc.name}`}
                                onChange={(e) => {
                                  const val = e.target.value
                                  commitTopology((draft) => {
                                    const l = draft.erLocations.find((x) => x.id === loc.id)
                                    if (l) {
                                      l.peeringLocation ??= findErPeeringLocationEntry(l.name)?.name
                                      l.name = val
                                    }
                                  })
                                }}
                                style={{ fontWeight: 700, width: 165 }}
                              />
                              <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>ER location:</span>
                                <select
                                  className="aznet-select"
                                  data-testid={`aznet-erloc-peering-location-${loc.id}`}
                                  aria-label={`ER peering location ${loc.name}`}
                                  value={findErPeeringLocationEntry(loc.peeringLocation ?? loc.name)?.name ?? ''}
                                  onChange={(e) => {
                                    const peeringLocation = e.target.value
                                    commitTopology((draft) => {
                                      const l = draft.erLocations.find((x) => x.id === loc.id)
                                      if (l) l.peeringLocation = peeringLocation
                                    })
                                  }}
                                  style={{ width: 210 }}
                                >
                                  <option value="" disabled>
                                    {loc.peeringLocation ? `Unknown location: ${loc.peeringLocation}` : 'Select ER peering location'}
                                  </option>
                                  {ER_PEERING_LOCATIONS_CATALOG.map((entry) => (
                                    <option key={entry.name} value={entry.name}>
                                      {entry.name} ({entry.geopoliticalRegion})
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>SKU:</span>
                                <select
                                  className="aznet-select"
                                  data-testid={`aznet-erloc-sku-${loc.id}`}
                                  value={loc.sku ?? 'Standard'}
                                  onChange={(e) => {
                                    const nextSku = e.target.value as AzErCircuitSku
                                    commitTopology((draft) => {
                                      const l = draft.erLocations.find((x) => x.id === loc.id)
                                      if (l) l.sku = nextSku
                                    })
                                  }}
                                >
                                  <option value="Local">Local</option>
                                  <option value="Standard">Standard</option>
                                  <option value="Premium">Premium</option>
                                </select>
                              </label>
                              <label className="aznet-checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={loc.globalReachEnabled}
                                  onChange={(e) => {
                                    const checked = e.target.checked
                                    commitTopology((draft) => {
                                      const l = draft.erLocations.find((x) => x.id === loc.id)
                                      if (l) l.globalReachEnabled = checked
                                    })
                                  }}
                                />
                                <span>Global Reach (Intra-Location)</span>
                              </label>
                              <button
                                type="button"
                                className="aznet-btn"
                                data-testid={`aznet-erloc-info-btn-${loc.id}`}
                                style={{ fontSize: 11, padding: '2px 8px' }}
                                onClick={() =>
                                  setErLocationModalState({
                                    open: true,
                                    hasOpened: true,
                                    targetLocationId: loc.id,
                                    locationName: loc.peeringLocation ?? loc.name,
                                    sku: loc.sku ?? 'Standard',
                                  })
                                }
                              >
                                📍 Show ER Location Info
                              </button>
                            </div>
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-delete-erloc-${loc.id}`}
                              style={{
                                padding: '2px 8px',
                                fontSize: 11,
                                color: 'var(--error)',
                                borderColor: 'var(--border)',
                              }}
                              onClick={() => deleteErLocationById(loc.id)}
                            >
                              Delete ER location
                            </button>
                          </div>

                          {/* Cross-location Global Reach Links (#45) */}
                          {topology.erLocations.length > 1 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                                ExpressRoute Global Reach (Cross-Location Circuit Peering):
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {topology.erLocations
                                  .filter((other) => other.id !== loc.id)
                                  .map((other) => {
                                    const existingGr = (topology.erGlobalReachLinks ?? []).find(
                                      (gr) =>
                                        (gr.locationAId === loc.id && gr.locationBId === other.id) ||
                                        (gr.locationAId === other.id && gr.locationBId === loc.id),
                                    )
                                    return (
                                      <button
                                        key={other.id}
                                        type="button"
                                        data-testid={`aznet-toggle-gr-${loc.id}-${other.id}`}
                                        className={`aznet-btn ${existingGr?.enabled ? 'aznet-btn-primary' : ''}`}
                                        style={{ fontSize: 11, padding: '3px 8px' }}
                                        onClick={() => {
                                          commitTopology((draft) => {
                                            draft.erGlobalReachLinks = draft.erGlobalReachLinks ?? []
                                            const idx = draft.erGlobalReachLinks.findIndex(
                                              (gr) =>
                                                (gr.locationAId === loc.id &&
                                                  gr.locationBId === other.id) ||
                                                (gr.locationAId === other.id &&
                                                  gr.locationBId === loc.id),
                                            )
                                            if (idx >= 0) {
                                              draft.erGlobalReachLinks.splice(idx, 1)
                                            } else {
                                              draft.erGlobalReachLinks.push({
                                                id: `ergr-${loc.id}-${other.id}-${Date.now().toString(36).slice(-3)}`,
                                                name: `${loc.name}-gr-${other.name}`,
                                                locationAId: loc.id,
                                                locationBId: other.id,
                                                enabled: true,
                                              })
                                            }
                                          })
                                        }}
                                      >
                                        {existingGr?.enabled ? '✓ Global Reach: ' : '+ Global Reach to '}
                                        {other.name}
                                      </button>
                                    )
                                  })}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                </div>
                </InspectorSection>
                )}

                {showVwanHubEditor &&
                  topology.vwanHubs
                    .filter((h) => selected.kind !== 'vwan-hub' || h.id === selected.hubId)
                    .map((hub) => (
                      <Suspense key={hub.id} fallback={null}><HubConfiguration hub={hub} topology={topology}
                        commit={commitTopology} onAttach={(vnetId) => attachVnetToHub(vnetId, hub.id)}
                        focusFirewall={firewallEditorHubId === hub.id} initialOpen={guidanceNavigation}
                        learningAnchor={guidanceAnchor('hub-editor', hub.id)} onFirewallSnat={() => setSnatHubId(hub.id)}
                        onError={setWorkspaceNotice} onClose={() => setActiveTab(null)} /></Suspense>
                    ))}

                {/* Node Labels & Annotations (scoped to selected node #47) */}
                <InspectorSection title={t('Node labels and annotations')} summary={t('Optional diagram labels')} initialOpen={false}>
                <div className="aznet-card" data-testid="aznet-node-labels-editor">
                  <h3 hidden={workspaceSession?.presentationPreview}>Node Label & Annotation</h3>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12, color: 'var(--text)' }}>
                    Optional text label displayed as an annotation badge below the selected node.
                  </p>
                  {[
                    ...topology.vnets
                      .filter((n) => !selectedVnetId || n.id === selectedVnetId)
                      .map((n) => ({ kind: 'vnet' as const, id: n.id, name: `VNet: ${n.name}`, label: n.label ?? '' })),
                    ...topology.vwanHubs
                      .filter((n) => selected.kind === 'vwan-hub' && n.id === selected.hubId)
                      .map((n) => ({ kind: 'vwanHub' as const, id: n.id, name: `vWAN Hub: ${n.name}`, label: n.label ?? '' })),
                    ...topology.erLocations
                      .filter((n) => selected.kind === 'er-location' && n.id === selected.locationId)
                      .map((n) => ({ kind: 'erLocation' as const, id: n.id, name: `ER location: ${n.name}`, label: n.label ?? '' })),
                    ...topology.sites
                      .filter((n) => selected.kind === 'site' && n.id === selected.siteId)
                      .map((n) => ({ kind: 'site' as const, id: n.id, name: `Site: ${n.name}`, label: n.label ?? '' })),
                  ].map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="aznet-toggle-row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 160 }}>{item.name}</span>
                      <input
                        type="text"
                        maxLength={120}
                        placeholder="Optional diagram label..."
                        data-testid={`aznet-node-label-input-${item.id}`}
                        value={item.label}
                        onChange={(e) => {
                          const nextVal = e.target.value
                          commitTopology((draft) => {
                            const cleaned = nextVal.trim() ? nextVal : undefined
                            if (item.kind === 'vnet') {
                              const target = draft.vnets.find((v) => v.id === item.id)
                              if (target) target.label = cleaned
                            } else if (item.kind === 'vwanHub') {
                              const target = draft.vwanHubs.find((h) => h.id === item.id)
                              if (target) target.label = cleaned
                            } else if (item.kind === 'erLocation') {
                              const target = draft.erLocations.find((l) => l.id === item.id)
                              if (target) target.label = cleaned
                            } else if (item.kind === 'site') {
                              const target = draft.sites.find((s) => s.id === item.id)
                              if (target) target.label = cleaned
                            }
                          })
                        }}
                        style={{
                          flex: 1,
                          padding: '4px 8px',
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                        }}
                      />
                    </div>
                  ))}
                </div>
                </InspectorSection>
              </div>
              )
            })()}

            {/* TAB 5: AZURE CAPTURE IMPORT, EFFECTIVE-ROUTE COMPARISON & BICEP EXPORT */}
            {activeTab === 'azure' && (
              <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}><AzurePanel
                topology={topology} simulation={simulation} observations={captureObservations} comparison={captureComparison}
                notices={captureNotices} stale={captureRevision !== baselineRevision} capture={originalCapture}
                onCaptured={(observations, comparison, warnings, capture) => {
                  setCaptureObservations(observations); setCaptureComparison(comparison); setCaptureNotices(warnings); setCaptureRevision(baselineRevision)
                  setOriginalCapture(capture)
                }} onComparison={(report) => { setCaptureComparison(report); setCaptureRevision(baselineRevision) }}
                onBundleImport={({ source, manifest }) => {
                  if (source.mode !== 'azure-network') throw new Error('Expected an Azure networking issue bundle.')
                  applyLoadedTopology('', source.topology)
                  setCaptureObservations(source.observations); setCaptureComparison(source.comparison)
                  setOriginalCapture(source.capture)
                  setCaptureNotices([...source.notices, t('Imported historical evidence from app {0}, revision {1}. Current-engine replay is not live Azure validation.', manifest.app.version, manifest.app.revision)])
                  setCaptureRevision(azRoutingInput(source.topology).revision); setActiveTab('azure')
                }}
                onImportFile={() => fileInputRef.current?.click()} onCompareFile={() => compareFileInputRef.current?.click()} /></Suspense>
            )}
          </div>
        </CanvasOverlay>}
        </WorkspaceTabPanel>
      </div>

      {udrManager && <Suspense fallback={null}><UdrTableManager topology={topology} request={udrManager} commit={commitTopology}
        onClose={() => setUdrManager(undefined)} /></Suspense>}
      {cloneVnetId && <Suspense fallback={null}><CloneVnetDialog key={cloneVnetId} topology={topology} sourceId={cloneVnetId}
        onClose={() => setCloneVnetId(undefined)} onClone={copy => {
          if (!('gateways' in copy)) return false
          const errors = validateAzNetTopology({ ...topology, vnets: [...topology.vnets, copy] })
          if (errors.length) throw new Error(errors.join(' '))
          const committed = commitTopology(draft => { draft.vnets.push(copy) })
          if (committed) setSelected({ kind: 'vnet', vnetId: copy.id })
          return committed
        }} /></Suspense>}

      {sampleGalleryOpen && <Suspense fallback={null}><SampleGallery entries={visibleCatalogEntries} currentId={sampleId} testIdPrefix="aznet"
        hasWorkspace={topology.name !== 'Empty Topology' || !!(topology.vnets.length || topology.vwanHubs.length || topology.sites.length || topology.erLocations.length || topology.udrTables.length || topology.routeMaps?.length || topology.vnetPeerings.length || topology.erLinks.length || topology.vpnConnections.length || topology.siteLinks.length)}
        onLoad={loadSample} onExport={handleExportJson}
        onOpenCurriculum={workspaceSession?.setLearningView ? () => workspaceSession.setLearningView?.({ open: true }) : undefined}
        onClose={() => setSampleGalleryOpen(false)} /></Suspense>}

      {/* ExpressRoute Peering Locations & Providers Modal (#43, #44) */}
      {erLocationModalState.hasOpened && <Suspense fallback={null}><ErLocationInfoModal
        isOpen={erLocationModalState.open}
        initialLocationName={erLocationModalState.locationName}
        currentSku={erLocationModalState.sku}
        connectedAzureRegions={
          erLocationModalState.targetLocationId
            ? topology.erLinks
                .filter(
                  (l) =>
                    l.enabled &&
                    l.locationId === erLocationModalState.targetLocationId &&
                    (l.targetKind === 'vnet-gateway' || l.targetKind === 'vwan-hub'),
                )
                .map((l) => {
                  if (l.targetKind === 'vnet-gateway') {
                    const v = topology.vnets.find((x) => x.gateways.some((g) => g.id === l.targetId))
                    const gw = v?.gateways.find((g) => g.id === l.targetId)
                    return {
                      name: `${v?.name ?? 'VNet'} / ${gw?.name ?? l.targetId}`,
                      region: v?.region ?? '',
                    }
                  }
                  const h = topology.vwanHubs.find((x) => x.id === l.targetId)
                  return {
                    name: `vWAN Hub ${h?.name ?? l.targetId}`,
                    region: h?.region ?? '',
                  }
                })
            : []
        }
        onSelectLocationAndSku={
          erLocationModalState.targetLocationId
            ? (locationName, sku) => {
                const targetLocId = erLocationModalState.targetLocationId!
                commitTopology((draft) => {
                  const targetLoc = draft.erLocations.find((l) => l.id === targetLocId)
                  if (targetLoc) {
                    targetLoc.name = locationName
                    targetLoc.peeringLocation = locationName
                    targetLoc.sku = sku
                  }
                })
              }
            : undefined
        }
        onClose={() => setErLocationModalState((prev) => ({ ...prev, open: false }))}
      /></Suspense>}
    </div>
  )
}
