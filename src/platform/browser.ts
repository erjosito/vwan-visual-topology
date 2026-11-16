import { incompletePlatformResult, validateRequest } from './service'
import { platformLimits } from './contract'
import type { PlatformResult } from './contract'

export async function runBrowserSimulation(input: unknown, signal?: AbortSignal): Promise<PlatformResult> {
  const request = validateRequest(input)
  const worker = new Worker(new URL('./browser-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve) => {
    const stopped = (code: string): PlatformResult => incompletePlatformResult(request, code)
    let settled = false
    const finish = (result: PlatformResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      worker.terminate()
      resolve(result)
    }
    const cancel = () => finish(stopped('CANCELLED'))
    const timer = setTimeout(() => finish(stopped('TIME_LIMIT')), request.budget?.maxMillis ?? platformLimits.maxMillis)
    worker.onmessage = ({ data }: MessageEvent<PlatformResult>) => {
      const bytes = new TextEncoder().encode(JSON.stringify(data)).length
      finish(bytes > (request.budget?.maxOutputBytes ?? platformLimits.maxOutputBytes) ? stopped('OUTPUT_LIMIT') : data)
    }
    worker.onerror = () => finish(stopped('WORKER_FAILURE'))
    if (signal?.aborted) cancel()
    else { signal?.addEventListener('abort', cancel, { once: true }); worker.postMessage(request) }
  })
}
