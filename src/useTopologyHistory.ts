import { useEffect, useState } from 'react'
import { example } from './model'
import type { Topology } from './model'
import { validateTopology } from './validation'

export interface UseTopologyHistoryOptions {
  storageKey: string
  maxHistory?: number
  onBeforeUndoRedo?: (next: Topology) => void
  onAfterChange?: (next: Topology) => void
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Invalid input.')

export function useTopologyHistory({
  storageKey,
  maxHistory = 40,
  onBeforeUndoRedo,
  onAfterChange,
}: UseTopologyHistoryOptions) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(storageKey)
      return {
        topology: validateTopology(saved ? JSON.parse(saved) : structuredClone(example)),
        error: '',
        backup: '',
      }
    } catch (error) {
      return {
        topology: validateTopology(structuredClone(example)),
        error: `Saved topology could not be loaded: ${errorMessage(error)}. The saved data has not been overwritten.`,
        backup: saved ?? '',
      }
    }
  })

  const [topology, setTopology] = useState<Topology>(initial.topology)
  const [history, setHistory] = useState<{ past: Topology[]; future: Topology[] }>({ past: [], future: [] })
  const [error, setError] = useState(initial.error)
  const [saveError, setSaveError] = useState('')

  const persist = (next: Topology) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setSaveError('')
    } catch {
      setSaveError('Browser storage is unavailable or full. Export JSON to preserve your topology.')
    }
  }

  const save = (next: Topology, recordHistory = true) => {
    if (recordHistory && JSON.stringify(next) !== JSON.stringify(topology)) {
      const snapshot = structuredClone(topology)
      setHistory((current) => ({ past: [...current.past.slice(-(maxHistory - 1)), snapshot], future: [] }))
    }
    setTopology(next)
    onAfterChange?.(next)
    persist(next)
    setError('')
  }

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = () => {
    const previous = history.past.at(-1)
    if (!previous) return
    const currentSnapshot = structuredClone(topology)
    setHistory((current) => ({
      past: current.past.slice(0, -1),
      future: [currentSnapshot, ...current.future].slice(0, maxHistory),
    }))
    setTopology(previous)
    setError('')
    onBeforeUndoRedo?.(previous)
    onAfterChange?.(previous)
    persist(previous)
  }

  const redo = () => {
    const [next, ...rest] = history.future
    if (!next) return
    const currentSnapshot = structuredClone(topology)
    setHistory((current) => ({
      past: [...current.past.slice(-(maxHistory - 1)), currentSnapshot],
      future: rest,
    }))
    setTopology(next)
    setError('')
    onBeforeUndoRedo?.(next)
    onAfterChange?.(next)
    persist(next)
  }

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
