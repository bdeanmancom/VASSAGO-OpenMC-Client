/**
 * Message protocol between the headless game session (protocol + gameplay core)
 * and whatever front-end drives it (the Electron renderer, or tests).
 * Everything here is plain structured-cloneable data.
 */

export type AuthMode = 'offline' | 'microsoft'

export interface ConnectOptions {
  host: string
  port: number
  username: string
  auth: AuthMode
  /** Explicit game version (e.g. "1.21.11"), or null to auto-detect by pinging. */
  version: string | null
  viewDistance: number
  /** Optional Azure application (client) id for Microsoft sign-in. */
  msaClientId?: string | null
}

export interface ItemDTO {
  id: number
  name: string
  displayName: string
  count: number
  stackSize: number
  damage?: number
  maxDamage?: number
  enchanted?: boolean
  customName?: string
}

export interface EntityDTO {
  id: number
  /** registry name e.g. "zombie", "player", "item" */
  name: string
  kind: string
  username?: string
  uuid?: string
  x: number; y: number; z: number
  yaw: number; pitch: number
  width: number; height: number
  sneaking?: boolean
  /** item id held in main hand, or dropped item id for item entities */
  heldItem?: ItemDTO | null
}

export interface EntityMove { id: number, x: number, y: number, z: number, yaw: number, pitch: number, headYaw?: number }

export interface SectionDTO {
  /** 4096 block-state ids (y<<8|z<<4|x) or null when the section is entirely air. */
  blocks: Uint16Array | null
  /** 4096 bytes, sky<<4|block; or a uniform byte value when number. */
  light: Uint8Array | number
}

export interface WindowDTO {
  id: number
  type: string
  title: string
  /** number of container slots preceding the player inventory (0 for the player inventory itself) */
  inventoryStart: number
  slots: (ItemDTO | null)[]
  cursor: ItemDTO | null
  hotbar: number
}

export interface PlayerListEntry { uuid: string, username: string, ping: number, gamemode: number, displayName?: string }

export type SessionPhase = 'idle' | 'authenticating' | 'connecting' | 'login' | 'loading' | 'playing' | 'disconnected'

export type SessionEvent =
  | { t: 'phase', phase: SessionPhase, detail?: string }
  | { t: 'msaCode', userCode: string, verificationUri: string, expiresIn: number }
  | { t: 'login', entityId: number, username: string, uuid: string, version: string, protocol: number, gameMode: string, dimension: string, minY: number, height: number, brand?: string }
  | { t: 'respawn', dimension: string, minY: number, height: number, gameMode: string }
  | { t: 'chunk', x: number, z: number, minY: number, sections: SectionDTO[] }
  | { t: 'chunkLight', x: number, z: number, light: (Uint8Array | number)[] }
  | { t: 'unloadChunk', x: number, z: number }
  | { t: 'blocks', updates: Int32Array } // [x,y,z,state]*
  | { t: 'self', x: number, y: number, z: number, vx: number, vy: number, vz: number, onGround: boolean, inWater: boolean, tick: number }
  | { t: 'forcedLook', yaw: number, pitch: number }
  | { t: 'health', health: number, food: number, saturation: number }
  | { t: 'experience', level: number, progress: number }
  | { t: 'gameMode', gameMode: string }
  | { t: 'death' }
  | { t: 'hurt' }
  | { t: 'entitySpawn', e: EntityDTO }
  | { t: 'entityUpdate', e: EntityDTO }
  | { t: 'entityMoves', moves: EntityMove[] }
  | { t: 'entityGone', id: number }
  | { t: 'entityAnim', id: number, anim: 'swing' | 'hurt' }
  | { t: 'window', w: WindowDTO }
  | { t: 'windowClose' }
  | { t: 'chat', motd: string, plain: string, kind: 'chat' | 'system' | 'actionbar' }
  | { t: 'title', text: string, subtitle?: boolean }
  | { t: 'time', timeOfDay: number, day: number, raining: boolean }
  | { t: 'players', players: PlayerListEntry[] }
  | { t: 'resourcePack', url: string, forced: boolean, prompt?: string }
  | { t: 'dig', x: number, y: number, z: number, state: 'start' | 'done' | 'cancel', timeMs: number }
  | { t: 'disconnect', reason: string, kicked: boolean, canReconnect: boolean }
  | { t: 'error', message: string }
  | { t: 'log', level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown }

export interface Controls { forward: boolean, back: boolean, left: boolean, right: boolean, jump: boolean, sprint: boolean, sneak: boolean }

export type SessionCommand =
  | { t: 'connect', opts: ConnectOptions }
  | { t: 'disconnect' }
  | { t: 'controls', c: Controls }
  | { t: 'look', yaw: number, pitch: number }
  | { t: 'chat', text: string }
  | { t: 'digStart', x: number, y: number, z: number, face: number }
  | { t: 'digCancel' }
  | { t: 'useBlock', x: number, y: number, z: number, face: number, cx: number, cy: number, cz: number }
  | { t: 'useItem' }
  | { t: 'useItemRelease' }
  | { t: 'attack', id: number }
  | { t: 'interactEntity', id: number }
  | { t: 'swing' }
  | { t: 'hotbar', slot: number }
  | { t: 'windowClick', slot: number, button: number, mode: number }
  | { t: 'windowClose' }
  | { t: 'drop', stack: boolean }
  | { t: 'respawn' }
  | { t: 'resourcePack', accept: boolean }
  | { t: 'viewDistance', chunks: number }
  | { t: 'fly', flying: boolean }

/** Face index → unit vector. Matches the vanilla protocol's direction enum. */
export const FACE_VECTORS: readonly (readonly [number, number, number])[] = [
  [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]
]

/** Versions that have passed the integration suite against a real server. */
export const VERIFIED_VERSIONS: readonly string[] = ['1.21.11']
