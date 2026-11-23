import { readFile, stat, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export interface CloudEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export class EncryptedCloudCache {
  constructor(private file: string, private encryption: CloudEncryption) {}
  assertAvailable() {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('OS-protected credential storage is unavailable.')
  }
  async read(): Promise<string | undefined> {
    this.assertAvailable()
    try {
      if ((await stat(this.file)).size > 2 * 1024 * 1024) throw new Error('Credential cache is too large.')
      return this.encryption.decryptString(await readFile(this.file))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async write(value: string) {
    this.assertAvailable()
    if (Buffer.byteLength(value) > 1024 * 1024) throw new Error('Credential cache is too large.')
    const encrypted = this.encryption.encryptString(value)
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      await rename(temporary, this.file)
    } finally { await rm(temporary, { force: true }) }
  }
  async clear() { await rm(this.file, { force: true }) }
}
