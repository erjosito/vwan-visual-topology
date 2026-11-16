# L7 and DNS modeling contract

Design follow-up for #136, grounded in the existing packet/inventory contracts.
This document defines the first implementation slices; it does not enable these
services, deploy resources or certify application availability.

## Implemented foundation (#156)

The shared foundation is implemented as platform contract 2, optional native
`application.version: 1` identity inventory, separate HTTP/DNS requests, typed
decision/uncertainty envelopes, bounded worker execution and original-reference
VNet detail projection. Legacy contract 1 rejects application fields explicitly;
legacy documents without the extension retain their native meaning.
See [the platform contract guide](../PLATFORM.md#applicationdns-contracts-foundation-156)
and `src/application.ts` for exact admitted shapes and limits.

**No service provider is enabled.** Service-specific configuration fields
(listeners, rules, pools/groups, DNS methods/endpoints) fail admission until their
provider children define and test those schemas. Identity declarations do not
enable service authoring, application exercises, capture or Bicep export.
Every foundation request reports configuration and availability as unassessed;
it performs no service matching, DNS lookup, health check or network-leg
fabrication. The service sections below remain the planned #157–159 boundaries.

## Boundary and evaluation

Keep three different questions separate:

1. **DNS:** which configured endpoint names could this resolver receive?
2. **HTTP request:** which listener, rule and eligible backend/origin could handle
   this scheme/host/path?
3. **Network legs:** can the modeled client and proxy/backend endpoints exchange
   the necessary IPv4 TCP tuples through the original routing/filtering owners?

Traffic Manager returns a DNS answer. It is never a packet hop. Application
Gateway and Front Door terminate one connection and originate another; neither
can be added to a packet trace as if it merely forwards the unchanged tuple.
Preserve the client identity as HTTP metadata separately from the proxy's
transport source. X-Forwarded-For is not a source-IP override for an NSG.

Use the existing native document, stable inventory IDs, admission bounds and
worker/job cancellation. Inventory references identify original frontends,
subnets, workloads/NIC/IP configurations, backend pools and services. The VNet
detail dialog and selected-flow boundary overlay project these same objects.
Do not create a second editable application diagram, global all-to-all edges or
a separate routing implementation.

### Versioned result envelope (proposed extension)

An optional, versioned `application` document extension and request operation
must pass admission and capability negotiation before use. Legacy documents
without it retain their current meaning. Unknown future versions are rejected
on import, not silently dropped. Changes to the platform's strict contract and
capability schema must be versioned and covered by old-client rejection tests.

The request contains original client identity, scheme (`http`/`https`), host,
port and a normalized absolute path, plus an explicitly selected service.
DNS evaluation is a separate operation with resolver context and evaluation
time. It must not be silently inferred from a destination IP.

Results contain an ordered list of typed decisions:

| Decision | Required evidence |
| --- | --- |
| `dns-selection` | Original profile/endpoint IDs, configured method, enabled/health state, candidate answers, TTL/cache context |
| `listener-match` | Original service/listener ID, scheme/host/port match, matched rule and configured priority |
| `request-route` | Path match/default, original pool/group, candidate backends/origins, explicit unknown/rejected features |
| `network-leg` | Original client/proxy/backend IDs, before/after tuple and references to existing packet evidence |
| `response-assumption` | Conditional response owner, unsupported TLS/WAF/application assumptions and limits |

Each decision reports `satisfied`, `violated` or `not-assessed`, with reasons,
source/configuration provenance and references. A malformed configuration is an
admission/validation error, not a healthy route. An unknown prerequisite cannot
be converted into a selected healthy backend or a successful application result.
Independent, definite failures may still be reported without claiming unknown
stages succeeded. Overall configuration reachability and application success
are separate: **no initial slice returns verified HTTP/TLS availability**.

Represent all eligible candidates when platform selection cannot be reproduced.
An illustrative choice, if provided, is explicitly labeled, deterministic and
does not claim Azure's production load distribution. No live probes, DNS,
certificate checks, remote fetches, cloud credentials or latency emulation.

## First service slices

### 1. Application Gateway

- Regional **Standard_v2** first, explicit public/private IPv4 frontend and owned
  subnet. HTTPS is configuration-only; certificate validation is not simulated.
- Basic/exact-host listeners and Basic or ordered URL-path-based routing with a
  default backend. Rule priority is explicit and unique (1–20000). Do not apply
  Front Door's path matching algorithm to Application Gateway.
- Backend HTTP settings provide port/protocol. Original backend endpoint IDs and
  declared healthy/unhealthy/unknown assessment remain distinct from network
  reachability and probe transport permission.
- Evaluate client-to-gateway and gateway-to-backend legs separately. Preserve
  original subnet/NSG/route ownership; subnet-wide source possibilities cannot
  be reduced to a fabricated guaranteed appliance instance IP.
- First slice excludes WAF evaluation, advanced preview rules, wildcard/multisite
  listeners beyond the explicit subset, rewrites, redirects, cookie affinity,
  autoscaling/capacity, live health and the TCP/TLS proxy feature. Unsupported
  declarations remain visible/unassessed or fail admission for invalid shapes.

### 2. Traffic Manager

- First method: **Priority**, with explicitly configured enabled external
  endpoints, unique priorities and healthy/unhealthy/unknown monitoring evidence.
- Return candidate DNS names/answers and explain selection. In the documented
  all-degraded case, preserve Traffic Manager's fallback behavior; do not teach
  that an unhealthy profile always returns no endpoint. Unknown health that
  could change the winner leaves selection unassessed.
- First evaluation is explicitly **fresh resolver/no cached answer**. A later
  optional single-resolver cache may use caller-supplied time and a prior answer
  with remaining TTL. Never claim immediate failover for existing cached answers
  or predict recursive resolver/client TTL compliance.
- No HTTP proxy, new packet source, synthetic peering or route. Selecting a name
  does not prove its address/reachability; unresolved names stay unassessed.
- Weighted, Performance, Geographic, Multivalue, Subnet and nested profiles are
  deferred. In particular, configured weights are not observed traffic shares.

### 3. Front Door

- **Standard**, public IPv4 origins first; preserve the future Premium/Private
  Link boundary without advertising it as supported. Classic is not the target.
- Explicit domain, HTTP(S), exact/terminal-wildcard path matching and origin
  groups. Test documented matching precedence rather than sharing a guessed
  longest-prefix implementation with Application Gateway.
- Declared origin enabled/priority/health and explicitly bounded eligibility.
  Return candidate origins; do not invent edge location, latency samples,
  proprietary selection, DNS resolution or live failover timing.
- Separate client-to-edge and edge-to-origin legs. The edge is not a VNet router
  and cannot receive synthetic private/BGP routes. Where Azure service source
  ranges cannot be concretely assessed by the packet kernel, retain an explicit
  unassessed boundary rather than a universal trusted source.
- Caching, rule sets, origin overrides, WAF, Private Link, response compression,
  session affinity, WebSockets and real TLS validation are deferred. Absence of a
  matching route and unsupported features have distinct explanations.

## Shared limits and validation

Start with at most 32 application services, 64 listeners/rules per service,
64 backend/origin members per pool/group, 32 DNS profiles and 64 DNS endpoints
per profile, within existing aggregate admission/output/work limits. These are
simulator bounds, not Azure quotas. Enforce bounded strings, no arbitrary regular
expressions, unique original IDs, owner/reference integrity and safe path/host
normalization. Do not fetch a user-provided origin URL to assess configuration.

Every implementation child includes EN/JA content, explicit help/source links,
keyboard/focus and narrow/light/dark detail tests, unchanged legacy saves,
native export/reload/undo, worker/headless parity and offline Electron. Add
negative tests where unsupported policy, unknown health or missing DNS cannot
earn a configured/isolated training result. Add at least two valid alternate
designs before introducing an open-ended graded exercise.

New Azure capture/Bicep output requires its own allowlist, original-ID provenance
and tested deployment subset. Initial service authoring does not imply capture,
deployment, resource existence, live health or imported policy completeness.

## Delivery order

Shared contract/admission/evidence first, then Application Gateway, Traffic
Manager, and Front Door. The latter services reuse proven original-identity and
leg UI primitives, not another service's selection semantics. The service
children may be refined after their focused feasibility checks; keep #136 open
until its implemented supported scope and explicit deferrals are reconciled.
None blocks VPN NAT, the existing Internet/L4 milestone or offline practice.

## Verified references

Reviewed 2026-11-16. Service documentation can change independently of this
versioned simulator subset:

- [Application Gateway request rules, priorities and preview boundary](https://learn.microsoft.com/en-us/azure/application-gateway/configuration-request-routing-rules)
- [Application Gateway health probes](https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-probe-overview)
- [Traffic Manager DNS routing methods](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods)
- [Traffic Manager monitoring and degraded behavior](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring)
- [Front Door route matching](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-route-matching)
- [Front Door origin selection](https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods)
