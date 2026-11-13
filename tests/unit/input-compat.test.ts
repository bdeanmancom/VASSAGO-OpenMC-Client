import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { actionTable, fixEntityAction, installInputCompat, sneakNeedsAction } from '../../src/session/input-compat'

const require = createRequire(import.meta.url)
const mcData = require('minecraft-data')
const mc = require('minecraft-protocol')

const protocol = (v: string) => mcData(v).protocol
const hasInput = (v: string) => !!protocol(v).play.toServer.types.packet_player_input

/** The action id that really goes on the wire, read back with the protocol library's own parser. */
function wireAction (version: string, params: any): string | number {
  const serializer = mc.createSerializer({ state: 'play', isServer: false, version })
  const deserializer = mc.createDeserializer({ state: 'play', isServer: true, version })
  const buffer = serializer.createPacketBuffer({ name: 'entity_action', params })
  return deserializer.parsePacketBuffer(buffer).data.params.actionId
}

describe('entity actions', () => {
  it('documents the library defect: the old number for "start sprinting" means something else from 1.21.6 on', () => {
    expect(wireAction('1.21.4', { entityId: 1, actionId: 3, jumpBoost: 0 })).toBe('start_sprinting')
    expect(wireAction('1.21.11', { entityId: 1, actionId: 3, jumpBoost: 0 })).toBe('start_riding_jump')
    expect(wireAction('26.1', { entityId: 1, actionId: 4, jumpBoost: 0 })).toBe('stop_riding_jump')
  })
  it('sends what was meant on every version', () => {
    for (const v of ['1.21.1', '1.21.4', '1.21.5', '1.21.6', '1.21.11', '26.1']) {
      const table = actionTable(protocol(v))
      for (const [legacy, meant] of [[3, 'start_sprinting'], [4, 'stop_sprinting'], [2, 'stop_sleeping'], [8, 'start_fall_flying']] as [number, string][]) {
        const fixed = fixEntityAction({ entityId: 1, actionId: legacy, jumpBoost: 0 }, table)
        expect(fixed, `${v} ${meant}`).not.toBeNull()
        expect(wireAction(v, fixed), `${v} ${meant}`).toBe(meant)
      }
    }
  })
  it('drops an action the version no longer has, and leaves named or unknown ones alone', () => {
    const modern = actionTable(protocol('1.21.11'))
    expect(fixEntityAction({ entityId: 1, actionId: 0, jumpBoost: 0 }, modern)).toBeNull() // start sneaking is gone
    expect(fixEntityAction({ entityId: 1, actionId: 'start_sprinting', jumpBoost: 0 }, modern)).toEqual({ entityId: 1, actionId: 'start_sprinting', jumpBoost: 0 })
    expect(fixEntityAction({ entityId: 1, actionId: 42, jumpBoost: 0 }, modern)).toEqual({ entityId: 1, actionId: 42, jumpBoost: 0 })
    expect(fixEntityAction({ entityId: 1, actionId: 3, jumpBoost: 0 }, null)).toEqual({ entityId: 1, actionId: 3, jumpBoost: 0 })
  })
})

describe('sneaking', () => {
  it('needs the entity action exactly where the input packet exists but the server does not read it yet', () => {
    const needs = (v: string) => sneakNeedsAction(actionTable(protocol(v)), hasInput(v))
    expect(needs('1.21.1')).toBe(false) // no input packet: the library sends the action itself
    expect(needs('1.21.3')).toBe(true)
    expect(needs('1.21.4')).toBe(true)
    expect(needs('1.21.5')).toBe(true)
    expect(needs('1.21.6')).toBe(false) // the server reads the input packet
    expect(needs('1.21.11')).toBe(false)
    expect(needs('26.1')).toBe(false)
  })
})

describe('installInputCompat', () => {
  const fake = (version: string) => {
    const wire: [string, any][] = []
    const client: any = { write (name: string, params: any) { wire.push([name, params]) } }
    const bot: any = { _client: client, entity: { id: 7 }, registry: { protocol: protocol(version) } }
    return { wire, client, bot, undo: installInputCompat(bot) }
  }
  it('on 1.21.4, adds the sneak action next to the input packet, once per change', () => {
    const f = fake('1.21.4')
    f.client.write('player_input', { inputs: { shift: true } })
    f.client.write('player_input', { inputs: { shift: true } })
    f.client.write('player_input', { inputs: { shift: false } })
    expect(f.wire.map(([n, p]) => n === 'entity_action' ? `${n}:${p.actionId}:${p.entityId}` : `${n}:${p.inputs.shift}`)).toEqual([
      'player_input:true', 'entity_action:start_sneaking:7', 'player_input:true', 'player_input:false', 'entity_action:stop_sneaking:7'
    ])
    expect(wireAction('1.21.4', f.wire[1][1])).toBe('start_sneaking')
  })
  it('on 1.21.11, leaves sneaking to the input packet and corrects sprinting', () => {
    const f = fake('1.21.11')
    f.client.write('player_input', { inputs: { shift: true } })
    f.client.write('entity_action', { entityId: 7, actionId: 3, jumpBoost: 0 })
    f.client.write('entity_action', { entityId: 7, actionId: 0, jumpBoost: 0 }) // would be "start sneaking": no longer exists
    f.client.write('position', { x: 0 })
    expect(f.wire).toEqual([
      ['player_input', { inputs: { shift: true } }],
      ['entity_action', { entityId: 7, actionId: 'start_sprinting', jumpBoost: 0 }],
      ['position', { x: 0 }]
    ])
  })
  it('can be undone', () => {
    const f = fake('1.21.11')
    f.undo()
    f.client.write('entity_action', { entityId: 7, actionId: 3, jumpBoost: 0 })
    expect(f.wire).toEqual([['entity_action', { entityId: 7, actionId: 3, jumpBoost: 0 }]])
  })
})
