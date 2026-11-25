import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Topology } from './model'
import type { ComparisonSession } from './AzureComparisonPanel'
import type { AzNetTopology } from './azure-net/model'
import type { AzCapturedObservations, AzNetComparisonReport } from './azure-net/azure-import'
import { compareAzure, comparisonProfileKey } from './azure-comparison'
import { routingRevision } from './diagnostics'
import { validateTopology } from './validation'
import { manifestSchema, networkObservationSchema, observationSchema, profileSchema } from './discrepancy-schema'
import type { DiscrepancyManifest } from './discrepancy-schema'
export { discrepancyIssueUrl } from './discrepancy-issue'

export const DISCREPANCY_MAX_BYTES = 25_000_000
export const discrepancyFiles = ['manifest.json', 'topology.json', 'evidence.json', 'report.json', 'issue.md'] as const
export type DiscrepancySource = {
  mode: 'vwan'; topology: Topology; session?: ComparisonSession
} | {
  mode: 'azure-network'; topology: AzNetTopology; observations: AzCapturedObservations | null
  comparison: AzNetComparisonReport | null; notices: string[]; comparisonCurrent: boolean; capture?: unknown
}
export interface DiscrepancyBundle {
  manifest: DiscrepancyManifest
  source: DiscrepancySource
  originalReport: unknown
}
type Description = Pick<DiscrepancyManifest, 'summary' | 'expected' | 'actual'>
type Provenance = DiscrepancyManifest['app']
const invalid = (message: string): never => { throw new Error(message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Invalid discrepancy evidence.')
  return value as Record<string, unknown>
}
function notices(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 4096 || value.some(item => typeof item !== 'string' || item.length > 4096)) {
    return invalid('Invalid discrepancy capture notices.')
  }
  return value as string[]
}
function json(value: unknown) { return strToU8(JSON.stringify(value, null, 2)) }
function originalCapture(value: unknown, mode: DiscrepancySource['mode']): unknown {
  if (value === undefined) return undefined
  const capture = record(value)
  if (capture.kind !== (mode === 'vwan' ? 'azure-vwan-capture' : 'azure-network-capture') || capture.version !== 2
    || strToU8(JSON.stringify(capture)).length > (mode === 'vwan' ? 8_000_000 : 4_000_000)) return invalid('Invalid original Azure capture in discrepancy bundle.')
  return capture
}
function parseJson(bytes: Uint8Array): unknown {
  const parsed: unknown = JSON.parse(strFromU8(bytes))
  const pending = [{ value: parsed, depth: 0 }]
  let count = 0
  while (pending.length) {
    const { value, depth } = pending.pop()!
    if (++count > 1_000_000 || depth > 64) return invalid('Discrepancy JSON exceeds the nesting or item limit.')
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) return invalid('Invalid discrepancy JSON object key.')
        pending.push({ value: child, depth: depth + 1 })
      }
    }
  }
  return parsed
}

export function createDiscrepancyBundle(source: DiscrepancySource, description: Description, app: Provenance, now = new Date()): Uint8Array<ArrayBuffer> {
  let evidence: unknown, originalReport: unknown = null, comparisonAt: string | null = null
  if (source.mode === 'vwan') {
    const session = source.session
    const current = session?.report?.revision === routingRevision(source.topology)
      && session.report.profileKey === comparisonProfileKey(session.profile)
    if (session) {
      evidence = { observation: observationSchema.parse(session.observation), profile: profileSchema.parse(session.profile),
        capture: originalCapture(session.capture, source.mode) }
      if (current) { originalReport = session.report; comparisonAt = session.report!.generatedAt }
    } else evidence = null
  } else {
    evidence = { observations: source.observations ? networkObservationSchema.parse(source.observations) : null,
      notices: notices(source.notices), capture: originalCapture(source.capture, source.mode) }
    if (source.comparisonCurrent && source.comparison) { originalReport = source.comparison; comparisonAt = now.toISOString() }
  }
  const manifest = manifestSchema.parse({
    kind: 'aznetsim-discrepancy', version: 1, mode: source.mode, createdAt: now.toISOString(), comparisonAt, app, ...description,
  })
  const issue = `# ${manifest.summary}\n\n## Expected\n${manifest.expected}\n\n## Actual\n${manifest.actual}\n\n`
    + `Mode: ${manifest.mode}\nApp: ${app.version} (${app.revision})\nEngine revision: ${app.engineRevision}\n`
    + `Created: ${manifest.createdAt}\nComparison time: ${comparisonAt ?? 'No current comparison was exported'}\n\n`
    + 'Import this ZIP from Azure files > Report a discrepancy in the matching workspace mode. '
    + 'Review the preview, then explicitly replace the workspace. '
    + 'The current engine reruns recorded evidence; report.json retains the original results. '
    + 'No Azure connection is required. Partial, failed and unsupported captures remain unassessed. '
    + 'Live convergence and uncaptured behavior cannot be reproduced from this package.\n'
  const files = {
    'manifest.json': json(manifest), 'topology.json': json(source.topology),
    'evidence.json': json(evidence), 'report.json': json(originalReport), 'issue.md': strToU8(issue),
  }
  if (Object.values(files).reduce((sum, file) => sum + file.length, 0) > DISCREPANCY_MAX_BYTES - 4096) {
    return invalid('The discrepancy bundle exceeds the 25 MB GitHub attachment limit. Use a smaller investigation scope.')
  }
  // Stored entries make the input-size limit also a hard decompression-memory bound.
  return new Uint8Array(zipSync(files, { level: 0 }))
}

export async function readDiscrepancyBundle(bytes: Uint8Array): Promise<DiscrepancyBundle> {
  if (bytes.length > DISCREPANCY_MAX_BYTES) return invalid('The discrepancy bundle exceeds the 25 MB GitHub attachment limit.')
  const seen = new Set<string>()
  let size = 0
  const files = unzipSync(bytes, { filter(entry) {
    if (!discrepancyFiles.some(name => name === entry.name) || seen.has(entry.name) || entry.compression !== 0
      || entry.originalSize !== entry.size || (size += entry.originalSize) > DISCREPANCY_MAX_BYTES) {
      return invalid('Invalid discrepancy ZIP. Use the original stored ZIP exported by AzNetSim.')
    }
    seen.add(entry.name)
    return true
  } })
  if (seen.size !== discrepancyFiles.length) return invalid('The discrepancy bundle is missing required files.')
  const parse = (name: typeof discrepancyFiles[number]): unknown => parseJson(files[name])
  const manifest = manifestSchema.parse(parse('manifest.json'))
  const topology = parse('topology.json'), evidence = parse('evidence.json'), originalReport = parse('report.json')
  let source: DiscrepancySource
  if (manifest.mode === 'vwan') {
    const admitted = validateTopology(topology)
    let session: ComparisonSession | undefined
    if (evidence !== null) {
      const data = record(evidence)
      const observation = observationSchema.parse(data.observation), profile = profileSchema.parse(data.profile)
      // Recompute, never execute or trust serialized findings from another machine.
      const report = compareAzure(admitted, observation, profile, Date.parse(manifest.comparisonAt ?? manifest.createdAt))
      session = { observation, profile, capture: originalCapture(data.capture, manifest.mode),
        ...(manifest.comparisonAt ? { report, replayAt: manifest.comparisonAt } : {}) }
    }
    source = { mode: 'vwan', topology: admitted, session }
  } else {
    const { parseAzNetTopology } = await import('./azure-net/admission')
    const admitted = parseAzNetTopology(topology), data = record(evidence)
    const observations = data.observations === null ? null : networkObservationSchema.parse(data.observations)
    let comparison: AzNetComparisonReport | null = null
    if (observations && manifest.comparisonAt) {
      const [{ simulateAzNet }, { compareAzNetWithObservations }] = await Promise.all([import('./azure-net/engine'), import('./azure-net/azure-import')])
      comparison = compareAzNetWithObservations(admitted, simulateAzNet(admitted), observations)
    }
    source = { mode: 'azure-network', topology: admitted, observations, comparison, notices: notices(data.notices),
      comparisonCurrent: true, capture: originalCapture(data.capture, manifest.mode) }
  }
  return { manifest, source, originalReport }
}
