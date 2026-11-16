# VPN overlap NAT: bounded native model

Issue #134 adds **cross-premises IPsec overlap NAT**, not Internet egress.
Both classic VPN Gateway and Virtual WAN VPN run in the existing **v2
Azure/Full Hybrid routing engine**. NAT changes its original connection's
advertisements and packet boundary; it is not a replacement routing engine.
The legacy **v1 VWAN provider does not implement NAT**. Its old saves remain
compatible; attempting to attach NAT fields to that provider is rejected
instead of silently dropping them. Use the v2 provider to author this feature;
there is no automatic conversion.

## Provider capabilities

| | Classic VPN Gateway | Virtual WAN VPN |
|---|---|---|
| Original owner | `AzVnetGateway` of kind `Vpn` | `AzVwanHub` site-to-site gateway |
| Association | Original `AzVpnConnection` targeting that gateway | Original `AzVpnConnection` representing one site link, targeting that hub |
| Gateway declaration | `vpnNat: { sku, bgpRouteTranslation }` | `vpnNat: { bgpRouteTranslation }` |
| SKU | Explicit `VpnGw2`–`VpnGw5` or `VpnGw2AZ`–`VpnGw5AZ` | **Not** a classic gateway SKU; no classic SKU is inferred |
| Instances in this slice | Single instance; each rule selects `default` | Static rules apply to both instances and omit the selector; dynamic rules select `0` or `1` |
| BGP peers | Explicit, non-APIPA, excluded from ingress internal mappings | Explicit, non-APIPA; a covered peer needs the static translated address, with a specific static `/32` exception for a dynamic range |

Instance selectors are **model tokens**, not ARM resource IDs or deployment
schemas. Classic active-active per-instance association is explicitly
unsupported, rather than incorrectly applying the VWAN instance behavior.
This model conservatively excludes classic peers from NAT ranges: the official
overview's routing section says to exclude peers, while its FAQ describes
static translated peers. The latter classic variant is not enabled here.

Only route-based, any-to-any cross-premises `IPsec` is supported. Internet
breakout, NAT64/IPv6, P2S, VNet-to-VNet, policy-based selectors, appliance/SD-WAN
NAT and port-specific rule declarations are rejected. Guest/router Internet
SNAT, NAT Gateway and public DNAT remain separate features.

## Rules, validation and routing

Connection-owned `nat` declares `purpose: "overlap"`, `connectionType: "IPsec"`,
`trafficSelectors: "route-based"` and a nonempty `rules` array. Each rule has
`id`, `name`, `type` (`Static`/`Dynamic`), `mode`
(`IngressSNAT`/`EgressSNAT`), `internalMapping`, `externalMapping`, and the
provider-specific optional `ipConfigurationId` token above.

* **IngressSNAT** translates branch source addresses entering Azure and reverses
  destination addresses leaving for that branch.
* **EgressSNAT** translates Azure source addresses leaving for the branch and
  reverses destination addresses entering Azure. **Do not add a separate DNAT
  rule** for the paired reverse mapping.
* Static mappings require canonical IPv4 prefixes of equal size and preserve
  the address offset. Either side can initiate.
* Dynamic pools must not be larger than their internal range; classic external
  pools are limited to `/26` or smaller. A dynamic rule identity belongs to one
  connection only. Initiation must come from the internal-mapping side.
  The only overlapping internal-range exception is a VWAN **ingress** static
  rule for the exact declared `bgpPeerIp/32`, with BGP enabled, inside a dynamic
  ingress mapping. The documented BGP-peer exception does not enable arbitrary
  static host overrides, egress overrides or non-BGP overlaps.
  The isolated illustrative allocation uses the first external address and
  port `49152`; it is **not** Azure's allocator, a port-preservation claim,
  capacity/exhaustion modeling, or live session state.
* External mappings on a gateway must be disjoint, except identical shared
  static rule associations. Shared ingress rules must represent the same site.
  Distinct sites' translated ingress ranges must also be disjoint across
  modeled gateways. Rule IDs/names and shared definitions are checked.
* External mappings cannot overlap untranslated site networks or any modeled
  Azure VNet prefix. Azure external mappings must not collide with the
  branch's local internal ranges. These checks are deliberately conservative
  across the topology, including disconnected original ranges; this slice
  does not prove arbitrary tenant/VRF isolation.

The gateway-wide **BGP route translation** switch affects only matching rules
on each associated BGP connection: exact ingress internal prefixes become
external learned prefixes, and exact egress internal prefixes become external
advertised prefixes. Unmatched prefixes and connections remain unchanged.
Original prefix and rule identity survive in RIB evidence; the BGP inspector
shows original and translated prefixes. Overlapping aggregates/more-specific
site advertisements are rejected where an exact ingress advertisement is
required. Existing route-map, AS-loop, hub-table and preference semantics stay
in the native engine.

With BGP translation disabled, BGP advertisements are not rewritten.
For non-BGP tunnels, configure the existing **static VPN prefixes** as the
post-NAT ingress ranges (or advertise them explicitly from the site when
using BGP without translation). Declare manual branch routes using
`nat.onPremisesRoutes`, also editable in the NAT inspector. These are explicit
on-premises **static** routes through that original connection, not invented
BGP advertisements. They are required to reach egress external ranges when
BGP does not supply those routes. The model accepts a site with declared
post-NAT prefixes while retaining its original internal addresses in the NAT
rules.

## Inspect and assess

In Azure/Full Hybrid, configure the original VPN connection:

1. Declare the original gateway capability, supported classic SKU if
   applicable, and gateway-wide BGP translation setting. The gateway's own
   configuration inspector exposes the same settings and association list.
2. Add ingress/egress mappings as needed. For BGP, declare the original
   `bgpPeerIp` and configured `bgpPeerTranslatedIp`; the latter must match the
   static peer mapping or the unchanged excluded peer.
3. Use **VPN NAT packet assessment**, selecting initiation direction and an
   explicit IPv4 TCP/UDP five-tuple. Enter the destination as the initiator
   sees it, including the external mapping when needed.

Both EN/JA inspectors explain the rules and pairing. A packet assessment is
bounded to one selected original connection and one unambiguous Azure subnet.
The **existing native forwarding trace** must actually traverse that VPN
boundary. Its UDRs, GatewaySubnet behavior, peering flags, hub association,
route selection and return routes still apply. Per-rule before/after tuples,
original edge/rule IDs and native hop evidence are retained for each leg.
The response starts with the reversed delivered tuple and must traverse the
same connection in the opposite direction. Dynamic reverse destination
mapping is allowed only for that assessed reverse five-tuple; unrelated new
external-side initiations are rejected.

An address-only route probe cannot establish this packet/session contract and
returns **not assessed** when it reaches a configured NAT boundary. Packet
results explicitly leave NSG/firewall permission, guest readiness and
application delivery **not assessed**. No live session, timer, pool exhaustion,
real packet hash, additional NAT connection stage or cross-connection dynamic
reply state is asserted. A complete forward route does not establish a return
route, and no response is assessed after an incomplete forward path.

Optional fields persist in native JSON, browser saves/history and share
documents without a topology version change. Only an absent (`undefined`) NAT
declaration means no NAT: explicit `false`, `0`, `null` or empty-string gateway,
hub and connection configurations are rejected. Bicep export explicitly warns
that it does **not** deploy an equivalent NAT configuration. Azure capture
reconstruction of NAT rules is not implemented: captures containing known
gateway/connection NAT associations are rejected rather than silently
discarding them. The standalone network collector retains only gateway
`natRules[].id` and connection `ingressNatRules[].id`/`egressNatRules[].id`
under its existing bounded allowlist; it does not collect mappings or secrets.
Malformed association shapes are rejected by the importer, not treated as empty
arrays. Absent/null or empty association arrays remain compatible with older
capture formats. This does not extend the legacy v1 WAN collector's structural
scope. No resources are created by this feature.

## Headless/worker contract

The existing platform `simulate` operation accepts optional `vpnPacket`
(Azure/Full Hybrid only):

```json
{
  "connectionId": "vpn",
  "direction": "ingress",
  "tuple": {
    "sourceAddress": "10.0.0.4",
    "destinationAddress": "192.168.2.5",
    "protocol": "tcp",
    "sourcePort": 12345,
    "destinationPort": 443
  }
}
```

`result.vpnPacket` contains independent `forward`/`reply` packet legs,
translation classification and explicit security/delivery limitations. Browser
workers and headless execution use the same implementation. This does not add
a new verification/requirement kind or certify a security policy.

## Official sources

Read on 2026-11-16 before implementing semantics:

* [VPN Gateway NAT overview, scope, routing, FAQ and limitations](https://learn.microsoft.com/azure/vpn-gateway/nat-overview)
* [Virtual WAN NAT rules, instance behavior, peers, static routes and packet flow](https://learn.microsoft.com/azure/virtual-wan/nat-rules-vpn-gateway)
* [Virtual WAN PowerShell NAT association example](https://learn.microsoft.com/azure/virtual-wan/nat-rules-vpn-gateway-powershell)

Tests: `src\vpn-nat.test.ts`, `e2e\vpn-nat.spec.ts`. They cover both providers,
static bidirectional and dynamic internal-side initiation, paired replies,
independent native return blackholes, exact/missing BGP associations,
manual post-NAT routes, public translated ranges without Internet breakout,
validation/rejection, persistence, EN/JA inspectors and worker/headless parity.
`tests\collect-azure-network.test.ps1 -VpnNatOnly` runs the real standalone
collector against gateway-only, ingress-only and egress-only NAT fixtures and
verifies each emitted capture is rejected by the current importer.
