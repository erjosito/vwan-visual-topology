import { parentPort, workerData } from 'node:worker_threads'
import { executePlatform } from '../src/platform/service'

parentPort!.postMessage(executePlatform(workerData))
