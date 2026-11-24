export type RoutingOperation = 'route' | 'flow' | 'packet' | 'bgp'
export type RoutingOwner = { kind: 'document' | 'vnet' | 'subnet' | 'gateway' | 'site' | 'connection' | 'vwan-hub'; id: string }
export type RoutingScope =
  | { kind: 'document' }
  | { kind: 'component'; vnetId: string }
  | { kind: 'hub-table'; hubId: string; tableId: string }

export type RoutingLimitation = {
  id: string
  code: string
  owner: RoutingOwner
  scope: RoutingScope
  operations: RoutingOperation[]
  completeness: 'complete' | 'not-assessed'
  message: string
  evidenceReferences: string[][]
}

export type RoutingEvidenceEnvelope = {
  provider: 'azure-net'
  engineVersion: string
  revision: string
  requestRevision: string
  scope: { kind: 'subnet-table'; subnetId: string } | { kind: 'hub-table'; hubId: string; tableId: string }
  complete: boolean
  limitationIds: string[]
}

export function routingLimitation(message: string, details: Omit<RoutingLimitation, 'id' | 'message'>): RoutingLimitation {
  return { ...details, message, id: JSON.stringify([details.code, details.owner, details.scope, details.evidenceReferences]) }
}

export function unscopedRoutingLimitations(warnings: string[], records: RoutingLimitation[] = []): RoutingLimitation[] {
  const described = new Set(records.map(record => record.message))
  return [...records, ...[...new Set(warnings)].filter(message => !described.has(message)).map(message =>
    routingLimitation(message, {
      code: 'UNSCOPED_ROUTING_WARNING', owner: { kind: 'document', id: String(warnings.indexOf(message)) },
      scope: { kind: 'document' }, operations: ['route', 'flow', 'packet', 'bgp'],
      completeness: 'not-assessed', evidenceReferences: [['warnings', String(warnings.indexOf(message))]],
    }))]
}
