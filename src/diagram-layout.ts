import type { LayoutMode, NodePosition, Topology } from './model'

export function diagramLayout(topology: Topology, mode: LayoutMode) {
  const positions = new Map<string, NodePosition>()
  const locations = topology.erLocations ?? []
  const nvaMap = new Map(topology.connections.filter((c) => c.transport === 'SpokeNVA' && c.spokeId).map((c) => [c.siteId, c.spokeId!]))
  const visibleSites = topology.sites.filter((site) => !nvaMap.has(site.id))
  const standaloneSpokes = topology.spokes.filter((spoke) => !spoke.hubId)
  const hubSpokes = topology.spokes.filter((spoke) => Boolean(spoke.hubId))
  let width = Math.max(1000, topology.hubs.length * 260, visibleSites.length * 200, topology.spokes.length * 200, locations.length * 200)
  let height = locations.length ? (standaloneSpokes.length ? 960 : 900) : topology.siteLinks.length ? (standaloneSpokes.length ? 820 : 750) : (standaloneSpokes.length ? 720 : 650)
  if (mode === 'layered') {
    const row = (nodes: { id: string }[], y: number) => nodes.forEach((node, i) => positions.set(node.id, { x: width * (i + 1) / (nodes.length + 1), y }))
    if (standaloneSpokes.length) {
      row(standaloneSpokes, 65)
      row(hubSpokes, 195)
      row(topology.hubs, 390)
      row(locations, 600)
      row(visibleSites, locations.length ? 820 : 620)
    } else {
      row(topology.spokes, 85); row(topology.hubs, 310); row(locations, 540); row(visibleSites, locations.length ? 780 : 550)
    }
  } else {
    const outer = [...topology.spokes, ...locations, ...visibleSites]
    const rings = Math.max(1, Math.ceil(outer.length / 12))
    const radiusX = Math.max(440, topology.hubs.length * 130 + 200)
    const radiusY = Math.max(300, Math.ceil(topology.hubs.length / 8) * 110 + 180)
    width = 2 * (radiusX + (rings - 1) * 260) + 260
    height = 2 * (radiusY + (rings - 1) * 160) + 160
    topology.hubs.forEach((hub, i) => positions.set(hub.id, {
      x: width / 2 + (i - (topology.hubs.length - 1) / 2) * 250,
      y: height / 2 + (topology.hubs.length > 1 ? (i % 2 ? 30 : -30) : 0),
    }))
    outer.forEach((node, i) => {
      const ring = Math.floor(i / 12)
      const count = Math.min(12, outer.length - ring * 12)
      const angle = -Math.PI / 2 + 2 * Math.PI * (i % 12) / count
      positions.set(node.id, {
        x: width / 2 + Math.cos(angle) * (radiusX + ring * 260),
        y: height / 2 + Math.sin(angle) * (radiusY + ring * 160),
      })
    })
  }
  for (const [id, point] of Object.entries(topology.layout?.positions[mode] ?? {})) {
    if (positions.has(id)) positions.set(id, point)
  }
  for (const [siteId, spokeId] of nvaMap) {
    const spokePoint = positions.get(spokeId)
    if (spokePoint) positions.set(siteId, spokePoint)
  }
  width = Math.max(width, ...[...positions.values()].map((p) => p.x + 140))
  height = Math.max(height, ...[...positions.entries()].map(([id, p]) => p.y + (topology.hubs.some((h) => h.id === id) ? 120 : 70)))
  return { positions, width, height }
}

export function diagramCurve(a: NodePosition, b: NodePosition, aSize: NodePosition, bSize: NodePosition, bend = 0) {
  const dx = b.x - a.x, dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  const control = { x: (a.x + b.x) / 2 - dy / length * bend, y: (a.y + b.y) / 2 + dx / length * bend }
  const boundary = (center: NodePosition, size: NodePosition) => {
    const dx = control.x - center.x, dy = control.y - center.y
    const scale = 1 / (Math.max(Math.abs(dx) / size.x, Math.abs(dy) / size.y) || 1)
    return { x: center.x + dx * scale, y: center.y + dy * scale }
  }
  const start = boundary(a, aSize), end = boundary(b, bSize)
  return {
    start, control, end,
    d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    label: { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 },
    at: (t: number) => ({
      x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
      y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
      dx: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
      dy: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y),
    }),
  }
}
