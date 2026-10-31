# Routing logic, route selection, and application critique

**Current application review:** section 9 was updated on **2026-10-31** against
deployed feature revision `8c5f0a6498a8`, covering every open and closed issue
through #23. Sections 1-8 retain the earlier, revision-specific engine review
and its follow-up; they are not a current feature inventory. In particular,
spoke BGP NVAs and hosting-VNet route maps are now implemented, and the
documentation-ASN wizard restriction has been corrected.

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

### Diagnostic-layer follow-up (#17)

The intent-aware checker in `src/diagnostics.ts` uses independent forward and
return traces, declared endpoint ownership, address-range partitions, physical
path sets and bounded single-link scenarios. It distinguishes modeled failures,
risks and unassessed cases; application delivery, firewall rules, NAT and ECMP
hash pairing remain outside its scope.

R1 is now corrected at the shared site-export boundary: an already-leading
sender ASN is not prepended again, while Azure-learned transit routes still
receive the sender ASN when absent. Explicit/configured origins, Azure transit
and ECMP have regression coverage.

R2-R4 are not claimed resolved. Diagnostics gate affected ER-default cases,
reserved hub-AS/input assumptions, NVA selection and unavailable SD-WAN outbound
learning as unknown. Unrelated supported flows remain assessable. This does not
change the historic lab evidence or certify new Azure behavior.

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

## 9. Application critique and prioritized recommendations

### Review scope and conclusion

Reviewed the current implementation, README, existing engine critique, scoped
Azure lab report, and all **23 GitHub issues: 12 closed and 11 open**, including
their latest implementation/evidence comments. An issue's original planning
body is not necessarily its current delivery status: #16 and #17, for example,
still contain historical proposal wording although their features are shipped.
This section updates the existing recommendations rather than creating a
second competing roadmap.

**The strongest part of the application is explainability:** separate routing
planes, neighbor-specific before/after policies, exact link provenance,
independent return paths and preserved failed Azure predictions make it more
useful than a diagram-only designer. Local-first operation and the existing
Free hosting are appropriate; a cloud backend or infrastructure-platform
rewrite is not needed for the next improvements.

**The biggest remaining weakness is confidence communication.** The interface
still combines different coverage units, and realistic configurations can be
drawn more completely than they can be assessed or reconstructed from Azure.
Prioritize making those boundaries understandable, then extend the specific
routing contracts that block common workflows. Do not solve uncertainty by
hiding it, declaring all unknowns healthy, or adding more danger signs.

This is a product and implementation critique, not a new security audit, live
Azure experiment, accessibility certification or performance benchmark.
Recommendations below are proposals, not additional implemented features.

### Delivered capabilities to preserve

Structural capture/import and bare-hub Bicep export are delivered, not future
MVPs. Azure comparison, intent-aware diagnostics, explicit-only highlighting,
duplicate/overlapping declared IP-range detection, and one danger sign per
finding are also delivered. Logical SPOF detection intentionally excludes
spoke-to-hub attachments while retaining spokes in affected components.

The latest feature release includes blank-canvas panning/reset, explicit spoke BGP
NVAs, hosting-VNet policies and contextual IN/OUT association removal. Removing
an association preserves the opposite direction, other users of the map and
the reusable definition. The new NVA transport is not integrated SD-WAN.
These are regression invariants, not recommendations to implement again.

Route-map prepending now permits documentation ASNs `64496-64511` for lab
simulation with an Azure-acceptance caveat. Microsoft does not explicitly ban
that range in its route-map limitations; IANA documentation reservation alone
does not prove rejection. Production guidance remains owned public two-byte
ASNs. The separate NVA peer-identity contract does exclude documentation ASNs.
Keep those two contracts distinct.

### Complete issue reconciliation

States below are the review-time GitHub states, not implied certification.

| Issue | State | Current outcome and recommendation |
|---|---|---|
| [#1](https://github.com/erjosito/vwan-visual-topology/issues/1) | Closed | Offline WAN/bare-hub Bicep starter delivered. Keep omissions/refusals; it is not lossless topology deployment. Extension belongs to #4. |
| [#2](https://github.com/erjosito/vwan-visual-topology/issues/2) | Closed | Locally authenticated structural capture/import delivered. Preserve preview/cancel and explicit unsupported configuration. Do not rebuild browser authentication. |
| [#3](https://github.com/erjosito/vwan-visual-topology/issues/3) | Closed | Delivered: `importAzureCapture` accepts v2 collector files and persists observed `tables` and `spokes` in `topology.azureImport`, and the Hub BGP table inspector provides a `Simulated` / `Azure snapshot` toggle with resolved resource labels. |
| [#4](https://github.com/erjosito/vwan-visual-topology/issues/4) | Closed | Delivered: Bicep export now supports existing-VNet `hubVirtualNetworkConnections` (`enableInternetSecurity`) and secured-hub `Microsoft.Network/azureFirewalls` (`AZFW_Hub`) + `routingIntent` when explicit existing VNet / Firewall Policy ARM IDs are supplied. |
| [#5](https://github.com/erjosito/vwan-visual-topology/issues/5) | Closed | Scoped real-Azure experiment and owned-resource cleanup complete. Preserve original failed predictions and scope; this does not certify later features or all routing cases. |
| [#6](https://github.com/erjosito/vwan-visual-topology/issues/6) | Open, core shipped | Explicit spoke-NVA modeling is live. Remaining controlled competition/session/failover evidence must not be conflated with the implemented offline feature or integrated SD-WAN. |
| [#7](https://github.com/erjosito/vwan-visual-topology/issues/7) | Closed | Empty-static Azure materialization classification corrected and live-retested. Preserve the distinction from genuine custom routing. |
| [#8](https://github.com/erjosito/vwan-visual-topology/issues/8) | Closed | Inter-hub ASN double-counting in the locality warning corrected. Arrival history remains a limitation, not an outstanding nominal-selector bug. |
| [#9](https://github.com/erjosito/vwan-visual-topology/issues/9) | Open | Native/MSEE/customer AS-path representation requires controlled evidence. Keep raw paths and measurement boundaries; do not normalize discrepancies away. |
| [#10](https://github.com/erjosito/vwan-visual-topology/issues/10) | Closed | Remote-ER ASPath exclusion corrected after independent physical evidence. Retain local tie-breaking and the documented rule/example conflict. |
| [#11](https://github.com/erjosito/vwan-visual-topology/issues/11) | Closed | Private-AS removal at the ER customer boundary fixed and live-retested. Preserve public order and unaffected hub/VPN paths. |
| [#12](https://github.com/erjosito/vwan-visual-topology/issues/12) | Closed | Private-only firewall Internet fallback corrected separately from hub defaults. Do not reintroduce green delivery for unknown private destinations. |
| [#13](https://github.com/erjosito/vwan-visual-topology/issues/13) | Closed | Delivered: explicit opt-in `propagateDefaultRoute` controls on connections, spokes, and hub ER links (`Propagate default route (0.0.0.0/0)`), suppressing outbound `0.0.0.0/0` by default unless enabled and a hub Internet routing intent or learned default route is present, with Azure VNet `enableInternetSecurity` import mapping. |
| [#14](https://github.com/erjosito/vwan-visual-topology/issues/14) | Closed | Separate candidate/learned/advertised views and filters delivered, including ER-location inspection. Improve scale and NVA categorization without merging the planes again. |
| [#15](https://github.com/erjosito/vwan-visual-topology/issues/15) | Closed | Superseded by #27: zero-consent public feedback repository (`erjosito/vwan-visual-topology-feedback`) provides direct GitHub issue filing without OAuth app consent, while preserving the optional managed API path. |
| [#16](https://github.com/erjosito/vwan-visual-topology/issues/16) | Closed | Non-destructive local-capture comparison delivered. Persistence is #3; custom contexts are #22. Match means compared fields match, not network certification. |
| [#17](https://github.com/erjosito/vwan-visual-topology/issues/17) | Closed | Diagnostics delivered, including later ownership/SPOF/marker corrections. Coverage semantics and unsupported contracts are #19-#23, not a need to rebuild diagnostics. |
| [#18](https://github.com/erjosito/vwan-visual-topology/issues/18) | Closed | Selection no longer starts or retargets highlighting. Preserve explicit requests, independent traces and the documented table-highlight clearing exception. |
| [#19](https://github.com/erjosito/vwan-visual-topology/issues/19) | Closed | Delivered: integrated SD-WAN outbound route export (`65515` prepend + hub outbound maps + site import) and validated NVA selection ranking in diagnostics, removing the blanket SD-WAN outbound unassessed gate. |
| [#20](https://github.com/erjosito/vwan-visual-topology/issues/20) | Closed | Delivered: consistent hub eBGP own-AS (`65515`/`65520`) loop rejection across ER location imports, legacy connections, and spoke BGP NVAs, plus diagnostic AS-path input boundary gates for non-origin leading site ASNs and pre-existing `12076` on non-ER links. |
| [#21](https://github.com/erjosito/vwan-visual-topology/issues/21) | Open | Deterministic resumable analysis and explicit overflow scope remain. Keep cancellation, limits, routing-revision invalidation and stale-worker protection. |
| [#22](https://github.com/erjosito/vwan-visual-topology/issues/22) | Open | Custom table/association/propagation contexts require explicit configuration and observation provenance. Do not reconstruct them from effective-route snapshots alone. |
| [#23](https://github.com/erjosito/vwan-visual-topology/issues/23) | Closed | Delivered: routing-check status and coverage drawer now separate unassigned advertised prefixes (with every unassigned prefix listed per site and a direct Edit button), grouped model scope boundaries (such as SD-WAN flow pairs), and genuinely incomplete/truncated scans. |
| [#24](https://github.com/erjosito/vwan-visual-topology/issues/24) | Closed | Delivered: spoke-NVA is rendered as a composite router badge attached below its hosting spoke VNet icon; peer IPv4 is auto-inferred from the spoke prefix (or optional); creation uses attached downstream Azure VNets (including non-spoke VNets) and on-premises sites instead of redundant Originated prefix / manual BGP advertisement fields. |
| [#25](https://github.com/erjosito/vwan-visual-topology/issues/25) | Closed | Delivered: `unowned-advertisement` diagnostics now enumerate every connection/ER-link advertisement source per unassigned prefix (with transport, hub/location, and AS path) and provide direct one-click `Edit advertisements: <connection>` and `Edit <site>` actions in the coverage panel and advanced diagnostics drawer. |
| [#26](https://github.com/erjosito/vwan-visual-topology/issues/26) | Closed | Delivered: multi-prefix site ownership (`prefixes` comma-separated editor and `+N` badge on site nodes), one-click `Assign <prefix> to <site>` action in coverage notices, and separate `Spoke BGP NVAs` categorization in `RouteInspector` and workspace stats. |
| [#27](https://github.com/erjosito/vwan-visual-topology/issues/27) | Closed | Delivered: zero-consent feedback submission via pre-filled GitHub issue links to the public repository `erjosito/vwan-visual-topology-feedback`, closing #15. |
| [#28](https://github.com/erjosito/vwan-visual-topology/issues/28) | Closed | Delivered: bounded 40-step local undo/redo history with `Ctrl+Z` / `Ctrl+Y` (`Ctrl+Shift+Z`) keyboard shortcuts, shared route-map attachment preview in the editor, and orphan `spoke-nva` site cleanup when deleting its hosting spoke. |

### Prioritized implementation recommendations

#### P1 - Separate routing findings, configuration omissions and scan coverage (#23)

**Evidence:** `src/App.tsx:85` counts unknown findings, and
`src/App.tsx:388-396` combines them with routing issues in the headline. In the
reported example, "14 unassessed cases" means **11 unsupported SD-WAN flow
assessments plus three router-level notices covering four unassigned advertised
prefixes**. The run visited 21 cells and 42 probes without exhausting a budget.
Neither fourteen network faults nor fourteen missing implementations follows.

Use consistent units and distinct categories: detected routing findings,
unassigned/overlapping owned ranges, unsupported model capabilities, and
unfinished requested analysis. Put implementation-gap details and issue links
in optional model/coverage documentation, not repeated primary warnings for
each unsupported flow. The primary result must still state its assessed scope.
Keep a real incomplete-run indication for exhausted budgets, nonconvergence,
unreadable requested requirements and trace overflow.

**Acceptance:** the mixed example reports actual issue count without a summed
"14 cases" label; missing ownership identifies the affected prefixes and an
editing action; a budget-limited run names its actual budget and unfinished
scope. Unsupported flows are neither danger icons nor silently healthy.
English/Japanese, automatic/advanced views and downloaded reports agree.
Preserve one topology sign per finding and distinguish duplicate declared
ranges from repeated BGP advertisements or live-host duplicate-IP discovery.

#### P1 - Establish explicit advertisement and confidence contracts (#9, #13, #20)

**Evidence:** historic R2/R3 and the open issues identify representation/default
and admission gaps. The lab's positive advertisement subset deliberately did
not certify defaults or receiver absence. Current explicit spoke-NVA validation
does not establish equivalent behavior for every legacy transport.

Define the stage of every configured/observed AS path: source advertisement,
hub-learned candidate, inter-hub route, map snapshot or customer wire export.
Add explicit supported per-connection default controls with unknown distinct
from false; use one export contract for equivalent legacy/expanded ER models.
Apply scoped own-AS admission only where evidence supports it. Keep observed,
documented nominal and unvalidated behavior separate rather than inventing a
total transport ranking.

**Acceptance:** independently controlled prefix/default/own-AS fixtures cover
both ER representations and unaffected VPN/NVA behavior, with raw paths
preserved. Any new live test freezes predictions first and records arrival
order, exact receiver boundary and both competing inputs. Documentation-ASN
advice must not claim unperformed Azure acceptance/rejection.

#### P1 - Target the integrated-SD-WAN gap, not a generic NVA abstraction (#19)

**Evidence:** eleven unsupported flows in the reported topology depend on
integrated-NVA learning/ranking. The new spoke-NVA feature and the physical lab
use a different attachment category.

Select a small supported integrated-NVA scenario and establish inbound,
outbound, return-path and ranking capabilities from first-party/vendor evidence.
Replace unknown gates only for those supported configurations. Keep optional
vendor-specific behavior explicit; do not map every appliance to VPN or to a
spoke BGP peer merely to reduce the coverage count.

**Acceptance:** supported forward/return and competing-prefix fixtures have
reproducible evidence, asymmetric/missing-return regressions, and narrowly
removed coverage notices. Unsupported variants remain scoped model exclusions.

#### P2 - Make endpoint ownership practical for multi-prefix networks

**Evidence:** connections support many advertisements, including 4,000 explicit
spoke-NVA advertisements, but the site editor exposes one optional owned IPv4
prefix (`src/TopologyObjectEditor.tsx:194-197`). Advertisements correctly do not
establish ownership. This makes legitimate multi-network ownership harder to
declare and can encourage artificial extra site nodes.

Introduce a bounded multi-prefix ownership editor using the existing site
prefix representation where feasible. Clearly distinguish originated/owned
networks from transit advertisements and aggregates; retain empty ownership for
a transit-only NVA. Show unresolved advertised ranges with direct ownership
actions, without automatically assigning an aggregate to an advertising router.

**Acceptance:** one router can own several disjoint networks, native legacy
files round-trip, duplicate/overlap findings remain accurate, and summary holes
or repeated transit advertisements do not invent endpoints or ownership.
This is a new recommendation, not an already tracked implementation issue.

#### P2 - Integrate NVA identity into the whole workspace

**Evidence:** explicit NVA nodes and hosting-spoke paths are delivered, but
`src/App.tsx:378` still counts all router records as "sites", and
`src/RouteInspector.tsx:96` groups them under "On-premises sites". Automatic
positions reuse the router/site layout rather than a hosting-spoke grouping.

Categorize spoke NVAs consistently in counts, router selectors and path menus.
Place new NVA nodes near their hosting spoke, preserving user-saved positions
and both layouts. Distinguish logical peer availability from the actual two
Azure hub BGP sessions; do not imply physical redundancy was simulated.
Make hosting-VNet versus NVA-side policy ownership visible.

**Acceptance:** creation, deletion/rehosting, route selection, both-direction
paths and downstream links preserve existing semantics. Keyboard users can
discover creation and policy removal without a pointer; mobile native scrolling,
blank-canvas panning and explicit-only highlighting stay intact. Large diagrams
should have a deliberate fit/reset affordance, not silently move saved nodes.
This is a follow-on UX recommendation, not a claim that core NVA support is absent.

#### P2 - Add bounded undo and a small change-impact preview

**Evidence:** `src/App.tsx:190-199` validates and immediately persists edits;
the deletion editor explicitly says the action cannot be undone. JSON backup
and confirmation help, but changing a shared map or deleting an attachment can
affect many prefixes before the user understands the result.

Add bounded local undo/redo for topology edits, grouping a node drag as one
operation. Before destructive edits or shared-map changes, show affected
references and optionally changed selected routes for a bounded scope.
Do not introduce a backend, full version-control UI or hidden automatic repairs.

**Acceptance:** undo restores exact references, policies, advertisements and
layouts; redo is invalidated after a divergent edit; routing changes invalidate
old diagnostics and comparisons. Storage failure retains export recovery.
Shared-map unassignment remains distinct from deleting the definition.
This is a new recommendation and needs a separate scoped issue before implementation.

#### P2 - Persist reviewed observations and reuse the existing inspector (#3)

**Evidence:** #16 is delivered, but observations/mappings remain in page memory
(`src/App.tsx:76` and #3's delivery comment). A reload can lose a carefully
reviewed comparison even while the topology remains saved.

Add bounded, explicitly reviewed snapshot/mapping persistence and a small
Simulated/Azure snapshot switch in the existing inspector. Preserve timestamps,
selectors, associated next-hop/AS-path tuples and unavailable/partial/stale
statuses. Offer removal/export; avoid treating captured evidence as simulation
advertisements or deployment configuration.

**Acceptance:** reload/native exchange retains consented provenance and stable
mappings, old topology files remain compatible, edits cannot publish stale
matches, and failed/empty/partial observations never prove suppression.
Keep collection locally authenticated and manual, with no cloud credential store.

#### P2 - Measure scale before expanding limits or splitting code (#21)

**Evidence:** the production feature build has a **614.90 kB minified main
JavaScript chunk, 180.69 kB gzip**, and emits Vite's existing size warning.
`src/RouteInspector.tsx:39-85,111-119` groups/filter-scans route arrays and renders all
matching candidates; `src/App.tsx:148` recomputes simulation on topology changes,
including persisted layout changes. These identify measurement targets, not
proof of unacceptable latency.

Benchmark 500-1,000 prefixes, parallel routes and dense diagrams: load time,
edit/drag responsiveness, table opening/filtering, diagnostic time and peak
memory. Then consider lazy optional inspectors, reusable grouping, bounded
table rendering and separating layout-only work from routing computation while
retaining current labels/provenance. Keep the existing cancellable worker.

**Acceptance:** published before/after measurements justify each optimization;
small-topology semantics and accessibility remain unchanged. Resumable batches
visit every requested case without duplicates/omissions, and disclose 128-branch
or 32-site-path overflow instead of merely increasing/removing safety limits.

#### P2 - Turn the evidence and documentation into a maintained capability matrix

Maintain one concise matrix: modeled capability, Azure evidence scope,
observation/import support, export support, known limitation and tracking issue.
Separate supported nominal behavior from verified physical experiments and
configuration not represented at all. Cover #6, #9, #13, #19, #20 and #22 first.
Reuse the existing report and lessons rather than duplicating raw source/evidence.

Correct stale current-facing documentation and issue status summaries while
preserving dated proposals and immutable lab records. The README's obsolete
amber-unknown-marker description is corrected with this review. The earlier
engine snapshot's VNet-map exclusion is historical, not the latest capability.
Keep an explicit peer-ASN versus route-map-prepend FAQ and source dates.

**Acceptance:** README, current issue status and matrix agree on shipped
features; each fidelity claim identifies documentation versus actual measured
evidence. A planning body on a closed issue is not presented as an open roadmap.
For future validation, use small independently controlled experiments and only
clean up resources created for that experiment, never existing production assets.

### Blockers, sequencing and non-goals

Recommended sequence: #23 first; then scoped #13/#20 boundary/default work and
#19 evidence discovery; then ownership/NVA workflow improvements, #3 persistence
and measured #21 scaling. Custom routing contexts (#22) and broader export (#4)
need explicit model/target contracts before implementation, not inferred defaults.

Feedback #15 awaits owner GitHub App setup and a real authenticated submission.
Sign-in itself is enabled; submission intentionally remains unavailable.
This is a configuration blocker, not a reason to hold unrelated offline work.
Separately, hosted Actions run
[41184949161](https://github.com/erjosito/vwan-visual-topology/actions/runs/41184949161)
was blocked before steps by account payment/spending limits. Restore hosted CI
when the owner can resolve that; do not portray local validation as passing CI.
Keep the documented revision-stamped local validation/official SWA CLI fallback.

Do not add browser Azure authentication, continuous monitoring, automatic
remediation, a generic vendor BGP platform, packet/firewall/NAT certification or
paid hosting merely to address these recommendations. Preserve the existing
Free SWA, domains, local-first simulator and explicit import/export omissions.

### Verification supporting this review

Feature revision `8c5f0a6498a8` passed build/lint and **243 unit tests**.
All **95 distinct browser cases** passed across runs: 94 passed on the full run;
one old assertion required the corrected ASN wording, then all seven targeted
feature/map cases passed locally. This is not a claimed single final 95/95 run.
Those seven workflows also passed on production, including NVA creation/native
roundtrip, both layouts/directions, hosting-VNet policy filtering and contextual
association preservation.

All built assets matched SHA256 on the default SWA host and both custom domains;
all nine forged-principal gateway probes returned 401. Feedback remained
disabled and the managed deployment identity pin was refreshed without an
identity change. No new Azure lab resources were created or live NVA acceptance,
performance, failure or vendor certification experiments run for this release.
