import { it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'
import { executePlatform } from '../src/platform/service'
import { vpnNatFixture } from '../tests/fixtures/vpn-nat'

it('serves actual stdio discovery, validation, grading, bounded evidence and cancellation without privileged tools', async () => {
  const client = new Client({ name: 'platform-contract-test', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('platform-dist', 'mcp.cjs')], stderr: 'pipe' })
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
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(['cancel_job', 'get_capabilities', 'get_evidence', 'get_job', 'get_schema', 'start_simulation'])
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
