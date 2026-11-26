# Optional personal Microsoft accounts, private cloud storage and sharing

This feature is optional and disabled until configured. Anonymous simulation,
local files and the Electron application continue to work without signing in.
Only personal Microsoft accounts (for example Outlook.com and Hotmail) are
supported. Work/school accounts and Entra External ID external tenants are not
configured by this implementation.

The browser uses Microsoft's hosted sign-in and PKCE through MSAL Browser.
Configured Windows builds use the system browser and MSAL Node in Electron's
main process; tokens never enter the canvas renderer.
An Azure Functions v4 API validates delegated access tokens and accesses a
private Blob Storage container through managed identity. Users do not grant
Microsoft Graph permissions or access to their Azure subscriptions.

## What is saved

While signed in, curriculum enrollment and completion history synchronize
automatically. Anonymous history is kept separately and is never imported
automatically. **Cloud account > Import anonymous progress** requires confirmation
and keeps the anonymous original. Import only history that belongs to you.
Awards and belts remain self-reported learning records, not verified certification.

Topologies upload only through an explicit **Save as new cloud copy**,
**Update linked cloud save** or **Overwrite cloud save** action and confirmation.
The library supports named saves, loading, replacing and deletion.
Saving preserves the native topology format. Loading replaces the active design
through normal workspace admission; it does not deploy Azure resources. Export
any design you want to keep before loading another.

The header separates **Saved locally** (this browser or desktop profile, not a
JSON backup) from the current design's cloud relationship. **Matches last confirmed
cloud save** compares the design with the last acknowledged upload or load, not
continuous cloud synchronization. Later edits remain visibly unuploaded, including
edits made while an older snapshot uploads. A failed operation does not confirm
a save. Refreshing the cloud library can report a changed or missing record, but
never silently advances the linked write revision; review and explicitly select
the desired record before overwriting it.

**Update linked cloud save** retains that save's ID and conditional revision.
**Save as new cloud copy** creates another record and links this design to the
new copy. The account-scoped link survives a reload in the same tab using bounded
sessionStorage metadata: ID/name, provider, ETag and a content fingerprint, never
another topology copy. If metadata storage is unavailable, the dialog warns that
the link cannot be retained. Sign-out/account changes, new designs, accepted
imports and samples clear the link. Practice and read-only shares do not change
the normal design's status. There are no background topology uploads or polling.

Do not upload credentials or confidential network configuration without approval.
Topology inventory, addresses, names and retained native JSON fields are included.
The API does not store account email or display name. It derives a storage owner
from the validated token issuer and subject, not a browser-supplied user ID.

## Read-only sharing

**Cloud account > Share saved version** selects an existing owned save;
**Enable a 30-day link** requires separate confirmation. Saving privately does
not enable sharing. Unsaved workspace edits are never uploaded by sharing.
**Manage shared links** lists and revokes links, including links for deleted
saves. A stale library ETag prevents issuance; refresh cloud topologies first.

The approved policy is **anyone with the link**, **latest cloud-saved version**,
**read only**, with **30-day expiry** and owner revocation. Later saves and
renames appear when the recipient refreshes the view. The heading identifies
this as the latest saved version at the last refresh, with its exact cloud
revision (ETag), not a live editor or a pinned snapshot. Native topology IDs,
fields and manual coordinates are retained;
both native network formats (classic VWAN and mixed/H&S/Full) use their existing
diagram renderers without editor, import or owner-write handlers.

Opening a share never loads it into the recipient's design or practice session.
An already open workspace remains mounted but hidden, so returning preserves
drafts/history. A fresh share tab does not mount a workspace until Return is
selected. Signed-in recipients may explicitly export JSON or save a new record
in **their own** cloud library, never the owner's record. Anonymous import/export
of ordinary local designs is unchanged. Anyone who can view the document can
technically extract its data; this login-gated copy UI is not DRM.

Revocation, expiry, a missing source or deletion of its stored owner data prevents
future resolution. Conditional overwrites preserve a server-controlled blob
incarnation; deletion/recreation gets a new incarnation, so an old link cannot
resurrect even when an owner reuses the topology UUID. Pre-sharing blobs acquire
incarnation metadata conditionally on first issuance without changing their JSON
(their ETag/last-modified time advances; refresh the library). Signing out does
not revoke shares. Deleting a Microsoft account does not notify this independent
store: revoke links **before** account deletion, or have the operator erase that
owner's stored data; otherwise existing links can remain usable until expiry.
Already downloaded data and copies cannot be recalled.

Links contain a random 256-bit capability in the URL fragment, not a topology,
owner ID, storage path, bearer token or SAS. The anonymous resolver is exclusively
`POST /cloud/shared` with a small JSON body, not a token-bearing request URL.
`GET/PUT/DELETE /cloud/shares` remain bearer-authenticated and owner-scoped;
ordinary progress/topology APIs remain private. Public resolution also requires
the owner's private index record, valid expiry and the original incarnation.
Public/private responses use `no-store`, `nosniff`, `no-referrer` and no-index
headers; the app already applies a global no-referrer policy. Do not log request
bodies, fragments, authorization headers or share records in API/proxy/analytics
instrumentation. Hashes of capabilities, not capabilities, name resolver blobs.

The application bounds resolver bodies to 1 KiB, issuance to 2 KiB, documents to
4 MiB, a best-effort threshold of 50 share records per owner (including expired
records until revoked), resolver work to 8 concurrent
requests and 120 requests/minute per Function instance, and issuance to 6/minute
per owner per instance. The record threshold is not an atomic storage quota;
simultaneous issuances may exceed it. Throttling returns 429/Retry-After. Instance quotas reset
on restart and are **not a distributed or per-IP abuse control**. A public
production deployment should additionally configure its gateway/WAF's aggregate
rate, concurrency and cost limits appropriate to replica count and anticipated
traffic. Do not trust caller-supplied forwarded IP headers for authorization.

The legacy `#s=...` reader remains as a deprecated **read-only embedded snapshot**,
not the latest saved version. Its UI warns that old links cannot expire or be
revoked; it never replaces the workspace or auto-uploads. New full-payload URL
generation has been removed. Cloud-link creation/resolution needs configured web
cloud support and connectivity; unavailable, expired and revoked views preserve
the local design. Electron does not create/manage or resolve cloud sharing links.
Local JSON files remain its sharing alternative; legacy
snapshots can still be viewed locally without uploading.

These are source changes, not deployment instructions being executed. Deploy
matching frontend **and** backend versions deliberately before qualifying real
sharing. Older APIs report sharing unavailable; there is no embedded-URL fallback.

## Register the applications

These are administrator setup instructions for a new installation.
Use two registrations in an existing Microsoft Entra workforce tenant:

1. Register an API application supporting **Personal Microsoft accounts only**.
   Record its application/client ID. In its manifest, set
   `api.requestedAccessTokenVersion` to `2`.
2. Under **Expose an API**, use `api://<API-client-ID>` as the Application ID URI.
   Add a delegated scope named `Cloud.Access`, enabled for user consent. Give its
   consent text an accurate description of private learning and topology storage.
3. Register a separate SPA application supporting **Personal Microsoft accounts
   only**. Add the **Single-page application** platform, not the Web platform.
   Register the exact redirect URI
   `https://<simulator-host>/auth-redirect.html`. For development, separately add
   `http://localhost:5173/auth-redirect.html`, or the exact allowed local origin and
   port you actually use.
4. Give the SPA the API's delegated `Cloud.Access` permission. If the portal does
   not list a personal-account API under **My APIs**, locate it by its application
   ID under **APIs my organization uses**. Remove the default Microsoft Graph
   `User.Read` permission if present. No Graph permission is needed.
5. If required by your tenant's consent policy, pre-authorize this SPA for the
   exposed scope. Do not enable implicit token grants or create a SPA client secret.

Use descriptive names such as **AzNetSim Personal Accounts SPA** and
**AzNetSim User Cloud API**. Entra generates their GUID IDs. Personal-account-only
registrations do not support creating enterprise service principals in the
workforce tenant; do not broaden their supported account types to work around that.

The authority is fixed to `https://login.microsoftonline.com/consumers`.
The API accepts v2 tokens only, for the personal-account tenant
`9188040d-6c67-4c5b-b112-36a304b66dad`. It verifies signature, issuer, expiration,
not-before time, API audience, an explicitly authorized client ID and `Cloud.Access`.
An ID token or a token for Microsoft Graph is not an API access token.

The optional `CLOUD_DESKTOP_CLIENT_ID` setting authorizes one additional desktop
public client without changing the existing web client or storage owner derivation.
Register it for personal Microsoft accounts, grant the same API's delegated
`Cloud.Access` permission and configure its desktop redirect URI before enabling
the desktop client. Do not broaden the account audience or accept arbitrary
client IDs. A matching verified issuer/subject retains the same storage owner
across clients; real personal-account web/desktop interoperability still needs
live qualification. This backend capability alone does not enable Electron login; the Windows build
also needs the desktop configuration below.

See Microsoft's [supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types)
and [MSAL v5 redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge).
After registration, verify that a real personal account can consent to this API
scope. Local mocked identity tests cannot establish that the registrations or
tenant consent policy are correct.

## Configure the frontend

Set these public build-time variables in your build environment, then rebuild:

```text
VITE_MICROSOFT_CLIENT_ID=<SPA-client-ID>
VITE_CLOUD_API_SCOPE=api://<API-client-ID>/Cloud.Access
VITE_CLOUD_API_BASE_URL=/api/cloud
```

Client IDs and the scope are public identifiers, not credentials. Never put
secrets, storage keys or connection strings in `VITE_*` variables.
Invalid/missing configuration disables the cloud UI. Electron ignores it.
An API URL must use HTTPS, except localhost/127.0.0.1 in a development build.

Deploy both `index.html` and `auth-redirect.html` and their built assets.
The redirect bridge is standalone, does not mount React and must not run the
simulator router. Its path, protocol, hostname and port must exactly match the
SPA registration.

The provided SWA configuration allows Microsoft login network requests and
Microsoft sign-in frames. Only the bridge permits same-origin framing, for
MSAL's silent renewal; the main app still denies framing. Do not add a
`Cross-Origin-Opener-Policy` header to the bridge, including through a CDN or
reverse proxy, because it breaks the MSAL v5 response channel. Browsers blocking
third-party cookies or requiring fresh consent may still require
**Sign in again / switch account**.

## Configure Windows cloud sign-in

Create a separate **Personal Microsoft accounts only** public-client registration.
Under **Mobile and desktop applications**, register `http://localhost` as the
redirect URI (not an SPA or confidential Web redirect). Grant the existing API's
delegated `Cloud.Access` permission and obtain any required administrator consent.
Do not add a secret, implicit grants, Graph permissions or Azure subscription
permissions. The application uses authorization code + S256 PKCE, a random OAuth
state and an ephemeral loopback port bound only to `127.0.0.1`. Microsoft ignores
the port for the registered localhost desktop redirect.

Set `CLOUD_DESKTOP_CLIENT_ID` on the matching Function (or the Bicep
`desktopClientId` parameter), leaving `CLOUD_CLIENT_ID` unchanged. Deploy the
backend allowlist support before testing desktop API access.

These are public, **build-time** Windows settings:

```powershell
$env:AZNET_DESKTOP_CLOUD_CLIENT_ID = '<desktop-public-client-ID>'
$env:AZNET_DESKTOP_CLOUD_API_SCOPE = 'api://<existing-API-client-ID>/Cloud.Access'
$env:AZNET_DESKTOP_CLOUD_API_BASE_URL = 'https://<function-host>/api/cloud'
npm run build:desktop
```

The API base must be an absolute HTTPS URL, not the web build's optional relative
`/api/cloud`. CI uses repository variables `AZNET_DESKTOP_CLOUD_CLIENT_ID`,
`AZNET_DESKTOP_CLOUD_API_BASE_URL` and the existing `VITE_CLOUD_API_SCOPE`.
Missing/invalid configuration leaves sign-in unavailable without disabling local
simulation. The build embeds these settings in the main bundle; changing
environment variables after installation cannot redirect the app's cloud API.
Never put credentials in any of these variables.

Sign-in opens the system browser, not an Electron login window. **Cancel sign-in**,
sign-out, a two-minute callback timeout and quitting the app close the listener.
Only fixed, schema-checked library/progress/sharing-management operations cross
guarded IPC; there is no renderer HTTP proxy, raw token or arbitrary URL API.
The canvas keeps its existing CSP, blocked external network, sandbox and
context isolation. Main-process API calls omit cookies, reject redirects, bound
responses to 4 MiB and retain conditional ETags and account-generation checks.
They do not require a new browser CORS origin.

Tokens and the selected account are stored only in the current desktop profile's
`desktop-cloud-cache.v1.bin`, encrypted using Electron `safeStorage` (Windows
DPAPI). Unavailable OS encryption fails closed; there is no plaintext fallback.
An unreadable cache leaves the app signed out with explicit sign-in available.
Unavailable OS encryption prevents opening the sign-in browser.
Configured builds allow one instance per profile to avoid competing credential
writers. Startup restores only the deliberately selected cached account; it
does not launch a browser or automatically upload designs. API access renews
tokens silently when possible. Expired consent requires explicit sign-in.
**Sign out of this app** cancels old requests and removes the app's credential
cache; it does not sign out the system browser, revoke existing shares or erase
local topology/progress data. Export backups before removing an entire profile.
Switching accounts invalidates old library handles and pending replies.

Cloud library CRUD and learning progress use the existing account workflows.
Creating/managing sharing links and resolving links remain web-only in the UI;
desktop must not generate unusable `app://` sharing URLs. Azure resource collection
still uses its separate, explicitly chosen local Azure CLI session.

### Rollout qualification

Source integration and mocked tests do not establish successful production sign-in.
Before enabling/publishing a configured installer, verify an installed Windows
build with a real personal Microsoft account: consent, cancel/retry, restart and
silent renewal, account switch, sign-out, offline launch and failed API access.
Check that an existing web-created save and curriculum history appear in desktop,
and a desktop-created save/update appears on web with the same account. Verify a
different account cannot see either library and stale ETags still return 412.
The backend's unchanged issuer/subject owner derivation must be qualified with
real web/desktop access tokens; synthetic equal-claim tests are not proof that
the registrations produce the same owner. If they differ, stop rollout and plan
an explicit identity migration rather than silently creating a second library.
Do not log/copy tokens or cache plaintext while diagnosing this.

## Configure the Function and storage

Use an Azure Functions v4 JavaScript/Node.js app with a supported Node 22 runtime.
Precreate a container named `user-cloud` with anonymous access disabled. Disable
public blob access on the storage account too. The container is not created by
the app. Enable a system-assigned or user-assigned managed identity on the
Function and grant it **Storage Blob Data Contributor**, preferably scoped to
this container. Allow for RBAC propagation before testing.

| Function setting | Value |
| --- | --- |
| `FUNCTIONS_WORKER_RUNTIME` | `node` for non-Flex plans. Flex uses `functionAppConfig.runtime` instead. |
| `CLOUD_STORAGE_ACCOUNT_URL` | `https://<account>.blob.core.windows.net` |
| `CLOUD_RUNTIME_CLIENT_ID` | Optional user-assigned managed-identity client ID. Omit for system-assigned identity. |
| `CLOUD_API_AUDIENCE` | API application/client ID, the GUID, not `api://...`. |
| `CLOUD_CLIENT_ID` | Authorized SPA application/client ID. |
| `CLOUD_DESKTOP_CLIENT_ID` | Optional additional authorized desktop public-client ID; omit to keep web-only authorization. Never a wildcard or API audience. |
| `CLOUD_ALLOWED_ORIGINS` | Comma-separated exact browser origins, with scheme and port, without paths or trailing slashes. |

Also configure the Function host's own required storage and hosting settings.
Those are separate from the private user-data container. Do not reuse the
statistics dashboard's tenant-specific authentication settings or credentials.

The HTTP trigger intentionally has platform `authLevel: anonymous`: the handler
authenticates private data requests itself with a bearer access token. Only the
capability-based shared resolver is deliberately public. Do not put an
interactive Easy Auth redirect in front of this API. Do not expose storage keys,
SAS URLs, raw bearer tokens or document bodies in request logs.

Storage layout:

```text
users/<SHA256-of-issuer-and-subject>/progress.json
users/<same-owner>/topologies/<UUID>.json
users/<same-owner>/shares/<management-UUID>.json
shared/<SHA256-of-capability>.json
```

Each write is conditional: create uses `If-None-Match: *`, replacement/deletion
requires an exact `If-Match` ETag. Other users cannot select a different owner
through a URL, query or document field.

## Hosting and packaging

Choose a supported hosting arrangement before deploying:

* **Same origin:** route `/api/cloud/*` to this Function through a supported
  Static Web Apps linked backend or your reverse proxy. Check the actual SWA
  plan/backend capabilities first. The supplied production infrastructure uses
  the separate HTTPS API option instead of changing SWA backend authentication.
* **Separate HTTPS API:** set `VITE_CLOUD_API_BASE_URL` to
  `https://<function-host>/api/cloud`. Add that exact API origin to the main
  page's `connect-src` in `public/staticwebapp.config.json`. Keep Microsoft's
  existing entries and do not use `*`. Configure exact frontend origins in
  `CLOUD_ALLOWED_ORIGINS`. Configure the same exact origins in Function App
  platform CORS: the host handles browser OPTIONS preflights before the handler.
  Handler-only CORS is insufficient. Verify exposed `ETag` and allowed
  Authorization, Content-Type, If-Match and If-None-Match headers. Cookies and
  credentialed CORS are not used.

Build from the repository root in PowerShell:

```powershell
npm ci
npm ci --prefix functions\user-cloud
npm run build
npm run build:user-cloud
```

Publish `dist` as the frontend artifact. The backend artifact is separate:
package `functions\user-cloud\host.json`, `package.json`, `package-lock.json`,
and its built `dist\index.mjs` as the Function application root.
Azure packages and JOSE remain runtime dependencies. Use your chosen deployment
mechanism's production dependency restore, or stage `npm ci --omit=dev` with
the Function manifest and lockfile before zip deployment. Do not deploy just
the JavaScript bundle without its runtime dependencies. No resources are
created, registrations changed or applications deployed by these build commands.

## Production infrastructure and releases

`infra/user-cloud.bicep` provisions a dedicated resource group deployment with
AzNetSim-named runtime and GitHub identities, Node 22 Flex Consumption hosting
(512 MB, no always-ready instances, maximum 40 instances), and private Blob
storage. Create the resource group first and preview changes:

```powershell
az group create --name rg-aznetsim-user-cloud --location westeurope
az deployment group what-if --resource-group rg-aznetsim-user-cloud --template-file infra\user-cloud.bicep --parameters spaClientId=<SPA-client-ID> apiClientId=<API-client-ID>
az deployment group create --resource-group rg-aznetsim-user-cloud --template-file infra\user-cloud.bicep --parameters spaClientId=<SPA-client-ID> apiClientId=<API-client-ID>
```

Select the intended subscription explicitly for your installation. The deployment
returns the actual API URL, Function name and deployment identity client ID.
Its isolated VNet uses `10.247.69.0/24`; check this range before linking it to any
other network. Storage has shared-key and public network access disabled.
Blob traffic uses a private endpoint and private DNS. The runtime has Blob Data
Owner on this dedicated account for host locks, deployment packages and user
data. The GitHub identity has Website Contributor only on this Function.
Neither identity is shared with the statistics service.

The template's GitHub OIDC subject is pinned to this repository's immutable
identity and the **user-cloud-production** environment. Override
`githubOidcSubject` for a fork or a different environment, using the repository's
actual OIDC subject format. Do not replace federation with a client secret.

Configure these **repository variables** before the selected CI build:

| Variable | Value |
| --- | --- |
| `VITE_MICROSOFT_CLIENT_ID` | Personal Accounts SPA client ID |
| `VITE_CLOUD_API_SCOPE` | `api://<API-client-ID>/Cloud.Access` |
| `VITE_CLOUD_API_BASE_URL` | Deployment output `apiBaseUrl` |

The web build uses these variables. Windows uses the separate public-client ID
and absolute API URL described above, with the same API scope. Update the main
SWA CSP's exact `connect-src` API origin if provisioning another Function host.
Changing variables does not change an already-built candidate or the live site.

A running Function resource is not a deployed API. Promote the **user-cloud**
candidate separately from **web**; frontend sign-in can succeed while the backend
has no registered functions. The release workflow checks that the unauthenticated
topology-list route returns the expected 401 (not an empty 404) and that browser
write preflight works before recording a successful promotion. This probe does
not verify a personal account or storage writes. After release, verify an explicit
save, list, refresh and reopen with an authorized personal account.

The cloud panel distinguishes a failed list from an empty library. If a write is
confirmed but the following list refresh fails, the confirmed save remains
visible: retry **Refresh cloud topologies**, rather than saving another copy.
An interrupted write acknowledgement is not reported as success; retrying the
same save within the open panel confirms the original record without creating a
duplicate. Keep a local export if a write cannot be confirmed.

Configure **user-cloud-production** with deployment branches restricted to
`main`, retaining any required reviewers. Set its environment variables:

| Variable | Value |
| --- | --- |
| `AZURE_USER_CLOUD_CLIENT_ID` | Deployment identity client ID, not the SPA/API/runtime client ID |
| `AZURE_USER_CLOUD_TENANT_ID` | Infrastructure tenant ID |
| `AZURE_USER_CLOUD_SUBSCRIPTION_ID` | Infrastructure subscription ID |
| `AZURE_USER_CLOUD_RESOURCE_GROUP` | Dedicated resource group |
| `AZURE_USER_CLOUD_FUNCTION_APP` | Deployment output `functionAppName` |

CI stages `host.json`, the runtime manifest/lockfile and `dist/index.mjs`,
installs locked production dependencies, and records the exact ZIP as the
**user-cloud** candidate. Follow [explicit releases](releasing.md) to preflight
and promote this target from a successful main-push run. Release performs no
build or dependency restore. Deploy the backend before enabling the configured
**web** candidate. Merging alone never deploys either target.

Application Insights records sampled server operations and exceptions, not
frontend visitor analytics. Automatic dependency tracking is disabled to avoid
collecting per-owner Blob paths. Log Analytics retains 30 days and has a
0.1 GB daily ingestion cap; this is a best-effort telemetry cap, not a hard Azure
spending limit or an application rate limit. Monitor platform costs and configure
budget alerts and abuse protection for the intended public audience.
Private endpoints incur charges even when the Function scales to zero.

Blob and container soft deletion retain deleted data for 30 days. App deletion
does not purge these recoverable copies immediately. Production operators must
use their Azure administrative access for retention or permanent-erasure requests.

## Operational evidence and follow-ups

The following table inventories source contracts, not recovery guarantees.
The dated read-only inspection below records a limited deployment check
separately. No stored topology/progress content was read or modified.

| Question | What the repository establishes | What remains to decide or verify |
| --- | --- | --- |
| Is sharing throttled globally? | [`sharing.ts`](../functions/user-cloud/sharing.ts) keeps request, concurrency and per-owner issuance counters in the running handler's memory. The limits described under [read-only sharing](#read-only-sharing) are local, resettable controls, not aggregate or per-IP limits. | Approved inspection of the deployed ingress, worker/replica configuration and aggregate controls. Decide whether current exposure and demand justify a gateway rule or distributed enforcement; do not add infrastructure speculatively. |
| How far can hosting scale? | [`user-cloud.bicep`](../infra/user-cloud.bicep) specifies a maximum of 40 Function instances. That is neither an observed replica count nor a global application request/cost ceiling. | Actual deployed settings, expected traffic and an operator-approved abuse/cost policy. Telemetry ingestion caps are not spending limits. |
| Can deleted data be recovered? | The template enables 30-day Blob and container soft deletion. The API uses conditional writes and owner-scoped paths. | Data-plane access and an isolated restore drill remain unverified. Supported block-blob overwrites can have soft-deleted snapshots even without versioning, but their existence and successful restoration have not been tested. The template does not enable blob versioning or define a separate backup policy. |
| What does app deletion promise? | Deletes remove active records; soft-deleted copies may remain. Share resolution also depends on the private index and source incarnation. | A retention/erasure policy and a restore procedure that does not revive revoked links, erased data or stale write authority. Local profile recovery and portable JSON exports remain separate from server recovery. |

### Recovery policy and user-controlled copies

The owner confirmed that the cloud service is offered free without a data
guarantee. There is no promised recovery time, guaranteed recovery point or
successful-restore commitment. The configured retention window is an operational
setting, not a service-level guarantee. This does not change the documented
privacy, consent or deletion controls.

Recovery may be useful after an accidental deletion, an unwanted overwrite
(including an empty/reset history), or an operator/storage mistake. It cannot
recover changes that were never uploaded, and in-account soft deletion is not an
independent disaster-recovery backup.

Users should keep portable JSON copies of designs they need. Profile recovery
and a cloud save are not substitutes for a user-controlled backup. Batch export
and reimport of selected designs or the whole cloud library is a proposed
improvement, not an available feature or a replacement for existing individual
topology export/import. No new cloud resources or protection settings are
authorized by that proposal.

### Read-only configuration check, 2026-11-26

Scope: Azure Resource Manager metadata for the dedicated storage account and
`user-cloud` container in the repository's configured user-cloud resource group.
The resource group was resolved from the `user-cloud-production` deployment
variables. No blob listing, content, snapshots, credentials or application
settings were retrieved, and no setting was changed.

| Property | Observed result | Evidence limit |
| --- | --- | --- |
| Account | StorageV2, Standard_LRS; HNS flag unset/null | The template does not enable HNS. This is account configuration, not proof of any individual blob's type or history. |
| Blob soft deletion | Enabled, 30 days; `allowPermanentDelete: false` | Recovery has not been exercised. These settings alone do not prove that a particular deleted blob or snapshot remains recoverable. |
| Container soft deletion | Enabled, 30 days | No container was deleted or restored. Whole-container restoration could affect many users and is not authorized by this check. |
| Versioning, change feed, point-in-time restore | Unset/null in the returned service configuration, not explicitly enabled | Do not interpret this as an absence of soft-deleted overwrite snapshots or as tested recovery coverage. |
| Container access | Public access `None`; no container immutability policy or legal hold | This does not verify the operator's data-plane permissions or private-network access. |
| Backup vault resources in this resource group | None returned | Outside-group vaults, external copies and cross-resource protection relationships were not assessed; no claim that all backups are absent. |

The runtime storage-account application setting was not inspected. The check is
limited to the dedicated deployment account, not proof of the running
application's binding, exact deployed application revision, historical settings
or a working recovery path. No recovery point/time was measured.

Azure documents [soft deletion of blobs and supported overwrite snapshots](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview)
and [whole-container soft deletion](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-container-overview).
For supported flat-namespace block-blob overwrites, undeleting makes the retained
snapshots available; recovering previous content then requires a deliberate
snapshot copy/promotion. Metadata-only updates are not protected by blob soft
deletion in the same way. These are documented platform semantics, not results
of a local drill.

### Isolated restore verification procedure

This is a procedure to approve and execute later, not a completed drill. No
write/delete/restore scope has been approved. A best-effort drill does not
introduce a recovery SLA for the free service.

1. Obtain explicit operator approval for the test account(s), isolated
   container/environment, synthetic fixture IDs, allowed operations, retention
   window and cleanup. Agree the desired recovery point and recovery time.
   If safe isolation or approval is missing, record the blocker and stop.
   Do not inspect or restore unrelated user records.
2. Record the effective soft-delete, versioning/backup and access configuration
   using approved administrative metadata only. Prepare synthetic native
   topology and progress fixtures, preserving local originals for comparison.
   Create test saves/shares through normal consent and conditional-write paths.
   Include a second owned test account to check isolation if approved.
3. Delete only the approved fixtures and verify the expected missing/revoked
   behavior. Use the approved administrative recovery mechanism to recover only
   those fixtures within the measured retention window. Treat overwrite recovery
   as a separate case: inspect only approved fixture snapshots, versions or
   backups. Where soft deletion retained a pre-overwrite snapshot, undelete it
   and perform the separately approved copy/promotion. If no suitable retained
   copy exists, record the case as unrecoverable; do not infer that merely from
   disabled versioning or treat a deleted-blob drill as proof.
4. Verify native content against the originals, account isolation and rejection
   of stale ETags after restoration. Check both share-index and source-incarnation
   behavior. Restoring old share/index/source records can revive an unexpired
   capability; do not restore revoked links or expose restored sharing records
   without an explicitly reviewed revocation policy. Stop if deletion or sharing
   expectations cannot be preserved.
5. Record the date, tested source/deployment revision, approved scope,
   configuration, elapsed recovery time, content hashes, outcomes and remaining
   gaps. Do not retain topology bodies, owner paths, capability URLs, credentials
   or tokens in reports/logs. Revoke test shares and clean up only the approved
   fixtures under the agreed retention policy. Record retained soft-deleted
   copies honestly; application cleanup is not immediate permanent erasure.

Track the [aggregate sharing-limit decision (#473)](https://github.com/erjosito/vwan-visual-topology/issues/473)
and [retention/recovery decision (#474)](https://github.com/erjosito/vwan-visual-topology/issues/474)
separately under #382. Boundary-preservation requirements remain in the
[platform host contract](../PLATFORM.md#clients-and-data-flow) and
[document lifecycle](document-lifecycle.md); signing remains #146.

## Conflicts, offline use and privacy

Account progress has a separate local cache per Microsoft home account ID.
If cloud and cached histories diverge, synchronization stops rather than
overwriting one silently. Back up the account history through the learning
status panel, then choose **Use cloud history** or **Use this account cache**.
Writes made during another save are queued. Connection failures keep local
history; retry through **Refresh cloud progress**, reconnecting, or the periodic
60-second check. A signed-in badge does not mean all changes have synchronized.

Signing out immediately detaches cloud access and returns to anonymous history.
It clears this app's in-tab Microsoft account/token cache, not your Microsoft
session in other websites. Account learning caches remain on this device.
On a shared device, export anything needed and clear this site's browser data
when finished. Fresh tabs without this app's session marker require sign-in.
Browser duplicate-tab and session-restore features can retain sessionStorage;
closing a tab is not a substitute for explicitly signing out on a shared device.

Cloud topologies never autosave. Stale replacements/deletions are rejected;
refresh the list before choosing again. Failed/timeout responses may have an
unknown server-side outcome, so refresh before creating another save. Keep
local exports for offline access and recovery. Signing in does not isolate
the existing local design workspace by account; only learning caches and the
cloud library are account-specific.

The object/request limit is 4 MiB and names are limited to 120 characters.
New topology creation has a best-effort threshold of 50 records per account.
This is not an atomic storage quota: simultaneous creates can exceed it.
Existing records remain listed so users can delete them. Add production
rate limits, abuse protection, spending alerts and retention controls appropriate
to a public personal-account service before opening it broadly.

Resetting learning history while signed in synchronizes the empty history.
Deleting a cloud topology leaves the local design untouched. The authenticated
API also supports ETag-conditional `DELETE /api/cloud/progress` for removal.
Choose and disclose Blob soft-delete/versioning, backup retention and
administrator deletion procedures: app deletion does not promise immediate
erasure of provider backups. There is no permanent account profile in this API.
Local caches are not encrypted by the app. Storage encryption and operator
access follow your Azure account configuration.

## Validation before enabling for users

Local unit tests validate signed JWT claims, per-owner API paths, native
topology admission, conditional versions and progress synchronization.
Browser tests replace only identity/configuration and exercise the real app
with the production handler and an in-memory store. They do not authenticate
against Microsoft or persist to Azure.

Before rollout, use the actual registrations, deployed headers and managed
identity to verify personal-account sign-in/consent, token renewal, account
switching, denied work/school accounts, cross-account isolation, cloud progress
and topology operations, offline/conflict recovery and the configured retention
policy. Infrastructure deployment and release success do not establish that a
real user has signed in or completed a cloud save; verify those interactively
with personal accounts before claiming end-to-end rollout validation.
