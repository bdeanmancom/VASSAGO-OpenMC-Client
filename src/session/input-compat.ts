/**
 * Sneak and sprint packets the protocol library gets wrong on some versions.
 *
 * Two things changed in the protocol, and the library (mineflayer 4.39) follows neither fully:
 *
 * 1. 1.21.2 added a "player input" packet. From 1.21.6 on the server reads sneaking from it and
 *    the old "start/stop sneaking" entity actions are gone. The library sends only the input
 *    packet wherever it exists — so on 1.21.2–1.21.5, where the server still expects the entity
 *    action, sneaking never reaches the server.
 * 2. Removing those two actions in 1.21.6 renumbered the rest. The library still writes the old
 *    numbers, so "start sprinting" (3) arrives as "start riding jump" and the server never
 *    learns that the player sprints (nor wakes up, nor opens an elytra).
 *
 * Both are corrected here, at the last step before the packet is written, from the protocol
 * tables of the version in use — nothing is hard-coded per version.
 */

/** Entity action numbering up to 1.21.5: what the library means by a numeric id. */
const LEGACY_ACTIONS = ['start_sneaking', 'stop_sneaking', 'stop_sleeping', 'start_sprinting', 'stop_sprinting', 'start_riding_jump', 'stop_riding_jump', 'open_inventory', 'start_fall_flying']

export interface ActionTable {
  /** id → name for this protocol version */
  byId: Record<string, string>
  names: Set<string>
}

/** The entity-action table of a protocol version, or null when it has none we can read. */
export function actionTable (protocol: any): ActionTable | null {
  const packet = protocol?.play?.toServer?.types?.packet_entity_action
  const field = Array.isArray(packet) && Array.isArray(packet[1]) ? packet[1].find((f: any) => f?.name === 'actionId') : null
  const type = field?.type
  if (!Array.isArray(type) || type[0] !== 'mapper' || !type[1]?.mappings) return null
  const byId: Record<string, string> = type[1].mappings
  return { byId, names: new Set(Object.values(byId)) }
}

/**
 * The entity action to write in place of one the library wrote with an old numeric id.
 * Returns the parameters to send (by name, so the serializer picks the right number), the
 * original parameters when nothing needs fixing, or null when the action no longer exists.
 */
export function fixEntityAction (params: any, table: ActionTable | null): any | null {
  if (!table || typeof params?.actionId !== 'number') return params
  const meant = LEGACY_ACTIONS[params.actionId]
  if (meant === undefined || table.byId[String(params.actionId)] === meant) return params
  return table.names.has(meant) ? { ...params, actionId: meant } : null
}

/** True on versions that have the input packet but still read sneaking from the entity action. */
export function sneakNeedsAction (table: ActionTable | null, hasInputPacket: boolean): boolean {
  return hasInputPacket && !!table?.names.has('start_sneaking')
}

/** Correct a bot's outgoing sneak/sprint packets. Returns a function that undoes the wiring. */
export function installInputCompat (bot: any): () => void {
  const client = bot?._client
  if (!client) return () => {}
  const protocol = bot.registry?.protocol
  const table = actionTable(protocol)
  const alsoAction = sneakNeedsAction(table, !!protocol?.play?.toServer?.types?.packet_player_input)
  const before = client.write
  const raw: (name: string, params: unknown) => void = before.bind(client)
  let shift = false
  client.write = (name: string, params: any) => {
    if (name === 'entity_action') {
      const fixed = fixEntityAction(params, table)
      if (fixed !== null) raw(name, fixed)
      return
    }
    raw(name, params)
    if (name === 'player_input' && alsoAction && typeof params?.inputs?.shift === 'boolean' && params.inputs.shift !== shift) {
      shift = params.inputs.shift
      raw('entity_action', { entityId: bot.entity?.id ?? 0, actionId: shift ? 'start_sneaking' : 'stop_sneaking', jumpBoost: 0 })
    }
  }
  return () => { client.write = before }
}
