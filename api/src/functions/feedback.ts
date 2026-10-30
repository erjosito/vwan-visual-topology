import { app } from '@azure/functions'
import { available, response, settings, submit } from '../feedback.js'
import { github } from '../github.js'

app.http('feedbackStatus', {
  methods: ['GET'],
  route: 'feedback/status',
  authLevel: 'anonymous',
  handler: async () => {
    const config = settings()
    return response(200, { available: available(config), deploymentId: config.deploymentId })
  },
})
app.http('feedback', {
  methods: ['POST'],
  route: 'feedback',
  authLevel: 'anonymous',
  handler: async (request) => {
    const config = settings()
    return submit(request, config, () => github(config))
  },
})
