import { GameSession } from '../../src/session/session'
import type { ConnectOptions, SessionCommand, SessionEvent } from '../../src/shared/protocol'

/**
 * Normally the client negotiates its version from the status ping, like the app does. Setting
 * VASSAGO_TEST_FORCE_VERSION makes every test client speak that version instead — used to check
 * older protocol versions against a newer server that translates for them (ViaBackwards).
 */
export const FORCED_VERSION: string | null = process.env.VASSAGO_TEST_FORCE_VERSION || null

export class TestClient {
  events: SessionEvent[] = []
  session: GameSession
  private waiters: { pred: (e: SessionEvent) => boolean, resolve: (e: SessionEvent) => void }[] = []
  pos = { x: 0, y: 0, z: 0, onGround: false }
  chunks = new Map<string, Extract<SessionEvent, { t: 'chunk' }>>()
  blocks = new Map<string, number>()
  window: Extract<SessionEvent, { t: 'window' }>['w'] | null = null
  entities = new Map<number, any>()
  gameMode = ''

  constructor (public name: string) {
    this.session = new GameSession({
      emit: (ev) => {
        if (ev.t === 'login' || ev.t === 'gameMode' || ev.t === 'respawn') this.gameMode = ev.gameMode
        if (ev.t === 'self') this.pos = { x: ev.x, y: ev.y, z: ev.z, onGround: ev.onGround }
        else if (ev.t === 'chunk') this.chunks.set(`${ev.x},${ev.z}`, ev)
        else if (ev.t === 'blocks') { for (let i = 0; i < ev.updates.length; i += 4) this.blocks.set(`${ev.updates[i]},${ev.updates[i + 1]},${ev.updates[i + 2]}`, ev.updates[i + 3]) } else if (ev.t === 'window') this.window = ev.w
        else if (ev.t === 'entitySpawn' || ev.t === 'entityUpdate') this.entities.set(ev.e.id, ev.e)
        else if (ev.t === 'entityGone') this.entities.delete(ev.id)
        if (ev.t !== 'self' && ev.t !== 'log') this.events.push(ev)
        if (ev.t === 'log' && process.env.VASSAGO_DEBUG) console.log(`[${name}]`, ev.level, ev.msg)
        this.waiters = this.waiters.filter(w => { if (w.pred(ev)) { w.resolve(ev); return false } return true })
      }
    })
  }

  send (cmd: SessionCommand) { this.session.handle(cmd) }

  connect (port: number, extra: Partial<ConnectOptions> = {}) {
    this.send({ t: 'connect', opts: { host: '127.0.0.1', port, username: this.name, auth: 'offline', version: FORCED_VERSION, viewDistance: 4, ...extra } })
  }

  waitFor<T extends SessionEvent['t']> (type: T, pred: (e: Extract<SessionEvent, { t: T }>) => boolean = () => true, timeout = 20000): Promise<Extract<SessionEvent, { t: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`[${this.name}] timeout waiting for ${type}`)), timeout)
      this.waiters.push({
        pred: e => e.t === type && pred(e as any),
        resolve: e => { clearTimeout(timer); resolve(e as any) }
      })
    })
  }

  async until (cond: () => boolean, timeout = 15000, what = 'condition') {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > timeout) throw new Error(`[${this.name}] timeout waiting for ${what}`)
      await sleep(50)
    }
  }

  async joined (port: number, extra: Partial<ConnectOptions> = {}) {
    const from = this.events.length
    const playing = this.waitFor('phase', e => e.phase === 'playing', 60000)
    this.connect(port, extra)
    await playing
    // A previous (aborted) run may have left this player dead on the server.
    await sleep(300)
    if (this.events.slice(from).some(e => e.t === 'death')) {
      const alive = this.waitFor('health', e => e.health > 0, 20000)
      this.send({ t: 'respawn' })
      await alive
    }
    await this.until(() => this.chunks.size >= 9, 60000, 'chunks')
    await this.until(() => this.pos.onGround, 30000, 'landing')
  }

  chat (text: string) { this.send({ t: 'chat', text }) }

  /** Switch own game mode via command (operator only); no-op when already in that mode. */
  async mode (mode: 'survival' | 'creative') {
    if (this.gameMode === mode) return
    const changed = this.waitFor('gameMode', e => e.gameMode === mode)
    this.chat(`/gamemode ${mode}`)
    await changed
  }
  /**
   * Empty the inventory, give exactly this item and hold it (operator only). Waits for the clear to
   * arrive before giving, so a stack left over from an earlier test is never mistaken for the new one.
   */
  async hold (item: string, count = 64) {
    this.chat(`/clear ${this.name}`)
    await this.until(() => this.window?.slots.every(s => s == null) === true, 10000, 'inventory cleared')
    this.chat(`/give ${this.name} minecraft:${item} ${count}`)
    const inHotbar = () => this.window?.slots.findIndex((s, i) => i >= 36 && i <= 44 && s?.name === item) ?? -1
    await this.until(() => inHotbar() >= 36, 10000, `${item} in the hotbar`)
    this.send({ t: 'hotbar', slot: inHotbar() - 36 })
    await sleep(200)
  }

  close () { this.send({ t: 'disconnect' }) }
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
