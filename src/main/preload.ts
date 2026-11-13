import { contextBridge, ipcRenderer } from 'electron'
import type { VassagoBridge } from '../shared/bridge'

const bridge: VassagoBridge = {
  session: {
    send: cmd => ipcRenderer.send('session:cmd', cmd),
    onEvent: cb => {
      const fn = (_e: unknown, ev: any) => cb(ev)
      ipcRenderer.on('session:event', fn)
      return () => { ipcRenderer.removeListener('session:event', fn) }
    }
  },
  ping: (host, port) => ipcRenderer.invoke('ping', host, port),
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: cfg => ipcRenderer.invoke('config:save', cfg)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    setFullscreen: on => ipcRenderer.invoke('app:fullscreen', on),
    onFullscreen: cb => {
      const fn = (_e: unknown, on: boolean) => cb(on)
      ipcRenderer.on('app:fullscreen-changed', fn)
      return () => { ipcRenderer.removeListener('app:fullscreen-changed', fn) }
    },
    openExternal: url => ipcRenderer.invoke('app:openExternal', url),
    exportDiagnostics: extra => ipcRenderer.invoke('app:diagnostics', extra),
    saveScreenshot: dataUrl => ipcRenderer.invoke('app:screenshot', dataUrl),
    log: (level, msg, data) => ipcRenderer.send('app:log', level, msg, data),
    signOut: username => ipcRenderer.invoke('app:signOut', username),
    quit: () => ipcRenderer.send('app:quit')
  }
}

contextBridge.exposeInMainWorld('vassago', bridge)
