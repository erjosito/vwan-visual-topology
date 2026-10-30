import { cp, mkdir, readFile, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'api')
const destination = join(root, 'test-artifacts', 'feedback-api')
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
if (Object.values(manifest.dependencies).some((version) => !/^[~^]?\d/.test(version))) {
  throw new Error('Production API dependencies must be registry versions, not local or linked packages.')
}
await mkdir(destination, { recursive: true })
for (const name of ['package.json', 'package-lock.json', 'host.json', 'dist']) {
  await cp(join(source, name), join(destination, name), { recursive: true })
}
const command = process.platform === 'win32' ? process.env.ComSpec : 'npm'
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm ci --omit=dev --no-fund --no-audit'] : ['ci', '--omit=dev', '--no-fund', '--no-audit']
execFileSync(command, args, { cwd: destination, stdio: 'inherit' })
const allowed = new Set(['package.json', 'package-lock.json', 'host.json', 'dist', 'node_modules'])
for (const name of await readdir(destination)) {
  if (!allowed.has(name)) throw new Error(`Unexpected API deployment file: ${name}`)
}
async function checkLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('API deployment artifacts must not contain links or junctions.')
    if (entry.isDirectory()) await checkLinks(join(directory, entry.name))
  }
}
await checkLinks(destination)
console.log('Packaged compiled API with production dependencies only; no source, tests or local settings.')
