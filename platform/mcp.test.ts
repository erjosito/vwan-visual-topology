import { it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { executePlatform } from '../src/platform/service'
import { vpnNatFixture } from '../tests/fixtures/vpn-nat'
import { hubFirewallTopology, azHubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { scenarioTopologies } from '../src/learning/scenario-topologies'
import { scenarioBundle } from '../src/learning/scenario-course'
import { haRoutingRequirements, haRoutingTopology } from '../tests/fixtures/ha-routing'
import { haBackend, haPacket, haPortsTopology } from '../tests/fixtures/ha-ports'
import { nvaBgpTopology } from '../tests/fixtures/nva-bgp'
import { readFileSync } from 'node:fs'
import { vpnErTopology } from '../tests/fixtures/vpn-er'
import { vpnInstanceTopology, vpnMigrationSnapshots } from '../tests/fixtures/vpn-instance'
import { privateLinkTopology, privateLinkRequest } from '../tests/fixtures/private-link'

const serverPath = resolve(process.env.MCP_PACKAGE_DIR ?? 'platform-dist', 'mcp.cjs')

it('retains explicit Private Link connection identity and complete translated evidence through stdio', async () => {
  const client = new Client({ name: 'private-link-contract-test', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' }))
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    const data = response.structuredContent
    if (response.isError || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(JSON.stringify(response.content))
    return data as Record<string, unknown>
  }
  try {
    const schema = await call('get_schema', { mode: 'full' })
    expect(schema.packetDestinationShapes).toContainEqual({ kind: 'private-endpoint', privateEndpointId: 'original consumer Private Endpoint ID' })
    const topology = privateLinkTopology()
    const request = { contractVersion: 1 as const, operation: 'simulate' as const, document: { mode: 'full' as const, topology },
      packet: privateLinkRequest('b') }
    const { handle } = await call('start_simulation', { request })
    let status: unknown
    for (let attempt = 0; attempt < 100; attempt++) {
      status = (await call('get_job', { handle })).status
      if (status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(status).toBe('finished')
    const chunks: string[] = []
    let complete = false
    for (let offset = 0; offset < 1_000_000;) {
      const chunk = await call('get_evidence', { handle, section: 'packet', offset, limit: 4000 })
      if (typeof chunk.jsonText !== 'string' || !chunk.jsonText.length) throw new Error('Missing Private Link evidence chunk.')
      chunks.push(chunk.jsonText)
      if (chunk.complete) { complete = true; break }
      offset += chunk.jsonText.length
    }
    expect(complete).toBe(true)
    const packet: unknown = JSON.parse(chunks.join(''))
    expect(packet).toEqual(executePlatform(request).packet)
    expect(packet).toMatchObject({ ingress: 'configured', reply: { session: 'conditional-response' },
      forward: { steps: expect.arrayContaining([expect.objectContaining({ entity: { kind: 'private-endpoint', id: 'b-pe' }, routeId: 'b-connection' })]) } })
  } finally { await client.close() }
}, 20000)

it('exposes private VPN ER dependencies and directional protection through the actual stdio worker', async () => {
  const client = new Client({ name: 'vpn-over-er-contract-test', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' }))
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return response.structuredContent as Record<string, any>
  }
  const read = async (handle: string, section: string) => {
    const chunks: string[] = []
    for (let offset = 0; offset < 1_000_000;) {
      const chunk = await call('get_evidence', { handle, section, offset, limit: 4000 })
      chunks.push(chunk.jsonText)
      if (chunk.complete) return JSON.parse(chunks.join(''))
      expect(chunk.jsonText.length).toBeGreaterThan(0)
      offset += chunk.jsonText.length
    }
    throw new Error('Private VPN evidence exceeded the test retrieval bound.')
  }
  try {
    expect((await call('get_schema', { mode: 'full' })).optionalVpnOverEr.connection.underlay.kind).toBe('express-route')
    const topology = vpnErTopology()
    const request = { contractVersion: 1 as const, operation: 'evaluate' as const, document: { mode: 'full' as const, topology },
      requirements: [{ id: 'private-workload', kind: 'flow' as const, source: { kind: 'subnet' as const, vnetId: 'hub', subnetId: 'app' },
        target: { kind: 'site' as const, siteId: 'site' }, sourceAddress: '10.0.1.4', destinationAddress: '192.168.10.4', expectation: 'allow' as const }] }
    const { handle } = await call('start_simulation', { request })
    let state
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await call('get_job', { handle })
      if (state.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(state?.status).toBe('finished')
    expect(state?.resultStatus).toBe('complete')
    const expected = executePlatform(request)
    expect(await read(handle, 'simulation')).toEqual(expected.simulation)
    const assessments = await read(handle, 'assessments')
    expect(assessments).toEqual(expected.assessments)
    expect(assessments[0].outcome).toBe('satisfied')
    expect(assessments[0].evidence.forward.vpnProtection[0].protection).toBe('intended-ipsec')
    expect(assessments[0].evidence.reverse.vpnProtection[0].underlay.onPremEndpoint).toBe('172.16.0.4')
    for (const failEr of [false, true]) {
      const topology = vpnInstanceTopology()
      topology.erLinks[0].enabled = !failEr
      const bindingRequest = { contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
        vpnTransition: { previousTopology: vpnMigrationSnapshots()[2].topology, event: { id: failEr ? 'fail-er' : 'enable-bgp', description: 'Synthetic authored snapshot change; no live SA event' } },
        requirements: [
          ...['private-west', 'private-east'].map((tunnelId) => ({ id: tunnelId, kind: 'vpn-tunnel', connectionId: 'private', tunnelId,
            expectation: failEr ? 'ineligible' : 'eligible', underlayState: failEr ? 'unavailable' : 'available' })),
          { id: 'public-backup', kind: 'vpn-tunnel', connectionId: 'backup', tunnelId: 'internet-west', expectation: 'eligible',
            binding: { azureAddress: '169.254.21.2', cpeAddress: '169.254.21.1', gatewayInstanceId: 'instance-west' } },
        ] }
      const job = await call('start_simulation', { request: bindingRequest })
      let state
      for (let attempt = 0; attempt < 100; attempt++) {
        state = await call('get_job', { handle: job.handle })
        if (state.status === 'finished') break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(state?.status).toBe('finished')
      expect(state?.resultStatus).toBe('complete')
      expect(state?.assessments.map((assessment: { outcome: string }) => assessment.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied'])
      const expected = executePlatform(bindingRequest)
      expect(await read(job.handle, 'simulation')).toEqual(expected.simulation)
      expect(await read(job.handle, 'bgpNeighbors')).toEqual(expected.bgpNeighbors)
      expect(await read(job.handle, 'vpnTransition')).toEqual(expected.vpnTransition)
    }
  } finally { await client.close() }
}, 20000)

it('qualifies subnet-peering route visibility separately from forwarding through the actual stdio engine', async () => {
  const client = new Client({ name: 'subnet-peering-contract-test', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' }))
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return response.structuredContent as Record<string, any>
  }
  try {
    expect((await call('get_schema', { mode: 'full' })).subnetPeering.modes).toEqual(['hub-spoke', 'full'])
    const topology = JSON.parse(readFileSync(resolve('public', 'docs', 'samples', 'azure-net', 'subnet-peering.json'), 'utf8'))
    const request = { contractVersion: 1 as const, operation: 'evaluate' as const, document: { mode: 'full' as const, topology }, requirements: [
      { id: 'preview-visibility', kind: 'route' as const, table: 'a2', prefix: '10.81.1.0/24', expectation: 'present' as const },
      { id: 'no-whole-vnet-route', kind: 'route' as const, table: 'a1', prefix: '10.81.0.0/16', expectation: 'absent' as const },
      { id: 'selected-forwarding', kind: 'flow' as const, source: { kind: 'subnet' as const, vnetId: 'vnet-a', subnetId: 'a1' },
        target: { kind: 'subnet' as const, vnetId: 'vnet-b', subnetId: 'b1' }, sourceAddress: '10.80.1.4', destinationAddress: '10.81.1.4', expectation: 'allow' as const },
      { id: 'unselected-forwarding', kind: 'flow' as const, source: { kind: 'subnet' as const, vnetId: 'vnet-a', subnetId: 'a2' },
        target: { kind: 'subnet' as const, vnetId: 'vnet-b', subnetId: 'b1' }, sourceAddress: '10.80.2.4', destinationAddress: '10.81.1.4', expectation: 'deny' as const },
    ] }
    const { handle } = await call('start_simulation', { request })
    let state
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await call('get_job', { handle })
      if (state.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(state?.status).toBe('finished')
    const result: Record<string, any> = {}
    for (const section of ['simulation', 'assessments', 'document']) {
      const chunks: string[] = []
      for (let offset = 0; offset < 1_000_000;) {
        const chunk = await call('get_evidence', { handle, section, offset, limit: 4000 })
        chunks.push(chunk.jsonText)
        if (chunk.complete) break
        expect(chunk.jsonText.length).toBeGreaterThan(0)
        offset += chunk.jsonText.length
      }
      result[section] = JSON.parse(chunks.join(''))
    }
    const expected = executePlatform(request)
    expect(result).toEqual({ simulation: expected.simulation, assessments: expected.assessments, document: expected.document })
    expect(result.assessments.map((assessment: any) => assessment.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied', 'satisfied'])
  } finally { await client.close() }
}, 20000)

it('exposes original per-NVA received-route evidence through the freshly built stdio engine without implying subnet injection', async () => {
  const client = new Client({ name: 'nva-bgp-contract-test', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' }))
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return response.structuredContent as Record<string, any>
  }
  const run = async (request: unknown, expectedStatus = 'complete') => {
    const { handle } = await call('start_simulation', { request })
    let state
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await call('get_job', { handle })
      if (state.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(state?.status).toBe('finished')
    expect(state?.resultStatus).toBe(expectedStatus)
    return handle
  }
  try {
    const capabilities = await call('get_capabilities')
    expect(capabilities.nvaBgp.evidence).toBe('simulation.nvaBgpPeers[originalApplianceId][]')
    expect((await call('get_schema', { mode: 'full' })).nvaBgp).toEqual(capabilities.nvaBgp)
    const topology = nvaBgpTopology()
    topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/12', '203.0.113.0/24']
    const base = { contractVersion: 1 as const, document: { mode: 'full' as const, topology } }
    await run({ ...base, operation: 'validate' })
    const request = { ...base, operation: 'evaluate' as const, requirements: [
      { id: 'bgp-reception-does-not-inject-host-subnet', kind: 'route' as const, table: 'reader-subnet', prefix: '198.18.0.0/24', expectation: 'absent' as const },
    ] }
    const handle = await run(request, 'not assessed')
    const neighborChunks: string[] = []
    for (let offset = 0; offset < 1_000_000;) {
      const chunk = await call('get_evidence', { handle, section: 'bgpNeighbors', offset, limit: 16000 })
      neighborChunks.push(chunk.jsonText)
      if (chunk.complete) break
      expect(chunk.jsonText.length).toBeGreaterThan(0)
      offset += chunk.jsonText.length
    }
    const neighbors = JSON.parse(neighborChunks.join(''))
    expect(neighbors).toEqual(executePlatform(request).bgpNeighbors)
    expect(neighbors.neighbors.filter((neighbor: any) => neighbor.localResourceKey === JSON.stringify(['appliance', 'reader']))).toHaveLength(4)
    const chunks: string[] = []
    for (let offset = 0; offset < 1_000_000;) {
      const chunk = await call('get_evidence', { handle, section: 'simulation', offset, limit: 2000 })
      chunks.push(chunk.jsonText)
      if (chunk.complete) break
      expect(chunk.jsonText.length).toBeGreaterThan(0)
      offset += chunk.jsonText.length
    }
    const simulation = JSON.parse(chunks.join(''))
    expect(simulation).toEqual(executePlatform(request).simulation)
    expect(simulation.nvaBgpPeers.reader).toHaveLength(2)
    expect(simulation.nvaBgpPeers.reader[0].gatewaySummaryAssessment).toMatchObject({
      status: 'not-assessed', configuredPrefixes: ['10.0.0.0/12', '203.0.113.0/24'], gatewayIds: [], branchToBranch: true,
    })
    expect(simulation.nvaBgpPeers.reader[1].gatewaySummaryAssessment).toBeUndefined()
    expect(simulation.nvaBgpPeers.reader.flatMap((peer: any) => peer.routes.filter((route: any) => route.prefix === '198.18.0.0/24'))).toHaveLength(2)
    expect(simulation.nvaBgpPeers.reader[0].routes.find((route: any) => route.prefix === '198.18.0.0/24')).toMatchObject({
      asPath: [65515, 65020], nextHopId: 'west-ars', wireAttributes: { nextHop: 'not-assessed' },
      sourceRoute: { nextHopId: 'west-source', nextHopIp: '10.10.1.4', asPath: [65020] },
    })
    const assessments = await call('get_evidence', { handle, section: 'assessments', limit: 16000 })
    expect(assessments.complete).toBe(true)
    expect(JSON.parse(assessments.jsonText)[0]).toMatchObject({ outcome: 'not assessed', coverage: { complete: false } })
    expect(simulation.subnetTables['reader-subnet'].routes.filter((route: any) => route.prefix === '198.18.0.0/24' && route.active)).toHaveLength(0)
    topology.vnets[0].routeServer!.branchToBranchTraffic = false
    const offRequest = { ...base, operation: 'simulate' }
    const offHandle = await run(offRequest)
    const offChunks: string[] = []
    for (let offset = 0; offset < 1_000_000;) {
      const chunk = await call('get_evidence', { handle: offHandle, section: 'bgpNeighbors', offset, limit: 16000 })
      offChunks.push(chunk.jsonText)
      if (chunk.complete) break
      expect(chunk.jsonText.length).toBeGreaterThan(0)
      offset += chunk.jsonText.length
    }
    const directOff = executePlatform(offRequest).bgpNeighbors!
    expect(JSON.parse(offChunks.join(''))).toEqual(directOff)
    const readerNeighbors = directOff.neighbors.filter((neighbor) => neighbor.localResourceKey === JSON.stringify(['appliance', 'reader']))
    expect(readerNeighbors).toHaveLength(4)
    expect(readerNeighbors.every((neighbor) => neighbor.availability === 'available')).toBe(true)
    expect(readerNeighbors.filter((neighbor) => neighbor.remoteResourceKey === JSON.stringify(['route-server', 'west-ars']))
      .map((neighbor) => neighbor.received!.routes.length)).toEqual([1, 1])
    expect(readerNeighbors.filter((neighbor) => neighbor.remoteResourceKey === JSON.stringify(['route-server', 'east-ars']))
      .map((neighbor) => neighbor.received!.routes.length)).toEqual([3, 3])
  } finally { await client.close() }
}, 20000)

it('qualifies owned HA-port forwarding and fail-closed alternatives through the actual stdio engine', async () => {
  const client = new Client({ name: 'ha-ports-contract-test', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' }))
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return response.structuredContent as Record<string, any>
  }
  try {
    expect((await call('get_capabilities')).haPorts.modes).toEqual(['hub-spoke', 'full'])
    expect((await call('get_schema', { mode: 'full' })).inventoryShapes.haPortsRule.haPortsForwarding).toBe('preserve-tuple')
    for (const variant of ['healthy', 'unknown', 'unhealthy', 'wrong-return'] as const) {
      const topology = haPortsTopology()
      if (variant === 'unknown' || variant === 'unhealthy') topology.inventory!.loadBalancers![0].probes[0].health[0].status = variant
      if (variant === 'wrong-return') topology.udrTables[1].routes[0].nextHopIp = '10.80.2.4'
      const request = { contractVersion: 2 as const, operation: 'evaluate' as const, document: { mode: 'full' as const, topology },
        requirements: [{ id: 'original-ha-packet', kind: 'packet' as const, packet: haPacket,
          sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10', expectation: 'configured' as const,
          requiredBackend: { ...haBackend('primary'), address: '10.80.1.4' } }, ...haRoutingRequirements('primary')] }
      const job = await call('start_simulation', { request })
      let state
      for (let attempt = 0; attempt < 100; attempt++) {
        state = await call('get_job', { handle: job.handle })
        if (state.status === 'finished') break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(state?.status).toBe('finished')
      expect(state?.resultStatus).toBe(variant === 'unknown' ? 'not assessed' : 'complete')
      const chunks: string[] = []
      for (let offset = 0; offset < 1_000_000;) {
        const chunk = await call('get_evidence', { handle: job.handle, section: 'assessments', offset, limit: 16000 })
        chunks.push(chunk.jsonText)
        if (chunk.complete) break
        expect(chunk.jsonText.length).toBeGreaterThan(0)
        offset += chunk.jsonText.length
      }
      const evidence = JSON.parse(chunks.join(''))
      expect(evidence).toEqual(executePlatform(request).assessments)
      expect(evidence[0].outcome).toBe(variant === 'healthy' ? 'satisfied' : variant === 'unknown' ? 'not assessed' : 'violated')
      expect(evidence.at(-1).outcome).toBe('satisfied')
    }
  } finally { await client.close() }
}, 20000)

it('serves actual stdio discovery, validation, grading, bounded evidence and cancellation without privileged tools', async () => {
  const client = new Client({ name: 'platform-contract-test', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += chunk })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return response.structuredContent as Record<string, any>
  }
  try {
    const list = await client.listTools()
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(['cancel_job', 'cancel_render', 'get_artifact', 'get_capabilities', 'get_evidence', 'get_job', 'get_render_job', 'get_schema', 'release_render', 'start_render', 'start_simulation'])
    expect((await call('get_capabilities')).modes).toEqual(['vwan', 'hub-spoke', 'full'])
    const topology = {
      version: 1, name: 'MCP owned spokes',
      hubs: [{ id: 'a', name: 'A', region: 'swedencentral', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
      spokes: [{ id: 's', name: 'S', hubId: 'a', prefixes: ['10.1.0.0/16'] }, { id: 't', name: 'T', hubId: 'a', prefixes: ['10.2.0.0/16'] }],
      sites: [], connections: [], siteLinks: [],
    }
    const request = {
      contractVersion: 1, operation: 'evaluate', document: { mode: 'vwan', topology },
      requirements: [{ id: 'goal', kind: 'flow', source: { kind: 'spoke', id: 's' }, target: { kind: 'spoke', id: 't' }, sourceAddress: '10.1.0.4', destinationAddress: '10.2.0.4', expectation: 'allow' }],
    }
    const schema = await call('get_schema', { mode: 'full' })
    expect(schema.example.kind).toBe('azure-network-topology')
    expect(schema.inventoryShapes.nics[0].owner.kind).toBe('vnet')
    expect(schema.optionalPacket.operation).toBe('simulate')
    expect(schema.requirementShapes.some((shape: Record<string, unknown>) => shape.applianceChain)).toBe(true)
    const chainTopology = structuredClone(scenarioTopologies['colocated-chain'])
    chainTopology.udrTables.find((table) => table.id === 'inspection-onward')!.routes[0].enabled = true
    const chainCheck = scenarioBundle.checks.find((check) => check.id === 'colocated-chain.repair-check')!
    if (chainCheck.kind !== 'requirements.satisfied') throw new Error('Expected chain check')
    const chainJob = await call('start_simulation', { request: { contractVersion: 1, operation: 'evaluate',
      document: { mode: 'full', topology: chainTopology }, requirements: chainCheck.params.requirements } })
    let chainResult
    for (let attempt = 0; attempt < 100; attempt++) {
      chainResult = await call('get_job', { handle: chainJob.handle })
      if (chainResult.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(chainResult?.resultStatus).toBe('complete')
    expect(chainResult?.assessments.map((entry: { outcome: string }) => entry.outcome)).toEqual(['satisfied', 'satisfied', 'satisfied'])
    const haTopology = haRoutingTopology()
    haTopology.vpnConnections[0].enabled = false
    const haRequirements = haRoutingRequirements('primary')
    if (haRequirements[0].kind !== 'flow') throw new Error('Expected branch flow')
    delete haRequirements[0].applianceChain
    const haJob = await call('start_simulation', { request: { contractVersion: 1, operation: 'evaluate',
      document: { mode: 'full', topology: haTopology }, requirements: haRequirements } })
    let haResult
    for (let attempt = 0; attempt < 100; attempt++) {
      haResult = await call('get_job', { handle: haJob.handle })
      if (haResult.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(haResult?.resultStatus).toBe('complete')
    expect(haResult?.assessments.map((entry: { outcome: string }) => entry.outcome)).toEqual(['violated', 'satisfied', 'satisfied'])
    const { handle } = await call('start_simulation', { request })
    let result
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await call('get_job', { handle })
      if (result.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(result?.resultStatus).toBe('complete')
    expect(result?.assessments[0].outcome).toBe('satisfied')
    const chunk = await call('get_evidence', { handle, section: 'assessments', offset: 0, limit: 100 })
    expect(chunk.jsonText.length).toBeLessThanOrEqual(100)
    expect(chunk.complete).toBe(false)
    const packetRequest = {
      contractVersion: 1, operation: 'simulate', document: { mode: 'vwan', topology: {
        ...topology, spokes: topology.spokes.map((spoke) => ({ ...spoke, subnets: [{ id: `subnet-${spoke.id}`, name: 'App', prefix: spoke.prefixes[0] }] })),
        inventory: {
          workloads: [{ id: 'mcp-vm', name: 'MCP workload', nicIds: ['mcp-nic'] }],
          nics: [{ id: 'mcp-nic', name: 'MCP NIC', owner: { kind: 'spoke', id: 's' },
            ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: 'subnet-s', privateIp: '10.1.0.4' }] }],
          publicIps: [],
        },
      } },
      packet: { source: { kind: 'workload', workloadId: 'mcp-vm', nicId: 'mcp-nic', ipConfigurationId: 'primary' },
        target: { kind: 'external', address: '20.50.60.70' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 },
    }
    const packetJob = await call('start_simulation', { request: packetRequest })
    let packetStatus
    for (let attempt = 0; attempt < 100; attempt++) {
      packetStatus = await call('get_job', { handle: packetJob.handle })
      if (packetStatus.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(packetStatus?.resultStatus).toBe('complete')
    expect(packetStatus?.sections).toContain('packet')
    const packetChunk = await call('get_evidence', { handle: packetJob.handle, section: 'packet', limit: 16000 })
    expect(packetChunk.complete).toBe(true)
    expect(JSON.parse(packetChunk.jsonText)).toEqual(executePlatform(packetRequest).packet)
    expect(JSON.parse(packetChunk.jsonText).reply.routing).toBe('not-assessed')
    const badPacket = await client.callTool({ name: 'start_simulation', arguments: {
      request: { ...packetRequest, packet: { ...packetRequest.packet, sourcePort: 0 } },
    } })
    expect(badPacket.isError).toBe(true)
    const vpnRequest = { contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: vpnNatFixture('vwan') },
      vpnPacket: { connectionId: 'vpn', direction: 'ingress', tuple: { sourceAddress: '10.0.0.4',
        destinationAddress: '192.168.2.5', sourcePort: 12345, destinationPort: 443, protocol: 'tcp' } } }
    const vpnJob = await call('start_simulation', { request: vpnRequest })
    let vpnStatus
    for (let attempt = 0; attempt < 100; attempt++) {
      vpnStatus = await call('get_job', { handle: vpnJob.handle })
      if (vpnStatus.status === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(vpnStatus?.resultStatus).toBe('complete')
    expect(vpnStatus?.sections).toContain('vpnPacket')
    const vpnChunk = await call('get_evidence', { handle: vpnJob.handle, section: 'vpnPacket', limit: 16000 })
    expect(vpnChunk.complete).toBe(true)
    const vpnEvidence = JSON.parse(vpnChunk.jsonText)
    expect(vpnEvidence).toEqual(executePlatform(vpnRequest).vpnPacket)
    expect(vpnEvidence.forward.routing).toBe('reachable')
    expect(vpnEvidence.reply.routing).toBe('reachable')
    const second = await call('start_simulation', { request })
    await call('cancel_job', { handle: second.handle })
    expect((await call('get_job', { handle: second.handle })).resultStatus).toBe('not assessed')
    await expect(call('get_job', { handle: '11111111-1111-4111-8111-111111111111' })).rejects.toThrow()
    const invalid = await client.callTool({ name: 'start_simulation', arguments: { request: { ...request, operation: 'deploy' } } })
    expect(invalid.isError).toBe(true)
    expect(stderr).toBe('')
  } finally { await client.close() }
}, 20000)

it('exports real custom-routing bypass and inspected GIF artifacts through bounded MCP chunks', async () => {
  const client = new Client({ name: 'flow-export-test', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return response.structuredContent as Record<string, any>
  }
  const wait = async (name: string, handle: string) => {
    const deadline = Date.now() + 35000
    for (;;) {
      const state = await call(name, { handle })
      if (state.status !== 'running') return state
      if (Date.now() > deadline) throw new Error('Job did not finish.')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  try {
    const requirements = [
      { id: 'vnet-bypass', target: { kind: 'spoke', id: 'trusted-b' }, destinationAddress: '10.20.0.4', inspect: false },
      { id: 'branch-bypass', target: { kind: 'site', id: 'branch-a' }, destinationAddress: '10.50.0.4', inspect: false },
      { id: 'inspected', target: { kind: 'spoke', id: 'untrusted-a' }, destinationAddress: '10.30.0.4', inspect: true },
    ].map(({ inspect, ...goal }) => ({
      ...goal, kind: 'flow', source: { kind: 'spoke', id: 'trusted-a' }, sourceAddress: '10.10.0.4', expectation: 'allow',
      firewallPolicy: { hubId: 'hub-local', forward: inspect ? 'required' : 'bypassed', reverse: inspect ? 'required' : 'bypassed' },
    }))
    const { handle } = await call('start_simulation', { request: {
      contractVersion: 1, operation: 'evaluate', document: { mode: 'vwan', topology: hubFirewallTopology() }, requirements,
    } })
    const evaluation = await wait('get_job', handle)
    expect(evaluation.assessments.every((a: any) => a.outcome === 'satisfied')).toBe(true)
    for (const goal of requirements) {
      const rendered = await call('start_render', { handle, assessmentId: goal.id, options: { width: 640, durationMs: 1500 } })
      const job = await wait('get_render_job', rendered.handle)
      expect(job.status, JSON.stringify(job)).toBe('finished')
      expect(job.revision).toBe(evaluation.revision)
      expect(job.mimeType).toBe('image/gif')
      expect(job.lanes).toHaveLength(2)
      expect(job.lanes.every((lane: any) => lane.nodes.some((node: any) => node.kind === 'firewall') === (goal.id === 'inspected'))).toBe(true)
      const chunks: Buffer[] = []
      let offset = 0
      for (;;) {
        const chunk = await call('get_artifact', { handle: rendered.handle, offset, limit: 997 })
        expect(chunk.offset).toBe(offset)
        const decoded = Buffer.from(chunk.data, 'base64')
        expect(decoded.length).toBe(chunk.nextOffset - chunk.offset)
        chunks.push(decoded)
        offset = chunk.nextOffset
        if (chunk.complete) break
      }
      const bytes = Buffer.concat(chunks)
      expect(bytes.length).toBe(job.byteLength)
      expect(bytes.subarray(0, 6).toString()).toBe('GIF89a')
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(job.sha256)
      await expect(call('get_artifact', { handle: rendered.handle, offset: job.byteLength + 1 })).rejects.toThrow()
      await call('release_render', { handle: rendered.handle })
      await expect(call('get_render_job', { handle: rendered.handle })).rejects.toThrow()
    }
    await expect(call('start_render', { handle, assessmentId: 'missing' })).rejects.toThrow()
    const cancelled = await call('start_render', { handle, assessmentId: 'inspected' })
    await call('cancel_render', { handle: cancelled.handle })
    expect((await call('get_render_job', { handle: cancelled.handle })).status).toBe('cancelled')
    await expect(call('get_artifact', { handle: cancelled.handle })).rejects.toThrow()
    await call('release_render', { handle: cancelled.handle })
    const retained: string[] = []
    for (let index = 0; index < 4; index++) {
      const job = await call('start_render', { handle, assessmentId: 'vnet-bypass', options: { format: 'svg' } })
      expect((await wait('get_render_job', job.handle)).status).toBe('finished')
      retained.push(job.handle)
    }
    await expect(call('start_render', { handle, assessmentId: 'vnet-bypass' })).rejects.toThrow('capacity')
    await call('release_render', { handle: retained[0] })
    const replacement = await call('start_render', { handle, assessmentId: 'vnet-bypass', options: { format: 'svg' } })
    expect((await wait('get_render_job', replacement.handle)).status).toBe('finished')
  } finally { await client.close() }
}, 60000)

it('assesses static hub Firewall required/bypassed legs through actual stdio with the same evidence as the local API', async () => {
  const client = new Client({ name: 'static-hub-firewall-test', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    expect(response.isError).not.toBe(true)
    return response.structuredContent as Record<string, any>
  }
  try {
    expect((await call('get_capabilities')).staticHubFirewall.scope).toContain('Single hub')
    for (const mode of ['vwan', 'full'] as const) {
      const schema = await call('get_schema', { mode })
      expect(schema.optionalStaticHubFirewall.staticRoute.nextHop).toBe(schema.optionalStaticHubFirewall.firewall.id)
      const request = { contractVersion: 1, operation: 'evaluate', document: { mode,
        topology: mode === 'vwan' ? hubFirewallTopology('published-branch') : azHubFirewallTopology('published-branch') },
      requirements: [{ id: 'asymmetric', kind: 'flow',
        source: mode === 'vwan' ? { kind: 'spoke', id: 'untrusted-a' } : { kind: 'subnet', vnetId: 'untrusted-a', subnetId: 'sub-untrusted-a' },
        target: mode === 'vwan' ? { kind: 'spoke', id: 'trusted-a' } : { kind: 'subnet', vnetId: 'trusted-a', subnetId: 'sub-trusted-a' },
        sourceAddress: '10.30.0.4', destinationAddress: '10.10.0.4', expectation: 'allow',
        firewallPolicy: { hubId: 'hub-local', forward: 'bypassed', reverse: 'required' } }] }
      const { handle } = await call('start_simulation', { request })
      let result
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await call('get_job', { handle })
        if (result.status === 'finished') break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(result?.resultStatus).toBe('complete')
      expect(result?.assessments[0].outcome).toBe('satisfied')
      const evidence = await call('get_evidence', { handle, section: 'assessments', limit: 16000 })
      expect(evidence.complete).toBe(true)
      expect(JSON.parse(evidence.jsonText)).toEqual(executePlatform(request).assessments)
    }
  } finally { await client.close() }
}, 20000)
