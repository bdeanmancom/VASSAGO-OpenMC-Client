/** Persistent launcher configuration (stored as JSON in the user data directory). */
import type { AuthMode } from './protocol'

export interface Profile {
  id: string
  name: string
  username: string
  auth: AuthMode
}

export interface SavedServer {
  id: string
  name: string
  host: string
  port: number
  /** preferred profile id, optional */
  profileId?: string
  lastPlayed?: number
  /** set when the server last turned away a private-server name because it runs in online mode */
  requiresAccount?: boolean
}

export interface RecentConnection { host: string, port: number, name: string, at: number, profileId: string, version?: string }

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom'

export interface Settings {
  preset: GraphicsPreset
  renderDistance: number
  fov: number
  fpsLimit: number // 0 = unlimited (vsync)
  sensitivity: number
  smoothLighting: boolean
  clouds: boolean
  antialias: boolean
  mipmaps: boolean
  resolutionScale: number
  brightness: number
  viewBobbing: boolean
  fullscreen: boolean
  showFps: boolean
  guiScale: number
  invertY: boolean
  autoJump: boolean
  volume: number
  msaClientId: string
  acceptedOfflineWarning: boolean
}

export interface AppConfig {
  schema: 1
  profiles: Profile[]
  activeProfileId: string
  servers: SavedServer[]
  recents: RecentConnection[]
  settings: Settings
}

export const PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, Partial<Settings>> = {
  low: { renderDistance: 5, smoothLighting: false, clouds: false, antialias: false, mipmaps: false, resolutionScale: 0.75 },
  medium: { renderDistance: 8, smoothLighting: true, clouds: true, antialias: false, mipmaps: true, resolutionScale: 1 },
  high: { renderDistance: 12, smoothLighting: true, clouds: true, antialias: true, mipmaps: true, resolutionScale: 1 },
  ultra: { renderDistance: 16, smoothLighting: true, clouds: true, antialias: true, mipmaps: true, resolutionScale: 1 }
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'medium',
  renderDistance: 8,
  fov: 75,
  fpsLimit: 0,
  sensitivity: 1,
  smoothLighting: true,
  clouds: true,
  antialias: false,
  mipmaps: true,
  resolutionScale: 1,
  brightness: 0.5,
  viewBobbing: true,
  fullscreen: false,
  showFps: false,
  guiScale: 1,
  invertY: false,
  autoJump: false,
  volume: 0.6,
  msaClientId: '',
  acceptedOfflineWarning: false
}

export function defaultConfig (): AppConfig {
  return {
    schema: 1,
    profiles: [{ id: 'default', name: 'Player', username: 'Player', auth: 'offline' }],
    activeProfileId: 'default',
    servers: [],
    recents: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/
export function isValidUsername (name: string): boolean { return USERNAME_RE.test(name) }

/** Parse "host", "host:port", "[v6]:port". Returns null when invalid. */
export function parseAddress (input: string): { host: string, port: number } | null {
  const s = input.trim()
  if (!s || /\s/.test(s)) return null
  let host = s; let port = 25565
  const v6 = s.match(/^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/)
  if (v6) { host = v6[1]; if (v6[2]) port = Number(v6[2]); if (!isIPv6(host)) return null } else {
    const idx = s.lastIndexOf(':')
    if (idx > 0 && s.indexOf(':') === idx) { host = s.slice(0, idx); port = Number(s.slice(idx + 1)) } else if (idx >= 0 && !isIPv6(s)) return null
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) return null
  return { host, port }
}

function isIPv6 (s: string): boolean {
  if (!/^[0-9a-fA-F:]+$/.test(s)) return false
  const groups = s.split(':')
  const compressed = s.includes('::')
  if (s.split('::').length > 2) return false
  if (!compressed && groups.length !== 8) return false
  if (compressed && groups.length > 8) return false
  return groups.every(g => g.length <= 4)
}

/** Merge a loaded (possibly old/partial/corrupt) config with defaults. */
export function sanitizeConfig (raw: unknown): AppConfig {
  const def = defaultConfig()
  if (!raw || typeof raw !== 'object') return def
  const r = raw as Partial<AppConfig>
  const profiles = Array.isArray(r.profiles) ? r.profiles.filter(p => p && typeof p.id === 'string' && typeof p.username === 'string').map(p => ({
    id: p.id, name: String(p.name ?? p.username), username: p.username, auth: (p.auth === 'microsoft' ? 'microsoft' : 'offline') as AuthMode
  })) : []
  const servers = Array.isArray(r.servers) ? r.servers.filter(s => s && typeof s.host === 'string' && Number.isInteger(s.port)).map(s => ({
    id: String(s.id), name: String(s.name ?? s.host), host: s.host, port: s.port, profileId: s.profileId, lastPlayed: s.lastPlayed, ...(s.requiresAccount === true ? { requiresAccount: true } : {})
  })) : []
  const settings = { ...DEFAULT_SETTINGS }
  if (r.settings && typeof r.settings === 'object') {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = (r.settings as any)[k]
      if (typeof v === typeof DEFAULT_SETTINGS[k]) (settings as any)[k] = v
    }
  }
  settings.renderDistance = Math.min(32, Math.max(2, Math.round(settings.renderDistance)))
  settings.fov = Math.min(110, Math.max(30, settings.fov))
  settings.guiScale = Math.min(1.5, Math.max(0.75, settings.guiScale))
  settings.volume = Math.min(1, Math.max(0, settings.volume))
  settings.resolutionScale = Math.min(1, Math.max(0.5, settings.resolutionScale))
  const out: AppConfig = {
    schema: 1,
    profiles: profiles.length > 0 ? profiles : def.profiles,
    activeProfileId: typeof r.activeProfileId === 'string' ? r.activeProfileId : def.activeProfileId,
    servers,
    recents: Array.isArray(r.recents) ? r.recents.filter(x => x && typeof x.host === 'string').slice(0, 8) : [],
    settings
  }
  if (!out.profiles.some(p => p.id === out.activeProfileId)) out.activeProfileId = out.profiles[0].id
  return out
}
