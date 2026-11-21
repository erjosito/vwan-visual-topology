import { fingerprint } from './cloud/document-state'

export type ArtifactDestination =
  | { kind: 'file'; platform: 'desktop' | 'browser'; name: string; location: string; revision: string; bindingId?: string; authority: unknown }
  | { kind: 'cloud'; accountId: string; id: string; name: string; etag: string }

export type ArtifactChoice = ArtifactDestination | { kind: 'choose-file'; name: string }
  | { kind: 'choose-cloud'; accountId: string; name: string }
  | { kind: 'download-copy'; name: string }
export type ArtifactMetadata = {
  version: 1
  destination: Omit<Extract<ArtifactDestination, { kind: 'file' }>, 'authority'> | Extract<ArtifactDestination, { kind: 'cloud' }>
  digest?: string
}
export type ArtifactWriteRequest = { documentId: string; choice: ArtifactChoice; content: string }
export type ArtifactWriter = (request: ArtifactWriteRequest) => Promise<ArtifactReceipt>
export type ArtifactReceipt = { confirmed: true; destination: ArtifactDestination } | { confirmed: false; name: string } | null
export type CommandResult = 'saved' | 'downloaded' | 'cancelled' | 'needs-destination' | 'busy' | 'failed' | 'revoked'
export interface ArtifactSnapshot {
  destination?: ArtifactMetadata['destination']
  operation: 'idle' | 'saving' | 'failed'
  revision: 'draft' | 'checking' | 'matches' | 'modified' | 'unknown'
  retained: boolean
  fileAccess?: 'required' | 'available'
  notice?: { kind: 'saved' | 'downloaded'; name: string; location?: string }
  error?: string
}

export function createDocumentCommands({
  documentId, getTopology, getAccountId, write, retain, release, authorizeFile, confirmed, digest = fingerprint,
}: {
  documentId: string
  getTopology: () => unknown
  getAccountId: () => string | undefined
  write: ArtifactWriter
  retain: (metadata: ArtifactMetadata | undefined) => boolean
  release?: () => Promise<void>
  authorizeFile?: (destination: Extract<ArtifactDestination, { kind: 'file' }>) => Promise<Extract<ArtifactDestination, { kind: 'file' }> | null>
  confirmed?: (destination: ArtifactDestination, topology: unknown) => void
  digest?: (topology: unknown) => Promise<string>
}) {
  let destination: ArtifactDestination | undefined
  let savedDigest: string | undefined
  let retained = false
  let live = true, observation = 0, confirmation = 0, accountGeneration = 0
  let pending: Promise<CommandResult> | undefined
  let snapshot: ArtifactSnapshot = { operation: 'idle', revision: 'draft', retained: false }
  const listeners = new Set<() => void>()
  const metadataDestination = (value: ArtifactDestination): ArtifactMetadata['destination'] => value.kind === 'cloud'
    ? { kind: value.kind, accountId: value.accountId, id: value.id, name: value.name, etag: value.etag }
    : { kind: value.kind, platform: value.platform, name: value.name, location: value.location, revision: value.revision,
      ...(value.bindingId ? { bindingId: value.bindingId } : {}) }
  const publish = (update: Partial<ArtifactSnapshot>) => {
    snapshot = { ...snapshot, ...update }
    for (const listener of listeners) listener()
  }
  const owned = (value: ArtifactDestination) => value.kind !== 'cloud' || value.accountId === getAccountId()
  const exposeDestination = () => ({
    destination: destination && owned(destination) ? metadataDestination(destination) : undefined,
    fileAccess: destination?.kind === 'file' ? destination.authority === undefined ? 'required' as const : 'available' as const : undefined,
  })
  const retainSafely = (value: ArtifactMetadata | undefined) => {
    try { return retain(value) } catch { return false }
  }
  const observe = async () => {
    const ticket = ++observation
    if (!live || !destination || !owned(destination)) return
    const accountTicket = accountGeneration
    publish({ revision: 'checking' })
    try {
      const value = await digest(JSON.parse(JSON.stringify(getTopology())))
      if (!live || ticket !== observation || destination.kind === 'cloud' && accountTicket !== accountGeneration) return
      publish({ revision: savedDigest ? value === savedDigest ? 'matches' : 'modified' : 'unknown' })
    } catch {
      if (live && ticket === observation) publish({ revision: 'unknown' })
    }
  }
  const confirm = async (value: ArtifactDestination, topology: unknown) => {
    const ticket = ++confirmation
    const accountTicket = accountGeneration
    let hash: string | undefined
    try { hash = await digest(topology) } catch { /* A confirmed write can still have an unverified model revision. */ }
    if (!live || ticket !== confirmation || !owned(value)
      || value.kind === 'cloud' && accountTicket !== accountGeneration) return false
    destination = value; savedDigest = hash
    const metadata = { version: 1 as const, destination: metadataDestination(value), digest: hash }
    retained = retainSafely(metadata)
    publish({ ...exposeDestination(), operation: 'idle', retained, error: undefined })
    await observe()
    if (live && ticket === confirmation && owned(value)) confirmed?.(value, topology)
    return true
  }
  const run = (choice: ArtifactChoice | undefined): Promise<CommandResult> => {
    if (!live) return Promise.resolve('revoked')
    if (pending) return Promise.resolve('busy')
    if (!choice) return Promise.resolve('needs-destination')
    const cloudChoice = choice.kind === 'cloud' || choice.kind === 'choose-cloud'
    if (cloudChoice && choice.accountId !== getAccountId()) {
      publish({ operation: 'failed', error: 'The saved cloud destination belongs to a different account.' })
      return Promise.resolve('failed')
    }
    if (choice.kind === 'file' && choice.authority === undefined && !authorizeFile) {
      publish({ operation: 'failed', error: 'The file permission must be renewed before saving.' })
      return Promise.resolve('failed')
    }
    const accountTicket = accountGeneration
    let content: string, topology: unknown
    try {
      content = JSON.stringify(getTopology(), null, 2)
      if (!content || new TextEncoder().encode(content).length > 4_000_000) throw new Error('The topology exceeds the supported document size.')
      topology = JSON.parse(content)
    } catch (error) {
      publish({ operation: 'failed', error: error instanceof Error ? error.message : 'The topology could not be serialized.' })
      return Promise.resolve('failed')
    }
    const operation = async (): Promise<CommandResult> => {
      try {
        if (!live) return 'revoked'
        if (cloudChoice && (choice.accountId !== getAccountId() || accountTicket !== accountGeneration)) {
          throw new Error('The cloud account changed before saving.')
        }
        let authorized = choice
        if (choice.kind === 'file' && choice.authority === undefined) {
          const renewed = await authorizeFile!(choice)
          if (!live) return 'revoked'
          if (!renewed) { publish({ operation: 'idle' }); return 'cancelled' }
          if (renewed.authority === undefined || renewed.platform !== choice.platform
            || renewed.location !== choice.location || renewed.name !== choice.name
            || renewed.revision !== choice.revision || renewed.bindingId !== choice.bindingId) {
            throw new Error('The renewed permission does not match the original file. Use Save As.')
          }
          authorized = renewed
        }
        const receipt = await write({ documentId, choice: authorized, content })
        if (!live) return 'revoked'
        if (cloudChoice && (choice.accountId !== getAccountId() || accountTicket !== accountGeneration)) throw new Error('The cloud account changed before the save was confirmed.')
        if (!receipt) { publish({ operation: 'idle' }); return 'cancelled' }
        if (!receipt.confirmed) {
          publish({ operation: 'idle', notice: { kind: 'downloaded', name: receipt.name } })
          return 'downloaded'
        }
        if (choice.kind === 'cloud' && (receipt.destination.kind !== 'cloud'
          || receipt.destination.accountId !== choice.accountId || receipt.destination.id !== choice.id)
          || choice.kind === 'choose-file' && receipt.destination.kind !== 'file'
          || choice.kind === 'choose-cloud' && (receipt.destination.kind !== 'cloud' || receipt.destination.accountId !== choice.accountId)
          || choice.kind === 'file' && (receipt.destination.kind !== 'file'
            || receipt.destination.platform !== choice.platform || receipt.destination.location !== choice.location)) {
          throw new Error('The save acknowledgement does not match the selected destination.')
        }
        if (!await confirm(receipt.destination, topology)) {
          if (!live) return 'revoked'
          throw new Error('The destination changed before the save was confirmed.')
        }
        publish({ notice: { kind: 'saved', name: receipt.destination.name,
          location: receipt.destination.kind === 'file' ? receipt.destination.location : undefined } })
        return 'saved'
      } catch (error) {
        if (!live) return 'revoked'
        publish({ operation: 'failed', error: error instanceof Error ? error.message : 'The document save failed.' })
        return 'failed'
      }
    }
    pending = Promise.resolve().then(operation).finally(() => { pending = undefined })
    publish({ operation: 'saving', notice: undefined, error: undefined })
    return pending
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    observe,
    accountChanged() {
      accountGeneration++; observation++
      if (!destination || destination.kind !== 'cloud') return
      publish({ ...exposeDestination(), retained: owned(destination) && retained,
        revision: owned(destination) ? 'checking' : 'draft', notice: undefined, error: undefined })
      void observe()
    },
    async restore(metadata: ArtifactMetadata, authority?: unknown) {
      if (!live || pending) return false
      observation++; confirmation++
      destination = metadata.destination.kind === 'file' ? { ...metadata.destination, authority } : metadata.destination
      savedDigest = metadata.digest
      retained = true
      publish({ ...exposeDestination(), operation: 'idle', retained: owned(destination), revision: 'draft', notice: undefined, error: undefined })
      await observe()
      return true
    },
    save: () => run(destination),
    saveAs: (choice: ArtifactChoice) => run(choice),
    async loaded(value: ArtifactDestination, topology: unknown) {
      if (!live || pending || !owned(value)) return false
      return confirm(value, topology)
    },
    reset() {
      if (!live || pending) return false
      observation++; confirmation++; destination = undefined; savedDigest = undefined; retained = false
      retainSafely(undefined)
      publish({ destination: undefined, fileAccess: undefined, operation: 'idle', revision: 'draft', retained: false, notice: undefined, error: undefined })
      return true
    },
    canClose: () => !pending && snapshot.revision === 'matches' && !!destination && owned(destination),
    async dispose() {
      live = false; observation++; listeners.clear()
      await Promise.all([pending, release?.()])
    },
  }
}
