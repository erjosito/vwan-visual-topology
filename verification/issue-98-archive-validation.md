# Archived lab validation (#98)

Archived output is independent evidence, not a simulator-generated expected snapshot.
Native topology JSONs are published in each original
[net-lab-builder lab folder](https://github.com/erjosito/net-lab-builder/tree/main/labs).
All new H&S evidence below is pinned to source revision
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
| [dual-hub-vnra-udr-transit](https://github.com/erjosito/net-lab-builder/tree/main/labs/dual-hub-vnra-udr-transit): access disabled | H&S; [fixture](issue-98-vnra-archive.json), six pre-fix NIC routes, two Network Watcher next hops and two guest ICMP failures | **PASS after route-visibility fix**; `simulator-topology-access-disabled.json`. Active peering/UDR routes coexist with forwarding denied by peering access. |
| Same VNRA lab: access corrected | H&S; two native guest probes, each 10/10 received; all-six corrected peering flags | **PASS** for logical bidirectional reachability; `simulator-topology.json`. Configured two-VNRA path is a model assertion, not a packet TTL/hop observation. |
| [disable-peering-route-propagation](https://github.com/erjosito/net-lab-builder/tree/main/labs/disable-peering-route-propagation): S1 summary-only NIC cut | H&S; [fixture](issue-98-udr-archive.json), 11 hub-probe route facts plus three spoke next-hop dependency facts | **PASS** for selected effective routes; `simulator-topology.json`. Ten active peering `/16`s beat `/8` by LPM. |
| Same UDR lab: S2 explicit-spoke workaround NIC cut | H&S; 21 hub-probe route facts | **PASS** for selected effective routes; `simulator-topology-explicit-spokes.json`. Ten User `/16`s override equal-prefix peering routes, which remain visible as Invalid. |
| Same UDR lab: actual preview suppression | Failed feature-update output and Pending/ApprovalRequired registration | **BLOCKED (historical Azure feature gate)**. No enabled-preview export or positive Azure-validation claim. |
| Same UDR lab: later S4 ER/VPN/SD-WAN and stateful packet behavior | Separate captures, not the S1/S2 route cuts | **NOT VALIDATED in this batch**. Conntrack enforcement is outside the simulator; later applicable routing/BGP evidence remains queued. |

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

The remaining three unaudited selected labs and the uncompleted S4 cut retain their order
and admission/evidence gates in [#98](https://github.com/erjosito/vwan-visual-topology/issues/98).
The two excluded labs above require evidence/report reconciliation before re-admission.
The VNRA negative/positive pair and UDR LPM pair are educational sample candidates;
neither is added automatically to the built-in gallery.
