import { createContext, useContext } from 'react'

export const WorkspaceSessionContext = createContext<{
  openLibrary: () => void
  openDocument: (input: unknown) => Promise<void>
  capture?: unknown
} | undefined>(undefined)

export const useWorkspaceSession = () => useContext(WorkspaceSessionContext)
