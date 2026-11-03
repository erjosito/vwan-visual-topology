# Azure Networking Simulator (Preview) — Empirical Live Azure Verification (2026-11-03)

## Overview

This directory contains the empirical Azure validation artifacts, generated Bicep templates, and live Azure control-plane captures (`uc1-capture.json` through `uc8-capture.json`) used to validate the **Azure Networking Simulator (Preview)** (`src/azure-net/`) against real Azure hub-spoke topologies deployed in `rg-aznet-sim-lab-20261103` and `rg-aznet-sim-lab-p2-20261103` (`swedencentral`).

Every scenario was verified across three layers:
1. **NIC Effective Routes (`az network nic show-effective-route-table`)** across 5 NICs (`nic-vm-hub-nva`, `nic-vm-gw-proxy`, `nic-vm-spoke1`, `nic-vm-spoke2`, `nic-vm-branch-hq`), including `snet-gw-proxy` sharing the exact `rt-aznet-gw-subnet` Route Table associated with `GatewaySubnet`.
2. **BGP Control Plane** across Azure Route Server (`az network routeserver peering list-learned-routes` / `list-advertised-routes`), Azure VPN Gateway (`az network vnet-gateway list-learned-routes` / `list-advertised-routes`), and BIRD BGP daemons on `vm-hub-nva` (`AS 65010`) and `vm-branch-hq` (`AS 65100`) (`birdc show protocols`, `birdc show route`).
3. **Data Plane (`ping`, `curl`, and NVA `iptables FORWARD` packet counters)** via `az vm run-command invoke`.

---

## Validation Scenarios & Comparison Summary

| Scenario | Sample Topology | Live Azure Capture | Imported Effective Routes | Sample Effective Routes | Control & Data Plane Verification |
| --- | --- | --- | --- | --- | --- |
| **UC1: Hub-Spoke + NVA + ARS + VNG Baseline (`snet-gw-proxy`)** | `samples/azure-net/uc1-hub-spoke-nva-ars-baseline.json` | `uc1-capture.json` | **32 matched / 0 mismatched** | **30 matched / 0 mismatched** | Symmetric inspection via `vm-hub-nva` (`10.100.2.4`); `snet-gw-proxy` proves `GatewaySubnet` UDR redirects `10.101.0.0/16` and `10.102.0.0/16` to `10.100.2.4` |
| **UC2: Missing `GatewaySubnet` UDR Return-Path Asymmetry** | `samples/azure-net/uc2-gateway-subnet-missing-udr-asymmetry.json` | `uc2-capture.json` | **31 matched / 0 mismatched** | **29 matched / 0 mismatched** | Removing `10.101.0.0/16 -> 10.100.2.4` from `rt-aznet-gw-subnet` causes `nic-vm-gw-proxy` (and `GatewaySubnet`) to fall back to `10.101.0.0/16 -> VNetPeering`, bypassing `vm-hub-nva` on the return path |
| **UC3: `disableBgpRoutePropagation` + Peering `allowForwardedTraffic=false`** | `samples/azure-net/uc3-bgp-propagation-and-peering-gates.json` | `uc3-capture.json` | **27 matched / 0 mismatched** | **25 matched / 0 mismatched** | Enabling `disableBgpRoutePropagation=true` on `rt-aznet-spoke2` removes all 4 `VirtualNetworkGateway` routes from `nic-vm-spoke2`; setting `allowForwardedTraffic=false` + `useRemoteGateways=false` on `vnet-aznet-spoke1` drops NVA-forwarded packets from `vm-spoke2` (`100% packet loss`) |
| **UC4: Private Endpoint `/32` `InterfaceEndpoint` vs `RouteTableEnabled`** | `samples/azure-net/uc4-private-endpoint-udr-override.json` | `uc4-capture.json` | **31 matched / 0 mismatched** | **29 matched / 0 mismatched** | Enabling `privateEndpointNetworkPolicies=RouteTableEnabled` on `snet-spoke1-pe` and adding `10.101.2.4/32 -> VirtualAppliance 10.100.2.4` overrides the `/32 InterfaceEndpoint` system route and routes traffic through `vm-hub-nva` (`FORWARD` counter `+7` packets) |
| **UC5: ARS `allowBranchToBranchTraffic=false` Suppression** | `samples/azure-net/uc5-ars-branch-to-branch-and-bgp-selection.json` | `uc5-capture.json` | **29 matched / 0 mismatched** | **27 matched / 0 mismatched** | Disabling `allowBranchToBranchTraffic` on `ars-aznet-hub` withdraws `192.168.100.0/24` (`AS 65010`) from `vng-aznet-hub-vpn` and `vm-branch-hq`, and withdraws `10.250.0.0/16` (`AS 65515 65100`) from `vm-hub-nva`; `ping 192.168.100.4` from `vm-branch-hq` fails (`100% packet loss`) |
| **UC6: ARS `0.0.0.0/0` NVA Self-Blackhole Loop & Auto-Fix** | `samples/azure-net/uc6-ars-default-route-self-blackhole.json` | `uc6-capture.json` | **34 matched / 0 mismatched** | **30 matched / 0 mismatched** | When `vm-hub-nva` (`10.100.2.4`) advertises `0.0.0.0/0` to `ars-aznet-hub` without `disableBgpRoutePropagation=true` or `0.0.0.0/0 -> Internet` on `rt-aznet-hub-nva`, `nic-vm-hub-nva` receives `VirtualNetworkGateway 0.0.0.0/0 -> 10.100.2.4` (pointing to itself!); `curl 1.1.1.1` from `vm-spoke1` loops **16,702 packets** in `vm-hub-nva` `iptables FORWARD` until TTL expires. Adding `0.0.0.0/0 -> Internet` on `rt-aznet-hub-nva` marks the self-route `Invalid` and restores `HTTP/1.1 301` |
| **UC7: More-Specific BGP Route (`/16`) Bypasses Summary UDR (`/8`) via LPM** | `samples/azure-net/uc7-bgp-lpm-bypasses-summary-udr.json` | `uc7-capture.json` | **33 matched / 0 mismatched** | **29 matched / 0 mismatched** | With `10.0.0.0/8 -> VirtualAppliance 10.100.2.4` on `rt-aznet-spoke1` and `disableBgpRoutePropagation=false`, the BGP-learned `10.250.0.0/16 -> VirtualNetworkGateway` wins by LPM (`0` packets on `vm-hub-nva` `FORWARD`, `ttl=63`); stopping BIRD on `vm-branch-hq` withdraws the `/16` BGP route and shifts traffic to the `/8` NVA UDR (`4/4` packets on `vm-hub-nva`, `ttl=62`) |
| **UC8: UDR `None`, `Internet`, `VnetLocal`, & `VirtualNetworkGateway` Transit Trap** | `samples/azure-net/uc8-udr-next-hop-types-and-vng-transit-trap.json` | `uc8-capture.json` | **36 matched / 0 mismatched** | **31 matched / 0 mismatched** | Verifies `10.101.128.0/24 -> None` (`100% packet loss`), `0.0.0.0/0 -> Internet` breakout, and proves empirically that a UDR with `NextHopType=VirtualNetworkGateway` for a VNet/non-gateway prefix (`10.102.0.0/16 -> VirtualNetworkGateway`) is compiled by Azure SDN into **`User | Active | 10.102.0.0/16 | None`** in the NIC effective route table |
| **UC9: ExpressRoute MSEE Hairpin Transit (`weight` & AS-Path Selection)** | `samples/azure-net/uc9-expressroute-msee-hairpin-transit.json` | Unit-tested (`engine.test.ts`) | N/A (synthetic multi-VNet ER circuit) | Verified in `engine.test.ts` | Models two Hub VNets (`vnet-hub-west` and `vnet-hub-east`) linked to a shared ExpressRoute circuit (`er-metro-global`) with `weight=100` vs `weight=0`, MSEE hairpin transit between unpeered VNets, and `expressroute-hairpin-transit` diagnostics |

---

## Key Empirical Azure SDN Discoveries Incorporated into Simulator

### 1. Azure Route Server Routes Appear as `VirtualNetworkGateway` in NIC Effective Routes
When Azure Route Server (`ars-aznet-hub`, `AS 65515`) learns a prefix (`192.168.100.0/24`) from an NVA BGP peer (`10.100.2.4`, `AS 65010`) and injects it into the Hub VNet and peered Spoke VNets (`useRemoteGateways=true`), Azure's NIC effective route API (`az network nic show-effective-route-table`) reports the route as:
- `source: "VirtualNetworkGateway"`
- `nextHopType: "VirtualNetworkGateway"`
- `nextHopIpAddress: ["10.100.2.4"]` (the NVA's private IP, whereas VNG-originated routes carry the VNG BGP IP `10.100.0.4`/`10.100.0.5`).

Both `compileSingleSubnetEffectiveRoutes` (`src/azure-net/engine.ts`) and `compareAzNetWithObservations` (`src/azure-net/azure-import.ts`) now account for this equivalence and deduplicate routes when `allowBranchToBranchTraffic=true` causes VNG to also learn the same prefix from ARS.

### 2. `privateEndpointNetworkPolicies = RouteTableEnabled` Invalidates `/32 InterfaceEndpoint` Under Any Covering UDR
In **UC1–UC3** (`privateEndpointNetworkPolicies = Disabled` on `snet-spoke1-pe`), `nic-vm-gw-proxy` has `10.101.2.4/32 -> Default (InterfaceEndpoint)` as `Active` even though `rt-aznet-gw-subnet` has a covering `/16` UDR (`10.101.0.0/16 -> VirtualAppliance 10.100.2.4`).
In **UC4**, when `privateEndpointNetworkPolicies` on `snet-spoke1-pe` was changed to `RouteTableEnabled`:
- On `nic-vm-spoke1` (which received an explicit `10.101.2.4/32 -> VirtualAppliance 10.100.2.4` UDR), `10.101.2.4/32 -> Default (InterfaceEndpoint)` became `Invalid`.
- On `nic-vm-gw-proxy` (which only had `10.101.0.0/16 -> VirtualAppliance 10.100.2.4` and no `/32` UDR), `10.101.2.4/32 -> Default (InterfaceEndpoint)` **also** became `Invalid`!
- Meanwhile, on `nic-vm-hub-nva` (which has no UDR covering `10.101.0.0/16`), `10.101.2.4/32 -> Default (InterfaceEndpoint)` remained `Active`.

`src/azure-net/engine.ts` (`Step G`) now models this exact behavior: when the Private Endpoint subnet has `privateEndpointNetworkPolicies` set to `RouteTableEnabled` or `Enabled`, any active `User` UDR covering the Private Endpoint IP (`/16`, `/24`, or `/32`) invalidates the system `/32 InterfaceEndpoint` route on that subnet.

### 3. `allowForwardedTraffic=false` + `useRemoteGateways=true` Interaction with Azure Route Server
In **UC3**, when `vnet-aznet-spoke1`'s peering toward `vnet-aznet-hub` had `allowForwardedTraffic=false` **and** `useRemoteGateways=true` while `ars-aznet-hub` was active and BGP-peered with `vm-hub-nva` (`10.100.2.4`), Azure SDN treated `10.100.2.4` as a `VirtualNetworkGateway` next hop and permitted traffic from `vm-spoke2` (`10.102.1.4`) forwarded by `vm-hub-nva` into `vm-spoke1` (`10.101.1.4`).
When `useRemoteGateways` was set to `false` alongside `allowForwardedTraffic=false`, `ping` and `curl` from `vm-spoke2` to `vm-spoke1` immediately dropped at the peering boundary (`100% packet loss`).
Both `validatePeeringTransition` (`src/azure-net/engine.ts`) and `runAzNetDiagnostics` (`src/azure-net/diagnostics.ts`) now model both cases (`error` when dropped, `warning` when masked by ARS + `useRemoteGateways=true`).

### 4. `allowBranchToBranchTraffic=false` on Azure Route Server (`UC5`)
When `allowBranchToBranchTraffic` was set to `false` on `ars-aznet-hub`:
- `ars-aznet-hub` continued learning `192.168.100.0/24` from `vm-hub-nva` (`10.100.2.4`) and programming it into Azure VNet NIC effective route tables (`nic-vm-spoke1`, `nic-vm-spoke2`, `nic-vm-gw-proxy`), and `vng-aznet-hub-vpn` continued learning `10.250.0.0/16` from `lgw-branch-hq` and programming it into Azure VNet NIC effective route tables (`nic-vm-hub-nva`, `nic-vm-spoke1`, `nic-vm-spoke2`, `nic-vm-gw-proxy`).
- However, route exchange **between** `ars-aznet-hub` and `vng-aznet-hub-vpn` stopped completely: `vng-aznet-hub-vpn` stopped learning `192.168.100.0/24` and stopped advertising it to `vm-branch-hq`, and `ars-aznet-hub` stopped advertising `10.250.0.0/16` to `vm-hub-nva`'s BIRD BGP daemon.

### 5. ARS `0.0.0.0/0` Self-Loop on NVA Subnet (`UC6`)
When `vm-hub-nva` (`10.100.2.4`) advertised `0.0.0.0/0` to Azure Route Server (`ars-aznet-hub`) while `rt-aznet-hub-nva` had `disableBgpRoutePropagation: false` and no `0.0.0.0/0 -> Internet` UDR:
- Azure SDN injected `VirtualNetworkGateway | Active | 0.0.0.0/0 | VirtualNetworkGateway | 10.100.2.4` onto **every** subnet in `vnet-aznet-hub` and peered spokes (`useRemoteGateways: true`) — including `snet-nva` (`nic-vm-hub-nva`) itself!
- Injecting `0.0.0.0/0` via `VirtualNetworkGateway` also caused Azure SDN to completely remove `Default | Active | 0.0.0.0/0 | Internet` and all ~85 `Default -> None` bogon filter routes from the NIC effective route tables.
- When `vm-spoke1` (`10.101.1.4`) sent `curl -I -m 3 http://1.1.1.1`, `vm-hub-nva` received the packet and forwarded it toward its subnet default gateway (`10.100.2.1`), which the Azure vSwitch immediately hairpinned back to `10.100.2.4` — looping **16,702 packets** in `iptables FORWARD` until IP TTL expired.
- Applying the simulator's Auto-Fix (`0.0.0.0/0 -> Internet` UDR on `rt-aznet-hub-nva`) marked `VirtualNetworkGateway | 0.0.0.0/0 -> 10.100.2.4` as `Invalid` on `nic-vm-hub-nva`, stopped the packet loop (`3` packets in `FORWARD`), and restored `HTTP/1.1 301 Moved Permanently`.

### 6. More-Specific BGP Route (`/16`) Overrides Summary UDR (`/8`) via Longest Prefix Match (`UC7`)
When `rt-aznet-spoke1` has a summary UDR (`10.0.0.0/8 -> VirtualAppliance 10.100.2.4`) intended to force all RFC1918 traffic through `vm-hub-nva`, but `disableBgpRoutePropagation` is `false`:
- The BGP-learned route `10.250.0.0/16 -> VirtualNetworkGateway (10.100.0.4, 10.100.0.5)` remains `Active` alongside `10.0.0.0/8 -> VirtualAppliance (10.100.2.4)`.
- Traffic from `vm-spoke1` (`10.101.1.4`) to `10.250.0.100` matches `/16` by Longest Prefix Match (LPM) and goes straight to `vng-aznet-hub-vpn` (`0` forward packets on `vm-hub-nva`, `ttl=63`).
- Stopping BIRD on `vm-branch-hq` withdraws `10.250.0.0/16`, causing `vm-spoke1` to fall back to the `10.0.0.0/8 -> 10.100.2.4` UDR (`4/4` forward packets on `vm-hub-nva`, `ttl=62`).

### 7. UDR `NextHopType=VirtualNetworkGateway` Compiles to `None` in NIC Effective Routes (`UC8`)
When a User-Defined Route specifies `NextHopType: VirtualNetworkGateway` for a VNet/non-gateway prefix (`10.102.0.0/16 -> VirtualNetworkGateway`) on either `rt-aznet-spoke1` or `rt-aznet-hub-nva`:
- Azure's SDN control plane compiles the UDR directly into **`User | Active | 10.102.0.0/16 | None`** in the NIC effective route table (`az network nic show-effective-route-table`), blackholing traffic immediately.
- Both `src/azure-net/engine.ts`, `src/azure-net/diagnostics.ts` (`udr-vng-invalid-transit`), and `src/azure-net/azure-import.ts` (`isUdrUnresolvedVngMatch`) model and verify this behavior.

### 8. Bicep `dependsOn` Ordering for `allowGatewayTransit: true` VNet Peerings
When a Hub VNet deploys VNet peerings with `allowGatewayTransit: true` in parallel with `Microsoft.Network/virtualNetworkGateways` and `Microsoft.Network/virtualHubs/bgpConnections` (Azure Route Server), spoke VNets (`useRemoteGateways: true`) can miss the initial ARS route-injection event unless the Hub->Spoke peering explicitly depends on the Hub VNG and ARS IP configuration (`src/azure-net/bicep-export.ts`). In the Phase 2 deployment (`rg-aznet-sim-lab-p2-20261103`), adding those `dependsOn` edges resulted in immediate `FullyInSync` peerings and zero missing ARS routes on `nic-vm-spoke1` and `nic-vm-spoke2` without manual peering resyncs.

---

## Reproducing the Comparison

Run the automated test suite:

```bash
npm test -- src/azure-net/engine.test.ts
```
