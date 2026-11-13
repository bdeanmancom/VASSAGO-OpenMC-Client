#!/usr/bin/env node
// Contact-sheet generator for the procedural art library.
//
//   node scripts/art-preview.mjs                 tiles.png, blocks.png, icons.png + stats
//   node scripts/art-preview.mjs --tiles REGEX   review-tiles.png  (matching tile keys, large)
//   node scripts/art-preview.mjs --blocks REGEX  review-blocks.png (matching blocks, isometric, large)
//   node scripts/art-preview.mjs --icons REGEX   review-icons.png  (matching items, large)
//   options: --version 1.21.11   --scale N   --cols N   --out NAME
//
// Output goes to tests/e2e/artifacts/art/ (gitignored). PNGs are encoded here with
// node:zlib, so there are no native dependencies.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'tests', 'e2e', 'artifacts', 'art')

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
function opt (name, fallback = null) {
  const i = argv.indexOf('--' + name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}
const version = opt('version', '1.21.11')

// ---------------------------------------------------------------------------
// bundle + import the art modules
// ---------------------------------------------------------------------------
async function loadArt () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vassago-art-'))
  const entry = path.join(tmp, 'entry.ts')
  const dir = path.join(root, 'src', 'renderer', 'game').replace(/\\/g, '/')
  const hasIcons = fs.existsSync(path.join(dir, 'itemicons.ts'))
  fs.writeFileSync(entry, [
    `export * from '${dir}/looks'`,
    `export * from '${dir}/materials'`,
    `export * from '${dir}/textures'`,
    hasIcons ? `export * from '${dir}/itemicons'` : ''
  ].join('\n'))
  const outfile = path.join(tmp, 'art.mjs')
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning' })
  try {
    return await import(pathToFileURL(outfile).href)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// tiny PNG encoder (RGBA8, no interlace)
// ---------------------------------------------------------------------------
const CRC = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC[n] = c >>> 0
}
function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk (type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng (w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------------------
// canvas helpers
// ---------------------------------------------------------------------------
class Sheet {
  constructor (w, h, bg = [24, 26, 31]) {
    this.w = w; this.h = h
    this.d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) { this.d[i * 4] = bg[0]; this.d[i * 4 + 1] = bg[1]; this.d[i * 4 + 2] = bg[2]; this.d[i * 4 + 3] = 255 }
  }

  px (x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a === 0) return
    const i = (y * this.w + x) * 4
    const t = a / 255
    this.d[i] = this.d[i] * (1 - t) + r * t
    this.d[i + 1] = this.d[i + 1] * (1 - t) + g * t
    this.d[i + 2] = this.d[i + 2] * (1 - t) + b * t
  }

  rect (x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c[0], c[1], c[2])
  }

  /** Blit an RGBA image scaled by an integer factor. */
  blit (img, iw, ih, x, y, scale) {
    for (let j = 0; j < ih; j++) {
      for (let i = 0; i < iw; i++) {
        const s = (j * iw + i) * 4
        if (img[s + 3] === 0) continue
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) this.px(x + i * scale + dx, y + j * scale + dy, img[s], img[s + 1], img[s + 2], img[s + 3])
      }
    }
  }

  text (str, x, y, c = [150, 156, 168]) {
    let cx = x
    for (const ch of str.toUpperCase()) {
      const g = FONT[ch]
      if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r * 3 + k] === '1') this.px(cx + k, y + r, c[0], c[1], c[2])
      cx += 4
    }
  }

  save (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, encodePng(this.w, this.h, this.d))
  }
}

const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '010101010101010',
  9: '010101011001110', _: '000000000000111', ':': '000010000010000', '~': '000011110000000', '-': '000000111000000',
  '.': '000000000000010'
}

/** Split a label into lines of at most `n` characters. */
function wrapLabel (s, n, maxLines) {
  const lines = []
  for (let i = 0; i < s.length && lines.length < maxLines; i += n) lines.push(s.slice(i, i + n))
  return lines
}

// ---------------------------------------------------------------------------
// game data
// ---------------------------------------------------------------------------
const data = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'gamedata', `${version}.json`), 'utf8'))

/** All states of a block as { props, shape } (last property varies fastest). */
function statesOf (b) {
  const out = []
  const n = b.max - b.min + 1
  for (let i = 0; i < n; i++) {
    let r = i
    const props = {}
    for (let k = b.p.length - 1; k >= 0; k--) {
      const [name, values] = b.p[k]
      props[name] = values[r % values.length]
      r = Math.floor(r / values.length)
    }
    const shape = data.shapes[Array.isArray(b.s) ? b.s[i] : b.s] ?? []
    out.push({ props, shape, id: b.min + i })
  }
  return out
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const art = await loadArt()
const { lookFor, paintTile, hasPainter, isFallbackLook, paintItemIcon, isFallbackIcon, renderBoxes } = art

const blockByName = new Map(data.blocks.map(b => [b.name ?? b.n, b]))
const defaultState = b => statesOf(b).find(s => s.id === b.def) ?? statesOf(b)[0]

function tileImage (key) {
  const px = new Uint8ClampedArray(16 * 16 * 4)
  paintTile(key, px)
  return px
}

/** Isometric (or flat sprite) picture of one block state, `size`×`size` RGBA. */
function blockImage (name, state, size) {
  const look = lookFor(name, state.props, state.shape.length > 0)
  const out = new Uint8ClampedArray(size * size * 4)
  if (look.kind === 'none') return out
  if (look.kind === 'cross' || look.kind === 'flat') {
    const t = tileImage(look.kind === 'cross' ? look.tiles[2] : look.tiles[1])
    const k = Math.floor(size / 16)
    const off = Math.floor((size - 16 * k) / 2)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const s = (y * 16 + x) * 4
        for (let dy = 0; dy < k; dy++) {
          for (let dx = 0; dx < k; dx++) {
            const d = ((off + y * k + dy) * size + off + x * k + dx) * 4
            out[d] = t[s]; out[d + 1] = t[s + 1]; out[d + 2] = t[s + 2]; out[d + 3] = t[s + 3]
          }
        }
      }
    }
    return out
  }
  const boxes = look.boxes ?? (look.kind === 'auto' && state.shape.length > 0 ? state.shape : [[0, 0, 0, 1, 1, 1]])
  if (renderBoxes) renderBoxes(boxes, look.tiles, size, out)
  return out
}

function stats () {
  const keys = new Map() // key -> layer mask
  const fallbackBlocks = []
  let states = 0
  const kinds = {}
  for (const b of data.blocks) {
    let fb = false
    for (const st of statesOf(b)) {
      states++
      const look = lookFor(b.n, st.props, st.shape.length > 0)
      kinds[look.kind] = (kinds[look.kind] ?? 0) + 1
      if (look.kind === 'none') continue
      if (isFallbackLook(look)) fb = true
      for (const k of look.tiles) keys.set(k, (keys.get(k) ?? 0) | (1 << look.layer))
    }
    if (fb) fallbackBlocks.push(b.n)
  }
  return { keys, fallbackBlocks, states, kinds }
}

function sheetOfTiles (keys, scale, cols, labelLines = 2) {
  const cellW = 16 * scale + 4
  const chars = Math.floor((cellW - 2) / 4)
  const cellH = 16 * scale + 4 + labelLines * 6
  const rows = Math.ceil(keys.length / cols)
  const sheet = new Sheet(cols * cellW + 4, rows * cellH + 4)
  keys.forEach((key, i) => {
    const x = 4 + (i % cols) * cellW; const y = 4 + Math.floor(i / cols) * cellH
    sheet.blit(tileImage(key), 16, 16, x, y, scale)
    wrapLabel(key, chars, labelLines).forEach((ln, k) => sheet.text(ln, x, y + 16 * scale + 1 + k * 6))
  })
  return sheet
}

function sheetOfImages (items, size, scale, cols, labelLines = 2) {
  const cellW = size * scale + 4
  const chars = Math.floor((cellW - 2) / 4)
  const cellH = size * scale + 4 + labelLines * 6
  const rows = Math.ceil(items.length / cols)
  const sheet = new Sheet(cols * cellW + 4, rows * cellH + 4, [30, 32, 38])
  items.forEach((it, i) => {
    const x = 4 + (i % cols) * cellW; const y = 4 + Math.floor(i / cols) * cellH
    sheet.blit(it.img, size, size, x, y, scale)
    wrapLabel(it.label, chars, labelLines).forEach((ln, k) => sheet.text(ln, x, y + size * scale + 1 + k * 6))
  })
  return sheet
}

const iconEnv = {
  blockLook: name => {
    const b = blockByName.get(name)
    if (!b) return null
    const st = defaultState(b)
    return lookFor(name, st.props, st.shape.length > 0)
  }
}
function iconImage (name) {
  const px = new Uint8ClampedArray(32 * 32 * 4)
  paintItemIcon(name, iconEnv, px)
  return px
}

const REPRESENTATIVE = `grass_block dirt coarse_dirt podzol mycelium dirt_path farmland mud clay sand red_sand gravel snow_block ice packed_ice blue_ice
stone cobblestone mossy_cobblestone stone_bricks mossy_stone_bricks cracked_stone_bricks chiseled_stone_bricks smooth_stone granite polished_granite diorite polished_diorite andesite polished_andesite
deepslate cobbled_deepslate polished_deepslate deepslate_bricks deepslate_tiles chiseled_deepslate tuff polished_tuff tuff_bricks chiseled_tuff calcite dripstone_block
blackstone polished_blackstone polished_blackstone_bricks gilded_blackstone basalt polished_basalt smooth_basalt obsidian crying_obsidian bedrock
sandstone chiseled_sandstone cut_sandstone smooth_sandstone red_sandstone cut_red_sandstone bricks mud_bricks packed_mud nether_bricks red_nether_bricks netherrack soul_sand soul_soil magma_block glowstone
end_stone end_stone_bricks purpur_block purpur_pillar quartz_block quartz_pillar chiseled_quartz_block quartz_bricks prismarine prismarine_bricks dark_prismarine sea_lantern
coal_ore iron_ore copper_ore gold_ore redstone_ore lapis_ore diamond_ore emerald_ore deepslate_diamond_ore deepslate_iron_ore nether_gold_ore nether_quartz_ore ancient_debris
coal_block iron_block copper_block gold_block redstone_block lapis_block diamond_block emerald_block netherite_block raw_iron_block raw_copper_block raw_gold_block amethyst_block budding_amethyst
exposed_copper weathered_copper oxidized_copper cut_copper oxidized_cut_copper chiseled_copper copper_grate copper_bulb
oak_planks spruce_planks birch_planks jungle_planks acacia_planks dark_oak_planks mangrove_planks cherry_planks pale_oak_planks bamboo_planks crimson_planks warped_planks bamboo_mosaic
oak_log spruce_log birch_log jungle_log acacia_log dark_oak_log mangrove_log cherry_log pale_oak_log bamboo_block crimson_stem warped_stem stripped_oak_log stripped_birch_log
oak_leaves spruce_leaves birch_leaves jungle_leaves acacia_leaves dark_oak_leaves mangrove_leaves cherry_leaves pale_oak_leaves azalea_leaves flowering_azalea_leaves
white_wool red_wool blue_wool yellow_wool lime_concrete cyan_concrete black_concrete orange_concrete_powder purple_concrete_powder terracotta white_terracotta red_terracotta cyan_terracotta
magenta_glazed_terracotta light_blue_glazed_terracotta yellow_glazed_terracotta lime_glazed_terracotta glass white_stained_glass red_stained_glass blue_stained_glass tinted_glass
crafting_table furnace blast_furnace smoker chest ender_chest barrel bookshelf chiseled_bookshelf jukebox note_block tnt dispenser dropper observer piston sticky_piston
loom cartography_table fletching_table smithing_table stonecutter grindstone lectern composter hopper cauldron anvil enchanting_table brewing_stand bell beacon spawner
bee_nest beehive honey_block honeycomb_block slime_block sponge hay_block pumpkin carved_pumpkin jack_o_lantern melon cactus bone_block target redstone_lamp
moss_block sculk sculk_catalyst sculk_sensor shroomlight nether_wart_block warped_wart_block crimson_nylium warped_nylium ochre_froglight mushroom_stem red_mushroom_block brown_mushroom_block
oak_stairs stone_brick_stairs oak_slab cobblestone_wall oak_fence oak_fence_gate oak_door iron_door oak_trapdoor glass_pane iron_bars ladder scaffolding red_bed white_carpet
torch lantern campfire oak_sign red_banner lever stone_button oak_pressure_plate flower_pot potted_poppy cake red_candle white_shulker_box shulker_box player_head creeper_head
tube_coral_block brain_coral_block fire_coral_block dead_horn_coral_block end_portal_frame respawn_anchor lodestone command_block structure_block decorated_pot dragon_egg`.split(/\s+/)

async function main () {
  const tilesRe = opt('tiles'); const blocksRe = opt('blocks'); const iconsRe = opt('icons')
  const st = stats()
  const allKeys = [...st.keys.keys()].sort()

  if (tilesRe !== null) {
    const re = new RegExp(tilesRe)
    const keys = allKeys.filter(k => re.test(k))
    const scale = Number(opt('scale', 6)); const cols = Number(opt('cols', 10))
    const file = path.join(outDir, opt('out', 'review-tiles') + '.png')
    sheetOfTiles(keys, scale, cols, 3).save(file)
    console.log(`${keys.length} tiles → ${file}`)
    return
  }
  if (blocksRe !== null) {
    const re = new RegExp(blocksRe)
    const scale = Number(opt('scale', 2)); const cols = Number(opt('cols', 8))
    const items = data.blocks.filter(b => re.test(b.n)).map(b => ({ label: b.n, img: blockImage(b.n, defaultState(b), 64) }))
    const file = path.join(outDir, opt('out', 'review-blocks') + '.png')
    sheetOfImages(items, 64, scale, cols, 2).save(file)
    console.log(`${items.length} blocks → ${file}`)
    return
  }
  if (iconsRe !== null) {
    const re = new RegExp(iconsRe)
    const scale = Number(opt('scale', 4)); const cols = Number(opt('cols', 10))
    const items = data.items.filter(i => re.test(i.n)).map(i => ({ label: i.n, img: iconImage(i.n) }))
    const file = path.join(outDir, opt('out', 'review-icons') + '.png')
    sheetOfImages(items, 32, scale, cols, 2).save(file)
    console.log(`${items.length} icons → ${file}`)
    return
  }

  // (a) every distinct tile key
  sheetOfTiles(allKeys, 3, 40, 2).save(path.join(outDir, 'tiles.png'))

  // (b) representative blocks as pseudo-isometric cubes
  const reps = REPRESENTATIVE.filter(n => blockByName.has(n))
  sheetOfImages(reps.map(n => ({ label: n, img: blockImage(n, defaultState(blockByName.get(n)), 64) })), 64, 1, 20, 2)
    .save(path.join(outDir, 'blocks.png'))

  // (c) every item icon at 2×
  let fallbackItems = []
  if (paintItemIcon) {
    sheetOfImages(data.items.map(i => ({ label: i.n, img: iconImage(i.n) })), 32, 2, 32, 2).save(path.join(outDir, 'icons.png'))
    if (isFallbackIcon) fallbackItems = data.items.filter(i => isFallbackIcon(i.n, iconEnv)).map(i => i.n)
  }

  const missing = allKeys.filter(k => !hasPainter(k))
  console.log(`version ${version}: ${data.blocks.length} blocks, ${st.states} states, ${data.items.length} items`)
  console.log(`render kinds: ${Object.entries(st.kinds).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  console.log(`distinct tile keys: ${allKeys.length}`)
  console.log(`tile keys without a dedicated painter: ${missing.length}${missing.length ? '\n  ' + missing.join(' ') : ''}`)
  console.log(`blocks using the fallback look: ${st.fallbackBlocks.length}${st.fallbackBlocks.length ? '\n  ' + st.fallbackBlocks.join(' ') : ''}`)
  console.log(`items using the fallback icon: ${fallbackItems.length}${fallbackItems.length ? '\n  ' + fallbackItems.slice(0, 60).join(' ') : ''}`)
  console.log(`sheets written to ${outDir}`)
}

await main()
