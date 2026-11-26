import { CloudHttpError, type CloudClient } from './client'
import { cloudLimits, parseCloudTopology, type CloudEntry, type CloudTopology } from './contracts'
import { fingerprint } from './document-state'

export const libraryBackupLimits = { entries: 50, bytes: 32 * 1024 * 1024 }
const format = 'aznetsim-cloud-library'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const version = /^"[\x21\x23-\x7e]{1,160}"$/
type LibraryApi = Pick<CloudClient, 'listTopologies' | 'getTopology' | 'saveTopology'>
export type BackupErrorCode = 'invalid' | 'limit' | 'changed' | 'request' | 'access'
export class LibraryBackupError extends Error {
  code: BackupErrorCode
  id?: string
  constructor(code: BackupErrorCode, id?: string) {
    super(`Library backup: ${code}${id ? ` (${id})` : ''}`)
    this.code = code
    this.id = id
  }
}
export interface LibraryBackupEntry { id: string; document: CloudTopology }
export interface LibraryBackup { format: typeof format; version: 1; entries: LibraryBackupEntry[] }
export interface LibraryImportEntry extends LibraryBackupEntry {
  state: 'new' | 'identical' | 'conflict' | 'error'
  etag?: string
  error?: BackupErrorCode
}
export interface LibraryImportResult {
  id: string
  status: 'imported' | 'confirmed' | 'identical' | 'kept' | 'failed' | 'unconfirmed' | 'not-started'
  error?: BackupErrorCode | 'quota'
}

function object(input: unknown, fields: string[]): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).every(key => fields.includes(key))
}
function checkSize(raw: string) {
  if (raw.length > libraryBackupLimits.bytes || new TextEncoder().encode(raw).length > libraryBackupLimits.bytes) {
    throw new LibraryBackupError('limit')
  }
}
function checkedBackup(input: unknown): LibraryBackup {
  if (!object(input, ['format', 'version', 'entries']) || input.format !== format || input.version !== 1
    || !Array.isArray(input.entries)) throw new LibraryBackupError('invalid')
  if (input.entries.length > libraryBackupLimits.entries) throw new LibraryBackupError('limit')
  const ids = new Set<string>()
  const entries = input.entries.map((entry: unknown): LibraryBackupEntry => {
    if (!object(entry, ['id', 'document']) || typeof entry.id !== 'string' || !uuid.test(entry.id)
      || ids.has(entry.id)) throw new LibraryBackupError('invalid')
    ids.add(entry.id)
    try { return { id: entry.id, document: parseCloudTopology(entry.document) } }
    catch { throw new LibraryBackupError('invalid', entry.id) }
  })
  return { format, version: 1, entries }
}
export function parseLibraryBackup(raw: string): LibraryBackup {
  checkSize(raw)
  let input: unknown
  try { input = JSON.parse(raw) } catch { throw new LibraryBackupError('invalid') }
  return checkedBackup(input)
}
function checkedList(entries: CloudEntry[]) {
  if (!Array.isArray(entries)) throw new LibraryBackupError('invalid')
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!entry || !uuid.test(entry.id) || !version.test(entry.etag) || ids.has(entry.id)) {
      throw new LibraryBackupError('invalid')
    }
    ids.add(entry.id)
  }
  return entries
}
function errorCode(error: unknown): BackupErrorCode {
  return error instanceof LibraryBackupError ? error.code
    : error instanceof CloudHttpError && [401, 403].includes(error.status) ? 'access'
      : error instanceof CloudHttpError && error.status === 412 ? 'changed' : 'request'
}
async function same(left: CloudTopology, right: CloudTopology) {
  return await fingerprint(left) === await fingerprint(right)
}

export async function exportLibraryBackup(api: LibraryApi, selected: readonly string[] | undefined, signal: AbortSignal) {
  signal.throwIfAborted()
  const before = checkedList(await api.listTopologies())
  signal.throwIfAborted()
  const wanted = selected ? new Set(selected) : undefined
  if (wanted && (!wanted.size || wanted.size !== selected!.length || [...wanted].some(id => !uuid.test(id)))) {
    throw new LibraryBackupError('invalid')
  }
  const entries = wanted ? before.filter(entry => wanted.has(entry.id)) : before
  if (wanted && entries.length !== wanted.size) throw new LibraryBackupError('changed')
  if (entries.length > libraryBackupLimits.entries) throw new LibraryBackupError('limit')
  const documents: LibraryBackupEntry[] = []
  let bytes = 0
  for (const entry of entries) {
    signal.throwIfAborted()
    const saved = await api.getTopology(entry.id)
    signal.throwIfAborted()
    if (!saved || saved.etag !== entry.etag) throw new LibraryBackupError('changed', entry.id)
    let document: CloudTopology
    try { document = parseCloudTopology(saved.value) } catch { throw new LibraryBackupError('invalid', entry.id) }
    const portable = { id: entry.id, document }
    bytes += new TextEncoder().encode(JSON.stringify(portable)).length
    if (bytes > libraryBackupLimits.bytes) throw new LibraryBackupError('limit')
    documents.push(portable)
  }
  const after = checkedList(await api.listTopologies())
  signal.throwIfAborted()
  const revisions = new Map(after.map(entry => [entry.id, entry.etag]))
  if ((!wanted && (after.length !== before.length || after.some(entry => !before.some(old => old.id === entry.id))))
    || entries.some(entry => revisions.get(entry.id) !== entry.etag)) throw new LibraryBackupError('changed')
  const raw = JSON.stringify({ format, version: 1, entries: documents } satisfies LibraryBackup)
  checkSize(raw)
  return { raw, count: documents.length }
}

export async function previewLibraryBackup(api: LibraryApi, backup: LibraryBackup, signal: AbortSignal): Promise<LibraryImportEntry[]> {
  const entries: LibraryImportEntry[] = []
  for (const entry of backup.entries) {
    signal.throwIfAborted()
    try {
      const current = await api.getTopology(entry.id)
      signal.throwIfAborted()
      if (!current) entries.push({ ...entry, state: 'new' })
      else {
        if (!version.test(current.etag)) throw new LibraryBackupError('invalid', entry.id)
        const document = parseCloudTopology(current.value)
        const identical = await same(document, entry.document)
        signal.throwIfAborted()
        entries.push({ ...entry, state: identical ? 'identical' : 'conflict', etag: current.etag })
      }
    } catch (error) {
      signal.throwIfAborted()
      if (errorCode(error) === 'access') throw error
      entries.push({ ...entry, state: 'error', error: errorCode(error) })
    }
  }
  return entries
}

export async function importLibraryBackup(api: LibraryApi, entries: readonly LibraryImportEntry[],
  overwrites: ReadonlySet<string>, signal: AbortSignal): Promise<LibraryImportResult[]> {
  signal.throwIfAborted()
  let count = checkedList(await api.listTopologies()).length
  const results: LibraryImportResult[] = []
  for (const entry of entries) {
    if (signal.aborted) { results.push({ id: entry.id, status: 'not-started' }); continue }
    if (entry.state === 'identical') { results.push({ id: entry.id, status: 'identical' }); continue }
    if (entry.state === 'conflict' && !overwrites.has(entry.id)) { results.push({ id: entry.id, status: 'kept' }); continue }
    if (entry.state === 'error') { results.push({ id: entry.id, status: 'failed', error: entry.error }); continue }
    if (entry.state === 'conflict' && (!entry.etag || !version.test(entry.etag))) {
      results.push({ id: entry.id, status: 'failed', error: 'invalid' }); continue
    }
    // Reconcile before retrying so a lost create acknowledgement never generates another GUID.
    let current: Awaited<ReturnType<LibraryApi['getTopology']>>
    try {
      current = await api.getTopology(entry.id)
      signal.throwIfAborted()
      if (current && await same(parseCloudTopology(current.value), entry.document)) {
        signal.throwIfAborted()
        results.push({ id: entry.id, status: 'confirmed' }); continue
      }
      signal.throwIfAborted()
    } catch (error) {
      results.push({ id: entry.id, status: signal.aborted ? 'not-started' : 'failed', error: errorCode(error) })
      continue
    }
    if (entry.state === 'new' ? !!current : !current || current.etag !== entry.etag) {
      results.push({ id: entry.id, status: 'failed', error: 'changed' }); continue
    }
    if (entry.state === 'new' && count >= cloudLimits.records) {
      results.push({ id: entry.id, status: 'failed', error: 'quota' }); continue
    }
    try {
      await api.saveTopology(entry.id, entry.document, entry.state === 'new' ? null : entry.etag!)
      if (signal.aborted) { results.push({ id: entry.id, status: 'unconfirmed' }); continue }
      if (entry.state === 'new') count++
      results.push({ id: entry.id, status: 'imported' })
    } catch (error) {
      if (signal.aborted) { results.push({ id: entry.id, status: 'unconfirmed' }); continue }
      try {
        const found = await api.getTopology(entry.id)
        signal.throwIfAborted()
        if (found && await same(parseCloudTopology(found.value), entry.document)) {
          signal.throwIfAborted()
          if (entry.state === 'new') count++
          results.push({ id: entry.id, status: 'confirmed' }); continue
        }
        results.push({ id: entry.id,
          status: error instanceof CloudHttpError && error.status >= 400 && error.status < 500 ? 'failed' : 'unconfirmed',
          error: error instanceof CloudHttpError && error.status === 413 ? 'quota' : errorCode(error) })
      } catch {
        results.push({ id: entry.id, status: 'unconfirmed', error: errorCode(error) })
      }
    }
  }
  return results
}
