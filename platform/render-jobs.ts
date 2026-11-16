import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { PlatformResult } from '../src/platform/contract'
import { createFlowExportScene, flowExportLimits, flowExportOptions } from '../src/flow-export'
import type { FlowExportOptions } from '../src/flow-export'
import type { renderFlow } from './render'

type Rendered = Awaited<ReturnType<typeof renderFlow>>
type Job = { expires: number; cancel: () => Promise<void>; result?: Rendered; error?: string; status: 'running' | 'finished' | 'failed' | 'cancelled' }

export class RenderJobs {
  private jobs = new Map<string, Job>()
  private active = 0
  constructor(private workerFile = join(__dirname, 'render-worker.cjs')) {}

  start(result: PlatformResult, assessmentId: string, input: FlowExportOptions = {}) {
    this.prune()
    if (this.active >= 1 || this.jobs.size >= 4) throw new Error('Render capacity reached; wait for active work or release retained artifacts.')
    const options = flowExportOptions(input)
    createFlowExportScene(result, assessmentId, options)
    const handle = randomUUID()
    const worker = new Worker(this.workerFile, {
      workerData: { result, assessmentId, options },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    })
    this.active++
    let settled = false
    let termination: Promise<void>
    const job: Job = { expires: Date.now() + 600_000, status: 'running', cancel: () => finish('cancelled', 'Render cancelled.') }
    const finish = (status: Job['status'], error?: string, rendered?: Rendered): Promise<void> => {
      if (settled) return termination
      settled = true
      clearTimeout(timer)
      termination = worker.terminate().then(() => {
        this.active--
        Object.assign(job, { status, error, result: rendered })
      }, () => {
        this.active--
        Object.assign(job, { status: 'failed', error: 'Could not stop render worker.' })
      })
      return termination
    }
    const timer = setTimeout(() => finish('failed', 'Render time limit reached.'), 30_000)
    worker.once('message', (message: { result?: Rendered; error?: string }) => {
      if (!message.result) finish('failed', message.error ?? 'Render failed.')
      else if (message.result.bytes.byteLength > flowExportLimits.maxBytes) finish('failed', 'Artifact byte limit reached.')
      else finish('finished', undefined, message.result)
    })
    worker.once('error', () => finish('failed', 'Render worker failed.'))
    worker.once('exit', () => { if (!settled) finish('failed', 'Render worker exited.') })
    this.jobs.set(handle, job)
    return handle
  }

  get(handle: string) {
    this.prune()
    const job = this.jobs.get(handle)
    if (!job) throw new Error('Unknown or expired render handle.')
    return job
  }

  describe(handle: string) {
    const job = this.get(handle), result = job.result
    return {
      handle, status: job.status, ...(job.error ? { error: job.error } : {}),
      ...(result ? {
        mimeType: result.mimeType, format: result.format, byteLength: result.bytes.length,
        sha256: createHash('sha256').update(result.bytes).digest('hex'),
        width: result.scene.width, height: result.scene.height, durationMs: result.scene.durationMs,
        engineVersion: result.scene.engineVersion, revision: result.scene.revision,
        assessmentId: result.scene.assessmentId, outcome: result.scene.outcome,
        lanes: result.scene.lanes.map(({ direction, status, nodes }) => ({ direction, status, nodes })),
        limitations: result.scene.limitations,
      } : {}),
    }
  }

  artifact(handle: string, offset = 0, limit = 12_000) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 12_000) throw new Error('Invalid artifact chunk bounds.')
    const result = this.get(handle).result
    if (!result) throw new Error('No finished artifact is available.')
    if (offset > result.bytes.length) throw new Error('Offset outside artifact.')
    const end = Math.min(offset + limit, result.bytes.length)
    return {
      offset, nextOffset: end, totalBytes: result.bytes.length, complete: end === result.bytes.length,
      mimeType: result.mimeType, encoding: 'base64', data: Buffer.from(result.bytes.subarray(offset, end)).toString('base64'),
    }
  }

  async cancel(handle: string) { await this.get(handle).cancel() }
  async release(handle: string) { await this.get(handle).cancel(); this.jobs.delete(handle) }
  close() { for (const job of this.jobs.values()) void job.cancel(); this.jobs.clear() }
  private prune() { for (const [handle, job] of this.jobs) if (job.expires <= Date.now()) { void job.cancel(); this.jobs.delete(handle) } }
}
