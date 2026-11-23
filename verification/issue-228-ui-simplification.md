# UI simplification comparison and inspector follow-up

## Current status

The initial evaluation below describes the opt-in preview delivered in #252.
The maintainer subsequently approved making it the default in #262, retaining
the legacy presentation for comparison and retrofit work. #264 consolidated
routing checks; #265 split Settings from Help & feedback. The original toolbar
measurements and surface audit below are historical, not measurements of those
later changes. Maintainer approval is formative feedback, not a human study.

The next bounded slice applies contextual disclosure to the **VNet configuration
card in hub-spoke and mixed/full documents**. Common identity, address-space and
layout fields receive visible labels. Gateway advertisements and device
addition/removal have separate, keyboard-operable sections with current-state
summaries. Existing configured prefixes and devices start expanded. Users can
collapse them without hiding VPN settings, Route Server preferences, validation
alerts or the warning that advertisements do not create forwarding routes.

This keeps the selected contextual-disclosure approach rather than adding a
global capability mode or another configuration wizard. The same mounted editor,
original handlers, topology and history serve both presentations; toggling does
not discard an uncommitted advertisement draft. Native VWAN configuration,
peerings, NSGs, route tables and the rest of the inspector are unchanged.

### Inspector comparison

Eight browser cases cover simple and imported advanced VNets in hub-spoke/full
and English/Japanese. For the simple VNet, the card exposes **5 inputs, selects
and buttons instead of 11** in all four mode/language combinations. Two
additional disclosure summaries are not included in that count. This measures
CSS-visible controls in the card, not controls simultaneously inside the viewport
or successful task discovery. Configured advanced designs start expanded, so
this is not a universal control-count reduction.

English/light cases use 1440 x 1000; Japanese/dark cases use 390 x 1000.
`grouped-inspector` and `legacy-inspector` screenshot attachments show the task
states, including the draft-preservation comparison. Focus and toolbar heights
can differ between those states; their screenshots are not a controlled
pixel-height comparison. Reproduce the screenshots and JSON count attachments:

```powershell
npx playwright test workspace-presentation.spec.ts -g "VNet inspector|imported VNet" --workers=2
```

The cases check keyboard disclosure, exact saved-JSON preservation, a deferred
draft across presentation switches, commit/undo, device addition/undo, imported
settings, persistent VPN warnings, narrow-page overflow and scoped axe results.
The combined presentation/discovery run passed all 57 cases; the production
default/startup checks passed all six cases and localization passed 12 tests.
Build and lint pass, with the existing `ErLocationInfoModal` lint warning.

Tradeoffs remain: optional tasks cost an extra disclosure; visible labels take
vertical space, especially in Japanese; and the existing peering section still
precedes the VNet card. No task-time or mobile-space improvement is claimed.
The whole-inspector hierarchy and other dialogs remain candidates for later
evaluation, not silently included in this implementation. Human comparison is
still pending with zero participants; #228 remains open for that broader work.

### Subnet and accessible-inspection follow-up

The next slice applies the same mounted-editor disclosure to the **subnet
configuration card** in hub-spoke/full. Name, prefix, route-table association and
deletion stay visible. Outbound/private-endpoint settings have a state summary
with explicit unspecified/enabled/disabled status, policy value and endpoint
count. Existing explicit outbound configuration, non-default PE policies,
endpoints or unknown outbound capture start expanded. Unspecified outbound
configuration is not described as verified Internet access.

The incomplete-capture warning and the Internet/private-service modeling
boundary remain outside the disclosure. Existing endpoints receive accessible
name/address/remove labels. These remain configuration controls, not evidence
of live reachability. Subnet deletion now sits beside the common fields in both
presentations; legacy retains all controls without disclosure.

Eight EN/JA cases cover simple and imported configurations in both modes,
including narrow screens. A simple subnet exposes 4 inputs/selects/buttons
instead of 7, plus one disclosure summary; this is a card control count, not a
human-discovery or above-the-fold measurement. They check a deferred prefix across presentation
switches, explicit commit/undo, policy changes, endpoint addition/undo, exact
saved JSON, imported route-table/endpoint settings and unknown warnings after
collapse. Scoped axe checks cover the expanded endpoint form.

The dense-visualization research in #284 also exposed existing native diagram
accessible names that omitted visible labels. Reuse the existing `DiagramButton`
mechanism for connection groups, policy markers, ER locations and sites, so
visible text, direction and OFF state participate in the name without losing
original owner identity. Event handlers, geometry and selection are unchanged.
The dense/small research browser cases now require a clean whole-page baseline
axe result instead of merely comparing inherited findings; the original #240
findings remain historical evidence, not silently rewritten results.

Validation: the combined 88-case regression passed 86 cases, with two desktop
practice cases timing out. Both passed unchanged in a one-worker rerun alongside
the eight subnet cases and five existing native-workspace workflows (15/15).
All five dense-visualization cases passed, including clean baseline axe checks.
Six production default/startup cases, the Electron smoke, build, localization
(12 tests) and lint passed; lint retains the existing `ErLocationInfoModal`
warning. The desktop smoke now polls its existing post-End visible-item
assertion, rather than racing the browser's keyboard-scroll completion.

This is not a global basic/advanced mode, a routing/schema change or a completed
human usability study. Native VWAN and other dialog hierarchies remain outside
this slice; human participants are still zero.

### Subnet and gateway context-menu follow-up

The approved next slice evaluates the existing **hub-spoke/full subnet and
standalone VNet gateway menus**, not a new action catalog or a configuration
redesign. Inspection of the current menu builders found:

- A subnet with an associated route table has 12 ordinary root entries:
  owner detail, three path entries, configuration, effective routes, the existing
  route-table destination picker, two propagation toggles, outbound access,
  a second configuration shortcut and deletion. The inherited failure action
  or unassessed notice adds one more root. These mix immediate inspection with
  maintenance of imported policies.
- A gateway has only three ordinary entries: BGP RIB, configuration and removal.
  It has no modeled workload-subnet path endpoint. It also lacks the direct
  owner-detail entry already available from a subnet.

| Bounded alternative | Decision and tradeoff |
| --- | --- |
| Leave both menus flat | Lowest change cost and no additional disclosure, but leaves subnet policy maintenance mixed with core inspection. Retain the flat gateway structure because three actions do not justify another navigation step. |
| Wrap subnet connect/association/policies in a general advanced menu | Reject: the existing route-table and path destination pickers would acquire a second submenu level, particularly awkward for narrow screens and keyboard/touch use. |
| Replace secondary subnet actions with an All actions link | Reuses the existing VNet strategy, but unnecessarily moves the current table and propagation tasks away from their context. The searchable Workspace controls already provide the full catalog. |
| Keep direct inspection and destination pickers; group only flat policy maintenance | Selected. One **Subnet policies** submenu contains the original propagation/outbound handlers and original policy-configuration shortcut. Owner detail, path actions, configuration, effective routes, current-table association and deletion remain direct. The associated table name stays visible. |

For the configured fixture the root changes from **13 to 10 entries**, including
the unchanged failure entry. This is a menu count, not a usability or task-time
claim. A gateway deliberately remains flat; the new presentation adds only
**Open VNet detail**, reusing the existing owner-detail handler. Its three
original actions and destructive treatment remain unchanged. No gateway path
action is invented. Legacy retains its original subnet/gateway presentation.
The native VWAN menus are outside this subnet/gateway slice.

Only presentation over the original action objects changes. The full catalog
used by visible/searchable Workspace controls and graphical VNet detail stays
ungrouped, with original IDs, handlers, imported settings and undo history.
Fault/restore-only handling still runs outside presentation grouping; inactive
gateway identity, deletion styling, incomplete-capture warnings and modeling
boundaries remain intact. No topology, routing, schema, sharing or cloud code
changes are included.

Nine explicit-preview browser cases in the existing presentation test file
cover hub-spoke/full, EN/light/desktop and JA/dark/390 px. They compare flat and
grouped screenshots/counts, keyboard submenu focus and Escape return, touch
activation, root destination pickers, imported-policy edit/undo, detail-context
original handlers, Workspace search equivalents, routes/path availability,
advanced configuration/unknown warnings, gateway owner detail and inactive
identity, and inherited restore-only menus. Scoped axe checks cover the new
submenu; the extra unknown-region case checks disabled root warnings and
unavailable on-premises destinations. They explicitly seed
`aznet-ui-preview:v1=true`; legacy coverage is
obtained by switching presentation over the same saved design. Existing detail
and desktop checks retain native VWAN/three-mode coverage.

Reproduce the focused cases with an owned Vite server on port 4183:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4183'
npx playwright test workspace-presentation.spec.ts -g "subnet and gateway menu disclosure" --workers=2
```

Validation: the final focused menu run passes **9/9**; **85 existing browser
regressions** also pass across the presentation, graphical-detail, subnet-peering,
VPN-mode, Workspace controls and failure suites. The combined development run
initially exposed an incorrect new test assumption about available destinations;
the final focused run checks the actual disabled on-premises destination instead.
Build, platform build, lint and **16 action/localization unit tests** pass.
Lint retains the pre-existing `ErLocationInfoModal` warning. The existing chained
Electron smoke passes, including offline/native integration and graphical-detail
original IDs, edit/undo/redo and keyboard focus in all three modes. The
unchanged-source 28-state accessibility gate is recorded against the committed
revision in the PR rather than changing this report during that audit.

Human participants remain **zero**; discoverability, task efficiency, manual
screen-reader assessment and touch-device usability remain unverified. Existing
untranslated legacy action labels are not relabeled by this slice; the new
group and reused owner-detail entry have EN/JA text. Production startup and
packaged-release validation remain separate gates, not inferred from dev tests.

## Initial preview decision and scope (historical)

For #228, choose contextual progressive disclosure plus shallow, task-oriented
global menus. Implement an opt-in **Preview UI** button, not a permanent
basic/advanced capability mode. The existing presentation remains the default.
The same editor, selection, history, topology and simulation serve both views.
The preference is local to this browser or desktop profile, not a cloud setting.
If preference storage fails, switching still works in the current tab.

This is a bounded first slice: shared chrome, the existing searchable workspace
controls, learning-status metadata, and VNet context menus in mixed/classic and
native Virtual WAN documents. It is not a completed usability study or a
replacement for the configuration dialogs.

## Alternatives

These are design assessments, not measured participant outcomes. Each row is a
lightweight interaction prototype for the same create/connect/inspect/trace task.

| Approach | Interaction sketch | Discoverability and cognitive load | Switching friction | Accessibility | Implementation and maintenance | Advanced access |
| --- | --- | --- | --- | --- | --- | --- |
| Global basic/advanced | Start basic; switch to advanced to find a routing control | Fewer initial choices, but users must know which mode contains their task | High: an unrelated global preference interrupts the task | Two presentations to explain and test; capability boundaries can be misleading | High: duplicated visibility rules across every surface | Existing advanced values can become invisible; requires summaries and explicit exceptions |
| Contextual disclosure | Select VNet; inspect common actions; expand additional tasks | Strong context, but weak if it relies on right-click alone | Low: reveal more where working | Good with equivalent visible controls and keyboard access | Moderate if original action handlers are reused | Good with one complete, searchable source catalog |
| Task navigation/onboarding | Choose create, connect, inspect or trace; follow suggested steps | Helpful first task, but extra navigation for returning engineers | Moderate when a workflow prescribes an order | Requires non-pointer entry points and an escape from guidance | High for a new wizard/command system; lower using existing learning tools | Can strand imported designs outside the prescribed workflow |
| Selected combination | File/Explore/Settings for global actions; select VNet for configuration, routes and paths; search all actions | Removes persistent unrelated choices without inventing a second command catalog | Low: one additional disclosure, not a capability switch | Native keyboard/touch disclosure, visible close controls, existing selection/search | Bounded: shared groups and small action metadata; no engine/schema changes | Full inspector/dialog and original action tree remain available |

Reject a new permanent basic/advanced mode and a new wizard for this slice.
Neither establishes which controls are actually confusing, and both introduce
state and navigation independent of the authoritative design. Existing
**Learn & practice** remains optional and does not gate ordinary editing.

## Surface audit and implemented response

| Surface | Observed friction | Preview response and preservation boundary |
| --- | --- | --- |
| Header/navigation | Samples, sample selector, ER information, file/share/export actions and preferences compete with routing work | File, Explore and Settings & help groups; routing checks, issue counts, undo/redo and learning entry points stay directly accessible |
| Workspace controls | Creation precedes the selected object's commands; inventory and capability summaries precede the immediate task | Selected actions first in both DOM and visual order; creation collapses only with a selection and empty search; search exposes both |
| VNet context menu | Fourteen root entries mix configuration, path shortcuts and element maintenance | Nine representative root entries; keep detail, configure, connect/peer, effective routes, path explorer and delete; All VNet actions opens and focuses the complete existing catalog |
| Other contextual menus | Canvas, connections, appliances, subnet and route-map menus have distinct scopes and existing destination pickers | Unchanged in this slice. No extra Connect wrapper or deeper cascading picker is introduced |
| Create/edit and owner inspector | Consequential BGP, routing, propagation, NVA and attachment settings cannot safely be classified as globally basic | Keep full dialogs and inspector actions unchanged, including non-default values. Opening an editor and switching presentation leaves it open |
| Information/results | Account/course/edition/belt/points form a long persistent learning badge; topology labels and diagnostics have different purposes | Compact learning trigger with accessible full description and on-demand details; session-only/unavailable storage notices remain visible. Canvas labels, route tables, warnings, failures, unknown results and model limitations are not filtered |
| Narrow screens | Current toolbar scrolls inside a 180 px cap, including document actions outside the initial visible area | Menus stay within viewport, provide a touch Close button and Escape/focus return; core toolbar no longer scrolls. Its additional height remains an explicit tradeoff |

Failure simulation and restore-only menus are applied outside ordinary VNet
compaction. The palette and owner inspector use the original full actions,
including disabled choices, nested handlers and existing deletion confirmation.
No settings move into a new cascading configuration menu.

## Reproducible before/after evidence

Use the empty mixed workspace at 1440 x 1000 and 390 x 1000, with the controls
panel at its normal default, English/light theme and anonymous zero progress.
Count visible header buttons, selects and summaries, excluding the fixed
workspace-controls panel. Do not count offscreen scrollable controls as
immediately discoverable.

The original desktop header is 148 px high. The preview is 99 px. At 390 px the
current header is capped at 180 px with internal scrolling; the preview is
225 px without that scrolling. This is not a claim that mobile usability has
improved: the extra 45 px competes with the canvas and must be compared by people.
The temporary preview entry point is not intended as permanent chrome.

For `hub-spoke-firewall-udr`, the hub VNet root menu changes from 14 to 9 entries.
The removed roots are Show path to/from, Inspect Subnet, Add Subnet, Change Azure
Region and Add / Remove VNet Elements. All VNet actions replaces those shortcuts
with the existing searchable palette. It is not a reduction in capabilities.

`e2e\workspace-presentation.spec.ts` captures current/preview desktop images and
narrow-screen images as test attachments. Reproduce with:

```powershell
npx playwright test workspace-presentation.spec.ts --workers=2
```

Original and preview screenshots were also inspected locally for toolbar
wrapping, canvas space, popup placement and the representative VNet menu.
Counts and screenshots establish presentation changes, not successful task
discovery.

## Automated evidence

Focused source-action tests exercise retained handlers, disabled nested
destinations, destructive actions and access to the untouched catalog.
Browser checks exercise both providers, exact saved-design preservation,
selection/history availability, editor continuity, export, reload preference,
source-action search, stale-search clearing, keyboard focus, touch dismissal,
Japanese and unavailable preference storage. Popup axe checks cover both themes.

Existing workspace discovery, cloud accounts, learning progress and localization
regressions also pass. Production checks retain the lazy startup budget and
optional language/practice/auth loading. The real Electron smoke includes the
preview, profile-preserved topology, disabled online feedback, native import,
offline assets and three-mode parity. These checks do not replace manual screen
reader testing or prove human usability.

## Human comparison and promotion gate

**Participants: 0. Human comparison is pending. No task-time, completion-rate or
difficulty results have been collected.** Maintainer walkthroughs should be
recorded as formative feedback, not general usability evidence.

Proposed protocol: at least three first-time users and three experienced network
engineers, including a returning-user trial. Alternate current/preview order,
use equivalent tasks and test desktop plus narrow/touch and keyboard conditions.
Use the same imported advanced design for both presentations.

| Task | Record |
| --- | --- |
| Create two VNets and connect them | Completion, elapsed time, wrong actions, requests for help |
| Inspect a route and trace a path | Time to find the control, correct source/destination, navigation errors |
| Diagnose a failed or unknown path | Correct distinction between failure, unknown and unsupported modeling |
| Find and inspect an existing advanced routing/NVA setting | Time, incorrect edits, confidence that the existing value was retained |
| Export/reopen and return to the current presentation | Task completion, data preservation, switching difficulty |

After each task collect perceived difficulty on the same seven-point scale.
Also record whether menu/search discovery required a hint and whether the mobile
header or repeated disclosure impeded canvas work. Do not interpret fewer menu
items as a task-time result.

Provisional thresholds, to be agreed before recruiting: at least 80% unaided
completion for first-time tasks, a 20% improvement in their median discovery
time, no more than 10% median slowdown for experienced users, no inaccessible
advanced setting, zero topology/history loss and zero concealed failure/unknown
indicators. Investigate every misclassification of model limitations and require
no regressions in keyboard/touch completion. Report raw participant results and
sample-size limitations rather than claiming statistical proof.

The original recommendation was to keep the preview opt-in until those gates
and maintainer acceptance were met. The maintainer later explicitly approved
the new default in #262 without collecting the proposed human-comparison data.
The remaining recommendations below are evaluation proposals, not a scheduled
removal of the legacy UI.

Revise the mobile layout if its height harms the tasks. If accepted, promote in a
separate reviewed change, retain a seven-day rollback window, then remove the
temporary flag and old presentation. If not accepted, revise or remove this
preview instead of allowing two permanent interfaces. #228 remains open.

## Current-default task audit and critique (2026-11-23)

This follow-up evaluates the current default, not the historical opt-in preview.
It first challenged the proposed solutions: another toolbar rearrangement would
not establish which task is difficult, and a permanent basic/advanced mode or
new wizard would duplicate navigation without evidence of better discovery.
The dense-view experiments in `issue-240-dense-visualization.md` are a separate,
dev-only comparison, not a new capability mode in the application.

Two reproducible English walkthroughs use local Windows/Chromium and a fresh
mixed/full workspace:
1440 x 1000/light and 390 x 1000/dark. They create two VNets with the existing
searchable Workspace controls, use **Peer with VNet**, inspect the actual
effective-route table, run **Routing checks > Check routing**, then download
through **Save As**. The downloaded JSON matches the current topology; export
does not mutate the stored design. Keyboard context-menu activation uses the
same original object and existing handlers.

At 390 px, Workspace controls is deliberately behind **Workspace actions**.
The first creation requires opening that disclosure, then the controls panel;
the panel must be reopened for the second creation. Desktop starts with the
existing controls panel visible. This is an observed scripted access cost, not
proof that a novice cannot discover the controls.

| Possible response | Critique and next decision |
| --- | --- |
| Keep Workspace controls permanently exposed on narrow screens | Removes a disclosure but adds persistent chrome; compare the same create task and remaining canvas space before choosing |
| Empty-canvas create/example entry using existing handlers | Contextual and temporary, but could compete with import/cloud recovery or imply a mandatory wizard; compare against the current entry before implementing |
| Another basic/advanced mode or onboarding wizard | Adds capability/switching state without locating the problem; reject for this slice |
| Task-specific dense views | May help inventory or configured-peer lookup, but do not address first-create discovery and cannot replace routing evidence |

The bounded recommendation is to test the current creation entry against an
empty-canvas affordance, rather than redesign every menu or promote a new mode.
No additional production affordance is implemented by this research.

The audit measures initial header geometry and viewport-intersecting buttons,
selects and summaries, excluding the fixed Workspace controls panel and
CSS-invisible/collapsed content. Counts are not total capabilities, usable hit
targets or participant discovery results. Raw current observations are retained
in `issue-228-240-observations.json`; historical figures above are not rewritten.

| Current baseline | Header height | Sampled visible header controls | Panel openings for two creations | Header disclosure openings |
| --- | ---: | ---: | ---: | ---: |
| 1440 px, English/light | 89 px | 13 | 0 | 0 |
| 390 px, English/dark | 94 px | 4 | 2 | 1 |

Reproduce only this audit:

```powershell
npx playwright test workspace-presentation.spec.ts -g "current UI task audit" --workers=1 --retries=0
```

**Human participants remain zero.** The walkthrough knows labels and uses search
and a Save As shortcut; it does not measure unaided discovery, human completion
time, perceived complexity, manual screen-reader use or real touch interaction.
It also does not establish failed/unknown-path classification, first-time
advanced-setting discovery, Japanese task completion or cloud interoperability.
Use the participant protocol above before claiming those outcomes. #228 remains
open; the current audit is a reproducible baseline, not a completed human study.

After integrating main `2c6a959`, the native graph-preservation case and both
current-UI walkthroughs pass again. Both raw walkthrough records, including
header measurements, action counts and visible effective routes, exactly match
the committed observations.
