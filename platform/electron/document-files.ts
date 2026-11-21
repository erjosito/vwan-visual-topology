import { constants } from 'node:fs'
import { access, lstat, realpath, open, rename, link, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { admitJson } from '../../src/platform/service'
import type { DesktopFileDestination, DesktopDocumentRequest, DesktopSaveRequest, DesktopFileFailure, LocalFile } from '../../src/platform/desktop'

const maxBytes = 4_000_000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export class DocumentFileError extends Error {
  constructor(public readonly code: DesktopFileFailure, cause?: unknown) {
    super({
      invalid: 'Only bounded native topology JSON and valid document capabilities are supported.',
      busy: 'A file operation is already running for this document.',
      revoked: 'The document file capability is no longer available. Select a destination again.',
      conflict: 'The selected file changed or disappeared. Load it again or use Save As; it has not been overwritten.',
      permission: 'The selected file could not be written. Check permissions, disk space and the destination.',
      failed: 'The local file operation failed. The prior destination remains selected.',
    }[code], { cause })
  }
}

interface Snapshot { digest: string; dev: number; ino: number; mode: number; content: string }
interface Destination { token: string; path: string; snapshot: Snapshot }
interface Owner { id: string; controller: AbortController; busy: boolean; destination?: Destination }
interface FileDialogs {
  open: (language?: 'en' | 'ja') => Promise<string | undefined>
  save: (name: string, language?: 'en' | 'ja', saveAs?: boolean) => Promise<string | undefined>
}

function documentRequest(value: unknown, save = false): DesktopDocumentRequest | DesktopSaveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !(save ? ['documentId', 'language', 'content', 'destinationToken', 'suggestedName'] : ['documentId', 'language']).includes(key))
    || !('documentId' in value) || typeof value.documentId !== 'string' || !uuid.test(value.documentId)
    || ('language' in value && value.language !== 'en' && value.language !== 'ja')) {
    throw new DocumentFileError('invalid')
  }
  if (save && (!('content' in value) || typeof value.content !== 'string' || Buffer.byteLength(value.content, 'utf8') > maxBytes
    || ('destinationToken' in value && (typeof value.destinationToken !== 'string' || !uuid.test(value.destinationToken)))
    || ('suggestedName' in value && (typeof value.suggestedName !== 'string'
      || !value.suggestedName.length || value.suggestedName.length > 120 || /[\\/:*?"<>|]/.test(value.suggestedName)
      || Array.from(value.suggestedName).some(character => character.charCodeAt(0) < 32)
      || /[. ]$/.test(value.suggestedName))))) {
    throw new DocumentFileError('invalid')
  }
  return value as DesktopDocumentRequest | DesktopSaveRequest
}

function nativeContent(content: string, required = false) {
  let value: unknown
  try { value = JSON.parse(content.replace(/^\uFEFF/, '')); admitJson(value) } catch { throw new DocumentFileError('invalid') }
  const native = !!value && typeof value === 'object'
    && (('version' in value && value.version === 1 && !('kind' in value))
      || ('kind' in value && value.kind === 'azure-network-topology'))
  if (required && !native) throw new DocumentFileError('invalid')
  return native
}

async function selectedPath(file: string) {
  if (extname(file).toLowerCase() !== '.json') throw new DocumentFileError('invalid')
  return join(await realpath(dirname(file)), basename(file))
}

async function snapshot(file: string): Promise<Snapshot> {
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new DocumentFileError('invalid')
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes) throw new DocumentFileError('invalid')
    const bytes = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < bytes.length) {
      const next = await handle.read(bytes, size, Math.min(65_536, bytes.length - size), size)
      if (!next.bytesRead) break
      size += next.bytesRead
    }
    if (size > maxBytes) throw new DocumentFileError('invalid')
    const after = await lstat(file)
    if (after.isSymbolicLink() || after.dev !== info.dev || after.ino !== info.ino) throw new DocumentFileError('conflict')
    const data = bytes.subarray(0, size)
    return { digest: createHash('sha256').update(data).digest('hex'), dev: info.dev, ino: info.ino,
      mode: info.mode, content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) }
  } finally { await handle.close() }
}

function sameFile(first: Snapshot, second: Snapshot) {
  return first.digest === second.digest && first.dev === second.dev && first.ino === second.ino
}

async function writableFile(file: string) {
  await access(file, constants.W_OK)
  // access() does not enforce Windows ACLs; opening without truncation checks actual write permission.
  const handle = await open(file, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
  await handle.close()
}

function publicDestination(destination: Destination): DesktopFileDestination {
  return { token: destination.token, name: basename(destination.path), location: destination.path,
    revision: destination.snapshot.digest }
}

async function replaceFile(temporary: string, file: string, digest: string, signal: AbortSignal) {
  if (process.platform !== 'win32') { await rename(temporary, file); return }
  // Windows ReplaceFile preserves the destination's ACL; MoveFileEx/rename does not.
  const command = `
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  $stream=[IO.File]::OpenRead([string]$p.file)
  try {
    if ($stream.Length -gt 4000000) { exit 42 }
    $hash=[Security.Cryptography.SHA256]::Create()
    try { $digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
  } finally { $stream.Dispose() }
  if ($digest -ne $p.digest) { exit 42 }
  [IO.File]::Replace([string]$p.temporary,[string]$p.file,[NullString]::Value)
} catch {
  $failure=$_.Exception
  while ($failure.InnerException) { $failure=$failure.InnerException }
  if ($failure -is [UnauthorizedAccessException]) { exit 13 }
  if ($failure -is [IO.FileNotFoundException]) { exit 42 }
  exit 1
}`
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await new Promise<void>((resolve, reject) => {
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15_000, maxBuffer: 4096, signal },
    error => {
      if (error?.code === 42) reject(new DocumentFileError('conflict'))
      else if (error?.code === 13) reject(new DocumentFileError('permission'))
      else if (error) reject(error)
      else resolve()
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(JSON.stringify({ temporary, file, digest }))
  })
}

export class DesktopDocumentFiles {
  private owners = new Map<string, Owner>()
  private operations = new Set<Promise<unknown>>()
  private paths = new Set<string>()
  private picking = false
  private closed = false
  constructor(private dialogs: FileDialogs) {}

  private current(owner: Owner) {
    if (this.closed || owner.controller.signal.aborted || this.owners.get(owner.id) !== owner) throw new DocumentFileError('revoked')
  }

  private run<T>(id: string, action: (owner: Owner) => Promise<T>): Promise<T> {
    if (this.closed) throw new DocumentFileError('revoked')
    let owner = this.owners.get(id)
    if (!owner) {
      if (this.owners.size >= 64) throw new DocumentFileError('busy')
      owner = { id, controller: new AbortController(), busy: false }
      this.owners.set(id, owner)
    }
    if (owner.busy) throw new DocumentFileError('busy')
    owner.busy = true
    const current = owner
    const operation = (async () => {
      try { return await action(current) }
      catch (error) {
        if (error instanceof DocumentFileError) throw error
        if (current.controller.signal.aborted) throw new DocumentFileError('revoked')
        const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
        throw new DocumentFileError(['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT'].includes(String(code)) ? 'permission' : 'failed', error)
      } finally {
        current.busy = false
        if (!current.destination && this.owners.get(id) === current) this.owners.delete(id)
      }
    })()
    this.operations.add(operation)
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation))
    return operation
  }

  private async pick(owner: Owner, choose: () => Promise<string | undefined>) {
    this.current(owner)
    if (this.picking) throw new DocumentFileError('busy')
    this.picking = true
    const signal = owner.controller.signal
    let aborted: () => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      aborted = () => reject(new DocumentFileError('revoked'))
      signal.addEventListener('abort', aborted, { once: true })
    })
    try {
      const file = await Promise.race([choose(), cancelled])
      this.current(owner)
      return file
    } finally {
      signal.removeEventListener('abort', aborted)
      this.picking = false
    }
  }

  async open(request: unknown): Promise<LocalFile> {
    const input = documentRequest(request)
    return this.run(input.documentId, async owner => {
      if (owner.destination) throw new DocumentFileError('invalid')
      const selected = await this.pick(owner, () => this.dialogs.open(input.language))
      if (!selected) return null
      const file = await selectedPath(selected)
      const loaded = await snapshot(file)
      const native = nativeContent(loaded.content)
      let writable = native
      if (writable) {
        try { await writableFile(file) } catch { writable = false }
      }
      this.current(owner)
      if (writable) owner.destination = { token: randomUUID(), path: file, snapshot: loaded }
      return { name: basename(file), content: loaded.content,
        ...(owner.destination ? { destination: publicDestination(owner.destination) } : { readOnly: true }) }
    })
  }

  async save(request: unknown): Promise<DesktopFileDestination | null> {
    const input = documentRequest(request, true) as DesktopSaveRequest
    nativeContent(input.content, true)
    return this.run(input.documentId, async owner => {
      const prior = owner.destination
      if (input.destinationToken && input.destinationToken !== prior?.token) throw new DocumentFileError('revoked')
      let file: string, expected: Snapshot | undefined
      if (input.destinationToken && prior) { file = prior.path; expected = prior.snapshot }
      else {
        const name = input.suggestedName ?? 'topology.json'
        const selected = await this.pick(owner, () => this.dialogs.save(/\.json$/i.test(name) ? name : `${name}.json`, input.language, !!prior))
        if (!selected) return null
        file = await selectedPath(selected)
        try { expected = await snapshot(file); nativeContent(expected.content, true) }
        catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
        }
      }
      this.current(owner)
      const pathKey = process.platform === 'win32' ? file.toLowerCase() : file
      if (this.paths.has(pathKey)) throw new DocumentFileError('busy')
      this.paths.add(pathKey)
      const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`)
      let created = false
      try {
        if (expected) {
          try { if (!sameFile(expected, await snapshot(file))) throw new DocumentFileError('conflict') }
          catch { throw new DocumentFileError('conflict') }
          await writableFile(file)
        }
        const handle = await open(temporary, 'wx', expected ? expected.mode & 0o777 : 0o600)
        created = true
        try { await handle.writeFile(input.content, 'utf8'); await handle.sync() }
        finally { await handle.close() }
        this.current(owner)
        if (expected) {
          try { if (!sameFile(expected, await snapshot(file))) throw new DocumentFileError('conflict') }
          catch { throw new DocumentFileError('conflict') }
          await writableFile(file)
          await replaceFile(temporary, file, expected.digest, owner.controller.signal)
          created = false
        } else {
          // Exclusive creation must not overwrite a file that appeared after the picker.
          try { await link(temporary, file) }
          catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new DocumentFileError('conflict')
            throw error
          }
        }
        const written = await snapshot(file)
        if (written.digest !== createHash('sha256').update(input.content, 'utf8').digest('hex')) throw new DocumentFileError('conflict')
        this.current(owner)
        const destination = { token: randomUUID(), path: file, snapshot: written }
        owner.destination = destination
        return publicDestination(destination)
      } finally {
        this.paths.delete(pathKey)
        if (created) await unlink(temporary).catch(() => {})
      }
    })
  }

  release(request: unknown) {
    const { documentId } = documentRequest(request)
    const owner = this.owners.get(documentId)
    owner?.controller.abort()
    this.owners.delete(documentId)
  }

  async close() {
    this.closed = true
    for (const owner of this.owners.values()) owner.controller.abort()
    await Promise.allSettled([...this.operations])
    this.owners.clear()
  }
}
