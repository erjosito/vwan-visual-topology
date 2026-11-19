# Standalone ExpressRoute/VPN coexistence

These controls apply to standalone gateways in a VNet, in hub-and-spoke and Full
Hybrid mode. They do not configure Virtual WAN managed gateways.

## Configuration and checks

Open **Configure Gateway & Peerings** on an original gateway or its VNet.
Gateways retain optional `sku`, `vpnType` (`RouteBased`/`PolicyBased`) and
`vpnGatewayGeneration` (`Generation1`/`Generation2`). Legacy saves and captures
without these facts remain unspecified; importing or simulating does not fill
them with observed-looking defaults.

Coexistence requires RouteBased VPN, supported non-Basic gateway SKUs and
GatewaySubnet **/27 or shorter**. Basic, PolicyBased, incompatible declared VPN
generation/SKU pairs, and missing/undersized GatewaySubnet are validation errors.
Native JSON admission still retains semantic-invalid settings for diagnosis and
correction. Missing or unfamiliar SKUs produce warnings, not compatibility proof.
The current VPN SKU reference includes VpnGw4AZ/5AZ: the older coexistence
tutorial's VpnGw1/2/3 examples are not a universal allowlist. Generation, regional
availability, capacity and Azure deployment readiness are not certified.

A RouteBased gateway may use **policy-based traffic selectors on a connection**.
That is not a PolicyBased gateway. IPsec selector enforcement is not simulated.

**Check Routing** identifies enabled UDRs overlapping GatewaySubnet, naming the
route table, route, destination, next hop and affected gateways. Routes covering
the gateway range (including default routes) are errors; a nondefault covering
summary less specific than the containing system VNet route is not treated as
diverting local gateway traffic. More-specific overlaps
are warnings because actual BGP endpoint IPs are not inferred. Existing
GatewaySubnet BGP-propagation checks remain. Gateways need working internal BGP
communication; simulated routes do not prove native sessions or underlay health.

The bounded read-only network collector retains gateway SKU, routing type and
generation. Both ARM and CLI capture shapes are accepted. Azure generation
`None` remains unknown. Bicep preserves declared settings, emits these checks and
discloses missing-setting defaults instead of silently repairing an invalid
design. It remains a starter, not a deployment-equivalence certificate.

## Routing boundaries

| Design | Modeled behavior |
| --- | --- |
| ER and VPN without ARS | Equal-prefix ER preference, regardless of a shorter VPN AS path; longest-prefix match still permits more-specific VPN routes |
| ER withdrawn/restored | Recomputed steady-state VPN fallback/ER restoration, not measured convergence or failover time |
| ER-only and VPN-only sites, no ARS exchange | Each can reach Azure; coexistence alone does not advertise their prefixes to one another |
| Same-VNet ARS with branch-to-branch | NVA/gateway and opposite-kind ER/VPN gateway route exchange; inbound/outbound ARS maps retain their own scopes |
| VPN integration with ARS | Explicit active/active, ASN 65515, and no explicitly unsupported Basic/PolicyBased configuration; VPN BGP enablement is **not required**, so static site prefixes can be exchanged |
| Unsupported/unknown ARS gateway prerequisite | No invented exchange; control-plane/flow assessment is incomplete rather than proof of isolation |
| ER circuit-to-circuit transit | Not provided by ARS; use an explicitly modeled supported Global Reach design |

Azure's outbound ER preference does **not** configure the on-premises return
path. Model site inbound local preference explicitly when ER must be preferred;
do not infer symmetry from the Azure route. Existing site-owned policies remain
separate from gateway and ARS maps.

VPN backup covers ER **private peering**, not Microsoft-peering services. The
VPN public-IP underlay must remain Internet-reachable independently of the ER
path it backs up. Microsoft-peering failover and this underlay dependency are
explicitly outside the routing model, not successful delivery assertions.

The BGP inspector separates an enabled gateway and eligible managed ARS exchange
from external VPN BGP enablement. Static VPN does not acquire external BGP
neighbors merely because its routes can be exchanged with ARS. Managed endpoint
mappings, native counters and establishment remain unknown.

## Evidence

The no-ARS preference, forwarding and fallback baseline reuses the independently
recorded [issue #81 qualification](https://github.com/erjosito/vwan-visual-topology/issues/81)
and `verification/issue-81-coexistence.json`. The new ARS cross-gateway,
static-VPN, policy, boundary, import/export and authoring regressions are
**modeled/documentary checks**, not additional live Azure qualification. No new
paid deployment or release is implied.

References reviewed November 19, 2026:

- [ER/VPN coexistence](https://learn.microsoft.com/en-us/azure/expressroute/how-to-configure-coexisting-gateway-portal)
- [ARS ER/VPN support](https://learn.microsoft.com/en-us/azure/route-server/expressroute-vpn-support)
- [Current VPN gateway SKUs](https://learn.microsoft.com/en-us/azure/vpn-gateway/about-gateway-skus)
- [ExpressRoute gateways](https://learn.microsoft.com/en-us/azure/expressroute/expressroute-about-virtual-network-gateways)
