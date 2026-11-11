import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PathMotion, type MotionFlow, type MotionSegment } from '../PathMotion'
import type { AzDiagnosticFinding } from './diagnostics'
import type { AzFlowTrace } from './engine'
import type { AzNetTopology, AzPeeringDirectionFlags, AzUdrTable, AzVNet } from './model'

export type AzSelectedEntity =
  | { kind: 'subnet'; vnetId: string; subnetId: string }
  | { kind: 'vnet'; vnetId: string }
  | { kind: 'gateway'; vnetId: string; gatewayId: string }
  | { kind: 'route-server'; vnetId: string; routeServerId: string }
  | { kind: 'appliance'; vnetId: string; applianceId: string }
  | { kind: 'peering'; peeringId: string }
  | { kind: 'er-link'; linkId: string }
  | { kind: 'er-global-reach-link'; linkId: string }
  | { kind: 'vpn-connection'; connectionId: string }
  | { kind: 'site-link'; siteLinkId: string }
  | { kind: 'vwan-hub'; hubId: string }
  | { kind: 'er-location'; locationId: string }
  | { kind: 'site'; siteId: string }

export type AzContextMenuTarget =
  | { kind: 'canvas'; x: number; y: number; svgX: number; svgY: number }
  | { kind: 'entity'; x: number; y: number; entity: AzSelectedEntity }

interface AzureNetDiagramProps {
  topology: AzNetTopology
  selected?: AzSelectedEntity
  onSelect: (entity: AzSelectedEntity) => void
  onContextMenu?: (target: AzContextMenuTarget) => void
  onMoveNode: (
    nodeKind: 'vnet' | 'vwan-hub' | 'er-location' | 'site',
    nodeId: string,
    x: number,
    y: number,
  ) => void
  onTogglePeeringEnabled?: (peeringId: string, enabled: boolean) => void
  onUpdatePeeringFlag?: (
    peeringId: string,
    direction: 'aToB' | 'bToA',
    flag: keyof AzPeeringDirectionFlags,
    value: boolean,
  ) => void
  onUpdateRouteTable?: (
    routeTableId: string,
    patch: Partial<Pick<AzUdrTable, 'disableBgpRoutePropagation' | 'disablePeeringRoutePropagation'>>,
  ) => void
  onAssociateSubnetRouteTable?: (
    vnetId: string,
    subnetId: string,
    routeTableId: string | undefined,
  ) => void
  onOpenEditorForEntity?: (entity: AzSelectedEntity) => void
  forwardTrace?: AzFlowTrace | null
  reverseTrace?: AzFlowTrace | null
  additionalForwardTraces?: AzFlowTrace[]
  additionalReverseTraces?: AzFlowTrace[]
  diagnostics: AzDiagnosticFinding[]
  showDiagnosticBadges: boolean
  onShowIssues: (findings: AzDiagnosticFinding[]) => void
  onClearHighlights: () => void
}

interface BoxPosition {
  x: number
  y: number
  width: number
  height: number
}

function getVnetBoxHeight(vnet: AzVNet): number {
  const headerH = 44
  const controlStripH = vnet.gateways.length > 0 || vnet.routeServer || vnet.appliances.length > 0 ? 30 : 0
  const subnetsH = Math.max(1, vnet.subnets.length) * 28 + 14
  return headerH + controlStripH + subnetsH
}

function isHubVnetRole(role: string): boolean {
  return role === 'hub' || role === 'hub-vnet' || role === 'transit' || role === 'transit-vnet'
}

function computePositions(topology: AzNetTopology): {
  vnets: Record<string, BoxPosition>
  vwanHubs: Record<string, BoxPosition>
  erLocations: Record<string, BoxPosition>
  sites: Record<string, BoxPosition>
} {
  const vnets: Record<string, BoxPosition> = {}
  const vwanHubs: Record<string, BoxPosition> = {}
  const erLocations: Record<string, BoxPosition> = {}
  const sites: Record<string, BoxPosition> = {}

  const spokes = topology.vnets.filter((v) => !isHubVnetRole(v.role))
  const hubs = topology.vnets.filter((v) => isHubVnetRole(v.role))

  spokes.forEach((v, idx) => {
    const w = 285
    const h = getVnetBoxHeight(v)
    vnets[v.id] = {
      x: v.x ?? 80 + idx * 330,
      y: v.y ?? 45,
      width: w,
      height: h,
    }
  })

  hubs.forEach((v, idx) => {
    const w = 315
    const h = getVnetBoxHeight(v)
    vnets[v.id] = {
      x: v.x ?? 260 + idx * 380,
      y: v.y ?? 275,
      width: w,
      height: h,
    }
  })

  topology.vwanHubs.forEach((h, idx) => {
    vwanHubs[h.id] = {
      x: h.x ?? 180 + idx * 340,
      y: h.y ?? 295,
      width: 240,
      height: 82,
    }
  })

  topology.erLocations.forEach((loc, idx) => {
    erLocations[loc.id] = {
      x: loc.x ?? 380 + idx * 320,
      y: loc.y ?? 530,
      width: 225,
      height: 66,
    }
  })

  topology.sites.forEach((s, idx) => {
    sites[s.id] = {
      x: s.x ?? 220 + idx * 360,
      y: s.y ?? 665,
      width: 235,
      height: 76,
    }
  })

  return { vnets, vwanHubs, erLocations, sites }
}

export function AzureNetDiagram({
  topology,
  selected,
  onSelect,
  onContextMenu,
  onMoveNode,
  onTogglePeeringEnabled,
  onUpdatePeeringFlag,
  onUpdateRouteTable,
  onAssociateSubnetRouteTable,
  onOpenEditorForEntity,
  forwardTrace,
  reverseTrace,
  additionalForwardTraces = [],
  additionalReverseTraces = [],
  diagnostics,
  showDiagnosticBadges,
  onShowIssues,
  onClearHighlights,
}: AzureNetDiagramProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoverPopover, setHoverPopover] = useState<
    | { kind: 'peering'; peeringId: string; x: number; y: number }
    | { kind: 'route-table'; vnetId: string; subnetId: string; routeTableId: string; x: number; y: number }
    | null
  >(null)

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const scheduleClosePopover = () => {
    clearHoverTimer()
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverPopover(null)
    }, 180)
  }

  const getRelativePopoverPosition = (clientX: number, clientY: number) => {
    const shell = shellRef.current
    if (!shell) return { x: 24, y: 24 }
    const rect = shell.getBoundingClientRect()
    const x = Math.min(Math.max(12, clientX - rect.left + 10), Math.max(12, rect.width - 335))
    const y = Math.min(Math.max(12, clientY - rect.top + 10), Math.max(12, rect.height - 260))
    return { x, y }
  }
  const [dragState, setDragState] = useState<
    | {
        mode: 'node'
        nodeKind: 'vnet' | 'vwan-hub' | 'er-location' | 'site'
        nodeId: string
        startMouseX: number
        startMouseY: number
        origX: number
        origY: number
      }
    | {
        mode: 'pan'
        startMouseX: number
        startMouseY: number
        origPanX: number
        origPanY: number
      }
    | null
  >(null)

  const positions = computePositions(topology)
  const openKeyboardContext = (event: KeyboardEvent<SVGGElement>, entity: AzSelectedEntity) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      onSelect(entity)
      return
    }
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    onSelect(entity)
    onContextMenu?.({ kind: 'entity', entity, x: rect.left + 20, y: rect.top + 20 })
  }

  const forwardTraces = [...(forwardTrace ? [forwardTrace] : []), ...additionalForwardTraces]
  const reverseTraces = [...(reverseTrace ? [reverseTrace] : []), ...additionalReverseTraces]
  const forwardEdges = new Set(forwardTraces.flatMap((trace) => trace.traversedEdgeIds))
  const reverseEdges = new Set(reverseTraces.flatMap((trace) => trace.traversedEdgeIds))
  const forwardSubnets = new Set(
    forwardTraces.flatMap((trace) => trace.hops).map((h) => h.subnetId).filter((s): s is string => Boolean(s)),
  )
  const reverseSubnets = new Set(
    reverseTraces.flatMap((trace) => trace.hops).map((h) => h.subnetId).filter((s): s is string => Boolean(s)),
  )

  const hasActiveHighlights =
    forwardTraces.length > 0 || reverseTraces.length > 0 ||
    (showDiagnosticBadges && diagnostics.some((d) => d.severity !== 'info'))

  const findingsForNode = (kind: 'vnet' | 'vwan-hub' | 'er-location' | 'site', id: string) =>
    showDiagnosticBadges ? diagnostics.filter((finding) => {
      if (finding.severity === 'info') return false
      const endpoints = [finding.sampleFlow?.source, finding.sampleFlow?.destination]
      if (kind === 'vnet') {
        const peering = finding.peeringId && topology.vnetPeerings.find((p) => p.id === finding.peeringId)
        return finding.vnetId === id || (peering && (peering.vnetAId === id || peering.vnetBId === id)) ||
          endpoints.some((ref) => ref?.kind === 'subnet' && ref.vnetId === id)
      }
      if (kind === 'site') return endpoints.some((ref) => ref?.kind === 'site' && ref.siteId === id)
      if (kind === 'vwan-hub') return endpoints.some((ref) => ref?.kind === 'vwanHub' && ref.hubId === id)
      return finding.erLocationId === id
    }) : []

  const diagnosticNodes = [
    ...topology.vnets.map((node) => ({ kind: 'vnet' as const, id: node.id, name: node.name, box: positions.vnets[node.id] })),
    ...topology.vwanHubs.map((node) => ({ kind: 'vwan-hub' as const, id: node.id, name: node.name, box: positions.vwanHubs[node.id] })),
    ...topology.erLocations.map((node) => ({ kind: 'er-location' as const, id: node.id, name: node.name, box: positions.erLocations[node.id] })),
    ...topology.sites.map((node) => ({ kind: 'site' as const, id: node.id, name: node.name, box: positions.sites[node.id] })),
  ]

  const clientToSvgDelta = (dx: number, dy: number) => {
    const svg = svgRef.current
    if (!svg) return { dx, dy }
    const rect = svg.getBoundingClientRect()
    const scaleX = (1180 / zoom) / Math.max(rect.width, 1)
    const scaleY = (790 / zoom) / Math.max(rect.height, 1)
    return { dx: dx * scaleX, dy: dy * scaleY }
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState) return
    if (dragState.mode === 'pan') {
      const { dx, dy } = clientToSvgDelta(
        e.clientX - dragState.startMouseX,
        e.clientY - dragState.startMouseY,
      )
      setPan({ x: dragState.origPanX - dx, y: dragState.origPanY - dy })
    } else {
      const { dx, dy } = clientToSvgDelta(
        e.clientX - dragState.startMouseX,
        e.clientY - dragState.startMouseY,
      )
      onMoveNode(
        dragState.nodeKind,
        dragState.nodeId,
        Math.round(dragState.origX + dx),
        Math.round(dragState.origY + dy),
      )
    }
  }

  const handlePointerUp = () => {
    setDragState(null)
  }

  const centerOf = (box?: BoxPosition) =>
    box ? { cx: box.x + box.width / 2, cy: box.y + box.height / 2 } : { cx: 0, cy: 0 }

  const [pixelsPerUnit, setPixelsPerUnit] = useState(1)
  useLayoutEffect(() => {
    const svg = svgRef.current!
    const updateScale = () => {
      const matrix = svg.getScreenCTM()
      if (matrix) setPixelsPerUnit(Math.hypot(matrix.a, matrix.b))
    }
    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [zoom])

  const motionBoxes = new Map<string, BoxPosition>([
    ...Object.entries(positions.vnets).map(([id, box]) => [`vnet:${id}`, box] as const),
    ...Object.entries(positions.vwanHubs).map(([id, box]) => [`vwan-hub:${id}`, box] as const),
    ...Object.entries(positions.erLocations).map(([id, box]) => [`er-location:${id}`, box] as const),
    ...Object.entries(positions.sites).map(([id, box]) => [`site:${id}`, box] as const),
  ])
  const deviceOwners = new Map(topology.vnets.flatMap((vnet) =>
    [...vnet.gateways, ...vnet.appliances].map((device) => [device.id, `vnet:${vnet.id}`] as const),
  ))
  const targetKey = (kind: string, id: string) =>
    kind === 'site' || kind === 'vwan-hub' ? `${kind}:${id}` : deviceOwners.get(id)
  const motionEdges = new Map<string, MotionSegment>()
  const addMotionEdge = (id: string, from: string | undefined, to: string | undefined) => {
    const a = from && motionBoxes.get(from), b = to && motionBoxes.get(to)
    if (!a || !b || !from || !to) return
    const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 }
    const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    motionEdges.set(id, { id, from, to, start, end, control: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } })
  }
  for (const peering of topology.vnetPeerings) {
    if (peering.enabled) addMotionEdge(peering.id, `vnet:${peering.vnetAId}`, `vnet:${peering.vnetBId}`)
  }
  for (const vnet of topology.vnets) {
    const attachment = vnet.vwanHubAttachment
    if (attachment?.enabled) addMotionEdge(`vhub-attach:${vnet.id}:${attachment.hubId}`, `vnet:${vnet.id}`, `vwan-hub:${attachment.hubId}`)
  }
  for (const link of topology.erLinks) {
    if (link.enabled) addMotionEdge(link.id, `er-location:${link.locationId}`, targetKey(link.targetKind, link.targetId))
  }
  for (const link of topology.erGlobalReachLinks ?? []) {
    if (link.enabled) addMotionEdge(link.id, `er-location:${link.locationAId}`, `er-location:${link.locationBId}`)
  }
  for (const connection of topology.vpnConnections) {
    if (connection.enabled) addMotionEdge(connection.id, `site:${connection.siteId}`, targetKey(connection.targetKind, connection.targetId))
  }
  for (const link of topology.siteLinks) {
    if (link.enabled) addMotionEdge(link.id, `site:${link.siteAId}`, `site:${link.siteBId}`)
  }
  const motionFlows: MotionFlow[] = []
  const motionColors = new Map<string, string>()
  for (const [direction, traces] of [['forward', forwardTraces], ['return', reverseTraces]] as const) {
    for (const trace of traces) {
      const destinationId = `${direction}:${trace.destinationIp}`
      motionColors.set(destinationId, direction === 'forward' ? 'var(--forward)' : 'var(--return)')
      let segments: MotionSegment[] = []
      const finish = (stopped = false) => {
        if (segments.length) motionFlows.push({ segments, destinationId, direction, stopped })
        segments = []
      }
      for (const hop of trace.hops) {
        if (hop.action === 'dropped' || hop.action === 'loop') break
        if (!hop.edgeId) continue
        const edge = motionEdges.get(hop.edgeId)
        const from = hop.vnetId ? `vnet:${hop.vnetId}` : `${hop.nodeKind}:${hop.nodeId}`
        if (!edge || (from !== edge.from && from !== edge.to)) { finish(); continue }
        const segment = from === edge.from ? edge : { ...edge, from, to: edge.from, start: edge.end, end: edge.start }
        if (segments.length && segments.at(-1)!.to !== from) finish()
        segments.push(segment)
      }
      finish(trace.status !== 'delivered')
    }
  }

  const viewW = 1180 / zoom
  const viewH = 790 / zoom

  return (
    <div ref={shellRef} className="aznet-canvas-shell" data-testid="aznet-canvas-shell">
      <svg
        ref={svgRef}
        className="aznet-diagram-svg"
        data-testid="aznet-diagram-svg"
        viewBox={`${pan.x} ${pan.y} ${viewW} ${viewH}`}
        onPointerDown={(e) => {
          setHoverPopover(null)
          if (e.target === svgRef.current) {
            setDragState({
              mode: 'pan',
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              origPanX: pan.x,
              origPanY: pan.y,
            })
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => {
          if (!onContextMenu) return
          e.preventDefault()
          const svg = svgRef.current
          let svgX = 320
          let svgY = 180
          if (svg) {
            const rect = svg.getBoundingClientRect()
            const scaleX = (1180 / zoom) / Math.max(rect.width, 1)
            const scaleY = (790 / zoom) / Math.max(rect.height, 1)
            svgX = Math.round(pan.x + (e.clientX - rect.left) * scaleX)
            svgY = Math.round(pan.y + (e.clientY - rect.top) * scaleY)
          }
          onContextMenu({
            kind: 'canvas',
            x: e.clientX,
            y: e.clientY,
            svgX,
            svgY,
          })
        }}
      >
        <defs>
          <pattern id="aznet-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="var(--grid)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect
          x={pan.x - 1000}
          y={pan.y - 1000}
          width={viewW + 2000}
          height={viewH + 2000}
          fill="url(#aznet-grid)"
          pointerEvents="none"
        />

        {/* 1. VNet Peerings */}
        {topology.vnetPeerings.map((peering) => {
          const boxA = positions.vnets[peering.vnetAId]
          const boxB = positions.vnets[peering.vnetBId]
          if (!boxA || !boxB) return null
          const a = centerOf(boxA)
          const b = centerOf(boxB)
          const midX = (a.cx + b.cx) / 2
          const midY = (a.cy + b.cy) / 2
          const isSelected = selected?.kind === 'peering' && selected.peeringId === peering.id
          const inForward = forwardEdges.has(peering.id)
          const inReverse = reverseEdges.has(peering.id)
          const hasFinding =
            showDiagnosticBadges && diagnostics.some((d) => d.peeringId === peering.id && d.severity !== 'info')
          const brokenAccess =
            !peering.enabled ||
            !peering.aToB.allowVirtualNetworkAccess ||
            !peering.bToA.allowVirtualNetworkAccess

          let stroke = 'var(--info)'
          if (brokenAccess || hasFinding) stroke = 'var(--error)'
          if (inReverse) stroke = 'var(--return)'
          if (inForward) stroke = 'var(--forward)'
          if (isSelected) stroke = 'var(--accent)'

          const flagsSummary: string[] = []
          if (peering.aToB.allowGatewayTransit || peering.bToA.allowGatewayTransit) {
            flagsSummary.push('GW-Transit')
          }
          if (peering.aToB.allowForwardedTraffic && peering.bToA.allowForwardedTraffic) {
            flagsSummary.push('Fwd:✓')
          } else {
            flagsSummary.push('Fwd:Partial/Off')
          }
          if (brokenAccess) {
            flagsSummary.push('VNetAccess:OFF')
          }

          return (
            <g
              key={peering.id}
              className="aznet-edge-group"
              data-testid={`aznet-peering-${peering.id}`}
              onMouseEnter={(e) => {
                clearHoverTimer()
                const pos = getRelativePopoverPosition(e.clientX, e.clientY)
                setHoverPopover({
                  kind: 'peering',
                  peeringId: peering.id,
                  x: pos.x,
                  y: pos.y,
                })
              }}
              onMouseLeave={scheduleClosePopover}
              onClick={(e) => {
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'peering', peeringId: peering.id }
                onSelect(entity)
                const pos = getRelativePopoverPosition(e.clientX, e.clientY)
                setHoverPopover({
                  kind: 'peering',
                  peeringId: peering.id,
                  x: pos.x,
                  y: pos.y,
                })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setHoverPopover(null)
                onSelect({ kind: 'peering', peeringId: peering.id })
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity: { kind: 'peering', peeringId: peering.id },
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse || isSelected ? 4 : 2.5}
                strokeDasharray={brokenAccess ? '6 5' : inReverse && !inForward ? '7 4' : undefined}
              />
              <rect
                data-testid={`aznet-peering-pill-${peering.id}`}
                x={midX - 66}
                y={midY - 11}
                width={132}
                height={22}
                rx={6}
                fill={brokenAccess || hasFinding ? 'var(--error-surface)' : 'var(--surface)'}
                stroke={stroke}
                strokeWidth={1.3}
              />
              <text
                x={midX}
                y={midY + 4}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--text)"
              >
                Peer · {flagsSummary.join(' · ')}
              </text>
            </g>
          )
        })}

        {/* 2. VNet-to-vWAN Hub Attachments */}
        {topology.vnets.map((vnet) => {
          const att = vnet.vwanHubAttachment
          if (!att || !att.enabled) return null
          const vBox = positions.vnets[vnet.id]
          const hBox = positions.vwanHubs[att.hubId]
          if (!vBox || !hBox) return null
          const a = centerOf(vBox)
          const b = centerOf(hBox)
          const edgeId = `vhub-attach:${vnet.id}:${att.hubId}`
          const inForward = forwardEdges.has(edgeId)
          const inReverse = reverseEdges.has(edgeId)
          return (
            <g key={edgeId}>
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={inForward ? 'var(--forward)' : inReverse ? 'var(--return)' : 'var(--info)'}
                strokeWidth={inForward || inReverse ? 4 : 2.5}
                strokeDasharray={inReverse && !inForward ? '7 4' : undefined}
              />
            </g>
          )
        })}

        {/* 3. ExpressRoute Links (via MSEE Locations) */}
        {topology.erLinks.map((link) => {
          const locBox = positions.erLocations[link.locationId]
          if (!locBox) return null
          let targetBox: BoxPosition | undefined
          if (link.targetKind === 'site') {
            targetBox = positions.sites[link.targetId]
          } else if (link.targetKind === 'vwan-hub') {
            targetBox = positions.vwanHubs[link.targetId]
          } else {
            const ownerVnet = topology.vnets.find((v) =>
              v.gateways.some((g) => g.id === link.targetId),
            )
            if (ownerVnet) targetBox = positions.vnets[ownerVnet.id]
          }
          if (!targetBox) return null
          const a = centerOf(locBox)
          const b = centerOf(targetBox)
          const midX = (a.cx + b.cx) / 2
          const midY = (a.cy + b.cy) / 2
          const inForward = forwardEdges.has(link.id)
          const inReverse = reverseEdges.has(link.id)
          const isSelected = selected?.kind === 'er-link' && selected.linkId === link.id
          const hasSkuMismatch =
            showDiagnosticBadges &&
            diagnostics.some((d) => d.category === 'er-sku-regional-mismatch' && d.erLinkId === link.id)
          const stroke = !link.enabled
            ? 'var(--link)'
            : hasSkuMismatch
              ? 'var(--error)'
              : isSelected
                ? 'var(--accent)'
                : inForward
                  ? 'var(--forward)'
                  : inReverse
                    ? 'var(--return)'
                    : 'var(--warning)'
          return (
            <g
              key={link.id}
              data-testid={`aznet-erlink-${link.id}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${link.targetKind === 'site' ? 'ExpressRoute link' : 'ER connection'} ${link.name}`}
              onKeyDown={(e) => openKeyboardContext(e, { kind: 'er-link', linkId: link.id })}
              onClick={(e) => {
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'er-link', linkId: link.id }
                onSelect(entity)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'er-link', linkId: link.id }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse || isSelected ? 4.2 : 2.8}
                strokeDasharray={!link.enabled || hasSkuMismatch ? '5 4' : inReverse && !inForward ? '7 4' : undefined}
              />
              <rect
                x={midX - 48}
                y={midY - 9}
                width={96}
                height={18}
                rx={5}
                fill={hasSkuMismatch ? 'var(--error-surface)' : 'var(--warning-surface)'}
                stroke={stroke}
                strokeWidth={1.1}
              />
              <text
                x={midX}
                y={midY + 3.5}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={hasSkuMismatch ? 'var(--error)' : 'var(--warning)'}
              >
                ER{link.weight ? ` · W:${link.weight}` : ''}
                {link.prepend?.length ? ` · +${link.prepend.length}AS` : ''}
                {hasSkuMismatch ? ' · ! SKU' : ''}
                {!link.enabled ? ' · OFF' : ''}
              </text>
            </g>
          )
        })}

        {/* 3b. ExpressRoute Global Reach Links between ER Locations (#45) */}
        {(topology.erGlobalReachLinks ?? []).map((grLink) => {
          const boxA = positions.erLocations[grLink.locationAId]
          const boxB = positions.erLocations[grLink.locationBId]
          if (!boxA || !boxB) return null
          const a = centerOf(boxA)
          const b = centerOf(boxB)
          const midX = (a.cx + b.cx) / 2
          const midY = (a.cy + b.cy) / 2
          const inForward = forwardEdges.has(grLink.id)
          const inReverse = reverseEdges.has(grLink.id)
          const isSelected =
            selected?.kind === 'er-global-reach-link' && selected.linkId === grLink.id
          const stroke = !grLink.enabled
            ? 'var(--link)'
            : isSelected
              ? 'var(--accent)'
              : inForward
                ? 'var(--forward)'
                : inReverse
                  ? 'var(--return)'
                  : 'var(--info)'
          return (
            <g
              key={grLink.id}
              data-testid={`aznet-ergrlink-${grLink.id}`}
              onClick={(e) => {
                e.stopPropagation()
                const entity: AzSelectedEntity = {
                  kind: 'er-global-reach-link',
                  linkId: grLink.id,
                }
                onSelect(entity)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = {
                  kind: 'er-global-reach-link',
                  linkId: grLink.id,
                }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse || isSelected ? 4 : 2.6}
                strokeDasharray="6 3"
              />
              <rect
                x={midX - 50}
                y={midY - 9}
                width={100}
                height={18}
                rx={5}
                fill="var(--surface-muted)"
                stroke={stroke}
                strokeWidth={1.1}
              />
              <text
                x={midX}
                y={midY + 3.5}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={700}
                fill="var(--info)"
              >
                🌐 Global Reach{!grLink.enabled ? ' · OFF' : ''}
              </text>
            </g>
          )
        })}

        {/* 4. S2S VPN / SD-WAN Overlay Connections */}
        {topology.vpnConnections.map((conn) => {
          const siteBox = positions.sites[conn.siteId]
          if (!siteBox) return null
          let targetBox: BoxPosition | undefined
          if (conn.targetKind === 'vwan-hub') {
            targetBox = positions.vwanHubs[conn.targetId]
          } else if (conn.targetKind === 'vnet-gateway') {
            const ownerVnet = topology.vnets.find((v) =>
              v.gateways.some((g) => g.id === conn.targetId),
            )
            if (ownerVnet) targetBox = positions.vnets[ownerVnet.id]
          } else {
            const ownerVnet = topology.vnets.find((v) =>
              v.appliances.some((a) => a.id === conn.targetId),
            )
            if (ownerVnet) targetBox = positions.vnets[ownerVnet.id]
          }
          if (!targetBox) return null
          const a = centerOf(siteBox)
          const b = centerOf(targetBox)
          const midX = (a.cx + b.cx) / 2
          const midY = (a.cy + b.cy) / 2
          const inForward = forwardEdges.has(conn.id)
          const inReverse = reverseEdges.has(conn.id)
          const isSelected =
            selected?.kind === 'vpn-connection' && selected.connectionId === conn.id
          const stroke = !conn.enabled
            ? 'var(--link)'
            : isSelected
              ? 'var(--accent)'
              : inForward
                ? 'var(--forward)'
                : inReverse
                  ? 'var(--return)'
                  : 'var(--purple)'
          return (
            <g
              key={conn.id}
              data-testid={`aznet-vpnconn-${conn.id}`}
              onClick={(e) => {
                e.stopPropagation()
                const entity: AzSelectedEntity = {
                  kind: 'vpn-connection',
                  connectionId: conn.id,
                }
                onSelect(entity)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = {
                  kind: 'vpn-connection',
                  connectionId: conn.id,
                }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse || isSelected ? 3.8 : 2.2}
                strokeDasharray="6 4"
              />
              <rect
                x={midX - 42}
                y={midY - 9}
                width={84}
                height={18}
                rx={5}
                fill="var(--surface-muted)"
                stroke={stroke}
                strokeWidth={1.1}
              />
              <text
                x={midX}
                y={midY + 3.5}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill="var(--purple)"
              >
                VPN · {conn.bgpEnabled ? 'BGP' : 'Static'}
                {!conn.enabled ? ' · OFF' : ''}
              </text>
            </g>
          )
        })}

        {/* 5. Site-to-Site Links */}
        {topology.siteLinks.map((sLink) => {
          const boxA = positions.sites[sLink.siteAId]
          const boxB = positions.sites[sLink.siteBId]
          if (!boxA || !boxB) return null
          const a = centerOf(boxA)
          const b = centerOf(boxB)
          const midX = (a.cx + b.cx) / 2
          const midY = (a.cy + b.cy) / 2
          const inForward = forwardEdges.has(sLink.id)
          const inReverse = reverseEdges.has(sLink.id)
          const isSelected = selected?.kind === 'site-link' && selected.siteLinkId === sLink.id
          const stroke = !sLink.enabled
            ? 'var(--link)'
            : isSelected
              ? 'var(--accent)'
              : inForward
                ? 'var(--forward)'
                : inReverse
                  ? 'var(--return)'
                  : 'var(--link)'
          return (
            <g
              key={sLink.id}
              data-testid={`aznet-sitelink-${sLink.id}`}
              onClick={(e) => {
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'site-link', siteLinkId: sLink.id }
                onSelect(entity)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'site-link', siteLinkId: sLink.id }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse || isSelected ? 3.6 : 2}
                strokeDasharray="4 4"
              />
              <rect
                x={midX - 38}
                y={midY - 9}
                width={76}
                height={18}
                rx={5}
                fill="var(--surface)"
                stroke={stroke}
                strokeWidth={1.1}
              />
              <text
                x={midX}
                y={midY + 3.5}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={600}
                fill="var(--text)"
              >
                WAN Link{!sLink.enabled ? ' · OFF' : ''}
              </text>
            </g>
          )
        })}

        <PathMotion flows={motionFlows} pixelsPerUnit={pixelsPerUnit} colors={motionColors} />

        {/* 6. Compound VNet Cards */}
        {topology.vnets.map((vnet) => {
          const box = positions.vnets[vnet.id]
          if (!box) return null
          const isVnetSelected = selected?.kind === 'vnet' && selected.vnetId === vnet.id
          const vnetFindings = findingsForNode('vnet', vnet.id)
          const hasError = vnetFindings.some((f) => f.severity === 'error')
          const hasWarning = vnetFindings.some((f) => f.severity === 'warning')

          const hasControlRow =
            vnet.gateways.length > 0 || Boolean(vnet.routeServer) || vnet.appliances.length > 0
          const subnetStartY = box.y + 44 + (hasControlRow ? 30 : 0) + 6

          return (
            <g
              key={vnet.id}
              data-testid={`aznet-vnet-${vnet.id}`}
              tabIndex={0}
              role="button"
              aria-label={`VNet ${vnet.name}`}
              onKeyDown={(e) => openKeyboardContext(e, { kind: 'vnet', vnetId: vnet.id })}
              onPointerDown={(e) => {
                if (e.button === 2) return
                e.stopPropagation()
                setDragState({
                  mode: 'node',
                  nodeKind: 'vnet',
                  nodeId: vnet.id,
                  startMouseX: e.clientX,
                  startMouseY: e.clientY,
                  origX: box.x,
                  origY: box.y,
                })
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSelect({ kind: 'vnet', vnetId: vnet.id })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSelect({ kind: 'vnet', vnetId: vnet.id })
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity: { kind: 'vnet', vnetId: vnet.id },
                })
              }}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={12}
                fill="var(--surface)"
                stroke={
                  isVnetSelected
                    ? 'var(--accent)'
                    : hasError
                      ? 'var(--error)'
                      : hasWarning
                        ? 'var(--warning)'
                        : isHubVnetRole(vnet.role)
                          ? 'var(--info)'
                          : 'var(--link)'
                }
                strokeWidth={isVnetSelected || hasError ? 2.6 : 1.8}
              />

              {/* VNet Header */}
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={42}
                rx={12}
                fill={
                  isHubVnetRole(vnet.role)
                    ? 'var(--surface-muted)'
                    : 'var(--surface-muted)'
                }
              />
              <text
                x={box.x + 12}
                y={box.y + 18}
                fontSize={12.5}
                fontWeight={700}
                fill="var(--text)"
              >
                {vnet.name}
              </text>
              <text
                x={box.x + 12}
                y={box.y + 34}
                fontSize={10.5}
                fill="var(--text)"
              >
                {vnet.prefixes.join(', ')} · {vnet.region}
              </text>
              <rect
                x={box.x + box.width - 66}
                y={box.y + 8}
                width={56}
                height={18}
                rx={5}
                fill="var(--surface-muted)"
              />
              <text
                x={box.x + box.width - 38}
                y={box.y + 20}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={700}
                fill="var(--text-muted)"
              >
                {vnet.role.toUpperCase()}
              </text>

              {/* Control Plane / Appliances Strip */}
              {hasControlRow && (
                <g>
                  {(() => {
                    const chips: {
                      key: string
                      label: string
                      bg: string
                      fg: string
                      entity: AzSelectedEntity
                    }[] = []
                    for (const gw of vnet.gateways) {
                      chips.push({
                        key: gw.id,
                        label: gw.kind === 'ExpressRoute' ? 'ER GW' : 'VPN GW',
                        bg: gw.kind === 'ExpressRoute' ? 'var(--warning-surface)' : 'var(--surface-muted)',
                        fg: gw.kind === 'ExpressRoute' ? 'var(--warning)' : 'var(--purple)',
                        entity: { kind: 'gateway', vnetId: vnet.id, gatewayId: gw.id },
                      })
                    }
                    if (vnet.routeServer?.enabled) {
                      chips.push({
                        key: vnet.routeServer.id,
                        label: `ARS 65515${vnet.routeServer.branchToBranchTraffic ? ' · B2B' : ''}`,
                        bg: 'var(--surface-muted)',
                        fg: 'var(--success)',
                        entity: {
                          kind: 'route-server',
                          vnetId: vnet.id,
                          routeServerId: vnet.routeServer.id,
                        },
                      })
                    }
                    for (const app of vnet.appliances) {
                      chips.push({
                        key: app.id,
                        label:
                          app.kind === 'azure-firewall'
                            ? 'AzFirewall'
                            : app.kind === 'vnra'
                              ? 'VNRA 100G'
                              : `NVA (${app.privateIp})`,
                        bg:
                          app.kind === 'azure-firewall'
                            ? 'var(--surface-muted)'
                            : app.kind === 'vnra'
                              ? 'var(--surface-muted)'
                              : 'var(--surface-muted)',
                        fg:
                          app.kind === 'azure-firewall'
                            ? 'var(--error)'
                            : app.kind === 'vnra'
                              ? 'var(--accent)'
                              : 'var(--purple)',
                        entity: { kind: 'appliance', vnetId: vnet.id, applianceId: app.id },
                      })
                    }
                    let offsetX = box.x + 10
                    return chips.slice(0, 4).map((chip) => {
                      const chipW = Math.min(92, Math.max(58, chip.label.length * 6.2 + 12))
                      const currX = offsetX
                      offsetX += chipW + 5
                      return (
                        <g
                          key={chip.key}
                          data-testid={`aznet-chip-${chip.key}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelect(chip.entity)
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onSelect(chip.entity)
                            onContextMenu?.({
                              kind: 'entity',
                              x: e.clientX,
                              y: e.clientY,
                              entity: chip.entity,
                            })
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <rect
                            x={currX}
                            y={box.y + 47}
                            width={chipW}
                            height={20}
                            rx={5}
                            fill={chip.bg}
                            stroke={chip.fg}
                            strokeWidth={1}
                          />
                          <text
                            x={currX + chipW / 2}
                            y={box.y + 60}
                            textAnchor="middle"
                            fontSize={9.5}
                            fontWeight={700}
                            fill={chip.fg}
                          >
                            {chip.label}
                          </text>
                        </g>
                      )
                    })
                  })()}
                </g>
              )}

              {/* Clickable Subnet Rows */}
              {vnet.subnets.map((subnet, sIdx) => {
                const rowY = subnetStartY + sIdx * 28
                const isSubSelected =
                  selected?.kind === 'subnet' && selected.subnetId === subnet.id
                const inFwd = forwardSubnets.has(subnet.id)
                const inRev = reverseSubnets.has(subnet.id)
                const rt = subnet.routeTableId
                  ? topology.udrTables.find((t) => t.id === subnet.routeTableId)
                  : undefined
                const hasPe = (subnet.privateEndpoints?.length ?? 0) > 0

                let rowFill = 'var(--surface-muted)'
                let rowStroke = 'var(--link)'
                if (inRev) {
                  rowFill = 'var(--warning-surface)'
                  rowStroke = 'var(--return)'
                }
                if (inFwd) {
                  rowFill = 'var(--success-surface)'
                  rowStroke = 'var(--forward)'
                }
                if (isSubSelected) {
                  rowFill = 'var(--selection)'
                  rowStroke = 'var(--accent)'
                }

                return (
                  <g
                    key={subnet.id}
                    data-testid={`aznet-subnet-${subnet.id}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`Subnet ${vnet.name} / ${subnet.name}`}
                    onKeyDown={(e) => openKeyboardContext(e, { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const entity: AzSelectedEntity = {
                        kind: 'subnet',
                        vnetId: vnet.id,
                        subnetId: subnet.id,
                      }
                      onSelect(entity)
                      onContextMenu?.({
                        kind: 'entity',
                        x: e.clientX,
                        y: e.clientY,
                        entity,
                      })
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={box.x + 8}
                      y={rowY}
                      width={box.width - 16}
                      height={24}
                      rx={6}
                      fill={rowFill}
                      stroke={rowStroke}
                      strokeWidth={isSubSelected || inFwd || inRev ? 1.8 : 1}
                    />
                    <text
                      x={box.x + 15}
                      y={rowY + 15}
                      fontSize={10.5}
                      fontWeight={isSubSelected ? 700 : 600}
                      fill="var(--text)"
                    >
                      {subnet.name}
                    </text>
                    <text
                      x={box.x + 148}
                      y={rowY + 15}
                      fontSize={9.5}
                      fill="var(--text)"
                    >
                      {subnet.prefix}
                    </text>
                    {rt && (() => {
                      const rtTags: string[] = [`🗂️ ${rt.name.length > 10 ? `${rt.name.slice(0, 9)}…` : rt.name}`]
                      if (rt.disableBgpRoutePropagation) {
                        rtTags.push('GWroutes:OFF')
                      }
                      if (rt.disablePeeringRoutePropagation) {
                        rtTags.push('PeerSuppress:ON')
                      }
                      const badgeText = rtTags.join(' · ')
                      const badgeW = Math.min(124, Math.max(54, badgeText.length * 4.8 + 10))
                      const badgeX = box.x + box.width - (hasPe ? 38 + badgeW : 10 + badgeW)
                      return (
                        <g
                          data-testid={`aznet-subnet-rt-badge-${subnet.id}`}
                          onMouseEnter={(e) => {
                            clearHoverTimer()
                            const pos = getRelativePopoverPosition(e.clientX, e.clientY)
                            setHoverPopover({
                              kind: 'route-table',
                              vnetId: vnet.id,
                              subnetId: subnet.id,
                              routeTableId: rt.id,
                              x: pos.x,
                              y: pos.y,
                            })
                          }}
                          onMouseLeave={scheduleClosePopover}
                          onClick={(e) => {
                            e.stopPropagation()
                            const entity: AzSelectedEntity = {
                              kind: 'subnet',
                              vnetId: vnet.id,
                              subnetId: subnet.id,
                            }
                            onSelect(entity)
                            const pos = getRelativePopoverPosition(e.clientX, e.clientY)
                            setHoverPopover({
                              kind: 'route-table',
                              vnetId: vnet.id,
                              subnetId: subnet.id,
                              routeTableId: rt.id,
                              x: pos.x,
                              y: pos.y,
                            })
                          }}
                        >
                          <rect
                            x={badgeX}
                            y={rowY + 4}
                            width={badgeW}
                            height={16}
                            rx={4}
                            fill={
                              rt.disableBgpRoutePropagation || rt.disablePeeringRoutePropagation
                                ? 'var(--surface-muted)'
                                : 'var(--surface-muted)'
                            }
                            stroke={
                              rt.disableBgpRoutePropagation || rt.disablePeeringRoutePropagation
                                ? 'var(--link)'
                                : 'var(--link)'
                            }
                            strokeWidth={0.8}
                          />
                          <text
                            x={badgeX + badgeW / 2}
                            y={rowY + 15}
                            textAnchor="middle"
                            fontSize={8}
                            fontWeight={700}
                            fill={
                              rt.disableBgpRoutePropagation || rt.disablePeeringRoutePropagation
                                ? 'var(--text)'
                                : 'var(--accent)'
                            }
                          >
                            {badgeText}
                          </text>
                        </g>
                      )
                    })()}
                    {hasPe && (
                      <g>
                        <rect
                          x={box.x + box.width - 36}
                          y={rowY + 4}
                          width={26}
                          height={16}
                          rx={4}
                          fill="var(--surface-muted)"
                        />
                        <text
                          x={box.x + box.width - 23}
                          y={rowY + 15}
                          textAnchor="middle"
                          fontSize={8.5}
                          fontWeight={700}
                          fill="var(--info)"
                        >
                          PE
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}
              {vnet.label?.trim() ? (
                <g
                  data-testid={`aznet-node-label-${vnet.id}`}
                  transform={`translate(${box.x + box.width / 2}, ${box.y + box.height + 15})`}
                  style={{ pointerEvents: 'none' }}
                >
                  <rect
                    x={-Math.min(Math.max(vnet.label.trim().length * 5.8 + 18, 64), box.width - 8) / 2}
                    y={-10}
                    width={Math.min(Math.max(vnet.label.trim().length * 5.8 + 18, 64), box.width - 8)}
                    height={19}
                    rx={9.5}
                    fill="var(--warning-surface)"
                    stroke="var(--warning)"
                    strokeWidth={1.1}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={600}
                    fill="var(--warning)"
                  >
                    {vnet.label.trim().length > 36 ? `${vnet.label.trim().slice(0, 35)}…` : vnet.label.trim()}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}

        {/* 7. Virtual WAN Hubs (Hybrid Mode) */}
        {topology.vwanHubs.map((hub) => {
          const box = positions.vwanHubs[hub.id]
          if (!box) return null
          const isSelected = selected?.kind === 'vwan-hub' && selected.hubId === hub.id
          return (
            <g
              key={hub.id}
              data-testid={`aznet-vwanhub-${hub.id}`}
              role="button"
              tabIndex={0}
              aria-label={`Select Virtual WAN Hub ${hub.name}`}
              onKeyDown={(e) => openKeyboardContext(e, { kind: 'vwan-hub', hubId: hub.id })}
              onPointerDown={(e) => {
                if (e.button === 2) return
                e.stopPropagation()
                setDragState({
                  mode: 'node',
                  nodeKind: 'vwan-hub',
                  nodeId: hub.id,
                  startMouseX: e.clientX,
                  startMouseY: e.clientY,
                  origX: box.x,
                  origY: box.y,
                })
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSelect({ kind: 'vwan-hub', hubId: hub.id })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'vwan-hub', hubId: hub.id }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={12}
                fill="var(--surface-muted)"
                stroke={isSelected ? 'var(--accent)' : 'var(--info)'}
                strokeWidth={isSelected ? 2.6 : 1.8}
              />
              <text x={box.x + 14} y={box.y + 24} fontSize={12.5} fontWeight={700} fill="var(--text)">
                {hub.name}
              </text>
              <text x={box.x + 14} y={box.y + 42} fontSize={10.5} fill="var(--text)">
                vWAN Hub ({hub.prefix}) · Pref: {hub.preference}
              </text>
              <text x={box.x + 14} y={box.y + 60} fontSize={10} fontWeight={600} fill="var(--info)">
                Routing Intent: {hub.routingIntent.private ? 'Private ✓' : 'Private Off'} /{' '}
                {hub.routingIntent.internet ? 'Internet ✓' : 'Internet Off'}
              </text>
              {hub.label?.trim() ? (
                <g
                  data-testid={`aznet-node-label-${hub.id}`}
                  transform={`translate(${box.x + box.width / 2}, ${box.y + box.height + 15})`}
                  style={{ pointerEvents: 'none' }}
                >
                  <rect
                    x={-Math.min(Math.max(hub.label.trim().length * 5.8 + 18, 64), box.width - 8) / 2}
                    y={-10}
                    width={Math.min(Math.max(hub.label.trim().length * 5.8 + 18, 64), box.width - 8)}
                    height={19}
                    rx={9.5}
                    fill="var(--warning-surface)"
                    stroke="var(--warning)"
                    strokeWidth={1.1}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={600}
                    fill="var(--warning)"
                  >
                    {hub.label.trim().length > 36 ? `${hub.label.trim().slice(0, 35)}…` : hub.label.trim()}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}

        {/* 8. ExpressRoute Locations (MSEE) */}
        {topology.erLocations.map((loc) => {
          const box = positions.erLocations[loc.id]
          if (!box) return null
          const isSelected = selected?.kind === 'er-location' && selected.locationId === loc.id
          return (
            <g
              key={loc.id}
              data-testid={`aznet-erloc-${loc.id}`}
              onPointerDown={(e) => {
                if (e.button === 2) return
                e.stopPropagation()
                setDragState({
                  mode: 'node',
                  nodeKind: 'er-location',
                  nodeId: loc.id,
                  startMouseX: e.clientX,
                  startMouseY: e.clientY,
                  origX: box.x,
                  origY: box.y,
                })
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSelect({ kind: 'er-location', locationId: loc.id })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'er-location', locationId: loc.id }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={10}
                fill="var(--surface-muted)"
                stroke={isSelected ? 'var(--accent)' : 'var(--warning)'}
                strokeWidth={isSelected ? 2.5 : 1.8}
              />
              <text x={box.x + 12} y={box.y + 24} fontSize={12} fontWeight={700} fill="var(--warning)">
                ⚡ {loc.name}
              </text>
              <text x={box.x + 12} y={box.y + 44} fontSize={10} fill="var(--warning)">
                MSEE 12076 · {loc.sku ?? 'Standard'} · GR: {loc.globalReachEnabled ? 'On' : 'Off'}
              </text>
              {loc.label?.trim() ? (
                <g
                  data-testid={`aznet-node-label-${loc.id}`}
                  transform={`translate(${box.x + box.width / 2}, ${box.y + box.height + 15})`}
                  style={{ pointerEvents: 'none' }}
                >
                  <rect
                    x={-Math.min(Math.max(loc.label.trim().length * 5.8 + 18, 64), box.width - 8) / 2}
                    y={-10}
                    width={Math.min(Math.max(loc.label.trim().length * 5.8 + 18, 64), box.width - 8)}
                    height={19}
                    rx={9.5}
                    fill="var(--warning-surface)"
                    stroke="var(--warning)"
                    strokeWidth={1.1}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={600}
                    fill="var(--warning)"
                  >
                    {loc.label.trim().length > 36 ? `${loc.label.trim().slice(0, 35)}…` : loc.label.trim()}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}

        {/* 9. On-Premises Sites */}
        {topology.sites.map((site) => {
          const box = positions.sites[site.id]
          if (!box) return null
          const isSelected = selected?.kind === 'site' && selected.siteId === site.id
          return (
            <g
              key={site.id}
              data-testid={`aznet-site-${site.id}`}
              tabIndex={0}
              role="button"
              aria-label={`On-premises site ${site.name}`}
              onKeyDown={(e) => openKeyboardContext(e, { kind: 'site', siteId: site.id })}
              onPointerDown={(e) => {
                if (e.button === 2) return
                e.stopPropagation()
                setDragState({
                  mode: 'node',
                  nodeKind: 'site',
                  nodeId: site.id,
                  startMouseX: e.clientX,
                  startMouseY: e.clientY,
                  origX: box.x,
                  origY: box.y,
                })
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSelect({ kind: 'site', siteId: site.id })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const entity: AzSelectedEntity = { kind: 'site', siteId: site.id }
                onSelect(entity)
                onContextMenu?.({
                  kind: 'entity',
                  x: e.clientX,
                  y: e.clientY,
                  entity,
                })
              }}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={10}
                fill="var(--surface)"
                stroke={isSelected ? 'var(--accent)' : 'var(--link)'}
                strokeWidth={isSelected ? 2.5 : 1.8}
              />
              <text x={box.x + 12} y={box.y + 24} fontSize={12} fontWeight={700} fill="var(--text)">
                🏢 {site.name}
              </text>
              <text x={box.x + 12} y={box.y + 42} fontSize={10.5} fill="var(--text)">
                ASN {site.asn} · {site.prefixes.join(', ')}
              </text>
              <text x={box.x + 12} y={box.y + 58} fontSize={9.5} fill="var(--text-muted)">
                On-Premises Branch / Datacenter
              </text>
              {site.label?.trim() ? (
                <g
                  data-testid={`aznet-node-label-${site.id}`}
                  transform={`translate(${box.x + box.width / 2}, ${box.y + box.height + 15})`}
                  style={{ pointerEvents: 'none' }}
                >
                  <rect
                    x={-Math.min(Math.max(site.label.trim().length * 5.8 + 18, 64), box.width - 8) / 2}
                    y={-10}
                    width={Math.min(Math.max(site.label.trim().length * 5.8 + 18, 64), box.width - 8)}
                    height={19}
                    rx={9.5}
                    fill="var(--warning-surface)"
                    stroke="var(--warning)"
                    strokeWidth={1.1}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={600}
                    fill="var(--warning)"
                  >
                    {site.label.trim().length > 36 ? `${site.label.trim().slice(0, 35)}…` : site.label.trim()}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}
        {diagnosticNodes.map(({ kind, id, name, box }) => {
          const findings = findingsForNode(kind, id)
          if (!box || !findings.length) return null
          const label = `Review ${findings.length} routing issues for ${name}`
          return <g key={`${kind}:${id}`}
            data-testid={`aznet-finding-badge-${kind === 'vnet' ? id : `${kind}-${id}`}`}
            role="button" tabIndex={0} aria-label={label} style={{ cursor: 'pointer' }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onShowIssues(findings) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onShowIssues(findings)
              }
            }}>
            <title>{label}: {findings.map((finding) => finding.title).join('; ')}</title>
            <circle cx={box.x + box.width - 8} cy={box.y + 6} r={11}
              fill={findings.some((finding) => finding.severity === 'error') ? 'var(--error)' : 'var(--warning)'}
              stroke="var(--link)" strokeWidth={2} />
            <text x={box.x + box.width - 8} y={box.y + 10} textAnchor="middle"
              fontSize={9} fontWeight={800} fill="var(--on-accent)">
              {findings.length > 99 ? '99+' : findings.length}
            </text>
          </g>
        })}
      </svg>

      {/* Interactive Peering Hover Popover (#38, #48) */}
      {hoverPopover?.kind === 'peering' && (() => {
        const peering = topology.vnetPeerings.find((p) => p.id === hoverPopover.peeringId)
        if (!peering) return null
        const vnetA = topology.vnets.find((v) => v.id === peering.vnetAId)
        const vnetB = topology.vnets.find((v) => v.id === peering.vnetBId)
        const vnetAHasGwOrArs = Boolean(
          vnetA && (vnetA.gateways.some((g) => g.enabled) || vnetA.routeServer?.enabled),
        )
        const vnetBHasGwOrArs = Boolean(
          vnetB && (vnetB.gateways.some((g) => g.enabled) || vnetB.routeServer?.enabled),
        )
        return (
          <div
            className="aznet-hover-popover"
            data-testid="aznet-peering-hover-card"
            style={{ left: hoverPopover.x, top: hoverPopover.y }}
            onMouseEnter={clearHoverTimer}
            onMouseLeave={scheduleClosePopover}
          >
            <div className="aznet-hover-popover-header">
              <strong>🔗 {peering.name}</strong>
              <label className="aznet-hover-toggle">
                <input
                  type="checkbox"
                  checked={peering.enabled}
                  onChange={(e) => onTogglePeeringEnabled?.(peering.id, e.target.checked)}
                />
                Enabled
              </label>
            </div>
            <div className="aznet-hover-popover-grid">
              <div className="aznet-hover-popover-col">
                <div className="aznet-hover-col-title">
                  {vnetA?.name ?? peering.vnetAId} → {vnetB?.name ?? peering.vnetBId}
                </div>
                {(
                  [
                    ['allowVirtualNetworkAccess', 'VNet Access'],
                    ['allowForwardedTraffic', 'Forwarded Traffic'],
                    ['allowGatewayTransit', 'Allow GW Transit'],
                    ['useRemoteGateways', 'Use Remote GW'],
                  ] as const
                ).map(([flag, label]) => {
                  const disabledReason =
                    flag === 'useRemoteGateways' && !peering.aToB.useRemoteGateways && vnetAHasGwOrArs
                      ? `${vnetA?.name} already has a local Gateway or Route Server`
                      : flag === 'allowGatewayTransit' && !peering.aToB.allowGatewayTransit && !vnetAHasGwOrArs
                        ? `${vnetA?.name} has no enabled Gateway or Route Server`
                        : undefined
                  return (
                    <label
                      key={flag}
                      className="aznet-hover-check"
                      title={disabledReason}
                      style={disabledReason ? { opacity: 0.55 } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={peering.aToB[flag]}
                        disabled={Boolean(disabledReason)}
                        onChange={(e) =>
                          onUpdatePeeringFlag?.(peering.id, 'aToB', flag, e.target.checked)
                        }
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
              <div className="aznet-hover-popover-col">
                <div className="aznet-hover-col-title">
                  {vnetB?.name ?? peering.vnetBId} → {vnetA?.name ?? peering.vnetAId}
                </div>
                {(
                  [
                    ['allowVirtualNetworkAccess', 'VNet Access'],
                    ['allowForwardedTraffic', 'Forwarded Traffic'],
                    ['allowGatewayTransit', 'Allow GW Transit'],
                    ['useRemoteGateways', 'Use Remote GW'],
                  ] as const
                ).map(([flag, label]) => {
                  const disabledReason =
                    flag === 'useRemoteGateways' && !peering.bToA.useRemoteGateways && vnetBHasGwOrArs
                      ? `${vnetB?.name} already has a local Gateway or Route Server`
                      : flag === 'allowGatewayTransit' && !peering.bToA.allowGatewayTransit && !vnetBHasGwOrArs
                        ? `${vnetB?.name} has no enabled Gateway or Route Server`
                        : undefined
                  return (
                    <label
                      key={flag}
                      className="aznet-hover-check"
                      title={disabledReason}
                      style={disabledReason ? { opacity: 0.55 } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={peering.bToA[flag]}
                        disabled={Boolean(disabledReason)}
                        onChange={(e) =>
                          onUpdatePeeringFlag?.(peering.id, 'bToA', flag, e.target.checked)
                        }
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="aznet-hover-popover-footer">
              <button
                type="button"
                className="aznet-mini-btn"
                onClick={() => {
                  const entity: AzSelectedEntity = { kind: 'peering', peeringId: peering.id }
                  onSelect(entity)
                  onOpenEditorForEntity?.(entity)
                  setHoverPopover(null)
                }}
              >
                Configure Peering…
              </button>
              <button
                type="button"
                className="aznet-mini-btn"
                onClick={() => setHoverPopover(null)}
              >
                Close
              </button>
            </div>
          </div>
        )
      })()}

      {/* Interactive Subnet Route Table Hover Popover (#41) */}
      {hoverPopover?.kind === 'route-table' && (() => {
        const rt = topology.udrTables.find((t) => t.id === hoverPopover.routeTableId)
        const vnet = topology.vnets.find((v) => v.id === hoverPopover.vnetId)
        const subnet = vnet?.subnets.find((s) => s.id === hoverPopover.subnetId)
        if (!rt || !vnet || !subnet) return null
        return (
          <div
            className="aznet-hover-popover"
            data-testid="aznet-rt-hover-card"
            style={{ left: hoverPopover.x, top: hoverPopover.y }}
            onMouseEnter={clearHoverTimer}
            onMouseLeave={scheduleClosePopover}
          >
            <div className="aznet-hover-popover-header">
              <strong>🗂️ {rt.name}</strong>
              <span className="aznet-hover-subtitle">
                {vnet.name} / {subnet.name}
              </span>
            </div>
            <div className="aznet-hover-checks-stack">
              <label className="aznet-hover-check">
                <input
                  type="checkbox"
                  checked={!rt.disableBgpRoutePropagation}
                  onChange={(e) =>
                    onUpdateRouteTable?.(rt.id, {
                      disableBgpRoutePropagation: !e.target.checked,
                    })
                  }
                />
                Propagate Gateway Routes (GWroutes)
              </label>
              <label className="aznet-hover-check">
                <input
                  type="checkbox"
                  checked={!rt.disablePeeringRoutePropagation}
                  onChange={(e) =>
                    onUpdateRouteTable?.(rt.id, {
                      disablePeeringRoutePropagation: !e.target.checked,
                    })
                  }
                />
                Propagate Peering Routes
              </label>
            </div>
            <div className="aznet-hover-routes-list">
              <div className="aznet-hover-col-title">
                UDR Routes ({rt.routes.length})
              </div>
              {rt.routes.length === 0 ? (
                <div className="aznet-hover-empty">No static UDR routes configured.</div>
              ) : (
                rt.routes.slice(0, 5).map((r) => (
                  <div key={r.id} className="aznet-hover-route-row">
                    <code>{r.prefix}</code>
                    <span>
                      → {r.nextHopType}
                      {r.nextHopIp ? ` (${r.nextHopIp})` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="aznet-hover-popover-footer">
              <button
                type="button"
                className="aznet-mini-btn"
                onClick={() => {
                  const entity: AzSelectedEntity = {
                    kind: 'subnet',
                    vnetId: vnet.id,
                    subnetId: subnet.id,
                  }
                  onSelect(entity)
                  onOpenEditorForEntity?.(entity)
                  setHoverPopover(null)
                }}
              >
                Edit Route Table…
              </button>
              <button
                type="button"
                className="aznet-mini-btn aznet-danger-btn"
                onClick={() => {
                  onAssociateSubnetRouteTable?.(vnet.id, subnet.id, undefined)
                  setHoverPopover(null)
                }}
              >
                Detach
              </button>
            </div>
          </div>
        )
      })()}

      {/* Bottom-left Canvas Controls & Clear Highlights */}
      <div className="aznet-canvas-controls">
        <button
          type="button"
          className="aznet-ctrl-btn"
          onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="aznet-ctrl-btn"
          onClick={() => setZoom((z) => Math.max(0.65, +(z - 0.15).toFixed(2)))}
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="aznet-ctrl-btn"
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
        >
          Reset view
        </button>
        {hasActiveHighlights && (
          <button
            type="button"
            className="aznet-ctrl-btn aznet-clear-highlights-btn"
            data-testid="aznet-clear-highlights-btn"
            onClick={onClearHighlights}
          >
            ✕ Clear highlights & icons
          </button>
        )}
      </div>
    </div>
  )
}
