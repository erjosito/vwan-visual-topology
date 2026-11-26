# Subnet peering

H&S and Full Hybrid support direct IPv4 subnet peering. Open a peering's
**Configure Peering State & Flags** action, choose **Selected subnets**, select
participating subnets on both ends, and explicitly apply the scope.
Selections remain draft until applied. Original subnet IDs, not display names,
define membership; renaming does not change it. Deleted/wrong-owner references
are errors, never an instruction to peer the whole VNet.

The **Selected subnet peering** sample connects `a1` to `b1` while leaving `a2`
and `b2` outside the forwarding scope.

## Routes versus forwarding

This models the behavior documented for the current subscription-flagged
preview, not a prediction of future GA behavior:

- Every local subnet sees peering routes for the **remote participating subnet
  prefixes**, including local subnets that do not participate.
- A direct packet can cross the peering only when both the source and destination
  subnets participate and ordinary directional VNet-access flags allow it.
- The visible route from an unselected source does not establish delivery.
  Return routing is checked independently.

This is neither an NSG nor `disablePeeringRoutePropagation`. Existing whole-VNet
peerings retain full remote address-space routes and their prior access behavior.
Local VNet routes, subnet ownership and manually saved coordinates are unchanged.

## Native contract and validation

The existing version-2 peering ID and endpoints remain:

```json
{
  "scope": {
    "type": "subnets",
    "subnetAIds": ["original-subnet-in-vnetAId"],
    "subnetBIds": ["original-subnet-in-vnetBId"]
  }
}
```

Omitted `scope`, or `{"type":"whole-vnet"}`, means legacy whole-VNet peering.
One shared pair of sets defines reciprocal scope; contradictory directional
declarations are not invented. Directional access/forwarding/transit flags remain
separate. Membership is preserved through native JSON, share/storage/history and
the shared web/CLI/MCP/Electron engine.

Validation checks one link per distinct VNet pair, unique owned references,
1-200 selected subnets per side, at most 1,000 remote selected subnets across a
VNet's links, participating parent-address-space restrictions and cross-link
address-space uniqueness. Invalid scopes cannot certify reachability or isolation.

## Isolated overlapping VNets

H&S and Full Hybrid allow separate VNets to reuse IPv4 prefixes and workload
addresses. Packet probes bind each workload to its original VNet, subnet and NIC,
and repeated workload addresses include the network name and ID in the selector.
Routing still decides where the packet goes: choosing a remote workload does not
redirect an address that routes locally.

Ordinary whole-VNet peering rejects overlapping address spaces on its two ends.
Selected-subnet peering retains the participating-parent restrictions above; it
is not a general workaround for those constraints. Unresolved overlapping
destinations reached through shared transit or conflicting remote peering routes
are explicitly not assessed rather than assigned to the first matching VNet.

Existing single-service public mappings and qualified NAT Gateway/Firewall
behavior retain original network context. Bounded Private Link Service forwarding
is described below. This does not add proxy behavior, general multi-stage NAT, or overlap qualification for
the legacy standalone VWAN provider. Bounded HA-ports steering retains its
separately documented ownership restrictions.

### Composed private SNAT

H&S and Full Hybrid also support TCP/UDP workload-to-workload paths through
two to four original NVA VMs with explicit `nva-snat` declarations. Use the
existing original NVA SNAT editor for each waypoint. Each rule matches the
tuple visible there, including source translation from the preceding NVA.
The packet panel and MCP expose both mappings and their conditional inverses.
Each inverse requires an independently checked route to the exact original
translator, followed by its return route. A different router, missing route or
loop does not establish a response mapping. Subnet and NIC filtering uses the
tuple visible at each boundary; source ports remain illustrative.

This slice does not qualify arbitrary public or DNAT chains, managed hubs,
VPN/gateway composition or HA-ports steering. Existing single-service NAT and
classic Firewall-to-NAT-Gateway support are unchanged. No live guest NAT rules,
session state or application delivery are verified.

### Private Endpoint to provider forwarding

H&S and Full Hybrid can trace an explicitly approved original Private Endpoint
connection to an original Private Link Service and Standard internal Load
Balancer. Two unpeered consumers can reuse the same addresses, including provider
addresses. The service binding does not create general provider VNet transit or
access to another consumer.

Open **VNet detail > Private Link services and connections** in the provider VNet
to declare its original LB frontend, provider NAT subnet/address and provisioning
state. Disabling Private Link Service network policies is an explicit subnet
change. Bind each consumer's original Private Endpoint to that service and
declare the connection approval. Select the Private Endpoint as the packet
destination. Existing LB authoring controls its original backend pool, ordinary
TCP/UDP rules, declared health and probe filtering.

Native version-2 inventory stores `privateLinkServices[]` with `owner`,
`loadBalancerId`, `frontendId`, `natIpConfigurations[]` (`id`, `subnetId`,
`privateIp`), `provisioningState` (`succeeded` or `unknown`) and `proxyProtocol`.
`privateEndpointConnections[]` stores `id`, `privateEndpointId`, `serviceId` and
`state` (`approved`, `pending`, `rejected`, `disconnected` or `unknown`).
The provider subnet uses `privateLinkServiceNetworkPolicies: "Disabled"`.
Original associations survive native JSON, history, storage and shared
web/Electron/CLI/MCP execution. The Bicep starter warns that it omits these
service resources and bindings. Captured or retained unknown fields alone do not
establish a service binding or approval.

Evidence separates the original consumer and provider networks, the PLS
source/destination mapping, LB destination mapping, visible filtering tuples and
independently checked return routes. Provider SNAT uses the declared NAT address,
not the consumer address. Port allocation and backend selection are illustrative.
Conditional responses are not unsolicited reverse connections or live sessions.
Source filtering, enabled PE subnet filtering, backend data filtering and health
probe filtering remain separate.

This qualified configuration slice requires one provider NAT configuration,
declared successful provisioning, an approved connection, ordinary non-floating
NIC-backed LB rules and no additional routers. Multiple NAT configurations,
Proxy Protocol v2, HA ports, inbound-NAT-only bindings, Direct Connect preview and
Application Gateway private connectivity remain not assessed. Missing capture
relationships, unknown approval and unknown backend health cannot pass.

The provider model follows Microsoft's
[Private Link Service overview](https://learn.microsoft.com/en-us/azure/private-link/private-link-service-overview),
including provider source NAT, approval, supported protocols and Standard LB
integration. Qualification here is synthetic configuration testing, not live
Azure service, provisioning, allocation or application validation.

## Supported boundaries

Gateway/ARS/VWAN/appliance composition, private endpoints, delegated-subnet
over-advertisement, IPv6 and AVNM orchestration are not qualified by this feature.
When an enabled subnet peering involves a declared gateway, ARS, appliance,
VWAN attachment, private endpoint or delegated subnet, control-plane coverage
is explicitly incomplete and flow/route requirements are **not assessed**.
Partial route displays are not complete effective-table evidence.
Remote ARS peers over subnet peering are explicitly unassessed, and ARS VNet
route-map connections are not offered for these links.

## Collection and deployment

The read-only Azure collector preserves `peerCompleteVnets`, `localSubnetNames`,
`remoteSubnetNames`, `enableOnlyIPv6Peering` and subnet delegations. Import resolves
subnet names to their original owning IDs. A selected-subnet capture must include
both VNet ends and matching local/remote membership in both directions. Missing,
contradictory, unknown-name or IPv6-only scopes are rejected, not widened.
Older captures that omitted these properties cannot establish that an existing
Azure peering used whole-VNet rather than subnet scope; recapture with the updated
collector before drawing conclusions about actual Azure configuration.

The Bicep starter emits mirrored subnet-name lists and `peerCompleteVnets: false`
using API `2024-05-01`. Review its warnings: changing between whole-VNet and subnet
peering requires **deleting and recreating the Azure peering**. Membership edits
update and synchronize the existing link. Changing the simulator's design does
not perform either operation in Azure.

No Azure provisioning or live enablement validation was performed. Subscription
allowlisting, management-tool availability and the documented VM-generation
restriction must be checked separately. No NSGs, delegated services, AVNM actions
or unmodeled transit prerequisites are implied by this infrastructure starter.

## Sources

Reviewed 2026-11-18:

- [Configure subnet peering](https://learn.microsoft.com/en-us/azure/virtual-network/how-to-configure-subnet-peering):
  participating sets, preview route visibility versus forwarding, address-space
  restrictions, 200/1,000 limits, update/sync, delete/recreate, delegated-subnet and
  VM SKU limitations.
- [Manage virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-manage-peering#requirements-and-constraints):
  ordinary peering requires non-overlapping address spaces on its two ends.
- [ARM/Bicep peering schema, 2024-05-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2024-05-01/virtualnetworks/virtualnetworkpeerings):
  exact exported property names and types.
- [Route Server FAQ](https://learn.microsoft.com/en-us/azure/route-server/route-server-faq#can-i-apply-a-route-map-to-a-spoke-thats-connected-by-subnet-peering):
  ARS VNet connections/route maps are unsupported for subnet-peered spokes.
