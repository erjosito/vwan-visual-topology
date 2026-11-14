import type { PlatformResult } from './contract'

type Reply<T> = { ok: true; value: T } | { ok: false; error: string }
export type LocalFile = { name: string; content: string } | null
export type DesktopScope = { subscriptionId: string; tenantId: string }
export type DesktopAccounts = { cloud: { name: string; resourceManager: string }; accounts: { id: string; name: string; tenantId: string; state: string }[] }
export type DesktopTargets = { groups: { id: string; name: string }[]; wans: { id: string; name: string }[] }
export interface DesktopBridge {
  openTopology(): Promise<Reply<LocalFile>>
  accounts(): Promise<Reply<DesktopAccounts>>
  targets(scope: DesktopScope): Promise<Reply<DesktopTargets>>
  collect(request: DesktopScope & { mode: 'vwan' | 'hub-spoke' | 'full'; target: string }): Promise<Reply<LocalFile>>
  simulate(request: unknown): Promise<Reply<PlatformResult>>
}
declare global { interface Window { desktopSimulator?: DesktopBridge } }
