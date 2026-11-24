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
observations have no inferred captured neighbor table. The separate
[simulated BGP neighbor inspector](bgp-neighbors.md) exposes modeled
resource/local-role relationships without treating these historical captures
as current state. Captured ARS neighbors and physical MSEE/session mappings
remain separate follow-up work.

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

## Native VPN endpoint configuration

When a capture includes native `vnetGateways` configuration, **Native VPN IP
configurations** retains the original gateway and IP-configuration IDs, assigned
default/custom BGP addresses, and tunnel addresses. The association uses the
explicit `bgpPeeringAddresses[].ipconfigurationId` reference matched to a
captured IP configuration, not array ordering. Foreign/missing references or
malformed addresses remain unknown instead of receiving invented associations.
Inventories and address arrays are bounded to 64 entries.

These are configuration observations, not physical VM identities, native
session state or evidence of failover. Assigned BGP addresses can be selected
even in configuration-only captures, but missing neighbors/counters remain
missing. Tunnel addresses are shown separately and are never added as BGP
neighbors. Default and custom addresses remain distinct in the details.
Nothing is bound to the simulator's projected speaker roles or saved topology.

The separately approved #259 lab verified the native configuration shape for
active/active (two referenced IP configurations) and standalone active/standby
(one referenced active configuration). This does not claim one physical
instance for standby, complete physical aliases, ER/MSEE mappings or live BGP
establishment. `gateway-native-endpoints-capture.json` is a synthetic regression
fixture; it contains no original lab identifiers or secret values.

## Captured managed-gateway learned routes

The same lazy Azure capture inspector now exposes `vngLearnedRoutes`, collected
by `az network vnet-gateway list-learned-routes` for VPN and ExpressRoute virtual
network gateways where the command returns records. Unsupported or denied reads
are not successful empty route sets. Select the original captured gateway key
and exactly one **Local BGP endpoint**. Endpoint choices come from explicit local addresses in
the captured neighbors and learned routes, or explicit native VPN BGP assignments, not from configured redundancy,
array positions or subnet offsets. Routes without a local address are separately
**Unassigned**; they are never attributed to a known endpoint.

The learned-route table preserves duplicate prefixes, native AS paths (including
empty paths), next hops, source peers, Azure route origin (not BGP ORIGIN) and
zero weight. Null optional attributes remain missing, not fabricated defaults.
Filter by an explicit **Source peer**, or choose **Inspect captured routes** on a neighbor
with matching source-peer evidence at that exact local endpoint. A forwarding
next hop is never used to make that match. Rows without a source peer remain
separately inspectable. Changing gateway or endpoint resets the peer filter.
Importing another capture resets gateway, endpoint, peer and page selection,
even when its resource keys or timestamp match the previous capture.
Tables show at most 100 routes per page and accept at most 10,000 rows per
gateway and 256 captured gateway keys; malformed/oversized route data is
disclosed as incomplete, even if the capture section claimed completeness.

Route-only captures do not need a neighbor table or NIC observation. Conversely,
a captured neighbor does not imply that routes were collected. Historical
neighbor counters and learned rows remain independent: apparent disagreement
is not resolved by rewriting native counters or deriving session state from
route rows. Capture time, original gateway/local endpoint scope and per-command
coverage remain visible. Missing/failed/empty observations are not proof of an
empty per-session learned-route table, withdrawal, convergence or session failure.

This adds read-only per-endpoint managed-gateway coverage, not physical-instance
qualification. An ER virtual network gateway is not a circuit, primary/secondary
MSEE pair or peering-location speaker. No such bindings or native alias mappings
are inferred. The committed gateway-route fixture
and browser/offline tests are synthetic; this increment performs no fresh Azure
reads and claims no new ER/VPN live qualification.

This is not full simulator-to-Azure BGP route-result parity. Captured ARS neighbor inspection, physical-instance
bindings, MSEE/provider sessions and data-plane/failover qualification remain
outside these bounded checks. Historical lab results do not certify sessions
after later configuration drift.

## Captured managed-gateway advertised routes

With `-IncludeEffectiveRoutes`, the collector queries
`az network vnet-gateway list-advertised-routes --peer <neighbor>` once per
distinct captured remote address. Native self-address rows are not remote
query targets. `vngAdvertisedRoutes[gateway][requestedPeer]` retains the
requested **advertised-to peer** separately from each row's `localAddress`,
`nextHop` and optional `sourcePeer`. The request is never inserted as a source
peer. Per-command coverage distinguishes successful empty data from denied,
unsupported or failed reads; these failures do not invalidate otherwise
complete configuration capture. Missing remote addresses leave the gateway's
advertisement inventory incomplete, even when its known-peer queries succeed.

Choose the local endpoint first, then expand **Captured gateway advertised
routes**, or use **Inspect advertised routes** on a captured neighbor.
The table preserves duplicate paths, empty/native AS paths, zero weight and
missing source attributes. A different local endpoint's rows stay excluded;
missing local addresses remain **Unassigned**. Peer choices, rows and pages are
bounded to 256 peers, 10,000 rows per requested peer and 100 rows per page.
Malformed observations cannot establish complete coverage. Capture replacement
resets selection; inspection does not change topology or saved simulation state.

These are historical, command-reported advertisements, not proof of peer
acceptance, pre/post-policy parity, route installation or packet delivery.
No primary/secondary MSEE binding, physical identity or live FSM is inferred.
The separately approved #259 provider lab supplies native gateway output shapes;
the committed advertisement fixture remains synthetic and contains no lab IDs.

## Captured ARS learned and advertised routes

The Azure capture view also exposes historical ARS routes. Choose the original
`route-server/peering` key, learned versus advertised direction, and one captured
local role/address. The collector retains Azure's `RouteServiceRole_IN_0` or
`RouteServiceRole_IN_1` envelope key as `localRole` on each projected route,
instead of discarding it when flattening the two arrays.

An Azure role is not a guessed physical identity or IP-alias mapping. Legacy
rows without a role can still be scoped by their captured local address; rows
without either remain explicitly unassigned. Endpoints with no rows are not
invented from an expected redundant pair. A missing row does not establish an
empty learned-route table, a disconnected peer or successful withdrawal.

Next hop and source peer remain separate. Native hyphenated or empty AS paths,
zero weight and missing attributes are preserved. The view renders at most 100
rows per page, accepts at most 10,000 rows per peering/direction and 256 peering
keys, and reports malformed/oversized observations instead of asserting complete
coverage. It does not mark observed routes as simulator best paths.

These observations remain capture-session data, not saved topology configuration.
No new Azure reads, deployments, route advertisements or packet-delivery claims
are introduced by this inspection view. Captured ARS neighbor state and complete
physical-instance bindings remain separate follow-up work.

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

## Modeled route-table status

Compact modeled BGP tables use `*` for a unique preferred candidate, `=` for
multiple equally ranked candidates, and `-` for an alternative. These are app
selection markers, not IOS validity flags. Equal-length ER and VPN paths can
tie under the modeled site criteria; this does not confirm real-router ECMP
or a unique BGP best path. Router-specific tie-breakers and multipath policy
are not fully modeled. No default on-premises ER-over-VPN preference is inferred.

The distinction is preserved in accessible status labels and copyable text.
It does not change the routing engine, candidate retention or flow selection.
Received/advertised views still use `?` for unassessed selection, and NVA views
retain their separate ARS-selection scope, not an inferred NVA best path.
