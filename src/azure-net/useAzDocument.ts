import { useEffect, useEffectEvent, useLayoutEffect, useState } from 'react'
import { useWorkspaceSession, useWorkspaceStorage } from '../workspace-context'
import { resolveSampleIdAlias } from '../sample-catalog'
import { validateVpnNat } from '../vpn-nat'
import { pruneDeletedInventory, validateInventory } from '../inventory'
import { validateApplicationInventory } from '../application-inventory'
import { parseAzNetTopology } from './admission'
import { AZNET_STORAGE_KEY, consumeAzSnapshotUrl, loadAzWorkspace, workspaceError } from './workspace'
import { AZURE_NET_SAMPLES, cloneAzNetTopology, type AzNetTopology } from './model'
import { validateUdrRegionEdit } from './udr-regions'
import { pruneAzSiteRouteMaps } from './route-maps'
import { pruneAzArsRouteMaps } from './ars-route-maps'
import { measureAzWork } from './performance'

function resolveInitialUrlSample() {
  if (typeof window === 'undefined') return null
  const requested = resolveSampleIdAlias(new URLSearchParams(window.location.search).get('sample') ?? '')
  if (!requested) return null
  return AZURE_NET_SAMPLES.find((sample) => sample.id === requested) ?? null
}

export function useAzDocument(onError: (message: string) => void, onChange: (next: AzNetTopology) => void) {
  const workspaceSession = useWorkspaceSession()
  const workspaceStorage = useWorkspaceStorage()
  const [cachedHistory] = useState(() => workspaceSession?.getEditorHistory?.())
  const [initialResolved] = useState(() => {
    if (cachedHistory?.provider === 'azure-net') return {
      sampleId: cachedHistory.sampleId, topology: cachedHistory.topology,
      snapshotImported: false, recovery: cachedHistory.recovery,
    }
    if (workspaceSession?.practice && workspaceSession.practice.document.mode !== 'vwan') return {
      sampleId: '', topology: workspaceSession.practice.document.topology, snapshotImported: false, recovery: [],
    }
    const stored = loadAzWorkspace(workspaceStorage, window.location.hash)
    if (stored.snapshotImported) return stored
    const urlSample = resolveInitialUrlSample()
    if (urlSample) return { ...stored, sampleId: urlSample.id, topology: parseAzNetTopology(urlSample.topology) }
    return stored
  })
  const [sampleId, setSampleId] = useState(initialResolved.sampleId)
  const [topology, setTopology] = useState(initialResolved.topology)
  const [history, setHistory] = useState<AzNetTopology[]>(() => cachedHistory?.provider === 'azure-net' ? cachedHistory.past : [])
  const [future, setFuture] = useState<AzNetTopology[]>(() => cachedHistory?.provider === 'azure-net' ? cachedHistory.future : [])
  const [recoveryEntries] = useState(initialResolved.recovery)
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(() =>
    cachedHistory?.provider === 'azure-net' ? cachedHistory.recoveryAcknowledged : initialResolved.recovery.length === 0)
  const [saveError, setSaveError] = useState('')
  const [pendingUrlSample, setPendingUrlSample] = useState(() => {
    if (workspaceSession?.practice) return ''
    if (cachedHistory?.provider === 'azure-net') return cachedHistory.pendingUrlSample
    const requested = resolveSampleIdAlias(new URLSearchParams(window.location.search).get('sample') ?? '')
    return !initialResolved.snapshotImported && /^[a-z0-9-]+$/.test(requested) && !resolveInitialUrlSample() ? requested : ''
  })
  useLayoutEffect(() => {
    workspaceSession?.rememberEditorHistory?.({
      provider: 'azure-net', topology, sampleId, past: history, future, recovery: recoveryEntries,
      recoveryAcknowledged, pendingUrlSample,
    })
  }, [workspaceSession, topology, sampleId, history, future, recoveryEntries, recoveryAcknowledged, pendingUrlSample])

  const persistCurrentWorkspace = useEffectEvent(() => {
    if (!recoveryAcknowledged || pendingUrlSample) {
      workspaceSession?.documentSave?.local(topology, 'unavailable')
      return
    }
    try {
      parseAzNetTopology(topology)
      if (workspaceSession?.practice && workspaceSession.savePractice) {
        workspaceSession.savePractice({ mode: workspaceSession.practice.document.mode === 'hub-spoke' ? 'hub-spoke' : 'full', topology })
      } else {
        measureAzWork('persist', () => workspaceStorage.setItem(AZNET_STORAGE_KEY, JSON.stringify({ sampleId, topology })))
      }
      setSaveError('')
      workspaceSession?.documentSave?.local(topology, 'saved')
      if (!workspaceSession?.practice) consumeAzSnapshotUrl()
    } catch (error) {
      workspaceSession?.documentSave?.local(topology, 'unavailable')
      setSaveError(`Workspace could not be saved (storage unavailable/full or invalid design): ${workspaceError(error)}. Use Save As to preserve this design; saved originals and URL snapshots have not been overwritten.`)
    }
  })
  useEffect(() => {
    // Report storage synchronization outcomes, including quota failures.
    // oxlint-disable-next-line react/set-state-in-effect
    persistCurrentWorkspace()
  }, [sampleId, topology, recoveryAcknowledged, pendingUrlSample])

  const commitTopology = (updater: (draft: AzNetTopology) => void) => {
    let next: AzNetTopology
    try {
      next = measureAzWork('commit', () => {
        const draft = cloneAzNetTopology(topology)
        updater(draft)
        validateUdrRegionEdit(topology, draft)
        pruneAzSiteRouteMaps(draft)
        pruneAzArsRouteMaps(draft)
        pruneDeletedInventory(draft, topology)
        validateInventory(draft)
        validateApplicationInventory(draft)
        validateVpnNat(draft)
        return draft
      })
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Inventory edit rejected.')
      return false
    }
    setHistory(previous => [...previous.slice(-24), measureAzWork('history-clone', () => cloneAzNetTopology(topology))])
    setFuture([])
    onChange(next)
    setTopology(next)
    return true
  }
  const handleUndo = () => measureAzWork('undo', () => {
    if (!history.length) return
    const previous = history[history.length - 1]
    setFuture(items => [measureAzWork('history-clone', () => cloneAzNetTopology(topology)), ...items])
    setHistory(items => items.slice(0, -1))
    onChange(previous)
    setTopology(previous)
  })
  const handleRedo = () => measureAzWork('redo', () => {
    if (!future.length) return
    const next = future[0]
    setHistory(items => [...items, measureAzWork('history-clone', () => cloneAzNetTopology(topology))])
    setFuture(items => items.slice(1))
    onChange(next)
    setTopology(next)
  })
  const replaceTopology = (id: string, input: AzNetTopology) => {
    const next = parseAzNetTopology(input)
    workspaceSession?.documentSave?.reset()
    setSampleId(id)
    setTopology(next)
    setHistory([])
    setFuture([])
    return next
  }
  return {
    topology, sampleId, history, future, recoveryEntries, recoveryAcknowledged, setRecoveryAcknowledged,
    saveError, pendingUrlSample, setPendingUrlSample, commitTopology, handleUndo, handleRedo, replaceTopology,
  }
}
