import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const artifacts = {
  web: 'static-site',
  statistics: 'statistics-function',
  'user-cloud': 'user-cloud-function',
  desktop: 'unsigned-windows-development-build',
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
const numericId = (value) => /^[1-9]\d*$/.test(String(value))
const sourceSha = (value) => /^[a-f0-9]{40}$/.test(value ?? '')
const digest = (value) => /^[a-f0-9]{64}$/.test(value ?? '')

const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const legacyDesktopVersion = /^\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/
const desktopReleaseTag = (version) => legacyDesktopVersion.test(version) ? `desktop-dev-${version}` : `v${version}`

export function candidateVersion(version) {
  requireValue(typeof version === 'string' && version === version.trim() && semanticVersion.test(version), 'Release version must be MAJOR.MINOR.PATCH without prerelease/build suffixes')
  requireValue(version.split('.').every((part) => Number(part) <= 65535), 'Release version exceeds Windows version bounds')
  return { build: version, package: version, file: `${version}.0` }
}

async function filesIn(root, prefix = '') {
  const files = {}
  for (const name of (await readdir(resolve(root, prefix))).sort()) {
    requireValue(!name.includes('\\'), 'Backslashes in artifact paths are not supported')
    const relative = prefix ? `${prefix}/${name}` : name
    const path = resolve(root, relative)
    const stat = await lstat(path)
    requireValue(!stat.isSymbolicLink(), 'Candidate must not contain symbolic links')
    if (stat.isDirectory()) Object.assign(files, await filesIn(root, relative))
    else {
      requireValue(stat.isFile(), 'Candidate must contain only regular files')
      files[relative] = sha256(await readFile(path))
    }
  }
  return files
}

export async function createCandidate(target, root, inputs, env = process.env) {
  requireValue(Object.hasOwn(artifacts, target), 'Unknown release target')
  requireValue(sourceSha(env.GITHUB_SHA) && numericId(env.GITHUB_RUN_ID) && numericId(env.GITHUB_RUN_ATTEMPT), 'Missing CI provenance')
  const versioned = target === 'desktop' || (target === 'web' && env.CANDIDATE_VERSION != null)
  if (versioned) {
    requireValue(candidateVersion(env.CANDIDATE_VERSION).package === env.CANDIDATE_PACKAGE_VERSION, 'Candidate package version mismatch')
  }
  await mkdir(resolve(root, 'payload'), { recursive: true })
  for (const [source, destination] of inputs) {
    const entries = destination ? [[source, destination]]
      : (await readdir(source)).map((name) => [resolve(source, name), name])
    for (const [path, name] of entries) {
      await cp(path, resolve(root, 'payload', name), { recursive: true, errorOnExist: true, force: false })
    }
  }
  const manifest = {
    schema: 1, target, repository: env.GITHUB_REPOSITORY, sourceSha: env.GITHUB_SHA,
    runId: String(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    version: versioned ? env.CANDIDATE_VERSION : null,
    packageVersion: versioned ? env.CANDIDATE_PACKAGE_VERSION : null,
    files: await filesIn(resolve(root, 'payload')),
  }
  await save(resolve(root, 'manifest.json'), manifest)
  await verifyCandidate(root, manifest)
  return manifest
}

export async function verifyCandidate(root, expected) {
  const manifest = await json(resolve(root, 'manifest.json'))
  requireValue(manifest.schema === 1 && Object.hasOwn(artifacts, manifest.target), 'Unsupported candidate manifest')
  requireValue(sourceSha(manifest.sourceSha) && numericId(manifest.runId) && Number.isSafeInteger(manifest.runAttempt) && manifest.runAttempt > 0, 'Invalid candidate provenance')
  for (const field of ['repository', 'sourceSha', 'runId', 'runAttempt', 'target']) {
    requireValue(manifest[field] === expected[field], `Candidate ${field} mismatch`)
  }
  requireValue(JSON.stringify(Object.keys(await filesIn(root)).sort()) === JSON.stringify(['manifest.json', ...Object.keys(manifest.files).map((name) => `payload/${name}`)].sort()), 'Unexpected or missing candidate files')
  const actual = await filesIn(resolve(root, 'payload'))
  requireValue(Object.keys(actual).length > 0, 'Empty candidate')
  requireValue(JSON.stringify(actual) === JSON.stringify(manifest.files), 'Candidate checksum mismatch')
  if (manifest.target === 'web') {
    requireValue(Object.hasOwn(actual, 'index.html') && Object.hasOwn(actual, 'staticwebapp.config.json'), 'Missing web entry/configuration')
    if (manifest.version != null || manifest.packageVersion != null) {
      requireValue(candidateVersion(manifest.version).package === manifest.packageVersion, 'Candidate package version mismatch')
      const html = await readFile(resolve(root, 'payload', 'index.html'), 'utf8')
      requireValue(html.includes(`<meta name="application-version" content="${manifest.version}">`), 'Web application version does not match manifest')
    }
  } else if (manifest.target === 'statistics' || manifest.target === 'user-cloud') {
    requireValue(Object.keys(actual).length === 1 && Object.hasOwn(actual, 'function.zip'), 'Unexpected Function package')
  } else {
    let fileVersion
    if (legacyDesktopVersion.test(manifest.version ?? '')) {
      requireValue(/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(manifest.packageVersion ?? ''), 'Missing desktop package version')
      fileVersion = manifest.version
    } else {
      const identity = candidateVersion(manifest.version)
      requireValue(manifest.packageVersion === identity.package, 'Candidate package version mismatch')
      fileVersion = identity.file
    }
    requireValue(Object.hasOwn(actual, `Azure-Network-Simulator-${manifest.version}-x64.exe`), 'Installer version does not match manifest')
    requireValue(Object.hasOwn(actual, 'installer-sha256.json'), 'Missing desktop checksum evidence')
    const evidence = await json(resolve(root, 'payload', 'installer-sha256.json'))
    const checksums = Array.isArray(evidence) ? evidence : [evidence]
    requireValue(checksums.length === 1 && checksums[0].Hash?.toLowerCase() === actual[`Azure-Network-Simulator-${manifest.version}-x64.exe`], 'Installer checksum evidence mismatch')
    const version = await json(resolve(root, 'payload', 'version-checks.json'))
    requireValue(version.fileVersion === fileVersion && version.productVersion === `${manifest.packageVersion}.0`
      && version.runtimeVersion === manifest.packageVersion
      && version.buildVersion === manifest.version && version.packageVersion === manifest.packageVersion, 'Packaged version evidence mismatch')
  }
  return manifest
}

export function validateRun(run, jobs, workflowId, repository) {
  requireValue(run.repository?.full_name === repository && run.head_repository?.full_name === repository, 'Foreign repository candidate')
  requireValue(run.workflow_id === workflowId && run.path === '.github/workflows/ci.yml', 'Unexpected candidate workflow')
  requireValue(run.event === 'push' && run.head_branch === 'main', 'Only main-push CI candidates can be released')
  requireValue(run.status === 'completed' && run.conclusion === 'success', 'Candidate CI did not complete successfully')
  requireValue(sourceSha(run.head_sha), 'Invalid candidate source SHA')
  for (const name of ['validate', 'desktop']) {
    const matches = jobs.filter((job) => job.name === name)
    requireValue(matches.length === 1 && matches[0].conclusion === 'success' && matches[0].status === 'completed', `Required CI job did not pass: ${name}`)
  }
}

export function validateArchivePaths(names) {
  requireValue(names.length > 0, 'Empty candidate archive')
  for (const name of names) {
    requireValue(name && !name.includes('\\') && !name.startsWith('/') && !name.includes(':')
      && !name.split('/').includes('..') && !name.split('/').includes('.'), 'Unsafe candidate archive path')
  }
}

export function promotionDecision(candidate, records, rollback, relation) {
  const current = records[0]
  if (rollback) {
    requireValue(candidate.target !== 'desktop', 'Desktop rollback is an explicit reinstall, not a deployment')
    requireValue(records.some((record) => record.archiveSha256 === candidate.archiveSha256
      && record.runId === candidate.runId && record.runAttempt === candidate.runAttempt), 'Rollback requires a previously released exact candidate')
  } else if (current) {
    requireValue(relation === 'ahead' || relation === 'identical', 'Stale or divergent promotion; use explicit rollback for a previously released candidate')
    if (relation === 'identical') {
      requireValue(current.archiveSha256 === candidate.archiveSha256, 'Same source has different bytes; select the already released candidate')
    }
    if ((candidate.target === 'web' || candidate.target === 'desktop') && semanticVersion.test(current.version ?? '')) {
      candidateVersion(candidate.version)
      const previous = current.version.split('.').map(Number)
      const difference = candidate.version.split('.').map((part, index) => Number(part) - previous[index]).find((value) => value !== 0) ?? 0
      requireValue(difference >= 0, 'Semantic release version must not go backwards')
    }
  }
  if (!rollback && (candidate.target === 'web' || candidate.target === 'desktop') && semanticVersion.test(candidate.version ?? '')) {
    requireValue(records.every((record) => record.version !== candidate.version || record.archiveSha256 === candidate.archiveSha256),
      'Semantic version is already published with different bytes; bump package.json before CI')
  }
  return current?.archiveSha256 === candidate.archiveSha256
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { maxBuffer: 512 * 1024 * 1024, ...options })
}
const api = (path) => JSON.parse(gh(['api', path], { encoding: 'utf8' }))
const pages = (path) => JSON.parse(gh(['api', '--paginate', '--slurp', path], { encoding: 'utf8' }))
const releases = (repository) => pages(`repos/${repository}/releases?per_page=100`).flat()

function recordsFor(repository, target) {
  return releases(repository).filter((release) => !release.draft && release.tag_name.startsWith(`promotion-${target}-`))
    .map((release) => {
      const record = JSON.parse(release.body)
      requireValue(record.schema === 1 && record.repository === repository && record.target === target && sourceSha(record.sourceSha)
        && digest(record.archiveSha256) && numericId(record.runId) && Number.isInteger(record.runAttempt)
        && record.runAttempt > 0, 'Invalid published release record')
      return { ...record, release, publishedAt: release.published_at }
    }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.release.id - a.release.id)
}

async function output(values) {
  console.log(JSON.stringify(values, null, 2))
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), { flag: 'a' })
  }
}

async function checkRun(repository, runId, attempt) {
  requireValue(numericId(runId) && numericId(attempt), 'A numeric CI run ID and attempt are required')
  const run = api(`repos/${repository}/actions/runs/${runId}/attempts/${attempt}`)
  const workflow = api(`repos/${repository}/actions/workflows/ci.yml`)
  const jobs = pages(`repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`).flatMap((page) => page.jobs)
  validateRun(run, jobs, workflow.id, repository)
  const ancestry = api(`repos/${repository}/compare/${run.head_sha}...main`)
  requireValue(['ahead', 'identical'].includes(ancestry.status), 'Candidate SHA is not on main')
  return run
}

async function unpack(archive, directory) {
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trimEnd().split('\n')
  validateArchivePaths(entries)
  execFileSync('unzip', ['-q', archive, '-d', directory])
}

export async function preflight(target, runId, directory, attempt) {
  requireValue(Object.hasOwn(artifacts, target), 'Unknown release target')
  const repository = process.env.GITHUB_REPOSITORY
  const run = await checkRun(repository, runId, attempt)
  const expected = { target, repository, sourceSha: run.head_sha, runId: String(run.id), runAttempt: run.run_attempt }
  const available = pages(`repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`).flatMap((page) => page.artifacts)
    .filter((artifact) => artifact.name === `${artifacts[target]}-${attempt}` && !artifact.expired)
  requireValue(available.length <= 1, 'Ambiguous candidate artifacts')
  let bytes, archiveSha256
  if (available.length) {
    const artifact = available[0]
    requireValue(/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ''), 'Missing GitHub artifact digest')
    bytes = gh(['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`])
    archiveSha256 = artifact.digest.slice(7)
  } else {
    const previous = recordsFor(repository, target).find((record) => record.runId === String(run.id) && record.runAttempt === run.run_attempt)
    requireValue(previous, 'Candidate expired or missing; select a retained run or a previously released candidate')
    const asset = previous.release.assets.find((entry) => entry.name === 'candidate.zip')
    requireValue(asset, 'Previously released candidate archive is missing')
    bytes = gh(['api', `repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'])
    archiveSha256 = previous.archiveSha256
  }
  requireValue(sha256(bytes) === archiveSha256, 'GitHub archive digest mismatch')
  await mkdir(directory, { recursive: true })
  const archive = resolve(directory, 'candidate.zip')
  await writeFile(archive, bytes)
  await unpack(archive, resolve(directory, 'candidate'))
  const manifest = await verifyCandidate(resolve(directory, 'candidate'), expected)
  await save(resolve(directory, 'receipt.json'), { ...expected, schema: 1, archiveSha256, version: manifest.version, packageVersion: manifest.packageVersion })
  await output({ source_sha: run.head_sha, version: manifest.version ?? '', archive_sha256: archiveSha256 })
}

export async function guard(directory, rollback) {
  const receipt = await json(resolve(directory, 'receipt.json'))
  const run = await checkRun(process.env.GITHUB_REPOSITORY, receipt.runId, receipt.runAttempt)
  requireValue(receipt.repository === process.env.GITHUB_REPOSITORY && receipt.sourceSha === run.head_sha
    && receipt.runAttempt === run.run_attempt, 'Preflight receipt no longer matches the successful CI attempt')
  requireValue(sha256(await readFile(resolve(directory, 'candidate.zip'))) === receipt.archiveSha256, 'Preflight archive checksum mismatch')
  const manifest = await verifyCandidate(resolve(directory, 'candidate'), receipt)
  requireValue(manifest.version === receipt.version && manifest.packageVersion === receipt.packageVersion, 'Preflight version mismatch')
  const records = recordsFor(receipt.repository, receipt.target)
  const relation = records.length ? api(`repos/${receipt.repository}/compare/${records[0].sourceSha}...${receipt.sourceSha}`).status : null
  const pendingReleases = releases(receipt.repository).filter((release) => release.draft && release.tag_name.startsWith(`promotion-${receipt.target}-`))
  const noOp = promotionDecision(receipt, records, rollback, relation) && !(rollback && pendingReleases.length)
  for (const pending of pendingReleases) {
    if (rollback && pending.tag_name !== `promotion-${receipt.target}-${process.env.GITHUB_RUN_ID}`) continue
    requireValue(pending.tag_name === `promotion-${receipt.target}-${process.env.GITHUB_RUN_ID}`
      && JSON.parse(pending.body).archiveSha256 === receipt.archiveSha256,
    'Unresolved promotion draft exists; rerun that release or reconcile it before another promotion')
  }
  if (receipt.target === 'desktop') {
    const existing = releases(receipt.repository).find((release) => release.tag_name === desktopReleaseTag(receipt.version))
    if (existing) {
      const identity = JSON.parse(existing.body)
      requireValue(identity.archiveSha256 === receipt.archiveSha256 && identity.sourceSha === receipt.sourceSha, 'Desktop version is already published with different bytes')
    }
  }
  await output({ no_op: noOp, source_sha: receipt.sourceSha, version: receipt.version ?? '' })
  return { ...receipt, noOp }
}

export async function record(directory, rollback, reserve = false) {
  const receipt = await json(resolve(directory, 'receipt.json'))
  const promotionId = process.env.GITHUB_RUN_ID
  requireValue(numericId(promotionId), 'Missing promotion run identity')
  const body = {
    ...receipt, rollback, promotionRunId: promotionId,
    ciUrl: `https://github.com/${receipt.repository}/actions/runs/${receipt.runId}`,
    promotionUrl: `https://github.com/${receipt.repository}/actions/runs/${promotionId}`,
    notice: receipt.target === 'desktop' ? 'Unsigned Windows development build; not a signed production installer.' : 'Explicit deployment record; not an application download release.',
  }
  const notes = resolve(directory, 'record.json')
  await save(notes, body)
  const tag = `promotion-${receipt.target}-${promotionId}`
  const publish = async (name, title, assets, prerelease, draftOnly = false) => {
    let found = releases(receipt.repository).find((release) => release.tag_name === name)
    const created = !found
    const unresolved = `Cannot resolve created release "${name}"; preserve its draft and resume the original promotion`
    if (created) {
      const response = gh(['api', '--method', 'POST', `repos/${receipt.repository}/releases`,
        '-f', `tag_name=${name}`, '-f', `target_commitish=${receipt.sourceSha}`, '-f', `name=${title}`,
        '-f', `body=${await readFile(notes, 'utf8')}`, '-F', 'draft=true'], { encoding: 'utf8' })
      try { found = JSON.parse(response) }
      catch { throw new Error(unresolved) }
    }
    requireValue(found?.tag_name === name && numericId(found.id) && Array.isArray(found.assets)
      && typeof found.draft === 'boolean' && (!created || found.draft), unresolved)
    let identity
    try { identity = JSON.parse(found.body) }
    catch { throw new Error(`Release identity is unreadable for "${name}"; preserve its draft and resume the original promotion`) }
    requireValue(identity?.archiveSha256 === receipt.archiveSha256 && identity.sourceSha === receipt.sourceSha, 'Release identity already exists with different bytes')
    for (const path of assets) {
      const name = path.split(/[\\/]/).at(-1)
      const existing = found.assets.find((asset) => asset.name === name)
      if (existing) {
        requireValue(existing.digest === `sha256:${sha256(await readFile(path))}`, 'Published asset checksum mismatch; refusing to overwrite')
      } else {
        requireValue(found.draft, 'Published release is missing assets; refusing to change it')
        gh(['release', 'upload', found.tag_name, path, '--repo', receipt.repository])
      }
    }
    if (draftOnly || !found.draft) return
    gh(['release', 'edit', name, '--repo', receipt.repository, '--draft=false', prerelease ? '--prerelease' : '--latest'])
  }
  if (!reserve && receipt.target === 'desktop') {
    await publish(desktopReleaseTag(receipt.version), `Windows development build ${receipt.version} (unsigned)`,
      [resolve(directory, 'candidate', 'payload', `Azure-Network-Simulator-${receipt.version}-x64.exe`), notes], false)
  }
  await publish(tag, `${rollback ? 'Rollback' : 'Promotion'}: ${receipt.target} ${receipt.sourceSha.slice(0, 12)}`,
    [resolve(directory, 'candidate.zip'), notes], true, reserve)
  if (!reserve && process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `Released **${receipt.target}** from [CI ${receipt.runId}](${body.ciUrl}).\n\nSource: \`${receipt.sourceSha}\`\n\nArchive SHA256: \`${receipt.archiveSha256}\`\n\n${body.notice}\n`, { flag: 'a' })
  }
}

async function main() {
  const [command, target, argument, directory, attempt = '1'] = process.argv.slice(2)
  if (command === 'prepare-desktop') {
    const version = candidateVersion((await json('package.json')).version)
    if (process.env.GITHUB_ENV) {
      await writeFile(process.env.GITHUB_ENV, `CANDIDATE_VERSION=${version.build}\nCANDIDATE_PACKAGE_VERSION=${version.package}\nCANDIDATE_FILE_VERSION=${version.file}\n`, { flag: 'a' })
    }
    await output({ CANDIDATE_VERSION: version.build, CANDIDATE_PACKAGE_VERSION: version.package, CANDIDATE_FILE_VERSION: version.file })
  } else if (command === 'create') {
    const root = resolve('test-artifacts', 'candidates', target)
    const inputs = target === 'web' ? [['dist', '']] : target === 'statistics' || target === 'user-cloud'
      ? [[`test-artifacts/${target === 'statistics' ? 'github-statistics' : 'user-cloud'}-function.zip`, 'function.zip']]
      : (await readdir('release')).filter((name) => name.endsWith('-x64.exe')).map((name) => [resolve('release', name), name])
        .concat((await readdir('test-artifacts/desktop')).filter((name) => name.endsWith('checks.json') || name.endsWith('sha256.json'))
          .map((name) => [resolve('test-artifacts/desktop', name), name]))
    const version = candidateVersion((await json('package.json')).version)
    await createCandidate(target, root, inputs, { ...process.env, CANDIDATE_VERSION: version.build, CANDIDATE_PACKAGE_VERSION: version.package })
  } else if (command === 'preflight') await preflight(target, argument, resolve(directory), attempt)
  else if (command === 'guard') await guard(resolve(target), argument === 'true')
  else if (command === 'record') await record(resolve(target), argument === 'true')
  else if (command === 'reserve') await record(resolve(target), argument === 'true', true)
  else throw new Error('Expected prepare-desktop, create, preflight, guard, reserve or record command')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
