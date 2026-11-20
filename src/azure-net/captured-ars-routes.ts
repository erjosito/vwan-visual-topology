import type { AzCapturedBgpPeerRoute } from './azure-import'

export function capturedArsRoutes(input: unknown) {
  const rows: AzCapturedBgpPeerRoute[] = []
  if (!Array.isArray(input) || input.length > 10_000) return { rows, rejected: true }
  let rejected = false
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { rejected = true; continue }
    const row = raw as Record<string, unknown>
    const strings = ['network', 'localAddress', 'localRole', 'nextHop', 'sourcePeer', 'origin', 'asPath'] as const
    if (typeof row.network !== 'string' || !row.network ||
      strings.some((key) => row[key] != null && (typeof row[key] !== 'string' || (row[key] as string).length > 512)) ||
      (row.weight != null && (typeof row.weight !== 'number' || !Number.isSafeInteger(row.weight) || row.weight < 0))) {
      rejected = true
      continue
    }
    const route: AzCapturedBgpPeerRoute = { network: row.network }
    for (const key of strings) if (row[key] != null) route[key] = row[key] as string
    if (row.weight != null) route.weight = row.weight as number
    rows.push(route)
  }
  return { rows, rejected }
}

export function capturedArsEndpoint(row: AzCapturedBgpPeerRoute) {
  return JSON.stringify([row.localRole || '', row.localAddress || ''])
}
