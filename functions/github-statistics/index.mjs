import { app } from '@azure/functions'
import { ManagedIdentityCredential } from '@azure/identity'
import { BlobServiceClient } from '@azure/storage-blob'
import { collectAndPersist } from './handler.mjs'

async function run(context) {
  const account = process.env.AZURE_STATS_STORAGE_ACCOUNT
  const clientId = process.env.AZURE_STATS_RUNTIME_CLIENT_ID
  if (!account || !clientId) throw new Error('Statistics storage and runtime identity must be configured.')
  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new ManagedIdentityCredential({ clientId }),
    { retryOptions: { maxTries: 4, tryTimeoutInMs: 30_000 } },
  )
  const summary = await collectAndPersist({
    repository: process.env.GITHUB_STATS_REPOSITORY,
    trafficToken: process.env.GH_STATS_TRAFFIC_TOKEN,
    invocationId: context.invocationId,
    container: service.getContainerClient('github-statistics'),
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
  route: 'statistics/collect',
  authLevel: 'admin',
  handler: async (_request, context) => ({ jsonBody: await run(context) }),
})
