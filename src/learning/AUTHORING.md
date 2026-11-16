# Guided course authoring contract

Stage 1 of #176 / #179. The `course-*` files are **author-time contracts and
examples**; importing them does not activate a course runner or award points.
Stage 2 (#182) adds a protected canvas. Stage 3 (#178) replaces the old modal
with a lazy, non-modal sidebar and semantic navigation assistance. The sidebar
shows the ordered example instructions as an explicitly **unassessed preview**:
previous/next change presentation only, not completion, unlocks, awards or belts.
The preview cursor and pause/resume state survive editor switches in memory,
not reload. No legacy JSON draft, raw requirements or engine payload is shown.
Existing independent draft/achievement storage is retained untouched. The
evidence-gated runner, progression and full curriculum remain #180/#183/#184.

The root's `openPractice({ courseId, scenarioId, document }, signal)` session API
accepts a copied native scenario after explicit confirmation; it does not look
up lesson names or hardcode the curriculum. Opening/selecting lesson content must
not invoke it implicitly. Resume the existing canvas instead of loading its
starter again. `practice-workspace.ts` owns the separate canvas envelope; it is
not the course progress/award ledger. `practice-session.ts` loads only when
practice exists or is explicitly started, keeping optional learning off the
normal startup asset graph. See `PLATFORM.md` for exact persistence,
return, recovery and same-session history behavior.

## What goes where

| File | Edit for |
| --- | --- |
| `course-outline.ts` | Full journey objectives and planned point budgets |
| `course-examples.ts` | Lesson order, preview belts/thresholds, localized instructions, hints, quizzes, tasks, checks and guidance references |
| `course-scenarios.ts` | Native starter documents; copy before editing |
| `course-contract.ts` | A genuinely new reusable task/check/action shape |
| `course-validation.ts` | Validation for a new shape/scope, not individual lesson IDs |
| `course.test.ts` | Content validation and real-engine failure/solution fixtures |

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

## Planned white-to-black ladder

| Belt | Required points | Planned points available before next belt | Objective |
| --- | ---: | ---: | --- |
| White | 0 | 150 | Address ownership, exact routes, direct peering |
| Yellow | 150 | 200 | Access flags, non-transitivity, return paths |
| Orange | 350 | 250 | Longest prefix, UDRs, equal-prefix selection |
| Green | 600 | 300 | Gateway transit, Route Server, BGP selection |
| Blue | 900 | 350 | Virtual WAN propagation, table scope, intent |
| Brown | 1,250 | 450 | Mixed diagnosis, alternatives, transfer/capstone |
| Black | 1,700 | 0 | Capstone completion and honest uncertainty |

These are explicit **planning allocations**, not available awards or authored
lessons. #184 must supply reviewed tasks/checkpoints within those budgets (or
revise the content plan explicitly). Points alone never replace the mastery
checkpoint at a belt transition. Black belt is local practice, not certification.

`exampleCourse` deliberately publishes only a **preview contract** with white and
yellow thresholds backed by its actual sample tasks. Do not copy its preview
threshold into the full journey or expose it as the complete product curriculum.
The peering lesson is complete; the UDR checkpoint is a representative advanced
example, not proof the other belt curricula have shipped. Existing shared-engine
fixtures verify both starter failures and repaired outcomes; human subject-matter
and learner review remain release work, not claimed research results.

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
6. Run `npx vitest run src/learning/course.test.ts` and `npm run build`.
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
| `vnet.peered` | Distinct owned `vnetAId`/`vnetBId`; direct enabled peering and access in both directions |
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
It is a contract, not a new progress implementation.

| Change | Required action |
| --- | --- |
| Typo, translation, presentational wording or reorder | Keep task ID, assessment version and award ID; increment content version for publication |
| New starter assumptions, bindings, correct answer or grading | Increment affected tasks' `assessmentVersion`; reevaluate required mastery before further advance |
| Changed point values or belt thresholds | Change content config; retain points recorded at original award and disclose changed targets |
| New task inserted before current/completed content | Keep history; require unmet inserted prerequisites before the next uncompleted task; do not silently auto-complete it |
| Removed task/lesson | Archive its completion/award; never transfer credit to replacement IDs |
| Deliberately new credit | New award ID plus explicit migration policy; a version bump alone cannot award twice |

Future completion records must bind course/task identity, assessment version and
document revision. First awards must record `(courseId, awardId, pointsAtAward)`;
unique award identity is independent of task ordering and assessment version.
Historical awards never disappear or reprice when current content changes.
An older pass can remain history without satisfying a revised current checkpoint.
If historical points do not reach a newly raised threshold, show the gap honestly;
any additional credit/top-up needs an explicit migration, not synthetic completions.

Do not silently reprice tasks downward and make the new course impossible for
returning learners: a curriculum update must review both new-learner reachability
and paths for affected existing learners under the retained historical awards.
Keep legacy `aznet-simulator:practice:v1` entries unchanged as independent history;
none prove completion of new guided tasks. Storage/multi-tab handling and executable
migration tests belong to #183.
