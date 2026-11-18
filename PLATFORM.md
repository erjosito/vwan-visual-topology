# Local simulation platform

Azure Network Simulator (**AzNetSim**) provides a shared local simulation platform
for classic VNets/hub-and-spoke, Virtual WAN and hybrid networks. The product name
does not expand any provider's supported semantics; existing API identifiers,
native formats, desktop identity and saved-data keys remain compatible.

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

## Application/DNS contracts foundation (#156)

Platform contract **2** adds the separate `application` operation and result
section. Capabilities report `supportedContractVersions: [1, 2]`, application
inventory/request version 1 and **`application.providers: []`**. Contract 1
remains supported for existing native/packet operations but explicitly rejects
application declarations/requests. Unknown future versions and unknown fields
inside the application contracts fail admission rather than disappearing.

Native v1/v2 documents may optionally retain `topology.application`:

```json
{
  "version": 1,
  "services": [
    {
      "id": "original-service",
      "name": "Imported service identity",
      "kind": "application-gateway",
      "references": [],
      "unsupportedFeatures": []
    }
  ],
  "dnsProfiles": []
}
```

This is **identity-only inventory**, not service configuration or support.
`services.kind` admits `application-gateway`/`front-door`; DNS profile identities
use `traffic-manager`. Optional service `owner` is an existing
`{kind: "vnet" | "spoke", id}`. References are discriminated original service,
DNS-profile, public-IP, owned subnet, workload/NIC/IP-configuration tuple, or
owned Load Balancer frontend/pool references (see `src/application.ts` and
`get_schema.applicationContracts`). References must exist and match owners;
edits cannot delete a referenced endpoint while leaving a broken save.
There are at most 32 services, 32 profiles, 64 references and 32 bounded
unsupported-feature names per entry. Application entities count against the
existing aggregate platform node bound. Listener/rule/member/endpoint bounds
are reserved for provider children; those configuration fields are currently
rejected, not silently accepted as functioning services.

An application request uses `contractVersion: 2`, `operation: "application"`,
the original native `document`, and one `application` field:

- HTTP: `{version: 1, kind: "http", serviceId, client, scheme, host, port, path}`.
  `client` is an original `{kind: "workload", workloadId, nicId,
  ipConfigurationId}` or `{kind: "external", address: "explicit public IPv4"}`.
  Hostnames are ASCII DNS names (lowercased, optional terminal dot removed);
  ports are 1–65535 and scheme is `http`/`https`. Absolute paths exclude
  queries/fragments, backslashes, dot segments and ambiguous encoded
  separators/control characters. Percent escapes are uppercased, not decoded
  into a guessed provider-specific matching algorithm.
- DNS: `{version: 1, kind: "dns", profileId, resolver, name, evaluatedAt,
  cache: "fresh"}`. Resolver uses the same original client identity shape;
  time is caller-supplied canonical UTC, e.g. `2026-11-16T00:00:00.000Z`.
  No wall clock, cached answer or failover timing is inferred.

The ordered evidence separates DNS selection, listener matching, request
routing, two original IPv4 TCP network legs, and conditional response
assumptions. Absent provider facts remain explicit `null`/empty candidates,
never fabricated addresses or packet evidence. Configuration and availability
are separate; availability is always `not-assessed`. Unsupported providers and
unknown prerequisites cannot produce a configured result or training grade.
Independent definite failures may still aggregate as violations. Existing
packet requests and native routing engines are unchanged.

The EN/JA VNet detail panel inspects imported identities and highlights original
subnet/workload cards for the selected request. These are references, not extra
routers, global edges, or evidence that a proxy forwards an unchanged tuple.
Inspection uses the same bounded/cancellable browser worker and headless
executor; native export/reload/undo retains the optional inventory. Request
drafts/results are ephemeral. No DNS, probes, TLS checks, arbitrary origin
fetches, cloud calls or telemetry are introduced. Application Gateway,
Traffic Manager and Front Door providers remain #157–159; no exercises, capture
or deployment support are enabled by this foundation.

## On-demand explanations and local practice

**Learn & practice** opens an optional, keyboard-accessible EN/JA panel in all
native editors. Concept help also appears as collapsed **Explain this** disclosures
beside hub preference, route decisions and diagnostics. Curated concepts live
in `src/learning/content.ts`; result-specific disclosures display the existing
engine's reasons, not AI-inferred causes. Help does not change configuration
or silently enable a learning mode. References load only after deliberate
selection; external references remain blocked by the desktop host.

Three routing exercises in `src/learning/exercises.ts` cover Virtual WAN, VNet peering
and Full Hybrid connectivity. These legacy content/assessment fixtures remain
tested; their JSON draft picker is no longer learner-facing. Each pins its rubric version, owned endpoint
IDs/addresses, requirements, preparation, concept links and hints. The VWAN
starter intentionally has unassessable propagation scope; absence is not
taught as verified isolation. Tests accept a one-hub or multi-hub repair,
direct peering or NVA transit, and hub attachments or direct peering respectively.
There is no reference-topology equality check.

Six EN/JA connectivity exercises in `src/learning/connectivity-exercises.ts`
cover explicit private-subnet egress, UDR precedence over NAT Gateway, independent
LB probe/client NSGs, public VM ingress permissions, original DNAT return ownership
and unknown internal LB backend health. They use fixed original IPv4/endpoint
bindings and configuration-only packet predicates. Unknown health, allocation,
mapping or filtering cannot certify either connectivity or isolation. Supported
repairs are open-ended; no guest/listener or live-session readiness is certified.

The lazy, non-modal learning sidebar runs the **Routing foundations** track's
six sequential missions through black belt (40 tasks, 1,325 first-earned points) from `course-examples.ts`,
`course-routing.ts` and `course-wan.ts`. They cover direct peering, equal-prefix
UDR preference, longest-prefix diagnosis, shared-gateway return routing, secured
Virtual WAN and a two-fault hybrid capstone. `runner.ts` is the single progression authority: scoped
setup, observation, direct-peering configuration plus engine outcome, open-design
requirements, and quizzes unlock the next task only after a passing current
check and explicit **Complete task & continue**. The root keeps task/completion
and pause/resume state across native editor switches. Compatible completion and
linear position restore after reload from the bounded browser-local ledger.
Raw JSON, raw requirements,
exercise selection menus and engine payloads are not exposed in the sidebar.
Confirmed **Load practice network** validates the starter using the shared
worker before opening a **protected practice workspace**. Opening/resuming the
sidebar does not reload or reset a canvas; loading a starter always confirms
replacement of any existing practice edits.

**Learning tracks**, shared by the optional sidebar and status details, lists
Routing foundations as **Available**, with **DNS and name resolution** and
**Application delivery** explicitly **Planned**. Planned entries have no playable
course, progress or unlock action and never change routing completion totals.
The header, status details and completion view scope claims to Routing
foundations. The catalog/overview remain off the normal startup graph; the
header reuses lightweight course metadata. Existing course/storage/assessment
identities and all first-earned awards are unchanged; see the
[track compatibility policy](src/learning/AUTHORING.md#track-scope-and-compatibility).

**Show me where** resolves typed action IDs and exact entity/table/route/prefix
parameters, not translated labels, selectors from content, coordinates or
synthetic clicks. Native adapters select/frame the source object and open its
inspector or context menu. Nested destinations are outlined when the learner
opens the submenu. Matching prefix candidates are outlined together; an absent
prefix highlights the exact subnet table instead. Dashed learning outlines are
pointer-transparent and separate from routing/path evidence. They follow
scroll, resize, pan/zoom and inspector movement; missing, disabled, covered or
closed targets get an explicit reason and an explicit reveal retry. Navigation
never mutates topology, awards credit or answers quizzes, and never costs
points. Focus stays put unless **Focus highlighted control** is requested.
Guidance dismisses an occluding workspace-controls pane without changing its
saved preference; it can still be reopened explicitly. Observation requires
**Record inspection: prefix** inside the exact scoped native routes inspector.
Its token cannot carry across tasks, revisions, replacement or replay.

Pending checks and passing candidates bind the live editor's monotonic revision,
practice scope, runtime session, course/content/task and assessment version.
Edits, edit/undo, reset, pause and provider changes abort or discard old evidence.
Unknown/incomplete/unsupported engine assessments never pass; quizzes have
answer-specific retry feedback. Unmet flow feedback names required inspection
waypoints in both directions, without exposing engine IDs or JSON. Explicit
advance focuses the next task or completion heading when the replaced button
loses focus; ordinary renders and canvas interactions do not move focus.
Completed-task review is historical, not proof
that today's canvas is still valid. Explicit lesson replay preserves history
and cannot emit duplicate completion events. Newly inserted/revised unmet
tasks gate the next uncompleted task even if later historical records exist.

Routing foundations has separately versioned original and scenario editions.
New learners start the seven-scenario edition. Existing completion history
keeps the original edition until explicit, confirmed enrollment; old points
and belts remain historical achievements, not credit in the new edition.
Enrollment is an optional field in the existing v1 progress ledger and uses
the same writer ownership and optimistic conflict checks as completion writes.
Changing editions does not replace the current practice canvas. Each scenario
still requires the existing explicit starter/replacement confirmation.

Mixed flow requirements can declare
`applianceChain: { forward: ["firewall-id", "sdwan-id"], reverse: ["sdwan-id", "firewall-id"] }`.
Each leg contains 1-16 distinct original appliance IDs, with explicit order
independently authored for both directions. This is an allow-only assertion;
it cannot be combined with legacy appliance/Firewall waypoint policy fields.
A complete delivered trace must contain each declared leg's ordered sequence
in `traversedApplianceIds`. Additional intermediate appliances are permitted;
this is an ordered waypoint requirement, not an exact-hop-count assertion.
Unknown original owners and VWAN-only providers return **not assessed**.
Subnet UDR policy selected at an appliance's hosting subnet takes precedence
over same-VNet/direct-peering and automatic topology-chain shortcuts. None of
these checks asserts live Firewall rules, vendor SD-WAN behavior, HA health,
convergence timing or preservation of existing sessions.

The root owns one separate practice canvas in
`network-simulator:practice-workspace:v1`, including stable course/scenario IDs,
the native document, active/resume state and the normal return provider.
Normal document keys (`vwan-visual-topology:v1`, `aznet-visual-topology:v1`),
selection and preserved-original archives are not practice save destinations.
VWAN layout mode/positions and mixed-network node `x`/`y` coordinates remain
inside their respective native documents. Display preferences stay shared.
**Return to my design** and **Resume practice** keep independent undo/redo stacks
during the same page session; reload restores documents/layouts, not undo stacks.
An active saved practice resumes on ordinary reload. Explicit mode, sample and
shared-snapshot links take precedence and leave practice available to resume.
Panel reopen and instruction navigation do not reload a starter; only confirmed
starter loading replaces the previous practice canvas.

Initial practice persistence must succeed before a starter opens. Subsequent
save failures keep the latest practice in memory with a visible session-only
warning; it remains resumable for export before reload. Damaged practice is
preserved and blocks replacement until confirmed **Discard practice workspace**,
which deletes only the practice-canvas key, not drafts, achievements, preferences
or normal designs. An origin-wide exclusive Web Lock
(`network-simulator:practice-writer:v1`) now protects both practice persistence
and guided awards. A second tab remains a reader until the owner returns to its
normal design, discards practice or closes. Pausing the sidebar does not release
an editable practice canvas. Resume acquires ownership and adopts the latest
saved canvas only when this tab has no unsaved local edits. Missing/rejected
Web Locks fail closed for practice; normal designs remain available. Expected-raw
comparisons additionally refuse stale/old-client writes. No synchronization of
independently edited normal designs is claimed.

Guided history uses `network-simulator:learning-progress:v1`, envelope and award
policy version 1, bounded to 2,048 completion events and 1,000,000 characters.
Completion identity is `(courseId, taskId, assessmentVersion)`; first completion
per `(courseId, awardId)` supplies immutable historical points, including retired
tasks. Reassessment grants no duplicate credit. Current task/check identities
gate unlocks and mastery checkpoints; belt names/order, thresholds and checkpoint
identities come from the lightweight declarative course profile. Published point
changes never reprice history; changed thresholds/checkpoints may leave an honest
gap. Totals and belts derive from this ledger, never an incremented mutable total.

The shared header shows **Not signed in**, a labeled belt icon and points in
both native providers. Optional details show point/checkpoint gaps, storage scope,
single-writer recovery, first-award policy, backup, retry and scoped reset.
Damaged/unavailable records are not presented as zero earned credit. Quota-failed
accepted events remain session-only and exportable, never reported as durable.
Known conflicts refuse completion/advance and preserve originals. Confirmed reset
rechecks the confirmation snapshot and removes only guided history/points.
Status details and explanation bodies load on demand to preserve startup budgets.
The six-mission curriculum (#184) provides the complete local white-to-black
practice path, not Azure certification or evidence of educational effectiveness.
Independent subject-matter/novice evaluation remains #181/#160.
The original course/task/award identities and 175 first-earned preview points are
retained, as are the first 24 tasks' 550 points. Advanced gateway/WAN content
assesses diagnosis of preconfigured transit/intent, not an unimplemented
gateway/hub-configuration guidance adapter. Exact Default-table requirements and
both-direction Firewall waypoints prevent route-presence or bypass-only passes.
Exact current-route and forward/return checks, supported alternative repairs and a complete
real-control journey are covered by the learning unit/browser suites.
Complete EN and JA native-control journeys, plus keyboard transition and
dark/narrow/reduced-motion samples, are technical regressions rather than human
usability or learning outcomes. #181 records the qualification and #160 retains
the explicitly pending opt-in human study. Exact hub-table guidance (#204) and
a less-scaffolded transfer diagnosis (#205) remain tracked enhancements.

Retained legacy progress uses `aznet-simulator:practice:v1` in localStorage, independently
of normal topology saves: at most nine 200,000-character drafts within the existing
1,000,000-character aggregate storage limit, twenty recent
attempts per exercise and a retained latest practice achievement. Attempts
include rubric/grader versions, timestamp, engine revision fingerprint and hint
use. Partial, unknown, malformed, mismatched or cancelled evaluations cannot
award a practice pass. Historical achievements remain explicitly unverified;
older rubric/grader awards request reassessment rather than becoming current
certification. Finishing later unsuccessful attempts does not erase a prior
practice achievement.

The sidebar does not write or reset this legacy ledger. Retained
progress is per browser origin or Electron profile, **not encrypted,
account-backed or synchronized**. The status panel provides an original-byte
legacy backup; legacy attempts/drafts grant no guided-course credit. Guided
reset never changes those bytes or the visual workspace. No exercises/results are uploaded, no Azure
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

## Explicit public ingress and DNAT

Cross-premises VPN overlap NAT is a separate, bounded feature: see
[VPN overlap NAT](docs/VPN-OVERLAP-NAT.md) for native-provider boundaries,
gateway/connection inspectors, BGP translation and the optional `vpnPacket`
simulation contract. It does not enable VPN Internet breakout or legacy-v1 NAT.

The packet probe selects an original **public-IP frontend** separately from an
external Internet address. Standard static IPv4 VM frontends map to the original
private NIC address and preserve the client source. Associated subnet/NIC NSGs
must allow the private tuple; absent or default-only NSGs do not publish a
public VM listener. An arbitrary Internet-to-private-workload probe does not
select that mapping. NAT Gateway never publishes unsolicited ingress.

Original Firewall/NVA detail controls declare frontend allocations and bounded
TCP/UDP DNAT rules: explicit source CIDRs, unique rule priorities, frontend
ports, original workload/NIC/IP-configuration targets and translated ports.
First matching priority wins; unknown captured rules are not permissions.
Frontends may share the **same router's** SNAT pool or backing NIC association,
not another service's allocation. Editing and native save/load retain original
service, rule and target identities. Removing a target prunes dependent rules
without deleting shared frontend allocations.

Firewall public DNAT also translates the client source to an illustrative
address in its original **AzureFirewallSubnet**, preserving the source port.
Backend NSGs compare that subnet domain, not the Internet client or a predicted
instance allocation. NVA rules explicitly preserve the client source or SNAT to
the original private interface. Platform public-IP mapping and original NVA
inbound NSGs precede guest DNAT; outbound NSGs see its post-guest private tuple.
Public NVA VM interfaces require NSG permission too. Missing backing NICs remain
unassessed. A denial stops packet evidence at the enforcement stage while
retaining native routes.

Replies are conditional on this allowed new flow and must reach the original
translation owner before inverse mapping. Private source translation routes
back to that original interface/subnet; preserved-client NVA responses require
an actual route through the NVA. Black holes, bypasses, extra routers and
more-specific routes that distinguish possible Firewall instance addresses are
reported rather than silently applying an inverse. NAT Gateway's precedence for
**new outbound** flows does not replace an existing VM/router ingress-response
owner. Nothing certifies a listener, guest firewall, health or application
delivery, and there is no persistent/live session ledger.

Public VM mappings are retained in both native families, but native-v1 does not
invent an unmodeled direct NIC Internet return route. Appliance DNAT forwarding
and return assessment use native-v2 original appliances and routes. Secured-hub
private interfaces, private/forced-tunnel DNAT, multiple translating services,
IPv6 and vendor-specific policies remain
unassessed or separate work. Current cloud capture/Bicep and existing practice
rubrics do not claim these new declarations; #135 tracks their integration.
Candidate exercises include absent/default/explicit ingress NSGs, Firewall
source-subnet filters and preserved-client NVA asymmetry, not new graded badges.

Reference: [Azure Firewall NAT behaviors](https://techcommunity.microsoft.com/blog/azurenetworksecurityblog/azure-firewall-nat-behaviors/3825834).

## Original regional Standard Load Balancer

Optional `inventory.loadBalancers` retains one original VNet/spoke owner,
public **Standard static public-IP** or private subnet frontends, original
VM/NIC/IP-configuration backend pools, TCP/HTTP/HTTPS probes with explicitly
declared healthy/unhealthy/unknown status, ordinary TCP/UDP rules and affinity,
specific inbound NAT, and public outbound rules. Shared service and allocation
IDs survive native saves and subnet/detail views; deleting an original backend
or frontend prunes dependent associations rather than inventing substitutes.

Public initiation selects the original public-IP allocation from an explicit
Internet client. Internal initiation selects
`{kind:"load-balancer",loadBalancerId,frontendId}` from an original private
workload. It requires the existing native route to the private frontend and a
reachable, non-translating return to the original client. Frontends do not add
BGP/UDR routes. Backend-to-own-internal-frontend access is explicitly blocked.
Extra appliance/gateway translation stages are unassessed.

Each ordinary rule independently checks original backend addressing, declared
health and probe NSGs before displaying **known eligible** backends. Probe
transport filtering uses Azure's `168.63.129.16` source and TCP for TCP/HTTP/HTTPS,
not a simulated HTTP listener or live probe timer. An associated subnet/NIC NSG
must independently permit client data to the mapped private backend tuple.
Unhealthy/denied probes cannot select a new backend; missing health, address or
filter evidence remains unknown. Selection hashes stable original references
and the declared five-tuple/client-IP affinity for **illustration**, not Azure's
proprietary algorithm, an observed selection or existing-flow migration.

Ordinary non-floating rules preserve the client source and map frontend address/
port to an original backend. Inbound NAT targets its specific association without
consulting health probes. Only reachable symmetric responses conditionally
inverse-map the original frontend owner; return black holes and unsupported
additional translating routers cannot claim an inverse or application delivery.
Native-v1 retains private spoke frontend routing but does not invent direct NIC
Internet return/egress paths.

On native-v2 direct Internet routes, new-flow precedence is selected router/UDR,
then Standard NAT Gateway, instance public IP, and public LB outbound SNAT.
Explicit outbound rules use supported original primary IPv4 associations;
ordinary public rules may supply implicit SNAT unless disabled. Internal
frontends and inbound NAT alone supply no egress. Unknown primary role,
membership/rule completeness, incompatible or missing allocation and ambiguous/
unsupported coverage remain unassessed. Address/port allocation and capacity
are illustrative. Explicit outbound rules require disabling overlapping inbound
rule SNAT. This precedence never replaces an established LB ingress response.

Public HA ports are rejected. Direct frontend-destination HA/Floating IP
mapping remains unassessed; it is not ordinary DNAT. The separate bounded
UDR steering slice below preserves the original destination.
Basic/Gateway/global LB, IPv6, VMSS orchestration, proprietary hashing, live
health/sessions, SNAT exhaustion and L7/WAF are outside this slice. #135 still
tracks allowlisted Azure capture/import/Bicep and new graded-learning integration.

References: [components](https://learn.microsoft.com/en-us/azure/load-balancer/components),
[outbound rules](https://learn.microsoft.com/en-us/azure/load-balancer/outbound-rules).

### Bounded internal HA-ports NVA forwarding (#245)

Engine `2026.11.17.3`, native topology v2, contract 1 flow/route checks and
contract 2 packet predicates support one internal Standard LB/frontend/pool
and one floating HA-ports rule. Use the existing frontend's private IP as a
subnet UDR `VirtualAppliance` next hop. The rule declares `haPorts: true`,
`floatingIp: true`, protocol `all`, frontend/backend ports `0`, and
`haPortsForwarding: "preserve-tuple"`. The last field explicitly declares
modeled guest forwarding; merely importing an Azure HA-ports rule does not
establish that assumption.

Each pool member must retain original workload/NIC/IP-configuration identities
and match a single-NIC/single-IP `nva-vm` backing device's private IP/subnet.
The existing probe declarations supply unverified healthy/unhealthy snapshots;
probe NSGs are checked separately from client-data NSGs. Unknown eligibility
fails closed, and no known-eligible backend stops the new flow. Eligible members
are selected by stable original-ID order for illustration, not Azure hashing.
Disabling a selected NVA's forwarding does not silently change declared health.

Forwarding resolves the VIP to the original NVA without DNAT or SNAT and keeps
the route table's next hop as the VIP. Native `hops[].haPorts` and
`packet.haPorts` identify the frontend, rule, pool, eligible/selected original
backend and probe evidence. The packet view exposes both independently traced
legs, tuple preservation and symmetry; `requiredBackend` can bind that original
NVA backend. A different return NVA/bypass cannot pass the configured predicate.
Conditional response permission does not establish a live NVA session.

The original `tests/fixtures/ha-ports.ts` qualifies workload-to-branch and
workload-to-workload paths, declared standby selection, independent return
faults and an unaffected local witness. This is not a published learner mission;
curriculum guidance/questions and award compatibility remain separate gates.

Nonfloating HA ports, multiple frontends/pools/LBs sharing a backend,
multi-NIC/multi-IP backend layouts, additional backend NAT policies, chained
LB steering, Internet egress and ambiguous/missing original ownership remain
unassessed. No probes/timers, Azure hashing, convergence, backend OS readiness,
VMSS orchestration, state replication or session continuity are simulated.
Azure supports more layouts than this intentionally bounded first slice.

Reference: [HA ports and configuration-specific symmetry](https://learn.microsoft.com/azure/load-balancer/load-balancer-ha-ports-overview).

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
- `packet`: unique ID, a supported `packet` request, fixed original
  `sourceAddress`/`destinationAddress`, and `configured`/`blocked` expectation.
  Optional `requiredBackend` binds an original workload/NIC/IP-configuration
  triple and its exact private `address`. Place these goals in `requirements`,
  not the top-level simulation-only `packet` field. `configured` requires
  supported forward mapping/routing/filtering and a supported symmetric response;
  `blocked` checks proven initiation denial, not a broken or unknown response.
  Missing/changed identities and unknown health/allocation/policies never pass.

Each goal is `satisfied`, `violated` or `not assessed`, with evidence/reasons.
Missing or ambiguous ownership, unobserved imported controls, incomplete
convergence or unsupported inspection never become a passing grade.
Alternate valid designs are accepted against goals, not compared with one
reference JSON. Unknown top-level/request/goal fields are rejected.

These are steady-state configuration assertions, not observed Azure packet
delivery, runtime firewall/NAT/session enforcement, bandwidth/SLA or convergence-time guarantees.
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

Custom tables combined with routing intent and unsupported static hub next hops remain
not assessed in both VWAN providers. The bounded single-hub local Firewall subset
and per-direction inspection predicates are documented in
[static Firewall routing](docs/hub-firewall-static-routing.md). Unknown propagation and incomplete table
scope remain conservative; retained source is not proof of isolation. Bicep
starters explicitly warn about omitted hub policies, branch controls and NVA
peerings; native JSON/share URLs preserve them. Dedicated controls, legacy
documents, practice progress and all mode selectors remain available. Automatic
legacy-save/URL migration, unified defaults and selector retirement are #138,
not part of this capability bridge. Supported Internet egress and NSG packet
contracts are described here; public ingress and Standard Load Balancers have
their separate bounded packet contracts above.

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
Without supported translation, reply routing is a separate hypothetical probe.
Explicit direct Standard NAT Gateway (including public prefixes) and instance
public-IP egress expose illustrative SNAT tuples and `conditional-response`
inverse mapping, not unsolicited Internet initiation. Private subnet defaults
are preserved exactly; an Internet route without an outbound method is blocked.
Selected UDR/router/gateway routes precede source-subnet NAT.

Optional `inventory.routerSnatPolicies` reference one original `hub` or
`appliance`, never a copied router. `firewall-network-rules` supports Standard
static `publicIpIds`, optional `privateRanges` (default `IANAPrivateRanges`:
RFC1918 + RFC6598), and declared `zoneRedundant`. Custom exclusions replace the
defaults; never/always sentinels are `0.0.0.0/0` and `255.255.255.255/32`.
`nva-snat` declares one source/destination CIDR and TCP/UDP matching rule, with
explicit `sourcePrefixes`, `destinationPrefixes`, `protocol` (`tcp`, `udp`,
`any`) and router `publicIpIds`. Matching guest traffic SNATs to the original
private interface before its public outbound mapping.
NVA rules currently reference native-v2 appliances; legacy native-v1 site/spoke
NVA NAT remains unassessed. Known StandardV2 instance mappings are unsupported.
Unknown captured subnet NAT associations remain unknown even with a declared
NIC/router public pool; explicitly resolve the subnet association before
claiming an ultimate public mapping.

Classic non-zone-redundant Firewall + Standard NAT Gateway uses an illustrative
Firewall **private** handoff then the NAT Gateway public address, not two public
NATs. Router responses independently check routing back to the original NIC
after inverse translation, including declared static discard/next-hop rules.
Unknown allocations, multiple-router NAT, unsupported forced-tunnel translation,
custom Firewall exclusions combined with NAT Gateway, StandardV2/IPv6/NAT64,
application-rule proxying, dynamic ports/capacity/timers remain unassessed.
For private SNAT, the configured interface is only a representative of backend
allocation. Translation is `snat`, `none`, or `not-assessed`; `egress` separately
distinguishes configured, blocked, legacy-implicit and unknown behavior.
Public-IP association alone establishes neither inbound DNAT nor a listener.
Delivery and guest/firewall readiness remain not assessed; supported NSG denial
is reported separately from routing and translation.
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

### Original subnet/NIC NSGs

Optional `inventory.networkSecurityGroups` contain original `id`, `name`, `rules`,
optional `region` and `rulesStatus: "unknown"`. Rules declare unique names/IDs and
direction/priority pairs (100–4096), inbound/outbound direction, allow/deny,
TCP/UDP/any, source/destination IPv4/CIDR selectors and individual/ranged ports.
`inventory.nsgAssociations` bind one original `{kind:"spoke"|"vnet",id}` owner and
`{kind:"subnet"|"nic",id}` target to an `nsgId`, or preserve `status:"unknown"`.
No copied subnet/NIC or inferred association is created. Legacy optional absence
survives round-trip; removing an original target prunes its association, not
unassociated original NSG resources. Known GatewaySubnet/AzureFirewallSubnet
customer NSG associations are rejected; captured uncertainty remains visible.

`packet.nsg.forward`/`reply` report `allowed`, `denied` or `not-assessed`, ordered
checks, original owner/target, NSG/rule ID, priority, direction and five-tuple.
Outbound checks run NIC then subnet before public SNAT; inbound checks run subnet
then NIC on private tuples. Original NVA backing subnet/NIC checks surround
declared private guest SNAT. An unknown NVA interface/NIC or earlier translator
does not establish filtering permission. A deny stops packet-tuple evidence,
not the underlying native effective routes. `packet.security: "denied"` means
an NSG denies this new initiation; an NSG allow never certifies full security,
guest forwarding, a listener or application delivery.

Built-in defaults retain priorities 65000/65001/65500. VirtualNetwork is resolved
from original owner and native local/peering/BGP/UDR scope, never blanket RFC1918;
incomplete coverage remains unknown. Internet excludes known scoped VNet prefixes.
AzureLoadBalancer allows only explicit health-probe context, not arbitrary public
clients. Dynamic tags/ASGs and unsupported protocols remain unassessed, never
wildcard-allowed. Illustrative translated address/port domains are compared as
domains, not exact allocated values.

Each invocation is a fresh initiation against the current topology. For a fully
NSG-allowed flow, a response may reuse its bounded hypothetical flow record,
reversing known enforcement tuples without applying new reverse-initiation rules.
Unknown return translation prevents exact response NSG evidence. No persistent
session ledger, Azure state inspection or timer/capacity behavior is modeled.
Standard public VM/LB ingress's associated-NSG requirement is service-specific;
its context is not generalized to all internal/outbound flows. Standard LB
backend admission is service-specific, including internal frontends; actual
public ingress and LB forwarding use their separate bounded engines above.

The graded connectivity catalog includes explicit egress and separate LB
probe/client permission lessons. NIC-versus-subnet denial and response-versus-
reverse-initiation remain additional candidate lessons, not separate graded badges.

References: [NSG processing and statefulness](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview),
[ordered subnet/NIC processing](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works),
[service-tag scope](https://learn.microsoft.com/en-us/azure/virtual-network/service-tags-overview),
[Firewall subnet restrictions](https://learn.microsoft.com/en-us/azure/firewall/firewall-faq).

## Local MCP / Copilot skill

Prerequisites: Node 22 and a trusted checkout; dependencies are restored with
`npm ci`, then `npm run build:platform`. `npm run mcp` starts the standalone
stdio server. `.github/mcp.json` declares the repository-local server, launched
from this repository root after building. Review/enable it through your client's
trust flow; the configuration does not grant blanket permissions.

The simulation tools are `get_capabilities`, `get_schema`, `start_simulation`,
`get_job`, `get_evidence`, `cancel_job`. They provide native examples,
bounded JSON evidence chunks (up to 16,000 characters), explicit job status
and requirement assessments. Concatenate all requested chunks before parsing
JSON. Transport buffering is bounded independently of job admission.

### Animated flow artifacts

The path explorer offers **Export flow diagram** for an individual owned pair
in either native provider. GIF and animated SVG loops last 1.5 or 2 seconds;
PNG exports a still frame. Both clients use the same logical export scene and
motion geometry, rather than a screenshot of the interactive canvas. Firewall
inspection is expanded as a separate node. Forward/return evidence is independent;
unknown legs have no moving traffic, and blocked legs stop at their last
evidenced node. Up to six directional alternatives are shown without choosing a
favorable ECMP path. Longer paths are rejected rather than silently truncated.
The view does not expand physical interfaces or gateway internals.

MCP workflow:

1. Evaluate an explicit `flow` requirement and retain its job handle and ID.
2. Call `start_render` with `handle`, `assessmentId`, and optional
   `options: {format: "gif", durationMs: 2000, width: 1200}`.
3. Read `get_render_job` until finished; it reports the source engine/revision,
   assessment outcome, per-leg logical nodes, artifact length and SHA-256.
4. Fetch `get_artifact` byte chunks (maximum 12,000 bytes). **Decode each base64
   chunk separately**, concatenate decoded bytes in offset order, then check
   total length and SHA-256. A caller may deliberately save the result.
5. Use `release_render` after retrieval; `cancel_render` cancels unfinished work
   without changing the source simulation.

Rendering is optional and isolated from routing computation. Node uses a bounded
worker with local resvg rasterization and gifenc encoding; no browser executable,
HTTP listener, remote rendering service or shell encoder is required. The web
client uses a local Canvas raster and the same scene/frame/encoding logic.
Static content is rasterized once; only circle pixels change between frames.
GIFs use 20 fps (30 or 40 frames). SVG/PNG require no GIF encoding.

The codec has its own lazy bundle, and capability discovery imports only the
small options contract, not rendering geometry. Export controls remain available
with the workspace when offline; rendering/encoding is loaded on deliberate
export. Measured workspace startup is about 322 KB local gzip with these controls,
so its browser regression ceiling is 325 KB (previously 320 KB). The 140 KB
entry-only ceiling and 1.2 MB raw workspace ceiling are unchanged; both startup
graphs explicitly exclude the GIF codec.

Render limits: width 640-1400, at most ten nodes per lane, 8 MB output,
one active render, four retained handles, 30 seconds per job, ten-minute expiry.
Release artifacts to free retained capacity. Expiry/cancellation never certifies
a flow. Only existing result handles are accepted: no arbitrary HTML, URLs,
filesystem paths, UI mutation or uploads. Labels are XML-escaped.
Explicit browser downloads do not overwrite or import a topology.

Every artifact is **illustrative routing evidence**, not a packet capture,
Firewall permission/session test, live delivery guarantee or latency prediction.
Animation duration is presentation-only. Raster font appearance can differ by OS.

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
releases. The root `package.json` supplies the semantic app/installer version,
starting at `0.1.0`; its installer is `Azure-Network-Simulator-0.1.0-x64.exe`.
Windows resource versions use `0.1.0.0`, and CI verifies those actual resources
and the packaged runtime. Commit a source version bump before building a new
release; publication never changes versions or tested bytes. Publication is a separate manual
promotion of the tested candidate, not an effect of merging or packaging.
See the [release runbook](docs/releasing.md). The application and installer use
the repository's Windows icon resources.

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
The broker/wrapper also override child-process CLI usage telemetry and file
logging to disabled without changing the user's CLI configuration. Chromium
proxy discovery is disabled for local assets; Azure CLI's separate enterprise
proxy settings remain intact.

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

### Complete bounded diagnostics measurements

`npm run benchmark:diagnostics -- <output.json>` retains the declared 500/1,000-prefix
source-star and ECMP/N-1 workloads, bounded continuation and wide-reference parity.
`DIAGNOSTICS_ROOT` selects frozen baseline source without changing the harness.
`node scripts/compare-diagnostics.mjs <baseline-source> <baseline-dist> <candidate-dist> <output.json>`
runs six serial alternating SSR pairs and four actual production-browser worker pairs.
It requires clean committed source, verifies immutable artifacts and complete report,
workload and budget identities, and retains individual runs and descriptive ranges.
The browser fixture supplies a valid hub region for native import; its report hashes
are compared separately from SSR. Browser timing includes continuation, rendering and
worker message copies; batch-boundary heap samples are not a true peak-memory bound.
Closed affected-flow disclosures defer DOM mounting, not assessment or report evidence;
expanding them restores every flow and directional trace. Scenario-local parsed route
ranges preserve longest-prefix selection without sharing state across failures.

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
and first inactive-workspace latency, first Japanese switch, and a fresh-context
Japanese initial workspace. `PRODUCTION_ROOT` selects an existing
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

The default-English entry and settled workspace local-gzip budgets are now
130,000 and 300,000 bytes respectively (the existing 1,200,000-byte workspace
raw ceiling is unchanged). The shared Japanese catalog loads only for a saved
Japanese preference or an explicit language switch; Japanese startup waits for
it before rendering the workspace. A pending/failed switch preserves the current
language, originals and drafts, with explicit reload recovery. Already-loaded
languages can switch while offline; this is not offline fresh-navigation support.
Japanese startup and first-switch costs are measured separately, not counted as
an improvement to the English budget.

`node scripts/compare-production.mjs <baseline-dist> <candidate-dist> <output.json>`
runs the same measurement harness against immutable artifacts in twenty alternating
AB/BA pairs, isolating each invocation in a fresh browser process. It preserves raw
runs beside the summary, full raw timing arrays, nearest-rank p95, environment
qualifications and artifact hashes. Run it without concurrent local tests/builds.

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
The [desktop operations runbook](docs/desktop-operations.md) assigns repository
maintainer runtime/dependency patching responsibility and response targets,
separates embedded Node/Chromium from system prerequisites, and defines
enterprise install/update/rollback/retention qualification. Named owner/backup
acceptance, target-environment installer lifecycle tests and release approval
remain production gates, not results of packaged-app smoke tests.
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
It also launches real Electron for the offline application-contract workflow.
On display-less Linux runners, run it as
`xvfb-run -a npm run test:e2e -- --workers=2`; the matching Playwright Docker
image used by CI includes Xvfb. Headless Chromium alone does not provide the
display required by Electron. The test itself remains enabled and unchanged.
Native application inventory admission stays on the synchronous import path,
but request/evidence evaluation and detail-only Japanese catalogs stay with
their lazy inspection UI. Both the entry and active-workspace production
asset budgets remain enforced by the existing production smoke suite.

`npm run test:desktop` launches actual Electron and checks three-mode engine
parity, native JSON import/export/persistence, immediate HRP UI reevaluation,
existing local diagnostics workers, packaged offline assets, narrow bridge,
renderer Node isolation, disabled outbound integrations and remote-fetch
blocking. The same harness accepts `DESKTOP_EXECUTABLE` to test ASAR packaging
and the external worker resource. It does not authenticate to Azure.
Windows CI builds/tests unsigned NSIS development candidates; Ubuntu retains
the existing web quality gates. Neither job deploys or publishes on merge.
The separate manual **Release** workflow verifies an exact successful main-push
CI run/attempt before promoting its tested bytes. Both jobs must pass for any
release target. Its default preflight has no production side effects; see the
[release runbook](docs/releasing.md) for explicit deployment and publication.

`npm run test:desktop-network` adds an actual Chromium startup-to-shutdown
net-log check, reachable loopback/PAC canary and HTTP(S)/WS(S) probes for both
the app and bridge-free documentation. It also checks the session HTTP(S)
filter independently of CSP. It accepts `DESKTOP_EXECUTABLE`, retains only
synthetic summaries, and deletes its raw log/profile. This is not an OS-wide
trace or live Azure CLI endpoint evidence. See the operations runbook for the
explicit authenticated-capture scope and enterprise network-acceptance gates.
