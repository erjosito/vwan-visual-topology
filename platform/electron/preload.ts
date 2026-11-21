import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktopSimulator', Object.freeze({
  openTopology: () => ipcRenderer.invoke('desktop:open'),
  accounts: () => ipcRenderer.invoke('desktop:accounts'),
  targets: (scope: unknown) => ipcRenderer.invoke('desktop:targets', scope),
  collect: (request: unknown) => ipcRenderer.invoke('desktop:collect', request),
  simulate: (request: unknown) => ipcRenderer.invoke('desktop:simulate', request),
  openDocument: (request: unknown) => ipcRenderer.invoke('desktop:document-open', request),
  saveDocument: (request: unknown) => ipcRenderer.invoke('desktop:document-save', request),
  releaseDocument: (request: unknown) => ipcRenderer.invoke('desktop:document-release', request),
}))
