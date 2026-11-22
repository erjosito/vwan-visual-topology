import { importAzureCapture } from './azure-import'
import { azureObservationEnvelope, parseAzureObservationData } from './azure-observation-data'
export * from './azure-observation-data'

export function parseAzureObservation(input: unknown) {
  const root = azureObservationEnvelope(input)
  return parseAzureObservationData(input, importAzureCapture({ ...root, version: 1 }))
}
