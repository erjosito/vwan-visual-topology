import type { DiagnosticsFinding } from './diagnostics'
import type { Topology } from './model'
import { topologyObject } from './model'
import { evidenceSet, warningFingerprint } from './warning-evidence'

export function vwanWarningToken(topology: Topology, finding: DiagnosticsFinding): string {
  const entries = finding.occurrences ?? [finding]
  const related = entries.flatMap((entry) => entry.related)
  const objects = related.map((ref) => topologyObject(topology, ref)).filter(Boolean)
  const mapIds = new Set<string>()
  const collectMaps = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      if (['inboundMapId', 'outboundMapId'].includes(key) && typeof entry === 'string') mapIds.add(entry)
      else collectMaps(entry)
    }
  }
  objects.forEach(collectMaps)
  const maps = topology.routeMaps?.filter((map) => mapIds.has(map.id) || related.some((ref) => ref.id === map.hubId || ref.id === map.siteId))
  return warningFingerprint('vwan', {
    id: finding.id, rule: finding.rule, severity: finding.severity, confidence: finding.confidence,
    entries: evidenceSet(entries.map((entry) => ({
      id: entry.id, rule: entry.rule, severity: entry.severity, confidence: entry.confidence,
      source: entry.source, target: entry.target, sourceAddress: entry.sourceAddress,
      destinationAddress: entry.destinationAddress, prefix: entry.prefix, isolation: entry.isolation,
      related: evidenceSet(entry.related), evidence: evidenceSet(entry.evidence),
      forward: evidenceSet(entry.forward), reverse: evidenceSet(entry.reverse),
    }))),
    objects: evidenceSet(objects), maps, allowBranchToBranchTraffic: topology.allowBranchToBranchTraffic,
  })
}
