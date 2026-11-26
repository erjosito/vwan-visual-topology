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

A VNet with its own VPN or ExpressRoute gateway cannot enable
`useRemoteGateways`, even when that local gateway is disabled in the simulator.
Canvas and full peering editors prevent enabling this combination but permit
clearing an invalid saved flag. Imported conflicts retain their original
configuration for repair and appear in topology validation. A disabled local
gateway does not make the peer's gateway an eligible routing fallback.

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

### Application Gateway private TCP proxy

The separately negotiated application contract (`contractVersion: 2`,
`operation: "application"`) also accepts
`{version: 1, kind: "tcp", serviceId, client, sourcePort, port}`. The client is
an original workload/NIC/IP binding. Open **VNet detail > Application Gateway
private TCP proxy** to declare one private Standard_v2/WAF_v2 gateway, its
dedicated subnet, distinct frontend and serving-instance addresses, original
listener/rule/pool IDs and rule priority, one original workload backend and
its port. Missing addresses, unknown provisioning or unknown default TCP probe
health remain not assessed. Declared healthy is unverified.

The **TCP proxy connections** application operation shows the client/frontend
connection separately from the instance/backend connection. Backend NSGs see
the instance's private source, with an illustrative ephemeral port. Each
connection has independent forward and return routing, filtering and conditional
response evidence. A reachable frontend does not imply a reachable backend.
The client needs no direct backend route, and the proxy grants no arbitrary VNet
transit. An unrelated unpeered duplicate address does not make an otherwise
unique original peering route ambiguous; competing remote peering owners and
unresolved shared transit remain unassessed.

Native `application.services[].tcpProxy` persists the explicit configuration;
the shared worker and MCP return the two connections in
`application.connections[]`. Unsupported operations and unknown capture
relationships do not gain coverage merely from retaining those fields. This
slice does not qualify public frontends, multiple serving instances, TLS
termination, Proxy Protocol, HTTP/WAF, autoscale/failover, additional translating
routers, Private Link composition or live listener/application readiness.
The Bicep starter is not an equivalent gateway deployment.

References: Microsoft's
[TCP/TLS proxy configuration](https://learn.microsoft.com/en-us/azure/application-gateway/how-to-tcp-tls-proxy),
[Layer 4 client IP behavior](https://learn.microsoft.com/en-us/azure/application-gateway/proxy-protocol-header)
and [gateway connection/source-address behavior](https://learn.microsoft.com/en-us/azure/application-gateway/how-application-gateway-works).
These support a bounded synthetic configuration model, not a live Azure
qualification claim.

### Firewall explicit HTTP/HTTPS proxy

Open **VNet detail > Original Firewall proxy policy** to bind an existing
`azure-firewall` appliance in its dedicated `AzureFirewallSubnet` to an original
Standard/Premium policy. Declare the original policy groups, collections and
rules as bounded JSON and DNS bindings to original workload/NIC/IP identities.
Saving rejects malformed JSON, dangling references and ambiguous priorities.
Editing preserves the original identities; native JSON retains the policy.

Use the **Firewall explicit proxy** application operation, or
`{version: 1, kind: "firewall-proxy", mode: "explicit", serviceId, client,
sourcePort, proxyPort, scheme, host, port}` with application contract version 2.
The client addresses the original Firewall private IP and configured HTTP port,
including for HTTPS CONNECT. It does not need a UDR or direct backend route.
An original matching application allow rule is required. Network rules are
examined first regardless of application-rule priority; a matching network rule
remains unqualified rather than being relabeled as application proxying.
Unmatched application policy remains unassessed because built-in infrastructure
rules are not captured.

The two TCP connections have independent native routes, NSG checks and
conditional replies. The upstream always has Firewall source translation,
irrespective of network-rule private SNAT exclusions. Neither the private VIP nor
the representative ephemeral port is claimed as an actual serving-instance
allocation. Filtering covers the Firewall subnet and ephemeral-port uncertainty;
every usable Firewall subnet address has an original native return witness in
`application.connections[].returnVariants`. This exhaustive proof is bounded to
/24 through /26. A VIP-only allowance or return route cannot prove that all
possible instances work. Mixed returns remain unassessed.

Declare complete policy, successful provisioning, no inheritance or DNAT
composition, and disabled threat intelligence, IDPS and TLS inspection.
Unknown controls, public upstreams, additional routers and Private Link
composition remain unassessed. Transparent interception has its separate proof
described below. DNS bindings are explicit
configuration, not live resolution. Application, TLS and listener availability
remain unverified. The Bicep starter omits these policy and DNS declarations and
is not an equivalent deployment.

References: Microsoft's [explicit proxy](https://learn.microsoft.com/en-us/azure/firewall/explicit-proxy),
[rule processing](https://learn.microsoft.com/en-us/azure/firewall/rule-processing)
and [private-range SNAT](https://learn.microsoft.com/en-us/azure/firewall/snat-private-range).

### Firewall transparent application rules

The same original Firewall policy also supports
`{version: 1, kind: "firewall-proxy", mode: "transparent", serviceId, client,
sourcePort, destinationAddress, scheme, host, port}`. Do not supply `proxyPort`.
Choose **Firewall application proxy > Transparent application rule** in the
application panel and declare the original destination plus HTTP Host or HTTPS
SNI. Explicit proxy need not be enabled for transparent rules.

The original native route must actually reach the selected original Firewall,
for example through the client's UDR. The unmodified native witness stops with
`status: "proxy-intercepted"` at that appliance. It does not report backend
delivery, infer a direct client/backend connection or turn a bypass into proxy
evidence. Upstream routing and its response are assessed independently.
Original client traffic sent to a peered Firewall is not classified as traffic
forwarded from a third VNet merely because its next hop is an appliance.

Network rules match the original destination and precede application rules
regardless of numeric application priority. A matching transparent network deny
is a violation; a matching network allow remains outside this application
proxy provider. HTTP Host may select the declared Firewall DNS-bound backend,
even when it differs from the original client destination. Without TLS
inspection, HTTPS uses declared SNI for matching but cannot substitute a
different DNS answer for the original destination. Such a mismatch stays
unassessed.

Both proxy connections retain conditional replies. The client-facing reply
preserves the original destination identity; this does not create an
end-to-end NAT inverse or live session. Application-rule source translation
still applies independently of network-rule private SNAT exclusions. The same
instance-address uncertainty, exhaustive bounded return witnesses, original
identities and unsupported controls described above apply.

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
