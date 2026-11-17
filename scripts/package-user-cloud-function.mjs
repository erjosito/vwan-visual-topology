import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: { output: { type: 'string', default: 'test-artifacts/user-cloud-function' } },
})
const output = resolve(values.output)
await mkdir(dirname(output), { recursive: true })
await mkdir(output)
for (const file of ['package.json', 'package-lock.json', 'host.json', 'dist/index.mjs']) {
  const destination = resolve(output, file)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(resolve(root, 'functions/user-cloud', file), destination)
}
console.log(`Function source staged at ${output}. Install locked dependencies there before packaging.`)
