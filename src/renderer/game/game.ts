/**
 * Game: glue between the session (protocol/gameplay core), the client world,
 * the renderer, input and the HUD store.
 */
import { createAttemptGate, newAttemptId } from '../../shared/attempt'
import * as THREE from 'three'
import type { ConnectOptions, Controls, SessionCommand, SessionEvent, WindowDTO } from '../../shared/protocol'
import type { Settings } from '../../shared/config'
import { buildRegistry, F_WATER, K_LIQUID, type GameData, type Registry } from './registry'
import { Scene, buildTileTexture, type Environment } from './scene'
import { World } from './world'
import { Entities } from './entities'
import { raycastBlocks, type BlockHit } from './raycast'
import { Store, heldItem, type ChatLine, type HudState } from './store'
import { containsWater, entityColors, lookFor } from './materials'
import { paintTile } from './textures'
import { itemIconCanvas, setIconRegistry } from './icons'
import { Audio } from './audio'

const REACH_SURVIVAL = 4.5
const REACH_CREATIVE = 5
const EYE = 1.62
const EYE_SNEAK = 1.27

const KEY_CONTROLS: Record<string, keyof Controls> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint', ControlRight: 'sprint'
}

export class Game {
  private scene: Scene | null = null
  private world: World | null = null
  private entities: Entities | null = null
  private reg: Registry | null = null
  private queue: SessionEvent[] = []
  private loadingRegistry = false
  private disposed = false
  private raf = 0
  private unsub: (() => void) | null = null
  private cleanup: (() => void)[] = []

  // self state
  private prev = new THREE.Vector3()
  private curr = new THREE.Vector3()
  private currAt = 0
  private hasPos = false
  private onGround = false
  private velocity = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private lookDirty = false
  private lastLookSent = 0
  private eye = EYE
  private fov = 75
  private bob = 0
  private bobAmp = 0
  private controls: Controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  private sprintLatch = false
  private lastForwardTap = 0
  private lastJumpTap = 0
  private flying = false

  // environment
  private env: Environment = { timeOfDay: 6000, raining: false, dimension: 'overworld', underwater: false, underLava: false }
  private timeAt = performance.now()
  private gameMode = 'survival'
  private version = ''

  // interaction
  private target: BlockHit | null = null
  private targetEntity: number | null = null
  private outline: THREE.LineSegments | null = null
  private crack: THREE.Mesh | null = null
  private crackTextures: THREE.Texture[] = []
  private leftDown = false
  private rightDown = false
  private dig: { x: number, y: number, z: number, start: number, timeMs: number } | null = null
  private digCooldown = 0
  private lastUse = 0
  private handSwingAt = -1e9
  private handItem: string | null = null
  private audio = new Audio()
  private stepAt = 0
  private wasUnderwater = false
  private handEquipAt = 0

  // frame stats
  private lastFrame = performance.now()
  private frames = 0
  private fpsAt = performance.now()
  private fps = 0
  private frameCount = 0
  private chatId = 1

  constructor (
    private canvas: HTMLCanvasElement,
    private store: Store<HudState>,
    private settings: Settings,
    private opts: ConnectOptions
  ) {}

  /** Identifies this screen's connection attempt among the events of the shared session. */
  private readonly attemptId = newAttemptId()
  private readonly mine = createAttemptGate(this.attemptId)

  // ------------------------------------------------------------------ setup

  start () {
    const bridge = window.vassago
    this.store.set({ phase: 'connecting', phaseDetail: `${this.opts.host}:${this.opts.port}`, server: `${this.opts.host}${this.opts.port !== 25565 ? ':' + this.opts.port : ''}`, username: this.opts.username })
    this.audio.volume = this.settings.volume
    this.unsub = bridge.session.onEvent(ev => this.onEvent(ev))
    this.send({ t: 'connect', opts: this.opts, attempt: this.attemptId })
    this.bindInput()
    this.lastFrame = performance.now()
    const loop = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)
      const now = performance.now()
      const limit = this.settings.fpsLimit
      if (limit > 0 && now - this.lastFrame < 1000 / limit - 0.5) return
      try { this.frame(now) } catch (err: any) {
        window.vassago.app.log('error', `frame error: ${err?.stack ?? err}`)
      }
    }
    this.raf = requestAnimationFrame(loop)
    ;(window as any).__vassago = { game: this }
  }

  dispose (disconnect = true) {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    if (disconnect) this.send({ t: 'disconnect' })
    this.unsub?.()
    for (const c of this.cleanup) c()
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    this.world?.dispose()
    this.entities?.clear()
    this.outline?.geometry.dispose()
    for (const t of this.crackTextures) t.dispose()
    this.scene?.dispose()
    this.audio.dispose()
    setIconRegistry(null)
    if ((window as any).__vassago?.game === this) delete (window as any).__vassago
  }

  send (cmd: SessionCommand) { window.vassago.session.send(cmd) }

  applySettings (s: Settings) {
    const prev = this.settings
    this.settings = s
    this.audio.volume = s.volume
    if (this.world) {
      this.world.renderDistance = s.renderDistance
      if (this.world.smoothLighting !== s.smoothLighting) { this.world.smoothLighting = s.smoothLighting }
    }
    if (this.scene) {
      this.scene.cloudsEnabled = s.clouds
      this.scene.gamma = 1.25 - s.brightness * 0.6
      this.resize()
    }
    if (prev.renderDistance !== s.renderDistance) this.send({ t: 'viewDistance', chunks: s.renderDistance })
  }

  private async loadRegistry (version: string) {
    this.loadingRegistry = true
    try {
      const res = await fetch(`gamedata/${version}.json`)
      if (!res.ok) throw new Error(`No game data bundled for version ${version}`)
      const data = await res.json() as GameData
      if (this.disposed) return
      const reg = buildRegistry(data, lookFor, containsWater)
      this.reg = reg
      setIconRegistry(reg)
      const s = this.settings
      const tiles = buildTileTexture(reg.tileKeys, paintTile, s.mipmaps ? 4 : 1, s.mipmaps)
      this.scene = new Scene(this.canvas, tiles, s.antialias)
      this.scene.cloudsEnabled = s.clouds
      this.scene.gamma = 1.25 - s.brightness * 0.6
      const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
      this.world = new World(reg, this.scene.opaqueMat, this.scene.transMat, workers)
      this.world.renderDistance = s.renderDistance
      this.world.smoothLighting = s.smoothLighting
      this.scene.scene.add(this.world.group)
      this.entities = new Entities({ colors: entityColors, itemIcon: itemIconCanvas })
      this.scene.scene.add(this.entities.group)
      this.buildOverlays()
      this.resize()
      window.vassago.app.log('info', `registry ready: ${reg.stateCount} states, ${reg.tileKeys.length} tiles, ${workers} mesh workers`)
    } catch (err: any) {
      window.vassago.app.log('error', `failed to load game data: ${err?.stack ?? err}`)
      this.store.set({ disconnect: { reason: `Could not load game data: ${err?.message ?? err}`, kicked: false } })
      this.send({ t: 'disconnect' })
      return
    } finally {
      this.loadingRegistry = false
    }
    const q = this.queue
    this.queue = []
    for (const ev of q) this.onEvent(ev)
  }

  private buildOverlays () {
    const scene = this.scene!.scene
    this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x05060a, transparent: true, opacity: 0.75 }))
    this.outline.visible = false
    this.outline.frustumCulled = false
    this.outline.renderOrder = 3
    scene.add(this.outline)
    for (let stage = 0; stage < 8; stage++) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 16
      const g = cv.getContext('2d')!
      let seed = 1234
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      g.fillStyle = 'rgba(10,10,14,0.85)'
      const cracks = 2 + stage * 2
      for (let i = 0; i < cracks; i++) {
        let x = 8 + (rnd() - 0.5) * 4; let y = 8 + (rnd() - 0.5) * 4
        const ang = rnd() * Math.PI * 2
        const len = 3 + stage * 0.9
        for (let k = 0; k < len; k++) {
          g.fillRect(Math.floor(x), Math.floor(y), 1, 1)
          x += Math.cos(ang + (rnd() - 0.5) * 1.2); y += Math.sin(ang + (rnd() - 0.5) * 1.2)
        }
      }
      const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace
      this.crackTextures.push(t)
    }
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), new THREE.MeshBasicMaterial({ map: this.crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
    this.crack.visible = false
    this.crack.renderOrder = 3
    scene.add(this.crack)
  }

  private resize = () => {
    if (!this.scene) return
    const w = this.canvas.clientWidth; const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.settings.resolutionScale
    this.scene.resize(w, h, ratio)
  }

  // ------------------------------------------------------------------ input

  private get screen () { return this.store.get().screen }
  private get playing () { const s = this.store.get(); return s.phase === 'playing' && s.screen === 'none' && !s.dead && !s.disconnect }

  private bindInput () {
    const on = <K extends keyof DocumentEventMap>(target: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts)
      this.cleanup.push(() => target.removeEventListener(type, fn, opts))
    }
    on(window, 'resize', this.resize)
    on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas
      this.store.set({ pointerLocked: locked })
      if (!locked) {
        this.releaseAll()
        const s = this.store.get()
        if (s.screen === 'none' && s.phase === 'playing' && !s.dead && !s.disconnect && document.hasFocus()) this.openScreen('pause')
      }
    })
    on(window, 'blur', () => this.releaseAll())
    on(this.canvas, 'click', () => { if (this.playing) this.lockPointer() })
    on(document, 'mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement !== this.canvas) return
      const sens = 0.0022 * this.settings.sensitivity
      this.yaw -= e.movementX * sens
      this.pitch -= e.movementY * sens * (this.settings.invertY ? -1 : 1)
      const lim = Math.PI / 2 - 0.001
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch))
      this.lookDirty = true
    })
    on(this.canvas, 'mousedown', (e: MouseEvent) => {
      if (document.pointerLockElement !== this.canvas) return
      if (e.button === 0) { this.leftDown = true; this.primaryAction() } else if (e.button === 2) { this.rightDown = true; this.secondaryAction() } else if (e.button === 1) this.pickBlock()
    })
    on(document, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) { this.leftDown = false; this.stopDig() } else if (e.button === 2) { if (this.rightDown) this.send({ t: 'useItemRelease' }); this.rightDown = false }
    })
    on(this.canvas, 'contextmenu', (e: Event) => e.preventDefault())
    on(document, 'wheel', (e: WheelEvent) => {
      if (!this.playing) return
      const cur = this.store.get().hotbar
      this.setHotbar((cur + (e.deltaY > 0 ? 1 : 8)) % 9)
    }, { passive: true })
    on(document, 'keydown', (e: KeyboardEvent) => this.onKey(e, true))
    on(document, 'keyup', (e: KeyboardEvent) => this.onKey(e, false))
  }

  lockPointer () {
    if (document.pointerLockElement === this.canvas) return
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
      p?.catch?.(() => {})
    } catch {}
  }

  private releaseAll () {
    this.leftDown = false; this.rightDown = false
    this.stopDig()
    const c = this.controls
    if (c.forward || c.back || c.left || c.right || c.jump || c.sprint || c.sneak) {
      this.controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
      this.sprintLatch = false
      this.send({ t: 'controls', c: this.controls })
    }
  }

  private onKey (e: KeyboardEvent, down: boolean) {
    const s = this.store.get()
    if (s.phase !== 'playing' || s.disconnect) return
    const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA'

    if (down && e.code === 'F3') { e.preventDefault(); this.store.set({ showDebug: !s.showDebug }); return }
    if (down && e.code === 'F1') { e.preventDefault(); this.store.set({ hideHud: !s.hideHud }); return }
    if (down && e.code === 'F2') { e.preventDefault(); void this.screenshot(); return }
    if (down && e.code === 'F11') { e.preventDefault(); void window.vassago.app.setFullscreen(!document.fullscreenElement && !this.settings.fullscreen); return }

    if (s.screen !== 'none') {
      if (down && e.code === 'Escape') { e.preventDefault(); this.closeScreen(); return }
      if (down && e.code === 'KeyE' && s.screen === 'inventory' && !typing) { e.preventDefault(); this.closeScreen() }
      return
    }
    if (s.dead) return

    if (e.code === 'Tab') { e.preventDefault(); this.store.set({ showPlayers: down }); return }
    const ctl = KEY_CONTROLS[e.code]
    if (ctl) {
      e.preventDefault()
      if (e.repeat) return
      const now = performance.now()
      if (down && ctl === 'forward') {
        if (now - this.lastForwardTap < 280) this.sprintLatch = true
        this.lastForwardTap = now
      }
      if (!down && ctl === 'forward') this.sprintLatch = false
      if (down && ctl === 'jump') {
        if (now - this.lastJumpTap < 300 && (this.gameMode === 'creative' || this.gameMode === 'spectator')) {
          this.flying = !this.flying
          this.send({ t: 'fly', flying: this.flying })
          this.store.set({ flying: this.flying })
          this.lastJumpTap = 0
        } else this.lastJumpTap = now
      }
      this.controls = { ...this.controls, [ctl]: down }
      this.sendControls()
      return
    }
    if (!down) return
    if (e.code.startsWith('Digit') && e.code !== 'Digit0') { this.setHotbar(Number(e.code.slice(5)) - 1); return }
    switch (e.code) {
      case 'KeyE': e.preventDefault(); this.openScreen('inventory'); break
      case 'KeyT': case 'Enter': e.preventDefault(); this.openScreen('chat', ''); break
      case 'Slash': e.preventDefault(); this.openScreen('chat', '/'); break
      case 'KeyQ': this.send({ t: 'drop', stack: e.ctrlKey }); break
      case 'Escape': e.preventDefault(); this.openScreen('pause'); break
    }
  }

  private sendControls () {
    const c = this.controls
    this.send({ t: 'controls', c: { ...c, sprint: (c.sprint || this.sprintLatch) && c.forward } })
  }

  setHotbar (slot: number) {
    if (slot === this.store.get().hotbar) return
    this.store.set({ hotbar: slot })
    this.send({ t: 'hotbar', slot })
    const item = this.store.get().inventory?.slots[36 + slot]
    this.store.set({ heldName: item ? { text: item.customName ?? item.displayName, time: performance.now() } : null })
    this.stopDig()
  }

  openScreen (screen: HudState['screen'], prefill = '') {
    this.releaseAll()
    this.store.set({ screen, chatPrefill: prefill, showPlayers: false })
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  closeScreen () {
    const s = this.store.get()
    if (s.screen === 'inventory' && s.window) this.send({ t: 'windowClose' })
    this.store.set({ screen: 'none', window: null })
    if (!s.dead) this.lockPointer()
  }

  sendChat (text: string) {
    const t = text.trim()
    if (t) this.send({ t: 'chat', text: t })
  }

  respawn () { this.send({ t: 'respawn' }) }

  answerResourcePack (accept: boolean) {
    this.send({ t: 'resourcePack', accept })
    this.store.set({ resourcePack: null })
  }

  private async screenshot () {
    if (!this.scene) return
    this.scene.render()
    const url = this.canvas.toDataURL('image/png')
    const path = await window.vassago.app.saveScreenshot(url)
    if (path) this.pushChat(`§7Screenshot saved to §f${path}`)
  }

  // ------------------------------------------------------------ interaction

  private primaryAction () {
    if (!this.playing) return
    this.handSwingAt = performance.now()
    if (this.targetEntity != null) { this.send({ t: 'attack', id: this.targetEntity }); return }
    if (this.target) this.startDig(this.target)
    else this.send({ t: 'swing' })
  }

  private startDig (hit: BlockHit) {
    if (this.gameMode === 'adventure' || this.gameMode === 'spectator') return
    this.dig = { x: hit.x, y: hit.y, z: hit.z, start: performance.now(), timeMs: this.gameMode === 'creative' ? 0 : 1e9 }
    this.send({ t: 'digStart', x: hit.x, y: hit.y, z: hit.z, face: hit.face })
  }

  private stopDig () {
    if (this.dig) { this.send({ t: 'digCancel' }); this.dig = null }
    if (this.crack) this.crack.visible = false
    this.store.set({ digProgress: 0 })
  }

  private secondaryAction () {
    if (!this.playing) return
    const now = performance.now()
    this.lastUse = now
    if (this.targetEntity != null) { this.send({ t: 'interactEntity', id: this.targetEntity }); return }
    const held = heldItem(this.store.get())
    const isBlockItem = !!held && !!this.reg?.blockByName.has(held.name)
    if (this.target) {
      const h = this.target
      this.handSwingAt = now
      this.send({ t: 'useBlock', x: h.x, y: h.y, z: h.z, face: h.face, cx: h.cx, cy: h.cy, cz: h.cz })
      if (isBlockItem) this.audio.play('place')
      if (held && !isBlockItem) this.send({ t: 'useItem' })
    } else if (held) {
      this.send({ t: 'useItem' })
    }
  }

  private pickBlock () {
    if (!this.target || !this.reg) return
    const name = this.reg.data.blocks[this.reg.blockOfState[this.target.state]]?.n
    const inv = this.store.get().inventory
    if (!name || !inv) return
    for (let i = 0; i < 9; i++) if (inv.slots[36 + i]?.name === name) { this.setHotbar(i); return }
  }

  // ----------------------------------------------------------------- events

  private pushChat (motd: string) {
    const line: ChatLine = { id: this.chatId++, motd, time: performance.now() }
    this.store.set({ chat: [...this.store.get().chat.slice(-99), line] })
  }

  private onEvent (ev: SessionEvent) {
    if (this.disposed) return
    if (!this.mine(ev)) return // left over from the connection the previous screen was showing
    const store = this.store
    switch (ev.t) {
      case 'phase':
        if (ev.phase === 'disconnected') { store.set({ phase: ev.phase }); return }
        store.set({ phase: ev.phase, phaseDetail: ev.detail ?? store.get().phaseDetail })
        if (ev.phase === 'playing') {
          store.set({ dead: false })
          // Grab the mouse as soon as the player is in the world (works when the
          // connect click is still a recent user gesture; otherwise a click resumes).
          if (store.get().screen === 'none') this.lockPointer()
        }
        return
      case 'msaCode': store.set({ msaCode: { userCode: ev.userCode, verificationUri: ev.verificationUri } }); return
      case 'disconnect':
        if (document.pointerLockElement === this.canvas) document.exitPointerLock()
        store.set({ disconnect: { reason: ev.reason, kicked: ev.kicked, kind: ev.kind, detail: ev.detail, auth: ev.auth }, screen: 'none', resourcePack: null, msaCode: null })
        return
      case 'resourcePack': store.set({ resourcePack: { url: ev.url, forced: ev.forced, prompt: ev.prompt } }); return
      case 'log': return
      case 'error': window.vassago.app.log('warn', ev.message); return
      case 'login':
        this.version = ev.version
        this.gameMode = ev.gameMode
        this.env.dimension = ev.dimension
        store.set({ version: ev.version, gameMode: ev.gameMode, msaCode: null, username: ev.username })
        if (!this.reg && !this.loadingRegistry) void this.loadRegistry(ev.version)
        return
    }
    // Everything below needs the registry / scene.
    if (!this.reg || !this.world || !this.entities) { this.queue.push(ev); return }
    const world = this.world
    const now = performance.now()
    switch (ev.t) {
      case 'respawn':
        world.clear(); this.entities.clear()
        this.env.dimension = ev.dimension
        this.gameMode = ev.gameMode
        this.hasPos = false
        store.set({ worldReady: false, gameMode: ev.gameMode, dead: false })
        break
      case 'chunk': world.setChunk(ev.x, ev.z, ev.minY, ev.sections); break
      case 'chunkLight': world.setLight(ev.x, ev.z, ev.light); break
      case 'unloadChunk': world.unloadChunk(ev.x, ev.z); break
      case 'blocks':
        for (let i = 0; i < ev.updates.length; i += 4) world.setBlock(ev.updates[i], ev.updates[i + 1], ev.updates[i + 2], ev.updates[i + 3])
        break
      case 'self': {
        const jump = !this.hasPos || Math.abs(ev.x - this.curr.x) + Math.abs(ev.y - this.curr.y) + Math.abs(ev.z - this.curr.z) > 8
        this.prev.copy(jump ? new THREE.Vector3(ev.x, ev.y, ev.z) : this.renderPos(now))
        this.curr.set(ev.x, ev.y, ev.z)
        this.currAt = now
        this.velocity.set(ev.vx, ev.vy, ev.vz)
        this.onGround = ev.onGround
        this.hasPos = true
        break
      }
      case 'forcedLook': this.yaw = ev.yaw; this.pitch = ev.pitch; break
      case 'health': {
        const s = store.get()
        store.set({ health: ev.health, food: ev.food, dead: ev.health <= 0 ? s.dead : false })
        break
      }
      case 'experience': store.set({ xpLevel: ev.level, xpProgress: ev.progress }); break
      case 'gameMode':
        this.gameMode = ev.gameMode
        if (ev.gameMode !== 'creative' && ev.gameMode !== 'spectator' && this.flying) { this.flying = false; store.set({ flying: false }) }
        store.set({ gameMode: ev.gameMode })
        break
      case 'death':
        this.releaseAll()
        if (document.pointerLockElement === this.canvas) document.exitPointerLock()
        store.set({ dead: true, screen: 'none', window: null })
        break
      case 'hurt': store.set({ hurtAt: now }); this.audio.play('hurt'); break
      case 'entitySpawn': this.entities.spawn(ev.e); break
      case 'entityUpdate': this.entities.update(ev.e); break
      case 'entityMoves': for (const m of ev.moves) this.entities.move(m, now); break
      case 'entityGone': this.entities.remove(ev.id); if (this.targetEntity === ev.id) this.targetEntity = null; break
      case 'entityAnim': this.entities.anim(ev.id, ev.anim, now); break
      case 'window': this.onWindow(ev.w); break
      case 'windowClose': if (store.get().screen === 'inventory') { store.set({ screen: 'none', window: null }); this.lockPointer() } break
      case 'chat':
        if (ev.kind === 'actionbar') store.set({ actionBar: { text: ev.motd, time: now } })
        else this.pushChat(ev.motd)
        break
      case 'title': {
        const cur = store.get().title
        store.set({ title: ev.subtitle ? { text: cur?.text ?? '', sub: ev.text, time: now } : { text: ev.text, sub: cur && now - cur.time < 500 ? cur.sub : '', time: now } })
        break
      }
      case 'time': this.env.timeOfDay = ev.timeOfDay; this.env.raining = ev.raining; this.timeAt = now; break
      case 'players': store.set({ players: ev.players }); break
      case 'dig':
        if (ev.state === 'start') { if (this.dig && this.dig.x === ev.x && this.dig.y === ev.y && this.dig.z === ev.z) { this.dig.timeMs = ev.timeMs; this.dig.start = now } } else {
          if (ev.state === 'done') { world.setBlock(ev.x, ev.y, ev.z, 0); this.audio.play('break'); this.digCooldown = now + (this.gameMode === 'creative' ? 220 : 280) }
          this.dig = null
          if (this.crack) this.crack.visible = false
          store.set({ digProgress: 0 })
        }
        break
    }
  }

  private onWindow (w: WindowDTO) {
    const store = this.store
    const s = store.get()
    if (w.type === 'inventory') {
      const patch: Partial<HudState> = { inventory: w, hotbar: w.hotbar }
      if (s.window) { patch.window = null; if (s.screen === 'inventory') { patch.screen = 'none'; this.lockPointer() } }
      store.set(patch)
    } else {
      // Mirror the player-inventory part so the hotbar stays live while a container is open.
      const inv: WindowDTO = { id: 0, type: 'inventory', title: 'Inventory', inventoryStart: 9, cursor: null, hotbar: w.hotbar, slots: [...Array(9).fill(null), ...w.slots.slice(w.inventoryStart, w.inventoryStart + 36), s.inventory?.slots[45] ?? null] }
      if (s.screen !== 'inventory') { this.releaseAll(); if (document.pointerLockElement === this.canvas) document.exitPointerLock() }
      store.set({ window: w, inventory: inv, hotbar: w.hotbar, screen: 'inventory' })
    }
  }

  // ------------------------------------------------------------------ frame

  private renderPos (now: number): THREE.Vector3 {
    const a = Math.max(0, Math.min(1, (now - this.currAt) / 50))
    return new THREE.Vector3().lerpVectors(this.prev, this.curr, a)
  }

  private frame (now: number) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.frames++
    this.frameCount++
    if (now - this.fpsAt >= 500) {
      this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt))
      this.frames = 0; this.fpsAt = now
      this.store.set({ fps: this.fps })
      if (this.store.get().showDebug) this.updateDebug()
    }
    const scene = this.scene; const world = this.world; const reg = this.reg
    if (!scene || !world || !reg || !this.entities) return

    if (this.lookDirty && now - this.lastLookSent > 45) {
      this.send({ t: 'look', yaw: this.yaw, pitch: this.pitch })
      this.lookDirty = false; this.lastLookSent = now
    }

    // camera
    const pos = this.renderPos(now)
    const sneaking = this.controls.sneak && !this.flying
    this.eye += ((sneaking ? EYE_SNEAK : EYE) - this.eye) * Math.min(1, dt * 14)
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    const moving = this.onGround && speed > 0.03
    this.bobAmp += ((moving && this.settings.viewBobbing ? Math.min(1, speed * 6) : 0) - this.bobAmp) * Math.min(1, dt * 8)
    if (moving) this.bob += dt * (8 + speed * 22)
    if (moving && now - this.stepAt > (sprintingNow(this.controls, this.sprintLatch) ? 290 : 380) && this.playing) { this.stepAt = now; this.audio.play('step') }
    const cam = scene.camera
    cam.rotation.order = 'YXZ'
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.004 * this.bobAmp)
    cam.position.set(pos.x, pos.y + this.eye + Math.abs(Math.cos(this.bob)) * 0.045 * this.bobAmp, pos.z)
    const sprinting = (this.controls.sprint || this.sprintLatch) && this.controls.forward
    const targetFov = this.settings.fov * (sprinting && speed > 0.1 ? 1.1 : 1) * (this.flying ? 1.04 : 1)
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 10)
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix() }

    // world upkeep
    world.cameraChunk.x = Math.floor(pos.x) >> 4
    world.cameraChunk.y = Math.floor(pos.y) >> 4
    world.cameraChunk.z = Math.floor(pos.z) >> 4
    world.pump()
    if (this.frameCount % 15 === 0) world.updateVisibility()
    if (!this.store.get().worldReady && this.hasPos && world.readyAround(world.cameraChunk.x, world.cameraChunk.z)) this.store.set({ worldReady: true })

    // environment
    const headState = world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z))
    this.env.underwater = (reg.flags[headState] & F_WATER) !== 0
    this.env.underLava = reg.kind[headState] === K_LIQUID && !this.env.underwater
    if (this.env.underwater !== this.wasUnderwater) { this.wasUnderwater = this.env.underwater; if (this.hasPos) this.audio.play('splash') }
    const envNow = { ...this.env, timeOfDay: (this.env.timeOfDay + (now - this.timeAt) / 50) % 24000 }
    scene.update(envNow, Math.min(this.settings.renderDistance, 32), now / 1000)

    const curve = (l: number) => l / (4 - 3 * l)
    this.entities.tick(now, dt, (x, y, z) => {
      const l = world.getLight(Math.floor(x), Math.floor(y), Math.floor(z))
      const b = Math.max(curve((l >> 4) / 15) * scene.dayLight, curve((l & 15) / 15))
      return scene.ambient + (1 - scene.ambient) * b
    })

    // first-person hand
    const held = heldItem(this.store.get())
    const heldName = held && !this.store.get().hideHud ? held.name : null
    if (heldName !== this.handItem) {
      this.handItem = heldName
      this.handEquipAt = now
      scene.setHandItem(heldName ? itemIconCanvas(heldName) : null)
    }
    const hl = world.getLight(Math.floor(pos.x), Math.floor(pos.y + 1), Math.floor(pos.z))
    const hb = scene.ambient + (1 - scene.ambient) * Math.max(curve((hl >> 4) / 15) * scene.dayLight, curve((hl & 15) / 15))
    scene.updateHand(Math.min(1, Math.max(0, (now - this.handSwingAt) / 260)) % 1, Math.sin(this.bob) * 0.012 * this.bobAmp, -Math.abs(Math.cos(this.bob)) * 0.012 * this.bobAmp, 0.35 + hb * 0.65, Math.min(1, (now - this.handEquipAt) / 180))

    this.updateTarget(now)
    scene.render()
  }

  private updateTarget (now: number) {
    const scene = this.scene!; const world = this.world!; const reg = this.reg!
    const cam = scene.camera
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation)
    const reach = this.gameMode === 'creative' ? REACH_CREATIVE : REACH_SURVIVAL
    let hit: BlockHit | null = null
    let ent: { id: number, dist: number } | null = null
    if (this.store.get().phase === 'playing' && !this.store.get().dead) {
      hit = raycastBlocks(reg, (x, y, z) => world.getBlock(x, y, z), cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, reach)
      ent = this.entities!.raycast(cam.position, dir, hit ? Math.min(hit.dist, 3.2) : 3.2)
    }
    this.targetEntity = ent ? ent.id : null
    if (ent) hit = null
    const changed = (hit?.x !== this.target?.x) || (hit?.y !== this.target?.y) || (hit?.z !== this.target?.z) || (hit?.state !== this.target?.state)
    this.target = hit
    if (changed) {
      const outline = this.outline!
      if (hit) {
        const pts: number[] = []
        const e = 0.003
        for (const b of hit.boxes) {
          const x0 = b[0] - e; const y0 = b[1] - e; const z0 = b[2] - e; const x1 = b[3] + e; const y1 = b[4] + e; const z1 = b[5] + e
          const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]
          for (const [a, bb] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(...c[a], ...c[bb])
        }
        outline.geometry.dispose()
        outline.geometry = new THREE.BufferGeometry()
        outline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        outline.position.set(hit.x, hit.y, hit.z)
        outline.visible = true
        const block = reg.data.blocks[reg.blockOfState[hit.state]]
        this.store.set({ target: block ? block.n : '' })
      } else {
        outline.visible = false
        this.store.set({ target: ent ? (this.entities!.get(ent.id)?.username ?? this.entities!.get(ent.id)?.name ?? '') : '' })
      }
    }

    // continuous digging
    if (this.leftDown && this.playing) {
      if (this.dig) {
        if (!hit || hit.x !== this.dig.x || hit.y !== this.dig.y || hit.z !== this.dig.z) {
          this.stopDig()
          if (hit && now >= this.digCooldown) this.startDig(hit)
        }
      } else if (hit && now >= this.digCooldown && this.targetEntity == null) this.startDig(hit)
    }
    if (this.dig && this.crack) {
      const p = this.dig.timeMs > 0 && this.dig.timeMs < 1e8 ? Math.min(1, (now - this.dig.start) / this.dig.timeMs) : 0
      this.store.set({ digProgress: p })
      if (p > 0.02) {
        this.crack.visible = true
        this.crack.position.set(this.dig.x + 0.5, this.dig.y + 0.5, this.dig.z + 0.5)
        ;(this.crack.material as THREE.MeshBasicMaterial).map = this.crackTextures[Math.min(7, Math.floor(p * 8))]
      }
    }
    // held right button repeats placement
    if (this.rightDown && this.playing && now - this.lastUse > 260) {
      const held = heldItem(this.store.get())
      if (held && this.reg?.blockByName.has(held.name) && this.target) this.secondaryAction()
    }
  }

  private updateDebug () {
    const world = this.world; const scene = this.scene
    if (!world || !scene) return
    const st = world.stats()
    const p = this.curr
    const info = scene.renderer.info
    const facing = ['south (+Z)', 'west (-X)', 'north (-Z)', 'east (+X)'][((Math.round(-this.yaw / (Math.PI / 2)) % 4) + 6) % 4]
    const mem = (performance as any).memory
    const t = this.target
    const tb = t && this.reg ? this.reg.data.blocks[this.reg.blockOfState[t.state]]?.n : null
    this.store.set({
      debug: [
        `Vassago ${__APP_VERSION__} — protocol ${this.version}`,
        `${this.fps} fps  ·  ${info.render.calls} draw calls  ·  ${(info.render.triangles / 1000).toFixed(1)}k tris`,
        `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
        `Chunk: ${Math.floor(p.x) >> 4}, ${Math.floor(p.z) >> 4}  ·  Facing: ${facing}`,
        `Chunks: ${st.columns} loaded  ·  ${st.sectionsMeshed} sections meshed  ·  queue ${st.queue}`,
        `Mesher: ${st.workers} workers  ·  ${st.meshMsAvg.toFixed(2)} ms avg  ·  ${(st.triangles / 1000).toFixed(0)}k tris total`,
        `Entities: ${this.entities?.count ?? 0}  ·  Dimension: ${this.env.dimension}  ·  Mode: ${this.gameMode}`,
        `Time: ${Math.floor(this.env.timeOfDay)}${this.env.raining ? '  ·  rain' : ''}  ·  Light: ${(() => { const l = world.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)); return `sky ${l >> 4} block ${l & 15}` })()}`,
        tb ? `Target: ${tb} @ ${t!.x}, ${t!.y}, ${t!.z}` : 'Target: —',
        mem ? `Memory: ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB JS heap  ·  GPU: ${info.memory.geometries} geometries, ${info.memory.textures} textures` : ''
      ].filter(Boolean)
    })
  }

  // --------------------------------------------------------- test/debug API

  /** Snapshot used by the debug overlay and end-to-end tests. */
  debugState () {
    return {
      pos: { x: this.curr.x, y: this.curr.y, z: this.curr.z },
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround,
      fps: this.fps,
      world: this.world?.stats() ?? null,
      entities: this.entities?.count ?? 0,
      target: this.target ? { x: this.target.x, y: this.target.y, z: this.target.z, face: this.target.face } : null,
      gameMode: this.gameMode,
      draw: this.scene ? { calls: this.scene.renderer.info.render.calls, triangles: this.scene.renderer.info.render.triangles } : null
    }
  }

  setLook (yaw: number, pitch: number) { this.yaw = yaw; this.pitch = pitch; this.lookDirty = true }
  setControls (c: Partial<Controls>) { this.controls = { ...this.controls, ...c }; this.sendControls() }
}

function sprintingNow (c: Controls, latch: boolean) { return (c.sprint || latch) && c.forward }

declare const __APP_VERSION__: string
