import type { BrowserDocumentHandle } from './browser-document-writer'

const databaseName = 'aznetsim-document-files'
const storeName = 'handles'
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
interface StoredFile { id: string; documentId: string; handle: BrowserDocumentHandle; revision: string; savedAt: number }

export function createBrowserDocumentStore() {
  let connection: Promise<IDBDatabase> | undefined
  const database = () => connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: 'id' })
      store.createIndex('savedAt', 'savedAt')
      store.createIndex('documentId', 'documentId')
    }
    request.onsuccess = () => {
      const db = request.result
      if (abandoned) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
    request.onerror = () => { abandoned = true; reject(request.error) }
    request.onblocked = () => { abandoned = true; reject(new Error('File permission storage is blocked.')) }
  }).catch(error => { connection = undefined; throw error })
  const valid = (file: StoredFile | undefined): file is StoredFile => !!file && typeof file.id === 'string' && idPattern.test(file.id)
    && typeof file.documentId === 'string' && idPattern.test(file.documentId)
    && typeof file.revision === 'string' && /^[0-9a-f]{64}$/.test(file.revision)
    && Number.isFinite(file.savedAt) && file.handle?.kind === 'file'
    && typeof file.handle.name === 'string' && !!file.handle.name && file.handle.name.length <= 255
    && typeof file.handle.getFile === 'function' && typeof file.handle.createWritable === 'function'
    && typeof file.handle.queryPermission === 'function' && typeof file.handle.requestPermission === 'function'
    && typeof file.handle.isSameEntry === 'function'
  return {
    async get(documentId: string, bindingId: string | undefined) {
      if (!idPattern.test(documentId) || !bindingId || !idPattern.test(bindingId)) return undefined
      try {
        const db = await database()
        const file = await new Promise<StoredFile | undefined>((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly')
          const request = transaction.objectStore(storeName).get(bindingId)
          transaction.oncomplete = () => resolve(request.result)
          transaction.onabort = () => reject(transaction.error)
        })
        return valid(file) && file.id === bindingId && file.documentId === documentId ? file : undefined
      } catch { return undefined }
    },
    async put(documentId: string, handle: BrowserDocumentHandle, revision: string, bindingId: string) {
      const file = { id: bindingId, documentId, handle, revision, savedAt: Date.now() }
      if (!valid(file)) return false
      try {
        const db = await database()
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readwrite')
          const store = transaction.objectStore(storeName)
          store.put(file)
          let retained = 0
          const cursor = store.index('savedAt').openCursor(null, 'prev')
          cursor.onsuccess = () => {
            const entry = cursor.result
            if (!entry) return
            if (entry.primaryKey !== bindingId && ++retained > 63) entry.delete()
            entry.continue()
          }
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error)
        })
        return true
      } catch { return false }
    },
    async remove(id: string) {
      if (!idPattern.test(id)) return
      try {
        const db = await database()
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readwrite')
          const cursor = transaction.objectStore(storeName).index('documentId').openCursor(id)
          cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue() } }
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error)
        })
      } catch { /* Losing a permission hint must not delete or alter the user's file. */ }
    },
    async dispose() {
      try { (await connection)?.close() } catch {}
      connection = undefined
    },
  }
}
