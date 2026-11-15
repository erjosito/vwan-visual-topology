export type WorkspaceProvider = 'vwan' | 'azure-net'
export const workspaceSessionKey = 'network-simulator:workspace:v1'
export const workspaceArchiveKey = 'network-simulator:originals:v1'
export const workspaceStorageKeys = {
  vwan: 'vwan-visual-topology:v1',
  'azure-net': 'aznet-visual-topology:v1',
} as const
export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface WorkspaceStartup {
  provider?: WorkspaceProvider
  recovery?: string
}

function validSelection(value: unknown): value is { version: 1; provider: WorkspaceProvider } {
  return !!value && typeof value === 'object' && 'version' in value && value.version === 1
    && 'provider' in value && typeof value.provider === 'string' && Object.hasOwn(workspaceStorageKeys, value.provider)
}

export function workspaceStartup(storage: Pick<Storage, 'getItem'>, search: string, hash = ''): WorkspaceStartup {
  try {
    if (/(?:#|&)s=/.test(hash)) return { provider: 'azure-net' }
    const params = new URLSearchParams(search)
    const alias = params.get('mode')?.toLowerCase()
    if (['vwan', 'vwan-only'].includes(alias ?? '')) return { provider: 'vwan' }
    if (['hub-spoke', 'hub-and-spoke', 'vnet', 'full', 'aznet', 'azure-net'].includes(alias ?? '')) return { provider: 'azure-net' }
    const sample = params.get('sample')
    if (sample) return { provider: sample.startsWith('azure-vnet-') || sample.startsWith('uc')
      || ['hub-spoke-firewall-udr', 'ars-sdwan-nva-coexistence', 'dual-hub-vnra-global-peering',
        'hybrid-vwan-and-hub-spoke', 'enterprise-vnet-all-features-showcase'].includes(sample) ? 'azure-net' : 'vwan' }
    const raw = storage.getItem(workspaceSessionKey)
    if (raw !== null) {
      let session: unknown
      try { session = JSON.parse(raw) } catch { /* Invalid selections require an explicit recovery choice. */ }
      if (!validSelection(session)) {
        return { recovery: 'The workspace selection could not be read. Choose a saved design; originals have not been replaced.' }
      }
      return { provider: session.provider }
    }
    const candidates = (Object.keys(workspaceStorageKeys) as WorkspaceProvider[])
      .filter((provider) => storage.getItem(workspaceStorageKeys[provider]) !== null)
    if (candidates.length > 1) return {}
    return { provider: candidates[0] ?? 'azure-net' }
  } catch {
    return { provider: 'azure-net', recovery: 'Workspace storage is unavailable or damaged. Saved originals have not been replaced.' }
  }
}

export interface WorkspaceOriginal { key: string; raw: string }

export function workspaceOriginals(storage: Pick<Storage, 'getItem'>): WorkspaceOriginal[] {
  const raw = storage.getItem(workspaceArchiveKey)
  if (raw === null) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== 'object'
    || typeof entry.key !== 'string' || typeof entry.raw !== 'string')) throw new Error('Saved originals could not be read.')
  return parsed
}

export function preserveWorkspaceOriginal(storage: WorkspaceStorage, key: string) {
  const raw = storage.getItem(key)
  if (raw === null) return
  const originals = workspaceOriginals(storage)
  if (originals.some((entry) => entry.key === key && entry.raw === raw)) return
  storage.setItem(workspaceArchiveKey, JSON.stringify([...originals, { key, raw }]))
}

export function selectWorkspace(storage: WorkspaceStorage, provider: WorkspaceProvider, replacement?: string) {
  const key = workspaceStorageKeys[provider]
  preserveWorkspaceOriginal(storage, key)
  const previous = storage.getItem(workspaceSessionKey)
  if (previous !== null) {
    try { if (!validSelection(JSON.parse(previous))) preserveWorkspaceOriginal(storage, workspaceSessionKey) }
    catch { preserveWorkspaceOriginal(storage, workspaceSessionKey) }
  }
  storage.setItem(workspaceSessionKey, JSON.stringify({ version: 1, provider }))
  if (replacement !== undefined) {
    try { storage.setItem(key, replacement) }
    catch (error) {
      if (previous === null) storage.removeItem(workspaceSessionKey)
      else storage.setItem(workspaceSessionKey, previous)
      throw error
    }
  }
}
