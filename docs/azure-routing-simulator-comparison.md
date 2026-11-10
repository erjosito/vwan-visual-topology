# Azure Networking Simulators — Candid Technical Comparison

**Compared projects:**
- **Azure Routing Simulator** by Pieterbas Nagengast (`https://pieterbasnagengast.github.io/Azure-RoutingSimulator/`, [`PieterbasNagengast/Azure-RoutingSimulator`](https://github.com/PieterbasNagengast/Azure-RoutingSimulator))
- **AzNet & Virtual WAN Topology Lab** (`https://vwan-simulator.com/`, [`erjosito/vwan-visual-topology`](https://github.com/erjosito/vwan-visual-topology))

---

## Executive Summary

Both projects are client-side, zero-backend browser simulators designed to make Azure's control-plane and data-plane routing behavior transparent, visual, and testable before touching production infrastructure. Rather than duplicating the exact same scope, the two tools originally approached the problem from complementary angles:

1. **Pieterbas Nagengast's Azure Routing Simulator** started from **classical Hub-and-Spoke VNet routing, Azure Route Server, UDRs, and practical operational footguns** (such as Default Outbound Access retirement, `disablePeeringRoutePropagation` preview, MSEE ExpressRoute hairpinning when on-premises advertises summary routes, and one-click URL `#s=` state sharing). Its single-screen cockpit and guided walkthroughs are remarkably clean and fast to learn.
2. **AzNet & Virtual WAN Topology Lab (`erjosito/vwan-visual-topology`)** started from **multi-hub Enterprise Virtual WAN BGP control-plane simulation** (Route Maps with match/action rules, Hub Routing Preference across ExpressRoute/VPN/AS-Path, Secured Virtual Hub Routing Intent, Spoke BGP NVA transit, and MSEE Global Reach) and subsequently expanded into a **general-purpose Hub-and-Spoke + Hybrid VNet graph simulator** backed by **deployable Bicep generation, a read-only Azure PowerShell collector, and automated NIC effective-route diffing against live Azure deployments**.

This document provides a candid, code-level comparison of where each tool shines, where each has gaps, and what we learned from studying `Azure-RoutingSimulator`.

---

## Side-by-Side Capability Matrix

| Capability Area | Pieterbas Nagengast — `Azure-RoutingSimulator` | `erjosito/vwan-visual-topology` (Unified AzNet + vWAN Lab) | Notes |
|---|---|---|---|
| **Topology Cardinality** | Fixed canonical topology (1 Hub VNet, up to 3 Spokes, 1 On-Premises site) with quick toggles | Arbitrary graph topology (multiple Hub VNets, arbitrary Spokes & Subnets, multiple vWAN Hubs, multiple ER MSEE locations, multiple On-Prem sites & site-to-site links) | Fixed topology keeps UI ultra-compact; arbitrary graph supports multi-region / multi-hub designs |
| **Virtual WAN Deep Control Plane** | High-level `Hub Mode: Standard VNet vs vWAN` toggle (`Routing Intent: Private / Internet`, `Branch-to-Branch`) | Full multi-hub vWAN simulator: Inbound/Outbound Route Maps, AS-Path prepending/filtering, community matching, Hub Routing Preference (`ExpressRoute`, `VpnGateway`, `ASPath`), Secured Hub Firewall tables, Spoke BGP NVA peering | `vwan-visual-topology` models full multi-hub BGP convergence |
| **Subnet Effective Route Table** | Yes — per-subnet and gateway route table (`System`, `BGP`, `UDR`, `Peering`, `Default`) with active/overridden status and trace-matched row highlighting | Yes — per-subnet NIC Effective Route Table with exact Azure precedence (`PE /32` > `UDR` > `BGP` > `System`), LPM IP tester, suppressed routes, and active flow highlighting | Both tools accurately model Azure's LPM -> Source Priority tie-breaker |
| **`disableBgpRoutePropagation`** | Yes — per-Route-Table toggle (`Disable BGP Propagation`) | Yes — per-Route-Table toggle (`disableBgpRoutePropagation`) + diagnostic detection when enabled without fallback UDR | Supported in both |
| **`disablePeeringRoutePropagation` (DPR Preview)** | **Yes** — first-class Route Table toggle (`Disable Peering Route Propagation`) suppressing `System · VNetPeering` routes + `PeerBypass` warning when a summary UDR is overridden by a `/16` peering route | **Added after this comparison** (previously missing!) | Great catch from `Azure-RoutingSimulator` |
| **Default Outbound Access Retirement & Internet Egress** | **Yes** — models `Outbound Connectivity` (NAT Gateway / PIP vs retired default outbound access), `Internet (20.50.60.70)` trace destination, `NoEgress` drops, and Firewall bypass warnings | **Added after this comparison** (previously modeled `0.0.0.0/0 -> Internet` system route and ARS `0.0.0.0/0` self-loop, but did not model `defaultOutboundAccess: false` drops) | Another great practical scenario from `Azure-RoutingSimulator` |
| **Private Endpoint (`/32 InterfaceEndpoint`)** | Yes — toggle per spoke (`10.x.0.50/32 -> InterfaceEndpoint`) + `subnetPolicies` toggle (`Disabled` vs `Enabled`) so UDRs can override `/32` PE routes | Yes — multiple Private Endpoints per subnet with `privateEndpointNetworkPolicies` (`Disabled`, `Enabled`, `RouteTableEnabled`) + `/32` firewall bypass diagnostics | Both model the `RouteTableEnabled` / subnet policy interaction with `/32` PE routes |
| **Azure Route Server (ASN 65515)** | Yes — models ARS + NVA BGP advertisement (`10.0.0.0/8`, `0.0.0.0/0`), `No B2B` drop when ARS branch-to-branch is off, and NVA self-loop hint | Yes — models ARS (`ASN 65515`), `branchToBranchTraffic`, `hubRoutingPreference` (`ExpressRoute`/`VpnGateway`/`ASPath`), multi-NVA ECMP, and ARS `0.0.0.0/0` self-blackhole loop on the NVA's own subnet | `vwan-visual-topology` also models ARS Hub Routing Preference tie-breaks |
| **ExpressRoute MSEE Hairpin Detection** | **Yes** — explicitly detects when Spoke-to-Spoke traffic traverses ExpressRoute Gateway to MSEE and hairpins back because on-prem advertises a summary (e.g., `10.0.0.0/8` or `172.16.0.0/12`) | Previously modeled at the engine level (UC9 two-VNet MSEE hairpin scenario) and now **promoted to a first-class Diagnostic with Auto-Fix** | `Azure-RoutingSimulator`'s `Hairpin` badge is very clear for architects |
| **Gateway TransitSummarization (`summarizedGatewayPrefixes`)** | Not modeled | Yes — models VNet Peering Gateway Transit Summarization (`summarizedGatewayPrefixes`) and its interaction with spoke BGP routes (validated against live Azure in UC7) | Useful for preview VNet summarization features |
| **Managed VNRA & Multi-Region Hub Chaining** | Not modeled | Yes — models `VirtualNetworkApplianceSubnet` (VNRA 100 Gbps) and cross-region Hub-to-Hub NVA/Firewall static route chaining | Useful for multi-region hub-and-spoke |
| **Forward + Return Symmetry & Auto-Fix** | Traces forward and return paths simultaneously, flags `Asymmetric Routing` (`FWD: ...` vs `RET: ...`) and per-hop warnings (`Bypass`, `Blackhole`, `Hairpin`, `PeerBypass`, `NoEgress`) | Traces forward + return paths, checks stateful appliance set equality across all pairs, and provides **one-click `Auto-Fix`** buttons on diagnostic findings | `Auto-Fix` mutates the topology live so users can see the fix take effect |
| **URL Hash Sharing (`#s=...`)** | **Yes** — compact base64 URL hash (`#s=...`) for instant scenario sharing without files | **Added after this comparison** (previously relied on JSON import/export and `?sample=` links) | URL hash sharing is much more convenient for quick Slack/Teams links |
| **Custom Diagram Node Labels (`label`)** | Fixed node titles | **Yes** — optional custom text labels (`<= 120` chars) rendered as pill badges on any VNet, vWAN Hub, Spoke, ExpressRoute Location, or On-Premises Site | Useful for annotating design notes, owners, or ticket/change references directly on the diagram |
| **Live Azure Loop (Bicep Export + Collector + Diff)** | Pure in-browser educational simulator (no IaC export or live Azure capture import) | **Full closed loop**: generates deployable `.bicep`, ships a read-only PowerShell collector (`collect-azure-network.ps1`), imports live Azure captures, and diffs simulated vs. observed NIC effective routes (including `GatewaySubnet` proxy NICs) | Every engine rule in `vwan-visual-topology` was empirically verified against live Azure (`0` route diffs across UC1–UC9) |

---

## Where `Azure-RoutingSimulator` (Pieterbas Nagengast) Excels

1. **Zero-Friction UX & Guided Pedagogical Walkthroughs:**
   - Having 15 curated scenarios with a built-in step-by-step **Scenario Guide** (`prev` / `next` steps that highlight specific DOM controls and explain *why* a route wins or drops) makes `Azure-RoutingSimulator` an outstanding teaching tool.
2. **Up-to-Date Coverage of New Azure VNet Changes:**
   - Modeling **Default Outbound Access retirement** (`NoEgress` when a spoke matches `0.0.0.0/0 -> Internet` without a NAT Gateway/PIP or Firewall UDR) and **Disable Peering Route Propagation (Preview)** (`disablePeeringRoutePropagation` + `PeerBypass` warning when a `/16` peering route overrides a `/8` summary UDR) addresses two of the most common questions Azure network architects face today.
3. **Instant `#s=` Permalink Sharing:**
   - Encoding the workspace state directly into `location.hash` (`#s=...`) lets anyone share a broken or fixed routing scenario in a single URL without downloading/uploading JSON files.
4. **Inline Route Table Highlighting During Flow Traces:**
   - Highlighting the exact winning forward (`FWD`) and return (`RET`) routes directly inside the inspected Effective Route Table while a flow trace is active makes it effortless to connect the control plane to the data plane.

---

## Where `vwan-visual-topology` (AzNet + vWAN Simulator) Excels

1. **Empirical Verification Against Live Azure (Bicep -> Deploy -> Capture -> Route Diff):**
   - Can export any topology to a deployable Azure **Bicep** template, collect the live Azure resource group state and NIC effective route tables via a read-only PowerShell script (using an auxiliary proxy subnet sharing `GatewaySubnet`'s route table to work around Azure's prohibition on probe VMs in `GatewaySubnet`), and run an automated **route-by-route diff** inside the UI.
2. **Multi-Hub / Multi-Region Arbitrary Graph & Full BGP Engine:**
   - Supports multiple Hub VNets, multiple Virtual WAN Hubs, multiple ExpressRoute MSEE peering locations (including Global Reach), multi-hop on-premises site meshes, Inbound/Outbound Route Maps, AS-Path prepending, and Hub Routing Preference tie-breakers (`ExpressRoute` vs `VpnGateway` vs `ASPath`).
3. **Proactive Root-Cause Diagnostics with One-Click `Auto-Fix`:**
   - Automatically sweeps all subnet/site pairs to detect `GatewaySubnet` missing return UDRs, NVA IP forwarding disabled, ARS `0.0.0.0/0` self-blackhole loops on the NVA subnet, Private Endpoint `/32` firewall bypasses, and BGP/Peering LPM overrides of summary Firewall UDRs — and lets the user apply the remediation with one click.
4. **Focused UI Modes (`Full Mode`, `VWAN-Only`, `Hub-and-Spoke-Only`):**
   - Because enterprise architects rarely mix standalone Hub-and-Spoke VNet Gateways/Route Servers and Virtual WAN in the same design (outside of migration scenarios), the unified app now provides top-level mode switches to tailor the canvas and controls to **VWAN-Only**, **Hub-and-Spoke-Only**, or **Full Hybrid Mode**.

---

## Features Inspired by `Azure-RoutingSimulator` Added to Our Roadmap & Implemented

After reviewing `PieterbasNagengast/Azure-RoutingSimulator`, we opened GitHub issues and implemented the following improvements in `erjosito/vwan-visual-topology`:

1. **Unified Single-App Experience with Mode Switcher (`Full Mode`, `VWAN-Only`, `Hub-and-Spoke-Only`)** — merged the Virtual WAN simulator and AzNet simulator into one app with a persistent mode selector and tailored UI visibility.
2. **`disablePeeringRoutePropagation` (DPR Preview) & `PeerBypass` Diagnostics** — added `disablePeeringRoutePropagation` on Route Tables to suppress `VNetPeering` system routes, plus automatic detection and one-click `Auto-Fix` when a more-specific `/16` VNet peering route bypasses a summary `/8` or `/12` Firewall UDR.
3. **Default Outbound Access (`defaultOutboundAccess`) & Internet Egress Tracing** — added `Internet (20.50.60.70)` as a first-class destination in the Path & Symmetry Tracer, `defaultOutboundAccess` per subnet, `dropped-no-outbound-access` (`NoEgress`) simulation, and uninspected Internet egress warnings when a Hub Firewall is present.
4. **ExpressRoute MSEE Hairpin Diagnostic (`expressroute-msee-hairpin`)** — added automated detection and one-click `Auto-Fix` when Spoke-to-Spoke traffic hairpins through an ExpressRoute Gateway/MSEE because on-premises advertises a summary route covering the spokes.
5. **URL Hash State Sharing (`#s=...`) & Active-Trace Route Highlighting** — added one-click permalink sharing and `FWD`/`RET` badges on the active winning rows in the Subnet Effective Route Table.
