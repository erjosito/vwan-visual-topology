# Virtual WAN hub route-table contexts

The simulator supports explicit local hub route tables, connection association,
and dynamic propagation to table IDs and labels. It does not derive these controls
from an effective-route snapshot. See [#22](https://github.com/erjosito/vwan-visual-topology/issues/22)
for the design contract, calibration and scope.

## Model and compatibility

Existing version-1 authored designs without these optional properties retain
Default association/propagation. New designs and imported configurations can use:

```json
{
  "routeTables": [
    { "id": "business", "name": "Business", "labels": ["business"] }
  ],
  "routeTablesStatus": "captured"
}
```

The table inventory belongs to a hub. Each attached spoke, branch connection or
hub-side ER link can retain a separate configuration:

```json
{
  "hubRouting": {
    "status": "configured",
    "associatedTableId": "business",
    "propagatedTableIds": ["business"],
    "labels": ["business"]
  }
}
```

This example is a **VNet** connection. VPN, ER and integrated branch connections
must associate with `defaultRouteTable`, not `business`. Spoke BGP NVAs inherit
their hosting VNet connection's controls; that hosting connection must also
associate with Default. Branches and NVA hosting connections within a hub must
have the same effective propagation destinations, even when expressed with
different equivalent ID/label syntax.

`configured` means explicit model input; `captured` means captured configuration;
`unknown` preserves missing or unsupported controls without claiming reachability.
Known references must resolve in the local hub inventory. Reserved Default/None
IDs are canonicalized; duplicate IDs differing only in case are rejected.
**Labels are case-sensitive and distinct from table IDs and display names.**
Preserve the actual Azure payload, including native `default`/`none` labels;
do not replace them with a portal display label.

Association selects a connection's outbound forwarding table. Propagation
controls where that connection's routes are visible; it does not select the
connection's outbound table. None means no propagation, not no association.
Empty label lists use the Default label unless None is explicit.

## Selection, tracing and inspection

Candidates are selected independently in each table before inter-hub export.
Dynamic remote advertisements follow destination labels, retain their origin
table context, and do not leak into unrelated Default tables. A connection's
propagation label need not exist on an origin table: the live Default-table
calibration demonstrated this case. The origin-context interpretation is
conservative when exports are remote-only or multiple origin contexts disagree.
The same origin-label exception on a custom source table is not live-calibrated;
affected remote contexts remain **Not assessed** rather than inheriting the
Default-table result as proof.
Default routes do not propagate between hubs.

VNet ingress and NVA ingress use their connection association. The hub-origin
path selector and BGP-table inspector expose explicit table selection. Forward
and return directions are evaluated independently. Longest-prefix lookup is
performed inside the selected table, not by filtering a preselected global RIB.

Unsupported static next hops, incomplete inventory/configuration, ambiguous
remote context, and custom contexts involving secured hubs produce **Not
assessed**, not a synthetic network failure or a healthy result. Arbitrary
firewall rules, NAT, sessions and vendor NVA behavior are not certified.

## Capture and comparison boundaries

The read-only collector adds `routingContextVersion: 1` to its existing capture
contract. It projects table identities, labels and static controls, and VNet
association/propagation with explicit provenance. It checks hub BGP inventory;
gateway presence or unobserved branch controls prevents authoritative full-scope
absence claims. No site, advertisement or NVA is fabricated.

An imported design with unobserved branch inputs or unconfirmed WAN transit
controls is also **Not assessed** for path certification, even if its captured
VNet configuration is readable. A structural projection cannot establish that
omitted sources or controls do not affect forwarding.

Effective-route capture queries discovered routable custom tables as well as
Default, never None. It reserves Default coverage at the 100-table global limit
and retains request, time, resource, row and byte bounds. Configuration inventory
remains bounded to 64 tables per hub.

Choose the same table identity in **Azure files > Compare with Azure capture**
and in the design. A missing, denied, failed, stale, unrequested or nonmatching
snapshot is not an empty table. Missing-route claims additionally require
complete authoritative configuration scope, explicit expected prefixes and a
complete expected design. Structural identity, selected next hops and optional
AS paths remain separate comparison dimensions.

An attached capture mapped to a hub is authoritative for snapshot lookup: a
missing selected custom table does not fall back to an older persisted table.
Persisted snapshots remain available for hubs not mapped by that attachment,
with their own collector metadata rather than the attachment's provenance.

Native JSON/storage retain the optional fields and unknown references.
Persisted legacy imports with disclosed limitations but no context metadata
migrate conservatively to unknown. Bicep export rejects custom, static or unknown
controls it cannot emit rather than silently dropping them.

## First-party references

- [Hub association, propagation, labels, None, branch constraints and inter-hub restrictions](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing)
- [Configure virtual hub routing](https://learn.microsoft.com/azure/virtual-wan/how-to-virtual-hub-routing)
- [Spoke BGP NVA hosting-connection and dual-session requirements](https://learn.microsoft.com/azure/virtual-wan/scenario-bgp-peering-hub#benefits-and-considerations)
- [Configure BGP peering to an NVA](https://learn.microsoft.com/azure/virtual-wan/create-bgp-peering-hub-portal)

The documented portal label spelling is not proof of case-insensitive native
matching. The controlled case-sensitive target-label result and its unchanged
origin-table control are recorded separately in
[#22's calibration evidence](https://github.com/erjosito/vwan-visual-topology/issues/22#issuecomment-6868732333).

## Replay fixtures and calibration status

The [fixture manifest](../tests/fixtures/azure-vwan-contexts/manifest.json) records
SHA-256 hashes of the **published sanitized bytes**, not the original private
captures. The fixtures are executable import/path regressions:

| Fixture | Provenance and expected interpretation |
| --- | --- |
| `native-default.json` | Actual two-hub collector output from November 14, 2026. Resource identities and public addresses are replaced. Both Default label spellings, unknown branch inputs and the unconfirmed WAN transit flag are retained; paths remain Not assessed. |
| `synthetic-custom.json` | Synthetic business-table association/propagation with two VNets. This is a regression case, not live Azure evidence. |
| `synthetic-isolated.json` | Synthetic None propagation while retaining business association. Forward and return reachability differ. This is not live Azure evidence. |
| `synthetic-mixed-intent.json` | Synthetic custom tables combined with private routing intent. Coverage must remain Not assessed. This is not live Azure evidence. |

The original lab's independent deadline cleanup began during a laptop outage.
Custom-table origin-label fallback, empty-propagation and shared-label controls
were prepared but not executed there. The captured Default label experiment
does not establish their behavior. A separately authorized follow-up lab is
being used for remaining live calibration; unexecuted controls are not passing
results and must not be presented as certified Azure behavior.
