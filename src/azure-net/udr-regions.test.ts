import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology, validateAzNetTopology, type AzNetTopology } from './model'
import { parseAzNetTopology } from './admission'
import { importAzNetCapture } from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { simulateAzNet, traceAzNetFlow } from './engine'
import { runAzNetDiagnostics } from './diagnostics'
import { resolveUdrRegion, udrAssociationError, validateUdrRegionEdit } from './udr-regions'

function fixture(): AzNetTopology {
  const topology = createEmptyAzNetTopology()
  topology.vnets = ['a', 'b'].map((id, index) => ({
    id, name: id, role: 'spoke', region: index ? 'westeurope' : ' West Europe ',
    prefixes: [`10.${index}.0.0/16`], gateways: [], appliances: [],
    subnets: [{ id: `s-${id}`, name: id, prefix: `10.${index}.1.0/24`, routeTableId: 'rt' }],
  }))
  topology.udrTables = [{ id: 'rt', name: 'Shared', region: 'WEST EUROPE', disableBgpRoutePropagation: true,
    routes: [{ id: 'drop', name: 'Drop', prefix: '0.0.0.0/0', nextHopType: 'None', enabled: true }] }]
  return topology
}

describe('UDR regions and independent subnet associations', () => {
  it('allows normalized same-region sharing and round trips without VNet ownership', () => {
    const topology = fixture()
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    expect(udrAssociationError(topology, topology.vnets[1], topology.udrTables[0])).toBeUndefined()
    const bicep = generateAzNetBicep(topology).text
    expect(bicep).toContain("param location string = 'westeurope'")
    expect(bicep).toContain("location: 'westeurope'")
    expect(bicep.match(/location: location/g)).toHaveLength(2)
    expect(bicep.match(/id: rt_rt.id/g)).toHaveLength(2)
    topology.udrTables[0].region = 123 as unknown as string
    expect(() => parseAzNetTopology(topology)).toThrow()
  })

  it('rejects malformed regions and missing imported table references without dropping references', () => {
    const topology = fixture()
    topology.udrTables[0].region = '!'
    expect(validateAzNetTopology(topology).join(' ')).toContain('invalid region')
    const before = fixture()
    expect(() => validateUdrRegionEdit(before, topology)).toThrow(/valid nonempty region/)
    topology.vnets[0].subnets[0].routeTableId = 'missing'
    expect(() => parseAzNetTopology(topology)).toThrow(/Subnet route table/)
    expect(topology.vnets[0].subnets[0].routeTableId).toBe('missing')
  })

  it('preserves invalid imported references, diagnoses them and does not apply their routes/settings', () => {
    const topology = fixture()
    topology.vnets[1].region = 'eastus'
    const imported = parseAzNetTopology(JSON.parse(JSON.stringify(topology)))
    expect(imported).toEqual(topology)
    expect(validateAzNetTopology(imported).join(' ')).toContain('same region')
    const simulation = simulateAzNet(imported)
    expect(simulation.subnetTables['s-b'].routes.some((route) => route.source === 'User')).toBe(false)
    expect(simulation.subnetTables['s-b'].bgpPropagationDisabled).toBe(false)
    expect(traceAzNetFlow(imported, simulation, { kind: 'subnet', vnetId: 'b', subnetId: 's-b' }, '8.8.8.8').status).toBe('not-assessed')
    expect(runAzNetDiagnostics(imported, simulation, { includePairAnalysis: false }).some((finding) => finding.category === 'udr-region-association')).toBe(true)
    expect(() => generateAzNetBicep(imported)).toThrow(/same region/)
  })

  it('infers legacy regions only from unambiguous existing associations without mutating JSON', () => {
    const topology = fixture()
    delete topology.udrTables[0].region
    expect(resolveUdrRegion(topology, topology.udrTables[0])).toBe('westeurope')
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(generateAzNetBicep(topology).text).toContain("location: 'westeurope'")
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    expect(topology.udrTables[0].region).toBeUndefined()
    topology.vnets[1].region = 'eastus'
    expect(resolveUdrRegion(topology, topology.udrTables[0])).toBeUndefined()
    expect(validateAzNetTopology(topology).join(' ')).toContain('unknown region')
  })

  it('allows unassociated regional tables and requires explicit regions for unused legacy tables', () => {
    const topology = fixture()
    for (const vnet of topology.vnets) delete vnet.subnets[0].routeTableId
    topology.udrTables[0].region = 'East US'
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(generateAzNetBicep(topology).text).toContain("location: 'eastus'")
    delete topology.udrTables[0].region
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(() => generateAzNetBicep(topology, { defaultLocation: 'eastus' })).toThrow(/explicit region/)
    const after = structuredClone(topology)
    after.vnets[0].subnets[0].routeTableId = 'rt'
    expect(() => validateUdrRegionEdit(topology, after)).toThrow(/unknown region/)
  })

  it('rejects new cross-region associations and VNet/table region changes but permits repairs', () => {
    const topology = fixture()
    for (const change of [
      (next: typeof topology) => { next.vnets[1].region = 'eastus' },
      (next: typeof topology) => { next.udrTables[0].region = 'eastus' },
    ]) {
      const next = structuredClone(topology)
      change(next)
      expect(() => validateUdrRegionEdit(topology, next)).toThrow(/same region/)
    }
    topology.vnets[1].region = 'eastus'
    const unrelated = structuredClone(topology)
    unrelated.name = 'Still repairable'
    expect(() => validateUdrRegionEdit(topology, unrelated)).not.toThrow()
    const repaired = structuredClone(topology)
    delete repaired.vnets[1].subnets[0].routeTableId
    expect(() => validateUdrRegionEdit(topology, repaired)).not.toThrow()
  })

  it('pins inferred legacy regions before region changes or removing the last association', () => {
    const topology = fixture()
    delete topology.udrTables[0].region
    topology.vnets.pop()
    const moved = structuredClone(topology)
    moved.vnets[0].region = 'eastus'
    expect(() => validateUdrRegionEdit(topology, moved)).toThrow(/same region/)
    const detached = structuredClone(topology)
    delete detached.vnets[0].subnets[0].routeTableId
    validateUdrRegionEdit(topology, detached)
    expect(detached.udrTables[0].region).toBe('westeurope')
    expect(topology.udrTables[0].region).toBeUndefined()
  })

  it('imports Azure locations including unused tables without assigning a global default', () => {
    const imported = importAzNetCapture({ kind: 'azure-network-capture', version: 2, resourceGroup: 'rg',
      vnets: [], routeTables: [{ id: 'west', name: 'West', location: 'westeurope', routes: [] },
        { id: 'east', name: 'East', location: 'eastus', routes: [] }, { id: 'unknown', name: 'Unknown', routes: [] }] }).topology
    expect(imported.udrTables.map((table) => table.region)).toEqual(['westeurope', 'eastus', undefined])
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(imported)))).toEqual(imported)
  })
})
