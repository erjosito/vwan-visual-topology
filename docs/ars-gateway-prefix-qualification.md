# Gateway summaries and NVA received routes

## Supported boundary

`summarizedGatewayPrefixes` configures gateway advertisements, not local
address ownership. For ER/VPN connections without an overriding map, in the snapshot model
configured summaries replace covered hub/spoke advertisements, uncovered prefixes
remain, independent prefixes are allowed, and aggregate holes do not become
reachable. A gateway and GatewaySubnet are required for gateway summarization.
Spoke-local configuration does not configure the hub's gateway.

An inbound or outbound ARS route-map association on a particular ER/VPN
connection takes precedence over `summarizedGatewayPrefixes` for that connection,
even when the map itself has no summarization rule. The snapshot model applies
this documented override per connection; other connections retain their previous
modeled behavior, and removing the association restores modeled summaries.
This does not establish which summary routes an NVA receives from ARS.

**First-map creation is a separate, unqualified transition.** The FAQ documents
a software upgrade triggered by creating the first route map. A user reported
VPN prefix loss after this creation even without any connection associations
(#298). The cause and ER behavior are not established. The snapshot model does
not track that upgrade history; an empty map/assignment list or map deletion does
not prove legacy software state or restore it. The fresh first-map attempts
below failed and also encountered independently recorded VNet configuration drift.
A separate sole-VPN recovery control subsequently observed AGP taking effect
after a successful unassigned-map recreation and fresh AGP reapplication. This
does not qualify the original first-map transition or arbitrary unassigned-map
topologies.

**Automatic ARS-to-NVA summary projection remains unassessed.** The bounded live
observations below do not qualify every gateway/peer combination. Do not interpret the displayed
ordinary received candidates, or absence of a configured summary among them, as
proof of actual Azure advertisements. Do not substitute an ARS RIB or a hosting
subnet's effective routes for an NVA's received BGP table.

For each configured original NVA/ARS pair whose exporting VNet has configured
summaries, `simulation.nvaBgpPeers[id][].gatewaySummaryAssessment` records:

- `status: "not-assessed"` and the configured prefixes;
- original enabled gateway IDs and GatewaySubnet ID, when present;
- the exporting ARS branch-to-branch setting.

The inspector shows the boundary independently for each original ARS and respects
its selected peer filter. Clearing/removing summaries removes that annotation.
No new summary routes, NVA best path, or forwarding behavior are manufactured.
Peer availability and export qualification are separate.

## Authoritative evidence reviewed 2026-11-18

[Advertised gateway prefixes overview](https://learn.microsoft.com/en-us/azure/virtual-network/advertised-gateway-prefixes-overview)
documents ER/VPN gateway advertisements to on-premises, covered-prefix suppression,
uncovered-prefix retention, independent summaries, and gateway prerequisites.
It explicitly says ARS is not required. It does not specify NVA received routes.

[Azure Route Server FAQ](https://learn.microsoft.com/en-us/azure/route-server/route-server-faq#can-i-use-route-maps-with-virtual-network-address-prefix-summarization)
says Route Server applies VNet summarization to ER/VPN connections and a route
map on such a connection takes precedence. It describes branch-to-branch route
exchange separately. Neither statement establishes whether gateway summaries
replace/coexist with connected advertisements sent to a BGP NVA.

## Coexisting ER/VPN observations (2026-11-18)

An approved lab recorded native ARS advertised routes and the local NVA's
retained **pre-import-filter Adj-RIB-In**, independently for both established
ARS endpoints. ExpressRoute and active/active VPN gateways coexisted in the
tested VNet. Their simultaneous presence prevents unique gateway-source
attribution; this is not separate ER-only and VPN-only qualification.

The following prefixes are synthetic replacements for the private lab address
plan, not native captures:

| Phase | Branch-to-branch | Configured gateway prefix | ARS outbound and actual local NVA receipt, both endpoints |
|---|---|---|---|
| Baseline | Off | None | Original `10.80.0.0/16` |
| Summary configured | Off | `10.80.0.0/13` | Original `/16`; configured `/13` absent in the bounded capture |
| Exchange enabled | On | `10.80.0.0/13` | Original `/16` **and** configured `/13` |
| Summary edited | On | `10.80.0.0/15` | Original `/16` **and** new `/15`; previously observed `/13` withdrawn |
| Summary cleared | On | None | Original `/16`; previously observed `/15` withdrawn |

Both positive native ARS role arrays retained their actual `localAddress`,
`asPath: "65515"`, matching local `nextHop`, `origin: "Igp"` and numeric
`weight: 0`. The independent NVA observations confirmed the original and
aggregate route sets. Role labels are not a physical-instance mapping.

The summary-off negative is scoped to the captured internal exchange: native
gateway summary origination and all four gateway-to-ARS endpoint pairs supplied
positive controls. It is not a universal absence claim or proof that external
VPN transport was healthy.

The run ended with 17 passing checks, two scoped negative observations and
eight unknown results. These counts include configuration and restoration checks,
not 27 independently qualified routing features. Exact configuration was
restored; both ARS branch-to-branch flags and all VNet summary properties were
returned to their original state. AA/AS operational baseline was verified after
a configuration-free re-initiation of the existing AA VPN profiles.

### Unknowns in the coexisting-gateway run

- **External VPN summary receipt:** the AA VPN positive control degraded during
  the summary windows. A wide aggregate overlapped the emulator's peer-loopback
  address; a narrower aggregate excluded it but did not recover the sessions in
  that window. Later baseline recovery does not retroactively qualify those
  observations or establish the cause.
- **ER-only, VPN-only and external MSEE behavior:** no external provider circuit
  was present; coexistence alone does not identify which gateway originated
  the summary received by ARS.
- **Directly peered NVA and one NVA on two ARS:** cross-VNet sessions were already
  disabled/down in the baseline. Empty output is not evidence of no routes.
- **Eligible uncovered spoke, outside prefix and gatewayless control:** the
  existing spoke did not use remote gateways, no outside-prefix positive control
  was established, and neither existing ARS VNet was gatewayless.
- **Route-map precedence in Azure:** no precedence experiment was performed.
  The FAQ's documented per-connection rule is distinct from these observations.
- **Aggregate holes and packet delivery:** BGP receipt does not establish a
  forwarding route or delivery to an address inside the aggregate.

## Fresh sole-VPN and first-map observations (2026-11-18 UTC)

A separate, newly created lab had one Route Server, an active/active VPN gateway,
a local BGP NVA and an independent IPsec/BGP receiver. There was no ExpressRoute
gateway or provider circuit. A covered spoke and an uncovered spoke used gateway
transit; outside-prefix controls did not overlap the configured aggregates or
the receiver's BGP peering addresses. No route map had previously been created
on this Route Server.

Before the first map request, both actual VPN receiver neighbors and both local
NVA/ARS neighbors were established. All four internal gateway/ARS endpoint pairs
also supplied positive controls. Actual retained pre-import-filter Adj-RIB-In
was captured separately per neighbor, not inferred from a selected best route.

| Pre-map phase | VPN receiver, both neighbors | Local NVA, both ARS neighbors |
|---|---|---|
| No AGP, no map definitions or assignments | Original hub, covered spoke, uncovered spoke and outside-NVA prefixes | Original hub, covered spoke, uncovered spoke and outside-on-premises prefixes |
| AGP configured, still no map definitions or assignments | Covering aggregate and independent AGP present; covered hub/spoke originals suppressed; uncovered and outside-NVA routes retained | Original hub/spoke and outside-on-premises routes retained; neither configured AGP received |

These are bounded sole-VPN observations. They qualify the pre-map gateway
advertisement controls and show why the earlier coexisting-gateway NVA result
must not be generalized: additive NVA summaries are not unconditional. They do
not identify the gateway source of the earlier mixed result or qualify ER.

### First unassigned map: failed operation and configuration drift

The first harmless, unassigned map request was accepted at 23:04:31 UTC.
Native Activity Log records terminal failure at 23:44:26 UTC. Azure returned
`ResourceOperationFailure` with a nested `InternalServerError`
(`An error occurred.`), with no further inner error. The map was Failed while
the ARS root remained Succeeded. This is asynchronous provisioning failure,
not evidence distinguishing a request-definition defect from a service/upgrade
failure.

A separate successful VNet PUT at 23:14:21-23:14:27 UTC used API `2022-07-01`.
Native resource-change evidence associates removal of both AGP entries and
addition of a subnet NSG reference with that same write/correlation. The lab's
earlier conditional AGP-set write used API `2026-03-01`; the set, map request
and concurrent VNet write had distinct correlations. No lab clear/restoration
write explains that property removal.

This proves concurrent VNet-property drift, not its purpose, the field-removal
mechanism, caller identity or route-map causation. Resource-change indexing time
was later than the native operation timestamps; those times are not interchangeable.
No security automation was disabled or modified to protect the experiment.

The causal comparison is therefore confounded: AGP configuration was not
continuously preserved across the pending map operation, and no successful
first-map completion was observed. Pending-state VPN captures did not have two
healthy, complete receiver tables; missing or incomplete output is **unknown**,
not proof that a prefix was withdrawn. Both local NVA neighbors remained
established with original and outside-on-premises routes in that bounded capture.

No map was resubmitted during that attempt. A separately authorized
post-success AGP reapplication control was not run because its success
precondition never occurred. Failure, map deletion or cleanup does not
establish a software downgrade.

#298 remains open. This attempt does not reproduce a completed first-map upgrade
ignoring still-configured AGP, establish global AGP disablement, qualify ER
behavior or justify a simulator rule based on mere map existence.

## Regional retry and sole-VPN recovery control (2026-11-19 UTC)

A supported map retry against the original lab returned
`ReferencedResourceNotProvisioned`: the parent ARS remained Failed after an
unsuccessful deletion. This explains that retry's blocker, not the original
map operation's internal error. The retained-resource cleanup failure is
tracked separately in #310.

A newly created West Europe lab repeated the sole-VPN design: active/active
VPN with ASN 65515, no P2S configuration, a local BGP NVA, an independent
IPsec/BGP receiver, and covered/uncovered gateway-transit spokes. No ER
gateway or provider circuit was present. Pristine no-AGP and AGP controls
preceded the first empty-rules, unassigned map request.

The first request was accepted at 08:13:02 UTC and failed natively at
08:58:26 UTC with the same generic
`ResourceOperationFailure` / `InternalServerError` and no deeper explanation.
The ARS root remained Succeeded. A separate VNet PUT at
08:17:18-08:17:26 UTC used API `2022-07-01`; resource-change evidence again
correlated removal of both AGPs with addition of a subnet NSG reference.
This is configuration drift, not an attribution of the writer or proof of
route-map causation. The first-map comparison was again confounded.

### Map-only recovery, without deleting the healthy ARS

The failed map alone was deleted and its absence verified while preserving
the healthy ARS and VPN lab. One recreation was acknowledged at 09:06:06 UTC.
Native Activity Log records success at 09:38:42 UTC; a direct resource read
confirmed Succeeded at 09:40:46 UTC. The ARS also remained Succeeded and there
were positively zero map assignments. This follows the documented
[failed-map delete/recreate guidance](https://learn.microsoft.com/en-us/azure/route-server/route-maps-how-to).
It is a recovery control, not a pristine first-map upgrade or an explanation
of either initial failure.

The two existing guest IKE profiles were reinitiated without changing their
configuration or PSKs. Both actual VPN receiver neighbors and both local
NVA/ARS neighbors subsequently established. However, the native gateway
peer-status API continued to report the previously observed internal
gateway/ARS rows Connecting with zero received prefixes under both
`2026-03-01` and `2026-05-01`.

A bounded withdrawal of one existing on-premises emulator origin removed
that control prefix from both actual NVA pre-import-filter tables; restoring
the origin restored receipt at both. VPN receiver sessions remained
established. The exact BIRD configuration and administrative state were
restored. No gateway reset, replacement resources or security changes were
used. This demonstrates fresh exchange at the actual receivers, not the
identity, physical multiplicity or health of every opaque internal adjacency.
The original strict health check and execution history were not changed:
the internal-native and full-matrix result remains **unknown**.

### Separate receiver-only AGP set/clear comparison

With the recovered, successful map still unassigned, a separately labeled
receiver-only control reapplied the original covering and independent AGPs.
Fresh full-native VNet reads, conditional ETags and property diffs verified
that the set/clear writes changed only `summarizedGatewayPrefixes`. Unknown
NSG attachments and other native properties were preserved.

| Recovered phase | VPN receiver, both neighbors | Local NVA, both ARS neighbors |
|---|---|---|
| No AGP, successful map present and unassigned | Original hub, covered spoke, uncovered spoke and outside-NVA prefixes | Original hub, covered spoke, uncovered spoke and outside-on-premises prefixes |
| AGPs reapplied, still zero map assignments | Covering aggregate and independent AGP present; covered hub/spoke originals suppressed; uncovered and outside-NVA routes retained | Original hub/spoke and outside-on-premises routes retained; neither configured AGP received |
| AGPs cleared, map still unassigned | Original hub/spoke and outside-NVA routes restored; configured AGPs absent | Original hub/spoke and outside-on-premises routes retained; configured AGPs absent |

Both the AGP-set and final cleared results were confirmed in two complete,
current per-neighbor receipt frames. The bounded receiver experiment ended
without errors and with its configuration restored before ownership-audited
cleanup. Cleanup completion and any retained Azure resources are separate
operational checks; successful map recovery does not resolve #310.

**Scoped conclusion:** configured AGP still took effect at both actual VPN
receivers after this successful, unassigned-map recovery and fresh
reapplication. This does not support a blanket rule that map existence
disables AGP. It does not reproduce the user's pristine first-map transition,
establish why older-API VNet writes removed AGP, qualify ER or mapped-connection
behavior, or turn the original strict-matrix unknown into a pass. Neither
this route exchange nor aggregate receipt proves packet delivery.

## Simulator boundary and follow-up

The coexisting-gateway result rules out blanket replacement of the original
ARS-native VNet prefix by gateway summaries: the local NVA can receive both.
The fresh sole-VPN result also rules out unconditional additive summaries to
local NVAs; the regional recovery control retained this distinction.
These observations do not justify generic synthesis for arbitrary gateways, remote
peers or gatewayless designs. The engine therefore retains explicit
`gatewaySummaryAssessment.status: "not-assessed"` rather than inventing missing
ownership or forwarding evidence. Historical captures can be inspected with the
endpoint-scoped ARS route viewer.

Repository regressions preserve ordinary modeled candidates, per-ARS identity,
edit/clear annotations and unchanged local forwarding; they are **not Azure
observations**. Existing gateway-advertisement tests remain separate from this
ARS-to-NVA boundary.

#233 remains open for the missing matrix and a safely attributed shared
control-plane projection. Native Azure captures, execution ledgers and exact
restoration evidence remain private; this document contains only sanitized
conclusions.
