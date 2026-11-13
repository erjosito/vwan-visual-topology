import { AZNET_MAX_JSON_LENGTH, parseAzNetJson, parseAzNetTopology } from './admission'
import { createEmptyAzNetTopology, type AzNetTopology } from './model'

export const AZNET_STORAGE_KEY = 'aznet-visual-topology:v1'
export const workspaceError = (error: unknown) => error instanceof Error ? error.message : String(error)
export interface AzWorkspace {
  sampleId: string
  topology: AzNetTopology
  snapshotImported: boolean
  recovery: { source: string; raw: string; message: string }[]
}

export function loadAzWorkspace(storage: Pick<Storage, 'getItem'>, hash: string): AzWorkspace {
  const result: AzWorkspace = { sampleId: '', topology: createEmptyAzNetTopology(), snapshotImported: false, recovery: [] }
  try {
    const raw = storage.getItem(AZNET_STORAGE_KEY)
    if (raw !== null) {
      try {
        if (raw.length > AZNET_MAX_JSON_LENGTH + 4096) throw new Error('Saved workspace exceeds size limit.')
        const record: unknown = JSON.parse(raw)
        if (!record || typeof record !== 'object' || !('topology' in record)) throw new Error('Missing workspace topology.')
        result.topology = parseAzNetTopology(record.topology)
        if ('sampleId' in record && typeof record.sampleId === 'string') result.sampleId = record.sampleId.slice(0, 120)
      } catch (error) {
        result.recovery.push({ source: 'browser workspace', raw, message: workspaceError(error) })
      }
    }
  } catch (error) {
    result.recovery.push({ source: 'browser storage', raw: '', message: workspaceError(error) })
  }
  if (/(?:#|&)s=/.test(hash)) {
    try {
      const match = hash.match(/(?:#|&)s=([A-Za-z0-9_-]+)(?:&|$)/)
      if (!match || match[1].length > Math.ceil(AZNET_MAX_JSON_LENGTH * 4 / 3)) throw new Error('Malformed or oversized shared snapshot.')
      const binary = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'))
      const json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
      result.topology = parseAzNetJson(json)
      result.sampleId = 'shared-topology'
      result.snapshotImported = true
    } catch (error) {
      result.recovery.push({ source: 'URL snapshot', raw: hash, message: workspaceError(error) })
    }
  }
  return result
}

/** Consume a snapshot once. Shared links remain snapshots, never a hidden override on reload. */
export function consumeAzSnapshotUrl() {
  const url = new URL(window.location.href)
  const fragments = url.hash.slice(1).split('&').filter((part) => !part.startsWith('s='))
  url.hash = fragments.join('&')
  // An explicit sample is also a one-time load, not a persistent override of saved edits.
  url.searchParams.delete('sample')
  window.history.replaceState(null, '', url)
}

export function downloadAzText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
