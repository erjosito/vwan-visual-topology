# Indirect spokes through a spoke Firewall

In **Full Hybrid**, open the **Virtual WAN indirect spoke through Azure Firewall**
sample. The workload VNet is peered to the security VNet, not attached to the
virtual hub. Both forwarding directions traverse the original spoke Firewall.

To author the design:

1. Add Azure Firewall or an NVA to a VNet and attach that VNet to the virtual hub.
2. Peer the indirect workload VNet with the Firewall VNet, allowing forwarded traffic.
3. Open the hub's **Configure Hub & Labels** panel. Under the security VNet's
   **Connection static routes**, add the indirect prefixes and original appliance
   IP. **Propagate static route** is enabled when adding a route.
4. Add return UDRs on the indirect workload subnets pointing to the same appliance.
5. Inspect hub/subnet routes and trace both directions. Removing a return UDR does
   not withdraw the hub route and must not be mistaken for successful return routing.

This models Azure's **option 1**, connection static routes with propagation
enabled. Their connection's table/label propagation also controls inter-hub
exports. They are static routes, not fabricated Firewall BGP advertisements.
Peering system routes remain preferred over these gateway-exported routes.

Native JSON stores `staticRoutes: [{ name, addressPrefixes, nextHopIpAddress }]`
and `propagateStaticRoutes` under `vwanHubAttachment`; save/load and undo use
the normal topology history. There are limits of 64 named routes and 256 total
prefixes per connection. Bicep export warns that it does not deploy this routing
configuration; capture import is not an equivalent indirect-spoke deployment.

## Explicit limits

Unrecognized next hops, disabled/unspecified static propagation, multiple next
hops for one static prefix, default routes, overlap with directly attached
VNet prefixes, routing intent, and route maps on the originating connection
remain **not assessed**. This does not claim that Azure cannot support these
cases. In particular, bypass-next-hop, option 2 hub-table routes, Internet egress
and routing-intent composition need their own qualification.

Firewall rules, NAT, sessions and packet delivery are not evaluated. This change
does not deploy Azure resources or certify the design against a live lab.

## Sources

- [Azure indirect spoke architecture](https://learn.microsoft.com/azure/virtual-wan/indirect-spoke-architecture):
  connection routes, propagation, return UDRs and non-transitive peering.
- [Virtual WAN static routes](https://learn.microsoft.com/azure/virtual-wan/static-routes):
  option 1 versus option 2 and supported inspection patterns.
- [Azure route selection](https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing):
  VNet/peering routes are preferred over BGP-learned routes.
