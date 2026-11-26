# Simulated BGP neighbors

Choose **BGP neighbors** in the context menu of an original ARS, NVA, gateway,
on-premises router, ExpressRoute location or Virtual WAN hub. Use right-click
or focus the element and press **Shift+F10**; the inspector opens with that
resource selected. Elements without BGP inspection do not offer the action.
The inspector is available in both native workspace providers, on the
web and in offline Electron. Inspection never edits topology or coordinates.

Select one **Local BGP resource**, then one **Local BGP instance**. The summary
contains only that instance's neighbors. Changing canvas selection does not
silently repoint this read-only inspector; explicitly opening **BGP neighbors**
again starts the requested resource scope. A deleted resource, instance or
neighbor is not silently replaced.

Filter neighbors by name, original resource key, ASN, address or connection.
Choose a row for received/advertised logical route candidates, prefix
filtering and expandable original route evidence. **Inspect from peer** opens
the reverse resource/instance perspective. **Copy neighbor summary** preserves
the local scope, availability and logical count labels. Tables remain
keyboard-accessible and horizontally scrollable on narrow screens. English
and Japanese are supported.

## What the rows mean

**Modeled relationship available** is a steady-state configuration assessment,
not BGP **Established**, TCP connectivity, convergence or packet delivery.
Unavailable configuration and not-assessed evidence are separate states.
No FSM, uptime, message counters, physical failures or failover timing are
invented.

Counts are distinct prefixes in a **logical relationship**, not measured
per-instance counters. ARS speaker perspectives share the resource-level
engine evidence; the engine does not model independent speaker policies,
failures or divergent advertisements. Duplicate advertisements from distinct
modeled neighbors remain separate rows.

Received evidence is logical post-policy reception. For NVA-to-ARS exchange,
advertised candidates are snapshotted before the ARS inbound route map, after
the existing eligibility and AS-loop checks. This is not a raw native
received routes before import policy (Adj-RIB-In). **Peer received** is explicitly post-policy and must not be
misread as the local router's pre-policy advertisements. Where that distinction
cannot be supported, advertisements/counts remain **Not assessed**.

An assessed empty logical candidate set shows zero; missing or incomplete
control-plane evidence does not. `?` in these compact route tables means
instance best-path selection is not assessed. The forwarding next hop is not
necessarily the advertising neighbor. Existing gateway-summary unknowns
remain unknown; these views do not resolve #233 or #298.

Historical [captured BGP observations](bgp-observations.md) stay in **Azure
files**, with their original endpoint scope, timestamps and native fields.
They are not merged into simulated rows or updated by configuration edits.
That view also exposes managed-gateway learned routes by exact captured local
address and explicit source peer, including route-only captures. These are
native historical rows, not the simulated inspector's shared logical counts;
they do not supply missing ER circuit/MSEE or physical-alias mappings.

## Identity and managed boundaries

### Two ExpressRoute circuits to one classic gateway

In Full Hybrid mode, use two independent ER location/circuit abstractions and
four ER links: one site link and one Azure gateway connection per circuit.
Reusing a site ID or gateway ID does not merge the circuit candidates.
These abstractions do not identify the physical primary/secondary MSEE sessions.

Open **Configure ER connection** to set **Azure connection routing weight**
(integer 0-32000, default 0). **Set Routing Weight** opens this same validated
editor instead of a separate preset submenu. For the same prefix, higher weight
precedes shorter AS path. Weight stays local to Azure and does not influence the site's
reverse-direction selection. Open the **site ER link** to set
**Site-to-Azure AS-path prepend**. Customer private ASNs and their prepends
are retained on private peering. Use site inbound route-map local preference
for reverse-direction policy.

Gateway evidence retains preferred and nonpreferred circuit candidates.
Subnet effective routes retain equal-cost connection identities; route labels
name the connections. Equal-cost eligibility does not simulate packet hashing
or traffic distribution. A flow follows one deterministic eligible circuit
and says so. Disable a connection/site link or select an empty advertised-prefix
list for steady-state withdrawal. Destination lookup still uses longest prefix.

These controls are shared by web and Electron. Full Hybrid VWAN hub connections
keep their existing weight and inbound prepend behavior. Classic Azure-facing
gateway prepend values from JSON are preserved but not modeled; configure the
site link instead. Legacy site-link weights are preserved on edit but are not
Azure connection weight controls. Standalone VWAN mode does not acquire Full
Hybrid weight/prepend support. MED, physical-session ECMP distribution and
convergence timing are not assessed. See the scoped
[dual-ER lab findings](../verification/dual-er-private-peering.md).

### Managed relationships

Managed resources now have a default **Managed peer relationships** table,
with the original peer name, known remote ASN, relationship type, connection
ID and enabled configuration. VWAN hubs use ASN **65515**, ER/MSEE location
aggregates use **12076**, and sites and standalone VPN gateways retain their
configured ASNs. Same-WAN hubs have an automatic inter-hub routing row;
separate WANs do not acquire an invented adjacency.

These resource-level relationships are not a physical BGP neighbor matrix.
**Not observed** describes session state only, not the known ASN or connection.
Original ER links remain separate; legacy direct site/hub ER connections are
labeled as routing relationships with an unmapped edge, not direct site/hub
BGP peers. Static VPN and explicit inter-WAN static routing show
**Not applicable (static routing)** rather than a BGP session.
Filter the managed table by name, resource ID, ASN or connection, and select
a peer to inspect the reverse perspective. Mapping and provenance are
expandable rather than repeated before useful configuration.

The shared `BgpInspection` contract separates resource keys, local instance
IDs, remote instance IDs, relationship/connection IDs and directional neighbor
IDs. Keys are tuples of original kind/ID/role, not names or ASNs. Names can
change without replacing identities. Save/load retains the original topology
IDs; inspector state and projected roles are not new saved configuration.

| Resource/relationship | Exposed modeled scope | Explicit limitation |
| --- | --- | --- |
| ARS and eligible local/directly peered NVA | Two stable ARS roles; NVA retains both distinct remote neighbors per ARS | Roles are not captured array indices, physical instance identities or inferred IPs |
| NVA | One logical router, authored private IP and configured memberships | No vendor internal instances or independently measured endpoint route sets |
| Standalone active/active VPN | Legacy: two active modeled speakers; explicit `vpnInstances`/`tunnels`: original IP-configuration identities and only configured tunnel relationships | No inferred full mesh or Established state; per-instance failure is scoped only with explicit bindings |
| Standalone active/standby VPN | One active modeled speaker | A physical standby still exists; no second established standby neighbor is invented |
| Legacy VPN with absent `activeActive` | Multiplicity not assessed | Original absence and existing routing behavior are preserved |
| ARS/gateway exchange | Unmapped managed relationship | B2B disabled is not proof of no native session; ARS/VPN exchange requires explicit active/active and ASN 65515 |
| ER location, ER gateway | Original connection and MSEE aggregate relationship; known ASNs | A location aggregate is not an ER circuit or physical MSEE/gateway instance; no primary/secondary full mesh is inferred |
| VWAN hub/gateways | Same-WAN inter-hub, ER and configured VPN/NVA relationships; ASN 65515 | A hub is not one BGP speaker; standalone VPN active/standby controls do not apply |
| On-premises site/site link | Original site and logical relationship | Vendor internals, managed remote mappings and unsupported route directions stay unassessed |

Managed relationships have separate enabled/disabled logical exchange
metadata, not fabricated session rows. ARS and gateway addresses are never
derived from subnet offsets. Captured role/IP aliases are not bound to the
modeled roles without separate evidence.

Browser, Electron and local platform results share this pure projection.
`simulate`/`evaluate` expose `bgpNeighbors`; the MCP's bounded `get_evidence`
accepts that section. Concatenate all returned chunks before parsing JSON.
The existing output budgets and unknown-result semantics still apply.

For [instance-bound classic VPN](gateway-coexistence.md#instance-bound-vpn-and-apipa-bgp),
each neighbor's `vpnTunnel` evidence retains its original connection/tunnel,
gateway instance/IP configuration, expected BGP endpoints, shared-CPE peer
lookups, transport dependency and per-session route provenance. Explicit tuple
observations and their expected/observed comparisons are labeled separately;
an unexpected attempt does not erase a valid APIPA exchange or establish the
cause of an outage. The inspector's existing **Session identity and
provenance** disclosure exposes this evidence. Connection routing settings
also expose read-only per-tunnel evidence and preserve native bindings.
Legacy topologies without explicit mappings retain their qualified logical
speaker behavior. Imported native endpoint configuration alone does not supply
missing CPE membership or establish any sessions.

## Sanitized reference and expected adjacency matrix

`tests/fixtures/bgp-neighbors.ts` extends the public synthetic two-ARS/multi-NVA
reference with active/active VPN, an isolated active/standby VNet, a site and
opaque ER relationships. It contains no supplied private design, Azure
resource identifiers or captured endpoint addresses.

## Peered-VNet ARS/NVA reflection (#447)

[Issue #447](https://github.com/erjosito/vwan-visual-topology/issues/447)
records a [reviewed, public Azure-only lab report](https://github.com/erjosito/azure-lab-ars-nva-bgp-20261123) for
[#259](https://github.com/erjosito/vwan-visual-topology/issues/259):
two Standard ARS resources, one local source NVA each, and one shared reader
in a VNet directly peered to both. Gateway-transit/use-remote-gateways flags
were false. Eight actual endpoint sessions were Established and their
local/remote identities were independently checked.

With both ARS B2B flags off, native ARS learning and local NIC routes retained
the source prefixes, but both native advertisements to the reader and its
BIRD RIB contained only VNet prefixes. Enabling **west only** advertised west
source prefixes from both west endpoints while east remained negative.
The revised **both-B2B-on** suite independently checked baseline duplicate
prefixes, west source export filtering to the common prefix, west withdrawal
with sessions retained, and restoration; east remained a positive control.
The original failed baseline is not relabeled as a passing test.
Both original ARS flags were restored and verified false. Final
ownership-verified resource cleanup belongs to the lab's `results.json` and
#259, not this code change.

West native learned attributes were path `65010`, next hop `10.70.1.4`.
Native advertised and BIRD received attributes were path `65515 65010`,
next hop the **actual advertising ARS endpoint** (`10.70.0.5` or `.4`).
Native API AS-path strings use hyphens; BIRD uses spaces. This is wire
metadata, **not an ARS data-plane forwarding hop**.

The deterministic application fixture uses different synthetic addresses,
ASNs and documentation prefixes; it is not a dump of that lab. Both fixture
ARS resources explicitly enable B2B for positive shared-reader assertions.
The engine/inspector contract is:

- Different-VNet NVA reflection is gated per exporting ARS; sessions,
  source inbound routes, local NIC routes and VNet advertisements are not.
  The west-only regression preserves an independent east negative control.
- `nvaBgpPeers[].routes` is the receiver-side projection. Different-VNet
  NVA paths prepend `65515` **after** supported outbound policies. Each
  `sourceRoute` is a detached copy of the ARS-learned candidate **before**
  outbound policy, with its original source VNet/NVA/path/next hop.
- `wireAttributes.nextHop=not-assessed`, and wire `nextHopIp` is absent.
  The topology has no managed ARS endpoint bindings. Native captured
  endpoints/paths remain in their original observation scopes; they are
  neither fabricated nor mapped by capture-array order to modeled roles.
- An available peer can have zero lab prefixes while retaining VNet
  advertisements. Missing/incomplete evidence is not an assessed empty set,
  and unavailable peers do not acquire fabricated empty observations.
- `routeServerOutbound` remains the source-side policy/SDN projection,
  **not receiver wire attributes**. A spoke's SDN export is not blanket-gated
  by the NVA reflection rule; policy-assignment scope remains unchanged.
- Same-VNet prefix eligibility retains legacy behavior, explicitly
  **not assessed** for B2B applicability. Its wire AS path, and gateway-source
  wire AS paths, are omitted rather than presenting source paths as measured
  receiver attributes. Existing forwarding reasoning remains separate.

Only local-source to peered-reader reflection was live-qualified. Reverse
reader-origin reflections in the synthetic fixture exercise the scoped
different-VNet model, not another live certification. Same-VNet behavior,
native route maps, gateway-summary reception, physical ER/MSEE identity,
packet/kernel delivery, ECMP, timing/convergence and failure orchestration
are not certified by these results. Stable modeled endpoint-role identities
and logical counts are preserved through B2B edits and source filter/withdraw/
restore; they are not independent measured per-instance counters.

## Expected adjacency matrix

| Selected local resource + role | Expected remote resource + role | Evidence |
| --- | --- | --- |
| `reader` + logical router | `west-ars` + ARS 1 and ARS 2; `east-ars` + ARS 1 and ARS 2 | Four separate modeled neighbors; shared logical candidates, not four observed native Adj-RIBs |
| `west-source` + logical router | `west-ars` + ARS 1 and ARS 2 | Same-VNet ARS/NVA exchange |
| `east-source` + logical router | `east-ars` + ARS 1 and ARS 2 | Same-VNet ARS/NVA exchange |
| `west-ars` + either selected ARS role | `west-source` + router; `reader` + router | Two rows per selected local role, not a flattened four-row default |
| `east-ars` + either selected ARS role | `east-source` + router; `reader` + router | Two rows per selected local role |
| `vpn-aa` + either selected active role | `branch` + router | One logical remote neighbor per selected active role |
| `vpn-as` + active role | `branch` + router | One active perspective, no standby session row |
| `branch` + logical router | `vpn-aa` + active 1 and active 2; `vpn-as` + active | Three modeled remote perspectives |
| ER location/gateway and ARS/gateway boundaries | Unknown managed instance mapping | Separate relationship disclosure; no qualified native neighbor matrix |
| Native VWAN hub | Unknown managed gateway/edge mapping | No invented hub speaker or standalone mode |

Focused regressions cover reverse inspection, original identity through rename
and save/load, pre/post-policy distinctions, multiple NVAs sharing a peered-VNet
policy connection, duplicate prefixes, zero/unavailable/unknown states,
incomplete simulation, B2B/disabled configuration, unavailable resource owners
and AA/AS/legacy mode. Browser checks additionally cover explicit reopening,
deletion, instance switching, immutable saves, keyboard, narrow accessibility
and Japanese. Compiled platform/MCP parity and offline Electron exercise the
same reference. Production checks prohibit eager inspector/projection loading.

The native version-1 two-hub fixture also has independent ER and VPN
connections. A local MCP validation/evaluation (contract 1, engine
`2026.11.16.2`) satisfied exact-prefix presence checks for `203.0.113.0/24`
in both hubs: the local hub selected ER with AS path `12076 65050`, and the
remote hub received the inter-hub path `65520 65520 12076 65050`.
This checks the existing routing context, not session establishment or live
withdrawal. Known peer/ASN presentation, scoped identities, native save
immutability and EN/JA keyboard accessibility are separate application tests.

This implementation is a bounded increment of #259, not completion of native
managed-instance qualification. Previously recorded VPN observations are
historical, not fresh ER/VPN validation by these tests. The separately approved
ARS/NVA Azure lab has its own execution, evidence and ownership-verified cleanup
gate; deterministic tests are not reported as live Azure results.

## Source-backed expectations

- [ARS FAQ: peer every NVA with both ARS instances](https://learn.microsoft.com/en-us/azure/route-server/route-server-faq#do-i-need-to-peer-each-nva-with-both-azure-route-server-instances)
- [VPN BGP configuration considerations](https://learn.microsoft.com/en-us/azure/vpn-gateway/configure-bgp#bgp-configuration-considerations)
- [ARS ExpressRoute/VPN support and prerequisites](https://learn.microsoft.com/en-us/azure/route-server/expressroute-vpn-support)
- [ExpressRoute primary/secondary peering addresses](https://learn.microsoft.com/en-us/azure/expressroute/expressroute-routing#ip-addresses-used-for-peering)
- [Virtual WAN managed ASN](https://learn.microsoft.com/azure/virtual-wan/connect-virtual-network-gateway-vwan)
- [Virtual WAN inter-WAN static VPN constraints](https://learn.microsoft.com/azure/virtual-wan/virtual-wan-connectivity)
- [Azure gateway and MSEE ASNs](https://learn.microsoft.com/azure/networking/connectivity-interoperability-control-plane)

ER/VPN coexistence rules are tracked separately in #334; neither this
inspector nor the ARS/NVA lab implements that follow-up.
