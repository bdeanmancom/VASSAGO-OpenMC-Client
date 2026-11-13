// Long two-player session. Not part of the default suite's time budget: run with
//   VASSAGO_SOAK_MINUTES=10 npm run test:soak
// against the servers started by the integration setup (or VASSAGO_TEST_PORT).
import { afterAll, describe, expect, inject, it } from 'vitest'
import { TestClient, sleep } from './harness'

const port = inject('port')
const version = inject('version')
const clientVersion = inject('clientVersion')
const MINUTES = Number(process.env.VASSAGO_SOAK_MINUTES ?? 2)
const idle = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }

const op = new TestClient('VassagoOp')
const bob = new TestClient('VassagoBob')
const decline = (c: TestClient) => { void c.waitFor('resourcePack', () => true, 60000).then(() => c.send({ t: 'resourcePack', accept: false })).catch(() => {}) }

describe(`Paper ${version} (client ${clientVersion}) — ${MINUTES} minute two-player session`, () => {
  afterAll(async () => { op.close(); bob.close(); await sleep(300) })

  it('both players stay connected while moving, building, chatting, using a chest and dying', async () => {
    const lost = (c: TestClient) => c.events.find(e => e.t === 'disconnect') as any
    const alive = (what: string) => {
      for (const c of [op, bob]) { const d = lost(c); if (d) throw new Error(`${c.name} was disconnected while ${what}: ${d.reason}${d.detail ? ` (${d.detail})` : ''}`) }
    }
    decline(op); await op.joined(port)
    // An interrupted earlier run may have left the whitelist on, which would refuse the second
    // player (the operator passes it). A server that is meant to be whitelisted, with both test
    // names on it, is run with VASSAGO_TEST_KEEP_WHITELIST=1.
    if (process.env.VASSAGO_TEST_KEEP_WHITELIST !== '1') { op.vanilla('whitelist off'); await sleep(500) }
    decline(bob); await bob.joined(port)
    op.vanilla('difficulty peaceful') // no mobs wandering into the test
    await op.mode('creative')
    op.vanilla(`spreadplayers ${Math.floor(op.pos.x)} ${Math.floor(op.pos.z)} 0 3 under 100 false VassagoOp`)
    await sleep(1500)
    await op.until(() => op.pos.onGround, 20000, 'on the surface')
    const px = Math.floor(op.pos.x); const pz = Math.floor(op.pos.z); const ground = Math.floor(op.pos.y); const py = ground + 24
    op.vanilla(`fill ${px - 6} ${ground + 4} ${pz - 6} ${px + 6} ${ground + 60} ${pz + 6} minecraft:air`)
    await sleep(400)
    op.vanilla(`fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py} ${pz + 6} minecraft:stone`)
    op.vanilla(`setblock ${px + 4} ${py + 1} ${pz - 4} minecraft:chest`)
    const home = async (c: TestClient, dx: number) => {
      op.vanilla(`tp ${c.name} ${px + 0.5 + dx} ${py + 1} ${pz + 0.5}`)
      await c.until(() => !!lost(c) || (Math.abs(c.pos.x - (px + 0.5 + dx)) < 0.01 && c.pos.onGround), 15000, `${c.name} teleport`)
      alive('teleporting')
    }
    await home(op, 0); await home(bob, 2)
    op.vanilla('gamemode creative VassagoBob')
    const holdStone = async (c: TestClient) => {
      await c.until(() => !!lost(c) || (c.window?.type === 'inventory' && c.window.slots.some((s, i) => i >= 36 && i <= 44 && s?.name === 'stone')), 10000, `${c.name} has stone in the hotbar`)
      c.send({ t: 'hotbar', slot: c.window!.slots.findIndex((s, i) => i >= 36 && i <= 44 && s?.name === 'stone') - 36 })
      await sleep(200)
    }
    op.vanilla('clear @a')
    // wait for the clear to arrive before giving, so a stack left over from an earlier run is not mistaken for the new one
    for (const c of [op, bob]) await c.until(() => c.window?.slots.every(s => s == null) === true, 10000, `${c.name} inventory cleared`)
    op.vanilla('give @a minecraft:stone 64')
    for (const c of [op, bob]) await holdStone(c)
    await op.until(() => [...op.entities.values()].some(e => e.username === 'VassagoBob'), 15000, 'op sees bob')
    await bob.until(() => [...bob.entities.values()].some(e => e.username === 'VassagoOp'), 15000, 'bob sees op')

    const until = Date.now() + MINUTES * 60_000
    const stats = { rounds: 0, moves: 0, chats: 0, placed: 0, broken: 0, chests: 0, deaths: 0 }
    while (Date.now() < until) {
      const r = stats.rounds
      // movement: both walk, jump, sneak, sprint — and each must be seen moving by the other,
      // every round (entity ids change on respawn, so they are looked up by name each time)
      const idOf = (viewer: TestClient, name: string) => [...viewer.entities.values()].find(e => e.username === name)?.id
      await op.until(() => !!lost(op) || !!lost(bob) || (idOf(op, 'VassagoBob') != null && idOf(bob, 'VassagoOp') != null), 15000, 'players see each other')
      alive('finding each other')
      const relayed = [
        bob.waitFor('entityMoves', e => e.moves.some(m => m.id === idOf(bob, 'VassagoOp')), 15000),
        op.waitFor('entityMoves', e => e.moves.some(m => m.id === idOf(op, 'VassagoBob')), 15000)
      ]
      for (const p of relayed) p.catch(() => {}) // reported below, with the disconnect reason if there is one
      for (const [c, yaw] of [[op, 0], [bob, Math.PI]] as [TestClient, number][]) {
        c.send({ t: 'look', yaw, pitch: 0 })
        c.send({ t: 'controls', c: { ...idle, forward: true, jump: r % 2 === 0 } })
      }
      await sleep(800)
      for (const c of [op, bob]) c.send({ t: 'controls', c: { ...idle, back: true, sneak: true } })
      await sleep(800)
      for (const c of [op, bob]) c.send({ t: 'controls', c: { ...idle, forward: true, sprint: true, left: true } })
      await sleep(400)
      for (const c of [op, bob]) c.send({ t: 'controls', c: idle })
      alive('moving')
      for (const [c, dx] of [[op, 0], [bob, 2]] as [TestClient, number][]) {
        const moved = Math.hypot(c.pos.x - (px + 0.5 + dx), c.pos.z - (pz + 0.5))
        if (moved < 1) throw new Error(`${c.name} did not move in round ${r} (${moved.toFixed(2)} blocks from home)`)
      }
      await Promise.all(relayed)
      stats.moves += 2
      await home(op, 0); await home(bob, 2)

      // chat both ways
      const a = bob.waitFor('chat', e => e.plain.includes(`soak ${r} from op`), 15000)
      op.chat(`soak ${r} from op`); await a
      const b = op.waitFor('chat', e => e.plain.includes(`soak ${r} from bob`), 15000)
      bob.chat(`soak ${r} from bob`); await b
      stats.chats += 2

      // build and break, each seen by the other player
      // each player builds within its own reach (op stands at px+0.5, bob at px+2.5)
      for (const [c, other, tx] of [[op, bob, px - 2], [bob, op, px + 4]] as [TestClient, TestClient, number][]) {
        const key = `${tx},${py + 1},${pz + 3}`
        c.blocks.delete(key); other.blocks.delete(key)
        c.send({ t: 'useBlock', x: tx, y: py, z: pz + 3, face: 1, cx: 0.5, cy: 1, cz: 0.5 })
        await other.until(() => !!lost(c) || !!lost(other) || (other.blocks.get(key) ?? 0) !== 0, 15000, `${c.name} placed block seen by ${other.name}`)
        alive('placing'); stats.placed++
        c.send({ t: 'digStart', x: tx, y: py + 1, z: pz + 3, face: 1 })
        await other.until(() => !!lost(c) || !!lost(other) || other.blocks.get(key) === 0, 15000, `${c.name} broken block seen by ${other.name}`)
        alive('breaking'); stats.broken++
      }

      // open the chest, move a stack in and back out, close
      if (r % 3 === 0) {
        const opened = op.waitFor('window', e => e.w.type.includes('generic_9x3'), 15000)
        op.send({ t: 'useBlock', x: px + 4, y: py + 1, z: pz - 4, face: 1, cx: 0.5, cy: 0.9, cz: 0.5 })
        const w = (await opened).w
        const slot = w.slots.findIndex((s, i) => i >= 27 && s?.name === 'stone')
        op.send({ t: 'windowClick', slot, button: 0, mode: 1 })
        await op.until(() => !!lost(op) || op.window?.slots.slice(0, 27).some(s => s?.name === 'stone') === true, 10000, 'stack in chest')
        op.send({ t: 'windowClick', slot: op.window!.slots.findIndex((s, i) => i < 27 && s?.name === 'stone'), button: 0, mode: 1 })
        await op.until(() => !!lost(op) || op.window?.slots.slice(0, 27).every(s => s == null) === true, 10000, 'stack back out')
        const closed = op.waitFor('windowClose', () => true, 10000)
        op.send({ t: 'windowClose' }); await closed
        // the stack may have come back into a different hotbar slot: hold it again
        await holdStone(op)
        alive('using the chest'); stats.chests++
      }

      // die and respawn
      if (r % 4 === 1) {
        op.vanilla('gamemode survival VassagoBob')
        const died = bob.waitFor('death', () => true, 15000)
        op.vanilla('kill VassagoBob'); await died
        const back = bob.waitFor('health', e => e.health === 20, 20000)
        bob.send({ t: 'respawn' }); await back
        await sleep(500)
        op.vanilla('gamemode creative VassagoBob')
        await home(bob, 2)
        op.vanilla('clear VassagoBob')
        await bob.until(() => bob.window?.slots.every(s => s == null) === true, 10000, 'bob inventory cleared')
        op.vanilla('give VassagoBob minecraft:stone 64')
        await holdStone(bob)
        alive('respawning'); stats.deaths++
      }

      await sleep(3000) // stand still together for a while every round
      alive('standing still')
      stats.rounds++
    }
    console.log(`soak finished after ${MINUTES} min:`, JSON.stringify(stats))
    expect(lost(op)).toBeUndefined()
    expect(lost(bob)).toBeUndefined()
    expect(stats.rounds).toBeGreaterThan(MINUTES * 3)

    // leave the world as we found it
    op.vanilla(`spreadplayers ${px} ${pz} 0 3 under ${py} false @a`)
    await sleep(1500)
    op.vanilla(`fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py + 2} ${pz + 6} minecraft:air`)
    await sleep(800)
  }, (MINUTES * 60 + 240) * 1000)
})
