# Windows desktop operations and production gates

Applies to #106; publisher/signing work stays in #146. This is the repository's
maintenance policy and an enterprise pilot runbook, **not production release
approval**. Current artifacts remain unsigned development builds. No updater,
upload service, Azure deployment or identity enrollment is introduced.

## Ownership and patching policy

The **repository maintainer role** owns the bundled desktop runtime and npm
dependency lifecycle, not the end user. A production release must name an
accepting maintainer/release approver and a backup in the organization's release
record. This document assigns the repository responsibility; it cannot establish
staffing, an enterprise SLA or publisher approval on that organization's behalf.

| Component | Responsible role | Required action |
| --- | --- | --- |
| Electron and its embedded Chromium/Node | Repository maintainer | Monitor Electron releases/security notices weekly and on disclosed exploitation; update the exact Electron pin and lockfile, rebuild and retest the complete package. Updating the developer's Node does **not** patch embedded Node/Chromium. |
| React, application dependencies, MCP SDK, bundler, packaging tools and transitive lockfile | Repository maintainer | Review advisories/lockfile audit weekly; assess shipped versus build-only exposure and record unavailable audit results honestly. Patch with focused manifest/lockfile changes, never an unreviewed bulk upgrade. |
| Release eligibility, immutable artifact/hash, signing identity, timestamp, channel and rollback decision | Release approver | Approve exact tested bytes and security exceptions with expiry; block distribution when the maintainer, backup, signing or provenance gate is missing. #146 owns signing integration. |
| Windows servicing, endpoint protection, disk encryption, local folder ACLs | Enterprise endpoint administrator | Maintain supported OS policy and filesystem/retention controls; test WDAC/AppLocker/SmartScreen policies without bypassing them. |
| Separately installed Azure CLI, its Python/extensions, and PowerShell 7 | Enterprise endpoint administrator | Install, inventory and patch through the organization's software channel; qualify the exact CLI/PowerShell versions for collection. The simulator must not install, upgrade, log in or elevate them. Offline modeling requires neither tool. |
| Read-only scope, permissions, egress review and capture retention | Azure resource/data owner | Approve a bounded target and discovery breadth, arrange existing authentication, review warnings locally and authorize any sanitized evidence sharing. |

Repository response targets: triage actively exploited/critical advisories within
one working day and aim for a tested candidate within 72 hours of an applicable
upstream fix; high severity within seven days; other fixes in the monthly
maintenance candidate. These are candidate/triage targets, not automatic releases
or a promise to ship without approval. If no safe fix is available, document the
exposure and compensating control; suspend the affected capability/distribution
instead of calling an unsupported runtime safe.

Support only the latest approved patched artifact. A previous approved artifact
is a temporary rollback option only if its security exposure is acceptable.
Before every candidate, record exact Electron/Chromium/embedded Node versions,
lockfile and source revision, installer and ASAR hashes, tests, known advisories,
and release approver. Re-evaluate upstream Electron support at that time; a pin
is reproducibility, not a lifetime support guarantee.

Patch qualification:

1. Review upstream notes, supported Electron line, transitive advisories and
   package/CLI prerequisites. Do not equate an unavailable audit with no findings.
2. Update only reviewed dependencies in a dedicated change; restore from the
   resulting lockfile. Do not change versions just to regenerate evidence.
3. Run lint, unit/platform and collector/wrapper tests, web build/regressions,
   actual development and packaged desktop/native checks, and
   `npm run test:desktop-network`. Investigate failures rather than disabling
   sandboxing, CSP, certificate checks or endpoint policy.
4. Repeat isolated-account install/upgrade/uninstall/rollback and signed-payload
   checks below; after approval distribute those exact bytes, not a rebuild.
5. Notify endpoint administrators of the new approved hash and withdrawal of
   vulnerable builds. Manual/offline installations must be tracked by the
   enterprise: there is deliberately no in-app patch check or inventory upload.

## Installation, controlled update and rollback

Current packaging is Windows x64 Electron/ASAR with an assisted **per-user NSIS**
installer (`oneClick: false`, `perMachine: false`). It is not MSI/MSIX, an
all-users deployment or a certified Intune/SCCM package. No separately downloaded
WebView2, system Node, CDN or Azure CLI is required to model offline.

Before an enterprise pilot, the endpoint administrator must qualify the exact
Windows version, endpoint policies and installer command line in an isolated
Windows account/VM. Do not install/uninstall on a shared developer account to
produce evidence: doing so can replace an existing user's application, shortcuts
and uninstall registration.

1. Obtain the installer, independently approved SHA-256 and release record from
   the organization's controlled channel, including offline transfer if needed.
   Never assume a filename or GitHub asset alone establishes publisher trust.
   Check locally:

   ```powershell
   Get-FileHash -LiteralPath $installer -Algorithm SHA256
   Get-AuthenticodeSignature -LiteralPath $installer |
     Select-Object Status, StatusMessage, SignerCertificate, TimeStamperCertificate
   ```

   Compare the hash with the approved record. Production requires a valid trusted
   signature, the organization's approved publisher and trusted timestamp on the
   installer **and installed executable(s)**. Current unsigned development bytes
   cannot pass that gate; do not bypass SmartScreen/WDAC policy to call them
   production-ready.
2. Close only this application's windows. Export needed native JSON locally
   before an upgrade; protect backup access and retention. A synchronized or
   network destination can upload data independently of the application.
3. Run the assisted installer as the intended standard user, choosing an approved
   local directory. Do not request elevation or install CLI prerequisites from
   the simulator. The candidate unattended NSIS `/S` path must be separately
   tested for the enterprise deployment system; it is not certified by the
   packaged-app smoke test.
4. Detect the actual installed executable/path and Windows uninstall registration
   in the pilot; verify product/file versions, signatures and approved hashes
   against the release record. Do not treat package semver, four-part build
   version and filename as interchangeable. Record chosen path, start-menu/
   shortcut behavior and standard-user launch results.
5. With no Azure capture, verify local samples, editing, import/export,
   persistence after restart, local documentation and network isolation.
   Validate all supported legacy views as well as the shared workspace. The
   repository's desktop harness uses only synthetic samples and a dedicated
   profile; it does not certify the installer's registry/shortcut behavior.
6. Update by deliberately reinstalling the approved replacement; there is no
   background download, update check or auto-update URL. Confirm saved JSON/
   preferences survive and reopening/re-exporting retains expected meaning.
7. Roll back by closing the app and reinstalling a previously approved artifact
   only after the release approver accepts its security status. Restore exported
   JSON into a clean, separately backed-up profile if compatibility fails; do not
   assume a newer profile is backward-compatible. Recheck offline behavior.
8. Use the product's registered Windows uninstaller as the same user. Verify app
   files/shortcuts/registration are removed and unrelated files are untouched.
   Profile data may remain in the product-specific directory under `%APPDATA%`;
   identify it before deliberately deleting it under retention policy. Also
   handle deliberate exports, backups and interrupted capture files. Never delete
   all of `%APPDATA%`, `.azure`, or another application's files.

Pilot acceptance must record fresh install, same-user upgrade, standard-user
launch, restart/persistence, rollback, uninstall and retention results on the
organization's target OS/policies. These remain unexecuted enterprise gates,
along with signing/channel approval; an unsigned `win-unpacked` launch is not
installer lifecycle evidence.

## Network isolation: tested boundary and remaining gate

Chromium serves packaged `app://simulator/` assets. Production disables Chromium
proxy discovery to avoid PAC/WPAD traffic during local startup. This affects
Chromium only: deliberate Azure CLI child processes retain the organization's
independent proxy, CA and authentication settings. Do not disable enterprise
proxy/certificate policy for Azure.

`npm run test:desktop-network` launches actual Electron with a fresh synthetic
profile and Chromium net logging enabled **before startup**. It runs all three
local sample simulations, opens bridge-free documentation, probes HTTP(S)/WS(S)
from both windows and probes the default session's HTTP(S) filter independently
of renderer CSP. A loopback server first proves reachability from the harness,
then must see zero application connections, even when supplied as a PAC URL.
The test rejects Chromium TCP/UDP connect and host-resolver events. It uses no
Azure CLI, identity, live resources or external canary. The same command with
`DESKTOP_EXECUTABLE` tests the real packaged app and records executable/ASAR
hashes and embedded runtime versions.

Only allowlisted summaries are retained in ignored
`test-artifacts\desktop\*-network-checks.json`; the raw Chromium log and fresh
profile are deleted even on failure. CI retains those synthetic summaries with
the existing desktop artifacts, never live capture/proxy/credential logs.
This is actual runtime evidence, not mocked network enforcement, but it is a
bounded Chromium observation, **not** an OS-wide process-tree/firewall trace or
proof that Azure CLI contacts only approved endpoints. It cannot certify every
Windows environment or future action. The pre-fix local run detected WPAD
resolution plus a UDP connectivity-probe event; this gate must not silently
ignore those events.

The desktop broker and fixed PowerShell wrapper explicitly disable CLI usage
telemetry and CLI file logging for their child processes, overriding inherited
user configuration without editing it. Dynamic extension installation and
PowerShell telemetry stay disabled. This uses supported
[Azure CLI configuration environment overrides](https://learn.microsoft.com/en-us/cli/azure/azure-cli-configuration).
It is not proof that CLI modules, cached configuration, system services,
revocation checks, DNS or enterprise proxies have no other network behavior.

## Authenticated read-only capture and endpoint acceptance

**2026-11-16 gate:** #106/comments and this work request do not supply an
explicitly approved tenant/subscription and WAN/resource-group target.
Consequently no cached account inventory, login, token request or live Azure
capture was attempted. Presence/absence of a usable authenticated session was
not established. Do not substitute fixture results for live evidence or infer
authorization from whichever subscription happens to be current.

For the resource/data owner and endpoint administrator to execute later:

1. Record approval privately for the exact public-Azure tenant/subscription,
   WAN or resource group, allowed related-resource reads, time/query budget,
   existing read permissions, evidence location and retention. Include the
   desktop account-list/target-discovery breadth: `accounts` lists cached
   accounts; `targets` lists resource groups and WANs across the selected
   subscription. Do not assume approval of one RG authorizes that inventory.
   VWAN collection follows referenced resources and route context. Review the
   actual collectors before approving that breadth.
2. Use an already installed, patched CLI/PowerShell and already authenticated
   session under the approved account. Record only tool versions and a
   sanitized scope alias in shareable evidence. Check scope locally through
   the desktop UI; never print `get-access-token`, `.azure` contents, account
   user records, raw identifiers or inventories into issues, CI or prompts.
   If missing/expired authentication, MFA/CA, unsupported cloud, missing modules
   or denied reads prevent collection, stop; no login/installation/elevation or
   resource change is authorized by this runbook.
3. Review the environment's egress policy before collection. Expected service
   families are public Azure ARM (`management.azure.com`) and Microsoft Entra
   authentication/token refresh (`login.microsoftonline.com`), plus the
   organization's approved DNS/proxy/certificate infrastructure. This is a
   review starting point, **not an observed or exhaustive allowlist**. No hosted
   simulator endpoint is required. Do not broadly allow `*.azure.com` or disable
   TLS inspection/verification to get a passing result.
4. Have the administrator observe the application/PowerShell/CLI process tree
   using approved OS firewall/proxy diagnostics, including startup, idle,
   deliberate scope discovery, one confirmed collection and shutdown.
   Chromium net logging alone cannot observe `az`. Avoid CLI `--debug`, packet
   payloads or HTTP authorization headers. Keep potentially identifying raw
   diagnostics in the organization's protected local evidence location, never
   the repository or automatic CI artifacts.
5. Select the approved scope and accept the native read-only confirmation once.
   Existing broker bounds are 60 seconds for metadata, 20 minutes for collection,
   2 MB combined process output and 4 MB admitted capture; existing narrower
   importer limits still apply. Stop on a scope mismatch or unexpected egress.
   Do not retry with broader rights or different resources.
6. Review/import the capture locally. Record whether import succeeded, coverage/
   warning counts, partial/unknown sections, mode and whether local modeling
   succeeds without the hosted service. Missing evidence is not healthy-empty
   Azure state. Capture is a non-atomic observation, not forwarding certification.
7. Share only an owner-approved summary: date, source/artifact hash, tool/runtime
   versions, scope alias, actual versus mocked status, approved endpoint
   categories observed, unexplained destinations and pass/fail/partial outcome.
   Clean capture temporary files after orderly shutdown and handle deliberate
   saved copies per retention policy. Keep the #106 live-capture and combined
   offline/**collection** network checklist items open until this completes.

## Bounded local evidence, 2026-11-16

This readiness change is based on main
`1d315744a02b90fe8041fca80ab142747eddc2f9`. Dependencies were absent in the
exclusive readiness worktree, so `npm ci --no-audit --no-fund` restored the
unchanged lockfile. No dependency or release versions were changed.

| Validation | Actual result and limits |
| --- | --- |
| `npm run lint` | Exit 0; existing `src/ErLocationInfoModal.tsx:46` set-state-in-effect warning remains. Not a warning-free lint claim. |
| `npm run test:desktop-cli` | Actual PowerShell wrapper with **mocked `az`**, including inherited telemetry/logging opt-out. Not authenticated Azure evidence. |
| `npm run build:platform` and `npx vitest run platform/electron/broker.test.ts` | Seven passing broker tests, including an actual PowerShell child observing overridden environment settings and actual process cancellation/deadlines; capture/auth responses remain fixtures. |
| `npm run build:desktop` | Successful TypeScript/Vite/platform build and unsigned x64 NSIS packaging with `--publish never`. Existing missing author/description packaging warnings remain; signing was deliberately skipped. |
| Development and packaged `npm run test:desktop-network` | Actual Electron startup-to-shutdown observations, all three sample simulations, local docs and ten blocked transport probes per run; reachable control server saw zero application connections and Chromium recorded zero matching connect/resolver events, including with the PAC canary configured. No CLI calls. |

Observed embedded runtime: Electron **42.11.18**, Chromium **148.0.7778.280**,
Node **24.19.0** (distinct from developer Node 22). Packaged evidence:

- Executable SHA-256:
  `871B0FC672466B278C6773E99D94B92E5E459F7A9A21222830CBFBE36AF3D804`
- ASAR SHA-256:
  `72B676B00DE4DBAD2C680921E997308CD65FD82E922A9D424B7912F5B8A22D40`
- Local installer `Azure-Network-Simulator-2026.11.16.7-x64.exe`:
  **116,696,309 bytes**, Authenticode **NotSigned**, SHA-256
  `C2C816B96E21D9E99DC272E0E5EEB2A173E37F84293195E7DB893DF0B09FDFE9`.

These are local candidate bytes, not a published replacement for an existing
release with the same unchanged build identity. No installer was executed on the
shared developer account. Full web/desktop baseline suites were not repeated;
this adds focused evidence rather than relabeling earlier results as fresh.
No live Azure validation, OS-wide endpoint certification, dependency vulnerability
audit, enterprise lifecycle test, publisher enrollment or release was performed.

Recommended #106 checklist treatment: record the runbook/role policy and
bounded offline Chromium evidence as delivered sub-items. Keep the combined
enterprise-installation, live-capture and offline-plus-collection endpoint
acceptance items open. Keep named maintainer/backup acceptance and exact external
CLI/PowerShell version qualification visible under the ownership/prerequisite
gate. Signing remains #146 pending identity/cost approval.
