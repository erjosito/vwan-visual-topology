import { cloudDocumentKey } from './cloud/document-state'
import { documentArtifactKey } from './document-metadata'
import { workspaceStorageKeys, type WorkspaceProvider, type WorkspaceStorage } from './workspace-session'

export const workspaceTabsKey = 'network-simulator:workspace-tabs:v1'
export const workspaceTabsLimit = 16
const diagnosticsKey = 'vwan-visual-topology:diagnostics:v1'
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface WorkspaceTab {
  id: string
  provider: WorkspaceProvider
  name: string
}

export interface WorkspaceTabs {
  version: 1
  activeId?: string
  tabs: WorkspaceTab[]
}

function parseSession(value: unknown): WorkspaceTabs {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('tabs' in value) || !Array.isArray(value.tabs) || value.tabs.length > workspaceTabsLimit) {
    throw new Error('Invalid workspace tab session.')
  }
  const tabs = value.tabs.map((entry: unknown): WorkspaceTab => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !idPattern.test(entry.id)
      || !('provider' in entry) || (entry.provider !== 'vwan' && entry.provider !== 'azure-net')
      || !('name' in entry) || typeof entry.name !== 'string' || entry.name.length > 120) {
      throw new Error('Invalid workspace tab.')
    }
    return { id: entry.id, provider: entry.provider, name: entry.name }
  })
  const activeId = 'activeId' in value ? value.activeId : undefined
  if (new Set(tabs.map(tab => tab.id)).size !== tabs.length
    || (tabs.length ? typeof activeId !== 'string' || !tabs.some(tab => tab.id === activeId) : activeId !== undefined)) {
    throw new Error('Invalid active workspace tab.')
  }
  return { version: 1, ...(typeof activeId === 'string' ? { activeId } : {}), tabs }
}

export function readWorkspaceTabs(storage: Pick<Storage, 'getItem'>): {
  session?: WorkspaceTabs
  recovery?: 'invalid' | 'unavailable'
} {
  let raw: string | null
  try { raw = storage.getItem(workspaceTabsKey) } catch { return { recovery: 'unavailable' } }
  if (raw === null) return {}
  try {
    if (raw.length > 32_768) throw new Error('Workspace tab session exceeds size limit.')
    return { session: parseSession(JSON.parse(raw)) }
  } catch { return { recovery: 'invalid' } }
}

function checkSession(storage: Pick<Storage, 'getItem'>, expected?: WorkspaceTabs) {
  const current = readWorkspaceTabs(storage)
  const missing = !current.session && !current.recovery
  const wanted = expected ? parseSession(expected) : undefined
  const actual = current.session ?? { version: 1, tabs: [] }
  if (current.recovery || (wanted ? JSON.stringify(actual) !== JSON.stringify(wanted) : !missing)) {
    throw new Error('Workspace tabs changed or could not be read. Reload before changing the session.')
  }
}

export function writeWorkspaceTabs(storage: Pick<Storage, 'getItem' | 'setItem'>, session: WorkspaceTabs, expected?: WorkspaceTabs) {
  const next = parseSession(session)
  checkSession(storage, expected)
  storage.setItem(workspaceTabsKey, JSON.stringify(next))
}

export function workspaceTabKey(tab: WorkspaceTab, field: 'topology' | 'diagnostics' | 'cloud' | 'closed' | 'artifact') {
  if (!idPattern.test(tab.id) || !Object.hasOwn(workspaceStorageKeys, tab.provider)) throw new Error('Invalid workspace tab.')
  return `network-simulator:workspace-tab:v1:${tab.id}:${field}`
}

export function workspaceTabStorage(storage: WorkspaceStorage, tab: WorkspaceTab, writable = () => true): WorkspaceStorage {
  const keys = new Map([
    [workspaceStorageKeys[tab.provider], workspaceTabKey(tab, 'topology')],
    [diagnosticsKey, workspaceTabKey(tab, 'diagnostics')],
    [cloudDocumentKey, workspaceTabKey(tab, 'cloud')],
    [documentArtifactKey, workspaceTabKey(tab, 'artifact')],
  ])
  const target = (key: string) => keys.get(key) ?? key
  const check = () => { if (!writable()) throw new Error('This workspace tab is no longer writable.') }
  return {
    getItem: key => storage.getItem(target(key)),
    setItem: (key, value) => { check(); storage.setItem(target(key), value) },
    removeItem: key => { check(); storage.removeItem(target(key)) },
  }
}

export function addWorkspaceTab(storage: WorkspaceStorage, session: WorkspaceTabs, tab: WorkspaceTab, raw: string): WorkspaceTabs {
  const next = parseSession({ version: 1, activeId: tab.id, tabs: [...session.tabs, tab] })
  checkSession(storage, session)
  const key = workspaceTabKey(tab, 'topology')
  if (storage.getItem(key) !== null) throw new Error('Workspace tab storage already exists.')
  // Preserve native bytes; topology admission belongs to the selected editor, not session metadata.
  storage.setItem(key, raw)
  try { writeWorkspaceTabs(storage, next, session) }
  catch (error) {
    try { storage.removeItem(key) } catch { /* Keep an orphaned copy rather than replace any existing design. */ }
    throw error
  }
  return next
}

export function closeWorkspaceTabs(storage: WorkspaceStorage, session: WorkspaceTabs, ids: string[]): WorkspaceTabs {
  const remaining = session.tabs.filter(tab => !ids.includes(tab.id))
  const previous = session.tabs.findIndex(tab => tab.id === session.activeId)
  const next: WorkspaceTabs = { version: 1, tabs: remaining,
    ...(remaining.length ? { activeId: remaining.some(tab => tab.id === session.activeId) ? session.activeId
      : remaining[Math.min(Math.max(previous, 0), remaining.length - 1)].id } : {}) }
  writeWorkspaceTabs(storage, next, session)
  for (const tab of session.tabs.filter(tab => ids.includes(tab.id))) {
    try { storage.setItem(workspaceTabKey(tab, 'closed'), String(Date.now())) } catch {}
  }
  return next
}

export function reopenWorkspaceTab(storage: WorkspaceStorage, session: WorkspaceTabs, tab: WorkspaceTab): WorkspaceTabs {
  const next = parseSession({ version: 1, activeId: tab.id, tabs: [...session.tabs, tab] })
  if (storage.getItem(workspaceTabKey(tab, 'topology')) === null) throw new Error('Recovery data is missing.')
  writeWorkspaceTabs(storage, next, session)
  return next
}
