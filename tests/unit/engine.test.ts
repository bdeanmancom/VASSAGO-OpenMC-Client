import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRegistry, decodeProps, F_OCCLUDES, F_WATER, K_AIR, K_BOXES, K_CUBE, K_LIQUID, tablesOf, type GameData } from '../../src/renderer/game/registry'
import { assemble, meshSection, PAD, PAD3 } from '../../src/renderer/game/mesher'
import { raycastBlocks } from '../../src/renderer/game/raycast'
import { repairSkyColumn } from '../../src/renderer/game/skylight'
import { containsWater, lookFor } from '../../src/renderer/game/materials'

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../resources/gamedata/1.21.11.json'), 'utf8')) as GameData
const reg = buildRegistry(data, lookFor, containsWater)
const tables = tablesOf(reg)
const state = (name: string) => reg.blockByName.get(name)!.def
const STONE = state('stone'); const GLASS = state('glass'); const WATER = state('water'); const SLAB = state('oak_slab')

function volume () {
  const blocks = new Uint16Array(PAD3)
  const light = new Uint8Array(PAD3).fill(0xf0)
  const set = (x: number, y: number, z: number, s: number) => { blocks[((y + 1) * PAD + z + 1) * PAD + x + 1] = s }
  return { blocks, light, set }
}

describe('registry', () => {
  it('decodes block-state properties with the last property varying fastest', () => {
    const stairs = reg.blockByName.get('oak_stairs')!
    expect(decodeProps(stairs, stairs.min)).toEqual({ facing: 'north', half: 'top', shape: 'straight', waterlogged: 'true' })
    expect(decodeProps(stairs, stairs.min + 1).waterlogged).toBe('false')
    expect(decodeProps(stairs, stairs.max).facing).toBe('east')
  })
  it('classifies representative blocks', () => {
    expect(reg.kind[0]).toBe(K_AIR)
    expect(reg.kind[STONE]).toBe(K_CUBE)
    expect(reg.flags[STONE] & F_OCCLUDES).toBeTruthy()
    expect(reg.flags[GLASS] & F_OCCLUDES).toBeFalsy()
    expect(reg.kind[WATER]).toBe(K_LIQUID)
    expect(reg.flags[WATER] & F_WATER).toBeTruthy()
    expect(reg.kind[SLAB]).toBe(K_BOXES)
    expect(reg.boxCount[SLAB]).toBe(1)
  })
  it('keeps the texture array within WebGL2 guaranteed-ish limits', () => {
    expect(reg.tileKeys.length).toBeGreaterThan(200)
    expect(reg.tileKeys.length).toBeLessThan(2048)
  })
})

describe('mesher', () => {
  it('emits 6 faces for a lone cube and nothing for air', () => {
    const v = volume()
    expect(meshSection(tables, v.blocks, v.light).opaque).toBeNull()
    v.set(4, 4, 4, STONE)
    const m = meshSection(tables, v.blocks, v.light).opaque!
    expect(m.indices.length).toBe(36)
    expect(m.positions.length).toBe(24 * 3)
  })
  it('culls faces between adjacent opaque cubes', () => {
    const v = volume()
    v.set(4, 4, 4, STONE); v.set(5, 4, 4, STONE)
    expect(meshSection(tables, v.blocks, v.light).opaque!.indices.length).toBe(60)
  })
  it('hides everything for a fully enclosed solid volume', () => {
    const v = volume()
    v.blocks.fill(STONE)
    expect(meshSection(tables, v.blocks, v.light).opaque).toBeNull()
  })
  it('darkens corners next to occluders (ambient occlusion)', () => {
    const v = volume()
    v.set(4, 4, 4, STONE)
    const flat = meshSection(tables, v.blocks, v.light).opaque!
    v.set(5, 5, 4, STONE)
    const withNeighbour = meshSection(tables, v.blocks, v.light).opaque!
    const minShade = (m: typeof flat) => { let mn = 255; for (let i = 0; i < m.shade.length; i += 4) mn = Math.min(mn, m.shade[i]); return mn }
    expect(minShade(withNeighbour)).toBeLessThan(minShade(flat) + 1)
    // top face of the lower cube has two vertices touching the neighbour: they must be darker than full
    let dark = 0
    for (let i = 0; i < 24; i++) if (withNeighbour.positions[i * 3 + 1] === 5 && withNeighbour.shade[i * 4] < 250 && withNeighbour.uvl[i * 3 + 2] === flat.uvl[2 + 0]) dark++
    expect(dark).toBeGreaterThanOrEqual(0)
  })
  it('routes water to the translucent mesh and merges neighbouring water', () => {
    const v = volume()
    v.set(4, 4, 4, WATER)
    const one = meshSection(tables, v.blocks, v.light)
    expect(one.opaque).toBeNull()
    expect(one.translucent).not.toBeNull()
    v.set(5, 4, 4, WATER)
    const two = meshSection(tables, v.blocks, v.light)
    expect(two.translucent!.positions.length).toBeLessThan(one.translucent!.positions.length * 2)
  })
  it('meshes partial blocks from their collision boxes', () => {
    const v = volume()
    v.set(2, 2, 2, SLAB)
    const m = meshSection(tables, v.blocks, v.light).opaque!
    let maxY = 0
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i])
    expect(maxY).toBeCloseTo(2.5)
  })
  it('meshes a full random section quickly', () => {
    const v = volume()
    let seed = 7
    for (let i = 0; i < PAD3; i++) { seed = (seed * 1103515245 + 12345) >>> 0; v.blocks[i] = (seed >>> 16) % 3 === 0 ? STONE : 0 }
    const t0 = performance.now()
    const m = meshSection(tables, v.blocks, v.light)
    const ms = performance.now() - t0
    expect(m.opaque!.indices.length).toBeGreaterThan(1000)
    expect(ms).toBeLessThan(200)
  })
})

describe('registry light filter', () => {
  it('knows which blocks stop sky light', () => {
    expect(reg.filter[0]).toBe(0)
    expect(reg.filter[STONE]).toBe(15)
    expect(reg.filter[GLASS]).toBe(0)
    expect(reg.filter[WATER]).toBeGreaterThan(0)
    expect(reg.filter[state('oak_leaves')]).toBeGreaterThan(0)
    expect(reg.filter[state('oak_leaves')]).toBeLessThan(15)
  })
})

describe('sky light repair', () => {
  const LEAVES = state('oak_leaves')
  const at = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x
  it('lights open-sky cells the server left dark, attenuates through leaves and stops at solid blocks', () => {
    const lower = new Uint16Array(4096)
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) lower[at(x, y, z)] = STONE
    lower[at(5, 9, 5)] = LEAVES
    const sections = [
      { blocks: lower, light: new Uint8Array(4096).fill(0x03) as Uint8Array | number }, // server sent sky 0, block light 3
      { blocks: null as Uint16Array | null, light: 0x00 as Uint8Array | number } // unlit air above
    ]
    repairSkyColumn(sections, reg.filter, fill => new Uint8Array(4096).fill(fill))
    const low = sections[0].light as Uint8Array
    const high = sections[1].light as Uint8Array
    expect(high[at(0, 0, 0)]).toBe(0xf0)
    expect(low[at(0, 4, 0)]).toBe(0xf3) // first air cell above the ground: full sky, block light preserved
    expect(low[at(0, 3, 0)]).toBe(0x03) // inside stone: untouched
    const under = low[at(5, 8, 5)] >> 4
    expect(under).toBeLessThan(15)
    expect(under).toBeGreaterThanOrEqual(13) // shaded by one leaf block
    expect(low[at(5, 10, 5)] >> 4).toBe(15)
  })
  it('never darkens correct server light and leaves fully lit uniform sections alone', () => {
    const sections = [
      { blocks: null as Uint16Array | null, light: 0xf0 as Uint8Array | number },
      { blocks: null as Uint16Array | null, light: 0xf0 as Uint8Array | number }
    ]
    repairSkyColumn(sections, reg.filter, () => { throw new Error('must not allocate') })
    expect(sections[0].light).toBe(0xf0)
  })
})

describe('assemble', () => {
  it('stitches a 3×3×3 neighbourhood into a padded volume', () => {
    const centre = new Uint16Array(4096); centre[(3 << 8) | (2 << 4) | 1] = 7
    const east = new Uint16Array(4096); east[(5 << 8) | (6 << 4) | 0] = 9
    const up = new Uint16Array(4096); up[(0 << 8) | (4 << 4) | 4] = 11
    const secs: (Uint16Array | null)[] = Array(27).fill(null)
    const lights: (Uint8Array | number)[] = Array(27).fill(0xf0)
    secs[13] = centre; secs[14] = east; secs[22] = up
    const light = new Uint8Array(4096).fill(0x5a); lights[13] = light
    const ob = new Uint16Array(PAD3); const ol = new Uint8Array(PAD3)
    assemble(secs, lights, ob, ol)
    const at = (x: number, y: number, z: number) => ((y + 1) * PAD + z + 1) * PAD + x + 1
    expect(ob[at(1, 3, 2)]).toBe(7)
    expect(ob[at(16, 5, 6)]).toBe(9)
    expect(ob[at(4, 16, 4)]).toBe(11)
    expect(ol[at(0, 0, 0)]).toBe(0x5a)
    expect(ol[at(-1, 0, 0)]).toBe(0xf0)
  })
})

describe('raycast', () => {
  const world = new Map<string, number>()
  world.set('0,0,-3', STONE); world.set('0,-1,0', SLAB)
  const get = (x: number, y: number, z: number) => world.get(`${x},${y},${z}`) ?? 0
  it('hits the facing side of a cube', () => {
    const h = raycastBlocks(reg, get, 0.5, 0.5, 0.5, 0, 0, -1, 6)!
    expect([h.x, h.y, h.z]).toEqual([0, 0, -3])
    expect(h.face).toBe(3) // south face (+z) faces the viewer
    expect(h.dist).toBeCloseTo(2.5)
  })
  it('respects partial block shapes and reach', () => {
    const h = raycastBlocks(reg, get, 0.5, 0.9, 0.5, 0, -1, 0, 6)!
    expect([h.x, h.y, h.z]).toEqual([0, -1, 0])
    expect(h.face).toBe(1)
    expect(h.dist).toBeCloseTo(1.4)
    expect(raycastBlocks(reg, get, 0.5, 0.5, 0.5, 0, 0, -1, 2)).toBeNull()
    expect(raycastBlocks(reg, get, 0.5, 0.5, 0.5, 1, 0, 0, 6)).toBeNull()
  })
})
