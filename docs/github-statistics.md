# Daily GitHub statistics

The `GitHub statistics` workflow collects one snapshot daily at approximately
04:17 UTC, or on manual dispatch from `main`. GitHub schedules can be delayed.
It uses Node.js without installing packages and stores JSON in private Azure
Blob Storage, not expiring Actions artifacts or a public Git branch.
No Azure Function, app instrumentation, user account, or public dashboard is
introduced.

## Collected data and interpretation

Each schema-v1 snapshot records collection start/end times, repository star,
fork and subscriber counters, and all published releases (including
prereleases). Assets have stable release/asset IDs, filenames, sizes, timestamps
and cumulative download counts. Draft releases, release descriptions,
identities of visitors/stargazers, referrers and visited paths are not retained.

An optional separate GitHub token enables the last 14 days of daily repository
views/clones and unique visitor/cloner estimates, plus GitHub's window totals.
Without that token, `traffic.status` is `not_configured`, not zero. A configured
token that fails, an API/rate-limit error, or a failed upload fails the workflow;
no partial snapshot is uploaded. Review failed runs and expired-token notices.

These are distribution and repository-interest metrics, **not active users or
installations**. Downloads include repeat downloads, automation and maintainer
testing. Subscribers are repository watchers, not users. Views/clones are for
the repository, not either application website. Web, Windows and MCP runtime
usage remains unmeasured.

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
`github/<owner>/<repo>/snapshots/YYYY/MM/DD/<run-id>-<attempt>.json`.
Reruns create separate snapshots without overwriting earlier ones. There is no
automatic expiry; review storage cost/retention as history grows. Blob and
container soft deletion provide a 30-day accidental-deletion recovery window,
not an independent backup or immutable archive.

## Provision private storage

Review the standalone subscription-scope template
`infra\github-statistics.bicep`. It creates a dedicated resource group, an LRS
storage account, a private `github-statistics` container, a managed identity,
GitHub environment federation, and a container-scoped Storage Blob Data
Contributor assignment. It does not change application hosting.

Public blob access and shared-key authentication are disabled. The storage
network endpoint is public so GitHub-hosted runners can connect, but reads and
writes require Azure authorization. The workflow identity can manage blobs
(including deletion) only in this container; it has no subscription-wide
Contributor role. A dashboard reader should get a separate Blob Data Reader
assignment rather than reusing the uploader identity.

Deploy using an Azure identity allowed to create the resources and assign roles
(for example, Contributor plus Role Based Access Control Administrator at the
appropriate scope). This creates billable Azure storage; review the what-if
before deployment.

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
   deployment branches to `main`. Required manual reviewers would also pause
   scheduled runs, so choose that policy deliberately.
2. Set these environment variables using the deployment outputs:

   | GitHub variable | Bicep output |
   | --- | --- |
   | `AZURE_STATS_CLIENT_ID` | `clientId` |
   | `AZURE_STATS_TENANT_ID` | `tenantId` |
   | `AZURE_STATS_STORAGE_ACCOUNT` | `storageAccount` |

3. Optionally add environment secret `GH_STATS_TRAFFIC_TOKEN`: a fine-grained
   GitHub PAT restricted to this repository with **Administration: read**
   (and the automatically included Metadata read permission). The token owner
   must have sufficient repository access. Do not grant Administration write.
   Set an expiry and arrange renewal. The built-in `GITHUB_TOKEN` handles
   public counters/releases but cannot supply the needed traffic permission.
4. Merge the workflow to `main`, enable Actions if needed, and manually run
   **GitHub statistics** once. Confirm success and the blob's existence.
   Initial Azure RBAC propagation can take time; rerun if necessary.

Only the environment's managed identity federation grants Azure access.
No Azure client secret or storage account key is stored in GitHub. The optional
GitHub PAT is still a credential and is sent only to GitHub traffic endpoints.
Azure login deliberately does not select a subscription: container-only data
permissions need not grant subscription discovery, and upload uses the storage
account's data endpoint directly.
Snapshots are deliberately not uploaded as workflow artifacts or printed in
logs, since logs/artifacts may be accessible to repository visitors.

GitHub may disable schedules in public repositories after 60 days without
repository activity. Monitor workflow execution, not just snapshot contents.
Enable appropriate workflow failure notifications and periodically verify the
latest snapshot age.

## Local checks and manual collection

```powershell
node --test scripts\collect-github-statistics.test.mjs
$env:GITHUB_TOKEN = gh auth token
# Optional: set GH_STATS_TRAFFIC_TOKEN using a suitably scoped token.
node scripts\collect-github-statistics.mjs --repository erjosito/vwan-visual-topology --output test-artifacts\github-statistics.json
Remove-Item Env:GITHUB_TOKEN
```

The collector refuses to overwrite an existing output file; choose a fresh
filename for another local run. `test-artifacts` is already ignored by Git.
The workflow requires only `contents: read` and `id-token: write`.

## Dashboard boundary

This implementation stores source snapshots only. A future private dashboard
can derive daily series from them. Public reporting should be a separate
reviewed aggregate export with collection dates, definitions and coverage
limitations; do not expose this container or its upload identity.

References:
[GitHub traffic API](https://docs.github.com/en/rest/metrics/traffic),
[Azure Login with OIDC](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended),
[scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
