import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export function dependencyGraph(sources) {
  const graph = new Map([...sources.keys()].map(file => [file, new Set()]))
  for (const [file, text] of sources) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue
      const specifier = node.moduleSpecifier.text
      if (!specifier.startsWith('.')) continue
      if (/\.(css|json|svg|png|jpg|webp)$/.test(specifier) || /\?(url|raw)$/.test(specifier)) continue
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        if (clause?.isTypeOnly) continue
        if (clause && !clause.name && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length && clause.namedBindings.elements.every(item => item.isTypeOnly)) continue
      } else {
        if (node.isTypeOnly) continue
        if (node.exportClause && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.length && node.exportClause.elements.every(item => item.isTypeOnly)) continue
      }
      const base = path.resolve(path.dirname(file), specifier)
      const target = [base, ...['.ts', '.tsx', '.mjs', '.cjs'].map(ext => base + ext),
        path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(candidate => sources.has(candidate))
      if (!target) throw new Error(`Unresolved relative dependency: ${file} -> ${specifier}`)
      graph.get(file).add(target)
    }
  }
  return graph
}

export function dependencyCycles(graph) {
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), cycles = []
  let index = 0
  function visit(file) {
    indices.set(file, index); low.set(file, index++)
    stack.push(file); active.add(file)
    for (const target of graph.get(file)) {
      if (!indices.has(target)) {
        visit(target)
        low.set(file, Math.min(low.get(file), low.get(target)))
      } else if (active.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)))
    }
    if (low.get(file) !== indices.get(file)) return
    const group = []
    let item
    do { item = stack.pop(); active.delete(item); group.push(item) } while (item !== file)
    if (group.length > 1 || graph.get(file).has(file)) cycles.push(group.sort())
  }
  for (const file of graph.keys()) if (!indices.has(file)) visit(file)
  return cycles.sort((a, b) => a[0].localeCompare(b[0]))
}

export async function assertDependencyBoundaries(root = process.cwd()) {
  const sources = new Map()
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test-artifacts'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(file)
      else if (/\.(ts|tsx|mjs|cjs)$/.test(entry.name) && !/\.(test|spec|d)\./.test(entry.name)) sources.set(file, await readFile(file, 'utf8'))
    }
  }
  for (const directory of ['src', 'platform', 'functions', 'scripts']) await collect(path.resolve(root, directory))
  const graph = dependencyGraph(sources)
  const cycles = dependencyCycles(graph)
  if (cycles.length) throw new Error(`Runtime dependency cycles:\n${cycles.map(group => group.map(file => path.relative(root, file)).join(' <-> ')).join('\n')}`)
  for (const file of ['src/ipv4.ts', 'src/azure-identity.ts', 'src/deployment-location.ts']) {
    if (graph.get(path.resolve(root, file))?.size) throw new Error(`Dependency primitive must remain a runtime leaf: ${file}`)
  }
  return { files: graph.size, edges: [...graph.values()].reduce((count, targets) => count + targets.size, 0), cycles: cycles.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await assertDependencyBoundaries())
}
