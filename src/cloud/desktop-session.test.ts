import { describe, expect, it, vi } from 'vitest'
import { createDesktopCloudSession } from './desktop-session'
import type { DesktopCloudBridge, DesktopCloudReply, DesktopCloudState } from './desktop-contract'
import { CloudHttpError } from './client'

const state: DesktopCloudState = { configured: true, account: { id: 'alice', name: 'Alice' },
  session: '11111111-1111-4111-8111-111111111111' }
function bridge(): DesktopCloudBridge {
  return {
    cloudStatus: vi.fn<DesktopCloudBridge['cloudStatus']>(async () => ({ ok: true, value: state })),
    cloudSignIn: vi.fn<DesktopCloudBridge['cloudSignIn']>(async () => ({ ok: true, value: state })),
    cloudSignOut: vi.fn<DesktopCloudBridge['cloudSignOut']>(async () => ({ ok: true, value: undefined })),
    cloudRequest: vi.fn<DesktopCloudBridge['cloudRequest']>(async () => ({ ok: true, value: [] })),
  }
}
describe('desktop cloud session adapter', () => {
  it('restores through native IPC without loading browser sign-in, receiving tokens or making renderer requests', async () => {
    const native = bridge(), fetcher = vi.spyOn(globalThis, 'fetch')
    try {
      const session = createDesktopCloudSession(native)
      expect(session.configured).toBe(false)
      await session.restore()
      expect(session.configured).toBe(true)
      expect(session.getSnapshot()).toMatchObject({ status: 'signed-in', account: state.account })
      expect(await session.getSnapshot().api!.listTopologies()).toEqual([])
      expect(native.cloudRequest).toHaveBeenCalledWith({ session: state.session, operation: 'listTopologies', args: [] })
      expect(fetcher).not.toHaveBeenCalled()
      expect(native.cloudSignIn).not.toHaveBeenCalled()
    } finally { fetcher.mockRestore() }
  })
  it('preserves conflict statuses and revokes both old API handles and in-flight replies on account change', async () => {
    const native = bridge(), session = createDesktopCloudSession(native)
    await session.restore()
    const api = session.getSnapshot().api!
    native.cloudRequest = vi.fn<DesktopCloudBridge['cloudRequest']>(async () => ({ ok: false, error: 'Conflict', status: 412 }))
    await expect(api.deleteTopology('id', '"etag"')).rejects.toBeInstanceOf(CloudHttpError)
    await expect(api.deleteTopology('id', '"etag"')).rejects.toMatchObject({ status: 412 })
    let finish!: (value: DesktopCloudReply<unknown>) => void
    native.cloudRequest = vi.fn<DesktopCloudBridge['cloudRequest']>(() => new Promise(resolve => { finish = resolve }))
    const reading = api.listTopologies()
    await session.disconnect()
    finish({ ok: true, value: [{ name: 'Late result' }] })
    await expect(reading).rejects.toThrow('Account changed')
    await expect(api.listTopologies()).rejects.toThrow('Account changed')
    expect(native.cloudRequest).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toEqual({ status: 'signed-out' })
  })
  it('cancels pending sign-in and never publishes a late account', async () => {
    const native = bridge(), session = createDesktopCloudSession(native)
    let finish!: (value: DesktopCloudReply<DesktopCloudState>) => void
    native.cloudSignIn = vi.fn<DesktopCloudBridge['cloudSignIn']>(() => new Promise(resolve => { finish = resolve }))
    const connecting = session.connect()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await session.disconnect()
    finish({ ok: true, value: state })
    await connecting
    expect(session.getSnapshot()).toEqual({ status: 'signed-out' })
  })
  it('keeps unconfigured desktops local-only and reports native failures without inventing a session', async () => {
    const native = bridge(), session = createDesktopCloudSession(native)
    native.cloudStatus = vi.fn<DesktopCloudBridge['cloudStatus']>(async () => ({ ok: true, value: { configured: false } }))
    await session.restore()
    expect(session.configured).toBe(false)
    expect(session.getSnapshot()).toEqual({ status: 'signed-out' })
    native.cloudSignIn = vi.fn<DesktopCloudBridge['cloudSignIn']>(async () => ({ ok: false, error: 'Cancelled' }))
    await session.connect()
    expect(session.getSnapshot()).toEqual({ status: 'error' })
  })
})
