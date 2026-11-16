import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { incompletePlatformResult, validateRequest } from '../src/platform/service'
import { platformLimits } from '../src/platform/contract'
import type { PlatformRequest, PlatformResult } from '../src/platform/contract'

type Job = { expires: number; cancel: () => void; result?: PlatformResult; done: Promise<PlatformResult> }

export class PlatformJobs {
  private jobs = new Map<string, Job>()
  private active = 0
  constructor(private workerFile = join(__dirname, 'worker.cjs')) {}

  start(input: unknown): string {
    const request = validateRequest(input)
    this.prune()
    if (this.active >= platformLimits.maxConcurrency || this.jobs.size >= 8) throw new Error('Job capacity reached; cancel or wait for existing jobs to expire.')
    const handle = randomUUID()
    const worker = new Worker(this.workerFile, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } })
    this.active++
    let finish: (result: PlatformResult) => void
    let settled = false
    const job: Job = {
      expires: Date.now() + 10 * 60_000,
      cancel: () => finish(this.incomplete(request, 'CANCELLED')),
      done: new Promise((resolve) => { finish = resolve }),
    }
    const resolve = finish!
    const timer = setTimeout(() => finish(this.incomplete(request, 'TIME_LIMIT')), request.budget?.maxMillis ?? platformLimits.maxMillis)
    finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      job.result = result
      void worker.terminate().then(() => { this.active--; resolve(result) })
    }
    worker.once('message', (result: PlatformResult) => {
      const bytes = Buffer.byteLength(JSON.stringify(result))
      finish(bytes > (request.budget?.maxOutputBytes ?? platformLimits.maxOutputBytes) ? this.incomplete(request, 'OUTPUT_LIMIT') : result)
    })
    worker.once('error', () => finish(this.incomplete(request, 'WORKER_FAILURE')))
    worker.once('exit', () => { if (!settled) finish(this.incomplete(request, 'WORKER_EXIT')) })
    this.jobs.set(handle, job)
    return handle
  }

  async run(input: unknown, signal?: AbortSignal): Promise<PlatformResult> {
    const handle = this.start(input)
    const cancel = () => this.cancel(handle)
    if (signal?.aborted) cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    try { return await this.jobs.get(handle)!.done }
    finally { signal?.removeEventListener('abort', cancel); this.jobs.delete(handle) }
  }

  get(handle: string) {
    this.prune()
    const job = this.jobs.get(handle)
    if (!job) throw new Error('Unknown or expired result handle.')
    return { status: job.result ? 'finished' : 'running', result: job.result }
  }

  cancel(handle: string) {
    const job = this.jobs.get(handle)
    if (!job) throw new Error('Unknown result handle.')
    job.cancel()
  }

  close() {
    for (const job of this.jobs.values()) job.cancel()
    this.jobs.clear()
  }

  private prune() {
    for (const [handle, job] of this.jobs) if (job.expires <= Date.now()) { job.cancel(); this.jobs.delete(handle) }
  }

  private incomplete(request: PlatformRequest, code: string): PlatformResult {
    return incompletePlatformResult(request, code)
  }
}
