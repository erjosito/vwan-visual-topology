import { applicationLimits } from './application-inventory'

export const applicationCapabilities = {
  inventoryVersion: 1,
  requestVersion: 1,
  minimumContractVersion: 2,
  operations: ['application'],
  providers: ['application-gateway-tcp'] as string[],
  scope: 'Native v2 private Standard_v2/WAF_v2 TCP proxy: one declared instance, listener and original workload backend. Separate client/backend connections and independent returns. HTTP/DNS, TLS termination, Proxy Protocol and managed private connectivity remain unavailable.',
  limits: applicationLimits,
  privacy: 'Offline declared configuration only; no DNS queries, probes, credentials, telemetry or origin fetches.',
}
