# Large captures and explicit two-WAN composition

These are application modeling bounds, not Azure quotas. No Azure resource or
live tunnel is created by importing a file.

## More than 500 VNets

The collector and importer accept up to **1000 aggregate VNet references** across
at most **20 hubs**. Unread references count too. Above 60 imported spokes there
is still a **1000-total-IPv4-prefix** budget; two prefixes on each of 600 VNets
will exceed it. The ≤60-spoke / 30-prefix-per-spoke envelope is unchanged.

The default collector reads each referenced VNet individually. To avoid exhausting
the unchanged **500 CLI invocation** limit, explicitly opt into resource-group
VNet listing:

```powershell
.\collect-azure-vwan.ps1 -VirtualWanId $wanId -BulkVnetReads `
  -AllowCrossSubscriptionVnets -OutputFile .\wan-a.json
```

`-AllowCrossSubscriptionVnets` is only necessary for cross-subscription references.
`-BulkVnetReads` requires read/list access on the referenced VNets' resource groups
and temporarily reads other VNets' address-space/community metadata there. Only
referenced VNets are exported. Each resource group is listed once, with bounded
pagination (2000 entries / 20 pages), and all pages/retries count against the same
500-invocation budget. A permission failure stays incomplete; there is no silent
fallback, unlimited retry or omission masquerading as a complete capture.

The 20-minute overall limit and 2 MB structural / 8 MB observed capture limits
are unchanged. Many separate resource groups can still exceed the request budget.
Do not delete references or merge hub arrays to bypass admission. Keep separate,
explicitly scoped investigations if an inventory exceeds these bounds.

Native layouts retain up to 1400 positions per view within the same coordinate
bounds. Large constellation views add capacity with each ring.
Headless admission **still has a 512-total-node limit** (including hubs and other
owners), a 4 MB input limit and an 8 MB output limit: 501 VNets with four hubs
can validate, while 1000 VNets cannot be submitted as one headless job.
A large full-table result can return `OUTPUT_LIMIT` / not assessed. These limits
are not raised merely because browser structural import admits 1000 references.

## Two WANs: deliberate composition, not concatenation

For a synthetic, manually authored starting point, import
[`samples/two-wan-s2s.json`](../samples/two-wan-s2s.json). Its four-hub paths cross
both VPN endpoint hubs; its remote VNet is deliberately **not** a P2S client.

Collect each Standard WAN separately using its original `-VirtualWanId`. Then
create a local envelope; `aHubId` and `bHubId` are the **original Azure hub ARM
IDs** at the tunnel ends:

```powershell
$federation = @{
  kind = 'azure-vwan-federation'; version = 1; name = 'Two WAN investigation'
  captures = @(
    (Get-Content .\wan-a.json -Raw | ConvertFrom-Json -AsHashtable),
    (Get-Content .\wan-b.json -Raw | ConvertFrom-Json -AsHashtable)
  )
  interWanVpns = @(@{
    id = 'wan-vpn'; name = 'Explicit S2S tunnel'
    aHubId = $wanAEndpointHubArmId; bHubId = $wanBEndpointHubArmId
    enabled = $true; status = 'configured'
    aToB = @('10.10.0.0/16'); bToA = @('10.20.0.0/16')
  })
}
$federation | ConvertTo-Json -Depth 100 |
  Set-Content .\federation.json -Encoding utf8
```

Import `federation.json` using **Import JSON** or **Import Azure capture**, review
the combined omissions, and acknowledge replacement. The 2 MB browser import
limit applies to the **whole envelope**. Exactly two different WANs, at most
20 aggregate hubs / 1000 aggregate references / 1000 prefixes above 60 spokes,
and zero or one explicit S2S link are supported. Original hub and VNet IDs stay
stable; duplicate/ambiguous ownership is rejected.

The native JSON stores `wans`, each hub's `wanId`, and `interWanVpns`. Old native
files without WAN scopes retain their previous single-WAN behavior. Imported
provenance retains both source IDs in `azureImport.wanIds`; `wanId` is the first
source for backward-compatible metadata only, **not** the federation's owner.
Per-WAN capture timestamps/collector versions are retained on `wans`. Captures
are non-atomic; effective-route snapshots remain read-only observations.

Only hubs in the **same WAN** receive implicit backbone links. Cross-WAN routes
must traverse the explicit VPN endpoints, including intermediate intra-WAN hubs;
forward and return directions are evaluated independently. Each direction exports
selected source-endpoint **Default-table** IPv4 routes contained in its declared
prefixes. Empty exports mean no routes; default-route export is unsupported.
These are explicit static VPN route exports with an empty modeled local AS path,
not inferred BGP advertisements or a prediction of negotiated AS-path preference.
Imported VPN routes are not reflected back across the tunnel.
WAN branch-to-branch controls are retained independently. A WAN with branch
transit disabled does not export its branch-origin routes to the inter-WAN VPN
or other branches; VNet-to-VPN traffic remains enabled.

Edit either endpoint hub to change **S2S tunnel enabled**, **VPN model provenance**
and **A to B / B to A IPv4 export prefixes**. WAN ownership is shown on hubs and
editable in the hub dialog. Export/reload native JSON to retain these assumptions.
Deleting an endpoint removes its VPN. Bicep export is blocked rather than creating
one fictitious WAN; Full Hybrid conversion does not automatically add federation.

## What this does not establish

`status: 'configured'` is an explicit **manually authored route-export assumption**,
not evidence that Azure's managed gateways negotiate that session. Real VPN
gateway tunnel/session state, shared-ASN handling, gateway route maps/propagation,
IPsec, NAT, authentication and service constraints are not reconstructed.
Use `status: 'unknown'` when those assumptions cannot be declared; forwarding and
isolation then remain unknown. Unknown/incomplete imported routing is never
cleared by this declaration.

In particular, **P2S / remote-access clients, client address pools, authentication,
client route download and P2S-to-S2S transit are unsupported**. A P2S gateway flag
does not create simulated clients or prove remote-access delivery. Captures with
uncaptured gateway advertisements retain their original uncertainty. Use a
separately authored native model only for a deliberate S2S/VNet routing experiment,
not as a production replica. Issue #282 remains open for that remote-access scope.
