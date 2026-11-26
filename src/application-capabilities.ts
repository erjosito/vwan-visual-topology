import { applicationLimits } from './application-inventory'

export const applicationCapabilities = {
  inventoryVersion: 1,
  requestVersion: 1,
  minimumContractVersion: 2,
  operations: ['application'],
  providers: ['application-gateway-tcp', 'azure-firewall-explicit-proxy', 'azure-firewall-application-proxy'] as string[],
  scope: 'Native v2 private Application Gateway TCP and original Standard/Premium Firewall explicit or transparently intercepted application proxy with declared policy and original DNS-bound workload. HTTP Host retargeting and non-inspected HTTPS SNI preserve distinct destination semantics. Separate connections and independent returns. Generic HTTP/DNS, TLS inspection, inherited policies, extra routers and Private Link composition remain unavailable.',
  limits: applicationLimits,
  privacy: 'Offline declared configuration only; no DNS queries, probes, credentials, telemetry or origin fetches.',
}
