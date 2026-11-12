export interface AzNetMetrics {
  counts: Record<string, number>
  durations: Record<string, number[]>
}
declare global {
  interface Window { __AZNET_METRICS__?: AzNetMetrics }
}

/** Opt-in local instrumentation; no telemetry, storage or network traffic. */
export function measureAzWork<T>(kind: string, work: () => T): T {
  const metrics = typeof window !== 'undefined' ? window.__AZNET_METRICS__ : undefined
  if (!metrics) return work()
  const start = performance.now()
  try { return work() }
  finally {
    metrics.counts[kind] = (metrics.counts[kind] ?? 0) + 1
    metrics.durations[kind] = [...(metrics.durations[kind] ?? []).slice(-199), performance.now() - start]
  }
}
