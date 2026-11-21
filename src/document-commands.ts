import { fingerprint } from './cloud/document-state'

export type ArtifactDestination =
  | { kind: 'file'; platform: 'desktop' | 'browser'; name: string; location: string; revision: string; authority: unknown }
  | { kind: 'cloud'; accountId: string; id: string; name: string; etag: string }

export type ArtifactChoice = ArtifactDestination | { kind: 'choose-file'; name: string }
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
  notice?: { kind: 'saved' | 'downloaded'; name: string; location?: string }
  error?: string
}

export function createDocumentCommands({
  documentId, getTopology, getAccountId, write, retain, release, digest = fingerprint,
}: {
  documentId: string
  getTopology: () => unknown
  getAccountId: () => string | undefined
  write: ArtifactWriter
  retain: (metadata: ArtifactMetadata | undefined) => boolean
  release?: () => Promise<void>
  digest?: (topology: unknown) => Promise<string>
}) {
  let destination: ArtifactDestination | undefined
  let savedDigest: string | undefined
  let live = true, observation = 0, confirmation = 0
  let pending: Promise<CommandResult> | undefined
  let snapshot: ArtifactSnapshot = { operation: 'idle', revision: 'draft', retained: false }
  const listeners = new Set<() => void>()
  const metadataDestination = (value: ArtifactDestination): ArtifactMetadata['destination'] => value.kind === 'cloud'
    ? { kind: value.kind, accountId: value.accountId, id: value.id, name: value.name, etag: value.etag }
    : { kind: value.kind, platform: value.platform, name: value.name, location: value.location, revision: value.revision }
  const publish = (update: Partial<ArtifactSnapshot>) => {
    snapshot = { ...snapshot, ...update }
    for (const listener of listeners) listener()
  }
  const owned = (value: ArtifactDestination) => value.kind !== 'cloud' || value.accountId === getAccountId()
  const retainSafely = (value: ArtifactMetadata | undefined) => {
    try { return retain(value) } catch { return false }
  }
  const observe = async () => {
    const ticket = ++observation
    if (!live || !destination) return
    publish({ revision: 'checking' })
    try {
      const value = await digest(JSON.parse(JSON.stringify(getTopology())))
      if (!live || ticket !== observation) return
      publish({ revision: savedDigest ? value === savedDigest ? 'matches' : 'modified' : 'unknown' })
    } catch {
      if (live && ticket === observation) publish({ revision: 'unknown' })
    }
  }
  const confirm = async (value: ArtifactDestination, topology: unknown) => {
    const ticket = ++confirmation
    let hash: string | undefined
    try { hash = await digest(topology) } catch { /* A confirmed write can still have an unverified model revision. */ }
    if (!live || ticket !== confirmation || !owned(value)) return false
    destination = value; savedDigest = hash
    const metadata = { version: 1 as const, destination: metadataDestination(value), digest: hash }
    const retained = retainSafely(metadata)
    publish({ destination: metadataDestination(value), operation: 'idle', retained, error: undefined })
    await observe()
    return true
  }
  const run = (choice: ArtifactChoice | undefined): Promise<CommandResult> => {
    if (!live) return Promise.resolve('revoked')
    if (pending) return Promise.resolve('busy')
    if (!choice) return Promise.resolve('needs-destination')
    if (choice.kind === 'cloud' && !owned(choice)) {
      publish({ operation: 'failed', error: 'The saved cloud destination belongs to a different account.' })
      return Promise.resolve('failed')
    }
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
        const receipt = await write({ documentId, choice, content })
        if (!live) return 'revoked'
        if (choice.kind === 'cloud' && !owned(choice)) throw new Error('The cloud account changed before the save was confirmed.')
        if (!receipt) { publish({ operation: 'idle' }); return 'cancelled' }
        if (!receipt.confirmed) {
          publish({ operation: 'idle', notice: { kind: 'downloaded', name: receipt.name } })
          return 'downloaded'
        }
        if (choice.kind === 'cloud' && (receipt.destination.kind !== 'cloud'
          || receipt.destination.accountId !== choice.accountId || receipt.destination.id !== choice.id)
          || choice.kind === 'choose-file' && receipt.destination.kind !== 'file'
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
    save: () => run(destination),
    saveAs: (choice: ArtifactChoice) => run(choice),
    async loaded(value: ArtifactDestination, topology: unknown) {
      if (!live || pending || !owned(value)) return false
      return confirm(value, topology)
    },
    reset() {
      if (!live || pending) return false
      observation++; confirmation++; destination = undefined; savedDigest = undefined
      retainSafely(undefined)
      publish({ destination: undefined, operation: 'idle', revision: 'draft', retained: false, notice: undefined, error: undefined })
      return true
    },
    canClose: () => !pending && snapshot.revision === 'matches',
    async dispose() {
      live = false; observation++; listeners.clear()
      await pending
      await release?.()
    },
  }
}
