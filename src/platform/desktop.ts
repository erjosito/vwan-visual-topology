import type { PlatformResult } from './contract'

export type DesktopFileFailure = 'invalid' | 'busy' | 'revoked' | 'conflict' | 'permission' | 'failed'
type Reply<T> = { ok: true; value: T } | { ok: false; error: string; code?: DesktopFileFailure }
export interface DesktopFileDestination { token: string; name: string; location: string; revision: string }
export interface DesktopDocumentRequest { documentId: string; language?: 'en' | 'ja' }
export interface DesktopSaveRequest extends DesktopDocumentRequest { content: string; destinationToken?: string; suggestedName?: string }
export type LocalFile = { name: string; content: string; destination?: DesktopFileDestination; readOnly?: true } | null
export type DesktopScope = { subscriptionId: string; tenantId: string }
export type DesktopAccounts = { cloud: { name: string; resourceManager: string }; accounts: { id: string; name: string; tenantId: string; state: string }[] }
export type DesktopTargets = { groups: { id: string; name: string }[]; wans: { id: string; name: string }[] }
export interface DesktopBridge {
  openTopology(): Promise<Reply<LocalFile>>
  accounts(): Promise<Reply<DesktopAccounts>>
  targets(scope: DesktopScope): Promise<Reply<DesktopTargets>>
  collect(request: DesktopScope & { mode: 'vwan' | 'hub-spoke' | 'full'; target: string }): Promise<Reply<LocalFile>>
  simulate(request: unknown): Promise<Reply<PlatformResult>>
  openDocument(request: DesktopDocumentRequest): Promise<Reply<LocalFile>>
  saveDocument(request: DesktopSaveRequest): Promise<Reply<DesktopFileDestination | null>>
  releaseDocument(request: DesktopDocumentRequest): Promise<Reply<void>>
}
declare global { interface Window { desktopSimulator?: DesktopBridge } }
