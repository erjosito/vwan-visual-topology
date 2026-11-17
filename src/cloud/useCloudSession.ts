import { createContext, useContext } from 'react'
import type { CloudSessionState } from './session'

export interface CloudSessionValue extends CloudSessionState {
  configured: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}
export const CloudContext = createContext<CloudSessionValue | undefined>(undefined)
export const useCloudSession = () => useContext(CloudContext)
