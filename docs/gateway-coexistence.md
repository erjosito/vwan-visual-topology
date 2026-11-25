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

## VPN over ExpressRoute private peering

This is a distinct, explicit connection mode, not the independent Internet VPN
backup described above. Open **Configure VPN Connection**, enable **VPN over ER
private peering**, and select the existing Azure and site ER links on one circuit.
Declare both RFC1918 outer endpoints, gateway private-IP enablement, Standard
public-IP capability and the gateway-owned private tunnel IP. Configure the
gateway as active/standby and RouteBased. A gateway SKU alone is not evidence of
its public-IP capability.

One logical site can advertise different exact subsets of its routes per
transport. On a site ER link select only the VPN device/transport prefix; on the
VPN connection select workload prefixes. An omitted selection preserves legacy
all-route export; an explicitly empty selection withdraws all BGP advertisements.
Outbound maps run after selection. A selection does not originate a missing route.
For example, declare `172.16.0.0/24` and `192.168.10.0/24` at the site; advertise
the former over ER and the latter over VPN. The VPN device can be
`172.16.0.4` and the Azure tunnel endpoint `10.0.255.4` in GatewaySubnet.
An ER host route or broader aggregate is also valid; no fixed small CIDR is required.

The connection declares a separate **outer ER routing context**: endpoint
reachability is resolved bidirectionally with every private overlay withdrawn.
The selected links must connect this site to an enabled ER gateway in the VPN
gateway's VNet. GatewaySubnet UDRs, missing endpoint routes, disabled links or ER
gateway failure prevent tunnel use. This does not certify that an actual on-prem
router has installed the equivalent underlay context/endpoint host routes; the
operator must configure those separately and avoid recursive overlay resolution.
The overlay must never be its own evidence of endpoint reachability.

Workload forwarding still uses normal effective routes and site policies.
Explicitly prefer Azure workload routes received on VPN using the site's
**inbound local preference**; Azure-side route choice does not configure the
on-prem return path. More-specific VPN workloads beat an ER aggregate, but equal
prefixes at Azure prefer direct ER. Withdrawal of the overlay can reveal an ER
aggregate: directional trace evidence explicitly says **direct ER without
IPsec**. There is no inferred fail-closed guarantee. Inspect both directions.
VPN failure leaves ER and independently configured Internet tunnels intact.

Native JSON retains `connection.underlay` (kind `express-route`, `azureLinkId`,
`siteLinkId`, `azureEndpoint`, `onPremEndpoint`), `useLocalAzureIpAddress`,
transport `advertisedPrefixes`, and explicit gateway private-IP declarations.
Simulation/headless output includes `vpnUnderlays`; flow evidence includes
directional `vpnProtection` and named inner/outer contexts. The independently
selectable dashed **VPN over ER** overlay follows the selected ER location,
beside rather than hidden inside its edges.

The legacy connection-level declaration assesses BGP, classic active/standby
RouteBased gateways with explicit Standard IP capability. Static and
active/active private overlays require the explicit instance/tunnel contract
below. **VPN NAT composition, Virtual WAN and NVA/SD-WAN private overlays remain
not assessed**. BGP is not an Azure prerequisite.
Captures preserve the private-IP connection flag and gateway enablement but do
not invent uncaptured ER links, endpoint ownership or public-IP capability.
Until these declarations are supplied, a captured private VPN is not assessed,
never silently converted into an Internet tunnel. Bicep export refuses private
overlays rather than emitting an inequivalent public VPN. Preserve native JSON.

These are deterministic routing checks, not a live Azure deployment or proof of
established IKE/IPsec SAs, crypto correctness, packet delivery, MTU/MSS,
throughput or convergence.

Reference: [S2S VPN over private peering](https://learn.microsoft.com/en-us/azure/vpn-gateway/site-to-site-vpn-private-peering).

## Instance-bound VPN and APIPA BGP

The native version-2 model also supports explicit `gateway.vpnInstances` and
`connection.tunnels`. They are authored/imported as native JSON; the connection
editor preserves these bindings and exposes per-tunnel evidence without rewriting
them into the legacy single-tunnel declaration. An instance has an original
`id`, `ipConfigurationId`, declared administrative state, private/public outer IPs,
default/custom BGP addresses and authored/captured provenance. No address is
derived from subnet offsets, array order, display names or ASN.

A connection owns only the **configured CPE tunnels**, not a full mesh over every
Azure endpoint. Each tunnel references one gateway instance and declares
`transport` (the existing ExpressRoute underlay shape, or explicit Internet
endpoints/availability), `ipsec` (an abstract availability assumption), and
`bgp` CPE source/listener/ASN/initiation/context bindings. Do not combine
per-tunnel transport with a connection-level `underlay`.

Effective LNG `bgpPeer` and connection `gatewayCustomBgpIpAddresses` select the
expected Azure address. An ordinary private CPE peer uses its mapped instance's
default GatewaySubnet BGP address. APIPA requires a corresponding custom Azure
address in **169.254.21.0 through 169.254.22.255**, unique ownership and CPE TCP/BGP
initiation. An explicit connection-local selection must map to the correct IP
configuration. Missing/ambiguous mappings are not guessed. IKE `ResponderOnly`
is not a BGP-passive fix.

One site's `vpnRouting` declares a **single shared CPE context/FIB**,
`localAddresses` and static `peerRoutes`. A peer route has a prefix, optional
source-address qualifier and a tunnel, ER-link or drop next hop. The evaluator
combines these with derived site routes using longest-prefix match, preferring
authored statics at equal prefix length. It records source/context and the
selected forward and return peer lookups. The same lookup governs CPE workload
forwarding and independent outer-ER resolution, not a separate BGP-only FIB.
Source-qualified workload policies require an explicit packet source; pair
traces supply both endpoint addresses. Selected static drop/unavailable next
hops do not silently fall back to dynamic routes. These local static routes
are not automatically originated into BGP.
A peer lookup must uniquely select
its intended tunnel. Overlay-learned self/cross-tunnel feedback is conservatively
not assessed; a wrong tunnel, missing peer route, unowned local address or
listener/ASN mismatch cannot learn routes. Azure's configured peer host-route
binding is labeled as such, not presented as a captured Azure FIB.

Outer ER lookups remain independent of private overlays. ER-only failure
withdraws both dependent instance-bound tunnels; one disabled instance/tunnel
does not disable the other. Internet transport and IPsec availability require
explicit assumptions; these checks never verify Internet reachability or SAs.
Export AS-path prepends affect Azure selection, not CPE import preference.
Independent CPE route maps, ECMP candidates and directional direct-ER bypass
evidence remain visible. Explicit static tunnels require both `staticPrefixes`
(Azure routes to CPE workloads) and `staticAzurePrefixes` (CPE routes to Azure);
`[]` means no static routes, not fallback to every site prefix.

`tests/fixtures/vpn-instance.ts` is a sanitized native reference: one gateway,
two explicitly mapped instances, one CPE/FIB, a private connection with two
tunnels and an existing Internet connection with only one tunnel. Its
`vpnMigrationSnapshots()` provides ordered static-backup, first-private,
two-private, enable-backup-BGP, BGP-only rollback, healthy-baseline, ER-only
failure and restoration snapshots. Connection/tunnel IDs and declared SA
assumptions remain stable through BGP enable/disable.

For headless **binding/dependency**, not merely flow, checks:

```json
{
  "id": "private-west-binding",
  "kind": "vpn-tunnel",
  "connectionId": "private",
  "tunnelId": "private-west",
  "expectation": "eligible",
  "binding": {
    "azureAddress": "10.244.255.30",
    "cpeAddress": "10.245.254.6",
    "gatewayInstanceId": "instance-west"
  },
  "underlayState": "available"
}
```

Use `expectation: "ineligible"` and `underlayState: "unavailable"` for an
ER-failure check. Unknown/unconfigured identities cannot pass. Evidence is in
`simulation.vpnTunnels[JSON.stringify([connectionId,tunnelId])]`, including
expected endpoints, independent observations and comparisons, transport/SA
assumptions, peer lookup witnesses and per-session route provenance.
Directional traces expose `vpnTunnelPaths`. The BGP inspector reuses original
resource/instance/relationship identities; unused endpoints do not become
failed required sessions.

On `simulate`/`evaluate`, optional
`vpnTransition: {previousTopology, event: {id, description}}` compares the
previous native snapshot with the current document. The `vpnTransition`
evidence section preserves both source snapshots, retained/added/removed tunnel
identities and derived eligibility, gateway/site RIB and subnet-table deltas.
It explicitly reports **`inPlaceReproduction: "not-assessed"`**: ordered
snapshots are not TCP history, a stateful SA-persistence model or a reproduction
of a live static-to-BGP operation. A fresh APIPA connection and a tunnel restart
remain different authored events, not substitutes for retained IDs.

Capture import retains effective native BGP configuration and original
IP-configuration associations, LNG BGP settings, custom selections and
`useLocalAzureIpAddress`, including unmapped BGP fields and provenance.
It does **not** infer CPE tunnel membership, merge LNGs into one physical CPE,
assume SA availability or identify instances by array order. Such captures
with private-IP, APIPA or custom-address selections remain not assessed until
explicit membership and dependencies are supplied. Ordinary captures without
those controls retain legacy qualified routing; retained gateway IP-configuration
metadata alone does not opt a connection into explicit-tunnel eligibility.
Historical peer-state captures remain separate from modeled eligibility.
Bicep refuses instance-bound exports rather than silently dropping semantics.

Per-tunnel observations can record an unexpected default-source attempt
alongside a matching APIPA exchange; neither observation overwrites the other.
A valid backup does not automatically break private BGP. Unexplained
Azure/vendor defects, full TCP/BGP FSM, crypto, rekey, throughput, packet delivery
and convergence seconds are not modeled. Live qualification still needs
correlated effective configuration, actual tuples/peer state, CPE FIBs and
bidirectional payload evidence. No customer data or live qualification is
included in this fixture.

Source rules reviewed November 25, 2026:
[BGP configuration considerations](https://learn.microsoft.com/azure/vpn-gateway/configure-bgp#bgp-configuration-considerations).

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
