import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { TestClient, sleep } from './harness'
import { pingServer } from '../../src/session/versions'

const port = inject('port')
const onlinePort = inject('onlinePort')
const version = inject('version')

const op = new TestClient('VassagoOp')
const bob = new TestClient('VassagoBob')
let px = 0; let py = 0; let pz = 0 // platform centre block (stone), players stand on py+1

function autoDeclinePack (c: TestClient) {
  void c.waitFor('resourcePack', () => true, 60000).then(() => c.send({ t: 'resourcePack', accept: false })).catch(() => {})
}

describe(`Paper ${version} — offline-mode server`, () => {
  beforeAll(async () => {
    autoDeclinePack(op)
    await op.joined(port)
  })
  afterAll(async () => { op.close(); bob.close(); await sleep(300) })

  it('answers the status ping and negotiates the protocol version', async () => {
    const res = await pingServer('127.0.0.1', port)
    expect(res.online).toBe(true)
    expect(res.resolvedVersion).toBe(version)
    expect(res.supported).toBe(true)
    expect(res.motd).toContain('Vassago test server')
    expect(res.playersMax).toBe(10)
  })

  it('logs in without Microsoft authentication and receives the world', async () => {
    const login = op.events.find(e => e.t === 'login') as any
    expect(login.username).toBe('VassagoOp')
    expect(login.version).toBe(version)
    expect(login.dimension).toContain('overworld')
    expect(op.chunks.size).toBeGreaterThanOrEqual(9)
    const anyChunk = [...op.chunks.values()][0]
    expect(anyChunk.sections.length).toBe(login.height / 16)
    expect(anyChunk.sections.some(s => s.blocks instanceof Uint16Array)).toBe(true)
    expect(anyChunk.sections.some(s => s.light instanceof Uint8Array)).toBe(true)
  })

  it('asked for consent before using the server resource pack', () => {
    const rp = op.events.find(e => e.t === 'resourcePack') as any
    expect(rp).toBeTruthy()
    expect(rp.url).toContain('vassago-test-pack.zip')
  })

  it('builds a test platform using operator commands (chat commands work)', async () => {
    op.chat('/gamemode creative')
    await op.waitFor('gameMode', e => e.gameMode === 'creative')
    const bx = Math.floor(op.pos.x); const bz = Math.floor(op.pos.z)
    px = bx; pz = bz; py = Math.min(Math.floor(op.pos.y) + 30, 300)
    op.chat(`/fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py} ${pz + 6} minecraft:stone`)
    op.chat(`/fill ${px - 6} ${py + 1} ${pz - 6} ${px + 6} ${py + 4} ${pz + 6} minecraft:air`)
    await op.until(() => op.blocks.has(`${px},${py},${pz}`), 15000, 'platform block updates')
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.y - (py + 1)) < 0.01 && op.pos.onGround, 15000, 'teleport onto platform')
    op.chat('/gamemode survival')
    await op.waitFor('gameMode', e => e.gameMode === 'survival')
  })

  it('walks, sprints and jumps with server-accepted movement', async () => {
    const start = { ...op.pos }
    op.send({ t: 'look', yaw: 0, pitch: 0 }) // facing -Z
    op.send({ t: 'controls', c: { forward: true, back: false, left: false, right: false, jump: false, sprint: false, sneak: false } })
    await sleep(1000)
    op.send({ t: 'controls', c: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false } })
    await sleep(400)
    expect(start.z - op.pos.z).toBeGreaterThan(2.5)
    expect(Math.abs(op.pos.x - start.x)).toBeLessThan(0.3)

    let maxY = op.pos.y
    op.send({ t: 'controls', c: { forward: false, back: false, left: false, right: false, jump: true, sprint: false, sneak: false } })
    for (let i = 0; i < 12; i++) { await sleep(40); maxY = Math.max(maxY, op.pos.y) }
    op.send({ t: 'controls', c: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false } })
    expect(maxY - (py + 1)).toBeGreaterThan(1.0)
    await op.until(() => op.pos.onGround, 5000, 'landing after jump')

    // The server must agree with where we think we are (no rubber-banding).
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && Math.abs(op.pos.z - (pz + 0.5)) < 0.01, 10000, 'teleport back')
  })

  it('lets a second player join; both see each other and movement syncs', async () => {
    autoDeclinePack(bob)
    await bob.joined(port)
    op.chat(`/tp VassagoBob ${px + 2.5} ${py + 1} ${pz + 0.5}`)
    await bob.until(() => Math.abs(bob.pos.x - (px + 2.5)) < 0.01, 15000, 'bob teleport')
    await op.until(() => [...op.entities.values()].some(e => e.username === 'VassagoBob'), 15000, 'op sees bob')
    await bob.until(() => [...bob.entities.values()].some(e => e.username === 'VassagoOp'), 15000, 'bob sees op')
    const bobSeenByOp = [...op.entities.values()].find(e => e.username === 'VassagoBob')
    const moved = op.waitFor('entityMoves', e => e.moves.some(m => m.id === bobSeenByOp.id && m.z > pz + 1.5), 15000)
    bob.send({ t: 'look', yaw: Math.PI, pitch: 0 }) // facing +Z
    bob.send({ t: 'controls', c: { forward: true, back: false, left: false, right: false, jump: false, sprint: false, sneak: false } })
    await moved
    bob.send({ t: 'controls', c: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false } })
    const players = [...op.events].reverse().find(e => e.t === 'players') as any
    expect(players.players.map((p: any) => p.username).sort()).toEqual(['VassagoBob', 'VassagoOp'])
  })

  it('exchanges chat messages between players', async () => {
    const got = op.waitFor('chat', e => e.plain.includes('hello from bob'))
    bob.chat('hello from bob')
    const msg = await got
    expect(msg.plain).toContain('VassagoBob')
    const back = bob.waitFor('chat', e => e.plain.includes('hi bob, op here'))
    op.chat('hi bob, op here')
    await back
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && op.pos.onGround, 30000, 'landing back in the overworld')
  })

  it('places and breaks blocks, visible to the other player', async () => {
    op.chat('/gamemode creative')
    await op.waitFor('gameMode', e => e.gameMode === 'creative')
    op.chat('/clear VassagoOp')
    op.chat('/give VassagoOp minecraft:stone 64')
    await op.until(() => op.window?.slots.some(s => s?.name === 'stone') === true, 10000, 'stone in inventory')
    const slot = op.window!.slots.findIndex(s => s?.name === 'stone')
    expect(slot).toBeGreaterThanOrEqual(36)
    op.send({ t: 'hotbar', slot: slot - 36 })
    await sleep(200)
    const tx = px - 3; const tz = pz - 3
    const key = `${tx},${py + 1},${tz}`
    op.blocks.delete(key); bob.blocks.delete(key)
    op.send({ t: 'useBlock', x: tx, y: py, z: tz, face: 1, cx: 0.5, cy: 1, cz: 0.5 })
    await op.until(() => (op.blocks.get(key) ?? 0) !== 0, 10000, 'placed block (self)')
    await bob.until(() => (bob.blocks.get(key) ?? 0) !== 0, 10000, 'placed block (other player)')
    expect(bob.blocks.get(key)).toBe(op.blocks.get(key))

    op.send({ t: 'digStart', x: tx, y: py + 1, z: tz, face: 1 })
    await op.until(() => op.blocks.get(key) === 0, 10000, 'broken block (self)')
    await bob.until(() => bob.blocks.get(key) === 0, 10000, 'broken block (other player)')
  })

  it('breaks blocks in survival with timed digging', async () => {
    op.chat('/gamemode survival')
    await op.waitFor('gameMode', e => e.gameMode === 'survival')
    const tx = px - 1; const tz = pz
    op.chat(`/setblock ${tx} ${py + 1} ${tz} minecraft:dirt`)
    const key = `${tx},${py + 1},${tz}`
    await op.until(() => (op.blocks.get(key) ?? 0) !== 0, 10000, 'dirt placed')
    const started = op.waitFor('dig', e => e.state === 'start')
    op.send({ t: 'digStart', x: tx, y: py + 1, z: tz, face: 5 })
    const dig = await started
    expect(dig.timeMs).toBeGreaterThan(300)
    await op.until(() => op.blocks.get(key) === 0, 10000, 'dirt broken')
    // the drop is picked up
    await op.until(() => op.window?.slots.some(s => s?.name === 'dirt') === true, 15000, 'dirt item collected')
  })

  it('moves items in the inventory and crafts in the 2x2 grid', async () => {
    op.chat('/clear VassagoOp')
    await op.until(() => op.window?.slots.every(s => s == null) === true, 10000, 'inventory cleared')
    op.chat('/give VassagoOp minecraft:oak_log 3')
    await op.until(() => op.window?.slots.some(s => s?.name === 'oak_log') === true, 10000, 'logs')
    const from = op.window!.slots.findIndex(s => s?.name === 'oak_log')
    op.send({ t: 'windowClick', slot: from, button: 0, mode: 0 })
    await op.until(() => op.window?.cursor?.name === 'oak_log', 5000, 'cursor holds logs')
    op.send({ t: 'windowClick', slot: 1, button: 1, mode: 0 }) // right click: place one log into crafting grid
    await op.until(() => op.window?.slots[1]?.name === 'oak_log' && op.window?.slots[1]?.count === 1, 5000, 'log in craft grid')
    op.send({ t: 'windowClick', slot: 20, button: 0, mode: 0 }) // put the rest down
    await op.until(() => op.window?.cursor == null && op.window?.slots[20]?.count === 2, 5000, 'rest placed')
    await op.until(() => op.window?.slots[0]?.name === 'oak_planks', 5000, 'craft result offered')
    expect(op.window!.slots[0]!.count).toBe(4)
    op.send({ t: 'windowClick', slot: 0, button: 0, mode: 0 })
    await op.until(() => op.window?.cursor?.name === 'oak_planks', 5000, 'took craft result')
    op.send({ t: 'windowClick', slot: 21, button: 0, mode: 0 })
    await op.until(() => op.window?.slots[21]?.name === 'oak_planks' && op.window?.slots[21]?.count === 4, 5000, 'planks stored')
    expect(op.window!.slots[1]).toBeNull()
  })

  it('opens a container, moves an item into it and closes it', async () => {
    const cx = px + 3; const cz = pz - 3
    op.chat(`/setblock ${cx} ${py + 1} ${cz} minecraft:chest`)
    await op.until(() => (op.blocks.get(`${cx},${py + 1},${cz}`) ?? 0) !== 0, 10000, 'chest placed')
    const opened = op.waitFor('window', e => e.w.type.includes('generic_9x3'))
    op.send({ t: 'useBlock', x: cx, y: py + 1, z: cz, face: 1, cx: 0.5, cy: 0.9, cz: 0.5 })
    const w = (await opened).w
    expect(w.inventoryStart).toBe(27)
    expect(w.slots.length).toBe(27 + 36)
    const planks = w.slots.findIndex(s => s?.name === 'oak_planks')
    expect(planks).toBeGreaterThanOrEqual(27)
    op.send({ t: 'windowClick', slot: planks, button: 0, mode: 1 }) // shift-click into chest
    await op.until(() => op.window?.slots.slice(0, 27).some(s => s?.name === 'oak_planks') === true, 5000, 'planks moved to chest')
    const closed = op.waitFor('windowClose')
    op.send({ t: 'windowClose' })
    await closed
    await op.until(() => op.window?.type === 'inventory', 5000, 'back to inventory')
    expect(op.window!.slots.some(s => s?.name === 'oak_planks')).toBe(false)
  })

  it('reports damage, death and respawns', async () => {
    const hurt = op.waitFor('hurt')
    op.chat('/damage VassagoOp 4')
    await hurt
    await op.until(() => (op.events.filter(e => e.t === 'health').at(-1) as any)?.health <= 16, 5000, 'health dropped')
    const death = op.waitFor('death')
    op.chat('/kill VassagoOp')
    await death
    const alive = op.waitFor('health', e => e.health === 20, 15000)
    op.send({ t: 'respawn' })
    await alive
  })

  it('handles dimension transitions', async () => {
    const respawn = op.waitFor('respawn', e => e.dimension.includes('nether'), 30000)
    op.chunks.clear()
    op.chat('/execute in minecraft:the_nether run tp VassagoOp 0 120 0')
    const ev = await respawn
    expect(ev.height).toBeGreaterThan(0)
    await op.until(() => op.chunks.size >= 9, 60000, 'nether chunks')
    const back = op.waitFor('respawn', e => e.dimension.includes('overworld'), 30000)
    op.chat(`/execute in minecraft:overworld run tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await back
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && op.pos.onGround, 30000, 'landing back in the overworld')
  })

  it('reports kicks with the server-provided reason', async () => {
    const dc = bob.waitFor('disconnect')
    op.chat('/kick VassagoBob integration test kick')
    const ev = await dc
    expect(ev.kicked).toBe(true)
    expect(ev.reason).toContain('integration test kick')
  })

  it('reconnects after a disconnect', async () => {
    autoDeclinePack(bob)
    bob.chunks.clear()
    await bob.joined(port)
    expect(bob.chunks.size).toBeGreaterThanOrEqual(9)
    const dc = bob.waitFor('disconnect')
    bob.close()
    expect((await dc).kicked).toBe(false)
  })
})

describe('connection failures', () => {
  it('reports a refused connection cleanly', async () => {
    const c = new TestClient('Nobody')
    const dc = c.waitFor('disconnect')
    c.connect(1) // nothing listens on port 1
    expect((await dc).reason).toMatch(/refused/i)
  })

  it('reports an unknown host cleanly', async () => {
    const c = new TestClient('Nobody')
    const dc = c.waitFor('disconnect', () => true, 30000)
    c.send({ t: 'connect', opts: { host: 'no-such-host.invalid', port: 25565, username: 'Nobody', auth: 'offline', version: null, viewDistance: 4 } })
    expect((await dc).reason).toMatch(/unknown host|unreachable|timed out/i)
  })

  it('rejects unsupported explicit versions before connecting', async () => {
    const c = new TestClient('Nobody')
    const dc = c.waitFor('disconnect')
    c.connect(port, { version: '1.7.10' })
    expect((await dc).reason).toMatch(/not supported/i)
  })
})

describe(`Paper ${version} — online-mode server`, () => {
  it('is pingable', async () => {
    const res = await pingServer('127.0.0.1', onlinePort)
    expect(res.online).toBe(true)
    expect(res.motd).toContain('online mode')
  })

  it('refuses an offline-mode login and the client does not try to bypass it', async () => {
    const c = new TestClient('NotAuthenticated')
    const dc = c.waitFor('disconnect', () => true, 30000)
    c.connect(onlinePort)
    const ev = await dc
    expect(c.events.some(e => e.t === 'login')).toBe(false)
    expect(ev.reason.length).toBeGreaterThan(0)
    console.log('online-mode rejection reason:', ev.reason)
  })
})
