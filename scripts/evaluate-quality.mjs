import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import { scorecardVersion, unitPlan, modelContractPlan, browserPlan, digest, vitestCases, playwrightCases, scoreGroup, unregisteredCriticalFiles } from './quality-scorecard.mjs'
import { accessibilityPlan, scoreAccessibility } from './accessibility-scorecard.mjs'
import { auditAccessibility } from './audit-accessibility.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
const args = process.argv.slice(2)
const browser = args.includes('--browser')
const accessibilityOnly = args.includes('--accessibility-only')
const regressionPlan = [...unitPlan, ...modelContractPlan.unit]
const workflowPlan = [...browserPlan, ...modelContractPlan.browser]
const outputIndex = args.indexOf('--output')
const output = outputIndex >= 0 ? args[outputIndex + 1] : 'test-artifacts/quality/latest.json'
if (!output || output.startsWith('--') || args.filter((arg) => arg === '--output').length > 1
  || (browser && accessibilityOnly)
  || args.some((arg, index) => !['--browser', '--accessibility-only', '--output'].includes(arg) && !(outputIndex >= 0 && index === outputIndex + 1))) {
  throw new Error('Usage: npm run evaluate -- [--browser | --accessibility-only] [--output path.json]')
}
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-') + `-${process.pid}`
const artifacts = resolve('test-artifacts', 'quality', runId)
await mkdir(artifacts, { recursive: true })
const commands = []
function command(script, commandArgs, env = {}) {
  return new Promise((accept, reject) => {
    const start = performance.now()
    const child = spawn(process.execPath, [script, ...commandArgs], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      commands.push({ script, args: commandArgs, exitCode: code, signal, durationMs: performance.now() - start })
      accept(code === 0 && !signal)
    })
  })
}
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim()
async function sourceSnapshot() {
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
  return {
    revision: git('rev-parse', 'HEAD'),
    dirty: !!git('status', '--porcelain', '--untracked-files=normal'),
    worktreeSha256: digest([git('diff', '--binary', 'HEAD', '--'),
      await Promise.all(untracked.map(async (file) => [file, digest((await readFile(file)).toString('base64'))]))]),
  }
}
const source = await sourceSnapshot()
const metrics = []
const errors = []
let server
try {
  const missingCritical = unregisteredCriticalFiles(git('ls-files').split('\n'))
  if (missingCritical.length) throw new Error(`Register critical evaluation files and version the corpus: ${missingCritical.join(', ')}`)
  if (!accessibilityOnly) {
    const ready = await command('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.platform.json'])
      && await command('scripts/build-platform.mjs', [])
    if (!ready) throw new Error('Platform build failed; regression evidence is not assessed')
    const unitFile = resolve(artifacts, 'vitest.json')
    const unitOk = await command('node_modules/vitest/vitest.mjs', [
      'run', ...regressionPlan.flatMap((group) => group.files), '--maxWorkers=2', '--retry=0', '--reporter=json', `--outputFile=${unitFile}`,
    ])
    const unitReport = JSON.parse(await readFile(unitFile, 'utf8'))
    const units = vitestCases(unitReport)
    metrics.push(...regressionPlan.map((group) => scoreGroup(group, units)))
    if (!unitOk || unitReport.success !== true) errors.push('Vitest runner failed (including setup/unhandled errors); gate is blocked even if individual cases passed.')
  }
  if (browser || accessibilityOnly) {
    const { createServer } = await import('vite')
    server = await createServer({ server: {
      host: '127.0.0.1', port: 0,
      watch: { ignored: ['**/test-artifacts/**', '**/test-results/**'] },
    }, clearScreen: false })
    await server.listen()
    if (browser) {
      const browserFile = resolve(artifacts, 'playwright.json')
      const browserOk = await command('node_modules/@playwright/test/cli.js', [
        'test', ...workflowPlan.flatMap((group) => group.files), '--workers=2', '--reporter=json',
        '--output', resolve(artifacts, 'browser'),
      ], { PLAYWRIGHT_BASE_URL: server.resolvedUrls.local[0], PLAYWRIGHT_JSON_OUTPUT_FILE: browserFile })
      const browserReport = JSON.parse(await readFile(browserFile, 'utf8'))
      const browsers = playwrightCases(browserReport)
      metrics.push(...workflowPlan.map((group) => scoreGroup(group, browsers)))
      if (!browserOk || browserReport.errors?.length) errors.push('Playwright runner failed; inspect local report/setup errors.')
    }
    const auditStart = performance.now()
    try {
      metrics.push(scoreAccessibility(await auditAccessibility({ baseURL: server.resolvedUrls.local[0], artifacts })))
    } finally {
      commands.push({ script: 'scripts/audit-accessibility.mjs', args: [],
        durationMs: performance.now() - auditStart, execution: 'in-process; owned Chromium contexts; 45s/state deadline; no retries' })
    }
  } else metrics.push(...workflowPlan.map((group) => scoreGroup(group, [], { completed: false })))
} catch (error) {
  errors.push(error.message)
} finally {
  await server?.close()
}
for (const group of [...regressionPlan, ...workflowPlan]) {
  if (!metrics.some((metric) => metric.id === group.id)) metrics.push(scoreGroup(group, [], { completed: false }))
}
if (!metrics.some(({ id }) => id === accessibilityPlan.id)) metrics.push(scoreAccessibility([], { completed: false }))
const requested = metrics.filter((metric) => accessibilityOnly ? metric.id === accessibilityPlan.id
  : browser || regressionPlan.some((group) => group.id === metric.id))
const gate = errors.length || requested.some((metric) => metric.status === 'failed') ? 'blocked'
  : requested.some((metric) => metric.status !== 'passed') ? 'incomplete' : 'passed-for-requested-subset'
const result = {
  scorecardVersion, planSha256: digest({ unitPlan, modelContractPlan, browserPlan, accessibilityPlan }), runId,
  measuredAt: new Date().toISOString(), source, sourceChangedDuringRun: digest(source) !== digest(await sourceSnapshot()),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  profile: accessibilityOnly ? 'automated-accessibility-only' : browser ? 'unit-scripted-browser-and-accessibility' : 'unit-only',
  overallScore: null, gate, metrics,
  notAssessed: ['Human usability/task efficiency/satisfaction', 'Learning gain/retention/transfer',
    'Expert-reviewed Azure fidelity beyond registered regressions', 'WCAG conformance',
    'Live Azure observations', 'Security certification', 'Packaged Electron and release provenance',
    'Production performance (run measure:production separately; dev timings are not production)'],
  evidenceDirectory: relative(root, artifacts), commands, errors,
  interpretation: 'Only registered regression and model-contract test conformance is scored; document-derived fixtures are not live-Azure-qualified. Accessibility reports sampled rule/node counts and a serious/critical gate, never a percentage. Compare only matching evidence/plan/case versions, profile and environment; never infer WCAG conformance, human usability, learning effectiveness or overall quality.',
}
if (result.sourceChangedDuringRun) {
  result.gate = 'blocked'
  result.errors.push('Source revision changed during evaluation.')
}
await mkdir(dirname(resolve(output)), { recursive: true })
const json = `${JSON.stringify(result, null, 2)}\n`
await writeFile(resolve(artifacts, 'scorecard.json'), json)
await writeFile(output, json)
console.log(JSON.stringify({ output: resolve(output), gate: result.gate, metrics: metrics.map(({ id, score, status, total }) => ({ id, score, status, total })) }, null, 2))
if (result.gate !== 'passed-for-requested-subset') process.exitCode = 1
