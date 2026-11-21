import type { ArtifactWriter } from './document-commands'
import type { DesktopBridge } from './platform/desktop'

export function createDesktopDocumentWriter(
  bridge: Pick<DesktopBridge, 'saveDocument'>,
  language: () => 'en' | 'ja' = () => 'en',
): ArtifactWriter {
  return async ({ documentId, choice, content }) => {
    if (choice.kind === 'cloud' || choice.kind === 'file' && choice.platform !== 'desktop') {
      throw new Error('The selected destination is not a desktop file.')
    }
    if (choice.kind === 'file' && (typeof choice.authority !== 'string' || !choice.authority)) {
      throw new Error('The file permission must be renewed before saving.')
    }
    const reply = await bridge.saveDocument({
      documentId, content, language: language(),
      ...(choice.kind === 'choose-file' ? { suggestedName: choice.name } : { destinationToken: choice.authority as string }),
    })
    if (!reply.ok) throw new Error(reply.error)
    if (!reply.value) return null
    return {
      confirmed: true,
      destination: {
        kind: 'file', platform: 'desktop', name: reply.value.name,
        location: reply.value.location, revision: reply.value.revision, authority: reply.value.token,
      },
    }
  }
}
