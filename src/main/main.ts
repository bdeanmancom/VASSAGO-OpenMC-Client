/**
 * Electron main process: window lifecycle, the vassago:// app protocol, IPC,
 * the session worker thread, configuration, secure token storage, logging,
 * crash recovery and diagnostics export.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { ConfigStore } from './config-store'
import { Logger } from './logger'
import { SecureStore } from './secure-store'
import type { AppInfo } from '../shared/bridge'
import { VERIFIED_VERSIONS, type PingResult, type SessionCommand } from '../shared/protocol'
import { parseAddress } from '../shared/config'

const E2E = !!process.env.VASSAGO_E2E
if (process.env.VASSAGO_USER_DATA) app.setPath('userData', process.env.VASSAGO_USER_DATA)
if (process.env.VASSAGO_SOFTWARE_GL) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
}
app.setName('Vassago')

const ROOT = path.join(__dirname, '..', '..')
const RENDERER_DIR = path.join(ROOT, 'dist', 'renderer')
const GAMEDATA_DIR = path.join(ROOT, 'resources', 'gamedata')
const EXTERNAL_ALLOW = [/^https:\/\/(www\.)?microsoft\.com\//, /^https:\/\/login\.live\.com\//, /^https:\/\/login\.microsoftonline\.com\//, /^https:\/\/github\.com\//, /^https:\/\/aka\.ms\//]

protocol.registerSchemesAsPrivileged([
  { scheme: 'vassago', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

let win: BrowserWindow | null = null
let logger: Logger
let config: ConfigStore
let secure: SecureStore
let worker: Worker | null = null
let workerSeq = 1
const workerCalls = new Map<number, (v: any) => void>()
let recovered = false
let crashCount = 0

// ------------------------------------------------------------ session worker

function ensureWorker (): Worker {
  if (worker) return worker
  const w = new Worker(path.join(__dirname, '..', 'session', 'worker.js'))
  worker = w
  w.on('message', (msg: any) => {
    switch (msg.k) {
      case 'event':
        if (msg.ev.t === 'log') { logger.log(msg.ev.level, 'session', msg.ev.msg, msg.ev.data); return }
        if (msg.ev.t === 'disconnect') logger.log('info', 'session', `disconnected: ${msg.ev.reason}`)
        if (win && !win.isDestroyed()) win.webContents.send('session:event', msg.ev)
        break
      case 'secure': {
        let value: string | null = null
        try {
          if (msg.op === 'get') value = secure.get(msg.key)
          else secure.set(msg.key, msg.value)
        } catch (err) { logger.log('warn', 'secure-store', String(err)) }
        w.postMessage({ k: 'secureResult', id: msg.id, value })
        break
      }
      case 'pingResult':
      case 'versionsResult':
        workerCalls.get(msg.id)?.(msg.result)
        workerCalls.delete(msg.id)
        break
    }
  })
  w.on('error', err => logger.log('error', 'session', `worker error: ${err?.stack ?? err}`))
  w.on('exit', code => {
    if (worker === w) worker = null
    for (const [, resolve] of workerCalls) resolve(null)
    workerCalls.clear()
    if (code !== 0 && !quitting) {
      logger.log('error', 'session', `worker exited unexpectedly (code ${code})`)
      if (win && !win.isDestroyed()) {
        win.webContents.send('session:event', { t: 'disconnect', reason: 'The connection engine stopped unexpectedly. You can reconnect.', kicked: false, canReconnect: true })
        win.webContents.send('session:event', { t: 'phase', phase: 'disconnected' })
      }
    }
  })
  return w
}

function workerCall<T> (msg: Record<string, unknown>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const id = workerSeq++
    const timer = setTimeout(() => { workerCalls.delete(id); resolve(fallback) }, timeoutMs)
    workerCalls.set(id, v => { clearTimeout(timer); resolve(v ?? fallback) })
    ensureWorker().postMessage({ ...msg, id })
  })
}

// -------------------------------------------------------------------- window

function serveApp () {
  protocol.handle('vassago', async request => {
    try {
      const url = new URL(request.url)
      let rel = decodeURIComponent(url.pathname)
      if (rel === '/' || rel === '') rel = '/index.html'
      const base = rel.startsWith('/gamedata/') ? GAMEDATA_DIR : RENDERER_DIR
      if (rel.startsWith('/gamedata/')) rel = rel.slice('/gamedata'.length)
      const file = path.normalize(path.join(base, rel))
      if (!file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 })
      const res = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      // Cross-origin isolation enables SharedArrayBuffer for zero-copy chunk meshing.
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
      headers.set('Cross-Origin-Resource-Policy', 'same-origin')
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
      if (file.endsWith('.js') || file.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript')
      return new Response(res.body, { status: res.status, headers })
    } catch (err) {
      return new Response('Not found', { status: 404 })
    }
  })
}

function createWindow () {
  const cfg = config.load()
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0d14',
    show: false,
    title: 'Vassago',
    autoHideMenuBar: true,
    fullscreen: cfg.settings.fullscreen,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  const w = win
  w.once('ready-to-show', () => w.show())
  w.on('closed', () => { if (win === w) win = null })
  w.on('enter-full-screen', () => w.webContents.send('app:fullscreen-changed', true))
  w.on('leave-full-screen', () => w.webContents.send('app:fullscreen-changed', false))
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('vassago://app/')) e.preventDefault() })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_ALLOW.some(re => re.test(url))) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) logger.log(level >= 3 ? 'error' : 'warn', 'renderer-console', message)
  })
  // Crash recovery: drop the connection, reload the UI and tell the user what happened.
  w.webContents.on('render-process-gone', (_e, details) => {
    logger.log('error', 'main', `renderer process gone: ${details.reason} (exit ${details.exitCode})`)
    worker?.postMessage({ k: 'cmd', cmd: { t: 'disconnect' } })
    crashCount++
    if (details.reason !== 'clean-exit' && crashCount <= 3 && !w.isDestroyed()) {
      recovered = true
      void w.loadURL('vassago://app/index.html?recovered=1')
    }
  })
  w.on('unresponsive', () => logger.log('warn', 'main', 'window became unresponsive'))
  void w.loadURL('vassago://app/index.html')
}

// ----------------------------------------------------------------------- ipc

function registerIpc () {
  ipcMain.on('session:cmd', (_e, cmd: SessionCommand) => {
    if (!cmd || typeof cmd.t !== 'string') return
    if (cmd.t === 'connect') {
      const o = cmd.opts
      if (!o || !parseAddress(`${o.host}:${o.port}`) || typeof o.username !== 'string') return
      logger.log('info', 'main', `connect ${o.host}:${o.port} auth=${o.auth} version=${o.version ?? 'auto'}`)
    }
    ensureWorker().postMessage({ k: 'cmd', cmd })
  })
  ipcMain.handle('ping', async (_e, host: string, port: number): Promise<PingResult> => {
    if (!parseAddress(`${host}:${port}`)) return { online: false, error: 'Invalid address' }
    return await workerCall<PingResult>({ k: 'ping', host, port }, 9000, { online: false, error: 'Timed out' })
  })
  ipcMain.handle('config:load', () => config.load())
  ipcMain.handle('config:save', (_e, cfg) => { config.save(cfg) })
  ipcMain.handle('app:info', async (): Promise<AppInfo> => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    supportedVersions: await workerCall<string[]>({ k: 'versions' }, 15000, []),
    verifiedVersions: [...VERIFIED_VERSIONS],
    secureStorage: secure.available,
    userData: app.getPath('userData')
  }))
  ipcMain.handle('app:fullscreen', (_e, on: boolean) => { win?.setFullScreen(!!on) })
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && EXTERNAL_ALLOW.some(re => re.test(url))) await shell.openExternal(url)
  })
  ipcMain.handle('app:signOut', (_e, username: string) => { secure.forget(String(username)) })
  ipcMain.on('app:log', (_e, level, msg, data) => {
    if (['debug', 'info', 'warn', 'error'].includes(level)) logger.log(level, 'renderer', String(msg).slice(0, 4000), data)
  })
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.handle('app:screenshot', async (_e, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null
    const dir = path.join(app.getPath('pictures'), 'Vassago')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `vassago-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    fs.writeFileSync(file, Buffer.from(dataUrl.slice(22), 'base64'))
    return file
  })
  ipcMain.handle('app:diagnostics', async (_e, extra: unknown) => {
    const cfg = config.load()
    let gpu: unknown = null
    try { gpu = await app.getGPUInfo('basic') } catch {}
    const report = {
      generatedAt: new Date().toISOString(),
      app: { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      system: { platform: process.platform, arch: process.arch, release: os.release(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemMB: Math.round(os.totalmem() / 1048576), freeMemMB: Math.round(os.freemem() / 1048576) },
      gpu,
      gpuFeatures: app.getGPUFeatureStatus(),
      // Usernames and server addresses are included; account tokens never are.
      config: cfg,
      recoveredFromCrash: recovered,
      renderer: extra ?? null,
      log: logger.tail()
    }
    let file: string | undefined
    if (E2E) file = path.join(app.getPath('userData'), 'diagnostics.json')
    else {
      const res = await dialog.showSaveDialog(win!, { title: 'Export diagnostics', defaultPath: `vassago-diagnostics-${Date.now()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (res.canceled || !res.filePath) return null
      file = res.filePath
    }
    fs.writeFileSync(file, JSON.stringify(report, null, 2))
    return file
  })
}

// ----------------------------------------------------------------- lifecycle

let quitting = false
if (!E2E && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  process.on('uncaughtException', err => { try { logger?.log('error', 'main', `uncaught exception: ${err?.stack ?? err}`) } catch {} })
  process.on('unhandledRejection', err => { try { logger?.log('warn', 'main', `unhandled rejection: ${(err as any)?.stack ?? err}`) } catch {} })

  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    logger = new Logger(path.join(userData, 'logs'))
    config = new ConfigStore(userData)
    secure = new SecureStore(userData)
    logger.log('info', 'main', `Vassago ${app.getVersion()} starting`, { platform: process.platform, arch: process.arch, electron: process.versions.electron })
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    serveApp()
    registerIpc()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('before-quit', () => {
    quitting = true
    try { worker?.postMessage({ k: 'cmd', cmd: { t: 'disconnect' } }) } catch {}
  })
  app.on('window-all-closed', () => {
    quitting = true
    const w = worker
    worker = null
    setTimeout(() => { void w?.terminate() }, 150)
    if (process.platform !== 'darwin') app.quit()
  })
}
