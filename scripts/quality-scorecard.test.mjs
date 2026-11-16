import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { scoreGroup, vitestCases, playwrightCases, unregisteredCriticalFiles } from './quality-scorecard.mjs'

const plan = { id: 'example', label: 'Example', files: ['src/example.test.ts'] }
const item = (name, outcome) => ({ name, outcome, durationMs: 1, file: 'C:\\repo\\src\\example.test.ts'.replaceAll('\\', '/') })

test('new learning safety and practice workflows cannot silently escape the versioned benchmark', () => {
  assert.deepEqual(unregisteredCriticalFiles([
    'src/learning/runner.test.ts', 'e2e/learning.spec.ts', 'e2e/practice-workspace.spec.ts',
    'src\\learning\\new-safety.test.ts', 'e2e/learning-new.spec.ts', 'src/unrelated.test.ts',
  ]), ['src/learning/new-safety.test.ts', 'e2e/learning-new.spec.ts'])
  const tracked = execFileSync('git', ['ls-files'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim().split('\n')
  assert.deepEqual(unregisteredCriticalFiles(tracked), [], 'Register new critical contracts and bump the manifest version')
})

test('missing files and empty/setup-only reports cannot score 100', () => {
  assert.equal(scoreGroup(plan, []).score, null)
  assert.equal(scoreGroup({ ...plan, files: [...plan.files, 'missing.ts'] }, [item('one', 'passed')]).score, null)
  assert.equal(scoreGroup(plan, [item('one', 'passed')], { completed: false }).status, 'not-assessed')
})

test('model-contract qualification survives scoring and never supplies credit for missing evidence', () => {
  const documentDerived = { ...plan, qualification: 'Synthetic, not live-Azure-qualified' }
  assert.equal(scoreGroup(documentDerived, [item('one', 'passed')]).qualification, documentDerived.qualification)
  assert.equal(scoreGroup(documentDerived, []).score, null)
})

test('failures, skipped and flaky cases remain in denominator and identities constrain comparison', () => {
  const result = scoreGroup(plan, [item('one', 'passed'), item('two', 'failed'), item('three', 'skipped'), item('four', 'flaky')])
  assert.equal(result.score, 25)
  assert.equal(result.total, 4)
  assert.equal(result.status, 'failed')
  assert.equal(scoreGroup(plan, [item('one', 'flaky')]).status, 'partial')
  assert.notEqual(result.caseSetSha256, scoreGroup(plan, [item('one', 'passed')]).caseSetSha256)
  assert.throws(() => scoreGroup(plan, [item('same', 'passed'), item('same', 'passed')]), /Duplicate/)
})

test('Vitest adapter normalizes Windows paths and preserves skipped/failing cases', () => {
  const cases = vitestCases({ testResults: [{ name: 'C:\\repo\\src\\example.test.ts', assertionResults: [
    { fullName: 'one', status: 'passed' }, { fullName: 'two', status: 'pending' }, { fullName: 'three', status: 'failed' },
  ] }] })
  assert.equal(scoreGroup(plan, cases).score, 33.33)
  assert.throws(() => vitestCases({}), /Invalid/)
})

test('Playwright retries and expected failures never become first-attempt passes', () => {
  const cases = playwrightCases({ config: { rootDir: 'C:/repo' }, suites: [{ title: 'file', suites: [{ title: 'group', specs: [
    { file: 'src/example.test.ts', title: 'flaky', tests: [{ projectName: 'chromium', expectedStatus: 'passed', results: [
      { status: 'failed', duration: 2 }, { status: 'passed', duration: 3 },
    ] }] },
    { file: 'src/example.test.ts', title: 'known failure', tests: [{ expectedStatus: 'failed', results: [{ status: 'failed' }] }] },
    { file: 'src/example.test.ts', title: 'timeout', tests: [{ expectedStatus: 'passed', results: [{ status: 'timedOut' }] }] },
  ] }] }] })
  assert.deepEqual(cases.map((entry) => entry.outcome), ['flaky', 'skipped', 'failed'])
  assert.equal(cases[0].durationMs, 5)
  assert.equal(scoreGroup(plan, cases).score, 0)
  assert.throws(() => playwrightCases({}), /Invalid/)
})
