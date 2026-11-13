/**
 * Contract between the art modules (materials.ts / textures.ts / itemicons.ts)
 * and the engine (registry, mesher, HUD).
 */
export const LAYER_OPAQUE = 0
export const LAYER_CUTOUT = 1
export const LAYER_TRANSLUCENT = 2
export type LayerType = 0 | 1 | 2

/**
 * auto   – geometry comes from the block's collision shape (full cube → cube, otherwise
 *          its boxes), or from `boxes` when given.
 * cube   – force a full cube even if the block has no collision (e.g. powder snow).
 * cross  – two diagonal quads (plants). Uses tiles[2].
 * flat   – a single double-sided quad lying just above the floor (rails, redstone dust). Uses tiles[1].
 * liquid – water / lava surface logic. Uses tiles[1] (top) and tiles[2] (sides).
 * none   – invisible (air, barrier, light, structure void…).
 */
export type RenderKind = 'auto' | 'cube' | 'cross' | 'flat' | 'liquid' | 'none'

/** Tile keys for faces in protocol order: down(-y), up(+y), north(-z), south(+z), west(-x), east(+x). */
export type FaceTiles = [string, string, string, string, string, string]

export interface BlockLook {
  kind: RenderKind
  layer: LayerType
  tiles: FaceTiles
  /** Rendered at full brightness regardless of world light (lava, glowstone, fire, torches…). */
  emissive?: boolean
  /** Custom geometry for blocks without a collision shape: boxes [x1,y1,z1,x2,y2,z2] in 0..1 block space. */
  boxes?: number[][]
}

export const TILE_SIZE = 16
