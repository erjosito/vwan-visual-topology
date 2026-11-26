# Dual ExpressRoute private-peering qualification

Issue: [#467](https://github.com/erjosito/vwan-visual-topology/issues/467).

## Scope and evidence

An ephemeral lab used one logical customer router, two 50 Mbps ExpressRoute
circuits, one classic Standard ER gateway and one Linux workload VM. Both
circuits advertised the router-owned `172.31.100.0/24`; packet checks targeted
its actual `172.31.100.1` address. The topology and addresses below are synthetic,
not customer configuration.

Collected evidence comprised four primary/secondary MSEE route tables,
gateway learned routes, workload NIC effective routes, provider interface
configuration and five-packet ICMP probes. Private raw records remain outside
the repository because they contain environment and provider identities.

| Scenario | Observed selection | Packet evidence |
| --- | --- | --- |
| Circuit B only, then circuit A only after convergence | Remaining circuit | 5/5 replies through each independently |
| Equal public AS paths and connection weights | Four gateway candidates and four NIC next hops | No packet-distribution claim |
| A public path length 4, B length 1; equal weights | B | Route evidence |
| Same paths, A connection weight 200 | A, despite longer path | 5/5 replies |
| A private path `65010 65010 65010 65010`, B `65010`; equal weights | B | 5/5 replies |
| Remove only A's private-AS prepend | Four equal-cost NIC next hops restored | Route evidence |
| Restore A's longer private path, withdraw B | A fallback | 5/5 replies |
| Restore shorter B | B preferred again | 5/5 replies |

MSEE routes retained the complete customer private-AS path. Gateway paths added
`12076`. Gateway route weights were 32769 at equal configured weights and
32969 for connection weight 200; these observed native weights are not the
configuration values. Nonpreferred gateway candidates remained visible.

The public/private ASN change used coordinated per-peer local-AS configuration
and Azure private-peering peer ASN configuration. An attempted global router
ASN update was rejected and is not evidence that the global ASN changed.

## Model corrections

The Full Hybrid customer-to-MSEE ingress must preserve customer ASNs and
prepends, including private ASNs. Do not apply this finding indiscriminately to
Azure-originated exports or standalone VWAN normalization. Those separate
boundaries remain unchanged.

Circuit connection identity must survive equal-cost subnet route compilation.
Azure connection weight must not leak into reverse-direction site selection.
The model retains circuit-level candidates and traces one deterministic path,
not both physical MSEEs or a predicted packet hash.

Regression coverage also exercises four-byte private ASNs, independent site
local preference, save/import and longest-prefix selection. These are model
checks, not additional live Azure qualifications.

## Explicit limits

- An attempted more-specific owned interface address was rejected as overlapping.
  No live longest-prefix experiment was completed and no additional resources
  were purchased to work around that limitation.
- Router Looking Glass returned successful HTTP responses without route data.
  No router RIB collection is claimed; interface configuration is not a RIB.
- No MED, packet-level ECMP distribution, convergence timing, failure detection,
  reverse-direction local preference or Full Hybrid/VWAN composition was
  live-qualified.
- Early isolation snapshots taken before convergence were not accepted as
  single-circuit evidence.

## References

- [Optimize ExpressRoute routing](https://learn.microsoft.com/azure/expressroute/expressroute-optimize-routing)
- [ExpressRoute private-peering disaster recovery](https://learn.microsoft.com/azure/expressroute/designing-for-disaster-recovery-with-expressroute-privatepeering)
- [MCR advanced BGP settings](https://docs.megaport.com/mcr/mcr-bgp-advanced/)
