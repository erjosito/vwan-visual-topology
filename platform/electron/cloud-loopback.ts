import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

export async function cloudLoopback(signal: AbortSignal, timeout = 120_000) {
  signal.throwIfAborted()
  const state = randomBytes(32).toString('base64url')
  let accept!: (code: string) => void, reject!: (error: Error) => void
  const code = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail })
  void code.catch(() => {})
  let host = '', finished = false
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    response.setHeader('Referrer-Policy', 'no-referrer')
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://localhost') }
    catch { response.writeHead(400).end('Invalid sign-in callback.'); return }
    if (finished || request.method !== 'GET' || request.headers.host !== host || url.pathname !== '/'
      || (request.url?.length ?? 0) > 8192 || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid sign-in callback.')
      return
    }
    const value = url.searchParams.get('code')
    const valid = value && value.length <= 4096 && url.searchParams.getAll('code').length === 1 && !url.searchParams.has('error')
    response.end(valid ? 'Sign-in received. You can close this tab and return to Azure Network Simulator.'
      : 'Sign-in was not completed. Return to Azure Network Simulator to retry.')
    finish(valid ? undefined : new Error('Sign-in was not completed.'), valid ? value : undefined)
  })
  server.maxConnections = 4
  server.keepAliveTimeout = 1000
  const finish = (error?: Error, value?: string) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    server.close()
    server.closeAllConnections()
    if (value) accept(value)
    else reject(error ?? new Error('Sign-in cancelled.'))
  }
  const cancel = () => finish(new Error('Sign-in cancelled.'))
  const timer = setTimeout(() => finish(new Error('Sign-in timed out.')), timeout)
  timer.unref()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await new Promise<void>((resolve, fail) => {
      server.once('error', fail)
      server.listen(0, '127.0.0.1', resolve)
    })
    signal.throwIfAborted()
    if (finished) throw new Error('Sign-in cancelled.')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback listener unavailable.')
    host = `localhost:${address.port}`
    return { redirectUri: `http://${host}`, state, code, close: cancel }
  } catch (error) {
    cancel()
    server.close()
    server.closeAllConnections()
    throw error
  }
}
