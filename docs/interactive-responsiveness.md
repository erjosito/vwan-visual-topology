# Interactive responsiveness measurements

This records the measurement phase and bounded native optimization of #384,
not a worker rollout. Interactive native edits and traces are measured separately from
the resumable assessment workers and the public/headless platform executor.

## Reproduce

Run from the repository root after installing the existing dependencies and
Playwright Chromium:

```powershell
npm run build
npm run benchmark:interactive -- --output test-artifacts\interactive-benchmark.json
```

The benchmark starts its own loopback production server on a random port,
opens isolated Chromium contexts, and closes both on completion or failure.
Requests outside that server's origin are blocked. It uses synthetic native
documents, English, the new UI, and a 1440 x 1000 viewport; it does not sign in
or access cloud topologies. Run it without concurrent builds or benchmarks.

Default coverage is all three modes and all three workload tiers, with one
excluded warmup followed by five measured iterations. Each iteration performs
a display edit, Undo, a semantic edit, Undo, and a native trace. The exact edited
field and original native ID are checked, every Undo must restore the complete
original saved document, and tracing must not mutate it. Edit persistence and
actual native trace execution are required, not inferred from a fast UI action.
Warmup leaves tracing active: subsequent edits measure the traced-workspace
steady state, not only a fresh idle editor.

For a focused comparison:

```powershell
npm run benchmark:interactive -- --mode hub-spoke --tier dense --iterations 10 --output test-artifacts\interactive-dense.json
```

`--mode` accepts `vwan`, `hub-spoke`, or `full`; `--tier` accepts `small`,
`dense`, or `near-limit`. Both flags can be repeated. Iterations must be 2-20.
Failed cases remain `not-assessed` with partial samples and a reason, and the
command exits unsuccessfully rather than reporting them as zero-cost work.
Source changes during measurement also fail the run.

## Workloads and bounds

| Mode | Small | Dense | Near-limit |
|---|---|---|---|
| VWAN | 3 VNets, 1 hub, 1 prefix/VNet | 200 VNets, 4 hubs, 4 prefixes/VNet | 1,000 VNets, 4 hubs, 1 prefix/VNet |
| H&S / Full Hybrid | 3 VNets, 4 site prefixes | 61 VNets, 500 site prefixes | 1,000 simple VNets, one explicit first-to-last peering |

VWAN uses the real native collector importer and layered layout. Mixed
small/dense workloads adapt the existing firewall/UDR dense browser fixture.
The mixed near-limit workload is deliberately **structural-limit sparse**:
it does not represent a dense 1,000-VNet transit mesh. All workloads must retain
the complete seeded native ID list through admission in the real browser.

These tests do not raise any existing import, prefix, layout, or engine limit.
They do not certify the public platform's distinct 512-node, 15-second, or
8 MB output envelope. Internal routing-name tokens are not sent through public
JSON admission. A native success is neither Azure validation nor a public
executor qualification.

## Timing and provenance

The primary measurement starts at the browser's captured input/click/change
event and ends after two `requestAnimationFrame` callbacks. It includes event
handlers, synchronous native work, React work, scheduling, and a rendering
opportunity. It is **not physical paint**, user typing duration, Azure
convergence, or Node/Playwright command elapsed time.

Opt-in `window.__AZNET_METRICS__` records bounded local spans for mutation/
validation, history comparison/cloning, routing projection, simulation, display binding, trace,
diagnostics, persistence, and render-to-layout. Normal sessions do not enable
timing or send telemetry. Render spans do not increment durable/engine counters.
Classic `editor-submit` includes its nested save/history/persistence pipeline;
mixed `commit` measures mutation/validation, with persistence in a later effect.
`render-to-layout` is inclusive of component/descendant commit and layout work,
not exclusive React CPU. **Do not add overlapping spans.** Phase summaries use
individual invocations, while invocation counts and raw per-action samples
retain their grouping.

Reports record Git HEAD, dirty-source/diff/untracked hashes, built-file hashes,
workload dimensions/hash, Node/Chromium versions, CPU, logical cores, and
available/total memory. Vite embeds the application version; CI also sets
`VITE_APP_REVISION` to its source SHA. Local benchmark provenance uses recorded
source identity and built-file hashes, not an assumed CI revision.
Commit a clean measurement-tool source first when collecting a reference
baseline; the generated report can be committed afterward.

Median and p95 use nearest rank. With five samples, p95 is the maximum: this
is a coarse local baseline, not a reliable fleet tail estimate. Ambient machine
load is uncontrolled, and sampled available memory is not a browser memory
peak. Comparisons require the same workload hashes, UI state, hardware/browser
class, build method, and sample count; inspect raw variability, not only one
summary number.

## Reference baseline and follow-up targets

The [raw reference report](benchmarks/interactive-baseline.json) contains all
225 measured actions across nine workloads, from clean source
`45037bee715a2b33b55d4a5cecdfe659c768e358`. Hardware was an Intel Core Ultra 7
165H with 22 logical CPUs and 34.0 GB total memory, Windows, Node 22.23.5,
and Chromium 156.0.8078.4. Available memory was only 0.89 GB before and
3.90 GB after the run: **this shared-machine baseline includes memory pressure
and changing ambient load**, not a controlled idle-machine qualification.

Values below are median / coarse p95 in milliseconds. Display Undo and every
raw sample, phase span, and invocation count remain in the report.

| Mode / tier | Display edit | Semantic edit | Semantic Undo | Trace |
|---|---:|---:|---:|---:|
| VWAN / small | 28 / 32 | 31 / 41 | 19 / 24 | 21 / 23 |
| VWAN / dense | 384 / 490 | 316 / 325 | 268 / 283 | 219 / 298 |
| VWAN / near-limit | 962 / 1,166 | 894 / 926 | 809 / 974 | 810 / 946 |
| H&S / small | 36 / 39 | 41 / 43 | 37 / 45 | 39 / 43 |
| H&S / dense | 323 / 497 | 1,355 / 1,634 | 1,445 / 1,486 | 107 / 191 |
| H&S / near-limit sparse | 427 / 491 | 756 / 929 | 800 / 963 | 466 / 539 |
| Full / small | 37 / 40 | 40 / 49 | 36 / 46 | 27 / 34 |
| Full / dense | 284 / 320 | 1,346 / 1,425 | 1,158 / 1,363 | 112 / 124 |
| Full / near-limit sparse | 367 / 511 | 541 / 1,048 | 681 / 771 | 399 / 486 |

The demonstrated priority is **mixed dense semantic edit/Undo**, not a blanket
worker migration: semantic edits invoke simulation once (median about 665 ms)
and synchronous diagnostics once (262-268 ms). Mutation, history cloning,
projection and persistence are each about 1-3 ms. The inclusive render-to-layout
span is about 1,320 ms and overlaps those engine spans; it must not be added
to them. Mixed display edits invoke neither simulation nor trace, but their
render-to-layout medians remain 258-294 ms, indicating separate rendering work.

VWAN display edits do rerun simulation once per measured action (dense median
190 ms), even though routing projections omit presentation-only names. This
is evidence for a cache investigation, not permission to reuse stale display
names or route results. Native near-limit retention passed without truncation;
the sparse mixed case does not establish worst-case dense transit latency.

Provisional follow-up acceptance targets, to be evaluated using paired
before/after runs under comparable load with at least 20 samples:

1. Reduce dense mixed semantic edit **and Undo** median by at least 50% and
   coarse p95 by at least 30%, in both modes. Relative to this reference,
   median ceilings are about 677/722 ms for H&S edit/Undo and 673/579 ms for
   Full. First investigate simulation and synchronous diagnostics.
2. Make name-only VWAN edits avoid simulation/trace recomputation while still
   refreshing names and preserving IDs; aim for dense display-edit median
   at most 200 ms and p95 at most 300 ms, versus 384/490 ms here.
3. Keep all five small-workload operations at p95 below 100 ms and avoid more
   than 10% median trace or near-limit regressions in paired comparisons.
   Recheck variable-load results rather than treating one five-sample run as
   a CI timing gate.

These targets were selected before optimization. Any future worker candidates must
preserve native/provider semantics, original IDs, admission and startup bounds,
and include document/generation ownership, cancellation, pending-state honesty,
and tab/account/practice stale-result tests. No interactive workers or new
asynchronous result lifecycle were introduced.

## Bounded optimization and paired evidence

The fresh [before report](benchmarks/interactive-paired-before.json) measures
900 actions from clean `37a36dd53bc3c2159d74c35f9bf5e24aaf93923f`; the
[corrected full report](benchmarks/interactive-corrected-full.json) measures
the identical nine workloads and 20 samples per operation from clean
`c476571ec8b0248cdf6c4141b55af03f8fd24d3a`. Each run retains one excluded
warmup, original native IDs, exact saved edits, complete Undo restoration,
actual trace execution, unchanged source/build checks, and raw phase counts.
Hardware, Node and Chromium match. Local builds were 0.6.0 and 0.6.1;
the combined curriculum/architecture release version is assigned before final CI.

The change reduces repeated IPv4/CIDR allocation and parsing, performs stable
single-scan longest-prefix selection, shares prefix ranges only within one
native simulation, and avoids redundant effective-route clones. It adds no
global route cache, admission relaxation or public-executor reuse.

VWAN simulation and pair traces use full semantic input, with known display
names rebound at presentation. IDs, unknown native fields, inferred ER location
names, hub regions and semantic static-route identities remain routing inputs.
Blank names retain their modeling eligibility. Group traces still use current
native names because destination-name deduplication is part of their behavior.
Name edits and Undo execute neither simulation nor pair trace in every measured
VWAN case; the browser regression also checks current visible hub prose.

Observed median / p95 milliseconds, **before -> corrected full run**:

| Mode / tier | Display edit | Semantic edit | Semantic Undo | Trace |
|---|---:|---:|---:|---:|
| VWAN / small | 23/25 -> 41/80 | 23/25 -> 34/64 | 24/26 -> 28/33 | 25/27 -> 24/47 |
| VWAN / dense | 154/279 -> 186/418 | 135/231 -> 255/330 | 113/253 -> 233/281 | 47/157 -> 196/238 |
| VWAN / near-limit | 584/1096 -> 195/891 | 453/1281 -> 240/1215 | 448/777 -> 186/928 | 449/890 -> 223/795 |
| H&S / small | 36/48 -> 26/31 | 33/60 -> 22/29 | 38/55 -> 24/28 | 29/42 -> 25/32 |
| H&S / dense | 345/502 -> 108/142 | 1370/1874 -> 270/355 | 1461/1818 -> 288/383 | 104/127 -> 41/59 |
| H&S / near-limit sparse | 445/700 -> 201/235 | 877/1178 -> 362/400 | 812/1056 -> 272/336 | 521/785 -> 232/282 |
| Full / small | 32/54 -> 23/27 | 31/45 -> 21/30 | 30/43 -> 22/24 | 30/48 -> 27/31 |
| Full / dense | 353/507 -> 122/145 | 1174/1827 -> 342/396 | 1076/1732 -> 328/404 | 120/177 -> 51/67 |
| Full / near-limit sparse | 484/699 -> 200/246 | 923/1187 -> 349/421 | 871/1100 -> 290/418 | 512/640 -> 260/303 |

The full corrected run satisfies both mixed dense edit/Undo improvement targets,
all small p95 targets, and every near-limit median check. **It does not alone
qualify dense VWAN**: display p95 exceeds 300 ms and trace median exceeds the
earlier paired control. Those failures and wide near-limit tails are retained,
not hidden or converted into a passing full-run claim.

### Rejected approach and variance rechecks

The [unqualified broad-binding report](benchmarks/interactive-rejected-broad-binding.json)
retains all 900 actions at `c4877920956fa5ff06e441cf861f781fc91032b1`.
Traversing the entire VWAN simulation DAG to replace display strings was
unnecessarily expensive. Simulation routes contain IDs and semantic static-route
names; only warning prose needs binding. The corrected typed helper binds
warnings without traversing route candidates, protected by a regression test.

[Complete native parity](benchmarks/interactive-native-parity.json) covers
27 original/rename/semantic workload cases, two samples each. The
[imported VWAN projection probe](benchmarks/interactive-vwan-projection-parity.json)
also compares complete simulation and pair-trace hashes against fresh native
outputs across nine variants, twice each, with native-input nonmutation checks.
Its dense/near-limit last samples measure roughly 43-246 ms for broad DAG
binding versus 0.018-0.049 ms for warning-only binding. These are isolated
probe costs, **not browser latency or fleet guarantees**.

After the corrected full run, unchanged-source **ABBA** dense VWAN rechecks
bracketed two after runs with two before runs. Each report contains all five
operations, 20 samples each, the same excluded warmup/workload/build identities,
and complete native functional checks. No concurrent local builds or profiles ran.

| Run | Source | Display median/p95 | Trace median/p95 |
|---|---|---:|---:|
| [A1 before](benchmarks/interactive-dense-vwan-before-1.json) | `37a36dd` | 159.4/213.7 | 70.2/163.0 |
| [B1 corrected](benchmarks/interactive-dense-vwan-after-1.json) | `c476571` | 83.0/105.8 | 60.8/136.5 |
| [B2 corrected](benchmarks/interactive-dense-vwan-after-2.json) | `c476571` | 84.1/114.8 | 57.2/142.7 |
| [A2 before](benchmarks/interactive-dense-vwan-before-2.json) | `37a36dd` | 160.2/204.4 | 61.8/146.2 |

Both 20-sample pairs satisfy the original dense display ceilings and show
no trace median regression (about 13% and 7% lower, respectively). Semantic
edit/Undo medians also do not regress in either pair. This supports the bounded
change under these local conditions; it does **not** erase the failed full-run
tails or guarantee <=300 ms under arbitrary shared-machine load. Mixed observed
edit/Undo medians improve about 70-80%, with p95 reductions about 77-81%, but
ambient load also varies. These remain reproducible local evidence, not a CI
wall-clock gate, physical-paint claim, dense 1,000-VNet transit result, public
executor qualification, or real Azure validation.
