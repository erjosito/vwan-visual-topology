import type { HttpRequest } from '@azure/functions'
import { cloudLimits } from '../../src/cloud/contracts'

export interface StoredValue { raw: string; etag: string; generation?: string }
export interface CloudStore {
  get(key: string): Promise<StoredValue | undefined>
  put(key: string, raw: string, etag: string | null, name?: string): Promise<string>
  delete(key: string, etag: string): Promise<void>
  list(prefix: string): Promise<{ id: string; name: string; etag: string; updatedAt: string }[]>
}
export class CloudError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function body(request: HttpRequest, limit = cloudLimits.bytes) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new CloudError(415, 'JSON required.')
  const reader = request.body?.getReader()
  if (!reader) throw new CloudError(400, 'JSON required.')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, raw = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) { await reader.cancel(); throw new CloudError(413, 'Cloud document size limit exceeded.') }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
    return JSON.parse(raw)
  } catch (error) {
    if (error instanceof CloudError) throw error
    throw new CloudError(400, 'Invalid JSON document.')
  } finally { reader.releaseLock() }
}
