import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.ps1': 'text/plain; charset=utf-8',
}
export const productionHosts = ['127.0.0.1', 'localhost', 'vwan-simulator.com', 'www.vwan-simulator.com', 'aznet-simulator.com', 'www.aznet-simulator.com']

function matches(pattern, pathname) {
  const expanded = pattern.replace(/\{([^}]+)\}/g, (_, values) => `(${values.split(',').join('|')})`)
  const regex = expanded.replace(/[.+?^$[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${regex}$`).test(pathname)
}

// Deliberately bounded to static SWA routing/headers, not auth, APIs or Azure transfer behavior.
export async function createProductionServer({ root = 'dist', port = 4174 } = {}) {
  const directory = resolve(root)
  const config = JSON.parse(await readFile(resolve(directory, 'staticwebapp.config.json'), 'utf8'))
  const server = createServer(async (request, response) => {
    const headers = { ...config.globalHeaders }
    try {
      const url = new URL(request.url, `http://${request.headers.host}`)
      if (!productionHosts.includes(url.hostname)) {
        response.writeHead(421, headers).end('Unrecognized test host')
        return
      }
      const pathname = decodeURIComponent(url.pathname)
      const route = config.routes?.find((item) => matches(item.route, pathname))
      Object.assign(headers, route?.headers)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end()
        return
      }
      let file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!file.startsWith(`${directory}${sep}`)) {
        response.writeHead(403, headers).end()
        return
      }
      const exists = await stat(file).then((value) => value.isFile()).catch(() => false)
      if (!exists) {
        if (config.navigationFallback && !config.navigationFallback.exclude?.some((pattern) => matches(pattern, pathname))) {
          file = resolve(directory, `.${config.navigationFallback.rewrite}`)
        } else {
          response.writeHead(404, headers).end()
          return
        }
      }
      const content = await readFile(file)
      headers['Content-Type'] = config.mimeTypes?.[extname(file)] || mimeTypes[extname(file)] || 'application/octet-stream'
      headers['Content-Length'] = content.length
      response.writeHead(200, headers).end(request.method === 'HEAD' ? undefined : content)
    } catch {
      response.writeHead(400, headers).end()
    }
  })
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', accept)
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createProductionServer({ port: Number(process.env.PRODUCTION_PORT || 4174) })
  console.log(`Built artifact listening on http://127.0.0.1:${server.address().port}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  })
}
