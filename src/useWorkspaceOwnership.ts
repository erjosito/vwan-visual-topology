import { useEffect, useRef, useState } from 'react'

export function useWorkspaceOwnership(memoryOnly: boolean) {
  const [status, setStatus] = useState<'checking' | 'owned' | 'blocked' | 'memory'>('checking')
  const current = useRef(status)
  useEffect(() => {
    let live = true
    let release: (() => void) | undefined
    queueMicrotask(() => {
      if (!live) return
      if (memoryOnly || typeof navigator.locks?.request !== 'function') {
        current.current = 'memory'; setStatus('memory')
        return
      }
      void navigator.locks.request('aznetsim-workspace-profile-v1', { ifAvailable: true }, async lock => {
        if (!live) return
        if (!lock) { current.current = 'blocked'; setStatus('blocked'); return }
        current.current = 'owned'; setStatus('owned')
        await new Promise<void>(resolve => { release = resolve })
      }).catch(() => {
        if (live) { current.current = 'memory'; setStatus('memory') }
      })
    })
    return () => {
      live = false
      current.current = 'checking'
      release?.()
    }
  }, [memoryOnly])
  return { status, current }
}
