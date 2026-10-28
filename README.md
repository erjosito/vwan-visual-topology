# Virtual WAN Topology Lab

A browser-based Azure Virtual WAN topology designer and **explainable planning simulator**. No Azure credentials, backend, database, or telemetry are needed to run it.

## Features

- Add virtual hubs, spoke VNets with IPv4 prefixes, and on-premises sites.
- Connect sites to hubs using ExpressRoute, S2S VPN, or integrated SD-WAN NVAs.
- Define per-connection BGP advertisements and received AS paths, or VPN site static prefixes. Disable connections to explore failures.
- Choose ExpressRoute, VPN, or AS Path routing preference independently per hub.
- Click hubs and prefixes to highlight preferred links in green. Inspect selected and alternative paths, including modeled ECMP.
- Enable private and/or Internet routing intent. Inspect **hub policy routes and firewall forwarding routes separately**, and see firewall traversal in flow traces.
- Connect on-premises sites with directional BGP export allowlists and AS-path prepends. Configure site ASNs and originated prefixes, then enable mesh route import on the desired hub connections.
- Apply inbound and outbound, first-match AS-path prepend route maps to supported Azure BGP connections. Preview outbound advertisements without confusing them with Azure best paths.
- Trace IPv4 flows from a hub or attached spoke, with longest-prefix matching and per-hop explanations.
- Save automatically in browser storage, and import/export validated, versioned JSON.

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
4. Open **Routing intent** to enable private or Internet policies. Use **Effective route view** to switch between the hub and Azure Firewall.
5. To model on-premises transit, add site prefixes and BGP links under **On-premises sites & BGP links**. Export allowlists match exact prefixes; `*` means all. On the ingress hub connection, enable **Advertise site-originated and learned on-premises routes**.
6. On supported connections, add inbound/outbound prepend rules. Prefix match modes are `Equals` and `Contains`; rules terminate on the first match, while unmatched routes pass unchanged.
7. Enter a destination IPv4 address and **Trace flow**. Green links show the modeled forwarding path; multiple equal paths are displayed rather than inventing a traffic hash.

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

The app is suitable for Azure Static Web Apps **Free**, with no always-on compute or database. Free-tier limits apply, and Free is not a production SLA tier. Deployment infrastructure and workflows are added only after the Azure target and plan are approved.
