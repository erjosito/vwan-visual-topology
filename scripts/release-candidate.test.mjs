import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import childProcess from 'node:child_process'
import { cpSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { candidateVersion, createCandidate, desktopIdentity, guard, preflight, promotionDecision, record, validateArchivePaths, validateRun, verifyCandidate } from './release-candidate.mjs'

const sourceSha = 'a'.repeat(40)
const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: sourceSha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'aznet-release-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = resolve(root, 'input')
  await mkdir(input)
  await writeFile(resolve(input, 'index.html'), '<html>exact tested bytes</html>')
  await writeFile(resolve(input, 'staticwebapp.config.json'), '{"navigationFallback":{"rewrite":"/index.html"}}')
  const directory = resolve(root, 'candidate')
  const manifest = await createCandidate('web', directory, [[input, '']], env)
  return { root, input, directory, manifest }
}

test('candidate preserves exact tested bytes and detects changed, missing and additional files', async (t) => {
  const { directory, manifest } = await fixture(t)
  assert.equal((await verifyCandidate(directory, manifest)).sourceSha, sourceSha)
  const index = resolve(directory, 'payload', 'index.html')
  const original = await readFile(index)
  await writeFile(index, 'different content')
  await assert.rejects(verifyCandidate(directory, manifest), /checksum mismatch/)
  await writeFile(index, original)
  await writeFile(resolve(directory, 'unexpected.txt'), 'extra')
  await assert.rejects(verifyCandidate(directory, manifest), /Unexpected or missing/)
  await rm(resolve(directory, 'unexpected.txt'))
  await rm(index)
  await assert.rejects(verifyCandidate(directory, manifest), /Unexpected or missing/)
})

test('candidate rejects provenance mismatch, missing entry points and empty payloads', async (t) => {
  const { directory, manifest, root } = await fixture(t)
  for (const [field, value] of Object.entries({ repository: 'other/repo', sourceSha: 'b'.repeat(40), runId: '456', runAttempt: 2, target: 'statistics' })) {
    await assert.rejects(verifyCandidate(directory, { ...manifest, [field]: value }), new RegExp(`${field} mismatch`))
  }
  const empty = resolve(root, 'empty')
  await mkdir(empty)
  await assert.rejects(createCandidate('web', resolve(root, 'empty-candidate'), [[empty, '']], env), /Empty candidate/)
  await writeFile(resolve(empty, 'not-index.html'), 'missing entry')
  await assert.rejects(createCandidate('web', resolve(root, 'missing-index'), [[empty, '']], env), /Missing web entry/)
})

test('candidate rejects symbolic links without reading their content', async (t) => {
  const { directory, root, manifest } = await fixture(t)
  const outside = resolve(root, 'outside')
  await mkdir(outside)
  await writeFile(resolve(outside, 'secret'), 'must not enter candidate')
  await symlink(outside, resolve(directory, 'payload', 'link'), 'junction')
  await assert.rejects(verifyCandidate(directory, manifest), /symbolic links/)
})

test('Function package and desktop evidence must match the candidate identity and bytes', async (t) => {
  const { root } = await fixture(t)
  const zip = resolve(root, 'function.zip')
  await writeFile(zip, 'locked Function package')
  await createCandidate('statistics', resolve(root, 'statistics'), [[zip, 'function.zip']], env)
  const cloudDirectory = resolve(root, 'user-cloud')
  const cloud = await createCandidate('user-cloud', cloudDirectory, [[zip, 'function.zip']], env)
  assert.equal((await verifyCandidate(cloudDirectory, cloud)).target, 'user-cloud')
  await assert.rejects(verifyCandidate(cloudDirectory, { ...cloud, target: 'statistics' }), /target mismatch/)
  await assert.rejects(createCandidate('user-cloud', resolve(root, 'bad-cloud'), [[zip, 'other.zip']], env), /Unexpected Function package/)
  await writeFile(resolve(cloudDirectory, 'payload', 'function.zip'), 'changed cloud package')
  await assert.rejects(verifyCandidate(cloudDirectory, cloud), /checksum mismatch/)
  const version = candidateVersion(new Date('2026-11-17T23:59:59Z'), '789')
  const installer = resolve(root, `Azure-Network-Simulator-${version.build}-x64.exe`)
  await writeFile(installer, 'tested installer')
  const evidence = resolve(root, 'installer-sha256.json')
  await writeFile(evidence, JSON.stringify({ Path: installer, Hash: hash('tested installer').toUpperCase() }))
  const versions = resolve(root, 'version-checks.json')
  await writeFile(versions, JSON.stringify({ fileVersion: version.build, productVersion: `${version.package}.0`, runtimeVersion: version.package,
    buildVersion: version.build, packageVersion: version.package }))
  const inputs = [[installer, installer.split(/[\\/]/).at(-1)], [evidence, 'installer-sha256.json'], [versions, 'version-checks.json']]
  const desktopEnv = { ...env, CANDIDATE_VERSION: version.build, CANDIDATE_PACKAGE_VERSION: version.package }
  await createCandidate('desktop', resolve(root, 'desktop'), inputs, desktopEnv)
  await writeFile(evidence, JSON.stringify({ Path: installer, Hash: '0'.repeat(64) }))
  await assert.rejects(createCandidate('desktop', resolve(root, 'bad-desktop'), inputs, desktopEnv), /checksum evidence mismatch/)
  await writeFile(evidence, JSON.stringify({ Path: installer, Hash: hash('tested installer') }))
  await writeFile(versions, JSON.stringify({ fileVersion: '2026.11.17.1', productVersion: version.package }))
  await assert.rejects(createCandidate('desktop', resolve(root, 'bad-version'), inputs, desktopEnv), /version evidence mismatch/)
  await writeFile(versions, JSON.stringify({ fileVersion: version.build, productVersion: `${version.package}.0`, runtimeVersion: '0.0.0',
    buildVersion: version.build, packageVersion: version.package }))
  await assert.rejects(createCandidate('desktop', resolve(root, 'bad-runtime'), inputs, desktopEnv), /version evidence mismatch/)
})

test('desktop CI identities need no source version bump and fail closed at Windows limits', () => {
  assert.deepEqual(candidateVersion(new Date('2027-01-03T00:00:00Z'), '41'), { build: '2027.01.03.41', package: '2027.1.3' })
  assert.notEqual(candidateVersion(new Date('2027-01-03T00:00:00Z'), '41').build, candidateVersion(new Date('2027-01-03T00:00:00Z'), '42').build)
  for (const value of ['0', '-1', '65536', '1\nbad', undefined]) {
    assert.throws(() => candidateVersion(new Date(), value), /Windows version bounds/)
  }
  const runs = [
    { id: 1, run_number: 799, created_at: '2026-11-16T23:59:59Z' },
    { id: 2, run_number: 800, created_at: '2026-11-17T00:00:00Z' },
    { id: 3, run_number: 801, created_at: '2026-11-17T00:02:00Z' },
  ]
  assert.equal(desktopIdentity(runs[1], runs).build, '2026.11.17.1')
  assert.equal(desktopIdentity(runs[2], runs).build, '2026.11.17.2')
  assert.equal(desktopIdentity({ ...runs[2], run_attempt: 2 }, runs).build, '2026.11.17.2')
  assert.throws(() => desktopIdentity(runs[2], []), /missing from daily history/)
})

test('user-cloud staging preserves the built entry and locked runtime files without test fixtures', async (t) => {
  const { root } = await fixture(t)
  const output = resolve(root, 'staged-cloud')
  childProcess.execFileSync(process.execPath, ['scripts/package-user-cloud-function.mjs', '--output', output])
  for (const file of ['package.json', 'package-lock.json', 'host.json', 'dist/index.mjs']) {
    assert.deepEqual(await readFile(resolve(output, file)), await readFile(resolve('functions/user-cloud', file)))
  }
  const staged = JSON.parse(await readFile(resolve(output, 'package.json'), 'utf8'))
  await readFile(resolve(output, staged.main))
  await assert.rejects(readFile(resolve(output, 'tests/user-cloud-fixture.ts')), { code: 'ENOENT' })
  assert.throws(() => childProcess.execFileSync(process.execPath, ['scripts/package-user-cloud-function.mjs', '--output', output], { stdio: 'pipe' }))
})

function runFixture() {
  return {
    run: { id: 123, repository: { full_name: 'owner/repo' }, head_repository: { full_name: 'owner/repo' },
      workflow_id: 7, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main',
      status: 'completed', conclusion: 'success', head_sha: sourceSha },
    jobs: ['validate', 'desktop'].map((name) => ({ name, conclusion: 'success', status: 'completed' })),
  }
}

test('promotion accepts only a successful exact-main CI run with both required jobs', () => {
  const { run, jobs } = runFixture()
  validateRun(run, jobs, 7, 'owner/repo')
  for (const change of [
    { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'feature' },
    { workflow_id: 99 }, { path: '.github/workflows/other.yml' }, { conclusion: 'failure' },
    { conclusion: 'cancelled' }, { status: 'in_progress' }, { head_sha: 'main' },
    { repository: { full_name: 'other/repo' } }, { head_repository: { full_name: 'fork/repo' } },
  ]) {
    assert.throws(() => validateRun({ ...run, ...change }, jobs, 7, 'owner/repo'))
  }
  for (const conclusion of ['skipped', 'failure', 'cancelled', null]) {
    assert.throws(() => validateRun(run, [jobs[0], { ...jobs[1], conclusion }], 7, 'owner/repo'), /Required CI job/)
  }
  assert.throws(() => validateRun(run, [jobs[0]], 7, 'owner/repo'), /Required CI job/)
  assert.throws(() => validateRun(run, [...jobs, jobs[0]], 7, 'owner/repo'), /Required CI job/)
})

test('artifact extraction rejects absolute, traversal and Windows-special paths', () => {
  validateArchivePaths(['manifest.json', 'payload/', 'payload/assets/app.js'])
  for (const path of ['../outside', '/absolute', 'payload/../../escape', 'C:/escape', 'payload\\escape', 'payload/./file']) {
    assert.throws(() => validateArchivePaths([path]), /Unsafe/)
  }
  assert.throws(() => validateArchivePaths([]), /Empty/)
})

test('promotion ordering rejects stale/divergent bytes and treats an exact retry as a no-op', () => {
  const candidate = { target: 'web', runId: '123', runAttempt: 1, archiveSha256: 'a'.repeat(64) }
  const previous = { ...candidate, runId: '122', archiveSha256: 'b'.repeat(64) }
  assert.equal(promotionDecision(candidate, [], false, null), false)
  assert.equal(promotionDecision(candidate, [previous], false, 'ahead'), false)
  assert.equal(promotionDecision(candidate, [candidate], false, 'identical'), true)
  for (const relation of ['behind', 'diverged', undefined]) {
    assert.throws(() => promotionDecision(candidate, [previous], false, relation), /Stale or divergent/)
  }
  assert.throws(() => promotionDecision(candidate, [previous], false, 'identical'), /different bytes/)
})

test('rollback requires the exact previously released run, attempt and archive', () => {
  const candidate = { target: 'statistics', runId: '123', runAttempt: 1, archiveSha256: 'a'.repeat(64) }
  const current = { ...candidate, runId: '124', archiveSha256: 'b'.repeat(64) }
  assert.equal(promotionDecision(candidate, [current, candidate], true, 'behind'), false)
  assert.equal(promotionDecision(candidate, [candidate], true, 'identical'), true)
  assert.throws(() => promotionDecision(candidate, [current], true, 'behind'), /previously released exact/)
  assert.throws(() => promotionDecision({ ...candidate, runAttempt: 2 }, [candidate], true, 'identical'), /previously released exact/)
  assert.throws(() => promotionDecision({ ...candidate, target: 'desktop' }, [candidate], true, 'identical'), /explicit reinstall/)
})

function fakeGitHub(t, candidateDirectory, overrides = {}) {
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY']
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '900', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' })
  const archive = Buffer.from('exact GitHub artifact ZIP bytes')
  const { run, jobs } = runFixture()
  run.run_attempt = 1
  const artifact = { id: 33, name: 'static-site-1', expired: false, digest: `sha256:${hash(archive)}` }
  const calls = []
  const transport = mock.method(childProcess, 'execFileSync', (command, args) => {
    calls.push([command, ...args])
    if (command === 'unzip') {
      if (args[0] === '-Z1') return 'manifest.json\npayload/index.html\npayload/staticwebapp.config.json\n'
      assert.equal(args[0], '-q')
      cpSync(candidateDirectory, args[3], { recursive: true })
      return Buffer.alloc(0)
    }
    assert.equal(command, 'gh')
    if (args[0] === 'api' && args.includes('--method') && overrides.createRelease) return overrides.createRelease(args)
    if (args[0] === 'release' && overrides.writeRelease) return overrides.writeRelease(args)
    assert.equal(args[0], 'api', 'Preflight/guard must never publish or deploy')
    const path = args.at(-1)
    if (args[1]?.includes('/actions/artifacts/33/zip')) return overrides.archive ?? archive
    if (args[1]?.includes('/releases/assets/44')) return archive
    let response
    if (path.endsWith('/actions/runs/123/attempts/1')) response = overrides.run ?? run
    else if (path.endsWith('/actions/workflows/ci.yml')) response = { id: 7 }
    else if (path.endsWith('/attempts/1/jobs?per_page=100')) response = [{ jobs: overrides.jobs ?? jobs }]
    else if (path.endsWith(`/compare/${sourceSha}...main`)) response = { status: overrides.ancestry ?? 'ahead' }
    else if (path.endsWith(`/compare/${sourceSha}...${sourceSha}`)) response = { status: 'identical' }
    else if (path.endsWith('/actions/runs/123/artifacts?per_page=100')) response = [{ artifacts: overrides.artifacts ?? [artifact] }]
    else if (path.endsWith('/releases?per_page=100')) response = [overrides.releases ?? []]
    else assert.fail(`Unexpected GitHub request: ${args.join(' ')}`)
    return JSON.stringify(response)
  })
  syncBuiltinESMExports()
  t.after(() => {
    transport.mock.restore()
    syncBuiltinESMExports()
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  return { calls, archive, artifact }
}

test('hosted preflight pins the run/attempt while main advances, and is read-only', async (t) => {
  const { directory, root } = await fixture(t)
  const { calls, archive } = fakeGitHub(t, directory)
  const ready = resolve(root, 'ready')
  await preflight('web', '123', ready, '1')
  const receipt = JSON.parse(await readFile(resolve(ready, 'receipt.json'), 'utf8'))
  assert.equal(receipt.sourceSha, sourceSha)
  assert.equal(receipt.runAttempt, 1)
  assert.equal(receipt.archiveSha256, hash(archive))
  await guard(ready, false)
  assert.ok(calls.some((call) => call.includes('repos/owner/repo/actions/runs/123/attempts/1')))
  assert.ok(calls.every((call) => call[0] === 'unzip' || (call[0] === 'gh' && call[1] === 'api')))
})

test('hosted preflight rejects invalid IDs, failed jobs, missing/expired candidates and archive tampering', async (t) => {
  const cases = [
    { overrides: { jobs: [] }, message: /Required CI job/ },
    { overrides: { ancestry: 'diverged' }, message: /not on main/ },
    { overrides: { artifacts: [] }, message: /expired or missing/ },
    { overrides: { artifacts: [{ name: 'static-site-1', expired: true }] }, message: /expired or missing/ },
    { overrides: { artifacts: [{ name: 'static-site-2', expired: false }] }, message: /expired or missing/ },
    { overrides: { artifacts: [{ name: 'static-site-1' }, { name: 'static-site-1' }] }, message: /Ambiguous candidate/ },
    { overrides: { artifacts: [{ name: 'static-site-1', expired: false }] }, message: /Missing GitHub artifact digest/ },
    { overrides: { archive: Buffer.from('altered archive') }, message: /archive digest mismatch/ },
  ]
  for (const { overrides, message } of cases) {
    await t.test(message.source, async (t) => {
      const { directory, root } = await fixture(t)
      fakeGitHub(t, directory, overrides)
      await assert.rejects(preflight('web', '123', resolve(root, 'ready'), '1'), message)
    })
  }
  await assert.rejects(preflight('web', '123; bad', 'unused', '1'), /numeric CI run/)
})

test('expired CI artifacts recover only from a published matching release archive; unresolved drafts block promotion', async (t) => {
  const { directory, root, manifest } = await fixture(t)
  const archiveSha256 = hash('exact GitHub artifact ZIP bytes')
  const record = { ...manifest, archiveSha256 }
  const published = { id: 2, tag_name: 'promotion-web-800', draft: false, body: JSON.stringify(record),
    published_at: '2026-11-17T12:00:00Z', assets: [{ id: 44, name: 'candidate.zip' }] }
  const pending = { id: 3, tag_name: 'promotion-web-899', draft: true, body: JSON.stringify(record), assets: [] }
  fakeGitHub(t, directory, { artifacts: [], releases: [pending, published] })
  const ready = resolve(root, 'ready')
  await preflight('web', '123', ready, '1')
  assert.equal(hash(await readFile(resolve(ready, 'candidate.zip'))), archiveSha256)
  await assert.rejects(guard(ready, false), /Unresolved promotion draft/)
  const recovery = await guard(ready, true)
  assert.equal(recovery.noOp, false, 'An unresolved deployment must not turn a known-good rollback into a no-op')
})

function releaseStore() {
  const releases = []
  let failUpload = false
  const create = (tag, body) => {
    assert.ok(!releases.some((entry) => entry.tag_name === tag))
    const release = { id: releases.length + 1, tag_name: tag, draft: true, assets: [], body }
    releases.push(release)
    return release
  }
  const createRelease = (args) => {
    assert.equal(args[args.indexOf('--method') + 1], 'POST')
    assert.ok(args.includes('draft=true'))
    assert.ok(args.includes(`target_commitish=${sourceSha}`))
    const field = (name) => args.find((value) => value.startsWith(`${name}=`)).slice(name.length + 1)
    return JSON.stringify(create(field('tag_name'), field('body')))
  }
  const writeRelease = (args) => {
    const [, command, tag] = args
    assert.ok(!args.includes('--clobber'))
    const release = releases.find((entry) => entry.tag_name === tag)
    if (command === 'upload') {
      assert.equal(release.draft, true)
      const path = args[3]
      const name = path.split(/[\\/]/).at(-1)
      assert.ok(!release.assets.some((asset) => asset.name === name))
      if (failUpload && name === 'record.json') {
        failUpload = false
        throw new Error('Simulated asset upload interruption')
      }
      release.assets.push({ name, digest: `sha256:${hash(readFileSync(path))}` })
    } else if (command === 'edit') {
      assert.ok(args.includes('--draft=false'))
      assert.ok(args.includes('--prerelease'))
      release.draft = false
      release.published_at = '2026-11-17T15:00:00Z'
    } else assert.fail(`Unexpected release command: ${command}`)
    return Buffer.alloc(0)
  }
  return { releases, createRelease, writeRelease, interruptUpload: () => { failUpload = true } }
}

test('new draft uses its returned identity even when the release list does not expose it yet', async (t) => {
  const { directory, root } = await fixture(t)
  const store = releaseStore()
  const { calls } = fakeGitHub(t, directory, {
    ...store,
    get releases() { return [] },
  })
  const ready = resolve(root, 'ready')
  await preflight('web', '123', ready, '1')
  await record(ready, false, true)
  assert.equal(store.releases.length, 1)
  assert.equal(store.releases[0].draft, true)
  assert.deepEqual(store.releases[0].assets.map((asset) => asset.name), ['candidate.zip', 'record.json'])
  assert.equal(calls.filter((call) => call.includes('POST')).length, 1)
})

test('unreadable or conflicting creation responses preserve the draft and fail before asset writes', async (t) => {
  const cases = [
    { mutate: () => '', message: /Cannot resolve created release/ },
    { mutate: () => '{}', message: /Cannot resolve created release/ },
    { mutate: (release) => JSON.stringify({ ...release, tag_name: 'another-tag' }), message: /Cannot resolve created release/ },
    { mutate: (release) => JSON.stringify({ ...release, body: 'unreadable' }), message: /Release identity is unreadable/ },
    { mutate: (release) => JSON.stringify({ ...release, body: JSON.stringify({ ...JSON.parse(release.body), archiveSha256: '0'.repeat(64) }) }),
      message: /Release identity already exists with different bytes/ },
  ]
  for (const { mutate, message } of cases) {
    await t.test(message.source, async (t) => {
      const { directory, root } = await fixture(t)
      const store = releaseStore()
      const { calls } = fakeGitHub(t, directory, { ...store, createRelease: (args) => mutate(JSON.parse(store.createRelease(args))) })
      const ready = resolve(root, 'ready')
      await preflight('web', '123', ready, '1')
      await assert.rejects(record(ready, false, true), message)
      assert.equal(store.releases.length, 1)
      assert.equal(store.releases[0].draft, true)
      assert.deepEqual(store.releases[0].assets, [])
      assert.equal(calls.filter((call) => call.includes('POST')).length, 1)
      assert.ok(!calls.some((call) => call.includes('upload') || call.includes('edit') || call.includes('delete')))
    })
  }
})

test('promotion reserves a draft before side effects, publishes after success, and never overwrites a retry', async (t) => {
  const { directory, root } = await fixture(t)
  const store = releaseStore()
  const { calls } = fakeGitHub(t, directory, store)
  const ready = resolve(root, 'ready')
  await preflight('web', '123', ready, '1')
  await record(ready, false, true)
  assert.equal(store.releases.length, 1)
  assert.equal(store.releases[0].draft, true)
  await guard(ready, false)
  await record(ready, false)
  assert.equal(store.releases[0].draft, false)
  const writes = calls.filter((call) => call[1] === 'release').length
  await record(ready, false)
  assert.equal(calls.filter((call) => call[1] === 'release').length, writes)
  store.releases[0].assets[0].digest = `sha256:${'0'.repeat(64)}`
  await assert.rejects(record(ready, false), /Published asset checksum mismatch/)
})

test('interrupted receipt upload is recoverable by the original run without replacing existing assets', async (t) => {
  const { directory, root } = await fixture(t)
  const store = releaseStore()
  fakeGitHub(t, directory, store)
  const ready = resolve(root, 'ready')
  await preflight('web', '123', ready, '1')
  store.interruptUpload()
  await assert.rejects(record(ready, false, true), /upload interruption/)
  assert.deepEqual(store.releases[0].assets.map((asset) => asset.name), ['candidate.zip'])
  await guard(ready, false)
  await record(ready, false, true)
  assert.deepEqual(store.releases[0].assets.map((asset) => asset.name), ['candidate.zip', 'record.json'])
  await record(ready, false)
  assert.equal(store.releases[0].draft, false)
})
