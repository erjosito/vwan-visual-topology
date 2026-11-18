# Captured gateway BGP neighbors

The Azure capture view can inspect `vngBgpPeerStatus` observations from
`az network vnet-gateway list-bgp-peer-status`. Choose a captured gateway, then
one **local BGP endpoint**. Rows from other local addresses are never combined
in the default table. Missing local addresses remain explicitly unassigned.
Capture timestamps, partial/unknown coverage and missing counters stay visible;
an observed zero is different from a counter that was not captured.

These are historical source observations, not live session monitoring or
simulator-derived BGP establishment. Editing the design does not update them.
They belong to the imported capture, not the current selected simulator router.
Observations are session-local and are not added to native topology JSON or
uploaded automatically. Importing another design clears this view.

This is a bounded first step of #259, **not completed physical-instance
qualification**. A local address is not proof of a physical instance identity:
an instance can have IP aliases. The view does not guess alias mappings, invent
instance IPs, duplicate resource-level relationships or infer a second active
speaker for an active/standby VPN gateway. Configured gateways without captured
observations have no inferred neighbor table. ARS, MSEE and simulator-generated
instance/session inspection remain separate follow-up work.

The collector retains reported prefix counts, connected duration and message
counters when present. Legacy captures without them show **Not captured**, not
fabricated defaults. Malformed recognized neighbor observations are rejected
rather than converted into a successful empty list. A BGP-only capture can be
inspected without requiring an unrelated NIC effective-route observation.

The initial increment used synthetic tests. Subsequent #259 Azure lab captures
confirmed two active VPN endpoints versus one active/standby endpoint, including
native self-address rows with state **Unknown** and zero counters. Private
native-output replay through the importer and both web modes checks exact
endpoint-scoped rows, states, durations and counters. The committed fixture is
still synthetic; no private capture or original resource identifiers are included.

The importer also retains collector-projected ARS advertised routes and accepts
BGP route observations without NIC observations or a neighbor table. Local
addresses, next hops, AS paths and missing `sourcePeer` stay as captured; a next
hop is not substituted for the advertising neighbor.

This is not full simulator-to-Azure BGP route-result parity. Gateway advertised
route collection, captured ARS route/neighbor inspection, physical-instance
bindings, MSEE/provider sessions and data-plane/failover qualification remain
outside these bounded checks. Historical lab results do not certify sessions
after later configuration drift.

Reference: [Azure BgpPeerStatus fields](https://learn.microsoft.com/en-us/dotnet/api/microsoft.azure.management.network.models.bgppeerstatus).

## Standalone VPN gateway mode

The gateway editor exposes the existing `activeActive` field for standalone
VNet VPN gateways only. Active/standby has one active BGP endpoint; active/active
has two. Both have two physical instances. These are configuration semantics,
not observed addresses or proof of established sessions. The setting does not
apply to Virtual WAN gateways.

Newly authored standalone VPN gateways explicitly use active/standby, matching
the existing Bicep export default. Older native designs and captures without a
mode retain its absence and show **Unspecified (legacy design)**. Export keeps
its former active/standby fallback, now with a warning. A missing capture field
is no longer silently represented as an observed false value.

ARS route exchange requires active/active and ASN 65515, including for
VPN-static routes with VPN BGP disabled. The editor, diagnostics and Bicep export
warn when an enabled local ARS has branch-to-branch exchange enabled and the
VPN gateway does not explicitly meet both requirements. They do not reject old
designs or change the resource-level routing engine. Such simulated routes are
not qualification of unsupported combinations. Per-instance failure, failover
timing and physical alias/session mappings remain unassessed.

Reference: [ARS support for ExpressRoute and VPN](https://learn.microsoft.com/en-us/azure/route-server/expressroute-vpn-support).
