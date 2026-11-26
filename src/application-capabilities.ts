import { applicationLimits } from './application-inventory'

export const applicationCapabilities = {
  inventoryVersion: 1,
  requestVersion: 1,
  minimumContractVersion: 2,
  operations: ['application'],
  providers: ['application-gateway-tcp', 'azure-firewall-explicit-proxy'] as string[],
  scope: 'Native v2 private Application Gateway TCP and original Standard/Premium Firewall explicit HTTP/HTTPS CONNECT proxy with declared application policy and original DNS-bound workload. Separate connections and independent returns. Transparent proxy, generic HTTP/DNS, TLS inspection, inherited policies, extra routers and Private Link composition remain unavailable.',
  limits: applicationLimits,
  privacy: 'Offline declared configuration only; no DNS queries, probes, credentials, telemetry or origin fetches.',
}
