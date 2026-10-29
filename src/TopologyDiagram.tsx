import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { LayoutMode, NodePosition, ObjectSelection, RouteMapDirection, RouterSelection, Topology } from './model'
import { transportLabels } from './model'
import type { Candidate, FlowPath } from './routing'
import { diagramCurve, diagramLayout } from './diagram-layout'
import virtualWanHubIcon from './assets/azure/virtual-wan-hub.svg'
import securedHubIcon from './assets/azure/azure-firewall-manager.svg'
import virtualNetworkIcon from './assets/azure/virtual-network.svg'
import expressRouteIcon from './assets/azure/expressroute.svg'
import { RouteMapPreview } from './RouteMapPreview'

export interface DiagramContextMenu { selection?: ObjectSelection; x: number; y: number; invoker: SVGElement }
interface Props {
  topology: Topology; hubId: string; selected: Candidate[]; preferredSiteLinkIds?: string[]
  sourceConnectionIds?: string[]; sourceSiteLinkIds?: string[]; sourceErLinkIds?: string[]; layout?: LayoutMode; zoom?: number
  paths: FlowPath[]; tracing: boolean; sourceSpokeIds?: string[]; selection?: ObjectSelection
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

export function TopologyDiagram({ topology, hubId, selected, preferredSiteLinkIds, sourceSiteLinkIds = [], sourceConnectionIds = [], sourceErLinkIds = [], layout = 'layered', zoom = 1, paths, sourceSpokeIds = [], tracing, selection, onObjectClick, onObjectContextMenu, onNodeMove, onShowRouteMapRules }: Props) {
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
  const { positions, width: layoutWidth, height: layoutHeight } = diagramLayout(topology, layout)
  const pixelWidth = Math.max(viewport.width, Math.min(layoutWidth, 1200))
  const pixelHeight = Math.max(viewport.height, 560)
  const scale = Math.min(pixelWidth / layoutWidth, pixelHeight / layoutHeight)
  const width = pixelWidth / scale, height = pixelHeight / scale
  if (moving) positions.set(moving.id, moving.position)
  const point = (id: string) => positions.get(id)!
  const hubSize = { x: 112, y: 48 }, nodeSize = { x: 94, y: 44 }
  const activeConnections = new Set(tracing ? [...paths.map((p) => p.connectionId).filter(Boolean), ...sourceConnectionIds] : selected.map((r) => r.connectionId))
  const activeErLinks = new Set(tracing ? [...paths.flatMap((path) => path.erLinkIds ?? []), ...sourceErLinkIds] : selected.flatMap((route) => [route.erHubLinkId, route.erSiteLinkId].filter(Boolean)))
  const edgeKey = (a: string, b: string) => [a, b].sort().join(':')
  const policyLinks = [
    ...topology.connections.map((connection) => {
      const siblings = topology.connections.filter((c) => c.hubId === connection.hubId && c.siteId === connection.siteId)
      const bend = siblings.length === 1 ? 18 : (siblings.findIndex((c) => c.id === connection.id) - (siblings.length - 1) / 2) * 85
      return { ...connection, curve: diagramCurve(point(connection.hubId), point(connection.siteId), hubSize, nodeSize, bend), side: bend < 0 ? -1 : 1,
        endpoints: [{ kind: 'hub', id: connection.hubId }, { kind: 'site', id: connection.siteId }] as RouterSelection[] }
    }),
    ...topology.siteLinks.map((link) => {
      const siblings = topology.siteLinks.filter((l) => edgeKey(l.a, l.b) === edgeKey(link.a, link.b))
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
  const previewNode = preview && (preview.owner.kind === 'hub' ? topology.hubs : topology.sites).find((node) => node.id === preview.owner.id)
  const previewLink = preview && policyLinks.find((link) => link.id === preview.connectionId)
  const previewMapId = previewNode?.routeMapAssignments?.find((assignment) => assignment.connectionId === preview?.connectionId)?.[`${preview!.direction}MapId`]
  const previewMap = topology.routeMaps?.find((map) => map.id === previewMapId)
  const activeHubEdges = new Set<string>()
  if (tracing) paths.forEach((p) => p.hubs.slice(1).forEach((id, i) => activeHubEdges.add(edgeKey(p.hubs[i], id))))
  else selected.filter((r) => r.remote).forEach((r) => activeHubEdges.add(edgeKey(hubId, r.originHubId)))
  const exactSiteLinks = new Set(tracing ? [...paths.flatMap((p) => p.siteLinkIds ?? []), ...sourceSiteLinkIds] : preferredSiteLinkIds ?? selected.flatMap((r) => r.siteLinkIds ?? []))
  const coordinates = (event: PointerEvent<SVGGElement>) => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse())
  const bound = (position: NodePosition, kind: ObjectSelection['kind']) => ({
    x: Math.round(Math.max(120, Math.min(20000, width - 130, position.x))),
    y: Math.round(Math.max(65, Math.min(20000, height - (kind === 'hub' ? 115 : 65), position.y))),
  })
  const selectable = (kind: ObjectSelection['kind'], id: string, label: string, activate = () => onObjectClick({ kind, id })) => ({
    role: 'button', tabIndex: 0, 'aria-label': label,
    'aria-pressed': selection?.kind === kind && selection.id === id,
    onClick: () => { if (suppressClick.current) { suppressClick.current = false; return }; activate() },
    onContextMenu: (event: MouseEvent<SVGGElement>) => {
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      onObjectContextMenu({ selection: { kind, id }, x: event.clientX, y: event.clientY, invoker: event.currentTarget })
    },
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && positions.has(id)) {
        event.preventDefault()
        const p = point(id), step = event.shiftKey ? 30 : 10
        onNodeMove(id, bound({ x: p.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: p.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, kind))
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        onObjectContextMenu({ selection: { kind, id }, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, invoker: event.currentTarget })
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() }
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
      const p = link.curve.at(endpoint ? 0.8 - index * 0.18 : 0.2 + index * 0.18)
      const length = Math.hypot(p.dx, p.dy)
      const normal = length ? { x: -p.dy / length * link.side, y: p.dx / length * link.side } : { x: 0, y: link.side }
      const position = { x: p.x + normal.x * 28, y: p.y + normal.y * 28 }
      const angle = Math.atan2(p.dy, p.dx) * 180 / Math.PI + ((direction === 'inbound') === !!endpoint ? 0 : 180)
      const label = `${direction === 'inbound' ? 'Inbound' : 'Outbound'} route map rules for ${node.name} on ${link.name}`
      return <Fragment key={`${owner.id}:${link.id}:${direction}`}>
        <g className={`policy-guide ${direction} ${link.enabled ? '' : 'is-down'}`} aria-hidden="true">
          <path d={`M ${p.x} ${p.y} L ${position.x} ${position.y}`} className="policy-leader" />
          <path transform={`translate(${p.x},${p.y}) rotate(${angle})`} d="M -9 0 H 9 M 4 -4 L 9 0 L 4 4" className="policy-arrow-halo" />
          <path transform={`translate(${p.x},${p.y}) rotate(${angle})`} d="M -9 0 H 9 M 4 -4 L 9 0 L 4 4" className="policy-arrow" />
        </g>
        <g className={`policy-marker ${direction} ${link.enabled ? '' : 'is-down'} clickable`} data-connection-id={link.id} data-router-id={owner.id} data-direction={direction} transform={`translate(${position.x},${position.y})`} {...selectable(owner.kind, owner.id, label, () => onShowRouteMapRules(owner, direction, link.id))} aria-pressed={undefined}
          aria-describedby={preview && preview.owner.id === owner.id && preview.connectionId === link.id && preview.direction === direction && previewMap ? previewId : undefined}
          onPointerEnter={(event) => { cancelPreviewClose(); setPreview({ owner, connectionId: link.id, direction, anchor: event.currentTarget }) }}
          onPointerLeave={leavePreview}
          onFocus={(event) => { cancelPreviewClose(); setPreview({ owner, connectionId: link.id, direction, anchor: event.currentTarget }) }}
          onBlur={closePreview}>
          <rect x="-23" y="-11" width="46" height="22" rx="7" /><path className="policy-filter" d="M -17 -5 H -7 L -10 0 V 5 L -14 3 V 0 Z" /><text x="7" y="4">{direction === 'inbound' ? 'IN' : 'OUT'}</text>
        </g>
      </Fragment>
    })
  }))
  return <div ref={scroll} className={`diagram-scroll ${moving ? 'is-repositioning' : ''}`} onScroll={closePreview}><svg ref={svg} className={`diagram layout-${layout}`} viewBox={`0 0 ${width} ${height}`} style={{ width: pixelWidth * zoom, height: pixelHeight * zoom }} role="group" tabIndex={0} aria-label="Interactive Virtual WAN topology. Drag nodes to arrange; right-click for actions. Alt+Arrow keys move a focused node." onPointerDownCapture={closePreview} onContextMenu={(event) => {
    if ((event.target as Element).closest('g[role="button"]')) return
    event.preventDefault()
    onObjectContextMenu({ x: event.clientX, y: event.clientY, invoker: event.currentTarget })
  }} onKeyDown={(event) => {
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
    <rect width={width} height={height} fill={layout === 'constellation' ? 'url(#constellation-glow)' : 'url(#grid)'} />
    {layout === 'layered' ? <g className="diagram-captions"><text x="24" y="28" className="diagram-caption">AZURE SPOKE NETWORKS</text><text x="24" y="225" className="diagram-caption">MICROSOFT GLOBAL BACKBONE</text><text x="24" y="465" className="diagram-caption">{topology.erLocations?.length ? 'EXPRESSROUTE LOCATIONS' : 'ON-PREMISES SITES'}</text>{!!topology.erLocations?.length && <text x="24" y="700" className="diagram-caption">ON-PREMISES SITES</text>}</g>
      : <g className="constellation-orbits" aria-hidden="true"><ellipse cx={width / 2} cy={height / 2} rx={width / 2 - 130} ry={height / 2 - 80} /><ellipse cx={width / 2} cy={height / 2} rx={Math.max(180, topology.hubs.length * 130)} ry="145" /><text x="24" y="30" className="diagram-caption">VIRTUAL WAN · NETWORK CONSTELLATION</text></g>}
    {topology.hubs.flatMap((h, i) => topology.hubs.slice(i + 1).map((other) => {
      const edge = diagramCurve(point(h.id), point(other.id), hubSize, hubSize, -35)
      return <g key={edgeKey(h.id, other.id)}><path data-testid={`interhub-${h.id}-${other.id}`} className={`network-link backbone ${activeHubEdges.has(edgeKey(h.id, other.id)) ? 'preferred-link' : ''}`} d={edge.d} />{badge('Inter-hub', edge.label)}</g>
    }))}
    {topology.spokes.map((spoke) => {
      const active = activeConnections.has(spoke.id) || sourceSpokeIds.includes(spoke.id) || (!tracing && spoke.hubId === hubId)
      const edge = diagramCurve(point(spoke.id), point(spoke.hubId), nodeSize, hubSize, 12)
      return <g key={spoke.id} className="clickable" {...selectable('spoke', spoke.id, `Edit spoke connection ${spoke.name}`)}><path className="link-hitbox" d={edge.d} /><path data-testid={`spoke-link-${spoke.id}`} className={`network-link spoke-link ${active ? 'preferred-link' : ''}`} d={edge.d} /></g>
    })}
    {topology.connections.map((connection) => {
      const edge = curves.get(connection.id)!
      const active = connection.enabled && activeConnections.has(connection.id)
      const name = connection.transport === 'ExpressRoute' ? 'ER' : connection.transport === 'SDWAN' ? 'SD-WAN' : 'VPN'
      return <g key={connection.id} className="clickable" {...selectable('connection', connection.id, `Edit connection ${connection.name}`)}><title>{connection.name} · {transportLabels[connection.transport]} · {connection.enabled ? active ? 'Preferred' : 'Alternative' : 'Down'}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`link-${connection.id}`} data-preferred={active} className={`network-link ${connection.transport} ${active ? 'preferred-link' : ''} ${connection.enabled ? '' : 'disabled-link'}`} d={edge.d} />{badge(`${name}${connection.enabled ? '' : ' (down)'}`, edge.label)}</g>
    })}
    {topology.siteLinks.map((link) => {
      const edge = curves.get(link.id)!
      return <g key={link.id} className="clickable" {...selectable('siteLink', link.id, `Select on-premises link ${link.name}`)}><title>{link.name}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`peer-link-${link.id}`} className={`network-link peer-link ${link.enabled && exactSiteLinks.has(link.id) ? 'preferred-link' : ''} ${link.enabled ? '' : 'disabled-link'}`} d={edge.d} />{badge(link.name.length > 30 ? `${link.name.slice(0, 28)}…` : link.name, edge.label)}</g>
    })}
    {(topology.erLinks ?? []).map((link) => {
      const edge = curves.get(link.id)!
      const active = link.enabled && activeErLinks.has(link.id)
      return <g key={link.id} className="clickable" {...selectable('erLink', link.id, `Edit ER connection ${link.name}`)}><title>{link.name} · ExpressRoute · {link.enabled ? 'Enabled' : 'Down'}</title><path className="link-hitbox" d={edge.d} /><path data-testid={`er-link-${link.id}`} className={`network-link ExpressRoute ${active ? 'preferred-link' : ''} ${link.enabled ? '' : 'disabled-link'}`} d={edge.d} />{badge(`ER${link.enabled ? '' : ' (down)'}`, edge.label)}</g>
    })}
    {topology.hubs.map((hub) => {
      const p = point(hub.id)
      const secured = hub.routingIntent.private || hub.routingIntent.internet
      const firewallActive = secured && (tracing ? paths.some((path) => path.firewalls?.includes(hub.id)) : hub.id === hubId)
      return <g key={hub.id} data-node-id={hub.id} transform={`translate(${p.x}, ${p.y})`} {...selectable('hub', hub.id, `Select hub ${hub.name}`)} {...movable('hub', hub.id)} className={`hub-node draggable-node ${hub.id === hubId ? 'active' : ''} ${firewallActive ? 'firewall-active' : ''}`}><title>{hub.name} · {hub.region}{secured && ` · Secured virtual hub · Azure Firewall (${[hub.routingIntent.private && 'private traffic', hub.routingIntent.internet && 'Internet traffic'].filter(Boolean).join(', ')})`}{tracing && firewallActive && ' · Active path traverses Azure Firewall'}</title><rect x="-112" y="-48" width="224" height="96" rx="18" /><NodeIcon kind="hub" secured={secured} /><text x="12" y="-19" className="node-kind">{secured ? 'SECURED VIRTUAL HUB' : 'VIRTUAL HUB'}</text><text y="6" className="node-name">{hub.name.length > 25 ? hub.name.slice(0, 23) + '…' : hub.name}</text><text y="29" className="node-detail">{hub.region.length > 30 ? hub.region.slice(0, 28) + '…' : hub.region}</text></g>
    })}
    {topology.spokes.map((spoke) => {
      const p = point(spoke.id)
      return <g key={spoke.id} data-node-id={spoke.id} transform={`translate(${p.x}, ${p.y})`} className="spoke-node draggable-node" {...selectable('spoke', spoke.id, `Select spoke ${spoke.name}`)} {...movable('spoke', spoke.id)}><title>{spoke.name}: {spoke.prefixes.join(', ')}</title><rect x="-94" y="-44" width="188" height="88" rx="15" /><NodeIcon kind="spoke" /><text x="10" y="-19" className="node-kind">SPOKE VNET</text><text y="6" className="node-name">{spoke.name.length > 22 ? spoke.name.slice(0, 20) + '…' : spoke.name}</text><text y="28" className="node-detail">{spoke.prefixes[0]}{spoke.prefixes.length > 1 ? ` +${spoke.prefixes.length - 1}` : ''}</text></g>
    })}
    {topology.sites.map((site) => {
      const p = point(site.id)
      return <g key={site.id} data-node-id={site.id} transform={`translate(${p.x}, ${p.y})`} className="site-node draggable-node" {...selectable('site', site.id, `Select site ${site.name}`)} {...movable('site', site.id)}><title>{site.name} · ASN {site.asn} · Originated prefix: {site.prefixes[0] || 'none'}</title><rect x="-94" y="-44" width="188" height="88" rx="15" /><NodeIcon kind="site" /><text x="10" y="-24" className="node-kind">ON-PREMISES</text><text y="-3" className="node-name">{site.name.length > 22 ? site.name.slice(0, 20) + '…' : site.name}</text><text y="16" className="node-detail">ASN {site.asn}</text><text y="34" className="node-detail node-prefixes">{site.prefixes[0] ?? 'No assigned prefix'}</text></g>
    })}
    {(topology.erLocations ?? []).map((location) => {
      const p = point(location.id)
      return <g key={location.id} data-node-id={location.id} transform={`translate(${p.x}, ${p.y})`} className="er-location-node draggable-node" {...selectable('erLocation', location.id, `Select ER location ${location.name}`)} {...movable('erLocation', location.id)}><title>{location.name} · ExpressRoute peering location</title><rect x="-94" y="-44" width="188" height="88" rx="15" /><NodeIcon kind="erLocation" /><text x="10" y="-19" className="node-kind">ER LOCATION</text><text y="6" className="node-name">{location.name.length > 22 ? location.name.slice(0, 20) + '…' : location.name}</text><text y="28" className="node-detail">ExpressRoute private peering</text></g>
    })}
    {policyMarks}
    {!topology.hubs.length && !topology.sites.length && !topology.erLocations?.length && <text x={width / 2} y={height / 2} textAnchor="middle" className="empty-diagram">Right-click the canvas to add your first hub or site.</text>}
  </svg>{preview && previewNode && previewLink && previewMap && <RouteMapPreview id={previewId} anchor={preview.anchor} map={previewMap} owner={previewNode.name} connection={previewLink.name} direction={preview.direction} enabled={previewLink.enabled} onEnter={cancelPreviewClose} onLeave={leavePreview} onClose={closePreview} />}</div>
}
