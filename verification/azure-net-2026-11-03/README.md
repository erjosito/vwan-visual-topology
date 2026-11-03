# Azure Networking Simulator (Preview) — Empirical Live Azure Verification (2026-11-03)

## Overview

This directory contains the empirical Azure validation artifacts, generated Bicep templates, and live Azure control-plane captures (`uc1-capture.json` through `uc5-capture.json`) used to validate the **Azure Networking Simulator (Preview)** (`src/azure-net/`) against a real Azure hub-spoke topology deployed in `rg-aznet-sim-lab-20261103` (`swedencentral`).

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

---

## Reproducing the Comparison

Run the automated test suite:

```bash
npm test -- src/azure-net/engine.test.ts
```
