import type { CloudClient } from './client'
import type { CloudAccount } from './microsoft'

export const desktopCloudOperations = [
  'getProgress', 'saveProgress', 'listTopologies', 'getTopology', 'saveTopology', 'updateTopologyMetadata', 'deleteTopology',
  'listShares', 'createShare', 'revokeShare',
] as const satisfies readonly (keyof CloudClient)[]
export interface DesktopCloudState { configured: boolean; account?: CloudAccount; session?: string }
export interface DesktopCloudRequest {
  session: string
  operation: typeof desktopCloudOperations[number]
  args: unknown[]
}
export type DesktopCloudReply<T> = { ok: true; value: T } | { ok: false; error: string; status?: number }
export interface DesktopCloudBridge {
  cloudStatus(): Promise<DesktopCloudReply<DesktopCloudState>>
  cloudSignIn(): Promise<DesktopCloudReply<DesktopCloudState>>
  cloudSignOut(): Promise<DesktopCloudReply<void>>
  cloudRequest(request: DesktopCloudRequest): Promise<DesktopCloudReply<unknown>>
}
