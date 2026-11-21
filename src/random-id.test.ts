import { afterEach, expect, test, vi } from 'vitest'
import { randomUUID } from './random-id'

afterEach(() => vi.unstubAllGlobals())

test('unavailable randomUUID uses secure bytes with UUID version and variant bits', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    bytes.fill(0xff)
    return bytes
  })
  vi.stubGlobal('crypto', { getRandomValues })
  expect(randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  expect(getRandomValues).toHaveBeenCalledOnce()
  expect(getRandomValues.mock.calls[0][0]).toHaveLength(16)
})

test('missing secure randomness fails rather than generating weak identifiers', () => {
  vi.stubGlobal('crypto', {})
  expect(() => randomUUID()).toThrow()
})
