# Guided course authoring contract

The `course-*` files define declarative content (#179); importing them does not
execute tasks. The protected canvas (#182), non-modal sidebar/guidance (#178)
and evidence-gated runner (#180) activate six sequential assessed missions
(40 tasks, 1,325 points, through black belt).
The root owns the runner across editor switches and pause/resume. A bounded
browser-local ledger (#183) restores compatible completions after reload and
derives first-earned points, checkpoint-gated belts and the header status.
The curriculum is authored under #184. No legacy JSON draft, raw requirements or
engine payload is shown; legacy storage stays untouched.

## Track scope and compatibility

The playable course is displayed as **Routing foundations**. Its historical
`azure-networking-preview` course ID, content version 4, award/check identities,
40 tasks, 1,325 points and stored practice/progress formats remain unchanged.
Renaming the presentation is not a migration or a grading revision.
`tracks.ts` is a small declarative catalog; **DNS and name resolution** and
**Application delivery** are **Planned** informational entries, with no course
binding, points, unlocks or start actions. `TrackOverview` is shared by the
on-demand status details and sidebar. The eager header uses only lightweight
course metadata; it must not import the catalog or overview.

Belts describe completion of a track's published curriculum, not all Azure
networking or professional certification. Available-course denominators and
XP exclude planned tracks; future tracks must use their own course identity.
Existing first awards and recorded content/assessment versions remain intact.
Future additions need an explicit compatibility review: expose compatible new
material as new modules, or scope incompatible belt requirements to a separate
extension/edition while retaining historic achievements. Do not silently change
published thresholds/checkpoints and thereby revoke an earned belt. This slice
adds no edition runtime or automatic historical credit.

`runner.ts` is the single progression authority. Supported check kinds dispatch
to reusable checks, never lesson-ID branches. A passing candidate is bound to
course/content/task/assessment identity, runtime session, practice scope and a
monotonic live-editor revision. **Complete task & continue** rechecks that binding,
records one scoped completion event and unlocks the next unmet task. Edits
(including edit/undo), replacement, provider/active-practice changes, cancellation,
review and replay cannot reuse pending or previous evidence. Shared-worker
requirements must have an exact, complete assessment set; unknown, unsupported,
failed or cancelled evaluation never passes.

**Show me where** is not observation evidence. The exact native subnet inspector
offers **Record inspection: prefix** only for the current scoped observation
request. Its short-lived token is task/session/revision-specific; repeated use of
the same check definition in another task requires a new observation. Quizzes
separately check interpretation with answer-specific feedback and free retries.
Past completion does not certify the current canvas. Completed tasks can be
reviewed, future tasks remain locked, and explicit lesson replay rechecks each
step without deleting history or emitting repeat completion credit.

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
and action IDs. `guidance.ts` resolves the three shipped actions to scoped
semantic anchors; the mixed editor reveals them using its own selection,
route-inspection and context-menu handlers. `TopologyContextMenu` carries command
identity separately from translated labels. The sidebar has no lesson-specific
branches and executes no assessed edits. `GuidanceHighlight` outlines the exact
visible registered targets without touching routing/path classes. Missing or
disabled controls get a localized reason; closed/moved inspectors can be
revealed again explicitly. Adding a supported control requires its resolver,
native reveal adapter and anchor, never a lesson-specific sidebar branch.

## White-to-black ladder

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
and course ID. Their current content version is 4 and publication is `complete`.
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
