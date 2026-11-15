# Local simulation platform

P0/P1/P2A/P2B of #112 add a browser-independent contract and local clients.
The existing React UI, native JSON formats, validators and TypeScript engines
remain the source of routing behavior. There is no separate desktop engine.
#114 tracks P0, #115 P1, #116 P2A, and #106 desktop/P2B.
#119/P3A and #120/P3B add on-demand explanations and local practice.
Identity, cloud progress, verified awards and resource-deployment APIs remain
outside this implementation.

Both websites and Windows start with an empty mixed-network topology when there
is no saved workspace; explicit samples/imports and saved work still load normally.
Damaged saved data remains available for recovery, not silently overwritten.
Window/executable/installer icons derive from the web's `public/favicon.svg`;
Windows resource editing is enabled, but code signing remains disabled.

There is no visible architecture-mode selector. Contextual creation/selection
controls expose classic VNets and Virtual WAN together. #138 preserves the native
v1 Virtual WAN editor/provider as an explicit compatibility path rather than
converting unsupported semantics to v2. Both native engines, existing links/files
and independent practice remain supported.

**Workspace** opens the saved-design/recovery library or starts an empty mixed
design. `network-simulator:workspace:v1` stores only the active native provider;
the existing `vwan-visual-topology:v1` and `aznet-visual-topology:v1` payloads stay
authoritative for their own families. Without a selection, two legacy saves
require an explicit choice. A single legacy save resumes in its compatible
editor. Legacy architecture aliases are consumed once; H&S aliases never delete
mixed virtual hubs or branch connections. Native imports/captures and v2 shared
snapshots select the appropriate provider, retaining native capture review and
comparison behavior. Explicit sample URLs are consumed after load.

Before selection/replacement, exact original bytes are preserved in
`network-simulator:originals:v1`, deduplicated by native key/content without silent
eviction. The library exports these immutable originals for explicit reimport.
They are not a second editable graph. Invalid active selections are recoverable
and archived before replacement. Archive/quota failures refuse replacement;
native-write failures roll back the selection. If storage is unavailable, an
explicitly unsaved in-memory design remains possible. Practice, display
preferences and inactive native payloads are not reset by workspace selection.

## On-demand explanations and local practice

**Learn & practice** opens an optional, keyboard-accessible EN/JA panel in all
native editors. Concept help also appears as collapsed **Explain this** disclosures
beside hub preference, route decisions and diagnostics. Curated concepts live
in `src/learning/content.ts`; result-specific disclosures display the existing
engine's reasons, not AI-inferred causes. Help does not change configuration
or silently enable a learning mode. References load only after deliberate
selection; external references remain blocked by the desktop host.

Three exercises in `src/learning/exercises.ts` cover Virtual WAN, VNet peering
and Full Hybrid connectivity. The course picker can assess/resume any exercise
without changing the normal workspace; visual opening selects its native editor,
and copying requires a compatible native document family. Each pins its rubric version, owned endpoint
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
Changing native editors cannot display a previous editor's assessment.

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
  simulation subnet table key (the original subnet ID). For an Azure-network
  hub assertion, use the original hub ID as `table` and explicitly set
  `hubTableId` to an exact owned table ID. The mixed engine maintains separate
  Default/custom/None RIBs; legacy `vwanHubRibs` remains its Default projection.
  `hubTableId` never falls back to a subnet table. Missing owners, unknown
  scopes and retained unsupported hub-table/policy/attachment configuration
  remain `not assessed` for both presence and absence. Native documents and
  unknown extension fields are preserved; retention is not semantic support.

Each goal is `satisfied`, `violated` or `not assessed`, with evidence/reasons.
Missing or ambiguous ownership, unobserved imported controls, incomplete
convergence or unsupported inspection never become a passing grade.
Alternate valid designs are accepted against goals, not compared with one
reference JSON. Unknown top-level/request/goal fields are rejected.

These are steady-state model assertions, not Azure packet delivery, firewall
rules/NAT/session enforcement, bandwidth/SLA or convergence-time guarantees.
HRP edits reevaluate immediately without Azure's possible route-bounce behavior.

Plain JSON admission bounds depth (32), aggregate values (100,000),
arrays (4,096), input (4 MB), total hub/VNet/site/workload/NIC/public-IP nodes
(512) and goals (64).

## Mixed hub tables and original workload detail

The contextual mixed hub editor exposes custom tables/labels and attachment
association/propagation. Labels are case-sensitive, association selects the
ingress lookup table and None suppresses propagation. Branches associate with
Default and share effective propagation destinations; branch edits synchronize
those destinations without silently changing captured/unknown provenance.
An unknown hub-table scope requires the explicit **Use edited hub table scope**
action; simply adding or renaming a table does not certify captured completeness.
Remote label propagation uses the original hub/table/route identities.

**Workspace controls > Capability coverage** inventories dedicated VWAN,
classic and mixed capabilities with explicit native-model limits. The same
matrix is exposed by MCP capabilities. Both native formats remain authoritative;
no second editable graph or automatic cross-format conversion is introduced.

Mixed hubs reuse the dedicated VWAN HRP selector, including local/remote
preference and the distinction between VPN gateways and NVAs. Hub-owned maps
are assigned to exact ER/VPN IDs or the original attached VNet ID, independently
on ingress and egress. VNet policies include its spoke NVA advertisements.
Integrated SD-WAN bypasses hub maps, but supports site policies. Static VPN
prefixes bypass BGP policies. Summaries retain contributors for forwarding;
aggregate holes remain unreachable. Mixed ER exports use selected associated
table routes, including remote and VPN origins, subject to existing ER scope,
Global Reach and private-ASN rules. Hub/site export feedback is bounded to 64
passes; incomplete or cyclic selection cannot certify any routing assertion.
Mixed ER link weights remain effective within ER selection; ASPath hub
preference still compares path length first.

The original `vpnConnections` collection retains its IDs and default VPN
meaning. Optional `transport: "SDWAN"` requires a BGP-enabled hub target;
`learnSiteRoutes` and `propagateDefaultRoute` expose hub branch controls.
ER hub links accept the same optional learning/default controls. Optional
`allowBranchToBranchTraffic: false` suppresses branch-origin hub exports, not
hub learning, VNet connectivity, site links or independent Global Reach. This
is route-propagation control, not a packet ACL. Site inbound local preference
defaults to 100 and is reset at inter-router boundaries; outbound local-preference
assignments are rejected. The existing native rule/ASN validator remains shared.

An original appliance can set `vwanBgpEnabled: true` to peer with its hosting
VNet's attached hub. BGP and IP forwarding must also be enabled; its original
ASN, advertised prefixes/attributes, overlay links and VNet connection are
reused. No duplicate router/site is created. The NVA inspector and connection
inspector expose these controls; hub/site policy markers retain exact owned
connection IDs, keyboard activation and rule previews.

Custom tables combined with routing intent and static hub next hops remain
not assessed in both VWAN providers. Unknown propagation and incomplete table
scope remain conservative; retained source is not proof of isolation. Bicep
starters explicitly warn about omitted hub policies, branch controls and NVA
peerings; native JSON/share URLs preserve them. Dedicated controls, legacy
documents, practice progress and all mode selectors remain available. Automatic
legacy-save/URL migration, unified defaults and selector retirement are #138,
not part of this capability bridge. Internet/NAT/LB/NSG engines are separate work.

Optional `topology.inventory` contains `workloads`, `nics` and `publicIps`.
A workload has `id`, `name`, `nicIds` and an optional existing router
`backingDeviceId`. A NIC has `id`, `name`, an original
`owner: {kind: "spoke"|"vnet", id}` and `ipConfigurations`. Each configuration
has `id`, `name`, a real owned `subnetId`, optional `privateIp` and optional
`publicIpId`. Public-IP records have `id`, `name` and optional `address`.
Entity IDs are unique, IP-configuration IDs are scoped to a NIC, and addresses
may be absent but are never synthesized. Detailed VWAN spokes explicitly
declare `subnets: [{id, name, prefix}]`; legacy spokes do not gain subnets.
Private addresses must be usable in one owned subnet and must not duplicate
another NIC, private endpoint or independently represented router. A workload
cannot span network owners; one router backing identity is not a second router.

**VNet detail** is available for selected VNets/spokes and their context menus
in all three modes. It edits the original saved graph, reuses its native
simulation and preserves entity IDs and overview coordinates. Search caps
visible cards/endpoints at 100; NIC associations remain explicit. Unknown or
unsupported services are not displayed as healthy discovered inventory.
With inventory present, VNet/subnet prefix text commits atomically on blur so
incomplete keystrokes cannot invalidate owned addresses. Native JSON preserves
the inventory; Bicep starters explicitly warn that they do not deploy it.

`simulate` accepts an optional `packet` (not an evaluation requirement):

```json
{
  "source": {"kind": "workload", "workloadId": "vm", "nicId": "nic", "ipConfigurationId": "primary"},
  "target": {"kind": "external", "address": "20.50.60.70"},
  "protocol": "tcp",
  "sourcePort": 49152,
  "destinationPort": 443
}
```

Either endpoint may reference an owned workload IP configuration. Only explicit
public IPv4 external addresses and TCP/UDP ports 1–65535 are supported.
Private/connected destinations and known public-IP associations are not
reclassified as Internet. The result's `packet` section preserves endpoint
identities and independently reports forward/reply `reachable`, `unreachable`
or `not-assessed` routing, original route/edge/table references and five-tuples.
The reply swaps addresses/ports as a separate hypothetical routing probe,
not proof that a response or session exists. Unknown addressing or coverage
remains not assessed; unsupported boundary translation has a null post-tuple.
Public-IP association alone establishes neither inbound DNAT nor a listener.
Delivery, security and translation readiness always remain not assessed.
The MCP schema and bounded `packet` evidence section expose the same contract;
web workers, Node workers and offline Electron use the same adapters.
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

The standalone `collect-azure-network.ps1` pins an explicit subscription (or
resolves the current subscription once) on every resource read. It projects
allowlisted non-secret fields at the CLI and serialization boundaries. Limits
are 500 subprocesses, 20 minutes overall, 60 seconds per subprocess by default,
2 million stdout characters, 65,536 stderr characters, 6 MB retained projected data and an
8 MB final UTF-8 envelope; command/runtime/output limits can be lowered with
the documented script parameters. Both process pipes are drained concurrently;
timed-out or oversized subprocess trees are terminated. No CLI error text,
credentials, account user records or automatic extension installation is exported.

The existing capture v2 format gains additive `observationVersion: 1`,
selected subscription/tenant/cloud context, configuration completeness,
per-section states and per-NIC observation coverage. Succeeded-empty,
denied, failed, timed-out, truncated, unsupported and not-requested results are
distinct. Collection is non-atomic and completeness is a collector report,
not a certification of the network. Import accepts older v2 captures with
unknown coverage and disables absence-based mismatch claims for them.
Missing/unsupported address ownership stays explicit in import warnings and
`unknownAddressing`: unrepresentable resources/routes are omitted from the
simulated subset, not assigned demo prefixes or endpoint IPs. Partial or
unsupported configurations cannot earn a complete-match badge. Only adequately
covered observations establish absent routes; present legacy observations
remain usable. Preserve the original local capture for its inventory/provenance.

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

### Exact web artifact and startup gates

`npm run test:production` serves the already-built `dist` with its SWA static
headers, asset caching and navigation-fallback exclusions. It does not rebuild,
substitute the Vite dev server, emulate Azure authentication/APIs, or claim Azure
compression/latency equivalence. CI runs the existing semantic suite and this
additional exact-artifact suite before uploading/deploying that same `dist`.
Production test traces have a separate output directory so other runners cannot
delete their downloads or traces.

The blocking external `theme-bootstrap.js` resolves stored/system theme before
React/CSS paint without loosening the self-only script CSP. Inactive workspace
JavaScript roots load on demand; presentation styles retain their shared eager
order so popup layering, motion and theme overrides do not depend on visiting
another mode first. This retains shared dependencies, mode-specific state,
recoverable loading/failure controls, native JSON/history and offline workers.

`npm run measure:production -- <output.json>` records the initial referenced
asset graph, settled cold-start JS/CSS requests per mode, first optional-panel
and first inactive-workspace latency. `PRODUCTION_ROOT` selects an existing
artifact for baseline reproduction. Gzip sizes are computed locally, not
observed Azure transfers; loopback timing samples are not a network-performance
promise. Compared with the published 8d9d76d artifact, the measured entry graph
fell from 354,192 to about 135,346 local-gzip bytes, and settled per-mode requests
from 354,192 to about 293,995–299,890 bytes. The initial request graph excludes the
inactive workspace JavaScript; the first switch now pays its loading cost. Measured local
ready/panel/switch timings are retained separately, with neither speed nor
peak-memory improvements assumed. CI enforces bounded entry/per-mode byte
budgets and tests defaults/overrides, pre-paint theme, workers, optional panels,
failure recovery and cached offline operations.

## Shared samples and workspace evolution

All current workspaces use the same searchable sample gallery, native modal
focus/keyboard behavior, responsive theme styling and load/error feedback.
Catalogs remain capability-specific; the gallery does not convert one topology
schema into another. Loading over an existing design requires confirmation and
offers the existing JSON exporter before replacing the design and undo history.
Closing a pending gallery load cancels it; failed or stale loads cannot replace
the active design. Explicit sample links and the legacy H&S/Full quick selector
retain their existing admission behavior.

The original #85 shell foundation is now used by #138's single-workspace
rollout described above. Both saved families, offline Electron and dedicated
VWAN routing capabilities remain intact. Compatibility preserves the native
editor rather than claiming universal lossless v1-to-v2 conversion. Shared
presentation does not replace the routing/control-plane implementations.

The current roots also reuse `WorkspaceTools` for collapsible/searchable
creation controls and selection-driven context actions. It calls existing
root-owned handlers rather than registering global callbacks or importing
another engine/editor into the entry bundle. Nested actions retain their
current prerequisite/disabled and failure-recovery gates and mount only when
expanded or requested by search. Classic deletion
uses the existing confirmation path. Full Hybrid exposes its implemented
virtual-hub creation; this does not supply missing custom-table parity.

The palette reserves canvas space below the unchanged full-width global bar
on wide screens and becomes a dismissible
non-modal drawer on narrow screens. Explicit opening focuses search; Escape
and the close control restore the opener. A narrow-screen action dismisses
the drawer before opening its editor. Canvas maximization temporarily hides
it without losing its choice. `aznet-workspace-tools:v1` stores only
`open`/`closed`, shared across compatible editors; invalid/unavailable
storage falls back to viewport-appropriate in-session behavior. Searching,
collapsing and inspecting do not modify topology JSON, saved coordinates,
simulation inputs or practice progress.

This shell supports the single-workspace rollout without schema migration.
Global workspace/file/analysis controls and legacy sample shortcuts remain.
Context-action terminology and semantics
remain supplied by their compatible root; no unsupported Internet/workload
controls are advertised.

Object discovery derives a read-only `WorkspaceObject` projection from each
existing editable graph. Provider family, selection kind, opaque ID and (for
classic child devices/subnets) VNet owner ID form a structured identity.
React keys serialize that tuple rather than joining unescaped user IDs.
The projection preserves the existing `ObjectSelection`/`AzSelectedEntity`
payloads; it is not another document wrapper, editable graph or canonical
schema conversion. Both root selection handlers retain explicit route
inspection scope until the user requests a route action.

`Find objects` indexes current canvas-selectable nodes, subnets, gateways,
Route Servers, appliances and links, including disabled devices. Route tables,
route maps and private endpoints still use their existing owner configuration;
discovery does not invent standalone selection handlers for them. Names,
labels, IDs and parent names remain opaque user data. The index is requested
only when its disclosure opens or search needs it; at most 100 matching buttons
are rendered, with a refine-search notice rather than a topology size limit.
Selection clears search and collapses discovery to surface contextual actions,
focusing their heading on wide screens or the restored opener on narrow ones.
No inventory selection changes saved designs, coordinates, undo history or
routing inputs.
Status badges read only enabled flags supported by the corresponding model;
retained extension fields on other records are not interpreted as status.

On short wide windows, a wrapped global/native header can extend beyond the
viewport. The palette then clamps its top to retain at least 240px of usable
height (or the available viewport), temporarily overlapping the lower header
instead of placing all controls offscreen. Normal-height placement stays below
the measured header. Selecting an object scrolls its contextual heading into
the panel before focusing it; both development and packaged Electron exercise
real pointer selection at 1024x640.

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
