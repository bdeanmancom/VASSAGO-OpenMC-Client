import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import type { Settings } from '../../shared/config'
import type { AuthMode, ConnectOptions, DisconnectKind, ItemDTO, WindowDTO } from '../../shared/protocol'
import { Game } from '../game/game'
import { Store, initialHud, useStore, type HudState } from '../game/store'
import { itemIconUrl } from '../game/icons'
import { Icon, Logo, Modal, MotdText } from './components'
import { SettingsBody } from './pages'
import type { Target } from './App'
import { Disconnected } from './Disconnected'

interface Props {
  opts: ConnectOptions
  target: Target
  settings: Settings
  setSettings: (patch: Partial<Settings>) => void
  onJoined: () => void
  onExit: () => void
  onReconnect: () => void
  /** Connect again as a different kind of profile (optionally signing the Microsoft account out first). */
  onRetryAs: (mode: AuthMode, fresh?: boolean) => void
  /** Reports why a connection ended, so the launcher can remember what a server requires. */
  onOutcome: (kind: DisconnectKind | undefined) => void
}

export function GameView ({ opts, target, settings, setSettings, onJoined, onExit, onReconnect, onRetryAs, onOutcome }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const store = useMemo(() => new Store<HudState>(initialHud()), [])
  const gameRef = useRef<Game | null>(null)
  const settingsRef = useRef(settings)

  useEffect(() => {
    const game = new Game(canvasRef.current!, store, settingsRef.current, opts)
    gameRef.current = game
    game.start()
    return () => { game.dispose(); gameRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { settingsRef.current = settings; gameRef.current?.applySettings(settings) }, [settings])

  const game = () => gameRef.current
  const phase = useStore(store, s => s.phase)
  const worldReady = useStore(store, s => s.worldReady)
  const disconnect = useStore(store, s => s.disconnect)
  const screen = useStore(store, s => s.screen)
  const dead = useStore(store, s => s.dead)
  const hideHud = useStore(store, s => s.hideHud)
  const pack = useStore(store, s => s.resourcePack)
  const msa = useStore(store, s => s.msaCode)
  const inWorld = phase === 'playing' && worldReady && !disconnect
  const joined = useRef(false)
  const reported = useRef(false)
  useEffect(() => { if (disconnect && !reported.current) { reported.current = true; onOutcome(disconnect.kind) } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disconnect])
  useEffect(() => { if (phase === 'playing' && !joined.current) { joined.current = true; onJoined() } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <div className="game" style={{ ['--gui' as any]: settings.guiScale }}>
      <canvas ref={canvasRef} className="game-canvas" data-testid="game-canvas" />
      {inWorld && !hideHud && <Hud store={store} showFps={settings.showFps} />}
      {inWorld && <ChatBox store={store} onSend={t => game()?.sendChat(t)} onClose={() => game()?.closeScreen()} />}
      {inWorld && screen === 'none' && !dead && <ResumeHint store={store} />}
      {inWorld && screen === 'inventory' && <InventoryScreen store={store} onClick={(slot, button, mode) => game()?.send({ t: 'windowClick', slot, button, mode })} onClose={() => game()?.closeScreen()} />}
      {inWorld && screen === 'pause' && (
        <div className="overlay dim">
          <div className="pause-menu">
            <Logo size={52} />
            <h2>Game paused</h2>
            <div className="pause-server">{target.name}</div>
            <button className="btn primary big" data-testid="resume" onClick={() => game()?.closeScreen()}>Back to game</button>
            <button className="btn big" onClick={() => store.set({ screen: 'settings' })}>Settings</button>
            <button className="btn big danger-outline" data-testid="disconnect" onClick={onExit}>Disconnect</button>
          </div>
        </div>
      )}
      {inWorld && screen === 'settings' && (
        <Modal title="Settings" wide onClose={() => store.set({ screen: 'pause' })} actions={<button className="btn primary" onClick={() => store.set({ screen: 'pause' })}>Done</button>}>
          <SettingsBody inGame ctx={{ config: { settings } as any, setSettings }} />
        </Modal>
      )}
      {inWorld && dead && (
        <div className="overlay death">
          <h1>You died</h1>
          <div className="death-actions">
            <button className="btn primary big" data-testid="respawn" onClick={() => game()?.respawn()}>Respawn</button>
            <button className="btn big" onClick={onExit}>Leave server</button>
          </div>
        </div>
      )}
      {!inWorld && !disconnect && <LoadingScreen store={store} target={target} opts={opts} onCancel={onExit} />}
      {msa && !disconnect && (
        <Modal
          title="Sign in with Microsoft"
          actions={<>
            <button className="btn ghost" data-testid="msa-use-offline" onClick={() => onRetryAs('offline')}>Use a private-server profile instead</button>
            <button className="btn ghost" onClick={onExit}>Cancel</button>
          </>}
        >
          <p>You are connecting with the Microsoft-account profile <b>{opts.username}</b>, so Vassago verifies that account before joining. Open the Microsoft sign-in page in your browser and enter this code:</p>
          <div className="msa-code" data-testid="msa-code">{msa.userCode}</div>
          <button className="btn primary" onClick={() => { void window.vassago.app.openExternal(msa.verificationUri) }}>Open {msa.verificationUri.replace(/^https:\/\//, '')}</button>
          <p className="muted">Vassago never sees your password. This window continues automatically once you finish signing in. A Microsoft account is only needed for servers running in online mode — for your own offline-mode server, use a private-server profile.</p>
        </Modal>
      )}
      {pack && !disconnect && (
        <Modal
          title="Server resource pack"
          actions={<>
            <button className="btn ghost" data-testid="pack-decline" onClick={() => game()?.answerResourcePack(false)}>Decline</button>
            <button className="btn primary" data-testid="pack-accept" onClick={() => game()?.answerResourcePack(true)}>Accept</button>
          </>}
        >
          <p>This server offers a resource pack{pack.forced ? ' and requires you to accept it to play' : ''}.</p>
          {pack.prompt && <p className="quote">{pack.prompt}</p>}
          <p className="pack-url">{pack.url}</p>
          <p className="muted">Vassago renders with its own original art. If you accept, the server is told you agreed, but the pack is not downloaded or applied. If you decline, the server may disconnect you.</p>
        </Modal>
      )}
      {disconnect && (
        <Disconnected
          info={disconnect}
          target={target}
          opts={opts}
          wasInWorld={phase === 'playing' || worldReady}
          onReconnect={onReconnect}
          onExit={onExit}
          onRetryAs={onRetryAs}
        />
      )}
    </div>
  )
}

function LoadingScreen ({ store, target, opts, onCancel }: { store: Store<HudState>, target: Target, opts: ConnectOptions, onCancel: () => void }) {
  const phase = useStore(store, s => s.phase)
  const detail = useStore(store, s => s.phaseDetail)
  const steps = ['Connecting', 'Logging in', 'Loading terrain', 'Building world']
  const idx = phase === 'authenticating' || phase === 'connecting' ? 0 : phase === 'login' ? 1 : phase === 'loading' ? 2 : 3
  return (
    <div className="overlay solid loading" data-testid="loading">
      <div className="loading-card">
        <Logo size={64} />
        <h2>{phase === 'authenticating' ? 'Signing in' : steps[idx]}…</h2>
        <div className="loading-server">{target.name}</div>
        <div className="loading-identity" data-testid="loading-identity">as {opts.username} · {opts.auth === 'microsoft' ? 'Microsoft account' : 'private-server profile (no account check)'}</div>
        <div className="loading-steps">{steps.map((s, i) => <span key={s} className={i < idx ? 'done' : i === idx ? 'now' : ''} />)}</div>
        <div className="loading-detail">{idx === 3 ? 'Meshing chunks around you' : detail}</div>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function ResumeHint ({ store }: { store: Store<HudState> }) {
  const locked = useStore(store, s => s.pointerLocked)
  if (locked) return null
  return <div className="resume-hint">Click to control the game</div>
}

// ----------------------------------------------------------------------- HUD

export function ItemIcon ({ item, size = 40 }: { item: ItemDTO | null, size?: number }) {
  if (!item) return null
  const dmg = item.maxDamage && item.damage ? 1 - item.damage / item.maxDamage : null
  return (
    <span className={`item ${item.enchanted ? 'enchanted' : ''}`} style={{ width: size, height: size }}>
      <img src={itemIconUrl(item.name)} alt={item.displayName} draggable={false} />
      {item.count > 1 && <span className="item-count">{item.count}</span>}
      {dmg != null && <span className="item-dmg"><i style={{ width: `${Math.max(4, dmg * 100)}%`, background: `hsl(${dmg * 120},85%,50%)` }} /></span>}
    </span>
  )
}

function Hud ({ store, showFps }: { store: Store<HudState>, showFps: boolean }) {
  const s = useStore(store, x => x)
  const now = performance.now()
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force(n => n + 1), 500); return () => clearInterval(t) }, [])
  const inv = s.inventory
  const survival = s.gameMode === 'survival' || s.gameMode === 'adventure'
  const hearts = Array.from({ length: 10 }, (_, i) => Math.max(0, Math.min(2, s.health - i * 2)))
  const food = Array.from({ length: 10 }, (_, i) => Math.max(0, Math.min(2, s.food - i * 2)))
  const hurt = now - s.hurtAt < 450
  const held = s.heldName && now - s.heldName.time < 2200 ? s.heldName.text : null
  const action = s.actionBar && now - s.actionBar.time < 3000 ? s.actionBar.text : null
  const title = s.title && now - s.title.time < 4000 ? s.title : null
  return (
    <div className="hud">
      {hurt && <div className="hurt-vignette" />}
      <div className={`crosshair ${s.target ? 'on' : ''}`}>
        {s.digProgress > 0 && <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" style={{ strokeDasharray: `${s.digProgress * 94.2} 94.2` }} /></svg>}
      </div>
      {title && <div className="title-overlay"><div className="title-main"><MotdText text={title.text} /></div>{title.sub && <div className="title-sub"><MotdText text={title.sub} /></div>}</div>}
      {(showFps || s.showDebug) && !s.showDebug && <div className="fps" data-testid="fps">{s.fps} fps</div>}
      {s.showDebug && <div className="debug" data-testid="debug">{s.debug.map((l, i) => <div key={i}>{l}</div>)}</div>}
      {s.showPlayers && (
        <div className="playerlist">
          <div className="playerlist-head">{s.server} · {s.players.length} online</div>
          {s.players.map(p => <div key={p.uuid} className="playerlist-row"><span>{p.username}</span><span className="muted">{p.ping} ms</span></div>)}
        </div>
      )}
      <div className="hud-bottom">
        {action && <div className="actionbar"><MotdText text={action} /></div>}
        {held && <div className="held-name">{held}</div>}
        {survival && (
          <div className="bars">
            <div className="hearts" data-testid="hearts" data-health={s.health}>{hearts.map((h, i) => <span key={i} className={`heart h${Math.ceil(h)}`} />)}</div>
            <div className="foods">{food.map((h, i) => <span key={i} className={`food h${Math.ceil(h)}`} />)}</div>
          </div>
        )}
        {survival && <div className="xp"><i style={{ width: `${s.xpProgress * 100}%` }} />{s.xpLevel > 0 && <span>{s.xpLevel}</span>}</div>}
        <div className="hotbar" data-testid="hotbar">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={`hot-slot ${i === s.hotbar ? 'sel' : ''}`}>
              <ItemIcon item={inv?.slots[36 + i] ?? null} size={40} />
              <span className="hot-key">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      {s.flying && <div className="fly-tag">Flying</div>}
    </div>
  )
}

function ChatBox ({ store, onSend, onClose }: { store: Store<HudState>, onSend: (text: string) => void, onClose: () => void }) {
  const chat = useStore(store, s => s.chat)
  const open = useStore(store, s => s.screen === 'chat')
  const prefill = useStore(store, s => s.chatPrefill)
  const hide = useStore(store, s => s.hideHud)
  const [text, setText] = useState('')
  const [, force] = useState(0)
  const history = useRef<string[]>([])
  const histIdx = useRef(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const t = setInterval(() => force(n => n + 1), 1000); return () => clearInterval(t) }, [])
  // Focus synchronously with the render that opens the box so no keystroke is lost, even at low frame rates.
  useLayoutEffect(() => { if (open) { setText(prefill); histIdx.current = -1; inputRef.current?.focus() } }, [open, prefill])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [chat, open])
  const now = performance.now()
  const lines = open ? chat : chat.filter(l => now - l.time < 10000).slice(-10)
  if (hide && !open) return null
  return (
    <div className={`chat ${open ? 'open' : ''}`}>
      <div className="chat-log" ref={logRef} data-testid="chat-log">
        {lines.map(l => <div key={l.id} className={`chat-line ${!open && now - l.time > 9000 ? 'fade' : ''}`}><MotdText text={l.motd} /></div>)}
      </div>
      {open && (
        <input
          ref={inputRef} className="chat-input" data-testid="chat-input" value={text} maxLength={256} spellCheck={false} placeholder="Message or /command"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation()
              const t = text.trim()
              if (t) { onSend(t); history.current.unshift(t); history.current = history.current.slice(0, 50) }
              setText(''); onClose()
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              const n = Math.min(history.current.length - 1, histIdx.current + 1)
              if (n >= 0) { histIdx.current = n; setText(history.current[n]) }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              const n = histIdx.current - 1
              histIdx.current = Math.max(-1, n); setText(n >= 0 ? history.current[n] : '')
            }
          }}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------- Inventory

interface Layout { title: string, groups: { label?: string, cols: number, slots: number[], className?: string }[] }

function containerLayout (w: WindowDTO): Layout {
  const n = w.inventoryStart
  const t = w.type.replace('minecraft:', '')
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)
  const title = w.title || 'Container'
  if (t === 'crafting' || t === 'crafting_3x3' || t === 'crafter_3x3') return { title, groups: [{ label: 'Crafting grid', cols: 3, slots: range(1, 10) }, { label: 'Result', cols: 1, slots: [0], className: 'result' }] }
  if (t === 'furnace' || t === 'blast_furnace' || t === 'smoker') return { title, groups: [{ label: 'Input', cols: 1, slots: [0] }, { label: 'Fuel', cols: 1, slots: [1] }, { label: 'Output', cols: 1, slots: [2], className: 'result' }] }
  if (t === 'generic_3x3') return { title, groups: [{ cols: 3, slots: range(0, n) }] }
  if (t === 'hopper') return { title, groups: [{ cols: 5, slots: range(0, n) }] }
  if (t.startsWith('generic_9x') || t === 'shulker_box') return { title, groups: [{ cols: 9, slots: range(0, n) }] }
  return { title, groups: [{ cols: Math.min(9, Math.max(1, n)), slots: range(0, n) }] }
}

function InventoryScreen ({ store, onClick, onClose }: { store: Store<HudState>, onClick: (slot: number, button: number, mode: number) => void, onClose: () => void }) {
  const win = useStore(store, s => s.window)
  const inv = useStore(store, s => s.inventory)
  const [mouse, setMouse] = useState({ x: -100, y: -100 })
  const [hover, setHover] = useState<{ slot: number, item: ItemDTO } | null>(null)
  const hoverSlot = useRef<number | null>(null)
  const w = win ?? inv
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const slot = hoverSlot.current
      if (slot == null) return
      if (e.code.startsWith('Digit') && e.code !== 'Digit0') onClick(slot, Number(e.code.slice(5)) - 1, 2)
      else if (e.code === 'KeyQ') onClick(slot, e.ctrlKey ? 1 : 0, 4)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClick])
  if (!w) return null
  const isPlayer = !win
  const start = w.inventoryStart
  const slot = (i: number, extra = '') => {
    const item = w.slots[i] ?? null
    return (
      <div
        key={i} className={`slot ${extra}`} data-slot={i} data-item={item?.name ?? ''}
        onMouseDown={(e: RMouseEvent) => { e.preventDefault(); e.stopPropagation(); if (e.button === 0) onClick(i, 0, e.shiftKey ? 1 : 0); else if (e.button === 2) onClick(i, 1, 0) }}
        onMouseEnter={() => { hoverSlot.current = i; setHover(item ? { slot: i, item } : null) }}
        onMouseLeave={() => { if (hoverSlot.current === i) { hoverSlot.current = null; setHover(null) } }}
        onContextMenu={e => e.preventDefault()}
      ><ItemIcon item={item} /></div>
    )
  }
  const layout = isPlayer ? null : containerLayout(w)
  return (
    <div
      className="overlay dim inventory-overlay" data-testid="inventory"
      onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })}
      onMouseDown={e => { if (e.target === e.currentTarget) { if (w.cursor) onClick(-999, e.button === 2 ? 1 : 0, 0); else onClose() } }}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="inv-panel">
        {isPlayer
          ? (
            <div className="inv-top">
              <div className="inv-group"><div className="inv-label">Armor</div><div className="slot-grid" style={{ ['--cols' as any]: 4 }}>{[5, 6, 7, 8].map(i => slot(i, 'armor'))}</div></div>
              <div className="inv-group"><div className="inv-label">Off hand</div><div className="slot-grid" style={{ ['--cols' as any]: 1 }}>{slot(45)}</div></div>
              <div className="inv-spacer" />
              <div className="inv-group"><div className="inv-label">Crafting</div><div className="slot-grid" style={{ ['--cols' as any]: 2 }}>{[1, 2, 3, 4].map(i => slot(i))}</div></div>
              <div className="inv-arrow"><Icon name="arrow" size={22} /></div>
              <div className="inv-group"><div className="inv-label">Result</div><div className="slot-grid" style={{ ['--cols' as any]: 1 }}>{slot(0, 'result')}</div></div>
            </div>
            )
          : (
            <>
              <div className="inv-title" data-testid="container-title">{layout!.title}</div>
              <div className="inv-top">
                {layout!.groups.map((g, gi) => (
                  <div className="inv-group" key={gi}>{g.label && <div className="inv-label">{g.label}</div>}<div className="slot-grid" style={{ ['--cols' as any]: g.cols }}>{g.slots.map(i => slot(i, g.className ?? ''))}</div></div>
                ))}
              </div>
            </>
            )}
        <div className="inv-label">Inventory</div>
        <div className="slot-grid" style={{ ['--cols' as any]: 9 }}>{Array.from({ length: 27 }, (_, i) => slot(start + i))}</div>
        <div className="slot-grid hotbar-row" style={{ ['--cols' as any]: 9 }}>{Array.from({ length: 9 }, (_, i) => slot(start + 27 + i))}</div>
        <div className="inv-hint">Click to pick up / place · right-click splits · shift-click moves · click outside to drop · E to close</div>
      </div>
      {w.cursor && <div className="cursor-item" style={{ left: mouse.x, top: mouse.y }}><ItemIcon item={w.cursor} /></div>}
      {hover && !w.cursor && <div className="tooltip" style={{ left: mouse.x + 14, top: mouse.y - 10 }}>{hover.item.customName ?? hover.item.displayName}{hover.item.enchanted && <span className="tooltip-sub">Enchanted</span>}</div>}
    </div>
  )
}
