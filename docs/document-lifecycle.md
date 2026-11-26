# Document lifecycle contract

When profile recovery is unavailable or another window owns it, one workspace notice explains that changes are temporary and provides **Save a file** and **Save to cloud** actions for the active tab. Save every changed tab before closing. Cloud saving is disabled when it is not configured; confirmed file/cloud saves remain independent of profile recovery. contract

Each open design has one `WorkspaceDocument` identity. Its native provider,
undo/redo history, editor state, configuration registrations, artifact commands
and cloud save state belong to that document, not to the currently visible tab.
Practice has separate history, storage and assessment ownership; it has no
ordinary document artifact commands.

This is the living contract for the implemented #364/#374 tabs and Save work,
not the earlier architecture assessment's proposed design. For native/API
versions, provider support and host boundaries, use the
[platform contract map](../PLATFORM.md#living-contracts-and-sources).

## Ownership and revisions

- The active document alone accepts editor/history and topology-storage writes.
  A live inactive document may finish its own already-submitted artifact save.
  Closing revokes its commands and file capabilities, even if the same stored
  identity is subsequently reopened.
- An artifact save freezes the submitted topology before asynchronous permission
  or writer work. Confirmation records that snapshot's digest, then checks the
  current topology. Newer edits remain unsaved.
- Recheck document liveness, confirmation generation and cloud account generation
  after asynchronous revision verification as well as after the write. Signing
  out and back in does not restore an old operation's authority.
- Routing/display revisions, document fingerprints and assessment generations
  serve different purposes. Switching providers/documents invalidates stale
  interactive evidence; ordinary edits and practice observations retain their
  existing scoped assessment rules.

## Destinations and closing

Live simulation requests use `createPlatformRequest` to omit absent typed
envelope and budget options. Native topology and requirement data must remain
unchanged for admission; never stringify/parse a request to erase invalid
values. Native producers delete cleared optional fields rather than assign
`undefined`. Browser and Node workers validate returned contract/provider
identity and assessment completeness; malformed replies settle as unassessed,
not successful evidence.

First Save requests a destination; subsequent Save uses the last confirmed
destination. Save As changes that destination only after acknowledged success.
Cancellation, denied permission, ETag conflict and unconfirmed downloads retain
the prior destination. A restored file hint is not permission to overwrite it.
Desktop writes require the document-bound main-process token; supported browser
writes require the original private handle and matching file revision.

Recovery storage is not an explicitly saved artifact. Destination metadata and
capabilities stay outside portable topology JSON and public shares.

`useWorkspaceConfigurationPending` registers controlled form state with its
captured document owner. The VWAN object form uses this explicit registration.
Canvas overlays also retain the existing DOM-derived guard for not-yet-migrated
fields, but report its result to that same owner rather than a global active-tab
scan. Resource-switch guards remain until those editors are migrated.

A matching topology digest alone cannot authorize closing an unapplied
configuration form. Close offers Save / Discard / Cancel without first silently
discarding the form. Save and close requires applying pending configuration in
its own tab, and rechecks **every** target document after all asynchronous saves.
An edit or account change in an earlier document cannot be lost while a later
document finishes saving. Explicit Discard remains a separate user decision.

## Implementation and acceptance evidence

| Requirement | Existing implementation | Automated evidence |
| --- | --- | --- |
| Independent topology, history, view/draft ownership and restart | #389 (#364) | `workspace-documents.test.ts`, `workspace-tabs.test.ts`, `single-workspace.spec.ts`, `configuration-selection.spec.ts` |
| Destination, digest, first/repeated Save, Save As and permission renewal | #391 (#374) | `document-commands.test.ts`, `document-metadata.test.ts`, `browser-document-writer.test.ts`, `document-file-writer.spec.ts` |
| Native file ownership, cancellation, conflicts and safe offline writes | #391 (#374) | `desktop-document-writer.test.ts`, `platform/electron/document-files.test.ts`, `scripts/test-desktop-document.mjs` |
| Account/ETag ownership and delayed saves after switching | #389 and #391 | `workspace-documents.test.ts`, `cloud-account.spec.ts` |
| Practice/history/evidence isolation | Existing practice contract, retained by #389 | `practice-workspace.spec.ts`, `single-workspace.spec.ts`, `learning-progress.spec.ts` |
| Post-verification revocation, pending configuration ownership and all-target close revalidation | #385 integration | New regressions in `document-commands.test.ts` and `document-file-writer.spec.ts` |
| Applicable keyboard, EN/JA, narrow layouts and native round trips | #389, #391 and #392; retained by #385 | Document/configuration/localization browser suites plus normal production, desktop and MCP qualification |

This is an incremental integration of the existing tabs and Save contracts,
not another document implementation. Human usability feedback in #301/#299
and responsiveness optimization in #384 remain separate work.

## Mixed-provider controllers

`AzureNetApp` composes provider hooks rather than implementing their lifecycles:

- `useAzDocument` owns native initialization/recovery, the sole editable topology,
  bounded undo/redo, validated commits and profile/practice persistence. Its
  replacement command admits native data and resets the existing save authority;
  artifact Save commands remain in the shared document layer.
- `useAzSelection` owns inspected/canvas/route identities and the existing
  dirty-configuration switch guard. Creation completion has a distinct command
  because its configuration has already been applied.
- `useAzTraceSession` owns document-scoped endpoints and pair, custom-IP and
  bounded group traces. Routing projections retain original IDs; display names
  do not select routes.
- `useAzDiagnosisSession` owns worker creation/disposal, revision/request matching,
  continuation and cancellation. Restored interrupted runs are cancelled, not
  restarted or certified; queued replies lose authority on disposal.

These hooks reuse the existing captured-owner editor state and history APIs.
They do not introduce a global store, second document graph or new wire format.
The page retains feature composition and shared action wiring. Optional feature
editors stay in their existing lazy modules; unrelated context concerns are not
split without independent subscription/ownership semantics.

## Foundational dependency boundaries

Platform builds run `scripts/dependency-boundaries.mjs` before bundling. Its
TypeScript AST graph covers non-test TS/TSX/MJS/CJS modules in `src`, `platform`,
`functions` and `scripts`, including relative static runtime imports and
re-exports. Type-only edges, dynamic imports, external packages and non-code
assets are excluded. Unresolved code edges and runtime cycles fail the build;
this is not a proof about dynamic execution or external package internals.

IPv4/CIDR, stable ARM identity and deployment location primitives remain
runtime leaves. Aggregate validation consumes inventory projections, not the
reverse. Observation data parsing receives already validated capture structure;
the observation facade and importer compose it without mutual imports. Cloud
handlers and sharing use the same bounded body reader and error identity from
`functions/user-cloud/http.ts`. Compatibility re-exports retain existing APIs
but remain visible to the cycle guard.
