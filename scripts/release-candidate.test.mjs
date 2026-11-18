import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import childProcess from 'node:child_process'
import { cpSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { artifacts, candidateVersion, createCandidate, guard, preflight, promotionDecision, record, validateArchivePaths, validateRun, verifyCandidate } from './release-candidate.mjs'
import { checkUserCloud } from './check-user-cloud.mjs'

const sourceSha = 'a'.repeat(40)
const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: sourceSha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('cloud release probe rejects unregistered endpoints and broken browser write preflight', async () => {
  const origin = 'https://app.test', base = 'https://api.test/api/cloud'
  const reply = async (_url, init) => init.method === 'OPTIONS'
    ? new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': init.headers['Access-Control-Request-Headers'] } })
    : new Response('{"error":"Sign in again."}', { status: 401, headers: {
      'WWW-Authenticate': 'Bearer', 'Access-Control-Allow-Origin': origin } })
  await checkUserCloud(base, origin, reply)
  await assert.rejects(checkUserCloud(base, origin, async () => new Response(null, { status: 404 })), /authentication route/)
  await assert.rejects(checkUserCloud(base, origin, async (url, init) =>
    init.method === 'OPTIONS' ? new Response(null, { status: 204 }) : reply(url, init)), /write preflight/)
})

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

async function desktopFixture(root, legacy = false) {
  const version = legacy ? { build: '2026.11.17.789', package: '2026.11.17', file: '2026.11.17.789' } : candidateVersion('0.1.0')
  const installer = resolve(root, `Azure-Network-Simulator-${version.build}-x64.exe`)
  await writeFile(installer, 'tested installer')
  const evidence = resolve(root, 'installer-sha256.json')
  await writeFile(evidence, JSON.stringify({ Path: installer, Hash: hash('tested installer').toUpperCase() }))
  const versions = resolve(root, 'version-checks.json')
  await writeFile(versions, JSON.stringify({ fileVersion: version.file, productVersion: `${version.package}.0`, runtimeVersion: version.package,
    buildVersion: version.build, packageVersion: version.package }))
  const inputs = [[installer, installer.split(/[\\/]/).at(-1)], [evidence, 'installer-sha256.json'], [versions, 'version-checks.json']]
  const desktopEnv = { ...env, CANDIDATE_VERSION: version.build, CANDIDATE_PACKAGE_VERSION: version.package }
  const directory = resolve(root, 'desktop')
  let manifest
  if (legacy) {
    await mkdir(resolve(directory, 'payload'), { recursive: true })
    const files = {}
    for (const [source, name] of inputs.sort((a, b) => a[1].localeCompare(b[1]))) {
      const bytes = await readFile(source)
      await writeFile(resolve(directory, 'payload', name), bytes)
      files[name] = hash(bytes)
    }
    manifest = { schema: 1, target: 'desktop', repository: env.GITHUB_REPOSITORY, sourceSha, runId: env.GITHUB_RUN_ID,
      runAttempt: 1, version: version.build, packageVersion: version.package, files }
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest))
  } else manifest = await createCandidate('desktop', directory, inputs, desktopEnv)
  return { version, installer, evidence, versions, inputs, desktopEnv, directory, manifest }
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
  const { version, installer, evidence, versions, inputs, desktopEnv } = await desktopFixture(root)
  await writeFile(evidence, JSON.stringify({ Path: installer, Hash: '0'.repeat(64) }))
  await assert.rejects(createCandidate('desktop', resolve(root, 'bad-desktop'), inputs, desktopEnv), /checksum evidence mismatch/)
  await writeFile(evidence, JSON.stringify({ Path: installer, Hash: hash('tested installer') }))
  await writeFile(versions, JSON.stringify({ fileVersion: '2026.11.17.1', productVersion: version.package }))
  await assert.rejects(createCandidate('desktop', resolve(root, 'bad-version'), inputs, desktopEnv), /version evidence mismatch/)
  await writeFile(versions, JSON.stringify({ fileVersion: version.file, productVersion: `${version.package}.0`, runtimeVersion: '0.0.0',
    buildVersion: version.build, packageVersion: version.package }))
  await assert.rejects(createCandidate('desktop', resolve(root, 'bad-runtime'), inputs, desktopEnv), /version evidence mismatch/)
})

test('semantic identities map to four-part Windows resources and reject ambiguous or oversized versions', () => {
  assert.deepEqual(candidateVersion('0.1.0'), { build: '0.1.0', package: '0.1.0', file: '0.1.0.0' })
  assert.equal(candidateVersion('65535.65535.65535').file, '65535.65535.65535.0')
  for (const value of ['0', '0.1', '01.2.3', '0.1.0-beta.1', '0.1.0+build.1', '2026.11.17.1', '0.1.0\n', undefined]) {
    assert.throws(() => candidateVersion(value), /MAJOR.MINOR.PATCH/)
  }
  for (const value of ['65536.0.0', '0.65536.0', '0.0.65536']) {
    assert.throws(() => candidateVersion(value), /Windows version bounds/)
  }
})

test('preparation follows source version bumps without GitHub history or builder mutations', async (t) => {
  const { root } = await fixture(t)
  const config = '{"appId":"stable-identity","buildNumber":"0"}'
  await writeFile(resolve(root, 'electron-builder.json'), config)
  for (const version of ['0.4.2', '0.4.3']) {
    await writeFile(resolve(root, 'package.json'), JSON.stringify({ version }))
    const output = childProcess.execFileSync(process.execPath, [resolve('scripts/release-candidate.mjs'), 'prepare-desktop'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ID: '', GITHUB_OUTPUT: '', GITHUB_ENV: '' },
    })
    assert.deepEqual(JSON.parse(output), { CANDIDATE_VERSION: version, CANDIDATE_PACKAGE_VERSION: version, CANDIDATE_FILE_VERSION: `${version}.0` })
    assert.equal(await readFile(resolve(root, 'electron-builder.json'), 'utf8'), config)
  }
})

test('historical dated installers remain verifiable but cannot be newly built as dated candidates', async (t) => {
  const { root } = await fixture(t)
  const { directory, manifest, inputs, desktopEnv } = await desktopFixture(root, true)
  assert.equal((await verifyCandidate(directory, manifest)).version, '2026.11.17.789')
  await assert.rejects(createCandidate('desktop', resolve(root, 'new-dated'), inputs, desktopEnv), /MAJOR.MINOR.PATCH/)
})

test('web candidates bind semantic version metadata while legacy unversioned archives remain valid', async (t) => {
  const { root, input, directory, manifest } = await fixture(t)
  assert.equal((await verifyCandidate(directory, manifest)).version, null)
  const versionEnv = { ...env, CANDIDATE_VERSION: '0.1.0', CANDIDATE_PACKAGE_VERSION: '0.1.0' }
  await assert.rejects(createCandidate('web', resolve(root, 'missing-version'), [[input, '']], versionEnv), /Web application version/)
  await writeFile(resolve(input, 'index.html'), '<html><meta name="application-version" content="0.1.0"></html>')
  const versioned = await createCandidate('web', resolve(root, 'versioned'), [[input, '']], versionEnv)
  assert.equal(versioned.version, '0.1.0')
  await assert.rejects(createCandidate('web', resolve(root, 'mismatched-package'), [[input, '']],
    { ...versionEnv, CANDIDATE_PACKAGE_VERSION: '0.2.0' }), /package version mismatch/)
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

test('semantic releases cannot reuse a version for different bytes or move backwards, except explicit web rollback', () => {
  for (const target of ['web', 'desktop']) {
    const previous = { target, version: '0.1.9', runId: '122', runAttempt: 1, archiveSha256: 'b'.repeat(64) }
    const candidate = { ...previous, version: '0.1.10', runId: '123', archiveSha256: 'a'.repeat(64) }
    assert.equal(promotionDecision(candidate, [previous], false, 'ahead'), false)
    assert.equal(promotionDecision(candidate, [candidate], false, 'identical'), true)
    assert.equal(promotionDecision({ ...candidate, version: '0.2.0' }, [previous], false, 'ahead'), false)
    assert.equal(promotionDecision(candidate, [{ ...previous, version: target === 'desktop' ? '2026.11.17.60' : null }], false, 'ahead'), false)
    assert.throws(() => promotionDecision({ ...candidate, version: previous.version }, [previous], false, 'ahead'), /already published/)
    assert.throws(() => promotionDecision(candidate, [previous, { ...candidate, archiveSha256: 'c'.repeat(64) }], false, 'ahead'), /already published/)
    assert.throws(() => promotionDecision({ ...candidate, version: '0.1.8' }, [previous], false, 'ahead'), /must not go backwards/)
    assert.throws(() => promotionDecision({ ...candidate, version: null }, [previous], false, 'ahead'), /MAJOR.MINOR.PATCH/)
    if (target === 'web') {
      assert.equal(promotionDecision(previous, [candidate, previous], true, 'behind'), false)
      const legacy = { ...previous, version: null }
      assert.equal(promotionDecision(legacy, [candidate, legacy], true, 'behind'), false)
    }
  }
})

function fakeGitHub(t, candidateDirectory, overrides = {}) {
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY']
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '900', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' })
  const archive = Buffer.from('exact GitHub artifact ZIP bytes')
  const { run, jobs } = runFixture()
  run.run_attempt = 1
  const manifest = JSON.parse(readFileSync(resolve(candidateDirectory, 'manifest.json'), 'utf8'))
  const artifact = { id: 33, name: `${artifacts[manifest.target]}-1`, expired: false, digest: `sha256:${hash(archive)}` }
  const calls = []
  const transport = mock.method(childProcess, 'execFileSync', (command, args) => {
    calls.push([command, ...args])
    if (command === 'unzip') {
      if (args[0] === '-Z1') return ['manifest.json', ...Object.keys(manifest.files).map((name) => `payload/${name}`)].join('\n')
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
      assert.ok(args.includes(tag.startsWith('promotion-') ? '--prerelease' : '--latest'))
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

test('desktop publication uses semantic tags, preserves legacy tags, and never overwrites version collisions', async (t) => {
  for (const legacy of [false, true]) {
    await t.test(legacy ? 'legacy date tag' : 'semantic tag', async (t) => {
      const { root } = await fixture(t)
      const { directory, version } = await desktopFixture(root, legacy)
      const store = releaseStore()
      const { calls } = fakeGitHub(t, directory, store)
      const ready = resolve(root, 'ready')
      await preflight('desktop', '123', ready, '1')
      await guard(ready, false)
      await record(ready, false)
      const tag = legacy ? `desktop-dev-${version.build}` : `v${version.build}`
      const published = store.releases.find((release) => release.tag_name === tag)
      assert.equal(published.draft, false)
      assert.deepEqual(published.assets.map((asset) => asset.name), [`Azure-Network-Simulator-${version.build}-x64.exe`, 'record.json'])
      assert.equal((await guard(ready, false)).noOp, true)
      const writes = calls.filter((call) => call[1] === 'release').length
      await record(ready, false)
      assert.equal(calls.filter((call) => call[1] === 'release').length, writes)
      published.body = JSON.stringify({ ...JSON.parse(published.body), archiveSha256: '0'.repeat(64) })
      await assert.rejects(guard(ready, false), /Desktop version is already published/)
      await assert.rejects(record(ready, false), /Release identity already exists/)
    })
  }
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
