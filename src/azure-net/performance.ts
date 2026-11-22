import { useLayoutEffect } from 'react'

export interface AzNetMetrics {
  counts: Record<string, number>
  durations: Record<string, number[]>
}
declare global {
  interface Window { __AZNET_METRICS__?: AzNetMetrics }
}

/** Opt-in local instrumentation; no telemetry, storage or network traffic. */
export function recordAzWork(kind: string, elapsedMillis: number) {
  const metrics = typeof window !== 'undefined' ? window.__AZNET_METRICS__ : undefined
  if (!metrics) return
  metrics.counts[kind] = (metrics.counts[kind] ?? 0) + 1
  metrics.durations[kind] = [...(metrics.durations[kind] ?? []).slice(-199), elapsedMillis]
}

export function measureAzWork<T>(kind: string, work: () => T): T {
  const metrics = typeof window !== 'undefined' ? window.__AZNET_METRICS__ : undefined
  if (!metrics) return work()
  const start = performance.now()
  try { return work() }
  finally { recordAzWork(kind, performance.now() - start) }
}

export function useMeasuredRender() {
  // oxlint-disable-next-line react/purity -- Opt-in timing is observed only after commit, never used to derive UI.
  const start = typeof window !== 'undefined' && window.__AZNET_METRICS__ ? performance.now() : undefined
  useLayoutEffect(() => {
    const metrics = window.__AZNET_METRICS__
    if (start === undefined || !metrics) return
    // Inclusive render-to-layout span, not an exclusive React or paint duration.
    metrics.durations['render-to-layout'] = [...(metrics.durations['render-to-layout'] ?? []).slice(-199), performance.now() - start]
  })
}
