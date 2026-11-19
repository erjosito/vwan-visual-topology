# Optional personal Microsoft accounts, private cloud storage and sharing

This feature is optional and disabled until configured. Anonymous simulation,
local files and the Electron application continue to work without signing in.
Only personal Microsoft accounts (for example Outlook.com and Hotmail) are
supported. Work/school accounts and Entra External ID external tenants are not
configured by this implementation.

The browser uses Microsoft's hosted sign-in and PKCE through MSAL Browser.
An Azure Functions v4 API validates delegated access tokens and accesses a
private Blob Storage container through managed identity. Users do not grant
Microsoft Graph permissions or access to their Azure subscriptions.

## What is saved

While signed in, curriculum enrollment and completion history synchronize
automatically. Anonymous history is kept separately and is never imported
automatically. **Cloud account > Import anonymous progress** requires confirmation
and keeps the anonymous original. Import only history that belongs to you.
Awards and belts remain self-reported learning records, not verified certification.

Topologies upload only through an explicit **Save to cloud** action and a
confirmation. The library supports named saves, loading, replacing and deletion.
Saving preserves the native topology format. Loading replaces the active design
through normal workspace admission; it does not deploy Azure resources. Export
any design you want to keep before loading another.

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
this as the latest saved version at the last refresh, not a live editor or a
pinned snapshot. Native topology IDs, fields and manual coordinates are retained;
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
the local design. Electron does not issue/resolve cloud links or launch an
external integration. Local JSON files remain its sharing alternative; legacy
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
not-before time, API audience, the authorized SPA client ID and `Cloud.Access`.
An ID token or a token for Microsoft Graph is not an API access token.

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

CI injects them into the web build only, not the Electron build. Update the main
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
