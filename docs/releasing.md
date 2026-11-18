# Integration and explicit releases

Merging is not releasing. `CI` validates pull requests and main pushes and
produces development candidates without Azure credentials or publication.
Manual CI is also validation-only. Existing `validate` and `desktop` job names
are unchanged. Root Markdown/license-only changes retain the existing CI
exclusions; use an earlier eligible main-push candidate when no build is needed.

| Event | Validation / candidates | Production effects |
| --- | --- | --- |
| Pull request | Existing web/platform/Windows gates | None; cannot be promoted |
| Main push | Same gates and candidate artifacts | None |
| Manual CI | Same gates and candidate artifacts | None; cannot be promoted |
| Tag push / CI completion | No release trigger | None |
| Manual Release, preflight only (default) | Verify selected main run/attempt, files and release history | None |
| Manual Release, preflight disabled | Repeat checks after environment approval | One explicitly selected target |

`Release` runs only from `main`. It checks out the **workflow's** pinned source,
not the candidate's code. Candidate packages are data, never executed by the
privileged release job. It accepts a numeric CI run ID and explicit attempt,
not a moving branch/tag, arbitrary SHA, pull-request run or a "latest" artifact.
Both `validate` and `desktop` must have completed successfully in that attempt,
even for a web-only or Function-only promotion. This deliberately tightens the
old web deployment's accidental independence from Windows validation.

Browser gates use the matching Playwright image for its preinstalled browsers,
but mount the `actions/setup-node` runtime read-only and put it first on `PATH`.
Keep dev-server, production and accessibility checks on that configured runtime,
not the image's independently selected Node version. This also avoids the native
HTTP/Buffer V8 abort documented in
[nodejs/node#66870](https://github.com/nodejs/node/issues/66870); do not mask a
server crash by relaxing assertions, retries or test timeouts.

## One-time repository setup

Before the first actual promotion:

1. Configure environments **web-production**, **github-statistics**,
   **user-cloud-production** and **desktop-release** with deployment branches
   restricted to `main`.
   Add required reviewers if supported by the repository's plan and desired
   approval policy. A workflow referencing a new environment does **not**
   configure reviewers or branch policies automatically. The main-ref guard
   and explicit dispatch remain enforced regardless.
2. Set `AZURE_STATIC_WEB_APPS_API_TOKEN` in **web-production**. Remove the old
   repository-level copy after confirming setup: historical CI reruns without
   an environment must not retain access to that deployment credential.
   Never paste credentials into issues, workflow inputs, artifacts or logs.
3. Keep the existing **github-statistics** environment's Azure variables,
   `GH_STATS_TRAFFIC_TOKEN` and OIDC federation; see
   [statistics configuration](github-statistics.md#configure-github).
   No Azure client secret or new Azure resources are needed. The promotion job
   has contents-write permission for durable release records and OIDC permission
   for Function targets; only the selected Function target signs in to Azure.
   The independent **user-cloud-production** environment uses its own
   AzNetSim identity and variables, never the statistics identity or credentials.
   See [personal-account deployment](cloud-accounts.md#production-infrastructure-and-releases).
4. Preserve any configured `CI / validate` and `CI / desktop` required checks.
   This change does not create branch rules or relax tests. Repository owners
   should configure integration rules if they are currently absent.
5. Disable the retired **Deploy statistics Function** workflow after merging.
   Do not rerun historical auto-deploy workflows; reviewers must reject those
   deployments. Old workflow definitions are retained by GitHub in run history;
   deleting a YAML file cannot revoke their historical credentials by itself.
6. Establish a baseline with a deliberate release from the cutover merge's
   successful CI before releasing later application changes. Pre-cutover runs
   lack the new manifests and cannot be promoted or used for automatic rollback.

This implementation does not provision these settings, move/read secret values,
change Azure federation or claim that environment reviewers are already enabled.
The existing Azure Function's daily 04:17 UTC collection remains independent of
deployments.

## Select, preflight, then promote

Select a completed successful **push to main** run in Actions. Check its source
SHA and attempt. Use **Re-run all jobs** if a new attempt is necessary: a rerun
of only failed jobs is not an eligible complete candidate attempt.

```powershell
gh run list --workflow ci.yml --branch main --event push --status success --limit 10
gh workflow run release.yml --ref main -f candidate_run_id=123456789 -f candidate_attempt=1 -f target=web -f preflight_only=true -f rollback=false
```

Inspect the Release run's preflight summary. The default is **no deployment,
release record, tag, installer publication or Azure login**. It verifies:

- Repository, expected CI workflow, main-push provenance, successful exact
  attempt and both required jobs; the selected SHA must still be on main.
- Unique target artifact, GitHub archive SHA256 and every payload file's SHA256,
  manifest/source/run/attempt identity, required entries and desktop version/
  installer evidence.
- Target release ordering, exact retry identity and explicit rollback eligibility.

Then dispatch with the **same run/attempt/target**, explicitly disabling preflight:

```powershell
gh workflow run release.yml --ref main -f candidate_run_id=123456789 -f candidate_attempt=1 -f target=web -f preflight_only=false -f rollback=false
```

Targets are **web**, **statistics**, **user-cloud**, or **desktop**, one per dispatch. Web and
Function deployments reuse exact CI bytes without installing dependencies or
rebuilding. Desktop publication reuses the tested unsigned installer and names
it `v<version>` (for example `v0.1.0`); it does not sign it or add an updater (#146).
There is no cross-target atomic release: one target succeeding says nothing
about the others. Release them independently and inspect each run's result.

## Application semantic versions

The root `package.json` is the single source of the app/installer version,
starting at **0.1.0**. Before CI builds a new release, use
`npm version patch --no-git-tag-version` (or `minor` / `major`) and commit both
`package.json` and `package-lock.json`. During `0.x` development, increment
the patch for compatible fixes and the minor for features or breaking changes;
document breaking changes in the release notes. Reserve `1.0.0` for an explicitly
declared stable compatibility contract. Internal topology schemas, engine
revisions, saved workspaces and learning awards keep their independent versions.

Versions must be plain `MAJOR.MINOR.PATCH`, without leading zeroes, prerelease
or build suffixes; each component must fit Windows' 0-65535 bound. Local and CI
desktop builds both read the root version. The runtime reports `0.1.0`, the
installer is `Azure-Network-Simulator-0.1.0-x64.exe`, and Windows FileVersion and
ProductVersion are `0.1.0.0`. CI verifies the actual packaged runtime/resources.
Web HTML also records `application-version` metadata, verified against its
candidate manifest. Source SHA, CI run/attempt and archive hashes remain the
exact build identities; CI no longer queries daily history or edits versions.

A version bump is required **before building** different bytes for a version
already published to that target. Unreleased changes may share a pending version.
Forward promotion rejects lower semantic versions and reuse with different
archives, even if the source commit is newer. A rerun cannot replace a published
version. Never bump, rename or rebuild during promotion; build a new candidate
from a committed version bump instead.

Historical `desktop-dev-YYYY.MM.DD.N` releases and unversioned web archives remain
verifiable and retain their original bytes/tags, including exact web rollback.
The first semantic release is a new identity, not a renaming of a date release.
Its numeric version is lower than historical `2026.*` Windows versions; in-place
installation over those builds is not qualified. The app ID/profile location
remain unchanged, but do not claim a tested upgrade or delete user data to force
one. Desktop downgrade/rollback remains a deliberate manual reinstall.

## Retention and durable release records

CI keeps `static-site-<attempt>`, `statistics-function-<attempt>`,
`user-cloud-function-<attempt>` and
`unsigned-windows-development-build-<attempt>` for **30 days**. Their root
`manifest.json` binds the `payload` to the source SHA, run and attempt.
PR/manual candidates are useful for testing but are intentionally unreleasable.
Preflight handoff artifacts last one day. Each preflight attempt creates a new
artifact ID, passed explicitly to promotion; rerunning only a failed promotion
reuses the successful preflight's handoff, while rerunning all jobs regenerates
it without replacing earlier handoffs. Approval expiry before any production
changes can be recovered with a fresh dispatch. An interrupted promotion with
an expired handoff must rerun all jobs in its original Release run to preserve
the reserved receipt's identity. Diagnostic-only CI artifacts are replaceable
on rerun; the per-attempt release candidate archives are never overwritten.

Before production changes, promotion reserves a draft
`promotion-<target>-<release-run-id>` GitHub release containing the verified
`candidate.zip` and a JSON record. On success it publishes that receipt as a
**prerelease**, not the latest installer. These archives provide delayed
redeployment/rollback after CI artifact expiry. Desktop also publishes its
installer and record in a normal explicitly **unsigned development** release.
The records link source SHA, original CI, promotion run, version and archive
digest; installer file hashes are in the archived manifest/evidence.

GitHub administrators can edit/delete releases; these are durable,
checksum-verified records, not signed tamper-proof provenance. Preserve them,
their assets and original CI run metadata. Release assets contribute to GitHub
download counters; promotion-archive downloads are not installer downloads or
evidence of application use.

## Concurrency, failure, retry and rollback

Promotions serialize per target and do not cancel an active deployment.
GitHub concurrency is **not a FIFO queue**: a newer pending dispatch can replace
an older pending one. Redispatch a superseded request deliberately. The guard
runs again after environment approval, so an older/divergent source cannot
replace a newer published source. An exact current candidate is a no-op;
the same source with different bytes is rejected rather than silently replaced.

A draft receipt left by a failed/partial promotion blocks forward promotions for
that target. Inspect the failed steps and rerun the **original Release run**:
its draft/assets are reused without overwriting existing bytes. Deployment
retry can repeat the same package upload; it cannot guarantee an Azure
operation was atomic. Desktop upload retries fill missing draft assets and
verify existing asset digests, never overwrite a published version.

If GitHub/Azure changed state but final receipt publication failed, do not
delete the draft merely to get a green run. Reconcile what was deployed and
finish the original run, or explicitly roll back to a previously released
candidate. A recovery rollback is allowed past another run's unresolved draft
and forces deployment even if the last successful receipt already names those
known-good bytes: the failed deployment may have changed production. Verify
recovery before manually reconciling/removing only the identified failed draft;
it continues to block forward promotion until reconciled.
A missing or mismatched published asset is an
error requiring investigation, not permission to clobber it. If abandoning a
draft after confirming no production side effects, delete **only that
identified draft** (and any associated unused tag after inspection); this is a
manual administrator recovery, not an automatic cleanup.

To roll back web, statistics or user-cloud, select the exact run/attempt of a **previously
successfully released candidate**:

```powershell
gh workflow run release.yml --ref main -f candidate_run_id=123456000 -f candidate_attempt=1 -f target=web -f preflight_only=true -f rollback=true
# Inspect the preflight, then repeat with preflight_only=false.
```

Rollback requires a matching published archive digest and creates a new
rollback receipt without changing source history or version identity.
Expired never-released candidates fail closed; merge a new change to obtain
a new eligible main-push candidate rather than rebuilding under an old identity.
Deleted CI run metadata or deleted release archives require manual recovery.
Function code rollback does not roll back collected data, infrastructure,
Entra policy or rotated credentials. Desktop rollback is a deliberate reinstall
of a retained earlier installer, not a workflow deployment or automatic update.

## Validation before cutover

Run `npm run build:user-cloud`, `node --test scripts/release-candidate.test.mjs`
and `npm run lint`, and
check both workflow files with `actionlint`. The focused suite covers candidate
byte preservation/tampering, source/run/attempt mismatches, missing payloads,
link/path rejection, actual installer evidence, invalid/failed/skipped CI gates,
stale promotion, retry and rollback rules. CI also packages and verifies all
four targets on its real Linux/Windows runners.

A valid hosted preflight requires these workflows to have landed and a new
successful main-push candidate. Neither local tests nor a PR run can prove a
production promotion occurred. The first actual deployment/publication is a
separate explicit operator action, not part of merging this change.
