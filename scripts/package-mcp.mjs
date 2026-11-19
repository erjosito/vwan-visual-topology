import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidateVersion } from './release-candidate.mjs'

export async function packageMcp(output, root = process.cwd()) {
  const read = (path) => readFile(resolve(root, path), 'utf8')
  const source = JSON.parse(await read('package.json'))
  const lock = JSON.parse(await read('package-lock.json'))
  const version = candidateVersion(source.version).package
  const manifest = {
    name: 'aznet-simulator-mcp', version, private: true, type: 'commonjs',
    main: 'mcp.cjs', engines: { node: '>=22' },
    dependencies: { '@resvg/resvg-js': source.dependencies['@resvg/resvg-js'] },
  }
  const packages = Object.fromEntries(Object.entries(lock.packages).filter(([path]) => path.startsWith('node_modules/@resvg/')))
  if (!packages['node_modules/@resvg/resvg-js']) throw new Error('Missing locked MCP rendering dependency')
  const licenses = new Set()
  for (const entry of ['mcp', 'worker', 'render-worker']) {
    for (const input of JSON.parse(await read(`platform-dist/${entry}.inputs.json`))) {
      const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)
      if (match) licenses.add(match[1])
    }
  }
  const notices = []
  for (const path of [...licenses].sort()) {
    const files = (await readdir(resolve(root, path))).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))
    if (!files.length) throw new Error(`Missing bundled dependency license: ${path}`)
    for (const name of files.sort()) notices.push(`${path}/${name}\n\n${await read(`${path}/${name}`)}`)
  }
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  for (const entry of ['mcp', 'worker', 'render-worker']) {
    await copyFile(resolve(root, `platform-dist/${entry}.cjs`), resolve(output, `${entry}.cjs`))
  }
  await copyFile(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'))
  await writeFile(resolve(output, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n--------------------\n\n'))
  await writeFile(resolve(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(resolve(output, 'package-lock.json'), `${JSON.stringify({
    name: manifest.name, version, lockfileVersion: 3, requires: true,
    packages: { '': { name: manifest.name, version, engines: manifest.engines, dependencies: manifest.dependencies }, ...packages },
  }, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageMcp(resolve(process.argv[2] ?? 'test-artifacts/mcp-package'))
    .catch((error) => { console.error(error.message); process.exitCode = 1 })
}
