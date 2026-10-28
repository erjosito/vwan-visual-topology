# Virtual WAN Topology Lab

A browser-based Azure Virtual WAN topology designer and **explainable planning simulator**. No Azure credentials, backend, database, or telemetry are needed to run it.

**Live app:** https://black-sea-0b65eb803.4.azurestaticapps.net

## Features

- Add virtual hubs, spoke VNets with IPv4 prefixes, and on-premises sites with editable ASNs and multiple originated prefixes. Enter site prefixes one per line, or separate them with commas/spaces. Site ASNs are visible in the diagram and sidebar.
- Connect sites to hubs using ExpressRoute, S2S VPN, or integrated SD-WAN NVAs.
- Define per-connection BGP advertisements and received AS paths, or VPN site static prefixes. Disable connections to explore failures.
- Choose ExpressRoute, VPN, or AS Path routing preference independently per hub.
- Click hubs and prefixes to highlight preferred links in green. **Show BGP routes** is available on hubs and on-premises sites, not connections or spokes. Route views show every candidate as a separate row, with preferred paths marked `*` in green, visible alternatives, AS paths and selection explanations. All equal-cost preferred paths are marked.
- Enable private and/or Internet routing intent. Inspect **hub policy routes and firewall forwarding routes separately**, and see firewall traversal in flow traces.
- Connect on-premises sites with directional BGP export allowlists and AS-path prepends. Configure site ASNs and originated prefixes, then enable mesh route import on the desired hub connections.
- Apply inbound and outbound, first-match AS-path prepend route maps to supported Azure BGP connections. Preview outbound advertisements without confusing them with Azure best paths.
- Trace IPv4 flows from a hub or attached spoke, with longest-prefix matching and per-hop explanations.
- Save automatically in browser storage, and import/export validated, versioned JSON.
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

1. Use **Hubs**, **Spokes**, **Sites**, and **Links** to construct the topology.
2. Select a link in the diagram or editor to change its advertised prefixes and received AS paths. Include provider ASNs such as `12076` in explicit ExpressRoute paths.
3. Click a hub, select a highlight prefix, and adjust **Hub routing preference** to compare paths.
4. Select a hub and click **Edit hub** (or **Routing intent**) to configure private/Internet intent and additional private prefixes as hub attributes. Use **Route view** to switch between the hub and Azure Firewall.
5. To model on-premises transit, add site prefixes and BGP links under **On-premises sites & BGP links**. Export allowlists match exact prefixes; `*` means all. On the ingress hub connection, enable **Advertise site-originated and learned on-premises routes**.
6. Right-click a supported connection (or select it and choose **Route maps**) to add inbound/outbound prepend rules in the diagram's editor. Prefix match modes are `Equals` and `Contains`; rules terminate on the first match, while unmatched routes pass unchanged.
7. Enter a destination IPv4 address and **Trace flow**. Green links show the modeled forwarding path; multiple equal paths are displayed rather than inventing a traffic hash.

Hub icons display the hub name and region, not an AS path. **AS Path** in the hub configuration is a routing-preference option; it is not an AS path assigned to the hub. Actual AS paths appear on individual routes in the route tables.

### Editing directly from the diagram

Right-click a hub, spoke, site, hub connection or on-premises link for its contextual menu. Hubs offer **Edit configuration**, **Show BGP routes**, firewall routes when applicable, creation actions and deletion. Sites also offer **Show BGP routes**, showing originated and learned candidates with their next hops and AS paths. Connections offer configuration, **Route maps**, advertisements and deletion, not a router's BGP table. Shift+F10 opens the same menu; use arrow keys to navigate and Escape to dismiss. Left-clicking still shows actions above the diagram and preserves hub route highlighting.

The **Inspect router** selector switches between hubs and sites. Hub views retain clearly labeled system, VPN-static and routing-intent entries alongside BGP candidates so that routing intent remains explainable; these entries do not have BGP AS paths.

On-premises nodes show their ASN and assigned-prefix summary, just like spoke prefix summaries: the first prefix followed by `+N` for additional prefixes. Hover over the node for the complete list. Sites without assigned prefixes are labeled explicitly; connection advertisements are not assumed to be locally assigned networks.

Use **Edit configuration** to rename an object or change its properties; existing IDs, relationships, advertisements and policies are preserved. Hub configuration includes routing intent, also summarized in the sidebar's hub cards. Spokes can be moved to another hub, and connections can be retargeted to existing hubs/sites. Invalid changes stay in the editor until corrected or canceled.

Use **+ Add hub** or **+ Add site** above the diagram, or select a hub for **+ Add spoke**, **+ Add connected site** and **+ Connect existing site**. A connected site and its hub connection are created together, with site-prefix advertisements enabled. Select a site for **+ Connect to hub** or **+ Link to another site**. Hub-to-hub links remain automatic.

**Delete** shows a confirmation, including the dependent spokes/connections/links that will also be removed. Deleting a hub keeps its on-premises sites. Export JSON first if you need an undo/backup. Keyboard users can select diagram objects with Enter/Space; the editor supports Tab and Escape. Firewall icons select their hub; routing intent is part of that hub's attributes, not a separate topology object.

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
| Route maps | Ordered prefix-match AS-path prepends only. Inbound applies before hub selection; outbound applies after selection, solely to advertisements. Azure maps are rejected on integrated SD-WAN NVA branch links. |
| Prepend ASNs | Azure maps require public 2-byte ASNs and reject Azure-reserved ASNs. Documentation ASNs `64496-64511` are accepted **for simulation only**. On-premises export prepends can use private/32-bit ASNs. |
| On-premises BGP | Shortest AS path, exact-prefix directional export allowlists, ASN/path loop prevention, up to 32 equal paths per prefix. Explicit connection BGP routes and configured site prefixes are available to the mesh. |
| Azure outbound routes | Preview includes post-map advertisements. Azure-originated routes are **not reimported into Azure through the site mesh**. Azure community suppression, route reflection through shared ER circuits, and Global Reach are not simulated. |
| Timing | Deterministic nominal convergence only. Azure arrival-order race conditions, failback history, and convergence delays are not predicted. |
| Flow traces | Forward direction only, up to 128 equal-cost branches. No return-flow symmetry, gateway-instance hashing, BGP MED/local preference, custom route tables, IPv6, or multiple VWANs. |

Supported import limits: 20 hubs, 60 spokes, 60 sites, 120 hub connections, 120 on-premises links, 100 advertisements per hub connection, and 2 MB per JSON file.

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
