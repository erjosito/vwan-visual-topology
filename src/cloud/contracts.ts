import { parseAzNetTopology } from '../azure-net/admission'
import { validateTopology } from '../validation'

export { parseProgressLedger } from '../learning/progress-ledger'
export type { ProgressLedger } from '../learning/progress-ledger'

export const cloudLimits = { bytes: 4 * 1024 * 1024, name: 120, description: 1024, records: 50 }
export interface CloudMetadata { name: string; description?: string }
export interface CloudTopology extends CloudMetadata { version: 1; topology: unknown }
export interface CloudEntry extends CloudMetadata { id: string; etag: string; updatedAt: string }
export interface CloudValue<T> { value: T; etag: string }
export interface CloudShare {
  id: string; topologyId: string; token: string; expiresAt: string; etag: string
}
export interface SharedTopology { document: CloudTopology; expiresAt: string; sourceVersion?: string }

export function parseCloudMetadata(input: unknown): CloudMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Cloud save metadata is required.')
  const value = input as CloudMetadata
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > cloudLimits.name
    || value.description !== undefined && (typeof value.description !== 'string' || value.description.length > cloudLimits.description)
    || Object.keys(value).some(key => !['name', 'description'].includes(key))) throw new Error('Invalid cloud save name or description.')
  return { name: value.name.trim(), ...(value.description?.trim() ? { description: value.description.trim() } : {}) }
}

export function parseCloudTopology(input: unknown): CloudTopology {
  if (!input || typeof input !== 'object') throw new Error('A named topology is required.')
  const value = input as CloudTopology
  if (value.version !== 1 || typeof value.name !== 'string' || !value.name.trim()
    || value.name.length > cloudLimits.name || Object.keys(value).some(key => !['version', 'name', 'description', 'topology'].includes(key))) {
    throw new Error('A bounded topology name and version are required.')
  }
  const topology = value.topology
  if (!topology || typeof topology !== 'object') throw new Error('A native topology is required.')
  const admitted = 'version' in topology && topology.version === 1 && !('kind' in topology)
    ? validateTopology(topology) : parseAzNetTopology(topology)
  const result: CloudTopology = { version: 1, ...parseCloudMetadata({ name: value.name, description: value.description }), topology: admitted }
  if (new TextEncoder().encode(JSON.stringify(result)).length > cloudLimits.bytes) throw new Error('Cloud topology size limit exceeded.')
  return result
}
