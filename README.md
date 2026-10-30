# Virtual WAN Topology Lab

A browser-based Azure Virtual WAN topology designer and **explainable planning simulator**. No Azure credentials, backend, database, or telemetry are needed to run it.

**Live app:** https://black-sea-0b65eb803.4.azurestaticapps.net

## Features

- Add virtual hubs, spoke VNets with IPv4 prefixes, and on-premises sites with editable ASNs and **one optional originated prefix** each. The site's ASN and prefix are visible on its node. Connections can still advertise multiple routes.
- Connect sites to hubs using ExpressRoute, S2S VPN, or integrated SD-WAN NVAs.
- Add **ER location** nodes with the official ExpressRoute icon and connect them to hubs and sites. Inspect per-attachment BGP advertisements and trace both physical links. Default ER-to-ER transit is blocked, including ER routes from remote hubs.
- Define per-connection BGP advertisements and learned AS paths. Configure non-BGP VPN static prefixes as **site attributes**, associated with the relevant VPN connection and accessible from either endpoint. Disable connections to explore failures.
- Right-click a VPN connection for **Change to static routing** / **Change to BGP routing**. A configure/review wizard seeds editable site-side destinations and changes connection advertisements, site statics and learning settings together. Mixed routing offers both conversions.
- Choose ExpressRoute, VPN, or AS Path routing preference independently per hub.
- Canvas-first workspace with **Layered topology** and **Network constellation** visuals, zoom, and right-click/keyboard creation and editing. Drag nodes to rearrange; links follow live. Positions are saved independently per view in browser storage and exported JSON. **Reset layout** restores only the active view. There is no permanent sidebar or prefix-filter dropdown.
- **+ / - zoom controls** synchronize with the percentage selector. The SVG viewport fills the available canvas without unusable side gutters, so nodes can be dragged to either side in both layouts.
- **BGP table**, **Learned routes**, and **Advertised routes** open distinct movable, resizable canvas inspectors. The BGP table groups candidates and marks preferred paths with `*`; click a prefix to highlight its paths. Every table supports a prefix text filter. Learned/advertised views also filter by neighbor and default to **After** inbound/outbound route maps, with a **Before** stage showing policy inputs, including subsequently dropped or summarized routes.
- Enable private and/or Internet routing intent. Inspect **hub policy routes and firewall forwarding routes separately**, and see firewall traversal in flow traces.
- Routing intent changes the hub itself into a **Secured virtual hub** on the canvas, without an extra firewall node or attachment. Either policy enables the secured icon; disabling both restores the normal hub. Firewall traversal highlights the secured hub and remains explicit in path details.
- **File issue** in the header opens this repository's new GitHub issue page in a separate tab, leaving the workspace unchanged. No topology data is attached automatically.
- Connect on-premises sites with directional BGP export allowlists and AS-path prepends. Configure site ASNs and originated prefixes, then enable mesh route import on the desired hub connections.
- Create named, reusable route maps owned by a **hub or on-premises site**. Each router assigns its own inbound/outbound policies to specific connections; the two ends are independent. Policies support ordered prefix matching, blocking, summarization and ASN prepending.
- **IN / OUT filter marks** identify each mapped connection near its owning hub/site, with contrasting, white-outlined arrows showing advertisement direction. Hover or focus a mark to preview the applied rules; click to inspect that exact endpoint, connection and direction, or choose **Show route map rules** for the router's complete policy list.
- Hover **Show path to** / **Show path from** on hubs, sites and spokes, then choose an endpoint and prefix from cascading menus to highlight forwarding paths immediately. No inspector opens automatically; use **Path details** for per-hop explanations or **Open path explorer** for custom addresses.
- **Show path to/from → All Azure VNets / All onprem sites / Everywhere** highlights grouped paths on hubs, sites and spokes. “To” traces from the selected node to that group's destination prefixes; “from” traces independently from each group member to the selected node's prefixes. Everywhere combines VNets and sites, excluding the selected node; hubs are not duplicated as copies of their spokes. **Path details** identifies each source, destination, prefix and unreachable result, retaining ECMP. Shared outgoing destination prefixes are traced once, but distinct incoming sources are never merged.
- Larger moving circles show traffic direction at a constant 200 screen pixels per second, following the actual curved links in order. Each distinct highlighted path has one circle; the next leaves its source only after the previous reaches its destination. Identical paths share one animation. Movement, layout, and zoom recalculate travel time; reduced-motion preferences retain static highlighting without animation.
- Save automatically in browser storage, and import/export validated, versioned JSON.
- **Azure files** imports a local, read-only Azure CLI capture after review and exports an offline Bicep starter for a new Standard WAN and selected unsecured hubs. No Azure authentication, SDK or deployment service is added to the app.
- **Clear topology** beside Export/Import starts an empty, saved workspace after confirmation. Cancel/Escape preserves the current topology; export first if you need a backup.
- Select any node or connection in the diagram to rename, edit or delete it. Add spokes and connected sites from a hub, or hub/BGP links from a site, without leaving the topology.

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

The collector integration tests require PowerShell 7 but use a mocked Azure CLI, with no Azure access. CI also compiles a representative generated Bicep file with Bicep **v0.40.2**, without authenticating or deploying.

## Working with the app

1. Right-click empty canvas to add a hub/site. Right-click a hub to add spokes or connect sites; right-click a site to add hub connections or on-premises BGP links. The toolbar also offers hub/site creation.
2. Right-click an object for **Edit configuration**, renaming or deletion. Routing intent is part of hub configuration; site configuration includes ASN and one optional originated prefix.
3. Right-click a connection for **Edit advertisements** (BGP only). Include provider ASNs such as `12076` in explicit ExpressRoute paths. For non-BGP S2S VPN routing, right-click the **site or hub → Static routing** (also under **Edit configuration → Configure static routing**), choose a VPN connection, enter the site's reachable prefixes, and save. **Static-only VPN** explicitly removes existing BGP advertisements and disables site-mesh BGP import on that connection.
4. Right-click a hub/site for **BGP table**, **Learned routes**, or **Advertised routes**. Adjust **Hub routing preference**, switch between the BGP, hub forwarding and firewall **Route view**, or click a BGP table prefix to compare candidate paths against the canvas. Filter prefixes by text; learned/advertised views additionally offer neighbor and before/after route-map filters.
5. To model on-premises transit, use **Link to another site** and configure directional prefix allowlists and prepends. `*` means all prefixes. Enable site-originated/learned-route import on the desired hub connections.
6. Right-click a **hub or site → Route maps**, or use **Edit configuration → Configure route maps**. Choose a connection, then its inbound/outbound maps relative to that router. A map can be shared across its router's connections; policies on the opposite endpoint remain independent. The toolbar/canvas entry offers a router selector. Deletion removes the map's assignments.
7. Hover **Show path to → destination → prefix** to highlight a path directly. **Show path from → source → prefix** uses prefixes belonging to the node you right-clicked, not the chosen source. Reachability appears on the canvas; **Path details** opens explanations only on request. Submenus also open by click/tap or Right Arrow; Left Arrow/Escape returns a level. Choose **Open path explorer** for custom IPv4 addresses. A selected prefix traces its network address, not every possible more-specific exception within it. Green links show preferred forwarding paths, including ECMP, on-premises transit and firewall traversal.
8. Move inspectors by dragging their header, or use **Left**/**Right**; resize with the corner handle on desktop. Close or press Escape without losing the topology. Use **Notes** for warnings, documentation and loading the example.

Hub icons display the hub name and region, not an AS path. **AS Path** in the hub configuration is a routing-preference option; it is not an AS path assigned to the hub. Actual AS paths appear on individual routes in the route tables.

Canvas hubs, spokes and ER locations use Microsoft's official **Virtual WAN Hub**, **Virtual Networks** and **ExpressRoute Circuits** icons, respectively, from the [Azure Architecture Center icon collection](https://learn.microsoft.com/azure/architecture/icons/) (V24). These SVGs in `src/assets/azure` are unchanged originals, displayed proportionally without recoloring. Secured hubs use the supplied **secured virtual hub reference image** (`secured-virtual-hub.png`), showing a red firewall surrounded by gray hub spokes, not the different Firewall Manager icon. This PNG is the user-provided reference; its original SVG source has not been independently verified. Microsoft permits copying, distributing and displaying its icons in architectural diagrams, training materials or documentation; all other rights are reserved by Microsoft.

### Azure files: offline import and Bicep export

Open **Azure files** in the header. All application processing stays in the browser; this feature adds no Azure sign-in, backend, SDK, account selector or deploy button. Ordinary native JSON import/export remains unchanged.

**Import:** download and review `collect-azure-vwan.ps1`, then run it with PowerShell 7 and an Azure CLI session authenticated **outside** this app (locally or in Cloud Shell PowerShell):

```powershell
.\collect-azure-vwan.ps1 `
  -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' `
  -OutputFile .\vwan-capture.json
```

The collector supports **one Standard Virtual WAN in public Azure**. It discovers hubs across resource groups in that WAN's subscription and reads their VNet references/address spaces, routing preferences, routing-intent policies and indicators of unsupported routing. It uses only bounded `az rest` GET requests, with a 60-second timeout per attempt, at most three attempts, pagination/resource/request limits and a 2 MB output cap. Existing output files require explicit `-Force`.

Reads require subscription-wide hub-list access plus read access to the selected WAN, its hubs/child resources and referenced VNets. Cross-subscription VNet reads are **off by default**; `-AllowCrossSubscriptionVnets` opts into reading only directly referenced VNets, never subscription enumeration. Denied child/VNet reads produce an explicitly incomplete capture; failed WAN/discovery reads abort rather than inventing an empty environment. The collector does not request tokens, keys, tunnel secrets or effective routes, and only allowlisted configuration fields are written.

Import the result with **Import Azure capture** or **Import JSON**. The app shows counts and omissions **before** replacement; acknowledgement and confirmation are required. Cancel/Escape, malformed captures and unsupported versions leave the workspace intact. Export its native JSON first if you need a backup. The versioned `azure-vwan-capture` format is intentionally **not** arbitrary ARM-template or Azure CLI JSON.

Imports create hubs and IPv4 spoke attachments with stable IDs derived from ARM IDs, and map `VpnGateway` to the simulator's `VPN` preference. Azure Firewall private/Internet routing intent is shown where recognized; no separate firewall site is fabricated. Sites, circuits, BGP advertisements/ASNs, subnet UDRs, firewall enforcement, route maps, custom propagation and observed effective routes are **not reconstructed**. Unsupported policies, custom routing, missing VNets and IPv6 omissions stay visible as **structure-only** limitations, not a promise of Azure-equivalent routing. Unknown hub preferences, Basic WANs, duplicate/ambiguous references, malformed prefixes and app-limit violations are rejected.

Capture time, source WAN/hub IDs, imported infrastructure prefixes and limitations persist in a small validated `azureImport` field through browser reload and native JSON exchange. The persistent workspace banner identifies imported routes as simulations, not observed Azure effective routes. Captures/JSON contain resource names, IDs and network configuration: handle them according to your organization's data policies.

**Export:** review the WAN/hub deployment names, canonical Azure locations and a separate **infrastructure CIDR for every included hub**. Newly drawn hubs have no CIDR default; destination prefixes are never reused automatically. Imported infrastructure prefixes are suggestions requiring review. IPv4 network CIDRs must be /24 or larger (/23 or larger recommended) and must not overlap selected hubs or known spoke/site networks. Unknown display-region names require manual canonical input; actual Azure region availability, capacity and address ownership cannot be checked offline.

**Review Bicep export** shows the resources, complete generated text and explicit omission report. After acknowledging resources, exclusions and charges, **Download main.bicep** saves one self-contained resource-group-scoped file using Network API `2024-10-01`. It creates a **new Standard WAN and bare hubs**, maps all three routing preferences and defaults router minimum capacity to **2 RIUs** (editable in Bicep). Simulator changes invalidate an existing preview.

Secured hubs, assigned hub route maps and incompletely captured/unsupported hub routing are **blocked**, not silently downgraded. You can explicitly exclude those hubs and export the supported subset; exclusions are recorded in the preview and template comments. No VNet creation/attachments, ER resources, gateways, VPN/on-premises sites, NVAs, firewall/rule resources, route-map policies or observed routes are generated.

This is a **starter, not a lossless clone, reconciliation tool or deployment guarantee**. The app never deploys it. Review names against the intended target resource group, compile externally (`az bicep build --file main.bicep`), and run Azure what-if before any deployment; deployments incur charges even for empty hubs. Effective-route snapshots remain tracked in [#3](https://github.com/erjosito/vwan-visual-topology/issues/3); VNet attachments and secured-hub export remain in [#4](https://github.com/erjosito/vwan-visual-topology/issues/4).

### ExpressRoute locations

Use **+ ER location** (or right-click the canvas), then right-click the location to **Connect to hub** and **Connect to site**. Hubs/sites also offer **Connect to ER location**. A location can have multiple attachments to different hubs and sites. Each site attachment represents an independent private-peering circuit at that location; sharing a location does not enable circuit-to-circuit transit. This is a planning abstraction, not a model of every MSEE/router or physical circuit.

The site attachment advertises the site's originated/learned prefixes by default. **Edit configuration** also accepts optional explicit BGP advertisements, one `prefix ASN ASN ...` per line. Enter the site-side AS path; the simulator adds provider ASN `12076` at the Azure boundary. Hub routing preference selects between these ER candidates and VPN/NVA/inter-hub alternatives. Existing direct site-to-hub ExpressRoute connections remain supported and retain their configuration.

Azure-to-ER advertisements show the **customer-side** AS path: provider `12076` followed by the public ASNs remaining after hub outbound policies. MSEE [removes private ASNs](https://learn.microsoft.com/azure/route-server/route-maps-scenario-prepend-routes#considerations) (`64512-65534` and `4200000000-4294967294`) before customer equipment receives them. Hub input paths and VPN exports retain their private ASNs; upstream MSEE/native gateway diagnostics describe a different boundary.

Right-click a location for its **BGP table**, **Learned routes** (from the attached routers), or **Advertised routes** (toward them). The BGP table groups learned candidates by prefix, shows each neighbor/attachment and AS path, and marks shortest-AS-path routes as preferred, retaining equal-cost ties and alternatives. Prefix text filtering and preferred next-hop highlighting work as on hubs/sites. These location-level best-path indicators summarize learned state; they do not enable new transit or override circuit export rules. The separate learned/advertised views filter by attachment and prefix; the location has no configurable route maps. Hubs export their selected local/remote VNet, VPN and NVA routes, subject to hub policies, but **do not export ER-learned routes** to any ER circuit. This includes ER routes learned through another hub or location, as described in [Microsoft's routing deep dive, scenario 2](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive#scenario-2-global-reach-and-hub-routing-preference). Default routes are not exported on these attachments. Two sites at the same ER location do not learn each other's ER prefixes.

Route maps remain hub/site attributes, assigned to their own ER attachment. Markers and rule inspectors work on the new links. Azure-to-site traces show the hub attachment, ER location and site circuit; site-origin traces use advertised Azure routes and highlight both ingress links. Disabling/deleting either attachment withdraws that path. Removing a location cascades to its attachments and policy assignments, not its hubs/sites. Import/export and per-layout positions include the new objects (`erLocations` / `erLinks`); older JSON remains compatible.

ExpressRoute Global Reach, shared-circuit hub-to-hub route reflection, redundant MSEE sessions, bandwidth, gateway limits and custom propagation are not modeled. In particular, connecting one location to several hubs does not simulate the shared-circuit reflection behavior in Microsoft's scenario 3. Routing intent continues to use the existing separate hub/firewall model; ER-to-ER firewall transit is not enabled.

### Editing directly from the diagram

Right-click a hub, spoke, site, hub connection, on-premises link or empty canvas for its contextual menu. Hubs/sites offer **BGP table**, **Learned routes**, **Advertised routes**, and **Route maps**; hubs also offer firewall routes when applicable. Hubs, spokes and sites offer both path commands. Connections offer configuration, advertisements, enable/disable and deletion, not router policies or a router's BGP table. Shift+F10 opens the same menu; use arrow keys to navigate and Escape to dismiss. Left-click selects objects and hub/site route highlighting.

Drag any hub, spoke or site to reposition it without changing its configuration or routing. Focus a node and use **Alt+Arrow** to move it, or **Alt+Shift+Arrow** for larger steps. Switching visualization preserves each view's arrangement; **Reset layout** restores its automatic positions without changing the other view. Node positions and the active visualization survive reloads and JSON import/export. Secured hubs remain single hub nodes with the same identity and saved position.

The **Inspect router** selector switches between hubs, sites and ER locations. The hub BGP table shows post-inbound candidates before routing intent; separate hub/firewall forwarding views retain routing-intent entries. System and VPN-static entries are labeled. Site BGP tables combine Azure and on-premises candidates using the same best-path calculation as site-origin tracing. AS paths describe route advertisements, not hub or firewall identities.

On-premises nodes show their ASN and single assigned prefix. Sites without one are labeled explicitly; connection advertisements and explicit VPN static routes are not assumed to be locally assigned networks. Spokes still support multiple prefixes.

The version-1 JSON `sites[].prefixes` field remains an array for compatibility, but accepts at most one entry. Multi-prefix imports are rejected without replacing the current workspace or discarding networks; reduce the list explicitly before importing. If an old browser workspace contains multiple prefixes, the example opens with an error and a **Download original saved topology** recovery button. Download it before editing or closing the page.

Use **Edit configuration** to rename an object or change its properties; existing IDs, relationships, advertisements and policies are preserved. Hub configuration includes routing intent. Spokes can be moved to another hub, and connections can be retargeted to existing hubs/sites. Invalid changes stay in the editor until corrected or canceled.

Use **+ Hub** or **+ Site** above the diagram, or the matching canvas menu commands. A connected site and its hub connection are created together, with site-prefix advertisements enabled. Hub-to-hub links remain automatic.

Use **Clear topology** in the header to start from scratch. Confirmation removes all objects, route maps, static prefixes and saved layout positions, resets zoom/view, and replaces the browser's saved workspace. Reloading keeps it empty; add a hub/site to begin again or import a backup.

**Delete** shows a confirmation, including dependent spokes/connections/links. Deleting a router removes its owned maps; deleting a connection removes its endpoint assignments but retains reusable maps. Deleting a hub keeps its on-premises sites. Export JSON first if you need a backup. Keyboard users can select objects with Enter/Space; modeless editors support Tab and Escape. Right-click a secured hub for **Show firewall routes**; hub/firewall route tables and path semantics are unchanged.

### Reusable route maps

Maps are named resources owned by exactly one hub (`hubId`) or on-premises site (`siteId`). Their assignments are attributes of that router: `routeMapAssignments: [{ connectionId, inboundMapId?, outboundMapId? }]`. Rules support exact/containing IPv4 matches and **Permit**, **Block/drop**, **Summarize** or **Prepend**, with continue/terminate processing. Unmatched routes are allowed. Summaries retain contributing destinations; holes remain unreachable. Azure summaries clear AS paths; site exports retain the originating router ASN.

**Inbound** means routes learned by the selected router; **outbound** means advertisements leaving it. Site outbound policies run before hub inbound policies. Hub outbound policies run before learning-site inbound policies. On-premises links support independent outbound/inbound policies at both ends, alongside their directional peer settings. Learned and advertised views default to **After** the selected router's corresponding route maps; select **Before** to inspect original prefixes and AS paths, including routes subsequently dropped, prepended or summarized. Neighbor/prefix filters remain selected when changing stages. These controls are inspection-only and never change policies or topology. Provider private-AS removal and inter-hub prepends occur in transit, outside these router-policy stages.

Purple **IN** and blue **OUT** filter marks appear separately for every assigned connection and direction, near the router that owns the policy. Leaders attach marks to their exact curves, including parallel VPN/ER and on-premises links. White-outlined arrows remain distinct from highlighted green links, pointing toward the owner for inbound advertisements and away for outbound advertisements. There are no aggregate node counts. Marks follow node movement, layout and zoom changes. Hover or keyboard-focus a mark for a scrollable preview of its exact map's ordered matches, actions, values and stop/continue behavior. The preview stays open while hovered; Escape dismisses it. Click or press Enter/Space for the persistent inspector. Disabled connections retain dashed marks and an inactive warning in their preview.

**Show route map rules** in a hub/site menu shows all its assignments, including exact/containing prefix matches, actions, summary prefixes, prepend ASNs and continue/stop processing. The inspector can filter by connection and direction; **Configure route maps** carries the selected connection into the editor. Unassigned resources and legacy peer-link prepend settings do not produce route-map marks.

Azure-side policies target ER/VPN BGP connections and require public 2-byte prepend ASNs. Site policies can use private/32-bit ASNs, including site-side SD-WAN policies. Azure-side integrated SD-WAN maps, spoke/inter-hub/P2S assignments, community/AS-path conditions and NAT are not modeled. Static VPN entries bypass BGP maps. Changing a connection's endpoints requires unassigning incompatible endpoint policies first.

Version-1 imports with legacy connection map references or embedded prepend rules are migrated into the hub's assignments, preserving IDs, directions and route behavior. New exports store references on routers, not connections. Legacy empty prepend lists remain compatible. The single-originated-prefix restriction described above still applies.

### Site-owned VPN static routing

For a guided conversion, right-click the **VPN connection** and select **Change to static routing** or **Change to BGP routing**. The command for the current routing mode is grayed out; mixed static/BGP routing enables both conversions. The wizard first configures destinations, then reviews every change before applying it. Cancel/Escape or Back makes no changes. It detects connection changes after review rather than overwriting them with a stale plan.

Destination suggestions use the site's assigned prefix, existing advertisements/static routes for that VPN, and learned site prefixes when enabled. Hub/spoke prefixes appear as source context, never as invented on-premises static destinations. Unknown destinations must be entered explicitly. Static conversion saves site-owned routes and clears that VPN's BGP advertisements/learning. BGP conversion removes only that VPN's site statics and creates editable BGP advertisements, initially using the site's ASN for former static destinations; optional site-originated/learned import is configurable. Static routes have no old AS paths to restore.

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
| Route maps | Hub/site-owned, reusable policies assigned per endpoint and connection. Prefix matching, permit/drop, summarize/prepend and continue/terminate. Independent site-peer policies; hub and site policies compose in advertisement order. No Azure-side SD-WAN, spoke/inter-hub/P2S, community/AS-path conditions or NAT. |
| Prepend ASNs | Hub maps require public 2-byte ASNs and reject Azure-reserved ASNs. Documentation ASNs `64496-64511` are accepted **for simulation only**. Site maps and on-premises peer policies can use private/32-bit ASNs. |
| On-premises BGP | Shortest AS path, exact-prefix directional export allowlists, ASN/path loop prevention, up to 32 equal paths per prefix. Explicit connection BGP routes and configured site prefixes are available to the mesh. |
| Azure outbound routes | Preview includes post-map advertisements. Azure-originated routes are **not reimported into Azure through the site mesh**. Azure community suppression, route reflection through shared ER circuits, and Global Reach are not simulated. |
| Timing | Deterministic nominal convergence only. Azure arrival-order race conditions, failback history, and convergence delays are not predicted. |
| Flow traces | Forward direction only, up to 128 equal-cost branches. No return-flow symmetry, gateway-instance hashing, BGP MED/local preference, custom route tables, IPv6, or multiple VWANs. |

The AS Path treatment of remote ER follows the controlled two-hub customer-MCR observations in [#10](https://github.com/erjosito/vwan-visual-topology/issues/10): remote ER4 beat local VPN10 after both arrival orders, with each input independently verified. Microsoft's HRP page contains a conflicting "remote ER last" note and a shorter-remote-ER example. The model follows the reproduced received-path comparison, not that unconditional exclusion; this is not a guarantee of every Azure topology or convergence history.

See [Azure testing lessons](AZURE-TESTING-LESSONS.md) for experiment design, evidence boundaries, verification pitfalls, cost controls and safe cleanup.

Supported import limits: 20 hubs, 60 spokes, 60 sites, 120 hub connections, 120 on-premises links, 240 route maps, 20 rules per map, 100 BGP advertisements and 100 site static prefixes per hub connection, and 2 MB per JSON file.

## Authoritative references

- [Virtual hub routing preference](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference)
- [Virtual WAN routing deep dive](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive)
- [Routing intent and routing policies](https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies)
- [Route maps and limitations](https://learn.microsoft.com/azure/virtual-wan/route-maps-about)
- [AS-path prepend configuration](https://learn.microsoft.com/azure/virtual-wan/route-maps-prepend-routes)

## Deployment

Hosted on Azure Static Web Apps **Free**, with no always-on compute or database: **$0/month within Free-tier limits**. Free is not a production SLA tier. Topology data stays in your browser; deploying the app does not create Virtual WAN resources.

The subscription-scope Bicep in `infra` creates only a tagged resource group and a Free Static Web App. Select your Azure subscription, review or override the names in `infra/main.parameters.json`, then preview and deploy:

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
