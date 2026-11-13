import { describe, expect, it } from 'vitest'
import { createTickEndGuard, installTickEnd, supportsTickEnd } from '../../src/session/tick-end'

/** Replays what reaches the server and applies the 26.3 rule: no two position packets without a tick end between. */
function serverAccepts (wire: string[]): boolean {
  let receivedPositionThisTick = false
  for (const p of wire) {
    if (p === 'tick_end') receivedPositionThisTick = false
    else if (p === 'position' || p === 'position_look') {
      if (receivedPositionThisTick) return false
      receivedPositionThisTick = true
    }
  }
  return true
}

function harness () {
  const wire: string[] = []
  let t = 0
  const guard = createTickEndGuard(() => wire.push('tick_end'), () => t)
  const write = (name: string) => { guard.beforeWrite(name); wire.push(name) }
  return { wire, guard, write, advance: (ms: number) => { t += ms } }
}

describe('the 26.3 server rule (model)', () => {
  it('rejects exactly what the unpatched client sent', () => {
    // captured from the bug report: no tick end is ever sent
    expect(serverAccepts(['teleport_confirm', 'position_look', 'position', 'flying', 'position'])).toBe(false)
    expect(serverAccepts(['position', 'flying', 'look', 'flying'])).toBe(true) // rotation / status packets do not count
  })
})

describe('tick-end guard', () => {
  it('produces "move, tick end, move, tick end" in normal play', () => {
    const h = harness()
    for (let tick = 0; tick < 5; tick++) { h.guard.onClientTick(); h.write('position'); h.advance(50) }
    expect(h.wire).toEqual(['tick_end', 'position', 'tick_end', 'position', 'tick_end', 'position', 'tick_end', 'position', 'tick_end', 'position'])
    expect(serverAccepts(h.wire)).toBe(true)
  })

  it('keeps a standing player connected (the case from the bug report)', () => {
    const h = harness()
    h.write('teleport_confirm'); h.write('position_look')
    // ticks with nothing to send, then the once-per-second position reminder, repeatedly
    for (let second = 0; second < 5; second++) {
      for (let tick = 0; tick < 20; tick++) { h.guard.onClientTick(); if (tick === 3) h.write('flying'); h.advance(50) }
      h.guard.onClientTick(); h.write('position')
    }
    expect(serverAccepts(h.wire)).toBe(true)
    expect(h.guard.sent).toBeGreaterThan(100)
  })

  it('separates position packets even when no client tick ran between them', () => {
    const h = harness()
    // physics disabled / catch-up burst / a teleport answer landing in the same tick as normal movement
    h.write('position'); h.write('position_look'); h.write('position'); h.write('look'); h.write('position')
    expect(h.wire).toEqual(['position', 'tick_end', 'position_look', 'tick_end', 'position', 'look', 'tick_end', 'position'])
    expect(serverAccepts(h.wire)).toBe(true)
  })

  it('does not add tick ends around packets that carry no position', () => {
    const h = harness()
    h.write('flying'); h.write('look'); h.write('chat'); h.write('flying')
    expect(h.wire).toEqual(['flying', 'look', 'chat', 'flying'])
  })

  it('keeps ending ticks (every 100 ms) while the physics loop is paused, and not otherwise', () => {
    const h = harness()
    h.guard.onClientTick()
    const start = h.guard.sent
    for (let i = 0; i < 10; i++) { h.advance(50); h.guard.poll() }
    // half a second of silence from the physics loop: one tick end per 100 ms, no more, no fewer
    expect(h.guard.sent - start).toBe(5)
    // physics running again: the poll must not double up
    const before = h.guard.sent
    for (let i = 0; i < 20; i++) { h.guard.onClientTick(); h.advance(25); h.guard.poll(); h.advance(25) }
    expect(h.guard.sent - before).toBe(20)
  })

  it('steps aside when the protocol library starts ending ticks itself', () => {
    const h = harness()
    // a future library version: "move, tick_end" written by the library every tick
    for (let tick = 0; tick < 4; tick++) { h.guard.onClientTick(); h.write('position'); h.write('tick_end'); h.advance(50) }
    // only the very first client tick (before the library was seen) came from the guard
    expect(h.wire).toEqual(['tick_end', 'position', 'tick_end', 'position', 'tick_end', 'position', 'tick_end', 'position', 'tick_end'])
    expect(h.guard.sent).toBe(1)
    // the invariant is still enforced if the library ever sends two position packets in one tick
    h.write('position'); h.write('position_look')
    expect(serverAccepts(h.wire)).toBe(true)
  })

  it('never lets a random packet stream violate the server rule', () => {
    let seed = 42
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const NAMES = (run: number) => ['position', 'position_look', 'look', 'flying', 'teleport_confirm', 'chat', 'keep_alive', ...(run % 5 === 0 ? ['tick_end'] : [])]
    for (let run = 0; run < 50; run++) {
      const h = harness()
      const names = NAMES(run)
      for (let i = 0; i < 400; i++) {
        const r = rnd()
        if (r < 0.25) h.guard.onClientTick()
        else if (r < 0.3) { h.advance(120); h.guard.poll() }
        else h.write(names[Math.floor(rnd() * names.length)])
      }
      expect(serverAccepts(h.wire)).toBe(true)
    }
  })
})

describe('installTickEnd', () => {
  const fakeBot = (hasPacket: boolean) => {
    const written: string[] = []
    const listeners: Record<string, (() => void)[]> = {}
    const client: any = { state: 'play', ended: false, write: (name: string) => { written.push(name) } }
    const bot: any = {
      _client: client,
      registry: { protocol: { play: { toServer: { types: hasPacket ? { packet_tick_end: ['container', []] } : {} } } } },
      on: (ev: string, fn: () => void) => { (listeners[ev] ??= []).push(fn) },
      removeListener: (ev: string, fn: () => void) => { listeners[ev] = (listeners[ev] ?? []).filter(f => f !== fn) },
      emit: (ev: string) => { for (const f of listeners[ev] ?? []) f() }
    }
    return { bot, client, written, listeners }
  }

  it('wraps the client so movement is always separated by tick ends, and can be undone', () => {
    const f = fakeBot(true)
    expect(supportsTickEnd(f.bot)).toBe(true)
    const original = f.client.write
    const undo = installTickEnd(f.bot)
    f.client.write('position_look', {}); f.bot.emit('physicsTick'); f.client.write('position', {}); f.client.write('position', {})
    expect(f.written).toEqual(['position_look', 'tick_end', 'position', 'tick_end', 'position'])
    expect(serverAccepts(f.written)).toBe(true)
    undo()
    expect(f.client.write).not.toBe(original) // restored to the bound original, not the wrapper
    f.client.write('position', {}); f.client.write('position', {})
    expect(f.written.slice(-2)).toEqual(['position', 'position'])
    expect(f.listeners.physicsTick).toEqual([])
  })

  it('stays silent outside the play state and on versions without the packet', () => {
    const f = fakeBot(true)
    const undo = installTickEnd(f.bot)
    f.client.state = 'configuration'
    f.bot.emit('physicsTick'); f.client.write('position', {}); f.client.write('position', {})
    expect(f.written).toEqual(['position', 'position'])
    undo()

    const old = fakeBot(false)
    expect(supportsTickEnd(old.bot)).toBe(false)
    const before = old.client.write
    installTickEnd(old.bot)()
    expect(old.client.write).toBe(before)
    expect(supportsTickEnd(null)).toBe(false)
  })
})
