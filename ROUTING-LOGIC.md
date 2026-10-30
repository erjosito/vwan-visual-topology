# Routing logic, route selection, and critique

Reviewed on **2026-10-30**, against application revision `3cd26971b7b141135c6eb0f9c8ba3cd4d65f1d40`. This describes the implementation, not an idealized Azure algorithm. The accompanying consolidation/feedback change does not change routing behavior.

**Bottom line:** the simulator has a coherent, deliberately scoped hub-selection pipeline, with real-Azure evidence for specific cases. It is not a full BGP or Azure control-plane emulator. This review reproduced two internal inconsistencies, an input-validation/AS-loop gap, and a counterintuitive NVA interaction that needs further Azure validation. Those findings are documented below, not silently fixed.

## 1. Scope and source map

One Standard Virtual WAN, a full mesh of hubs, directly connected IPv4 spokes, on-premises sites, VPN BGP/static connections, independent SD-WAN/NVA inputs, and ExpressRoute attachments are modeled. There are no custom route-table associations/labels, hub-table static overrides, IPv6, multiple WANs, or packet-level gateway/firewall simulation.

| Component | Responsibility |
|---|---|
| [`validation.ts`](src/validation.ts) | Validate/migrate topology IDs, prefixes, ASNs, policies and static VPN associations |
| [`bgp.ts`](src/bgp.ts) | Route-map execution, site exports, on-premises propagation and shortest-path selection |
| [`routing.ts`](src/routing.ts) | Hub candidates, HRP, inter-hub convergence, routing intent, outbound advertisements and hub-origin forwarding |
| [`paths.ts`](src/paths.ts) | Combined site/Azure view, site/spoke-origin traces and grouped paths |
| [`route-views.ts`](src/route-views.ts) | Neighbor-specific before/after inspection and the ER-location candidate table |
| [`RouteInspector.tsx`](src/RouteInspector.tsx) | Filtered presentation; does not change selection through its display filters |
| [`TopologyDiagram.tsx`](src/TopologyDiagram.tsx), [`PathMotion.tsx`](src/PathMotion.tsx) | Render calculated provenance, destination colors and paced circle streams; animation is not evidence of packet delivery |

Primary data objects are `Candidate` (prefix, AS path, transport, ingress, origin hub and forwarding provenance), `Decision` (all candidates and selected paths for one exact prefix), and `Simulation` (the separate tables and advertisements below).

## 2. Route production and inbound policies

[`simulate()`](src/routing.ts#L119) first runs [`propagateSites()`](src/bgp.ts#L128).

Site origins consist of configured site prefixes and explicit BGP advertisements on their connections/ER attachments. Explicit advertisements remain available as on-premises origins even when that Azure connection is disabled; disabling an Azure link is not treated as withdrawing the site's underlying network. Static VPN entries are not on-premises BGP origins.

Site-to-site propagation uses enabled exact links, their directional exact-prefix export allowlists, outbound policies, transmit/receive prepends, receiver inbound policies, and site/ASN-loop checks. For each exact prefix it retains shortest-AS-path ties, deduplicated and limited to 32. It runs up to 64 rounds. This is a simplified site policy, not a prediction of vendor local preference, MED or communities.

Hub candidates are then built from:

1. **Legacy connections:** explicit advertisements are already expressed as learned hub AS paths. An ER path's leading `12076`, if present, is temporarily removed around the site outbound policy and restored afterward.
2. **Learned site routes:** enabled `learnSiteRoutes` imports the site's selected on-premises routes. The attached site's ASN is added if not already first; ER adds provider ASN `12076`.
3. **ER locations:** enabled site attachments produce customer-side advertisements, then site outbound maps. Enabled hub attachments import all site advertisements at that location with `12076` prepended, then the hub's inbound map. These are independent circuit abstractions, not a shared-circuit/Global Reach implementation.
4. **Spokes:** each attached prefix becomes a local `system`/`VNet` route with empty AS path.
5. **VPN static destinations:** the site's `vpnStaticRoutes` are imported only through the associated enabled VPN, with empty local AS path. They are VPN transport candidates, **not hub-table static routes with Azure static-route priority**.

Site outbound policy precedes hub inbound policy. VPN-static candidates bypass BGP route maps. Azure-side SD-WAN maps are unsupported; site-side policies can still apply.

### Route-map execution

[`applyRouteMapRules()`](src/bgp.ts#L39) processes ordered rules. Empty prefix conditions match all; a condition list is OR, with exact or containing-prefix matching. Unmatched routes are permitted. A matched rule can permit, drop, prepend, or summarize; `continue` evaluates the modified route against later rules, while `terminate` stops only after a match. Drop ends that route immediately.

Summaries must cover the input prefix. Summarization clears the aggregate AS path and retains `forwardingRoutes` contributors; equal aggregate prefix/path combinations coalesce their contributors. Forwarding later resolves a concrete destination against those contributors, rather than inventing reachability throughout the aggregate. Site export restores a site ASN when necessary after aggregation.

Azure-side prepends are limited to public two-byte ASNs, excluding reserved values; documentation ASNs `64496-64511` are accepted for simulation. Site-side policies permit private/four-byte ASNs. Communities, AS-path matching/replacement, NAT and VNet/P2S/inter-hub map assignments are outside this implementation, even where Azure supports them.

## 3. Exact-prefix hub selection

[`decide()`](src/routing.ts#L107) groups candidates by **identical CIDR** and calls [`choose()`](src/routing.ts#L55). This must not be confused with destination lookup: AS-path length never makes a `/16` beat a matching `/24`.

The following filters are applied sequentially. A filter only eliminates candidates when its preferred subset is nonempty.

| Order | Filter |
|---|---|
| 1 | Prefer directly attached spoke system routes over every equal-prefix alternative |
| 2 | If a secure remote origin exists, exclude **unsecured remote ER** alternatives; local routes and other transports remain |
| 3 | For **ASPath** HRP only, retain the shortest full received AS path, including inter-hub prepends |
| 4 | Prefer local connections over remote-hub candidates |
| 5 | If both ER and VPN still exist, prefer VPN for **VPN** HRP or when all remaining candidates are remote; otherwise prefer ER. SD-WAN is not classified as VPN |
| 6 | For **ExpressRoute/VPN** HRP only, retain shortest AS paths among the survivors |
| 7 | Keep all remaining ties as modeled ECMP; no traffic hash or additional BGP tie-break is selected |

Consequently, a shorter remote path can beat a local path under ASPath; equal-length local/remote paths prefer local. Other HRPs use locality before transport and length. Remote-origin HRP also matters because only that origin's selected local routes are exported.

Examples for the same prefix: local ER length 5 beats local VPN length 2 under ExpressRoute HRP; VPN length 5 beats ER length 2 under VPN HRP. Under ASPath, length wins first; an equal-length local ER/VPN tie favors ER.

### Inter-hub convergence

Starting from local-only decisions, each round imports the other hubs' **selected local nondefault** paths. Two `65520` ASNs are prepended, and the original hub/provenance is retained. A hub never re-exports a remote route to another hub, nor advertises `0.0.0.0/0` over this mesh.

The loop checks selected-route signatures, detects repeats and stops after at most 64 rounds. Nonconvergent hub or on-premises calculations are flagged as provisional and disable tracing. This is a deterministic fixed-point calculation, **not elapsed convergence time, arrival ordering, or ER failback history**.

## 4. Three different Azure routing views

| Field | Meaning |
|---|---|
| `bgpTables` | Post-inbound-policy candidates and best paths before routing intent; includes explicitly labeled system and VPN-static entries, so not a literal pure BGP RIB |
| `tables` | Hub forwarding tables after routing-intent redirection |
| `firewallTables` | The selected exact destinations used after the firewall hop, plus the applicable Internet fallback |

With **private intent**, the hub forwarding table is replaced by RFC1918 aggregates plus configured extra private prefixes, all pointing to the local firewall. Exact learned/system routes remain in the firewall table. A non-RFC1918 destination needs an explicitly configured private prefix to reach that table; a bare private-only hub has no hub default.

With **Internet intent**, the hub gains a default to the firewall, and the firewall uses direct Internet egress. This intentionally does not model forced tunneling. With private intent but no Internet intent, an already learned firewall default is preserved; only an absent default gets a firewall-only direct-Internet fallback. That fallback does not become a hub or advertised default.

A trace to an unknown RFC1918 address cannot be delivered by the Internet fallback. `delivered` for non-RFC1918 Internet egress means a modeled route exists, not proof of HTTP success, firewall permission, SNAT or return reachability.

## 5. Outbound advertisements

Advertisements come from selected **pre-intent** hub paths, not from policy redirection entries. Outbound maps run after hub selection and therefore cannot change the hub's own best path.

| Attachment | Export behavior |
|---|---|
| Legacy VPN | Suppress its own ingress and routes returning to its site; prepend `65515`; apply hub outbound maps |
| Legacy ER | Same ingress/site suppression, plus no ER-to-ER export; apply hub maps and ER customer-boundary processing. Its default behavior differs from expanded ER: see R2 |
| Legacy SD-WAN | No Azure-to-site outbound learning is modeled |
| ER-location hub attachment | Export selected non-ER, nondefault routes; apply hub outbound maps, then customer-boundary processing |
| ER-location site attachment | Receive the exports from enabled hub attachments at the location, excluding routes returning to that site |
| Other hubs | Selected local nondefault routes only, with the separate inter-hub prepend described above |

[`erCustomerExport()`](src/routing.ts#L113) adds `12076` and removes both RFC6996 private-AS ranges **after** outbound maps. Internal hub paths and VPN exports are not stripped. Public map prepends remain.

The separate [`azureRoutesAtSites()`](src/paths.ts#L27) calculation starts from local site origins plus the actual Azure outbound advertisements, applies receiving-site inbound maps/AS-loop checks, and propagates over on-premises links. Its candidates/best paths drive the site BGP inspector and site-origin traces. It does **not** feed Azure-originated advertisements back into `simulate()` or model Azure reimport through site transit. Its ASN-prepend inconsistency is R1.

Per-attachment default-propagation/Internet-security switches are not modeled; observed real defaults therefore remain a known unsupported feature, not a pass from the positive-advertisement subset of the lab.

## 6. Destination forwarding and path provenance

[`traceFlow()`](src/routing.ts#L316) performs longest-prefix lookup in the current hub forwarding table, then in its firewall table if redirected. It resolves local summary contributors by longest prefix. For remote candidates it visits the originating hub and re-runs that hub's own forwarding lookup; hub revisits report a loop.

Local routes exit through their selected spoke/connection/ER attachment. A static VPN exit additionally looks up the destination in the site's on-premises table to retain downstream site hops and exact link IDs. Known downstream destinations without a route, and summary holes, are unreachable. A manually configured static destination with no known downstream topology retains assumed delivery at the VPN exit.

[`traceNodePath()`](src/paths.ts#L93) adds spoke ingress or selects a site's longest-prefix, shortest-AS-path route from the combined site view. Site paths can remain wholly on-premises or enter Azure through a VPN/ER attachment, then use hub forwarding. It detects a return to the source-side site path as a loop. Source-spoke-local destinations do not traverse a hub.

Traces retain exact parallel site links and both ER legs. Individual traces are limited to 128 branches; site best paths to 32 per prefix. Grouped traces run separate destination/source lookups and can contain more than 128 results in total. Choosing a prefix from a menu traces its network address, not every possible exception below it.

Forward and reverse traces are independent. There is no packet-level verification, return-path guarantee, vendor policy engine or firewall enforcement.

## 7. Inspector and animation semantics

**BGP table** shows candidates and preferred paths; **Learned routes** and **Advertised routes** show neighbor-scoped inputs/outputs, not only winners. The latter default to after inbound/outbound maps and can switch to before. Prefix filters are substring filters, not LPM queries, and do not alter simulation.

Provider AS processing and inter-hub prepends occur in transit, outside the router's map-stage snapshots. Sender advertised and receiver learned AS paths can consequently differ. ER locations have no configurable maps: their views reflect the attached routers' boundaries.

[`erLocationBgpTable()`](src/route-views.ts#L17) ranks the location's learned candidates by shortest AS path for inspection, preserving ties/alternatives. **That table does not drive `erImports()` or establish a real MSEE per-circuit RIB.** The hub receives the independent circuit candidates and applies its own HRP/maps. Do not interpret location-wide stars as permission for site-to-site transit or as proof of shared-circuit reflection.

Animation follows those computed links at 200 screen pixels/second with destination-colored streams and node tints. Destinations take colors sequentially from a 20-color palette, reused after 20. Reduced-motion mode retains static highlighting/colors. None of these presentation choices changes route selection or establishes delivery.

## 8. Critique: reproduced inconsistencies and open accuracy risks

The following synthetic, offline probes were run with `validateTopology()`, `simulate()` and, where relevant, `azureRoutesAtSites()` on the reviewed revision. No Azure resources were deployed. "Confirmed" describes the implementation result, **not an unperformed Azure experiment**.

### R1 - High priority: on-premises and combined site views disagree

**Confirmed internal inconsistency.** Site A (AS65010) has no originated prefix but explicitly advertises `10.80.0.0/16 [65010]` on an enabled VPN. Site C (AS65030) originates `10.80.0.0/16`. Site B (AS65020) connects to A and C over ordinary bidirectional, unfiltered site links. Only A needs an Azure connection; no route maps or other advertisements are required.

| Calculation at B | Selected paths |
|---|---|
| `simulate(t).siteTables.b` | Via A `[65010]` **and** via C `[65030]` (ECMP) |
| `azureRoutesAtSites(t, simulate(t)).tables.b` | Via C `[65030]` only; A's candidate is `[65010,65010]` |

Root cause: [`propagateSites()`](src/bgp.ts#L128) uses `receiveSiteRoutes()` with `repeatOriginAsn=false`, while the [combined calculation](src/paths.ts#L57) passes `true` for the same local origin. Explicit advertisements already contain their origin ASN, unlike empty-path configured site prefixes.

Thus the route learned into Azure, static-VPN downstream lookup, site inspector and site-origin trace can disagree for the same on-premises topology. This is not a vendor-specific tie-break; two application planes normalize the same input differently.

**Recommended correction:** establish one local-origin versus wire-advertisement representation and reuse its eBGP export logic in both calculations. Preserve the necessary sender prepend when forwarding a route actually learned from Azure; do not blindly change the flag everywhere. Add a regression expecting both planes to agree for explicit origins, configured origins, Azure-learned routes, summaries and ECMP.

### R2 - Medium priority: equivalent ER representations export defaults differently

**Confirmed internal inconsistency.** One unsecured hub learns `0.0.0.0/0 [65010]` from VPN site A. A separate site B has no advertised routes.

| Connection to B | Advertised default at B |
|---|---|
| Legacy `connections[]` ER | `0.0.0.0/0 [12076]` |
| Expanded ER-location hub/site attachments | None |

The [legacy outbound path](src/routing.ts#L276) does not exclude default routes, whereas the [ER-location path](src/routing.ts#L284) explicitly does. Merely changing the ER representation therefore changes site-learned defaults and potentially site-origin forwarding.

**Recommended correction:** define default export once and use it for both representations. Actual Azure defaults depend on attachment controls that are not modeled ([#13](https://github.com/erjosito/vwan-visual-topology/issues/13)); do not "fix" parity by declaring unconditional export or suppression correct for Azure.

### R3 - Medium priority: incomplete hub-side ASN-loop/input guard

**Confirmed implementation gap; exact Azure handling not retested here.** A validated legacy VPN advertisement `10.80.0.0/16 [65010,65515]` is accepted and selected by a hub modeled with ASN65515. Legacy validation rejects `65520` but permits `65515`; expanded ER advertisements reject both. Hub imports do not perform an own-AS loop check, although receiving sites do.

This is suspicious under ordinary eBGP own-AS loop prevention. However, legacy input is described as an already learned hub path, so this is also an unresolved **input-boundary contract**: the app may be assuming the real gateway has already rejected invalid inputs.

**Recommended correction:** explicitly reject impossible already-learned paths or model gateway/session-specific validation at import, and make both ER representations consistent. Validate Azure-specific exceptions before using one blanket reserved-AS rule. Do not claim that the current selector is a complete BGP admission policy.

### R4 - Accuracy risk: NVA interactions are conditional, not a total transport ranking

**Reproduced behavior, not a confirmed Azure defect.** Under ExpressRoute HRP with one local prefix:

| Available local AS-path lengths | Selected connection |
|---|---|
| VPN2, NVA3 | VPN2 |
| VPN2, NVA3, ER8 | NVA3 |

The worse ER8 introduces the ER-versus-VPN comparison, which eliminates VPN2; NVA3 then beats ER8 on length. This follows the implementation's staged filters and a literal reading of the documented ER/VPN step, but it is non-monotonic when all three transports compete.

The physical lab's direct-spoke BGP NVA was **not integrated SD-WAN**, and it did not certify this three-way combination. An Azure experiment should independently control all three received paths and both arrival orders. Do not replace the algorithm with a blanket "ER > NVA > VPN" ordering without evidence.

### Other boundaries that should not be mistaken for verified correctness

| Area | Assessment |
|---|---|
| Shorter remote ER under ASPath | Deliberate evidence-based choice, not an accidental missed filter. The current Microsoft HRP page still has a "remote ER last" note that conflicts with its own shorter-remote-ER example. The separate physical-MCR post-fix experiment supports this app's choice within its scope |
| Arrival order/failback | Deterministic output cannot reproduce history-sensitive choices. Existing warnings are essential; the lab's locality/VPN result required arrival-order control |
| ER-location table | Useful inspection abstraction, not a modeled MSEE forwarding/control plane; shared circuits, Global Reach and auxiliary-ER representation remain gaps |
| VPN static | Gateway import with an empty AS path and BGP-map bypass is an approximation, not the documented priority of static **hub-table** routes |
| Internet/private intent | Separate firewall fallback and hub redirection are important and calibrated; permissive-firewall/Internet delivery must not imply real reachability or forced-tunnel support |
| Communities and route maps | Unsupported attributes can materially affect Azure exports; prefix/AS-length agreement alone cannot establish community suppression or negative-route parity |
| Scale and ECMP | 32/128 branch limits can omit valid alternatives. The Azure lab explicitly did not certify ties or gateway-instance hashing |

**Suggested order of follow-up:** resolve R1's shared site-origin contract; unify R2's export decision with explicit default controls; clarify R3's accepted-input boundary; then run the targeted R4/ER-representation experiments. Routing behavior is deliberately unchanged by this documentation task.

## 9. What the consolidated Azure evidence does and does not establish

The [complete frozen lab report](verification/azure-vwan-2026-10-29/README.md), [manifest](verification/azure-vwan-2026-10-29/evidence-manifest.json), [raw sanitized results](verification/azure-vwan-2026-10-29/raw-output/) and [provenance](verification/azure-vwan-2026-10-29/IMPORT-PROVENANCE.md) now live in this repository.

The report records seven nominal selection cases checked on both hubs twice, a separate physical-ER post-fix repeat, fourteen unsecured deliveries, causal intent matrices, four positive advertisement subsets, and thirteen production collector/import exercises. It preserves original failed predictions and separates calibrated/post-fix repeats from blind predictions.

These are scoped observations, not a current-version conformance certificate. ECMP, all arrival histories, NE customer BGP, integrated SD-WAN, full forced tunneling, default-switch-false behavior, absent-route suppression and all policy combinations remain uncertified. The report's model revisions predate later SAP tracing, inspector and visualization work.

Historical investigations [#9](https://github.com/erjosito/vwan-visual-topology/issues/9) (auxiliary ER representation), [#13](https://github.com/erjosito/vwan-visual-topology/issues/13) (default advertisement controls), and [#6](https://github.com/erjosito/vwan-visual-topology/issues/6) (spoke NVA modeling) must not be read as completed features. No lab resources were re-created for this review.

## 10. Verification and references

Focused source coverage lives in [`routing.test.ts`](src/routing.test.ts), [`paths.test.ts`](src/paths.test.ts), [`route-maps.test.ts`](src/route-maps.test.ts), and [`route-views.test.ts`](src/route-views.test.ts). Passing those tests verifies their assertions, not the disputed Azure assumptions. The four review probes above were separate read-only reproductions, not new regression tests that would enshrine inconsistent behavior.

```powershell
npm test -- src\routing.test.ts src\paths.test.ts src\route-maps.test.ts src\route-views.test.ts
npm run lint
npm run build
```

References (the HRP, deep-dive, and route-map pages were rechecked on the review date):

- [Virtual hub routing preference](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference): staged HRP, secure-remote preference, inter-hub ASNs and arrival-order caveats.
- [Virtual WAN routing deep dive](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive): NVA versus VPN distinctions, ER export suppression, static hub routes and shared-circuit reflection.
- [Route maps](https://learn.microsoft.com/azure/virtual-wan/route-maps-about): default permit, ordered processing, summary AS-path removal, prepend limitations and inbound/outbound placement.
- [Routing intent and policies](https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies): deployment-specific intent behavior; use the frozen report for this lab's actual observations.
- [Azure testing lessons](AZURE-TESTING-LESSONS.md): independent predictions, correct measurement layers, evidence boundaries and ownership-safe cleanup.
