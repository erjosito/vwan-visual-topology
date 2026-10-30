import { analyzeRouting } from './diagnostics'
import type { DiagnosticsProfile } from './diagnostics'
import type { Topology } from './model'

self.onmessage = ({ data }: MessageEvent<{ topology: Topology; profile: DiagnosticsProfile; automatic?: boolean }>) => {
  try { self.postMessage({ report: analyzeRouting(data.topology, data.profile, data.automatic ? { automatic: true, maxCells: 50000, maxProbes: 20000, maxFindings: 1000, maxMillis: 15000 } : {}) }) }
  catch { self.postMessage({ error: 'Diagnostics could not be completed. Review the analysis profile and model limitations.' }) }
}
