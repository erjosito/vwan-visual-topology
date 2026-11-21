import { expect, test } from 'vitest'
import { documentArtifactKey, parseArtifactMetadata } from './document-metadata'
import { workspaceTabKey, workspaceTabStorage } from './workspace-tabs'

const destination = { kind: 'file', platform: 'desktop', name: 'network.json', location: 'C:\\Labs\\network.json', revision: 'a'.repeat(64) }
const metadata = { version: 1, destination, digest: 'b'.repeat(64) }

test('retained metadata projects bounded hints without importing file authority or arbitrary fields', () => {
  expect(parseArtifactMetadata(JSON.stringify({ ...metadata, token: 'private', destination: { ...destination, authority: 'forged' } }))).toEqual(metadata)
  for (const raw of ['{', JSON.stringify({ ...metadata, digest: ['b'.repeat(64)] }),
    JSON.stringify({ ...metadata, destination: { ...destination, revision: ['a'.repeat(64)] } }),
    JSON.stringify({ ...metadata, destination: { ...destination, location: 'x'.repeat(4097) } })]) {
    expect(parseArtifactMetadata(raw)).toBeUndefined()
  }
})

test('cloud hints require actual account identity, UUID and ETag rather than display name or coerced values', () => {
  const cloud = { kind: 'cloud', accountId: 'account', id: '11111111-1111-4111-8111-111111111111', name: 'Lab', etag: '"one"' }
  expect(parseArtifactMetadata(JSON.stringify({ ...metadata, destination: cloud }))?.destination).toEqual(cloud)
  for (const invalid of [{ ...cloud, id: [cloud.id] }, { ...cloud, etag: [cloud.etag] }, { ...cloud, accountId: '' }]) {
    expect(parseArtifactMetadata(JSON.stringify({ ...metadata, destination: invalid }))).toBeUndefined()
  }
})

test('artifact hints use separate document-scoped storage and cannot redirect another tab', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const tab = { id: '11111111-1111-4111-8111-111111111111', provider: 'vwan' as const, name: 'Lab' }
  const other = { ...tab, id: '22222222-2222-4222-8222-222222222222' }
  workspaceTabStorage(storage, tab).setItem(documentArtifactKey, JSON.stringify(metadata))
  expect(parseArtifactMetadata(storage.getItem(workspaceTabKey(tab, 'artifact')))).toEqual(metadata)
  expect(workspaceTabStorage(storage, other).getItem(documentArtifactKey)).toBeNull()
  expect(storage.getItem(documentArtifactKey)).toBeNull()
})
