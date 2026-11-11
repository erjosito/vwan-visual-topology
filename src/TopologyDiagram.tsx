import { t } from './i18n'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { LayoutMode, NodePosition, ObjectSelection, RouteMapDirection, RouterSelection, Topology } from './model'
import { topologyObject, transportLabels } from './model'
import { diagnosticFlowCount, type DiagnosticsFinding } from './diagnostics'
import { isolationLinkName } from './resilience'
import type { Candidate } from './routing'
import type { GroupPath, NodePath } from './paths'
import type { SiteRoute } from './bgp'
import { diagramCurve, diagramLayout } from './diagram-layout'
import virtualWanHubIcon from './assets/azure/virtual-wan-hub.svg'
import securedHubIcon from './assets/azure/secured-virtual-hub.png'
import virtualNetworkIcon from './assets/azure/virtual-network.svg'
import expressRouteIcon from './assets/azure/expressroute.svg'
import { RouteMapPreview } from './RouteMapPreview'
import { PathMotion } from './PathMotion'
import type { MotionFlow, MotionSegment } from './PathMotion'

const destinationPalette = [
  '#0f8b78', '#2568d7', '#cf8a16', '#8054c7', '#cb5076',
  '#0087a8', '#bd6229', '#5b7f2b', '#b348a5', '#5073a6',
  '#22996b', '#6b62bd', '#b99916', '#bf635d', '#417e87',
  '#8a6c45', '#738c37', '#a36593', '#3b6b99', '#708391',
] as const

export interface DiagramContextMenu {
  selection?: ObjectSelection; x: number; y: number; invoker: SVGElement
  routeMap?: { router: RouterSelection; connectionId: string; direction: RouteMapDirection }
}
interface Props {
  faults?: import('./failures').FaultMap
  risks?: Record<string, number>; onRisk?: (id: string) => void
  issues?: DiagnosticsFinding[]; onShowIssues?: (finding: DiagnosticsFinding) => void
  topology: Topology; hubId: string; erLocationId?: string; selected: Candidate[]; selectedSiteRoutes?: SiteRoute[]
  sourceConnectionIds?: string[]; sourceSiteLinkIds?: string[]; sourceErLinkIds?: string[]; layout?: LayoutMode; zoom?: number
  paths: (NodePath | GroupPath)[]; tracing: boolean; sourceSpokeIds?: string[]; selection?: ObjectSelection
  onObjectClick: (selection: ObjectSelection) => void; onObjectContextMenu: (menu: DiagramContextMenu) => void
  onNodeMove: (id: string, position: NodePosition) => void
  onShowRouteMapRules: (router: RouterSelection, direction: RouteMapDirection, connectionId: string) => void
}

function NodeIcon({ kind, secured = false }: { kind: 'hub' | 'spoke' | 'site' | 'erLocation'; secured?: boolean }) {
  return <g className={`node-icon ${kind}${secured ? ' secured' : ''}`} aria-hidden="true" transform="translate(-79,-21)">
    {kind === 'site' ? <><circle r="13" /><path d="M -7 7 V -7 H 2 V -2 H 7 V 7 Z M -3 -3 H -1 M -3 1 H -1 M -3 5 H -1 M 3 2 H 5" /></>
      : <image href={kind === 'hub' ? secured ? securedHubIcon : virtualWanHubIcon : kind === 'erLocation' ? expressRouteIcon : virtualNetworkIcon} x="-14" y="-14" width="28" height="28" preserveAspectRatio="xMidYMid meet" />}
  </g>
}

function SpokeNvaIcon({ spokeId }: { spokeId: string }) {
  return <g className="node-icon spoke-nva-icon" data-testid={`spoke-nva-icon-${spokeId}`} aria-hidden="true" transform="translate(-79,17)">
    <circle r="12" />
    <path d="M -6 0 H 6 M 0 -6 V 6 M -3 -3 L -6 0 L -3 3 M 3 -3 L 6 0 L 3 3" />
  </g>
}

export function TopologyDiagram({ topology, faults = {}, risks = {}, onRisk, issues = [], onShowIssues, hubId, erLocationId, selected, selectedSiteRoutes, sourceSiteLinkIds = [], sourceConnectionIds = [], sourceErLinkIds = [], layout = 'layered', zoom = 1, paths, sourceSpokeIds = [], tracing, selection, onObjectClick, onObjectContextMenu, onNodeMove, onShowRouteMapRules }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [preview, setPreview] = useState<{ owner: RouterSelection; connectionId: string; direction: RouteMapDirection; anchor: SVGGElement }>()
  const previewId = useId()
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelPreviewClose = () => clearTimeout(previewTimer.current)
  const closePreview = () => { cancelPreviewClose(); setPreview(undefined) }
  const leavePreview = () => {
    if (preview?.anchor === document.activeElement) return
    cancelPreviewClose()
    previewTimer.current = setTimeout(() => setPreview(undefined), 150)
  }
  useEffect(() => () => clearTimeout(previewTimer.current), [])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(scroll.current!)
    return () => observer.disconnect()
  }, [])
  const drag = useRef<{ id: string; kind: ObjectSelection['kind']; start: NodePosition; origin: NodePosition; moved: boolean } | undefined>(undefined)
  const suppressClick = useRef(false)
  const [moving, setMoving] = useState<{ id: string; position: NodePosition }>()
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const panDrag = useRef<{ pointerId: number; start: NodePosition; origin: NodePosition; unitsPerPixel: number } | undefined>(undefined)
  const { positions, width: layoutWidth, height: layoutHeight } = diagramLayout(topology, layout)
  const nvaSiteMap = new Map(topology.connections.filter((c) => c.transport === 'SpokeNVA' && c.spokeId).map((c) => [c.siteId, c.spokeId!]))
  const visualId = (id: string) => nvaSiteMap.get(id) ?? id
  const pixelWidth = Math.max(viewport.width, Math.min(layoutWidth, 1200))
  const pixelHeight = Math.max(viewport.height, 560)
  const scale = Math.min(pixelWidth / layoutWidth, pixelHeight / layoutHeight)
  const width = pixelWidth / scale, height = pixelHeight / scale
  if (moving) {
    positions.set(moving.id, moving.position)
    for (const [siteId, spokeId] of nvaSiteMap) {
      if (spokeId === moving.id) positions.set(siteId, moving.position)
    }
  }
  const point = (id: string) => positions.get(id)!
  const hubSize = { x: 112, y: 48 }, nodeSize = { x: 94, y: 44 }
  const exitsHub = (path: NodePath) => path.termination !== 'summary-hole'
  const activeConnections = new Set(tracing ? [...paths.filter(exitsHub).map((p) => p.connectionId).filter(Boolean), ...sourceConnectionIds] : selected.map((r) => r.connectionId))
  const activeErLinks = new Set(tracing ? [...paths.filter(exitsHub).flatMap((path) => path.erLinkIds ?? []), ...sourceErLinkIds] : selected.flatMap((route) => [route.erHubLinkId, route.erSiteLinkId].filter(Boolean)))
  const edgeKey = (a: string, b: string) => [a, b].sort().join(':')
  const policyLinks = [
    ...topology.connections.map((connection) => {
      if (connection.transport === 'SpokeNVA' && connection.spokeId) {
        return {
          ...connection, curve: diagramCurve(point(connection.spokeId), point(connection.hubId), nodeSize, hubSize, 12), side: -1,
          endpoints: [{ kind: 'site', id: connection.siteId }] as RouterSelection[],
        }
      }
      const siblings = topology.connections.filter((c) => c.transport !== 'SpokeNVA' && c.hubId === connection.hubId && c.siteId === connection.siteId)
      const bend = siblings.length === 1 ? 18 : (siblings.findIndex((c) => c.id === connection.id) - (siblings.length - 1) / 2) * 85
      return { ...connection, curve: diagramCurve(point(connection.hubId), point(connection.siteId), hubSize, nodeSize, bend), side: bend < 0 ? -1 : 1,
        endpoints: [{ kind: 'hub', id: connection.hubId }, { kind: 'site', id: connection.siteId }] as RouterSelection[] }
    }),
    ...topology.spokes.filter((spoke): spoke is typeof spoke & { hubId: string } => Boolean(spoke.hubId)).map((spoke) => ({
      id: spoke.id, name: spoke.name, enabled: true, curve: diagramCurve(point(spoke.id), point(spoke.hubId), nodeSize, hubSize, 12), side: 1,
      endpoints: [{ kind: 'hub', id: spoke.hubId }] as RouterSelection[],
    })),
    ...topology.siteLinks.map((link) => {
      const siblings = topology.siteLinks.filter((l) => edgeKey(visualId(l.a), visualId(l.b)) === edgeKey(visualId(link.a), visualId(link.b)))
      const bend = 65 + siblings.findIndex((l) => l.id === link.id) * 60
      return { ...link, curve: diagramCurve(point(link.a), point(link.b), nodeSize, nodeSize, bend), side: 1,
        endpoints: [{ kind: 'site', id: link.a }, { kind: 'site', id: link.b }] as RouterSelection[] }
    }),
    ...(topology.erLinks ?? []).map((link) => {
      const owner: RouterSelection = link.hubId ? { kind: 'hub', id: link.hubId } : { kind: 'site', id: link.siteId! }
      const siblings = (topology.erLinks ?? []).filter((other) => other.locationId === link.locationId && other.hubId === link.hubId && other.siteId === link.siteId)
      const bend = 18 + siblings.findIndex((other) => other.id === link.id) * 65
      return { ...link, curve: diagramCurve(point(owner.id), point(link.locationId), link.hubId ? hubSize : nodeSize, nodeSize, bend), side: 1, endpoints: [owner] }
    }),
  ]
  const curves = new Map(policyLinks.map((link) => [link.id, link.curve]))
  const markerSlots = new Map<string, number>()
  const previewNode = preview && (preview.owner.kind === 'hub' ? topology.hubs : topology.sites).find((node) => node.id === preview.owner.id)
  const previewLink = preview && policyLinks.find((link) => link.id === preview.connectionId)
  const previewMapId = previewNode?.routeMapAssignments?.find((assignment) => assignment.connectionId === preview?.connectionId)?.[`${preview!.direction}MapId`]
  const previewMap = topology.routeMaps?.find((map) => map.id === previewMapId)
  const activeHubEdges = new Set<string>()
  if (tracing) paths.forEach((p) => p.hubs.slice(1).forEach((id, i) => activeHubEdges.add(edgeKey(p.hubs[i], id))))
  else selected.filter((r) => r.remote).forEach((r) => activeHubEdges.add(edgeKey(hubId, r.originHubId)))
  const exactSiteLinks = new Set(tracing ? [...paths.filter(exitsHub).flatMap((p) => p.siteLinkIds ?? []), ...sourceSiteLinkIds] : (selectedSiteRoutes ?? selected).flatMap((r) => r.siteLinkIds ?? []))
  const motionEdges = new Map<string, { a: string; b: string; curve: ReturnType<typeof diagramCurve> }>()
  topology.connections.filter((link) => link.enabled && link.transport !== 'SpokeNVA').forEach((link) => motionEdges.set(link.id, { a: link.hubId, b: link.siteId, curve: curves.get(link.id)! }))
  topology.siteLinks.filter((link) => link.enabled).forEach((link) => motionEdges.set(link.id, { a: visualId(link.a), b: visualId(link.b), curve: curves.get(link.id)! }))
  topology.erLinks?.filter((link) => link.enabled).forEach((link) => motionEdges.set(link.id, { a: link.hubId ?? visualId(link.siteId!), b: link.locationId, curve: curves.get(link.id)! }))
  topology.spokes.filter((spoke): spoke is typeof spoke & { hubId: string } => Boolean(spoke.hubId)).forEach((spoke) => motionEdges.set(spoke.id, { a: spoke.id, b: spoke.hubId, curve: diagramCurve(point(spoke.id), point(spoke.hubId), nodeSize, hubSize, 12) }))
  topology.spokes.forEach((spoke) => (spoke.nvaSpokeIds ?? []).forEach((nvaSpokeId) => {
    if (positions.has(spoke.id) && positions.has(nvaSpokeId)) {
      motionEdges.set(`vnet-nva:${spoke.id}:${nvaSpokeId}`, { a: spoke.id, b: nvaSpokeId, curve: diagramCurve(point(spoke.id), point(nvaSpokeId), nodeSize, nodeSize, 18) })
    }
  }))
  topology.hubs.forEach((hub, i) => topology.hubs.slice(i + 1).forEach((other) => motionEdges.set(`interhub:${edgeKey(hub.id, other.id)}`, {
    a: hub.id, b: other.id, curve: diagramCurve(point(hub.id), point(other.id), hubSize, hubSize, -35),
  })))
  const flows: MotionFlow[] = []
  const stops = new Set<string>()
  let flow: MotionSegment[] = []
  let destinationId: string | undefined, direction: MotionFlow['direction']
  const finishFlow = (stopped = false) => {
    if (flow.length) flows.push({ segments: flow, destinationId: destinationId ?? flow.at(-1)!.to, direction, stopped })
    flow = []
  }
  const direct = (id: string | undefined, from: string | undefined) => {
    if (!id || !from) return
    const edge = motionEdges.get(id)
    if (!edge || (from !== edge.a && from !== edge.b)) return
    if (flow.length && flow.at(-1)!.to !== from) finishFlow()
    flow.push({
      id, from, to: from === edge.a ? edge.b : edge.a, control: edge.curve.control,
      start: from === edge.a ? edge.curve.start : edge.curve.end,
      end: from === edge.a ? edge.curve.end : edge.curve.start,
    })
  }
  const siteTravel = (links: string[] = [], hops: string[] = []) => links.forEach((id, i) => direct(id, visualId(hops[i])))
  const attachmentTravel = (id: string | undefined, inward = false) => {
    const connection = topology.connections.find((link) => link.id === id)
    const spoke = topology.spokes.find((node) => node.id === id)
    const er = topology.erLinks?.find((link) => link.id === id)
    if (connection?.spokeId) {
      direct(connection.spokeId, inward ? connection.spokeId : connection.hubId)
    } else if (connection) direct(id, inward ? connection.siteId : connection.hubId)
    else if (spoke?.hubId) direct(id, inward ? spoke.id : spoke.hubId)
    else if (er) direct(id, er.hubId ? inward ? er.locationId : er.hubId : inward ? visualId(er.siteId!) : er.locationId)
  }
  if (tracing) {
    for (const path of paths) {
      const diagnostic = 'direction' in path ? path : undefined
      destinationId = diagnostic?.targetNode?.id ? visualId(diagnostic.targetNode.id) : undefined; direction = diagnostic?.direction
      if (path.sourceSpokeId && path.sourceNvaSpokeId) {
        direct(`vnet-nva:${path.sourceSpokeId}:${path.sourceNvaSpokeId}`, path.sourceSpokeId)
      } else {
        attachmentTravel(path.sourceSpokeId, true)
      }
      siteTravel(path.sourceSiteLinkIds, path.sourceSiteHops)
      if (path.sourceErLinkIds?.length) path.sourceErLinkIds.forEach((id) => attachmentTravel(id, true))
      else attachmentTravel(path.sourceConnectionId, true)
      path.hubs.slice(1).forEach((id, i) => direct(`interhub:${edgeKey(path.hubs[i], id)}`, path.hubs[i]))
      if (exitsHub(path)) {
        if (path.erLinkIds?.length) path.erLinkIds.forEach((id) => attachmentTravel(id))
        else attachmentTravel(path.connectionId)
        siteTravel(path.siteLinkIds, path.siteHops)
        if (path.terminalKind === 'spoke' && path.siteId && !topology.spokes.find((s) => s.id === path.siteId)?.hubId) {
          const endNvaSpokeId = (path.siteHops?.length ? nvaSiteMap.get(path.siteHops.at(-1)!) : undefined) ?? path.nvaSpokeId ?? path.sourceNvaSpokeId
          if (endNvaSpokeId) direct(`vnet-nva:${path.siteId}:${endNvaSpokeId}`, endNvaSpokeId)
        }
      }
      const stopped = !!diagnostic && path.status === 'unreachable'
      const rawStop = stopped && (flow.at(-1)?.to ?? diagnostic.sourceNode?.id)
      const stop = rawStop ? visualId(rawStop) : undefined
      if (stop) stops.add(stop)
      finishFlow(stopped)
    }
  } else {
    for (const route of selected) {
      if (erLocationId) {
        const link = topology.erLinks?.find((link) => link.id === route.connectionId)
        attachmentTravel(route.connectionId, !!link?.hubId)
        siteTravel(route.siteLinkIds, route.sitePath)
        finishFlow()
        continue
      }
      const sources = topology.spokes.filter((spoke) => spoke.hubId === hubId && !activeConnections.has(spoke.id) && route.nvaSpokeId !== spoke.id)
      for (const source of sources.length ? sources : [undefined]) {
        attachmentTravel(source?.id, true)
        if (route.remote) direct(`interhub:${edgeKey(hubId, route.originHubId)}`, hubId)
        if (route.erHubLinkId && route.erSiteLinkId) {
          attachmentTravel(route.erHubLinkId); attachmentTravel(route.erSiteLinkId)
        } else attachmentTravel(route.connectionId)
        siteTravel(route.siteLinkIds, route.sitePath)
        const endNvaSpokeId = (route.sitePath?.length ? nvaSiteMap.get(route.sitePath.at(-1)!) : undefined) ?? route.nvaSpokeId
        const downstreamVnet = endNvaSpokeId ? topology.spokes.find((s) => !s.hubId && s.nvaSpokeIds?.includes(endNvaSpokeId) && s.prefixes.includes(route.prefix)) : undefined
        if (downstreamVnet && endNvaSpokeId) direct(`vnet-nva:${downstreamVnet.id}:${endNvaSpokeId}`, endNvaSpokeId)
        finishFlow()
      }
    }
    selectedSiteRoutes?.forEach((route) => { siteTravel(route.siteLinkIds, route.sitePath); finishFlow() })
  }
  const destinationColors = new Map<string, string>()
  for (const flow of flows) {
    const id = flow.destinationId
    if (!destinationColors.has(id)) destinationColors.set(id, destinationPalette[destinationColors.size % destinationPalette.length])
  }
  const destinationProps = (id: string) => {
    const color = destinationColors.get(id)
    return color ? { 'data-destination-color': color, style: { color } } : {}
  }
  const coordinates = (event: PointerEvent<SVGGElement>) => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse())
  const bound = (position: NodePosition, kind: ObjectSelection['kind']) => ({
    x: Math.round(Math.max(120, Math.min(20000, width - 130, position.x))),
    y: Math.round(Math.max(65, Math.min(20000, height - (kind === 'hub' ? 115 : 65), position.y))),
  })
  const selectable = (kind: ObjectSelection['kind'], id: string, label: string, activate = () => onObjectClick({ kind, id }), routeMap?: DiagramContextMenu['routeMap']) => ({
    role: 'button', tabIndex: 0, 'aria-label': faults[id] ? `${label} — Simulated failure: ${faults[id].map((f) => f.name).join(', ')}` : label,
    'data-simulated-failed': faults[id] ? 'true' : undefined,
    'aria-pressed': selection?.kind === kind && selection.id === id,
    onClick: () => { if (suppressClick.current) { suppressClick.current = false; return }; if (!faults[id]) activate() },
    onContextMenu: (event: MouseEvent<SVGGElement>) => {
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      onObjectContextMenu({ selection: { kind, id }, x: event.clientX, y: event.clientY, invoker: event.currentTarget, routeMap })
    },
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && positions.has(id)) {
        event.preventDefault()
        const p = point(id), step = event.shiftKey ? 30 : 10
        onNodeMove(id, bound({ x: p.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: p.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, kind))
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        onObjectContextMenu({ selection: { kind, id }, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, invoker: event.currentTarget, routeMap })
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!faults[id]) activate() }
    },
  })
  const movable = (kind: 'hub' | 'spoke' | 'site' | 'erLocation', id: string) => ({
    onPointerDown: (event: PointerEvent<SVGGElement>) => {
      if (event.button !== 0 || !event.isPrimary) return
      suppressClick.current = false
      drag.current = { id, kind, start: coordinates(event), origin: point(id), moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<SVGGElement>) => {
      const value = drag.current
      if (!value || value.id !== id) return
      const p = coordinates(event), dx = p.x - value.start.x, dy = p.y - value.start.y
      if (!value.moved && Math.hypot(dx, dy) < 4) return
      value.moved = true
      setMoving({ id, position: bound({ x: value.origin.x + dx, y: value.origin.y + dy }, kind) })
    },
    onPointerUp: (event: PointerEvent<SVGGElement>) => {
      const value = drag.current
      if (!value || value.id !== id) return
      if (value.moved) {
        const p = coordinates(event)
        suppressClick.current = true
        onNodeMove(id, bound({ x: value.origin.x + p.x - value.start.x, y: value.origin.y + p.y - value.start.y }, kind))
      }
      drag.current = undefined; setMoving(undefined)
    },
    onPointerCancel: () => { drag.current = undefined; setMoving(undefined) },
    onLostPointerCapture: () => { drag.current = undefined; setMoving(undefined) },
  })
  const badge = (text: string, p: NodePosition) => <g className="edge-badge" transform={`translate(${p.x},${p.y})`} aria-hidden="true"><rect x={-text.length * 3.2 - 7} y="-10" width={text.length * 6.4 + 14} height="20" rx="10" /><text y="3" className="link-label">{text}</text></g>
  const policyMarks = policyLinks.flatMap((link) => link.endpoints.flatMap((owner, endpoint) => {
    const node = (owner.kind === 'hub' ? topology.hubs : topology.sites).find((n) => n.id === owner.id)!
    const binding = node.routeMapAssignments?.find((a) => a.connectionId === link.id)
    const directions = (['inbound', 'outbound'] as const).filter((direction) => binding?.[`${direction}MapId`])
    return directions.map((direction, index) => {
      const nearEnd = !!endpoint || topology.spokes.some((spoke) => spoke.id === link.id)
      const p = link.curve.at(nearEnd ? 0.8 - index * 0.18 : 0.2 + index * 0.18)
      const length = Math.hypot(p.dx, p.dy)
      const normal = length ? { x: -p.dy / length * link.side, y: p.dx / length * link.side } : { x: 0, y: link.side }
      const position = { x: p.x + normal.x * 28, y: p.y + normal.y * 28 }
      const angle = Math.atan2(p.dy, p.dx) * 180 / Math.PI + ((direction === 'inbound') === nearEnd ? 0 : 180)
      const label = t("{0} route map rules for {1} on {2}", t(direction === 'inbound' ? 'Inbound' : 'Outbound'), node.name, link.name)
      return <Fragment key={`${owner.id}:${link.id}:${direction}`}>
        <g className={`policy-guide ${direction} ${link.enabled ? '' : 'is-down'}`} aria-hidden="true">
          <path d={`M ${p.x} ${p.y} L ${position.x} ${position.y}`} className="policy-leader" />
          <path transform={`translate(${p.x},${p.y}) rotate(${angle})`} d="M -9 0 H 9 M 4 -4 L 9 0 L 4 4" className="policy-arrow-halo" />
          <path transform={`translate(${p.x},${p.y}) rotate(${angle})`} d="M -9 0 H 9 M 4 -4 L 9 0 L 4 4" className="policy-arrow" />
        </g>
        <g className={`policy-marker ${direction} ${link.enabled ? '' : 'is-down'} clickable`} data-connection-id={link.id} data-router-id={owner.id} data-direction={direction} transform={`translate(${position.x},${position.y})`} {...selectable(owner.kind, owner.id, label, () => onShowRouteMapRules(owner, direction, link.id), { router: owner, connectionId: link.id, direction })} aria-pressed={undefined}
          aria-describedby={preview && preview.owner.id === owner.id && preview.connectionId === link.id && preview.direction === direction && previewMap ? previewId : undefined}
          onPointerEnter={(event) => { cancelPreviewClose(); setPreview({ owner, connectionId: link.id, direction, anchor: event.currentTarget }) }}
          onPointerLeave={leavePreview}
          onFocus={(event) => { cancelPreviewClose(); setPreview({ owner, connectionId: link.id, direction, anchor: event.currentTarget }) }}
          onBlur={closePreview}>
          <rect x="-23" y="-11" width="46" height="22" rx="7" /><path className="policy-filter" d="M -17 -5 H -7 L -10 0 V 5 L -14 3 V 0 Z" /><text x="7" y="4">{t(direction === 'inbound' ? 'IN' : 'OUT')}</text>
        </g>
      </Fragment>
    })
  }))
  const endPan = (event: PointerEvent<SVGSVGElement>) => {
    if (panDrag.current?.pointerId !== event.pointerId) return
    panDrag.current = undefined; setPanning(false)
  }
  return <><div ref={scroll} className={`diagram-scroll ${moving ? 'is-repositioning' : ''} ${panning ? 'is-panning' : ''}`} onScroll={closePreview}><svg ref={svg} className={`diagram layout-${layout}`} viewBox={`${pan.x} ${pan.y} ${width} ${height}`} style={{ width: pixelWidth * zoom, height: pixelHeight * zoom }} role="group" tabIndex={0} aria-label={t("Interactive Virtual WAN topology. Drag blank canvas to pan; drag nodes to arrange; right-click for actions. Home resets the view. Alt+Arrow keys move a focused node.")} onPointerDownCapture={closePreview}
    onPointerDown={(event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary
        || (event.target as Element).closest('g[role="button"], .network-link, .edge-badge, .policy-guide, .routing-path-stop')) return
      event.preventDefault()
      const matrix = event.currentTarget.getScreenCTM()
      if (!matrix) return
      panDrag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: pan, unitsPerPixel: 1 / matrix.a }
      setPanning(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus({ preventScroll: true })
    }}
    onPointerMove={(event) => {
      const drag = panDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      setPan({ x: drag.origin.x - (event.clientX - drag.start.x) * drag.unitsPerPixel,
        y: drag.origin.y - (event.clientY - drag.start.y) * drag.unitsPerPixel })
    }}
    onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
    onContextMenu={(event) => {
    if ((event.target as Element).closest('g[role="button"]')) return
    event.preventDefault()
    onObjectContextMenu({ x: event.clientX, y: event.clientY, invoker: event.currentTarget })
  }} onKeyDown={(event) => {
    if (event.target === event.currentTarget && event.key === 'Home') {
      event.preventDefault(); setPan({ x: 0, y: 0 }); return
    }
    if (event.target !== event.currentTarget || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    onObjectContextMenu({ x: bounds.left + 24, y: bounds.top + 24, invoker: event.currentTarget })
  }}>
    <defs>
      <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d8e2ee" /></pattern>
      <radialGradient id="constellation-glow"><stop offset="0" stopColor="#e9f1ff" /><stop offset="1" stopColor="#f8fbff" /></radialGradient>
      <linearGradient id="hub-card" x2="0" y2="1"><stop stopColor="#fff" /><stop offset="1" stopColor="#eef4ff" /></linearGradient>
    </defs>
    <rect x={pan.x} y={pan.y} width={width} height={height} fill={layout === 'constellation' ? 'url(#constellation-glow)' : 'url(#grid)'} />
    {layout === 'layered' ? <g className="diagram-captions"><text x="24" y="28" className="diagram-caption">{t("AZURE SPOKE NETWORKS")}</text><text x="24" y="225" className="diagram-caption">{t("MICROSOFT GLOBAL BACKBONE")}</text><text x="24" y="465" className="diagram-caption">{topology.erLocations?.length ? t("EXPRESSROUTE LOCATIONS") : t("ON-PREMISES SITES")}</text>{!!topology.erLocations?.length && <text x="24" y="700" className="diagram-caption">{t("ON-PREMISES SITES")}</text>}</g>
      : <g className="constellation-orbits" aria-hidden="true"><ellipse cx={width / 2} cy={height / 2} rx={width / 2 - 130} ry={height / 2 - 80} /><ellipse cx={width / 2} cy={height / 2} rx={Math.max(180, topology.hubs.length * 130)} ry="145" /><text x="24" y="30" className="diagram-caption">{t("VIRTUAL WAN · NETWORK CONSTELLATION")}</text></g>}
    {topology.hubs.flatMap((h, i) => topology.hubs.slice(i + 1).map((other) => {
      const edge = diagramCurve(point(h.id), point(other.id), hubSize, hubSize, -35)
      return <g key={edgeKey(h.id, other.id)}><path data-testid={`interhub-${h.id}-${other.id}`} className={`network-link backbone ${activeHubEdges.has(edgeKey(h.id, other.id)) ? 'preferred-link' : ''}`} d={edge.d} />{badge(t("Inter-hub"), edge.label)}</g>
    }))}
    {topology.spokes.filter((spoke): spoke is typeof spoke & { hubId: string } => Boolean(spoke.hubId)).map((spoke) => {
      const nvas = topology.connections.filter((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === spoke.id)
      const active = activeConnections.has(spoke.id) || sourceSpokeIds.includes(spoke.id)
        || nvas.some((connection) => activeConnections.has(connection.id))
        || paths.some((path) => path.nvaSpokeId === spoke.id || path.sourceNvaSpokeId === spoke.id)
        || (!tracing && spoke.hubId === hubId)
      const edge = diagramCurve(point(spoke.id), point(spoke.hubId), nodeSize, hubSize, 12)
      const nvaDown = nvas.length > 0 && nvas.every((connection) => !connection.enabled)
      return <g key={spoke.id} className="clickable" {...selectable('spoke', spoke.id, t("Edit spoke connection {0}", spoke.name))}><path className="link-hitbox" d={edge.d} /><path data-testid={`spoke-link-${spoke.id}`} className={`network-link spoke-link ${nvas.length ? 'SpokeNVA' : ''} ${active ? 'preferred-link' : ''} ${nvaDown ? 'disabled-link' : ''}`} d={edge.d} />{nvas.length > 0 && badge(`NVA BGP${nvaDown ? t(' (down)') : ''}`, edge.label)}</g>
    })}
    {topology.spokes.flatMap((spoke) => (spoke.nvaSpokeIds ?? []).map((nvaSpokeId) => {
      if (!positions.has(spoke.id) || !positions.has(nvaSpokeId)) return null
      const edge = diagramCurve(point(spoke.id), point(nvaSpokeId), nodeSize, nodeSize, 18)
      const active = tracing
        ? paths.some((path) => (path.sourceSpokeId === spoke.id && path.sourceNvaSpokeId === nvaSpokeId)
          || (path.siteId === spoke.id && (path.nvaSpokeId === nvaSpokeId || path.siteHops?.some((hopId) => nvaSiteMap.get(hopId) === nvaSpokeId))))
        : selected.some((route) => ((route.sitePath?.length ? nvaSiteMap.get(route.sitePath.at(-1)!) : undefined) ?? route.nvaSpokeId) === nvaSpokeId && spoke.prefixes.includes(route.prefix))
      return <g key={`vnet-nva:${spoke.id}:${nvaSpokeId}`} className="clickable" {...selectable('spoke', spoke.id, t("Select spoke {0}", spoke.name))}><title>{spoke.name} ↔ {topology.spokes.find((s) => s.id === nvaSpokeId)?.name ?? nvaSpokeId}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`vnet-link-${spoke.id}-${nvaSpokeId}`} className={`network-link spoke-link vnet-nva-link ${active ? 'preferred-link' : ''}`} d={edge.d} /></g>
    }))}
    {topology.connections.filter((connection) => connection.transport !== 'SpokeNVA').map((connection) => {
      const edge = curves.get(connection.id)!
      const active = connection.enabled && activeConnections.has(connection.id)
      const name = connection.transport === 'ExpressRoute' ? 'ER' : connection.transport === 'SDWAN' ? 'SD-WAN' : 'VPN'
      return <g key={connection.id} className="clickable" {...selectable('connection', connection.id, t("Edit connection {0}", connection.name))}><title>{connection.name} · {transportLabels[connection.transport]} · {connection.enabled ? active ? t("Preferred") : t("Alternative") : t("Down")}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`link-${connection.id}`} data-preferred={active} className={`network-link ${connection.transport} ${active ? 'preferred-link' : ''} ${connection.enabled ? '' : 'disabled-link'}`} d={edge.d} />{badge(`${name}${connection.enabled ? '' : t(' (down)')}`, edge.label)}</g>
    })}
    {topology.siteLinks.map((link) => {
      const edge = curves.get(link.id)!
      return <g key={link.id} className="clickable" {...selectable('siteLink', link.id, t("Select on-premises link {0}", link.name))}><title>{link.name}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`peer-link-${link.id}`} className={`network-link peer-link ${link.enabled && exactSiteLinks.has(link.id) ? 'preferred-link' : ''} ${link.enabled ? '' : 'disabled-link'}`} d={edge.d} />{badge(link.name.length > 30 ? `${link.name.slice(0, 28)}…` : link.name, edge.label)}</g>
    })}
    {(topology.erLinks ?? []).map((link) => {
      const edge = curves.get(link.id)!
      const active = link.enabled && activeErLinks.has(link.id)
      return <g key={link.id} className="clickable" {...selectable('erLink', link.id, t("Edit ER connection {0}", link.name))}><title>{link.name}  {t("· ExpressRoute ·")} {link.enabled ? t("Enabled") : t("Down")}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`er-link-${link.id}`} className={`network-link ExpressRoute ${active ? 'preferred-link' : ''} ${link.enabled ? '' : 'disabled-link'}`} d={edge.d} />{badge(`ER${link.enabled ? '' : t(' (down)')}`, edge.label)}</g>
    })}
    {(topology.erLocations ?? []).flatMap((loc) =>
      (loc.globalReachLocationIds ?? []).filter((peerId) => loc.id < peerId).map((peerId) => {
        const peer = topology.erLocations?.find((l) => l.id === peerId)
        if (!peer) return null
        const p1 = point(loc.id)
        const p2 = point(peer.id)
        const midX = (p1.x + p2.x) / 2
        const midY = (p1.y + p2.y) / 2 - 22
        const d = `M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`
        return (
          <g key={`gr-loc:${loc.id}:${peer.id}`} data-testid={`vwan-global-reach-link-${loc.id}-${peer.id}`}>
            <title>{loc.name} ↔ {peer.name} · ExpressRoute Global Reach (MSEE 12076)</title>
            <path d={d} fill="none" stroke="#a855f7" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.88" />
            {badge('Global Reach', { x: midX, y: midY })}
          </g>
        )
      })
    )}
    <PathMotion flows={flows} pixelsPerUnit={scale * zoom} colors={destinationColors} />
    {(() => {
      const renderCustomLabel = (nodeId: string, label: string | undefined, yOffset: number) => {
        const trimmed = label?.trim()
        if (!trimmed) return null
        const display = trimmed.length > 34 ? trimmed.slice(0, 32) + '…' : trimmed
        const width = Math.max(64, Math.min(220, display.length * 6.2 + 18))
        return (
          <g className="node-custom-label-group" data-testid={`node-label-${nodeId}`}>
            <rect x={-width / 2} y={yOffset - 11} width={width} height="18" rx="9" className="node-custom-label-bg" />
            <text y={yOffset + 1} className="node-custom-label">{display}</text>
          </g>
        )
      }
      return <>
    {topology.hubs.map((hub) => {
      const p = point(hub.id)
      const secured = hub.routingIntent.private || hub.routingIntent.internet
      const firewallActive = secured && (tracing ? paths.some((path) => path.firewalls?.includes(hub.id)) : hub.id === hubId)
      return <g key={hub.id} data-node-id={hub.id} {...destinationProps(hub.id)} transform={`translate(${p.x}, ${p.y})`} {...selectable('hub', hub.id, t("Select hub {0}", hub.name))} {...movable('hub', hub.id)} className={`hub-node draggable-node ${hub.id === hubId ? 'active' : ''} ${firewallActive ? 'firewall-active' : ''}`}><title>{hub.name} · {hub.region}{hub.label ? ` · ${hub.label}` : ''}{secured && t(" · Secured virtual hub · Azure Firewall ({0})", [hub.routingIntent.private && t('private traffic'), hub.routingIntent.internet && t('Internet traffic')].filter(Boolean).join(', '))}{tracing && firewallActive && t(" · Active path traverses Azure Firewall")}</title><rect x="-112" y="-48" width="224" height="96" rx="18" /><NodeIcon kind="hub" secured={secured} /><text x="12" y="-19" className="node-kind">{secured ? t("SECURED VIRTUAL HUB") : t("VIRTUAL HUB")}</text><text y="6" className="node-name">{hub.name.length > 25 ? hub.name.slice(0, 23) + '…' : hub.name}</text><text y="29" className="node-detail">{hub.region.length > 30 ? hub.region.slice(0, 28) + '…' : hub.region}</text>{renderCustomLabel(hub.id, hub.label, 62)}</g>
    })}
    {topology.spokes.map((spoke) => {
      const p = point(spoke.id)
      const nvas = topology.connections.filter((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === spoke.id)
      const nvaSite = nvas[0] ? topology.sites.find((site) => site.id === nvas[0].siteId) : undefined
      const standalone = !spoke.hubId
      const colorProps = destinationColors.has(spoke.id) ? destinationProps(spoke.id) : nvaSite ? destinationProps(nvaSite.id) : {}
      const effectiveLabel = spoke.label || nvaSite?.label
      return <g key={spoke.id} data-node-id={spoke.id} data-spoke-nva={nvas.length > 0 ? true : undefined} data-standalone-vnet={standalone ? true : undefined} {...colorProps} transform={`translate(${p.x}, ${p.y})`} className={`spoke-node draggable-node ${nvas.length ? 'spoke-nva-node' : ''} ${standalone ? 'standalone-vnet-node' : ''}`} {...selectable('spoke', spoke.id, t("Select spoke {0}", spoke.name))} {...movable('spoke', spoke.id)}>
        <title>{spoke.name}: {spoke.prefixes.join(', ')}{effectiveLabel ? ` · ${effectiveLabel}` : ''}{nvaSite && nvas[0] ? ` · ${t('Spoke BGP NVA')} (${nvaSite.name} · ASN ${nvaSite.asn} · ${nvas[0].peerIp})` : ''}</title>
        <rect x="-94" y="-44" width="188" height="88" rx="15" />
        <NodeIcon kind="spoke" />
        {nvas.length > 0 && <SpokeNvaIcon spokeId={spoke.id} />}
        <text x="10" y={nvas.length > 0 ? '-24' : '-19'} className="node-kind">{nvas.length > 0 ? t("SPOKE VNET · BGP NVA") : standalone ? t("AZURE VNET") : t("SPOKE VNET")}</text>
        <text y={nvas.length > 0 ? '-3' : '6'} className="node-name">{spoke.name.length > 22 ? spoke.name.slice(0, 20) + '…' : spoke.name}</text>
        <text y={nvas.length > 0 ? '16' : '28'} className="node-detail">{spoke.prefixes[0]}{spoke.prefixes.length > 1 ? ` +${spoke.prefixes.length - 1}` : ''}</text>
        {nvas.length > 0 && nvaSite && <text y="34" className="node-detail node-prefixes">AS{nvaSite.asn} · {nvas[0].peerIp}{nvas.length > 1 ? ` +${nvas.length - 1}` : ''}</text>}
        {renderCustomLabel(spoke.id, effectiveLabel, 58)}
      </g>
    })}
    {topology.sites.filter((site) => !nvaSiteMap.has(site.id)).map((site) => {
      const p = point(site.id)
      return <g key={site.id} data-node-id={site.id} {...destinationProps(site.id)} transform={`translate(${p.x}, ${p.y})`} className="site-node draggable-node" {...selectable('site', site.id, t("Select site {0}", site.name))} {...movable('site', site.id)}><title>{site.name}{site.label ? ` · ${site.label}` : ''}  {t("· ASN")} {site.asn}  {t("· Originated prefix:")} {site.prefixes.join(', ') || t('none')}</title><rect x="-94" y="-44" width="188" height="88" rx="15" /><NodeIcon kind="site" /><text x="10" y="-24" className="node-kind">{t("ON-PREMISES")}</text><text y="-3" className="node-name">{site.name.length > 22 ? site.name.slice(0, 20) + '…' : site.name}</text><text y="16" className="node-detail">ASN {site.asn}</text><text y="34" className="node-detail node-prefixes">{site.prefixes[0] ? `${site.prefixes[0]}${site.prefixes.length > 1 ? ` +${site.prefixes.length - 1}` : ''}` : t("No assigned prefix")}</text>{renderCustomLabel(site.id, site.label, 58)}</g>
    })}
    {(topology.erLocations ?? []).map((location) => {
      const p = point(location.id)
      const skuLabel = location.sku ?? 'Standard'
      const grActive = Boolean(location.globalReachEnabled || (location.globalReachLocationIds && location.globalReachLocationIds.length > 0))
      const detailLabel = `ER ${skuLabel}${grActive ? ' · Global Reach' : ''}`
      return <g key={location.id} data-node-id={location.id} {...destinationProps(location.id)} transform={`translate(${p.x}, ${p.y})`} className="er-location-node draggable-node" {...selectable('erLocation', location.id, t("Select ER location {0}", location.name))} {...movable('erLocation', location.id)}><title>{location.name}{location.peeringLocation ? ` (${location.peeringLocation})` : ''} · SKU {skuLabel}{grActive ? ' · Global Reach enabled' : ''}{location.label ? ` · ${location.label}` : ''}  {t("· ExpressRoute peering location")}</title><rect x="-94" y="-44" width="188" height="88" rx="15" /><NodeIcon kind="erLocation" /><text x="10" y="-19" className="node-kind">{t("ER LOCATION")}</text><text y="6" className="node-name">{location.name.length > 22 ? location.name.slice(0, 20) + '…' : location.name}</text><text y="28" className="node-detail">{detailLabel}</text>{renderCustomLabel(location.id, location.label, 58)}</g>
    })}
      </>
    })()}
    {policyMarks}
    {[...stops].map((id) => {
      const p = positions.get(id)
      if (!p) return null
      const label = t('Routing stops at {0}. No modeled onward route.', topologyObject(topology, { kind: topology.hubs.some((hub) => hub.id === id) ? 'hub' : topology.spokes.some((spoke) => spoke.id === id) ? 'spoke' : 'site', id })?.name ?? id)
      return <g key={id} className="routing-path-stop" data-node-id={id} role="img" aria-label={label} transform={`translate(${p.x - 80},${p.y + 38}) scale(${1 / (scale * zoom)})`}>
        <title>{label}</title><circle r="11" /><path d="M -4 -4 L 4 4 M -4 4 L 4 -4" />
      </g>
    })}
    {issues.filter((finding) => finding.severity === 'error' || finding.severity === 'warning').flatMap((finding) => {
      const failed = [...finding.forward, ...finding.reverse].find((path) => path.status !== 'delivered')
      const failedSource = failed && (finding.forward.includes(failed) ? finding.source : finding.target)
      const failedId = failed && (failed.siteHops?.at(-1) ?? failed.hubs.at(-1) ?? failedSource?.id)
      const object = finding.isolation?.object
        ?? (failedId ? finding.related.find((node) => node.id === failedId) : undefined)
        ?? finding.source ?? finding.related.find((node) => topologyObject(topology, node))
      const members = finding.occurrences ?? [finding]
      const objects = [...new Map([object, ...members.flatMap((entry) => [entry.source, entry.target])]
        .filter((entry) => entry !== undefined)
        .map((entry) => [`${entry.kind}:${entry.id}`, entry])).values()]
      return objects.map((markerObject) => {
      const node = positions.get(markerObject.id)
      const edge = (finding.isolation && markerObject === object ? motionEdges.get(finding.isolation.linkId)?.curve : curves.get(markerObject.id))?.at(0.5)
      const p = edge ? { x: edge.x, y: edge.y - 30 / (scale * zoom) }
        : node && { x: node.x + (markerObject.kind === 'hub' ? 100 : 82), y: node.y - 36 }
      if (!p || !onShowIssues) return null
      const key = finding.isolation && markerObject === object ? `link:${finding.isolation.linkId}` : `${markerObject.kind}:${markerObject.id}`
      const slot = markerSlots.get(key) ?? 0
      markerSlots.set(key, slot + 1)
      const label = `${t(finding.title)} · ${t('1 root-cause issue; {0} affected flow pairs', diagnosticFlowCount([finding]))}${finding.prefix ? ` · ${finding.prefix}` : ''}${finding.source ? ` · ${topologyObject(topology, finding.source)?.name} → ${finding.target ? topologyObject(topology, finding.target)?.name : ''}` : finding.isolation ? ` · ${isolationLinkName(topology, finding.isolation)}` : ''}`
      return <g key={`${finding.id}:${key}`} className="routing-issue-marker danger" data-issue-id={finding.id} data-object-key={key}
        data-root-count="1" data-affected-pairs={diagnosticFlowCount([finding])} role="button" tabIndex={0} aria-label={label}
        transform={`translate(${p.x - slot % 3 * 44 / (scale * zoom)},${p.y + Math.floor(slot / 3) * 44 / (scale * zoom)}) scale(${1 / (scale * zoom)})`}
        onClick={(event) => { event.stopPropagation(); onShowIssues(finding) }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onShowIssues(finding) } }}>
        <title>{label}</title><rect x="-22" y="-22" width="44" height="44" fill="transparent" />
        <path className="warning-triangle" d="M 0 -18 L 19 16 H -19 Z" />
        <text className="warning-symbol" y="10">!</text>
      </g>
      })
    })}
    {!topology.hubs.length && !topology.sites.length && !topology.erLocations?.length && <text x={width / 2} y={height / 2} textAnchor="middle" className="empty-diagram">{t("Right-click the canvas to add your first hub or site.")}</text>}
    {Object.entries(risks).filter(([id]) => positions.has(id) && !faults[id]).map(([id, count]) => {
      const p = point(id)
      return <g key={`risk:${id}`} role="button" tabIndex={0} aria-label={`Review ${count} N-1 resilience gaps for ${id}`}
        transform={`translate(${p.x},${p.y + 52})`} onClick={() => onRisk?.(id)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRisk?.(id) } }}>
        <rect className="resilience-gap-badge" x="-80" y="-10" width="160" height="22" rx="3" /><text className="resilience-gap-text" textAnchor="middle" y="6">△ {count} N-1 gaps</text>
      </g>
    })}
    {Object.entries(faults).filter(([id]) => positions.has(id) && !nvaSiteMap.has(id)).map(([id, failures]) => {
      const p = point(id)
      return <g key={`fault:${id}`} role="img" aria-label={`Simulated failure: ${failures.map((f) => f.name).join(', ')}`} transform={`translate(${p.x},${p.y - 44})`}>
        <rect className="simulated-fault-badge" x="-88" y="-19" width="176" height="22" rx="3" /><text className="simulated-fault-text" textAnchor="middle" y="-3">× SIMULATED FAILURE</text>
      </g>
    })}
  </svg>{preview && previewNode && previewLink && previewMap && !faults[preview.owner.id] && !faults[preview.connectionId] && <RouteMapPreview id={previewId} anchor={preview.anchor} map={previewMap} owner={previewNode.name} connection={previewLink.name} direction={preview.direction} enabled={previewLink.enabled} onEnter={cancelPreviewClose} onLeave={leavePreview} onClose={closePreview} />}</div>
    {(pan.x !== 0 || pan.y !== 0) && <button className="canvas-pan-reset" onClick={() => setPan({ x: 0, y: 0 })}>{t('Reset canvas view')}</button>}
  </>
}
