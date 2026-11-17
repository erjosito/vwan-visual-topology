# Optional personal Microsoft accounts and private cloud storage

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

## Register the applications

These are administrator setup instructions, not automatic provisioning.
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
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `CLOUD_STORAGE_ACCOUNT_URL` | `https://<account>.blob.core.windows.net` |
| `CLOUD_RUNTIME_CLIENT_ID` | Optional user-assigned managed-identity client ID. Omit for system-assigned identity. |
| `CLOUD_API_AUDIENCE` | API application/client ID, the GUID, not `api://...`. |
| `CLOUD_CLIENT_ID` | Authorized SPA application/client ID. |
| `CLOUD_ALLOWED_ORIGINS` | Comma-separated exact browser origins, with scheme and port, without paths or trailing slashes. |

Also configure the Function host's own required storage and hosting settings.
Those are separate from the private user-data container. Do not reuse the
statistics dashboard's tenant-specific authentication settings or credentials.

The HTTP trigger intentionally has platform `authLevel: anonymous`: the handler
authenticates every data request itself with a bearer access token. Do not put an
interactive Easy Auth redirect in front of this API. Do not expose storage keys,
SAS URLs, raw bearer tokens or document bodies in request logs.

Storage layout:

```text
users/<SHA256-of-issuer-and-subject>/progress.json
users/<same-owner>/topologies/<UUID>.json
```

Each write is conditional: create uses `If-None-Match: *`, replacement/deletion
requires an exact `If-Match` ETag. Other users cannot select a different owner
through a URL, query or document field.

## Hosting and packaging

Choose a supported hosting arrangement before deploying:

* **Same origin:** route `/api/cloud/*` to this Function through a supported
  Static Web Apps linked backend or your reverse proxy. Check the actual SWA
  plan/backend capabilities first; this change does not upgrade a plan or
  modify the existing deployment workflows.
* **Separate HTTPS API:** set `VITE_CLOUD_API_BASE_URL` to
  `https://<function-host>/api/cloud`. Add that exact API origin to the main
  page's `connect-src` in `public/staticwebapp.config.json`. Keep Microsoft's
  existing entries and do not use `*`. Configure exact frontend origins in
  `CLOUD_ALLOWED_ORIGINS`. If platform CORS is also enabled, it must agree with
  the handler's policy and expose `ETag` while allowing Authorization,
  Content-Type, If-Match and If-None-Match. Cookies are not used.

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
policy. None of those Azure resources or app registrations are provisioned by
this implementation.
