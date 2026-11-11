# Virtual WAN Topology Lab

A browser-based Azure Virtual WAN topology designer and **explainable planning simulator**. No Azure credentials, backend, database, or telemetry are needed for simulation. Optional online feedback opens a pre-filled issue in the public feedback repository without OAuth consent or topology uploads.

**Live app:** https://vwan-simulator.com (Virtual WAN default) or https://aznet-simulator.com (Hub & Spoke default). Explicit `?mode=...` links override the hostname default; switching modes updates the URL so reloads retain the chosen mode. Both hostnames serve the same app; browser-saved topologies are separate per origin.

**Routing behavior and prioritized application recommendations:** [ROUTING-LOGIC.md](ROUTING-LOGIC.md).

## Features

- **Unified 3-way architecture mode switcher (`Full Hybrid Mode`, `Hub & Spoke-Only`, `Virtual WAN-Only`)**: Switch seamlessly in the top header bar (`?mode=full`, `?mode=hub-spoke`, or `?mode=vwan`) between standalone Hub-and-Spoke VNet routing (UDRs, Azure Firewall, NVAs, Azure Route Server, VNet Peering, Private Endpoints), Virtual WAN-Only, or Full Hybrid designs.
- **Optional custom text labels (`label`) on diagram nodes**: Add optional note/annotation badges (`<= 120` characters) to any Hub, Spoke/VNet, ExpressRoute Location, or On-Premises Site across all simulator modes. Labels render as amber pill badges directly below nodes on the canvas, round-trip in exported JSON and `#s=` shareable URLs, and do not trigger routing recalculation or invalidate Azure comparison results.
- Add virtual hubs, spoke VNets with IPv4 prefixes, and on-premises sites with editable ASNs and **one or more optional comma-separated originated prefixes** (`prefixes`, shown with a `+N` badge on multi-prefix site nodes). Connections can also advertise transit or aggregate routes.
- Connect sites to hubs using ExpressRoute, S2S VPN, or integrated SD-WAN NVAs, with opt-in per-connection, per-spoke, and per-ER-attachment **Propagate default route (0.0.0.0/0)** (`propagateDefaultRoute`, suppressing outbound `0.0.0.0/0` by default unless explicitly enabled and a hub Internet routing intent or learned default route is present).
- Add **spoke BGP NVAs** attached directly to existing VNet spokes (rendered as a composite spoke-plus-router badge rather than a standalone site node, and categorized separately in workspace counts and inspector selectors), with an auto-inferred or optional peer IPv4 address, ASN, and attached downstream Azure VNets (including non-spoke VNets attached only to one or more spoke-NVAs) and on-premises sites. These are distinct from hub-integrated SD-WAN.
- Add **ER location** nodes with the official ExpressRoute icon and connect them to hubs and sites. In H&S/Full mode, right-click an ER node and choose **Configure ER Location & Labels** to select its physical **ER location** from the Microsoft catalog dropdown, independently of its display name. VWAN mode exposes the same catalog under **Edit configuration**. Inspect per-attachment BGP advertisements and trace both physical links. Default ER-to-ER transit is blocked, including ER routes from remote hubs.
- Configure site-owned prefixes (`prefixes`) and learned site-mesh BGP routes (`learnSiteRoutes`) on connections, plus non-BGP VPN static prefixes (`vpnStaticRoutes`) as **site attributes**, associated with the relevant VPN connection and accessible from either endpoint. Legacy connection-level `routes` fields in imported JSON are ignored for backward compatibility and omitted from exported JSON. Disable connections to explore failures.
- Right-click a VPN connection for **Change to static routing** / **Change to BGP routing**. A configure/review wizard seeds editable site-side destinations and updates site prefixes, site statics and learning settings together. Mixed routing offers both conversions.
- Choose ExpressRoute, VPN, or AS Path routing preference independently per hub.
- Canvas-first workspace with **Layered topology** and **Network constellation** visuals, zoom, and right-click/keyboard creation and editing. Drag nodes to rearrange; links follow live. Positions are saved independently per view in browser storage and exported JSON. **Reset layout** restores only the active view. There is no permanent sidebar or prefix-filter dropdown.
- **Maximize canvas** at the bottom right temporarily hides the top controls, simulated-outage panel, and routing-check banners in every mode. **Restore panels** remains available in the same place. Existing checks, failure overlays, highlights, and inspector windows stay intact; this is a temporary view setting, not a topology edit.
- **+ / - zoom controls** synchronize with the percentage selector. The SVG viewport fills the available canvas without unusable side gutters, so nodes can be dragged to either side in both layouts.
- **BGP table**, **Learned routes**, and **Advertised routes** open distinct movable, resizable canvas inspectors. The BGP table groups candidates and marks preferred paths with `*`; click a prefix to highlight its paths. Every table supports a prefix text filter. Learned/advertised views also filter by neighbor and default to **After** inbound/outbound route maps, with a **Before** stage showing policy inputs, including subsequently dropped or summarized routes.
- Plain node selection, context-menu opening and configuration saves never start route/path highlighting. Use **Highlight preferred routes**, a deliberate BGP-prefix selection, **Show path to/from**, the path explorer or a diagnostic finding. Selecting another object does not retarget an existing highlight. Opening/changing a route-table inspector clears its router-table highlight rather than silently highlighting a new table; independent flow traces are preserved. **Clear highlighting** also clears diagnostic evidence.
- Enable private and/or Internet routing intent. Inspect **hub policy routes and firewall forwarding routes separately**, and see firewall traversal in flow traces.
- Routing intent changes the hub itself into a **Secured virtual hub** on the canvas, without an extra firewall node or attachment. Either policy enables the secured icon; disabling both restores the normal hub. Firewall traversal highlights the secured hub and remains explicit in path details.
- Connect on-premises sites with directional BGP export allowlists and AS-path prepends. Configure site ASNs and originated prefixes, then enable mesh route import on the desired hub connections.
- Create named, reusable route maps owned by a **hub or on-premises site**. Each router assigns its own inbound/outbound policies to specific connections; the two ends are independent. Policies support ordered prefix matching, blocking, summarization and ASN prepending.
- **H&S / Full Hybrid site route maps:** right-click an on-premises site and choose **Manage Site Route Maps**. Reuses the VWAN rule editor and policy engine, with per-connection inbound/outbound assignments, unchanged unmatched routes, private/32-bit site ASNs and static-VPN bypass. Policies survive JSON export/import and undo/redo; deleting a map or connection cleans its assignments. BGP selection and flow traces follow the resulting connection. Azure Bicep export warns that site-device policies require separate router configuration; ARS-owned policies are a separate feature.
- **H&S / Full Hybrid ARS route maps:** right-click Azure Route Server and choose **Manage ARS Route Maps**. Assign prefix-based permit/drop, summarization and 2-byte AS-path prepend policies independently on each local NVA BGP peering or ER/VPN gateway connection. Inbound maps run before ARS selection; outbound maps affect advertisements, not ARS best paths. Inspect the selected connection's inbound/outbound post-policy tables, including the protected ARS own-VNet advertisement. Gateway exchange still requires Branch-to-Branch. Maps and assignments survive JSON/storage/history, and deleted maps/peers are cleaned up. Azure-reserved prepend ASNs are rejected; private prepends are stripped by ExpressRoute. **Modeled subset:** AS-path/community matching, attribute replacement, peered-spoke connection associations and ARS policy deployment in the Bicep starter are not supported. Unsupported advanced rule fields are rejected on import rather than ignored. See [Microsoft's ARS route-map documentation](https://learn.microsoft.com/azure/route-server/route-maps-about) for full Azure capabilities and limitations.
- **IN / OUT filter marks** identify each mapped connection near its owning hub/site, with contrasting, white-outlined arrows showing advertisement direction. Hover or focus a mark to preview the applied rules; click to inspect that exact endpoint, connection and direction, or choose **Show route map rules** for the router's complete policy list.
- **H&S / Full Hybrid canvas:** uses the same IN/OUT filter marks and rule previews for site connections and mapped ARS peer/gateway sessions. ARS sessions appear as labeled control-plane connections inside their VNet, separately from data-plane links; inactive policies remain visible with dashed marks. Subnet pills reserve space for compact route-table and PE tags; subnet prefixes and full names appear on hover or keyboard focus, while propagation settings remain in the route-table popover.
- Hover **Show path to** / **Show path from** on hubs, sites and spokes, then choose an endpoint and prefix from cascading menus to highlight forwarding paths immediately. No inspector opens automatically; use **Path details** for per-hop explanations or **Open path explorer** for custom addresses.
- **Show path to/from → All Azure VNets / All onprem sites / Everywhere** highlights grouped paths on hubs, sites and spokes. “To” traces from the selected node to that group's destination prefixes; “from” traces independently from each group member to the selected node's prefixes. Everywhere combines VNets and sites, excluding the selected node; hubs are not duplicated as copies of their spokes. **Path details** identifies each source, destination, prefix and unreachable result, retaining ECMP. Shared outgoing destination prefixes are traced once, but distinct incoming sources are never merged.
- Streams of larger circles show traffic direction at a constant 200 screen pixels per second, following the actual curved links in order. Circles are evenly spaced, with a new departure at most every 0.65 seconds rather than waiting for delivery. Each destination receives the next color in a fixed 20-color palette (teal, blue, amber, purple, and rose first), shared by its circles and a pale node-background tint. Multiple prefixes, sources, and equal-cost paths to the same destination share its color; the palette repeats after 20 destinations. Identical paths share one stream. Movement, layout, and zoom recalculate travel time; reduced-motion preferences retain static highlights and destination colors without animation.
- Save automatically in browser storage, use bounded local **Undo / Redo** (`Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z`, up to 40 steps), and import/export validated, versioned JSON.
- **Azure files** imports a local, read-only Azure CLI capture (v1 structural or v2 with observed effective-route snapshots) after review, persists observed snapshots on the imported topology (`azureImport.tables` and `azureImport.spokes`), and exports an offline Bicep starter for a new Standard WAN, selected hubs, optional `AZFW_Hub` Azure Firewalls with `routingIntent`, and optional existing-VNet `hubVirtualNetworkConnections`. No Azure authentication, SDK or deployment service is added to the app.
- **Hub BGP table inspector** includes a **Simulated / Azure snapshot** source switch whenever imported observed route snapshots are present on the topology, displaying observed prefixes, next-hop types, resolved resource names, and route origins alongside simulated routes.
- **Compare with Azure capture** attaches optional effective-route observations without replacing the design. Explicit resource mappings, route scope and coverage distinguish extra/missing routes, changed selected next hops, optional AS-path differences and unassessed cases.
- **Send feedback** opens a zero-consent pre-filled GitHub issue in the public feedback repository (`erjosito/vwan-visual-topology-feedback`) with no OAuth consent required.
- **Clear topology** beside Export/Import starts an empty, saved workspace after confirmation. Cancel/Escape preserves the current topology; export first if you need a backup.
- Select any node or connection in the diagram to rename, edit or delete it. Add spokes and connected sites from a hub, or hub/BGP links from a site, without leaving the topology.
- **Check routing** immediately scans modeled connectivity between all assigned endpoint networks and saved requirements. Findings sharing a modeled cause are grouped into one issue, with separate root-cause and affected-flow counts. Warning markers at affected endpoints navigate to the shared issue; expand its flow evidence to inspect independent forward/return paths. Partial repairs update the remaining group membership. Unassessed coverage is shown separately in neutral coverage notes, not danger signs. Optional **Advanced checks** retain explicit flow, firewall and neighbor requirements. No Azure credentials or packet probes are used.

## Appearance

The header **Theme** selector offers **Light**, **Dark**, and **System** in all three simulator modes. **System is the default** and follows operating-system changes while the app is open. An explicit choice is saved locally (`aznet-theme`), survives reloads and mode switching, and synchronizes across tabs on the same origin. If browser storage is blocked, the choice works for the current view without preventing simulation.

The startup page resolves the theme before React loads to avoid a wrong-theme flash. Shared semantic colors cover the canvas, SVG labels/links/badges, menus, forms, tables, inspectors, galleries, feedback and ER catalog. Status labels/icons, route-selection markers and line patterns remain alongside color; path animation still indicates direction. Reduced-motion behavior is unchanged. Printing uses the light palette; JSON/Bicep exports and saved topology data do not contain or depend on the appearance preference.

For new controls, use inherited form/window styles or the CSS tokens in `src/theme.css`: `--surface`, `--surface-muted`, `--text`, `--text-muted`, `--border`, `--accent`, `--selection`, `--focus`; status text pairs with `--error-surface`, `--warning-surface`, `--info-surface`, or `--success-surface`. SVG path direction uses `--forward` / `--return`; per-destination colors use `--path-1` through `--path-20`. Do not reuse status colors for arbitrary destinations or hard-code a popup palette.

## Languages and networking terminology

The interface supports **English** and **日本語 (Japanese)**. The header language selector changes the interface without changing topology names, addresses, configuration, selected routes or exported JSON. The choice is saved locally, independently of the topology; English remains the default. Translations are bundled with the app and do not call an external translation service.

Japanese terminology follows Microsoft's Japanese Virtual WAN documentation, cross-checked against Cisco's Japanese BGP documentation:

| English | Japanese |
|---|---|
| Route / route table | ルート / ルート テーブル |
| BGP table | BGP テーブル |
| Learned routes | 学習したルート |
| Advertised routes | アドバタイズしたルート |
| Effective routes | 有効なルート |
| AS path / prefix | AS パス / プレフィックス |
| Next hop / neighbor | 次ホップ / ネイバー |
| Route map | ルート マップ |
| Longest-prefix match | 最長プレフィックス一致 (LPM) |
| Hub routing preference | ハブのルーティングの優先順位 |

Established product/protocol names and acronyms such as Azure, Virtual WAN, ExpressRoute, BGP, VPN, SD-WAN, ASN and ECMP stay unchanged. User-defined/imported/example names and regions, numeric data, schema keys and executable code are data, not translated interface text. Unknown externally supplied warnings stay as supplied rather than being machine-translated; browser-native validation follows the browser's own language.

Sources checked before implementation: [Microsoft hub routing preference](https://learn.microsoft.com/ja-jp/azure/virtual-wan/about-virtual-hub-routing-preference), [effective routes](https://learn.microsoft.com/ja-jp/azure/virtual-wan/effective-routes-virtual-hub), [route maps](https://learn.microsoft.com/ja-jp/azure/virtual-wan/route-maps-about), and [Cisco BGP best-path selection](https://www.cisco.com/c/ja_jp/support/docs/ip/border-gateway-protocol-bgp/13753-25.html).

## Routing diagnostics

Choose **Check routing** to run the scan immediately, without configuring flows first. It checks every pair of assigned site/VNet networks, including forward/return delivery, selected-path failures, loops, aggregate gaps, wrong exits, asymmetry and duplicate/overlapping endpoint IP ranges. Repeated BGP advertisements are not duplicate address ownership; the simulator cannot detect duplicate addresses on live hosts. Healthy automatic cases do not create individual findings or canvas nodes. Warning signs identify shared root-cause issues on implicated and affected objects; multiple signs can navigate to the same issue without multiplying its root count. Click a sign to open that explanation and animate its independent forward and return paths in different destination colors. Expand affected-flow evidence to inspect each member's paths. Issue titles and **Highlight issue paths** offer the same explicit action. Failed streams end at the last reached node, marked with a stop symbol; a failure at the source shows a stop without inventing a link to animate. Aggregate gaps stop before the untraversed egress attachment. Use **Review routing issues** for the full list. Explanations load 50 findings at a time and support prefix/endpoint filtering.

Automatic unreachable-network findings are warnings because isolation may be intentional. **Advanced checks** opens the optional intent-aware inspector for expected/forbidden flows, firewall waypoints, neighbor requirements, profile/report exchange and single-link failure analysis. Saved flow requirements override automatic connectivity expectations for their covered endpoint/address pairs. An allow requirement checks both directions; a deny requirement checks only the specified forward direction. Source addresses matter for return routing. Prefix checks evaluate routing-equivalent address intervals, not a ping to every host or only the prefix base address.

Automatic scans also detect **single points of failure**: graph bridges whose removal splits a currently connected logical component. Checks include enabled VPN/SD-WAN/ER attachments, on-premises links, physical ER legs and implicit inter-hub links. Spoke-to-hub attachments are not flagged because resiliency cannot be configured at that level; spokes remain in the graph and in the affected node groups for other critical links. Parallel links and cycles prevent a structural bridge; already disconnected nodes are not attributed to an unrelated link failure. Each finding names the critical link and both separated node groups. This is a resilience risk, not a current outage. Absence of a bridge does not prove routing failover, independent physical circuits, convergence or shared-risk resilience; the optional advanced failure analysis separately recomputes routes for declared requirements.

Findings distinguish modeled errors, potential risks, information and cases that cannot be assessed. Asymmetric transit is not automatically an error, and ECMP candidates do not predict the forward/return traffic hash. Firewall waypoint checks do not execute firewall rules, NAT or session state. Coverage notices are separated into **Analysis coverage & model scope**, not topology danger signs, routing problems, or a combined "unassessed cases" count. The status bar and coverage drawer distinguish three separate categories with consistent units: **unassigned advertised prefixes** (with exhaustive per-prefix evidence naming the exact connection/ER-link advertisement source, transport, hub/location, AS path, and direct **Assign prefix to site** / **Edit static routes** and **Edit site** buttons so missing ownership can be fixed in place), **model scope boundaries** (such as unsupported SD-WAN outbound learning, grouped once per capability with collapsible affected endpoint pairs), and genuinely **incomplete scans** (only when an analysis budget, trace/ECMP limit or nonconvergence truncates the check). Advertisements alone do not establish ownership or create physical sites. Unknown ownership, unsupported learning, provisional routing and exhausted analysis limits must not be interpreted as a healthy real network.

Analysis runs in a cancellable local worker. Automatic scans have explicit limits of 50,000 address cells, 20,000 uncached traces, 1,000 findings and 15 seconds; reaching any limit shows an incomplete check rather than a clean bill of health. Repeated route/ownership/physical-path queries are cached for each immutable scenario. Large meshes are generated lazily rather than creating all endpoint pairs in advance. Optional single-link failure checks work on model copies only. Editing routing invalidates the signs and results; layout, names and language changes do not. Cancelled or superseded workers cannot publish late results.

The coverage panel names the actual exhausted budget and shows the limits used by that run. An address cell is a routing-equivalent source/destination interval pair, not a host count. The optional advanced run uses smaller defaults: 2,048 cells, 4,096 uncached traces, 500 findings, 24 routing failure scenarios and 5 seconds. Independent engine safeguards also limit traces to 128 branches and site selection to 32 equal paths; overflow remains unassessed. Missing ownership, unsupported behavior and nonconvergence are separate reasons for incomplete coverage, even below these budgets.

Unsupported analysis is tracked separately from detected network problems:

| Coverage gap | Implementation tracking |
|---|---|
| Integrated SD-WAN vs spoke BGP NVA parity | SD-WAN outbound learning and validated NVA tie-breaking delivered under #19; distinct spoke BGP NVA modeling delivered under #6 |
| Hub own-AS loop rejection and advertised AS-path boundaries | Hub eBGP own-AS (`65515`/`65520`) rejection and diagnostic input gates delivered under #20; ER customer/native path fidelity remains #9 |
| ER Internet/default advertisement controls and parity | Delivered under #13 |
| Resumable large analyses, trace/ECMP overflow and bounded failure scenarios | #21 |
| Imported custom hub tables, association/propagation and unobserved controls | #22; observed snapshot persistence delivered under #3 |

Missing/ambiguous ownership and references to deleted endpoints or neighbors are model/profile input problems to correct, not missing application features. Actual host duplicate-IP discovery, firewall rules, NAT, sessions and traffic-hash predictions are outside the current offline routing model; duplicate **declared IP ranges** are detected, not inferred from repeated route advertisements.

Analysis profiles are stored separately from topology JSON in this browser. Profiles can be downloaded/imported; diagnostic reports can be downloaded. These files contain endpoint addresses, object IDs and modeled route details and must be handled under your organization's data policies. No profile/report is sent to Azure, feedback or a new backend. Importing an analysis profile does not replace the topology.

## Offline failures and failure-domain resilience

All three modes support **Simulate failure of Azure region**, **ER location**, and **on-premises site** in the relevant node context menus. Regional faults remove every explicitly assigned regional resource (including embedded gateways, Route Servers and appliances) and its attachments from the active routing calculation. ER geography is never used to infer Azure region membership. A failed node is gray with an explicit **× SIMULATED FAILURE** badge; its entire context menu contains only applicable domain-wide restore actions. The active-outage banner provides **Restore all**.

Failures are **session-only overlays**, separate from the baseline topology and undo history. JSON/Bicep exports, sharing and local persistence always contain the intact baseline, even during a simulated outage; reloading discards faults. Simulation does not change administrative enable flags, policies, prefixes or layout. Effective routes, independent forwarding traces and diagnostics use the active scenario. There are no Azure API calls.

Virtual WAN VNets now support an optional explicit `region` field, configurable in their editor. Legacy/missing/unrecognized region metadata is **unassessed**, not guessed from a hub attachment. Embedded spoke NVAs inherit their hosting VNet's explicit region; ambiguous hosts are unassessed. Regions accept canonical names and Azure identifiers, e.g. `West Europe` / `westeurope`.

Open **Failure-domain resilience analysis (N-1)** above the canvas to check the baseline-working landscape against each single modeled site, location and region loss. Findings are grouped by failed domain, with separate group and affected flow/scenario counts. Each affected pair retains its own baseline/failure forward-return evidence and repair guidance; the group can simulate the corresponding reversible outage. **△ N-1 scenarios** markers count distinct failure scenarios at surviving affected endpoints, distinctly from current-outage styling, and open the relevant flow evidence. Baseline faults, hypothetical resilience gaps and unavailable endpoints are reported separately. Endpoint loss is not evidence of inadequate path redundancy; replicas/service recovery are not inferred.

The `ResilienceReport` API in `src/failure-analysis.ts` keeps `gaps` (`category: n-1-resilience-gap`) separate from structured `endpointExclusions` (`category: failed-endpoint-exclusion`). Both carry stable `id`, `scenarioId` (`<domain-kind>:<domain-id>`), `pairId`, and the implicated `fault: { kind, id, name }`. IDs do not depend on display names or diagnostic messages. Gaps retain baseline/failure forward-return evidence; exclusions retain baseline evidence and distinguish `failedEndpointIds` from `survivingEndpointIds`. Consumers can aggregate by category/domain/scenario without treating expected endpoint loss as a disconnected-survivor defect.

Virtual WAN honors saved declared allow requirements and excludes deny intents; without requirements, full workload/site connectivity is explicitly assumed. Hub & Spoke and Full Hybrid disclose their full-connectivity assumption (they have no declared exclusions contract). Checks use actual effective routing/UDRs and BGP withdrawals, not link counts. Stateful inspection must survive symmetrically; stateless path differences alone are not defects.

Coverage reports checked/total pairs, scenarios and failure/pair cases, endpoint-unavailable and unassessed cases, invalid/missing regions and computation limits (200 baseline pairs, 1,200 failure/pair cases, 3 seconds). Empty/partial/unassessed scope never establishes N-1 resilience. Representative-prefix/IP, ECMP/hash selection, physical shared risks, convergence timing, firewall policy, NAT, imported unobserved controls and application/platform recovery remain outside the conclusions. Results become stale after baseline routing changes and must be rerun. No result guarantees real-world availability.

## Run locally

Requires Node.js 22.12+.

```shell
npm ci
npm run dev
```

```shell
npm run lint
npm test
npm run test:collector
npm run build
npx playwright install chromium
npm run test:e2e
```

Production output is `dist`. The app uses relative asset URLs and can be served as static files. Browser storage is specific to the origin and device; export JSON before clearing storage or moving to a different URL. Exported files contain your topology and must be treated according to your organization's data policies.

## Documentation & worked examples

- **Live interactive documentation:** [`https://vwan-simulator.com/docs/`](https://vwan-simulator.com/docs/) ([日本語: `https://vwan-simulator.com/docs/?lang=ja`](https://vwan-simulator.com/docs/?lang=ja), also accessible via the **Docs** / **ドキュメント** button in the simulator header)
- **Markdown user guide & screenshots:** [`docs/README.md`](docs/README.md) (English) · [`docs/README.ja.md`](docs/README.ja.md) (日本語)
- **Downloadable sample JSON topologies:** [`samples/README.md`](samples/README.md) (English) · [`samples/README.ja.md`](samples/README.ja.md) (日本語) — includes the 4 Virtual WAN showcase samples (`hub-routing-preferences.json`, `secured-hub-routing-intent.json`, `spoke-bgp-nva-transit.json`, `three-hub-all-features-asymmetric.json`) as well as 5 comprehensive Azure VNet showcase samples and 9 live-Azure validation scenarios in [`samples/azure-net/`](samples/azure-net/) (`enterprise-vnet-all-features-showcase.json`, `hub-spoke-firewall-udr.json`, `ars-sdwan-nva-coexistence.json`, `dual-hub-vnra-global-peering.json`, `hybrid-vwan-and-hub-spoke.json`, and `uc1`–`uc9`), all accessible via one-click `?sample=<slug>` deep links.

The collector integration tests require PowerShell 7 but use a mocked Azure CLI, with no Azure access. CI also compiles a representative generated Bicep file with Bicep **v0.40.2**, without authenticating or deploying.

## Working with the app

Drag a blank canvas area with the left mouse button to pan the topology in either direction, at any zoom. Panning changes only the current view, not saved node coordinates or routing. **Reset canvas view** (or Home while the canvas is focused) restores the original view. Dragging nodes still arranges their saved positions; link actions, right-click menus and mobile scrolling remain separate.

### BGP NVAs in existing spokes

1. Right-click an existing spoke and select **Add BGP NVA**, or use that button in **Edit configuration** after saving spoke changes.
2. Name the NVA, enter its **NVA ASN** and **NVA BGP interface IPv4** address within the hosting spoke. Use a non-reserved public/private 2-byte ASN; Azure/IANA-reserved values and the hub ASN `65515` are rejected.
3. Optionally enter **NVA BGP advertisements**, one `prefix ASN ASN ...` per line, beginning with the NVA ASN. Leave **Originated prefix** empty for a transit-only NVA. Spoke VNet address spaces remain system routes; advertisements do not establish IP ownership.
4. For end-to-end paths, add downstream sites with their actual owned prefixes. Right-click the NVA and use **Link to another site** to model downstream BGP/forwarding. Its hub peer advertises originated/learned routes by default. Explicit aggregates retain known downstream contributions and report aggregate holes.
5. Right-click the NVA for **BGP table**, **Learned routes**, **Advertised routes** or path commands. Hubs show a distinct **Spoke BGP NVA** origin. Animated paths traverse the hosting spoke, NVA and downstream links, including the independent return path. Edit or disable its **NVA BGP** connection to change/withdraw the peering.
6. On the hosting spoke, **Spoke connection route maps** edits hub-side VNet policies. These apply to its system routes and the advertisements of all NVAs in that spoke, not to an integrated SD-WAN connection. NVA-side router policies remain independent.

**Azure requirements and model boundary:** a peer must reside in a directly attached VNet and use an actual NIC IP, not a loopback. Azure requires identical advertisements to **both** hub router IPs; the app models these as **one logical peering**, not two independent failures. It assumes Default association/propagation, branch-to-branch enabled and reachable sessions. Secured hubs require Routing Intent. Azure supports at most eight BGP peers per hub and 4,000 advertised routes per NVA; native JSON remains bounded at 2 MB and routing analyses retain their existing budgets. The app does not configure or verify live sessions, UDRs, appliance/vendor forwarding, subnet membership, load-balancer next-hop overrides, dynamic convergence or shared failure domains. Advertisements contained in directly attached local VNet address spaces are suppressed in favor of their system routes.

The existing [controlled Azure lab](verification/azure-vwan-2026-10-29/README.md) includes real local/remote direct-spoke NVA endpoint deliveries, but is not certification of every new configuration or NVA ranking/failover case. See [Microsoft's BGP peering requirements and examples](https://learn.microsoft.com/azure/virtual-wan/scenario-bgp-peering-hub) and [routing deep dive](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive). Structural Azure import still **does not reconstruct BGP NVAs**; configure them manually after import. Bicep export still omits appliances, peers and downstream routing, with an explicit warning; it does not enable BGP in Azure.

### Public GitHub feedback repository (no OAuth consent required)

**Feedback** opens an accessible, optional form that prepares a pre-filled issue in the dedicated public feedback repository [`erjosito/vwan-visual-topology-feedback`](https://github.com/erjosito/vwan-visual-topology-feedback) without requiring Azure Static Web Apps OAuth app consent (`/.auth/login/github`). The simulator remains anonymous and local-first while the main application repository (`erjosito/vwan-visual-topology`) remains private.

The form previews exactly what is included in the pre-filled GitHub issue URL: category (`Bug`, `Feature request`, or `Other`), summary, description, target repository (`erjosito/vwan-visual-topology-feedback`), app revision, and a report reference (`FB-<uuid>`). No topology, network configuration, screenshots, browser logs, or storage contents are attached. Because the feedback repository is public, users must not include secrets, credentials, or confidential/customer data.

Drafts are stored only in the current tab's `sessionStorage` until the user opens the GitHub issue form or clicks **Discard draft**. Clicking **Open issue on GitHub** opens the pre-filled issue creation page (`https://github.com/erjosito/vwan-visual-topology-feedback/issues/new`) in a new tab and also provides a direct **Continue to GitHub issue form** link and a **Browse public feedback** link.

### Topology workflow

1. Right-click empty canvas to add a hub/site. Right-click a hub to add spokes or connect sites; right-click a site to add hub connections or on-premises BGP links. The toolbar also offers hub/site creation.
2. Right-click an object for **Edit configuration**, renaming or deletion. Routing intent is part of hub configuration; site configuration includes ASN and one or more optional originated prefixes.
3. Configure connection BGP learning (`learnSiteRoutes`) and default-route propagation (`propagateDefaultRoute`) in **Edit configuration** on the connection. Legacy connection-level `routes` fields in imported JSON are ignored (except legacy `kind: "vpn-static"` entries migrated to `site.vpnStaticRoutes`) and are never exported. For non-BGP S2S VPN routing, right-click the **site or hub → Static routing** (also under **Edit configuration → Configure static routing**), choose a VPN connection, enter the site's reachable prefixes, and save. **Static-only VPN** disables site-mesh BGP import on that connection.
4. Right-click a hub/site for **BGP table**, **Learned routes**, or **Advertised routes**. Adjust **Hub routing preference**, switch between the BGP, hub forwarding and firewall **Route view**, or click a BGP table prefix to compare candidate paths against the canvas. Filter prefixes by text; learned/advertised views additionally offer neighbor and before/after route-map filters.
5. To model on-premises transit, use **Link to another site** and configure directional prefix allowlists and prepends. `*` means all prefixes. Enable site-originated/learned-route import on the desired hub connections.
6. Right-click a **hub or site → Route maps**, or use **Edit configuration → Configure route maps**. Choose a connection, then its inbound/outbound maps relative to that router. A map can be shared across its router's connections; policies on the opposite endpoint remain independent. The toolbar/canvas entry offers a router selector. Deletion removes the map's assignments.
7. Hover **Show path to → destination → prefix** to highlight a path directly. **Show path from → source → prefix** uses prefixes belonging to the node you right-clicked, not the chosen source. Reachability appears on the canvas; **Path details** opens explanations only on request. Submenus also open by click/tap or Right Arrow; Left Arrow/Escape returns a level. Choose **Open path explorer** for custom IPv4 addresses. A selected prefix traces its network address, not every possible more-specific exception within it. Green links show preferred forwarding paths, including ECMP, on-premises transit and firewall traversal.
8. Move inspectors by dragging their header, or use **Left**/**Right**; resize with the corner handle on desktop. Close or press Escape without losing the topology. Use **Notes** for warnings, documentation and loading the example.

Hub icons display the hub name and region, not an AS path. **AS Path** in the hub configuration is a routing-preference option; it is not an AS path assigned to the hub. Actual AS paths appear on individual routes in the route tables.

Canvas hubs, spokes and ER locations use Microsoft's official **Virtual WAN Hub**, **Virtual Networks** and **ExpressRoute Circuits** icons, respectively, from the [Azure Architecture Center icon collection](https://learn.microsoft.com/azure/architecture/icons/) (V24). These SVGs in `src/assets/azure` are unchanged originals, displayed proportionally without recoloring. Secured hubs use the supplied **secured virtual hub reference image** (`secured-virtual-hub.png`), showing a red firewall surrounded by gray hub spokes, not the different Firewall Manager icon. This PNG is the user-provided reference; its original SVG source has not been independently verified. Microsoft permits copying, distributing and displaying its icons in architectural diagrams, training materials or documentation; all other rights are reserved by Microsoft.

### Azure files: offline import and Bicep export

Open **Azure files** in the header. All application processing stays in the browser; this feature adds no Azure sign-in, backend, SDK, account selector or deploy button. Ordinary native JSON import/export remains unchanged.

**Import:** download and review [`collect-azure-vwan.ps1`](https://github.com/erjosito/vwan-visual-topology-feedback/blob/main/scripts/collect-azure-vwan.ps1) from the app or the public repository, then run it with PowerShell 7 and an Azure CLI session authenticated **outside** this app (locally or in Cloud Shell PowerShell):

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/erjosito/vwan-visual-topology-feedback/main/scripts/collect-azure-vwan.ps1' -OutFile .\collect-azure-vwan.ps1
.\collect-azure-vwan.ps1 `
  -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' `
  -OutputFile .\vwan-capture.json
```

The configuration-only collector supports **one Standard Virtual WAN in public Azure**. It discovers hubs across resource groups in that WAN's subscription and reads their VNet references/address spaces, routing preferences, routing-intent policies and indicators of unsupported routing. Without `-IncludeEffectiveRoutes`, it uses only bounded `az rest` GET requests, with a 60-second timeout per attempt, at most three attempts, pagination/resource/request limits and a 2 MB v1 output cap. Existing output files require explicit `-Force`.

Reads require subscription-wide hub-list access plus read access to the selected WAN, its hubs/child resources and referenced VNets. Cross-subscription VNet reads are **off by default**; `-AllowCrossSubscriptionVnets` opts into reading only directly referenced VNets, never subscription enumeration. Denied child/VNet reads produce an explicitly incomplete capture; failed WAN/discovery reads abort rather than inventing an empty environment. Configuration-only collection does not request effective routes; neither mode exports tokens, keys, tunnel secrets or account user details.

Import the result with **Import Azure capture** or **Import JSON**. The app shows counts and omissions **before** replacement; acknowledgement and confirmation are required. Cancel/Escape, malformed captures and unsupported versions leave the workspace intact. Export its native JSON first if you need a backup. The versioned `azure-vwan-capture` format is intentionally **not** arbitrary ARM-template or Azure CLI JSON.

Imports create hubs and IPv4 spoke attachments with stable IDs derived from ARM IDs, and map `VpnGateway` to the simulator's `VPN` preference. Azure Firewall private/Internet routing intent is shown where recognized; no separate firewall site is fabricated. Sites, circuits, BGP advertisements/ASNs, subnet UDRs, firewall enforcement, route maps, custom propagation and observed effective routes are **not reconstructed**. Unsupported policies, custom routing, missing VNets and IPv6 omissions stay visible as **structure-only** limitations, not a promise of Azure-equivalent routing. Unknown hub preferences, Basic WANs, duplicate/ambiguous references, malformed prefixes and app-limit violations are rejected.

### Compare an existing design with Azure observations

Choose **Azure files → Compare with Azure capture**. Download the same collector,
review it, and opt into observational route queries:

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/erjosito/vwan-visual-topology-feedback/main/scripts/collect-azure-vwan.ps1' -OutFile .\collect-azure-vwan.ps1
.\collect-azure-vwan.ps1 `
  -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' `
  -IncludeEffectiveRoutes -OutputFile .\vwan-observation.json
```

The collector uses the existing local Azure CLI login, explicitly selects the
WAN subscription, and records its public-cloud/tenant/subscription context and
actual CLI version without account names or credentials. Route retrieval uses
`az network vhub get-effective-routes` for each discovered hub's Default table.
The CLI handles the underlying asynchronous diagnostic POST/polling operation;
the captured `apiVersion` field identifies this CLI operation, not a claimed
fixed REST API version. Metadata reads and
`Microsoft.Network/virtualHubs/effectiveRoutes/action` are required; Reader alone
may not suffice. No role assignments or Azure resources are changed.

Load the **v2 observation** in the comparison panel (8 MB maximum), not the
structure-replacement importer. The current design remains untouched. Hubs
auto-bind only through retained ARM IDs, and spokes through retained
ARM-derived IDs; manually designed objects require explicit mappings. Names
and regions never silently establish identity. Unknown objects stay in the
review list; they are not added as fictional sites or circuits.

Select one observed hub. Supported structural comparisons cover HRP,
recognized routing intent, spoke attachments and IPv4 address spaces. Route
comparison starts with **unsecured Default tables on both sides**, compares
selected forwarding routes rather than losing BGP candidates, and preserves
associated multiprefix/ECMP rows. Explicitly map gateway next hops to the
appropriate hub and VPN/ER class: these snapshots cannot distinguish individual
branch connections, circuits or gateway instances. Route origins are retained
as evidence, not certified against a different BGP boundary.

An Azure-only prefix is an observation, not automatically a fault. To identify
a missing expected route, enter its exact IPv4 prefix and confirm complete
expected design coverage; a structure-only import is not a full route baseline.
A covering aggregate is not an identical more-specific route. Optional AS-path
comparison preserves repeated, provider and inter-hub ASNs and normalizes only
formatting. Unsupported intent/custom routing, unknown next hops, denied/failed/
truncated observations, incomplete model selection and captures older than
24 hours or more than five minutes in the future remain unassessed.

**Differences / Designed and compared fields / Azure snapshot** views provide
prefix/status filters and source evidence. Selecting a result selects its known
affected node or connection without starting a flow animation. Editing routing
or mappings invalidates results; layout and language changes do not.

Observations/mappings stay **in page memory only**, separate from native topology
JSON and browser persistence; reload or **Remove comparison capture** discards
them. Keep the original local capture if needed. The optional report download
contains resource IDs, addresses, mappings and associated observed rows and must
be handled under your organization's data policies. It is not sent to Azure,
feedback or another backend. Native snapshot persistence and the optional
loopback refresh companion remain follow-ons; #3 is not fully completed.

Bounds are 10,000 rows/table, 20,000 captured rows and 8 MB v2 output; the
collector has finite per-action/overall/request budgets. The browser additionally
limits expanded prefix/next-hop work to 100,000 tuples, reports to 10,000 rows,
display to the first 200 filtered rows and report downloads to 16 MB. Exhausted
coverage is not a healthy result. This feature was validated with mocked CLI
responses, selected frozen lab response shapes, unit/browser regressions and
Chrome CDP, not new live Azure reads or packet tests.

Capture time, source WAN/hub IDs, imported infrastructure prefixes and limitations persist in a small validated `azureImport` field through browser reload and native JSON exchange. The persistent workspace banner identifies imported routes as simulations, not observed Azure effective routes. Captures/JSON contain resource names, IDs and network configuration: handle them according to your organization's data policies.

**Export:** review the WAN/hub deployment names, canonical Azure locations and a separate **infrastructure CIDR for every included hub**. Newly drawn hubs have no CIDR default; destination prefixes are never reused automatically. Imported infrastructure prefixes are suggestions requiring review. IPv4 network CIDRs must be /24 or larger (/23 or larger recommended) and must not overlap selected hubs or known spoke/site networks. Unknown display-region names require manual canonical input; actual Azure region availability, capacity and address ownership cannot be checked offline.

**Review Bicep export** shows the resources, complete generated text and explicit omission report. After acknowledging resources, exclusions and charges, **Download main.bicep** saves one self-contained resource-group-scoped file using Network API `2024-10-01`. It creates a **new Standard WAN and bare hubs**, maps all three routing preferences and defaults router minimum capacity to **2 RIUs** (editable in Bicep). Simulator changes invalidate an existing preview.

Secured hubs, assigned hub route maps and incompletely captured/unsupported hub routing are **blocked**, not silently downgraded. You can explicitly exclude those hubs and export the supported subset; exclusions are recorded in the preview and template comments. No VNet creation/attachments, ER resources, gateways, VPN/on-premises sites, NVAs, firewall/rule resources, route-map policies or observed routes are generated.

This is a **starter, not a lossless clone, reconciliation tool or deployment guarantee**. The app never deploys it. Review names against the intended target resource group, compile externally (`az bicep build --file main.bicep`), and run Azure what-if before any deployment; deployments incur charges even for empty hubs. Effective-route snapshots remain tracked in [#3](https://github.com/erjosito/vwan-visual-topology/issues/3); VNet attachments and secured-hub export remain in [#4](https://github.com/erjosito/vwan-visual-topology/issues/4).

### ExpressRoute locations

Use **+ ER location** (or right-click the canvas), then right-click the location to **Connect to hub** and **Connect to site**. Hubs/sites also offer **Connect to ER location**. A location can have multiple attachments to different hubs and sites. Each site attachment represents an independent private-peering circuit at that location; sharing a location does not enable circuit-to-circuit transit. This is a planning abstraction, not a model of every MSEE/router or physical circuit.

The site attachment advertises the site's originated/learned prefixes when `learnSiteRoutes` is enabled. The simulator adds provider ASN `12076` at the Azure boundary. Hub routing preference selects between these ER candidates and VPN/NVA/inter-hub alternatives. Existing direct site-to-hub ExpressRoute connections remain supported and retain their configuration. Legacy `erLinks[].routes` fields in imported JSON are ignored and omitted from exports.

Azure-to-ER advertisements show the **customer-side** AS path: provider `12076` followed by the public ASNs remaining after hub outbound policies. MSEE [removes private ASNs](https://learn.microsoft.com/azure/route-server/route-maps-scenario-prepend-routes#considerations) (`64512-65534` and `4200000000-4294967294`) before customer equipment receives them. Hub input paths and VPN exports retain their private ASNs; upstream MSEE/native gateway diagnostics describe a different boundary.

Right-click a location for its **BGP table**, **Learned routes** (from the attached routers), or **Advertised routes** (toward them). The BGP table groups learned candidates by prefix, shows each neighbor/attachment and AS path, and marks shortest-AS-path routes as preferred, retaining equal-cost ties and alternatives. Prefix text filtering and preferred next-hop highlighting work as on hubs/sites. These location-level best-path indicators summarize learned state; they do not enable new transit or override circuit export rules. The separate learned/advertised views filter by attachment and prefix; the location has no configurable route maps. Hubs export their selected local/remote VNet, VPN and NVA routes, subject to hub policies, but **do not export ER-learned routes** to any ER circuit. This includes ER routes learned through another hub or location, as described in [Microsoft's routing deep dive, scenario 2](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive#scenario-2-global-reach-and-hub-routing-preference). Default routes are not exported on these attachments. Two sites at the same ER location do not learn each other's ER prefixes.

Route maps remain hub/site attributes, assigned to their own ER attachment. Markers and rule inspectors work on the new links. Azure-to-site traces show the hub attachment, ER location and site circuit; site-origin traces use advertised Azure routes and highlight both ingress links. Disabling/deleting either attachment withdraws that path. Removing a location cascades to its attachments and policy assignments, not its hubs/sites. Import/export and per-layout positions include the new objects (`erLocations` / `erLinks`); older JSON remains compatible.

ExpressRoute Global Reach, shared-circuit hub-to-hub route reflection, redundant MSEE sessions, bandwidth, gateway limits and custom propagation are not modeled. In particular, connecting one location to several hubs does not simulate the shared-circuit reflection behavior in Microsoft's scenario 3. Routing intent continues to use the existing separate hub/firewall model; ER-to-ER firewall transit is not enabled.

### Editing directly from the diagram

Right-click a hub, spoke, site, hub connection, on-premises link or empty canvas for its contextual menu. Hubs/sites offer **BGP table**, **Learned routes**, **Advertised routes**, and **Route maps**; hubs also offer firewall routes when applicable. Hubs, spokes and sites offer both path commands. Connections offer configuration, enable/disable and deletion, not connection-level prefix lists, router policies or a router's BGP table. Shift+F10 opens the same menu; use arrow keys to navigate and Escape to dismiss. Left-click only selects an object; route/path highlighting requires an explicit action.

Drag any hub, spoke or site to reposition it without changing its configuration or routing. Focus a node and use **Alt+Arrow** to move it, or **Alt+Shift+Arrow** for larger steps. Switching visualization preserves each view's arrangement; **Reset layout** restores its automatic positions without changing the other view. Node positions and the active visualization survive reloads and JSON import/export. Secured hubs remain single hub nodes with the same identity and saved position.

The **Inspect router** selector switches between hubs, sites and ER locations. The hub BGP table shows post-inbound candidates before routing intent; separate hub/firewall forwarding views retain routing-intent entries. System and VPN-static entries are labeled. Site BGP tables combine Azure and on-premises candidates using the same best-path calculation as site-origin tracing. AS paths describe route advertisements, not hub or firewall identities.

On-premises nodes show their ASN and single assigned prefix. Sites without one are labeled explicitly; connection advertisements and explicit VPN static routes are not assumed to be locally assigned networks. Spokes still support multiple prefixes.

The version-1 JSON `sites[].prefixes` field remains an array for compatibility, but accepts at most one entry. Multi-prefix imports are rejected without replacing the current workspace or discarding networks; reduce the list explicitly before importing. If an old browser workspace contains multiple prefixes, the example opens with an error and a **Download original saved topology** recovery button. Download it before editing or closing the page.

Use **Edit configuration** to rename an object, set or clear an **optional diagram label** (`label`, up to 120 characters, rendered as a pill badge under the node on the canvas without affecting routing or diagnostics), or change its properties; existing IDs, relationships, advertisements and policies are preserved. In **Full Hybrid** and **Hub & Spoke-Only** modes, use the **Configure → Node Labels & Annotations** card (or the inline `Label` input when creating a VNet, vWAN Hub, ExpressRoute Location, or On-Premises Site) to edit node labels. Hub configuration includes routing intent. Spokes can be moved to another hub, and connections can be retargeted to existing hubs/sites. Invalid changes stay in the editor until corrected or canceled.

Use **+ Hub** or **+ Site** above the diagram, or the matching canvas menu commands. A connected site and its hub connection are created together, with site-prefix advertisements enabled. Hub-to-hub links remain automatic.

Use **Clear topology** in the header to start from scratch. Confirmation removes all objects, route maps, static prefixes and saved layout positions, resets zoom/view, and replaces the browser's saved workspace. Reloading keeps it empty; add a hub/site to begin again or import a backup.

**Delete** shows a confirmation, including dependent spokes/connections/links. Deleting a router removes its owned maps; deleting a connection removes its endpoint assignments but retains reusable maps. Deleting a hub keeps its on-premises sites. Export JSON first if you need a backup. Keyboard users can select objects with Enter/Space; modeless editors support Tab and Escape. Right-click a secured hub for **Show firewall routes**; hub/firewall route tables and path semantics are unchanged.

### Reusable route maps

Maps are named resources owned by exactly one hub (`hubId`) or on-premises site (`siteId`). Their assignments are attributes of that router: `routeMapAssignments: [{ connectionId, inboundMapId?, outboundMapId? }]`. Rules support exact/containing IPv4 matches and **Permit**, **Block/drop**, **Summarize** or **Prepend**, with continue/terminate processing. Unmatched routes are allowed. Summaries retain contributing destinations; holes remain unreachable. Azure summaries clear AS paths; site exports retain the originating router ASN.

**Inbound** means routes learned by the selected router; **outbound** means advertisements leaving it. Site outbound policies run before hub inbound policies. Hub outbound policies run before learning-site inbound policies. On-premises links support independent outbound/inbound policies at both ends, alongside their directional peer settings. Learned and advertised views default to **After** the selected router's corresponding route maps; select **Before** to inspect original prefixes and AS paths, including routes subsequently dropped, prepended or summarized. Neighbor/prefix filters remain selected when changing stages. These controls are inspection-only and never change policies or topology. Provider private-AS removal and inter-hub prepends occur in transit, outside these router-policy stages.

Purple **IN** and blue **OUT** filter marks appear separately for every assigned connection and direction, near the router that owns the policy. Leaders attach marks to their exact curves, including parallel VPN/ER and on-premises links. White-outlined arrows remain distinct from highlighted green links, pointing toward the owner for inbound advertisements and away for outbound advertisements. There are no aggregate node counts. Marks follow node movement, layout and zoom changes. Hover or keyboard-focus a mark for a scrollable preview of its exact map's ordered matches, actions, values and stop/continue behavior. The preview stays open while hovered; Escape dismisses it. Click or press Enter/Space for the persistent inspector. Disabled connections retain dashed marks and an inactive warning in their preview.

**Show route map rules** in a hub/site menu shows all its assignments, including exact/containing prefix matches, actions, summary prefixes, prepend ASNs and continue/stop processing. The inspector can filter by connection and direction; **Configure route maps** carries the selected connection into the editor. Unassigned resources and legacy peer-link prepend settings do not produce route-map marks.

Azure-side policies target ER/VPN BGP connections and VNet connections (including their spoke BGP NVA advertisements). The wizard rejects private ASNs (`64512-65534`), Azure-reserved `8074`, `8075`, `12076`, `65535` and 4-byte ASNs; the app also excludes the IANA AS_TRANS placeholder `23456`. Use your own public 2-byte ASN in production. Documentation ASNs **`64496-64511` are accepted for lab simulation**, including editing existing imports: they are [IANA-reserved for documentation](https://www.iana.org/assignments/iana-as-numbers-special-registry/), not production ASN guidance. [Microsoft's route-map limitations](https://learn.microsoft.com/azure/virtual-wan/route-maps-about#considerations-and-limitations) do **not explicitly ban that documentation range**; Azure acceptance has not been independently verified. This corrects the earlier wizard restriction, which was a conservative app policy rather than a proven Azure rejection. Valid ASNs may be repeated. Site policies can use private/32-bit ASNs, including site-side SD-WAN policies. The stricter **NVA peer ASN** restriction is different: Microsoft's BGP peering page explicitly excludes the IANA documentation range there. Azure-side integrated SD-WAN maps, inter-hub/P2S assignments, community/AS-path conditions and NAT are not modeled. Static VPN entries bypass BGP maps. Changing a connection's endpoints requires unassigning incompatible endpoint policies first.

Right-click an **IN/OUT route-map marker** and choose **Remove route map association** to unassign only that router, connection and direction. The other direction, associations on other connections, and the reusable map definition remain intact. Shift+F10 on a focused marker provides the same action.

Version-1 imports with legacy connection map references or embedded prepend rules are migrated into the hub's assignments, preserving IDs, directions and route behavior. New exports store references on routers, not connections. Legacy empty prepend lists remain compatible. The single-originated-prefix restriction described above still applies.

### Site-owned VPN static routing

For a guided conversion, right-click the **VPN connection** and select **Change to static routing** or **Change to BGP routing**. The command for the current routing mode is grayed out; mixed static/BGP routing enables both conversions. The wizard first configures destinations, then reviews every change before applying it. Cancel/Escape or Back makes no changes. It detects connection changes after review rather than overwriting them with a stale plan.

Destination suggestions use the site's assigned prefixes, existing static routes for that VPN, and learned site prefixes when enabled. Hub/spoke prefixes appear as source context, never as invented on-premises static destinations. Unknown destinations must be entered explicitly. Static conversion saves site-owned static routes and disables that VPN's BGP learning. BGP conversion removes only that VPN's site statics, adds selected destinations to the site's originated prefixes (`site.prefixes`), and enables BGP import (`learnSiteRoutes`) on the connection. Static routes have no old AS paths to restore.

Connection/node IDs, existing route IDs where possible, enabled state, route-map assignments, site ASN/prefix, other connections and layouts are retained. The data schema is unchanged. This converts the existing Azure-to-site model; it does not configure on-premises return static routes or tunnel endpoint IP addresses.

Non-BGP S2S VPN destinations are stored on sites as `vpnStaticRoutes: [{ id, prefix, connectionId }]`, not in a connection's BGP advertisements. The hub's **Static routing** inspector edits these same site attributes for its attached VPN connections; it does not create hub-table static overrides. Associations allow modeling different destination sets through different VPNs. Each connection supports up to 100 static prefixes; these can include transit destinations without changing the site's single originated prefix.

Static routes have no local AS path, bypass BGP policies, and withdraw when their VPN is down. Existing route selection, inter-hub propagation and forwarding semantics are unchanged. Static-only configuration removes that VPN's explicit BGP entries and disables site-originated/learned BGP import only after you select the option and save. BGP and static entries can otherwise coexist as a planning approximation. This configures Azure-to-site destinations only; separate on-premises return static routes are not modeled.

Legacy version-1 `connections[].routes` entries with `kind: "vpn-static"` migrate to the owning site's list, preserving IDs and VPN associations. Imports/exports round-trip the new fields. Deleting a VPN/hub removes dangling site static associations; incompatible site/transport changes are rejected until its static entries are removed or reassigned.

### Contextual path boundaries

Hub destinations use attached-spoke prefixes because hub address spaces are not configured in this model. A site with assigned prefixes offers those; otherwise its explicit connection advertisements are offered and may include transit destinations. The selected route can legitimately terminate at a different advertiser of the same prefix.

Site-origin paths evaluate received Azure advertisements and on-premises BGP together, including directional peer policies, shortest AS paths and loop checks. Outbound map changes influence this site-side view without reinjecting those routes into Azure's hub simulation. Forward and reverse paths are calculated independently; Azure reimport through site transit, generic SD-WAN outbound learning, host/firewall reachability and return-flow symmetry remain outside the model.

## Routing model and boundaries

This is **not** an Azure control-plane emulator or a guarantee of effective routes in a deployed network. Validate important designs against Azure effective routes and packet tests.

| Area | Model |
|---|---|
| Virtual WAN | One Standard VWAN; full-mesh inter-hub connectivity. Default association/propagation unless private routing intent manages it. |
| Route selection | Per-prefix best-path selection; forwarding uses longest-prefix match. AS Path preference compares full received lengths, including inter-hub prepends; a shorter remote ER path can win. Local paths break equal-length local/remote ties. Other HRPs retain their local/remote and ER/VPN distinctions. |
| Inter-hub advertisements | Only selected local best paths are advertised, with `65520 65520` prepended. No default-route propagation or remote-route re-export over the full mesh. Nonconvergent calculations are flagged and tracing is disabled. |
| Spokes | Directly attached IPv4 VNets. Local system routes override equal-prefix BGP routes. No subnet UDRs or Private Endpoint policies. |
| SD-WAN | Independent NVA source, **not** a VPN gateway. After the documented ER/VPN comparison, NVA candidates compete on AS path. Undocumented/vendor tie-breaks are not predicted and a warning is shown. |
| VPN static | Non-BGP site prefixes are imported as VPN routes with an empty local AS path. They can propagate inter-hub, but **do not** get hub-table static-route precedence. Gateway redistribution and static/BGP coexistence are approximations. Arbitrary static hub-table overrides are not modeled. |
| Private routing intent | Hub policy table contains RFC1918 aggregates plus configured private prefixes to Azure Firewall. Firewall table contains selected exact routes and an Internet fallback when no default is learned; that fallback does not install a hub default. Unknown RFC1918 destinations without a private forwarding route remain unreachable. Non-RFC1918 destinations require explicit private prefixes on each secured hub. |
| Internet routing intent | Hub default route to Azure Firewall, with direct Internet egress from the firewall. Forced tunneling and per-connection default-route advertisement switches are not modeled. |
| Firewalls | Forwarding only, assuming permissive policies. No allow/deny, DNAT, SNAT, threat inspection, or health simulation. |
| Spoke BGP NVA | Explicit hosting spoke, NIC peer IP, 2-byte ASN and advertisements. Bidirectional modeled BGP through the NVA and downstream site links; Default propagation, identical dual hub sessions and branch-to-branch enabled are assumed. Distinct from integrated SD-WAN; live sessions/UDRs/physical failover are not verified. |
| Route maps | Hub/site-owned, reusable policies assigned per endpoint and connection, including hosting-VNet maps for NVA advertisements/system routes. Prefix matching, permit/drop, summarize/prepend and continue/terminate. Independent site-peer policies; hub and site policies compose in advertisement order. No Azure-side SD-WAN, inter-hub/P2S, community/AS-path conditions or NAT. |
| Prepend ASNs | Hub wizard saves require valid public 2-byte ASNs and reject Azure-reserved, private, documentation, AS_TRANS and 4-byte ASNs. Legacy documentation ASNs `64496-64511` remain importable **for simulation only**. Site maps and on-premises peer policies can use private/32-bit ASNs. |
| On-premises BGP | Shortest AS path, exact-prefix directional export allowlists, ASN/path loop prevention, up to 32 equal paths per prefix. Explicit connection BGP routes and configured site prefixes are available to the mesh. |
| Azure outbound routes | Preview includes post-map advertisements. Azure-originated routes are **not reimported into Azure through the site mesh**. Azure community suppression, route reflection through shared ER circuits, and Global Reach are not simulated. |
| Timing | Deterministic nominal convergence only. Azure arrival-order race conditions, failback history, and convergence delays are not predicted. |
| Flow traces | Forward direction only, up to 128 equal-cost branches. No return-flow symmetry, gateway-instance hashing, BGP MED/local preference, custom route tables, IPv6, or multiple VWANs. |

The AS Path treatment of remote ER follows the controlled two-hub customer-MCR observations in [#10](https://github.com/erjosito/vwan-visual-topology/issues/10): remote ER4 beat local VPN10 after both arrival orders, with each input independently verified. Microsoft's HRP page contains a conflicting "remote ER last" note and a shorter-remote-ER example. The model follows the reproduced received-path comparison, not that unconditional exclusion; this is not a guarantee of every Azure topology or convergence history.

The single-file [routing logic and critique](ROUTING-LOGIC.md) documents the actual route-production, HRP, policy, advertisement and forwarding pipeline, including reproduced internal inconsistencies and unverified Azure assumptions.

The [complete Azure verification report](verification/azure-vwan-2026-10-29/README.md), its 212 sanitized evidence files, original hash manifest and editable diagrams are now included in this repository. [Import provenance](verification/azure-vwan-2026-10-29/IMPORT-PROVENANCE.md) identifies the exact unchanged upstream snapshot. These are historical scoped observations, not certification of every current feature.

See [Azure testing lessons](AZURE-TESTING-LESSONS.md) for experiment design, evidence boundaries, verification pitfalls, cost controls and safe cleanup. The browser workspace has no GitHub issue link because the source repository is private; no replacement feedback backend or authentication was added.

Supported topology import limits: 20 hubs, 60 spokes, 60 site/NVA routers, 120 hub connections, 120 on-premises links, 240 route maps, 20 rules per map, 100 BGP advertisements and 100 site static prefixes per ordinary hub connection, up to 4,000 explicit advertisements per spoke NVA peer (eight peers per hub), and 2 MB per native/configuration-only JSON file. Separate v2 observation files have the explicit 8 MB limit described above.

## Authoritative references

- [Virtual hub routing preference](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference)
- [Virtual WAN routing deep dive](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive)
- [Routing intent and routing policies](https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies)
- [Route maps and limitations](https://learn.microsoft.com/azure/virtual-wan/route-maps-about)
- [AS-path prepend configuration](https://learn.microsoft.com/azure/virtual-wan/route-maps-prepend-routes)

## Deployment

Hosted on Azure Static Web Apps **Standard**, with no always-on compute or database. The West Europe retail base price is **US$9/month** (approximately **EUR8.08/month** as checked November 2026), before taxes, with 100 GB/month included bandwidth per subscription and additional bandwidth billed separately. Domain registration/renewal and Azure DNS charges are separate. The same app serves `vwan-simulator.com`, `www.vwan-simulator.com`, and `aznet-simulator.com`, with managed HTTPS certificates and an Azure DNS apex alias for each root domain. Topology data stays in your browser; deploying the app does not create Virtual WAN resources.

The subscription-scope Bicep in `infra` creates only a tagged resource group and a Standard Static Web App. Custom domain bindings and DNS records are configured separately. Select your Azure subscription, review or override the names in `infra/main.parameters.json`, then preview and deploy:

```powershell
az login
az account set --subscription '<your-subscription-id>'
az deployment sub what-if --location westeurope --template-file .\infra\main.bicep --parameters '@infra\main.parameters.json' sessionId='<tracking-id>' deployedBy='<operator>'
az deployment sub create --name vwan-visual-topology --location westeurope --template-file .\infra\main.bicep --parameters '@infra\main.parameters.json' sessionId='<tracking-id>' deployedBy='<operator>'
```

Store the app's deployment token in the GitHub repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN`; never commit it. The `CI` workflow runs lint, unit tests, production build and Chromium tests, then deploys **those exact built assets** on `main` only. Pull requests cannot deploy. A manual workflow run can redeploy `main`.

To run the same browser tests against the deployed app instead of starting a local server:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://black-sea-0b65eb803.4.azurestaticapps.net'
npm run test:e2e
Remove-Item Env:\PLAYWRIGHT_BASE_URL
```

To remove this installation, first verify the group contains only the resources you intend to delete, then run `az group delete --name rg-vwan-visual-topology-dev-426b`. Deleting the group removes the hosted app; it does not delete exported topology files or browser storage.
