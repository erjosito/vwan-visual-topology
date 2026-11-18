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

No live Azure qualification was performed for this increment. The committed
fixture is synthetic and is explicitly labeled as such.

Reference: [Azure BgpPeerStatus fields](https://learn.microsoft.com/en-us/dotnet/api/microsoft.azure.management.network.models.bgppeerstatus).
