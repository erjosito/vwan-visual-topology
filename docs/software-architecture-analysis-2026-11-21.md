# Software architecture analysis - Azure Network Simulator

**Assessment date:** 2026-11-21  
**Source snapshot:** `2a18c3b9295d6aa0844939f84e50a47df0e0da37`, freshly fetched merged `main`.  
**Manifest version:** `0.5.0`. This snapshot also includes the subsequently merged warning-acknowledgement change, #369; it is not just the previously released artifact.  
**Scope:** architecture assessment, recommendations and subsequent issue tracking only. No application changes or deployments.

**Historical snapshot:** measurements, implementation status and recommendations
below refer to the recorded source, not current main. See the
[living contract map](../PLATFORM.md#living-contracts-and-sources) for current
contracts and the linked GitHub issues for delivery status.

### Backlog tracking update - 2026-11-21

The owner subsequently requested GitHub tracking: [epic #379](https://github.com/erjosito/vwan-visual-topology/issues/379). Tabs #364 and Save #374 are already being implemented, so **R6 is now the highest-priority integration item**, not deferred until later persistence work. Coordinate their existing implementations rather than starting a competing document abstraction or blocking them on the entire epic. Recommendation IDs below remain stable; section order is not the updated urgency order.

| Urgency rank | Recommendation | Issue | Priority |
| --- | --- | --- | --- |
| 1 | R6 - Document/editor lifecycle integration | [#385](https://github.com/erjosito/vwan-visual-topology/issues/385) | P1, immediate coordination with #364/#374 |
| 2 | R1 - Mixed-editor orchestration | [#381](https://github.com/erjosito/vwan-visual-topology/issues/381) | P1 |
| 3 | R3 - Types and live request construction | [#380](https://github.com/erjosito/vwan-visual-topology/issues/380) | P1 |
| 4 | R2 - Foundational import cycles | [#383](https://github.com/erjosito/vwan-visual-topology/issues/383) | P1 |
| 5 | R4 - Interactive responsiveness | [#384](https://github.com/erjosito/vwan-visual-topology/issues/384) | P1, measure before rollout |
| 6 | R5 - Scoped uncertainty/evidence | [#386](https://github.com/erjosito/vwan-visual-topology/issues/386) | P1/P2 |
| 7 | R7 - Qualification scheduling | [#388](https://github.com/erjosito/vwan-visual-topology/issues/388) | P2 |
| 8 | R8 - Documentation freshness | [#387](https://github.com/erjosito/vwan-visual-topology/issues/387) | P2 |
| 9 | R9 - Host/operational safeguards | [#382](https://github.com/erjosito/vwan-visual-topology/issues/382) | P2/P3; signing stays in #146 |

This tracking update does not change the pinned code assessment, measurements or its evidence limits.

## 1. Executive assessment

**The architecture remains viable, but the product has outgrown its original application-level organization. An incremental modularization is warranted; a rewrite is not.**

AzNetSim is now a local simulation platform with several clients, rather than simply a Virtual WAN diagramming SPA. Its strongest decisions have survived that expansion: native document compatibility, deterministic shared engines, explicit uncertainty, bounded execution, local-first operation, and independently promoted tested artifacts.

The largest maintainability risks are concentrated orchestration in the mixed-network editor, cyclic dependencies around foundational modules, and inconsistent type-checking strictness. The principal performance risk is that interactive route calculation still executes synchronously in React despite worker-based diagnostics and platform assessments. Document lifecycle and evidence contracts need clearer internal boundaries before more save destinations, tabs, service providers or automated repair suggestions are added.

**Recommended direction:** retain one repository and a modular local simulation core; separate application orchestration, provider-specific semantics and host adapters more explicitly. Keep the two native model families. Strengthen existing boundary checks rather than introducing microservices, a graph database, a universal networking model or a general plugin framework.

## 2. Method and evidence limits

The analysis used a clean, isolated checkout of the pinned source, direct reads of implementation and test/build contracts, a TypeScript-AST import inventory, and the existing exact-source CI result. It examined workspace ownership, both engines, admission, diagnostics, learning, cloud persistence, rendering, Electron/MCP adapters and delivery.

The original comparison baseline is the first README-bearing commit, `6551eb426ac6be6a806a51d7926fa19c7b89231e`, dated 2026-10-28 [E00]. This is a scope comparison, not a claim that every intervening design decision was audited.

Existing CI [44892334417](https://github.com/erjosito/vwan-visual-topology/actions/runs/44892334417) passed `validate`, `desktop` and `mcp` for the exact assessed source. Those tests were **not rerun for this documentation-only assessment**. No new runtime benchmarks, human usability study, Azure lab validation or penetration test were conducted. Source size indicates review surface, not defects or measured latency. Findings below distinguish implementation evidence from inferred risks.

No user topology files or Azure resources were accessed for the analysis.

### Measured structural inventory

Inventory covers `.ts`, `.tsx`, `.mjs` and `.cjs` under `src`, `platform` and `functions`. Test files are excluded from the non-test column. PowerShell collectors, CSS, JSON examples, infrastructure and delivery scripts are outside these counts.

| Area | Code files including tests | Test files | Non-test files |
| --- | ---: | ---: | ---: |
| `src` | 331 | 65 | 266 |
| `platform` | 16 | 7 | 9 |
| `functions` | 10 | 2 | 8 |
| Total | 357 | 74 | 283 |

The non-test files contain 55,526 line segments, counting a trailing empty segment when present. Important concentrations:

| File | Line segments | Architectural interpretation |
| --- | ---: | --- |
| `src\azure-net\AzureNetApp.tsx` | 5,546 | Broad editor, state, calculation and workflow orchestration |
| `src\azure-net\engine.ts` | 3,843 | Substantial provider-specific simulation and forwarding kernel |
| `src\azure-net\AzureNetDiagram.tsx` | 2,352 | Large interactive presentation surface |
| `src\azure-net\model.ts` | 1,408 | Native model, validation and authored examples |
| `src\diagnostics.ts` | 1,291 | Legacy-provider investigation logic |
| `src\azure-net\diagnostics.ts` | 1,185 | Mixed-provider investigation logic |
| `src\App.tsx` | 853 | Compatibility-provider orchestration |

For comparison, `src\er-locations-catalog.ts` has 4,963 line segments but is largely catalog data. It should not be treated as the same kind of concentration as the editor or engine. The mixed editor contains 77 resolved local import declarations/calls, including type and dynamic edges; this is a coupling indicator, not a count of eagerly loaded modules.

## 3. How the scope has changed

| Original scope | Current architectural responsibility |
| --- | --- |
| Browser-only VWAN designer | Browser and Electron editors plus a local MCP client surface |
| One structural VWAN model | Compatible native v1 VWAN and native v2 mixed Azure/hybrid families |
| Hub selection and simple flow tracing | Subnet effective routes, gateway/ARS/NVA exchange, packet policies and scoped NAT/LB behavior |
| Browser autosave and JSON files | Recovery/original preservation, cloud documents, account-scoped progress and sharing |
| Diagram and route inspectors | Cross-layer diagnostics, outage/resilience analysis, guided practice and logical flow artifacts |
| Static-site delivery | Five release targets, including two optional cloud Functions |

The original system already distinguished planning simulation from Azure control-plane emulation. The expanded app generally preserves that distinction [E00, E03, E05].

In particular, application/DNS inventory and request contracts exist, but `applicationCapabilities.providers` is empty. This is a foundation for future Application Gateway, Front Door and Traffic Manager behavior, **not implemented service execution** [E03]. Likewise, bounded two-WAN S2S composition and classic VPN over ER are explicit supported slices, not arbitrary WAN federation, negotiated tunnels or live IPsec verification.

## 4. Current architecture and principal flows

### Runtime and module map

| Boundary | Main modules | Responsibility |
| --- | --- | --- |
| Startup and workspace application | `main.tsx`, `WorkspaceRoot.tsx`, `workspace-context.ts`, `workspace-session.ts` | Lazy startup, provider selection, recovery, original document ownership and account/practice handoff |
| Native editor providers | `App.tsx`, `azure-net\AzureNetApp.tsx` | Authoring, selection, history, inspections and user workflows |
| Simulation domain | `routing.ts`, `azure-net\engine.ts`, routing/NAT/inventory helpers | Provider-specific route calculation, forwarding and declared packet behavior |
| Investigation and evaluation | Both diagnostics modules, `platform\service.ts`, packet assessment, learning runner | Scoped findings and explicit requirement outcomes with uncertainty |
| Browser execution adapters | Provider diagnostics workers, `src\platform\browser.ts` | Isolated expensive assessments, cancellation and stale-result handling |
| Node/MCP adapters | `platform\jobs.ts`, `worker.ts`, `mcp.ts`, render jobs | Bounded local jobs, discovery, evidence/artifact retrieval and expiration |
| Presentation and artifact projection | Both diagram components, network detail, `flow-export.ts` | Original-resource views and a shared logical directional scene |
| Desktop host | Electron main/preload/broker | Restricted local assets, narrow IPC, file selection and explicitly approved read-only Azure collection |
| Optional user cloud | Cloud session/client/document state; user-cloud Function | Authentication, private topology/progress persistence and sharing |
| Optional operational statistics | Statistics Function and dashboard | Scheduled GitHub/SWA aggregate metrics, separate from simulation and user documents |

This is best described as a **local modular monolith with multiple host adapters and two optional independently deployed backend services**. The frontend is still a single-repository SPA, but the whole product is no longer frontend-only.

### Flow A: edit, calculate and inspect

The root selects an authoritative native provider. That provider owns edits and history, produces a failure-adjusted routing input, calculates routes and projects results into inspectors and the diagram. Mixed-provider semantic/display revisions avoid recalculating routes for many presentation-only changes [E01, E02, E06].

Importantly, the initial interactive route calculations in both editors are synchronous `useMemo` calls. Worker execution exists for diagnostics and platform evaluations; it does not currently cover all interactive routing [E02, E04].

### Flow B: explicit assessment and learning

A request passes strict plain-JSON and envelope admission, native parsing and ownership validation, then the same domain kernels. Results distinguish `satisfied`, `violated` and `not assessed`. Browser/Node hosts add execution bounds and termination.

Learning binds proof to a practice workspace, revision and generation; edits or cancellation invalidate it. Progress cannot be awarded merely because a stale result or incomplete requirement set looks successful [E04, E10]. This is an important application boundary to preserve.

### Flow C: collection and persistence

Desktop collection runs behind the main-process broker against an explicitly selected existing CLI scope. Captures are bounded, filtered and parsed, then deliberately handed to the workspace. Native files, observed Azure configuration and simulated outcomes are distinct artifacts [E11].

Local recovery persistence, explicit cloud saving and cloud-version comparison are also distinct. Cloud document state tracks account, provider, epoch, sequence, digest and ETag. Practice suppresses normal document saving. These are substantive protections, not merely status labels [E01, E09].

### Flow D: rendering and delivery

UI and Node rendering share a logical scene with independent forward/return lanes and unknown/stopped states. Render workers produce bounded artifacts with hashes; the scene is not a canvas screenshot or packet-delivery certificate [E12].

Integration CI builds candidates without publishing. Explicit promotion checks source, run, attempt and target, then reuses tested archives. Five targets are promoted independently, although web/statistics/user-cloud currently share the `validate` qualification job [E13].

## 5. Strengths worth retaining

1. **One semantic implementation across clients.** Browser, desktop and MCP reuse the TypeScript kernels. The Node build already rejects browser/React/i18n leakage into its bundles; host separation is partly executable, not just documented [E04, E16].
2. **Compatibility without lossy universal conversion.** Native v1/v2 documents and provider identities remain explicit. Original bytes are preserved before replacement, and storage failure refuses unsafe transitions [E01, E08].
3. **Conservative evidence.** Nonconvergence, unsupported scope and unavailable prerequisites remain distinguishable from success. The VPN-over-ER wrapper resolves its outer routes with private overlays withdrawn, avoiding circular self-support [E05].
4. **Appropriate separation of presentation and authority.** Original ownership is retained in views and flow exports. Warning acknowledgement is evidence-fingerprinted UI triage, not permission to ignore an evaluation failure; its state is excluded from routing revisions [E06, E07].
5. **Local-first and deliberate online transitions.** Normal simulation needs neither credentials nor cloud storage. Authentication modules load on demand; user-cloud operations enforce account/version boundaries. Electron restricts renderer egress while separately mediating CLI collection [E09, E11].
6. **Meaningful qualification beyond unit tests.** The repository has real browser workflows, packaged/offline host checks, production CSP/startup checks, collector/Bicep validation and a quality framework that separates automated conformance from human usability or Azure fidelity [E13, E14].

## 6. Findings and recommendations

Priorities: **P1** means address in the next architectural hardening work; **P2** means planned improvement; **P3** means contingent on demonstrated demand. They do not imply a current outage or exploitable vulnerability.

### R1 - Decompose mixed-editor orchestration, not just JSX size (P1)

**Evidence:** The 5,546-line mixed editor owns selection, modal/editor state, topology commits and validation, undo/redo, local persistence, route/trace calculation, worker lifecycle and diagnostics. The root/context additionally coordinates accounts, practice, learning and document state [E01, E02].

**Risk:** A feature-specific edit can affect unrelated ownership, persistence or calculation paths. Extracting only visual fragments would leave this coupling intact. The much smaller legacy editor shows that the problem is concentrated, not uniform throughout the app.

**Recommendation:** Extract cohesive provider-level controllers/hooks for document/history commands, routing/trace state, diagnosis sessions and editor selection. Move inline feature editors into existing feature modules. Leave the page as composition and interaction wiring, with one authoritative topology/history per active document.

Split workspace context by responsibility where subscriptions are genuinely independent; do not merely create a global store containing the same broad object. Keep provider-specific actions typed. Reuse current command/menu helpers so toolbar, keyboard and context-menu actions continue to operate on the same original resources.

**Acceptance:** Existing create/edit/undo/import/practice/EN-JA workflows still pass; unrelated panels do not acquire duplicate document state; dirty drafts and selection changes remain protected.

### R2 - Remove verified foundational import cycles (P1)

The syntactic static-runtime import graph contains four nontrivial strongly connected groups:

| Group | Concrete coupling | Suggested cut |
| --- | --- | --- |
| `validation`, `hub-routing`, `inventory`, `application-inventory` | Validation imports higher-level validators/routing helpers; those modules return to validation or inventory | Extract pure IPv4/CIDR primitives and separate inventory projections from aggregate validation |
| `azure-import`, `azure-observation` | Capture import consumes observation parsing; observation consumes import/stable identity helpers | Move stable ARM identity utilities to a neutral module; separate observation parsing from capture composition |
| `bicep-export`, `connectivity-bicep` | Export calls connectivity generation, which imports location normalization back from export | Move location normalization into a small shared deployment primitive |
| User-cloud `handler`, `sharing` | Handler constructs sharing; sharing imports body/error helpers from handler | Extract request-body/error primitives, keeping authentication and store contracts explicit |

The edges were confirmed by direct reads [E15]. The graph excludes type-only imports, dynamic edges and re-exports; it is not an exhaustive proof that only four runtime cycles exist. No initialization defect was reproduced.

**Risk:** Foundational modules cannot be reasoned about or imported independently. Dependency growth can pull unrelated concerns across runtime or bundle boundaries and make later extraction more fragile.

**Recommendation:** Break the listed edges with small, dependency-leaf modules. Preserve existing exported names through compatibility re-exports where useful. Extend the existing headless bundle guard with targeted cycle/layer checks, initially preventing new cycles and then removing the baseline groups. Do not respond with a broad utility barrel.

**Acceptance:** These groups disappear from the static graph; existing admission, capture, Bicep and cloud tests pass; Node/browser dependency guards and startup budgets remain unchanged.

### R3 - Align type and request-construction boundaries (P1)

**Evidence:** Platform TypeScript explicitly enables `strict`; the app and user-cloud configurations do not, and their configurations do not inherit it from the root. Public simulation/evidence fields remain broadly typed. MCP schemas, service admission and native schemas contain separately maintained representations of contracts [E04, E16].

The live platform admits only plain JSON and rejects `undefined`, accessors and unsafe objects. The hybrid editor correctly deletes unset optional properties instead of assigning `undefined` [E17]. A storage JSON round trip can erase that distinction.

**Risk:** Internal edits can type-check in one build and fail another boundary. Large refactors are less protected by nullability checks, and duplicated contract representations can drift.

**Recommendation:** Establish a strictness baseline and stage stricter checking, starting with command, request and document-state boundaries. Introduce typed request constructors and internally discriminated provider/operation results, while preserving existing wire contracts.

Share constants and envelope definitions where practical, and test admission/discovery agreement. Do not replace bounded unknown-field retention with blanket strict native-field rejection: portable extension retention and semantic support are deliberately different concepts.

**Acceptance:** Live, unsaved editor objects reach an actual worker correctly; unset optional fields are omitted; malformed/unknown requests still fail closed; contract 1/2 and native v1/v2 compatibility tests pass. Avoid broad `any` or suppression-based strictness migrations.

### R4 - Treat interactive responsiveness separately from worker assessments (P1)

**Evidence:** Mixed routing and traces are synchronous memoized calls, and legacy routing also executes synchronously. Mixed semantic revisions already avoid many presentation-triggered calculations, but cloning, revision serialization, history and localStorage still process substantial document snapshots [E02, E06, E08].

**Risk:** A large routing edit can block input despite asynchronous diagnosis. This is a source-visible risk, **not a newly measured slowdown**.

**Recommendation:** Use the existing opt-in local performance counters and dense fixtures to measure commit, projection, simulation, persistence and rendering separately. Prototype moving the expensive interactive calculation to a provider-specific bounded worker, with cancellation, semantic revision and generation ownership. Do not show an old result as current while replacement work is pending.

Do not simply substitute `runBrowserSimulation` everywhere. Public platform execution has a 512-node/15-second/8-million-byte output envelope, whereas structural VWAN admission can retain 1,000 VNet references. Its full evidence payload is not automatically the right interactive response. Also, internal mixed routing-name tokens contain NUL characters forbidden by public admission; pass native documents and compute internal projections behind an appropriate worker boundary [E04, E06, E18].

Only after measurement should history deltas, indexed recovery storage, inspector virtualization or viewport culling be considered. Preserve original IDs, keyboard navigation and recoverability.

**Acceptance:** Repeatable near-limit edit/trace/undo measurements improve on representative hardware; cancellation and stale-result tests pass; small designs remain responsive; startup stays within the existing 300,000 gzip/1,200,000 raw byte ceilings [E14].

### R5 - Make uncertainty scope and evidence structure easier to extend (P1/P2)

**Evidence:** Strongly typed diagnostic findings coexist with engine warning strings and broadly typed platform evidence. Mixed-provider exact-route grading conservatively returns unknown when `simulation.warnings.length` is nonzero, even before relating a warning to the requested table [E04, E05].

**Risk:** Growing capabilities can make unrelated warning conditions suppress otherwise independently assessable requirements. Conversely, casually relaxing a global guard could produce false passes. Presentation prose is also a fragile integration contract for future remediation or service providers.

**Recommendation:** Incrementally introduce structured limitation records with stable code, original owner/scope, affected operation and evidence references. Preserve provider-specific route/packet semantics; share an evidence envelope, not one universal route algorithm.

Replace coarse certification guards only when a scoped completeness rule has explicit positive, negative and unrelated-uncertainty tests. Keep acknowledgement, visual severity and assessment authority independent. Future repair suggestions should construct an isolated candidate change and evaluate explicit before/after requirements through the same kernel, then require deliberate application.

**Acceptance:** Relevant unknowns never pass; independent known failures remain reportable; unrelated uncertainty is handled explicitly; prose/localization changes cannot change warning identity or grading. Directional firewall explanations retain separate forward/return owners.

### R6 - Formalize document and editor-session lifecycle before Save/tabs growth (P1 for #374)

**Evidence:** Cloud document state already tracks account, provider, tickets, fingerprints and ETags. Local history/persistence differs between providers. Configuration switching partly detects dirty state by inspecting DOM values and data attributes [E08, E09, E19].

**Risk:** Remembered file/cloud saving and multiple documents would expand destination, permission, draft and in-flight-operation states. Duplicating cloud protections in each button or relying on DOM inspection across newly extracted editors would be error-prone.

**Recommendation:** Evolve the existing document state into explicit per-document commands: load, save, save-as, replacement, recovery and dirty-editor registration. Reuse current epoch/account/ETag checks; distinguish local recovery persistence from the explicitly saved artifact. Keep route/display revisions, document fingerprints and assessment generations semantically distinct.

For #374, store destination metadata outside portable topology JSON. Desktop remembered saving needs narrow main-process capabilities, not arbitrary renderer paths. Browser overwrite support must honestly handle file-handle permissions and download-only fallback. Normal successful saves should use non-modal destination/status feedback; cloud-upload consent is a separate boundary, not an incidental popup to remove [E11].

Do not introduce IndexedDB or a state-machine library solely to rename commands. Replace DOM dirty detection incrementally with explicit editor-session contracts while retaining the existing guard until coverage is complete.

**Acceptance:** First/repeated save, save-as, cancelled dialogs, failed writes, account changes, cloud conflicts, edits during a save, practice isolation and future tab isolation are tested without losing current recovery behavior.

### R7 - Improve qualification scheduling without weakening evidence (P2)

In exact-source CI run 44892334417, the observed job durations were:

| Job or selected step | Minutes |
| --- | ---: |
| `validate` job | 43.95 |
| Browser suite step | 29.80 |
| Collector step | 8.68 |
| Production smoke step | 1.38 |
| Accessibility gate step | 1.08 |
| `desktop` job | 6.18 |
| `mcp` job | 0.90 |

This is one run, not a historical distribution; step durations are subsets of their job and must not be added to job durations. The evidence identifies browser/collector scheduling as the major qualification cost, rather than unit execution.

**Recommendation:** Consider browser sharding and independent collector/backend qualification, retaining the existing `validate` aggregate contract and exact source/run/attempt artifact identity. Build the browser candidate once and validate those same bytes across applicable jobs. Promotion must still require every gate necessary for the selected target.

Select tests by changed architectural dependency and risk, **not by patch/minor version alone**. Engine, admission, evidence, ownership and shared-editor changes still need cross-provider/host and relevant complete learning workflows. A targeted release dispatch already avoids unrelated target runners; use that existing seam before weakening tests [E13].

Retain human task-based evaluation for discoverability, density and explanation quality. Passing scripted workflows is not a human usability, learning-effectiveness or Azure-fidelity result [E14].

### R8 - Keep architecture/capability documentation current (P2)

**Verified drift:** `scripts\quality-scorecard.mjs` declares scorecard version 14, while `docs\quality-evaluation.md` identifies the executable manifest as version 7 [E14]. This does not invalidate the executable gate, but it weakens the document as a current architectural reference.

**Recommendation:** Maintain a small set of authoritative contracts/decision records for native versions, execution envelopes, supported providers, evidence authority and persistence. Check duplicated version/capability statements against executable definitions where inexpensive. Link long feature narratives to those contracts instead of repeating mutable values in multiple places.

Treat this report as a dated snapshot, not a replacement for living contracts. The documented mismatch is recorded here, not fixed as an unrelated change.

### R9 - Preserve host trust boundaries as operational needs grow (P2/P3)

**Evidence:** Electron uses sandboxed/context-isolated rendering and narrow origin-checked IPC. Cloud storage uses managed identity and conditional blob versions. MCP jobs/artifacts are local, bounded and expiring. Windows packaging explicitly disables executable signing [E09, E11, E12, E20].

**Recommendation:** Preserve these boundaries when adding save capabilities, optional online services or updates. Prioritize signed desktop distribution when enterprise adoption requires it; provenance/checksums are useful but do not replace publisher signing.

The sharing handler's throttles are instance-local counters [E09]. If hosted scale-out becomes material, explicitly design aggregate quotas/rate controls and recovery/restore procedures rather than assuming those counters are global. Actual hosting scale, restore configuration and capacity were not validated here.

Do not add cloud simulation workers, generic shell MCP tools or automatic deployment just because the product now has a backend. Local MCP transport also does not mean an AI client keeps supplied topology data offline.

## 7. Suggested migration sequence

| Stage | Bounded deliverable | Dependencies and verification |
| --- | --- | --- |
| 0 - Preserve baseline | Record critical ownership/JSON/uncertainty contracts; collect strictness and dense-workload baselines | No behavior changes; reuse current CI, local counters and fixtures |
| 1 - Reduce coupling | Break the four import groups; extract one mixed-editor controller at a time | R2 can start independently; preserve public exports, native saves and lazy loading |
| 2 - Harden application boundaries | Typed commands/requests, staged strictness, explicit dirty-editor ownership | R1/R3 groundwork; actual live-worker and document-concurrency checks |
| 3 - Address measured latency | Interactive-worker prototype and only profile-justified snapshot/render improvements | R4 baseline and stable request/revision contracts; unchanged execution admission safety |
| 4 - Expand safely | Scoped limitation/evidence records, #374 lifecycle, future application providers | Independent negative/unknown fixtures; no unsupported provider becomes implicitly enabled |
| Parallel delivery track | Browser/collector scheduling and documentation freshness | Preserve aggregate qualification and immutable promotion; no SemVer-based blind skips |

Small independent PRs should each state which invariant they preserve and which new boundary they establish. Avoid a simultaneous engine, editor, schema and storage rewrite: it would make regressions difficult to attribute and discard much of the existing qualification advantage.

## 8. Success criteria and non-recommendations

The hardening is successful when a new feature can be added through a bounded provider/feature module without editing a large set of unrelated lifecycle handlers, and when native compatibility, live-worker JSON safety, unknown-result handling and lazy startup remain mechanically protected.

Measure dependency groups, changed orchestration surface, applicable qualification time, near-limit interaction durations and false-pass/false-failure cases. Do not invent a single architecture score or use file-size targets as a substitute for cohesion.

**Not recommended now:** microservices for local simulation; mandatory sign-in/cloud persistence; merging native v1/v2 into a lossy schema; event sourcing/graph storage without a demonstrated requirement; a runtime plugin ecosystem; relaxing unknown/admission guards; increasing startup or headless bounds just to hide regressions; declaring application/DNS services implemented from their inventory contracts.

**Overall conclusion:** invest in internal application boundaries and explicit evidence/document contracts. The shared local simulation and delivery architecture is an asset to evolve, not something to replace.

## Evidence index

Links are immutable source references to the assessed commit unless explicitly marked as the original baseline.

- **E00 - Original scope:** [original README, lines 1-17](https://github.com/erjosito/vwan-visual-topology/blob/6551eb426ac6be6a806a51d7926fa19c7b89231e/README.md#L1-L17).
- **E01 - Workspace authority and handoff:** [root, lines 321-442](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/WorkspaceRoot.tsx#L321-L442); [workspace context](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/workspace-context.ts#L11-L57).
- **E02 - Interactive calculation and editor orchestration:** [mixed editor, lines 317-533](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-net/AzureNetApp.tsx#L317-L533); [legacy synchronous calculation](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/App.tsx#L260).
- **E03 - Application foundation, not providers:** [capabilities](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/application-inventory.ts#L5-L18).
- **E04 - Shared contracts and bounded hosts:** [plain JSON/request admission](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/platform/service.ts#L17-L89); [execution/grading](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/platform/service.ts#L195-L260); [limits/result types](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/platform/contract.ts#L58-L96); [browser host](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/platform/browser.ts#L5-L29); [Node jobs](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/platform/jobs.ts#L9-L82); [MCP envelope](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/platform/mcp.ts#L114-L141).
- **E05 - Independent VPN underlay, convergence and warnings:** [engine, lines 400-461](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-net/engine.ts#L400-L461).
- **E06 - Semantic/display separation:** [routing input](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-net/routing-input.ts#L11-L60).
- **E07 - Warning triage is not authority:** [fingerprint](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/warning-evidence.ts#L1-L33); [evidence binding](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/warning-triage.ts#L6-L31).
- **E08 - Preservation and local history:** [original bytes/rollback](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/workspace-session.ts#L47-L85); [legacy history/persistence](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/useTopologyHistory.ts#L47-L121).
- **E09 - Cloud ownership, consent and store:** [document state](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/cloud/document-state.ts#L23-L149); [save workflow](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/cloud/CloudPanel.tsx#L80-L122); [lazy/account-scoped session](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/cloud/session.ts#L12-L75); [conditional blob store/runtime identity](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/functions/user-cloud/index.ts#L16-L80); [sharing counters](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/functions/user-cloud/sharing.ts#L14-L24).
- **E10 - Learning proof ownership:** [runner](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/learning/runner.ts#L133-L251).
- **E11 - Desktop capabilities:** [main-process origin/protocol/network/IPC checks](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/platform/electron/main.ts#L23-L110); [broker scope and capture bounds](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/platform/electron/broker.ts#L14-L133).
- **E12 - Shared scene and bounded rendering:** [scene](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/flow-export.ts#L11-L48); [render jobs/artifacts](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/platform/render-jobs.ts#L11-L93).
- **E13 - Qualification/promotion:** [CI gates/candidates](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/.github/workflows/ci.yml#L23-L147); [release contract](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/docs/releasing.md#L3-L34).
- **E14 - Production and quality authority:** [startup budget/lazy exclusions](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/e2e/production/smoke.ts#L131-L158); [executable scorecard/version](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/scripts/quality-scorecard.mjs#L3-L48); [quality dimensions and stale version statement](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/docs/quality-evaluation.md#L1-L70).
- **E15 - Confirmed cycle edges:** [validation](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/validation.ts#L1-L8), [hub routing](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/hub-routing.ts#L1-L2), [inventory](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/inventory.ts#L1-L3), [application inventory](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/application-inventory.ts#L1-L3), [capture import](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-import.ts#L1-L5), [observation](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-observation.ts#L1-L4), [Bicep export](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/bicep-export.ts#L1-L4), [connectivity generation](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/connectivity-bicep.ts#L1-L3), [cloud handler](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/functions/user-cloud/handler.ts#L1-L3), [sharing](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/functions/user-cloud/sharing.ts#L1-L4).
- **E16 - Type/build boundaries:** [app compiler](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/tsconfig.app.json), [platform compiler](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/tsconfig.platform.json), [Function compiler](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/functions/user-cloud/tsconfig.json); [headless bundle guard](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/scripts/build-platform.mjs#L4-L24).
- **E17 - Live JSON-safe editing:** [optional property omission](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-net/HybridRoutingEditor.tsx#L54-L92); [bounded extension retention](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/azure-net/admission.ts#L134-L155).
- **E18 - Different import/collection envelopes:** [structural limits](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/topology-limits.ts#L1-L5); [collector limits](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/collect-azure-vwan.ps1#L13-L16); [legacy browser file limit](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/App.tsx#L615-L624).
- **E19 - Shared interactions and dirty tracking:** [menu helpers](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/context-actions.ts#L4-L27); [DOM configuration guard](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/src/configuration-selection.ts#L3-L24).
- **E20 - Distribution and operational service:** [desktop signing setting](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/electron-builder.json#L11-L15); [separate statistics runtime](https://github.com/erjosito/vwan-visual-topology/blob/2a18c3b9295d6aa0844939f84e50a47df0e0da37/functions/github-statistics/index.mjs#L12-L69).
