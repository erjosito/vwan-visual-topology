import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, freemem, platform, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { createProductionServer } from './production-server.mjs'
import { filesIn } from './release-candidate.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const modes = ['vwan', 'hub-spoke', 'full']
const tiers = ['small', 'dense', 'near-limit']

export function summarize(values) {
  assert.ok(values.length && values.every(value => Number.isFinite(value) && value >= 0), 'Missing or invalid measured samples')
  const ordered = [...values].sort((a, b) => a - b)
  const rank = percentile => ordered[Math.ceil(ordered.length * percentile) - 1]
  return { samples: ordered.length, min: ordered[0], median: rank(0.5), p95: rank(0.95), max: ordered.at(-1) }
}

async function sourceIdentity() {
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()
  return { sha: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')),
    diffSha256: sha256(git('diff', 'HEAD', '--binary')),
    untracked: Object.fromEntries(await Promise.all(untracked.map(async file => [file, sha256(await readFile(file))]))) }
}

async function measureAction(page, locator, event, action) {
  await locator.evaluate((element, event) => {
    window.__AZNET_METRICS__ = { counts: {}, durations: {} }
    window.__INTERACTIVE_FENCE__ = new Promise(resolve => {
      element.addEventListener(event, () => {
        const start = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)))
      }, { capture: true, once: true })
    })
  }, event)
  await action()
  let deadline
  try {
    return await Promise.race([
      page.evaluate(async () => ({ eventToTwoRafMillis: await window.__INTERACTIVE_FENCE__,
        metrics: structuredClone(window.__AZNET_METRICS__) })),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Interactive render fence exceeded 45 seconds')), 45_000) }),
    ])
  } finally {
    clearTimeout(deadline)
  }
}

async function topologyIn(page, mode) {
  return page.evaluate(mode => {
    const saved = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'))
    return mode === 'vwan' ? saved : saved.topology
  }, mode)
}

async function openNodeAction(page, mode, node, action) {
  const target = mode === 'vwan' ? page.getByLabel(`Select spoke ${node.name}`, { exact: true })
    : page.getByTestId(`aznet-select-vnet-${node.id}`)
  await target.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: action, exact: true }).click()
  if (mode !== 'vwan' && action === 'Configure VNet & Elements') {
    const section = page.locator('.aznet-inspector-window summary').filter({ hasText: 'VNet configuration' })
    if (await section.locator('..').getAttribute('open') === null) await section.click()
  }
}

async function measureWorkload(browser, origin, mode, tier, topology, iterations) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const result = { mode, tier, status: 'not-assessed', workloadSha256: sha256(JSON.stringify(topology)),
    nativeReferences: mode === 'vwan' ? topology.spokes.length : topology.vnets.length,
    prefixes: (mode === 'vwan' ? [...topology.spokes, ...topology.sites] : [...topology.vnets, ...topology.sites])
      .reduce((count, node) => count + node.prefixes.length, 0),
    topologyBytes: Buffer.byteLength(JSON.stringify(topology)), samples: [] }
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(45_000)
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.addInitScript(({ mode, topology }) => {
      window.__AZNET_METRICS__ = { counts: {}, durations: {} }
      localStorage.setItem('vwan-visual-topology:language:v1', 'en')
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('aznet-workspace-tools:v1', 'open')
      localStorage.setItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1',
        JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology }))
    }, { mode, topology })
    await page.goto(`${origin}/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    await page.waitForLoadState('networkidle')
    const original = await topologyIn(page, mode)
    assert.deepEqual((mode === 'vwan' ? original.spokes : original.vnets).map(node => node.id),
      (mode === 'vwan' ? topology.spokes : topology.vnets).map(node => node.id), 'Browser admission omitted or replaced native references')
    const node = mode === 'vwan' ? original.spokes[0] : original.vnets.find(vnet => vnet.id === 'bench-vnet-0')
    assert.ok(node, 'Missing benchmark edit endpoint')
    const undo = page.getByRole('button', { name: /Undo$/, exact: false })
    if (!await undo.isVisible()) await page.getByTitle('Workspace controls', { exact: true }).click()
    for (let iteration = 0; iteration <= iterations; iteration++) {
      const record = (operation, sample) => {
        if (iteration) result.samples.push({ iteration, operation, ...sample })
      }
      for (const semantic of [false, true]) {
        await openNodeAction(page, mode, node, mode === 'vwan' ? 'Edit configuration' : 'Configure VNet & Elements')
        let sample
        if (mode === 'vwan') {
          const editor = page.getByRole('dialog', { name: 'Edit spoke', exact: true })
          await editor.getByLabel(semantic ? 'Prefixes' : 'Name', { exact: true }).fill(semantic
            ? ['10.250.250.0/24', ...node.prefixes.slice(1)].join(', ') : `${node.name} measured`)
          const submit = editor.getByRole('button', { name: 'Save changes', exact: true })
          sample = await measureAction(page, submit, 'click', () => submit.click())
        } else {
          const input = semantic ? page.getByTestId(`aznet-vnet-region-${node.id}`)
            : page.getByRole('textbox', { name: `VNet name ${node.name}`, exact: true })
          sample = await measureAction(page, input, 'input', () => input.fill(semantic ? 'eastus' : `${node.name} measured`))
        }
        const changed = await topologyIn(page, mode)
        assert.notDeepEqual(changed, original, 'The measured edit did not commit')
        const edited = (mode === 'vwan' ? changed.spokes : changed.vnets).find(candidate => candidate.id === node.id)
        assert.ok(edited, 'The edit lost its original native ID')
        if (!semantic) assert.equal(edited.name, `${node.name} measured`, 'The requested display edit did not commit')
        else if (mode === 'vwan') assert.deepEqual(edited.prefixes, ['10.250.250.0/24', ...node.prefixes.slice(1)])
        else assert.equal(edited.region, 'eastus', 'The requested semantic edit did not commit')
        assert.ok(sample.metrics.counts.persist, 'The measured edit did not persist')
        record(semantic ? 'semantic-edit' : 'display-edit', sample)
        const reversed = await measureAction(page, undo, 'click', () => undo.click())
        assert.deepEqual(await topologyIn(page, mode), original, 'Undo did not restore native IDs and the original document')
        record(semantic ? 'undo-semantic-edit' : 'undo-display-edit', reversed)
      }
      await openNodeAction(page, mode, node, 'Open path explorer')
      let sample
      if (mode === 'vwan') {
        const destination = page.getByLabel('Destination node', { exact: true })
        await destination.selectOption(`spoke:${original.spokes.at(-1).id}`)
        await page.getByLabel('Destination prefix', { exact: true }).selectOption(original.spokes.at(-1).prefixes[0])
        const show = page.getByRole('button', { name: 'Show preferred path', exact: true })
        sample = await measureAction(page, show, 'click', () => show.click())
      } else {
        await page.getByTestId('aznet-trace-source-select').selectOption(`subnet:${node.id}:${node.subnets[0].id}`)
        const destination = page.getByTestId('aznet-trace-dest-select')
        const target = original.sites[0] ? `site:${original.sites[0].id}:${original.sites[0].prefixes[0]}`
          : `subnet:${original.vnets.at(-1).id}:${original.vnets.at(-1).subnets[0].id}`
        const alternate = await destination.locator('option').evaluateAll((options, target) =>
          options.map(option => option.value).find(value => value && value !== target), target)
        assert.ok(alternate, 'Missing alternate trace endpoint')
        await destination.selectOption(alternate)
        sample = await measureAction(page, destination, 'change', () => destination.selectOption(target))
      }
      assert.ok(sample.metrics.counts.trace, 'The measured action did not execute a native interactive trace')
      assert.deepEqual(await topologyIn(page, mode), original, 'Tracing mutated the saved native document')
      record('trace', sample)
    }
    result.operations = Object.fromEntries([...new Set(result.samples.map(sample => sample.operation))].map(operation => {
      const samples = result.samples.filter(sample => sample.operation === operation)
      const kinds = [...new Set(samples.flatMap(sample => Object.keys(sample.metrics.durations)))]
      return [operation, { eventToTwoRafMillis: summarize(samples.map(sample => sample.eventToTwoRafMillis)),
        phases: Object.fromEntries(kinds.map(kind => [kind, summarize(samples.flatMap(sample => sample.metrics.durations[kind] ?? []))])),
        invocationCounts: Object.fromEntries([...new Set(samples.flatMap(sample => Object.keys(sample.metrics.counts)))]
          .map(kind => [kind, samples.map(sample => sample.metrics.counts[kind] ?? 0)])) }]
    }))
    result.status = 'measured'
  } catch (error) {
    result.error = String(error.message).replaceAll(process.cwd(), '<repository>').slice(0, 1500)
  } finally {
    await context.close()
  }
  console.log(JSON.stringify({ mode, tier, status: result.status, error: result.error,
    operations: result.operations && Object.fromEntries(Object.entries(result.operations).map(([key, value]) => [key, value.eventToTwoRafMillis])) }))
  return result
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: 'test-artifacts/interactive-benchmark.json' },
    iterations: { type: 'string', default: '5' },
    mode: { type: 'string', multiple: true },
    tier: { type: 'string', multiple: true },
  } })
  const iterations = Number(values.iterations)
  assert.ok(Number.isInteger(iterations) && iterations >= 2 && iterations <= 20, 'Use 2-20 measured iterations plus one excluded warmup')
  const selectedModes = values.mode ?? modes, selectedTiers = values.tier ?? tiers
  assert.ok(selectedModes.length && selectedModes.every(mode => modes.includes(mode)), 'Unknown or empty mode selection')
  assert.ok(selectedTiers.length && selectedTiers.every(tier => tiers.includes(tier)), 'Unknown or empty tier selection')
  const before = await sourceIdentity()
  const result = { schema: 1, measuredAt: new Date().toISOString(), source: before,
    environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, totalMemory: totalmem(), availableMemoryBefore: freemem() },
    iterations, excludedWarmupIterations: 1, selectedModes, selectedTiers,
    methodology: 'Synthetic native documents on local production Chromium, English new UI, 1440x1000. Event capture to two requestAnimationFrame callbacks includes scheduling, handlers, React work and rendering opportunity, not physical paint or Azure latency. Phase spans can overlap and must not be added; render-to-layout is inclusive, not exclusive React CPU. Opt-in bounded local metrics only, no telemetry. Sparse mixed 1000-VNet case measures structural retention, not dense transit or platform qualification; native measurements do not certify the public 512-node/15-second/8MB envelope. Five-sample p95 is a coarse nearest-rank maximum, not fleet evidence. Ambient machine load is uncontrolled.',
    builtFiles: await filesIn(resolve('dist')), cases: [] }
  const server = await createProductionServer({ root: 'dist', port: 0 })
  let browser, loader
  try {
    loader = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
      optimizeDeps: { noDiscovery: true, include: [] } })
    const fixture = await loader.ssrLoadModule('/tests/fixtures/interactive-workloads.ts')
    browser = await chromium.launch()
    result.environment.browser = browser.version()
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const mode of selectedModes) for (const tier of selectedTiers) {
      const topology = mode === 'vwan' ? fixture.vwanInteractiveTopology(tier) : fixture.mixedInteractiveTopology(tier)
      result.cases.push(await measureWorkload(browser, origin, mode, tier, topology, iterations))
    }
  } finally {
    await browser?.close()
    await loader?.close()
    server.closeAllConnections()
    await new Promise(accept => server.close(accept))
  }
  result.environment.availableMemoryAfter = freemem()
  result.sourceChangedDuringRun = JSON.stringify(before) !== JSON.stringify(await sourceIdentity())
  await mkdir(dirname(values.output), { recursive: true })
  await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`)
  assert.equal(result.sourceChangedDuringRun, false, 'Source changed during measurements')
  assert.ok(result.cases.every(item => item.status === 'measured'), 'Unassessed cases remain explicit; this is not a complete responsiveness baseline')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
