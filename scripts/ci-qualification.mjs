import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filesIn } from './release-candidate.mjs'

export const shardCount = 4
const manifestPath = 'test-artifacts/ci/build-inputs.json'
const planPath = 'test-artifacts/ci/browser-plan.json'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

function identity(env) {
  requireValue(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(env.GITHUB_REPOSITORY ?? '')
    && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
    && /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '')
    && /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'Missing qualification provenance')
  return { repository: env.GITHUB_REPOSITORY, sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }
}

async function buildFiles(root) {
  const entries = await Promise.all(['dist', 'platform-dist', 'functions/user-cloud/dist'].map(async folder => {
    const files = await filesIn(resolve(root, folder))
    requireValue(Object.keys(files).length, `Empty build input: ${folder}`)
    return Object.fromEntries(Object.entries(files).map(([file, hash]) => [`${folder}/${file}`, hash]))
  }))
  return Object.assign({}, ...entries, { [planPath]: sha256(await readFile(resolve(root, planPath))) })
}

export function browserCases(report, completed = false) {
  requireValue(Array.isArray(report.suites) && !report.errors?.length, 'Invalid or failed browser report')
  const cases = []
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      requireValue(spec.id && test.projectName && test.expectedStatus === 'passed', 'Invalid or skipped required browser case')
      if (completed) requireValue(test.results?.length && test.results.at(-1).status === 'passed',
        `Required browser case did not pass: ${spec.id}`)
      cases.push(`${spec.id}:${test.projectName}`)
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  report.suites.forEach(visit)
  requireValue(cases.length && new Set(cases).size === cases.length, 'Empty or duplicated browser case inventory')
  return cases
}

export async function prepareBuild(root, env) {
  const plan = await json(resolve(root, planPath))
  requireValue(!plan.config?.shard, 'The browser inventory must be unsharded')
  browserCases(plan)
  const manifest = { schema: 1, ...identity(env), files: await buildFiles(root) }
  await save(resolve(root, manifestPath), manifest)
  return manifest
}

export async function verifyBuild(root, env) {
  const manifest = await json(resolve(root, manifestPath))
  requireValue(manifest.schema === 1, 'Unknown build-input schema')
  for (const [key, value] of Object.entries(identity(env))) {
    requireValue(manifest[key] === value, `Build-input ${key} mismatch; rerun all web qualification jobs`)
  }
  requireValue(JSON.stringify(manifest.files) === JSON.stringify(await buildFiles(root)), 'Build-input checksum mismatch')
  return manifest
}

async function shardReceipt(root, env, current) {
  requireValue(Number.isInteger(current) && current >= 1 && current <= shardCount, 'Unknown browser shard')
  await verifyBuild(root, env)
  const directory = resolve(root, 'test-artifacts/ci/shards', String(current))
  const bytes = await readFile(resolve(directory, 'report.json'))
  const report = JSON.parse(bytes)
  requireValue(report.config?.shard?.current === current && report.config.shard.total === shardCount, 'Browser shard identity mismatch')
  const cases = browserCases(report, true)
  return { schema: 1, ...identity(env), current, total: shardCount,
    buildSha256: sha256(await readFile(resolve(root, manifestPath))), reportSha256: sha256(bytes), cases }
}

export async function recordShard(root, env, current) {
  const receipt = await shardReceipt(root, env, current)
  await save(resolve(root, 'test-artifacts/ci/shards', String(current), 'receipt.json'), receipt)
  return receipt
}

export function verifyPrerequisites(needs) {
  for (const name of ['web-build', 'collectors', 'browser', 'production']) {
    requireValue(needs[name]?.result === 'success', `Required qualification job did not pass: ${name}`)
  }
}

function phaseReceipt(env, phase, buildSha256) {
  requireValue(['collectors', 'production'].includes(phase), 'Unknown qualification phase')
  return { schema: 1, ...identity(env), phase, ...(phase === 'production' ? { buildSha256 } : {}) }
}

export async function recordPhase(root, env, phase) {
  if (phase === 'production') await verifyBuild(root, env)
  const receipt = phaseReceipt(env, phase, phase === 'production' ? sha256(await readFile(resolve(root, manifestPath))) : undefined)
  const directory = resolve(root, 'test-artifacts/ci/phases')
  await mkdir(directory, { recursive: true })
  await save(resolve(directory, `${phase}.json`), receipt)
}

export async function aggregate(root, env, needs) {
  verifyPrerequisites(needs)
  await verifyBuild(root, env)
  const buildSha256 = sha256(await readFile(resolve(root, manifestPath)))
  for (const phase of ['collectors', 'production']) {
    const receipt = await json(resolve(root, 'test-artifacts/ci/phases', `${phase}.json`))
    requireValue(JSON.stringify(receipt) === JSON.stringify(phaseReceipt(env, phase, buildSha256)),
      `Mismatched ${phase} phase evidence; rerun all web qualification jobs`)
  }
  const directory = resolve(root, 'test-artifacts/ci/shards')
  requireValue(JSON.stringify((await readdir(directory)).sort()) === JSON.stringify(['1', '2', '3', '4']), 'Missing or unexpected browser shards')
  const expected = browserCases(await json(resolve(root, planPath)))
  const actual = []
  for (let current = 1; current <= shardCount; current++) {
    const receipt = await json(resolve(directory, String(current), 'receipt.json'))
    const fresh = await shardReceipt(root, env, current)
    requireValue(JSON.stringify(receipt) === JSON.stringify(fresh), 'Mismatched browser shard evidence')
    actual.push(...fresh.cases)
  }
  requireValue(new Set(actual).size === actual.length
    && JSON.stringify(actual.sort()) === JSON.stringify(expected.sort()), 'Browser shards omitted, duplicated or added required cases')
  return { ...identity(env), shards: shardCount, cases: actual.length }
}

async function main() {
  const env = process.env, root = process.cwd(), [command, current] = process.argv.slice(2)
  requireValue(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === env.GITHUB_SHA, 'Checkout source mismatch')
  if (command === 'prerequisites') verifyPrerequisites(JSON.parse(env.CI_QUALIFICATION_NEEDS))
  else if (command === 'prepare-build') await prepareBuild(root, env)
  else if (command === 'verify-build') await verifyBuild(root, env)
  else if (command === 'record-shard') await recordShard(root, env, Number(current))
  else if (command === 'record-phase') await recordPhase(root, env, current)
  else if (command === 'aggregate') console.log(JSON.stringify(await aggregate(root, env, JSON.parse(env.CI_QUALIFICATION_NEEDS)), null, 2))
  else throw new Error('Usage: ci-qualification.mjs prerequisites | prepare-build | verify-build | record-shard N | record-phase collectors/production | aggregate')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
