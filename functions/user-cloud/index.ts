import { app } from '@azure/functions'
import { ManagedIdentityCredential } from '@azure/identity'
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob'
import { cloudLimits } from '../../src/cloud/contracts'
import { createAuthenticator } from './authentication'
import { CloudError, createCloudHandler, type CloudStore } from './handler'

function storageError(error: unknown): never {
  const status = (error as { statusCode?: number }).statusCode
  if (status === 412 || status === 409) throw new CloudError(412, 'This cloud version changed. Reload before replacing or deleting it.')
  if (status === 404) throw new CloudError(404, 'Cloud item not found.')
  throw error
}

export function blobStore(container: ContainerClient): CloudStore {
  return {
    async get(key) {
      const blob = container.getBlockBlobClient(key)
      try {
        const result = await blob.download()
        if (!result.etag || (result.contentLength ?? Infinity) > cloudLimits.bytes) throw new CloudError(413, 'Cloud document exceeds the supported size.')
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of result.readableStreamBody!) {
          length += Buffer.byteLength(chunk)
          if (length > cloudLimits.bytes) { result.readableStreamBody?.destroy(); throw new CloudError(413, 'Cloud document exceeds the supported size.') }
          chunks.push(Buffer.from(chunk))
        }
        return { raw: Buffer.concat(chunks).toString('utf8'), etag: result.etag }
      } catch (error) { if ((error as { statusCode?: number }).statusCode === 404) return undefined; return storageError(error) }
    },
    async put(key, raw, etag, name) {
      try {
        const result = await container.getBlockBlobClient(key).uploadData(Buffer.from(raw), {
          conditions: etag === null ? { ifNoneMatch: '*' } : { ifMatch: etag },
          blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8', blobCacheControl: 'no-store' },
          metadata: name ? { name: encodeURIComponent(name) } : undefined,
        })
        if (!result.etag) throw new Error('Cloud version unavailable.')
        return result.etag
      } catch (error) { return storageError(error) }
    },
    async delete(key, etag) {
      try { await container.getBlockBlobClient(key).delete({ conditions: { ifMatch: etag }, deleteSnapshots: 'include' }) }
      catch (error) { storageError(error) }
    },
    async list(prefix) {
      const entries: Awaited<ReturnType<CloudStore['list']>> = []
      for await (const blob of container.listBlobsFlat({ prefix, includeMetadata: true })) {
        const id = blob.name.slice(prefix.length).replace(/\.json$/, '')
        if (!/^[0-9a-f-]{36}$/.test(id)) continue
        entries.push({ id, name: decodeURIComponent(blob.metadata?.name ?? 'Saved topology').slice(0, cloudLimits.name),
          etag: blob.properties.etag!, updatedAt: blob.properties.lastModified?.toISOString() ?? '' })
      }
      return entries
    },
  }
}

let handler: ReturnType<typeof createCloudHandler> | undefined
app.http('userCloud', {
  methods: ['GET', 'PUT', 'DELETE', 'OPTIONS'], authLevel: 'anonymous', route: 'cloud/{resource}/{id?}',
  handler: async request => {
    try {
      if (!handler) {
        const url = process.env.CLOUD_STORAGE_ACCOUNT_URL
        const origins = (process.env.CLOUD_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
        if (!url || !/^https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/?$/.test(url) || !origins.length) throw new Error('Cloud configuration required.')
        const service = new BlobServiceClient(url, new ManagedIdentityCredential(process.env.CLOUD_RUNTIME_CLIENT_ID
          ? { clientId: process.env.CLOUD_RUNTIME_CLIENT_ID } : {}), { retryOptions: { maxTries: 3, tryTimeoutInMs: 10000 } })
        handler = createCloudHandler({
          authenticate: createAuthenticator(process.env.CLOUD_API_AUDIENCE ?? '', process.env.CLOUD_CLIENT_ID ?? ''),
          store: blobStore(service.getContainerClient('user-cloud')), origins,
        })
      }
      return await handler(request)
    } catch {
      return { status: 503, headers: { 'Cache-Control': 'no-store' }, jsonBody: { error: 'Cloud service has not been configured or is unavailable.' } }
    }
  },
})
