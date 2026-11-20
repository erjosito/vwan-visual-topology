# Subnet UDR route-table regions

Azure subnet route tables are independent resources in the topology's global
`udrTables` array. Their optional `region` attribute is not VNet ownership.
Unassociated tables are allowed, and multiple subnets/VNets in the same region
can share a table. Region comparisons ignore case, spaces and hyphens
(`West Europe` and `westeurope` compare equally).

For version 2 JSON without table regions, a region is inferred only if all
existing subnet associations identify one nonempty normalized VNet region.
This compatibility rule does not modify imported JSON. An unused legacy table,
an association with an unknown region, or conflicting legacy associations has
no inferred region; configure the table explicitly before making associations.
No workspace-wide default is assigned. When authoring changes legacy
associations or VNet regions, the prior unambiguous region is pinned to the
table so that moving a VNet cannot implicitly move an independent resource.

Authoring rejects new invalid associations and region changes that invalidate
existing associations. Previously imported invalid references remain intact
and can be repaired incrementally. Validation and routing diagnostics identify
them. Invalid/unknown associations do not apply UDRs or propagation settings;
forwarding is conservatively **not assessed**, not proof of connectivity or
isolation, until repaired.

Azure capture import preserves each route table's `location` as `region`.
Bicep emits each table in its own normalized region and preserves subnet
associations. Export rejects invalid associations or unresolved table regions
rather than substituting the export's default location.

Subscription identity is not modeled here, so same-subscription eligibility
is not assessed. Virtual WAN hub route tables are outside this contract.

Reference: [Azure route-table association rules](https://learn.microsoft.com/en-us/azure/virtual-network/manage-route-table#associate-a-route-table-to-a-subnet).
