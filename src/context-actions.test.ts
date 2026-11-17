import { describe, expect, it, vi } from 'vitest'
import { contextActionDisabled, previewVnetActions } from './context-actions'
import type { ContextAction } from './TopologyContextMenu'

describe('preview VNet actions', () => {
  it('keeps original primary and destructive handlers and exposes the untouched full catalog', () => {
    const inspect = { label: 'Inspect routes', previewPrimary: true, onSelect: vi.fn() }
    const connect = { label: 'Connect', previewPrimary: true, allowDisabledChildren: true,
      children: [{ label: 'Existing destination', disabled: true }] }
    const advanced = { label: 'Advanced routing', children: [{ label: 'Custom table', run: vi.fn() }] }
    const remove = { label: 'Delete VNet', danger: true, run: vi.fn() }
    const actions: ContextAction[] = [advanced, inspect, connect, remove]
    const openAll = vi.fn(() => actions)
    const preview = previewVnetActions(actions, openAll)
    expect(preview).toEqual([inspect, connect, expect.objectContaining({ label: 'All VNet actions' }), remove])
    expect(preview[0]).toBe(inspect)
    expect(preview[1].children).toBe(connect.children)
    expect(contextActionDisabled(preview[1])).toBe(false)
    preview[0].onSelect?.()
    preview[2].run?.()
    preview[3].run?.()
    expect(inspect.onSelect).toHaveBeenCalledOnce()
    expect(openAll).toHaveReturnedWith(actions)
    expect(remove.run).toHaveBeenCalledOnce()
    expect(actions).toEqual([advanced, inspect, connect, remove])
  })

  it('does not duplicate destructive primary actions or enable disabled actions', () => {
    const remove = { label: 'Delete', previewPrimary: true, danger: true, disabled: true }
    const preview = previewVnetActions([remove], vi.fn())
    expect(preview.filter((action) => action === remove)).toHaveLength(1)
    expect(contextActionDisabled(preview[0])).toBe(true)
    expect(previewVnetActions([], vi.fn())).toHaveLength(1)
  })
})
