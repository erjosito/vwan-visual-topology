# Gateway summaries and NVA received routes

## Supported boundary

`summarizedGatewayPrefixes` configures gateway advertisements, not local
address ownership. Existing ER/VPN gateway advertisement behavior is unchanged:
configured summaries replace covered hub/spoke advertisements, uncovered prefixes
remain, independent prefixes are allowed, and aggregate holes do not become
reachable. A gateway and GatewaySubnet are required for gateway summarization.
Spoke-local configuration does not configure the hub's gateway.

**ARS-to-NVA summary behavior is not assessed.** Do not interpret the displayed
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

## Qualification matrix

| Gateway | Branch-to-branch | Peer placement | Azure observation |
|---|---|---|---|
| ExpressRoute + GatewaySubnet | Off / on | Local / directly peered | Not assessed |
| VPN + GatewaySubnet | Off / on | Local / directly peered | Not assessed |
| No gateway (control) | Off / on | Local / directly peered | Not assessed for ARS exports; gateway prerequisite documented |
| Either gateway, one NVA on two ARS | Off / on | Original per-ARS scope | Not assessed |

Repository regressions exercise these configurations and preserve the ordinary
modeled candidates; they are **not Azure observations**. They also check distinct
summaries, an independent/outside summary, edit/clear/remove behavior, original
identities and absence of local route changes. Existing gateway tests remain the
separate qualification of the modeled gateway-advertisement path.

A separately approved recorded Azure lab is still required to close #233.
Capture the actual ARS advertisements and NVA received tables alongside gateway
exports for the matrix above, including a distinguishable covered summary and an
uncovered hub/spoke prefix. Establish replacement versus coexistence, outside
prefixes, and edit/clear/remove results before changing the ARS export algorithm.
No live Azure resources were provisioned for this boundary change.
