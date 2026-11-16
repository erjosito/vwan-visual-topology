---
name: network-simulation
description: Create or evaluate Azure networking topology JSON with the local simulator MCP. Use for Virtual WAN, hub-and-spoke or Full Hybrid designs, effective routes, modeled forwarding and explicit requirement checks.
---

# Local network simulation

Use the `azure-network-simulator` MCP tools for deterministic results. Do not
invent routing outcomes or replace the engine with your own networking rules.
The server must already be installed/built and enabled; do not silently install
tools, grant permissions or enable an external service.

## Privacy and limits

The engine/MCP run locally, but tool inputs and results may reach your selected
AI provider. Do not claim cloud Copilot is offline or safe for confidential data
merely because the MCP transport is local. Follow the user's data policy.
These tools do not authorize file writes, Azure commands, deployments or changes
to an open simulator canvas. No generic shell or collection tool is provided.

## Workflow

1. Discover `get_capabilities` and `get_schema` for the selected mode. Preserve
   native topology versions and explicit unsupported behavior.
2. Record every user requirement and assumption. Translate supported goals
   into uniquely identified `flow` or exact-table `route` assertions; list
   interpretive, bandwidth, SLA, firewall-policy and other unsupported goals
   separately. Never silently omit a goal and claim the whole request passed.
3. Construct JSON from the documented example and run `start_simulation` with
   `operation: validate`. Read `get_job`; fix configuration errors before grading.
4. Start `operation: evaluate` with the reviewed explicit assertions. Read job
   status with sensible waits, not tight polling. Read bounded `get_evidence`
   chunks for failed or unknown assertions and relevant routes. Concatenate all
   chunks before interpreting JSON; a partial chunk is not a complete result.
5. Revise at most three times, recording which assumption/configuration changed.
   Cancel unwanted work with `cancel_job`. Budget exhaustion, missing ownership,
   unsupported controls and `not assessed` never count as successful checks.
6. Present the native JSON for deliberate import through the existing web or
   desktop UI. Include engine/contract version, per-requirement outcomes,
   witnesses, limitations and unresolved goals. Do not overwrite files or mutate
   the current UI unless the user separately authorizes that operation.

The simulator models steady-state routing, not elapsed Azure convergence,
traffic delivery, firewall rules/NAT/session enforcement or vendor internals.
It reevaluates HRP changes immediately and does not require route bouncing.

## Optional flow diagrams

When runtime capabilities include `rendering`, use `start_render` with a
completed evaluation handle and exact flow `assessmentId`. Options select
GIF/animated SVG/PNG, 1500/2000 ms and width 640-1400. Read `get_render_job`,
then fetch all `get_artifact` chunks. Decode each base64 chunk separately and
concatenate bytes by offset; verify total length and SHA-256 before handing off.
Use `release_render` after retrieval or `cancel_render` to stop unwanted work.
Saving an artifact requires separate caller file-write authorization.

The shared logical scene expands Firewall hops and preserves independent
forward/return and unknown/stopped states. It is not a screenshot of the current
canvas or proof of packet delivery, permissions, sessions or elapsed timing.
Do not label unknowns as successes or interpret circle speed as latency.
