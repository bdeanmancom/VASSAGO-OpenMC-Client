import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LAYER_CUTOUT, LAYER_OPAQUE, LAYER_TRANSLUCENT, type BlockLook } from '../../src/renderer/game/looks'
import { containsWater, entityColors, isFallbackLook, lookFor } from '../../src/renderer/game/materials'
import { paintTile } from '../../src/renderer/game/textures'
import { paintItemIcon, type IconEnv } from '../../src/renderer/game/itemicons'

interface Block { n: string, min: number, max: number, def: number, p: Array<[string, string[]]>, s: number | number[] }
interface GameData { blocks: Block[], shapes: number[][][], items: Array<{ n: string }>, entities: Array<{ n: string }> }

const data: GameData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../resources/gamedata/1.21.11.json'), 'utf8'))

function propsOf (b: Block, state: number): Record<string, string> {
  let r = state - b.min
  const props: Record<string, string> = {}
  for (let k = b.p.length - 1; k >= 0; k--) {
    const [name, values] = b.p[k]
    props[name] = values[r % values.length]
    r = Math.floor(r / values.length)
  }
  return props
}
const shapeOf = (b: Block, state: number): number[][] => data.shapes[Array.isArray(b.s) ? b.s[state - b.min] : b.s] ?? []

const KINDS = new Set(['auto', 'cube', 'cross', 'flat', 'liquid', 'none'])
const LAYERS = new Set([LAYER_OPAQUE, LAYER_CUTOUT, LAYER_TRANSLUCENT])

/** key → set of layers it is used in (kind 'none' looks excluded). */
const keyLayers = new Map<string, Set<number>>()
const problems: string[] = []
let stateCount = 0
const fallbackBlocks = new Set<string>()

for (const b of data.blocks) {
  for (let s = b.min; s <= b.max; s++) {
    stateCount++
    const props = propsOf(b, s)
    const hasCollision = shapeOf(b, s).length > 0
    const look = lookFor(b.n, props, hasCollision)
    const where = `${b.n} ${JSON.stringify(props)}`
    if (!KINDS.has(look.kind)) problems.push(`bad kind: ${where}`)
    if (!LAYERS.has(look.layer)) problems.push(`bad layer: ${where}`)
    if (!Array.isArray(look.tiles) || look.tiles.length !== 6 || look.tiles.some(t => typeof t !== 'string' || t.length === 0)) problems.push(`bad tiles: ${where}`)
    if (!hasCollision && look.kind === 'auto' && !(look.boxes !== undefined && look.boxes.length > 0)) problems.push(`auto without geometry: ${where}`)
    if (look.boxes !== undefined) {
      for (const box of look.boxes) {
        if (box.length !== 6 || box.some(v => !Number.isFinite(v) || v < 0 || v > 1) || box[0] > box[3] || box[1] > box[4] || box[2] > box[5]) problems.push(`bad box: ${where}`)
      }
    }
    if (look.kind === 'none') continue
    if (isFallbackLook(look)) fallbackBlocks.add(b.n)
    for (const t of look.tiles) {
      let set = keyLayers.get(t)
      if (set === undefined) { set = new Set(); keyLayers.set(t, set) }
      set.add(look.layer)
    }
  }
}

const def = (name: string): BlockLook => {
  const b = data.blocks.find(x => x.n === name)
  if (b === undefined) throw new Error(`no block ${name}`)
  return lookFor(name, propsOf(b, b.def), shapeOf(b, b.def).length > 0)
}

describe('materials', () => {
  it('returns a valid look for every state of every block', () => {
    expect(stateCount).toBeGreaterThan(20000)
    expect(problems.slice(0, 20)).toEqual([])
  })

  it('keeps the number of distinct tile keys under the texture-array budget', () => {
    expect(keyLayers.size).toBeGreaterThan(300)
    expect(keyLayers.size).toBeLessThan(1400)
  })

  it('has dedicated art for (nearly) every block', () => {
    expect([...fallbackBlocks].length).toBeLessThan(40)
  })

  it('handles the special kinds', () => {
    expect(def('air').kind).toBe('none')
    expect(def('barrier').kind).toBe('none')
    const water = def('water')
    expect(water.kind).toBe('liquid')
    expect(water.layer).toBe(LAYER_TRANSLUCENT)
    expect(containsWater('water', { level: '0' })).toBe(true)
    const lava = def('lava')
    expect(lava.kind).toBe('liquid')
    expect(lava.emissive).toBe(true)
    expect(containsWater('lava', { level: '0' })).toBe(false)
    expect(containsWater('oak_stairs', { waterlogged: 'true', facing: 'north', half: 'bottom', shape: 'straight' })).toBe(true)
    expect(containsWater('oak_stairs', { waterlogged: 'false', facing: 'north', half: 'bottom', shape: 'straight' })).toBe(false)
    expect(containsWater('kelp', { age: '0' })).toBe(true)
    expect(containsWater('seagrass', {})).toBe(true)
    expect(def('poppy').kind).toBe('cross')
    expect(def('rail').kind).toBe('flat')
    expect(def('glowstone').emissive).toBe(true)
    expect(def('torch').emissive).toBe(true)
    expect(def('oak_leaves').layer).toBe(LAYER_CUTOUT)
    expect(def('red_stained_glass').layer).toBe(LAYER_TRANSLUCENT)
  })

  it('puts log end-grain on the faces perpendicular to the axis', () => {
    // faces: down, up, north, south, west, east
    const y = lookFor('oak_log', { axis: 'y' }, true).tiles
    const x = lookFor('oak_log', { axis: 'x' }, true).tiles
    const z = lookFor('oak_log', { axis: 'z' }, true).tiles
    const end = y[0]
    expect(y[1]).toBe(end)
    expect(y.slice(2).every(t => t !== end)).toBe(true)
    expect([x[4], x[5]]).toEqual([end, end])
    expect([x[0], x[1], x[2], x[3]].every(t => t !== end)).toBe(true)
    expect([z[2], z[3]]).toEqual([end, end])
    expect([z[0], z[1], z[4], z[5]].every(t => t !== end)).toBe(true)
  })

  it('gives grass distinct top, side and bottom, and a snowy side', () => {
    const g = lookFor('grass_block', { snowy: 'false' }, true).tiles
    expect(new Set([g[0], g[1], g[2]]).size).toBe(3)
    const snowy = lookFor('grass_block', { snowy: 'true' }, true).tiles
    expect(snowy[2]).not.toBe(g[2])
  })

  it('puts the furnace front on the facing side', () => {
    const n = lookFor('furnace', { facing: 'north', lit: 'false' }, true).tiles
    const e = lookFor('furnace', { facing: 'east', lit: 'false' }, true).tiles
    expect(n[2]).toBe(e[5])
    expect(n[2]).not.toBe(n[3])
    expect(lookFor('furnace', { facing: 'north', lit: 'true' }, true).tiles[2]).not.toBe(n[2])
  })

  it('falls back sensibly for unknown blocks', () => {
    const solid = lookFor('totally_new_block', {}, true)
    expect(solid.kind).toBe('auto')
    expect(isFallbackLook(solid)).toBe(true)
    const plant = lookFor('totally_new_plant', { age: '1' }, false)
    expect(plant.kind).not.toBe('auto')
    expect(plant.tiles).toHaveLength(6)
  })

  it('has colours for every entity', () => {
    for (const e of [...data.entities, { n: 'something_unknown' }]) {
      const c = entityColors(e.n)
      expect(c.body).toMatch(/^#[0-9a-f]{6}$/)
      expect(c.accent).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('textures', () => {
  it('paints every tile deterministically with layer-appropriate alpha', () => {
    const a = new Uint8ClampedArray(16 * 16 * 4)
    const b = new Uint8ClampedArray(16 * 16 * 4)
    const bad: string[] = []
    for (const [key, layers] of keyLayers) {
      a.fill(7); b.fill(99)
      paintTile(key, a)
      paintTile(key, b)
      let same = true; let allOpaque = true; let binary = true; let any = false
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break }
      for (let i = 3; i < a.length; i += 4) {
        if (a[i] !== 255) allOpaque = false
        if (a[i] !== 0 && a[i] !== 255) binary = false
        if (a[i] !== 0) any = true
      }
      if (!same) bad.push(`not deterministic: ${key}`)
      if (!any) bad.push(`empty: ${key}`)
      if (layers.has(LAYER_OPAQUE) && !allOpaque) bad.push(`opaque layer tile with holes: ${key}`)
      if (layers.has(LAYER_CUTOUT) && !binary) bad.push(`cutout tile with partial alpha: ${key}`)
    }
    expect(bad.slice(0, 20)).toEqual([])
  })

  it('still paints unknown keys', () => {
    const px = new Uint8ClampedArray(16 * 16 * 4)
    paintTile('no_such_tile:at:all', px)
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i + 3]).toBe(255)
      // neutral, never the classic magenta "missing texture"
      expect(px[i] > 200 && px[i + 1] < 80 && px[i + 2] > 200).toBe(false)
    }
  })

  it('applies the transform suffix', () => {
    const base = new Uint8ClampedArray(16 * 16 * 4)
    const t = new Uint8ClampedArray(16 * 16 * 4)
    paintTile('log:oak', base)
    paintTile('log:oak~1', t)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(t[(y * 16 + x) * 4]).toBe(base[(x * 16 + y) * 4])
  })
})

describe('item icons', () => {
  const blocks = new Map(data.blocks.map(b => [b.n, b]))
  const env: IconEnv = {
    blockLook: name => {
      const b = blocks.get(name)
      return b === undefined ? null : lookFor(name, propsOf(b, b.def), shapeOf(b, b.def).length > 0)
    }
  }

  it('paints something for every item', () => {
    const px = new Uint8ClampedArray(32 * 32 * 4)
    const empty: string[] = []
    for (const item of [...data.items, { n: 'item_from_the_future' }]) {
      px.fill(0)
      paintItemIcon(item.n, env, px)
      let opaque = 0
      for (let i = 3; i < px.length; i += 4) if (px[i] >= 200) opaque++
      if (opaque < 12) empty.push(item.n)
    }
    expect(empty).toEqual([])
  })

  it('is deterministic', () => {
    const a = new Uint8ClampedArray(32 * 32 * 4)
    const b = new Uint8ClampedArray(32 * 32 * 4)
    for (const n of ['diamond_pickaxe', 'oak_planks', 'poppy', 'water_bucket', 'unknown_thing']) {
      paintItemIcon(n, env, a)
      paintItemIcon(n, env, b)
      expect(Array.from(a)).toEqual(Array.from(b))
    }
  })
})
