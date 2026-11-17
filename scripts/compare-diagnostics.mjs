import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const [baselineSource, baselineDist, candidateDist, output] = process.argv.slice(2)
if (!baselineSource || !baselineDist || !candidateDist || !output || process.argv.length !== 6) {
  throw new Error('Usage: node scripts/compare-diagnostics.mjs <baseline-source> <baseline-dist> <candidate-dist> <output.json>')
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=normal')) throw new Error('Commit source changes before measuring')
const revision = git('rev-parse', 'HEAD')
const roots = { baselineSource: resolve(baselineSource), candidateSource: process.cwd(),
  baselineDist: resolve(baselineDist), candidateDist: resolve(candidateDist) }
async function fingerprint(root) {
  const hash = createHash('sha256')
  for (const file of (await readdir(root, { recursive: true })).sort()) {
    if ((await stat(join(root, file))).isFile()) hash.update(file.replaceAll('\\', '/')).update('\0').update(await readFile(join(root, file))).update('\0')
  }
  return hash.digest('hex')
}
async function fingerprints() {
  const result = {}
  for (const [label, root] of Object.entries(roots)) {
    result[label] = await fingerprint(label.endsWith('Source') ? join(root, 'src') : root)
  }
  return result
}
const hashes = await fingerprints()
const rawRoot = join(dirname(resolve(output)), 'diagnostics-paired-runs')
await mkdir(rawRoot, { recursive: true })
const runs = { ssr: { baseline: [], candidate: [] }, browser: { baseline: [], candidate: [] } }, order = []
for (const [kind, pairs] of [['ssr', 6], ['browser', 4]]) {
  for (let pair = 0; pair < pairs; pair++) {
    for (const artifact of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const file = join(rawRoot, `${kind}-${pair + 1}-${artifact}.json`)
      const script = kind === 'ssr' ? 'scripts/benchmark-diagnostics.mjs' : 'scripts/measure-diagnostics-worker.mjs'
      execFileSync(process.execPath, [script, file], { maxBuffer: 8 * 1024 * 1024, env: { ...process.env,
        DIAGNOSTICS_ROOT: roots[`${artifact}Source`], PRODUCTION_ROOT: roots[`${artifact}Dist`] } })
      runs[kind][artifact].push(JSON.parse(await readFile(file, 'utf8')))
      order.push({ kind, pair: pair + 1, artifact })
      console.log(`${kind} pair ${pair + 1}/${pairs}: ${artifact}`)
    }
  }
}
function distribution(samples) {
  assert.ok(samples.length > 0 && samples.every((sample) => Number.isFinite(sample) && sample >= 0))
  const sorted = [...samples].sort((a, b) => a - b), half = sorted.length / 2
  return { samples, count: sorted.length, median: (sorted[Math.floor(half)] + sorted[Math.ceil(half) - 1]) / 2, min: sorted[0], max: sorted.at(-1) }
}
const ssr = {}
for (const artifact of ['baseline', 'candidate']) {
  ssr[artifact] = runs.ssr[artifact][0].results.map((first) => {
    const rows = runs.ssr[artifact].map((run) => run.results.find((row) => row.label === first.label))
    for (const row of rows) {
      const reference = runs.ssr.baseline[0].results.find((entry) => entry.label === row.label)
      for (const key of ['workloadSha256', 'reportSha256', 'budget', 'cells', 'probes', 'failureCases', 'status', 'complete', 'remainingCells', 'limits']) {
        assert.deepEqual(row[key], reference[key], `${artifact} ${row.label}: ${key} drifted`)
      }
      assert.equal(row.complete, true)
      assert.equal(row.remainingCells, 0)
    }
    return { label: first.label, workloadSha256: first.workloadSha256, reportSha256: first.reportSha256,
      budget: first.budget, cells: first.cells, probes: first.probes, failureCases: first.failureCases,
      elapsedMillis: distribution(rows.map((row) => row.elapsedMillis)),
      maximumObservedHeapMiB: distribution(rows.map((row) => row.maximumObservedHeapMiB)) }
  })
}
for (const artifact of ['baseline', 'candidate']) for (const row of runs.browser[artifact]) {
  for (const key of ['workloadSha256', 'reportSha256', 'browser', 'budget', 'cells', 'probes', 'status', 'remainingCells']) {
    assert.deepEqual(row[key], runs.browser.baseline[0][key], `Browser ${artifact}: ${key} drifted`)
  }
}
assert.equal(revision, git('rev-parse', 'HEAD'))
assert.equal(git('diff', 'HEAD', '--'), '')
assert.deepEqual(await fingerprints(), hashes, 'Source or production artifacts changed during measurement')
const browser = Object.fromEntries(['baseline', 'candidate'].map((artifact) => [artifact, {
  ...runs.browser[artifact][0],
  ...Object.fromEntries(['elapsedMillis', 'batches', 'animationFrames', 'maximumFrameGapMillis', 'cancelMillis']
    .map((key) => [key, distribution(runs.browser[artifact].map((row) => row[key]))])),
}]))
await writeFile(output, `${JSON.stringify({
  evidenceVersion: 1, measuredAt: new Date().toISOString(), harnessRevision: revision, artifactSha256: hashes, order,
  qualification: 'Six SSR pairs and four production-browser pairs, serial alternating AB/BA; fresh process per invocation. Fixed bounded-before-wide case order within SSR. Full report hashes and corpus/budgets must match across artifacts. Shared machine, OS cache uncontrolled. Small-sample medians/ranges are descriptive; no p95/significance or true peak-memory claim.',
  ssr, browser, rawRuns: runs,
}, null, 2)}\n`)
console.log(`Comparison saved: ${output}`)
