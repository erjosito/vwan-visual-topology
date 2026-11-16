import type { Assessment, PlatformResult } from './platform/contract'
import type { DiagnosticsFinding, DiagnosticsReport } from './diagnostics'
import type { AzPairFlowAnalysis, AzFlowTrace } from './azure-net/engine'
import type { NodePath } from './paths'
import { diagramCurve } from './diagram-layout'
import { motionPoint, motionSamples, motionTrack } from './path-motion'
import type { MotionSegment } from './path-motion'
import { flowExportLimits, type FlowExportOptions } from './flow-export-options'
export { flowExportLimits, type FlowExportOptions } from './flow-export-options'

export type FlowExportNode = { id: string; label: string; detail: string; kind: 'endpoint' | 'hub' | 'firewall' | 'transit' }
export type FlowExportLane = {
  direction: 'forward' | 'return'; status: 'delivered' | 'stopped' | 'unknown'
  nodes: FlowExportNode[]; details: string[]
}
export type FlowExportScene = {
  version: 1; engineVersion: string; revision: string; assessmentId: string; outcome: Assessment['outcome']
  width: number; height: number; durationMs: 1500 | 2000
  lanes: FlowExportLane[]; limitations: string[]
}

export function flowExportOptions(input: FlowExportOptions = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['format', 'durationMs', 'width'].includes(key))) throw new Error('Unknown render option.')
  const { format = 'gif', durationMs = 2000, width = 1200 } = input
  if (!['gif', 'svg', 'png'].includes(format) || ![1500, 2000].includes(durationMs)
    || !Number.isInteger(width) || width < flowExportLimits.minWidth || width > flowExportLimits.maxWidth) throw new Error('Invalid render options: GIF/SVG/PNG, 1500/2000 ms, width 640-1400.')
  return { format, durationMs, width }
}

export function createFlowExportScene(result: PlatformResult, assessmentId: string, input: FlowExportOptions = {}): FlowExportScene {
  const options = flowExportOptions(input)
  if (!result.document || result.status === 'invalid' || !result.revision || result.errors.length) throw new Error('A completed simulation result with an admitted document is required.')
  const assessment = result.assessments.find(entry => entry.id === assessmentId)
  if (!assessment?.evidence || typeof assessment.evidence !== 'object' || Array.isArray(assessment.evidence)) throw new Error('Select an assessed flow with directional trace evidence.')
  const lanes: FlowExportLane[] = []
  const add = (lane: FlowExportLane) => {
    lane.nodes = lane.nodes.reduce<FlowExportNode[]>((nodes, node) => {
      const previous = nodes.at(-1)
      if (previous?.id === node.id && (previous.kind === node.kind || previous.kind !== 'firewall' && node.kind !== 'firewall')) {
        if (node.kind === 'endpoint') nodes[nodes.length - 1] = node
      } else nodes.push(node)
      return nodes
    }, [])
    if (!lane.nodes.length) throw new Error('The flow has no owned trace nodes.')
    if (lane.nodes.length > flowExportLimits.maxNodesPerLane) throw new Error('Flow exceeds the export node limit; choose a shorter flow.')
    if (!lanes.some(existing => JSON.stringify(existing) === JSON.stringify(lane))) lanes.push(lane)
  }
  if (result.document.mode === 'vwan') {
    const topology = result.document.topology
    const report = assessment.evidence as DiagnosticsReport
    if (!Array.isArray(report.findings)) throw new Error('The selected assessment is not a flow.')
    const node = (id: string, kind: FlowExportNode['kind'] = 'transit', detail = ''): FlowExportNode => {
      const owner = [...topology.hubs, ...topology.spokes, ...topology.sites, ...(topology.erLocations ?? [])].find(owner => owner.id === id)
      return { id, label: owner?.name ?? id, detail, kind }
    }
    const convert = (finding: DiagnosticsFinding, path: NodePath, direction: FlowExportLane['direction']) => {
      const source = direction === 'forward' ? finding.source : finding.target
      if (!source) return
      const nodes = [node(source.id, 'endpoint', direction === 'forward' ? finding.sourceAddress : finding.destinationAddress)]
      for (const id of path.sourceSiteHops ?? []) nodes.push(node(id))
      if (path.sourceNvaSpokeId) nodes.push(node(path.sourceNvaSpokeId))
      for (const id of path.sourceErLinkIds ?? []) {
        const locationId = topology.erLinks?.find(link => link.id === id)?.locationId
        if (locationId) nodes.push(node(locationId))
      }
      for (const id of path.hubs) {
        const context = path.hubContexts?.find(context => context.hubId === id)
        nodes.push(node(id, 'hub', context?.tableId ?? 'defaultRouteTable'))
        if (path.firewalls?.includes(id)) {
          const hub = topology.hubs.find(hub => hub.id === id)
          nodes.push({ id: hub?.firewall?.id ?? `firewall:${id}`, label: hub?.firewall?.name ?? 'Azure Firewall', detail: 'Inspection hop', kind: 'firewall' })
        }
      }
      for (const id of path.erLinkIds ?? []) {
        const locationId = topology.erLinks?.find(link => link.id === id)?.locationId
        if (locationId) nodes.push(node(locationId))
      }
      for (const id of path.siteHops ?? []) nodes.push(node(id))
      if (path.status === 'delivered' && path.siteId) {
        nodes.push(node(path.siteId, 'endpoint', direction === 'forward' ? finding.destinationAddress : finding.sourceAddress))
      }
      add({
        direction, status: assessment.outcome === 'not assessed' || path.traceComplete === false || path.status === 'unknown' ? 'unknown' : path.status === 'delivered' ? 'delivered' : 'stopped',
        nodes, details: path.steps,
      })
    }
    const findings = report.findings.flatMap(finding => [finding, ...(finding.occurrences ?? [])])
    for (const finding of findings) {
      for (const path of finding.forward) convert(finding, path, 'forward')
      for (const path of finding.reverse) convert(finding, path, 'return')
    }
  } else {
    const topology = result.document.topology
    const pair = assessment.evidence as AzPairFlowAnalysis
    if (!pair.forward || !pair.reverse) throw new Error('The selected assessment is not a directional flow.')
    const convert = (trace: AzFlowTrace, direction: FlowExportLane['direction']) => {
      const nodes: FlowExportNode[] = []
      for (const hop of trace.hops) {
        if (hop.action === 'dropped' || hop.action === 'loop') break
        if (hop.hubTableId === 'firewall-onward') continue
        const inspection = hop.action === 'inspect-firewall' || hop.action === 'inspect-nva'
        const firewallId = inspection && hop.nodeKind === 'vwan-hub'
          ? topology.vwanHubs.find(hub => hub.id === hop.nodeId)?.firewall?.id ?? `firewall:${hop.nodeId}` : hop.nodeId
        nodes.push({
          id: `${hop.nodeKind}:${firewallId}`, label: hop.nodeName,
          kind: inspection ? 'firewall' : hop.nodeKind === 'vwan-hub' ? 'hub' : 'transit',
          detail: hop.hubTableId ?? (hop.action === 'origin' ? direction === 'forward' ? pair.reverse.destinationIp : pair.forward.destinationIp : hop.action === 'delivered' ? trace.destinationIp : hop.action),
        })
      }
      add({
        direction, status: assessment.outcome === 'not assessed' || trace.status === 'not-assessed' ? 'unknown' : trace.status === 'delivered' ? 'delivered' : 'stopped',
        nodes, details: trace.hops.map(hop => hop.detail),
      })
    }
    convert(pair.forward, 'forward'); convert(pair.reverse, 'return')
  }
  if (!lanes.length || lanes.length > flowExportLimits.maxLanes || !lanes.some(lane => lane.direction === 'forward') || !lanes.some(lane => lane.direction === 'return')) {
    throw new Error('Export requires bounded independent forward and return evidence (at most six alternatives).')
  }
  return {
    version: 1, engineVersion: result.engineVersion, revision: result.revision, assessmentId, outcome: assessment.outcome,
    width: options.width, height: 190 + lanes.length * 170, durationMs: options.durationMs, lanes,
    limitations: ['Logical forwarding view; physical interfaces and gateway internals are not expanded.',
      'Animation is illustrative, not delivery, Firewall permission, session or latency evidence.',
      ...result.limitations, ...assessment.reasons],
  }
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!)
const short = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 3)}...` : text
const text = (x: number, y: number, value: string, size = 14, anchor = 'start') =>
  `<text x="${x}" y="${y}" fill="#182230" font-family="Arial,sans-serif" font-size="${size}" text-anchor="${anchor}">${escapeXml(value)}</text>`

function laneGeometry(scene: FlowExportScene, lane: FlowExportLane, index: number) {
  const y = 110 + index * 170
  const spacing = (scene.width - 200) / Math.max(1, lane.nodes.length - 1)
  const halfWidth = Math.min(85, spacing * 0.41), segments: MotionSegment[] = []
  const points = lane.nodes.map((_, i) => ({ x: lane.nodes.length === 1 ? scene.width / 2 : 100 + i * spacing, y: y + 65 }))
  for (let i = 1; i < points.length; i++) {
    const curve = diagramCurve(points[i - 1], points[i], { x: halfWidth, y: 25 }, { x: halfWidth, y: 25 })
    segments.push({ id: `${index}-${i}`, from: lane.nodes[i - 1].id, to: lane.nodes[i].id, ...curve })
  }
  return { y, spacing, halfWidth, points, segments, color: lane.direction === 'forward' ? '#107c41' : '#b35c00' }
}

export function flowFramePixels(scene: FlowExportScene, background: Uint8Array | Uint8ClampedArray, timeMs: number) {
  const pixels = new Uint8Array(background)
  scene.lanes.forEach((lane, index) => {
    if (lane.status === 'unknown') return
    const { points, segments, halfWidth, color } = laneGeometry(scene, lane, index)
    if (!segments.length) return
    const samples = motionSamples(segments)
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16))
    for (let i = 0; i < 3; i++) {
      const point = motionPoint(samples, (timeMs / scene.durationMs + i / 3) % 1)
      for (let y = Math.floor(point.y - 6); y <= Math.ceil(point.y + 6); y++) {
        for (let x = Math.floor(point.x - 6); x <= Math.ceil(point.x + 6); x++) {
          if (x < 0 || y < 0 || x >= scene.width || y >= scene.height
            || points.some(node => Math.abs(node.x - x) <= halfWidth + 1 && Math.abs(node.y - y) <= 26)) continue
          const alpha = Math.max(0, Math.min(1, 5.5 - Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y)))
          const offset = (y * scene.width + x) * 4
          for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - alpha) + rgb[channel] * alpha)
        }
      }
    }
  })
  return pixels
}

export function flowSceneSvg(scene: FlowExportScene, timeMs = 0, animated = false, includeMotion = true): string {
  const w = scene.width, parts: string[] = []
  parts.push(text(24, 34, short(scene.assessmentId, Math.floor(w / 13)), 23),
    text(24, 61, `Routing model | ${scene.outcome} | forward: green / return: amber`, 14))
  scene.lanes.forEach((lane, index) => {
    const { y, color, spacing, halfWidth, segments, points } = laneGeometry(scene, lane, index)
    parts.push(text(24, y, `${lane.direction === 'forward' ? 'Forward' : 'Return'} | ${lane.status === 'delivered' ? 'route reaches owner' : lane.status === 'unknown' ? 'NOT ASSESSED - no moving traffic' : 'STOPPED - no delivery'}`, 15))
    const track = motionTrack(segments)
    parts.push(`<path d="${track}" fill="none" stroke="${lane.status === 'unknown' ? '#8793a1' : color}" stroke-width="3"${lane.direction === 'return' || lane.status === 'unknown' ? ' stroke-dasharray="7 5"' : ''}/>`)
    if (includeMotion && lane.status !== 'unknown' && segments.length) {
      const samples = motionSamples(segments)
      for (let i = 0; i < 3; i++) {
        if (animated) parts.push(`<circle r="5" fill="${color}"><animateMotion path="${track}" dur="${scene.durationMs / 1000}s" begin="${-i * scene.durationMs / 3000}s" calcMode="paced" repeatCount="indefinite"/></circle>`)
        else {
          const point = motionPoint(samples, ((timeMs / scene.durationMs) + i / 3) % 1)
          parts.push(`<circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}"/>`)
        }
      }
    }
    lane.nodes.forEach((node, i) => {
      const point = points[i], firewall = node.kind === 'firewall'
      const labelSize = Math.min(13, Math.max(8, halfWidth / 3))
      const labelLength = Math.floor(2 * halfWidth / (labelSize * 0.65))
      parts.push(`<rect data-node-id="${escapeXml(node.id)}" data-kind="${node.kind}" x="${point.x - halfWidth}" y="${point.y - 25}" width="${2 * halfWidth}" height="50" rx="8" fill="${firewall ? '#fff1d6' : node.kind === 'hub' ? '#e8daef' : '#e5f1fc'}" stroke="${firewall ? '#cb6c08' : '#4276a4'}"/>`,
        text(point.x, point.y - 3, short(node.label, labelLength), labelSize, 'middle'),
        text(point.x, point.y + 15, firewall ? 'FW' : node.kind === 'hub' ? 'HUB' : 'NODE', 10, 'middle'),
        text(point.x, point.y + 52, short(node.detail, Math.floor(Math.min(spacing, 190) / 7)), 11, 'middle'))
    })
    if (lane.status === 'stopped') {
      const last = points.at(-1)!
      parts.push(`<circle cx="${last.x}" cy="${last.y}" r="31" fill="none" stroke="#c43138" stroke-width="3"/>`)
    }
  })
  parts.push(text(24, scene.height - 44, 'Illustrative routing only. No live delivery, Firewall rules, sessions or timing certification.', 12),
    text(24, scene.height - 20, `Engine ${scene.engineVersion} | revision ${short(scene.revision, 24)} | logical hop view`, 11))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${scene.height}" viewBox="0 0 ${w} ${scene.height}" role="img"><title>${escapeXml(scene.assessmentId)}</title><desc>${escapeXml(scene.limitations.join(' '))}</desc><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`
}
