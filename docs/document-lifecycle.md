# Document lifecycle contract

Each open design has one `WorkspaceDocument` identity. Its native provider,
undo/redo history, editor state, configuration registrations, artifact commands
and cloud save state belong to that document, not to the currently visible tab.
Practice has separate history, storage and assessment ownership; it has no
ordinary document artifact commands.

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
