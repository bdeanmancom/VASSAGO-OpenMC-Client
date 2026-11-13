/** Voxel ray casting against the client world for block targeting. */
import { F_SOLID, K_AIR, K_BOXES, K_CROSS, K_CUBE, K_FLAT, K_LIQUID, type Registry } from './registry'

export interface BlockHit {
  x: number, y: number, z: number
  /** protocol face index (0 down,1 up,2 north,3 south,4 west,5 east) */
  face: number
  /** hit point relative to the block origin (0..1) */
  cx: number, cy: number, cz: number
  dist: number
  state: number
  /** selection boxes in block-local space */
  boxes: number[][]
}

const FULL = [[0, 0, 0, 1, 1, 1]]
const CROSS_BOX = [[0.15, 0, 0.15, 0.85, 0.85, 0.85]]
const FLAT_BOX = [[0, 0, 0, 1, 0.0625, 1]]

export function selectionBoxes (reg: Registry, state: number): number[][] | null {
  const k = reg.kind[state]
  if (k === K_LIQUID) return null
  if (k === K_AIR) {
    // invisible but solid blocks (barriers) are still targetable
    if (!(reg.flags[state] & F_SOLID)) return null
    return FULL
  }
  if (k === K_CUBE) return FULL
  if (k === K_CROSS) return CROSS_BOX
  if (k === K_FLAT) return FLAT_BOX
  if (k === K_BOXES) {
    const out: number[][] = []
    const off = reg.boxOffset[state] * 6
    for (let i = 0; i < reg.boxCount[state]; i++) out.push(Array.from(reg.boxData.subarray(off + i * 6, off + i * 6 + 6)))
    return out
  }
  return null
}

function rayBox (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: number[], max: number): { t: number, face: number } | null {
  let tmin = 0; let tmax = max; let face = -1
  const o = [ox, oy, oz]; const d = [dx, dy, dz]
  const negFace = [4, 0, 2]; const posFace = [5, 1, 3]
  for (let a = 0; a < 3; a++) {
    const lo = b[a]; const hi = b[a + 3]
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return null
      continue
    }
    let t1 = (lo - o[a]) / d[a]; let t2 = (hi - o[a]) / d[a]
    let f = negFace[a]
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; f = posFace[a] }
    if (t1 > tmin) { tmin = t1; face = f }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  if (face < 0) return null // started inside
  return { t: tmin, face }
}

export function raycastBlocks (
  reg: Registry, getBlock: (x: number, y: number, z: number) => number,
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number
): BlockHit | null {
  let x = Math.floor(ox); let y = Math.floor(oy); let z = Math.floor(oz)
  const stepX = dx > 0 ? 1 : -1; const stepY = dy > 0 ? 1 : -1; const stepZ = dz > 0 ? 1 : -1
  const tdx = Math.abs(1 / (dx || 1e-12)); const tdy = Math.abs(1 / (dy || 1e-12)); const tdz = Math.abs(1 / (dz || 1e-12))
  let tx = (dx > 0 ? x + 1 - ox : ox - x) * tdx
  let ty = (dy > 0 ? y + 1 - oy : oy - y) * tdy
  let tz = (dz > 0 ? z + 1 - oz : oz - z) * tdz
  let t = 0
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const state = getBlock(x, y, z)
    if (state !== 0) {
      const boxes = selectionBoxes(reg, state)
      if (boxes) {
        let best: { t: number, face: number } | null = null
        for (const b of boxes) {
          const h = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, b, maxDist)
          if (h && (!best || h.t < best.t)) best = h
        }
        if (best) {
          return {
            x, y, z, face: best.face, dist: best.t, state, boxes,
            cx: ox - x + dx * best.t, cy: oy - y + dy * best.t, cz: oz - z + dz * best.t
          }
        }
      }
    }
    if (tx < ty && tx < tz) { t = tx; tx += tdx; x += stepX } else if (ty < tz) { t = ty; ty += tdy; y += stepY } else { t = tz; tz += tdz; z += stepZ }
  }
  return null
}
