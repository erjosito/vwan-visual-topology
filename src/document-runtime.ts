import { createDocumentCommands, type ArtifactDestination, type ArtifactWriter } from './document-commands'
import { createBrowserDocumentWriter } from './browser-document-writer'
import { createBrowserDocumentStore } from './browser-document-store'
import { createDesktopDocumentWriter } from './desktop-document-writer'
import { documentArtifactKey, parseArtifactMetadata } from './document-metadata'
import type { CloudSessionValue } from './cloud/useCloudSession'
import type { WorkspaceDocument } from './workspace-documents'
import { randomUUID } from './random-id'

export function createDocumentRuntime(getCloud: () => CloudSessionValue | undefined, language: () => 'en' | 'ja',
  persistent: () => boolean) {
  const store = createBrowserDocumentStore()
  const browser = createBrowserDocumentWriter({ retainHandle: store.put })
  const bridge = window.desktopSimulator
  const desktop = bridge ? createDesktopDocumentWriter(bridge, language) : undefined
  const attempts = new Map<string, string>()
  const owners = new Map<string, WorkspaceDocument>()
  const write: ArtifactWriter = async request => {
    const { choice, documentId, content } = request
    if (choice.kind === 'download-copy') return browser.write(request)
    if (choice.kind !== 'cloud' && choice.kind !== 'choose-cloud') return (desktop ?? browser.write)(request)
    const [{ CloudHttpError }, { parseCloudTopology }] = await Promise.all([import('./cloud/client'), import('./cloud/contracts')])
    const cloud = getCloud(), api = cloud?.api
    if (!api || cloud.account?.id !== choice.accountId) throw new Error('Sign in to the saved cloud account before saving.')
    const value = parseCloudTopology({ version: 1, name: choice.name, topology: JSON.parse(content) })
    if (!window.confirm(language() === 'ja'
      ? 'このトポロジを自分のクラウドにアップロードしますか。許可のない機密データや秘密情報を保存しないでください。'
      : 'Upload this topology to your private cloud library? Do not upload secrets or confidential data without approval.')) return null
    const attemptKey = `${documentId}:${choice.accountId}`
    const id = choice.kind === 'cloud' ? choice.id : attempts.get(attemptKey) ?? randomUUID()
    if (choice.kind === 'choose-cloud') attempts.set(attemptKey, id)
    const document = owners.get(documentId)
    const ticket = document?.save.beginArtifact(id, choice.accountId)
    if (!document || !ticket) throw new Error('The document closed or another cloud operation is pending.')
    let etag: string
    try {
      try { etag = await api.saveTopology(id, value, choice.kind === 'cloud' ? choice.etag : null) }
      catch (error) {
        if (choice.kind !== 'choose-cloud' || !(error instanceof CloudHttpError) || error.status !== 412) throw error
        const found = await api.getTopology(id)
        if (!found || JSON.stringify(found.value) !== JSON.stringify(value)) throw error
        etag = found.etag
      }
      if (getCloud()?.api !== api || getCloud()?.account?.id !== choice.accountId) throw new Error('The cloud account changed while saving.')
    } catch (error) {
      document.save.failed(ticket, error instanceof CloudHttpError && error.status === 412)
      throw error
    }
    attempts.delete(attemptKey)
    return { confirmed: true, destination: { kind: 'cloud', accountId: choice.accountId, id, name: value.name, etag } }
  }
  return {
    browser,
    retainBrowserFile: store.put,
    initialize(document: WorkspaceDocument) {
      owners.set(document.id, document)
      const topology = () => {
        if (document.history) return document.history.topology
        const raw = document.association.getItem(document.provider === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1')
        if (!raw) throw new Error('The document is not ready.')
        const parsed = JSON.parse(raw)
        return document.provider === 'vwan' ? parsed : parsed.topology
      }
      document.commands = createDocumentCommands({
        documentId: document.id, getTopology: topology, getAccountId: () => getCloud()?.account?.id,
        confirmed: (destination, submitted) => {
          if (destination.kind === 'cloud') document.save.linkArtifact(destination, submitted, document.provider)
        },
        write, retain: metadata => {
          if (metadata) document.association.setItem(documentArtifactKey, JSON.stringify(metadata))
          else document.association.removeItem(documentArtifactKey)
          return persistent()
        },
        authorizeFile: async destination => {
          if (destination.platform === 'browser') {
            const stored = await store.get(document.id, destination.bindingId)
            if (!stored || stored.revision !== destination.revision) throw new Error('File permission is unavailable. Use Save As.')
            return browser.bind(document.id, stored.handle, stored.revision, stored.id)
          }
          if (!bridge) throw new Error('This file requires the desktop app. Use Save As.')
          const released = await bridge.releaseDocument({ documentId: document.id })
          if (!released.ok) throw new Error(released.error)
          const opened = await bridge.openDocument({ documentId: document.id, language: language() })
          if (!opened.ok) throw new Error(opened.error)
          if (!opened.value) return null
          if (!opened.value.destination) throw new Error('The selected file is read-only. Use Save As.')
          const value = opened.value.destination
          return { kind: 'file', platform: 'desktop', name: value.name, location: value.location,
            revision: value.revision, authority: value.token }
        },
        release: async () => {
          if (owners.get(document.id) === document) owners.delete(document.id)
          browser.release(document.id)
          for (const key of attempts.keys()) if (key.startsWith(`${document.id}:`)) attempts.delete(key)
          await bridge?.releaseDocument({ documentId: document.id })
        },
      })
      let metadata
      try { metadata = parseArtifactMetadata(document.association.getItem(documentArtifactKey)) } catch {}
      if (metadata) void document.commands.restore(metadata)
    },
    async dispose() { await store.dispose() },
  }
}

export function desktopArtifact(value: { name: string; location: string; revision: string; token: string }): ArtifactDestination {
  return { kind: 'file', platform: 'desktop', name: value.name, location: value.location,
    revision: value.revision, authority: value.token }
}
