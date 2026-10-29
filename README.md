# Virtual WAN Topology Lab

A browser-based Azure Virtual WAN topology designer and **explainable planning simulator**. No Azure credentials, backend, database, or telemetry are needed to run it.

**Live app:** https://black-sea-0b65eb803.4.azurestaticapps.net

## Features

- Add virtual hubs, spoke VNets with IPv4 prefixes, and on-premises sites with editable ASNs and **one optional originated prefix** each. The site's ASN and prefix are visible on its node. Connections can still advertise multiple routes.
- Connect sites to hubs using ExpressRoute, S2S VPN, or integrated SD-WAN NVAs.
- Define per-connection BGP advertisements and received AS paths. Configure non-BGP VPN static prefixes as **site attributes**, associated with the relevant VPN connection and accessible from either endpoint. Disable connections to explore failures.
- Choose ExpressRoute, VPN, or AS Path routing preference independently per hub.
- Canvas-first workspace with **Layered topology** and **Network constellation** visuals, zoom, and right-click/keyboard creation and editing. Drag nodes to rearrange; links follow live. Positions are saved independently per view in browser storage and exported JSON. **Reset layout** restores only the active view. There is no permanent sidebar or prefix-filter dropdown.
- **Show BGP routes** on hubs and sites opens a movable, resizable, nonmodal canvas inspector. Compact prefix/reason headings group every candidate; the first column contains only `*` for preferred routes or is blank for alternatives. Preferred paths remain green, with every AS path visible. Click a heading prefix to highlight its paths.
- Enable private and/or Internet routing intent. Inspect **hub policy routes and firewall forwarding routes separately**, and see firewall traversal in flow traces.
- Connect on-premises sites with directional BGP export allowlists and AS-path prepends. Configure site ASNs and originated prefixes, then enable mesh route import on the desired hub connections.
- Create named, reusable route maps owned by a **hub or on-premises site**. Each router assigns its own inbound/outbound policies to specific connections; the two ends are independent. Policies support ordered prefix matching, blocking, summarization and ASN prepending.
- **IN / OUT marks** identify each mapped connection near its owning hub/site, with arrows showing advertisement direction. Click a mark to inspect that exact endpoint, connection and direction, or choose **Show route map rules** for the router's complete policy list.
- Hover **Show path to** / **Show path from** on hubs, sites and spokes, then choose an endpoint and prefix from cascading menus to highlight forwarding paths immediately. No inspector opens automatically; use **Path details** for per-hop explanations or **Open path explorer** for custom addresses.
- Save automatically in browser storage, and import/export validated, versioned JSON.
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
npm run build
npx playwright install chromium
npm run test:e2e
```

Production output is `dist`. The app uses relative asset URLs and can be served as static files. Browser storage is specific to the origin and device; export JSON before clearing storage or moving to a different URL. Exported files contain your topology and must be treated according to your organization's data policies.

## Working with the app

1. Right-click empty canvas to add a hub/site. Right-click a hub to add spokes or connect sites; right-click a site to add hub connections or on-premises BGP links. The toolbar also offers hub/site creation.
2. Right-click an object for **Edit configuration**, renaming or deletion. Routing intent is part of hub configuration; site configuration includes ASN and one optional originated prefix.
3. Right-click a connection for **Edit advertisements** (BGP only). Include provider ASNs such as `12076` in explicit ExpressRoute paths. For non-BGP S2S VPN routing, right-click the **site or hub → Static routing** (also under **Edit configuration → Configure static routing**), choose a VPN connection, enter the site's reachable prefixes, and save. **Static-only VPN** explicitly removes existing BGP advertisements and disables site-mesh BGP import on that connection.
4. Right-click a hub/site for **Show BGP routes**. Adjust **Hub routing preference**, switch hub/firewall **Route view**, or click a table prefix to compare candidate paths against the canvas.
5. To model on-premises transit, use **Link to another site** and configure directional prefix allowlists and prepends. `*` means all prefixes. Enable site-originated/learned-route import on the desired hub connections.
6. Right-click a **hub or site → Route maps**, or use **Edit configuration → Configure route maps**. Choose a connection, then its inbound/outbound maps relative to that router. A map can be shared across its router's connections; policies on the opposite endpoint remain independent. The toolbar/canvas entry offers a router selector. Deletion removes the map's assignments.
7. Hover **Show path to → destination → prefix** to highlight a path directly. **Show path from → source → prefix** uses prefixes belonging to the node you right-clicked, not the chosen source. Reachability appears on the canvas; **Path details** opens explanations only on request. Submenus also open by click/tap or Right Arrow; Left Arrow/Escape returns a level. Choose **Open path explorer** for custom IPv4 addresses. A selected prefix traces its network address, not every possible more-specific exception within it. Green links show preferred forwarding paths, including ECMP, on-premises transit and firewall traversal.
8. Move inspectors by dragging their header, or use **Left**/**Right**; resize with the corner handle on desktop. Close or press Escape without losing the topology. Use **Notes** for warnings, documentation and loading the example.

Hub icons display the hub name and region, not an AS path. **AS Path** in the hub configuration is a routing-preference option; it is not an AS path assigned to the hub. Actual AS paths appear on individual routes in the route tables.

Canvas hubs and spokes use Microsoft's official **Virtual WAN Hub** and **Virtual Networks** icons, respectively, from the [Azure Architecture Center icon collection](https://learn.microsoft.com/azure/architecture/icons/) (V24). The SVGs in `src/assets/azure` are unchanged originals, displayed proportionally without recoloring. Microsoft permits copying, distributing and displaying these icons in architectural diagrams, training materials or documentation; all other rights are reserved by Microsoft.

### Editing directly from the diagram

Right-click a hub, spoke, site, hub connection, on-premises link or empty canvas for its contextual menu. Hubs/sites offer **Show BGP routes** and **Route maps**; hubs also offer firewall routes when applicable. Hubs, spokes and sites offer both path commands. Connections offer configuration, advertisements, enable/disable and deletion, not router policies or a router's BGP table. Shift+F10 opens the same menu; use arrow keys to navigate and Escape to dismiss. Left-click selects objects and hub/site route highlighting.

Drag any hub, spoke or site to reposition it without changing its configuration or routing. Focus a node and use **Alt+Arrow** to move it, or **Alt+Shift+Arrow** for larger steps. Switching visualization preserves each view's arrangement; **Reset layout** restores its automatic positions without changing the other view. Node positions and the active visualization survive reloads and JSON import/export. Firewall icons move with their hub.

The **Inspect router** selector switches between hubs and sites. Hub views distinguish system, VPN-static and routing-intent entries from BGP candidates. AS paths describe route advertisements, not hub or firewall identities.

On-premises nodes show their ASN and single assigned prefix. Sites without one are labeled explicitly; connection advertisements and explicit VPN static routes are not assumed to be locally assigned networks. Spokes still support multiple prefixes.

The version-1 JSON `sites[].prefixes` field remains an array for compatibility, but accepts at most one entry. Multi-prefix imports are rejected without replacing the current workspace or discarding networks; reduce the list explicitly before importing. If an old browser workspace contains multiple prefixes, the example opens with an error and a **Download original saved topology** recovery button. Download it before editing or closing the page.

Use **Edit configuration** to rename an object or change its properties; existing IDs, relationships, advertisements and policies are preserved. Hub configuration includes routing intent. Spokes can be moved to another hub, and connections can be retargeted to existing hubs/sites. Invalid changes stay in the editor until corrected or canceled.

Use **+ Hub** or **+ Site** above the diagram, or the matching canvas menu commands. A connected site and its hub connection are created together, with site-prefix advertisements enabled. Hub-to-hub links remain automatic.

Use **Clear topology** in the header to start from scratch. Confirmation removes all objects, route maps, static prefixes and saved layout positions, resets zoom/view, and replaces the browser's saved workspace. Reloading keeps it empty; add a hub/site to begin again or import a backup.

**Delete** shows a confirmation, including dependent spokes/connections/links. Deleting a router removes its owned maps; deleting a connection removes its endpoint assignments but retains reusable maps. Deleting a hub keeps its on-premises sites. Export JSON first if you need a backup. Keyboard users can select objects with Enter/Space; modeless editors support Tab and Escape. Firewall icons select their hub.

### Reusable route maps

Maps are named resources owned by exactly one hub (`hubId`) or on-premises site (`siteId`). Their assignments are attributes of that router: `routeMapAssignments: [{ connectionId, inboundMapId?, outboundMapId? }]`. Rules support exact/containing IPv4 matches and **Permit**, **Block/drop**, **Summarize** or **Prepend**, with continue/terminate processing. Unmatched routes are allowed. Summaries retain contributing destinations; holes remain unreachable. Azure summaries clear AS paths; site exports retain the originating router ASN.

**Inbound** means routes received by the selected router; **outbound** means advertisements leaving it. Site outbound policies run before hub inbound policies. Hub outbound policies run before receiving-site inbound policies. On-premises links support independent outbound/inbound policies at both ends, alongside their existing directional peer settings. Site imports from Azure influence site-origin path tracing; the site BGP inspector remains the on-premises candidate table, not a combined Azure/on-premises table.

Purple **IN** and blue **OUT** marks appear separately for every assigned connection and direction, near the router that owns the policy. Leaders attach marks to their exact curves, including parallel VPN/ER and on-premises links. Arrows point toward the owner for inbound advertisements and away for outbound advertisements. There are no aggregate node counts. Marks follow node movement, layout and zoom changes. Hover for the owner, connection and map name; click or focus and press Enter/Space to inspect that specific assignment. Disabled connections retain dashed marks for configured, inactive policies.

**Show route map rules** in a hub/site menu shows all its assignments, including exact/containing prefix matches, actions, summary prefixes, prepend ASNs and continue/stop processing. The inspector can filter by connection and direction; **Configure route maps** carries the selected connection into the editor. Unassigned resources and legacy peer-link prepend settings do not produce route-map marks.

Azure-side policies target ER/VPN BGP connections and require public 2-byte prepend ASNs. Site policies can use private/32-bit ASNs, including site-side SD-WAN policies. Azure-side integrated SD-WAN maps, spoke/inter-hub/P2S assignments, community/AS-path conditions and NAT are not modeled. Static VPN entries bypass BGP maps. Changing a connection's endpoints requires unassigning incompatible endpoint policies first.

Version-1 imports with legacy connection map references or embedded prepend rules are migrated into the hub's assignments, preserving IDs, directions and route behavior. New exports store references on routers, not connections. Legacy empty prepend lists remain compatible. The single-originated-prefix restriction described above still applies.

### Site-owned VPN static routing

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
| Route selection | Per-prefix best-path selection; forwarding uses longest-prefix match. HRP follows the documented order, including local/remote distinctions and the remote-ER AS Path exception. |
| Inter-hub advertisements | Only selected local best paths are advertised, with `65520 65520` prepended. No default-route propagation or remote-route re-export over the full mesh. Nonconvergent calculations are flagged and tracing is disabled. |
| Spokes | Directly attached IPv4 VNets. Local system routes override equal-prefix BGP routes. No subnet UDRs or Private Endpoint policies. |
| SD-WAN | Independent NVA source, **not** a VPN gateway. After the documented ER/VPN comparison, NVA candidates compete on AS path. Undocumented/vendor tie-breaks are not predicted and a warning is shown. |
| VPN static | Non-BGP site prefixes are imported as VPN routes with an empty local AS path. They can propagate inter-hub, but **do not** get hub-table static-route precedence. Gateway redistribution and static/BGP coexistence are approximations. Arbitrary static hub-table overrides are not modeled. |
| Private routing intent | Hub policy table contains RFC1918 aggregates plus configured private prefixes to Azure Firewall. Firewall table contains selected exact forwarding routes. Non-RFC1918 destinations require explicit private prefixes on each secured hub. |
| Internet routing intent | Hub default route to Azure Firewall, with direct Internet egress from the firewall. Forced tunneling and per-connection default-route advertisement switches are not modeled. |
| Firewalls | Forwarding only, assuming permissive policies. No allow/deny, DNAT, SNAT, threat inspection, or health simulation. |
| Route maps | Hub/site-owned, reusable policies assigned per endpoint and connection. Prefix matching, permit/drop, summarize/prepend and continue/terminate. Independent site-peer policies; hub and site policies compose in advertisement order. No Azure-side SD-WAN, spoke/inter-hub/P2S, community/AS-path conditions or NAT. |
| Prepend ASNs | Hub maps require public 2-byte ASNs and reject Azure-reserved ASNs. Documentation ASNs `64496-64511` are accepted **for simulation only**. Site maps and on-premises peer policies can use private/32-bit ASNs. |
| On-premises BGP | Shortest AS path, exact-prefix directional export allowlists, ASN/path loop prevention, up to 32 equal paths per prefix. Explicit connection BGP routes and configured site prefixes are available to the mesh. |
| Azure outbound routes | Preview includes post-map advertisements. Azure-originated routes are **not reimported into Azure through the site mesh**. Azure community suppression, route reflection through shared ER circuits, and Global Reach are not simulated. |
| Timing | Deterministic nominal convergence only. Azure arrival-order race conditions, failback history, and convergence delays are not predicted. |
| Flow traces | Forward direction only, up to 128 equal-cost branches. No return-flow symmetry, gateway-instance hashing, BGP MED/local preference, custom route tables, IPv6, or multiple VWANs. |

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
