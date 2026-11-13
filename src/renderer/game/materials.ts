/**
 * Block appearance table: maps a block name + state properties to a BlockLook
 * (render kind, layer, six tile keys, optional custom boxes).
 *
 * All art is original and procedural — tile keys produced here are painted by
 * textures.ts. No game assets are shipped or referenced.
 *
 * Tile key grammar (only consumer: textures.paintTile):
 *   <id>[:<arg>…][~<op>]
 * where <op> is a bit mask applied when sampling the base tile:
 *   1 = transpose, 2 = flip horizontally, 4 = flip vertically.
 */
import {
  LAYER_OPAQUE as O, LAYER_CUTOUT as C, LAYER_TRANSLUCENT as T,
  type BlockLook, type FaceTiles, type LayerType, type RenderKind
} from './looks'
import { hasTile, DYE_NAMES, WOOD_NAMES } from './textures'

type Props = Record<string, string>
type Dyn = (p: Props, hasCollision: boolean) => BlockLook
type Entry = BlockLook | Dyn

// ---------------------------------------------------------------------------
// small constructors
// ---------------------------------------------------------------------------
const all = (k: string): FaceTiles => [k, k, k, k, k, k]
/** [down, up, north, south, west, east] from top / bottom / side keys. */
const tbs = (top: string, bottom: string, side: string): FaceTiles => [bottom, top, side, side, side, side]
const asTiles = (t: FaceTiles | string): FaceTiles => typeof t === 'string' ? all(t) : t

function mk (kind: RenderKind, layer: LayerType, tiles: FaceTiles | string, extra?: Partial<BlockLook>): BlockLook {
  return extra ? { kind, layer, tiles: asTiles(tiles), ...extra } : { kind, layer, tiles: asTiles(tiles) }
}
const solid = (tiles: FaceTiles | string, layer: LayerType = O, extra?: Partial<BlockLook>): BlockLook => mk('auto', layer, tiles, extra)
const cross = (key: string, extra?: Partial<BlockLook>): BlockLook => mk('cross', C, key, extra)
const flat = (key: string, extra?: Partial<BlockLook>): BlockLook => mk('flat', C, key, extra)
const boxed = (tiles: FaceTiles | string, boxes: number[][], layer: LayerType = O, extra?: Partial<BlockLook>): BlockLook =>
  mk('auto', layer, tiles, { boxes: px(boxes), ...extra })

const NONE_LOOK: BlockLook = mk('none', O, 'none')

const FACE: Record<string, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 }
const OPP = [1, 0, 3, 2, 5, 4]

/** Pixel-space (0..16) boxes → block space (0..1). */
function px (boxes: number[][]): number[][] {
  return boxes.map(b => [b[0] / 16, b[1] / 16, b[2] / 16, b[3] / 16, b[4] / 16, b[5] / 16])
}

/** Rotate a pixel-space box that was authored for facing=north around the block's vertical axis. */
function rotBox (b: number[], facing: string | undefined): number[] {
  const [x1, y1, z1, x2, y2, z2] = b
  switch (facing) {
    case 'south': return [16 - x2, y1, 16 - z2, 16 - x1, y2, 16 - z1]
    case 'east': return [16 - z2, y1, x1, 16 - z1, y2, x2]
    case 'west': return [z1, y1, 16 - x2, z2, y2, 16 - x1]
    default: return b
  }
}
const rot = (boxes: number[][], facing: string | undefined): number[][] => boxes.map(b => rotBox(b, facing))
const swapXZ = (boxes: number[][]): number[][] => boxes.map(b => [b[2], b[1], b[0], b[5], b[4], b[3]])
const flipY = (boxes: number[][]): number[][] => boxes.map(b => [b[0], 16 - b[4], b[2], b[3], 16 - b[1], b[5]])

/** Logs, pillars, hay…: end-grain on the faces perpendicular to `axis`, bark running along it. */
function pillar (axis: string | undefined, end: string, side: string): FaceTiles {
  const r = side + '~1'
  if (axis === 'x') return [r, r, r, r, end, end]
  if (axis === 'z') return [side, side, end, end, r, r]
  return [end, end, side, side, side, side]
}

/** Put `front` on the face named by `facing` (any of the six), `back` opposite. */
function faced (facing: string | undefined, front: string, side: string, top: string, bottom: string = top, back: string = side): FaceTiles {
  const t: FaceTiles = [bottom, top, side, side, side, side]
  const f = FACE[facing ?? 'north'] ?? 2
  if (f <= 1) { t[0] = side; t[1] = side }
  t[f] = front
  t[OPP[f]] = back
  return t
}

/** 16-step `rotation` property → quadrant: 0 south, 1 west, 2 north, 3 east. */
const quadrant = (rotation: string | undefined): number => ((Number(rotation ?? 0) + 2) >> 2) & 3
const QUAD_FACING = ['south', 'west', 'north', 'east']

// ---------------------------------------------------------------------------
// name helpers
// ---------------------------------------------------------------------------
const WOODS_BY_LENGTH = [...WOOD_NAMES].sort((a, b) => b.length - a.length)
const DYES_BY_LENGTH = [...DYE_NAMES].sort((a, b) => b.length - a.length)
const isWood = (s: string): boolean => WOOD_NAMES.includes(s)
const isDye = (s: string): boolean => DYE_NAMES.includes(s)
const STAGES = ['exposed', 'weathered', 'oxidized']

function hashName (s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// geometry builders
// ---------------------------------------------------------------------------
function fenceBoxes (p: Props): number[][] {
  const b: number[][] = [[6, 0, 6, 10, 16, 10]]
  if (p.north === 'true') b.push([7, 12, 0, 9, 15, 6], [7, 6, 0, 9, 9, 6])
  if (p.south === 'true') b.push([7, 12, 10, 9, 15, 16], [7, 6, 10, 9, 9, 16])
  if (p.west === 'true') b.push([0, 12, 7, 6, 15, 9], [0, 6, 7, 6, 9, 9])
  if (p.east === 'true') b.push([10, 12, 7, 16, 15, 9], [10, 6, 7, 16, 9, 9])
  return b
}

function wallBoxes (p: Props): number[][] {
  const b: number[][] = []
  const post = p.up !== 'false'
  if (post) b.push([4, 0, 4, 12, 16, 12])
  const m = post ? 4 : 8
  const seg = (v: string | undefined, box: number[]): void => {
    if (v === 'low' || v === 'tall' || v === 'true') { box[4] = v === 'tall' ? 16 : 14; b.push(box) }
  }
  seg(p.north, [5, 0, 0, 11, 14, m])
  seg(p.south, [5, 0, 16 - m, 11, 14, 16])
  seg(p.west, [0, 0, 5, m, 14, 11])
  seg(p.east, [16 - m, 0, 5, 16, 14, 11])
  if (b.length === 0) b.push([4, 0, 4, 12, 16, 12])
  return b
}

function gateBoxes (p: Props): number[][] {
  let b: number[][]
  if (p.open === 'true') {
    b = [
      [0, 5, 7, 2, 16, 9], [14, 5, 7, 16, 16, 9],
      [0, 12, 9, 2, 15, 15], [0, 6, 9, 2, 9, 15], [0, 9, 13, 2, 12, 15],
      [14, 12, 9, 16, 15, 15], [14, 6, 9, 16, 9, 15], [14, 9, 13, 16, 12, 15]
    ]
  } else {
    b = [
      [0, 5, 7, 2, 16, 9], [14, 5, 7, 16, 16, 9],
      [2, 12, 7, 14, 15, 9], [2, 6, 7, 14, 9, 9], [6, 9, 7, 10, 12, 9]
    ]
  }
  if (p.in_wall === 'true') b = b.map(x => [x[0], x[1] - 3, x[2], x[3], x[4] - 3, x[5]])
  return rot(b, p.facing)
}

/** Thin plates on the faces whose property is 'true' (vines, lichen, veins). */
function plateBoxes (p: Props, withVertical: boolean): number[][] {
  const b: number[][] = []
  if (p.north === 'true') b.push([0, 0, 0.2, 16, 16, 0.7])
  if (p.south === 'true') b.push([0, 0, 15.3, 16, 16, 15.8])
  if (p.west === 'true') b.push([0.2, 0, 0, 0.7, 16, 16])
  if (p.east === 'true') b.push([15.3, 0, 0, 15.8, 16, 16])
  if (p.up === 'true') b.push([0, 15.3, 0, 16, 15.8, 16])
  if (withVertical && p.down === 'true') b.push([0, 0.2, 0, 16, 0.7, 16])
  if (b.length === 0) b.push(withVertical ? [0, 0.2, 0, 16, 0.7, 16] : [0, 0, 15.3, 16, 16, 15.8])
  return b
}

function torchLook (kind: string, facing: string | undefined, lit: boolean): BlockLook {
  const k = lit ? kind : kind + '_off'
  const extra = lit ? { emissive: true } : undefined
  if (facing === undefined) {
    return boxed([`planks:oak`, `torch_top:${k}`, `torch:${k}`, `torch:${k}`, `torch:${k}`, `torch:${k}`], [[7, 0, 7, 9, 10, 9]], C, extra)
  }
  return boxed([`planks:oak`, `torch_top:${k}`, `torchw:${k}`, `torchw:${k}`, `torchw:${k}`, `torchw:${k}`], rot([[7, 3, 13, 9, 13, 15]], facing), C, extra)
}

function buttonBoxes (p: Props): number[][] {
  const h = p.powered === 'true' ? 1 : 2
  const alongX = p.facing === 'north' || p.facing === 'south' || p.facing === undefined
  if (p.face === 'wall') return rot([[5, 6, 16 - h, 11, 10, 16]], p.facing)
  const floor: number[][] = alongX ? [[5, 0, 6, 11, h, 10]] : [[6, 0, 5, 10, h, 11]]
  return p.face === 'ceiling' ? flipY(floor) : floor
}

function leverBoxes (p: Props): number[][] {
  const on = p.powered === 'true'
  if (p.face === 'wall') {
    return rot([[5, 4, 13, 11, 12, 16], on ? [7, 4, 8, 9, 6, 13] : [7, 10, 8, 9, 12, 13]], p.facing)
  }
  let b: number[][] = [[5, 0, 4, 11, 3, 12], on ? [7, 3, 9, 9, 10, 11] : [7, 3, 5, 9, 10, 7]]
  if (p.facing === 'east' || p.facing === 'west') b = swapXZ(b)
  return p.face === 'ceiling' ? flipY(b) : b
}

function cauldronBoxes (fill: number): number[][] {
  const b: number[][] = [
    [0, 0, 0, 4, 3, 4], [12, 0, 0, 16, 3, 4], [0, 0, 12, 4, 3, 16], [12, 0, 12, 16, 3, 16],
    [0, 3, 0, 16, 4, 16],
    [0, 4, 0, 16, 16, 2], [0, 4, 14, 16, 16, 16], [0, 4, 2, 2, 16, 14], [14, 4, 2, 16, 16, 14]
  ]
  if (fill > 0) b.push([2, 4, 2, 14, fill, 14])
  return b
}

// ---------------------------------------------------------------------------
// families
// ---------------------------------------------------------------------------
function woodLook (stripped: boolean, wood: string, kind: string): Entry | null {
  if (!isWood(wood)) return null
  const side = `${stripped ? 'slog' : 'log'}:${wood}`
  const end = `${stripped ? 'slogtop' : 'logtop'}:${wood}`
  if (kind === 'wood' || kind === 'hyphae') return p => solid(pillar(p.axis, side, side))
  return p => solid(pillar(p.axis, end, side))
}

function copperRule (name: string): Entry | null {
  let stage = 'new'
  let rest = name
  for (const s of STAGES) if (name.startsWith(s + '_')) { stage = s; rest = name.slice(s.length + 1) }
  const block = `copper:${stage}`
  const cut = `cut_copper:${stage}`
  switch (rest) {
    case 'copper': if (stage === 'new') return null; return solid(block)
    case 'copper_block': return solid(block)
    case 'cut_copper': case 'cut_copper_stairs': case 'cut_copper_slab': return solid(cut)
    case 'chiseled_copper': return solid(`chiseled_copper:${stage}`)
    case 'copper_grate': return solid(`copper_grate:${stage}`, C)
    case 'copper_bulb': return p => {
      const lit = p.lit === 'true'
      return solid(`copper_bulb:${stage}:${lit ? 'lit' : 'off'}${p.powered === 'true' ? ':pow' : ''}`, O, lit ? { emissive: true } : undefined)
    }
    case 'copper_door': return p => solid(`door:copper_${stage}:${p.half === 'upper' ? 'top' : 'bottom'}`, C)
    case 'copper_trapdoor': return solid(`trapdoor:copper_${stage}`, C)
    case 'copper_bars': return solid(`bars:copper_${stage}`, C)
    case 'copper_chain': return chainEntry(`copper_${stage}`)
    case 'copper_lantern': return lanternEntry(`copper_${stage}`)
    case 'copper_chest': return chestEntry(`copper_${stage}`)
    case 'lightning_rod': return solid(block)
    case 'copper_golem_statue': return solid(tbs(block, block, `copper_golem:${stage}`))
  }
  return null
}

function chainEntry (mat: string): Entry {
  const k = `chain:${mat}`
  const r = k + '~1'
  return p => {
    if (p.axis === 'x') return solid([r, r, r, r, k, k], C)
    if (p.axis === 'z') return solid([k, k, k, k, r, r], C)
    return solid(k, C)
  }
}

function lanternEntry (kind: string): Entry {
  const tiles = tbs(`lantern_top:${kind}`, `lantern_top:${kind}`, `lantern:${kind}`)
  const hang = tbs(`lantern_top:${kind}`, `lantern_top:${kind}`, `lantern:${kind}:hang`)
  const a = boxed(tiles, [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]], C, { emissive: true })
  const b = boxed(hang, [[5, 1, 5, 11, 8, 11], [6, 8, 6, 10, 10, 10], [7, 10, 7, 9, 16, 9]], C, { emissive: true })
  return p => p.hanging === 'true' ? b : a
}

function chestEntry (kind: string): Entry {
  return p => solid(faced(p.facing, `chest:${kind}:front`, `chest:${kind}:side`, `chest:${kind}:top`))
}

function signEntry (wood: string, mode: 'stand' | 'wall' | 'hang' | 'wallhang'): Entry | null {
  if (!isWood(wood)) return null
  if (mode === 'stand' || mode === 'wall') {
    const t = tbs(`planks:${wood}`, `planks:${wood}`, `sign:${wood}`)
    if (mode === 'wall') return p => boxed(t, rot([[0, 7, 14, 16, 15, 16]], p.facing))
    return p => {
      const b = [[0, 7, 7, 16, 15, 9], [7, 0, 7, 9, 7, 9]]
      return boxed(t, quadrant(p.rotation) & 1 ? swapXZ(b) : b)
    }
  }
  const t = tbs(`slog:${wood}`, `slog:${wood}`, `hsign:${wood}`)
  const body = [[1, 0, 7, 15, 10, 9], [3, 10, 7.5, 4, 16, 8.5], [12, 10, 7.5, 13, 16, 8.5]]
  if (mode === 'hang') return p => boxed(t, quadrant(p.rotation) & 1 ? swapXZ(body) : body, C)
  const wall = [[1, 0, 7, 15, 10, 9], [3, 10, 7.5, 4, 14, 8.5], [12, 10, 7.5, 13, 14, 8.5], [0, 14, 6, 16, 16, 10]]
  return p => boxed(t, p.facing === 'east' || p.facing === 'west' ? swapXZ(wall) : wall, C)
}

function bannerEntry (dye: string, wall: boolean): Entry | null {
  if (!isDye(dye)) return null
  const t = tbs(`wool:${dye}`, `wool:${dye}`, `banner:${dye}`)
  if (wall) return p => boxed(t, rot([[1, 0, 14.5, 15, 16, 15.5]], p.facing), C)
  return p => {
    const b = [[1, 0, 7.5, 15, 16, 8.5]]
    return boxed(t, quadrant(p.rotation) & 1 ? swapXZ(b) : b, C)
  }
}

function headEntry (type: string, wall: boolean): Entry {
  const skin = `head:${type}:skin`
  if (wall) return p => solid(faced(p.facing, `head:${type}:wall`, skin, skin))
  return p => solid(faced(QUAD_FACING[quadrant(p.rotation)], `head:${type}:front`, skin, skin))
}

function railEntry (type: string): Entry {
  return p => {
    const on = type !== 'normal' && p.powered === 'true'
    const k = `rail:${type}${on ? ':on' : ''}`
    switch (p.shape) {
      case 'east_west': case 'ascending_east': case 'ascending_west': return flat(k + '~1')
      case 'south_east': return flat('rail:curve')
      case 'south_west': return flat('rail:curve~2')
      case 'north_east': return flat('rail:curve~4')
      case 'north_west': return flat('rail:curve~6')
      default: return flat(k)
    }
  }
}

function doublePlant (name: string, extra?: Partial<BlockLook>): Entry {
  const lo = cross(`p:${name}:bottom`, extra)
  const hi = cross(`p:${name}:top`, extra)
  return p => p.half === 'upper' ? hi : lo
}

function ageCross (name: string, stage: (age: number) => number, extra?: Partial<BlockLook>): Entry {
  const memo: BlockLook[] = []
  return p => {
    const s = stage(Number(p.age ?? 0))
    return memo[s] ?? (memo[s] = cross(`p:${name}:${s}`, extra))
  }
}

/** Tiles of a plain cube-like base block in its default state (null when it would be the fallback). */
function baseTiles (stem: string): FaceTiles | null {
  const candidates = isWood(stem)
    ? [stem + '_planks']
    : [stem, stem + 's', stem + '_planks', stem + '_block', stem.replace(/brick$/, 'bricks'), stem.replace(/tile$/, 'tiles')]
  for (const c of candidates) {
    const e = entryFor(c)
    const l = typeof e === 'function' ? e({}, true) : e
    if (l.kind !== 'none' && !l.tiles[2].startsWith('fallback:')) return l.tiles
  }
  return null
}

function derived (stem: string): FaceTiles | null {
  if (stem === 'petrified_oak') return all('planks:oak')
  if (stem === 'smooth_stone') return tbs('smooth_stone', 'smooth_stone', 'smooth_stone_slab:side')
  if (stem === 'light_weighted') return all('gold_block')
  if (stem === 'heavy_weighted') return all('iron_block')
  return baseTiles(stem)
}

// ---------------------------------------------------------------------------
// plants handled as simple cutout crosses: tile key `p:<name>`
// ---------------------------------------------------------------------------
const CROSS_PLANTS = new Set([
  'dandelion', 'golden_dandelion', 'torchflower', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip',
  'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'wither_rose', 'lily_of_the_valley',
  'brown_mushroom', 'red_mushroom', 'short_grass', 'fern', 'dead_bush', 'bush', 'short_dry_grass',
  'tall_dry_grass', 'seagrass', 'cobweb', 'sugar_cane', 'crimson_fungus', 'warped_fungus', 'crimson_roots',
  'warped_roots', 'nether_sprouts', 'hanging_roots', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines',
  'twisting_vines_plant', 'kelp', 'kelp_plant', 'cactus_flower', 'open_eyeblossom', 'closed_eyeblossom',
  'firefly_bush', 'spore_blossom', 'bamboo_sapling', 'big_dripleaf_stem', 'attached_pumpkin_stem',
  'attached_melon_stem', 'grass', 'azalea_sprout'
])
const DOUBLE_PLANTS = new Set([
  'sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'tall_seagrass', 'pitcher_plant',
  'small_dripleaf'
])
const NONE = new Set(['air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void', 'moving_piston', 'tripwire'])

const CORALS = ['tube', 'brain', 'bubble', 'fire', 'horn']

// ---------------------------------------------------------------------------
// one-off blocks
// ---------------------------------------------------------------------------
const SPECIAL: Record<string, () => Entry> = {
  water: () => mk('liquid', T, tbs('water', 'water', 'water:flow')),
  bubble_column: () => mk('liquid', T, tbs('water', 'water', 'water:flow')),
  lava: () => mk('liquid', O, tbs('lava', 'lava', 'lava:flow'), { emissive: true }),

  grass_block: () => {
    const a = solid(tbs('grass:top', 'dirt', 'grass:side'))
    const b = solid(tbs('snow', 'dirt', 'grass:side:snowy'))
    return p => p.snowy === 'true' ? b : a
  },
  podzol: () => {
    const a = solid(tbs('podzol:top', 'dirt', 'podzol:side'))
    const b = solid(tbs('snow', 'dirt', 'grass:side:snowy'))
    return p => p.snowy === 'true' ? b : a
  },
  mycelium: () => {
    const a = solid(tbs('mycelium:top', 'dirt', 'mycelium:side'))
    const b = solid(tbs('snow', 'dirt', 'grass:side:snowy'))
    return p => p.snowy === 'true' ? b : a
  },
  dirt_path: () => solid(tbs('dirt_path:top', 'dirt', 'dirt_path:side')),
  farmland: () => {
    const dry = solid(tbs('farmland', 'dirt', 'dirt'))
    const wet = solid(tbs('farmland:wet', 'dirt', 'dirt'))
    return p => p.moisture === '7' ? wet : dry
  },
  snow: () => p => boxed('snow', [[0, 0, 0, 16, Number(p.layers ?? 1) * 2, 16]]),
  snow_block: () => solid('snow'),
  powder_snow: () => mk('cube', O, 'powder_snow'),
  ice: () => solid('ice', T),
  frosted_ice: () => solid('ice:frosted', T),
  slime_block: () => mk('cube', T, 'slime_block'),
  honey_block: () => mk('cube', T, 'honey_block'),
  soul_sand: () => mk('cube', O, 'soul_sand'),
  mud: () => mk('cube', O, 'mud'),
  glass: () => solid('glass', C),
  tinted_glass: () => solid('tinted_glass', T),
  glass_pane: () => solid(tbs('pane_edge:clear', 'pane_edge:clear', 'glass'), C),
  iron_bars: () => solid('bars:iron', C),
  iron_chain: () => chainEntry('iron'),
  chain: () => chainEntry('iron'),
  ladder: () => solid('ladder', C),
  scaffolding: () => solid(tbs('scaffolding:top', 'scaffolding:top', 'scaffolding:side'), C),
  spawner: () => solid('spawner', C),
  trial_spawner: () => p => {
    const on = p.trial_spawner_state !== undefined && p.trial_spawner_state !== 'inactive'
    const k = on ? (p.ominous === 'true' ? 'ominous' : 'on') : 'off'
    return solid(tbs(`trial_spawner:top:${k}`, 'trial_spawner:bottom', `trial_spawner:side:${k}`), C)
  },
  vault: () => p => {
    const on = p.vault_state !== undefined && p.vault_state !== 'inactive'
    const k = (p.ominous === 'true' ? 'ominous' : 'normal') + (on ? ':on' : '')
    return solid(faced(p.facing, `vault:front:${k}`, `vault:side:${k}`, `vault:top:${k}`, 'vault:bottom'), C)
  },
  mangrove_roots: () => solid(tbs('mangrove_roots:top', 'mangrove_roots:top', 'mangrove_roots:side'), C),
  muddy_mangrove_roots: () => p => solid(pillar(p.axis, 'muddy_mangrove_roots:top', 'muddy_mangrove_roots:side')),
  bamboo_block: () => p => solid(pillar(p.axis, 'bamboo_block:top', 'bamboo_block:side')),
  stripped_bamboo_block: () => p => solid(pillar(p.axis, 'stripped_bamboo_block:top', 'stripped_bamboo_block:side')),
  bamboo_mosaic: () => solid('bamboo_mosaic'),
  bamboo: () => solid('bamboo_stalk'),
  cactus: () => boxed(tbs('cactus:top', 'cactus:bottom', 'cactus:side'), [[1, 0, 1, 15, 16, 15]]),
  sugar_cane: () => cross('p:sugar_cane'),
  lily_pad: () => flat('lily_pad'),
  frogspawn: () => flat('frogspawn'),
  redstone_wire: () => p => {
    const c = (v: string | undefined): boolean => v === 'side' || v === 'up'
    let m = (c(p.north) ? 1 : 0) | (c(p.east) ? 2 : 0) | (c(p.south) ? 4 : 0) | (c(p.west) ? 8 : 0)
    // a wire with a single connection continues straight through
    if (m === 1 || m === 4) m = 5
    if (m === 2 || m === 8) m = 10
    return flat(`redstone:${m}:${Number(p.power ?? 0) > 0 ? 'on' : 'off'}`)
  },
  rail: () => railEntry('normal'),
  powered_rail: () => railEntry('powered'),
  detector_rail: () => railEntry('detector'),
  activator_rail: () => railEntry('activator'),
  pink_petals: () => p => flat(`petals:pink:${p.flower_amount ?? '4'}`),
  wildflowers: () => p => flat(`petals:wild:${p.flower_amount ?? '4'}`),
  leaf_litter: () => p => flat(`petals:litter:${p.segment_amount ?? '4'}`),
  vine: () => p => boxed('vine', plateBoxes(p, false), C),
  glow_lichen: () => p => boxed('glow_lichen', plateBoxes(p, true), C),
  sculk_vein: () => p => boxed('sculk_vein', plateBoxes(p, true), C),
  resin_clump: () => p => boxed('resin_clump', plateBoxes(p, true), C),
  fire: () => cross('fire', { emissive: true }),
  soul_fire: () => cross('fire:soul', { emissive: true }),
  nether_portal: () => p => boxed('nether_portal', p.axis === 'z' ? [[6, 0, 0, 10, 16, 16]] : [[0, 0, 6, 16, 16, 10]], T, { emissive: true }),
  end_portal: () => boxed('end_portal', [[0, 11, 0, 16, 12, 16]], O, { emissive: true }),
  end_gateway: () => mk('cube', O, 'end_portal', { emissive: true }),
  lever: () => p => boxed('lever', leverBoxes(p)),
  tripwire_hook: () => p => boxed('tripwire_hook', rot([[6, 1, 14, 10, 9, 16], [7.5, 3, 10, 8.5, 5, 14]], p.facing)),
  torch: () => torchLook('fire', undefined, true),
  wall_torch: () => p => torchLook('fire', p.facing ?? 'north', true),

  // --- nature -----------------------------------------------------------------
  pumpkin: () => solid(tbs('pumpkin:top', 'pumpkin:top', 'pumpkin:side')),
  carved_pumpkin: () => p => solid(faced(p.facing, 'pumpkin:face', 'pumpkin:side', 'pumpkin:top')),
  jack_o_lantern: () => p => solid(faced(p.facing, 'pumpkin:face:lit', 'pumpkin:side', 'pumpkin:top'), O, { emissive: true }),
  melon: () => solid(tbs('melon:top', 'melon:top', 'melon:side')),
  hay_block: () => p => solid(pillar(p.axis, 'hay_block:top', 'hay_block:side')),
  mushroom_stem: () => p => mushroomTiles(p, 'mushroom_stem'),
  brown_mushroom_block: () => p => mushroomTiles(p, 'brown_mushroom_block'),
  red_mushroom_block: () => p => mushroomTiles(p, 'red_mushroom_block'),
  azalea: () => solid(tbs('azalea:top', 'azalea:top', 'azalea:side'), C),
  flowering_azalea: () => solid(tbs('azalea:top:flowering', 'azalea:top', 'azalea:side:flowering'), C),
  moss_carpet: () => solid('moss_block'),
  pale_moss_carpet: () => p => {
    const b: number[][] = []
    if (p.bottom !== 'false') b.push([0, 0, 0, 16, 1, 16])
    const side = (v: string | undefined, box: number[]): void => {
      if (v === 'low' || v === 'tall') { box[4] = v === 'tall' ? 16 : 10; b.push(box) }
    }
    side(p.north, [0, 0, 0.2, 16, 10, 0.7]); side(p.south, [0, 0, 15.3, 16, 10, 15.8])
    side(p.west, [0.2, 0, 0, 0.7, 10, 16]); side(p.east, [15.3, 0, 0, 15.8, 10, 16])
    if (b.length === 0) b.push([0, 0, 0, 16, 1, 16])
    return boxed(tbs('pale_moss_block', 'pale_moss_block', 'pale_moss_carpet:side'), b, C)
  },
  pale_hanging_moss: () => {
    const a = cross('p:pale_hanging_moss:tip')
    const b = cross('p:pale_hanging_moss')
    return p => p.tip === 'false' ? b : a
  },
  big_dripleaf: () => p => {
    const y = p.tilt === 'full' ? 9 : p.tilt === 'partial' ? 11 : 14
    return boxed(tbs('big_dripleaf:top', 'big_dripleaf:top', 'big_dripleaf:stem'), [[0, y, 0, 16, y + 1, 16], [7, 0, 7, 9, y, 9]], C)
  },
  mangrove_propagule: () => {
    const a = cross('p:mangrove_propagule')
    const b = cross('p:mangrove_propagule:hanging')
    return p => p.hanging === 'true' ? b : a
  },
  cave_vines: () => caveVines('p:cave_vines'),
  cave_vines_plant: () => caveVines('p:cave_vines_plant'),
  wheat: () => ageCross('wheat', a => Math.min(a, 7)),
  carrots: () => ageCross('carrots', a => a < 2 ? 0 : a < 4 ? 1 : a < 7 ? 2 : 3),
  potatoes: () => ageCross('potatoes', a => a < 2 ? 0 : a < 4 ? 1 : a < 7 ? 2 : 3),
  beetroots: () => ageCross('beetroots', a => Math.min(a, 3)),
  nether_wart: () => ageCross('nether_wart', a => a < 1 ? 0 : a < 3 ? 1 : 2),
  sweet_berry_bush: () => ageCross('sweet_berry_bush', a => Math.min(a, 3)),
  torchflower_crop: () => ageCross('torchflower_crop', a => Math.min(a, 1)),
  pumpkin_stem: () => ageCross('stem', a => Math.min(a >> 1, 3)),
  melon_stem: () => ageCross('stem', a => Math.min(a >> 1, 3)),
  pitcher_crop: () => p => {
    const age = Math.min(Number(p.age ?? 0), 4)
    if (p.half === 'upper') return age < 3 ? NONE_LOOK : cross(`p:pitcher_crop:${age}:top`)
    return cross(`p:pitcher_crop:${age}`)
  },
  cocoa: () => p => solid(`cocoa:${Math.min(Number(p.age ?? 0), 2)}`),
  chorus_plant: () => solid('chorus_plant'),
  chorus_flower: () => p => solid(Number(p.age ?? 0) >= 5 ? 'chorus_flower:dead' : 'chorus_flower'),
  pointed_dripstone: () => p => cross(`p:dripstone:${p.thickness ?? 'tip'}${p.vertical_direction === 'down' ? '~4' : ''}`),
  amethyst_cluster: () => p => cross(`p:amethyst:3${p.facing === 'down' ? '~4' : ''}`),
  sea_pickle: () => solid('sea_pickle'),
  turtle_egg: () => solid('turtle_egg'),
  sniffer_egg: () => solid('sniffer_egg'),
  dried_ghast: () => solid('dried_ghast'),
  dragon_egg: () => boxed('dragon_egg', [
    [3, 0, 3, 13, 2, 13], [1, 2, 1, 15, 8, 15], [2, 8, 2, 14, 11, 14], [3, 11, 3, 13, 13, 13], [5, 13, 5, 11, 15, 11], [6, 15, 6, 10, 16, 10]
  ]),
  sponge: () => solid('sponge'),
  wet_sponge: () => solid('sponge:wet'),

  // --- utility ----------------------------------------------------------------
  crafting_table: () => solid(['planks:oak', 'crafting_table:top', 'crafting_table:front', 'crafting_table:front', 'crafting_table:side', 'crafting_table:side']),
  furnace: () => furnaceEntry('furnace'),
  blast_furnace: () => furnaceEntry('blast_furnace'),
  smoker: () => furnaceEntry('smoker'),
  dispenser: () => p => dispenserTiles(p, 'dispenser'),
  dropper: () => p => dispenserTiles(p, 'dropper'),
  observer: () => p => {
    const back = p.powered === 'true' ? 'observer:back:on' : 'observer:back'
    return solid(faced(p.facing, 'observer:front', 'observer:side', 'observer:top', 'observer:top', back))
  },
  piston: () => p => pistonLook(p, false),
  sticky_piston: () => p => pistonLook(p, true),
  piston_head: () => p => {
    const face = p.type === 'sticky' ? 'piston:top:sticky' : 'piston:top'
    return solid(faced(p.facing, face, 'piston:arm', 'piston:arm', 'piston:arm', 'piston:top'))
  },
  chest: () => chestEntry('wood'),
  trapped_chest: () => chestEntry('trapped'),
  ender_chest: () => chestEntry('ender'),
  barrel: () => p => {
    const top = p.open === 'true' ? 'barrel:top:open' : 'barrel:top'
    const s = 'barrel:side'
    const r = 'barrel:side~1'
    switch (p.facing) {
      case 'down': return solid(tbs('barrel:bottom', top, s))
      case 'north': return solid([s, s, top, 'barrel:bottom', r, r])
      case 'south': return solid([s, s, 'barrel:bottom', top, r, r])
      case 'west': return solid([r, r, r, r, top, 'barrel:bottom'])
      case 'east': return solid([r, r, r, r, 'barrel:bottom', top])
      default: return solid(tbs(top, 'barrel:bottom', s))
    }
  },
  bookshelf: () => solid(tbs('planks:oak', 'planks:oak', 'bookshelf')),
  chiseled_bookshelf: () => p => solid(faced(p.facing, 'chiseled_bookshelf:front', 'chiseled_bookshelf:side', 'chiseled_bookshelf:top')),
  jukebox: () => solid(tbs('jukebox:top', 'jukebox:side', 'jukebox:side')),
  note_block: () => solid('note_block'),
  tnt: () => solid(tbs('tnt:top', 'tnt:bottom', 'tnt:side')),
  target: () => solid(tbs('target:top', 'target:top', 'target:side')),
  loom: () => p => solid(faced(p.facing, 'loom:front', 'loom:side', 'loom:top', 'planks:oak')),
  cartography_table: () => solid(tbs('cartography_table:top', 'planks:dark_oak', 'cartography_table:side')),
  fletching_table: () => solid(tbs('fletching_table:top', 'planks:birch', 'fletching_table:side')),
  smithing_table: () => solid(tbs('smithing_table:top', 'smithing_table:bottom', 'smithing_table:side')),
  stonecutter: () => solid(tbs('stonecutter:top', 'stone', 'stonecutter:side')),
  grindstone: () => solid(tbs('grindstone:top', 'grindstone:top', 'grindstone:side')),
  lectern: () => boxed(tbs('lectern:top', 'planks:oak', 'lectern:side'), [[0, 0, 0, 16, 2, 16], [4, 2, 4, 12, 13, 12], [1, 13, 1, 15, 16, 15]]),
  composter: () => solid(tbs('composter:top', 'composter:side', 'composter:side')),
  hopper: () => solid(tbs('hopper:top', 'hopper:side', 'hopper:side')),
  cauldron: () => boxed(tbs('cauldron:top', 'cauldron:side', 'cauldron:side'), cauldronBoxes(0)),
  water_cauldron: () => p => boxed(tbs('cauldron:top:water', 'cauldron:side', 'cauldron:side'), cauldronBoxes(6 + 3 * Number(p.level ?? 3))),
  lava_cauldron: () => boxed(tbs('cauldron:top:lava', 'cauldron:side', 'cauldron:side'), cauldronBoxes(15), O, { emissive: true }),
  powder_snow_cauldron: () => p => boxed(tbs('cauldron:top:snow', 'cauldron:side', 'cauldron:side'), cauldronBoxes(6 + 3 * Number(p.level ?? 3))),
  brewing_stand: () => solid(tbs('brewing_stand:top', 'brewing_stand:top', 'brewing_stand')),
  enchanting_table: () => solid(tbs('enchanting_table:top', 'obsidian', 'enchanting_table:side')),
  end_portal_frame: () => p => solid(tbs(p.eye === 'true' ? 'end_portal_frame:top:eye' : 'end_portal_frame:top', 'end_stone', 'end_portal_frame:side')),
  anvil: () => solid(tbs('anvil:top', 'anvil', 'anvil')),
  chipped_anvil: () => solid(tbs('anvil:top:chipped', 'anvil', 'anvil')),
  damaged_anvil: () => solid(tbs('anvil:top:damaged', 'anvil', 'anvil')),
  bell: () => p => {
    const body = [[5, 6, 5, 11, 13, 11], [4, 4, 4, 12, 6, 12], [7, 13, 7, 9, 16, 9]]
    if (p.attachment === 'floor') {
      const stand = [[0, 13, 7, 16, 15, 9], [0, 0, 6, 2, 13, 10], [14, 0, 6, 16, 13, 10]]
      return boxed('bell', [...body, ...(p.facing === 'east' || p.facing === 'west' ? swapXZ(stand) : stand)])
    }
    return boxed('bell', body)
  },
  beacon: () => solid('beacon', O, { emissive: true }),
  conduit: () => solid('conduit', O, { emissive: true }),
  end_rod: () => solid('end_rod', O, { emissive: true }),
  heavy_core: () => solid('heavy_core'),
  decorated_pot: () => solid(tbs('decorated_pot:top', 'decorated_pot:top', 'decorated_pot:side')),
  flower_pot: () => boxed(tbs('flower_pot:top', 'terracotta', 'flower_pot:side'), [[5, 0, 5, 11, 6, 11]], C),
  cake: () => p => {
    const bites = Number(p.bites ?? 0)
    return boxed(tbs('cake:top', 'cake:bottom', 'cake:side'), [[1 + 2 * bites, 0, 1, 15, 8, 15]])
  },
  candle: () => candleEntry('plain'),
  candle_cake: () => candleCake('plain'),
  shulker_box: () => solid(tbs('shulker:plain:top', 'shulker:plain:top', 'shulker:plain:side')),
  redstone_lamp: () => {
    const off = solid('redstone_lamp')
    const on = solid('redstone_lamp:lit', O, { emissive: true })
    return p => p.lit === 'true' ? on : off
  },
  redstone_ore: () => oreEntry('redstone', 'stone'),
  deepslate_redstone_ore: () => oreEntry('redstone', 'deepslate'),
  repeater: () => p => repeaterLook(p, 'repeater'),
  comparator: () => p => repeaterLook(p, 'comparator'),
  daylight_detector: () => p => solid(tbs(p.inverted === 'true' ? 'daylight_detector:top:inverted' : 'daylight_detector:top', 'daylight_detector:side', 'daylight_detector:side')),
  sculk_sensor: () => p => sculkSensor(p, ''),
  calibrated_sculk_sensor: () => p => sculkSensor(p, ':calibrated'),
  sculk_shrieker: () => solid(tbs('sculk_shrieker:top', 'sculk', 'sculk_shrieker:side'), C),
  sculk_catalyst: () => solid(tbs('sculk_catalyst:top', 'sculk', 'sculk_catalyst:side')),
  respawn_anchor: () => p => {
    const c = Number(p.charges ?? 0) > 0 ? ':on' : ''
    return solid(tbs('respawn_anchor:top' + c, 'respawn_anchor:bottom', 'respawn_anchor:side' + c), O, c ? { emissive: true } : undefined)
  },
  lodestone: () => solid(tbs('lodestone:top', 'lodestone:top', 'lodestone:side')),
  crafter: () => p => {
    const dir = (p.orientation ?? 'north_up').split('_')[0]
    return solid(faced(dir, 'crafter:front', 'crafter:side', 'crafter:top', 'crafter:bottom'))
  },
  creaking_heart: () => p => {
    const k = p.creaking_heart_state === 'awake' ? ':awake' : ''
    return solid(pillar(p.axis, 'creaking_heart:top' + k, 'creaking_heart:side' + k))
  },
  structure_block: () => p => solid(`structure_block:${p.mode ?? 'data'}`),
  jigsaw: () => p => {
    const dir = (p.orientation ?? 'north_up').split('_')[0]
    return solid(faced(dir, 'jigsaw:front', 'jigsaw:side', 'jigsaw:side', 'jigsaw:side', 'jigsaw:back'))
  },
  test_block: () => p => solid(`test_block:${p.mode ?? 'start'}`),
  test_instance_block: () => solid('test_block:instance'),
  lantern: () => lanternEntry('iron'),
  command_block: () => commandBlock(''),
  campfire: () => campfireEntry('fire'),
  soul_campfire: () => campfireEntry('soul'),
  sea_lantern: () => solid('sea_lantern', O, { emissive: true }),
  glowstone: () => solid('glowstone', O, { emissive: true }),
  shroomlight: () => solid('shroomlight', O, { emissive: true }),
  magma_block: () => solid('magma_block', O, { emissive: true }),
  crying_obsidian: () => solid('crying_obsidian', O, { emissive: true }),
  bee_nest: () => p => beeLook(p, 'bee_nest'),
  beehive: () => p => beeLook(p, 'beehive'),
  sandstone: () => solid(tbs('sandstone:top', 'sandstone:bottom', 'sandstone:side')),
  chiseled_sandstone: () => solid(tbs('sandstone:top', 'sandstone:top', 'sandstone:chiseled')),
  cut_sandstone: () => solid(tbs('sandstone:top', 'sandstone:top', 'sandstone:cut')),
  smooth_sandstone: () => solid('sandstone:top'),
  red_sandstone: () => solid(tbs('red_sandstone:top', 'red_sandstone:bottom', 'red_sandstone:side')),
  chiseled_red_sandstone: () => solid(tbs('red_sandstone:top', 'red_sandstone:top', 'red_sandstone:chiseled')),
  cut_red_sandstone: () => solid(tbs('red_sandstone:top', 'red_sandstone:top', 'red_sandstone:cut')),
  smooth_red_sandstone: () => solid('red_sandstone:top'),
  smooth_quartz: () => solid('quartz_block:bottom'),
  quartz_block: () => solid(tbs('quartz_block:top', 'quartz_block:bottom', 'quartz_block:side')),
  nether_quartz_ore: () => oreEntry('quartz', 'netherrack'),
  nether_gold_ore: () => oreEntry('gold', 'netherrack'),
  gilded_blackstone: () => oreEntry('gold', 'blackstone'),
  petrified_oak_slab: () => solid('planks:oak')
}

function mushroomTiles (p: Props, skin: string): BlockLook {
  const f = (v: string | undefined): string => v === 'false' ? 'mushroom_inside' : skin
  return solid([f(p.down), f(p.up), f(p.north), f(p.south), f(p.west), f(p.east)])
}

function caveVines (key: string): Entry {
  const a = cross(key)
  const b = cross(key + ':lit', { emissive: true })
  return p => p.berries === 'true' ? b : a
}

function furnaceEntry (n: string): Entry {
  return p => {
    const lit = p.lit === 'true'
    return solid(faced(p.facing, lit ? `${n}:front:lit` : `${n}:front`, `${n}:side`, `${n}:top`), O, lit ? { emissive: true } : undefined)
  }
}

function dispenserTiles (p: Props, n: string): BlockLook {
  if (p.facing === 'up' || p.facing === 'down') {
    const t = all('furnace:top')
    t[FACE[p.facing]] = `${n}:front:vertical`
    return solid(t)
  }
  return solid(faced(p.facing, `${n}:front`, 'furnace:side', 'furnace:top'))
}

function pistonLook (p: Props, sticky: boolean): BlockLook {
  const head = p.extended === 'true' ? 'piston:inner' : sticky ? 'piston:top:sticky' : 'piston:top'
  const back = 'piston:bottom'
  // piston:side has its wooden band along the top edge; the engine maps u = 1-x on north,
  // x on south, z on west and 1-z on east faces, and (x, z) on top/bottom faces.
  const side = 'piston:side'
  const l = side + '~1' // band on the left
  const r = side + '~3' // band on the right
  const d = side + '~4' // band at the bottom
  switch (p.facing) {
    case 'up': return solid([back, head, side, side, side, side])
    case 'down': return solid([head, back, d, d, d, d])
    case 'south': return solid([d, d, back, head, r, l])
    case 'west': return solid([l, l, r, l, head, back])
    case 'east': return solid([r, r, l, r, back, head])
    default: return solid([side, side, head, back, l, r])
  }
}

const ROT_OP: Record<string, string> = { north: '', south: '~4', west: '~1', east: '~3' }

function repeaterLook (p: Props, n: string): BlockLook {
  const on = p.powered === 'true' ? ':on' : ''
  return solid(tbs(`${n}:top${on}${ROT_OP[p.facing ?? 'north'] ?? ''}`, 'smooth_stone', 'smooth_stone_slab:side'))
}

function sculkSensor (p: Props, variant: string): BlockLook {
  const on = p.sculk_sensor_phase === 'active' ? ':on' : ''
  return solid(tbs(`sculk_sensor:top${variant}${on}`, 'sculk', 'sculk_sensor:side'), C)
}

function beeLook (p: Props, n: string): BlockLook {
  const front = Number(p.honey_level ?? 0) >= 5 ? `${n}:front:honey` : `${n}:front`
  return solid(faced(p.facing, front, `${n}:side`, `${n}:top`, `${n}:bottom`))
}

function campfireEntry (kind: string): Entry {
  const logs = [[0, 0, 0, 16, 7, 16]]
  const flames = [[7.75, 7, 1, 8.25, 16, 15], [1, 7, 7.75, 15, 16, 8.25]]
  const off = boxed(tbs('campfire:top', 'campfire:bottom', 'campfire:side'), logs, C)
  const on = boxed(tbs(`campfire:top:${kind}`, 'campfire:bottom', `campfire:side:${kind}`), [...logs, ...flames], C, { emissive: true })
  return p => p.lit === 'false' ? off : on
}

function candleEntry (dye: string): Entry {
  const k = `candle:${dye}`
  const off = solid(k)
  const on = solid(tbs('candle:lit', k, k), O, { emissive: true })
  return p => p.lit === 'true' ? on : off
}

function candleCake (dye: string): Entry {
  const t = tbs('cake:top', 'cake:bottom', `candle_cake:${dye}`)
  const off = boxed(t, [[1, 0, 1, 15, 8, 15], [7, 8, 7, 9, 14, 9]])
  const on = boxed(t, [[1, 0, 1, 15, 8, 15], [7, 8, 7, 9, 14, 9]], O, { emissive: true })
  return p => p.lit === 'true' ? on : off
}

function oreEntry (mineral: string, host: string): Entry {
  return solid(`ore:${mineral}:${host}`)
}

// ---------------------------------------------------------------------------
// suffix rules (first match wins; more specific suffixes first)
// ---------------------------------------------------------------------------
type Rule = [suffix: string, fn: (stem: string, name: string) => Entry | null]

const SUFFIX: Rule[] = [
  ['_wall_hanging_sign', s => signEntry(s, 'wallhang')],
  ['_hanging_sign', s => signEntry(s, 'hang')],
  ['_wall_sign', s => signEntry(s, 'wall')],
  ['_sign', s => signEntry(s, 'stand')],
  ['_stained_glass_pane', s => isDye(s) ? solid(tbs(`pane_edge:${s}`, `pane_edge:${s}`, `sglass:${s}`), T) : null],
  ['_stained_glass', s => isDye(s) ? solid(`sglass:${s}`, T) : null],
  ['_glazed_terracotta', s => isDye(s) ? solid(`glazed:${s}`) : null],
  ['_terracotta', s => isDye(s) ? solid(`terracotta:${s}`) : null],
  ['_concrete_powder', s => isDye(s) ? solid(`powder:${s}`) : null],
  ['_concrete', s => isDye(s) ? solid(`concrete:${s}`) : null],
  ['_wool', s => isDye(s) ? solid(`wool:${s}`) : null],
  ['_carpet', s => isDye(s) ? solid(`wool:${s}`) : null],
  ['_bed', s => {
    if (!isDye(s)) return null
    const side = `bed:${s}:side`
    const head = solid(tbs(`bed:${s}:head`, 'planks:oak', side))
    const foot = solid(tbs(`bed:${s}:foot`, 'planks:oak', side))
    return p => p.part === 'head' ? head : foot
  }],
  ['_wall_banner', s => bannerEntry(s, true)],
  ['_banner', s => bannerEntry(s, false)],
  ['_candle_cake', s => isDye(s) ? candleCake(s) : null],
  ['_candle', s => isDye(s) ? candleEntry(s) : null],
  ['_shulker_box', s => isDye(s) ? solid(tbs(`shulker:${s}:top`, `shulker:${s}:top`, `shulker:${s}:side`)) : null],
  ['_planks', s => isWood(s) ? solid(`planks:${s}`) : null],
  ['_log', s => s.startsWith('stripped_') ? woodLook(true, s.slice(9), 'log') : woodLook(false, s, 'log')],
  ['_wood', s => s.startsWith('stripped_') ? woodLook(true, s.slice(9), 'wood') : woodLook(false, s, 'wood')],
  ['_stem', s => s.startsWith('stripped_') ? woodLook(true, s.slice(9), 'log') : woodLook(false, s, 'log')],
  ['_hyphae', s => s.startsWith('stripped_') ? woodLook(true, s.slice(9), 'hyphae') : woodLook(false, s, 'hyphae')],
  ['_leaves', s => hasTile(`leaves:${s}`) ? solid(`leaves:${s}`, C) : null],
  ['_sapling', s => isWood(s) ? cross(`sapling:${s}`) : null],
  ['_fence_gate', s => {
    const t = derived(s)
    return t && (p => boxed(t, gateBoxes(p)))
  }],
  ['_fence', s => {
    const t = derived(s)
    return t && (p => boxed(t, fenceBoxes(p)))
  }],
  ['_trapdoor', s => (isWood(s) || s === 'iron') ? solid(`trapdoor:${s}`, C) : null],
  ['_door', s => (isWood(s) || s === 'iron') ? (p => solid(`door:${s}:${p.half === 'upper' ? 'top' : 'bottom'}`, C)) : null],
  ['_pressure_plate', s => {
    const t = derived(s)
    return t && (p => boxed(t, [[1, 0, 1, 15, p.powered === 'true' || Number(p.power ?? 0) > 0 ? 0.5 : 1, 15]]))
  }],
  ['_button', s => {
    const t = derived(s)
    return t && (p => boxed(t, buttonBoxes(p)))
  }],
  ['_stairs', s => { const t = derived(s); return t && solid(t) }],
  ['_slab', s => { const t = derived(s); return t && solid(t) }],
  ['_wall', s => {
    const t = derived(s)
    return t && (p => boxed(t, wallBoxes(p)))
  }],
  ['_ore', s => {
    if (s.startsWith('deepslate_')) return oreEntry(s.slice(10), 'deepslate')
    if (s.startsWith('nether_')) return oreEntry(s.slice(7), 'netherrack')
    return oreEntry(s, 'stone')
  }],
  ['_coral_block', s => coral(s, k => solid(`coral_block:${k}`))],
  ['_coral_wall_fan', s => coral(s, k => p => boxed(`coral_fan:${k}`, rot([[0, 6, 6, 16, 7, 16]], p.facing), C))],
  ['_coral_fan', s => coral(s, k => boxed(`coral_fan:${k}`, [[0, 1, 0, 16, 2, 16]], C))],
  ['_coral', s => coral(s, k => cross(`coral:${k}`))],
  ['_wall_torch', s => {
    if (s === 'redstone') return p => torchLook('redstone', p.facing ?? 'north', p.lit !== 'false')
    return (s === 'soul' || s === 'copper') ? (p => torchLook(s, p.facing ?? 'north', true)) : null
  }],
  ['_torch', s => {
    if (s === 'redstone') return p => torchLook('redstone', undefined, p.lit !== 'false')
    return (s === 'soul' || s === 'copper') ? torchLook(s, undefined, true) : null
  }],
  ['_wall_head', s => headEntry(s, true)],
  ['_wall_skull', s => headEntry(s, true)],
  ['_head', s => headEntry(s, false)],
  ['_skull', s => headEntry(s, false)],
  ['_shelf', s => isWood(s) ? (p => solid(faced(p.facing, `shelf:${s}`, `slog:${s}`, `slog:${s}`))) : null],
  ['_lantern', s => (s === 'soul') ? lanternEntry('soul') : null],
  ['_froglight', s => p => solid(pillar(p.axis, `froglight:${s}:top`, `froglight:${s}`), O, { emissive: true })],
  ['_command_block', s => commandBlock(s)],
  ['_nylium', s => (s === 'crimson' || s === 'warped') ? solid(tbs(`nylium:${s}`, 'netherrack', `nylium:${s}:side`)) : null],
  ['_wart_block', s => solid(`wart_block:${s === 'nether' ? 'crimson' : s}`)],
  ['_amethyst_bud', s => {
    const size = s === 'small' ? 0 : s === 'medium' ? 1 : 2
    return p => cross(`p:amethyst:${size}${p.facing === 'down' ? '~4' : ''}`)
  }]
]

function coral (stem: string, make: (k: string) => Entry): Entry | null {
  const dead = stem.startsWith('dead_')
  const type = dead ? stem.slice(5) : stem
  if (!CORALS.includes(type)) return null
  return make(dead ? `${type}:dead` : type)
}

function commandBlock (kind: string): Entry {
  const k = kind === '' ? 'impulse' : kind
  return p => solid(faced(p.facing, `command_block:${k}:front`, `command_block:${k}:side`, `command_block:${k}:side`, `command_block:${k}:side`, `command_block:${k}:back`))
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------
function pottedEntry (plant: string): Entry {
  const alias: Record<string, string> = { azalea_bush: 'azalea', flowering_azalea_bush: 'flowering_azalea' }
  const inner = entryFor(alias[plant] ?? plant)
  const l = typeof inner === 'function' ? inner({}, false) : inner
  const key = l.kind === 'none' ? 'p:fern' : l.tiles[2]
  return boxed(
    tbs('flower_pot:top', 'terracotta', `potted:${key}`),
    [[5, 0, 5, 11, 6, 11], [7.75, 6, 2, 8.25, 16, 14], [2, 6, 7.75, 14, 16, 8.25]], C)
}

/** Generic cube assembled from whatever tiles textures.ts registers under the block's own name. */
function generic (name: string): Entry | null {
  const side = hasTile(name + ':side') ? name + ':side' : hasTile(name) ? name : null
  if (side === null) return null
  const top = hasTile(name + ':top') ? name + ':top' : side
  const bottom = hasTile(name + ':bottom') ? name + ':bottom' : top
  const front = hasTile(name + ':front') ? name + ':front' : null
  if (top === side && bottom === side && front === null) return solid(side)
  if (front !== null) return p => solid(faced(p.facing, front, side, top, bottom))
  const upright = solid([bottom, top, side, side, side, side])
  return p => (p.axis === 'x' || p.axis === 'z') ? solid(pillar(p.axis, top, side)) : upright
}

function fallback (name: string): Entry {
  const key = `fallback:${name}`
  const cubeLook = solid(key)
  const plantLook = mk('cross', O, key)
  return (_p, hasCollision) => hasCollision ? cubeLook : plantLook
}

function resolve (name: string): Entry {
  if (NONE.has(name)) return NONE_LOOK
  if (name.startsWith('waxed_')) return entryFor(name.slice(6))
  if (name.startsWith('infested_')) return entryFor(name.slice(9))
  const special = SPECIAL[name]
  if (special !== undefined) return special()
  if (CROSS_PLANTS.has(name)) return cross(`p:${name}`)
  if (DOUBLE_PLANTS.has(name)) return doublePlant(name)
  if (name.startsWith('potted_')) return pottedEntry(name.slice(7))
  const cu = copperRule(name)
  if (cu !== null) return cu
  const g = generic(name)
  if (g !== null) return g
  for (const [suffix, fn] of SUFFIX) {
    if (name.endsWith(suffix)) {
      const r = fn(name.slice(0, name.length - suffix.length), name)
      if (r) return r
    }
  }
  return fallback(name)
}

const ENTRIES = new Map<string, Entry>()

function entryFor (name: string): Entry {
  let e = ENTRIES.get(name)
  if (e === undefined) {
    e = resolve(name)
    ENTRIES.set(name, e)
  }
  return e
}

const NO_COLLISION = new WeakMap<BlockLook, BlockLook>()

/**
 * Appearance for one block state. `props` maps state property names to string
 * values; `hasCollision` tells whether the state has a collision shape (used as
 * geometry for kind 'auto' looks that carry no boxes of their own).
 */
export function lookFor (name: string, props: Record<string, string>, hasCollision: boolean): BlockLook {
  const e = entryFor(name)
  const l = typeof e === 'function' ? e(props, hasCollision) : e
  if (!hasCollision && l.kind === 'auto' && l.boxes === undefined) {
    // No geometry source: fall back to something that can still be drawn.
    let alt = NO_COLLISION.get(l)
    if (alt === undefined) {
      alt = { ...l, kind: l.layer === C ? 'cross' : 'cube' }
      NO_COLLISION.set(l, alt)
    }
    return alt
  }
  return l
}

/** True when lookFor() has no dedicated art for this block and uses the hashed fallback tile. */
export function isFallbackLook (look: BlockLook): boolean {
  return look.tiles[2].startsWith('fallback:')
}

const ALWAYS_WET = new Set(['water', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'])

/** True for states that contain water (water itself, waterlogged=true, always-submerged plants). */
export function containsWater (name: string, props: Record<string, string>): boolean {
  return props.waterlogged === 'true' || ALWAYS_WET.has(name)
}

// ---------------------------------------------------------------------------
// entity colours
// ---------------------------------------------------------------------------
const ENTITY: Record<string, [string, string]> = {
  player: ['#3a8fb0', '#c99873'],
  zombie: ['#4f8a4a', '#3a5fa0'],
  zombie_villager: ['#55864a', '#6b4a34'],
  husk: ['#b09a6a', '#6f5f40'],
  drowned: ['#4f9a94', '#2f5a6a'],
  skeleton: ['#c8c8c0', '#8a8a84'],
  stray: ['#a8b8bc', '#5f7a86'],
  bogged: ['#8a9a6a', '#5a6a3a'],
  parched: ['#c9b78a', '#8a7448'],
  wither_skeleton: ['#2c2c30', '#4a4a50'],
  creeper: ['#58b048', '#2f6a2a'],
  spider: ['#3a302c', '#b02a2a'],
  cave_spider: ['#1f4a52', '#b02a2a'],
  enderman: ['#17131c', '#c45ae0'],
  endermite: ['#3a2a4a', '#8a5ab0'],
  silverfish: ['#8a9096', '#5a6066'],
  slime: ['#78c860', '#4f9a40'],
  magma_cube: ['#3a1410', '#f0902a'],
  witch: ['#4a3a5a', '#5a9a4a'],
  blaze: ['#f0b030', '#c8641a'],
  ghast: ['#eeeeee', '#b0b0b0'],
  happy_ghast: ['#f4f4f4', '#7ab0d8'],
  phantom: ['#4a5a9a', '#7af08a'],
  guardian: ['#5a9a8a', '#e07a3a'],
  elder_guardian: ['#b8b8a0', '#7a7a9a'],
  shulker: ['#9a6a9a', '#e8e0a0'],
  vex: ['#8aa0b8', '#d8e4ee'],
  evoker: ['#3a3a40', '#c8a030'],
  vindicator: ['#4a4a50', '#8a6a4a'],
  pillager: ['#5a3a34', '#8a8a84'],
  illusioner: ['#2f4a8a', '#c8a030'],
  ravager: ['#5a5a58', '#3a3a38'],
  hoglin: ['#c8785a', '#8a4a34'],
  zoglin: ['#d89a8a', '#6a8a4a'],
  piglin: ['#e0a078', '#6a4a2a'],
  piglin_brute: ['#e0a078', '#2a2a30'],
  zombified_piglin: ['#d88a8a', '#5a8a4a'],
  strider: ['#a83a3a', '#5a2a2a'],
  warden: ['#0f3a44', '#2ad0c8'],
  breeze: ['#8aa0d8', '#d0d8f0'],
  creaking: ['#6a6660', '#f08a2a'],
  wither: ['#1c1c20', '#4a4a50'],
  ender_dragon: ['#18141c', '#c45ae0'],
  giant: ['#4f8a4a', '#3a5fa0'],
  // passive
  cow: ['#4a3628', '#e8e4dc'],
  mooshroom: ['#a8262a', '#e8e4dc'],
  pig: ['#eaa0a0', '#c87a7a'],
  sheep: ['#e8e4dc', '#c8a890'],
  chicken: ['#f0f0f0', '#e0a020'],
  horse: ['#8a5a34', '#3a2a1c'],
  donkey: ['#7a6a5a', '#4a3e34'],
  mule: ['#5a3a28', '#2f2018'],
  skeleton_horse: ['#c8c8c0', '#8a8a84'],
  zombie_horse: ['#4f8a4a', '#2f5a2a'],
  llama: ['#d8c8a0', '#8a6a4a'],
  trader_llama: ['#d8c8a0', '#3a5fa0'],
  camel: ['#d8a860', '#a87838'],
  camel_husk: ['#b09a6a', '#6f5f40'],
  wolf: ['#d8d4d0', '#a83a3a'],
  cat: ['#e0a040', '#f0f0e8'],
  ocelot: ['#e8b848', '#6a4a20'],
  fox: ['#e07a28', '#f0f0e8'],
  rabbit: ['#a8805a', '#e8d8c0'],
  panda: ['#f0f0f0', '#1c1c20'],
  polar_bear: ['#f0f0f0', '#c8d0d8'],
  goat: ['#e8e4dc', '#a89a88'],
  armadillo: ['#a8605a', '#6a3a34'],
  sniffer: ['#a83a3a', '#4a8a4a'],
  frog: ['#d8884a', '#e8d8a0'],
  tadpole: ['#5a4a3a', '#3a2a20'],
  axolotl: ['#f0a0c8', '#c8508a'],
  turtle: ['#4a9a4a', '#c8c060'],
  dolphin: ['#8aa8c8', '#e0e8f0'],
  squid: ['#2a4a6a', '#1c3048'],
  glow_squid: ['#1a8a8a', '#7af0d8'],
  cod: ['#c8a880', '#8a6a4a'],
  salmon: ['#c84a3a', '#5a7a5a'],
  tropical_fish: ['#f08a2a', '#f0f0f0'],
  pufferfish: ['#e8c838', '#3a8ac8'],
  nautilus: ['#d8a070', '#f0e8d8'],
  zombie_nautilus: ['#5a9a6a', '#d8d8b0'],
  bat: ['#4a3a2c', '#2f241c'],
  bee: ['#f0c030', '#2a2420'],
  parrot: ['#e03030', '#3060d8'],
  allay: ['#5ac8f0', '#d0f0ff'],
  villager: ['#8a5a3a', '#c99873'],
  wandering_trader: ['#3a5fa0', '#c99873'],
  iron_golem: ['#d8d0c8', '#6a9a4a'],
  snow_golem: ['#f4f8f8', '#e07a18'],
  copper_golem: ['#d87a4a', '#5ab09a'],
  mannequin: ['#3a8fb0', '#c99873'],
  // objects
  item: ['#d8d8d8', '#909090'],
  experience_orb: ['#a8f030', '#e8ff80'],
  arrow: ['#8a6a3a', '#d8d8d8'],
  spectral_arrow: ['#f0d040', '#fff0a0'],
  trident: ['#4aa89a', '#2f6a64'],
  snowball: ['#f4f8f8', '#c8d8e0'],
  egg: ['#e8dcc0', '#c8b890'],
  ender_pearl: ['#1a6a5a', '#3ac8a8'],
  eye_of_ender: ['#4aa85a', '#1a3a2a'],
  experience_bottle: ['#d8e060', '#a8f030'],
  splash_potion: ['#c84ac8', '#e8e8f0'],
  lingering_potion: ['#8a4ac8', '#e8e8f0'],
  fireball: ['#f08a2a', '#f0d040'],
  small_fireball: ['#f08a2a', '#f0d040'],
  dragon_fireball: ['#c45ae0', '#f0c0ff'],
  wither_skull: ['#1c1c20', '#4a4a50'],
  shulker_bullet: ['#e8e0a0', '#9a6a9a'],
  llama_spit: ['#e8f0f0', '#c0d0d0'],
  wind_charge: ['#c0d0f0', '#8aa0d8'],
  breeze_wind_charge: ['#c0d0f0', '#8aa0d8'],
  firework_rocket: ['#d83a3a', '#f0f0f0'],
  fishing_bobber: ['#d83a3a', '#f0f0f0'],
  tnt: ['#c8382c', '#f0f0f0'],
  falling_block: ['#8a8a8a', '#6a6a6a'],
  minecart: ['#8a8e94', '#5a5e64'],
  chest_minecart: ['#8a8e94', '#a8782c'],
  furnace_minecart: ['#8a8e94', '#4a4a4a'],
  tnt_minecart: ['#8a8e94', '#c8382c'],
  hopper_minecart: ['#8a8e94', '#3a3a40'],
  spawner_minecart: ['#8a8e94', '#2a3a4a'],
  command_block_minecart: ['#8a8e94', '#c8845a'],
  armor_stand: ['#b8935a', '#8a8a8a'],
  item_frame: ['#8a5a34', '#b8935a'],
  glow_item_frame: ['#8a5a34', '#e8f0a0'],
  painting: ['#8a5a34', '#d8c8a0'],
  leash_knot: ['#b08a5a', '#8a6a3a'],
  end_crystal: ['#e060c8', '#f0e0ff'],
  evoker_fangs: ['#c8c0a8', '#8a8470'],
  lightning_bolt: ['#f0f4ff', '#a8c0ff'],
  area_effect_cloud: ['#c0c0d0', '#9090a8'],
  ominous_item_spawner: ['#3a6a8a', '#7ac8e0']
}

const BOAT_WOOD: Record<string, string> = {
  oak: '#b48f55', spruce: '#7a5a34', birch: '#d6c68a', jungle: '#b07e58', acacia: '#b8612f', cherry: '#e6b7b0',
  dark_oak: '#4d3218', pale_oak: '#e8dcd6', mangrove: '#7a3a34', bamboo: '#cdb450'
}

const ENTITY_CACHE = new Map<string, { body: string, accent: string }>()

function hsl (h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Body / accent colours for simple entity models, by entity registry name. */
export function entityColors (name: string): { body: string, accent: string } {
  let c = ENTITY_CACHE.get(name)
  if (c !== undefined) return c
  const known = ENTITY[name]
  if (known !== undefined) {
    c = { body: known[0], accent: known[1] }
  } else {
    const boat = /^(.*?)_(chest_)?(boat|raft)$/.exec(name)
    if (boat !== null && BOAT_WOOD[boat[1]] !== undefined) {
      c = { body: BOAT_WOOD[boat[1]], accent: boat[2] ? '#a8782c' : '#6a4a2a' }
    } else {
      const h = hashName(name)
      const hue = h % 360
      c = { body: hsl(hue, 0.32, 0.5), accent: hsl((hue + 40) % 360, 0.38, 0.32) }
    }
  }
  ENTITY_CACHE.set(name, c)
  return c
}
