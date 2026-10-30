# Verification report provenance

The [complete report](README.md), [sanitized evidence](raw-output/), [manifest](evidence-manifest.json), and [editable diagrams](diagrams/) are now maintained alongside the application in this repository.

| Property | Imported snapshot |
|---|---|
| Upstream | [erjosito/vwan-routing-verification-20261029-4cf83ab4](https://github.com/erjosito/vwan-routing-verification-20261029-4cf83ab4) |
| Exact upstream commit | `417cdd4bd28a9fe1c296464f719e4844036326c8` |
| Consolidation date | 2026-10-30 |
| Scope | All 228 tracked files: original README, 212 sanitized JSON evidence files, manifest, 13 diagram/icon files, and `.gitattributes` |
| Integrity | All 228 copied files matched the upstream checkout byte-for-byte; all 212 `publishedSanitizedSha256` entries matched |
| Added here | This provenance file only; the imported snapshot is unchanged |

Preserve the distinction between an original prediction commitment and the hash of a sanitized published derivative. `predictionSha256` and `originalPrivateEvidenceSha256` are not expected to equal a copied file's hash. Use `publishedSanitizedSha256` for the published JSON files.

Original failed predictions, later corrections, scoped passes, and cleanup proofs remain intact. Historical wording and absolute upstream links in the frozen report have deliberately not been rewritten. The findings apply to the model revisions and scenarios recorded there, not to every subsequent application version.

No Azure or provider resources were deployed or re-created for this consolidation. The original source repository was not deleted, archived, or changed: it was still **public** when this snapshot was imported. Making the application repository private does not retroactively change the upstream repository's visibility.

This directory is repository documentation, not application content: it is outside `src` and `public` and is not included in the static application's `dist` deployment.

Current implementation and review: [routing logic and critique](../../ROUTING-LOGIC.md). Reusable operational guidance: [Azure testing lessons](../../AZURE-TESTING-LESSONS.md).
