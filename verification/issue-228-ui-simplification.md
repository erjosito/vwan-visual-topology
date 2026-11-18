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
