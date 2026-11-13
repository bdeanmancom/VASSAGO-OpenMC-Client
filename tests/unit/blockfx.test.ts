import { describe, expect, it } from 'vitest'
import { CRACK_SIZE, CRACK_STAGES, crackPixels, crackStage, fragmentColors, soundGroup } from '../../src/renderer/game/blockfx'
import { Particles } from '../../src/renderer/game/particles'

describe('crack overlay', () => {
  const opaque = (px: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++; return n }
  it('maps dig progress to ten stages', () => {
    expect(crackStage(0)).toBe(-1)
    expect(crackStage(0.01)).toBe(0)
    expect(crackStage(0.55)).toBe(5)
    expect(crackStage(1)).toBe(CRACK_STAGES - 1)
    expect(crackStage(NaN)).toBe(-1)
  })
  it('grows from stage to stage, each containing the one before', () => {
    let previous = crackPixels(0)
    expect(previous.length).toBe(CRACK_SIZE * CRACK_SIZE * 4)
    expect(opaque(previous)).toBeGreaterThan(3)
    for (let stage = 1; stage < CRACK_STAGES; stage++) {
      const current = crackPixels(stage)
      expect(opaque(current), `stage ${stage}`).toBeGreaterThan(opaque(previous))
      for (let i = 3; i < current.length; i += 4) if (previous[i] > 0) expect(current[i]).toBeGreaterThan(0)
      previous = current
    }
    // never a solid cover: the block stays recognisable under the last stage
    expect(opaque(previous)).toBeLessThan(CRACK_SIZE * CRACK_SIZE * 0.6)
  })
  it('is deterministic', () => {
    expect(Array.from(crackPixels(6))).toEqual(Array.from(crackPixels(6)))
  })
})

describe('material sounds', () => {
  it('puts blocks into the family they sound like', () => {
    const cases: [string, string][] = [
      ['stone', 'stone'], ['cobblestone', 'stone'], ['deepslate_bricks', 'stone'], ['stone_stairs', 'stone'], ['stone_button', 'stone'],
      ['oak_planks', 'wood'], ['spruce_log', 'wood'], ['oak_stairs', 'wood'], ['birch_door', 'wood'], ['chest', 'wood'], ['crafting_table', 'wood'],
      ['dirt', 'dirt'], ['farmland', 'dirt'], ['grass_block', 'grass'], ['short_grass', 'grass'], ['poppy', 'grass'],
      ['sand', 'sand'], ['gravel', 'gravel'], ['glass', 'glass'], ['white_stained_glass_pane', 'glass'], ['ice', 'glass'],
      ['white_wool', 'wool'], ['red_carpet', 'wool'], ['iron_block', 'metal'], ['anvil', 'metal'], ['iron_door', 'metal'],
      ['snow_block', 'snow'], ['oak_leaves', 'leaves'], ['minecraft:obsidian', 'stone']
    ]
    for (const [block, group] of cases) expect(soundGroup(block), block).toBe(group)
  })
})

describe('fragments', () => {
  it('take their colours from the visible pixels of the block tile', () => {
    const tile = new Uint8ClampedArray(16 * 16 * 4)
    for (let i = 0; i < 256; i++) { tile[i * 4] = 255; tile[i * 4 + 1] = i < 128 ? 0 : 128; tile[i * 4 + 2] = 0; tile[i * 4 + 3] = i % 2 ? 255 : 0 }
    const colors = fragmentColors(tile, 20, 7)
    expect(colors.length).toBe(20)
    for (const [r, g, b] of colors) { expect(r).toBe(1); expect([0, 128 / 255]).toContain(g); expect(b).toBe(0) }
    expect(fragmentColors(tile, 20, 7)).toEqual(colors)
    expect(fragmentColors(new Uint8ClampedArray(16 * 16 * 4), 3)).toEqual([[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]])
  })
  it('fly, fall and disappear', () => {
    const p = new Particles()
    expect(p.count).toBe(0)
    p.burst(10, 64, -3, fragmentColors(new Uint8ClampedArray(1024).fill(200), 28), 1)
    p.hit(10, 64, -3, [0, 1, 0], [[1, 1, 1], [1, 1, 1]], 0.5)
    expect(p.count).toBe(30)
    p.update(0.05)
    expect(p.count).toBe(30)
    expect(p.points.geometry.drawRange.count).toBeGreaterThan(0)
    for (let i = 0; i < 40; i++) p.update(0.05)
    expect(p.count).toBe(0)
    p.update(0.05)
    expect(p.points.geometry.drawRange.count).toBe(0)
    p.dispose()
  })
})
