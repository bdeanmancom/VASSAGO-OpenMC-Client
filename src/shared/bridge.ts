/** API exposed to the renderer by the preload script (window.vassago). */
import type { AppConfig } from './config'
import type { PingResult, SessionCommand, SessionEvent } from './protocol'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  supportedVersions: string[]
  verifiedVersions: string[]
  /** newer server versions verified through the server's own translation layer */
  verifiedTranslated: { server: string, as: string }[]
  secureStorage: boolean
  userData: string
}

export interface VassagoBridge {
  session: {
    send: (cmd: SessionCommand) => void
    onEvent: (cb: (ev: SessionEvent) => void) => () => void
  }
  ping: (host: string, port: number) => Promise<PingResult>
  config: {
    load: () => Promise<AppConfig>
    save: (cfg: AppConfig) => Promise<void>
  }
  app: {
    info: () => Promise<AppInfo>
    setFullscreen: (on: boolean) => Promise<void>
    onFullscreen: (cb: (on: boolean) => void) => () => void
    openExternal: (url: string) => Promise<void>
    exportDiagnostics: (extra: unknown) => Promise<string | null>
    saveScreenshot: (dataUrl: string) => Promise<string | null>
    log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown) => void
    signOut: (username: string) => Promise<void>
    quit: () => void
  }
}

declare global {
  interface Window { vassago: VassagoBridge }
}
