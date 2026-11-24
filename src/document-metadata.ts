import type { ArtifactMetadata } from './document-commands'

export const documentArtifactKey = 'network-simulator:document-artifact:v1'
const containsControls = (value: string) => Array.from(value).some(character => character.charCodeAt(0) < 32)

export function parseArtifactMetadata(raw: string | null): ArtifactMetadata | undefined {
  if (!raw || raw.length > 8192) return undefined
  try {
    const value = JSON.parse(raw)
    if (value?.version !== 1 || !value.destination
      || value.digest !== undefined && (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest))) return undefined
    const source = value.destination
    if (typeof source.name !== 'string' || !source.name || containsControls(source.name)) return undefined
    let destination: ArtifactMetadata['destination']
    if (source.kind === 'file') {
      if (!['browser', 'desktop'].includes(source.platform) || source.name.length > 255
        || typeof source.location !== 'string' || !source.location || source.location.length > 4096
        || containsControls(source.location) || typeof source.revision !== 'string' || !/^[0-9a-f]{64}$/.test(source.revision)) return undefined
      if (source.bindingId !== undefined && (source.platform !== 'browser' || typeof source.bindingId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(source.bindingId))) return undefined
      destination = { kind: 'file', platform: source.platform, name: source.name, location: source.location, revision: source.revision,
        ...(source.bindingId ? { bindingId: source.bindingId } : {}) }
    } else if (source.kind === 'cloud') {
      if (source.name.length > 120 || typeof source.accountId !== 'string' || !source.accountId || source.accountId.length > 1000
        || typeof source.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(source.id)
        || typeof source.etag !== 'string' || !/^"[\x21\x23-\x7e]{1,160}"$/.test(source.etag)) return undefined
      destination = { kind: 'cloud', accountId: source.accountId, id: source.id, name: source.name, etag: source.etag }
    } else return undefined
    return { version: 1, destination, ...(value.digest ? { digest: value.digest } : {}) }
  } catch { return undefined }
}
