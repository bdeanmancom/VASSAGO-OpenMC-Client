/**
 * GameSession — the headless protocol + gameplay core.
 *
 * It owns one server connection (via mineflayer / minecraft-protocol), simulates the
 * local player at 20 TPS, tracks world/entity/inventory state and translates everything
 * into the compact message protocol defined in shared/protocol.ts. It has no dependency
 * on Electron or the DOM so it can run in a worker thread or directly inside tests.
 */
import type {
  ConnectOptions, Controls, EntityDTO, EntityMove, ItemDTO, SectionDTO, SessionCommand,
  SessionEvent, WindowDTO
} from '../shared/protocol'
import { FACE_VECTORS } from '../shared/protocol'
import { resolveVersion } from './versions'
import { describeDisconnect } from './errors'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mineflayer = require('mineflayer')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Vec3 } = require('vec3')

export interface SecureStore {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
}

export interface SessionHost {
  emit: (ev: SessionEvent, transfer?: ArrayBuffer[]) => void
  /** Encrypted-at-rest storage for Microsoft account tokens. */
  secureStore?: SecureStore
}

const CONNECT_TIMEOUT_MS = 30000

export class GameSession {
  private bot: any = null
  private opts: ConnectOptions | null = null
  private ended = true
  private tick = 0
  private dirtyEntities = new Set<number>()
  private windowDirty = false
  private flushTimer: NodeJS.Timeout | null = null
  private connectTimer: NodeJS.Timeout | null = null
  private pendingBlocks: number[] = []
  private pendingLight = new Set<string>()
  private digging = false
  private flying = false
  private controls: Controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  private sequence = 0
  private loggedIn = false
  private pendingPacks: { uuid?: string, hash?: string }[] = []
  private lastReason: { reason: string, kicked: boolean } | null = null
  private chatMessage: any = null
  private spawned = false
  private chatMessageFor: any = null

  constructor (private readonly host: SessionHost) {}

  private emit (ev: SessionEvent, transfer?: ArrayBuffer[]) { this.host.emit(ev, transfer) }
  private log (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown) { this.emit({ t: 'log', level, msg, data }) }

  handle (cmd: SessionCommand): void {
    try {
      this.dispatch(cmd)
    } catch (err: any) {
      this.log('warn', `command ${cmd.t} failed: ${err?.message ?? err}`)
    }
  }

  private dispatch (cmd: SessionCommand): void {
    if (cmd.t === 'connect') { void this.connect(cmd.opts); return }
    if (cmd.t === 'disconnect') { this.disconnect('Disconnected'); return }
    const bot = this.bot
    if (!bot || this.ended) return
    if (cmd.t === 'resourcePack') { this.answerResourcePack(cmd.accept); return }
    if (!this.loggedIn) return
    switch (cmd.t) {
      case 'controls': this.applyControls(cmd.c); break
      case 'look': bot.look(cmd.yaw, cmd.pitch, true).catch(() => {}); break
      case 'chat': {
        const text = cmd.text.slice(0, 256)
        if (text.trim().length > 0) bot.chat(text)
        break
      }
      case 'digStart': this.digStart(cmd.x, cmd.y, cmd.z, cmd.face); break
      case 'digCancel': this.digCancel(); break
      case 'useBlock': this.useBlock(cmd); break
      case 'useItem': bot.activateItem(false); break
      case 'useItemRelease': bot.deactivateItem(); break
      case 'attack': { const e = bot.entities[cmd.id]; if (e) bot.attack(e); break }
      case 'interactEntity': { const e = bot.entities[cmd.id]; if (e) bot.useOn(e); break }
      case 'swing': bot.swingArm('right'); break
      case 'hotbar': if (cmd.slot >= 0 && cmd.slot <= 8) { bot.setQuickBarSlot(cmd.slot); this.windowDirty = true } break
      case 'windowClick': this.windowClick(cmd.slot, cmd.button, cmd.mode); break
      case 'windowClose': if (bot.currentWindow) bot.closeWindow(bot.currentWindow); this.windowDirty = true; break
      case 'drop': this.dropHeld(cmd.stack); break
      case 'respawn': bot.respawn(); break
      case 'viewDistance': bot.setSettings({ viewDistance: cmd.chunks }); break
      case 'fly': this.setFlying(cmd.flying); break
    }
  }

  // ---------------------------------------------------------------- connect

  async connect (opts: ConnectOptions): Promise<void> {
    if (this.bot) this.teardown()
    this.opts = opts
    this.ended = false
    this.loggedIn = false
    this.spawned = false
    this.lastReason = null
    this.tick = 0
    this.emit({ t: 'phase', phase: opts.auth === 'microsoft' ? 'authenticating' : 'connecting', detail: `${opts.host}:${opts.port}` })

    let version: string
    try {
      version = await resolveVersion(opts.host, opts.port, opts.version)
    } catch (err: any) {
      this.finish(describeDisconnect(err), false)
      return
    }
    if (this.ended) return
    this.log('info', `connecting to ${opts.host}:${opts.port} as ${opts.username} (${opts.auth}), version ${version}`)

    const botOptions: any = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      version,
      auth: opts.auth,
      viewDistance: opts.viewDistance,
      hideErrors: true,
      logErrors: false,
      checkTimeoutInterval: 30000,
      brand: 'vassago',
      respawn: false,
      // The stock plugin auto-accepts packs during configuration; we ask the user instead.
      plugins: { resource_pack: false }
    }
    if (opts.auth === 'microsoft') {
      botOptions.onMsaCode = (data: any) => {
        this.emit({ t: 'msaCode', userCode: data.user_code, verificationUri: data.verification_uri, expiresIn: data.expires_in })
      }
      botOptions.profilesFolder = this.makeTokenCache()
      if (opts.msaClientId) { botOptions.authTitle = opts.msaClientId; botOptions.flow = 'msal' }
    }

    let bot: any
    try {
      bot = mineflayer.createBot(botOptions)
    } catch (err: any) {
      this.finish(describeDisconnect(err), false)
      return
    }
    this.bot = bot
    this.connectTimer = setTimeout(() => {
      if (!this.loggedIn && opts.auth !== 'microsoft') {
        this.lastReason = { reason: 'Connection timed out — the server did not respond in time.', kicked: false }
        try { bot.end('timeout') } catch {}
        this.finish(this.lastReason.reason, false)
      }
    }, CONNECT_TIMEOUT_MS)
    this.wire(bot)
  }

  /** prismarine-auth cache backed by the host's encrypted store instead of plain files. */
  private makeTokenCache () {
    const store = this.host.secureStore
    const mem = new Map<string, any>()
    return ({ cacheName, username }: { cacheName: string, username: string }) => {
      const key = `msa:${username}:${cacheName}`
      const load = async () => {
        if (mem.has(key)) return mem.get(key)
        let v: any = {}
        try { const raw = await store?.get(key); if (raw) v = JSON.parse(raw) } catch {}
        mem.set(key, v)
        return v
      }
      const save = async (v: any) => { mem.set(key, v); await store?.set(key, JSON.stringify(v)) }
      return {
        async reset () { await save({}) },
        async getCached () { return await load() },
        async setCached (v: any) { await save(v) },
        async setCachedPartial (v: any) { await save({ ...(await load()), ...v }) }
      }
    }
  }

  private wire (bot: any) {
    const client = bot._client
    const guard = <T extends any[]>(fn: (...a: T) => void) => (...a: T) => {
      if (this.bot !== bot) return
      try { fn(...a) } catch (err: any) { this.log('warn', `event handler error: ${err?.stack ?? err}`) }
    }

    client.on('connect', guard(() => this.emit({ t: 'phase', phase: 'login' })))
    client.on('state', guard((state: string) => {
      if (state === 'configuration') this.emit({ t: 'phase', phase: 'login', detail: 'Configuring…' })
    }))

    bot.once('login', guard(() => {
      this.loggedIn = true
      if (this.connectTimer) clearTimeout(this.connectTimer)
      this.emit({
        t: 'login',
        entityId: bot.entity?.id ?? 0,
        username: bot.username,
        uuid: bot.player?.uuid ?? client.uuid ?? '',
        version: bot.version,
        protocol: bot.protocolVersion,
        gameMode: bot.game.gameMode,
        dimension: bot.game.dimension,
        minY: bot.game.minY ?? 0,
        height: bot.game.height ?? 256,
        brand: bot.game.serverBrand
      })
      this.emit({ t: 'phase', phase: 'loading', detail: 'Loading terrain…' })
      this.flushTimer = setInterval(() => this.flush(), 50)
    }))

    bot.on('spawn', guard(() => {
      this.spawned = true
      this.emit({ t: 'phase', phase: 'playing' })
      this.emit({ t: 'forcedLook', yaw: bot.entity.yaw, pitch: bot.entity.pitch })
      this.emitHealth()
      this.windowDirty = true
      this.emitPlayers()
      this.emitTime()
    }))

    bot.on('respawn', guard(() => {
      this.emit({ t: 'respawn', dimension: bot.game.dimension, minY: bot.game.minY ?? 0, height: bot.game.height ?? 256, gameMode: bot.game.gameMode })
    }))
    bot.on('game', guard(() => {
      this.emit({ t: 'gameMode', gameMode: bot.game.gameMode })
      if (bot.game.gameMode !== 'creative' && bot.game.gameMode !== 'spectator' && this.flying) this.setFlying(false)
    }))

    // --- world
    bot.on('chunkColumnLoad', guard((pos: any) => this.sendChunk(pos.x >> 4, pos.z >> 4)))
    bot.on('chunkColumnUnload', guard((pos: any) => this.emit({ t: 'unloadChunk', x: pos.x >> 4, z: pos.z >> 4 })))
    client.on('block_change', guard((p: any) => {
      this.pendingBlocks.push(p.location.x, p.location.y, p.location.z, p.type)
    }))
    client.on('multi_block_change', guard((p: any) => {
      if (!p.chunkCoordinates) return
      const { x: cx, y: cy, z: cz } = p.chunkCoordinates
      for (const rec of p.records) {
        const r = typeof rec === 'bigint' ? Number(rec) : rec
        const state = Math.floor(r / 4096)
        const local = r & 0xfff
        this.pendingBlocks.push((cx << 4) + ((local >> 8) & 15), (cy << 4) + (local & 15), (cz << 4) + ((local >> 4) & 15), state)
      }
    }))
    client.on('update_light', guard((p: any) => this.pendingLight.add(`${p.chunkX},${p.chunkZ}`)))

    // --- self
    bot.on('physicsTick', guard(() => {
      this.tick++
      if (this.flying) this.flyTick()
      const e = bot.entity
      this.emit({ t: 'self', x: e.position.x, y: e.position.y, z: e.position.z, vx: e.velocity.x, vy: e.velocity.y, vz: e.velocity.z, onGround: e.onGround, inWater: !!e.isInWater, tick: this.tick })
    }))
    bot.on('forcedMove', guard(() => this.emit({ t: 'forcedLook', yaw: bot.entity.yaw, pitch: bot.entity.pitch })))
    bot.on('health', guard(() => this.emitHealth()))
    bot.on('experience', guard(() => this.emit({ t: 'experience', level: bot.experience.level, progress: bot.experience.progress })))
    bot.on('death', guard(() => {
      // Logging in while dead never produces a 'spawn'; enter the world anyway so the
      // front-end can show the death screen and offer to respawn.
      if (!this.spawned) { this.spawned = true; this.emit({ t: 'phase', phase: 'playing' }); this.windowDirty = true; this.emitPlayers(); this.emitTime() }
      this.emitHealth()
      this.emit({ t: 'death' })
    }))
    bot.on('entityHurt', guard((e: any) => {
      if (e === bot.entity) this.emit({ t: 'hurt' })
      else this.emit({ t: 'entityAnim', id: e.id, anim: 'hurt' })
    }))
    bot.on('entitySwingArm', guard((e: any) => { if (e !== bot.entity) this.emit({ t: 'entityAnim', id: e.id, anim: 'swing' }) }))

    // --- entities
    bot.on('entitySpawn', guard((e: any) => { if (e !== bot.entity) this.emit({ t: 'entitySpawn', e: this.entityDTO(e) }) }))
    bot.on('entityGone', guard((e: any) => { this.dirtyEntities.delete(e.id); this.emit({ t: 'entityGone', id: e.id }) }))
    bot.on('entityMoved', guard((e: any) => { if (e !== bot.entity) this.dirtyEntities.add(e.id) }))
    const upd = guard((e: any) => { if (e !== bot.entity && e) this.emit({ t: 'entityUpdate', e: this.entityDTO(e) }) })
    bot.on('entityUpdate', upd)
    bot.on('entityEquip', upd)
    bot.on('entityCrouch', upd)
    bot.on('entityUncrouch', upd)
    bot.on('itemDrop', upd)

    // --- chat & ui
    bot.on('message', guard((msg: any, position: string) => {
      const kind = position === 'game_info' ? 'actionbar' : position === 'system' ? 'system' : 'chat'
      this.emit({ t: 'chat', motd: safeMotd(msg), plain: String(msg.toString?.() ?? msg), kind })
    }))
    bot.on('actionBar', guard((msg: any) => this.emit({ t: 'chat', motd: safeMotd(msg), plain: String(msg.toString?.() ?? msg), kind: 'actionbar' })))
    bot.on('title', guard((text: any, type: string) => this.emit({ t: 'title', text: this.text(text), subtitle: type === 'subtitle' })))
    bot.on('time', guard(() => this.emitTime()))
    bot.on('rain', guard(() => this.emitTime()))
    bot.on('playerJoined', guard(() => this.emitPlayers()))
    bot.on('playerLeft', guard(() => this.emitPlayers()))
    bot.on('playerUpdated', guard(() => this.emitPlayers()))
    const onPack = guard((p: any) => {
      this.pendingPacks.push({ uuid: p.uuid, hash: p.hash })
      this.emit({ t: 'resourcePack', url: String(p.url), forced: !!p.forced, prompt: p.promptMessage ? this.text(p.promptMessage) : undefined })
    })
    client.on('add_resource_pack', onPack)
    client.on('resource_pack_send', onPack)

    // --- inventory / windows
    const markWindow = guard(() => { this.windowDirty = true })
    bot.once('inject_allowed', guard(() => { bot.inventory.on('updateSlot', markWindow) }))
    bot.on('heldItemChanged', markWindow)
    bot.on('windowOpen', guard((w: any) => {
      w.on('updateSlot', markWindow)
      this.windowDirty = true
    }))
    bot.on('windowClose', guard(() => { this.emit({ t: 'windowClose' }); this.windowDirty = true }))

    // --- digging feedback
    bot.on('diggingCompleted', guard((b: any) => { this.digging = false; this.emit({ t: 'dig', x: b.position.x, y: b.position.y, z: b.position.z, state: 'done', timeMs: 0 }) }))
    bot.on('diggingAborted', guard((b: any) => { this.digging = false; this.emit({ t: 'dig', x: b.position.x, y: b.position.y, z: b.position.z, state: 'cancel', timeMs: 0 }) }))

    // --- lifecycle
    bot.on('kicked', guard((reason: any) => {
      this.lastReason = { reason: this.text(reason) || 'Kicked by server', kicked: true }
    }))
    bot.on('error', guard((err: any) => {
      this.log('warn', `connection error: ${err?.message ?? err}`)
      if (!this.lastReason) this.lastReason = { reason: describeDisconnect(err), kicked: false }
      if (!this.loggedIn) { this.finish(this.lastReason.reason, false) }
    }))
    bot.on('end', guard((why: string) => {
      const r = this.lastReason ?? { reason: describeDisconnect(why), kicked: false }
      this.finish(r.reason, r.kicked)
    }))
  }

  private finish (reason: string, kicked: boolean) {
    if (this.ended) return
    this.ended = true
    const wasBot = this.bot
    this.teardown()
    if (wasBot) { try { wasBot.end() } catch {} }
    this.emit({ t: 'disconnect', reason, kicked, canReconnect: !!this.opts })
    this.emit({ t: 'phase', phase: 'disconnected', detail: reason })
  }

  disconnect (reason: string) {
    if (this.ended) return
    this.lastReason = { reason, kicked: false }
    const bot = this.bot
    this.finish(reason, false)
    try { bot?.quit?.(reason) } catch {}
  }

  private teardown () {
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.flushTimer = null
    this.connectTimer = null
    const bot = this.bot
    this.bot = null
    this.loggedIn = false
    this.dirtyEntities.clear()
    this.pendingBlocks = []
    this.pendingLight.clear()
    this.flying = false
    this.digging = false
    this.pendingPacks = []
    if (bot) {
      try { bot.removeAllListeners() } catch {}
      try { bot._client.removeAllListeners('block_change'); bot._client.removeAllListeners('multi_block_change') } catch {}
      // Keep an error sink so late socket errors never crash the host process.
      try { bot._client.on('error', () => {}); bot.on('error', () => {}) } catch {}
      try { bot._client.end() } catch {}
    }
  }

  // ------------------------------------------------------------------ flush

  private flush () {
    const bot = this.bot
    if (!bot) return
    if (this.pendingBlocks.length > 0) {
      const arr = Int32Array.from(this.pendingBlocks)
      this.pendingBlocks = []
      this.emit({ t: 'blocks', updates: arr }, [arr.buffer as ArrayBuffer])
    }
    if (this.pendingLight.size > 0) {
      for (const key of this.pendingLight) {
        const [x, z] = key.split(',').map(Number)
        this.sendLight(x, z)
      }
      this.pendingLight.clear()
    }
    if (this.dirtyEntities.size > 0) {
      const moves: EntityMove[] = []
      for (const id of this.dirtyEntities) {
        const e = bot.entities[id]
        if (!e) continue
        moves.push({ id, x: e.position.x, y: e.position.y, z: e.position.z, yaw: e.yaw ?? 0, pitch: e.pitch ?? 0, headYaw: e.headYaw })
      }
      this.dirtyEntities.clear()
      if (moves.length > 0) this.emit({ t: 'entityMoves', moves })
    }
    if (this.windowDirty) {
      this.windowDirty = false
      this.emit({ t: 'window', w: this.windowDTO() })
    }
  }

  // ------------------------------------------------------------------ world

  private sectionLight (column: any, i: number): Uint8Array | number {
    const sky = column.skyLightSections?.[i + 1]
    const blk = column.blockLightSections?.[i + 1]
    if (!sky && !blk) return -1 // unknown: front-end infers from neighbours
    const out = new Uint8Array(4096)
    for (let n = 0; n < 4096; n++) out[n] = ((sky ? sky.get(n) : 0) << 4) | (blk ? blk.get(n) : 0)
    return out
  }

  private sendChunk (cx: number, cz: number) {
    const column = this.bot.world.getColumn(cx, cz)
    if (!column) return
    const minY: number = column.minY ?? 0
    const sections: SectionDTO[] = []
    const transfer: ArrayBuffer[] = []
    const n = column.sections.length
    for (let i = 0; i < n; i++) {
      const sec = column.sections[i]
      let blocks: Uint16Array | null = null
      if (sec) {
        const data = sec.data
        if (data && data.value !== undefined && data.palette === undefined) {
          if (data.value !== 0) blocks = new Uint16Array(4096).fill(data.value)
        } else if (data) {
          blocks = new Uint16Array(4096)
          let any = false
          for (let k = 0; k < 4096; k++) { const v = data.get(k); blocks[k] = v; if (v !== 0) any = true }
          if (!any) blocks = null
        }
      }
      const light = this.sectionLight(column, i)
      if (blocks) transfer.push(blocks.buffer as ArrayBuffer)
      if (typeof light !== 'number') transfer.push(light.buffer as ArrayBuffer)
      sections.push({ blocks, light })
    }
    this.emit({ t: 'chunk', x: cx, z: cz, minY, sections }, transfer)
  }

  private sendLight (cx: number, cz: number) {
    const column = this.bot.world.getColumn(cx, cz)
    if (!column) return
    const light: (Uint8Array | number)[] = []
    const transfer: ArrayBuffer[] = []
    for (let i = 0; i < column.sections.length; i++) {
      const l = this.sectionLight(column, i)
      if (typeof l !== 'number') transfer.push(l.buffer as ArrayBuffer)
      light.push(l)
    }
    this.emit({ t: 'chunkLight', x: cx, z: cz, light }, transfer)
  }

  // --------------------------------------------------------------- controls

  private applyControls (c: Controls) {
    const bot = this.bot
    this.controls = c
    bot.setControlState('forward', c.forward)
    bot.setControlState('back', c.back)
    bot.setControlState('left', c.left)
    bot.setControlState('right', c.right)
    bot.setControlState('sprint', c.sprint)
    if (this.flying) {
      bot.setControlState('jump', false)
      bot.setControlState('sneak', false)
    } else {
      bot.setControlState('jump', c.jump)
      bot.setControlState('sneak', c.sneak)
    }
  }

  private setFlying (on: boolean) {
    const bot = this.bot
    const mode = bot.game.gameMode
    if (on && mode !== 'creative' && mode !== 'spectator') return
    if (on === this.flying) return
    this.flying = on
    bot.physics.gravity = on ? 0 : 0.08
    try { bot._client.write('abilities', { flags: on ? 2 : 0 }) } catch {}
    this.applyControls(this.controls)
  }

  /** Simple creative flight: gravity is disabled and vertical speed follows jump/sneak. */
  private flyTick () {
    const bot = this.bot
    const c = this.controls
    const v = bot.entity.velocity
    const target = (c.jump ? 0.42 : 0) - (c.sneak ? 0.42 : 0)
    v.y = v.y * 0.6 + target * 0.4
    const boost = c.sprint ? 1.9 : 1.45
    if (c.forward || c.back || c.left || c.right) { v.x *= boost; v.z *= boost } else { v.x *= 0.9; v.z *= 0.9 } // extra air-brake when idle
    const max = c.sprint ? 1.1 : 0.55
    const h = Math.hypot(v.x, v.z)
    if (h > max) { v.x *= max / h; v.z *= max / h }
    if (bot.entity.onGround && !c.jump && this.tick > 5) this.setFlying(false)
  }

  /**
   * Answer the oldest pending server resource-pack offer. Packs are only ever
   * acknowledged after explicit user consent. (Vassago renders with its own original
   * art, so an accepted pack is acknowledged to the server but not applied visually.)
   */
  private answerResourcePack (accept: boolean) {
    const pack = this.pendingPacks.shift()
    if (!pack || !this.bot) return
    const client = this.bot._client
    const send = (result: number) => {
      const body: any = { result }
      if (pack.uuid !== undefined) body.uuid = pack.uuid
      else if (this.bot.supportFeature('resourcePackUsesHash')) body.hash = pack.hash
      client.write('resource_pack_receive', body)
    }
    if (accept) { send(3); send(0) } else send(1)
  }

  // ------------------------------------------------------------ interaction

  private digStart (x: number, y: number, z: number, face: number) {
    const bot = this.bot
    const block = bot.blockAt(new Vec3(x, y, z))
    if (!block || block.name === 'air') return
    if (this.digging) { try { bot.stopDigging() } catch {} }
    const fv = FACE_VECTORS[face] ?? FACE_VECTORS[1]
    let timeMs = 0
    try { timeMs = bot.digTime(block) } catch {}
    if (!bot.canDigBlock(block) && bot.game.gameMode !== 'creative') {
      if (block.position.distanceTo(bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0)) > 6.5) return
    }
    if (!Number.isFinite(timeMs)) return // unbreakable
    this.digging = true
    this.emit({ t: 'dig', x, y, z, state: 'start', timeMs })
    bot.dig(block, 'ignore', new Vec3(fv[0], fv[1], fv[2])).catch(() => { this.digging = false })
  }

  private digCancel () {
    if (!this.digging) return
    this.digging = false
    try { this.bot.stopDigging() } catch {}
  }

  private useBlock (cmd: { x: number, y: number, z: number, face: number, cx: number, cy: number, cz: number }) {
    const bot = this.bot
    const client = bot._client
    this.sequence++
    bot.swingArm('right')
    const packet: any = {
      hand: 0,
      location: new Vec3(cmd.x, cmd.y, cmd.z),
      direction: cmd.face,
      cursorX: cmd.cx,
      cursorY: cmd.cy,
      cursorZ: cmd.cz,
      insideBlock: false,
      worldBorderHit: false,
      sequence: this.sequence
    }
    client.write('block_place', packet)
  }

  private windowClick (slot: number, button: number, mode: number) {
    const bot = this.bot
    if (mode < 0 || mode > 4) return
    const w = bot.currentWindow ?? bot.inventory
    const gridSize = this.craftingGridSize(w)
    const takesCraftResult = gridSize > 0 && slot === 0 && mode === 0 && !!w.slots[0]
    bot.clickWindow(slot, button, mode).then(() => {
      // Before 1.21.5 the server does not echo the consumed ingredients after a craft;
      // the client is expected to predict them (the vanilla client does the same).
      if (takesCraftResult && bot.registry.isOlderThan('1.21.5')) {
        for (let i = 1; i <= gridSize; i++) {
          const it = w.slots[i]
          if (!it) continue
          if (it.count > 1) { it.count--; w.updateSlot(i, it) } else w.updateSlot(i, null)
        }
      }
      this.windowDirty = true
    }).catch((err: any) => {
      this.log('debug', `window click rejected: ${err?.message ?? err}`)
      this.windowDirty = true
    })
    this.windowDirty = true
  }

  /** Number of crafting-grid slots following result slot 0, or 0 when the window is not a crafting window. */
  private craftingGridSize (w: any): number {
    if (w === this.bot.inventory) return 4
    const type = String(w.type ?? '')
    return type.includes('crafting') ? 9 : 0
  }

  private dropHeld (stack: boolean) {
    const bot = this.bot
    const item = bot.heldItem
    if (!item) return
    const p = stack ? bot.tossStack(item) : bot.toss(item.type, item.metadata ?? null, 1)
    Promise.resolve(p).catch(() => {}).finally(() => { this.windowDirty = true })
  }

  // ------------------------------------------------------------------- DTOs

  private itemDTO (item: any): ItemDTO | null {
    if (!item) return null
    let enchanted = false
    try { enchanted = (item.enchants?.length ?? 0) > 0 } catch {}
    let customName: string | undefined
    try { const cn = item.customName; if (cn) customName = this.text(cn) } catch {}
    let damage: number | undefined
    try { damage = item.durabilityUsed || undefined } catch {}
    return {
      id: item.type,
      name: item.name,
      displayName: item.displayName ?? item.name,
      count: item.count,
      stackSize: item.stackSize ?? 64,
      damage,
      maxDamage: item.maxDurability || undefined,
      enchanted: enchanted || undefined,
      customName
    }
  }

  private entityDTO (e: any): EntityDTO {
    let held: ItemDTO | null = null
    try {
      if (e.name === 'item' && typeof e.getDroppedItem === 'function') held = this.itemDTO(e.getDroppedItem())
      else if (e.equipment?.[0]) held = this.itemDTO(e.equipment[0])
    } catch {}
    return {
      id: e.id,
      name: e.name ?? e.type ?? 'unknown',
      kind: e.type ?? 'other',
      username: e.username,
      uuid: e.uuid,
      x: e.position.x,
      y: e.position.y,
      z: e.position.z,
      yaw: e.yaw ?? 0,
      pitch: e.pitch ?? 0,
      width: e.width ?? 0.6,
      height: e.height ?? 1.8,
      sneaking: e.crouching || undefined,
      heldItem: held
    }
  }

  private windowDTO (): WindowDTO {
    const bot = this.bot
    const w = bot.currentWindow ?? bot.inventory
    const isInv = w === bot.inventory
    return {
      id: w.id,
      type: isInv ? 'inventory' : String(w.type),
      title: isInv ? 'Inventory' : this.text(w.title),
      inventoryStart: isInv ? 9 : w.inventoryStart,
      slots: w.slots.map((it: any) => this.itemDTO(it)),
      cursor: this.itemDTO(w.selectedItem),
      hotbar: bot.quickBarSlot ?? 0
    }
  }

  /**
   * Flatten any chat component (JSON string, NBT, object) to plain text, translating
   * language keys through the protocol library's tables when available.
   */
  private text (v: any): string {
    if (v == null) return ''
    const known = knownKey(v)
    if (known) return known
    try {
      const bot = this.bot
      if (bot?.registry) {
        if (!this.chatMessage || this.chatMessageFor !== bot.registry) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          this.chatMessage = require('prismarine-chat')(bot.registry)
          this.chatMessageFor = bot.registry
        }
        const CM = this.chatMessage
        let input = v
        if (typeof input === 'string' && (input.startsWith('{') || input.startsWith('[') || input.startsWith('"'))) { try { input = JSON.parse(input) } catch {} }
        const msg = typeof CM.fromNotch === 'function' ? CM.fromNotch(input) : new CM(input)
        const out = String(msg.toString())
        if (out.length > 0) return out
      }
    } catch {}
    return titleText(v)
  }

  private emitHealth () {
    const bot = this.bot
    this.emit({ t: 'health', health: bot.health ?? 20, food: bot.food ?? 20, saturation: bot.foodSaturation ?? 0 })
  }

  private emitTime () {
    const bot = this.bot
    this.emit({ t: 'time', timeOfDay: bot.time?.timeOfDay ?? 6000, day: bot.time?.day ?? 0, raining: !!bot.isRaining })
  }

  private emitPlayers () {
    const bot = this.bot
    const players = Object.values<any>(bot.players ?? {}).map(p => ({
      uuid: p.uuid, username: p.username, ping: p.ping ?? 0, gamemode: p.gamemode ?? 0
    }))
    this.emit({ t: 'players', players })
  }
}

function safeMotd (msg: any): string {
  try { return String(msg.toMotd()) } catch { return String(msg) }
}

/** Flatten a chat component / NBT component / JSON string to plain text. */
export function titleText (v: any): string {
  if (v == null) return ''
  if (typeof v === 'string') {
    if (v.startsWith('{') || v.startsWith('"') || v.startsWith('[')) {
      try { return titleText(JSON.parse(v)) } catch { return v }
    }
    return v
  }
  if (typeof v.toString === 'function' && v.constructor?.name === 'ChatMessage') return v.toString()
  if (Array.isArray(v)) return v.map(titleText).join('')
  if (typeof v === 'object') {
    // prismarine-nbt tagged value
    if ('type' in v && 'value' in v && Object.keys(v).length <= 3) return titleText(v.value)
    let out = ''
    if (v.text != null) out += titleText(v.text)
    else if (v[''] != null) out += titleText(v[''])
    else if (v.translate != null) {
      const key = titleText(v.translate)
      const args = v.with ? (Array.isArray(v.with) ? v.with : (v.with.value?.value ?? v.with.value ?? [])) : []
      out += KNOWN_KEYS[key] ?? (v.fallback ? titleText(v.fallback) : key)
      if (!KNOWN_KEYS[key] && args.length) out += ' ' + args.map(titleText).join(' ')
    }
    if (v.extra) {
      const extra = Array.isArray(v.extra) ? v.extra : (v.extra.value?.value ?? v.extra.value ?? [])
      if (Array.isArray(extra)) out += extra.map(titleText).join('')
    }
    return out
  }
  return String(v)
}

/** Our own wording for a few well-known disconnect keys (more actionable than the stock text). */
function knownKey (v: any): string | null {
  let o = v
  if (typeof o === 'string') {
    if (!o.startsWith('{')) return KNOWN_KEYS[o] ?? null
    try { o = JSON.parse(o) } catch { return null }
  }
  if (o && typeof o === 'object') {
    if ('type' in o && 'value' in o && o.type === 'compound') o = o.value
    let key = o.translate
    if (key && typeof key === 'object' && 'value' in key) key = key.value
    if (typeof key === 'string' && KNOWN_KEYS[key]) return KNOWN_KEYS[key]
  }
  return null
}

const KNOWN_KEYS: Record<string, string> = {
  'multiplayer.disconnect.kicked': 'Kicked by an operator',
  'multiplayer.disconnect.banned': 'You are banned from this server',
  'multiplayer.disconnect.server_full': 'The server is full',
  'multiplayer.disconnect.server_shutdown': 'Server closed',
  'multiplayer.disconnect.not_whitelisted': 'You are not white-listed on this server',
  'multiplayer.disconnect.duplicate_login': 'You logged in from another location',
  'multiplayer.disconnect.unverified_username': 'Failed to verify username — this server requires a signed-in Microsoft account (online mode).',
  'multiplayer.disconnect.outdated_client': 'Outdated client — the server runs a newer version',
  'multiplayer.disconnect.incompatible': 'Incompatible client version',
  'multiplayer.disconnect.idling': 'You have been idle for too long',
  'multiplayer.disconnect.flying': 'Flying is not enabled on this server',
  'multiplayer.disconnect.name_taken': 'That name is already taken',
  'multiplayer.requiredTexturePrompt.disconnect': 'This server requires its resource pack',
  'disconnect.timeout': 'Timed out',
  'disconnect.loginFailedInfo.invalidSession': 'Invalid session — try signing in again'
}
