import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createProductionServer } from './production-server.mjs'

const topology = {
  version: 1, name: '1000-prefix star',
  hubs: [{ id: 'h', name: 'h', region: 'westeurope', preference: 'ASPath', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
  sites: [], connections: [], siteLinks: [],
  spokes: Array.from({ length: 40 }, (_, i) => ({
    id: `spoke-${i}`, name: `Spoke ${i}`, hubId: 'h',
    prefixes: [...Array.from({ length: 24 }, (_, j) => `10.${i + 1}.${j}.0/24`), `10.${i + 1}.24.0/21`],
  })),
}
const profile = {
  version: 1, failureAnalysis: false,
  intents: topology.spokes.slice(1).map((target, i) => ({
    id: target.id, source: { kind: 'spoke', id: 'spoke-0' }, target: { kind: 'spoke', id: target.id },
    sourcePrefix: '10.1.0.0/19', destinationPrefix: `10.${i + 2}.0.0/19`, expectation: 'allow',
  })),
}
const server = await createProductionServer({ root: process.env.PRODUCTION_ROOT || 'dist', port: 0 })
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = [], workers = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('worker', (worker) => workers.push(new URL(worker.url()).pathname))
  await page.addInitScript(({ profile }) => {
    localStorage.setItem('vwan-visual-topology:diagnostics:v1', JSON.stringify(profile))
    const post = Worker.prototype.postMessage
    window.diagnosticsWorkerInputs = []
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.topology) window.diagnosticsWorkerInputs.push({
        name: message.topology.name, spokes: message.topology.spokes.length,
        prefixes: message.topology.spokes.reduce((sum, spoke) => sum + spoke.prefixes.length, 0),
        firstSpoke: message.topology.spokes[0], firstIntent: message.profile.intents[0],
      })
      return post.call(this, message, ...rest)
    }
  }, { profile })
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=vwan`)
  await page.getByTestId('vwan-app').waitFor()
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: '1000-prefix-star.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
  })
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(topology.name).catch(async (error) => {
    console.error(await page.getByRole('alert').allTextContents())
    throw error
  })
  await page.getByRole('button', { name: 'Check routing', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced checks', exact: true }).click()
  await page.getByLabel('Import analysis profile file', { exact: true }).setInputFiles({
    name: 'star-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)),
  })
  await expect(page.locator('.routing-check-status')).toHaveCount(0)
  const panel = page.getByRole('dialog', { name: 'Routing diagnostics', exact: true })
  const run = panel.getByRole('button', { name: 'Run diagnostics', exact: true })
  const proceed = panel.getByRole('button', { name: 'Continue analysis', exact: true })
  const savedDesigns = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => !key.includes('diagnostics')).sort().map((key) => [key, localStorage.getItem(key)])))
  const original = await savedDesigns()
  await page.evaluate(() => {
    window.diagnosticsFrames = []
    let previous = performance.now()
    window.diagnosticsFrame = (now) => {
      window.diagnosticsFrames.push(now - previous)
      previous = now
      window.diagnosticsAnimation = requestAnimationFrame(window.diagnosticsFrame)
    }
    window.diagnosticsAnimation = requestAnimationFrame(window.diagnosticsFrame)
  })
  const started = performance.now()
  await run.click()
  let batches = 1
  for (;;) {
    await expect(run).toBeEnabled({ timeout: 60000 })
    if (!await proceed.isVisible()) break
    assert.ok(++batches < 1000, 'Worker continuation did not finish')
    await proceed.click()
  }
  const elapsedMillis = performance.now() - started
  const mountedFlowButtons = await panel.locator('[data-testid="vwan-affected-flows"] button').count()
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.diagnosticsAnimation)
    return window.diagnosticsFrames
  })
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export diagnostic report', exact: true }).click()
  const chunks = []
  for await (const chunk of await (await download).createReadStream()) chunks.push(chunk)
  const { report } = JSON.parse(Buffer.concat(chunks).toString())
  const inputs = await page.evaluate(() => window.diagnosticsWorkerInputs)
  assert.ok(inputs.length >= 2 && inputs.every((input) => input.spokes === 40 && input.prefixes === 1000))
  assert.equal(report.complete, true, JSON.stringify({ cells: report.cells, probes: report.probes, continuation: report.continuation, limitations: report.limitations, inputs }))
  assert.equal(report.cells, 24375)
  assert.equal(report.probes, 1950)
  assert.equal(report.continuation.status, 'complete')
  assert.equal(report.continuation.remainingCells, 0)
  assert.ok(batches > 1)
  assert.ok(frames.length > 1, 'Main-thread animation did not advance')
  await run.click()
  await expect(panel.getByRole('button', { name: 'Cancel analysis', exact: true })).toBeVisible()
  const cancelStarted = performance.now()
  await panel.getByRole('button', { name: 'Cancel analysis', exact: true }).click()
  await expect(run).toBeEnabled()
  await expect(panel).toContainText('Analysis cancelled; unassessed cases remain unverified.')
  const cancelMillis = performance.now() - cancelStarted
  assert.deepEqual(await savedDesigns(), original)
  assert.deepEqual(errors, [])
  assert.ok(workers.length >= 3 && workers.every((url) => /diagnostics-worker-/.test(url)))
  const result = {
    browser: browser.version(), workloadSha256: createHash('sha256').update(JSON.stringify({ topology, profile })).digest('hex'),
    reportSha256: createHash('sha256').update(JSON.stringify({ ...report, budget: undefined })).digest('hex'),
    elapsedMillis, batches, cells: report.cells, probes: report.probes, budget: report.budget,
    mountedFlowButtons,
    status: report.continuation.status, remainingCells: report.continuation.remainingCells,
    animationFrames: frames.length, maximumFrameGapMillis: Math.max(...frames), cancelMillis,
    qualification: 'Production app and actual worker, default 2048-cell/4096-probe/5000ms budgets. The SSR star uses a blank hub region; this native-importable variant supplies westeurope without changing routing scope. Includes continuation clicks, rendering and worker message copies. Frame gaps include report rendering; cancellation timing includes the browser action. Shared loopback environment, not a production latency guarantee.',
  }
  const output = `${JSON.stringify(result, null, 2)}\n`
  if (process.argv[2]) {
    await mkdir(dirname(process.argv[2]), { recursive: true })
    await writeFile(process.argv[2], output)
  }
  console.log(output)
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((accept) => server.close(accept))
}
