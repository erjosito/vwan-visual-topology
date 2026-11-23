import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createCloudSession } from './session'
import { readCloudConfiguration } from './configuration'
import { CloudContext } from './useCloudSession'

const DesktopCloudProvider = lazy(() => import('./DesktopCloudProvider'))

function useSession() {
  const [session] = useState(() => createCloudSession(
    readCloudConfiguration(), { storage: () => sessionStorage },
  ))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => { void session.restore() }, [session])
  return { ...state, configured: session.configured, connect: session.connect, disconnect: session.disconnect }
}
function BrowserCloudProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  return <CloudContext value={session}>{children}</CloudContext>
}
export function CloudProvider({ children }: { children: ReactNode }) {
  return typeof window.desktopSimulator?.cloudStatus === 'function'
    ? <Suspense fallback={null}><DesktopCloudProvider>{children}</DesktopCloudProvider></Suspense>
    : <BrowserCloudProvider>{children}</BrowserCloudProvider>
}
