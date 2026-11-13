# Archived lab validation (#98)

Archived output is independent evidence, not a simulator-generated expected snapshot.
Native topology JSONs are published in each original
[net-lab-builder lab folder](https://github.com/erjosito/net-lab-builder/tree/main/labs).
The VNRA and S1/S2 H&S evidence below is pinned to source revision
`c14b2bd94787a0645392eb000cdd3cfbd9b59e7d`; the earlier pilot keeps its own
`5ba98831d8244eef162e6dbb2cc12a5b58f02e74` provenance.
Fixture `sources` entries record exact paths, Git-blob SHA-256 hashes, observation
layers and capture-quality limitations. Tests run offline without Azure access.
If a lab report or its evidence is inconsistent, exclude the whole lab from
validation until reconciled. Do not admit a partial replay by cherry-picking
apparently usable rows from the inconsistent lab.

| Lab / scenario | Mode / independent evidence | Result and native exports |
|---|---|---|
| [vwan-routemap-summarization](https://github.com/erjosito/net-lab-builder/tree/main/labs/vwan-routemap-summarization): B2B-on baseline and ER-only outbound summary | VWAN; [fixture](issue-98-routemap-archive.json), nine prefix/AS-path/absence facts | **PASS** for those advertisements; `simulator-topology.json`, `simulator-topology-er-only-summary.json`. No packet-forwarding, timing, B2B-off or AS-path mitigation claim. |
| Same summarization lab: AS12076 drop-only, drop before summary, B2B-off mixed summary (#101) | VWAN; [additional fixture](issue-101-routemap-archive.json), 14 recorded prefix/AS-path/absence facts | Native exports `simulator-topology-as-path-drop.json`, `simulator-topology-as-path-drop-summary.json`, `simulator-topology-b2b-off-summary.json`. Configured route provenance gates branch exports; no internal aggregate origin flags, intermittent race or packet-forwarding claims. |
| [expressroute-megaport-bgp](https://github.com/erjosito/net-lab-builder/tree/main/labs/expressroute-megaport-bgp) | Report/raw-output consistency audit at `5ba98831d8244eef162e6dbb2cc12a5b58f02e74` | **INCONCLUSIVE / EXCLUDED FROM VALIDATION**. Report claims workload/NIC routes and failed MSEE queries, but raw `04`/`05`/`10` show a different route set and `13` is an API error. No accepted observations, replay fixture or native validation export; reconcile or obtain consistent evidence before admission. |
| [msee-hairpin-hns-vwan-ipv6](https://github.com/erjosito/net-lab-builder/tree/main/labs/msee-hairpin-hns-vwan-ipv6): IPv4 candidate | Report consistency audit at the same pinned revision | **INCONCLUSIVE / EXCLUDED FROM VALIDATION**. Final README/deploy log require one shared circuit, but the README topology/control-plane diagrams describe two circuits and IPv6 exchange contrary to the reported result. The validation checklist is still a pre-deploy skeleton. No replay or native validation export until the report is reconciled. |
| [dual-hub-hubless-region-ars](https://github.com/erjosito/net-lab-builder/tree/main/labs/dual-hub-hubless-region-ars): pre-Delta3 ECMP / BIRD default prepend | Full Hybrid; [fixture](issue-98-ars-hubless-archive.json), nine distinct ARS prefix/path and NIC default-next-hop observations | **PASS after remote-BGP peer and ARS ECMP fixes**; `simulator-topology.json`, `simulator-topology-default-preferred.json`. Direct peering BGP reachability is separate from spoke route injection. No VPN, packet, convergence or successful Azure route-map activation claim. |
| [dual-hub-interconnect-ars-route-policy](https://github.com/erjosito/net-lab-builder/tree/main/labs/dual-hub-interconnect-ars-route-policy) | Report/evidence admission audit at `efe260c688733dfc647bdb6cd0d2fccfd9c740e0` | **INCONCLUSIVE / EXCLUDED FROM VALIDATION**. `validation.md:25` says U3 completed and rolled back, but `validation.md:70,311-312` and `README.md:122,352` say it was not run and its prerequisite association remains active (`README.md:309,320`). The selected Aug 8 Linux replacement folder contains only a certification narrative, not its native route/probe/configuration bundle. Do not mix Aug 6, Aug 7, Aug 8 and Aug 10 states, cherry-pick older rows, or manufacture a native validation export. Reconcile execution status and publish the matching native Linux snapshot before re-admission. |
| [vwan-dual-er-symmetric](https://github.com/erjosito/net-lab-builder/tree/main/labs/vwan-dual-er-symmetric): C2 primary-up/down/restored four-spoke cut | VWAN; [fixture](issue-98-dual-er-archive.json), eight peer prefix/path facts plus four primary-peer withdrawal absences | **PASS** for received advertisements, including standby paths and restored baseline. Native exports `simulator-topology-c2.json`, `simulator-topology-c2-primary-down.json`, `simulator-topology-c2-restored.json`. CE export allowlists preserve the captured two on-prem prefixes and prevent an invented Azure-route feedback loop. Only the MCR-to-CE link is disabled, not ER. No GCP best-path, timing or firewall-session claim. |
| Same dual-ER lab: C1 exact complete AS paths | Native C1 customer-side paths retain the normal inter-hub `65520 65520` segment in only one remote direction | **DEFERRED / NOT ADMITTED as an exact-path regression** by user disposition in #98: treat the asymmetric retention as a suspected MSEE private-AS-stripping glitch, not a confirmed platform bug or a missing customer rewrite setting. Azure map definitions are captured; both preserve the intended prefix rules/associations and the documented `23456` to `64496` update. The user will investigate MSEE behavior. No speculative AS-removal change, invented rewrite policy or exact C1 validation export; accepted C2 coverage is unchanged. |
| [vwan-sdwan-three-hub](https://github.com/erjosito/net-lab-builder/tree/main/labs/vwan-sdwan-three-hub): frozen A, B2, ASPath seed and four completed HRP resets | VWAN; [fixture](issue-98-three-hub-archive.json) pinned to `efe260c688733dfc647bdb6cd0d2fccfd9c740e0`; 27 distinct firewall prefix/path/local-vs-remote facts, corroborated by 168 native rows in 42 samples; 12 A source-export presence/absence facts across paired BIRD peers | **PASS after site local-preference/export-feedback fix**. Seven native exports: `simulator-topology-policy-a.json`, `simulator-topology-policy-b2.json`, `simulator-topology-aspath-seed.json`, `simulator-topology-er-japan-first.json`, `simulator-topology-er-nva-first.json`, `simulator-topology-vpn-japan-first.json`, `simulator-topology-vpn-nva-first.json`. All 12 DC winners per state and A's withdrawal of foreign-DC mesh exports match. Mesh senders retain their own-prefix allowlists; A's inbound preference 400 and nonlocal source prepends are retained. No workload-prefix, packet, history or reset-causality claim. |
| [dual-hub-vnra-udr-transit](https://github.com/erjosito/net-lab-builder/tree/main/labs/dual-hub-vnra-udr-transit): access disabled | H&S; [fixture](issue-98-vnra-archive.json), six pre-fix NIC routes, two Network Watcher next hops and two guest ICMP failures | **PASS after route-visibility fix**; `simulator-topology-access-disabled.json`. Active peering/UDR routes coexist with forwarding denied by peering access. |
| Same VNRA lab: access corrected | H&S; two native guest probes, each 10/10 received; all-six corrected peering flags | **PASS** for logical bidirectional reachability; `simulator-topology.json`. Configured two-VNRA path is a model assertion, not a packet TTL/hop observation. |
| [disable-peering-route-propagation](https://github.com/erjosito/net-lab-builder/tree/main/labs/disable-peering-route-propagation): S1 summary-only NIC cut | H&S; [fixture](issue-98-udr-archive.json), 11 hub-probe route facts plus three spoke next-hop dependency facts | **PASS** for selected effective routes; `simulator-topology.json`. Ten active peering `/16`s beat `/8` by LPM. |
| Same UDR lab: S2 explicit-spoke workaround NIC cut | H&S; 21 hub-probe route facts | **PASS** for selected effective routes; `simulator-topology-explicit-spokes.json`. Ten User `/16`s override equal-prefix peering routes, which remain visible as Invalid. |
| Same UDR lab: actual preview suppression | Failed feature-update output and Pending/ApprovalRequired registration | **BLOCKED (historical Azure feature gate)**. No enabled-preview export or positive Azure-validation claim. |
| Same UDR lab: later S4 three-hybrid routing/BGP and VPN/SD-WAN asymmetry | Full Hybrid; [fixture](issue-98-udr-s4-archive.json), source Git blobs pinned to `efe260c688733dfc647bdb6cd0d2fccfd9c740e0`; 21 selected NIC rows, 11 SD-WAN prefixes/terminal ASNs, 11 exact MSEE prefix/paths and two ER gateway prefix/paths; native two-way probes and directional NVA counters | **PASS after static-origin overlay and subnet-UDR NVA chaining fixes**. `simulator-topology-s4-hybrid.json`. Both VPN/SD-WAN forward paths bypass the firewall and return paths traverse it; asymmetric inspection is detected without conntrack enforcement. SD-WAN's full one-AS path is reconstructed from captured static origins/sender, not a full native AS_PATH dump. Paired physical ER paths collapse to logical links; ER packet forwarding, timing and stateful drops are not asserted. |

## Reproducible checks

- `npm test -- src/azure-net/engine.test.ts -t recorded` compares the new H&S
  facts, validates native admission/round-trip and keeps forwarding checks separate.
- `npm run test:e2e -- azure-net-archive.spec.ts` exercises native file import,
  active/invalid routes, LPM, VNRA forward/return reachability, exact JSON
  export/reimport/reload and page-error checks.
- The original VWAN pilot tests remain in `src/routing.test.ts` and `e2e/app.spec.ts`.

The VNRA and UDR pairs contribute **47 distinct archived observations**: eight VNRA
control-plane facts, four native ICMP outcomes and 35 UDR NIC route facts.
Repeated checks of an unchanged state and inferred configured-hop assertions
are not counted as new independent observations.
The hubless ARS pair adds **nine** distinct observations, without counting duplicate
ARS-instance rows or unchanged post-policy paths again.

## Evidence boundaries

The VNRA native pre-fix full peering snapshot corroborates only two hub1
directions. The all-six disabled state comes from the historical report; the
abbreviated retry snapshots do not contain the access flag. All-six corrected
flags and the four guest probe outputs are native. NIC/Network Watcher captures
precede correction; post-fix NIC stability is not another Azure measurement.
The retry directory supplies time context, not exact per-probe timestamps.

The UDR native text captures lack timestamps and complete command/API metadata.
S1/S2 scenario names and the report establish order; the later-expanded deployment
script supplies configuration intent, not an atomic historical resource inventory.
The exports retain the observed selected CIDR route context, not entire route
tables. VPN LNG connected host `/32`, public gateway next-hop representation,
later SD-WAN/ER branches, session enforcement and preview suppression are
explicitly outside this cut. No more-specific route relevant to the selected
spoke destinations is replaced by a lookalike.

VNRA-subnet effective-route API failures were **404**, not empty routing tables.
No throughput/SKU, TTL/hop count, timing, exhaustive ECMP, post-fix Monitor,
NSG or stateful-firewall certification is inferred. No cloud/provider resources
were created, queried or modified for this batch.

## Queue

All selected sequential labs/cuts have received an admission audit and bounded
replay or explicit excluded/deferred disposition. All 22 admitted native exports
are published with adjacent lab documentation; regression, publication and
exact-revision production receipts are tracked in [#98](https://github.com/erjosito/vwan-visual-topology/issues/98).
The three excluded labs above require evidence/report reconciliation before re-admission.
The dual-ER C1 exact-path anomaly is deferred to the user's MSEE investigation
and does not block completion of the admitted archive-validation scopes.
The historical preview feature gate remains unvalidated, not an enabled-preview pass.
The VNRA negative/positive pair and UDR LPM pair are educational sample candidates;
neither is added automatically to the built-in gallery.
