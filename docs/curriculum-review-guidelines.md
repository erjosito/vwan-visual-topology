# Curriculum review guidelines

Review baseline: 2026-11-23. This consolidates the product owner's feedback
through the revised curriculum and the step 2 quiz correction. Use it for future
curriculum proposals, content reviews and acceptance checks. It is a statement
of intended experience, **not a claim that every requirement is implemented**.
Update it when a later decision changes the baseline; distinguish proposals
from approved requirements. Supporting evidence, compatibility and localization
guardrails reflect the accepted authoring approach, not additional verbatim
user requests.

The central principle is: **teach Azure networking through meaningful,
guided scenarios, not how to operate the simulator.**

## 1. Guided experience and clear explanations

- Use a non-modal sidebar and one active task at a time. Unlock tasks linearly,
  rather than presenting an exercise menu.
- Introduce a believable situation, the architecture and the goal before asking
  for an action. Explain why a hub, gateway, firewall or other new component is
  useful before introducing its settings.
- Use explicit networking language: for example, "Open the effective routes
  for subnet Workload in VNet Application." Explain what effective routes are
  before requiring their interpretation. Do not rely on ambiguous shorthand
  such as `Application / Workload` or unexplained terms such as IP "ownership."
- Give navigation help by revealing and highlighting the exact native
  button, command or field. Finding a simulator control is not the skill being
  assessed, and navigation help must not perform the learner's repair.
- Keep scenario context distinct from the current task. Show scenario-local
  progress as well as overall progress so repeated background is not mistaken
  for a new instruction.
- Keep the original task visible, with its result and "What you learned"
  explanation below it. Wait for explicit **Next** before replacing it.
- Debriefs should explain the observed networking behavior, not just announce
  success. Include a relevant official Microsoft documentation section that
  opens in another tab. Briefly signpost related topics taught later.
- Provide back/review navigation through completed material without unlocking
  future tasks or silently replacing the learner's current work.

## 2. Low-friction interaction and topology continuity

- Detect completed native inspections and valid edits automatically; do not
  require routine "Record inspection" or "Check task" clicks. A quiz still
  requires deliberate answer submission.
- Remove redundant instructions, repeated warnings and unnecessary buttons.
  Once practice is loaded, continuing it should be the primary action, not
  loading it again. Keep restart and other advanced options secondary.
- Put secondary guidance in tooltips or progressive disclosure, not repeated
  paragraphs such as "Navigation help never costs points."
- Be accurate about account state and storage. Do not show "No account" or
  "not synchronized" warnings to a signed-in learner indiscriminately.
  Distinguish locally saved, session-only, syncing, synchronized and failed
  states rather than implying cloud success from a local save.
- Protect normal designs. Confirm before replacing a different topology or
  discarding edits; keep practice separate from normal saved work.
- Within an approved guided journey, prepare the next scenario after explicit
  Next where safe. Do not make loading a sample a repeated assessed task.
- Minimize topology resets. Prefer incremental changes, such as introducing a
  firewall hub, then creating peerings, then configuring routes. When a new
  architecture snapshot is necessary, explain what changed and why.
- Introduce route tables, UDRs and other new concepts gradually, not as unexplained
  settings in an almost-finished topology.
- Explain expected intermediate canvas warnings: which are intentionally
  unresolved, why they appear and when the lesson will address them.
- Native inspection, path highlighting and animations must work in protected
  practice as in normal designs, respecting reduced-motion preferences.
- Keep quizzes compact and readable; avoid stretched radio controls or excessive
  empty space.
- Do not expose JSON, engine payloads or authoring contracts in the learner flow.

## 3. Meaningful scenarios and assessments

- Prefer practical, varied architectures and troubleshooting over a sequence
  of theoretical route-table questions.
- Mix closed inspections, open repairs and interpretation/design quizzes.
  Examples include identifying a next hop, repairing missing UDRs or gateway
  propagation, explaining asymmetric routing and comparing design drawbacks.
- Every task needs an explicit learning objective and observable evidence.
  Ask: **what does a correct response demonstrate that the previous task did not?**
- Teach or reference the underlying concept before assessing it. Debriefs and
  belt summaries must describe what the learner actually did, not the next
  chapter's objectives.
- Loading a topology is preparation, not evidence that the learner understands
  a VNet. Award no XP or mastery claims for loading alone.
- Give each assessed task points, but grant first-earned credit only once.
  Use fresh evidence from the correct scope; stale or unsupported results must
  not count as completion.
- Check the networking objective rather than a particular simulator gesture.
  Where the exercise permits alternatives, accept supported valid repairs and
  preserve other working conversations and intended isolation.
- Avoid duplicate tasks that merely restate longest-prefix matching or another
  already-covered concept. Revisit it only with a distinct application or
  increased diagnostic complexity.
- Prefer realistic operational problems. The proposed hypothetical `/24`
  next-hop-None UDR question was rejected as both unusual and repetitive;
  that is not a blanket prohibition on explaining discard routes.
- Quizzes must test networking reasoning, not reading back a fact already
  supplied by the question. Use plausible distractors with comparable grammar,
  detail and length; avoid giveaways such as absurd alternatives or conspicuous
  "always"/"never" phrasing.

### Concrete quiz-review example

Rejected: **"Where is 10.22.1.10 owned?"**, with **"Partner / partner-work"**
as the answer, immediately after saying Partner uses that address.
The notation was unclear and the question did not demonstrate useful learning.

Approved replacement:

> Application has a local VNet route for 10.21.0.0/16. Does that route cover
> destination 10.22.1.10?

The answer explains that the prefix covers 10.21.0.0 through 10.21.255.255.
Being a private IP does not make 10.22.1.10 local to that VNet. This assesses
**route-prefix scope**; connecting the VNets remains the following task.

## 4. Architecture choices and approved sequencing

- Start with ordinary VNet peering and actual Azure Firewall, not a generic NVA
  merely named "firewall." Avoid introducing customer-managed HA questions
  before learners understand basic inspection and routing.
- Teach VNet gateways and basic hybrid VPN before advanced SD-WAN. Do not insert
  an SD-WAN appliance into an Azure-to-Azure path without a credible architectural
  purpose. A future SD-WAN scenario should justify its external-site role.
- Teach static VPN routing before BGP, then introduce ExpressRoute circuits,
  peering locations, location redundancy and gateway/MSEE BGP evidence.
- Introduce basic Virtual WAN early, not for the first time at brown belt.
  Put secured private Virtual WAN immediately after basic Virtual WAN because
  it is a common deployment pattern.
- Introduce customer-managed NVA HA later. Contrast its responsibilities with
  managed Azure Firewall and the routing complexity Virtual WAN absorbs.
- Do not retain a standalone early forwarding-settings chapter simply to
  exercise another control or repeat route selection.

The approved revised baseline is twelve chapters and 72 assessed tasks.
These counts describe this edition, not a prohibition on future revisions:

| Chapter | Topic | Chapter-end belt |
| --- | --- | --- |
| C01 | VNets, address ranges and private peering | White/yellow |
| C02 | Azure Firewall, UDRs and independent return routing | Yellow |
| C03 | Basic Standard Virtual WAN and managed transit | Yellow/orange |
| C04 | Secured private Virtual WAN and private routing intent | Orange |
| C05 | Static VPN, VNet gateway and gateway sharing | Orange/green |
| C06 | VPN BGP learning versus route propagation | Green |
| C07 | ExpressRoute circuits, locations and BGP evidence | Green/blue |
| C08 | ExpressRoute location resilience | Blue |
| C09 | ExpressRoute preference and VPN backup | Blue/brown |
| C10 | Customer-managed NVA HA | Brown |
| C11 | Multi-hub routing tables, labels and segmentation | Brown/black |
| C12 | Independent-fault troubleshooting and handover | Black |

Earlier suggestions to place VPN directly after the firewall chapter, or to
introduce Virtual WAN only after ExpressRoute/NVA HA, were superseded by this
approved early-Virtual-WAN sequence. Keep the prerequisite reasoning, not both
conflicting orders.

## 5. Gamification, scope and progress

- Make early levels attainable quickly; increase challenge meaningfully later.
- Show the current belt, earned XP and points remaining to the next belt in
  readily accessible status, alongside accurate sign-in/storage information.
- Delineate stages around coherent topics, not arbitrary point thresholds.
  Belt recognition must reflect assessed learning, not navigation or loading.
- Give a mixed/full-color milestone after each chapter. Keep mixed milestones
  lighter; full-belt celebrations should show the new belt, a short summary of
  topics learned since the previous full belt and subtle accessible confetti.
- Scope belts to the published track, not all Azure networking or professional
  certification. Routing is the current focus; DNS and Application delivery
  were requested as explicitly **Planned** tracks, not playable promises.
- Preserve earned history when compatible content changes. A beta-era waiver
  allowed a particular earlier curriculum extension without preserving old
  sessions; it is not standing permission to reset progress on every revision.
  Revised-edition opt-in and historical achievements remain separate concerns.

## 6. Maintainability, evidence and future scope

- Keep curriculum content, ordering, prerequisites, XP, quizzes and guidance
  declarative so routine curriculum edits require few runtime code changes.
- Maintain English/Japanese parity for instructions, choices, feedback and
  debriefs. Keep identity/version compatibility separate from wording changes.
- Base exercises on actual supported native controls and shared simulation
  evidence. Identify missing app capabilities as follow-up work rather than
  writing an exercise that cannot be completed.
- Be explicit about model limits: a successful route alone does not demonstrate
  firewall/NSG permission or application availability. Steady-state routing is
  not live Azure convergence, measured failover or session continuity.
  Aggregate ExpressRoute evidence is not an independent observation of each MSEE.
- Use the book and public blog scenarios as inspiration for original exercises
  and coverage reviews. Do not publish copyrighted book extracts or private
  reference material in this public repository.
- As DNS and application routing become supported, expand diagnosis beyond route
  inspection to resolution and request/port-specific evidence. Keep unsupported
  areas, including deferred multicloud work, explicit.
- Review curriculum and gallery structure as related but independent deliverables.
  Before implementing a substantial redesign, iterate on it and perform a fresh
  critique for gaps, repetition, prerequisite jumps and misleading explanations.

### Suggestions and open questions, not blanket requirements

- A learning-path editor was raised as a possible way to review content faster;
  its implementation was not approved by that question alone. A concise scenario
  overview is already useful without requiring a complete learner walkthrough.
- Azure Route Server was discussed as useful context but potentially too advanced.
  The approved v2 treatment is an ungraded architectural comparison, not a
  prerequisite configuration lab.
- Per-step topology snapshots were suggested as one possible way to support
  review navigation, not mandated as the storage design.

## 7. Reusable review checklist

For each chapter and task, record **pass / gap / not applicable**, the evidence,
and any follow-up issue. Inspect the actual learner UI as well as authored text.

- [ ] Is the situation and networking purpose clear before the first action?
- [ ] Is each new concept explained before it is assessed?
- [ ] Are VNet/subnet names, prefixes and inspection scopes unambiguous?
- [ ] Does every task assess a distinct, useful objective rather than repetition?
- [ ] Do quizzes require reasoning, with plausible and balanced alternatives?
- [ ] Can navigation help reveal the correct native control without doing the work?
- [ ] Are preparation and completion separate, with no loading-only XP?
- [ ] Does credit require current evidence and preserve other required outcomes?
- [ ] Are topology transitions justified, incremental where possible and safe?
- [ ] Do instructions remain visible with a truthful debrief and explicit Next?
- [ ] Are context, progress, warnings and storage/account messages accurate?
- [ ] Are review, resume, reload and account changes safe for designs and history?
- [ ] Do belt milestones reflect coherent assessed topics and appropriate difficulty?
- [ ] Is the native EN/JA experience readable, keyboard-accessible and usable on
      narrow screens, with appropriate reduced-motion behavior?
- [ ] Are simulator limitations and deferred coverage stated without distracting
      from the lesson or claiming unimplemented capabilities?

## References and maintenance

Feedback basis: the learning-design conversation through 2026-11-23. The sections
above paraphrase that feedback and distinguish later approved decisions from
earlier proposals; they do not reproduce private reference sources.

- [Learning epic #176](https://github.com/erjosito/vwan-visual-topology/issues/176):
  original guided-learning scope and staged delivery.
- [Technical authoring contract](../src/learning/AUTHORING.md): schemas, evidence,
  compatibility and runtime rules. Its historical edition-specific descriptions
  must not be mistaken for the current pedagogical baseline.
- [Diagnostics and learning roadmap](diagnostics-learning-roadmap.md): future
  service coverage and cross-layer evidence.
- [Revised curriculum #406](https://github.com/erjosito/vwan-visual-topology/pull/406)
  and [quiz clarification #434](https://github.com/erjosito/vwan-visual-topology/pull/434):
  approved concrete changes.

For future reviews, update this document when the product decision changes.
Use issues for defects and proposals, the authoring contract for implementation
mechanics, and this document for the experience and teaching-quality baseline.
