import { createRoutingAnalysis } from './diagnostics'
import type { DiagnosticsProfile } from './diagnostics'
import type { Topology } from './model'

type Request = { type?: 'start'; topology: Topology; profile: DiagnosticsProfile; automatic?: boolean } | { type: 'continue' }
let analysis: ReturnType<typeof createRoutingAnalysis> | undefined
self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    if (data.type !== 'continue') {
      analysis = createRoutingAnalysis(data.topology, data.profile, data.automatic
        ? { automatic: true, maxCells: 50000, maxProbes: 20000, maxFindings: 1000, maxMillis: 15000 } : {})
    }
    if (!analysis) throw new Error('No current analysis')
    const report = analysis.advance()
    if (report.continuation?.status !== 'paused') analysis = undefined
    self.postMessage({ report })
  } catch {
    analysis = undefined
    self.postMessage({ error: 'Diagnostics could not be completed. Review the analysis profile and model limitations.' })
  }
}
