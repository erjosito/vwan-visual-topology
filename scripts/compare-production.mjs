import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const [baseline, candidate, output] = process.argv.slice(2)
if (!baseline || !candidate || !output || process.argv.length !== 5) {
  throw new Error('Usage: node scripts/compare-production.mjs <baseline-dist> <candidate-dist> <output.json>')
}
const roots = { baseline: resolve(baseline), candidate: resolve(candidate) }
const artifacts = join(dirname(resolve(output)), 'paired-runs')
await mkdir(artifacts, { recursive: true })
async function fingerprint(root) {
  const hash = createHash('sha256')
  for (const file of (await readdir(root, { recursive: true })).sort()) {
    if (!(await stat(join(root, file))).isFile()) continue
    hash.update(file.replaceAll('\\', '/')).update('\0').update(await readFile(join(root, file))).update('\0')
  }
  return hash.digest('hex')
}
const hashes = { baseline: await fingerprint(roots.baseline), candidate: await fingerprint(roots.candidate) }
const revision = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sourceRevision = revision()
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim()) {
  throw new Error('Commit source changes before measuring artifacts')
}
const availableMemoryBefore = freemem()
const runs = { baseline: [], candidate: [] }
const order = []
for (let pair = 0; pair < 20; pair++) {
  const labels = pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']
  for (const label of labels) {
    const raw = join(artifacts, `${String(pair + 1).padStart(2, '0')}-${label}.json`)
    execFileSync(process.execPath, ['scripts/measure-production.mjs', raw], {
      env: { ...process.env, PRODUCTION_ROOT: roots[label] }, maxBuffer: 8 * 1024 * 1024,
    })
    runs[label].push(JSON.parse(await readFile(raw, 'utf8')))
    order.push({ pair: pair + 1, artifact: label })
    console.log(`Pair ${pair + 1}/20: ${label}`)
  }
}
function distribution(samples) {
  if (samples.length !== 20 || samples.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Incomplete timing evidence')
  const sorted = [...samples].sort((a, b) => a - b)
  return { samples, count: sorted.length, median: (sorted[9] + sorted[10]) / 2,
    p95: sorted[18], min: sorted[0], max: sorted.at(-1) }
}
function summarize(reports) {
  if (reports.some((report) => JSON.stringify(report.initialReferencedGraph) !== JSON.stringify(reports[0].initialReferencedGraph))) {
    throw new Error('Initial reference graph varied across repeated runs')
  }
  if (reports.some((report) => JSON.stringify(report.initialJapaneseWorkspace.initialRequests) !== JSON.stringify(reports[0].initialJapaneseWorkspace.initialRequests))) {
    throw new Error('Japanese startup requests varied across repeated runs')
  }
  return {
    initialReferencedGraph: reports[0].initialReferencedGraph,
    modes: ['vwan', 'hub-spoke', 'full'].map((mode) => {
      const entries = reports.map((report) => report.modes.find((entry) => entry.mode === mode))
      if (entries.some((entry) => JSON.stringify(entry.initialRequests) !== JSON.stringify(entries[0].initialRequests))) {
        throw new Error(`Startup requests varied across repeated ${mode} runs`)
      }
      return { mode, language: 'en', initialRequests: entries[0].initialRequests,
        ...Object.fromEntries(['readyMs', 'firstOptionalPanelMs', 'firstInactiveWorkspaceMs', 'firstJapaneseSwitchMs']
          .map((key) => [key, distribution(entries.map((entry) => entry[key]))])),
        firstJapaneseSwitchWorkspace: entries[0].firstJapaneseSwitchWorkspace }
    }),
    initialJapaneseWorkspace: { ...reports[0].initialJapaneseWorkspace,
      readyMs: distribution(reports.map((report) => report.initialJapaneseWorkspace.readyMs)) },
  }
}
if (sourceRevision !== revision() || execFileSync('git', ['diff', 'HEAD', '--'], { encoding: 'utf8' }).trim()
  || hashes.baseline !== await fingerprint(roots.baseline)
  || hashes.candidate !== await fingerprint(roots.candidate)) throw new Error('Source/artifact changed during comparison')
if (new Set([...runs.baseline, ...runs.candidate].map((report) => report.browserVersion)).size !== 1) {
  throw new Error('Browser version changed during comparison')
}
const result = {
  evidenceVersion: 1, measuredAt: new Date().toISOString(), harnessRevision: sourceRevision,
  environment: { node: process.version, browser: runs.candidate[0].browserVersion, platform: process.platform,
    cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemory: totalmem(), availableMemoryBefore, availableMemoryAfter: freemem() },
  qualification: '20 serial invocations per artifact, alternating AB/BA pairs; fresh browser per invocation and fresh contexts per mode. Mode order is fixed. Shared machine, OS cache not reset. Loopback uncompressed artifact serving; local gzip is not Azure transfer. Nearest-rank p95 is descriptive, not statistical significance.',
  order, artifactSha256: hashes, baseline: summarize(runs.baseline), candidate: summarize(runs.candidate),
}
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Comparison saved: ${output}`)
