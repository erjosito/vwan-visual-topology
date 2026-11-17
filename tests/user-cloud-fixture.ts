import { CloudError, createCloudHandler, type CloudStore, type StoredValue } from '../functions/user-cloud/handler'

export const testOwner = (user: string) => (user === 'alice' ? 'a' : 'b').repeat(64)
export function cloudFixture(origins = ['https://app.test']) {
  const data = new Map<string, StoredValue & { name?: string }>()
  let version = 0
  const store: CloudStore = {
    async get(key) { return data.get(key) },
    async put(key, raw, expected, name) {
      if (expected === null ? data.has(key) : data.get(key)?.etag !== expected) throw new CloudError(412, 'Changed cloud version.')
      const etag = `"${++version}"`
      data.set(key, { raw, etag, name })
      return etag
    },
    async delete(key, etag) {
      if (!data.has(key)) throw new CloudError(404, 'Not found.')
      if (data.get(key)?.etag !== etag) throw new CloudError(412, 'Changed cloud version.')
      data.delete(key)
    },
    async list(prefix) {
      return [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({
        id: key.slice(prefix.length).replace(/\.json$/, ''), name: value.name ?? 'Saved topology', etag: value.etag,
        updatedAt: '2026-11-17T12:00:00Z',
      }))
    },
  }
  const handler = createCloudHandler({ store, origins,
    authenticate: async authorization => {
      const user = authorization?.replace('Bearer ', '')
      if (!['alice', 'bob'].includes(user ?? '')) throw new Error('Rejected token')
      return testOwner(user!)
    } })
  const request = async (path: string, init?: RequestInit) => {
    const url = new URL(path, 'https://app.test')
    const [, resource, id] = url.pathname.match(/\/api\/cloud\/([^/]+)(?:\/([^/]+))?$/) ?? []
    const request = new Request(url, init)
    return handler(Object.assign(request, { params: { resource, id } }) as unknown as Parameters<typeof handler>[0])
  }
  return { data, store, request }
}
