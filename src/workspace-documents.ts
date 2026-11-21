import { createDocumentSaveState, type DocumentSaveState } from './cloud/document-state'
import type { WorkspaceEditorHistory } from './workspace-context'
import type { WorkspaceStorage } from './workspace-session'
import { workspaceTabKey, workspaceTabStorage, workspaceTabsLimit, type WorkspaceTab } from './workspace-tabs'

export interface WorkspaceDocument {
  id: string
  provider: WorkspaceTab['provider']
  storage: WorkspaceStorage
  save: DocumentSaveState
  editorState: Map<string, unknown>
  history?: WorkspaceEditorHistory
  remember: (history: WorkspaceEditorHistory) => boolean
}

export function createWorkspaceDocuments(storage: WorkspaceStorage) {
  const documents = new Map<string, WorkspaceDocument>()
  let activeId: string | undefined
  let accountId: string | undefined
  let disposed = false
  const get = (tab: WorkspaceTab): WorkspaceDocument => {
    workspaceTabKey(tab, 'topology')
    if (disposed) throw new Error('The workspace document session has ended.')
    const cached = documents.get(tab.id)
    if (cached) {
      if (cached.provider !== tab.provider) throw new Error('The workspace document provider changed.')
      return cached
    }
    if (documents.size >= workspaceTabsLimit) throw new Error('The workspace document limit has been reached.')
    let document: WorkspaceDocument
    const live = () => !disposed && documents.get(tab.id) === document
    const owned = () => live() && activeId === tab.id
    const scoped = workspaceTabStorage(storage, tab, owned)
    const association = workspaceTabStorage(storage, tab, live)
    const state = createDocumentSaveState(() => ({
      getItem: scoped.getItem, setItem: scoped.setItem, removeItem: association.removeItem,
    }))
    const save = { ...state, reset: () => { if (owned()) state.reset() } }
    document = {
      id: tab.id, provider: tab.provider, storage: scoped, save, editorState: new Map(),
      remember(history) {
        if (!owned() || history.provider !== tab.provider) return false
        document.history = history
        save.observe(history.topology, history.provider)
        return true
      },
    }
    documents.set(tab.id, document)
    save.setActive(false)
    save.setAccount(accountId)
    return document
  }
  const suspend = () => {
    if (activeId) documents.get(activeId)?.save.setActive(false)
    activeId = undefined
  }
  return {
    get,
    active: () => activeId ? documents.get(activeId) : undefined,
    activate(tab: WorkspaceTab) {
      const document = get(tab)
      if (activeId === tab.id) return document
      suspend()
      activeId = tab.id
      document.save.setActive(true)
      return document
    },
    suspend,
    setAccount(next: string | undefined) {
      accountId = next
      for (const document of documents.values()) document.save.setAccount(next)
    },
    forget(id: string) {
      if (activeId === id) suspend()
      documents.get(id)?.save.setActive(false)
      documents.delete(id)
    },
    dispose() {
      suspend()
      disposed = true
      for (const document of documents.values()) document.save.setActive(false)
      documents.clear()
    },
  }
}
