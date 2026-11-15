import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

export async function assetGraph(paths, root = 'dist') {
  const graph = new Map()
  async function visit(path) {
    if (graph.has(path)) return
    const data = await readFile(resolve(root, `.${path}`))
    graph.set(path, { path, rawBytes: data.length, localGzipBytes: gzipSync(data).length })
    if (path.endsWith('.js')) {
      const imports = data.toString().matchAll(/(?:^|[;}])\s*import\s*(?:[^;]*?\s*from\s*)?["']([^"']+)["']/g)
      for (const match of imports) {
        if (match[1].startsWith('.')) await visit(new URL(match[1], `http://artifact${path}`).pathname)
      }
    }
  }
  for (const path of paths) await visit(path)
  const files = [...graph.values()].sort((a, b) => a.path.localeCompare(b.path))
  return { files, rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0), localGzipBytes: files.reduce((sum, file) => sum + file.localGzipBytes, 0) }
}

export async function initialAssetGraph(root = 'dist') {
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const paths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => new URL(match[1], 'http://artifact/').pathname)
  return assetGraph(paths, root)
}
