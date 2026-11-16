export const flowExportLimits = { maxWidth: 1400, minWidth: 640, maxLanes: 6, maxNodesPerLane: 10, maxBytes: 8_000_000, fps: 20 } as const
export type FlowExportOptions = { format?: 'gif' | 'svg' | 'png'; durationMs?: 1500 | 2000; width?: number }
