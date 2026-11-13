import { useEffect, useMemo, useState } from 'react'
import { fallbackProfile, isValidUsername, parseAddress, type AppConfig, type GraphicsPreset, type Profile, type SavedServer } from '../../shared/config'
import type { PingResult } from '../../shared/protocol'
import { addrKey, addrLabel, hue, newId, type AppCtx, type Target } from './App'
import { Icon, Logo, Modal, MotdText, PingBars, Segmented, Slider, Toggle, stripMotd } from './components'

function VersionBadge ({ ping }: { ping: PingResult | 'loading' | undefined }) {
  if (!ping || ping === 'loading') return <span className="badge muted">…</span>
  if (!ping.online) return <span className="badge danger">Offline</span>
  if (!ping.supported) return <span className="badge danger" title={`Protocol ${ping.protocol} is not supported by this build`}>{cleanVersion(ping.versionName)} · unsupported</span>
  // A server that says it runs another version than the one we speak is translating for us (ViaVersion/ViaBackwards).
  const label = ping.serverVersion ? `${ping.serverVersion} · joins as ${ping.resolvedVersion}` : ping.resolvedVersion
  const via = ping.serverVersion ? ` The server reports version ${ping.serverVersion} and translates between versions; Vassago connects as ${ping.resolvedVersion}.` : ''
  if (ping.verified) return <span className="badge ok" title={`This combination passes Vassago's integration test suite.${via}`}>{label} · verified</span>
  return <span className="badge warn" title={`Supported by the protocol library but not yet verified by Vassago's integration tests.${via}`}>{label} · experimental</span>
}

function cleanVersion (v?: string) { return (v ?? 'unknown').replace(/§./g, '').slice(0, 24) }

function timeAgo (t: number): string {
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

function ServerIcon ({ ping, name }: { ping: PingResult | 'loading' | undefined, name: string }) {
  const fav = ping && ping !== 'loading' ? ping.favicon : undefined
  if (fav) return <img className="server-icon" src={fav} alt="" />
  return <div className="server-icon placeholder" style={{ ['--h' as any]: hue(name) }}>{name.slice(0, 1).toUpperCase()}</div>
}

// ---------------------------------------------------------------------- Play

export function PlayPage ({ ctx }: { ctx: AppCtx }) {
  const { config, pings, ping, launch, navigate, activeProfile } = ctx
  const last = config.recents[0]
  const featured: Target | null = last ? { host: last.host, port: last.port, name: last.name } : config.servers[0] ? { host: config.servers[0].host, port: config.servers[0].port, name: config.servers[0].name } : null
  useEffect(() => {
    if (featured) ping(featured.host, featured.port)
    config.recents.forEach(r => ping(r.host, r.port))
    const t = setInterval(() => { if (featured) ping(featured.host, featured.port, true) }, 20000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featured?.host, featured?.port])
  const fp = featured ? pings[addrKey(featured.host, featured.port)] : undefined
  // A server joined with a non-default profile remembers that choice; everything else follows the default.
  const pinned = (id: string | undefined) => id ? config.profiles.find(x => x.id === id) : undefined
  const featuredProfile = (last && pinned(last.pinnedProfileId)) || activeProfile
  const modeLabel = (auth: string) => auth === 'microsoft' ? 'Microsoft account' : 'private-server profile'

  return (
    <div className="page play-page">
      <section className="hero">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="hero-inner">
          <div className="eyebrow">Welcome back, {activeProfile.username}</div>
          <h1>{featured ? 'Jump back in' : 'Find your world'}</h1>
          {featured
            ? (
              <div className="hero-server">
                <ServerIcon ping={fp} name={featured.name} />
                <div className="hero-server-text">
                  <div className="hero-server-name">{featured.name}</div>
                  <div className="hero-server-meta">
                    <span>{addrLabel(featured.host, featured.port)}</span>
                    <PingBars ping={fp} />
                    {fp && fp !== 'loading' && fp.online && <span>{fp.latency} ms · {fp.playersOnline ?? 0}/{fp.playersMax ?? 0} players</span>}
                    <VersionBadge ping={fp} />
                  </div>
                  {fp && fp !== 'loading' && fp.online && fp.motd && <div className="hero-motd"><MotdText text={fp.motd.split('\n').slice(0, 2).join(' ')} /></div>}
                </div>
              </div>
              )
            : <p className="hero-lead">Add a server or connect directly to start playing. Vassago speaks the Java Edition protocol with its own engine and original art — no game installation required.</p>}
          <div className="hero-actions">
            {featured
              ? <button className="btn primary big" data-testid="play-featured" onClick={() => launch(featured, featuredProfile)}><Icon name="play" size={20} />Play</button>
              : <button className="btn primary big" onClick={() => navigate('direct')}><Icon name="direct" size={20} />Direct Connect</button>}
            <button className="btn big" onClick={() => navigate('servers')}><Icon name="servers" size={20} />Browse servers</button>
          </div>
          {featured && <div className="hero-identity" data-testid="play-identity">Joins as <b>{featuredProfile.username}</b> · {modeLabel(featuredProfile.auth)} · <button className="link" onClick={() => navigate('profiles')}>change</button></div>}
        </div>
      </section>

      <section>
        <h3 className="section-title"><Icon name="clock" size={16} />Recent connections</h3>
        {config.recents.length === 0
          ? <div className="empty">Servers you join will appear here for one-click access.</div>
          : (
            <div className="recent-grid">
              {config.recents.map(r => {
                const p = pings[addrKey(r.host, r.port)]
                const as = pinned(r.pinnedProfileId)
                return (
                  <button key={addrKey(r.host, r.port)} className="recent-card" onClick={() => launch({ host: r.host, port: r.port, name: r.name }, as)}>
                    <ServerIcon ping={p} name={r.name} />
                    <span className="recent-text">
                      <span className="recent-name">{r.name}</span>
                      <span className="recent-meta">{addrLabel(r.host, r.port)} · {timeAgo(r.at)}{as && as.id !== activeProfile.id ? ` · as ${as.username}` : ''}</span>
                    </span>
                    <PingBars ping={p} />
                  </button>
                )
              })}
            </div>
            )}
      </section>
    </div>
  )
}

// ------------------------------------------------------------------- Servers

function ServerEditor ({ initial, onSave, onClose }: { initial: SavedServer | null, onSave: (s: SavedServer) => void, onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [address, setAddress] = useState(initial ? addrLabel(initial.host, initial.port) : '')
  const parsed = parseAddress(address)
  const [probe, setProbe] = useState<PingResult | 'loading' | undefined>()
  useEffect(() => {
    if (!parsed) { setProbe(undefined); return }
    setProbe('loading')
    let live = true
    const t = setTimeout(() => { void window.vassago.ping(parsed.host, parsed.port).then(r => { if (live) setProbe(r) }) }, 500)
    return () => { live = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])
  const save = () => {
    if (!parsed) return
    // keep what is known about the server unless it now points somewhere else
    const same = initial && initial.host === parsed.host && initial.port === parsed.port
    onSave({ ...(same ? initial : {}), id: initial?.id ?? newId(), name: name.trim() || parsed.host, host: parsed.host, port: parsed.port })
  }
  return (
    <Modal
      title={initial ? 'Edit server' : 'Add server'} onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" data-testid="save-server" disabled={!parsed} onClick={save}>{initial ? 'Save' : 'Add server'}</button></>}
    >
      <label className="field"><span>Server name</span><input autoFocus data-testid="server-name" value={name} onChange={e => setName(e.target.value)} placeholder="My private server" maxLength={48} /></label>
      <label className="field"><span>Address</span><input data-testid="server-address" value={address} onChange={e => setAddress(e.target.value)} placeholder="play.example.net or 192.168.1.20:25565" spellCheck={false} onKeyDown={e => { if (e.key === 'Enter') save() }} /></label>
      <div className="probe">
        {!address ? <span className="muted">Port 25565 is used when none is given.</span>
          : !parsed ? <span className="danger-text">That doesn’t look like a valid address.</span>
            : probe === 'loading' || !probe ? <><PingBars ping="loading" /><span className="muted">Checking server…</span></>
              : probe.online ? <><PingBars ping={probe} /><span>{probe.latency} ms · {probe.playersOnline}/{probe.playersMax} players</span><VersionBadge ping={probe} /></>
                : <><PingBars ping={probe} /><span className="muted">No response — you can still save it.</span></>}
      </div>
    </Modal>
  )
}

export function ServersPage ({ ctx }: { ctx: AppCtx }) {
  const { config, update, pings, ping, launch } = ctx
  const [editing, setEditing] = useState<SavedServer | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SavedServer | null>(null)
  useEffect(() => { config.servers.forEach(s => ping(s.host, s.port)) }, [config.servers, ping])
  const refresh = () => config.servers.forEach(s => ping(s.host, s.port, true))
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Multiplayer Servers</h1><p className="sub">Your saved Java Edition-compatible servers.</p></div>
        <div className="head-actions">
          <button className="btn" onClick={refresh}><Icon name="refresh" />Refresh</button>
          <button className="btn primary" data-testid="add-server" onClick={() => setEditing('new')}><Icon name="plus" />Add server</button>
        </div>
      </header>
      {config.servers.length === 0
        ? (
          <div className="empty big">
            <Icon name="servers" size={34} />
            <h3>No servers yet</h3>
            <p>Add a server by its address to see its status, player count and version here.</p>
            <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add your first server</button>
          </div>
          )
        : (
          <div className="server-list">
            {config.servers.map(s => {
              const p = pings[addrKey(s.host, s.port)]
              const online = p && p !== 'loading' && p.online
              return (
                <div key={s.id} className="server-card" data-testid="server-card">
                  <ServerIcon ping={p} name={s.name} />
                  <div className="server-main">
                    <div className="server-title"><span className="server-name">{s.name}</span><VersionBadge ping={p} />{s.requiresAccount && <span className="badge warn" data-testid="requires-account" title="Last time, this server refused a private-server name because it runs in online mode. It needs a Microsoft account that owns the game — or, if it is your server, online mode turned off.">verified accounts only</span>}</div>
                    <div className="server-motd">{online && p.motd ? <MotdText text={p.motd.split('\n').slice(0, 2).join('  ')} /> : <span className="muted">{p === 'loading' || !p ? 'Pinging…' : `Can’t reach server${p.error ? ` (${p.error})` : ''}`}</span>}</div>
                    <div className="server-addr">{addrLabel(s.host, s.port)}{s.lastPlayed ? ` · played ${timeAgo(s.lastPlayed)}` : ''}</div>
                  </div>
                  <div className="server-stats">
                    <div className="server-ping"><PingBars ping={p} />{online && <span>{p.latency} ms</span>}</div>
                    {online && <div className="server-players">{p.playersOnline ?? 0}<span>/{p.playersMax ?? 0}</span></div>}
                  </div>
                  <div className="server-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setEditing(s)}><Icon name="edit" /></button>
                    <button className="icon-btn" title="Remove" onClick={() => setConfirmDelete(s)}><Icon name="trash" /></button>
                    <button className="btn primary" data-testid="join-server" onClick={() => launch({ host: s.host, port: s.port, name: s.name })}><Icon name="play" />Join</button>
                  </div>
                </div>
              )
            })}
          </div>
          )}
      {editing && (
        <ServerEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={s => {
            update(c => ({ ...c, servers: c.servers.some(x => x.id === s.id) ? c.servers.map(x => x.id === s.id ? s : x) : [...c.servers, s] }))
            ping(s.host, s.port, true)
            setEditing(null)
          }}
        />
      )}
      {confirmDelete && (
        <Modal
          title="Remove server?" onClose={() => setConfirmDelete(null)}
          actions={<><button className="btn ghost" onClick={() => setConfirmDelete(null)}>Keep</button><button className="btn danger" onClick={() => { update(c => ({ ...c, servers: c.servers.filter(x => x.id !== confirmDelete.id) })); setConfirmDelete(null) }}>Remove</button></>}
        >
          <p>“{confirmDelete.name}” will be removed from your list. This doesn’t affect the server itself.</p>
        </Modal>
      )}
    </div>
  )
}

// ------------------------------------------------------------ Direct connect

export function DirectPage ({ ctx }: { ctx: AppCtx }) {
  const { config, update, launch, toast } = ctx
  const [address, setAddress] = useState('')
  const [profileId, setProfileId] = useState(config.activeProfileId)
  const [save, setSave] = useState(false)
  const [probe, setProbe] = useState<PingResult | 'loading' | undefined>()
  const parsed = parseAddress(address)
  useEffect(() => {
    if (!parsed) { setProbe(undefined); return }
    setProbe('loading')
    let live = true
    const t = setTimeout(() => { void window.vassago.ping(parsed.host, parsed.port).then(r => { if (live) setProbe(r) }) }, 450)
    return () => { live = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])
  const profile = config.profiles.find(p => p.id === profileId) ?? ctx.activeProfile
  const go = () => {
    if (!parsed) return
    if (save && !config.servers.some(s => addrKey(s.host, s.port) === addrKey(parsed.host, parsed.port))) {
      update(c => ({ ...c, servers: [...c.servers, { id: newId(), name: parsed.host, host: parsed.host, port: parsed.port }] }))
      toast('Saved to your server list.')
    }
    launch({ host: parsed.host, port: parsed.port, name: parsed.host }, profile)
  }
  const online = probe && probe !== 'loading' && probe.online
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Direct Connect</h1><p className="sub">Join a server by address without saving it.</p></div></header>
      <div className="card form-card">
        <label className="field"><span>Server address</span>
          <input autoFocus data-testid="direct-address" className="big-input" value={address} onChange={e => setAddress(e.target.value)} placeholder="hostname or IP — e.g. 192.168.1.20:25565" spellCheck={false} onKeyDown={e => { if (e.key === 'Enter') go() }} />
        </label>
        <div className="probe">
          {!address ? <span className="muted">Port 25565 is assumed when you leave it out.</span>
            : !parsed ? <span className="danger-text">Enter a hostname or IP address, optionally followed by :port.</span>
              : probe === 'loading' || !probe ? <><PingBars ping="loading" /><span className="muted">Looking for the server…</span></>
                : online ? <><PingBars ping={probe} /><span>{probe.latency} ms · {probe.playersOnline}/{probe.playersMax} players</span><VersionBadge ping={probe} /><span className="probe-motd"><MotdText text={(probe.motd ?? '').split('\n')[0]} /></span></>
                  : <><PingBars ping={probe} /><span className="muted">No response{probe.error ? ` (${probe.error})` : ''}. Check the address, or try connecting anyway.</span></>}
        </div>
        <label className="field"><span>Play as</span>
          <div className="profile-pick">
            {config.profiles.map(p => (
              <button key={p.id} type="button" className={`profile-option ${p.id === profile.id ? 'active' : ''}`} onClick={() => setProfileId(p.id)}>
                <span className="avatar sm" style={{ ['--h' as any]: hue(p.username) }}>{p.username.slice(0, 1).toUpperCase()}</span>
                <span><b>{p.username}</b><small>{p.auth === 'microsoft' ? 'Microsoft account' : 'Private server (offline)'}</small></span>
              </button>
            ))}
          </div>
        </label>
        <div className="form-foot">
          <label className="check"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} /><span>Save to my server list</span></label>
          <button className="btn primary big" data-testid="direct-connect" disabled={!parsed} onClick={go}><Icon name="arrow" size={20} />Connect</button>
        </div>
      </div>
      {online && probe.supported === false && <div className="notice warn"><Icon name="warn" size={20} /><div>This server reports <b>{cleanVersion(probe.versionName)}</b> (protocol {probe.protocol}), which this build can’t speak yet. Connecting will fail with a clear message.</div></div>}
    </div>
  )
}

// ------------------------------------------------------------------ Profiles

/**
 * Choosing a default profile is the player saying "this is who I play as now", so servers that
 * remembered a different profile from an earlier join follow the new default again.
 */
function makeDefault (c: AppConfig, id: string): AppConfig {
  return { ...c, activeProfileId: id, recents: c.recents.map(({ pinnedProfileId, ...r }) => r) }
}

export function ProfilesPage ({ ctx }: { ctx: AppCtx }) {
  const { config, update, info, toast } = ctx
  const [adding, setAdding] = useState<'offline' | 'microsoft' | null>(null)
  const [renaming, setRenaming] = useState<Profile | null>(null)
  const [username, setUsername] = useState('')
  const mode = renaming?.auth ?? adding
  const taken = mode === 'offline' && config.profiles.some(p => p.auth === 'offline' && p.id !== renaming?.id && p.username.toLowerCase() === username.trim().toLowerCase())
  const valid = (mode === 'microsoft' ? username.trim().length >= 3 : isValidUsername(username)) && !taken
  const close = () => { setAdding(null); setRenaming(null); setUsername('') }
  const save = () => {
    if (!mode || !valid) return
    const name = username.trim()
    if (renaming) {
      update(c => ({ ...c, profiles: c.profiles.map(p => p.id === renaming.id ? { ...p, name, username: name } : p) }))
    } else {
      const p: Profile = { id: newId(), name, username: name, auth: mode }
      // A new private-server name becomes the default. A Microsoft account is only used where it is
      // asked for, unless the player makes it the default themselves.
      update(c => p.auth === 'offline' ? makeDefault({ ...c, profiles: [...c.profiles, p] }, p.id) : { ...c, profiles: [...c.profiles, p] })
    }
    close()
  }
  const remove = (p: Profile) => {
    if (config.profiles.length <= 1) { toast('Keep at least one profile.'); return }
    if (p.auth === 'microsoft') void window.vassago.app.signOut(p.username)
    update(c => {
      const profiles = c.profiles.filter(x => x.id !== p.id)
      return c.activeProfileId === p.id ? makeDefault({ ...c, profiles }, fallbackProfile(profiles).id) : { ...c, profiles }
    })
  }
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Profiles</h1><p className="sub">Who you play as. For your own or a friend’s offline-mode server, a private-server name is all you need.</p></div>
        <div className="head-actions">
          <button className="btn primary" data-testid="add-offline" onClick={() => { setAdding('offline'); setUsername('') }}><Icon name="plus" />New private-server name</button>
          <button className="btn" data-testid="add-microsoft" onClick={() => { setAdding('microsoft'); setUsername('') }}><Icon name="ms" />Add a Microsoft account</button>
        </div>
      </header>
      <div className="profile-list">
        {config.profiles.map(p => (
          <div key={p.id} className={`profile-card ${p.id === config.activeProfileId ? 'active' : ''}`} data-testid="profile-card">
            <span className="avatar lg" style={{ ['--h' as any]: hue(p.username) }}>{p.username.slice(0, 1).toUpperCase()}</span>
            <div className="profile-card-text">
              <div className="profile-card-name">{p.username}</div>
              <div className="profile-card-mode">{p.auth === 'microsoft'
                ? <><Icon name="ms" size={13} /> Microsoft account · signs in with Microsoft when you connect</>
                : <><Icon name="user" size={13} /> Private-server name · no account verification</>}</div>
            </div>
            {p.id === config.activeProfileId
              ? <span className="badge ok"><Icon name="check" size={12} /> Default</span>
              : <button className="btn" data-testid="use-profile" onClick={() => update(c => makeDefault(c, p.id))}>Make default</button>}
            {p.auth === 'offline' && <button className="icon-btn" data-testid="rename-profile" title="Change name" onClick={() => { setRenaming(p); setUsername(p.username) }}><Icon name="edit" /></button>}
            <button className="icon-btn" title={p.auth === 'microsoft' ? 'Sign out and remove' : 'Remove'} onClick={() => remove(p)}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
      <div className="two-col">
        <div className="notice"><Icon name="shield" size={20} /><div>
          <b>Private-server names</b>
          <p>Pick any name and join servers that have explicitly turned off account verification (offline mode). On a whitelisted server the name has to match the whitelist exactly. Names aren’t protected there — owners should add a login plugin, allow-list or an authenticating proxy. Vassago will not try to get around verification on servers that require it.</p>
        </div></div>
        <div className="notice"><Icon name="ms" size={20} /><div>
          <b>Microsoft accounts</b>
          <p>Only needed for servers that verify accounts (online mode). Uses Microsoft’s device-code sign-in: you enter a short code on microsoft.com in your own browser. Vassago never sees your password. Game ownership is checked by Microsoft/Mojang services, and tokens are {info?.secureStorage === false ? 'kept in memory only on this system (no OS keychain available)' : 'stored encrypted with your operating system’s keychain'}.</p>
        </div></div>
      </div>
      {mode && (
        <Modal
          title={renaming ? 'Change name' : mode === 'offline' ? 'New private-server name' : 'Add a Microsoft account'} onClose={close}
          actions={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" data-testid="save-profile" disabled={!valid} onClick={save}>{renaming ? 'Save' : 'Add profile'}</button></>}
        >
          {mode === 'offline'
            ? <>
              <label className="field"><span>Username</span><input autoFocus data-testid="profile-username" value={username} maxLength={16} onChange={e => setUsername(e.target.value)} placeholder="3–16 letters, digits or _" spellCheck={false} onKeyDown={e => { if (e.key === 'Enter') save() }} /></label>
              {username && !isValidUsername(username) && <p className="danger-text">Usernames must be 3–16 characters: letters, digits and underscores only.</p>}
              {taken && <p className="danger-text">You already have a profile with this name.</p>}
              {renaming && <p className="muted">On offline-mode servers your inventory, permissions and whitelist entry belong to the name, so a renamed profile arrives as a new player.</p>}
              </>
            : <>
              <label className="field"><span>Account e-mail or label</span><input autoFocus value={username} onChange={e => setUsername(e.target.value)} placeholder="you@example.com" spellCheck={false} onKeyDown={e => { if (e.key === 'Enter') save() }} /></label>
              <p className="muted">Used only to keep this account’s sign-in separate on this device. The first time you connect with it you’ll be shown a code to enter at microsoft.com/link. You only need this for servers that verify accounts.</p>
              </>}
        </Modal>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Settings

export function SettingsBody ({ ctx, inGame }: { ctx: Pick<AppCtx, 'config' | 'setSettings'>, inGame?: boolean }) {
  const s = ctx.config.settings
  const set = ctx.setSettings
  const [tab, setTab] = useState<'graphics' | 'controls' | 'general'>('graphics')
  return (
    <>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'graphics', label: 'Graphics' }, { value: 'controls', label: 'Controls' }, { value: 'general', label: 'General' }]} />
      {tab === 'graphics' && (
        <div className="card settings-card">
          <div className="row"><span className="row-text"><span className="row-label">Quality preset</span><span className="row-hint">Changes several options at once.</span></span>
            <Segmented<GraphicsPreset> value={s.preset} onChange={v => set({ preset: v })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }, ...(s.preset === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : [])]} />
          </div>
          <Slider label="Render distance" hint="How far terrain is drawn, in chunks. The server may send less." value={s.renderDistance} min={2} max={32} onChange={v => set({ renderDistance: v })} format={v => `${v} chunks`} />
          <Slider label="Field of view" value={s.fov} min={50} max={110} onChange={v => set({ fov: v })} format={v => `${v}°`} />
          <Slider label="Frame-rate limit" hint="Unlimited follows your display’s refresh rate." value={s.fpsLimit === 0 ? 250 : s.fpsLimit} min={30} max={250} step={10} onChange={v => set({ fpsLimit: v >= 250 ? 0 : v })} format={v => v >= 250 ? 'Unlimited' : `${v} fps`} />
          <Slider label="Brightness" value={Math.round(s.brightness * 100)} min={0} max={100} onChange={v => set({ brightness: v / 100 })} format={v => `${v}%`} />
          <Slider label="Resolution scale" hint="Lower values render fewer pixels for more speed." value={Math.round(s.resolutionScale * 100)} min={50} max={100} step={5} onChange={v => set({ resolutionScale: v / 100 })} format={v => `${v}%`} />
          <Slider label="HUD scale" value={Math.round(s.guiScale * 100)} min={75} max={150} step={5} onChange={v => set({ guiScale: v / 100 })} format={v => `${v}%`} />
          <Toggle label="Smooth lighting" hint="Ambient occlusion and soft light gradients." value={s.smoothLighting} onChange={v => set({ smoothLighting: v })} />
          <Toggle label="Clouds" value={s.clouds} onChange={v => set({ clouds: v })} />
          <Toggle label="Anti-aliasing" hint={inGame ? 'Applies the next time you join a world.' : undefined} value={s.antialias} onChange={v => set({ antialias: v })} />
          <Toggle label="Mipmaps" hint={inGame ? 'Applies the next time you join a world.' : 'Reduces shimmer on distant terrain.'} value={s.mipmaps} onChange={v => set({ mipmaps: v })} />
          <Toggle label="Fullscreen" hint="F11 toggles this at any time." value={s.fullscreen} onChange={v => set({ fullscreen: v })} />
        </div>
      )}
      {tab === 'controls' && (
        <div className="card settings-card">
          <Slider label="Mouse sensitivity" value={Math.round(s.sensitivity * 100)} min={10} max={300} step={5} onChange={v => set({ sensitivity: v / 100 })} format={v => `${v}%`} />
          <Toggle label="Invert vertical look" value={s.invertY} onChange={v => set({ invertY: v })} />
          <Toggle label="View bobbing" value={s.viewBobbing} onChange={v => set({ viewBobbing: v })} />
          <div className="keys">
            {[['W A S D', 'Move'], ['Space', 'Jump · double-tap to fly (creative)'], ['Shift', 'Sneak / descend'], ['Ctrl or double-tap W', 'Sprint'], ['Left mouse', 'Break / attack'], ['Right mouse', 'Place / use'],
              ['1–9 · wheel', 'Select hotbar slot'], ['E', 'Inventory'], ['Q', 'Drop item'], ['T · /', 'Chat · command'], ['Tab', 'Player list'], ['F1 · F2 · F3', 'Hide HUD · screenshot · debug overlay'], ['F11', 'Fullscreen'], ['Esc', 'Pause menu']]
              .map(([k, d]) => <div key={k} className="key-row"><kbd>{k}</kbd><span>{d}</span></div>)}
          </div>
        </div>
      )}
      {tab === 'general' && <GeneralSettings ctx={ctx} />}
    </>
  )
}

function GeneralSettings ({ ctx }: { ctx: Pick<AppCtx, 'config' | 'setSettings'> }) {
  const s = ctx.config.settings
  const [exported, setExported] = useState<string | null>(null)
  return (
    <div className="card settings-card">
      <Slider label="Sound volume" hint="Effects are synthesized by Vassago — original, not sampled." value={Math.round(s.volume * 100)} min={0} max={100} step={5} onChange={v => ctx.setSettings({ volume: v / 100 })} format={v => v === 0 ? 'Off' : `${v}%`} />
      <Toggle label="Show FPS counter" value={s.showFps} onChange={v => ctx.setSettings({ showFps: v })} />
      <label className="row"><span className="row-text"><span className="row-label">Microsoft application (client) ID</span><span className="row-hint">Optional. Use your own Azure app registration for sign-in; leave empty for the default flow.</span></span>
        <input className="inline-input" value={s.msaClientId} onChange={e => ctx.setSettings({ msaClientId: e.target.value.trim() })} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} />
      </label>
      <div className="row"><span className="row-text"><span className="row-label">Diagnostics</span><span className="row-hint">{exported ? `Saved to ${exported}` : 'Exports logs, settings and system/GPU details to a JSON file. Account tokens are never included. Nothing is sent anywhere.'}</span></span>
        <button className="btn" data-testid="export-diagnostics" onClick={() => { void window.vassago.app.exportDiagnostics({ userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, crossOriginIsolated: (window as any).crossOriginIsolated }).then(setExported) }}>Export diagnostics…</button>
      </div>
      <div className="row"><span className="row-text"><span className="row-label">Privacy</span><span className="row-hint">Vassago has no telemetry, analytics, ads or background services. It only talks to the servers you connect to and, for official accounts, Microsoft’s sign-in services.</span></span></div>
    </div>
  )
}

export function SettingsPage ({ ctx }: { ctx: AppCtx }) {
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Settings</h1><p className="sub">Changes are saved automatically.</p></div></header>
      <SettingsBody ctx={ctx} />
    </div>
  )
}

// --------------------------------------------------------------------- About

export function AboutPage ({ ctx }: { ctx: AppCtx }) {
  const info = ctx.info
  const versions = useMemo(() => info?.supportedVersions ?? [], [info])
  return (
    <div className="page narrow">
      <div className="about-hero">
        <Logo size={84} />
        <div>
          <h1>Vassago <span className="about-version">v{info?.version}</span></h1>
          <p className="sub">A free, independent, open-source client for Java Edition-compatible servers.</p>
        </div>
      </div>
      <div className="card about-card">
        <h3>Compatibility</h3>
        <p>Vassago only claims support for versions that pass its automated integration suite against a real server.</p>
        <div className="chips">
          {versions.map(v => <span key={v} className={`badge ${info?.verifiedVersions.includes(v) ? 'ok' : 'muted'}`} title={info?.verifiedVersions.includes(v) ? 'Verified by integration tests' : 'Protocol data available; not yet verified'}>{v}{info?.verifiedVersions.includes(v) ? ' · verified' : ''}</span>)}
          {(info?.verifiedTranslated ?? []).map(t => <span key={`via-${t.server}`} className="badge ok" data-testid="verified-translated" title={`Verified by integration tests against a ${t.server} server that admits older clients through ViaVersion/ViaBackwards. Vassago joins it as ${t.as}.`}>{t.server} · verified via server translation (as {t.as})</span>)}
        </div>
        <p className="muted">Unverified versions may connect but are experimental. Server versions newer than the list are only reachable when the server itself translates for older clients (ViaVersion with ViaBackwards).</p>
      </div>
      <div className="card about-card">
        <h3>Independent &amp; original</h3>
        <p>Vassago is not affiliated with, endorsed by, or connected to Mojang Studios or Microsoft. “Minecraft” is a trademark of Mojang Synergies AB. This client contains no game code or assets from Minecraft: every texture, icon and model is generated by Vassago’s own procedural art engine, and no game installation is required or downloaded.</p>
        <p>Online-mode servers require a Microsoft account that owns the game. Vassago never bypasses server authentication.</p>
      </div>
      <div className="card about-card">
        <h3>Open source</h3>
        <p>Released under the MIT License. Built on the work of these projects:</p>
        <ul className="credits">
          <li><b>PrismarineJS</b> — minecraft-protocol (BSD-3-Clause), mineflayer, minecraft-data, prismarine-auth, prismarine-chunk, prismarine-physics (MIT)</li>
          <li><b>three.js</b> (MIT) · <b>React</b> (MIT) · <b>Electron</b> (MIT)</li>
        </ul>
        <div className="about-meta">
          <span>Electron {info?.electron}</span><span>Chromium {info?.chrome}</span><span>Node {info?.node}</span><span>{info?.platform} {info?.arch}</span>
        </div>
        <button className="btn" onClick={() => { void window.vassago.app.openExternal('https://github.com/bdeanmancom/VASSAGO-OpenMC-Client') }}>View source on GitHub</button>
      </div>
    </div>
  )
}

export { stripMotd }
