import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createCloudSession } from './session'
import { readCloudConfiguration } from './configuration'
import { CloudContext } from './useCloudSession'

function useSession() {
  const [session] = useState(() => createCloudSession(
    readCloudConfiguration(), { storage: () => sessionStorage },
  ))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => { void session.restore() }, [session])
  return { ...state, configured: session.configured, connect: session.connect, disconnect: session.disconnect }
}
export function CloudProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  return <CloudContext value={session}>{children}</CloudContext>
}
