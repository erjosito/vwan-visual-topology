import { createAzNetConnectivityAnalysis } from './diagnostics'
import type { AzConnectivityScope } from './diagnostics'
import { simulateAzNet } from './engine'
import type { AzNetTopology } from './model'

type Request = { type: 'start'; topology: AzNetTopology; scope: AzConnectivityScope } | { type: 'continue' }
let analysis: ReturnType<typeof createAzNetConnectivityAnalysis> | undefined
self.onmessage = ({ data }: MessageEvent<Request>) => {
  const started = performance.now()
  try {
    if (data.type === 'start') analysis = createAzNetConnectivityAnalysis(data.topology, simulateAzNet(data.topology), data.scope)
    if (!analysis) throw new Error('No current analysis')
    const report = analysis.advance()
    if (report.continuation.status !== 'paused') analysis = undefined
    self.postMessage({ report, elapsedMillis: performance.now() - started })
  } catch {
    analysis = undefined
    self.postMessage({ error: 'Diagnostics could not be completed. Review the analysis profile and model limitations.' })
  }
}
