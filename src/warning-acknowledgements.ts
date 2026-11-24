export const warningAcknowledgementLimit = 4096

export function canAcknowledgeWarning(finding: {
  severity: string; rule?: string; category?: string; confidence?: string
  forward?: { status: string; traceComplete?: boolean }[]; reverse?: { status: string; traceComplete?: boolean }[]
}) {
  return finding.severity === 'warning' && finding.confidence !== 'unknown'
    && !['unknown', 'network-unreachable', 'unreachable', 'connectivity-failure', 'routing-not-assessed', 'scale-limit'].includes(finding.category ?? finding.rule ?? '')
    && ![...(finding.forward ?? []), ...(finding.reverse ?? [])].some((path) => path.status === 'unknown' || path.traceComplete === false)
}

export function orderWarningFindings<T>(findings: T[], acknowledged: (finding: T) => boolean): T[] {
  return [...findings.filter((finding) => !acknowledged(finding)), ...findings.filter(acknowledged)]
}

export function parseWarningAcknowledgements(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > warningAcknowledgementLimit
    || value.some((entry) => typeof entry !== 'string' || !/^warning:v1:(aznet|vwan):[0-9a-f]{32}$/.test(entry))
    || new Set(value).size !== value.length) throw new Error('Invalid warning acknowledgements.')
  return [...value]
}

export function setWarningAcknowledgement(topology: { warningAcknowledgements?: string[] }, token: string, acknowledged: boolean) {
  const entries = new Set(parseWarningAcknowledgements(topology.warningAcknowledgements) ?? [])
  if (acknowledged) {
    if (!entries.has(token) && entries.size >= warningAcknowledgementLimit) {
      throw new Error('Warning acknowledgement limit reached. Restore attention for an acknowledged warning before adding another.')
    }
    entries.add(token)
  } else entries.delete(token)
  if (entries.size) topology.warningAcknowledgements = [...entries]
  else delete topology.warningAcknowledgements
}
