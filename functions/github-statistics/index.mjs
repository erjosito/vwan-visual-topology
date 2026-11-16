import { app } from '@azure/functions'
import { ManagedIdentityCredential } from '@azure/identity'
import { BlobServiceClient } from '@azure/storage-blob'
import { readFile } from 'node:fs/promises'
import { collectAndPersist } from './handler.mjs'
import { dashboardResponse, persistDashboardSummary } from './dashboard.mjs'
import { collectStaticWebAppMetrics } from './swa.mjs'

const html = await readFile(new URL('./dashboard.html', import.meta.url), 'utf8')
const script = await readFile(new URL('./dashboard-client.js', import.meta.url), 'utf8')

function containerClient() {
  const account = process.env.AZURE_STATS_STORAGE_ACCOUNT
  const clientId = process.env.AZURE_STATS_RUNTIME_CLIENT_ID
  if (!account || !clientId) throw new Error('Statistics storage and runtime identity must be configured.')
  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new ManagedIdentityCredential({ clientId }),
    { retryOptions: { maxTries: 4, tryTimeoutInMs: 30_000 } },
  )
  return service.getContainerClient('github-statistics')
}

async function run(context) {
  const container = containerClient()
  const repository = process.env.GITHUB_STATS_REPOSITORY
  const summary = await collectAndPersist({
    repository,
    trafficToken: process.env.GH_STATS_TRAFFIC_TOKEN,
    invocationId: context.invocationId,
    container,
    collectWebMetrics: process.env.AZURE_STATS_SWA_RESOURCE_ID ? () => collectStaticWebAppMetrics({
      resourceId: process.env.AZURE_STATS_SWA_RESOURCE_ID,
      credential: new ManagedIdentityCredential({ clientId: process.env.AZURE_STATS_RUNTIME_CLIENT_ID }),
    }) : undefined,
    refreshSummary: () => persistDashboardSummary({ container, repository }),
  })
  context.log(JSON.stringify(summary))
  return summary
}

app.timer('collectGitHubStatistics', {
  schedule: '0 17 4 * * *',
  runOnStartup: false,
  useMonitor: true,
  retry: { strategy: 'fixedDelay', maxRetryCount: 3, delayInterval: { minutes: 15 } },
  handler: async (_timer, context) => { await run(context) },
})

app.http('collectNow', {
  methods: ['POST'],
  route: 'api/statistics/collect',
  authLevel: 'admin',
  handler: async (_request, context) => ({ jsonBody: await run(context) }),
})

for (const [name, route] of [
  ['statisticsDashboard', 'api/statistics'],
  ['statisticsDashboardScript', 'api/statistics/dashboard.js'],
  ['statisticsDashboardSummary', 'api/statistics/summary'],
  ['statisticsDashboardHome', '{*path}'],
]) {
  app.http(name, {
    methods: ['GET'],
    route,
    authLevel: 'anonymous',
    handler: (request) => dashboardResponse(request, {
      html,
      script,
      readSummary: async () => JSON.parse((await containerClient().getBlockBlobClient(
        `github/${process.env.GITHUB_STATS_REPOSITORY}/dashboard/summary.json`,
      ).downloadToBuffer()).toString('utf8')),
    }),
  })
}
