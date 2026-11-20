export const warningAcknowledgementLimit = 4096

export function parseWarningAcknowledgements(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > warningAcknowledgementLimit
    || value.some((entry) => typeof entry !== 'string' || !/^warning:v1:(aznet|vwan):[0-9a-f]{32}$/.test(entry))
    || new Set(value).size !== value.length) throw new Error('Invalid warning acknowledgements.')
  return [...value]
}

const prose = new Set(['name', 'label', 'layout', 'x', 'y', 'title', 'detail', 'summary', 'remediation',
  'steps', 'explanation', 'originLabel', 'nextHopName', 'nodeName', 'subnetName', 'vnetName', 'udrTableName',
  'destinationLabel', 'summaryReason', 'suppressedReason', 'causeTitle', 'warningAcknowledgements'])
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function warningEvidence(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => warningEvidence(entry))
    return key !== 'rules' && entries.every((entry) => entry && typeof entry === 'object' && 'id' in entry)
      ? entries.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) : entries
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([field, entry]) => entry !== undefined && !prose.has(field))
    .sort(([a], [b]) => compare(a, b))
    .map(([field, entry]) => [field, warningEvidence(entry, field)]))
  return value
}

export function evidenceSet(values: unknown[]): unknown[] {
  return values.map((value) => warningEvidence(value)).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)))
}

// A bounded UI content fingerprint, never an assessment or routing authority.
export function warningFingerprint(mode: 'aznet' | 'vwan', evidence: unknown): string {
  const text = JSON.stringify(warningEvidence(evidence))
  const lanes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (let index = 0; index < text.length; index++) {
    for (let lane = 0; lane < lanes.length; lane++) {
      lanes[lane] = Math.imul(lanes[lane] ^ text.charCodeAt(index), 0x01000193 + lane * 2) >>> 0
    }
  }
  return `warning:v1:${mode}:${lanes.map((lane) => lane.toString(16).padStart(8, '0')).join('')}`
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
