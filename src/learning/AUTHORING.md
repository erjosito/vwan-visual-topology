# Guided course authoring contract

For the consolidated product feedback, pedagogical requirements and reusable
review checklist, see [Curriculum review guidelines](../../docs/curriculum-review-guidelines.md).
Use that document for the current review baseline; edition-specific descriptions
below also include historical implementation details.

For curriculum readiness criteria and learner-experience guidelines, including
requested changes that may not yet be implemented, see
[Curriculum readiness](../../docs/curriculum-readiness.md).

The `course-*` files define declarative content (#179); importing them does not
execute tasks. The protected canvas (#182), non-modal sidebar/guidance (#178)
and evidence-gated runner (#180) activate sequential assessed missions.
The original edition has 40 tasks across six missions and 1,325 points; the
scenario edition has 75 tasks across eleven missions and 2,355 available points.
Its first eight missions retain the 1,575-point black-belt threshold and
mastery checkpoints; hybrid/multi-hub specialist practice and the final handover
challenge complete the journey without introducing a higher belt or demotion.
The root owns the runner across editor switches and pause/resume. A bounded
browser-local ledger (#183) restores compatible completions after reload and
derives first-earned points, checkpoint-gated belts and the header status.
The curriculum is authored under #184. No legacy JSON draft, raw requirements or
engine payload is shown; legacy storage stays untouched.

## Revised Azure networking journey

`curriculum-v2.ts` publishes `azure-routing-v2`: 72 assessed tasks in twelve
linear chapters, 1,345 XP and a checkpoint after every chapter. The order is
private peering, Azure Firewall/UDRs, introductory Standard Virtual WAN,
secured private Virtual WAN, static VPN, VPN BGP, ExpressRoute foundations,
ExpressRoute location resilience, ER/VPN backup, two-snapshot NVA HA,
multi-hub segmentation and an independent-fault handover.
Azure Route Server is an ungraded architectural comparison in the HA chapter.

Preparation is explicitly `ungraded`: loading and consent cannot earn XP.
After explicit Next, the same-course protected workspace prepares the next
chapter and presents its first substantive task. Native actions and fresh,
visible inspections supply evidence; quizzes still require explicit submission.
Verification inspections can also require the complete live-engine assertion
set, so an already repaired topology alone does not earn a separate viewing award.
C04's private-intent and attach-service assessments are version 2: they require
policy-managed Default association and None propagation, not manual Default
propagation. Existing award identities/prices and checkpoint versions are unchanged.

The small eager `curriculum-v2-profile.ts` owns identity, checkpoints and XP
thresholds. Teaching, native starters and stage narratives stay lazy in the
other `curriculum-v2-*` files. Reusable checks contain declarative native-field
expectations, original resource scopes and explicit engine requirements, never
per-lesson grading callbacks. Selected transport checks can bind an original
destination address; it must belong to the declared prefix and its native
lookup must select the expected original gateway.

The milestone ladder alternates mixed and full colors: White/yellow, Yellow,
Yellow/orange, Orange, Orange/green, Green, Green/blue, Blue, Blue/brown,
Brown, Brown/black and Black. Mixed milestones celebrate inline; full colors
retain the bounded, reduced-motion-aware dialog. Historical highest belts use
normalized color ranks, not incomparable edition-specific array indices.
Opting into v2 retains archived XP, first-award prices and earned belts without
granting any v2 VPN, ExpressRoute or HA competence.

Gateway and aggregate ExpressRoute-location tables are distinct evidence
scopes. Static VPN routes do not imply a BGP session. C06 prepares gateway BGP
capability and changes the exposed connection toggle. C10 requires the same
original packet and VIP steering in both declared health snapshots, not live
health probes, measured failover or stateful session continuity. All exercises
assess modeled routing, not firewall policy enforcement or application delivery.

## Track scope and compatibility

The playable track is displayed as **Routing foundations**. Its historical
`azure-networking-preview` course ID, award/check identities,
40 tasks, 1,325 points and stored practice/progress formats remain unchanged.
The original edition publishes presentation version 7; scenario version 9 includes
foundational practice, staged repairs, a changed-address completion challenge and
explicit belt-stage introductions.
Checkpoint assessment versions and first-earned awards remain compatible.
The first scenario's opening task uses assessment version 2: loading prepares
the workspace, but its existing five-point award requires a fresh inspection of
Application's local route. Earlier loading awards remain saved and are not
re-awarded or announced as new XP when this revised assessment is completed.
Checkpoint versions and belt thresholds are unchanged. Shared scenario background
is expanded initially and collapsed on later tasks; its local completion counter
uses the same assessment-qualified task history as the main progression.
Runtime inspection helpers live in schema-free `task-guidance.ts`; importing
`course-contract.ts` at runtime would eagerly load Zod and its schema construction.
Keep original task instructions and completed quiz question/answer visible above
the debrief, including during review. Hub-peering guidance explains the expected
unfinished inspection-routing diagnostics without hiding or blanket-dismissing errors.
The historical `inspection-bypass.predict-subnet` task now teaches routing versus
security permission instead of repeating a hypothetical /24 discard. Its assessment
is version 2; its award and price are unchanged. Teach/refer to firewall and NSG
policy first, while explicitly retaining the simulator's policy-enforcement limitation.
Give each new practice task a distinct learning purpose. Reinforce familiar
concepts inside new configurations rather than repeating standalone drills.
Renaming the presentation is not a migration or a grading revision.
`tracks.ts` is a small declarative catalog; **DNS and name resolution** and
**Application delivery** are **Planned** informational entries, with no course
binding, points, unlocks or start actions. `TrackOverview` is shared by the
on-demand status details and sidebar. The eager header uses only lightweight
course metadata; it must not import the catalog or overview.

The new header shows the highest checkpoint-qualified belt across published
editions, independent of enrollment. Editions with the same `trackId` count
once; an `xN` suffix appears only when multiple distinct tracks share that
highest belt. Planned tracks and unknown course completions do not count.
The tooltip/accessibility label explains the track count; status details
retain the selected edition's separate belt and points.

Belts describe checkpoint-qualified core progress, not completion of every
specialist task, all Azure networking or professional certification.
`belt-stages.ts` authors localized stage titles, introductions and recap topics.
Each stage ends at its existing belt checkpoint; the runner tests check those
boundaries against the actual ordered tasks. Introductions augment the opening
debrief, while the sidebar names the current stage and status details provide a
read-only stage outline. Changing this presentation does not change grading.

Remaining XP belongs to the selected edition, not the highest historical belt.
Zero remaining XP with an unmet checkpoint says to finish the stage, rather than
claiming a promotion. The runner emits a belt achievement only after an accepted
task completion raises its checkpoint-qualified rank. Replay, hydration and
progress replacement do not emit events. Failed writes that retain an accepted
session-only award can celebrate; rejected writes cannot. The notification belongs
to the runner's held debrief; dismissal is session-only state and does not advance
the task. The native dialog and topic copy stay in the optional learning UI,
not normal startup. Confetti is decorative, bounded
and disabled by reduced-motion preferences. Reload retains the award but does not
replay a dismissed or pending notification.
Native route explanations import only `explain.css`. Keep sidebar and belt
styles in the optional `LearningDialog` import of `learning.css`; importing
that stylesheet through `Explain` would load the learning UI styles at startup.

The full-journey task counter and final completion screen remain separate from
the scenario edition's eight-mission core black belt. Available-course denominators and
XP exclude planned tracks; future tracks must use their own course identity.
Existing first awards and recorded content/assessment versions remain intact.
Future additions need an explicit compatibility review: expose compatible new
material as new modules, or scope incompatible belt requirements to a separate
extension/edition while retaining historic achievements. Do not silently change
published thresholds/checkpoints and thereby revoke an earned belt. This slice
adds no automatic historical credit. For the beta HA extension (#222), the user
explicitly waived preservation of previous curriculum sessions. Scenario content
version 2 therefore extends the existing course rather than creating another
edition or session migration: all earlier task/award IDs and first-earned points
stay unchanged; the new six-task HA mission adds 250 points. The current black-belt
requirement is now 1,575 points plus the HA explanation checkpoint. Earlier
completion records are not deleted or rewritten, but do not grant HA credit.
Normal saved designs remain protected. This is an explicit beta exception to the
published-threshold policy above, not a general migration policy.

`editions.ts` is the lightweight edition catalog. Fresh learners start
`azure-routing-v2`; the original and scenario editions remain playable archives.
Historical original-course completions
retain the original edition unless the learner explicitly opts in through
**Progress, review & options** or header status details. A retained original practice
canvas also retains its edition when no enrollment/history selects otherwise.
The optional `enrollment` field extends the existing v1 ledger; old backups
remain readable. Enrollment uses the same exclusive writer/CAS protection as
awards. Switching editions neither loads a starter nor rewrites achievements.
The original belt and points remain visible separately after opting in, and
switching back restores the original journey. Reset explicitly clears all
editions' progress; it is not an edition-switch mechanism.

`runner.ts` is the single progression authority. Supported check kinds dispatch
to reusable checks, never lesson-ID branches. A passing candidate is bound to
course/content/task/assessment identity, runtime session, practice scope and a
monotonic live-editor revision. Automatic completion rechecks that binding,
records one scoped completion event and holds the completed task for its debrief.
Only **Next** opens the next unmet task. Edits
(including edit/undo), replacement, provider/active-practice changes, cancellation,
review and replay cannot reuse pending or previous evidence. Shared-worker
requirements must have an exact, complete assessment set; unknown, unsupported,
failed or cancelled evaluation never passes.

The visible, active sidebar debounces committed network edits before checking
them, records a successful check once and shows its explanation with the awarded XP.
It never makes a repair or commits a quiz answer. Initial entry, explicit restarts,
and returning from a normal design still require loading confirmation. After
**Next**, a new mission loads automatically only into an active same-course
practice workspace. Its introduction/debrief remains visible until another
**Next**; loading must never skip that teaching step.
Pause, hidden tabs, review, recovery confirmations and expanded secondary options
stop automatic work and invalidate unrecorded proof. An already awarded debrief
survives pause, documentation-tab visits and later canvas edits: **Next** is a
reading acknowledgement, not new grading or credit. Reload restores awarded
history and resumes the first unmet task; completed explanations remain reviewable.
Unknown results do not retry in a
loop; retry is offered only for assessment or recording failures.

**Show me where** navigates without itself reporting evidence. A native route
inspector reports only after its entire requested prefix text (or the exact table
when the prefix is genuinely absent) is visibly readable for a stable interval.
A visible adjacent cell in a horizontally scrolled row is not inspection.
Closed, filtered-out, off-screen, occluded, loading, wrong-scope and inactive views
cannot report. Hub-table coverage must still be complete. Its short-lived token
is task/session/revision-specific; repeated use of the same check definition in
another task requires a new observation. There is no Record inspection button.
Quizzes separately check interpretation after deliberate **Submit answer**,
with answer-specific feedback and free retries. Correct-answer explanations stay
visible until **Next**, including on the final task before the completion screen.
Past completion does not certify the current canvas. Completed tasks can be
reviewed, future tasks remain locked, and explicit lesson replay rechecks each
step without deleting history or emitting repeat completion credit.
Visible **Back/Next** controls review completed explanations without replacing the
live practice canvas or emitting awards. They are not per-step topology time
travel: no snapshot restoration or silent undo occurs during review.

Order each task's `guidanceIds` deliberately: the first is its one primary
**Show me where** action. Staged peering/UDR configuration follows the next
unfinished native scope automatically; this chooses navigation, never credit.
Keep this task selector in the optional sidebar's `task-guidance.ts`, not the
shared `guidance.ts` imported by native workspace controls, to preserve startup budgets.
Other targets are named with their localized guidance
instruction under **Progress, review & options > Navigation help**. Choosing
a secondary target closes options so automatic checking can resume. The primary
action preserves an explicitly opened options pause. Author only relevant
repair scopes rather than enumerating every VNet and table. Conceptual `hints`
are separate from navigation: nested disclosures reveal one level at a time,
starting with a reasoning prompt before a more concrete suggestion. Neither
kind of help costs XP or changes the network.

## Version 7 concept and assessment map

`scenario-foundations.ts` inserts content-only prerequisites into the existing
practice networks. Its staged tasks use the same native configuration checks as
other lessons; the runner has no lesson-specific grading branches.
The seven inserted tasks and six-task `routing-handover` mission use new award
IDs. The prior 62 award IDs, first-earned points, assessment versions and belt
thresholds/checkpoints are retained. Earlier completions do not manufacture
credit for inserted work; historical black belts are not retracted.

| Concept | Introduction | Practice and interpretation | Later application |
| --- | --- | --- | --- |
| Address owner, VNet and subnet range | First route debrief | `private-link.address-range` | Different owners and /24 ranges in `routing-handover` |
| Missing exact route, private discard, /0 default | `private-link.default-route` | `private-link.predict-default` | Selected None route in the handover |
| /8, /16, /24 and two destination lookups | Private-default debrief and hub briefing | `inspection-bypass.predict`, `.predict-subnet`, `.inspect` | Handover repair and final explanation |
| Equal-prefix UDR preference and separate reply | Hub policy introduction | `.forward` prepares the request; `.repair` requires both directions | Appliance-chain and handover outcomes |
| Whole-VNet scope, non-overlap and route versus permission | Private repair debrief | `.subnet-scope`, `.access-setting` | Handover's working Operations comparison |
| Peering forwarded-traffic permission versus NIC forwarding | `dedicated-chain.load` | Dedicated-chain repair and explanation | Tiered-chain outcome checks |
| Gateway sharing, BGP learning and subnet propagation | `branch-advertisement.load` | Branch repair, GatewaySubnet return inspection and explanation | ER/VPN specialist practice |
| Ordinary hub VNet versus managed Virtual WAN | Hub introduction and `wan-isolation.load` | Source association, service propagation and isolation checks | Multi-hub destination labels |
| New tier versus existing conversation | `tiered-incident.load` | `.entry` prepares departure; `.repair` diagnoses remaining transit | Final handover drops the prescribed repair |
| Routing snapshot versus session/failover evidence | HA introduction and packet diagnosis | Original tuple, independent backend and reply checks | Hybrid withdrawal explanation |

Routing intent has a scoped introduction and official reference in the default
WAN debrief, not a new secured-hub configuration assessment. The original
edition retains its dedicated routing-intent practice. Internet/NAT/security
policy, DNS and application-delivery competence are not implied by this course.
Replacing a snapshot now explains the architectural change and preconfigured
pieces; only the initial private-to-hub transition extends learner objects.

### Handover qualification rubric

The final small network changes owners, addresses, subnet boundaries and the
fault's location from earlier guided repairs. Its learner-facing setup states
the failed app/service conversation and protected outcomes, not the faulty rule.
Free navigation opens both endpoint tables/policies without targeting the bad
UDR. Optional conceptual hints and retries remain available.

The authored qualification is explicit:

- The starter's request reaches Supplier; its independent reply selects a
  more-specific /24 discard. The /16 peer candidate remains visible.
- Local Orders-to-Operations and Supplier-to-Operations conversations work.
  Orders and the tenant cannot initiate to each other.
- Disabling/removing the obsolete rule or removing its subnet association are
  qualified alternatives. No single edit is required by the outcome check.
- Editing the unrelated source policy is a non-fix. Breaking Operations,
  opening a tenant peering or changing endpoint address ownership cannot pass;
  unassessed ownership never earns success.
- A new post-repair observation and explanation compare the /24 app destination
  with the unaffected Operations subnet. Completion is not an exam endorsement.

Engine fixtures and EN/JA native-control journeys qualify runnable practice,
not independent human review. The author reviewed the wording in each language
and varied original-edition option order while preserving choice IDs, feedback
and grading. Answer-blind technical/style and native-language reviews remain
open under #219; transfer, retention and novice observations remain under #160
and #205. A fixed replayable challenge with free hints is not evidence that a
learner can diagnose a novel incident unassisted. Studies must record assistance
separately rather than interpreting route inspection or XP as comprehension.

## Scenario context and teaching

Every published lesson needs a bilingual `context`: a short fictional situation
and a meaningful networking goal, visible alongside the active assignment.
Every task needs a `debrief` containing one to three localized teaching paragraphs
and one to three titled HTTPS Microsoft Learn section references. References open
only when selected, in a new tab with `noopener noreferrer`. They never load
automatically. Author-time validation rejects missing teaching, untranslated
paragraphs, nonofficial URLs and links without a topic fragment.

`course-teaching.ts` assembles shared topic explanations and per-lesson stories
for both editions. It generates unambiguous inspection instructions from each
native check's actual VNet/subnet, hub/table or branch scope. The first subnet
inspection teaches effective routes, prefix membership and the local/peering
next hops; policy and gateway concepts are introduced later. Hybrid and multi-hub
steps have distinct observation, repair and return explanations. Outcome-graded
repairs must not assert that a learner used an unrequired canonical action:
label an illustrative configuration as a worked example. Later debriefs explain
the mission's routing principle rather than claiming unobserved live results.
Authors can supply a lesson's context or a task's debrief directly to override the
shared defaults. New missions need a story/topic entry (or explicit teaching),
not a runner branch. Keep grading, assessment IDs and historical awards separate
from presentation changes. The runner must never choose theory by lesson ID.

`scenarios[].extendsScenarioId` can extend the immediately preceding mixed-network
scenario. `course-transition.ts` preserves the learner's current network and
connections, adding the next template's new VNets, new route tables and their
subnet associations. It does not import template peerings, UDR entries from other
tables, or replacement versions of existing objects. Colliding IDs/custom subnet
policies fail without replacing the saved draft; an explicit confirmed restart
can load the standalone template instead. Normal designs, another course and
unrelated practice scenarios are never used as an extension source.

The peering mission now tests whole-VNet subnet scope and access permission
separately, after teaching both. The first hub mission adds an unconnected hub
with a firewall and empty workload route tables to the existing network.
`peerings.configured` checks the two native connections before
`udrs.configured` checks enabled VirtualAppliance UDRs on the actual associated
subnets. Both retain shared-engine witness/isolation checks. Learners build the
broad policy before inspecting longest-prefix selection and repairing the
inspection path. The four added tasks have new IDs/awards (+45 available XP);
existing IDs, first-earned point amounts and belt thresholds/checkpoints do not
change. Beta sessions may reset, but historical awards are never repriced.

The root's `openPractice({ courseId, scenarioId, document }, signal)` session API
accepts a copied native scenario after explicit confirmation; it does not look
up lesson names or hardcode the curriculum. Opening/selecting lesson content must
not invoke it implicitly. Resume the existing canvas instead of loading its
starter again. `practice-workspace.ts` owns the separate canvas envelope; it is
not the course progress/award ledger. `practice-session.ts` loads only when
practice exists or is explicitly started, keeping the controller and full course
off the normal startup asset graph. The header reads only lightweight course
metadata and the local ledger; details and concept bodies load on demand.
See `PLATFORM.md` for exact persistence,
return, recovery and same-session history behavior.

## What goes where

| File | Edit for |
| --- | --- |
| `course-outline.ts` | Full journey objectives and reviewed point budgets |
| `course-profile.ts` | Lightweight course identity, order, belts/thresholds and checkpoint assessment identities shared with the header |
| `course-examples.ts` | The original two localized missions and central content assembly; historical export name retained |
| `course-routing.ts` | Localized longest-prefix and gateway-return missions, checks and guidance |
| `course-wan.ts` | Localized secured-WAN and hybrid-capstone missions, checks and guidance |
| `course-scenarios.ts` | Native starter documents; copy before editing |
| `editions.ts` | Lightweight edition identities, scenario order, belts and cumulative mastery checkpoints |
| `scenario-course.ts` | Localized scenario objectives, balanced diagnostic choices, requirements and native guidance |
| `scenario-topologies.ts` | Independent original scenario-edition starter documents |
| `hybrid-scenario.ts`, `hybrid-course.ts` | Original ER/VPN fixture and the appended hybrid incident |
| `multihub-scenario.ts`, `multihub-course.ts` | Original two-hub fixture and destination-label incident |
| `scenario-course.test.ts` | Actual-engine starter failures, valid repairs, preserved witnesses and independent faults |
| `course-contract.ts` | A genuinely new reusable task/check/action shape |
| `course-validation.ts` | Validation for a new shape/scope, not individual lesson IDs |
| `course.test.ts` | Content validation and real-engine failure/solution fixtures |
| `runner.ts`, `runner.test.ts` | Reusable progression, current-revision checks, completion events and cancellation |
| `progress-ledger.ts`, `progress-ledger.test.ts` | Bounded local completion history, compatible first awards, points/belt derivation and storage recovery |
| `practice-ownership.ts` | Exclusive origin-wide practice/award writer ownership |
| `content.ts`, `concept-bodies.ts` | Concept summaries/references and lazily loaded explanation bodies |

Use declarative TypeScript data and the existing `{ en, ja }` convention. No
callbacks, scripts, CSS selectors, translated-label matching or synthetic clicks.
The Zod discriminated unions are the typed registry of supported semantic check
and action IDs. `guidance.ts` resolves registered actions to scoped
semantic anchors; the mixed editor reveals them using its own selection,
route-inspection and context-menu handlers. `TopologyContextMenu` carries command
identity separately from translated labels. The sidebar has no lesson-specific
branches and executes no assessed edits. `GuidanceHighlight` outlines the exact
visible registered targets without touching routing/path classes. Missing or
disabled controls get a localized reason; closed/moved inspectors can be
revealed again explicitly. Adding a supported control requires its resolver,
native reveal adapter and anchor, never a lesson-specific sidebar branch.

## Scenario-edition ladder

| Mission | Points | Architecture and assessed repair |
| --- | ---: | --- |
| Private application link | 100 | Direct VNet peering; preserve local operations and restricted-network isolation |
| Inspection bypass | 125 | Delivered but uninspected traffic; longest-prefix steering in both directions |
| Co-located appliance chain | 200 | Firewall and SD-WAN in separate subnets of one hub; onward subnet policy |
| Dedicated appliance VNets | 250 | Firewall and SD-WAN in separate VNets; IP forwarding and independent return order |
| Branch advertisement | 200 | Gateway route propagation into workload subnets; learning versus attachment |
| WAN isolation | 200 | Exact hub-table evidence, connection propagation and positive/negative witnesses |
| Tiered incident | 250 | Indirect spoke with two independent faults; preserve the existing application conversation |
| HA return path | 250 | Tuple-preserving floating HA-ports steering, independently routed return, original backend and Operations witness |
| Hybrid preference | 250 | Equal-prefix ER preference, VPN specificity, declared ER withdrawal and independent branch return |
| Multi-hub labels | 250 | Destination-label import, independently scoped source/return tables and connected-tenant isolation |

Each mission is linear: explicitly load, inspect an exact starting scope,
repair an open networking requirement, inspect the independent return scope,
then explain a design/diagnostic decision. Task points are 5, 5,
`mission budget - 35`, 5 and 20. Thresholds are 0, 100, 225, 425, 675, 1075
and 1575; cumulative interpretation checkpoints gate each belt. Brown requires
both the branch and WAN missions; black also requires the HA explanation.
HA adds a 25-point packet diagnosis before repair, reducing its repair to 190
points. Its six tasks award 5, 5, 25, 190, 5 and 20 points respectively.
The nine-task hybrid extension awards 5, 5, 65, 10, 25, 80, 10, 10 and 40
points. Existing thresholds, checkpoint IDs and first-earned awards are unchanged;
its new awards do not grant earlier tasks automatically.
The eight-task multi-hub extension awards 5, 10, 10, 25, 150, 10, 10 and 30
points. It follows hybrid practice without changing black-belt requirements,
old task/award identities or first-earned points.

Native guidance can reveal VNet configuration (`network.configure`), an
associated UDR table including an empty one (`route-table.configure` without
`routeId`), hub configuration (`hub.configure`) or an exact hub route table
(`hub-routes.open`). `packet-probe.open` opens an owned VNet detail dialog and
highlights its native packet form, including inside the dialog top layer. It
does not select endpoints, submit a probe or modify the topology; learners
choose and run their own tuple and close the detail dialog to resume the lesson.
These actions locate controls without making repairs.
Hub-route guidance can name an exact prefix: all matching candidates in the
original hub/table scope are highlighted, with the exact table as the fallback
when absent. Repeating guidance reopens that table and clears stale display
filters; it never substitutes the Firewall onward view or another table.
Unknown route-table capture gets explicit feedback, not a successful location.
The original secured-WAN and capstone verification tasks use this navigation
without changing their assessments, task identities, points or stored awards.
`connection.configure` reveals the original ER/VPN native editor without saving
or changing its enabled/BGP flags. `site-routes.open` reveals an original site's
received routes. `control-routes.inspected` requires an exact site/prefix or
hub/table/prefix observation; a different table, Firewall onward view or stale
token cannot substitute. Existing subnet observations remain distinct.
`connections.configured` binds enabled/BGP state and original connection
endpoints, asserts selected exact-prefix gateway rows from the shared engine's
native effective-table evidence, and requires complete shared flow/route
assessments. It does not infer a transport from delivery or implement another
route-selection algorithm.
`hub-associations.configured` retains each declared original enabled VNet
attachment, its hub and configured associated table, then requires the exact
complete shared assessment set. It prevents detachment, unknown association or
an unrelated table's routes from substituting for connected-tenant isolation.
It does not prescribe propagation edits or compute another routing result.
The existing exact-route action remains available when a specific row is
the intended observation. Requirements, not a prescribed edit sequence,
grade repairs. Preserve positive and isolation witnesses when adding cases.

Ordered chain checks require separately authored forward/reverse appliance
IDs. They assess complete modeled forwarding, not live security rules,
vendor overlay behavior, HA health/orchestration, convergence timing or
session failover. Missing/unknown owners and unsupported providers cannot
pass. Richer HA, BGP/export policies, subnet-scoped peering lessons and unsupported
WAN connection controls remain capability-gated follow-up work; these eight
cases and the hybrid/multi-hub extensions do not claim exhaustive book/blog coverage.

## Multi-hub routing qualification (#225)

The original `multihub-labels` fixture has two unsecured hubs, different local
custom-table IDs and four original enabled VNet attachments. West application
and West Operations use `west-workloads`; East shared service uses
`east-services`; the connected restricted tenant uses `tenant-only`.
The starter's West destination label `Shared` differs from the original
connections' `shared` propagation label. Explicit local table propagation seeds
the application export, so East already contains the application's return route;
West lacks the service route. This is intentionally not a union of hub tables.

Current shared engine `2026.11.18.2` qualifies two native alternatives: change
the West table's label to `shared`, or include its existing `Shared` label in
the East service connection's propagation. Both retain independent source and
return routing, West Operations and forbidden initiations in both directions
between West application and the restricted tenant. Four exact hub-table
presence/absence goals and a separate Default-table absence goal supplement the
four original-endpoint flow goals. Original attachment/association checks remain
separate from those routing outcomes, so removing the tenant is not a repair.

The already-running local MCP uses older engine `2026.11.16.2`: native validation
completed without errors and all nine repaired-case assertions were satisfied.
Its complete evidence shows forward `west-workloads` → `east-services` and the
independently evaluated reverse order, not a route union. It was not rebuilt or
reconfigured. Current-source regressions additionally qualify the asymmetric
starter, both repairs, case-sensitive non-match, local-ID/local-only non-fixes,
independent return loss, broken Operations and tenant leakage.
Unknown retained policy, remote-only propagation without a local seed and
secured/custom-table combinations remain **Not assessed**, including isolation.

Source: [Microsoft Learn, virtual hub routing](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing).
Association chooses a connection's lookup table; labels group propagation
destinations across hubs, while explicit table IDs are local. Exact label case
is a qualified simulator boundary here, not a measured live-Azure claim.
Default is another table, not a union. Empty-label fallback rules are not a
substitute for the explicit custom-table propagation used in this incident.
This mission does not grade static connection next hops, indirect BGP/NVA
export, routing-intent/custom-table composition, timed convergence or live
firewall enforcement; native support for other bounded cases does not publish
them as learning tasks automatically. No Azure resources were deployed.

EN/JA closed observations and native edits have automated contract/browser
qualification, including exact mobile table navigation with no mutation or
automatic credit. Human answer-blind SME/native-language/novice review and
learning-gain evidence remain under #160/#219.

## Hybrid routing qualification (#224)

The original `hybrid-preference` fixture uses coexisting ER/VPN gateways in a
/27 GatewaySubnet, an unchanged shared-gateway peering and two separately owned
branch /24 services. The branch's **outbound ER policy** summarizes only the
first real /24 contributor to /16; its VPN export retains both specifics.
The starter's preconfigured BGP VPN connection is disabled. The learner enables
and saves it, compares the actual active workload routes, then disables only
the original branch-side ER attachment. This assesses connection operation,
not construction or production readiness of a VPN gateway.

Current shared engine `2026.11.18.2` qualifies ER for equal `172.28.20.0/24`
candidates and VPN `172.28.10.0/24` over ER `172.28.0.0/16`. After declared ER
withdrawal both original services and their independent replies remain routable
through VPN; local Operations and restricted-tenant isolation remain separate
requirements. Both original ER attachments must remain enabled in the
coexistence stage, and the original VPN must retain BGP in both stages.
The already-running local MCP uses older engine `2026.11.16.2`: native validation
completed without errors and all five coexistence assertions were satisfied.
It was not rebuilt/reconfigured; current source regressions additionally qualify
the selected gateways, withdrawal and invalid alternatives.

Negative coverage includes disabled backup, loss of both transports, wrong
selected gateway despite passing shared assessments, stale proof, invalid BGP
state, independent branch observation, and a broken Operations witness.
A filtered return advertisement currently causes shared model warnings and
therefore **Not assessed**, never credit. An address inside the aggregate but
outside the original owned branch services is also **Not assessed**.
Native saves prune absent one-direction route-map properties instead of writing
`undefined`, preserving strict plain-JSON worker admission.

Source: [Microsoft Learn, ExpressRoute and site-to-site coexistence](https://learn.microsoft.com/azure/expressroute/how-to-configure-coexisting-gateway-portal).
Longest-prefix matching precedes equal-prefix transport preference; the
on-premises return preference must be configured independently. These snapshots
do not establish elapsed convergence, measured failover/failback, established
session continuity, throughput or SLA. No live Azure resources were deployed.
Gateway-summary export from ARS to NVA remains explicitly gated by #233 and is
not graded here. Existing `branch-advertisement` supplies the earlier workload
propagation case; further ARS/policy variants remain follow-up scope.

EN/JA objectives, closed observations, native edits and original scenario
questions have automated contract and native browser qualification. This is not
an independent answer-blind SME/native-language/novice review or a learning-gain
claim; those human evidence gates remain tracked under #160/#219.

Quiz options use authored order, comparable detail and grammatical structure,
and answer-specific explanations. Preserving old choice IDs preserves old
award/answer identities. Automated qualification is not an answer-blind SME
review and does not establish learning effectiveness.

## HA routing qualification (#222)

`tests/fixtures/ha-routing.ts` is an original two-NVA/ARS/branch fixture, not a
published mission. `ha-routing.test.ts` qualifies independent forward/return
paths, an unaffected local operations flow and invalid/unknown alternatives.
The original BGP qualification did not change curriculum awards. The bounded
HA-ports mission below now adds learner grading without publishing the broader
BGP withdrawal or controller mechanisms as working HA lessons.

| Mechanism | Qualified scope or remaining gate |
| --- | --- |
| Preferred/standby BGP advertisements | Shorter primary AS path, longer standby AS path; explicitly withdraw the primary branch advertisement and overlay, then verify both legs use the standby overlay. Restore is a new stateless snapshot, not measured failback. |
| Stale primary advertisement | An available alternate and a retained route are insufficient. Engine `2026.11.17.1` rejects delivery at an advertising NVA when a separately owned branch still needs a forwarding path. Abstract, unowned NVA-origin prefixes keep their existing behavior. |
| Manual UDR next-hop change | Equal-prefix User policy can still pin an NVA whose forwarding is explicitly disabled. Updating the next hop or removing that UDR restores the qualified standby path. This is a declared configuration repair, not health-triggered automation. |
| Internal Standard LB HA ports / Floating IP | Engine `2026.11.17.3` qualifies the explicit single-LB/single-NIC floating HA-ports UDR steering slice in `tests/fixtures/ha-ports.ts`; see `PLATFORM.md`. It preserves original ownership/tuples and checks return routing independently. Nonfloating, undeclared/import-only, direct frontend-destination and richer layouts stay unassessed. Ordinary LB DNAT is not a substitute. |
| BGP next hop independent of speaker | Current NVA advertisements use that NVA's private IP. Advertising an LB frontend or another NVA/firewall needs an explicit owned next hop before grading; Azure support does not imply simulator support. |
| Controller-driven address reassignment | Requires explicit address-owner transitions and resulting routing. It is not LB Floating IP and is not qualified by editing a label or retaining unknown JSON. |
| ECMP hashing, live probes, timers, VMSS orchestration, state replication and session continuity | Not established by these snapshots; retain explicit conceptual-only limits. A selected modeled path does not prove Azure per-flow symmetry. |

Candidate experience: inspect the workload's exact branch-prefix route and the
ARS candidates; compare branch-side return selection; observe a declared
withdrawal; repair stale advertisement or manual steering without changing
the local witness. A later graded mission still needs native ARS/NVA/overlay
guidance, reviewed EN/JA questions and an explicit award-compatibility decision.
Navigation assistance must not reveal the repair.

### Candidate inspection and questions (not learner-published)

EN inspection: In the workload's effective routes, find `172.31.80.0/24`
and record its source and next hop. Compare the two ARS candidates and the
branch-side return path. After the declared withdrawal, repeat both traces
and check that the operations subnet remains reachable.

JA inspection: ワークロードの有効なルートで `172.31.80.0/24` を探し、
ルートのソースとネクストホップを記録します。ARS の 2 つの候補と、
ブランチ側の戻り経路を比較します。明示的な撤回後に往復のトレースを
再実行し、運用サブネットへの到達性も確認します。

EN diagnosis: The preferred overlay is down, its advertisement remains,
and the standby is available. Why can the workload-to-branch trace fail
while the branch-prefix route is still present?

| Choice | EN | JA |
| --- | --- | --- |
| A | The preferred NVA still advertises the branch prefix; the selected route outlives that NVA's usable overlay. | 優先 NVA がブランチのプレフィックスを広告し続けており、選択されたルートがその NVA の使用可能なオーバーレイより長く残っています。 |
| B | The standby NVA advertises a longer AS path; ARS cannot retain that advertisement as an alternate candidate. | 待機 NVA が長い AS パスを広告しているため、ARS はその広告を代替候補として保持できません。 |
| C | The spoke uses the hub's remote gateway; branch replies therefore follow the same NVA as outbound packets. | スポークがハブのリモートゲートウェイを使用しているため、ブランチからの応答は送信パケットと同じ NVA を通ります。 |
| D | The effective table contains the branch prefix; the failure therefore lies outside modeled routing and forwarding. | 有効なルートにブランチのプレフィックスが存在するため、障害はモデル化されたルーティングと転送の範囲外にあります。 |

JA diagnosis: 優先オーバーレイが停止しても、その広告は残り、待機 NVA は
利用可能です。ブランチのルートが存在するのに、ワークロードから
ブランチへのトレースが失敗するのはなぜですか。

Author key A: route selection does not establish onward forwarding. B confuses
a less-preferred candidate with an invalid route; C couples independent return
selection to the outbound path; D mistakes route presence for delivery.
JA 解説: 正解は A です。ルートの選択だけでは、その先への転送を保証
しません。B は低優先度と無効を混同し、C は往復の独立した経路選択を
同一視し、D はルートの存在を配信の成功と同一視しています。

EN design tradeoff: What obligation remains when manual UDR next-hop changes
are used as the HA mechanism?

| Choice | EN | JA |
| --- | --- | --- |
| A | Provide detection and a process that updates affected route tables, and verify return routing separately from the changed next hop. | 検出と対象ルートテーブルを更新する手順を用意し、変更したネクストホップとは別に戻り経路を検証します。 |
| B | Provide detection and a process that changes ARS path preference, and rely on that preference to replace the configured UDR next hop. | 検出と ARS の経路優先順位を変更する手順を用意し、その優先順位によって設定済み UDR のネクストホップを置き換えます。 |
| C | Provide detection and a process that changes the branch AS path, and use that path to establish symmetry through the new UDR next hop. | 検出とブランチの AS パスを変更する手順を用意し、そのパスによって新しい UDR ネクストホップを通る往復の対称性を確立します。 |
| D | Provide detection and a process that changes peering gateway transit, and use that setting to replace the configured UDR next hop. | 検出とピアリングのゲートウェイトランジットを変更する手順を用意し、その設定によって設定済み UDR のネクストホップを置き換えます。 |

JA design tradeoff: 手動の UDR ネクストホップ変更を HA の仕組みとして
使う場合、設計側にどのような責務が残りますか。

Author key A: this fixture declares snapshots rather than implementing detection
or updates. B and D do not rewrite an explicit UDR next hop; C does not establish
independent return-path symmetry. JA 解説: 正解は A です。このフィクスチャは
状態を宣言するもので、検出や更新処理は実装しません。B と D は明示的な
UDR のネクストホップを書き換えず、C は独立した戻り経路の対称性を
保証しません。Both drafts still require independent answer-blind EN/JA review.

Sources checked for this qualification:
[ARS route injection and primary/standby AS paths](https://learn.microsoft.com/azure/route-server/route-injection-in-spokes),
[independent next-hop support](https://learn.microsoft.com/azure/route-server/next-hop-ip),
and [HA ports configuration/symmetry boundaries](https://learn.microsoft.com/azure/load-balancer/load-balancer-ha-ports-overview).
These document-derived tests are not live-Azure qualification, answer-blind SME
review or evidence of learning effectiveness.

### Bounded HA-ports learner mission (#222, forwarding #245)

The published `ha-return-path` mission uses `ha-scenario.ts`: a smaller original
workload/workload variant of the qualified `tests/fixtures/ha-ports.ts` mechanism,
without unrelated branch/ARS controls. It retains the original frontend, rule,
pool, NVA and workload identities and has its own shared-engine counterexamples.
The earlier authoring candidate below also covers branch routing; do not confuse
its branch prefix with the learner mission's `10.82.0.0/16`. Inspect the application
`work` subnet's route to `10.82.0.0/16`: the user route keeps the next hop
`10.80.3.10`, owned by `transit-lb` / `transit-vip`. A packet probe between the
original client/server workloads retains the destination `10.82.1.10` and TCP
ports 49152/443 while showing the selected original `primary-vm` identity.
The VIP's owning subnet is context, not an extra subnet route lookup.
EN: "Inspect the transit VIP route, then compare the packet's destination and
selected NVA." JA: "中継 VIP へのルートを確認し、パケットの宛先と選択された NVA を比較してください。"
Route inspection uses existing exact-scope guidance. Scoped packet guidance and
mounted EN/JA control tests now cover the learner mission. Do not expose fixture
JSON to learners or substitute a menu of tools.

Seed the remote subnet's independent return UDR with next hop `10.80.2.4`.
Both legs can be routable while the packet check fails for different NVAs.
Repair that return route to the transit VIP; retain the forward VIP route and
verify both the original selected backend and the unaffected local witness.
EN: "Repair the remote subnet's return route; verify both directions."
JA: "リモート サブネットの戻りルートを修正し、往復の経路を検証してください。"
The shared tests qualify this wrong-return counterexample and the restored
single-NVA result; they do not prove stateful firewall delivery.

Draft diagnosis question (correct A): EN: "The forward leg selects the primary
NVA and the return leg traverses standby. Why can the configured check fail
despite both routes being reachable?" A: "Backend selection leaves the remote
subnet's independent return route unchanged." B: "Tuple preservation makes the
reply's source address become the frontend VIP." C: "Probe eligibility changes
the route table only after another route lookup." JA: "往路はプライマリ NVA、
復路はスタンバイ NVA を通ります。両方の経路に到達可能でも、構成チェックが失敗する理由は何ですか。"
A: "バックエンドの選択では、リモート サブネットの独立した戻りルートは変更されません。"
B: "タプルを維持すると、応答の送信元アドレスがフロントエンド VIP に変わります。"
C: "プローブの適格性によるルート テーブルの変更は、次のルート検索後に反映されます。"

Draft tradeoff question (correct C): EN: "Which additional evidence would
support TCP session continuity across an actual NVA failure?" A: "Healthy
backend probe snapshots and the floating HA-ports rule configuration."
B: "Effective forward and return routing tables from both backend snapshots."
C: "Existing-session state replication and traffic captures across the failure."
JA: "実際の NVA 障害をまたいだ TCP セッションの継続性を裏付ける追加の証拠はどれですか。"
A: "正常なバックエンドのプローブ スナップショットと Floating IP を使う HA ポート ルールの構成。"
B: "両方のバックエンドのスナップショットにおける往復の有効なルート テーブル。"
C: "既存セッションの状態複製と、障害の前後を含むトラフィック キャプチャ。"
These historical drafts are not the published quiz text. `scenario-course.ts`
contains the reviewed diagnosis and time-dependent tradeoff questions. An
independent answer-blind AI technical review identified ambiguity in the original
tradeoff stem; the revised stem explicitly confirms tuple and return evidence.
A second key-free UTF-8 AI review selected the intended unique answers and
confirmed EN/JA equivalence. Neither review is human SME/native-language or
novice learning-effectiveness evidence; those remain under #160/#219. The model
does not supply session-continuity evidence. No continuity conclusion earns credit.

The learner starter pins the remote return to the standby NVA: both legs remain
routable but the HA packet and independently ordered flow checks fail. The
canonical repair uses the transit VIP. A return pinned to the current primary
also satisfies this declared snapshot; it does not follow a later backend
selection. Direct forward bypass, unknown health, altered original addresses,
missing forwarding declarations and broken Operations cannot pass. This is
neither a universal symmetry guarantee nor proof of stateful firewall delivery.

Award decision: #245 itself added no XP; #222 now publishes the six new awards
under existing course ID `azure-routing-scenarios`, content version 2, using the
explicit beta policy above. No previous-session migration, new edition, saved
design conversion, historical award deletion or automatic HA credit is added.

## Original-edition ladder

| Belt | Required points | Points available before next belt | Objective |
| --- | ---: | ---: | --- |
| White | 0 | 100 | Address ownership, exact routes, direct peering |
| Yellow | 100 | 75 | Diagnose an equal-prefix UDR override |
| Orange | 175 | 150 | Longest-prefix diagnosis, two destination addresses |
| Green | 325 | 225 | Shared gateway/BGP transit and independent return routing |
| Blue | 550 | 325 | Virtual WAN propagation, table scope, private intent |
| Brown | 875 | 450 | Mixed diagnosis, independent faults, transfer/capstone |
| Black | 1,325 | 0 | Capstone completion and honest uncertainty |

Two pre-implementation design/self-review iterations on #184 revised the old
unimplemented 1,700-point plan. Quick first wins retain the existing 100- and
75-point chapters and every historical award identity/value. New work budgets
then grow to 150, 225, 325 and 450 points. Points never replace mastery checkpoints.
All six chapters have available assessments. A pre-publication budget audit
corrected the capstone's listed subtask arithmetic: branch repair 85, return
repair 115 and combined verification 110 bring its actual total to the reviewed
450-point budget. No previously published awards were repriced.

`exampleCourse` and `previewCourse` retain their historical source export names
and course ID. Their current content version is 5 and publication is `complete`.
The original eleven tasks still award exactly 175 points; fresh and returning
learners can reach 1,325 without repricing or repeated credit. The first 24 tasks
retain their 550 points and assessment identities. Gateway and WAN chapters
diagnose preconfigured transit/intent, not gateway/hub-configuration skills.
Shared-engine fixtures cover failed forward/return outcomes, both supported
repair styles, the wrong-prefix non-fix and checkpoint reachability. A browser
journey drives all 40 tasks through real controls and restores the normal design.
WAN checks require the modeled Firewall waypoint in both directions; delivered
but bypassing paths fail. The capstone keeps two faults independent and rechecks
both repairs together. Exact hub requirements name the Default table, not a
union of hub routes. These scenarios do not combine custom tables with intent.

Technical author review references Microsoft Learn's
[routing selection](https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview),
[gateway transit](https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit)
and [hub routing](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing).
This is not independent human subject-matter sign-off or evidence of learning
effectiveness. Novice evaluation remains #181/#160. Black belt records local
practice completion, not Azure certification. Publication `complete` describes
the available assessed path, not human validation or a live Azure guarantee.

## Journey qualification and known limits

The #202 curriculum head `e1f1057` passed full CI run `43989910088` before
merging as `8d4151e`: 937 unit tests, 369 Chromium browser cases, 18 production
cases, unchanged startup budgets and actual unpackaged/packaged Electron smoke.
Those are repository regression denominators, not human success or learning
rates. The focused learning fixtures exercise all belt thresholds, historical
175/550-point histories, exact scopes, independent faults, supported alternatives
and unsupported-result refusal. `runner.test.ts` and `progress-ledger.test.ts`
separately cover stale evidence, inserted/revised content and immutable awards.

#181 records qualification findings and follow-ups. #206 adds waypoint-aware
failed-check feedback; #207 restores focus to the next task/completion heading
after explicit advance, without adding Tab stops or changing ordinary canvas
focus. Native-control browser regressions cover the complete course in EN and
JA, with dark/reduced-motion and separate narrow/focus cases. These scripted
checks do not validate native-language clarity, assistive-technology usability,
contrast exceptions or educational effectiveness.

Remaining enhancements: #204 needs a new exact hub-table guidance adapter;
current advanced table checks are exact but their cue opens the source subnet.
#205 separates the scaffolded capstone from a genuinely novel diagnosis task.
Human recruitment, independent SME review and pre/post/delayed-transfer sessions
remain pending under #160; this work has no participant results. Use the existing
`docs/human-evaluation-pilot.md` protocol and its guided-first-mission task, not XP
or test counts, to evaluate learning. Concurrent loaded-canvas accessibility and
benchmark work is tracked separately in #201/#197/#198/#199.

## Add or change a lesson without changing runtime code

1. Add/copy a starter in `course-scenarios.ts` with a permanent scenario ID.
2. Add a lesson with permanent IDs, localized objective, ordered `taskOrder`,
   tasks and explicit earlier-lesson prerequisites. Add its ID to `lessonOrder`.
3. Compose tasks from existing check kinds below. Reference check/guidance IDs,
   not React state. Reuse scoped definitions when their meaning really is shared;
   duplicate a quiz definition when editing one lesson should not affect another.
4. Set positive first-completion points, assessment versions and permanent award
   IDs. Update central belt configuration/checkpoints and the planned budget if
   necessary. New thresholds must be achievable by the actual ordered content.
5. Add localized feedback for every answer, relevant hints and semantic guidance.
   Navigation help stays available at every belt and never removes points.
6. Run `npx vitest run learning` and `npm run build`.
   The content-only addition/reorder test demonstrates this extension path.

Changing a title/quiz wording, adding a supported lesson, changing order or tuning
thresholds needs only content and relevant fixture edits. A new task mechanism,
unsupported networking assertion or new UI control needs a small separately
registered primitive/adapter with tests; do not introduce a lesson-ID switch.

## Supported checks and guidance

| Check kind | Parameters / completion meaning |
| --- | --- |
| `scenario.loaded` | Explicitly admitted `scenarioId` in the current practice session, not a title comparison |
| `routes.inspected` | Exact owned `vnetId`, `subnetId`, IPv4 `prefix`; observation only, not proof of comprehension |
| `vnet.peered` | Distinct owned `vnetAId`/`vnetBId`; direct enabled peering, access in both directions, and explicit shared-engine `requirements` for its outcome |
| `requirements.satisfied` | Existing platform requirements, all assessed and satisfied for the current document revision |
| `quiz.answered` | Localized question/choices/feedback, unique choice IDs and one declared correct choice |

Guidance actions are `routes.open` (owned subnet and exact prefix, including
absence), `peering.command` (exact pair), and `route-table.configure` (owned
subnet, associated table and exact route). They reveal/select tools, never apply
the assessed configuration or answer a question. Actions need scoped refs in each
supported UI provider. An absent prefix must highlight the table/filter and
explain absence, not wait forever for a nonexistent row. Disabled/deleted targets
need explicit recovery. Current adapters target the mixed-network provider;
legacy native VWAN needs a separately registered action/check scope before use.

`validateCourse(unknown)` checks plain bounded data, strict schemas, IDs,
translations, ordering/prerequisites, exact-once references, awards, checkpoints,
attainable thresholds and scoped check/guidance compatibility. It admits native
starters and evaluates engine checks using the existing platform, accepting
`violated` starters but rejecting `not assessed` ones. It does not execute learner
actions, prove every future UI target is mounted, guarantee a solution exists,
or replace solution fixtures and subject-matter review. Every declared check and
guidance target must be used so its scenario scope is actually validated.

## Versioning, insertion and historical awards

The policy is exported as `courseCompatibilityPolicy` for downstream stages.
The runner and persistent ledger consume these stable identities.

| Change | Required action |
| --- | --- |
| Typo, translation, presentational wording or reorder | Keep task ID, assessment version and award ID; increment content version for publication |
| New starter assumptions, bindings, correct answer or grading | Increment affected tasks' `assessmentVersion`; reevaluate required mastery before further advance |
| Changed point values or belt thresholds | Change content config; retain points recorded at original award and disclose changed targets |
| New task inserted before current/completed content | Keep history; require unmet inserted prerequisites before the next uncompleted task; do not silently auto-complete it |
| Removed task/lesson | Archive its completion/award; never transfer credit to replacement IDs |
| Deliberately new credit | New award ID plus explicit migration policy; a version bump alone cannot award twice |

Completion records bind course/task identity, assessment version and
document revision. First awards derive `(courseId, awardId, pointsAtAward)`;
unique award identity is independent of task ordering and assessment version.
Historical awards never disappear or reprice when current content changes.
An older pass can remain history without satisfying a revised current checkpoint.
If historical points do not reach a newly raised threshold, show the gap honestly;
any additional credit/top-up needs an explicit migration, not synthetic completions.

Do not silently reprice tasks downward and make the new course impossible for
returning learners: a curriculum update must review both new-learner reachability
and paths for affected existing learners under the retained historical awards.
Keep legacy `aznet-simulator:practice:v1` entries unchanged as independent history;
none prove completion of new guided tasks. Status details offer a download of the
original legacy bytes rather than inventing guided credit or rewriting old data.

The guided ledger uses `network-simulator:learning-progress:v1`, envelope version
1 and award policy version 1. Its immutable first completion for each
`(courseId, awardId)` supplies the historical points; no mutable total or duplicate
award array is persisted. Reassessment records a new completion identity without
re-awarding it. Records are bounded to 2,048 completions and 1,000,000 characters.
Do not silently prune history or accept unknown fields/policy versions.

Only the origin's exclusive Web Locks practice owner may write practice or
awards. Pause does not relinquish an editable canvas. Return to the normal design,
discard practice or close the tab to release it; another tab can then resume the
latest saved canvas. Missing/rejected locks fail closed for practice, not normal
designs. Expected-raw comparisons additionally reject stale/old-client writes.

Quota-failed accepted completions stay in memory with **Session only**, backup
and retry-saving controls. Conflicted/corrupt/unavailable records do not invent
zero credit or overwrite originals. A refused completion sink cannot advance
the runner. Confirmed reset rechecks the confirmation snapshot and deletes only
the guided ledger, not the practice canvas, normal designs or legacy history.
Clearing browser-origin/Electron-profile data still removes local progress;
there is no authentication, cloud sync, encryption or verified certification.
