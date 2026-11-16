# Quality evaluation scorecard

Tracked in #160. The purpose is repeatable evidence about strengths and gaps,
not a synthetic "the app is 94% good" claim. A scripted happy path cannot measure
how easily a novice discovers it, and a passing grading test cannot establish
that a learner understood networking.

## Dimensions and measurement

Keep the following dimensions separate. Report population, task/corpus,
denominator, date, revision and uncertainty alongside every number.

| Dimension | Automatic measures | Human evidence still needed |
| --- | --- | --- |
| Networking correctness | Registered route/packet fixtures; replay agreement with pinned, provenance-qualified Azure observations; disagreements by capability | Expert review of modeled semantics and observation relevance; new/live cases |
| Honest uncertainty and grading safety | False passes on invalid/unknown/unsupported and adversarial inputs; false failures on independently valid variants; cancellation/partial-job checks | Independent rubric/oracle review; whether supported assumptions are understandable |
| UI effectiveness/discoverability | Regression completion of scripted create/connect/inspect/trace/recover tasks, broken actions and JS errors | Unassisted novice/expert task-success rate and critical errors on realistic tasks |
| UI efficiency and recovery | Fixed-script interaction counts, response durations, keyboard/focus/recovery invariants | Human completion time, unnecessary actions, help requests and recovery success; script speed is not user speed |
| Accessibility | Keyboard/focus regressions and, later, automated rule violations by severity | Screen-reader, zoom/reflow, contrast exceptions and assistive-technology review; automated success is not WCAG conformance |
| Training/rubric engineering | Starter unmet/unknown, supported repairs, negative cases, independent drafts and versioned progress; coverage per exercise | Objective alignment, instructional clarity, feedback/hints, difficulty and valid alternative solutions |
| Learning effectiveness | Score independent pre/post/transfer tasks once a reviewed study supplies answers | Actual learner data, retention and transfer; no invented learning-gain score |
| Explanation quality | Stable evidence links/IDs, localization/source coverage, unknown-result regression tests | Factuality, actionability, level, misleading omissions and whether explanations help learning |
| Performance and scale | Exact production bytes, repeated fixed-workload timings, cancellation/budget limits and dense-topology regressions | Perceived responsiveness on representative hardware and networks |
| Reliability and compatibility | Native round trips, migration/recovery, malformed/partial inputs, worker parity, offline and packaged checks | Enterprise install/update experience and real-world recovery cases |
| Privacy and trust | No-egress tests, bounded allowlists, opt-in and redaction checks, signed-artifact/provenance checks where available | Threat/permission/data-flow review and independent testing; no security certification from pass rates |
| Localization and presentation | EN/JA contract/workflow tests, themes, narrow layouts, overflow and selected visual fixtures | Native-language terminology, readability, density and task comprehension |

These are related but not interchangeable. In particular, "routes passed",
"scripted workflow passed", "user completed the task" and "learner can solve a
new problem a week later" must never share the same label.

## Runnable first baseline

From the repository root, after installing the declared development dependencies:

```powershell
npm run evaluate
npm run evaluate -- --browser
npm run evaluate -- --browser --output test-artifacts\quality\candidate.json
npm run test:evaluation
```

The default evaluates registered **unit regression conformance**. `--browser`
also runs the registered Chromium workflow cases against an owned, ephemeral
loopback Vite server, which is closed afterward. It does not attach to an
existing server/browser or send a user's design to an evaluation service.
Browser binaries must already be installed using the repository's normal
Playwright setup. This is a development-workflow run, not a production or
packaged-desktop assessment.

The runner writes `test-artifacts\quality\latest.json` by default, plus raw
Vitest/Playwright reports, browser artifacts and `scorecard.json` under a unique
run directory. Everything stays local. CI runs the scorecard adapter tests;
it does not automatically upload study data or claim a full evaluation.

The executable manifest is `scripts/quality-scorecard.mjs`, version 1:

| Numeric series | Current evidence subset |
| --- | --- |
| Routing/packet regressions | Native routing, paths, VPN/hub contexts, classic routing, egress/ingress/NSG/LB and captured comparison tests |
| Requirement-grading regressions | Route/flow and packet requirement tests |
| Training-contract regressions | Routing and connectivity practice/rubric/progress tests |
| Persistence/local-boundary regressions | Workspace originals/recovery, inventory, platform service and MCP tests |
| Localization-contract regressions | Message/localization contract tests |
| Scripted UI workflows | Canvas presentation, original VNet detail and single-workspace tests |
| Scripted training workflows | Learning/practice browser tests |
| Scripted localization workflows | Localization browser tests |

Each score is **100 x first-attempt passed cases / registered reported cases**.
Failures, skips and flaky retry passes remain in the denominator; a retry does
not erase the first failure. Vitest retries are disabled for the evaluation.
Expected-failure browser tests do not earn passing credit. A missing planned
file, empty evidence or aborted setup yields `null`/`not-assessed`, never 100.
Raw counts are always included. These conventions are repository choices, not
validated psychometric or standards-compliance scores.

The report includes source revision, dirty-worktree fingerprint, environment,
execution commands/durations, plan hash and a per-series test-identity hash.
Source edits during execution block the result. Compare runs only with the
same metric version, plan/case hashes, profile and comparable environment.
Changing/removing cases is a new corpus, not evidence that quality improved.
Keep old run directories when comparing candidates.

**No overall score is calculated.** Missing human usability, learning,
independent semantic review, full accessibility, live Azure, security,
production performance and packaged-release evidence is explicitly listed.
Passing this subset is not a release approval. Routing errors, unsafe grading,
data loss/privacy violations or incomplete critical evidence cannot be
compensated for by good colors, speed or another passing dimension.

The first local baseline passed 417 registered unit and 72 browser cases. This
produced 100 for all eight *regression-conformance* series, with zero skipped or
flaky cases. It does **not** establish 100% usability, content quality or Azure
fidelity. The initial evaluation also caught a stale branding expectation and
correctly blocked the gate until it was fixed.

## Next automatic evaluations

Prioritize evidence quality before adding more aggregate numbers:

1. **Capability/oracle coverage:** a reviewed matrix of supported capability,
   native provider and provenance-qualified oracle. Report agreement
   `matching assessable cases / assessable observed cases`, unknown coverage and
   observation age separately. Existing synthetic tests are not live Azure
   evidence. Do not mix BGP observation agreement with packet/session proof.
2. **Per-exercise challenge sets:** reviewed unmet, valid alternate, invalid,
   unsupported, bypass and hint-leakage cases. Report false-pass and false-fail
   counts/rates separately; require zero known critical false passes. Preserve
   fixed original endpoint identities. Keep held-out variants independent of
   the example repair so the rubric cannot overfit one JSON design.
3. **Accessibility/performance sampling:** add a pinned automated accessibility
   tool only with a reviewed manifest change; retain manual criteria. Reuse
   `npm run measure:production` and exact-artifact startup gates. Collect repeated
   cold/warm runs on defined topology sizes and report sample count, median,
   p95, hardware/browser and raw timings. The current single local startup
   sample is neither a percentile nor an Azure latency measurement.
4. **Explanation/content audit:** track objectives, prerequisite coverage,
   source freshness, scope caveats and untranslated/contradictory claims.
   Automated checks catch missing fields or broken evidence, not factual truth
   or good Japanese. For example, broad legacy statements that NAT is never
   modeled need contextual expert review now that bounded packet NAT exists.

Do not silently expand the suite and compare its percentage to an older,
easier corpus. Keep difficulty/capability strata visible. LLM judgments may help
triage prose only with explicit data-sharing consent, pinned prompts/models,
independent calibration and human adjudication; they are not routing oracles or
ground truth about learning.

## Human evaluation protocol

Before collecting anything, specify consent, opt-in/local storage, minimization,
retention/deletion and how aggregated findings will be shared. Use synthetic
networks, not participant/customer production topologies. Do not automatically
record screens, telemetry, account identity or individual study responses.

### Usability

Run a small formative pilot separately for novice and experienced networking
users; include EN/JA and keyboard/assistive-technology users where feasible.
Define participants, task variants, success criteria, time limits and moderator
assistance rules in advance. A small pilot finds problems; it does not estimate
the whole population precisely.

Use representative tasks: start an empty mixed design, connect a site, inspect
why a route wins, model explicit Internet egress, explain an unknown LB result,
repair a practice draft, recover a save and resume offline. Counterbalance
variants/order and avoid teaching the exact path immediately before timing it.

Report unassisted task success (`successful tasks / eligible attempts`), critical
errors, assistance rate, recovery success and median completion time for
successful attempts **alongside failures/timeouts**, not hidden by excluding
them. Report sample sizes and uncertainty intervals for outcome rates.
Collect post-task ease and a validated satisfaction questionnaire only under
its proper administration/scoring rules. Satisfaction is not effectiveness,
and a 0–100 questionnaire score is not a percent of tasks passed.
For SUS, preserve its standard scoring (odd responses minus one, five minus
even responses, sum times 2.5), and report sample size, uncertainty, language
and participant profile. The resulting score is neither a percentage nor,
without an appropriate reference distribution, a percentile. Verify instrument
reuse terms before embedding questions; do not assume an ad-hoc Japanese
translation is validated. Do not equate an average from a small convenience
sample with a population benchmark.

For a task's independent binary outcomes, report a Wilson interval rather than
a zero-width normal interval when all participants pass/fail. Repeated tasks
from one person are clustered observations, not extra independent participants;
use per-task rates or an appropriate participant-clustered analysis.

### Training and explanations

Have two networking/instructional reviewers independently rate each exercise
and explanation on anchored 0–4 rubrics: technical correctness, objective/rubric
alignment, clear prerequisites, actionable feedback, useful non-answer hints,
transfer potential and honest scope/uncertainty. Zero means absent/misleading,
two means materially incomplete, four means accurate and sufficient for its
declared audience/scope. Publish anchors, disagreements and adjudication;
these local expert ratings are not a validated learning-effectiveness scale.

Use independent pre/post tasks and a delayed, novel transfer task for consenting
learners. Report paired percentage-point changes, completion/attrition, assistance
and retention interval, with sample sizes and uncertainty. Separate assisted
practice from unassisted assessment and avoid crediting hints or repeated
reference solutions as transfer. Add a comparison/counterbalanced condition
before claiming the application caused improvement.

Until those studies run, report these dimensions as **not measured**, not zero,
not 100, and not an AI-generated estimate.

## Research basis and limits

Reviewed 2026-11-16. The project-specific metric manifest, 0–4 review anchors,
initial suite selection and hard gates are design choices, not weights or
certification thresholds endorsed by these sources.

- [W3C accessibility evaluation guidance](https://www.w3.org/WAI/test-evaluate/)
  explains why tools must be complemented by knowledgeable human evaluation.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) supplies accessibility success
  criteria, not an automatic numeric rating of the app.
- [WCAG evaluation methodology](https://www.w3.org/TR/WCAG-EM/) informs the
  scope/exploration/representative-sample/evaluate/report process.
- [Accessibility Conformance Testing](https://www.w3.org/WAI/standards-guidelines/act/)
  distinguishes individual automated, semi-automated and manual rule outcomes
  from a complete conformance determination.
- [MeasuringU's SUS guidance](https://measuringu.com/sus/) and
  [sample-size/interval discussion](https://measuringu.com/sample-sizes-for-sus-ci/)
  are secondary methodological references, not a normative benchmark for this
  simulator. No primary instrument license or validated Japanese instrument
  was established by this investigation.
- [ISO 9241-11:2018 catalog](https://www.iso.org/standard/63500.html) is relevant
  to the effectiveness/efficiency/satisfaction framing. Its full text was not
  available for this review; no compliance claim or quoted standard is made.

The proposed training study and expert review are local evaluation protocols,
not a validated pedagogical scale. Reliability must be estimated from
independent ratings and reported disagreements; merely employing two reviewers
does not establish it. No defensible cross-dimension weights or overall
product-quality scale were established.
