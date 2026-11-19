# Curriculum readiness criteria and authoring guidelines

Recorded 2026-11-19 from curriculum review and learner feedback. These are
acceptance criteria for authoring and reviewing lessons, including requested
improvements that may not yet be implemented. This document does **not** declare
the current curriculum complete, independently reviewed or learning-validated.

The [authoring contract](../src/learning/AUTHORING.md) owns implemented task,
assessment, progression and compatibility contracts. The
[diagnostics roadmap](diagnostics-learning-roadmap.md) owns future capability
direction. Track content work under #210, quiz quality under #219, contextual
learning UI under #302 and account/synchronization accuracy under #311.

## What "ready" means

| Claim | Required evidence |
| --- | --- |
| Content ready for implementation | A coherent scenario, explicit objectives and prerequisites, supported assessments, original content and reviewed explanations/questions |
| Runnable practice | Actual-engine and native-UI qualification, protected workspaces, reliable progression/recovery and honest capability limits |
| Independently reviewed | Recorded technical, answer-blind quiz and language reviews; an author's self-check or automated heuristic is not independent review |
| Learning effectiveness assessed | Actual learner observations and separate, unassisted transfer assessment under the [human pilot](human-evaluation-pilot.md) |

Keep these claims separate. Record the revision, examined scope, evidence and
outstanding gates in the implementing issue or PR. Passing tests or earning a
belt does not establish learning effectiveness, Azure production readiness,
professional certification or exhaustive subject coverage.

## Context before interaction

Every lesson must explain a small, fictitious situation: who needs to communicate,
what currently happens, what should happen and why it matters. State the
networking objective before naming a control.

Introduce unfamiliar concepts before assessing them. For example, explain
effective routes, route sources and next-hop types before asking learners to
interpret a table. Explain the purpose and tradeoffs of a hub VNet before
introducing one; do not imply that a hub is always the best architecture.

Inspection instructions must name the actual evidence view, original object,
direction and exact prefix or request. Explain what to observe and what that
observation means, including a genuinely absent route. Avoid ambiguous directions
such as "Inspect Application / Workload for 10.22.0.0/16" without a scenario or
"Record the inspection there" when there is no such learner action.

For example: "The application workload needs to reach the data network
10.22.0.0/16. Open the application workload subnet's effective routes. Find that
exact prefix and compare its route source and next hop; if it is absent, note
that absence." The following explanation should connect the observation to the
networking mechanism, rather than merely congratulate the learner.

Use brief references to related future topics where helpful, without requiring
them prematurely. A VNet-peering introduction can distinguish its scope from
later subnet-peering material and separate route presence from permission to
forward traffic.

## A deliberate lesson loop

Use a clear sequence: scenario and concept, observation, learner action,
verification, short explanation, then an explicit **Next** action.

Completion should leave the learner time to read why the result follows, the
important limitation or misconception, and a topic-specific official Microsoft
documentation link. Open documentation in another tab without losing practice.
Remove generic filler such as instructions to answer about the scenario rather
than a simulator control; the question itself should already make that clear.

Do not silently advance past the explanation. Where setup is necessary, make
it part of the learner's explicit Start/Next transition rather than repeatedly
asking them to load a topology manually. Explain what is being introduced and
why. Opening the course, selecting a task for review, restoring a session or
observing an already-satisfied setup condition must not silently replace the
workspace or skip the next independent learning objective.

Provide Back/Next navigation through completed material without bypassing
unmet prerequisites or awarding repeat credit. Preserve learner edits and make
the distinction between historical review and the current editable practice
clear. Per-step topology snapshots are a possible implementation, **not an
already selected or implemented requirement**; an equivalent design must define
review, resume, unsaved-edit and undo behavior before shipping.

## Gradual construction and scenario continuity

Prefer evolving a recognizable topology over frequent unexplained replacement.
Introduce the smallest useful concept and change at each step. Do not teach
route tables and UDRs solely through a nearly finished topology that appears
without explanation.

For example, after basic peering, introduce a hub/firewall VNet and explain its
purpose. Let the learner reconnect peerings in one task, then introduce the
necessary routing policy in another. Where a genuinely different scenario is
needed, explain the transition and use the protected-practice replacement and
recovery rules; normal saved designs must remain safe.

Scenarios should expose unfamiliar but useful designs, not only repeat the same
fault with new addresses. Supported examples include co-located versus separate
SD-WAN/firewall VNets, HA return paths, indirect spokes, gateway advertisement
and multi-hub isolation. This is not an exhaustive coverage promise. Gate each
variant on actual engine and native-control support.

Combine closed evidence inspection, open networking repairs and questions about
causes, consequences or tradeoffs. Accept alternative repairs that satisfy the
declared requirements; do not require one hidden sequence of clicks or one
preferred JSON shape.

## Questions that assess understanding

Assess concepts that the explanation has taught or explicitly referenced.
Include foundational questions as well as incident diagnosis: peering scope,
route versus forwarding permission, route selection and independent return
routing are useful examples. A design-tradeoff question needs a stated goal or
comparison criterion so that one answer is defensible.

Each distractor must represent a plausible misconception and have a rationale.
Keep options comparable in length, grammar, detail, technical vocabulary,
specificity and qualification. Do not make the correct option the only nuanced,
grammatical or scenario-relevant sentence. Avoid gratuitous "always", "never"
and similar giveaway language, without banning technically necessary terms.

Vary authored answer positions while preserving stable choice IDs and grading.
Provide answer-specific explanations after deliberate submission, allow retry
and avoid leaking later incident diagnoses. Review EN and JA independently for
meaning and unintended clues.

Technical and answer-blind style review remain publication gates under #219.
Automated answer-position checks and distractor heuristics help detect problems;
they cannot prove that a question is fair or educationally useful. Record
pending human review honestly rather than treating green tests as its substitute.

## Evidence and capability boundaries

Bind assessments to the original scenario identities and current practice
revision. Inspect the requested native table or packet evidence, not a nearby
view, inferred route union or stale result. Recheck after edits, undo and the
other invalidating transitions defined by the authoring contract.

Qualify the unmet starter, valid repairs and meaningful invalid alternatives.
Preserve independent forward/return requirements, unaffected traffic and
isolation witnesses. Deleting a protected endpoint, disabling the restricted
tenant or breaking another required flow must not become a shortcut to passing.

Navigation help locates native controls without changing the assessed
configuration or manufacturing evidence. Keep free UI-location help distinct
from conceptual hints and independent problem solving.

State supported, violated and unassessed outcomes honestly. Unknown or
unsupported behavior never earns success or isolation credit. A modeled route
is not a successful handshake; neither proves TLS, application health, elapsed
convergence or live Azure delivery. Planned DNS/application tracks must not be
presented as available assessments.

## An unobtrusive, accurate learning experience

Keep the primary path linear and readable. Put secondary enrollment, reset,
recovery, storage and advanced options in appropriate secondary UI rather than
repeating distracting controls and warnings beside every task.

Disclosures must remain available and accurate for the actual state. Do not tell
a signed-in learner that no account or synchronization exists. Distinguish the
practice canvas, locally retained work and account-synchronized progress; show
actionable failure/recovery information when relevant. Simplifying the UI is not
permission to remove consent, conceal data loss or claim certification.

Check the lesson in EN/JA, with keyboard navigation and a narrow viewport.
Evidence, explanations, native controls and official references must remain
usable; a successful desktop mouse walkthrough alone is insufficient.

## Authoring handoff and review checklist

For every new or substantially revised lesson, record:

- Scenario, learning objective, prerequisites and concepts introduced.
- Starter, preserved identities/witnesses and supported capability boundaries.
- Exact evidence scopes, open repair requirements and accepted alternatives.
- Explanation, misconceptions, official section links and optional future-topic references.
- Quiz choices, stable IDs, distractor rationales and independent review status.
- Setup/Next transitions, completed-step review, resume and protected-workspace behavior.
- Relevant engine/native-UI tests, localization/accessibility checks and unresolved gaps.
- Content/assessment versions and compatibility impact on existing progress.

Keep supported curriculum changes declarative: wording, order, questions,
starters, hints, points and thresholds belong in content/configuration. Runtime
changes are for genuinely new reusable assessment, progression or guidance
capabilities, not branches for individual lesson IDs.

Follow the published achievement-compatibility policy. Any beta exception needs
explicit, revision-scoped authorization; an earlier waiver is not blanket
permission to revoke future achievements. Independently author public content;
private copyrighted extracts must remain excluded from Git, issues and artifacts.
Use current official documentation to verify version-sensitive technical claims.
