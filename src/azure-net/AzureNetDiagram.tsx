import { useRef, useState } from 'react'
import type { AzDiagnosticFinding } from './diagnostics'
import type { AzFlowTrace } from './engine'
import type { AzNetTopology, AzVNet } from './model'

export type AzSelectedEntity =
  | { kind: 'subnet'; vnetId: string; subnetId: string }
  | { kind: 'vnet'; vnetId: string }
  | { kind: 'gateway'; vnetId: string; gatewayId: string }
  | { kind: 'route-server'; vnetId: string; routeServerId: string }
  | { kind: 'appliance'; vnetId: string; applianceId: string }
  | { kind: 'peering'; peeringId: string }
  | { kind: 'vwan-hub'; hubId: string }
  | { kind: 'er-location'; locationId: string }
  | { kind: 'site'; siteId: string }

interface AzureNetDiagramProps {
  topology: AzNetTopology
  selected: AzSelectedEntity
  onSelect: (entity: AzSelectedEntity) => void
  onMoveNode: (
    nodeKind: 'vnet' | 'vwan-hub' | 'er-location' | 'site',
    nodeId: string,
    x: number,
    y: number,
  ) => void
  forwardTrace?: AzFlowTrace | null
  reverseTrace?: AzFlowTrace | null
  diagnostics: AzDiagnosticFinding[]
  showDiagnosticBadges: boolean
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
  onMoveNode,
  forwardTrace,
  reverseTrace,
  diagnostics,
  showDiagnosticBadges,
  onClearHighlights,
}: AzureNetDiagramProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
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

  const forwardEdges = new Set(forwardTrace?.traversedEdgeIds ?? [])
  const reverseEdges = new Set(reverseTrace?.traversedEdgeIds ?? [])
  const forwardSubnets = new Set(
    (forwardTrace?.hops ?? []).map((h) => h.subnetId).filter((s): s is string => Boolean(s)),
  )
  const reverseSubnets = new Set(
    (reverseTrace?.hops ?? []).map((h) => h.subnetId).filter((s): s is string => Boolean(s)),
  )

  const hasActiveHighlights =
    Boolean(forwardTrace || reverseTrace) || (showDiagnosticBadges && diagnostics.length > 0)

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

  const viewW = 1180 / zoom
  const viewH = 790 / zoom

  return (
    <div className="aznet-canvas-shell" data-testid="aznet-canvas-shell">
      <svg
        ref={svgRef}
        className="aznet-diagram-svg"
        data-testid="aznet-diagram-svg"
        viewBox={`${pan.x} ${pan.y} ${viewW} ${viewH}`}
        onPointerDown={(e) => {
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
      >
        <defs>
          <pattern id="aznet-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="rgba(148, 163, 184, 0.14)"
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
          const isSelected = selected.kind === 'peering' && selected.peeringId === peering.id
          const inForward = forwardEdges.has(peering.id)
          const inReverse = reverseEdges.has(peering.id)
          const hasFinding =
            showDiagnosticBadges && diagnostics.some((d) => d.peeringId === peering.id)
          const brokenAccess =
            !peering.enabled ||
            !peering.aToB.allowVirtualNetworkAccess ||
            !peering.bToA.allowVirtualNetworkAccess

          let stroke = '#0284c7'
          if (brokenAccess || hasFinding) stroke = '#dc2626'
          if (inReverse) stroke = '#d97706'
          if (inForward) stroke = '#059669'
          if (isSelected) stroke = '#2563eb'

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
              onClick={(e) => {
                e.stopPropagation()
                onSelect({ kind: 'peering', peeringId: peering.id })
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
                strokeDasharray={brokenAccess ? '6 5' : undefined}
              />
              <rect
                x={midX - 66}
                y={midY - 11}
                width={132}
                height={22}
                rx={6}
                fill={brokenAccess || hasFinding ? '#fef2f2' : '#f8fafc'}
                stroke={stroke}
                strokeWidth={1.3}
              />
              <text
                x={midX}
                y={midY + 4}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="#0f172a"
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
                stroke={inForward ? '#059669' : inReverse ? '#d97706' : '#0ea5e9'}
                strokeWidth={inForward || inReverse ? 4 : 2.5}
              />
            </g>
          )
        })}

        {/* 3. ExpressRoute Links (via MSEE Locations) */}
        {topology.erLinks.map((link) => {
          if (!link.enabled) return null
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
          const inForward = forwardEdges.has(link.id)
          const inReverse = reverseEdges.has(link.id)
          const stroke = inForward ? '#059669' : inReverse ? '#d97706' : '#b45309'
          return (
            <g key={link.id}>
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse ? 4.2 : 2.8}
              />
            </g>
          )
        })}

        {/* 4. S2S VPN / SD-WAN Overlay Connections */}
        {topology.vpnConnections.map((conn) => {
          if (!conn.enabled) return null
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
          const inForward = forwardEdges.has(conn.id)
          const inReverse = reverseEdges.has(conn.id)
          const stroke = inForward ? '#059669' : inReverse ? '#d97706' : '#7c3aed'
          return (
            <g key={conn.id}>
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={inForward || inReverse ? 3.8 : 2.2}
                strokeDasharray="6 4"
              />
            </g>
          )
        })}

        {/* 5. Site-to-Site Links */}
        {topology.siteLinks.map((sLink) => {
          if (!sLink.enabled) return null
          const boxA = positions.sites[sLink.siteAId]
          const boxB = positions.sites[sLink.siteBId]
          if (!boxA || !boxB) return null
          const a = centerOf(boxA)
          const b = centerOf(boxB)
          const inForward = forwardEdges.has(sLink.id)
          const inReverse = reverseEdges.has(sLink.id)
          return (
            <line
              key={sLink.id}
              x1={a.cx}
              y1={a.cy}
              x2={b.cx}
              y2={b.cy}
              stroke={inForward ? '#059669' : inReverse ? '#d97706' : '#64748b'}
              strokeWidth={inForward || inReverse ? 3.6 : 2}
              strokeDasharray="4 4"
            />
          )
        })}

        {/* 6. Compound VNet Cards */}
        {topology.vnets.map((vnet) => {
          const box = positions.vnets[vnet.id]
          if (!box) return null
          const isVnetSelected = selected.kind === 'vnet' && selected.vnetId === vnet.id
          const vnetFindings = showDiagnosticBadges
            ? diagnostics.filter((d) => d.vnetId === vnet.id)
            : []
          const hasError = vnetFindings.some((f) => f.severity === 'error')
          const hasWarning = vnetFindings.some((f) => f.severity === 'warning')

          const hasControlRow =
            vnet.gateways.length > 0 || Boolean(vnet.routeServer) || vnet.appliances.length > 0
          const subnetStartY = box.y + 44 + (hasControlRow ? 30 : 0) + 6

          return (
            <g
              key={vnet.id}
              data-testid={`aznet-vnet-${vnet.id}`}
              onPointerDown={(e) => {
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
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={12}
                fill="#ffffff"
                stroke={
                  isVnetSelected
                    ? '#2563eb'
                    : hasError
                      ? '#dc2626'
                      : hasWarning
                        ? '#d97706'
                        : isHubVnetRole(vnet.role)
                          ? '#0369a1'
                          : '#475569'
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
                    ? '#e0f2fe'
                    : '#f1f5f9'
                }
              />
              <text
                x={box.x + 12}
                y={box.y + 18}
                fontSize={12.5}
                fontWeight={700}
                fill="#0f172a"
              >
                {vnet.name}
              </text>
              <text
                x={box.x + 12}
                y={box.y + 34}
                fontSize={10.5}
                fill="#475569"
              >
                {vnet.prefixes.join(', ')} · {vnet.region}
              </text>
              <rect
                x={box.x + box.width - 66}
                y={box.y + 8}
                width={56}
                height={18}
                rx={5}
                fill="#0f172a"
              />
              <text
                x={box.x + box.width - 38}
                y={box.y + 20}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={700}
                fill="#f8fafc"
              >
                {vnet.role.toUpperCase()}
              </text>

              {/* Diagnostic Warning Badge on VNet Header */}
              {vnetFindings.length > 0 && (
                <g data-testid={`aznet-finding-badge-${vnet.id}`}>
                  <circle
                    cx={box.x + box.width - 8}
                    cy={box.y + 6}
                    r={10}
                    fill={hasError ? '#dc2626' : '#d97706'}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                  <text
                    x={box.x + box.width - 8}
                    y={box.y + 10}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={800}
                    fill="#ffffff"
                  >
                    !
                  </text>
                </g>
              )}

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
                        bg: gw.kind === 'ExpressRoute' ? '#fef3c7' : '#ede9fe',
                        fg: gw.kind === 'ExpressRoute' ? '#92400e' : '#5b21b6',
                        entity: { kind: 'gateway', vnetId: vnet.id, gatewayId: gw.id },
                      })
                    }
                    if (vnet.routeServer?.enabled) {
                      chips.push({
                        key: vnet.routeServer.id,
                        label: `ARS 65515${vnet.routeServer.branchToBranchTraffic ? ' · B2B' : ''}`,
                        bg: '#dcfce7',
                        fg: '#166534',
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
                            ? '#fee2e2'
                            : app.kind === 'vnra'
                              ? '#dbeafe'
                              : '#f3e8ff',
                        fg:
                          app.kind === 'azure-firewall'
                            ? '#991b1b'
                            : app.kind === 'vnra'
                              ? '#1e40af'
                              : '#6b21a8',
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
                  selected.kind === 'subnet' && selected.subnetId === subnet.id
                const inFwd = forwardSubnets.has(subnet.id)
                const inRev = reverseSubnets.has(subnet.id)
                const rt = subnet.routeTableId
                  ? topology.udrTables.find((t) => t.id === subnet.routeTableId)
                  : undefined
                const hasPe = (subnet.privateEndpoints?.length ?? 0) > 0

                let rowFill = '#f8fafc'
                let rowStroke = '#cbd5e1'
                if (inRev) {
                  rowFill = '#fffbeb'
                  rowStroke = '#d97706'
                }
                if (inFwd) {
                  rowFill = '#ecfdf5'
                  rowStroke = '#059669'
                }
                if (isSubSelected) {
                  rowFill = '#eff6ff'
                  rowStroke = '#2563eb'
                }

                return (
                  <g
                    key={subnet.id}
                    data-testid={`aznet-subnet-${subnet.id}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
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
                      fill="#0f172a"
                    >
                      {subnet.name}
                    </text>
                    <text
                      x={box.x + 148}
                      y={rowY + 15}
                      fontSize={9.5}
                      fill="#475569"
                    >
                      {subnet.prefix}
                    </text>
                    {rt && (
                      <rect
                        x={box.x + box.width - (hasPe ? 84 : 54)}
                        y={rowY + 4}
                        width={44}
                        height={16}
                        rx={4}
                        fill={
                          rt.disableBgpRoutePropagation
                            ? '#fee2e2'
                            : rt.disablePeeringRoutePropagation
                              ? '#fef3c7'
                              : '#e0e7ff'
                        }
                      />
                    )}
                    {rt && (
                      <text
                        x={box.x + box.width - (hasPe ? 62 : 32)}
                        y={rowY + 15}
                        textAnchor="middle"
                        fontSize={8.5}
                        fontWeight={700}
                        fill={
                          rt.disableBgpRoutePropagation
                            ? '#991b1b'
                            : rt.disablePeeringRoutePropagation
                              ? '#92400e'
                              : '#3730a3'
                        }
                      >
                        {rt.disableBgpRoutePropagation
                          ? 'BGP:OFF'
                          : rt.disablePeeringRoutePropagation
                            ? 'Peer:OFF'
                            : 'UDR'}
                      </text>
                    )}
                    {hasPe && (
                      <g>
                        <rect
                          x={box.x + box.width - 36}
                          y={rowY + 4}
                          width={26}
                          height={16}
                          rx={4}
                          fill="#ccfbf1"
                        />
                        <text
                          x={box.x + box.width - 23}
                          y={rowY + 15}
                          textAnchor="middle"
                          fontSize={8.5}
                          fontWeight={700}
                          fill="#115e59"
                        >
                          PE
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* 7. Virtual WAN Hubs (Hybrid Mode) */}
        {topology.vwanHubs.map((hub) => {
          const box = positions.vwanHubs[hub.id]
          if (!box) return null
          const isSelected = selected.kind === 'vwan-hub' && selected.hubId === hub.id
          return (
            <g
              key={hub.id}
              data-testid={`aznet-vwanhub-${hub.id}`}
              onPointerDown={(e) => {
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
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={12}
                fill="#ecfeff"
                stroke={isSelected ? '#2563eb' : '#0891b2'}
                strokeWidth={isSelected ? 2.6 : 1.8}
              />
              <text x={box.x + 14} y={box.y + 24} fontSize={12.5} fontWeight={700} fill="#0f172a">
                {hub.name}
              </text>
              <text x={box.x + 14} y={box.y + 42} fontSize={10.5} fill="#334155">
                vWAN Hub ({hub.prefix}) · Pref: {hub.preference}
              </text>
              <text x={box.x + 14} y={box.y + 60} fontSize={10} fontWeight={600} fill="#0e7490">
                Routing Intent: {hub.routingIntent.private ? 'Private ✓' : 'Private Off'} /{' '}
                {hub.routingIntent.internet ? 'Internet ✓' : 'Internet Off'}
              </text>
            </g>
          )
        })}

        {/* 8. ExpressRoute Locations (MSEE) */}
        {topology.erLocations.map((loc) => {
          const box = positions.erLocations[loc.id]
          if (!box) return null
          const isSelected = selected.kind === 'er-location' && selected.locationId === loc.id
          return (
            <g
              key={loc.id}
              data-testid={`aznet-erloc-${loc.id}`}
              onPointerDown={(e) => {
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
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={10}
                fill="#fffbeb"
                stroke={isSelected ? '#2563eb' : '#d97706'}
                strokeWidth={isSelected ? 2.5 : 1.8}
              />
              <text x={box.x + 12} y={box.y + 24} fontSize={12} fontWeight={700} fill="#78350f">
                ⚡ {loc.name}
              </text>
              <text x={box.x + 12} y={box.y + 44} fontSize={10} fill="#92400e">
                MSEE ASN 12076 · Global Reach: {loc.globalReachEnabled ? 'Enabled' : 'Off'}
              </text>
            </g>
          )
        })}

        {/* 9. On-Premises Sites */}
        {topology.sites.map((site) => {
          const box = positions.sites[site.id]
          if (!box) return null
          const isSelected = selected.kind === 'site' && selected.siteId === site.id
          return (
            <g
              key={site.id}
              data-testid={`aznet-site-${site.id}`}
              onPointerDown={(e) => {
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
              style={{ cursor: 'grab' }}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx={10}
                fill="#f8fafc"
                stroke={isSelected ? '#2563eb' : '#334155'}
                strokeWidth={isSelected ? 2.5 : 1.8}
              />
              <text x={box.x + 12} y={box.y + 24} fontSize={12} fontWeight={700} fill="#0f172a">
                🏢 {site.name}
              </text>
              <text x={box.x + 12} y={box.y + 42} fontSize={10.5} fill="#475569">
                ASN {site.asn} · {site.prefixes.join(', ')}
              </text>
              <text x={box.x + 12} y={box.y + 58} fontSize={9.5} fill="#64748b">
                On-Premises Branch / Datacenter
              </text>
            </g>
          )
        })}
      </svg>

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
