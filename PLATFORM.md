# Local simulation platform

P0/P1/P2A/P2B of #112 add a browser-independent contract and local clients.
The existing React UI, native JSON formats, validators and TypeScript engines
remain the source of routing behavior. There is no separate desktop engine.
#114 tracks P0, #115 P1, #116 P2A, and #106 desktop/P2B.
#119/P3A and #120/P3B add on-demand explanations and local practice.
Identity, cloud progress, verified awards and resource-deployment APIs remain
outside this implementation.

The Windows app starts VWAN with an empty topology when there is no saved
workspace; explicit samples/imports and saved work still load normally.
Damaged saved data remains available for recovery, not silently overwritten.
Window/executable/installer icons derive from the web's `public/favicon.svg`;
Windows resource editing is enabled, but code signing remains disabled.

Full Hybrid is temporarily paused **in the normal mode selector** while #85
unifies VWAN/Hub & Spoke interactions. Explicit `?mode=full`/`?mode=azure-net`
links, existing files, simulation engines and all three practice assessments
remain supported. This is not removal of mixed VWAN/classic networking.

## On-demand explanations and local practice

**Learn & practice** opens an optional, keyboard-accessible EN/JA panel in all
three modes. Concept help also appears as collapsed **Explain this** disclosures
beside hub preference, route decisions and diagnostics. Curated concepts live
in `src/learning/content.ts`; result-specific disclosures display the existing
engine's reasons, not AI-inferred causes. Help does not change configuration
or silently enable a learning mode. References load only after deliberate
selection; external references remain blocked by the desktop host.

Three exercises in `src/learning/exercises.ts` cover Virtual WAN, VNet peering
and Full Hybrid connectivity. The course picker can assess/resume any exercise
without changing the normal workspace; visual editing/copying requires its
matching architecture mode. Each pins its rubric version, owned endpoint
IDs/addresses, requirements, preparation, concept links and hints. The VWAN
starter intentionally has unassessable propagation scope; absence is not
taught as verified isolation. Tests accept a one-hub or multi-hub repair,
direct peering or NVA transit, and hub attachments or direct peering respectively.
There is no reference-topology equality check.

Practice JSON is an **independent draft**, saved locally on edits. **Open draft
in visual editor** validates it using the shared worker and requires explicit
replacement confirmation; export a normal design first. After visual editing,
reopen learning and **Copy workspace configuration into practice** before
assessment. Copying does not include temporary failure overlays. **Assess
practice draft** grades that exact snapshot using the P1 browser-worker adapter;
editing cancels pending work and visibly invalidates earlier displayed evidence.
Changing architecture mode cannot display a previous mode's assessment.

Local progress uses `aznet-simulator:practice:v1` in localStorage, independently
of normal topology saves: at most three 200,000-character drafts, twenty recent
attempts per exercise and a retained latest practice achievement. Attempts
include rubric/grader versions, timestamp, engine revision fingerprint and hint
use. Partial, unknown, malformed, mismatched or cancelled evaluations cannot
award a practice pass. Historical achievements remain explicitly unverified;
older rubric/grader awards request reassessment rather than becoming current
certification. Finishing later unsuccessful attempts does not erase a prior
practice achievement.

Progress is per browser origin or Electron profile, **not encrypted,
account-backed or synchronized**; simultaneous tabs use last-write-wins saves.
Storage corruption is preserved until deliberate reset; unavailable/full
storage is reported as session-only. Reset requires confirmation and does not
touch the visual workspace. No exercises/results are uploaded, no Azure
resources are created and basic help/grading requires no AI subscription.
Account-backed progress and server-verified awards remain P4.

### Small-corpus authoring rules

Keep concept IDs stable and source content independently authored with concise
EN/JA text, scope/uncertainty and references. Increment the content version when
its meaning changes. Exercise revisions must identify learning objectives,
owned endpoints, explicit supported assertions, preparation and hints; increment
the rubric version when requirements change. Never add an interpretive goal as
if the engine can grade it. Add focused tests with an unmet or unassessable
starter, materially different passing designs, and failures/unknown coverage.
Review content and assistance policy before expanding the corpus; local hints
are permitted and recorded, not grounds for a trusted certification claim.

## Clients and data flow

| Client | Execution and persistence | Network / privilege boundary |
| --- | --- | --- |
| Web | Existing UI/engines and diagnostics workers remain browser-local. `src/platform/browser.ts` adds a separately tested worker contract adapter for new consumers; the existing UI is not wholesale migrated to that facade. Native saves remain per browser origin. | Static-site loading and deliberately selected existing web integrations retain their current behavior. No Azure credentials or new backend. |
| Local MCP | `platform-dist/mcp.cjs`, Node workers, process-local jobs/evidence. No file, Azure, shell or UI mutation tools. | Stdio only; no HTTP listener. Your selected AI provider can receive tool inputs/results. Local MCP does **not** make hosted Copilot offline. |
| Windows desktop | Packaged React UI/assets in Electron; isolated Node workers and deliberate file dialogs. Same native JSON and existing capture review. | Renderer has no Node, filesystem or generic IPC/process API. No automatic HTTP(S) requests, updates, telemetry or crash uploads. Feedback and share-link features are disabled. Deliberate Azure collection alone invokes the local read-only CLI broker. |

Core/Node bundle import guards reject React, browser locale state and browser
worker dependencies. Presentation helpers accept a renderer rather than reading
mutable browser state. UI English/Japanese labels remain client-local; machine
evidence uses the engines' canonical English prose and identifiers. The optional
contract locale does not mutate global locale or change routing decisions.

## Contract v1

`src/platform/contract.ts` defines the schema. Discover engine version,
capabilities and limits at runtime; an explicit incompatible version is rejected.

```json
{
  "contractVersion": 1,
  "operation": "simulate",
  "document": {
    "mode": "vwan",
    "topology": {
      "version": 1,
      "name": "Empty example",
      "hubs": [],
      "spokes": [],
      "sites": [],
      "connections": [],
      "siteLinks": []
    }
  }
}
```

The explicit modes are `vwan`, `hub-spoke`, `full`. VWAN uses native v1;
the other two use native `version: 2, kind: "azure-network-topology"` and
retain their distinct mode envelope. `validate` returns an admitted native
document; `simulate` adds engine tables; `evaluate` also requires explicit goals:

- `flow`: unique ID, owned source/target, concrete source/destination IPv4 and
  `allow`/`deny`. VWAN endpoints use `{kind: "spoke"|"site"|"hub", id}`.
  Azure-network endpoints use `{kind: "subnet", vnetId, subnetId}` or
  `{kind: "site", siteId}`. An optional `requiredFirewallHubId` (VWAN) or
  `requiredApplianceId` (Azure-network) checks modeled inspection.
- `route`: unique ID, exact IPv4 prefix, `present`/`absent`, and table identity.
  VWAN uses a hub ID plus optional `hubTableId`; Azure-network uses its exact
  subnet table key (`vnetId/subnetId`).

Each goal is `satisfied`, `violated` or `not assessed`, with evidence/reasons.
Missing or ambiguous ownership, unobserved imported controls, incomplete
convergence or unsupported inspection never become a passing grade.
Alternate valid designs are accepted against goals, not compared with one
reference JSON. Unknown top-level/request/goal fields are rejected.

These are steady-state model assertions, not Azure packet delivery, firewall
rules/NAT/session enforcement, bandwidth/SLA or convergence-time guarantees.
HRP edits reevaluate immediately without Azure's possible route-bounce behavior.

Plain JSON admission bounds depth (32), aggregate values (100,000),
arrays (4,096), input (4 MB), modeled hub/VNet/site nodes (512) and goals (64).
Node/browser jobs have a hard 15-second ceiling and 8 MB result ceiling; callers
can lower them. Node worker heaps are bounded (192 MB old/32 MB young generation),
with at most two active workers. Cancellation terminates computation; capacity
is released after worker termination. Timed-out/cancelled/output-limited jobs
mark unchecked goals `not assessed`, never partially passed.

Node/MCP handles are process-local, limited to eight and expire after ten
minutes. Evidence handles are not resumable computation or a semantic cache.
The document revision is an informational non-cryptographic fingerprint,
not a provenance/security hash. Existing UI diagnostic continuation remains
available through its existing UI, not this initial service contract.

## Local MCP / Copilot skill

Prerequisites: Node 22 and a trusted checkout; dependencies are restored with
`npm ci`, then `npm run build:platform`. `npm run mcp` starts the standalone
stdio server. `.github/mcp.json` declares the repository-local server, launched
from this repository root after building. Review/enable it through your client's
trust flow; the configuration does not grant blanket permissions.

The six tools are `get_capabilities`, `get_schema`, `start_simulation`,
`get_job`, `get_evidence`, `cancel_job`. They provide native examples,
bounded JSON evidence chunks (up to 16,000 characters), explicit job status
and requirement assessments. Concatenate all requested chunks before parsing
JSON. Transport buffering is bounded independently of job admission.

`.github/skills/network-simulation/SKILL.md` guides requirement capture,
validation, assessment and up to three reviewed repairs, followed by explicit
JSON handoff for deliberate UI import. Unsupported goals stay visible.
Actual SDK stdio discovery/assessment/evidence/cancellation is tested.
This is not certification of arbitrary AI-generated designs or a claim that
an interactive Copilot synthesis session has been exercised.

## Windows development build

Supported initial target: Windows x64, stable pinned Electron 42.11.18,
Node 22 for development. Azure integration requires **already installed**
Azure CLI and PowerShell 7 on PATH and an existing authenticated session.
The MVP supports **public Azure only**. Other OSes/clouds are not certified.

```powershell
npm ci
npm run build:desktop
npm run desktop
npm run test:desktop
$env:DESKTOP_EXECUTABLE = Join-Path (Get-Location) 'release\win-unpacked\Azure Network Simulator.exe'
npm run test:desktop
```

`release` contains an assisted per-user NSIS installer and packaged application.
Artifacts are unsigned **development** builds, not enterprise production
releases. The filename/build identity uses `YYYY.MM.DD.N`; the package uses
three-part semver. Initial builds use the default Electron icon.

Electron loads local `app://simulator/` assets, not a local HTTP service.
Sandboxing, context isolation, CSP and main-frame/origin-checked IPC are enforced.
Documentation windows have no preload/bridge. External navigation/windows,
webviews and renderer HTTP(S) fetches are blocked. Local docs, samples,
JSON/Bicep/collector exports and existing diagnostics remain available.

The five renderer methods are `openTopology`, `accounts`, `targets`,
`collect`, `simulate`; there is no generic invoke, shell string or event bus.
CLI reads use a fixed PowerShell wrapper with explicit tenant/subscription.
Collection requires a native confirmation (default Cancel), chosen WAN or
resource group, and read-only existing collectors. Authentication/scope/cloud
checks occur before collecting. No `az login`, `account set`, dynamic extension
installation, elevation or resource mutation is attempted.

Metadata reads stop after 60 seconds; collection after 20 minutes; combined
stdout/stderr is capped at 2 MB and not forwarded to the renderer. Final capture
admission is capped at 4 MB. The underlying collector can create a larger
temporary output before rejection; the existing VWAN UI has a narrower 2 MB
file-import limit (Hub & Spoke/Full use 4 MB). Review/import retains those
existing limits; the broker ceiling does not enlarge the UI's admission limit.
Neither ceiling is a filesystem quota.
Known credential fields are stripped, but captures still contain sensitive
network/resource identifiers, observations and limitations. Partial captures
retain warnings and must pass the existing importer before handoff.
CLI/auth/permission/cloud/timeout errors remain local and request the user
to inspect the selected scope and existing session.

No live Azure discovery runs at application startup. Tests use mocked CLI
operations and sanitized captures; a user-selected live scope/endpoint-policy
validation remains a release gate. Explicit CLI reads can contact Azure identity
and management endpoints according to the user's existing Azure/cloud policy.
Disabling renderer networking does not isolate the user's CLI from Azure.

## Storage, installation and maintenance

Native topology/workspace and display preferences persist in Electron's local
user-data profile (the product's directory under `%APPDATA%`), separately from
the hosted web origins. Browser/desktop JSON round trips are interchangeable.
Uninstalling/reinstalling must not be assumed to erase saved scenarios; delete
the product-specific profile deliberately if retention policy requires it.
The smoke harness uses its own `test-artifacts/desktop` profiles.

File opens require native dialogs. Exports use save dialogs; captures use a
private temporary directory deleted after success/failure. Normal application
shutdown cancels active CLI work and waits for process exit and capture cleanup;
an OS crash/forced termination cannot guarantee that cleanup. These files are
not encrypted by the application. OS account permissions and disk protection
apply. A user-chosen OneDrive/network/synchronized export location can upload
files independently of the simulator. Do not put confidential captures in
test artifacts, CI artifacts, issues or AI prompts.

There is no automatic updater or background release check. Development updates
are rebuilt/reinstalled manually; export saved JSON before upgrades.
Before enterprise distribution, the repository maintainer must own Electron,
Chromium/Node and dependency monitoring, patch/test cadence, supported-version
policy, signed release approval and installer/uninstall rollback validation.
Production signing (Azure Artifact Signing or equivalent, publisher validation),
SmartScreen/reputation, final icons/metadata, signed download channel and release
approvals remain external production gates. Signing alone does not guarantee
instant SmartScreen reputation.

## Validation / CI

`npm test` builds the platform and runs the native engine plus platform tests.
`npm run test:platform` covers three-mode parity/round trips, isolated import
graphs/locale, alternative designs, violated/unknown goals, malformed inputs,
worker limits/cancellation and real MCP stdio.
`npm run test:collector` exercises the existing read-only collectors.
`npm run test:desktop-cli` exercises the actual fixed PowerShell wrapper with
mocked CLI responses for expired authentication, wrong tenant/cloud and
explicit read-only subscription scope.
The browser suite includes actual contract-worker parity and cancellation,
alongside existing routing/import/UI regressions.

`npm run test:desktop` launches actual Electron and checks three-mode engine
parity, native JSON import/export/persistence, immediate HRP UI reevaluation,
existing local diagnostics workers, packaged offline assets, narrow bridge,
renderer Node isolation, disabled outbound integrations and remote-fetch
blocking. The same harness accepts `DESKTOP_EXECUTABLE` to test ASAR packaging
and the external worker resource. It does not authenticate to Azure.
Windows CI builds/tests the unsigned NSIS development artifacts; existing
Ubuntu web validation and Static Web Apps deployment remain unchanged.
