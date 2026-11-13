/**
 * Block-state registry: flattens the per-version game data plus the art module's
 * looks into typed-array tables indexed by block-state id. The tables are built once
 * on the main thread and structured-cloned into the mesher workers.
 */
import type { BlockLook } from './looks'
import { LAYER_OPAQUE, LAYER_TRANSLUCENT } from './looks'

export interface GameDataBlock {
  n: string, d: string, min: number, max: number, def: number, tr: number, el: number, fl: number
  bb: string, h: number | null, p: [string, string[]][], s: number | number[]
}
export interface GameData {
  version: string
  protocol: number
  blocks: GameDataBlock[]
  shapes: number[][][]
  items: { id: number, n: string, d: string, ss: number }[]
  entities: { id: number, n: string, d: string, w: number, h: number, t: string }[]
}

export const K_AIR = 0
export const K_CUBE = 1
export const K_BOXES = 2
export const K_CROSS = 3
export const K_FLAT = 4
export const K_LIQUID = 5

export const F_OCCLUDES = 1
export const F_EMISSIVE = 2
export const F_WATER = 4
export const F_CULL_SAME = 8
export const F_SOLID = 16 // has a collision shape

/** Plain-data tables (cloneable to workers). */
export interface RegistryTables {
  stateCount: number
  kind: Uint8Array
  flags: Uint8Array
  layer: Uint8Array
  /** state*6 → tile layer */
  tiles: Uint16Array
  boxOffset: Uint32Array
  boxCount: Uint8Array
  boxData: Float32Array
  liquidLevel: Uint8Array
  waterTop: number
  waterSide: number
}

export interface Registry extends RegistryTables {
  data: GameData
  blockOfState: Uint16Array
  tileKeys: string[]
  blockByName: Map<string, GameDataBlock>
  itemById: Map<number, { id: number, n: string, d: string, ss: number }>
  defaultLook: (blockName: string) => BlockLook | null
}

export type LookFn = (name: string, props: Record<string, string>, hasCollision: boolean) => BlockLook
export type WaterFn = (name: string, props: Record<string, string>) => boolean

export function decodeProps (block: GameDataBlock, stateId: number): Record<string, string> {
  const props: Record<string, string> = {}
  let off = stateId - block.min
  for (let i = block.p.length - 1; i >= 0; i--) {
    const [name, values] = block.p[i]
    props[name] = values[off % values.length]
    off = Math.floor(off / values.length)
  }
  return props
}

function isFullCube (boxes: number[][]): boolean {
  if (boxes.length !== 1) return false
  const b = boxes[0]
  return b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 1 && b[4] === 1 && b[5] === 1
}

export function buildRegistry (data: GameData, lookFor: LookFn, containsWater: WaterFn): Registry {
  let stateCount = 0
  for (const b of data.blocks) stateCount = Math.max(stateCount, b.max + 1)
  const kind = new Uint8Array(stateCount)
  const flags = new Uint8Array(stateCount)
  const layer = new Uint8Array(stateCount)
  const tiles = new Uint16Array(stateCount * 6)
  const boxOffset = new Uint32Array(stateCount)
  const boxCount = new Uint8Array(stateCount)
  const liquidLevel = new Uint8Array(stateCount)
  const blockOfState = new Uint16Array(stateCount)
  const boxData: number[] = []
  const tileKeys: string[] = []
  const tileIndex = new Map<string, number>()
  const tileId = (key: string) => {
    let id = tileIndex.get(key)
    if (id === undefined) { id = tileKeys.length; tileKeys.push(key); tileIndex.set(key, id) }
    return id
  }
  const boxCache = new Map<string, number>()
  const internBoxes = (boxes: number[][]): number => {
    const key = boxes.map(b => b.join(',')).join(';')
    let off = boxCache.get(key)
    if (off === undefined) {
      off = boxData.length / 6
      for (const b of boxes) boxData.push(b[0], b[1], b[2], b[3], b[4], b[5])
      boxCache.set(key, off)
    }
    return off
  }

  const waterBlock = data.blocks.find(b => b.n === 'water')
  let waterTop = 0; let waterSide = 0
  if (waterBlock) {
    const wl = lookFor('water', decodeProps(waterBlock, waterBlock.def), false)
    waterTop = tileId(wl.tiles[1]); waterSide = tileId(wl.tiles[2])
  }

  const blockByName = new Map<string, GameDataBlock>()
  data.blocks.forEach((block, bi) => {
    blockByName.set(block.n, block)
    for (let s = block.min; s <= block.max; s++) {
      blockOfState[s] = bi
      const shapeIdx = Array.isArray(block.s) ? block.s[s - block.min] : block.s
      const shape = data.shapes[shapeIdx] ?? []
      const props = block.p.length > 0 ? decodeProps(block, s) : {}
      const look = lookFor(block.n, props, shape.length > 0)
      let k = K_AIR
      let boxes: number[][] | null = null
      switch (look.kind) {
        case 'none': k = K_AIR; break
        case 'liquid': k = K_LIQUID; break
        case 'cross': k = K_CROSS; break
        case 'flat': k = K_FLAT; break
        case 'cube': k = K_CUBE; break
        default: {
          boxes = look.boxes && look.boxes.length > 0 ? look.boxes : shape
          if (boxes.length === 0) k = K_AIR
          else if (isFullCube(boxes)) k = K_CUBE
          else k = K_BOXES
        }
      }
      kind[s] = k
      layer[s] = look.layer
      let f = 0
      if (k === K_CUBE && look.layer === LAYER_OPAQUE) f |= F_OCCLUDES
      if (look.emissive) f |= F_EMISSIVE
      if (containsWater(block.n, props)) f |= F_WATER
      if (k === K_CUBE && look.layer !== LAYER_OPAQUE && (look.layer === LAYER_TRANSLUCENT || !block.n.endsWith('leaves'))) f |= F_CULL_SAME
      if (shape.length > 0) f |= F_SOLID
      flags[s] = f
      if (k !== K_AIR) for (let i = 0; i < 6; i++) tiles[s * 6 + i] = tileId(look.tiles[i])
      if (k === K_BOXES && boxes) { boxOffset[s] = internBoxes(boxes); boxCount[s] = Math.min(boxes.length, 255) }
      if (k === K_LIQUID) liquidLevel[s] = Number(props.level ?? 0) | 0
    }
  })

  const lookCache = new Map<string, BlockLook | null>()
  const defaultLook = (name: string): BlockLook | null => {
    if (lookCache.has(name)) return lookCache.get(name) ?? null
    const block = blockByName.get(name)
    let look: BlockLook | null = null
    if (block) {
      const shapeIdx = Array.isArray(block.s) ? block.s[block.def - block.min] : block.s
      look = lookFor(name, decodeProps(block, block.def), (data.shapes[shapeIdx] ?? []).length > 0)
    }
    lookCache.set(name, look)
    return look
  }

  return {
    data,
    stateCount,
    kind,
    flags,
    layer,
    tiles,
    boxOffset,
    boxCount,
    boxData: Float32Array.from(boxData),
    liquidLevel,
    waterTop,
    waterSide,
    blockOfState,
    tileKeys,
    blockByName,
    itemById: new Map(data.items.map(i => [i.id, i])),
    defaultLook
  }
}

export function tablesOf (r: Registry): RegistryTables {
  return {
    stateCount: r.stateCount,
    kind: r.kind,
    flags: r.flags,
    layer: r.layer,
    tiles: r.tiles,
    boxOffset: r.boxOffset,
    boxCount: r.boxCount,
    boxData: r.boxData,
    liquidLevel: r.liquidLevel,
    waterTop: r.waterTop,
    waterSide: r.waterSide
  }
}
