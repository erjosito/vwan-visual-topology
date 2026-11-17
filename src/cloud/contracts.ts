import { parseAzNetTopology } from '../azure-net/admission'
import { validateTopology } from '../validation'

export { parseProgressLedger } from '../learning/progress-ledger'
export type { ProgressLedger } from '../learning/progress-ledger'

export const cloudLimits = { bytes: 4 * 1024 * 1024, name: 120, records: 50 }
export interface CloudTopology { version: 1; name: string; topology: unknown }
export interface CloudEntry { id: string; name: string; etag: string; updatedAt: string }
export interface CloudValue<T> { value: T; etag: string }

export function parseCloudTopology(input: unknown): CloudTopology {
  if (!input || typeof input !== 'object') throw new Error('A named topology is required.')
  const value = input as CloudTopology
  if (value.version !== 1 || typeof value.name !== 'string' || !value.name.trim()
    || value.name.length > cloudLimits.name || Object.keys(value).some(key => !['version', 'name', 'topology'].includes(key))) {
    throw new Error('A bounded topology name and version are required.')
  }
  const topology = value.topology
  if (!topology || typeof topology !== 'object') throw new Error('A native topology is required.')
  const admitted = 'version' in topology && topology.version === 1 && !('kind' in topology)
    ? validateTopology(topology) : parseAzNetTopology(topology)
  const result: CloudTopology = { version: 1, name: value.name.trim(), topology: admitted }
  if (new TextEncoder().encode(JSON.stringify(result)).length > cloudLimits.bytes) throw new Error('Cloud topology size limit exceeded.')
  return result
}
