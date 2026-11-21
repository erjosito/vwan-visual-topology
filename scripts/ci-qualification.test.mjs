import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { aggregate, browserCases, prepareBuild, recordPhase, recordShard, verifyBuild } from './ci-qualification.mjs'

const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' }
const needs = Object.fromEntries(['web-build', 'collectors', 'browser', 'production'].map(name => [name, { result: 'success' }]))
const report = (id, current, status = 'passed') => ({ config: { shard: current ? { current, total: 4 } : null },
  errors: [], suites: [{ specs: [{ id, tests: [{ projectName: 'chromium', expectedStatus: 'passed',
    results: current ? [{ status }] : [] }] }] }] })
const save = (path, value) => writeFile(path, JSON.stringify(value))

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'aznet-qualification-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const folder of ['dist', 'platform-dist', 'functions/user-cloud/dist', 'test-artifacts/ci']) {
    await mkdir(resolve(root, folder), { recursive: true })
  }
  for (const folder of ['dist', 'platform-dist', 'functions/user-cloud/dist']) await writeFile(resolve(root, folder, 'entry.js'), 'exact built bytes')
  const plan = report('case-1')
  plan.suites.push(...[2, 3, 4].map(current => report(`case-${current}`).suites[0]))
  await save(resolve(root, 'test-artifacts/ci/browser-plan.json'), plan)
  await prepareBuild(root, env)
  await recordPhase(root, env, 'collectors')
  await recordPhase(root, env, 'production')
  for (let current = 1; current <= 4; current++) {
    const directory = resolve(root, 'test-artifacts/ci/shards', String(current))
    await mkdir(directory, { recursive: true })
    await save(resolve(directory, 'report.json'), report(`case-${current}`, current))
    await recordShard(root, env, current)
  }
  return root
}

test('complete exact-source shards qualify; changed build bytes and cross-run/attempt inputs do not', async t => {
  const root = await fixture(t)
  assert.equal((await aggregate(root, env, needs)).cases, 4)
  for (const [key, value] of Object.entries({ GITHUB_REPOSITORY: 'other/repo', GITHUB_SHA: 'b'.repeat(40),
    GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '2' })) {
    await assert.rejects(verifyBuild(root, { ...env, [key]: value }), /mismatch/)
  }
  await writeFile(resolve(root, 'dist/entry.js'), 'rebuilt or changed bytes')
  await assert.rejects(aggregate(root, env, needs), /checksum mismatch/)
})

test('failed, skipped, cancelled and missing prerequisite jobs fail the release aggregate', async t => {
  const root = await fixture(t)
  for (const job of Object.keys(needs)) for (const result of ['failure', 'skipped', 'cancelled', undefined]) {
    await assert.rejects(aggregate(root, env, { ...needs, [job]: result ? { result } : undefined }), /did not pass/)
  }
  await recordPhase(root, { ...env, GITHUB_RUN_ATTEMPT: '2' }, 'collectors')
  await assert.rejects(aggregate(root, env, needs), /Mismatched collectors/)
  await rm(resolve(root, 'test-artifacts/ci/phases/collectors.json'))
  await assert.rejects(aggregate(root, env, needs), /ENOENT/)
})

test('missing, duplicated, omitted, extra and wrong-identity shard cases cannot qualify', async t => {
  const root = await fixture(t), directory = resolve(root, 'test-artifacts/ci/shards/4')
  await save(resolve(directory, 'report.json'), report('case-3', 4))
  await recordShard(root, env, 4)
  await assert.rejects(aggregate(root, env, needs), /omitted, duplicated or added/)
  await save(resolve(directory, 'report.json'), report('unregistered-case', 4))
  await recordShard(root, env, 4)
  await assert.rejects(aggregate(root, env, needs), /omitted, duplicated or added/)
  await save(resolve(directory, 'report.json'), report('case-4', 1))
  await assert.rejects(recordShard(root, env, 4), /identity mismatch/)
  await rm(directory, { recursive: true })
  await assert.rejects(aggregate(root, env, needs), /Missing or unexpected/)
})

test('failed/skipped/interrupted or raw-less/tampered evidence fails; existing successful retries remain visible', async t => {
  const root = await fixture(t), directory = resolve(root, 'test-artifacts/ci/shards/4')
  for (const status of ['failed', 'skipped', 'interrupted']) {
    await save(resolve(directory, 'report.json'), report('case-4', 4, status))
    await assert.rejects(recordShard(root, env, 4), /did not pass/)
  }
  const retry = report('case-4', 4)
  retry.suites[0].specs[0].tests[0].results.unshift({ status: 'failed' })
  await save(resolve(directory, 'report.json'), retry)
  await recordShard(root, env, 4)
  assert.equal((await aggregate(root, env, needs)).cases, 4)
  const receipt = JSON.parse(await readFile(resolve(directory, 'receipt.json')))
  receipt.runAttempt = '2'
  await save(resolve(directory, 'receipt.json'), receipt)
  await assert.rejects(aggregate(root, env, needs), /Mismatched/)
  await rm(resolve(directory, 'report.json'))
  await assert.rejects(aggregate(root, env, needs), /ENOENT/)
  assert.throws(() => browserCases({ suites: [], errors: [] }), /Empty/)
})
