import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { admitJson } from '../../src/platform/service'
import { importAzureCapture } from '../../src/azure-import'
import { importAzNetCapture } from '../../src/azure-net/azure-import'

export type Scope = { subscriptionId: string; tenantId: string }
export type Collection = Scope & { mode: 'vwan' | 'hub-spoke' | 'full'; target: string }
export type Executor = (args: string[], timeout: number, signal?: AbortSignal) => Promise<string>
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function scopeArguments(scope: Scope): string[] {
  if (!scope || typeof scope.subscriptionId !== 'string' || typeof scope.tenantId !== 'string' || !uuid.test(scope.subscriptionId) || !uuid.test(scope.tenantId) || Object.keys(scope).some((key) => !['subscriptionId', 'tenantId'].includes(key))) throw new Error('Select an explicit valid tenant/subscription.')
  return ['-SubscriptionId', scope.subscriptionId, '-TenantId', scope.tenantId]
}

export const executePowerShell: Executor = (args, timeout, signal) => new Promise((resolve, reject) => {
  const failure = () => new Error('Local CLI collection stopped: unavailable CLI/PowerShell, expired login, denied scope, timeout or output limit. No login, installation or Azure mutation was attempted.')
  if (signal?.aborted) { reject(failure()); return }
  const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', ...args], {
    windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no', POWERSHELL_TELEMETRY_OPTOUT: '1',
      AZURE_CORE_COLLECT_TELEMETRY: 'no', AZURE_LOGGING_ENABLE_LOG_FILE: 'no',
    },
  })
  let output = '', bytes = 0, stopped = false, settled = false
  const stop = () => {
    if (!child.pid || child.exitCode !== null) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
      killer.on('error', () => child.kill())
      killer.on('close', (code) => { if (code !== 0 && child.exitCode === null) child.kill() })
    } else child.kill('SIGKILL')
  }
  const fail = () => {
    if (stopped || settled) return
    stopped = true
    clearTimeout(timer)
    stop()
  }
  const timer = setTimeout(fail, timeout)
  signal?.addEventListener('abort', fail, { once: true })
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > 2_000_000) fail()
    else output += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2_000_000) fail() })
  child.on('error', fail)
  child.on('close', (code) => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', fail)
    settled = true
    if (stopped || code !== 0) reject(failure())
    else resolve(output)
  })
})

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:sharedKey|serviceKey|password|accessToken|refreshToken|token|clientSecret|privateKey|authorization|connectionString)$/i.test(key))
    .map(([key, item]) => [key, stripSecrets(item)]))
  return value
}

export class AzureBroker {
  private collecting = false
  private closing = false
  private controller = new AbortController()
  private pending = new Set<Promise<unknown>>()
  constructor(private scriptRoot: string, private collectorRoot: string, private execute: Executor = executePowerShell) {}

  async close() {
    this.closing = true
    this.controller.abort()
    await Promise.allSettled([...this.pending])
  }

  private async track<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('Desktop CLI broker is closing.')
    const work = action()
    this.pending.add(work)
    try { return await work }
    finally { this.pending.delete(work) }
  }

  accounts() { return this.track(async () => {
    const result = JSON.parse(await this.execute([join(this.scriptRoot, 'azure-read.ps1'), '-Operation', 'accounts'], 60_000, this.controller.signal))
    if (result.cloud?.name !== 'AzureCloud' || !Array.isArray(result.accounts)) throw new Error('Unsupported cloud or no readable account inventory. Public Azure only; no login attempted.')
    return result as { cloud: { name: string; resourceManager: string }; accounts: { id: string; name: string; tenantId: string; state: string }[] }
  }) }

  targets(scope: Scope) { return this.track(async () => {
    const result = JSON.parse(await this.execute([join(this.scriptRoot, 'azure-read.ps1'), '-Operation', 'targets', ...scopeArguments(scope)], 60_000, this.controller.signal))
    if (!Array.isArray(result.groups) || !Array.isArray(result.wans)) throw new Error('Unreadable target inventory.')
    return result as { groups: { id: string; name: string }[]; wans: { id: string; name: string }[] }
  }) }

  collect(input: Collection) { return this.track(async () => {
    if (this.collecting) throw new Error('A collection is already running.')
    if (!input || !['vwan', 'hub-spoke', 'full'].includes(input.mode) || Object.keys(input).some((key) => !['subscriptionId','tenantId','mode','target'].includes(key))) throw new Error('Invalid collection request.')
    const args = scopeArguments({ subscriptionId: input.subscriptionId, tenantId: input.tenantId })
    if (typeof input.target !== 'string' || input.target.length > 512 || /["\r\n\0]/.test(input.target)) throw new Error('Invalid collection target.')
    if (input.mode === 'vwan') {
      if (!new RegExp(`^/subscriptions/${input.subscriptionId}/resourceGroups/[a-zA-Z0-9_.() -]+/providers/Microsoft.Network/virtualWans/[a-zA-Z0-9_.-]+$`, 'i').test(input.target)) throw new Error('Selected WAN must belong to selected subscription.')
    } else if (!/^[a-zA-Z0-9_.() -]{1,90}$/.test(input.target)) throw new Error('Invalid resource group.')
    this.collecting = true
    let directory: string | undefined
    try {
      directory = await mkdtemp(join(tmpdir(), 'aznet-desktop-capture-'))
      const file = join(directory, 'capture.json')
      await this.execute([
        join(this.scriptRoot, 'azure-read.ps1'), '-Operation', 'collect', ...args,
        '-Mode', input.mode, '-Target', input.target, '-OutputFile', file, '-CollectorRoot', this.collectorRoot,
      ], 20 * 60_000, this.controller.signal)
      if ((await stat(file)).size > 4_000_000) throw new Error('Capture exceeds the desktop import limit.')
      const raw = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
      admitJson(raw)
      const capture = stripSecrets(raw)
      const content = admitJson(capture)
      if (input.mode === 'vwan') importAzureCapture(capture)
      else {
        const imported = importAzNetCapture(capture)
        if (!imported.topology.vnets.length) throw new Error('No usable VNet topology was captured; inspect scope/read permissions.')
      }
      return { name: 'azure-capture.json', content }
    } finally { this.collecting = false; if (directory) await rm(directory, { recursive: true, force: true }) }
  }) }
}
