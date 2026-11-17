# Curated topology collection

The gallery is an open-ended routing reference, not an assessed course or a
production deployment recommendation. Use **Learn & practice** for protected,
assessed exercises. Related objective labels identify conceptual overlap; the
button opens the course at the learner's current position, preserving course
prerequisites and awards. Opening a sample never completes an exercise.

## Choosing a starting point

The default **Reference topologies** collection contains focused reference
architectures. **Validation scenarios** is a separate, explicitly selected
collection containing small control/fault cases and two dense diagnostic stress
cases. Validation does not mean that every configuration in a fixture is healthy.
Difficulty describes the knowledge needed to investigate the sample, not a
qualification earned by loading it.

Within either collection, concept tracks put the investigation before the
historical filename:

| Track | Intended task |
| --- | --- |
| Route selection foundations | Compare prefix length, route source, endpoint overrides and UDR next hops |
| Inspection and return paths | Verify inspection in both directions and repair gateway return routing |
| Hybrid BGP and branch transit | Compare preferences, propagation gates and NVA-provided transit |
| Multi-region and coexistence | Follow explicitly configured regional and cross-architecture transit |
| Routing traps and diagnostics | Investigate deliberate, sometimes interacting faults |

Use the track and complexity filters together with search. Search accepts stable
IDs, short aliases, localized titles, purpose and concept text. For an introductory
Virtual WAN comparison, start with **Hub Routing Preferences**. For a small UDR
lookup exercise, select **Validation scenarios**, then **UC8**. The absence of a
minimal, healthy direct-peering reference in the current inventory remains a
content gap; UC8 is not relabeled as that design.

Each card provides purpose, prerequisites, key concepts, supported inspection
tools, limits and a suggested experiment. Study guides are expandable to avoid
making architecture selection depend on reading every implementation detail.
English and Japanese are supported.

## Inventory and disposition

All 19 existing sample IDs are retained. The source of gallery ordering and
metadata is `src/sample-catalog.ts`. The underlying topology JSON and routing
semantics are unchanged by this curation.

| Stable ID | Workspace | Collection / track | Level | Disposition and overlap decision |
| --- | --- | --- | --- | --- |
| `hub-routing-preferences` | VWAN | Reference / hybrid BGP | Foundational | Keep the focused transport-preference comparison first |
| `secured-hub-routing-intent` | VWAN | Reference / inspection | Intermediate | Keep the secured-versus-unsecured hub comparison |
| `spoke-bgp-nva-transit` | VWAN | Reference / hybrid BGP | Advanced | Keep indirect appliance-provided transit distinct from native peering |
| `default-example` | VWAN | Reference / multi-region | Intermediate | Reframe as dual-hub transport reference, not default startup content |
| `three-hub-all-features-asymmetric` | VWAN | Validation / diagnostics | Advanced | Move the all-features showcase to a diagnostic stress case |
| `hub-spoke-firewall-udr` | Hub-and-Spoke / Full | Reference / inspection | Intermediate | Keep the broader inspection architecture; not interchangeable with UC2's isolated fault |
| `ars-sdwan-nva-coexistence` | Hub-and-Spoke / Full | Reference / hybrid BGP | Intermediate | Keep broad coexistence distinct from UC1's control case and UC5's selection cases |
| `dual-hub-vnra-global-peering` | Hub-and-Spoke / Full | Reference / multi-region | Advanced | Keep explicit chained appliance transit |
| `hybrid-vwan-and-hub-spoke` | Full only | Reference / multi-region | Advanced | Keep cross-architecture coexistence; hide from Hub-and-Spoke gallery |
| `enterprise-vnet-all-features-showcase` | Hub-and-Spoke / Full | Validation / diagnostics | Advanced | Move dense all-features content to a diagnostic stress case |
| `uc1-hub-spoke-nva-ars-baseline` | Hub-and-Spoke / Full | Validation / inspection | Intermediate | Keep the small baseline as a control, not a duplicate production reference |
| `uc2-gateway-subnet-missing-udr-asymmetry` | Hub-and-Spoke / Full | Validation / inspection | Foundational | Keep isolated return-route fault |
| `uc3-bgp-propagation-and-peering-gates` | Hub-and-Spoke / Full | Validation / hybrid BGP | Foundational | Keep propagation versus forwarding-permission comparison |
| `uc4-private-endpoint-udr-override` | Hub-and-Spoke / Full | Validation / foundations | Intermediate | Keep endpoint-specific route-policy comparison |
| `uc5-ars-branch-to-branch-and-bgp-selection` | Hub-and-Spoke / Full | Validation / hybrid BGP | Intermediate | Keep Route Server selection distinct from Virtual WAN hub preference |
| `uc6-ars-default-route-self-blackhole` | Hub-and-Spoke / Full | Validation / diagnostics | Intermediate | Keep the self-loop case distinct from inspection bypass |
| `uc7-bgp-lpm-bypasses-summary-udr` | Hub-and-Spoke / Full | Validation / foundations | Foundational | Keep unequal-prefix selection distinct from UC4's endpoint policy |
| `uc8-udr-next-hop-types-and-vng-transit-trap` | Hub-and-Spoke / Full | Validation / foundations | Foundational | Keep the compact next-hop comparison and intentional blackhole |
| `uc9-expressroute-hairpin-two-vnets` | Hub-and-Spoke / Full | Validation / multi-region | Advanced | Keep the focused location-transit case separate from coexistence |

No topology is deleted or consolidated: overlapping fixtures test different
control-plane or forwarding conditions, while the larger references provide
context those fixtures intentionally omit. Consolidation is at the discovery
layer: one shared catalog replaces duplicated workspace gallery metadata, and
stress cases no longer compete with clean reference starting points.

## Compatibility and safety

The legacy `mode=hub-spoke` URL currently opens the Full Hybrid editor; the
internal Hub-and-Spoke-only view continues to exclude the coexistence design.
Canonical `?sample=<stable-id>` URLs remain supported in the corresponding
workspace. For unambiguous links, include `mode=vwan`, `mode=hub-spoke` or
`mode=full`, for example `/?mode=vwan&sample=hub-routing-preferences`.
The built-in `default-example` remains available without creating a JSON file.
Downloaded JSON filenames and JSON schemas do not change.

Additional convenience aliases resolve to the same canonical IDs: `hrp`,
`routing-intent`, `bgp-nva-spoke`, `default`, `three-hub-showcase`,
`hub-spoke-firewall`, `ars-sdwan`, `dual-hub-vnra`, `hybrid-coexistence`,
`enterprise-showcase`, and `uc1` through `uc9`. These are additions, not
replacements for the stable IDs.

Workspace replacement still requires confirmation and offers JSON export.
Cancellation, failed loads and closing an in-flight load preserve the existing
workspace. The shared modal retains keyboard focus handling, narrow layouts and
light/dark themes. Optional gallery code remains lazy in the VWAN workspace.

## Capability and curriculum boundaries

Related objective mappings coordinate this collection with #210:

| Objective | Related reference / validation material |
| --- | --- |
| Route overrides peering | UC6, UC8 |
| Only one workload is down | UC4, UC7 |
| The branch cannot reply | Firewall hub-and-spoke, UC1, UC2 |
| The secured WAN path | Secured virtual hub, dual-hub Virtual WAN |
| Two faults, one hybrid network | Full Hybrid coexistence and the two stress cases |

These are conceptual links, not claims that a sample satisfies a lesson's
assessment predicates. No course checks, progress, awards or scenarios change.
Track-aware learning UI in #217 / #218 is independent of the gallery filters.

Prioritize missing designs only against implemented, testable capabilities:

| Priority | Candidate | Gate |
| --- | --- | --- |
| Next content slice | Minimal healthy direct-peering reference with a route-override companion | Existing routing support; coordinate with #210 and assess separately |
| Later | DNS-linked private endpoint reference | Relevant #212 provider slice and #213 service access evidence |
| Later | DNS/HTTP multi-stage investigation | #157–#159 service providers and #214 learning evidence |
| Deferred | Hybrid DNS, advanced proxy composition, multicloud | Respective #212, #215 and #216 scope; never advertise as currently runnable |

The reviewed diagnostics/learning roadmap informs these gates. Public metadata
and this organization are independently authored. Private reference material is
not part of the catalog, repository assets, tests or PR artifacts.
