import { randomUUID } from 'node:crypto'
import { createCloudClient } from '../../src/cloud/client'
import { cloudLimits, parseCloudMetadata, parseCloudTopology, parseProgressLedger } from '../../src/cloud/contracts'
import { desktopCloudOperations, type DesktopCloudRequest, type DesktopCloudState } from '../../src/cloud/desktop-contract'
import type { CloudConfiguration } from '../../src/cloud/configuration'
import type { DesktopCloudAuth } from './cloud-auth'
import { boundedCloudFetch } from './cloud-http'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const id = (value: unknown) => typeof value === 'string' && uuid.test(value)
const etag = (value: unknown) => typeof value === 'string' && /^"[\x21\x23-\x7e]{1,160}"$/.test(value)
function admit(input: unknown): DesktopCloudRequest {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['session', 'operation', 'args'].includes(key))) throw new Error('Invalid cloud operation.')
  const value = input as DesktopCloudRequest, args = value.args
  if (!id(value.session) || !desktopCloudOperations.includes(value.operation) || !Array.isArray(args)
    || Buffer.byteLength(JSON.stringify(args)) > cloudLimits.bytes) throw new Error('Invalid cloud operation.')
  const valid = (() => {
    switch (value.operation) {
      case 'getProgress': case 'listTopologies': case 'listShares': return args.length === 0
      case 'getTopology': return args.length === 1 && id(args[0])
      case 'deleteTopology': case 'revokeShare': return args.length === 2 && id(args[0]) && etag(args[1])
      case 'createShare': return args.length === 3 && id(args[0]) && id(args[1]) && etag(args[2])
      case 'saveProgress':
        return args.length === 2 && (args[1] === null || etag(args[1])) && !!parseProgressLedger(JSON.stringify(args[0]))
      case 'saveTopology':
        return args.length === 3 && id(args[0]) && (args[2] === null || etag(args[2])) && !!parseCloudTopology(args[1])
      case 'updateTopologyMetadata':
        return args.length === 3 && id(args[0]) && etag(args[2]) && !!parseCloudMetadata(args[1])
    }
  })()
  if (!valid) throw new Error('Invalid cloud arguments.')
  return value
}
export class DesktopCloudBroker {
  private state: DesktopCloudState
  private abort = new AbortController()
  private generation = 0
  private queue = Promise.resolve()
  private connecting = false
  private closed = false
  private restoring?: Promise<DesktopCloudState>
  constructor(private config: CloudConfiguration | undefined, private auth: DesktopCloudAuth, private fetcher: typeof fetch = fetch) {
    this.state = { configured: !!config }
  }
  private serialize<T>(action: () => Promise<T>) {
    const operation = this.queue.then(action)
    this.queue = operation.then(() => {}, () => {})
    return operation
  }
  private check(ticket: number) {
    if (this.closed || ticket !== this.generation) throw new Error('Account changed.')
  }
  status() {
    if (!this.config || this.closed) return Promise.resolve({ configured: false })
    return this.restoring ??= this.authenticate(true).catch(() => ({ configured: !this.closed }))
  }
  private async authenticate(restore: boolean) {
    if (!this.config || this.closed) throw new Error('Desktop sign-in is not configured.')
    if (this.connecting) throw new Error('Sign-in is already in progress.')
    this.connecting = true
    if (!restore) this.restoring = undefined
    const ticket = ++this.generation
    this.abort.abort(); this.abort = new AbortController()
    const signal = this.abort.signal
    this.state = { configured: true }
    try {
      return await this.serialize(async () => {
        this.check(ticket)
        const account = await (restore ? this.auth.restore(signal) : this.auth.signIn(signal))
        this.check(ticket)
        this.state = { configured: true, ...(account ? { account, session: randomUUID() } : {}) }
        return this.state
      })
    } finally { this.connecting = false }
  }
  async signIn() {
    const state = await this.authenticate(false)
    this.restoring = Promise.resolve(state)
    return state
  }
  async signOut() {
    ++this.generation
    this.abort.abort()
    this.state = { configured: !!this.config && !this.closed }
    this.restoring = undefined
    await this.serialize(() => this.auth.signOut())
  }
  async request(input: unknown) {
    const request = admit(input), ticket = this.generation, signal = this.abort.signal
    if (!this.config || !this.state.account || request.session !== this.state.session) throw new Error('Account changed.')
    this.check(ticket)
    const api = createCloudClient(this.config.base, () => this.serialize(async () => {
      this.check(ticket)
      const token = await this.auth.token(signal)
      this.check(ticket)
      return token
    }), signal, boundedCloudFetch(this.fetcher))
    const method = api[request.operation] as (...args: unknown[]) => Promise<unknown>
    const result = await method(...request.args)
    this.check(ticket)
    return result
  }
  async close() {
    this.closed = true
    ++this.generation
    this.abort.abort()
    await this.queue
  }
}
