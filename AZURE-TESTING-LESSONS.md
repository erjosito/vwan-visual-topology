# Lessons learned: testing and verification in Azure

These practices come from the real two-hub Virtual WAN conformance exercise in
[#5](https://github.com/erjosito/vwan-visual-topology/issues/5). The
[scoped lab report](verification/azure-vwan-2026-10-29/README.md)
contains the measured outcomes, sanitized evidence and editable diagrams. This
is a reusable testing guide, not a certificate that every routing scenario has
passed. Keep limitations and final cleanup evidence in the report and issue.

## Design experiments that can disprove the model

- Write expected selections, advertisements and forwarding outcomes **before**
  running a scenario. Save the topology, model commit, UTC timestamp and SHA256.
  Keep the original bytes even when a prediction fails.
- Separate a blind prediction from an input-calibrated experiment, a
  retrospective comparison and a post-fix repeat. All are useful, but they are
  different evidence.
- Change one variable at a time: source advertisements, hub routing preference
  (HRP), routing intent or firewall policy. Record the actual initial state.
- Independently expose each competing route by withdrawing the other origin.
  A configured prepend count does not prove that Azure received that path.
- Test both arrival orders when selection might depend on withdrawal/recovery
  history. Do not call a transient or history-sensitive nominal match a
  universal conformance pass.
- Use non-overlapping prefixes for baseline reachability and a deliberately
  overlapping prefix for selection. Add a more-specific prefix to test
  longest-prefix match independently of HRP.

## Gate observations on actual readiness

An accepted ARM request, `--no-wait`, or a configured BGP neighbor is not proof of
readiness. Wait for the desired persisted configuration, completed provisioning
states and actual Established peers. Then require at least two matching route
observations separated in time; this lab uses a minimum 30-second separation.

Use bounded polling and explicit deadlines. Preserve failed observations. Stop a
read-only comparison once a stable mismatch needs investigation rather than
repeatedly waiting for the desired answer; do not terminate a resource mutation
and assume it rolled back.

Updating an owned Megaport VXC's static routes can temporarily interrupt its BGP
sessions even when the BGP configuration is preserved. Recheck actual peer
readiness after the update. A capture that correctly refuses a down peer is not
an empty-route result.

## Collect each layer; do not conflate their AS paths

| Evidence | What it establishes |
|---|---|
| Hub effective routes | The reported selected prefix, next-hop type, origin and native AS path. |
| VPN/NVA BIRD receiver and export tables | Actual received BGP paths and source configuration, with distinct inbound/export semantics. |
| Both ExpressRoute MSEE route tables | Routes at the Azure edge diagnostic stage, not necessarily the final customer wire path. |
| Auxiliary ER gateway learned/advertised routes | An additional Azure-origin observation point, not an independent customer-AS substitute. |
| Actual customer MCR per-neighbor Received routes | Positive customer-boundary advertisements and their exact reported AS strings. |
| Endpoint identity and causal forwarding probes | Observed delivery and, with additional controls, evidence of traversal. |

Always collect all available layers. A convenient API is not necessarily the
right observation boundary.

With routing intent, distinguish the default table's security redirects from
the security next hop's post-inspection forwarding table. Microsoft documents
next-hop resource effective routes for private routing policy; for Internet-only
policy, use the default route table instead. Bind a reported next hop to the
queried owned firewall resource ID or private IP, not just its display label.
For the CLI effective-route request, the working firewall resource type was
`AzureFirewalls` (plural). `AzureFirewall` returned HTTP 200 with an empty table
even after private intent completed; the plural request returned the known
routes. Check the request encoding before treating an empty result as evidence.

A firewall Internet default does not establish that Internet routing intent is
enabled. In the private-only test, both firewall tables included Internet
`0.0.0.0/0`, while both hub tables contained only RFC1918 redirects and no
default. Keep the forwarding planes and the policy configuration distinct.

Default advertisements also depend on connection flags, not just the hub policy.
The Internet-only lab positively observed VPN defaults with wire AS path
`65515` and customer ER defaults with `12076` on connections whose Internet
security flag was true. These defaults were outside the declared positive-wire
subset and current model scope, tracked separately in
[#13](https://github.com/erjosito/vwan-visual-topology/issues/13).

A newly learned default can invalidate the probe endpoint's return path. Here,
BIRD installed a VPN default with metric 32 ahead of the endpoint's DHCP
underlay default with metric 100. Replies to both owned firewall public IPs then
selected XFRM tunnels. Two exact public `/32` underlay response guards restored
the expected HTTP deliveries without changing BGP exports or cloud permissions.
Retain the initial failed observations and declare the corrected-lab repeat;
do not silently discard failures or withdraw a legitimate advertisement just
to make a probe pass. Forward-path selection is not return-path symmetry.

### ExpressRoute-specific findings

- The native hub RIB, upstream MSEE diagnostics, VPN receiver and final ER
  customer can legitimately show different AS strings. Declare any projection
  in advance; never normalize away an unexplained discrepancy.
- In this lab, auxiliary Azure ER inputs reported two provider ASNs under some
  HRPs and three under ASPath; VPN receiver paths did not always mirror that
  native representation. This remains an investigation in
  [#9](https://github.com/erjosito/vwan-visual-topology/issues/9), not a universal
  path-rewriting rule.
- MSEE removes private ASNs at the customer export boundary. Both RFC 6996
  ranges matter: `64512-65534` and `4200000000-4294967294`. Actual customer
  receipts for the tested private-AS VPN prefixes contained only `12076`.
  Preserve public-AS order and prepends; do not strip private ASNs from hub
  inputs or VPN exports. The application correction is tracked in
  [#11](https://github.com/erjosito/vwan-visual-topology/issues/11).
- An auxiliary VNet behind an ER gateway is useful, but is not sufficient by
  itself to establish behavior for a customer-originated ER prefix. Repeat
  important distinctions with an actual customer MCR origin.
- Documentation can contain conflicting rules and examples. In
  [#10](https://github.com/erjosito/vwan-visual-topology/issues/10), the
  unconditional "remote ER last" ASPath rule contradicted the measured shorter
  remote ER selection. The physical MCR control independently proved remote
  ER4 and local VPN10, then reproduced the ER selection after both arrival
  orders. Retain the failed original prediction and document the conflict
  before changing the algorithm.
- Include the two inter-hub `65520` prepends exactly once when comparing received
  path lengths. Do not add them a second time in warnings or assertions.

### Megaport diagnostics

Use the current documented asynchronous route API rather than assuming a legacy
synchronous empty response means the looking glass is unusable:

1. Request the owned MCR's
   `/v2/product/mcr2/{uid}/diagnostics/routes/bgp/neighbor` with
   `direction=RECEIVED`, `peer_ip_address` and `async=True`.
2. Read the operation UUID from `data`.
3. Poll `/v2/product/mcr2/{uid}/diagnostics/routes/operation?operationId={uuid}`
   until the operation completes, with bounded waits.

Respect diagnostic rate limits; this is troubleshooting, not regular monitoring.
Distinguish a pending operation, a completed empty list and an HTTP/API failure.
Check actual Established state and exact product ownership before capture.
The MCR product exposes speed as `portSpeed`; VXC speed uses `rateLimit`.

## Absence is weaker evidence than a positive route

The native hub-connection inbound/outbound APIs returned HTTP 200 with empty
results despite independently known routes. Those responses were not accepted
as suppression or advertisement-pass evidence.

An on-premises receiver can also reject a route containing its own ASN, and
per-neighbor diagnostics may expose different route sets. Therefore:

- Compare exact positive paths first, including next-hop identity.
- Require positive control prefixes before treating an empty result as useful.
- Do not infer Azure suppression from receiver absence, own-AS rejection,
  incomplete diagnostics or a down session.
- Keep "not observed" separate from "verified absent."

## Make endpoint and firewall tests causal

An HTTP response or ping alone does not establish which path was used. Check an
exact, unique endpoint identity, not merely HTTP 200. A wrong host, HTTP 403 or
an arbitrary probe error must not count as a successful deny.

For routing-intent verification, prepare narrow allow/deny experiments that
affect only the owned workload source IPs, exact probe destinations and test
port. Test allow, SE deny, NE deny and restore-allow epochs with repeated probes.
These are external causal controls; the simulator does not model firewall
filtering or SNAT. Until those epochs run, successful connectivity is not proof
that traffic traversed the expected firewall or firewall sequence.

Validate the control policy itself before enabling intent: Azure rejected a
rule collection group priority of 50 because the minimum is 100. A probe
collection at 100 can precede the functional allow collection at 200 within the
existing reviewed group. Preserve and verify the original functional rules,
and skip unchanged policy writes instead of triggering needless reprovisioning.

Preserve the controller's provider/management HTTPS access and the VMs' required
AzureCloud TCP 443 Run Command return channel before enabling Internet intent.
Verify both spoke connections' actual Internet-security flags first; do not send
an unnecessary update when they are already enabled. After routing intent
manages routing configuration, avoid resubmitting stale association/propagation
fields.

Synthetic MCR static routes are valid control-plane route-injection tools, but
do not create a real on-premises endpoint. Never claim endpoint delivery through
such a synthetic origin. Do not enable Global Reach or support-only ER-to-ER
firewall transit merely to make a test pass.

## Appliance and collector lessons

- Use Ubuntu with StrongSwan and BIRD for reproducible VPN branches. Verify both
  IPsec paths and BGP peers, then verify actual forwarding.
- BIRD's export table shows configured prepends before its normal eBGP own-AS
  prepend. Confirm the final path at the Azure receiver.
- Parse and check generated BIRD configuration with the version installed in
  the appliance. Controller Python/PowerShell success does not establish
  compatibility with the VM's older runtime or BIRD parser.
- Preserve the management underlay. Do not install a broad kernel BGP exporter
  on the controller merely to observe routes.
- Keep BGP VPN site address spaces absent when testing a BGP-only origin;
  otherwise a static advertisement can become an unintended competing source.
- A direct-spoke NVA BGP connection is **not** a hub-integrated SD-WAN appliance.
  Its model support is separately tracked in
  [#6](https://github.com/erjosito/vwan-visual-topology/issues/6).
- Azure can materialize `vnetLocalRouteOverrideCriteria: "Contains"` alongside
  an empty `staticRoutes` array. The criterion alone does not imply a
  nonstandard forwarding configuration. This caused the collector defect in
  [#7](https://github.com/erjosito/vwan-visual-topology/issues/7).
- A structural import pass is not routing conformance. Verify preview,
  acknowledged omissions, stable source IDs, persistence, native JSON
  round-trip and zero external app requests separately from routes.

## Tooling, credentials and safe automation

Use explicit `--subscription` on every Azure command in a shared environment;
do not change the shared CLI default. Check both SKU catalog restrictions and
live deployment validation before committing to a VM size or region.

Pass Bicep parameters as a JSON file (`--parameters '@parameters.json'`),
particularly for SSH keys and values containing spaces or `=`. Review ARM
validation and what-if before deployment. An exact unchanged app export should
be compiled, validated, deployed and checked before any lab-only augmentation.

`az vm run-command` can report provisioning success even when the script failed.
Require explicit semantic success markers and expected identities. Run Command
output is bounded: retain complete evidence privately on the VM and transfer a
bounded compressed packet with SHA256 and length checks when appropriate.
Never overlap Run Commands on the same VM.

Keep private-only Key Vault access private. Use an owned private endpoint and
the narrow required identity grants; never weaken public-network restrictions
to retrieve credentials. Fetch credentials at runtime, keep them out of output,
and do not save authentication headers or full secret-bearing provider objects.
Preserve unrelated VXC BGP/interface/commercial settings when changing one
owned field; refuse ambiguous or masked authentication configurations.

## Cost, deadlines and cleanup are verification requirements

For this exercise the user permits up to **USD 1,500 in Azure spend**. That is a
ceiling, not a target: retain the existing cheaper resource plan unless more
resources are necessary. The separately approved **USD 250 Megaport envelope**
is unchanged. Use **no Google Cloud resources**; no Google deployment is needed.
Provider charges are separate from Azure billing, and zero cancellation quotes
do not mean zero recurring charges or zero accrued spend.

Maintain a tagged ownership ledger, write-ahead provider order intents and an
independent cleanup watchdog. Check the watchdog and controller access after
network changes. Preserve the approved lifetime: start teardown by hour 42 and
finish before the 48-hour hard deadline; additional budget does not extend it.

Delete only resources created for this run, using recorded IDs and verified
ownership, in dependency order:

1. Both hub and auxiliary ER gateway connections.
2. ER private peerings.
3. Owned Megaport VXCs.
4. Owned Megaport MCRs.
5. Owned Azure resource group, plus only the task-created external identity
   grants and endpoint associations.

Do not delete the Azure resource group first and assume provider cleanup will
follow. Verify deletions and residual liabilities; preserve the pre-existing
vault, provider inventory and any other borrowed validation resources.

Keep the controller and private credential path until provider removal has been
independently verified and the proof is retained locally. A staged early-cleanup
mode can remove the owned ER attachments, peerings and provider products while
deliberately retaining the resource group. Test that mode separately without
replacing or disabling the active deadline watchdog.

Before deletion, privately fingerprint unrelated provider product IDs and
states, including nested VXCs rather than only top-level MCRs. After cleanup,
verify those records are unchanged and each owned product is decommissioned or
returns HTTP 404. Publish only the counts and verification outcome, not the
unrelated account inventory.

An accepted DELETE is not completed cleanup. Wait for actual group absence,
check for remaining run-tagged resources, and verify the exact external RBAC and
endpoint IDs are absent. Azure CLI can wrap 404s in structured JSON, and RBAC
uses `RoleAssignmentNotFound`; recognize specific API error codes, never treat
every failed request as absence. After the controller VM is deleted, rely on
the accepted Azure operation and caller-side verification, not its former
watchdog.

## Reporting and regression discipline

Keep a durable issue checkpoint after each milestone, including failures,
conditional matches, unresolved questions and next actions. Report selection,
advertisement, structural import and actual forwarding counts separately.
Retain UTC timestamps, model commits and immutable evidence hashes.

For a confirmed application defect: add a focused regression that fails before
the fix, make the smallest correction, run targeted tests/lint/build, then the
existing full CI. Verify the deployed UI and actual Azure/provider evidence
again. Do not replace the original prediction with the corrected answer.

Publish only sanitized evidence. Remove service keys, tokens, credentials,
passwords and secret-bearing provider payloads. Keep private ownership and
recovery material outside the public repository.

Redacted derivatives have different bytes. Record the original private SHA256
and the published sanitized SHA256 separately, and verify hashes against the
staged Git blobs after line-ending normalization. Do not present an original
prediction commitment as the hash of its redacted public copy.

## References

- [Lab tracking and evidence](https://github.com/erjosito/vwan-visual-topology/issues/5)
- [Virtual hub routing preference](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference)
- [Virtual WAN routing deep dive](https://learn.microsoft.com/azure/virtual-wan/routing-deep-dive)
- [Routing intent and routing policies](https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies)
- [MSEE private-AS removal considerations](https://learn.microsoft.com/azure/route-server/route-maps-scenario-prepend-routes#considerations)
- [Linux VM Run Command](https://learn.microsoft.com/azure/virtual-machines/linux/run-command)
- [Megaport asynchronous diagnostics](https://docs.megaport.com/api/api-mcr-diagnostics/)
- [Megaport API reference](https://dev.megaport.com/)
