import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from './benchmark-interactive.mjs'

test('unavailable or invalid timing cannot be reported as a fast measured baseline', () => {
  for (const values of [[], [NaN], [Infinity], [-1], [undefined]]) {
    assert.throws(() => summarize(values), /Missing or invalid/)
  }
  const raw = [80, 15, 30, 20, 50]
  const result = summarize(raw)
  assert.deepEqual(raw, [80, 15, 30, 20, 50])
  assert.equal(result.samples, 5)
  assert.equal(result.median, 30)
  assert.equal(result.p95, 80)
})
