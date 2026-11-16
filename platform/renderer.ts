import { parentPort, workerData } from 'node:worker_threads'
import { renderFlow } from './render'

void renderFlow(workerData.result, workerData.assessmentId, workerData.options)
  .then(result => parentPort!.postMessage({ result }))
  .catch((error: unknown) => parentPort!.postMessage({ error: error instanceof Error ? error.message : 'Render failed.' }))
