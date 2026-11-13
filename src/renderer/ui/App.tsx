import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo } from '../../shared/bridge'
import { PRESETS, isValidUsername, type AppConfig, type Profile, type SavedServer, type Settings } from '../../shared/config'
import type { AuthMode, ConnectOptions, DisconnectKind, PingResult } from '../../shared/protocol'
import { Icon, Logo, Modal } from './components'
import { AboutPage, DirectPage, PlayPage, ProfilesPage, ServersPage, SettingsPage } from './pages'
import { GameView } from './GameView'

export type Route = 'play' | 'servers' | 'direct' | 'profiles' | 'settings' | 'about'
export interface Target { host: string, port: number, name: string }
export type PingMap = Record<string, PingResult | 'loading'>

const NAV: { id: Route, label: string, icon: string }[] = [
  { id: 'play', label: 'Play', icon: 'play' },
  { id: 'servers', label: 'Multiplayer Servers', icon: 'servers' },
  { id: 'direct', label: 'Direct Connect', icon: 'direct' },
  { id: 'profiles', label: 'Profiles', icon: 'profiles' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'about', label: 'About', icon: 'about' }
]

export const addrKey = (host: string, port: number) => `${host.toLowerCase()}:${port}`
export const addrLabel = (host: string, port: number) => port === 25565 ? host : `${host}:${port}`

export interface AppCtx {
  config: AppConfig
  update: (fn: (c: AppConfig) => AppConfig) => void
  setSettings: (patch: Partial<Settings>) => void
  info: AppInfo | null
  pings: PingMap
  ping: (host: string, port: number, force?: boolean) => void
  launch: (target: Target, profile?: Profile) => void
  navigate: (r: Route) => void
  toast: (msg: string) => void
  activeProfile: Profile
}

export function App () {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [route, setRoute] = useState<Route>('play')
  const [pings, setPings] = useState<PingMap>({})
  const [game, setGame] = useState<{ opts: ConnectOptions, target: Target, key: number, profileId: string } | null>(null)
  const [pendingOffline, setPendingOffline] = useState<{ target: Target, profile: Profile } | null>(null)
  const [toasts, setToasts] = useState<{ id: number, msg: string }[]>([])
  const pingTimes = useRef<Record<string, number>>({})
  const toastId = useRef(1)

  useEffect(() => {
    void window.vassago.config.load().then(setConfig)
    void window.vassago.app.info().then(setInfo)
    if (new URLSearchParams(location.search).has('recovered')) {
      setTimeout(() => toast('Vassago recovered from a rendering crash. Your settings are intact — export diagnostics from Settings if this keeps happening.'), 400)
    }
  }, [])

  const toast = useCallback((msg: string) => {
    const id = toastId.current++
    setToasts(t => [...t, { id, msg }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)
  }, [])

  const update = useCallback((fn: (c: AppConfig) => AppConfig) => {
    setConfig(prev => {
      if (!prev) return prev
      const next = fn(prev)
      void window.vassago.config.save(next)
      return next
    })
  }, [])

  const setSettings = useCallback((patch: Partial<Settings>) => {
    update(c => {
      const isPresetChange = 'preset' in patch && patch.preset !== 'custom'
      const presetKeys = Object.keys(PRESETS.medium)
      const touchesPreset = Object.keys(patch).some(k => presetKeys.includes(k))
      let settings = { ...c.settings, ...patch }
      if (isPresetChange) settings = { ...settings, ...PRESETS[patch.preset as keyof typeof PRESETS] }
      else if (touchesPreset) settings.preset = 'custom'
      return { ...c, settings }
    })
    if ('fullscreen' in patch) void window.vassago.app.setFullscreen(!!patch.fullscreen)
  }, [update])

  useEffect(() => window.vassago.app.onFullscreen(on => {
    setConfig(prev => prev && prev.settings.fullscreen !== on ? { ...prev, settings: { ...prev.settings, fullscreen: on } } : prev)
  }), [])

  const ping = useCallback((host: string, port: number, force = false) => {
    const k = addrKey(host, port)
    const now = Date.now()
    if (!force && now - (pingTimes.current[k] ?? 0) < 15000) return
    pingTimes.current[k] = now
    setPings(p => ({ ...p, [k]: p[k] && p[k] !== 'loading' && !force ? p[k] : 'loading' }))
    void window.vassago.ping(host, port).then(res => setPings(p => ({ ...p, [k]: res })))
  }, [])

  const activeProfile = useMemo(() => config?.profiles.find(p => p.id === config.activeProfileId) ?? config?.profiles[0], [config])

  const start = useCallback((target: Target, profile: Profile) => {
    if (!config) return
    const opts: ConnectOptions = {
      host: target.host,
      port: target.port,
      username: profile.username,
      auth: profile.auth,
      version: null,
      viewDistance: config.settings.renderDistance,
      msaClientId: config.settings.msaClientId || null
    }
    setGame({ opts, target, key: Date.now(), profileId: profile.id })
  }, [config])

  // Only servers the player actually got into are remembered.
  const recordJoin = useCallback((target: Target, profileId: string) => {
    update(c => ({
      ...c,
      recents: [{ host: target.host, port: target.port, name: target.name, at: Date.now(), profileId }, ...c.recents.filter(r => addrKey(r.host, r.port) !== addrKey(target.host, target.port))].slice(0, 6),
      // a successful join with a private-server profile proves the server no longer demands accounts
      servers: c.servers.map(s => addrKey(s.host, s.port) === addrKey(target.host, target.port)
        ? { ...s, lastPlayed: Date.now(), requiresAccount: c.profiles.find(p => p.id === profileId)?.auth === 'offline' ? false : s.requiresAccount }
        : s)
    }))
  }, [update])

  const launch = useCallback((target: Target, profile?: Profile) => {
    if (!config) return
    const p = profile ?? activeProfile
    if (!p) return
    if (p.auth === 'offline' && !isValidUsername(p.username)) { toast('This profile has an invalid username. Usernames are 3–16 letters, digits or underscores.'); setRoute('profiles'); return }
    if (p.auth === 'offline' && !config.settings.acceptedOfflineWarning) { setPendingOffline({ target, profile: p }); return }
    start(target, p)
  }, [config, activeProfile, start, toast])

  /** From a disconnect screen: connect to the same server again as a different kind of profile. */
  const retryAs = useCallback((mode: AuthMode, fresh = false) => {
    if (!config || !game) return
    const target = game.target
    let profile = activeProfile?.auth === mode ? activeProfile : config.profiles.find(p => p.auth === mode && (mode === 'microsoft' || isValidUsername(p.username)))
    if (!profile) {
      profile = mode === 'offline'
        ? { id: newId(), name: 'Player', username: 'Player', auth: 'offline' }
        : { id: newId(), name: 'Microsoft account', username: 'Microsoft account', auth: 'microsoft' }
    }
    const chosen = profile
    update(c => ({ ...c, profiles: c.profiles.some(p => p.id === chosen.id) ? c.profiles : [...c.profiles, chosen], activeProfileId: chosen.id }))
    const go = () => {
      setGame(null)
      if (chosen.auth === 'offline' && !config.settings.acceptedOfflineWarning) setPendingOffline({ target, profile: chosen })
      else start(target, chosen)
    }
    if (fresh && mode === 'microsoft') void window.vassago.app.signOut(chosen.username).then(go, go)
    else go()
  }, [config, game, activeProfile, update, start])

  /** Remember whether a server turned away unverified names, so the launcher can say so up front. */
  const recordOutcome = useCallback((target: Target, kind: DisconnectKind | undefined) => {
    if (kind !== 'auth-required') return
    update(c => c.servers.some(s => addrKey(s.host, s.port) === addrKey(target.host, target.port) && !s.requiresAccount)
      ? { ...c, servers: c.servers.map(s => addrKey(s.host, s.port) === addrKey(target.host, target.port) ? { ...s, requiresAccount: true } : s) }
      : c)
  }, [update])

  if (!config || !activeProfile) return <div className="boot"><Logo size={72} /><div className="boot-bar" /></div>

  const ctx: AppCtx = { config, update, setSettings, info, pings, ping, launch, navigate: setRoute, toast, activeProfile }

  return (
    <>
      {game
        ? <GameView
            key={game.key}
            opts={game.opts}
            target={game.target}
            settings={config.settings}
            setSettings={setSettings}
            onJoined={() => recordJoin(game.target, game.profileId)}
            onExit={() => setGame(null)}
            onReconnect={() => setGame(g => g ? { ...g, key: Date.now() } : g)}
            onRetryAs={retryAs}
            onOutcome={kind => recordOutcome(game.target, kind)}
          />
        : (
          <div className="shell">
            <aside className="sidebar">
              <div className="brand">
                <Logo size={38} />
                <div><div className="brand-name">VASSAGO</div><div className="brand-sub">Open voxel client</div></div>
              </div>
              <nav>
                {NAV.map(n => (
                  <button key={n.id} className={`nav-item ${route === n.id ? 'active' : ''}`} onClick={() => setRoute(n.id)} data-nav={n.id}>
                    <Icon name={n.icon} /><span>{n.label}</span>
                  </button>
                ))}
              </nav>
              <div className="sidebar-foot">
                <button className="profile-chip" onClick={() => setRoute('profiles')} title="Switch profile">
                  <span className="avatar" style={{ ['--h' as any]: hue(activeProfile.username) }}>{activeProfile.username.slice(0, 1).toUpperCase()}</span>
                  <span className="profile-chip-text">
                    <span className="profile-chip-name">{activeProfile.username}</span>
                    <span className="profile-chip-mode">{activeProfile.auth === 'microsoft' ? 'Microsoft account' : 'Private server profile'}</span>
                  </span>
                </button>
                <div className="version-tag">v{info?.version ?? '…'}</div>
              </div>
            </aside>
            <main className="content" key={route}>
              {route === 'play' && <PlayPage ctx={ctx} />}
              {route === 'servers' && <ServersPage ctx={ctx} />}
              {route === 'direct' && <DirectPage ctx={ctx} />}
              {route === 'profiles' && <ProfilesPage ctx={ctx} />}
              {route === 'settings' && <SettingsPage ctx={ctx} />}
              {route === 'about' && <AboutPage ctx={ctx} />}
            </main>
          </div>
          )}

      {pendingOffline && (
        <Modal
          title="Private server mode"
          onClose={() => setPendingOffline(null)}
          actions={<>
            <button className="btn ghost" onClick={() => setPendingOffline(null)}>Cancel</button>
            <button className="btn primary" data-testid="accept-offline" onClick={() => {
              const p = pendingOffline
              setPendingOffline(null)
              update(c => ({ ...c, settings: { ...c.settings, acceptedOfflineWarning: true } }))
              // config state updates asynchronously; start directly
              start(p.target, p.profile)
            }}>I understand, connect</button>
          </>}
        >
          <div className="notice warn"><Icon name="shield" size={22} /><div>
            <p><b>You are connecting as “{pendingOffline.profile.username}” without account verification.</b></p>
            <p>This only works on servers whose owner has deliberately enabled offline mode. On those servers nothing proves who you are — anyone can join using any name, including yours.</p>
          </div></div>
          <ul className="bullets">
            <li>Only use this for servers you run or trust (LAN, private or whitelisted communities).</li>
            <li>Server owners should protect identities with a login/auth plugin, an IP allow-list, or by placing the server behind a trusted authenticating proxy.</li>
            <li>Vassago never attempts to bypass authentication on servers that require a Microsoft account — use an Official Account profile for those.</li>
          </ul>
        </Modal>
      )}

      <div className="toasts">{toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}</div>
    </>
  )
}

export function hue (s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return 215 + (h % 80) }

export function newId (): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }

export type { SavedServer }
