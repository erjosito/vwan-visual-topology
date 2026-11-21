import { CloudHttpError } from './client'
import { parseCloudTopology } from './contracts'
import type { CloudSessionValue } from './useCloudSession'
import type { WorkspaceDocument } from '../workspace-documents'
import type { ArtifactWriter } from '../document-commands'
import { randomUUID } from '../random-id'

export function createCloudDocumentWriter(getCloud: () => CloudSessionValue | undefined, language: () => 'en' | 'ja',
  owners: Map<string, WorkspaceDocument>, attempts: Map<string, string>): ArtifactWriter {
  return async ({ choice, documentId, content }) => {
    if (choice.kind !== 'cloud' && choice.kind !== 'choose-cloud') throw new Error('The selected destination is not a cloud entry.')
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
}
