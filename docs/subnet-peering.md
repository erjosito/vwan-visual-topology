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
- [ARM/Bicep peering schema, 2024-05-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2024-05-01/virtualnetworks/virtualnetworkpeerings):
  exact exported property names and types.
- [Route Server FAQ](https://learn.microsoft.com/en-us/azure/route-server/route-server-faq#can-i-apply-a-route-map-to-a-spoke-thats-connected-by-subnet-peering):
  ARS VNet connections/route maps are unsupported for subnet-peered spokes.
