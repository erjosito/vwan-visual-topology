import { afterEach, expect, it, vi } from 'vitest'
import { access, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { DesktopDocumentFiles } from './document-files'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, access: vi.fn(actual.access), link: vi.fn(actual.link) }
})
afterEach(() => { vi.mocked(access).mockReset(); vi.mocked(link).mockReset() })

const documentId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const topology = (name: string) => JSON.stringify({
  version: 1, name, hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [],
})
const code = (value: string) => expect.objectContaining({ code: value })

async function fixture(run: (directory: string) => Promise<void>) {
  await mkdir(resolve('test-artifacts'), { recursive: true })
  const directory = await mkdtemp(join(resolve('test-artifacts'), 'document-files-374-'))
  try { await run(directory) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

it('loads a writable native file and updates it without a picker; Save As changes the destination only after a confirmed write', async () => {
  await fixture(async directory => {
    const original = join(directory, 'original.json'), copy = join(directory, 'copy.json')
    await writeFile(original, topology('Original'))
    let picks = 0
    const files = new DesktopDocumentFiles({ open: async () => original, save: async () => { picks++; return copy } })
    try {
      const loaded = (await files.open({ documentId }))!
      expect(loaded.name).toBe('original.json')
      expect(loaded.destination!.location).toBe(original)
      let destination = (await files.save({ documentId, content: topology('Edited'), destinationToken: loaded.destination!.token }))!
      expect(picks).toBe(0)
      expect(await readFile(original, 'utf8')).toBe(topology('Edited'))
      destination = (await files.save({ documentId, content: topology('Copy'), suggestedName: 'Copy' }))!
      expect(picks).toBe(1)
      expect(destination.location).toBe(copy)
      expect(await readFile(original, 'utf8')).toBe(topology('Edited'))
      destination = (await files.save({ documentId, content: topology('Copy edited'), destinationToken: destination.token }))!
      expect(picks).toBe(1)
      expect(await readFile(copy, 'utf8')).toBe(topology('Copy edited'))
      expect(await readFile(original, 'utf8')).toBe(topology('Edited'))
      expect(await readFile(copy, 'utf8')).not.toContain(destination.token)
      expect(await readFile(copy, 'utf8')).not.toContain(destination.location)
      expect((await readdir(directory)).sort()).toEqual(['copy.json', 'original.json'])
    } finally { await files.close() }
  })
}, 35_000)

it('keeps the prior file capability on Save As cancellation and a failed write, and removes temporary output', async () => {
  await fixture(async directory => {
    const original = join(directory, 'original.json'), copy = join(directory, 'copy.json')
    await writeFile(original, topology('Original'))
    let selected: string | undefined
    const files = new DesktopDocumentFiles({ open: async () => original, save: async () => selected })
    try {
      const destination = (await files.open({ documentId }))!.destination!
      expect(await files.save({ documentId, content: topology('Cancelled') })).toBeNull()
      selected = copy
      vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }))
      await expect(files.save({ documentId, content: topology('Failed copy') })).rejects.toEqual(code('permission'))
      expect(await readFile(original, 'utf8')).toBe(topology('Original'))
      expect(await readdir(directory)).toEqual(['original.json'])
      await files.save({ documentId, content: topology('Saved original'), destinationToken: destination.token })
      expect(await readFile(original, 'utf8')).toBe(topology('Saved original'))
    } finally { await files.close() }
  })
}, 20_000)

it('rejects borrowed, forged and released capabilities and arbitrary renderer paths before opening a picker or writing', async () => {
  await fixture(async directory => {
    const original = join(directory, 'original.json')
    await writeFile(original, topology('Original'))
    const save = vi.fn(async () => join(directory, 'unrelated.json'))
    const files = new DesktopDocumentFiles({ open: async () => original, save })
    try {
      const destination = (await files.open({ documentId }))!.destination!
      await expect(files.save({ documentId: otherId, content: topology('Borrowed'), destinationToken: destination.token })).rejects.toEqual(code('revoked'))
      await expect(files.save({ documentId, content: topology('Forged'), destinationToken: otherId })).rejects.toEqual(code('revoked'))
      await expect(files.save({ documentId, content: topology('Path'), path: original })).rejects.toEqual(code('invalid'))
      await expect(files.open({ documentId, path: original })).rejects.toEqual(code('invalid'))
      files.release({ documentId })
      await expect(files.save({ documentId, content: topology('Released'), destinationToken: destination.token })).rejects.toEqual(code('revoked'))
      expect(save).not.toHaveBeenCalled()
      expect(await readFile(original, 'utf8')).toBe(topology('Original'))
      expect(await readdir(directory)).toEqual(['original.json'])
    } finally { await files.close() }
  })
})

it('does not overwrite an externally changed or deleted file and never falls back to a new destination', async () => {
  await fixture(async directory => {
    const original = join(directory, 'original.json')
    await writeFile(original, topology('Original'))
    const save = vi.fn(async () => join(directory, 'fallback.json'))
    const files = new DesktopDocumentFiles({ open: async () => original, save })
    try {
      const destination = (await files.open({ documentId }))!.destination!
      await writeFile(original, topology('External edit'))
      await expect(files.save({ documentId, content: topology('Overwrite'), destinationToken: destination.token })).rejects.toEqual(code('conflict'))
      expect(await readFile(original, 'utf8')).toBe(topology('External edit'))
      await unlink(original)
      await expect(files.save({ documentId, content: topology('Recreate'), destinationToken: destination.token })).rejects.toEqual(code('conflict'))
      expect(await readdir(directory)).toEqual([])
      expect(save).not.toHaveBeenCalled()
    } finally { await files.close() }
  })
})

it('serializes repeated saves and revokes a pending picker without letting a delayed result write another document', async () => {
  await fixture(async directory => {
    const original = join(directory, 'original.json'), late = join(directory, 'late.json')
    await writeFile(original, topology('Original'))
    let selected!: (file: string) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const save = vi.fn(() => { entered(); return new Promise<string>(resolve => { selected = resolve }) })
    const files = new DesktopDocumentFiles({ open: async () => original, save })
    try {
      await files.open({ documentId })
      const pending = files.save({ documentId, content: topology('Late result') })
      const rejected = expect(pending).rejects.toEqual(code('revoked'))
      await started
      await expect(files.save({ documentId, content: topology('Duplicate') })).rejects.toEqual(code('busy'))
      files.release({ documentId })
      await rejected
      selected(late)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(save).toHaveBeenCalledTimes(1)
      expect(await readFile(original, 'utf8')).toBe(topology('Original'))
      expect(await readdir(directory)).toEqual(['original.json'])
    } finally { await files.close() }
  })
})

it('closes while a file picker is pending without waiting for the native dialog or accepting its late result', async () => {
  await fixture(async directory => {
    let selected!: (file: string) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const files = new DesktopDocumentFiles({
      open: async () => undefined,
      save: () => { entered(); return new Promise<string>(resolve => { selected = resolve }) },
    })
    const pending = files.save({ documentId, content: topology('Pending') })
    const rejected = expect(pending).rejects.toEqual(code('revoked'))
    await started
    await files.close()
    await rejected
    selected(join(directory, 'after-close.json'))
    await new Promise<void>(resolve => setImmediate(resolve))
    await expect(files.save({ documentId: otherId, content: topology('After close') })).rejects.toEqual(code('revoked'))
    expect(await readdir(directory)).toEqual([])
  })
})

it('does not issue writable capabilities for captures or permission-denied sources, or overwrite unrelated JSON through Save As', async () => {
  await fixture(async directory => {
    const capture = join(directory, 'capture.json'), readonly = join(directory, 'readonly.json'), unrelated = join(directory, 'settings.json')
    const captured = await readFile(resolve('tests', 'fixtures', 'azure-vwan-contexts', 'native-default.json'), 'utf8')
    await writeFile(capture, captured)
    await writeFile(readonly, topology('Read only'))
    await writeFile(unrelated, '{"unrelated":true}')
    let source = capture, selected = capture
    const files = new DesktopDocumentFiles({ open: async () => source, save: async () => selected })
    try {
      expect(await files.open({ documentId })).toMatchObject({ readOnly: true, content: captured })
      await expect(files.save({ documentId, content: captured })).rejects.toEqual(code('invalid'))
      source = readonly
      vi.mocked(access).mockRejectedValueOnce(Object.assign(new Error('Denied'), { code: 'EACCES' }))
      expect(await files.open({ documentId: otherId })).toMatchObject({ readOnly: true })
      await expect(files.save({ documentId, content: topology('Capture overwrite') })).rejects.toEqual(code('invalid'))
      selected = unrelated
      await expect(files.save({ documentId, content: topology('Unrelated overwrite') })).rejects.toEqual(code('invalid'))
      expect(await readFile(capture, 'utf8')).toBe(captured)
      expect(await readFile(readonly, 'utf8')).toBe(topology('Read only'))
      expect(await readFile(unrelated, 'utf8')).toBe('{"unrelated":true}')
    } finally { await files.close() }
  })
})

it('enforces UTF-8 byte and file-size bounds before granting a capability or selecting a save destination', async () => {
  await fixture(async directory => {
    const large = join(directory, 'large.json')
    await writeFile(large, Buffer.alloc(4_000_001))
    const save = vi.fn(async () => join(directory, 'output.json'))
    const files = new DesktopDocumentFiles({ open: async () => large, save })
    try {
      await expect(files.open({ documentId })).rejects.toEqual(code('invalid'))
      await expect(files.save({ documentId, content: topology('Invalid') + ' '.repeat(4_000_001) })).rejects.toEqual(code('invalid'))
      await expect(files.save({ documentId, content: topology('\u3042'.repeat(1_400_000)) })).rejects.toEqual(code('invalid'))
      await expect(files.save({ documentId, content: 'not JSON' })).rejects.toEqual(code('invalid'))
      await expect(files.save({ documentId, content: topology('Path name'), suggestedName: '..\\outside.json' })).rejects.toEqual(code('invalid'))
      await expect(files.save({ documentId, content: topology('Control name'), suggestedName: 'unsafe\u0000name.json' })).rejects.toEqual(code('invalid'))
      expect(save).not.toHaveBeenCalled()
      expect(await readdir(directory)).toEqual(['large.json'])
    } finally { await files.close() }
  })
})

it('rejects symlink destinations rather than modifying their unrelated targets', async context => {
  await fixture(async directory => {
    const victim = join(directory, 'victim.json'), alias = join(directory, 'alias.json')
    await writeFile(victim, topology('Unrelated target'))
    try { await symlink(victim, alias) }
    catch (error) {
      if (process.platform === 'win32' && error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') { context.skip(); return }
      throw error
    }
    const files = new DesktopDocumentFiles({ open: async () => alias, save: async () => alias })
    try {
      await expect(files.open({ documentId })).rejects.toEqual(code('invalid'))
      await expect(files.save({ documentId, content: topology('Redirected') })).rejects.toEqual(code('invalid'))
      expect(await readFile(victim, 'utf8')).toBe(topology('Unrelated target'))
    } finally { await files.close() }
  })
})

it('preserves a protected Windows file ACL and handles quoted Unicode filenames during replacement', async context => {
  if (process.platform !== 'win32') { context.skip(); return }
  await fixture(async directory => {
    const original = join(directory, "network's-\u30cd\u30c3\u30c8\u30ef\u30fc\u30af.json")
    await writeFile(original, topology('Original'))
    const permissions = async (protect = false) => new Promise<string>((resolve, reject) => {
      const command = `
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Console]::In.ReadToEnd() | ConvertFrom-Json
$acl=[IO.File]::GetAccessControl([string]$p.file)
if ($p.protect) { $acl.SetAccessRuleProtection($true,$true); [IO.File]::SetAccessControl([string]$p.file,$acl) }
([IO.File]::GetAccessControl([string]$p.file)).AreAccessRulesProtected`
      const child = execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 15_000, maxBuffer: 4096 },
        (error, stdout) => { if (error) reject(error); else resolve(stdout.trim()) })
      child.stdin?.on('error', () => {})
      child.stdin?.end(JSON.stringify({ file: original, protect }))
    })
    const files = new DesktopDocumentFiles({ open: async () => original, save: async () => undefined })
    try {
      expect(await permissions(true)).toBe('True')
      const destination = (await files.open({ documentId }))!.destination!
      await files.save({ documentId, content: topology('Edited'), destinationToken: destination.token })
      expect(await readFile(original, 'utf8')).toBe(topology('Edited'))
      expect(await permissions()).toBe('True')
    } finally { await files.close() }
  })
}, 30_000)
