# Human usability and learning pilot

Tracked in #160. **Status: protocol ready for moderator review; no participants
enrolled, sessions run or human outcomes measured.** Automated workflows and
axe findings are not participant observations.

This is a small, formative, opt-in study, not a population benchmark, accessibility
certification or evidence that the application causes learning. Follow the
[measurement conventions and research qualifications](quality-evaluation.md#human-evaluation-protocol).

## Preparation and consent

1. Assign a moderator and a second networking reviewer. Freeze the application
   revision, build, browser/desktop version, task cards, synthetic starter files
   and answer rubrics before a session. Record hashes of exported starter files.
   Do not run against a changing development server.
2. Aim initially for three novice and three experienced volunteers. These are
   recruitment targets, not a sample-size/power claim. Record only the broad
   experience stratum needed for analysis, language, interaction method and a
   random session code. Do not collect names, employers, accounts, age or
   customer/network identifiers in research responses. Keep any necessary
   recruitment contacts outside the study dataset under the organizer's policy.
3. Use synthetic local workspaces only. Do not request Azure credentials,
   production JSON, external AI assistance or mandatory sign-in. Use a fresh
   browser profile or isolated desktop user-data directory, without modifying
   the participant's existing saved work. Verify the reset/export/reload procedure
   before recruitment.
4. Explain the purpose, voluntary participation, expected 35-minute usability
   session, optional eight-minute guided-practice task and optional separate
   learning follow-up. Obtain affirmative consent
   before collecting responses. A participant may stop or skip any task without
   consequence. Do not treat this document as organizational research approval.
5. Default to moderator notes only: no screen/audio recording, analytics or
   automatic uploads. Additional recording needs separate explicit consent and
   an approved retention policy. Agree a local owner and deletion date before
   collecting anything; the proposed default is 30 days after adjudication.
   Do not retain open-ended identifying or customer information in notes.
6. Store raw notes only in the existing ignored
   `test-artifacts\human-evaluation\<study-id>` directory or another approved
   local location. Never commit or attach participant-level responses to issues,
   PRs or releases. Share only reviewed, non-identifying aggregates and synthetic
   reproduction steps.

Have the second reviewer perform a dry run and approve the expected outcomes.
Record dry-run results as **reviewer rehearsal**, excluded from participant
denominators. Confirm accessibility accommodations before starting; no diagnosis
or medical information is needed.

## Common moderation and logging

Read each task's goal without naming the menu/button sequence. Start timing after
the goal is understood. Do not teach the solution or demonstrate the interface
immediately before measuring discovery. Stop at success, participant withdrawal
or the stated time limit. Ask neutral questions only after the timed attempt.

Use the same assistance ladder for everyone: no hint; neutral restatement;
conceptual hint; explicit UI instruction. Record the time and level of each
intervention. A result after a hint is **assisted**, not an unassisted success.
After a timeout, stop the clock before teaching or preparing the next task.

For each attempt record:

| Field | Allowed meaning |
| --- | --- |
| Task/version and session code | Join outcomes locally without participant identity |
| Eligibility | Eligible, skipped by choice, unavailable capability, or setup failure |
| Outcome | Unassisted success, assisted success, failed, timed out, or withdrawn |
| Duration | Seconds to outcome; retain timeout limit and censoring status |
| Assistance | Count, level and first intervention time |
| Critical error | Data loss, false claim of verified behavior, or unrecovered incorrect topology |
| Recovery | Applicable/not applicable; independent/assisted/failed |
| Ease | Optional original 1-7 response, 1 very difficult to 7 very easy; not a validated scale |
| Observation | Short non-identifying behavior note, not a diagnosis of the user |

Use U1-U2-U3 for half of each stratum and U2-U1-U3 for the others. Alternate
synthetic names/prefixes between sessions while preserving task difficulty and
recording the variant. Analyze task/order effects rather than assuming this
small convenience sample removes them.

## Usability task cards

These are goals for participants. Keep reviewer checkpoints separate from the
participant-facing text. Prepare and independently rehearse the synthetic files
before use; a missing starter or unsupported build is a setup failure, not a user
failure.

| Task | Participant goal | Limit | Moderator-only success checkpoints |
| --- | --- | --- | --- |
| U1: construct and connect | Starting empty, create a hub and a VNet with the supplied synthetic prefix, connect them, and find the VNet route in the hub. | 8 minutes | Original hub/VNet identities retained; intended attachment enabled; exact supplied prefix appears in the selected effective table; participant can identify the selected connection. |
| U2: inspect without intent | From the supplied one-hub trusted/untrusted starter, add Azure Firewall without enabling routing intent. Configure the supplied custom-table/static routing requirement and determine whether each direction of one supplied flow traverses it. | 10 minutes | Explicit original Firewall, both intents off, exact requested static target and associations; independent forward/reverse evidence; no claim that modeled inspection proves Firewall-policy permission or application delivery. |
| U3: preserve and recover | Export your design, reload it in the isolated workspace, and verify that the important objects and routing settings survived. Begin clearing the canvas, then decide to keep your work. | 5 minutes | Native round trip preserves original IDs/configuration; attempted cancellation leaves the topology and saved workspace unchanged. If confirmation is absent, record a product finding and restore from the export; do not blame the participant. |
| U4: optional guided first mission | Keep the supplied normal design safe, start guided networking practice, complete the first mission, reload to resume, and return to your original design. Explain why the two workloads can communicate and what the belt means. | 8 minutes | Explicit starter confirmation; protected canvas; predict/inspect/direct-peering/explain sequence; current checks and linear unlocks; Yellow belt at 100 local points; compatible reload; original design/layout intact. The participant distinguishes modeled routing and local progress from delivery guarantees or certification. |

U4 rehearses the shipped first seven guided tasks, not the retired independent
exercise menu. It is an optional additional usability task, not part of the
counterbalanced U1/U2 timing comparison. Do not instruct the participant to edit
JSON or pre-demonstrate the control sequence. Treat free **Show me where** as UI
navigation assistance, separately from conceptual hints, wrong route predictions
and moderator explanation. Log a failure to locate a control as a discoverability
problem, not automatically a networking error. Record reload/resume and original
design recovery separately from the learner's explanation.

The six-mission, 40-task black-belt path is assisted practice. In particular,
the capstone currently discloses its two faults in the instructions (#205).
It is not the independent pre/post/delayed-transfer assessment below. Prepare
new reviewed, matched task variants without those answers before claiming
transfer. Exact advanced hub-table navigation is tracked in #204. Native
Japanese terminology and actual screen-reader use still need human review.

For U2 the moderator derives a native synthetic starter from
`tests\fixtures\hub-firewall.ts`, removing its Firewall declaration and static
routes while retaining the reviewed custom-table setup. Keep the completed
fixture and its separately identified published/candidate matrix as the
moderator's answer, not the participant's starter. Pin and hash both files,
rehearse the repair and independently review the selected pair. Do not substitute live Azure fidelity
for this model-contract rubric. The participant receives the topology and
networking goal, not the implementation's expected JSON or UI path.

For each task, follow up with "What was hardest to find?" and "What did the
result tell you, and what did it not prove?" Record suggestions separately from
observed behavior. Specifically watch connection discovery (#173), independent
Firewall authoring and VPN gateway visibility (#174), and clear confirmation
(#172), without suggesting those controls before the timed attempt.

Recruit EN/JA and keyboard/assistive-technology users where feasible. Report
unfilled language/interaction strata as missing. Do not generalize an English
mouse-only rehearsal to Japanese, screen-reader or keyboard usability.

## Separate learning pilot

Participation in usability does not imply consent to a learning study. Keep
assisted practice distinct from unassisted assessment:

1. Before instruction, administer a reviewed synthetic task requiring route
   selection and an explanation of what remains unknown.
2. Offer the relevant existing practice module and optional explanations; record
   hint use and time. Practice completion is not the learning outcome.
3. Immediately afterward, administer a different, matched topology with changed
   prefixes, preference or association. Do not reuse the training answer.
4. Invite a delayed novel transfer task seven days later (record actual delay).
   Include a case in which unsupported/missing evidence requires withholding a
   verified-success claim. Record attrition without inventing missing scores.

Two reviewers must approve equivalence and grade answers independently before
adjudication. Use a task-specific 0-4 rubric for route choice, mechanism,
forward/reverse reasoning and scope/uncertainty: 0 absent/incorrect; 1 partially
relevant; 2 materially incomplete; 3 correct with a minor omission; 4 correct
and sufficient for the stated scope. Retain independent ratings, disagreements
and adjudicated scores. These are local review anchors, not a validated scale.
Do not disclose assessment solutions until the last relevant attempt.

No causal learning-effect claim is allowed without an appropriate comparison
design. Report paired pre/post changes descriptively, actual follow-up intervals,
assistance, attrition and sample sizes. The application cannot create these
outcomes by rerunning its test suite.

## Analysis and decision record

Report per task and stratum, not one blended "quality score":

- Unassisted successes / eligible measured attempts, with a Wilson interval
  for independent participant outcomes on that task. Report exclusions and their
  reasons separately; never remove eligible failures/timeouts from the rate.
- Assisted successes, critical errors, assistance levels and recovery outcomes.
- Median time among successful attempts alongside all failures, withdrawals,
  timeouts and their limits. It is not the completion time of the whole sample.
- Optional ease-response distribution, language, interaction method and missing
  responses. Do not label the ad-hoc ease item SUS or reproduce an unlicensed or
  unvalidated instrument.
- Learning: eligible, completed and paired counts; pre/post/delayed scores,
  actual delay, hint use and attrition. Repeated tasks are clustered within
  participants, not additional independent people.

Review individual findings with the second reviewer, prioritize by severity and
observed obstruction, and turn reproducible product problems into issues using
synthetic examples. Keep disagreement and small-sample uncertainty visible.
Aggregate publication needs the agreed privacy review, including protection
against identifying someone from a tiny subgroup.

Until real sessions run, the report is:

| Dimension | Current result |
| --- | --- |
| Human discoverability/task effectiveness | Not measured |
| Human efficiency/recovery/satisfaction | Not measured |
| Assistive-technology usability | Not measured |
| Human learning gain/retention/transfer | Not measured |

The pilot is ready to rehearse, not evidence that these dimensions passed.
