import { cidr, contains } from '../validation'
import type { AzNetTopology } from './model'

export function coexistenceChecks(topology: AzNetTopology) {
  return topology.vnets.flatMap((vnet) => {
    const gateways = vnet.gateways.filter((gateway) => gateway.enabled)
    if (!gateways.some((gateway) => gateway.kind === 'Vpn') || !gateways.some((gateway) => gateway.kind === 'ExpressRoute')) return []
    const findings: { id: string; code: 'gateway' | 'generation' | 'subnet' | 'udr'; severity: 'error' | 'warning'; summary: string; vnetId: string; subnetId?: string }[] = []
    const add = (key: string, code: typeof findings[number]['code'], summary: string, subnetId?: string, severity: 'error' | 'warning' = 'error') =>
      findings.push({ id: `coexistence:${vnet.id}:${key}`, code, severity, summary, vnetId: vnet.id, subnetId })
    for (const gateway of gateways) {
      if (gateway.sku?.trim().toLowerCase() === 'basic') add(`sku:${gateway.id}`, 'gateway',
        `Gateway "${gateway.name}" uses Basic, which does not support ER/VPN coexistence.`)
      if (gateway.kind !== 'Vpn') continue
      if (gateway.vpnType === 'PolicyBased') add(`type:${gateway.id}`, 'gateway',
        `VPN gateway "${gateway.name}" is PolicyBased; coexistence requires RouteBased, irrespective of connection traffic selectors.`)
      if (gateway.vpnGatewayGeneration &&
        (/^VpnGw1(AZ)?$/.test(gateway.sku ?? '') && gateway.vpnGatewayGeneration !== 'Generation1' ||
          /^VpnGw[45](AZ)?$/.test(gateway.sku ?? '') && gateway.vpnGatewayGeneration !== 'Generation2'))
        add(`generation:${gateway.id}`, 'generation',
          `VPN gateway "${gateway.name}" pairs ${gateway.sku} with unsupported ${gateway.vpnGatewayGeneration}.`)
    }
    const subnet = vnet.subnets.find((candidate) => candidate.name === 'GatewaySubnet')
    const range = subnet && cidr(subnet.prefix)
    if (!range || range.length > 27) add('subnet', 'subnet',
      `Coexistence in "${vnet.name}" requires GatewaySubnet /27 or shorter, not ${subnet?.prefix ?? 'a missing subnet'}.`, subnet?.id)
    if (subnet && range) {
      const table = topology.udrTables.find((candidate) => candidate.id === subnet.routeTableId)
      const localLength = Math.max(0, ...vnet.prefixes.filter((prefix) => cidr(prefix) && contains(prefix, range.network))
        .map((prefix) => cidr(prefix)!.length))
      for (const route of table?.routes ?? []) {
        const destination = route.enabled && cidr(route.prefix)
        if (!destination || !(contains(route.prefix, range.network) || contains(subnet.prefix, destination.network))) continue
        if (destination.length !== 0 && destination.length < localLength) continue
        add(`udr:${route.id}`, 'udr',
          `UDR "${table!.name}/${route.name}" (${route.prefix}, ${route.nextHopType}${route.nextHopIp ? ` ${route.nextHopIp}` : ''}) intersects GatewaySubnet ${subnet.prefix} used by ${gateways.map((gateway) => gateway.name).join(' and ')} and can interrupt gateway BGP communication.`,
          subnet.id, destination.length <= range.length ? 'error' : 'warning')
      }
    }
    return findings
  })
}
