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

## Follow-up scope

Use the saved reference baseline to choose the dominant phases and explicit
edit/trace/undo targets before implementing changes. Worker candidates must
preserve native/provider semantics, original IDs, admission and startup bounds,
and include document/generation ownership, cancellation, pending-state honesty,
and tab/account/practice stale-result tests. No improvement or lifecycle
qualification is claimed by this measurement-only delivery.
