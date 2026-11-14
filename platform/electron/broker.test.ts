import { it, expect } from 'vitest'
import { AzureBroker, scopeArguments } from './broker'
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'

const subscriptionId = '00000000-0000-4000-8000-000000000002', tenantId = '00000000-0000-4000-8000-000000000001'
const target = `/subscriptions/${subscriptionId}/resourceGroups/fixture-network/providers/Microsoft.Network/virtualWans/fixture-wan`

it('rejects malformed scope, wrong subscription, shell arguments and concurrent collection before process execution', async () => {
  let invoked = 0
  const broker = new AzureBroker('internal', 'collectors', async () => { invoked++; throw new Error('CLI unavailable') })
  expect(() => scopeArguments({ subscriptionId: '& az login', tenantId })).toThrow()
  expect(() => scopeArguments({ subscriptionId, tenantId, command: 'login' } as any)).toThrow()
  await expect(broker.collect({ subscriptionId, tenantId, mode: 'vwan', target: target.replace(subscriptionId, tenantId) })).rejects.toThrow('selected subscription')
  await expect(broker.collect({ subscriptionId, tenantId, mode: 'full', target: 'rg"; az login' })).rejects.toThrow('target')
  expect(invoked).toBe(0)
  await expect(broker.accounts()).rejects.toThrow('CLI unavailable')
})

it('keeps explicit scope, enforces deadlines, removes credential fields, validates partial captures and deletes temporary files', async () => {
  const calls: { args: string[]; timeout: number }[] = []
  let captureFile = ''
  const broker = new AzureBroker('internal', 'collectors', async (args, timeout) => {
    calls.push({ args, timeout })
    if (args.includes('accounts')) return JSON.stringify({ cloud: { name: 'AzureCloud' }, accounts: [] })
    if (args.includes('targets')) return JSON.stringify({ groups: [], wans: [] })
    captureFile = args[args.indexOf('-OutputFile') + 1]
    const capture = JSON.parse(await readFile(resolve('tests', 'fixtures', 'azure-vwan-contexts', 'native-default.json'), 'utf8'))
    capture.sharedKey = 'DO-NOT-PUBLISH'
    capture.warnings.push('Partial capture: branch scope not known')
    await writeFile(captureFile, JSON.stringify(capture))
    return '{"captured":true}'
  })
  await broker.accounts()
  await broker.targets({ subscriptionId, tenantId })
  const capture = await broker.collect({ subscriptionId, tenantId, mode: 'vwan', target })
  expect(capture.content).not.toContain('DO-NOT-PUBLISH')
  expect(capture.content).toContain('Partial capture')
  expect(calls[1].args).toContain(subscriptionId)
  expect(calls[1].args).toContain(tenantId)
  expect(calls[2].timeout).toBe(1200000)
  await expect(access(captureFile)).rejects.toThrow()
})

it('rejects unsupported cloud, malformed captures and CLI errors without leaking stderr or changing Azure defaults', async () => {
  const wrongCloud = new AzureBroker('internal', 'collectors', async () => JSON.stringify({ cloud: { name: 'AzureUSGovernment' }, accounts: [] }))
  await expect(wrongCloud.accounts()).rejects.toThrow('Unsupported cloud')
  let file = ''
  const malformed = new AzureBroker('internal', 'collectors', async (args) => {
    file = args[args.indexOf('-OutputFile') + 1]
    await writeFile(file, '{"notACapture":true}')
    return '{}'
  })
  await expect(malformed.collect({ subscriptionId, tenantId, mode: 'vwan', target })).rejects.toThrow()
  await expect(access(file)).rejects.toThrow()
})

it('rejects oversized captures and serializes collection, while still cleaning temporary output', async () => {
  let file = ''
  const oversized = new AzureBroker('internal', 'collectors', async (args) => {
    file = args[args.indexOf('-OutputFile') + 1]
    await writeFile(file, Buffer.alloc(4_000_001))
    return '{}'
  })
  const input = { subscriptionId, tenantId, mode: 'vwan' as const, target }
  const first = oversized.collect(input)
  await expect(oversized.collect(input)).rejects.toThrow('already running')
  await expect(first).rejects.toThrow('limit')
  await expect(access(file)).rejects.toThrow()
})
