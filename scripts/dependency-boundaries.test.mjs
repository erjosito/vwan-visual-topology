import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { dependencyCycles, dependencyGraph } from './dependency-boundaries.mjs'

const graph = entries => dependencyGraph(new Map(Object.entries(entries).map(([file, text]) => [path.resolve(file), text])))

test('runtime imports and compatibility re-exports cannot hide a cycle', () => {
  const result = graph({ 'a.ts': "export { value } from './b'", 'b.ts': "import { value } from './a'" })
  assert.deepEqual(dependencyCycles(result), [[path.resolve('a.ts'), path.resolve('b.ts')].sort()])
})

test('type-only and lazy edges do not create a static runtime cycle', () => {
  const result = graph({
    'a.ts': "import { value, type Other } from './b'; export type { Other } from './b'",
    'b.ts': "import type { Other } from './a'; import { type Another } from './a'; export { type Other } from './a'; const lazy = () => import('./a')",
  })
  assert.equal(result.get(path.resolve('a.ts')).size, 1)
  assert.equal(result.get(path.resolve('b.ts')).size, 0)
  assert.deepEqual(dependencyCycles(result), [])
})

test('side-effect imports and self imports are runtime dependencies; unresolved edges fail closed', () => {
  assert.equal(dependencyCycles(graph({ 'a.ts': "import './a'" })).length, 1)
  assert.throws(() => graph({ 'a.ts': "import './missing'" }), /Unresolved relative dependency/)
})
