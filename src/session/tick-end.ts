/**
 * Client tick-end packets.
 *
 * Since 1.21.2 the official client finishes every game tick by sending a "client tick end"
 * packet after that tick's movement packet. Servers before 26.3 do not depend on it, but 26.3
 * does: `ServerGamePacketListenerImpl.handleMovePlayer` remembers that a position-carrying move
 * packet arrived (`receivedPositionThisTick`), only `handleClientTickEnd` clears that, and a
 * second position packet while it is still set disconnects the player with
 * `multiplayer.disconnect.invalid_player_movement` ("Invalid move player packet received").
 *
 * The protocol library we build on (mineflayer) never sends tick-end, so on a 26.3 server the
 * client was kicked on its second position packet — about one second after spawning, even when
 * standing still. This module supplies the missing packet and guarantees the invariant the
 * server checks: there is always a tick-end between two position-carrying move packets.
 *
 * The guard is plain logic (no timers, no sockets) so it can be unit-tested; `installTickEnd`
 * wires it to a live bot.
 */

/** Serverbound move packets that carry a position (minecraft-data names). */
const POSITIONAL = new Set(['position', 'position_look'])

/** How long the physics loop may be silent before the fallback timer ends ticks itself. */
const STALL_MS = 100

export interface TickEndGuard {
  /** Call for every outgoing play packet, before it is written. */
  beforeWrite: (name: string) => void
  /** Call once per simulated client tick, before that tick's movement is written. */
  onClientTick: () => void
  /** Call periodically; ends a tick only when no tick has been ended for a while. */
  poll: () => void
  /** Number of tick-end packets sent so far. */
  readonly sent: number
}

export function createTickEndGuard (sendTickEnd: () => void, now: () => number = Date.now): TickEndGuard {
  let positionSinceTickEnd = false
  let lastEnd = now()
  let sent = 0
  const end = () => {
    sendTickEnd()
    sent++
    positionSinceTickEnd = false
    lastEnd = now()
  }
  return {
    beforeWrite (name) {
      if (!POSITIONAL.has(name)) return
      // Two position packets must never reach the server without a tick end between them.
      if (positionSinceTickEnd) end()
      positionSinceTickEnd = true
    },
    // The physics loop calls this at the start of tick N, i.e. after tick N-1's movement packet:
    // on the wire that is "move, tick end, move, tick end, …" exactly like the official client.
    onClientTick () { end() },
    // While the physics loop is paused (terrain not loaded yet, dead, mounted) the official client
    // still ends its ticks; keep doing so at tick rate.
    poll () { if (now() - lastEnd >= STALL_MS) end() },
    get sent () { return sent }
  }
}

/** True when this protocol version has the tick-end packet (1.21.2 and later). */
export function supportsTickEnd (bot: any): boolean {
  try { return !!bot.registry?.protocol?.play?.toServer?.types?.packet_tick_end } catch { return false }
}

/**
 * Make a mineflayer bot end its client ticks. Returns a function that undoes the wiring.
 * Does nothing on protocol versions without the packet.
 */
export function installTickEnd (bot: any): () => void {
  const client = bot?._client
  if (!client || !supportsTickEnd(bot)) return () => {}
  const rawWrite: (name: string, params: unknown) => void = client.write.bind(client)
  const inPlay = () => client.state === 'play' && !client.ended
  const guard = createTickEndGuard(() => { if (inPlay()) rawWrite('tick_end', {}) })

  client.write = (name: string, params: unknown) => {
    if (inPlay()) guard.beforeWrite(name)
    return rawWrite(name, params)
  }
  const onTick = () => guard.onClientTick()
  bot.on('physicsTick', onTick)
  const timer = setInterval(() => { if (inPlay()) guard.poll() }, 50)
  return () => {
    clearInterval(timer)
    try { bot.removeListener('physicsTick', onTick) } catch {}
    client.write = rawWrite
  }
}
