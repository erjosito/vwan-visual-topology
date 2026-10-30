import { analyzeRouting } from './diagnostics'
import type { DiagnosticsProfile } from './diagnostics'
import type { Topology } from './model'

self.onmessage = ({ data }: MessageEvent<{ topology: Topology; profile: DiagnosticsProfile }>) => {
  try { self.postMessage({ report: analyzeRouting(data.topology, data.profile) }) }
  catch { self.postMessage({ error: 'Diagnostics could not be completed. Review the analysis profile and model limitations.' }) }
}
