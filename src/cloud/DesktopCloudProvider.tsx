import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CloudContext } from './useCloudSession'
import { createDesktopCloudSession } from './desktop-session'

export default function DesktopCloudProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => createDesktopCloudSession(window.desktopSimulator!))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => { void session.restore() }, [session])
  return <CloudContext value={{ ...state, configured: session.configured, connect: session.connect, disconnect: session.disconnect }}>
    {children}
  </CloudContext>
}
