import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, extname, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { AzureBroker, type Scope, type Collection } from './broker'
import { PlatformJobs } from '../jobs'
import { admitJson } from '../../src/platform/service'

// Local assets need no proxy; avoid Chromium's automatic PAC/WPAD discovery.
// The explicitly invoked Azure CLI keeps its independent enterprise proxy settings.
app.commandLine.appendSwitch('no-proxy-server')
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
app.setAppUserModelId('com.github.erjosito.aznet-simulator')
if (app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', resolve(app.commandLine.getSwitchValue('user-data-dir')))
const site = resolve(__dirname, '..', '..', 'dist')
const jobs = new PlatformJobs(app.isPackaged ? join(process.resourcesPath, 'platform', 'worker.cjs') : join(__dirname, '..', 'worker.cjs'))
const broker = new AzureBroker(app.isPackaged ? join(process.resourcesPath, 'desktop') : __dirname, app.isPackaged ? join(process.resourcesPath, 'collectors') : join(site, 'scripts'))
let window: BrowserWindow

const mime: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ps1': 'text/plain',
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  const url = new URL(event.senderFrame?.url ?? 'about:blank')
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || url.protocol !== 'app:' || url.hostname !== 'simulator' || url.pathname !== '/') throw new Error('Untrusted desktop IPC origin.')
}

void app.whenReady().then(async () => {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'simulator' || request.method !== 'GET') return new Response(null, { status: 403 })
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
      const file = resolve(site, relative)
      if (!file.startsWith(site + sep) || !mime[extname(file)]) return new Response(null, { status: 403 })
      const data = await readFile(file)
      const hashes = extname(file) === '.html' ? [...data.toString('utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ') : ''
      return new Response(data, { headers: {
        'Content-Type': mime[extname(file)],
        'Content-Security-Policy': `default-src 'self'; script-src 'self' ${hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`,
      } })
    } catch { return new Response(null, { status: 404 }) }
  })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(?:app:\/\/simulator(?:\/|$)|blob:|data:)/.test(details.url) })
  })
  session.defaultSession.on('will-download', (_event, item) => {
    if (!/^(?:app:\/\/simulator\/|blob:app:\/\/simulator\/|data:)/.test(item.getURL())) { item.cancel(); return }
    item.setSaveDialogOptions({ title: 'Save local simulator export', defaultPath: item.getFilename() })
  })
  window = new BrowserWindow({
    width: 1440, height: 1000, show: false,
    icon: join(site, 'desktop-icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('app://simulator/docs/')) {
      const documentation = new BrowserWindow({ width: 1100, height: 900, icon: join(site, 'desktop-icon.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } })
      documentation.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      documentation.webContents.on('will-navigate', (event, destination) => {
        if (!destination.startsWith('app://simulator/docs/')) event.preventDefault()
      })
      documentation.webContents.on('will-attach-webview', (event) => event.preventDefault())
      void documentation.loadURL(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://simulator/')) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  const handle = (name: string, action: (value: unknown) => unknown) => ipcMain.handle(name, async (event, value: unknown) => {
    trusted(event)
    try { return { ok: true, value: await action(value) } }
    catch { return { ok: false, error: 'Local operation failed. Check selected scope, existing CLI authentication, read permissions and input/size limits. No login, installation or Azure mutation was attempted.' } }
  })
  handle('desktop:open', async () => {
    const selected = await dialog.showOpenDialog(window, { title: 'Open local topology or capture', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (selected.canceled) return null
    const file = selected.filePaths[0]
    if (extname(file).toLowerCase() !== '.json' || (await stat(file)).size > 4_000_000) throw new Error('Only bounded JSON files are supported.')
    const content = await readFile(file, 'utf8')
    admitJson(JSON.parse(content.replace(/^\uFEFF/, '')))
    return { name: 'local-topology.json', content }
  })
  handle('desktop:accounts', () => broker.accounts())
  handle('desktop:targets', (scope) => broker.targets(scope as Scope))
  handle('desktop:collect', async (request) => {
    const approved = await dialog.showMessageBox(window, {
      type: 'question', buttons: ['Cancel', 'Collect read-only'], defaultId: 0, cancelId: 0,
      message: 'Read Azure networking configuration using your existing local CLI session?',
      detail: 'The explicitly selected public-Azure tenant/subscription and WAN/resource group will be read. No login or resource changes. The capture stays local and may contain sensitive network data. Review it before import.',
    })
    return approved.response === 1 ? broker.collect(request as Collection) : null
  })
  handle('desktop:simulate', (request) => jobs.run(request))
  await window.loadURL('app://simulator/')
})
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  jobs.close()
  void broker.close().finally(() => app.quit())
})
app.on('window-all-closed', () => app.quit())
