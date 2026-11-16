import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: { output: { type: 'string', default: 'test-artifacts/github-statistics-function' } },
})
const output = resolve(values.output)
await mkdir(dirname(output), { recursive: true })
await mkdir(output)
const files = [
  ['functions/github-statistics/package.json', 'package.json'],
  ['functions/github-statistics/package-lock.json', 'package-lock.json'],
  ['functions/github-statistics/host.json', 'host.json'],
  ['functions/github-statistics/index.mjs', 'functions/github-statistics/index.mjs'],
  ['functions/github-statistics/handler.mjs', 'functions/github-statistics/handler.mjs'],
  ['functions/github-statistics/dashboard.mjs', 'functions/github-statistics/dashboard.mjs'],
  ['functions/github-statistics/swa.mjs', 'functions/github-statistics/swa.mjs'],
  ['functions/github-statistics/dashboard.html', 'functions/github-statistics/dashboard.html'],
  ['functions/github-statistics/dashboard-client.js', 'functions/github-statistics/dashboard-client.js'],
  ['scripts/collect-github-statistics.mjs', 'scripts/collect-github-statistics.mjs'],
]
for (const [source, target] of files) {
  const destination = resolve(output, target)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(resolve(root, source), destination)
}
console.log(`Function source staged at ${output}. Install locked dependencies there before packaging.`)
