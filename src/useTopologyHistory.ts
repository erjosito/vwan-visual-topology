import { useEffect, useLayoutEffect, useState } from 'react'
import type { Topology } from './model'
import { validateTopology } from './validation'
import { useWorkspaceSession, useWorkspaceStorage } from './workspace-context'
import { measureAzWork } from './azure-net/performance'

export interface UseTopologyHistoryOptions {
  storageKey: string
  maxHistory?: number
  onBeforeUndoRedo?: (next: Topology) => void
  onAfterChange?: (next: Topology) => void
}

const initialTopology: Topology = { version: 1, name: 'New topology', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [] }
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Invalid input.')

export function useTopologyHistory({
  storageKey,
  maxHistory = 40,
  onBeforeUndoRedo,
  onAfterChange,
}: UseTopologyHistoryOptions) {
  const session = useWorkspaceSession()
  const storage = useWorkspaceStorage()
  const [cached] = useState(() => session?.getEditorHistory?.())
  const [initial] = useState(() => {
    if (cached?.provider === 'vwan') return cached
    if (session?.practice?.document.mode === 'vwan') {
      return { topology: session.practice.document.topology, error: '', backup: '' }
    }
    let saved: string | null = null
    try {
      saved = storage.getItem(storageKey)
      return {
        topology: validateTopology(saved ? JSON.parse(saved) : structuredClone(initialTopology)),
        error: '',
        backup: '',
        stored: saved !== null,
      }
    } catch (error) {
      return {
        topology: validateTopology(structuredClone(initialTopology)),
        error: `Saved topology could not be loaded: ${errorMessage(error)}. The saved data has not been overwritten.`,
        backup: saved ?? '',
      }
    }
  })

  const [topology, setTopology] = useState<Topology>(initial.topology)
  const [history, setHistory] = useState<{ past: Topology[]; future: Topology[] }>(() =>
    cached?.provider === 'vwan' ? { past: cached.past, future: cached.future } : { past: [], future: [] })
  const [error, setError] = useState(initial.error)
  const [saveError, setSaveError] = useState(() => cached?.provider === 'vwan' ? cached.saveError : '')
  useLayoutEffect(() => {
    if (!cached && 'stored' in initial && initial.stored) session?.documentSave?.local(initial.topology, 'saved')
    else if (!cached && initial.error) session?.documentSave?.local(initial.topology, 'unavailable')
  }, [cached, initial, session?.documentSave])
  useLayoutEffect(() => {
    session?.rememberEditorHistory?.({
      provider: 'vwan', topology, past: history.past, future: history.future, error, saveError, backup: initial.backup,
    })
  }, [session, topology, history, error, saveError, initial.backup])

  const persist = (next: Topology) => {
    try {
      if (session?.practice && session.savePractice) session.savePractice({ mode: 'vwan', topology: next })
      else measureAzWork('persist', () => storage.setItem(storageKey, JSON.stringify(next)))
      session?.documentSave?.local(next, 'saved')
      setSaveError('')
    } catch {
      session?.documentSave?.local(next, 'unavailable')
      setSaveError(session?.documentSave ? '' : 'Browser storage is unavailable or full. Use Save As to preserve your topology.')
    }
  }

  const save = (next: Topology, recordHistory = true) => {
    if (recordHistory && measureAzWork('history-compare', () => JSON.stringify(next) !== JSON.stringify(topology))) {
      const snapshot = measureAzWork('history-clone', () => structuredClone(topology))
      setHistory((current) => ({ past: [...current.past.slice(-(maxHistory - 1)), snapshot], future: [] }))
    }
    setTopology(next)
    onAfterChange?.(next)
    persist(next)
    setError('')
  }

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = () => measureAzWork('undo', () => {
    const previous = history.past.at(-1)
    if (!previous) return
    const currentSnapshot = measureAzWork('history-clone', () => structuredClone(topology))
    setHistory((current) => ({
      past: current.past.slice(0, -1),
      future: [currentSnapshot, ...current.future].slice(0, maxHistory),
    }))
    setTopology(previous)
    setError('')
    onBeforeUndoRedo?.(previous)
    onAfterChange?.(previous)
    persist(previous)
  })

  const redo = () => measureAzWork('redo', () => {
    const [next, ...rest] = history.future
    if (!next) return
    const currentSnapshot = measureAzWork('history-clone', () => structuredClone(topology))
    setHistory((current) => ({
      past: [...current.past.slice(-(maxHistory - 1)), currentSnapshot],
      future: rest,
    }))
    setTopology(next)
    setError('')
    onBeforeUndoRedo?.(next)
    onAfterChange?.(next)
    persist(next)
  })

  const clearHistory = () => setHistory({ past: [], future: [] })

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('dialog'))
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        if (history.past.length) {
          event.preventDefault()
          undo()
        }
      } else if ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)) {
        if (history.future.length) {
          event.preventDefault()
          redo()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return {
    topology,
    backup: initial.backup,
    error,
    setError,
    saveError,
    save,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
  }
}
