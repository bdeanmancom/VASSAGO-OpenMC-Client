/**
 * Chunk-section mesher. Pure function over padded 18³ block/light volumes so it can run
 * in web workers and unit tests.
 *
 * Output vertex layout:
 *   position  float32 ×3   section-local (0..16)
 *   uvl       float32 ×3   u, v, texture-array layer
 *   shade     uint8   ×4   ao×faceShade, sky light, block light, emissive flag
 */
import {
  F_CULL_SAME, F_EMISSIVE, F_OCCLUDES, F_WATER, K_AIR, K_BOXES, K_CROSS, K_CUBE, K_FLAT, K_LIQUID,
  type RegistryTables
} from './registry'
import { LAYER_TRANSLUCENT } from './looks'

export const PAD = 18
export const PAD3 = PAD * PAD * PAD

export interface MeshData {
  positions: Float32Array
  uvl: Float32Array
  shade: Uint8Array
  indices: Uint32Array
}
export interface SectionMesh { opaque: MeshData | null, translucent: MeshData | null }

class Builder {
  pos = new Float32Array(4096 * 3)
  uvl = new Float32Array(4096 * 3)
  shade = new Uint8Array(4096 * 4)
  idx = new Uint32Array(8192)
  nv = 0
  ni = 0

  reset () { this.nv = 0; this.ni = 0 }

  private growV () {
    const cap = this.pos.length / 3 * 2
    const p = new Float32Array(cap * 3); p.set(this.pos); this.pos = p
    const u = new Float32Array(cap * 3); u.set(this.uvl); this.uvl = u
    const s = new Uint8Array(cap * 4); s.set(this.shade); this.shade = s
  }

  vertex (x: number, y: number, z: number, u: number, v: number, layer: number, ao: number, sky: number, blk: number, em: number): number {
    if ((this.nv + 1) * 3 > this.pos.length) this.growV()
    const i = this.nv
    const i3 = i * 3
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z
    this.uvl[i3] = u; this.uvl[i3 + 1] = v; this.uvl[i3 + 2] = layer
    const i4 = i * 4
    this.shade[i4] = ao; this.shade[i4 + 1] = sky; this.shade[i4 + 2] = blk; this.shade[i4 + 3] = em
    this.nv++
    return i
  }

  quad (a: number, b: number, c: number, d: number, flip: boolean, doubleSided = false) {
    const need = doubleSided ? 12 : 6
    if (this.ni + need > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n }
    const ix = this.idx
    let k = this.ni
    if (flip) { ix[k++] = b; ix[k++] = c; ix[k++] = d; ix[k++] = b; ix[k++] = d; ix[k++] = a } else { ix[k++] = a; ix[k++] = b; ix[k++] = c; ix[k++] = a; ix[k++] = c; ix[k++] = d }
    if (doubleSided) { ix[k++] = c; ix[k++] = b; ix[k++] = a; ix[k++] = d; ix[k++] = c; ix[k++] = a }
    this.ni = k
  }

  finish (): MeshData | null {
    if (this.ni === 0) return null
    return {
      positions: this.pos.slice(0, this.nv * 3),
      uvl: this.uvl.slice(0, this.nv * 3),
      shade: this.shade.slice(0, this.nv * 4),
      indices: this.idx.slice(0, this.ni)
    }
  }
}

// Face tables. Order: down, up, north, south, west, east.
// For each face: normal axis/sign and tangent axes (u × v = n) so corners
// (0,0),(1,0),(1,1),(0,1) wind counter-clockwise seen from outside.
const F_NAXIS = [1, 1, 2, 2, 0, 0]
const F_SIGN = [-1, 1, -1, 1, -1, 1]
const F_UAXIS = [0, 2, 1, 0, 2, 1]
const F_VAXIS = [2, 0, 0, 1, 1, 2]
const FACE_SHADE = [0.55, 1.0, 0.82, 0.82, 0.68, 0.68]
const AO_CURVE = [0.48, 0.66, 0.83, 1.0]
const CORNER_A = [0, 1, 1, 0]
const CORNER_B = [0, 0, 1, 1]
const STRIDE = [1, PAD * PAD, PAD] // index stride per axis x, y, z

const opaqueB = new Builder()
const transB = new Builder()
const p3 = [0, 0, 0]
const lo = [0, 0, 0]
const hi = [0, 0, 0]
const cAo = [0, 0, 0, 0]
const cSky = [0, 0, 0, 0]
const cBlk = [0, 0, 0, 0]
const cIdx = [0, 0, 0, 0]

function texU (face: number, x: number, y: number, z: number): number {
  switch (face) {
    case 0: case 1: return x
    case 2: return 1 - x
    case 3: return x
    case 4: return z
    default: return 1 - z
  }
}
function texV (face: number, x: number, y: number, z: number): number {
  return face < 2 ? z : 1 - y
}

export function meshSection (reg: RegistryTables, blocks: Uint16Array, light: Uint8Array, smooth = true): SectionMesh {
  const { kind, flags, layer, tiles, stateCount } = reg
  opaqueB.reset(); transB.reset()

  for (let y = 1; y <= 16; y++) {
    for (let z = 1; z <= 16; z++) {
      let i = (y * PAD + z) * PAD + 1
      for (let x = 1; x <= 16; x++, i++) {
        const s = blocks[i]
        if (s === 0 || s >= stateCount) continue
        const k = kind[s]
        const fl = flags[s]
        const bx = x - 1; const by = y - 1; const bz = z - 1
        if (k === K_CUBE) cube(reg, blocks, light, i, s, bx, by, bz, smooth)
        else if (k === K_BOXES) boxes(reg, blocks, light, i, s, bx, by, bz)
        else if (k === K_CROSS) cross(reg, light, i, s, bx, by, bz)
        else if (k === K_FLAT) flat(reg, light, i, s, bx, by, bz)
        if (k === K_LIQUID) liquid(reg, blocks, light, i, s, bx, by, bz, (fl & F_WATER) !== 0, tiles[s * 6 + 1], tiles[s * 6 + 2], layer[s] === LAYER_TRANSLUCENT, (fl & F_EMISSIVE) !== 0)
        else if (fl & F_WATER) liquid(reg, blocks, light, i, s, bx, by, bz, true, reg.waterTop, reg.waterSide, true, false)
      }
    }
  }
  return { opaque: opaqueB.finish(), translucent: transB.finish() }
}

function cube (reg: RegistryTables, blocks: Uint16Array, light: Uint8Array, i: number, s: number, bx: number, by: number, bz: number, smooth: boolean) {
  const { flags, layer, tiles } = reg
  const fl = flags[s]
  const b = layer[s] === LAYER_TRANSLUCENT ? transB : opaqueB
  const em = fl & F_EMISSIVE ? 255 : 0
  for (let f = 0; f < 6; f++) {
    const na = F_NAXIS[f]; const sg = F_SIGN[f]
    const ni = i + sg * STRIDE[na]
    const n = blocks[ni]
    if (n !== 0) {
      const nf = flags[n]
      if (nf & F_OCCLUDES) continue
      if (n === s && (fl & F_CULL_SAME)) continue
    }
    const ua = F_UAXIS[f]; const va = F_VAXIS[f]
    const su = STRIDE[ua]; const sv = STRIDE[va]
    const tile = tiles[s * 6 + f]
    const shade = FACE_SHADE[f]
    const nl = light[ni]
    for (let c = 0; c < 4; c++) {
      const a = CORNER_A[c]; const bb = CORNER_B[c]
      let ao = 3; let sky = nl >> 4; let blk = nl & 15
      if (smooth) {
        const i1 = ni + (a ? su : -su)
        const i2 = ni + (bb ? sv : -sv)
        const i3 = i1 + (bb ? sv : -sv)
        const o1 = flags[blocks[i1]] & F_OCCLUDES
        const o2 = flags[blocks[i2]] & F_OCCLUDES
        const o3 = flags[blocks[i3]] & F_OCCLUDES
        let cnt = 1
        if (!o1) { sky += light[i1] >> 4; blk += light[i1] & 15; cnt++ }
        if (!o2) { sky += light[i2] >> 4; blk += light[i2] & 15; cnt++ }
        if (o1 && o2) ao = 0
        else {
          ao = 3 - ((o1 ? 1 : 0) + (o2 ? 1 : 0) + (o3 ? 1 : 0))
          if (!o3) { sky += light[i3] >> 4; blk += light[i3] & 15; cnt++ }
        }
        sky /= cnt; blk /= cnt
      }
      p3[na] = sg > 0 ? 1 : 0
      p3[ua] = a
      p3[va] = bb
      cAo[c] = ao
      cIdx[c] = b.vertex(bx + p3[0], by + p3[1], bz + p3[2], texU(f, p3[0], p3[1], p3[2]), texV(f, p3[0], p3[1], p3[2]), tile,
        AO_CURVE[ao] * shade * 255, sky * 17, blk * 17, em)
    }
    b.quad(cIdx[0], cIdx[1], cIdx[2], cIdx[3], cAo[0] + cAo[2] < cAo[1] + cAo[3])
  }
}

function boxes (reg: RegistryTables, blocks: Uint16Array, light: Uint8Array, i: number, s: number, bx: number, by: number, bz: number) {
  const { flags, layer, tiles, boxData } = reg
  const b = layer[s] === LAYER_TRANSLUCENT ? transB : opaqueB
  const em = flags[s] & F_EMISSIVE ? 255 : 0
  const own = light[i]
  const off = reg.boxOffset[s] * 6
  const count = reg.boxCount[s]
  for (let n = 0; n < count; n++) {
    const o = off + n * 6
    lo[0] = boxData[o]; lo[1] = boxData[o + 1]; lo[2] = boxData[o + 2]
    hi[0] = boxData[o + 3]; hi[1] = boxData[o + 4]; hi[2] = boxData[o + 5]
    for (let f = 0; f < 6; f++) {
      const na = F_NAXIS[f]; const sg = F_SIGN[f]
      const plane = sg > 0 ? hi[na] : lo[na]
      let l = own
      if ((sg > 0 && plane >= 1) || (sg < 0 && plane <= 0)) {
        const ni = i + sg * STRIDE[na]
        if (flags[blocks[ni]] & F_OCCLUDES) continue
        l = light[ni]
      }
      // light inside partial blocks is often stored as 0; borrow from the brightest neighbour
      if (l === 0 || (own === 0 && l === own)) l = brightest(light, i)
      const ua = F_UAXIS[f]; const va = F_VAXIS[f]
      const tile = tiles[s * 6 + f]
      const shade = FACE_SHADE[f] * 255
      for (let c = 0; c < 4; c++) {
        p3[na] = plane
        p3[ua] = CORNER_A[c] ? hi[ua] : lo[ua]
        p3[va] = CORNER_B[c] ? hi[va] : lo[va]
        cIdx[c] = b.vertex(bx + p3[0], by + p3[1], bz + p3[2], texU(f, p3[0], p3[1], p3[2]), texV(f, p3[0], p3[1], p3[2]), tile,
          shade, (l >> 4) * 17, (l & 15) * 17, em)
      }
      b.quad(cIdx[0], cIdx[1], cIdx[2], cIdx[3], false)
    }
  }
}

function brightest (light: Uint8Array, i: number): number {
  let sky = light[i] >> 4; let blk = light[i] & 15
  for (let a = 0; a < 3; a++) {
    const l1 = light[i + STRIDE[a]]; const l2 = light[i - STRIDE[a]]
    sky = Math.max(sky, l1 >> 4, l2 >> 4); blk = Math.max(blk, l1 & 15, l2 & 15)
  }
  return (sky << 4) | blk
}

function cross (reg: RegistryTables, light: Uint8Array, i: number, s: number, bx: number, by: number, bz: number) {
  const b = opaqueB
  const tile = reg.tiles[s * 6 + 2]
  const em = reg.flags[s] & F_EMISSIVE ? 255 : 0
  const l = brightest(light, i)
  const sky = (l >> 4) * 17; const blk = (l & 15) * 17
  const a = 0.146; const c = 0.854
  // diagonal 1
  let v0 = b.vertex(bx + a, by, bz + a, 0, 1, tile, 235, sky, blk, em)
  let v1 = b.vertex(bx + c, by, bz + c, 1, 1, tile, 235, sky, blk, em)
  let v2 = b.vertex(bx + c, by + 1, bz + c, 1, 0, tile, 235, sky, blk, em)
  let v3 = b.vertex(bx + a, by + 1, bz + a, 0, 0, tile, 235, sky, blk, em)
  b.quad(v0, v1, v2, v3, false, true)
  // diagonal 2
  v0 = b.vertex(bx + a, by, bz + c, 0, 1, tile, 215, sky, blk, em)
  v1 = b.vertex(bx + c, by, bz + a, 1, 1, tile, 215, sky, blk, em)
  v2 = b.vertex(bx + c, by + 1, bz + a, 1, 0, tile, 215, sky, blk, em)
  v3 = b.vertex(bx + a, by + 1, bz + c, 0, 0, tile, 215, sky, blk, em)
  b.quad(v0, v1, v2, v3, false, true)
}

function flat (reg: RegistryTables, light: Uint8Array, i: number, s: number, bx: number, by: number, bz: number) {
  const b = opaqueB
  const tile = reg.tiles[s * 6 + 1]
  const em = reg.flags[s] & F_EMISSIVE ? 255 : 0
  const l = brightest(light, i)
  const sky = (l >> 4) * 17; const blk = (l & 15) * 17
  const y = by + 0.0625
  const v0 = b.vertex(bx, y, bz, 0, 0, tile, 255, sky, blk, em)
  const v1 = b.vertex(bx, y, bz + 1, 0, 1, tile, 255, sky, blk, em)
  const v2 = b.vertex(bx + 1, y, bz + 1, 1, 1, tile, 255, sky, blk, em)
  const v3 = b.vertex(bx + 1, y, bz, 1, 0, tile, 255, sky, blk, em)
  b.quad(v0, v1, v2, v3, false, true)
}

function liquid (reg: RegistryTables, blocks: Uint16Array, light: Uint8Array, i: number, s: number, bx: number, by: number, bz: number,
  water: boolean, topTile: number, sideTile: number, translucent: boolean, emissive: boolean) {
  const { kind, flags, liquidLevel } = reg
  const b = translucent ? transB : opaqueB
  const em = emissive ? 255 : 0
  const same = (st: number): boolean => {
    if (st === 0) return false
    if (water) return (flags[st] & F_WATER) !== 0
    return kind[st] === K_LIQUID && (flags[st] & F_WATER) === 0
  }
  const up = STRIDE[1]
  const heightAt = (ci: number): number => {
    const st = blocks[ci]
    if (!same(st)) return -1
    if (same(blocks[ci + up])) return 1
    if (kind[st] !== K_LIQUID) return 0.875 // waterlogged block
    const lv = liquidLevel[st]
    if (lv === 0) return 0.875
    if (lv >= 8) return 0.875
    return (8 - lv) / 9 * 0.95
  }
  const corner = (dx: number, dz: number): number => {
    let sum = 0; let n = 0
    for (let ox = dx - 1; ox <= dx; ox++) {
      for (let oz = dz - 1; oz <= dz; oz++) {
        const h = heightAt(i + ox + oz * PAD)
        if (h === 1) return 1
        if (h >= 0) { sum += h; n++ }
      }
    }
    return n > 0 ? sum / n : 0.875
  }
  const above = blocks[i + up]
  const full = same(above)
  const h00 = full ? 1 : corner(0, 0)
  const h10 = full ? 1 : corner(1, 0)
  const h11 = full ? 1 : corner(1, 1)
  const h01 = full ? 1 : corner(0, 1)
  let l = light[i]
  const la = light[i + up]
  l = (Math.max(l >> 4, la >> 4) << 4) | Math.max(l & 15, la & 15)
  const sky = (l >> 4) * 17; const blk = (l & 15) * 17

  if (!full && !(flags[above] & F_OCCLUDES && h00 === 1)) {
    const v0 = b.vertex(bx, by + h00, bz, 0, 0, topTile, 255, sky, blk, em)
    const v1 = b.vertex(bx, by + h01, bz + 1, 0, 1, topTile, 255, sky, blk, em)
    const v2 = b.vertex(bx + 1, by + h11, bz + 1, 1, 1, topTile, 255, sky, blk, em)
    const v3 = b.vertex(bx + 1, by + h10, bz, 1, 0, topTile, 255, sky, blk, em)
    b.quad(v0, v1, v2, v3, false, true)
  }
  const below = blocks[i - up]
  if (!same(below) && !(flags[below] & F_OCCLUDES)) {
    const v0 = b.vertex(bx, by, bz, 0, 0, topTile, 140, sky, blk, em)
    const v1 = b.vertex(bx + 1, by, bz, 1, 0, topTile, 140, sky, blk, em)
    const v2 = b.vertex(bx + 1, by, bz + 1, 1, 1, topTile, 140, sky, blk, em)
    const v3 = b.vertex(bx, by, bz + 1, 0, 1, topTile, 140, sky, blk, em)
    b.quad(v0, v1, v2, v3, false)
  }
  // sides: [di, x0,z0,hA, x1,z1,hB, shade]
  side(-PAD, bx + 1, bz, h10, bx, bz, h00, 205) // north
  side(PAD, bx, bz + 1, h01, bx + 1, bz + 1, h11, 205) // south
  side(-1, bx, bz, h00, bx, bz + 1, h01, 175) // west
  side(1, bx + 1, bz + 1, h11, bx + 1, bz, h10, 175) // east

  function side (di: number, x0: number, z0: number, hA: number, x1: number, z1: number, hB: number, shade: number) {
    const n = blocks[i + di]
    if (same(n) || (flags[n] & F_OCCLUDES)) return
    const v0 = b.vertex(x0, by, z0, 0, 1, sideTile, shade, sky, blk, em)
    const v1 = b.vertex(x1, by, z1, 1, 1, sideTile, shade, sky, blk, em)
    const v2 = b.vertex(x1, by + hB, z1, 1, 1 - hB, sideTile, shade, sky, blk, em)
    const v3 = b.vertex(x0, by + hA, z0, 0, 1 - hA, sideTile, shade, sky, blk, em)
    b.quad(v0, v1, v2, v3, false, true)
  }
}

/**
 * Assemble padded 18³ volumes from a 3×3×3 neighbourhood of sections.
 * `sections[n]` with n = (dy+1)*9 + (dz+1)*3 + (dx+1).
 */
export function assemble (
  secBlocks: (Uint16Array | null)[], secLight: (Uint8Array | number)[],
  outBlocks: Uint16Array, outLight: Uint8Array
): void {
  outBlocks.fill(0)
  for (let dy = -1; dy <= 1; dy++) {
    const y0 = dy < 0 ? 15 : 0; const y1 = dy > 0 ? 0 : 15
    for (let dz = -1; dz <= 1; dz++) {
      const z0 = dz < 0 ? 15 : 0; const z1 = dz > 0 ? 0 : 15
      for (let dx = -1; dx <= 1; dx++) {
        const x0 = dx < 0 ? 15 : 0; const x1 = dx > 0 ? 0 : 15
        const n = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1)
        const sb = secBlocks[n]
        const sl = secLight[n]
        const uniform = typeof sl === 'number' ? sl : -1
        const la = typeof sl === 'number' ? null : sl
        for (let y = dy === 0 ? 0 : y0; y <= (dy === 0 ? 15 : y1); y++) {
          const py = dy < 0 ? 0 : dy > 0 ? 17 : y + 1
          for (let z = dz === 0 ? 0 : z0; z <= (dz === 0 ? 15 : z1); z++) {
            const pz = dz < 0 ? 0 : dz > 0 ? 17 : z + 1
            const src = (y << 8) | (z << 4)
            const dst = (py * PAD + pz) * PAD
            if (dx === 0) {
              if (sb) for (let x = 0; x < 16; x++) outBlocks[dst + x + 1] = sb[src + x]
              if (la) for (let x = 0; x < 16; x++) outLight[dst + x + 1] = la[src + x]
              else for (let x = 0; x < 16; x++) outLight[dst + x + 1] = uniform
            } else {
              const px = dx < 0 ? 0 : 17
              if (sb) outBlocks[dst + px] = sb[src + x0]
              outLight[dst + px] = la ? la[src + x0] : uniform
            }
          }
        }
      }
    }
  }
}
