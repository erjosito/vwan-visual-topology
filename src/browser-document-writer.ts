import type { ArtifactDestination, ArtifactWriter } from './document-commands'

interface BrowserWritable {
  write(content: string): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
export interface BrowserDocumentHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  isSameEntry(other: BrowserDocumentHandle): Promise<boolean>
  createWritable(options: { mode: 'exclusive' }): Promise<BrowserWritable>
}
type Picker = (name: string) => Promise<BrowserDocumentHandle>
type FileDestination = Extract<ArtifactDestination, { kind: 'file' }>
interface Owner {
  live: boolean
  pending: boolean
  writing?: BrowserDocumentHandle
  file?: { handle: BrowserDocumentHandle; authority: object; revision: string }
}

async function revision(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
async function fileRevision(handle: BrowserDocumentHandle) {
  const file = await handle.getFile()
  if (file.size > 4_000_000) throw new Error('The file exceeds the supported document size.')
  return revision(await file.arrayBuffer())
}
function browserPicker(): Picker | null {
  if (typeof window === 'undefined') return null
  const browser = window as Window & { showSaveFilePicker?: (options: unknown) => Promise<BrowserDocumentHandle> }
  if (typeof browser.showSaveFilePicker !== 'function') return null
  return name => browser.showSaveFilePicker!({
    suggestedName: name, types: [{ description: 'Topology JSON', accept: { 'application/json': ['.json'] } }],
  })
}
function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  document.body.append(anchor)
  try { anchor.click() }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0) }
}

export function createBrowserDocumentWriter(options: {
  picker?: Picker | null
  download?: (content: string, name: string) => void
} = {}) {
  const picker = options.picker === undefined ? browserPicker() : options.picker
  const downloadFile = options.download ?? download
  const owners = new Map<string, Owner>()
  const ownerFor = (id: string) => {
    let owner = owners.get(id)
    if (!owner) {
      if (owners.size >= 64) throw new Error('Too many live file owners.')
      owner = { live: true, pending: false }
      owners.set(id, owner)
    }
    return owner
  }
  const valid = (owner: Owner) => {
    if (!owner.live) throw new Error('The document file permission was released.')
  }
  const destination = (owner: Owner): FileDestination => {
    const file = owner.file!
    return { kind: 'file', platform: 'browser', name: file.handle.name, location: file.handle.name,
      revision: file.revision, authority: file.authority }
  }
  const bind = (documentId: string, handle: BrowserDocumentHandle, savedRevision: string) => {
    const owner = ownerFor(documentId)
    if (owner.pending) throw new Error('Wait for the pending file operation.')
    if (!/^[0-9a-f]{64}$/.test(savedRevision) || handle.kind !== 'file' || !handle.name
      || typeof handle.getFile !== 'function' || typeof handle.createWritable !== 'function') {
      throw new Error('A real file handle and verified file revision are required.')
    }
    owner.file = { handle, revision: savedRevision, authority: {} }
    return destination(owner)
  }
  const write: ArtifactWriter = async ({ documentId, choice, content }) => {
    if (choice.kind === 'cloud' || choice.kind === 'file' && choice.platform !== 'browser') {
      throw new Error('The selected destination is not a browser file.')
    }
    const bytes = new TextEncoder().encode(content)
    if (bytes.byteLength > 4_000_000) throw new Error('The topology exceeds the supported document size.')
    const owner = ownerFor(documentId)
    if (owner.pending) throw new Error('A file operation is already pending for this document.')
    if (choice.kind === 'file' && (!owner.file || choice.authority !== owner.file.authority
      || choice.revision !== owner.file.revision || choice.location !== owner.file.handle.name)) {
      throw new Error('The file permission must be renewed before saving.')
    }
    owner.pending = true
    let writable: BrowserWritable | undefined
    try {
      let handle: BrowserDocumentHandle
      if (choice.kind === 'choose-file') {
        if (!picker) {
          downloadFile(content, choice.name)
          return { confirmed: false, name: choice.name }
        }
        try { handle = await picker(choice.name) }
        catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return null
          throw error
        }
      } else handle = owner.file!.handle
      valid(owner)
      owner.writing = handle
      for (const other of owners.values()) {
        if (other !== owner && other.writing && await handle.isSameEntry(other.writing)) {
          throw new Error('Another document is saving to this file.')
        }
      }
      let permission = await handle.queryPermission({ mode: 'readwrite' })
      if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' })
      valid(owner)
      if (permission !== 'granted') throw new Error('File write permission was not granted.')
      const before = await fileRevision(handle)
      if (choice.kind === 'file' && before !== choice.revision) throw new Error('The file changed externally. Use Save As to choose another destination.')
      valid(owner)
      writable = await handle.createWritable({ mode: 'exclusive' })
      valid(owner)
      if (await fileRevision(handle) !== before) throw new Error('The file changed before writing.')
      await writable.write(content)
      valid(owner)
      if (await fileRevision(handle) !== before) throw new Error('The file changed while saving.')
      await writable.close()
      writable = undefined
      const written = await revision(bytes.buffer)
      if (await fileRevision(handle) !== written) throw new Error('The saved file revision could not be confirmed.')
      valid(owner)
      owner.file = { handle, revision: written, authority: choice.kind === 'file' ? owner.file!.authority : {} }
      return { confirmed: true, destination: destination(owner) }
    } finally {
      if (writable) { try { await writable.abort() } catch { /* Keep the original write failure. */ } }
      owner.pending = false; owner.writing = undefined
    }
  }
  return {
    write,
    bind,
    async read(handle: BrowserDocumentHandle) {
      const file = await handle.getFile()
      if (file.size > 4_000_000) throw new Error('The file exceeds the supported document size.')
      const bytes = await file.arrayBuffer()
      return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), revision: await revision(bytes) }
    },
    release(documentId: string) {
      const owner = owners.get(documentId)
      if (owner) { owner.live = false; owners.delete(documentId) }
    },
  }
}
