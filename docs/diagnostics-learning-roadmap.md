# Diagnostics, service coverage and learning roadmap

Planning baseline: 2026-11-17. This records product direction, not implemented
capabilities, a delivery schedule or authorization to widen existing MVPs.
Linked issues own detailed scope and acceptance; implementation status must be
checked before advertising a capability.

## Direction

Expand from explaining which route wins to explaining which decision prevents
a particular request from working. Use one coherent investigation across DNS,
routing, transport policy and application routing, rather than disconnected
service panels or a second simulation engine.

The same deterministic evidence should support expert troubleshooting,
on-demand explanations, guided exercises and local headless/MCP clients.
Continue useful routing and packet exercises now; the broader curriculum does
not need to wait for every service or topic.

## One investigation, distinct evidence

Bind an investigation to original source/client and resolver identities, the
requested destination name or address, TCP/UDP protocol and ports, and HTTP
scheme/host/path where applicable. Preserve the request across repairs so the
user can compare equivalent assessments of successive topology revisions.

| Decision layer | Evidence to expose |
| --- | --- |
| Name resolution | Resolver context, visible zone/record, forwarding decisions, answer candidates or authoritative negative answer |
| Routing | Selected route and original table, next hop, independent return path and required inspection |
| Transport and policy | Compared TCP/UDP tuple, original subnet/NIC enforcement owners, matching NSG rule and supported NAT translations |
| Application routing | Original listener, hostname/path rule, backend/origin candidates and declared health |
| Proxy boundaries | Separate client-to-proxy and proxy-to-backend connections, transport source identity versus HTTP metadata |

These are related decisions, not a mandatory successful pipeline. An IP-only
probe need not involve DNS; Traffic Manager selects DNS answers and is never a
packet hop. Inspect known independent failures even when another stage is
unknown. Do not invent a resolved address, proxy source or healthy backend to
complete a trace.

Each finding should identify the responsible object, compared facts, reason,
evidence provenance and a native inspect/edit action. Keep declared
configuration, modeled outcomes and any separately captured Azure observations
distinguishable. A missing fact is not an authoritative negative DNS answer.

Use explicit supported, violated and unassessed outcomes in the relevant
versioned contracts. A permitted TCP path is not a successful handshake; a
handshake is not verified TLS or application availability. Likewise, a denied
or unresolved prerequisite must not certify isolation without sufficient
evidence.

## Learning and repair loop

1. Observe a reproducible failure for an explicit request.
2. Inspect evidence and identify the responsible decision and configuration.
3. Repair it through the original native control, with optional navigation help.
4. Rerun the same request against the changed topology.
5. Demonstrate the required outcome with fresh evidence, or diagnose the next
   exposed blocker.

For example, correcting a wrong DNS answer can expose a destination-port deny;
correcting that policy can expose the wrong HTTP backend selection. Do not
assume one repair proves end-to-end success or that every scenario has one
unique root cause.

Grade explicit supported outcomes, accept alternative valid repairs, and
invalidate stale results after edits or undo. Preserve first-earned awards,
protected practice workspaces and assessment-version compatibility. Separate
free help locating controls from conceptual hints and independent diagnosis;
local completion is not certification or proof of learning effectiveness.

## Capability stages and dependencies

The reviewed main-branch baseline already supports bounded IPv4 routing and
packet assessment, including scoped NSG, NAT/DNAT and regional Standard Load
Balancer cases. The guided course is primarily routing-focused. Application/DNS
foundation [#156](https://github.com/erjosito/vwan-visual-topology/issues/156)
landed in [#186](https://github.com/erjosito/vwan-visual-topology/pull/186), but
at this baseline no application or DNS service provider is enabled.

| Workstream | Intended first value and tracking |
| --- | --- |
| Existing networking | Enrich supported routing/packet exercises and conceptual design tasks now: [#210](https://github.com/erjosito/vwan-visual-topology/issues/210) |
| Three service MVPs | AppGW: Standard_v2 basic/exact-host/path routing and separate connections ([#157](https://github.com/erjosito/vwan-visual-topology/issues/157)); ATM: fresh-resolver Priority selection ([#158](https://github.com/erjosito/vwan-visual-topology/issues/158)); AFD: Standard/public-origin request routing ([#159](https://github.com/erjosito/vwan-visual-topology/issues/159)). Keep their approved exclusions. |
| DNS MVP, alongside service MVPs | Declared private zones, A/CNAME records, VNet links and explicit client resolver context. Start with fresh lookups and bounded missing-link/record, wrong-answer and public/private-resolution scenarios: [#212](https://github.com/erjosito/vwan-visual-topology/issues/212). No live recursive resolver or implicit custom forwarding. |
| Hybrid DNS follow-up | Add bounded custom DNS, conditional forwarding and Private Resolver endpoint/rule ownership after the basic DNS slice; stage within [#212](https://github.com/erjosito/vwan-visual-topology/issues/212). Resolver transport needs its own supported network evidence. |
| DNS/HTTP learning integration | Add versioned predicates, authoring validation and exact native service/evidence guidance as providers become ready: [#214](https://github.com/erjosito/vwan-visual-topology/issues/214). Provider delivery alone does not extend the current flow/route/packet grading contract. |
| PaaS access | Reuse existing private endpoint routes, then add explicit service identity/policy, DNS integration and a bounded Service Endpoint subset: [#213](https://github.com/erjosito/vwan-visual-topology/issues/213). DNS-dependent exercises require the relevant #212 slice. |
| Advanced delivery | Select later cache/failover, backend-type, proxy-composition and origin-restriction slices by exercise need: [#215](https://github.com/erjosito/vwan-visual-topology/issues/215), coordinated with service parent [#136](https://github.com/erjosito/vwan-visual-topology/issues/136). |
| Curated gallery | Organize original designs by supported task, concepts, prerequisites and limitations; distinguish runnable references, practice and validation fixtures: [#211](https://github.com/erjosito/vwan-visual-topology/issues/211). |

Cross-layer investigation presentation and reusable diagnostic findings need
explicit integration scoping alongside the providers and #214. Typed service
evidence and learning predicates alone do not deliver this unified experience.
Reuse the shared platform architecture; do not treat delivered foundation work
as an unimplemented replacement-engine backlog.

## Release and deferral boundaries

Every implemented slice needs honest capability discovery, strict original-owner
references, bounded/cancellable local execution, fresh revision-bound evidence,
native save/undo compatibility, and equivalent browser/headless/offline Electron
semantics. Include supported and unsupported cases, unknown inputs, alternative
repairs, keyboard/narrow UI and EN/JA guidance. Human learning-effectiveness
evaluation remains separate under
[#160](https://github.com/erjosito/vwan-visual-topology/issues/160).

Defer multicloud provider modeling explicitly:
[#216](https://github.com/erjosito/vwan-visual-topology/issues/216). Generic
site/NVA boundaries do not constitute non-Azure provider support. Other
unsupported advanced areas can remain conceptual or gain separately scoped
issues; do not make full Kubernetes ingress, WAF/DDoS/SSE, live monitoring,
capacity/convergence prediction or verified TLS/application behavior
prerequisites for this Azure-first roadmap.

Public curriculum, examples and diagrams must be independently authored.
Private copyrighted references stay local and excluded from version control;
do not copy them into issues, PRs, documentation, public assets or artifacts.
Check current official service documentation before implementing
version-sensitive semantics.

For current contracts and limits, see [PLATFORM.md](../PLATFORM.md). The
[guided-course authoring contract](../src/learning/AUTHORING.md) owns the current
published mission ladder, points, mastery checkpoints and qualification limits;
this roadmap does not introduce tasks, alter awards or enable planned providers.
The
[curriculum coverage assessment](https://github.com/erjosito/vwan-visual-topology/issues/210#issuecomment-6941627084)
records the initial gap analysis; this roadmap connects those workstreams to the
cross-layer diagnostic and learning direction.
