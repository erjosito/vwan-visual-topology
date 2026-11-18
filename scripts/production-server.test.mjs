import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createProductionServer } from './production-server.mjs'
import { initialAssetGraph } from './production-assets.mjs'

const config = JSON.parse(await readFile('dist/staticwebapp.config.json', 'utf8'))
const server = await createProductionServer({ port: 0 })
const origin = `http://127.0.0.1:${server.address().port}`
const hostStatus = (host, forwarded) => new Promise((accept, reject) => {
  const pending = request(origin, { headers: { Host: host, ...(forwarded ? { 'X-Forwarded-Host': forwarded } : {}) } }, (response) => {
    response.resume()
    response.on('end', () => accept(response.statusCode))
  })
  pending.on('error', reject)
  pending.end()
})
after(async () => {
  server.closeAllConnections()
  await new Promise((accept) => server.close(accept))
})

test('built application and auth pages identify the canonical source version', async () => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  for (const page of ['index.html', 'auth-redirect.html']) {
    const html = await readFile(`dist/${page}`, 'utf8')
    assert.ok(html.includes(`<meta name="application-version" content="${version}">`), page)
  }
})

test('serves exact dist bytes, SWA headers, asset caching and navigation exclusions', async () => {
  const response = await fetch(origin)
  assert.equal(await response.text(), await readFile('dist/index.html', 'utf8'))
  for (const [name, value] of Object.entries(config.globalHeaders)) assert.equal(response.headers.get(name), value)
  const html = await readFile('dist/index.html', 'utf8')
  const entry = html.match(/type="module"[^>]*src="([^"]+)"/)[1]
  const asset = await fetch(new URL(entry, origin))
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.match(asset.headers.get('content-type'), /^text\/javascript/)
  assert.equal((await fetch(`${origin}/workspace`)).status, 200)
  for (const path of ['/api/missing', '/.auth/missing', '/assets/missing.js', '/docs/missing', '/scripts/missing', '/missing.json', '/missing.png']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path)
  }
  const head = await fetch(`${origin}/theme-bootstrap.js`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.ok(Number(head.headers.get('content-length')) > 0)
})

test('only maps explicit test hosts and never exposes files outside dist', async () => {
  for (const host of ['vwan-simulator.com', 'www.vwan-simulator.com', 'aznet-simulator.com', 'www.aznet-simulator.com']) {
    assert.equal(await hostStatus(host), 200)
  }
  assert.equal(await hostStatus('aznet-simulator.com.evil.invalid'), 421)
  assert.equal(await hostStatus('evil.invalid', 'aznet-simulator.com'), 421)
  assert.equal((await fetch(`${origin}/..%2fpackage.json`)).status, 403)
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405)
})

test('entry graph retains the measured local gzip budget without eagerly referencing workspaces or GIF encoding', async () => {
  const graph = await initialAssetGraph()
  assert.ok(graph.localGzipBytes <= 130_000, `Entry graph: ${graph.localGzipBytes} local gzip bytes`)
  assert.ok(!graph.files.some(({ path }) => /\/(?:App|AzureNetApp)-/.test(path)))
  assert.ok(!graph.files.some(({ path }) => /\/flow-gif-codec-/.test(path)))
  assert.ok(!graph.files.some(({ path }) => /\/japanese-catalog-/.test(path)))
})
