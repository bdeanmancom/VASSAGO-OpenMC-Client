import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { FORCED_VERSION, TestClient, sleep } from './harness'
import { pingServer } from '../../src/session/versions'
import { createAttemptGate } from '../../src/shared/attempt'
import { createRequire } from 'node:module'

const port = inject('port')
const onlinePort = inject('onlinePort')
const version = inject('version')
// On a server that admits older clients through ViaBackwards the client speaks an older version than the server runs.
const clientVersion = inject('clientVersion')

const op = new TestClient('VassagoOp')
const bob = new TestClient('VassagoBob')
let px = 0; let py = 0; let pz = 0 // platform centre block (stone), players stand on py+1
/** How long the keep-connected test plays for. */
const SOAK_SECONDS = Number(process.env.VASSAGO_SOAK_SECONDS ?? 60)

function autoDeclinePack (c: TestClient) {
  void c.waitFor('resourcePack', () => true, 60000).then(() => c.send({ t: 'resourcePack', accept: false })).catch(() => {})
}

describe(`Paper ${version}${FORCED_VERSION ? ` (client forced to ${FORCED_VERSION})` : ''} — offline-mode server`, () => {
  beforeAll(async () => {
    autoDeclinePack(op)
    await op.joined(port)
    op.vanilla('difficulty peaceful') // no mobs wandering into the tests (matters on a reused server)
    op.vanilla('whitelist off') // an interrupted earlier run may have left it on
  })
  afterAll(async () => { op.close(); bob.close(); await sleep(300) })

  it('answers the status ping and negotiates the protocol version', async () => {
    const res = await pingServer('127.0.0.1', port)
    expect(res.online).toBe(true)
    expect(res.resolvedVersion).toBe(clientVersion)
    expect(res.supported).toBe(true)
    expect(res.motd).toContain('Vassago test server')
    expect(res.playersMax).toBe(10)
  })

  it('logs in without Microsoft authentication and receives the world', async () => {
    const login = op.events.find(e => e.t === 'login') as any
    expect(login.username).toBe('VassagoOp')
    expect(login.version).toBe(FORCED_VERSION ?? clientVersion)
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

  it('can also accept the resource pack offer and still joins', async () => {
    const c = new TestClient('VassagoAcc')
    void c.waitFor('resourcePack', () => true, 60000).then(() => c.send({ t: 'resourcePack', accept: true })).catch(() => {})
    await c.joined(port)
    expect(c.chunks.size).toBeGreaterThanOrEqual(9)
    const dc = c.waitFor('disconnect')
    c.close()
    await dc
  })

  it('builds a test platform using operator commands (chat commands work)', async () => {
    await op.mode('creative')
    // start from the surface no matter where a previous run left this player
    op.chat(`/spreadplayers ${Math.floor(op.pos.x)} ${Math.floor(op.pos.z)} 0 3 under 100 false VassagoOp`)
    await sleep(1500)
    await op.until(() => op.pos.onGround, 20000, 'standing on the surface')
    const bx = Math.floor(op.pos.x); const bz = Math.floor(op.pos.z)
    const ground = Math.floor(op.pos.y)
    px = bx; pz = bz; py = ground + 24
    op.chat(`/fill ${px - 6} ${ground + 4} ${pz - 6} ${px + 6} ${ground + 60} ${pz + 6} minecraft:air`) // leftovers from aborted runs
    await sleep(300)
    op.blocks.clear()
    op.chat(`/fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py} ${pz + 6} minecraft:stone`)
    await op.until(() => op.blocks.has(`${px},${py},${pz}`), 15000, 'platform block updates')
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.y - (py + 1)) < 0.01 && op.pos.onGround, 15000, 'teleport onto platform')
    await op.mode('survival')
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
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && op.pos.onGround, 60000, 'landing back in the overworld')
    await op.mode('survival')
  })

  it('places and breaks blocks, visible to the other player', async () => {
    await op.mode('creative')
    await op.hold('stone')
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
    await op.mode('survival')
    const tx = px - 1; const tz = pz
    op.chat(`/setblock ${tx} ${py + 1} ${tz} minecraft:dirt`)
    const key = `${tx},${py + 1},${tz}`
    await op.until(() => (op.blocks.get(key) ?? 0) !== 0, 10000, 'dirt placed')
    const started = op.waitFor('dig', e => e.state === 'start')
    // what the other player is shown: the block cracking under someone else's hand, then breaking
    const at = (e: { x: number, y: number, z: number }) => e.x === tx && e.y === py + 1 && e.z === tz
    const cracking = bob.waitFor('breakAnim', e => at(e) && e.stage >= 0, 10000)
    const broke = bob.waitFor('blockBreak', e => at(e) && e.state !== 0, 10000)
    const swung = bob.waitFor('entityAnim', e => e.anim === 'swing', 10000)
    op.send({ t: 'digStart', x: tx, y: py + 1, z: tz, face: 5 })
    const dig = await started
    expect(dig.timeMs).toBeGreaterThan(300)
    await op.until(() => op.blocks.get(key) === 0, 10000, 'dirt broken')
    await cracking
    await swung
    expect((await broke).state).toBeGreaterThan(0) // the state of the block that was there
    // the digger is not sent its own effects: it draws them itself
    expect(op.events.some(e => e.t === 'breakAnim' && at(e as any))).toBe(false)
    // walk onto the drop (it scatters a little) and pick it up
    op.chat(`/tp VassagoOp ${tx + 0.5} ${py + 1} ${tz + 0.5}`)
    await op.until(() => op.window?.slots.some(s => s?.name === 'dirt') === true, 15000, 'dirt item collected')
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01, 10000, 'teleport back')
  })

  it(`stays connected for ${SOAK_SECONDS}s while standing, walking, jumping, sneaking, sprinting, placing and breaking`, async () => {
    // Regression test for the 26.3 "Invalid move player packet received" kick: a client that never
    // ends its ticks is disconnected on its second position packet, i.e. within about a second.
    const idle = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
    const disconnected = () => op.events.find(e => e.t === 'disconnect') as any
    const alive = (what: string) => { const d = disconnected(); if (d) throw new Error(`disconnected while ${what}: ${d.reason}${d.detail ? ` (${d.detail})` : ''}`) }
    const home = async () => {
      op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
      await op.until(() => !!disconnected() || (Math.abs(op.pos.x - (px + 0.5)) < 0.01 && Math.abs(op.pos.z - (pz + 0.5)) < 0.01 && op.pos.onGround), 10000, 'teleport home')
      alive('teleporting')
    }
    await op.mode('creative')
    await home()
    await op.hold('stone')

    // standing completely still is what used to get the client kicked
    await sleep(4000)
    alive('standing still')

    const until = Date.now() + SOAK_SECONDS * 1000
    let rounds = 0
    const tx = px + 3; const tz = pz + 3
    const key = `${tx},${py + 1},${tz}`
    // Movement has to be real, not just commanded: our own position must leave home and rise in a
    // jump, and the other player's client must be told by the server that we moved and sneaked.
    const hx = px + 0.5; const hz = pz + 0.5
    let far = 0; let high = 0
    const track = setInterval(() => { far = Math.max(far, Math.hypot(op.pos.x - hx, op.pos.z - hz)); high = Math.max(high, op.pos.y - (py + 1)) }, 50)
    const opAt = (c: TestClient) => [...c.entities.values()].find(e => e.username === 'VassagoOp')
    await bob.until(() => !!opAt(bob), 15000, 'bob sees op')
    // sprinting is a flag (0x08) in the entity's shared metadata byte, which the server only sets
    // when it was told about the sprint in a form it understands
    let sprintSeen = false
    const stopWatching = bob.onPacket('entity_metadata', p => {
      if (p.entityId === opAt(bob)?.id && p.metadata?.some((m: any) => m.key === 0 && (Number(m.value) & 0x08) !== 0)) sprintSeen = true
    })
    try {
      while (Date.now() < until) {
        far = 0; high = 0; sprintSeen = false
        const relayed = bob.waitFor('entityMoves', e => e.moves.some(m => m.id === opAt(bob)?.id), 15000)
        const sneaked = bob.waitFor('entityUpdate', e => e.e.username === 'VassagoOp' && e.e.sneaking === true, 15000)
        op.send({ t: 'look', yaw: 0, pitch: 0 })
        op.send({ t: 'controls', c: { ...idle, forward: true } })
        await sleep(700)
        op.send({ t: 'controls', c: { ...idle, forward: true, jump: true } })
        await sleep(600)
        op.send({ t: 'controls', c: { ...idle, sneak: true, back: true } })
        await sleep(900)
        op.send({ t: 'controls', c: { ...idle, sprint: true, left: true, forward: true } })
        await sleep(400)
        op.send({ t: 'controls', c: idle })
        alive('moving')
        expect(far, 'distance walked from home').toBeGreaterThan(2)
        expect(high, 'height reached in the jump').toBeGreaterThan(0.9)
        await relayed
        await sneaked
        await bob.until(() => sprintSeen, 5000, 'sprinting seen by the other player')
        await home()

        // placed and broken as seen by the other player, i.e. as the server has it
        op.blocks.delete(key); bob.blocks.delete(key)
        op.send({ t: 'useBlock', x: tx, y: py, z: tz, face: 1, cx: 0.5, cy: 1, cz: 0.5 })
        await bob.until(() => !!disconnected() || (bob.blocks.get(key) ?? 0) !== 0, 10000, 'block placed (seen by the other player)')
        alive('placing a block')
        op.send({ t: 'digStart', x: tx, y: py + 1, z: tz, face: 1 })
        await bob.until(() => !!disconnected() || bob.blocks.get(key) === 0, 10000, 'block broken (seen by the other player)')
        alive('breaking a block')
        await sleep(1200) // an idle stretch every round
        alive('idling')
        rounds++
      }
    } finally {
      clearInterval(track)
      stopWatching()
    }
    expect(rounds).toBeGreaterThan(3)
    expect(disconnected()).toBeUndefined()
    // the server still agrees about where we are
    await home()
    await op.mode('survival')
  }, (SOAK_SECONDS + 90) * 1000)

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
    // the consumed ingredient disappears (server correction on 1.21.5+, client prediction before)
    await op.until(() => op.window?.slots[1] == null, 5000, 'ingredient consumed')
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

  it('uses held items (water bucket) and attacks entities', async () => {
    await op.mode('creative')
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && op.pos.onGround, 10000, 'teleport')
    await op.hold('water_bucket', 1)
    op.send({ t: 'look', yaw: 0, pitch: -Math.PI / 2 + 0.01 })
    await sleep(300)
    const key = `${px},${py + 1},${pz}`
    op.blocks.delete(key)
    op.send({ t: 'useItem' })
    await op.until(() => (op.blocks.get(key) ?? 0) !== 0, 10000, 'water placed by bucket')
    op.send({ t: 'useItemRelease' })
    op.chat(`/setblock ${px} ${py + 1} ${pz} minecraft:air`)

    op.chat(`/summon minecraft:pig ${px + 0.5} ${py + 1} ${pz - 1.5} {NoAI:1b}`)
    const isOurPig = (e: any) => e.name === 'pig' && Math.abs(e.y - (py + 1)) < 1 && Math.abs(e.x - (px + 0.5)) < 1
    await op.until(() => [...op.entities.values()].some(isOurPig), 10000, 'pig spawned')
    const pig = [...op.entities.values()].find(isOurPig)
    expect(pig.width).toBeGreaterThan(0.5)
    await op.mode('survival')
    const hurt = op.waitFor('entityAnim', e => e.id === pig.id && e.anim === 'hurt', 10000)
    op.send({ t: 'look', yaw: 0, pitch: -0.3 })
    op.send({ t: 'attack', id: pig.id })
    await hurt
    // our pig, by id: the world may hold pigs of its own, and they are none of this test's business
    op.chat(`/kill @e[type=minecraft:pig,distance=..8]`)
    await op.until(() => !op.entities.has(pig.id), 15000, 'pig removed')
  })

  it('flies in creative mode without being corrected by the server', async () => {
    await op.mode('creative')
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && Math.abs(op.pos.y - (py + 1)) < 0.01, 10000, 'teleport')
    const idle = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
    op.send({ t: 'fly', flying: true })
    op.send({ t: 'controls', c: { ...idle, jump: true } })
    await sleep(1500)
    op.send({ t: 'controls', c: idle })
    await sleep(600)
    const high = op.pos.y
    expect(high - (py + 1)).toBeGreaterThan(4) // far above jump height
    await sleep(800)
    expect(Math.abs(op.pos.y - high)).toBeLessThan(0.6) // hovering, not falling
    op.send({ t: 'look', yaw: 0, pitch: 0 })
    op.send({ t: 'controls', c: { ...idle, forward: true } })
    await sleep(800)
    op.send({ t: 'controls', c: idle })
    expect(pz + 0.5 - op.pos.z).toBeGreaterThan(2)
    // once the glide has stopped we stay put: the server is not dragging us back
    await sleep(1500)
    const before = { ...op.pos }
    await sleep(700)
    expect(Math.abs(op.pos.x - before.x) + Math.abs(op.pos.z - before.z)).toBeLessThan(0.3)
    expect(pz + 0.5 - op.pos.z).toBeGreaterThan(2)
    op.send({ t: 'fly', flying: false })
    await op.until(() => op.pos.onGround, 10000, 'landing after flight')
    await op.mode('survival')
    op.chat(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && op.pos.onGround, 10000, 'teleport back')
  })

  it('reports damage, death and respawns', async () => {
    const hurt = op.waitFor('hurt')
    const from = op.events.length
    op.chat('/damage VassagoOp 4')
    await hurt
    // any report of the lower health counts: on a peaceful server it starts coming back at once
    await op.until(() => op.events.slice(from).some(e => e.t === 'health' && e.health <= 16), 5000, 'health dropped')
    const death = op.waitFor('death')
    op.chat('/kill VassagoOp')
    await death
    const alive = op.waitFor('health', e => e.health === 20, 15000)
    op.send({ t: 'respawn' })
    await alive
  })

  it('handles dimension transitions', async () => {
    // creative: the arrival point may be inside rock or above lava, and chunk generation can be slow
    await op.mode('creative')
    const respawn = op.waitFor('respawn', e => e.dimension.includes('nether'), 30000)
    op.chunks.clear()
    op.chat('/execute in minecraft:the_nether run tp VassagoOp 0 120 0')
    const ev = await respawn
    expect(ev.height).toBeGreaterThan(0)
    await op.until(() => op.chunks.size >= 9, 60000, 'nether chunks')
    const back = op.waitFor('respawn', e => e.dimension.includes('overworld'), 30000)
    op.chat(`/execute in minecraft:overworld run tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await back
    await op.until(() => Math.abs(op.pos.x - (px + 0.5)) < 0.01 && op.pos.onGround, 60000, 'landing back in the overworld')
    await op.mode('survival')
  })

  it('cleans up the test platform', async () => {
    // `under py` makes the command look for ground below the platform instead of landing on it
    op.chat(`/spreadplayers ${px} ${pz} 0 3 under ${py} false @a`)
    await sleep(1500)
    op.chat(`/fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py + 2} ${pz + 6} minecraft:air`)
    await op.until(() => op.blocks.get(`${px},${py},${pz}`) === 0, 10000, 'platform removed')
    await sleep(1500)
    await op.until(() => op.pos.onGround && op.pos.y < py, 20000, 'back on the surface')
  })

  it('explains a whitelist refusal', async () => {
    op.chat('/whitelist on')
    await sleep(600)
    try {
      const stranger = new TestClient('VassagoStranger')
      const dc = stranger.waitFor('disconnect', () => true, 30000)
      stranger.connect(port)
      const ev = await dc
      expect(stranger.events.some(e => e.t === 'login')).toBe(false)
      expect(ev.kind).toBe('whitelist')
      expect(ev.kicked).toBe(true)
      expect(ev.reason).toMatch(/whitelist/i)
    } finally {
      op.chat('/whitelist off')
      await sleep(600)
    }
  })

  it('reports kicks with the server-provided reason', async () => {
    const dc = bob.waitFor('disconnect')
    op.chat('/kick VassagoBob integration test kick')
    const ev = await dc
    expect(ev.kicked).toBe(true)
    expect(ev.kind).toBe('kicked')
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

  it('a player who logs in while dead reaches the death state and can respawn', async () => {
    autoDeclinePack(bob)
    await bob.joined(port)
    const died = bob.waitFor('death')
    op.chat('/kill VassagoBob')
    await died
    const dc = bob.waitFor('disconnect')
    bob.close()
    await dc
    await sleep(500)
    autoDeclinePack(bob)
    bob.events.length = 0
    const playing = bob.waitFor('phase', e => e.phase === 'playing', 60000)
    const deadAgain = bob.waitFor('death', () => true, 60000)
    bob.connect(port)
    await Promise.all([playing, deadAgain])
    const alive = bob.waitFor('health', e => e.health === 20, 15000)
    bob.send({ t: 'respawn' })
    await alive
  })
})

describe('connection failures', () => {
  it('reports a refused connection cleanly', async () => {
    const c = new TestClient('Nobody')
    const dc = c.waitFor('disconnect')
    c.connect(1) // nothing listens on port 1
    const ev = await dc
    expect(ev.reason).toMatch(/refused/i)
    expect(ev.kind).toBe('network')
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

describe('cancelled and replaced connection attempts', () => {
  it('a cancelled attempt never comes back, even when another one starts right behind it', async () => {
    const c = new TestClient('VassagoRace')
    autoDeclinePack(c)
    c.connect(port) // attempt 1 is still asking the server for its version…
    c.close() // …when the player cancels
    await sleep(1500)
    expect(c.events.some(e => e.t === 'login')).toBe(false)
    expect(c.events.filter(e => e.t === 'disconnect').length).toBe(1)

    c.events.length = 0
    // A revived attempt would not show in the events (they are attributed to the current attempt
    // only): it would sit on the server as a second, silent connection. So count the connections
    // the session really opens.
    const mineflayer = createRequire(import.meta.url)('mineflayer')
    const createBot = mineflayer.createBot
    let opened = 0
    mineflayer.createBot = (...args: unknown[]) => { opened++; return createBot(...args) }
    try {
      c.connect(port) // attempt 2, cancelled and replaced at once by attempt 3
      c.close()
      const playing = c.waitFor('phase', e => e.phase === 'playing', 60000)
      c.connect(port)
      await playing
      await sleep(1500)
    } finally {
      mineflayer.createBot = createBot
    }
    expect(opened, 'connections opened for one surviving attempt').toBe(1)
    expect(c.events.filter(e => e.t === 'login').length).toBe(1)
    // only the cancel of attempt 2 shows up; nothing ended attempt 3
    expect(c.events.filter(e => e.t === 'disconnect').length).toBe(1)
    const dc = c.waitFor('disconnect')
    c.close()
    await dc
  })

  it('a failing attempt that was already replaced does not end its replacement', async () => {
    const c = new TestClient('VassagoRace')
    autoDeclinePack(c)
    const playing = c.waitFor('phase', e => e.phase === 'playing', 60000)
    c.connect(1) // will be refused…
    c.connect(port) // …but the player has already moved on
    await playing
    await sleep(1000)
    expect(c.events.some(e => e.t === 'disconnect')).toBe(false)
    expect(c.events.filter(e => e.t === 'login').length).toBe(1)
    const dc = c.waitFor('disconnect')
    c.close()
    await dc
  })
})

describe('a game screen taking over the shared session', () => {
  it('does not mistake the previous connection ending for its own', async () => {
    // What the app does when the player switches profile from inside a live connection: the old
    // screen closes its connection and the new one connects, back to back, on the same session.
    const c = new TestClient('VassagoRace')
    autoDeclinePack(c)
    const first = c.waitFor('login', () => true, 60000)
    c.connect(port, {}, 1)
    await first
    const second = c.waitFor('phase', e => e.phase === 'playing', 60000)
    autoDeclinePack(c) // the server asks every connection about its resource pack
    c.close()
    c.connect(port, {}, 2)
    await second
    await sleep(500)
    const from = c.events.findIndex(e => e.t === 'login') + 1
    const stream = c.events.slice(from)
    // the raw stream does contain the first connection's "Disconnected"…
    expect(stream.some(e => e.t === 'disconnect')).toBe(true)
    // …but a screen listening for attempt 2 never sees it, and does see its own login
    const mine = createAttemptGate(2)
    const visible = stream.filter(mine)
    expect(visible.some(e => e.t === 'disconnect')).toBe(false)
    expect(visible.filter(e => e.t === 'login').length).toBe(1)
    expect(visible[0]).toMatchObject({ t: 'phase', attempt: 2 })
    const dc = c.waitFor('disconnect')
    c.close()
    await dc
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
    expect(c.events.some(e => e.t === 'msaCode')).toBe(false) // a private-server profile never triggers Microsoft sign-in
    expect(ev.kind).toBe('auth-required')
    expect(ev.kicked).toBe(true)
    expect(ev.auth).toBe('offline')
    expect(ev.reason).toMatch(/online mode/)
    expect(ev.detail).toMatch(/verify username/i)
    console.log('online-mode rejection reason:', ev.reason)
  })
})
