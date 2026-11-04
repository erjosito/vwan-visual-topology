# Sample Topologies

**Language / 言語:** **English** | [日本語](./README.ja.md)

This directory contains ready-to-import Virtual WAN topology JSON files used in the [User Guide & Worked Examples](../docs/README.md) ([日本語ガイド](../docs/README.ja.md) · [live docs on `vwan-simulator.com/docs/`](https://vwan-simulator.com/docs/)).

| File | Scenario | Live Simulator Link |
| :--- | :--- | :--- |
| [`hub-routing-preferences.json`](./hub-routing-preferences.json) | **Example 1:** `ExpressRoute` vs `ASPath` hub routing preference with dual ExpressRoute + BGP VPN connections | [Open in Simulator](https://vwan-simulator.com/?sample=hub-routing-preferences) |
| [`secured-hub-routing-intent.json`](./secured-hub-routing-intent.json) | **Example 2:** Secured Virtual Hub with Private + Internet Azure Firewall Routing Intent and Static VPN default-route propagation | [Open in Simulator](https://vwan-simulator.com/?sample=secured-hub-routing-intent) |
| [`spoke-bgp-nva-transit.json`](./spoke-bgp-nva-transit.json) | **Example 3:** Spoke BGP NVA peering with a Virtual Hub and providing transit to a downstream standalone VNet and partner site | [Open in Simulator](https://vwan-simulator.com/?sample=spoke-bgp-nva-transit) |
| [`three-hub-all-features-asymmetric.json`](./three-hub-all-features-asymmetric.json) | **Example 4:** 3-Hub All-Features Enterprise Showcase with an intentional asymmetric routing path | [Open in Simulator](https://vwan-simulator.com/?sample=three-hub-all-features-asymmetric) |

---

## `three-hub-all-features-asymmetric.json` — Detailed Walkthrough

A 3-hub global enterprise topology designed to exercise every major feature of the Virtual WAN Visual Topology Simulator:

- **3 Virtual Hubs with all 3 Hub Routing Preferences**:
  - **West Europe Hub (`hub-weu`)**: `ExpressRoute` preference, Secured Virtual Hub with Azure Firewall Routing Intent enabled for both **Private** and **Internet** traffic.
  - **East US Hub (`hub-eus`)**: `VPN` preference, standard hub.
  - **Japan East Hub (`hub-jpe`)**: `ASPath` preference, Secured Virtual Hub with Azure Firewall Routing Intent enabled for **Private** traffic.
- **ExpressRoute Peering Location (`Equinix AM5 Amsterdam`)**:
  - Connects `Amsterdam Core DC` (`10.110.0.0/16`, `10.110.10.0/24`) to both `West Europe Hub` and `East US Hub`.
- **All 4 Connectivity Transports**:
  - **ExpressRoute** via `Equinix AM5 Amsterdam`.
  - **BGP S2S VPN** (`Amsterdam Backup S2S VPN` to `West Europe Hub`, `New York Primary S2S VPN` to `East US Hub`).
  - **Static S2S VPN with Default-Route Propagation** (`Madrid Retail Branch` `10.130.0.0/24` with `propagateDefaultRoute: true` from `West Europe Hub`).
  - **SD-WAN** (`Tokyo SD-WAN Branch` `10.140.0.0/16` connected to `Japan East Hub`, demonstrating bidirectional SD-WAN route learning).
  - **Spoke BGP NVA (`EMEA Transit NVA Spoke`, peer `10.11.0.4`, ASN `65110`)**:
    - Hosts an embedded NVA router advertising both a **Downstream Standalone Azure VNet** (`Downstream AI Landing Zone VNet`, `10.90.0.0/16`) and a **Downstream On-Premises Site** (`Zurich B2B Partner Enclave`, `172.20.0.0/16`).
- **On-Premises WAN Link**:
  - `Transatlantic MPLS Backhaul` (`site-ams-dc` ↔ `site-nyc-hq`).
- **Hub & Site Route Maps**:
  - `WEU-ER-Out-Prepend-64496` (`hub-weu` outbound on `er-hub-weu`): prepends documentation ASN `64496 64496` on `10.0.0.0/8` routes.
  - `EUS-VPN-In-Summarize-NYC` (`hub-eus` inbound on `conn-vpn-nyc-eus`): permits `10.120.0.0/16` inbound.
  - `AMS-VPN-Out-Prepend` (`site-ams-dc` outbound on `conn-vpn-ams-weu`): prepends `65010` on backup VPN advertisements.
- **Intentional Asymmetric Routing Issue**:
  - **Forward (`Azure → Amsterdam Core DC`)**: `West Europe Hub` prefers **ExpressRoute** (`Equinix AM5 Amsterdam`) due to `ExpressRoute` hub routing preference and shorter inbound AS path `[65010]`.
  - **Return (`Amsterdam Core DC → West Europe Spokes`)**: Because `WEU-ER-Out-Prepend-64496` prepends `64496 64496` outbound on the `West Europe Hub` ExpressRoute link (`er-hub-weu`), `Amsterdam Core DC` sees a shorter AS path (`[65515]`) over `Amsterdam Backup S2S VPN` (`conn-vpn-ams-weu`) than over ExpressRoute (`[65515, 64496, 64496]`, or `[65515, 65515]` via `East US Hub`), causing return traffic to take **VPN** (or cross-region **East US Hub**) while forward traffic takes **West Europe ExpressRoute**.

---

## Comprehensive Azure VNet Topologies (`samples/azure-net/`)

The [`samples/azure-net/`](./azure-net/) directory contains **5 comprehensive Azure VNet showcase topologies** and **9 focused empirical validation scenarios** (`uc1`–`uc9`) for the **Azure Networking Simulator (Preview)**. Every file in `samples/azure-net/` is mirrored to `public/docs/samples/azure-net/` and validated by `src/azure-net/engine.test.ts`.

### Flagship Azure VNet Showcase Samples

| File | Architecture & Key Features Covered | Live Simulator Link |
| :--- | :--- | :--- |
| [`azure-net/enterprise-vnet-all-features-showcase.json`](./azure-net/enterprise-vnet-all-features-showcase.json) | **Enterprise Multi-Region VNet All-Features Showcase:** 2 regional Hub VNets (`westeurope` + `northeurope`), Global VNet Peering, Azure Firewall inspection in both hubs, Azure Route Server (`ASN 65515`) + SD-WAN BGP NVA (`ASN 65110`), standalone ExpressRoute + Active-Active S2S VPN Gateways, Private Endpoint Network Policies (`RouteTableEnabled` vs `Disabled`), and BGP `/16` LPM overriding a `/8` summary UDR | [Open in Azure Net Simulator](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=enterprise-vnet-all-features-showcase) |
| [`azure-net/hub-spoke-firewall-udr.json`](./azure-net/hub-spoke-firewall-udr.json) | **Hub-and-Spoke + AzFW + GatewaySubnet UDR:** Classic self-managed Hub-and-Spoke VNet with ER & VPN Gateways, spoke UDR tables (`disableBgpRoutePropagation: true`), Private Endpoint `/32` `InterfaceEndpoint` system route override, and `GatewaySubnet` return-UDR asymmetry detection | [Open in Azure Net Simulator](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=hub-spoke-firewall-udr) |
| [`azure-net/ars-sdwan-nva-coexistence.json`](./azure-net/ars-sdwan-nva-coexistence.json) | **Azure Route Server + SD-WAN BGP NVA + ER/VPN B2B:** Dynamic transit hub VNet with Azure Route Server (`branchToBranchTraffic: true`, `hubRoutingPreference: ExpressRoute`), dual BGP NVAs (SD-WAN edge + inspection NVA), ER/VPN Branch-to-Branch route exchange, and spoke BGP propagation blackhole detection | [Open in Azure Net Simulator](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=ars-sdwan-nva-coexistence) |
| [`azure-net/dual-hub-vnra-global-peering.json`](./azure-net/dual-hub-vnra-global-peering.json) | **Dual-Region Managed VNRA + Chained Global Peering UDRs:** Dual-region 100 Gbps Managed Virtual Network Routing Appliances (VNRA) with chained UDRs across Global VNet Peering (`Spoke-WEU -> VNRA-WEU -> VNRA-NEU -> Spoke-NEU`) and peering flag (`allowVirtualNetworkAccess` / `allowForwardedTraffic`) validation | [Open in Azure Net Simulator](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=dual-hub-vnra-global-peering) |
| [`azure-net/hybrid-vwan-and-hub-spoke.json`](./azure-net/hybrid-vwan-and-hub-spoke.json) | **Hybrid Virtual WAN Secured Hub + Classic Hub-and-Spoke:** Coexistence topology bridging a Secured Virtual WAN Hub (with Routing Intent) and a classic Hub-and-Spoke VNet (with standalone ER Gateway + Azure Firewall) across a shared Frankfurt ExpressRoute MSEE (`ASN 12076`) | [Open in Azure Net Simulator](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=hybrid-vwan-and-hub-spoke) |

### `azure-net/enterprise-vnet-all-features-showcase.json` — Detailed Walkthrough

A multi-region enterprise Azure VNet topology designed to exercise every major feature of the Azure Networking Simulator:

- **2 Regional Hub VNets (`VNet-Hub-WEU-Core` & `VNet-Hub-NEU-DR`)**:
  - Interconnected via **Global VNet Peering** (`Hub-WEU ↔ Hub-NEU`) and a shared Amsterdam ExpressRoute MSEE (`Equinix AM5 Amsterdam`).
  - **`VNet-Hub-WEU-Core` (`10.10.0.0/22`)**: hosts `ER-GW-WEU` (ExpressRoute Gateway), `VPN-GW-WEU` (Active-Active S2S VPN Gateway to Dublin Backup DC), `ARS-WEU-Core` (Azure Route Server, `ASN 65515`, `branchToBranchTraffic: true`), `AzFW-WEU-Premium` (`10.10.1.4`), and `NVA-SDWAN-Edge-01` (`10.10.2.10`, `ASN 65110`, advertising Zurich SD-WAN prefixes `10.250.0.0/16` and `192.168.200.0/24`).
  - **`VNet-Hub-NEU-DR` (`10.20.0.0/22`)**: hosts `ER-GW-NEU` and `AzFW-NEU-DR` (`10.20.1.4`) with `RT-NEU-GatewaySubnet` ensuring symmetric inspection for `VNet-Spoke-DR-NEU` (`10.21.0.0/16`).
- **Private Endpoint Network Policies Comparison**:
  - **`VNet-Spoke-Payments-WEU` (`snet-payments-privatelink`)**: sets `privateEndpointNetworkPolicies: RouteTableEnabled` so traffic to `pe-ledger-sql` (`10.11.2.10`) is inspected by `AzFW-WEU-Premium`.
  - **`VNet-Spoke-Analytics-WEU` (`snet-datalake-pe`)**: keeps `privateEndpointNetworkPolicies: Disabled`, so `pe-curated-adls` (`10.12.2.25`) injects a `/32 InterfaceEndpoint` system route that overrides `/8` and `/16` UDRs by Longest Prefix Match.
- **Intentional BGP LPM vs Summary UDR Asymmetry**:
  - `VNet-Spoke-Analytics-WEU` uses `RT-WEU-Analytics-BGP-Enabled` (`disableBgpRoutePropagation: false`) with a `10.0.0.0/8 -> 10.10.1.4` summary UDR and a `10.99.0.0/16 -> None` blackhole route.
  - Because BGP propagation is enabled, the ARS-learned `10.250.0.0/16` route from `NVA-SDWAN-Edge-01` wins by LPM (`/16` beats `/8`) and bypasses `AzFW-WEU-Premium` outbound while return traffic from SD-WAN goes through `AzFW-WEU-Premium`.

### Empirical Live-Azure Validation Scenarios (`uc1`–`uc9`)

Each `uc*.json` topology in [`samples/azure-net/`](./azure-net/) corresponds to a live Azure deployment or edge-case routing verification in [`verification/azure-net-2026-11-03/`](../verification/azure-net-2026-11-03/):

| File | Routing Mechanism Validated Against Live Azure | Live Simulator Link |
| :--- | :--- | :--- |
| [`azure-net/uc1-hub-spoke-nva-ars-baseline.json`](./azure-net/uc1-hub-spoke-nva-ars-baseline.json) | **UC1:** Baseline Hub-and-Spoke with ARS (`ASN 65515`), BGP NVA (`ASN 65001`), VNet Peering (`AllowGatewayTransit` / `UseRemoteGateways`), and symmetric UDR inspection | [Open UC1](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc1-hub-spoke-nva-ars-baseline) |
| [`azure-net/uc2-gateway-subnet-missing-udr-asymmetry.json`](./azure-net/uc2-gateway-subnet-missing-udr-asymmetry.json) | **UC2:** Asymmetric firewall bypass when `GatewaySubnet` is missing a return UDR to the spoke prefix | [Open UC2](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc2-gateway-subnet-missing-udr-asymmetry) |
| [`azure-net/uc3-bgp-propagation-and-peering-gates.json`](./azure-net/uc3-bgp-propagation-and-peering-gates.json) | **UC3:** Interaction of `disableBgpRoutePropagation`, `allowGatewayTransit`, `useRemoteGateways`, and `allowForwardedTraffic` across 3 spokes | [Open UC3](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc3-bgp-propagation-and-peering-gates) |
| [`azure-net/uc4-private-endpoint-udr-override.json`](./azure-net/uc4-private-endpoint-udr-override.json) | **UC4:** Private Endpoint `/32 InterfaceEndpoint` system route overriding a `/16` UDR until `privateEndpointNetworkPolicies: RouteTableEnabled` is set | [Open UC4](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc4-private-endpoint-udr-override) |
| [`azure-net/uc5-ars-branch-to-branch-and-bgp-selection.json`](./azure-net/uc5-ars-branch-to-branch-and-bgp-selection.json) | **UC5:** Dual BGP NVAs (`ASN 65001` vs `ASN 65002` with AS-path prepend) peering with ARS and propagating best path + ECMP routes | [Open UC5](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc5-ars-branch-to-branch-and-bgp-selection) |
| [`azure-net/uc6-ars-default-route-self-blackhole.json`](./azure-net/uc6-ars-default-route-self-blackhole.json) | **UC6:** ARS `0.0.0.0/0` self-blackhole loop when a BGP NVA advertises `0.0.0.0/0` to ARS without a `0.0.0.0/0 -> Internet` UDR on `snet-nva` | [Open UC6](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc6-ars-default-route-self-blackhole) |
| [`azure-net/uc7-bgp-lpm-bypasses-summary-udr.json`](./azure-net/uc7-bgp-lpm-bypasses-summary-udr.json) | **UC7:** More-specific `/16` ARS/BGP route (`10.250.0.0/16`) winning by LPM over a summary `10.0.0.0/8` firewall UDR when BGP propagation is enabled | [Open UC7](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc7-bgp-lpm-bypasses-summary-udr) |
| [`azure-net/uc8-udr-next-hop-types-and-vng-transit-trap.json`](./azure-net/uc8-udr-next-hop-types-and-vng-transit-trap.json) | **UC8:** `NextHopType=None` blackhole carve-out, `NextHopType=Internet` forced breakout, and invalid `NextHopType=VirtualNetworkGateway` for spoke-to-spoke transit | [Open UC8](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc8-udr-next-hop-types-and-vng-transit-trap) |
| [`azure-net/uc9-expressroute-hairpin-two-vnets.json`](./azure-net/uc9-expressroute-hairpin-two-vnets.json) | **UC9:** VNet-to-VNet transit hairpin across a shared ExpressRoute circuit / MSEE (`ASN 12076`) with no VNet peering between hubs | [Open UC9](https://gray-wave-0e5ecfd03.3.azurestaticapps.net/?sample=uc9-expressroute-hairpin-two-vnets) |
