import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

export async function checkUserCloud(base, origin, fetcher = fetch) {
  const url = `${base.replace(/\/$/, '')}/topologies`
  const response = await fetcher(url, { headers: { Origin: origin }, redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (response.status !== 401 || response.headers.get('access-control-allow-origin') !== origin
    || !response.headers.get('www-authenticate')?.startsWith('Bearer') || !(await response.json()).error) {
    throw new Error('Cloud API authentication route or CORS is unavailable.')
  }
  const preflight = await fetcher(url, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'authorization,content-type,if-match,if-none-match',
  }, redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== origin
    || !preflight.headers.get('access-control-allow-methods')?.split(',').map(value => value.trim()).includes('PUT')
    || !['authorization', 'content-type', 'if-match', 'if-none-match'].every(header =>
      preflight.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map(value => value.trim()).includes(header))) {
    throw new Error('Cloud API write preflight is unavailable.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, origin] = process.argv.slice(2)
  if (!base || !origin) throw new Error('Usage: node scripts/check-user-cloud.mjs <API base URL> <allowed frontend origin>')
  for (let attempt = 1; ; attempt++) {
    try { await checkUserCloud(base, origin); break }
    catch (error) {
      if (attempt === 12) throw error
      await setTimeout(10000)
    }
  }
  console.log('Cloud authentication route and browser write preflight passed. Authenticated storage is not assessed.')
}
