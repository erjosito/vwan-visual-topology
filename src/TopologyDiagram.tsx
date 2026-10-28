import type { Topology } from './model'
import type { KeyboardEvent } from 'react'
import { preferenceLabels, transportLabels } from './model'
import type { Candidate, FlowPath } from './routing'

interface Props {
  topology: Topology
  hubId: string
  selected: Candidate[]
  paths: FlowPath[]
  tracing: boolean
  sourceSpokeId?: string
  onHubClick: (id: string) => void
  onConnectionClick: (id: string) => void
}

export function TopologyDiagram({ topology, hubId, selected, paths, sourceSpokeId, tracing, onHubClick, onConnectionClick }: Props) {
  const width = Math.max(900, topology.hubs.length * 250, topology.sites.length * 200, topology.spokes.length * 200)
  const positions = (ids: string[], y: number) => new Map(ids.map((id, i) => [id, { x: width * (i + 1) / (ids.length + 1), y }]))
  const hubs = positions(topology.hubs.map((h) => h.id), 290)
  const sites = positions(topology.sites.map((s) => s.id), 515)
  const spokes = positions(topology.spokes.map((s) => s.id), 80)
  const activeConnections = new Set(tracing ? paths.map((p) => p.connectionId).filter(Boolean) : selected.map((r) => r.connectionId))
  const activeHubEdges = new Set<string>()
  const edgeKey = (a: string, b: string) => [a, b].sort().join(':')
  if (tracing) paths.forEach((p) => p.hubs.slice(1).forEach((id, i) => activeHubEdges.add(edgeKey(p.hubs[i], id))))
  else selected.filter((r) => r.remote).forEach((r) => activeHubEdges.add(edgeKey(hubId, r.originHubId)))
  const sourceSpokes = new Set(topology.spokes.filter((s) => s.hubId === hubId).map((s) => s.id))
  const activeSiteEdges = new Set<string>()
  const sitePaths = tracing ? paths.flatMap((p) => p.siteHops ? [p.siteHops] : []) : selected.flatMap((r) => r.sitePath ? [r.sitePath] : [])
  sitePaths.forEach((path) => path.slice(1).forEach((id, i) => activeSiteEdges.add(edgeKey(path[i], id))))
  const activate = (action: () => void) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() }
  }
  const height = topology.siteLinks.length ? 720 : 610
  return <div className="diagram-scroll"><svg className="diagram" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: Math.min(width, 1200) }} role="img" aria-label="Interactive Virtual WAN topology. Hubs are clickable to show preferred routes.">
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d8e2ee" /></pattern></defs>
    <rect width={width} height={height} fill="url(#grid)" />
    <text x="24" y="28" className="diagram-caption">AZURE SPOKE NETWORKS</text>
    <text x="24" y="210" className="diagram-caption">MICROSOFT GLOBAL BACKBONE</text>
    <text x="24" y="435" className="diagram-caption">ON-PREMISES SITES</text>
    {topology.hubs.flatMap((h, i) => topology.hubs.slice(i + 1).map((other) => {
      const a = hubs.get(h.id)!, b = hubs.get(other.id)!
      const active = activeHubEdges.has(edgeKey(h.id, other.id))
      return <g key={edgeKey(h.id, other.id)}><path data-testid={`interhub-${h.id}-${other.id}`} className={`network-link backbone ${active ? 'preferred-link' : ''}`} d={`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${a.y - 100} ${b.x} ${b.y}`} /><text x={(a.x + b.x) / 2} y={a.y - 53} className="link-label">Inter-hub</text></g>
    }))}
    {topology.spokes.map((spoke) => {
      const a = spokes.get(spoke.id)!, b = hubs.get(spoke.hubId)!
      const active = activeConnections.has(spoke.id) || sourceSpokeId === spoke.id || (!tracing && sourceSpokes.has(spoke.id))
      return <path key={spoke.id} data-testid={`spoke-link-${spoke.id}`} className={`network-link spoke-link ${active ? 'preferred-link' : ''}`} d={`M ${a.x} ${a.y + 35} C ${a.x} 160 ${b.x} 160 ${b.x} ${b.y - 40}`} />
    })}
    {topology.connections.map((connection) => {
      const a = hubs.get(connection.hubId)!, b = sites.get(connection.siteId)!
      const siblings = topology.connections.filter((c) => c.hubId === connection.hubId && c.siteId === connection.siteId)
      const offset = (siblings.findIndex((c) => c.id === connection.id) - (siblings.length - 1) / 2) * 55
      const active = connection.enabled && activeConnections.has(connection.id)
      return <g key={connection.id} className="clickable" role="button" tabIndex={0} aria-label={`Edit connection ${connection.name}`} onClick={() => onConnectionClick(connection.id)} onKeyDown={activate(() => onConnectionClick(connection.id))}>
        <title>{connection.name} · {transportLabels[connection.transport]} · {connection.enabled ? active ? 'Preferred' : 'Alternative' : 'Down'}</title>
        <path className="link-hitbox" d={`M ${a.x} ${a.y + 40} C ${a.x + offset} 395 ${b.x + offset} 420 ${b.x} ${b.y - 33}`} />
        <path data-testid={`link-${connection.id}`} data-preferred={active} className={`network-link ${connection.transport} ${active ? 'preferred-link' : ''} ${connection.enabled ? '' : 'disabled-link'}`} d={`M ${a.x} ${a.y + 40} C ${a.x + offset} 395 ${b.x + offset} 420 ${b.x} ${b.y - 33}`} />
        <text className="link-label" x={(a.x + b.x) / 2 + offset * 0.75} y={408 + offset * 0.2}>{connection.transport === 'ExpressRoute' ? 'ER' : connection.transport === 'SDWAN' ? 'SD-WAN' : 'VPN'}{!connection.enabled ? ' (down)' : ''}</text>
      </g>
    })}
    {topology.siteLinks.map((link, index) => {
      const a = sites.get(link.a)!, b = sites.get(link.b)!
      const active = link.enabled && activeSiteEdges.has(edgeKey(link.a, link.b))
      return <g key={link.id}><title>{link.name}: {topology.sites.find((s) => s.id === link.a)?.name} ↔ {topology.sites.find((s) => s.id === link.b)?.name}</title><path data-testid={`peer-link-${link.id}`} className={`network-link peer-link ${active ? 'preferred-link' : ''} ${link.enabled ? '' : 'disabled-link'}`} d={`M ${a.x} ${a.y + 33} Q ${(a.x + b.x) / 2} ${650 + (index % 3) * 20} ${b.x} ${b.y + 33}`} /><text x={(a.x + b.x) / 2} y={600 + (index % 3) * 10} className="link-label">{link.name.length > 30 ? link.name.slice(0, 28) + '…' : link.name}</text></g>
    })}
    {topology.hubs.filter((h) => h.routingIntent.private || h.routingIntent.internet).map((hub) => {
      const p = hubs.get(hub.id)!
      const active = tracing ? paths.some((path) => path.firewalls?.includes(hub.id)) : hub.id === hubId
      return <g key={`fw:${hub.id}`} className="firewall-node" transform={`translate(${p.x + 82}, ${p.y + 83})`}><title>Azure Firewall · {hub.name}</title><path className={`network-link ${active ? 'preferred-link' : ''}`} d="M -40 -42 L -10 -18" /><rect x="-52" y="-17" width="104" height="34" rx="8" /><text y="4" className="node-detail">Azure Firewall</text></g>
    })}
    {topology.hubs.map((hub) => {
      const p = hubs.get(hub.id)!
      return <g key={hub.id} transform={`translate(${p.x}, ${p.y})`} role="button" tabIndex={0} aria-label={`Select hub ${hub.name}`} aria-pressed={hub.id === hubId} className={`hub-node clickable ${hub.id === hubId ? 'active' : ''}`} onClick={() => onHubClick(hub.id)} onKeyDown={activate(() => onHubClick(hub.id))}>
        <rect x="-105" y="-44" width="210" height="88" rx="14" /><text y="-15" className="node-kind">VIRTUAL HUB</text><text y="7" className="node-name">{hub.name.length > 25 ? hub.name.slice(0, 23) + '…' : hub.name}</text><text y="28" className="node-detail">{preferenceLabels[hub.preference]} · {hub.region.length > 18 ? hub.region.slice(0, 16) + '…' : hub.region}</text>
      </g>
    })}
    {topology.spokes.map((spoke) => {
      const p = spokes.get(spoke.id)!
      return <g key={spoke.id} transform={`translate(${p.x}, ${p.y})`} className="spoke-node"><title>{spoke.name}: {spoke.prefixes.join(', ')}</title><rect x="-88" y="-35" width="176" height="70" rx="10" /><text y="-12" className="node-kind">SPOKE VNET</text><text y="8" className="node-name">{spoke.name.length > 22 ? spoke.name.slice(0, 20) + '…' : spoke.name}</text><text y="26" className="node-detail">{spoke.prefixes[0]}{spoke.prefixes.length > 1 ? ` +${spoke.prefixes.length - 1}` : ''}</text></g>
    })}
    {topology.sites.map((site) => {
      const p = sites.get(site.id)!
      return <g key={site.id} transform={`translate(${p.x}, ${p.y})`} className="site-node"><title>{site.name}</title><rect x="-88" y="-33" width="176" height="66" rx="10" /><text y="-10" className="node-kind">ON-PREMISES</text><text y="13" className="node-name">{site.name.length > 22 ? site.name.slice(0, 20) + '…' : site.name}</text></g>
    })}
    {!topology.hubs.length && <text x={width / 2} y="290" textAnchor="middle" className="empty-diagram">Add your first hub in the topology editor.</text>}
  </svg></div>
}
