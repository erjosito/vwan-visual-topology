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
not prove legacy software state or restore it. Unassigned-map advertisements
must not be treated as live-qualified against this report.

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

## Recorded Azure observations (2026-11-18)

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

### Remaining unknowns

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

## Simulator boundary and follow-up

The live result rules out blanket replacement of the original ARS-native VNet
prefix by gateway summaries: the local NVA can receive both. It does not justify
unconditional synthesis of summaries for arbitrary gateways, remote peers or
gatewayless designs. The generic engine therefore retains explicit
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
