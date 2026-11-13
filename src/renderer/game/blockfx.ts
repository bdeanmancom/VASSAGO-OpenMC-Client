/**
 * Block-breaking feedback: the logic that does not need a renderer.
 *
 * - which original sound a block makes when hit and broken (by material family)
 * - the crack overlay, drawn procedurally in ten stages
 * - the colours of the fragments that fly off a block, sampled from its own tile
 *
 * Everything here is original: the crack pattern is generated, the sounds are synthesized
 * elsewhere from these families, and fragment colours come from Vassago's own painted tiles.
 */

export type SoundGroup = 'stone' | 'wood' | 'dirt' | 'grass' | 'sand' | 'gravel' | 'glass' | 'wool' | 'metal' | 'snow' | 'leaves'

const GROUPS: [RegExp, SoundGroup][] = [
  [/glass|ice$|^ice|_ice|beacon|sea_lantern|glowstone|amethyst/, 'glass'],
  [/wool|carpet|_bed$|sponge|moss|cobweb|hay_block|cake/, 'wool'],
  [/leaves|vine|azalea|mangrove_roots/, 'leaves'],
  [/snow/, 'snow'],
  [/^sand$|red_sand|soul_sand|soul_soil|concrete_powder|suspicious_sand/, 'sand'],
  [/gravel/, 'gravel'],
  [/grass|fern|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|lily|sapling|mushroom|wheat|carrots|potatoes|beetroots|sugar_cane|kelp|seagrass|bamboo|cactus|melon|pumpkin|sweet_berry|dead_bush|crop|stem/, 'grass'],
  [/dirt|farmland|podzol|mycelium|mud$|^mud|clay|rooted|path/, 'dirt'],
  [/iron|gold_block|copper|netherite|anvil|chain|lantern|cauldron|hopper|rail|bars|bell|lightning_rod/, 'metal'],
  [/planks|log|wood|stem$|hyphae|fence|door|trapdoor|chest|barrel|bookshelf|crafting_table|ladder|sign|_stairs|_slab|button|pressure_plate|campfire|composter|lectern|loom|note_block|jukebox|scaffolding|beehive|bee_nest|torch/, 'wood']
]

/** Wooden things are found before the "_stairs"/"_slab" catch-all gets a chance to call stone ones wood. */
const WOODS = /oak|spruce|birch|jungle|acacia|cherry|mangrove|bamboo|crimson|warped|pale_oak/

export function soundGroup (blockName: string): SoundGroup {
  const n = blockName.replace(/^minecraft:/, '')
  for (const [re, group] of GROUPS) {
    if (!re.test(n)) continue
    if (group === 'wood' && /_stairs|_slab|button|pressure_plate|fence|door|trapdoor|sign/.test(n) && !WOODS.test(n)) continue
    return group
  }
  return 'stone'
}

export const CRACK_STAGES = 10
export const CRACK_SIZE = 16

/** Crack stage (0..9) for a dig progress of 0..1, or -1 before anything shows. */
export function crackStage (progress: number): number {
  if (!(progress > 0)) return -1
  return Math.min(CRACK_STAGES - 1, Math.floor(progress * CRACK_STAGES))
}

function rng (seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * RGBA pixels (16×16) of the crack overlay at a stage. Later stages contain the earlier ones:
 * the same fractures grow longer and branch, so the block is seen to give way gradually.
 */
export function crackPixels (stage: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CRACK_SIZE * CRACK_SIZE * 4)
  const put = (x: number, y: number, a: number) => {
    const px = Math.round(x); const py = Math.round(y)
    if (px < 0 || py < 0 || px >= CRACK_SIZE || py >= CRACK_SIZE) return
    const i = (py * CRACK_SIZE + px) * 4
    out[i] = 12; out[i + 1] = 12; out[i + 2] = 16
    out[i + 3] = Math.max(out[i + 3], a)
  }
  const s = Math.max(0, Math.min(CRACK_STAGES - 1, Math.floor(stage)))
  const rnd = rng(0x5eed)
  const arms = 7
  for (let arm = 0; arm < arms; arm++) {
    // every arm draws the same random numbers at every stage, so stages nest
    const angle = (arm / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.7
    const bends = Array.from({ length: 12 }, () => (rnd() - 0.5) * 0.9)
    const branchAt = 2 + Math.floor(rnd() * 4)
    const branchTurn = (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.5)
    const appears = arm < 3 ? 0 : arm - 2 // three arms from the first stage, one more per stage after
    if (s < appears) continue
    const length = 3 + (s - appears) * 1.15
    let x = 7.5; let y = 7.5; let a = angle
    for (let k = 0; k < length; k++) {
      put(x, y, 215)
      if (k === branchAt && s - appears >= 3) {
        let bx = x; let by = y
        for (let j = 0; j < (s - appears - 2) * 0.9; j++) { bx += Math.cos(a + branchTurn); by += Math.sin(a + branchTurn); put(bx, by, 190) }
      }
      a += bends[k % bends.length] * 0.55
      x += Math.cos(a); y += Math.sin(a)
    }
  }
  return out
}

export type RGB3 = [number, number, number]

/**
 * `count` fragment colours taken from a tile's own pixels (16×16 RGBA), skipping transparent
 * ones. Deterministic for a given seed. Falls back to a neutral grey for an empty tile.
 */
export function fragmentColors (tile: Uint8ClampedArray, count: number, seed = 1): RGB3[] {
  const rnd = rng(seed * 2654435761)
  const out: RGB3[] = []
  const pixels = tile.length >> 2
  for (let tries = 0; out.length < count && tries < count * 12; tries++) {
    const i = Math.floor(rnd() * pixels) * 4
    if (tile[i + 3] < 96) continue
    out.push([tile[i] / 255, tile[i + 1] / 255, tile[i + 2] / 255])
  }
  while (out.length < count) out.push([0.5, 0.5, 0.5])
  return out
}
