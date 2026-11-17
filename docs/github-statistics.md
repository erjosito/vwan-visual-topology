# Daily GitHub and web hosting statistics

A Node.js Azure Function collects one snapshot daily at **04:17 UTC**. It uses
Flex Consumption with 512 MB instances, zero always-ready instances and a
dedicated VNet integration subnet. Azure Storage public network access, anonymous
Blob access and shared-key authentication remain disabled. One Blob private
endpoint and a linked private DNS zone provide host, deployment-package and
snapshot connectivity inside the dedicated statistics resource group.

The manual `Release` workflow's `statistics` target promotes the exact tested
Function package from a successful main-push CI run/attempt; merging Function
changes no longer deploys them. Preflight-only is the default. See the
[release runbook](releasing.md) for dispatch, setup and rollback. This workflow
has no daily collection schedule. No browser/MCP instrumentation, project
accounts or public dashboard are introduced. A personal/local runner is not
required.

The private dashboard is **https://telemetry.aznet-simulator.com**. It uses
Microsoft Entra sign-in and an explicit approved-user list; membership in the
tenant alone does not grant access. It reuses the Function and private Storage,
with no additional hosting plan, database or monitoring workspace.

## Collected data and interpretation

Each schema-v1 snapshot records collection start/end times, repository star,
fork and subscriber counters, and all published releases (including
prereleases). Assets have stable release/asset IDs, filenames, sizes, timestamps
and cumulative download counts. Draft releases, release descriptions,
identities of visitors/stargazers, referrers and visited paths are not retained.

An optional separate GitHub token enables the last 14 days of daily repository
views/clones and unique visitor/cloner estimates, plus GitHub's window totals.
Without that token, `traffic.status` is `not_configured`, not zero. A configured
token that fails, an API/rate-limit error, or a failed upload fails collection;
no partial snapshot is uploaded. The Function requires this token so that
scheduled collection cannot silently lose traffic coverage. Review failed
invocations and expired-token notices.

These are distribution and repository-interest metrics, **not active users or
installations**. Downloads include repeat downloads, automation and maintainer
testing. Subscribers are repository watchers, not users. Views/clones are for
the repository, not either application website. Existing Azure hosting metrics
are collected separately as described below; web sessions, feature usage,
Windows and MCP runtime usage remain unmeasured.

## Existing web hosting metrics

When `AZURE_STATS_SWA_RESOURCE_ID` is configured, the same Function queries
Azure Monitor for the production Static Web App's existing `SiteHits`,
`BytesSent` and `SiteErrors` metrics with daily `Total` aggregation. It backfills
the preceding **90 completed UTC days** on each run in three 30-day requests.
The SWA metrics API silently shortened a live 90-day request to 31 days; the
collector verifies each response's interval and exact time range to prevent
silent truncation. No requests are added to the application, and there is no
tracking SDK, visitor identifier, cookie or Application Insights deployment.
No monitoring workspace or new hosting resource is needed.

The production SWA resource hosts `aznet-simulator.com`, `vwan-simulator.com`
and `www.vwan-simulator.com`. Its metrics aggregate all those hostnames,
including the default hostname; they cannot be broken down by domain or path.
Site hits include asset requests, automation, bots and repeated requests.
They are **not page views, unique people, sessions or successful simulations**.
Site errors do not measure browser exceptions or simulation failures.
Missing metric samples stay `null`/unavailable, even when Azure reports a
successful query. Only an explicit zero is shown as zero.

The optional `web` field is added to the existing schema-v1 raw snapshot.
Overlapping windows use the latest observation per resource and UTC date,
never a sum of snapshots. Historical archives lacking `web` remain valid.
Dashboard web totals follow the selected range and display measured-day
coverage for each metric; incomplete totals include only available samples.
Historical platform data older than the backfill window is recoverable only
if it was previously archived. A configured metrics API/authentication error
fails collection rather than publishing a misleading successful snapshot.
MCP remains local stdio with no runtime reporting; release downloads are still
only distribution evidence.

Configure access once using an administrator with role-assignment permission:

```powershell
$swaId = az staticwebapp show --resource-group '<web-resource-group>' --name '<production-swa-name>' --query id --output tsv
$principalId = az identity show --resource-group '<statistics-resource-group>' --name id-github-statistics-function --query principalId --output tsv
az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal --role Reader --scope $swaId --output none
gh variable set AZURE_STATS_SWA_RESOURCE_ID --env github-statistics --body $swaId
```

The built-in **Reader** role is restricted to that one SWA resource. It grants
the runtime identity management-plane read access (including metrics), no
writes or data-plane access. CI's identity needs no SWA access: it only copies
the resource ID variable to the existing Function settings during deployment.
Explicitly promote the `statistics` target after configuration. RBAC can
take time to propagate. To disable collection, delete the Function's
`AZURE_STATS_SWA_RESOURCE_ID` app setting as well as the GitHub variable; the
deployment workflow does not delete existing settings when a variable is absent.
Restore the variable/deploy after reapplying base infrastructure that replaces
app settings. Existing dashboard authentication and private Storage remain
unchanged.

On 2026-11-16, [SWA metrics deployment 43931033007](https://github.com/erjosito/vwan-visual-topology/actions/runs/43931033007)
passed all 20 focused statistics tests and deployed successfully. The existing
runtime identity received Reader on the production SWA resource only. A real
administrator-triggered collection returned private raw/summary Blob ETags,
and approved-user API/browser checks confirmed the persisted web section.
The initial 90-day backfill contained 19 days with measured site hits; all
reported-error samples were unavailable, not zero. Live desktop/mobile
rendering and range selection passed. Anonymous summary/collection requests
returned HTTP 401, and Storage public networking, public Blob access and shared
keys remained disabled. This verifies manual collection, not a later scheduled
timer execution.

For later aggregation:

- Traffic windows overlap. For each repository/metric/UTC date, use the daily
  entry from the latest successful snapshot containing that date, not the sum
  of snapshots. Do not treat GitHub's partial current UTC day as final.
- Daily unique counts cannot be summed into weekly/monthly unique people.
  GitHub's rolling-window unique count is only for that returned window.
- Compute download deltas for the **same asset ID**, not by filename or release
  tag. The first observation is a baseline, not that day's downloads. Keep
  deleted/replaced assets in history; a missing asset or decreasing counter is
  not negative usage. Gaps yield interval growth, not exact daily attribution.
- Stars/forks/subscribers are point-in-time counters; differences represent
  net change, not the number of new events.

Snapshots use
`github/<owner>/<repo>/snapshots/YYYY/MM/DD/function-<invocation-id>.json`.
New invocations create separate snapshots; conditional writes prevent
overwrites, and repeated delivery of the same invocation checks the stored
receipt. There is no
automatic expiry; review storage cost/retention as history grows. Blob and
container soft deletion provide a 30-day accidental-deletion recovery window,
not an independent backup or immutable archive.

## Provision private storage

Review the standalone subscription-scope template
`infra\github-statistics.bicep`. It creates the dedicated resource group and LRS
Storage account, private `github-statistics` and `function-deployments`
containers, deployment and runtime identities, GitHub federation, an FC1 plan,
Function app, VNet, Blob private endpoint and private DNS configuration. It does
not change the web/desktop/MCP application hosting or add an always-on server.

The runtime identity has **Storage Blob Data Owner on the dedicated statistics
account**, as required for host locks/keys as well as deployment and snapshot
operations. It cannot access unrelated storage. The GitHub identity has
**Website Contributor only on this Function app**, allowing code deployment and
protected settings updates, not subscription-wide Contributor. A dashboard
reader should receive a separate data-reader assignment and private network
connectivity.

The initial hosted-collector design was blocked by Azure Policy disabling public
Storage networking. Its legacy CI container write grant should be removed after
the Function is verified; removing the declaration from an incremental Bicep
deployment alone does not delete the old assignment. This grant was removed
from the active deployment after verification. Never re-enable public
Storage access or add an exception to make the former hosted collector work.

Deploy using an Azure identity allowed to create the resources and assign roles
(for example, Contributor plus Role Based Access Control Administrator at the
appropriate scope). This creates billable private networking and storage; review the what-if
before deployment. The main fixed costs are one private endpoint and private
DNS zone. No NAT Gateway, VPN gateway, DNS Private Resolver or Premium plan is
required for this isolated timer workload.

```powershell
az login
az account set --subscription '<subscription-id>'
az deployment sub what-if --name github-statistics --location westeurope --template-file infra\github-statistics.bicep
az deployment sub create --name github-statistics --location westeurope --template-file infra\github-statistics.bicep --query properties.outputs --output json
```

Override `githubOidcSubject`, `resourceGroupName`, `storageAccountName` or
`location` using deployment parameters as needed. Do not point the deployment
at unrelated existing resources.

The default OIDC subject matches this repository's immutable-ID subject. For
another repository, inspect its OIDC configuration before deploying:

```powershell
gh api repos/<owner>/<repository>/actions/oidc/customization/sub
```

For the default environment-based subject, append
`:environment:github-statistics` to the returned `sub_claim_prefix` and pass it
as `githubOidcSubject`. Repositories using a custom subject template must use
that template's actual emitted subject instead. Do not disable immutable
subjects to make a name-only federation work. The subject in Azure must exactly
match GitHub's token; Azure Login prints the issuer, subject and audience when
diagnosing a mismatch.

## Configure GitHub

1. Create a GitHub Actions environment named **github-statistics**. Restrict its
   deployment branches to `main`. Required manual reviewers pause deployments,
   not the Azure collection timer.
2. Set these environment variables using the deployment outputs:

   | GitHub variable | Bicep output |
   | --- | --- |
   | `AZURE_STATS_CLIENT_ID` | `clientId` |
   | `AZURE_STATS_TENANT_ID` | `tenantId` |
   | `AZURE_STATS_STORAGE_ACCOUNT` | `storageAccount` |
   | `AZURE_STATS_SUBSCRIPTION_ID` | `subscriptionId` |
   | `AZURE_STATS_FUNCTION_APP` | `functionAppName` |
   | `AZURE_STATS_RESOURCE_GROUP` | Resource group name used for deployment |

3. Add environment secret `GH_STATS_TRAFFIC_TOKEN`: a fine-grained
   GitHub PAT restricted to this repository with **Administration: read**
   (and the automatically included Metadata read permission). The token owner
   must have sufficient repository access. Do not grant Administration write.
   Set an expiry and arrange renewal. The Function requests public
   counters/releases without a token; the built-in `GITHUB_TOKEN` cannot
   supply the needed traffic permission.
4. Merge the workflows to `main`, select the resulting successful main-push CI
   run/attempt, and manually run **Release** for `statistics`: first with
   `preflight_only=true`, then explicitly with `preflight_only=false`.
   Disable the retired **Deploy statistics Function** workflow and do not rerun
   its historical deployments. Confirm code deployment and perform the
   authenticated manual collection described below.
   Initial Azure RBAC propagation can take time; rerun if necessary.

Only the environment's managed identity federation grants Azure access.
No Azure client secret or storage account key is stored in GitHub. The dedicated
GitHub PAT is still a credential. The deployment workflow transfers it directly
from the environment secret into encrypted Function app settings, without
printing its value or packaging it with code. At collection time it is sent
only to GitHub traffic endpoints. Do not copy a broad personal CLI token into
automation. Rotate the dedicated read token by updating the environment secret
and dispatching the deployment workflow again.

Code is pushed to the authenticated Function SCM deployment endpoint using
Flex OneDeploy. The runtime/deployment identity, not the hosted runner, must
reach private deployment storage. Deployment and the first collection must be
tested end to end; a successful ARM deployment alone does not establish this
connectivity. Do not temporarily expose Storage to fix deployment failures.

The Azure timer retries failures up to three times at 15-minute intervals and
does not run automatically on host startup. It is independent of GitHub's
inactive-repository schedule suspension. Monitor Azure Function execution and
snapshot freshness, not only successful code deployments. Initial monitoring
does not include a separately provisioned alerting workspace.

## Local checks and manual collection

```powershell
node --test scripts\collect-github-statistics.test.mjs scripts\github-statistics-function.test.mjs scripts\github-statistics-dashboard.test.mjs scripts\github-statistics-swa.test.mjs
$env:GITHUB_TOKEN = gh auth token
# Optional: set GH_STATS_TRAFFIC_TOKEN using a suitably scoped token.
node scripts\collect-github-statistics.mjs --repository erjosito/vwan-visual-topology --output test-artifacts\github-statistics.json
Remove-Item Env:GITHUB_TOKEN
```

The collector refuses to overwrite an existing output file; choose a fresh
filename for another local run. `test-artifacts` is already ignored by Git.
CI requires only `contents: read` and `actions: read`. The privileged Release job uses
`contents: write` for durable release records and `id-token: write`
for the Function's existing Azure federation. Runtime
dependencies are isolated in `functions\github-statistics\package.json` and its
lockfile; the simulator application does not acquire Azure SDK dependencies.

`scripts\package-github-statistics-function.mjs` stages only the Function
sources, the shared collector, host configuration and locked manifest under
`test-artifacts`. CI installs production dependencies from the lockfile in
that staging folder and retains the ZIP as a checksummed candidate. Release
uploads those exact bytes without installing dependencies or rebuilding.
Credentials and collected snapshots are not included.

## Manual verification

The manual collection endpoint is `POST /api/statistics/collect`, protected with
`authLevel: admin`. It takes no repository, topology or storage parameters.
Invoke it with the Function host's administrator key in the `x-functions-key`
header, never in the URL or public logs. Retrieve the key only through an
authorized Azure management session; do not print or save it.

A successful response returns the Blob path, ETag, traffic coverage and release
count after Storage acknowledges the conditional write, plus a receipt for the
refreshed dashboard summary. It never returns the
GitHub token or raw traffic data. Requests without the key must be rejected.
The endpoint is for deliberate first-run checks or recovery, not a public
analytics API. Snapshot contents remain accessible only through authorized
private-network data access.

On 2026-11-16, [deployment run 43898245558](https://github.com/erjosito/vwan-visual-topology/actions/runs/43898245558)
successfully deployed from a hosted runner with Storage public networking
disabled. An administrator-authenticated invocation persisted the first
snapshot and returned its ETag with traffic coverage available; an anonymous
request returned HTTP 401. Azure also reported the expected daily timer
binding. This verifies deployment and manual collection, not a subsequent
scheduled execution.

## Private dashboard and authorization

The Function serves the dashboard at `/` and `/api/statistics`, its JavaScript
at `/api/statistics/dashboard.js`, and a read-only JSON summary at
`/api/statistics/summary`. App Service Authentication ("Easy Auth") validates
Entra sign-in and restricts access to explicit user object IDs in one tenant.
The application also rejects absent, malformed, wrong-tenant or unapproved
principals. Identity headers are trusted only behind enabled Easy Auth; never
exclude the dashboard routes from platform authentication or place keys in
browser code. The endpoints have no caller-controlled storage/repository
inputs, allow no writes, and return private/no-store caching headers. HTML
loads no third-party scripts, fonts or analytics.

The only authentication exclusion is `/api/statistics/collect`: it still
requires the Function administrator key, independently of Entra browser login.
The Azure timer does not make an HTTP request and is unaffected by Easy Auth.
The HTTP route prefix is explicitly empty, and existing API routes include
`api/` so the administrator endpoint retains its original URL.

Set up a dedicated **single-tenant** Entra app registration and enterprise
application before the first dashboard code deployment. Register the HTTPS
`/.auth/login/aad/callback` URL for the custom and default Function hostnames.
Use the existing runtime managed identity as a federated credential, with its
principal ID as subject, the tenant's v2 issuer and audience
`api://AzureADTokenExchange`. No client secret or Graph application permissions
are required. The optional delegated `Dashboard.Read` API scope can preauthorize
Azure CLI for approved-user operational verification; create the scope before
configuring its preauthorization. The user allowlist still applies.

Review and deploy `infra\github-statistics-auth.bicep` in the statistics resource
group, passing `dashboardClientId`, `runtimeClientId` and a nonempty
`allowedUserObjectIds` array. The template sets both platform and application
authorization from the same list. Never commit personal object IDs in public
parameter files. It configures
`OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID` for secretless sign-in and preserves
existing protected settings through a secure child deployment. After
reapplying the base Function infrastructure, reapply this authentication
template and dispatch the code workflow to restore protected settings.
GitHub code deployment does not create Entra applications or change membership.

Every successful collection rebuilds
`github/<owner>/<repo>/dashboard/summary.json` from at most the last 366 UTC
dates of raw snapshots. Daily traffic uses the latest observation of each date,
not the sum of overlapping windows. Download growth compares stable asset IDs
in collection order, including multiple same-day observations; new assets and
decreasing counters start baselines. Missing observations are not zero, and
growth across gaps is interval growth rather than exact daily usage. Raw
snapshots retain their existing indefinite retention.

Dashboard views read one compact Blob, not the entire archive. Conditional
summary writes retry concurrent updates; a failed refresh fails the invocation
so Azure retries, without deleting the already-persisted raw snapshot. The
dashboard shows collection freshness and warns after 36 hours without a
successful collection. Daily uniques are never added into monthly users.

## Custom domain and HTTPS

`telemetry.aznet-simulator.com` uses the existing Azure DNS zone in
`rg-vwan-visual-topology-dev-426b`; the Function stays in its dedicated
statistics resource group. Only the `telemetry` CNAME and `asuid.telemetry` TXT
records are added. Existing apex and `www` application records are unchanged.

Preview each deployment before applying it. Provision in this order:

1. Deploy `infra\github-statistics-domain-dns.bicep` in the DNS resource group,
   passing the Function's default hostname and `customDomainVerificationId`.
2. After DNS resolves, deploy `infra\github-statistics-domain.bicep` in the
   statistics resource group with `mode=bootstrap`, for the initial hostname
   binding only.
3. Deploy `infra\github-statistics-domain-certificate.bicep` to request the free
   site-scoped App Service managed certificate.
4. Deploy `infra\github-statistics-domain.bicep` again with its default
   `mode=tls` to bind that certificate. Do not rerun bootstrap on a TLS-bound
   hostname.

The existing Function reports `siteScopedCertificatesEnabled: true`, required
for this certificate model. Older Flex apps without that support need separate
migration planning; do not recreate or delete an existing app automatically.
Keep the direct CNAME and required validation records for managed renewal.
The custom hostname uses the same Entra authorization as the default hostname;
no public aggregate endpoint is introduced.

On 2026-11-16, [dashboard deployment 43924643480](https://github.com/erjosito/vwan-visual-topology/actions/runs/43924643480)
passed all 15 focused tests. Live verification confirmed trusted HTTPS,
Microsoft sign-in redirects with the custom-hostname callback, approved-user
API access and desktop/mobile browser rendering. Anonymous API requests and
forged identity headers were denied; manual collection still required its
administrator key. Both the raw snapshot and dashboard summary returned
successful private Storage receipts. This does not yet verify a later
scheduled timer execution.

Public reporting, if added later, must be a separate reviewed aggregate export
with collection dates, definitions and coverage limitations. Do not expose the
archive, summary Blob or runtime credentials publicly.

References:
[GitHub traffic API](https://docs.github.com/en/rest/metrics/traffic),
[Azure Login with OIDC](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended),
[Flex Consumption](https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan),
[Functions storage requirements](https://learn.microsoft.com/azure/azure-functions/storage-considerations),
[Static Web Apps platform metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-web-staticsites-metrics).
