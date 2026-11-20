import { expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './model'
import { createUdrTable, deleteUdrTable } from './udr-tables'

it('clones routes/settings with fresh identities and unchanged next-hop addresses without modifying source associations', () => {
  const topology = createEmptyAzNetTopology()
  const source = createUdrTable(topology, 'Original', 'westeurope')
  source.disableBgpRoutePropagation = true
  source.disablePeeringRoutePropagation = true
  source.routes = [{ id: 'route', name: 'Inspect', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true }]
  topology.udrTables.push(source)
  topology.vnets = [{ id: 'v', name: 'VNet', region: 'westeurope', role: 'spoke', prefixes: ['10.0.0.0/16'],
    subnets: [{ id: 's', name: 'Workload', prefix: '10.0.1.0/24', routeTableId: source.id }], appliances: [], gateways: [] }]
  const snapshot = structuredClone(topology)
  const clone = createUdrTable(topology, 'Copy', 'East US', source)
  expect(clone.id).not.toBe(source.id)
  expect(clone.routes[0].id).not.toBe(source.routes[0].id)
  expect(clone.routes[0]).toMatchObject({ nextHopIp: '10.0.1.4', prefix: '0.0.0.0/0' })
  expect(clone).toMatchObject({ region: 'East US', disableBgpRoutePropagation: true, disablePeeringRoutePropagation: true })
  clone.routes[0].prefix = '10.1.0.0/16'
  expect(topology).toEqual(snapshot)
  topology.udrTables.push(clone)
  expect(() => deleteUdrTable(topology, source.id)).toThrow(/Dissociate/)
  deleteUdrTable(topology, clone.id)
  expect(topology).toEqual(snapshot)
})

it('creates unused empty regional tables and rejects blank/duplicate names or malformed regions', () => {
  const topology = createEmptyAzNetTopology()
  const table = createUdrTable(topology, ' Unused ', ' West Europe ')
  expect(table).toMatchObject({ name: 'Unused', region: 'West Europe', routes: [], disableBgpRoutePropagation: false })
  topology.udrTables.push(table)
  expect(() => createUdrTable(topology, 'unused', 'eastus')).toThrow(/already exists/)
  expect(() => createUdrTable(topology, ' ', 'eastus')).toThrow(/1-120/)
  expect(() => createUdrTable(topology, 'New', '!')).toThrow(/valid nonempty/)
})
