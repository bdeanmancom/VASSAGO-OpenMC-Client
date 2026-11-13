/**
 * Procedural 32×32 item icons.
 *
 * Block items are drawn as a small isometric model built from the block's own
 * tiles (or as the flat sprite for plants / decals); everything else is an
 * original 16×16 pixel sprite, tinted per material and scaled 2×.
 * No external art is used.
 */
import type { BlockLook } from './looks'
import { DYE, DYE_NAMES, WOOD, WOOD_NAMES, hashStr, hexRgb, mix, paintTile, ramp, tone, type RGB, type Ramp } from './textures'

export interface IconEnv {
  /** Look of the block with this name in its default state, or null when the item is not a block. */
  blockLook: (name: string) => BlockLook | null
}

const ICON = 32
const SP = 16

// ---------------------------------------------------------------------------
// tile cache
// ---------------------------------------------------------------------------
const TILE_CACHE = new Map<string, Uint8ClampedArray>()
function tile (key: string): Uint8ClampedArray {
  let t = TILE_CACHE.get(key)
  if (t === undefined) {
    t = new Uint8ClampedArray(SP * SP * 4)
    paintTile(key, t)
    if (TILE_CACHE.size > 4096) TILE_CACHE.clear()
    TILE_CACHE.set(key, t)
  }
  return t
}

// ---------------------------------------------------------------------------
// isometric box renderer
// ---------------------------------------------------------------------------
// Camera sits above the north-east corner: the icon shows the top, the east
// face (left) and the north face (right). UVs follow the engine's convention.
const FACE_SHADE = [0.5, 1, 0.64, 0.52, 0.52, 0.82]
const RX = -0.70711; const RZ = -0.70711
const UX = -0.35355; const UY = 0.86603; const UZ = 0.35355
const DX = -0.61237; const DY = -0.5; const DZ = 0.61237

interface Hit { t: number, face: number, front: boolean }

/**
 * Render axis-aligned boxes (block space 0..1) textured with six face tiles
 * into a `size`×`size` RGBA buffer using an isometric projection.
 */
export function renderBoxes (boxes: number[][], tiles: string[], size: number, out: Uint8ClampedArray, solidHoles = false): void {
  const tex = tiles.map(tile)
  const scale = size / 1.64
  const hits: Hit[] = []
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sx = (px + 0.5 - size / 2) / scale
      const sy = (size / 2 - (py + 0.5)) / scale
      const ox = 0.5 + RX * sx + UX * sy - DX * 4
      const oy = 0.5 + UY * sy - DY * 4
      const oz = 0.5 + RZ * sx + UZ * sy - DZ * 4
      hits.length = 0
      for (const b of boxes) {
        // slab test; the ray direction has no zero components
        const tx1 = (b[3] - ox) / DX; const tx2 = (b[0] - ox) / DX // enter through +x, leave through -x
        const ty1 = (b[4] - oy) / DY; const ty2 = (b[1] - oy) / DY // enter through +y, leave through -y
        const tz1 = (b[2] - oz) / DZ; const tz2 = (b[5] - oz) / DZ // enter through -z, leave through +z
        let tIn = tx1; let fIn = 5
        if (ty1 > tIn) { tIn = ty1; fIn = 1 }
        if (tz1 > tIn) { tIn = tz1; fIn = 2 }
        let tOut = tx2; let fOut = 4
        if (ty2 < tOut) { tOut = ty2; fOut = 0 }
        if (tz2 < tOut) { tOut = tz2; fOut = 3 }
        if (tIn > tOut) continue
        hits.push({ t: tIn, face: fIn, front: true }, { t: tOut, face: fOut, front: false })
      }
      if (hits.length === 0) continue
      hits.sort((a, b) => a.t - b.t)
      let r = 0; let g = 0; let bl = 0; let acc = 0
      for (const h of hits) {
        const x = ox + DX * h.t; const y = oy + DY * h.t; const z = oz + DZ * h.t
        let u: number; let v: number
        switch (h.face) {
          case 0: case 1: u = x; v = z; break
          case 2: u = 1 - x; v = 1 - y; break
          case 3: u = x; v = 1 - y; break
          case 4: u = z; v = 1 - y; break
          default: u = 1 - z; v = 1 - y
        }
        const tu = Math.min(15, Math.max(0, Math.floor(u * 16)))
        const tv = Math.min(15, Math.max(0, Math.floor(v * 16)))
        const t = tex[h.face]
        const i = ((tv << 4) | tu) << 2
        let a = t[i + 3] / 255
        let shade = FACE_SHADE[h.face] * (h.front ? 1 : 0.72)
        let cr = t[i]; let cg = t[i + 1]; let cb = t[i + 2]
        if (a === 0) {
          if (!solidHoles || !h.front) continue
          // leaves: gaps read as deep shade instead of holes in the icon
          a = 1; shade *= 0.42
          const j = (((tv + 1) & 15) << 4 | ((tu + 1) & 15)) << 2
          cr = t[j] || 40; cg = t[j + 1] || 60; cb = t[j + 2] || 40
        }
        const w = (1 - acc) * a
        r += cr * shade * w; g += cg * shade * w; bl += cb * shade * w
        acc += w
        if (acc > 0.985) break
      }
      if (acc <= 0.02) continue
      const o = (py * size + px) * 4
      out[o] = r / acc; out[o + 1] = g / acc; out[o + 2] = bl / acc; out[o + 3] = Math.min(255, acc * 255 + 0.5)
    }
  }
}

// ---------------------------------------------------------------------------
// 16×16 sprite canvas
// ---------------------------------------------------------------------------
let I: Uint8ClampedArray = new Uint8ClampedArray(SP * SP * 4)

function ip (x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || x > 15 || y < 0 || y > 15) return
  const i = ((y << 4) | x) << 2
  I[i] = c[0]; I[i + 1] = c[1]; I[i + 2] = c[2]; I[i + 3] = a
}
const ia = (x: number, y: number): number => (x < 0 || x > 15 || y < 0 || y > 15) ? 0 : I[(((y << 4) | x) << 2) + 3]
function iart (rows: string[], pal: Record<string, RGB>, ox = 0, oy = 0): void {
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    for (let x = 0; x < r.length; x++) {
      const c = pal[r.charAt(x)]
      if (c !== undefined) ip(ox + x, oy + y, c)
    }
  }
}
function iline (x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= n; i++) { const t = n === 0 ? 0 : i / n; ip(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c) }
}
function irect (x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) ip(i, j, c)
}
/** Shaded ellipse lit from the top-left. */
function blob (cx: number, cy: number, rx: number, ry: number, R: Ramp, seed = 0, noise = 0): void {
  for (let y = 0; y < SP; y++) {
    for (let x = 0; x < SP; x++) {
      const dx = (x - cx) / rx; const dy = (y - cy) / ry
      const d = dx * dx + dy * dy
      if (d > 1) continue
      let i = 2.2 - (dx + dy) * 1.5 - d * 0.6
      if (noise > 0) i += ((hashStr(`${x},${y},${seed}`) % 100) / 100 - 0.5) * noise
      ip(x, y, R[Math.max(0, Math.min(4, Math.round(i)))])
    }
  }
}
/** Palette: '1'..'5' from the first ramp, 'a'..'e' from the second. */
function pal (A: Ramp, B?: Ramp, extra?: Record<string, string>): Record<string, RGB> {
  const p: Record<string, RGB> = {}
  for (let i = 0; i < 5; i++) { p[String(i + 1)] = A[i]; if (B !== undefined) p['abcde'.charAt(i)] = B[i] }
  if (extra !== undefined) for (const k of Object.keys(extra)) p[k] = hexRgb(extra[k])
  return p
}
/** One-pixel dark outline around the sprite (keeps icons readable on any slot colour). */
function outline (): void {
  const src = I.slice()
  const al = (x: number, y: number): number => (x < 0 || x > 15 || y < 0 || y > 15) ? 0 : src[(((y << 4) | x) << 2) + 3]
  for (let y = 0; y < SP; y++) {
    for (let x = 0; x < SP; x++) {
      if (al(x, y) !== 0) continue
      let n = -1
      if (al(x + 1, y) > 0) n = ((y << 4) | (x + 1)) << 2
      else if (al(x - 1, y) > 0) n = ((y << 4) | (x - 1)) << 2
      else if (al(x, y + 1) > 0) n = (((y + 1) << 4) | x) << 2
      else if (al(x, y - 1) > 0) n = (((y - 1) << 4) | x) << 2
      if (n < 0) continue
      const c = mix(tone([src[n], src[n + 1], src[n + 2]], -2.2), [20, 18, 26], 0.45)
      ip(x, y, c, 235)
    }
  }
}
function upscale (out: Uint8ClampedArray): void {
  for (let y = 0; y < ICON; y++) {
    for (let x = 0; x < ICON; x++) {
      const s = (((y >> 1) << 4) | (x >> 1)) << 2; const d = (y * ICON + x) * 4
      out[d] = I[s]; out[d + 1] = I[s + 1]; out[d + 2] = I[s + 2]; out[d + 3] = I[s + 3]
    }
  }
}
function fromTile (key: string): void { I.set(tile(key)) }

// ---------------------------------------------------------------------------
// materials & colours
// ---------------------------------------------------------------------------
const MATERIAL: Record<string, string> = {
  wooden: '#a8823f', stone: '#8a8d91', iron: '#d8d8d4', golden: '#f2c53a', gold: '#f2c53a', diamond: '#5fe3d8',
  netherite: '#4a4347', copper: '#d87a50', leather: '#8a5a34', chainmail: '#9a9da3', turtle: '#4a9a4a'
}
const R_WOOD = (): Ramp => ramp('#8a6a3a', 0.9)
const matRamp = (m: string): Ramp => ramp(MATERIAL[m] ?? '#b0b0b0', m === 'netherite' ? 1.1 : 0.9)

const TOOLS: Record<string, string[]> = {
  sword: ['', '............45', '...........454', '..........453', '.........453', '........453', '.......453', '..2...453', '..32.453', '...3253', '....32', '...b332', '..bc..2', '.bc', '.2'],
  pickaxe: ['', '.....44444', '....4555443', '...43...b443', '...3...bc.43', '......bc..43', '.....bc...43', '....bc.....3', '...bc', '..bc', '.bc', '.c'],
  axe: ['', '.........33', '........3443', '.......345543', '......34554bc', '......3454bc', '.......33bc', '........bc', '.......bc', '......bc', '.....bc', '....bc', '...bc', '..bc', '..c'],
  shovel: ['', '...........333', '..........34543', '.........345543', '.........34543', '.........3bc3', '........bc', '.......bc', '......bc', '.....bc', '....bc', '...bc', '..bc', '..c'],
  hoe: ['', '.......33333', '......3445543', '......33..bc3', '.........bc', '........bc', '.......bc', '......bc', '.....bc', '....bc', '...bc', '..bc', '..c'],
  spear: ['', '............45', '...........454', '...........43', '..........bc', '.........bc', '........bc', '.......bc', '......bc', '.....bc', '....bc', '...bc', '..bc', '.bc', '.c']
}
const ARMOR: Record<string, string[]> = {
  helmet: ['', '', '', '...4444444', '..455555443', '.45554444332', '.45443333322', '.4543....322', '.443......32', '.433......22', '.332......22'],
  chestplate: ['', '', '..444...444', '.45544.44543', '.45555455443', '.44555554433', '..345555432', '...4555443', '...4554443', '...4544433', '...4444332', '...3333322'],
  leggings: ['', '', '...44444444', '...45555543', '...45444443', '...454..343', '...454..343', '...443..332', '...443..332', '...433..322', '...433..322', '...332..222'],
  boots: ['', '', '', '', '', '..444...444', '..454...453', '..454...453', '..443...443', '.4443..4443', '.4533..4532', '.3332..3322']
}
const SHAPES: Record<string, string[]> = {
  ingot: ['', '', '', '', '......4444444', '.....45555543', '....455555432', '...4444444322', '...333333322', '...33333332'],
  nugget: ['', '', '', '', '', '......44', '.....4554', '....45543', '....44432', '.....332'],
  gem: ['', '', '.....4444', '....455554', '...45555443', '...4554443', '...3444433', '....34433', '.....343', '......3'],
  emerald: ['', '', '.....444', '....45554', '...4555443', '...4554443', '...4544433', '...4444333', '....44333', '.....333'],
  shard: ['', '', '.......4', '......45', '.....454', '.....4543', '....45443', '....4443', '...44433', '...3333'],
  bottle: ['', '.....ccc', '.....gGg', '.....gGg', '....gGGGg', '...g44444g', '...g45444g', '...g44444g', '...g34443g', '....g333g', '.....ggg'],
  bucket: ['', '', '....33333', '...3.....3', '..455555543', '..4aaaaaaa3', '..45555543', '...4555443', '...4554433', '....44433', '....33333'],
  boat: ['', '', '', '', '', '.4.........4', '.44.......43', '.3444444443', '..34444443', '...3333333'],
  minecart: ['', '', '', '', '..44444444444', '..4kkkkkkkkk3', '..45555555543', '..44444444433', '...3333333332', '...kk.....kk'],
  book: ['', '', '....2222222', '...2444444 2', '...24444442w', '...24454442w', '...24454442w', '...24444442w', '...24444442w', '...22222222w', '....wwwwwww'],
  paper: ['', '', '....wwwwwww', '....wxxxxxw', '....wwwwwww', '....wxxxxww', '....wwwwwww', '....wxxxxxw', '....wwwwwww', '....wxxxwww', '....wwwwwww'],
  stick: ['', '', '...........b', '..........bc', '.........bc', '........bc', '.......bc', '......bc', '.....bc', '....bc', '...bc', '..bc', '..c'],
  disc: ['', '', '.....kkkkk', '...kkKKKKkk', '..kKKkkkkKKk', '..kKkk44kkKk', '..kKk4554kKk', '..kKk4554kKk', '..kKkk44kkKk', '..kKKkkkkKKk', '...kkKKKKkk', '.....kkkkk'],
  bow: ['', '.......bbbb', '.....bbc..w', '....bc...w', '...bc...w', '...b...w', '..bc..w', '..b..w', '..b.w', '..bw', '..w'],
  arrow: ['', '...........444', '............34', '...........b.4', '..........b', '.........b', '........b', '.......b', '......b', '.....b', '..w.b', '..wwb', '...ww'],
  shears: ['', '', '....4.....4', '....45...45', '.....45.45', '......454', '.......4', '......b.b', '.....b...b', '....bb...bb', '....b.....b'],
  bowl: ['', '', '', '', '', '', '..b.......b', '..baaaaaaab', '..bbaaaaabb', '...bbbbbbb', '....ccccc'],
  apple: ['', '', '.......b', '......bl', '....44.b44', '...4554544', '...45544443', '...44444433', '...44444433', '....444433', '.....33.3'],
  bread: ['', '', '', '', '....4444444', '...455454543', '..4554545443', '..4444444433', '...33333333'],
  meat: ['', '', '.....4444', '...44555544', '..455544554', '..4554w45543', '..455444443w', '...4444433ww', '....33333.w'],
  drumstick: ['', '', '......4444', '.....455544', '.....4555443', '.....4554433', '......44433', '.....w.333', '....ww', '...ww', '...w.w'],
  fish: ['', '', '', '', '.4...44444', '.44.4555544', '.4445554k543', '.44.4444443', '.4...33333'],
  carrot: ['', '', '..........l.l', '...........ll', '........444l', '.......45443', '......45443', '.....45443', '....45443', '...4443', '...43', '..3'],
  cookie: ['', '', '', '.....4444', '...44554444', '..4554k54443', '..45444445k3', '..4k45444433', '..44444k4433', '...4444433', '.....3333'],
  slice: ['', '', '', '', '..l.........l', '..l444444444l', '...l4k454k4l', '....l44544l', '.....l444l', '......lll'],
  feather: ['', '', '..........444', '.........4554', '........4554', '.......4554', '......4544', '.....4544', '....444', '...b4', '..b'],
  bone: ['', '', '..........4.4', '..........454', '.........443', '........45', '.......45', '......45', '.....45', '...444', '..454', '..4.4'],
  string: ['', '', '.........44', '........4..4', '........4', '.......4', '.....44', '....4', '....4...', '.....44', '.......4', '......4'],
  seeds: ['', '', '', '', '.......4', '......45..4', '...4..3..453', '..453.....3', '...3...4', '......453', '.......3'],
  dust: ['', '', '', '', '', '........4', '.....4.454', '....45444543', '...4544454433', '..45444444433', '...333333333'],
  compass: ['', '', '.....aaaaa', '...aa44444aa', '..a444444444a', '..a4444r4444a', '..a444rr4444a', '..a4444k4444a', '..a4444k4444a', '...aa44444aa', '.....aaaaa'],
  shield: ['', '', '...bbbbbbbb', '...b444444b', '...b454444b', '...b444444b', '...b444454b', '...b444444b', '....b4444b', '.....b44b', '......bb'],
  totem: ['', '', '.....4444', '....455554', '....4k55k4', '..4445555444', '..4545555454', '..44.4554.44', '.....4554', '.....4444', '.....4..4'],
  rod: ['', '', '...........45', '..........454', '.........454', '........454', '.......454', '......454', '.....454', '....454', '...454', '...43'],
  elytra: ['', '', '....44...44', '...4554.4554', '..455544554 4', '..455543455 4', '..45543.34554', '..4543...3454', '..443.....344', '..43.......34', '..3.........3'],
  saddle: ['', '', '', '', '....444444', '...45555544', '..4554444553', '..454....453', '..44......43', '..b........b', '..4........4'],
  horse_armor: ['', '', '', '.........444', '..444444.4554', '.4555555444k4', '.455555555443', '.445555554433', '..44....44', '..43....43', '..3.....3'],
  tablet: ['', '', '....4444444', '...455555543', '...45k5k5k43', '...455555543', '...45k555k43', '...455555543', '...45k5k5k43', '...444444433', '....3333333'],
  sherd: ['', '', '....44444', '...4555554', '...45k55k43', '...455555433', '....455k443', '.....45443', '......443', '.......3'],
  trident: ['', '.........4.4.4', '.........4.4.4', '..........444', '..........45', '.........45', '........45', '.......45', '......45', '.....45', '....45', '...45', '..45', '..4'],
  rodline: ['', '..........b', '.........bcw', '........bc.w', '.......bc..w', '......bc...w', '.....bc....w', '....bc.....w', '...bc......r', '..bc', '.bc', '.c'],
  crossbow: ['', '', '....bbbbbbb', '...bc.w...cb', '..bc...w...b', '..b.....44', '..b....454', '..c...454w', '.....454..w', '....454', '...b4', '..b'],
  tag: ['', '', '', '.......w', '......w.444', '.....w.45554', '....w.455k54', '.....4555554', '....455555 4', '....44444'],
  harness: ['', '', '', '...4444444', '..455555554', '..45bbbbb54', '..45b...b54', '..45bbbbb54', '..455555554', '...4444444'],
  bundle: ['', '', '......ww', '.....w44w', '....444444', '...45555544', '..4555555443', '..4555555443', '..4455554433', '...44444433', '....333333'],
  shell: ['', '', '.....4444', '...44555544', '..455444554', '..4544k44543', '..454k4k4543', '..4544k44433', '...4444443', '....333333'],
  star: ['', '.......4', '.......4', '......454', '..444455544 44', '...4555555 54', '....455554', '....455554', '...4554554', '...44...44', '..4.......4'],
  key: ['', '', '.........444', '........4...4', '........4...4', '.........444', '........45', '.......45', '......45', '.....454', '....45.4', '....4']
}

// ---------------------------------------------------------------------------
// non-block item sprites
// ---------------------------------------------------------------------------
const FOOD_COLORS: Record<string, string> = {
  apple: '#d8342c', golden_apple: '#f2c53a', enchanted_golden_apple: '#f6d85a', bread: '#c8943a', porkchop: '#f0989a',
  cooked_porkchop: '#c8905a', beef: '#d8483a', cooked_beef: '#8a5234', mutton: '#d85a4a', cooked_mutton: '#8a5a3a',
  rabbit: '#e8a890', cooked_rabbit: '#c89058', chicken: '#f0c0a8', cooked_chicken: '#c88a48', rotten_flesh: '#a85a34',
  cod: '#c8a880', cooked_cod: '#d8c8a8', salmon: '#c84a3a', cooked_salmon: '#d8804a', tropical_fish: '#f08a2a',
  pufferfish: '#e8c838', carrot: '#f08a1c', golden_carrot: '#f2c53a', potato: '#d8b86a', baked_potato: '#d8a84a',
  poisonous_potato: '#b8c858', beetroot: '#a8242c', cookie: '#c8843a', melon_slice: '#e8483a', glistering_melon_slice: '#f2b83a',
  pumpkin_pie: '#e0923a', dried_kelp: '#3d4b33', sweet_berries: '#d8303a', glow_berries: '#f6a83a', chorus_fruit: '#9a6a9c',
  popped_chorus_fruit: '#b890c8', spider_eye: '#a82838', fermented_spider_eye: '#8a3a5a', honeycomb: '#e2951f'
}
const BALLS: Record<string, [string, string?]> = {
  ender_pearl: ['#1f8a78'], ender_eye: ['#4aa85a', '#1a3a2a'], slime_ball: ['#78c65e'], snowball: ['#f0f6f8'], clay_ball: ['#a0a7b5'],
  magma_cream: ['#e8902a', '#7a3a14'], fire_charge: ['#3a2a22', '#f08a1e'], wind_charge: ['#c8d4f0'], heart_of_the_sea: ['#3a8ad8', '#e8f4ff'],
  firework_star: ['#6a6a72'], nether_star: ['#f4f4e0'], turtle_scute: ['#4a9a4a'], scute: ['#4a9a4a'], armadillo_scute: ['#a8605a'], popped_chorus_fruit: ['#b890c8'],
  egg: ['#e8dcc0'], blue_egg: ['#a8c8d8'], brown_egg: ['#b88a60'], ghast_tear: ['#e8f0f4'], phantom_membrane: ['#c8c0a8'],
  rabbit_foot: ['#c8a878'], rabbit_hide: ['#b89068'], leather: ['#8a5a34'], ink_sac: ['#2a2a34'], glow_ink_sac: ['#2a8a8a', '#7af0d8'],
  cocoa_beans: ['#7a4a2a'], flint: ['#3a3a40'], coal: ['#26262b'], charcoal: ['#3a3028'], brick: ['#9b5a48'], nether_brick: ['#31191f'],
  resin_brick: ['#e2701f'], netherite_scrap: ['#5a4a44'], shulker_shell: ['#96689a'], nautilus_shell: ['#d8a070'], honeycomb: ['#e2951f'],
  disc_fragment_5: ['#2a3a4a'], echo_shard: ['#1a3a4a'], prismarine_crystals: ['#a8e0d0'], prismarine_shard: ['#5ea493'],
  quartz: ['#ebe6dd'], amethyst_shard: ['#9a6ad8'], lapis_lazuli: ['#2f55c8'], raw_iron: ['#d8a98a'], raw_copper: ['#e07a4a'], raw_gold: ['#f6cf3e']
}
const DUSTS: Record<string, string> = {
  redstone: '#e02a1e', glowstone_dust: '#f0c040', gunpowder: '#6a6a70', sugar: '#f0f0f4', blaze_powder: '#f0a020', bone_meal: '#e8e8e0'
}
const SPAWN: Record<string, [string, string]> = {
  chicken: ['#f0f0f0', '#e03a2a'], cow: ['#4a3628', '#a8a8a8'], pig: ['#eaa0a0', '#c86a6a'], sheep: ['#e8e4dc', '#f0b8b8'],
  zombie: ['#3a9a9a', '#5a8a4a'], skeleton: ['#c8c8c0', '#4a4a4a'], creeper: ['#58b048', '#1c1c1c'], spider: ['#3a302c', '#b02a2a'],
  enderman: ['#17131c', '#c45ae0'], blaze: ['#f0b030', '#fff0a0'], ghast: ['#f4f4f4', '#c0c0c0'], slime: ['#78c860', '#4f9a40'],
  villager: ['#6a4a3a', '#c99873'], wolf: ['#d8d4d0', '#c8a890'], cat: ['#e0a040', '#8a5a2a'], horse: ['#c0a078', '#f0e040'],
  bee: ['#f0c030', '#2a2420'], fox: ['#e07a28', '#f0f0e8'], warden: ['#0f3a44', '#2ad0c8'], axolotl: ['#f0a0c8', '#a84a8a'],
  frog: ['#d8884a', '#f0d8a0'], allay: ['#5ac8f0', '#d0f0ff'], witch: ['#3a1a2a', '#5a9a4a'], guardian: ['#5a9a8a', '#e07a3a'],
  piglin: ['#a87850', '#f0d8a0'], hoglin: ['#c8785a', '#5a3a34'], strider: ['#a83a3a', '#4a4a4a'], phantom: ['#4a5a9a', '#7af08a'],
  wither: ['#1c1c20', '#4a5a6a'], ender_dragon: ['#18141c', '#c45ae0'], iron_golem: ['#d8d0c8', '#6a9a4a'], snow_golem: ['#f4f8f8', '#e07a18']
}

function toolSprite (kind: string, material: string): void {
  iart(TOOLS[kind], pal(matRamp(material), R_WOOD()))
}

function hslRamp (name: string, s = 0.42, l = 0.5): Ramp {
  const h = hashStr(name) % 360
  const f = (n: number): number => { const k = (n + h / 30) % 12; return Math.round((l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255) }
  return ramp([f(0), f(8), f(4)], 0.9)
}

/** Draw a non-block item; returns false when nothing specific matched. */
function itemSprite (name: string): boolean {
  let m: RegExpExecArray | null
  if ((m = /^(wooden|stone|iron|golden|diamond|netherite|copper)_(sword|pickaxe|axe|shovel|hoe|spear)$/.exec(name)) !== null) { toolSprite(m[2], m[1]); return true }
  if ((m = /^(leather|copper|chainmail|iron|diamond|golden|netherite|turtle)_(helmet|chestplate|leggings|boots)$/.exec(name)) !== null) { iart(ARMOR[m[2]], pal(matRamp(m[1]))); return true }
  if ((m = /^(.+)_horse_armor$/.exec(name)) !== null) { iart(SHAPES.horse_armor, pal(matRamp(m[1]), undefined, { k: '#26262b' })); return true }
  if ((m = /^(.+)_nautilus_armor$/.exec(name)) !== null) { iart(SHAPES.shell, pal(matRamp(m[1]), undefined, { k: '#26262b' })); return true }
  if (name === 'wolf_armor') { iart(SHAPES.horse_armor, pal(ramp('#a8605a', 0.9), undefined, { k: '#26262b' })); return true }
  if ((m = /^(iron|gold|copper|netherite)_ingot$/.exec(name)) !== null) { iart(SHAPES.ingot, pal(matRamp(m[1]))); return true }
  if ((m = /^(iron|gold|copper)_nugget$/.exec(name)) !== null) { iart(SHAPES.nugget, pal(matRamp(m[1]))); return true }
  if (name === 'diamond') { iart(SHAPES.gem, pal(matRamp('diamond'))); return true }
  if (name === 'emerald') { iart(SHAPES.emerald, pal(ramp('#35cf6c', 0.95))); return true }
  if (name === 'amethyst_shard' || name === 'echo_shard' || name === 'prismarine_shard' || name === 'quartz' || name === 'flint' || name === 'disc_fragment_5') { iart(SHAPES.shard, pal(ramp(BALLS[name][0], 0.95))); return true }
  if (name === 'stick' || name === 'blaze_rod' || name === 'breeze_rod' || name === 'debug_stick') {
    if (name === 'stick' || name === 'debug_stick') iart(SHAPES.stick, pal(R_WOOD(), R_WOOD()))
    else iart(SHAPES.rod, pal(ramp(name === 'blaze_rod' ? '#f0b030' : '#a8b8e8', 0.9)))
    return true
  }
  if ((m = /^(.+)_dye$/.exec(name)) !== null && DYE[m[1]] !== undefined) { iart(SHAPES.dust, pal(ramp(DYE[m[1]], 0.9))); return true }
  if (DUSTS[name] !== undefined) { iart(SHAPES.dust, pal(ramp(DUSTS[name], 0.9))); return true }
  if (/_seeds$/.test(name) || name === 'pitcher_pod') {
    const c = ({ wheat_seeds: '#6aa83a', pumpkin_seeds: '#e8dcb0', melon_seeds: '#3a3028', beetroot_seeds: '#b89a6a', torchflower_seeds: '#3a8a6a', pitcher_pod: '#8a6a4a' } as Record<string, string>)[name] ?? '#8a9a4a'
    iart(SHAPES.seeds, pal(ramp(c, 1))); return true
  }
  if ((m = /^(.+?)_(chest_)?(boat|raft)$/.exec(name)) !== null) {
    const w = WOOD[m[1]] ?? WOOD.oak
    iart(SHAPES.boat, pal(ramp(w.planks, 0.9)))
    if (m[2] !== undefined) { irect(5, 4, 4, 3, hexRgb('#a9772e')); ip(6, 5, hexRgb('#d8d8d4')) }
    return true
  }
  if (/minecart$/.test(name)) {
    iart(SHAPES.minecart, pal(ramp('#8a8e94', 0.9), undefined, { k: '#2a2a30' }))
    const load = ({ chest_minecart: '#a9772e', furnace_minecart: '#5a5a5e', tnt_minecart: '#c7372c', hopper_minecart: '#45474d', command_block_minecart: '#c8845a' } as Record<string, string>)[name]
    if (load !== undefined) { const L = ramp(load, 0.9); irect(4, 2, 7, 3, L[2]); for (let x = 4; x < 11; x++) ip(x, 2, L[4]); ip(10, 4, L[0]) }
    return true
  }
  if (/bucket$/.test(name)) {
    const content = ({ water_bucket: '#2e62cc', lava_bucket: '#f08a1c', milk_bucket: '#f4f4f0', powder_snow_bucket: '#f4f9fb', cod_bucket: '#2e62cc', salmon_bucket: '#2e62cc', pufferfish_bucket: '#2e62cc', tropical_fish_bucket: '#2e62cc', axolotl_bucket: '#2e62cc', tadpole_bucket: '#2e62cc' } as Record<string, string>)[name] ?? '#3a3c42'
    iart(SHAPES.bucket, pal(ramp('#c9ccd0', 0.8), ramp(content, 0.8)))
    const fishy = ({ cod_bucket: '#c8a880', salmon_bucket: '#c84a3a', pufferfish_bucket: '#e8c838', tropical_fish_bucket: '#f08a2a', axolotl_bucket: '#f0a0c8', tadpole_bucket: '#5a4a3a' } as Record<string, string>)[name]
    if (fishy !== undefined) { const c = hexRgb(fishy); ip(5, 5, c); ip(6, 5, c); ip(7, 5, tone(c, 1)); ip(4, 4, c) }
    return true
  }
  if (/spawn_egg$/.test(name)) {
    const mob = name.slice(0, -10)
    const c = SPAWN[mob]
    const A = c !== undefined ? ramp(c[0], 0.9) : hslRamp(mob, 0.4, 0.5)
    const B = c !== undefined ? hexRgb(c[1]) : hslRamp(mob + '#', 0.5, 0.35)[2]
    blob(7.5, 8.2, 4.4, 5.6, A)
    for (const [x, y] of [[6, 5], [9, 7], [5, 9], [8, 11], [10, 10], [7, 8]]) if (ia(x, y) > 0) ip(x, y, B)
    return true
  }
  if (/potion$|_bottle$|^glass_bottle$|^dragon_breath$/.test(name)) {
    const liquid = ({ potion: '#3a6ae0', splash_potion: '#c84ac8', lingering_potion: '#8a4ac8', honey_bottle: '#f0a42c', experience_bottle: '#b8e040', dragon_breath: '#e87ac8', ominous_bottle: '#2a4a6a', glass_bottle: '#dceef4' } as Record<string, string>)[name] ?? '#3a6ae0'
    iart(SHAPES.bottle, pal(ramp(liquid, 0.9), undefined, { c: name === 'splash_potion' || name === 'lingering_potion' ? '#c9ccd0' : '#a8824a', g: '#b8d4e0', G: '#e4f2f8' }))
    return true
  }
  if (/book$/.test(name)) {
    const c = ({ book: '#8a4a2a', writable_book: '#8a4a2a', written_book: '#6a3a8a', enchanted_book: '#7a3ac8', knowledge_book: '#3a8a4a' } as Record<string, string>)[name] ?? '#8a4a2a'
    iart(SHAPES.book, pal(ramp(c, 0.9), undefined, { w: '#ece6d2' }))
    if (name === 'writable_book') iline(11, 2, 14, 0, hexRgb('#f0f0f0'))
    return true
  }
  if (name === 'paper' || name === 'map' || name === 'filled_map' || /banner_pattern$/.test(name)) {
    const ink = name === 'filled_map' ? '#5a8a4a' : name === 'map' ? '#d8cca8' : /banner_pattern$/.test(name) ? '#4a4a8a' : '#c8c0a8'
    iart(SHAPES.paper, { w: hexRgb(name === 'paper' ? '#f0ece0' : '#e2d8b8'), x: hexRgb(ink) })
    return true
  }
  if (/^music_disc_/.test(name)) { iart(SHAPES.disc, pal(hslRamp(name, 0.6, 0.55), undefined, { k: '#1c1c22', K: '#34343c' })); return true }
  if (/smithing_template$/.test(name)) { iart(SHAPES.tablet, pal(name.startsWith('netherite') ? ramp('#4a4347', 1) : hslRamp(name, 0.3, 0.5), undefined, { k: '#26262b' })); return true }
  if (/pottery_sherd$/.test(name)) { iart(SHAPES.sherd, pal(ramp('#9a5a3e', 0.85), undefined, { k: '#4a2a1c' })); return true }
  if (/harness$/.test(name)) { const d = name.slice(0, -8); iart(SHAPES.harness, pal(ramp(DYE[d] ?? '#8a5a34', 0.9), ramp('#8a5a34', 0.9))); return true }
  if (/bundle$/.test(name)) { const d = name === 'bundle' ? '' : name.slice(0, -7); iart(SHAPES.bundle, pal(ramp(DYE[d] ?? '#8a5a34', 0.9), undefined, { w: '#e8e2d4' })); return true }
  if (/trial_key$/.test(name)) { iart(SHAPES.key, pal(ramp(name.startsWith('ominous') ? '#3a8a9a' : '#d8843a', 0.9))); return true }
  if (FOOD_COLORS[name] !== undefined) {
    const R = ramp(FOOD_COLORS[name], 0.9)
    const leaf = { l: '#4f9a38', b: '#6a4a2a', k: '#4a2a1c', w: '#f0ece0' }
    if (/apple$/.test(name)) iart(SHAPES.apple, pal(R, undefined, leaf))
    else if (name === 'bread') iart(SHAPES.bread, pal(R))
    else if (/chicken$|rabbit$/.test(name)) iart(SHAPES.drumstick, pal(R, undefined, leaf))
    else if (/porkchop$|beef$|mutton$|rotten_flesh$/.test(name)) iart(SHAPES.meat, pal(R, undefined, leaf))
    else if (/cod$|salmon$|fish$/.test(name)) iart(SHAPES.fish, pal(R, undefined, leaf))
    else if (/carrot$/.test(name)) iart(SHAPES.carrot, pal(R, undefined, leaf))
    else if (name === 'cookie') iart(SHAPES.cookie, pal(R, undefined, leaf))
    else if (/melon_slice$/.test(name)) iart(SHAPES.slice, pal(R, undefined, { l: '#6f9a2a', k: '#2a1c14' }))
    else if (name === 'pumpkin_pie') { iart(SHAPES.cookie, pal(R, undefined, { k: '#f4e8c8' })) } else if (/berries$/.test(name)) { for (const [x, y] of [[5, 6], [9, 5], [7, 9]]) { blob(x, y, 2, 2, R); ip(x, y - 3, hexRgb('#4f9a38')) } } else blob(7.5, 8, 4.5, 4, R, hashStr(name), 1.2)
    return true
  }
  if (/_stew$|_soup$|^bowl$/.test(name)) {
    const c = ({ mushroom_stew: '#c8906a', rabbit_stew: '#c87a3a', beetroot_soup: '#a8242c', suspicious_stew: '#8aa85a' } as Record<string, string>)[name] ?? '#5a3a20'
    iart(SHAPES.bowl, pal(ramp('#7a5a34', 0.9), ramp(c, 0.8), { b: '#8a6a3a', c: '#5a3d22' }))
    return true
  }
  if (BALLS[name] !== undefined) {
    const [c, c2] = BALLS[name]
    const R = ramp(c, 0.95)
    if (/egg$/.test(name)) blob(7.5, 8.2, 4, 5.2, R)
    else if (name === 'nether_star') iart(SHAPES.star, pal(R))
    else if (/shell$/.test(name)) iart(SHAPES.shell, pal(R, undefined, { k: '#6a4a3a' }))
    else if (/^raw_|coal$|scrap$|brick$|hide$|leather$|cocoa/.test(name)) blob(7.5, 8.5, 5, 4, R, hashStr(name), 1.6)
    else blob(7.5, 7.5, 4.6, 4.6, R)
    if (c2 !== undefined) { const k = hexRgb(c2); ip(7, 7, k); ip(8, 7, k); ip(7, 8, k); ip(8, 8, tone(k, -1)) }
    if (name === 'ender_pearl') { ip(6, 6, R[4]); ip(9, 9, R[0]) }
    return true
  }
  switch (name) {
    case 'bow': iart(SHAPES.bow, pal(R_WOOD(), R_WOOD(), { w: '#e8e8e8' })); return true
    case 'crossbow': iart(SHAPES.crossbow, pal(ramp('#d8d8d4', 0.8), R_WOOD(), { w: '#e8e8e8' })); return true
    case 'arrow': case 'tipped_arrow': case 'spectral_arrow':
      iart(SHAPES.arrow, pal(ramp(name === 'spectral_arrow' ? '#f0d040' : name === 'tipped_arrow' ? '#c84ac8' : '#c9ccd0', 0.8), R_WOOD(), { w: '#f0f0f0' })); return true
    case 'shears': iart(SHAPES.shears, pal(ramp('#d8d8d4', 0.8), ramp('#b8473c', 0.9))); return true
    case 'flint_and_steel': iart(SHAPES.shard, pal(ramp('#3a3a40', 1)), -3, 2); iart(['.444', '4...4', '4...4', '.4.4'], pal(ramp('#c9ccd0', 0.8)), 8, 2); return true
    case 'compass': case 'recovery_compass': case 'clock':
      iart(SHAPES.compass, pal(ramp(name === 'clock' ? '#f0e8c8' : '#d8dce0', 0.7), ramp(name === 'clock' ? '#f2c53a' : name === 'compass' ? '#8a8e94' : '#2a8a8a', 0.9), { r: name === 'recovery_compass' ? '#3ac8d8' : '#d8342c', k: '#3a3a40' })); return true
    case 'spyglass': iart(SHAPES.rod, pal(ramp('#d8904a', 0.9))); ip(12, 2, hexRgb('#dceef4')); return true
    case 'fishing_rod': case 'carrot_on_a_stick': case 'warped_fungus_on_a_stick':
      iart(SHAPES.rodline, pal(R_WOOD(), R_WOOD(), { w: '#e8e8e8', r: name === 'carrot_on_a_stick' ? '#f08a1c' : name === 'fishing_rod' ? '#d8342c' : '#1a9a8a' })); return true
    case 'shield': iart(SHAPES.shield, pal(ramp('#8a6a3a', 0.9), ramp('#9a9da3', 0.8), { b: '#6a6e76' })); return true
    case 'elytra': iart(SHAPES.elytra, pal(ramp('#8a8aa8', 0.9))); return true
    case 'saddle': iart(SHAPES.saddle, pal(ramp('#a85a2a', 0.9), undefined, { b: '#c9ccd0' })); return true
    case 'trident': iart(SHAPES.trident, pal(ramp('#4aa89a', 0.9))); return true
    case 'mace': toolSprite('shovel', 'netherite'); irect(9, 1, 5, 5, hexRgb('#5a5a66')); ip(10, 2, hexRgb('#9a9aa8')); return true
    case 'totem_of_undying': iart(SHAPES.totem, pal(ramp('#f2c53a', 0.9), undefined, { k: '#3a8a4a' })); return true
    case 'name_tag': iart(SHAPES.tag, pal(ramp('#e2d8b8', 0.7), undefined, { w: '#e8e8e8', k: '#4a4a50' })); return true
    case 'lead': iart(SHAPES.string, pal(ramp('#b08a5a', 0.9))); return true
    case 'string': iart(SHAPES.string, pal(ramp('#f0f0f0', 0.5))); return true
    case 'feather': iart(SHAPES.feather, pal(ramp('#f0f0f0', 0.5), R_WOOD())); return true
    case 'bone': iart(SHAPES.bone, pal(ramp('#e8e6d8', 0.5))); return true
    case 'brush': toolSprite('shovel', 'copper'); return true
    case 'goat_horn': iart(SHAPES.rod, pal(ramp('#d8d0b8', 0.8))); return true
    case 'firework_rocket': iart(SHAPES.rod, pal(ramp('#d8342c', 0.9))); ip(12, 2, hexRgb('#f0f0f0')); return true
    case 'end_crystal': iart(SHAPES.gem, pal(ramp('#e060c8', 0.9))); return true
    case 'item_frame': case 'glow_item_frame': case 'painting': {
      const Fr = ramp('#8a5a34', 0.9)
      irect(3, 3, 10, 10, Fr[2]); irect(4, 4, 8, 8, name === 'painting' ? hexRgb('#5a8ab0') : name === 'glow_item_frame' ? hexRgb('#e8f0a0') : hexRgb('#c8a878'))
      for (let i = 3; i < 13; i++) { ip(i, 3, Fr[4]); ip(3, i, Fr[3]); ip(i, 12, Fr[0]); ip(12, i, Fr[1]) }
      if (name === 'painting') { irect(4, 9, 8, 3, hexRgb('#5a9a4a')); ip(9, 6, hexRgb('#f4e060')) }
      return true
    }
    case 'barrier': { const Rd = ramp('#d8342c', 0.9); for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if ((d < 6 && d > 4) || (d <= 4 && Math.abs(x - y) < 1.5)) ip(x, y, Rd[x + y < 14 ? 3 : 2]) } return true }
    case 'light': { const Y = ramp('#f6d85a', 0.8); blob(7.5, 6.5, 4, 4, Y); irect(6, 11, 4, 2, hexRgb('#9a9da3')); ip(6, 5, Y[4]); return true }
    case 'structure_void': { const Bl = ramp('#5a8ab8', 0.9); for (let i = 4; i < 12; i++) { ip(i, i, Bl[3]); ip(15 - i, i, Bl[2]) } irect(7, 7, 2, 2, Bl[4]); return true }
    case 'armor_stand': { const Wd = R_WOOD(); iline(7, 3, 7, 12, Wd[3]); iline(4, 5, 10, 5, Wd[2]); iline(5, 9, 9, 9, Wd[2]); irect(4, 13, 7, 1, hexRgb('#8a8d91')); ip(7, 2, Wd[4]); return true }
  }
  return false
}

// ---------------------------------------------------------------------------
// block items
// ---------------------------------------------------------------------------
const B = (...b: number[][]): number[][] => b.map(v => v.map(n => n / 16))
const FULL = B([0, 0, 0, 16, 16, 16])

const ICON_BOXES: Array<[RegExp, number[][]]> = [
  [/_slab$/, B([0, 0, 0, 16, 8, 16])],
  [/_stairs$/, B([0, 0, 0, 16, 8, 16], [0, 8, 8, 16, 16, 16])],
  [/_carpet$/, B([0, 0, 0, 16, 1, 16])],
  [/_trapdoor$/, B([0, 0, 0, 16, 3, 16])],
  [/_bed$/, B([0, 3, 0, 16, 9, 16], [0, 0, 0, 3, 3, 3], [13, 0, 0, 16, 3, 3], [0, 0, 13, 3, 3, 16], [13, 0, 13, 16, 3, 16])],
  [/chest$/, B([1, 0, 1, 15, 14, 15])],
  [/(_head|_skull)$/, B([4, 0, 4, 12, 8, 12])],
  [/_wall$/, B([4, 0, 4, 12, 16, 12], [5, 0, 0, 11, 13, 16])],
  [/_fence$/, B([6, 0, 1, 10, 16, 5], [6, 0, 11, 10, 16, 15], [7, 12, 5, 9, 15, 11], [7, 6, 5, 9, 9, 11])],
  [/^enchanting_table$/, B([0, 0, 0, 16, 12, 16])],
  [/^stonecutter$/, B([0, 0, 0, 16, 9, 16])],
  [/^daylight_detector$/, B([0, 0, 0, 16, 6, 16])],
  [/sculk_sensor$|^sculk_shrieker$/, B([0, 0, 0, 16, 8, 16])],
  [/^(repeater|comparator)$/, B([0, 0, 0, 16, 2, 16])],
  [/^end_portal_frame$/, B([0, 0, 0, 16, 13, 16])],
  [/^(farmland|dirt_path)$/, B([0, 0, 0, 16, 15, 16])],
  [/anvil$/, B([2, 0, 2, 14, 4, 14], [4, 4, 3, 12, 5, 13], [6, 5, 4, 10, 10, 12], [3, 10, 0, 13, 16, 16])],
  [/^hopper$/, B([0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], [6, 0, 6, 10, 4, 10])],
  [/^brewing_stand$/, B([1, 0, 1, 15, 2, 15], [7, 2, 7, 9, 14, 9])],
  [/^grindstone$/, B([2, 0, 6, 4, 13, 10], [12, 0, 6, 14, 13, 10], [4, 4, 2, 12, 16, 14])],
  [/^conduit$/, B([3, 3, 3, 13, 13, 13])],
  [/^end_rod$|lightning_rod$/, B([7, 0, 7, 9, 16, 9], [6, 0, 6, 10, 2, 10])],
  [/^turtle_egg$/, B([3, 0, 3, 12, 7, 12])],
  [/^sniffer_egg$/, B([1, 0, 2, 15, 16, 14])],
  [/^dried_ghast$/, B([3, 0, 3, 13, 10, 13])],
  [/^sea_pickle$/, B([5, 0, 5, 11, 8, 11])],
  [/^heavy_core$/, B([4, 0, 4, 12, 8, 12])],
  [/^decorated_pot$/, B([1, 0, 1, 15, 16, 15])],
  [/_golem_statue$/, B([3, 0, 3, 13, 14, 13])],
  [/^scaffolding$/, B([0, 14, 0, 16, 16, 16], [0, 0, 0, 2, 14, 2], [14, 0, 0, 16, 14, 2], [0, 0, 14, 2, 14, 16], [14, 0, 14, 16, 14, 16])],
  [/_shelf$/, B([0, 0, 11, 16, 4, 16], [0, 4, 13, 16, 16, 16], [0, 12, 11, 16, 16, 13])],
  [/^chorus_plant$/, B([3, 0, 3, 13, 16, 13])],
  [/azalea$/, B([6, 0, 6, 10, 8, 10], [0, 8, 0, 16, 16, 16])],
  [/^(cake)$/, B([1, 0, 1, 15, 8, 15])]
]

/** Block items that read better as a flat sprite of one of their tiles. */
function spriteTileFor (name: string, look: BlockLook): string | null {
  if (look.kind === 'cross') {
    if (name === 'nether_wart') return 'p:nether_wart:2'
    if (name === 'sunflower' || name === 'lilac' || name === 'rose_bush' || name === 'peony' || name === 'large_fern' || name === 'tall_grass' || name === 'pitcher_plant' || name === 'small_dripleaf') return `p:${name}:top`
    return look.tiles[2]
  }
  if (look.kind === 'flat') return look.tiles[1]
  if (name === 'wheat') return 'p:wheat:7'
  if (name === 'ladder' || name === 'vine' || name === 'glow_lichen' || name === 'sculk_vein' || name === 'resin_clump') return look.tiles[2]
  if (/_pane$|_bars$|_chain$|^chain$|_banner$/.test(name)) return look.tiles[2]
  if (/lantern$/.test(name) && name !== 'sea_lantern' && name !== 'jack_o_lantern') return look.tiles[2]
  if (name === 'bamboo') return 'potted:bamboo_stalk'
  if (name === 'pale_hanging_moss' || name === 'hanging_roots') return look.tiles[2]
  return null
}

function torchSprite (name: string): void {
  const flame = name.startsWith('soul') ? '#3fc4d8' : name.startsWith('redstone') ? '#e8301e' : name.startsWith('copper') ? '#7ad07a' : '#fbc23a'
  const Fl = ramp(flame, 0.9); const St = R_WOOD()
  for (let y = 7; y < 14; y++) { ip(7, y, St[3]); ip(8, y, St[1]) }
  iart(['.44.', '4554', '4554', '.44.'], pal(Fl), 6, 3)
}

function signSprite (wood: string, hanging: boolean): void {
  const w = WOOD[wood] ?? WOOD.oak
  const R = ramp(hanging ? w.inner : w.planks, 0.8); const St = ramp(w.bark, 0.9)
  if (hanging) {
    for (let y = 1; y < 5; y++) { ip(4, y, hexRgb('#6a6e76')); ip(11, y, hexRgb('#6a6e76')) }
    irect(2, 1, 12, 1, St[2])
    irect(2, 5, 12, 8, R[2])
    for (let x = 2; x < 14; x++) { ip(x, 5, R[4]); ip(x, 12, R[0]) }
    for (let x = 4; x < 12; x++) { ip(x, 7, R[0]); if (x < 10) ip(x, 9, R[0]) }
    return
  }
  irect(1, 2, 14, 8, R[2])
  for (let x = 1; x < 15; x++) { ip(x, 2, R[4]); ip(x, 9, R[0]) }
  for (let x = 3; x < 13; x++) { ip(x, 4, R[0]); if (x < 11) ip(x, 6, R[0]) }
  for (let y = 10; y < 15; y++) { ip(7, y, St[3]); ip(8, y, St[1]) }
}

function candleSprite (name: string): void {
  const d = name === 'candle' ? '' : name.slice(0, -7)
  const R = ramp(DYE[d] ?? '#e8d9a8', 0.8)
  for (let y = 7; y < 14; y++) { ip(6, y, R[3]); ip(7, y, R[2]); ip(8, y, R[2]); ip(9, y, R[1]) }
  for (let x = 6; x < 10; x++) ip(x, 7, R[4])
  ip(7, 6, hexRgb('#2a2a30')); ip(7, 5, hexRgb('#2a2a30'))
}

/** Door icon: both halves stacked, drawn at native resolution in the middle of the icon. */
function doorIcon (look: BlockLook, out: Uint8ClampedArray): void {
  const bottom = tile(look.tiles[2])
  const top = tile(look.tiles[2].replace(/:bottom$/, ':top'))
  for (let y = 0; y < ICON; y++) {
    const src = y < 16 ? top : bottom
    for (let x = 0; x < SP; x++) {
      const s = (((y & 15) << 4) | x) << 2; const d = (y * ICON + x + 8) * 4
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3]
    }
  }
}

function fallbackSprite (name: string): void {
  const R = hslRamp(name, 0.34, 0.52)
  iart(SHAPES.gem, pal(R))
  blob(7.5, 8, 4.6, 4.2, R)
  ip(6, 6, R[4]); ip(5, 7, R[4])
}

type IconKind = 'block' | 'sprite' | 'item' | 'fallback'

function paint (itemName: string, env: IconEnv, out: Uint8ClampedArray | null): IconKind {
  if (out !== null) out.fill(0)
  I = new Uint8ClampedArray(SP * SP * 4)
  const finish = (ol: boolean): void => { if (out !== null) { if (ol) outline(); upscale(out) } }

  // block items with a bespoke sprite
  if (/torch$/.test(itemName)) { torchSprite(itemName); finish(true); return 'item' }
  let m: RegExpExecArray | null
  if ((m = /^(.+?)_(hanging_)?sign$/.exec(itemName)) !== null && WOOD_NAMES.includes(m[1])) { signSprite(m[1], m[2] !== undefined); finish(true); return 'item' }
  if (/candle$/.test(itemName) && (itemName === 'candle' || DYE_NAMES.includes(itemName.slice(0, -7)))) { candleSprite(itemName); finish(true); return 'item' }

  const look = itemName === 'air' ? null : env.blockLook(itemName)
  if (look !== null && look.kind !== 'none') {
    if (/_door$/.test(itemName) && look.tiles[2].startsWith('door:')) { if (out !== null) doorIcon(look, out); return 'sprite' }
    const st = spriteTileFor(itemName, look)
    if (st !== null) { fromTile(st); finish(false); return 'sprite' }
    if (out !== null) {
      let boxes = look.boxes ?? FULL
      if (look.boxes === undefined || /_wall$|_fence$/.test(itemName)) for (const [re, b] of ICON_BOXES) if (re.test(itemName)) { boxes = b; break }
      let tiles: string[] = look.tiles
      if (/_bed$/.test(itemName)) tiles = [tiles[0], tiles[1].replace(/:foot$/, ':head'), tiles[2], tiles[3], tiles[4], tiles[5]]
      if (look.kind === 'liquid') boxes = B([0, 0, 0, 16, 14, 16])
      renderBoxes(boxes, tiles, ICON, out, /leaves$/.test(itemName))
    }
    return 'block'
  }
  if (itemName === 'air') return 'item'
  if (itemSprite(itemName)) { finish(true); return 'item' }
  fallbackSprite(itemName); finish(true)
  return 'fallback'
}

/** Paint a 32×32 RGBA icon (row-major, transparent background) for an item registry name. */
export function paintItemIcon (itemName: string, env: IconEnv, out: Uint8ClampedArray): void {
  paint(itemName, env, out)
  if (itemName === 'air') {
    // "air" has no picture; keep a faint marker so the slot is never fully empty
    I = new Uint8ClampedArray(SP * SP * 4)
    const c = hexRgb('#8a9aa8')
    for (let i = 5; i < 11; i++) { ip(i, 5, c); ip(i, 10, c); ip(5, i, c); ip(10, i, c) }
    upscale(out)
  }
}

/** True when the item has no dedicated icon and gets the tinted generic blob. */
export function isFallbackIcon (itemName: string, env: IconEnv): boolean {
  return paint(itemName, env, null) === 'fallback'
}
