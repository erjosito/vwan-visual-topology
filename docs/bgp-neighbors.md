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
| Standalone active/active VPN | Two active modeled speakers, each related to the configured site | Endpoint IPs and independent instance failures are not modeled |
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

## Sanitized reference and expected adjacency matrix

`tests/fixtures/bgp-neighbors.ts` extends the public synthetic two-ARS/multi-NVA
reference with active/active VPN, an isolated active/standby VNet, a site and
opaque ER relationships. It contains no supplied private design, Azure
resource identifiers or captured endpoint addresses.

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
