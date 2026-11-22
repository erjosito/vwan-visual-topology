# Interactive responsiveness measurements

This is the measurement phase of #384, not a worker rollout or a routing
optimization. Interactive native edits and traces are measured separately from
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
validation, history comparison/cloning, routing projection, simulation, trace,
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
available/total memory. Vite embeds the application version, not a source
revision: build hashes and controlled source are the provenance evidence.
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

These are selected targets, **not delivered improvements**. Worker candidates must
preserve native/provider semantics, original IDs, admission and startup bounds,
and include document/generation ownership, cancellation, pending-state honesty,
and tab/account/practice stale-result tests. No improvement or lifecycle
qualification is claimed by this measurement-only delivery.
