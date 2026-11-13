/**
 * Procedural tile painter — the whole block art of the client is generated here
 * from colours and patterns. Nothing is loaded from disk and no third-party
 * texture data is used; every pixel below is produced by original code.
 *
 * paintTile(key, out) fills one 16×16 RGBA tile. Keys come from materials.ts:
 *   <id>[:<arg>…][~<op>]     op bits: 1 transpose, 2 flip-x, 4 flip-y
 */
import { TILE_SIZE } from './looks'

const S = TILE_SIZE
const N = S * S * 4

export type RGB = [number, number, number]
/** Five shades, darkest → lightest; index 2 is the base colour. */
export type Ramp = RGB[]

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------
export function hexRgb (h: string): RGB {
  const n = parseInt(h.charAt(0) === '#' ? h.slice(1) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgb2hsv (c: RGB): [number, number, number] {
  const r = c[0] / 255; const g = c[1] / 255; const b = c[2] / 255
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn
  let h = 0
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + 6) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, mx <= 0 ? 0 : d / mx, mx]
}

function hsv2rgb (h: number, s: number, v: number): RGB {
  h = ((h % 360) + 360) % 360
  const c = v * s; const x = c * (1 - Math.abs((h / 60) % 2 - 1)); const m = v - c
  let r = 0; let g = 0; let b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c } else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c } else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function mix (a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
}

/**
 * Hue-shifted tone step. Negative → darker, cooler and a touch more saturated;
 * positive → lighter, warmer and less saturated. One unit is one palette step.
 */
export function tone (c: RGB, t: number): RGB {
  if (t === 0) return c
  let [h, s, v] = rgb2hsv(c)
  const a = Math.abs(t)
  const target = t < 0 ? 250 : 50
  const grey = s < 0.07
  if (grey) {
    h = target
  } else {
    const dh = ((target - h + 540) % 360) - 180
    h += Math.sign(dh) * Math.min(Math.abs(dh), (t < 0 ? 9 : 6) * a)
  }
  if (t < 0) {
    s = Math.min(1, s + (grey ? 0.035 : 0.06) * a)
    v = v * Math.pow(0.83, a)
  } else {
    s = s * Math.pow(0.84, a) + (grey ? 0.015 * a : 0)
    v = Math.min(1, v * Math.pow(1.12, a) + 0.025 * a)
  }
  return hsv2rgb(h, s, v)
}

const RAMPS = new Map<string, Ramp>()

/** Five-step ramp around a base colour; `k` scales the contrast between steps. */
export function ramp (base: string | RGB, k = 1): Ramp {
  const id = (typeof base === 'string' ? base : base.join(',')) + '|' + k
  let r = RAMPS.get(id)
  if (r === undefined) {
    const c = typeof base === 'string' ? hexRgb(base) : base
    r = [tone(c, -2 * k), tone(c, -k), c, tone(c, k), tone(c, 2 * k)]
    RAMPS.set(id, r)
  }
  return r
}

/** Ramp colour at a fractional index. */
function rc (R: Ramp, i: number): RGB {
  const last = R.length - 1
  if (i <= 0) return R[0]
  if (i >= last) return R[last]
  const f = Math.floor(i); const t = i - f
  return t < 0.02 ? R[f] : mix(R[f], R[f + 1], t)
}

const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v

// ---------------------------------------------------------------------------
// deterministic noise
// ---------------------------------------------------------------------------
export function hashStr (s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function ih (x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  h ^= h >>> 16
  h = Math.imul(h, 2246822519)
  h ^= h >>> 13
  return h >>> 0
}
/** Hash → [0,1). */
const rnd = (x: number, y: number, s: number): number => ih(x, y, s) / 4294967296
const rint = (x: number, y: number, s: number, n: number): number => Math.floor(rnd(x, y, s) * n)

/** Tileable smooth value noise with `px`×`py` lattice cells across the tile. */
function vn (x: number, y: number, px: number, py: number, s: number): number {
  const fx = (((x % S) + S) % S) * px / S; const fy = (((y % S) + S) % S) * py / S
  const x0 = Math.floor(fx); const y0 = Math.floor(fy)
  const tx = fx - x0; const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty)
  const x1 = (x0 + 1) % px; const y1 = (y0 + 1) % py
  const a = rnd(x0 % px, y0 % py, s); const b = rnd(x1, y0 % py, s)
  const c = rnd(x0 % px, y1, s); const d = rnd(x1, y1, s)
  return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy
}

// ---------------------------------------------------------------------------
// canvas (module state, saved/restored around nested paints)
// ---------------------------------------------------------------------------
let D: Uint8ClampedArray = new Uint8ClampedArray(N)
let SEED = 1

/** Set a pixel, wrapping around the tile (seamless patterns). */
function P (x: number, y: number, c: RGB, a = 255): void {
  const i = (((y & 15) << 4) | (x & 15)) << 2
  D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a
}
/** Set a pixel, clipped to the tile (sprites). */
function Q (x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || x > 15 || y < 0 || y > 15) return
  const i = ((y << 4) | x) << 2
  D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a
}
const alphaAt = (x: number, y: number): number => (x < 0 || x > 15 || y < 0 || y > 15) ? 0 : D[(((y << 4) | x) << 2) + 3]
function getPx (x: number, y: number): RGB {
  const i = (((y & 15) << 4) | (x & 15)) << 2
  return [D[i], D[i + 1], D[i + 2]]
}
function clear (): void { D.fill(0) }
function fill (c: RGB, a = 255): void { for (let i = 0; i < N; i += 4) { D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a } }
function rect (x: number, y: number, w: number, h: number, c: RGB, a = 255): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) Q(i, j, c, a)
}
function hline (x0: number, x1: number, y: number, c: RGB): void { for (let x = x0; x <= x1; x++) Q(x, y, c) }
function vline (x: number, y0: number, y1: number, c: RGB): void { for (let y = y0; y <= y1; y++) Q(x, y, c) }
function line (x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n
    Q(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c)
  }
}
/** Darken / lighten an existing pixel by a tone step. */
function shadePx (x: number, y: number, t: number): void {
  const i = (((y & 15) << 4) | (x & 15)) << 2
  if (D[i + 3] === 0) return
  const c = tone([D[i], D[i + 1], D[i + 2]], t)
  D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]
}
/** Every pixel of the tile through a callback returning a ramp index. */
function field (R: Ramp, f: (x: number, y: number) => number): void {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) P(x, y, rc(R, f(x, y)))
}

/** Stamp ASCII art: each character looks up a colour; '.' and ' ' are skipped. */
function art (rows: string[], pal: Record<string, RGB>, ox = 0, oy = 0): void {
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    for (let x = 0; x < r.length; x++) {
      const ch = r.charAt(x)
      if (ch === '.' || ch === ' ') continue
      const c = pal[ch]
      if (c !== undefined) Q(ox + x, oy + y, c)
    }
  }
}
/** Palette letters for a ramp: e.g. rp(R, 'abcde') → a = darkest … e = lightest. */
function rp (R: Ramp, letters: string, into: Record<string, RGB> = {}): Record<string, RGB> {
  for (let i = 0; i < letters.length; i++) into[letters.charAt(i)] = R[Math.min(i, R.length - 1)]
  return into
}

/** Light rim on the top/left of opaque shapes and shade on the bottom/right — gives sprites volume. */
function rim (lightT = 0.7, darkT = -0.8): void {
  const src = D.slice()
  const al = (x: number, y: number): number => (x < 0 || x > 15 || y < 0 || y > 15) ? 0 : src[(((y << 4) | x) << 2) + 3]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (al(x, y) === 0) continue
      const openTL = al(x - 1, y) === 0 || al(x, y - 1) === 0
      const openBR = al(x + 1, y) === 0 || al(x, y + 1) === 0
      if (openBR && !openTL) shadePx(x, y, darkT)
      else if (openTL && !openBR) shadePx(x, y, lightT)
    }
  }
}

// ---------------------------------------------------------------------------
// reusable patterns
// ---------------------------------------------------------------------------
interface TexOpt { p?: number, q?: number, py?: number, qy?: number, gain?: number, lit?: number, jit?: number, s?: number, bias?: number, lo?: number, hi?: number, step?: number }

/** Soft clumpy relief: smooth noise quantised to the ramp with a top-left light. */
function texFn (o: TexOpt = {}): (x: number, y: number) => number {
  const p = o.p ?? 4; const q = o.q ?? 8; const py = o.py ?? p; const qy = o.qy ?? q
  const gain = o.gain ?? 3; const lit = o.lit ?? 2.5; const jit = o.jit ?? 0.4; const s = o.s ?? SEED; const bias = o.bias ?? 0
  const lo = o.lo ?? 0; const hi = o.hi ?? 4; const step = o.step ?? 1
  const n = (x: number, y: number): number => vn(x, y, p, py, s) * 0.62 + vn(x, y, q, qy, s + 11) * 0.38
  return (x, y) => {
    const v = n(x, y)
    const i = 2 + bias + (v - 0.5) * gain + (v - n(x + 1, y + 1)) * lit + (rnd(x & 15, y & 15, s + 5) - 0.5) * jit
    return clamp(Math.round(i / step) * step, lo, hi)
  }
}
function tex (R: Ramp, o: TexOpt = {}): void { field(R, texFn(o)) }

/** Short horizontal cracks with a lit lower lip. */
function cracks (R: Ramp, n: number, s = SEED, dark = 1, light = 3): void {
  for (let i = 0; i < n; i++) {
    const x0 = rint(i, 0, s + 31, 16); const y0 = rint(i, 1, s + 31, 16); const len = 2 + rint(i, 2, s + 31, 4)
    const bend = rint(i, 3, s + 31, 3)
    for (let k = 0; k < len; k++) {
      const y = y0 + (k >= bend + 1 ? 1 : 0)
      P(x0 + k, y, R[dark])
      P(x0 + k, y + 1, R[light])
    }
  }
}

/** Scatter single-pixel specks of a ramp index. */
function specks (R: Ramp, n: number, idx: number, s = SEED): void {
  for (let i = 0; i < n; i++) P(rint(i, 0, s + 77 + idx, 16), rint(i, 1, s + 77 + idx, 16), R[idx])
}

interface CobOpt { n?: number, s?: number, gap?: number, jitter?: number, mortar?: RGB, tones?: number[], lightK?: number }

/** Rounded stones: toroidal Voronoi cells with dark joints and a top-left light on each stone. */
function cobble (R: Ramp, o: CobOpt = {}): void {
  const n = o.n ?? 3; const s = o.s ?? SEED; const gap = o.gap ?? 1; const jit = o.jitter ?? 0.6
  const tones = o.tones ?? [1.5, 2, 2, 2.5, 3]
  const cell = S / n
  const pts: number[][] = []
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      pts.push([
        (gx + 0.5 + (gy & 1) * 0.5 + (rnd(gx, gy, s) - 0.5) * jit) * cell,
        (gy + 0.5 + (rnd(gx, gy, s + 1) - 0.5) * jit) * cell,
        rnd(gx, gy, s + 2),
        0.85 + rnd(gx, gy, s + 3) * 0.4
      ])
    }
  }
  const wrap = (d: number): number => d > 8 ? d - 16 : d < -8 ? d + 16 : d
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9; let d2 = 1e9; let best = pts[0]; let bdx = 0; let bdy = 0
      for (const pt of pts) {
        const dx = wrap(x + 0.5 - pt[0]); const dy = wrap(y + 0.5 - pt[1])
        const d = Math.hypot(dx / pt[3], dy * pt[3])
        if (d < d1) { d2 = d1; d1 = d; best = pt; bdx = dx; bdy = dy } else if (d < d2) d2 = d
      }
      if (d2 - d1 < gap) { P(x, y, o.mortar ?? R[0]); continue }
      const base = tones[Math.floor(best[2] * tones.length)]
      const l = -(bdx + bdy) / cell
      const k = o.lightK ?? 1
      P(x, y, rc(R, base + (l > 0.26 ? k : l < -0.3 ? -k : 0)))
    }
  }
}

interface BrickOpt { w?: number, h?: number, s?: number, mortar?: RGB, inner?: (x: number, y: number) => number, vary?: number, bevel?: number, off?: number }

/** Courses of bricks with mortar joints, per-brick tone and a bevel. */
function bricks (R: Ramp, o: BrickOpt = {}): void {
  const w = o.w ?? 8; const h = o.h ?? 4; const s = o.s ?? SEED; const vary = o.vary ?? 1; const bev = o.bevel ?? 1
  const mortar = o.mortar ?? R[0]
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / h); const yy = y % h
    const off = (row & 1) === 1 ? (o.off ?? (w >> 1)) : 0
    for (let x = 0; x < S; x++) {
      const xs = (x + off) % S; const xx = xs % w; const bi = Math.floor(xs / w)
      if (yy === h - 1 || xx === w - 1) { P(x, y, mortar); continue }
      let i = (o.inner !== undefined ? o.inner(x, y) : 2) + (rint(bi, row, s + 13, 3) - 1) * 0.5 * vary
      if (yy === 0) i += 0.7 * bev
      else if (yy === h - 2 && h > 3) i -= 0.7 * bev
      if (xx === 0) i += 0.3 * bev
      else if (xx === w - 2) i -= 0.4 * bev
      P(x, y, rc(R, i))
    }
  }
}

/** Four horizontal boards with seams, staggered butt joints and grain streaks. */
function planks (R: Ramp, o: { s?: number, grain?: number, knots?: number } = {}): void {
  const s = o.s ?? SEED; const grain = o.grain ?? 1
  for (let b = 0; b < 4; b++) {
    const y0 = b * 4
    const joint = (2 + b * 5 + rint(b, 0, s, 4)) & 15
    const boardTone = (rint(b, 7, s, 3) - 1) * 0.35
    for (let x = 0; x < S; x++) {
      const seg = (x - joint) & 15
      for (let yy = 0; yy < 4; yy++) {
        const y = y0 + yy
        let i: number
        if (yy === 3) i = 0.4
        else if (seg === 0) i = 0.8
        else {
          i = 2 + boardTone
          if (yy === 0) i += 0.55
          const g = rnd((x + b * 3 + yy * 7) >> 2, y, s + 3)
          if (g < 0.2) i -= 0.75 * grain
          else if (g > 0.88) i += 0.5 * grain
          if (seg === 1) i += 0.4
          else if (seg === 15) i -= 0.3
        }
        P(x, y, rc(R, i))
      }
    }
  }
  for (let k = 0; k < (o.knots ?? 0); k++) {
    const x = rint(k, 20, s, 16); const y = rint(k, 21, s, 4) * 4 + 1
    P(x, y, R[0]); P(x + 1, y, R[1]); P(x - 1, y, R[1])
  }
}

/** Vertical bark striations (noise stretched along y, lit from the left). */
function bark (R: Ramp, o: { s?: number, px?: number, py?: number, gain?: number, lit?: number } = {}): void {
  const s = o.s ?? SEED; const gx = o.px ?? 8; const gy = o.py ?? 2; const gain = o.gain ?? 5
  const f = (x: number, y: number): number => vn(x, y, gx, gy, s) * 0.7 + vn(x, y, 5, 4, s + 9) * 0.3
  field(R, (x, y) => {
    const v = f(x, y)
    return clamp(Math.round(2 + (v - 0.5) * gain + (v - f(x + 1, y)) * (o.lit ?? 3)), 0, 4)
  })
}

/** Log end: bark rim around concentric growth rings. */
function rings (Rb: Ramp, Rw: Ramp, o: { s?: number, rimOnly?: boolean } = {}): void {
  const s = o.s ?? SEED
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5; const dy = y - 7.5
      const m = Math.max(Math.abs(dx), Math.abs(dy))
      if (m > 6.6) {
        const edge = (x === 0 || y === 0) ? 0.6 : (x === 15 || y === 15) ? -0.7 : 0
        P(x, y, rc(Rb, 1.6 + edge + (rnd(x, y, s) < 0.3 ? -0.8 : 0)))
        continue
      }
      const r = m * 0.5 + Math.hypot(dx, dy) * 0.5
      let i: number
      if (m > 5.6) i = 3
      else if (r < 1) i = 1
      else i = (Math.floor(r / 1.5 + 0.35) & 1) === 1 ? 1.5 : 2.5
      if (rnd(x, y, s + 4) < 0.12) i -= 0.5
      P(x, y, rc(Rw, i))
    }
  }
}

/** Leaf canopy: lit clumps separated by see-through gaps. */
function leaves (R: Ramp, o: { s?: number, p?: number, hole?: number, gain?: number } = {}): void {
  const s = o.s ?? SEED; const p = o.p ?? 5; const hole = o.hole ?? 0.36
  const n = (x: number, y: number): number =>
    vn(x, y, p, p, s) * 0.7 + vn(x, y, p * 2, p * 2, s + 3) * 0.3 + (rnd(x & 15, y & 15, s + 5) - 0.5) * 0.1
  clear()
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n(x, y)
      if (v < hole) continue
      let i = 1 + (v - hole) / (1 - hole) * (o.gain ?? 3.2) + (v - n(x + 1, y + 1)) * 4
      if (n(x - 1, y - 1) < hole) i += 0.8
      if (n(x + 1, y + 1) < hole) i -= 0.9
      P(x, y, R[clamp(Math.round(i), 0, 4)])
    }
  }
}

/** One-pixel (or wider) bevel: light top/left, dark bottom/right. */
function bevel (R: Ramp, w = 1, hi = 3.5, lo = 0.5): void {
  for (let k = 0; k < w; k++) {
    for (let t = k; t < S - k; t++) {
      P(t, k, rc(R, hi)); P(k, t, rc(R, hi))
    }
    for (let t = k; t < S - k; t++) {
      P(t, 15 - k, rc(R, lo)); P(15 - k, t, rc(R, lo))
    }
    P(15 - k, k, R[2]); P(k, 15 - k, R[2])
  }
}

/** Rectangular outline. */
function frame (x: number, y: number, w: number, h: number, c: RGB): void {
  hline(x, x + w - 1, y, c); hline(x, x + w - 1, y + h - 1, c); vline(x, y, y + h - 1, c); vline(x + w - 1, y, y + h - 1, c)
}
/** Inset panel: dark top/left inner edge, light bottom/right. */
function inset (x: number, y: number, w: number, h: number, dark: RGB, light: RGB): void {
  hline(x, x + w - 1, y, dark); vline(x, y, y + h - 1, dark)
  hline(x + 1, x + w - 1, y + h - 1, light); vline(x + w - 1, y + 1, y + h - 1, light)
}
/** Raised panel: light top/left, dark bottom/right. */
function raised (x: number, y: number, w: number, h: number, light: RGB, dark: RGB): void {
  hline(x, x + w - 1, y, light); vline(x, y, y + h - 1, light)
  hline(x + 1, x + w - 1, y + h - 1, dark); vline(x + w - 1, y + 1, y + h - 1, dark)
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------
type Painter = (args: string[]) => void
const U = new Map<string, Painter>()
const F = new Map<string, Painter>()
const def = (key: string, p: Painter): void => { U.set(key, p) }
const fam = (id: string, p: Painter): void => { F.set(id, p) }

/** True when a tile with exactly this key is registered (used to auto-assemble plain cubes). */
export function hasTile (key: string): boolean { return U.has(key) }

/** True when the key resolves to a dedicated painter (exact or family). */
export function hasPainter (key: string): boolean {
  const k = stripOp(key)[0]
  if (U.has(k)) return true
  const f = F.get(k.split(':')[0])
  return f !== undefined
}

function stripOp (key: string): [string, number] {
  const t = key.lastIndexOf('~')
  if (t < 0) return [key, 0]
  return [key.slice(0, t), Number(key.slice(t + 1)) | 0]
}

// ---------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------
export const DYE: Record<string, string> = {
  white: '#e6e9e9',
  orange: '#ec7c1e',
  magenta: '#c04fb6',
  light_blue: '#4eb4de',
  yellow: '#f4c934',
  lime: '#7ac230',
  pink: '#ee8fae',
  gray: '#484e53',
  light_gray: '#9b9b95',
  cyan: '#1a989e',
  purple: '#8239b6',
  blue: '#3a45ae',
  brown: '#7a4f2d',
  green: '#5b7a1e',
  red: '#b5302a',
  black: '#202026'
}
export const DYE_NAMES: string[] = Object.keys(DYE)

interface Wood { planks: string, bark: string, inner: string, leaf: string }
export const WOOD: Record<string, Wood> = {
  oak: { planks: '#b28e54', bark: '#6a5233', inner: '#b89a60', leaf: '#4b8f33' },
  spruce: { planks: '#7b5a35', bark: '#3f2d1b', inner: '#7e6039', leaf: '#3c6b4b' },
  birch: { planks: '#d4c489', bark: '#e2dfd5', inner: '#ccb87a', leaf: '#77a44a' },
  jungle: { planks: '#ae7d57', bark: '#5c4a24', inner: '#b2875b', leaf: '#3e9e2d' },
  acacia: { planks: '#b65f30', bark: '#6b635a', inner: '#b8623b', leaf: '#7b9a36' },
  dark_oak: { planks: '#4e331a', bark: '#3a2a17', inner: '#5b4024', leaf: '#356d2b' },
  mangrove: { planks: '#7b3b35', bark: '#5b4a31', inner: '#7d3d38', leaf: '#5a9a3b' },
  cherry: { planks: '#e4b6ae', bark: '#3b2331', inner: '#deaaa6', leaf: '#f0a6c6' },
  pale_oak: { planks: '#e6dbd4', bark: '#5e5751', inner: '#eae2da', leaf: '#8c9389' },
  bamboo: { planks: '#cbb24f', bark: '#86a03a', inner: '#d1bb59', leaf: '#6a9a30' },
  crimson: { planks: '#7d3a55', bark: '#5b2a3f', inner: '#893f5d', leaf: '#8a1a1a' },
  warped: { planks: '#2e7f75', bark: '#3e2d49', inner: '#3a8e85', leaf: '#178a82' }
}
export const WOOD_NAMES: string[] = Object.keys(WOOD)

const hx = hexRgb
const dyeRamp = (d: string, k = 1): Ramp => ramp(DYE[d] ?? '#9a9a9a', k)
const woodOf = (w: string): Wood => WOOD[w] ?? WOOD.oak

const C_DIRT = '#89623f'
const C_GRASS = '#69a847'
const C_STONE = '#7f8286'
const C_DEEP = '#4e4e55'
const C_NETHER = '#6f2f30'
const C_BLACK = '#2c2830'
const C_SNOW = '#f0f6f8'
const C_IRON = '#d5d5d2'
const C_GOLD = '#f2c53a'
const C_WATER = '#2e62cc'

// ---------------------------------------------------------------------------
// terrain
// ---------------------------------------------------------------------------
function dirtBase (s = SEED, hex = C_DIRT): void {
  const R = ramp(hex, 0.85)
  tex(R, { p: 5, q: 9, gain: 3.2, lit: 2.6, s })
  specks(R, 5, 4, s); specks(R, 6, 0, s)
}
const SEED_DIRT = hashStr('dirt') | 1
const SEED_STONE = hashStr('stone') | 1

function grassTop (hex: string, s = SEED): void {
  const R = ramp(hex, 0.9)
  tex(R, { p: 4, q: 8, gain: 2.6, lit: 2.2, s })
  // blade ticks
  for (let i = 0; i < 16; i++) {
    const x = rint(i, 0, s + 41, 16); const y = rint(i, 1, s + 41, 16)
    P(x, y, R[i % 3 === 0 ? 4 : 3]); P(x, y + 1, R[1])
  }
}

/** Dirt side with a fringe hanging from the top edge. */
function fringeSide (R: Ramp, s = SEED, depth = 3): void {
  dirtBase(SEED_DIRT)
  for (let x = 0; x < S; x++) {
    const d = depth - 1 + Math.round(vn(x, 0, 6, 1, s + 2) * 2.4 + rnd(x, 0, s) * 0.8 - 0.4)
    for (let y = 0; y <= d; y++) {
      const i = y === 0 ? 3.4 : y === d ? 1 : 2 + (rnd(x, y, s + 3) < 0.25 ? 1 : 0)
      P(x, y, rc(R, i))
    }
    shadePx(x, d + 1, -0.9)
  }
}

def('none', () => tex(ramp('#808488', 0.7)))
def('dirt', () => dirtBase())
def('coarse_dirt', () => {
  const R = ramp('#775639', 0.9)
  tex(R, { p: 4, q: 7, gain: 3.6, lit: 3 })
  const G = ramp('#8d8780', 0.8)
  for (let i = 0; i < 9; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); P(x, y, G[3]); P(x + 1, y, G[2]); P(x, y + 1, G[1]) }
})
def('rooted_dirt', () => {
  dirtBase(SEED_DIRT)
  const R = ramp('#b99a78', 0.9)
  for (let i = 0; i < 5; i++) {
    let x = rint(i, 0, SEED, 16); let y = rint(i, 1, SEED, 16)
    for (let k = 0; k < 5; k++) { P(x, y, R[k === 0 ? 3 : 2]); x += rint(i, k + 2, SEED, 3) - 1; y += 1 }
  }
})
def('grass:top', () => grassTop(C_GRASS))
def('grass:side', () => fringeSide(ramp(C_GRASS, 0.9)))
def('grass:side:snowy', () => fringeSide(ramp(C_SNOW, 0.5), SEED, 4))
def('podzol:top', () => {
  const R = ramp('#6d4c24', 0.9)
  tex(R, { p: 5, q: 9, gain: 3.4, lit: 3 })
  const N2 = ramp('#8a6a2e', 0.9)
  for (let i = 0; i < 10; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); P(x, y, N2[3]); P(x + 1, y + 1, N2[2]) }
})
def('podzol:side', () => fringeSide(ramp('#6d4c24', 0.9), SEED, 2))
def('mycelium:top', () => {
  const R = ramp('#7d6a84', 0.8)
  tex(R, { p: 5, q: 9, gain: 3, lit: 2.4 })
  specks(ramp('#b8a8bc', 0.6), 9, 3)
})
def('mycelium:side', () => fringeSide(ramp('#7d6a84', 0.8), SEED, 2))
def('dirt_path:top', () => {
  const R = ramp('#9a7d44', 0.8)
  tex(R, { p: 4, q: 8, gain: 2.6, lit: 2 })
  for (let i = 0; i < 16; i++) { P(i, 0, rc(R, 3.2)); P(0, i, rc(R, 3)); P(i, 15, rc(R, 1.2)); P(15, i, rc(R, 1.2)) }
})
def('dirt_path:side', () => fringeSide(ramp('#9a7d44', 0.8), SEED, 1))
function farmland (wet: boolean): void {
  const R = ramp(wet ? '#523420' : '#7a5433', 0.9)
  field(R, (x, y) => {
    const furrow = y & 3
    const base = furrow === 0 ? 3 : furrow === 3 ? 0.6 : furrow === 1 ? 2.3 : 1.6
    return base + (rnd(x, y, SEED) < 0.18 ? -0.7 : 0) + (rnd(x >> 1, y, SEED + 1) > 0.85 ? 0.5 : 0)
  })
}
def('farmland', () => farmland(false))
def('farmland:wet', () => farmland(true))
def('mud', () => {
  const R = ramp('#3f3b41', 0.8)
  tex(R, { p: 3, q: 6, gain: 2.6, lit: 4 })
  specks(R, 6, 4)
})
def('packed_mud', () => {
  const R = ramp('#8f6b51', 0.8)
  tex(R, { p: 4, q: 8, gain: 2.2, lit: 2 })
  const St = ramp('#b99a6a', 0.7)
  for (let i = 0; i < 7; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); P(x, y, St[3]); P(x + 1, y, St[2]) }
})
def('clay', () => tex(ramp('#a0a7b5', 0.6), { p: 3, q: 6, gain: 2.2, lit: 2 }))
function sandBase (hex: string, s = SEED): void {
  const R = ramp(hex, 0.6)
  field(R, (x, y) => {
    const ripple = vn(x + y * 0.5, y, 4, 5, s)
    return clamp(Math.round(2 + (ripple - 0.5) * 2.4 + (rnd(x, y, s + 1) - 0.5) * 1.3), 1, 3)
  })
  specks(R, 7, 0, s); specks(R, 6, 4, s)
}
def('sand', () => sandBase('#dccf9f'))
def('red_sand', () => sandBase('#bf6a2e'))
def('suspicious_sand', () => {
  sandBase('#dccf9f', hashStr('sand') | 1)
  const R = ramp('#b9a878', 0.8)
  art(['.aa..', 'a..a.', '..a..', '.....', '..a..'], { a: R[1] }, 5, 5)
})
def('gravel', () => {
  const A = ramp('#85817c', 0.9)
  cobble(A, { n: 5, gap: 0.55, jitter: 0.9, tones: [1, 1.6, 2, 2.4, 3, 3.4], mortar: A[0], lightK: 0.7 })
  const B = ramp('#8f7a68', 0.9)
  for (let i = 0; i < 12; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); P(x, y, B[2]); P(x + 1, y, B[1]) }
})
def('suspicious_gravel', () => {
  const A = ramp('#85817c', 0.9)
  cobble(A, { n: 5, gap: 0.55, jitter: 0.9, tones: [1, 1.6, 2, 2.4, 3, 3.4], mortar: A[0], lightK: 0.7, s: hashStr('gravel') | 1 })
  art(['.aa..', 'a..a.', '..a..', '.....', '..a..'], { a: A[0] }, 5, 5)
})
def('snow', () => {
  const R = ramp(C_SNOW, 0.45)
  tex(R, { p: 3, q: 6, gain: 2.2, lit: 2, jit: 0.2, lo: 1, hi: 4 })
})
def('powder_snow', () => {
  const R = ramp('#f4f9fb', 0.5)
  tex(R, { p: 6, q: 11, gain: 3, lit: 2.4, jit: 0.8, lo: 1, hi: 4 })
})
function iceTile (hex: string, alpha: number, streaks: number): void {
  const R = ramp(hex, 0.7)
  field(R, (x, y) => clamp(Math.round(2 + (vn(x, y, 3, 3, SEED) - 0.5) * 2.2), 1, 3))
  if (alpha < 255) for (let i = 3; i < N; i += 4) D[i] = alpha
  for (let i = 0; i < streaks; i++) {
    const x0 = rint(i, 0, SEED + 3, 16); const y0 = rint(i, 1, SEED + 3, 16); const len = 3 + rint(i, 2, SEED + 3, 4)
    for (let k = 0; k < len; k++) P(x0 + k, y0 - k, R[4], Math.min(255, alpha + 50))
  }
}
def('ice', () => iceTile('#8fb6f2', 165, 4))
def('ice:frosted', () => iceTile('#a8c8f6', 175, 7))
def('packed_ice', () => { iceTile('#8aabe6', 255, 3); cracks(ramp('#8aabe6', 0.7), 3) })
def('blue_ice', () => {
  const R = ramp('#6d9ce8', 0.7)
  field(R, (x, y) => clamp(Math.round(2 + (vn(x, y + x * 0.5, 3, 4, SEED) - 0.5) * 3), 1, 3))
  for (let i = 0; i < 3; i++) { const x0 = rint(i, 0, SEED, 16); const y0 = rint(i, 1, SEED, 16); for (let k = 0; k < 4; k++) P(x0 + k, y0 - k, R[4]) }
})
function mossBase (hex: string, s = SEED): void {
  const R = ramp(hex, 0.9)
  tex(R, { p: 5, q: 10, gain: 3.4, lit: 3, s })
  specks(R, 8, 4, s)
}
def('moss_block', () => mossBase('#5b7c2d'))
def('pale_moss_block', () => mossBase('#8b9188'))
def('pale_moss_carpet:side', () => {
  const R = ramp('#8b9188', 0.9)
  clear()
  for (let x = 0; x < S; x++) {
    const top = Math.round(1 + vn(x, 0, 5, 1, SEED) * 5 + rnd(x, 1, SEED) * 2)
    for (let y = top; y < S; y++) P(x, y, R[clamp(Math.round(texFn({ p: 5, q: 10, gain: 3.4 })(x, y)), 1, 4)])
    P(x, top, R[4])
  }
})

// water / lava -----------------------------------------------------------------
function waterTile (flow: boolean): void {
  const R = ramp(C_WATER, 0.75)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = flow ? vn(x, y, 6, 2, SEED) : vn(x, y, 2, 5, SEED)
      const w = flow ? vn(x, y, 8, 3, SEED + 5) : vn(x + y * 0.4, y, 4, 8, SEED + 5)
      let i = 2 + (v - 0.5) * 2.2
      let a = 172
      if (w > 0.7) { i += 1; a = 190 } else if (w < 0.24) i -= 0.6
      P(x, y, R[clamp(Math.round(i), 1, 4)], a)
    }
  }
}
def('water', () => waterTile(false))
def('water:flow', () => waterTile(true))
function lavaTile (flow: boolean): void {
  const R: Ramp = [hx('#8a1c08'), hx('#c63a0a'), hx('#e8690e'), hx('#f79a1c'), hx('#fdd34a')]
  const f = (x: number, y: number): number => flow
    ? vn(x, y, 5, 2, SEED) * 0.65 + vn(x, y, 8, 4, SEED + 2) * 0.35
    : vn(x, y, 3, 3, SEED) * 0.65 + vn(x, y, 6, 6, SEED + 2) * 0.35
  field(R, (x, y) => clamp(Math.round((f(x, y) - 0.5) * 7 + 2.1), 0, 4))
}
def('lava', () => lavaTile(false))
def('lava:flow', () => lavaTile(true))

// ---------------------------------------------------------------------------
// stone
// ---------------------------------------------------------------------------
function stoneBase (hex: string, s = SEED, o: TexOpt = {}, nCracks = 4, k = 0.75): Ramp {
  const R = ramp(hex, k)
  tex(R, { p: 3, q: 6, gain: 2.6, lit: 2.2, s, ...o })
  cracks(R, nCracks, s)
  return R
}
function polished (hex: string, k = 0.7): Ramp {
  const R = ramp(hex, k)
  tex(R, { p: 3, q: 5, gain: 1.6, lit: 1.2, jit: 0.3, lo: 1, hi: 3 })
  bevel(R, 1, 3.4, 0.9)
  return R
}
function speckled (hex: string, speck: string, n: number, k = 0.75): void {
  const R = ramp(hex, k)
  tex(R, { p: 5, q: 9, gain: 3, lit: 2.4, jit: 0.9 })
  const Sp = ramp(speck, 0.8)
  for (let i = 0; i < n; i++) {
    const x = rint(i, 0, SEED + 9, 16); const y = rint(i, 1, SEED + 9, 16)
    P(x, y, Sp[2]); if (i % 2 === 0) P(x + 1, y, Sp[1]); if (i % 3 === 0) P(x, y + 1, Sp[3])
  }
}
/** Dark crack polylines across a finished tile. */
function crackLines (c: RGB, n: number, s = SEED): void {
  for (let i = 0; i < n; i++) {
    let x = rint(i, 0, s + 61, 16); let y = rint(i, 1, s + 61, 6)
    const len = 6 + rint(i, 2, s + 61, 6)
    for (let k = 0; k < len; k++) {
      P(x, y, c)
      const r = rint(i, k + 3, s + 61, 4)
      if (r === 0) x--; else if (r === 1) x++
      y++
    }
  }
}
/** Moss patches creeping over a finished tile. */
function mossOver (amount: number, s = SEED): void {
  const R = ramp('#5f8030', 0.9)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = vn(x, y, 3, 3, s + 71) * 0.7 + vn(x, y, 7, 7, s + 72) * 0.3
      if (v > 1 - amount) P(x, y, R[clamp(Math.round(1 + (v - (1 - amount)) * 14 + (rnd(x, y, s) - 0.4)), 1, 4)])
    }
  }
}
/** Square carved ornament used by chiseled blocks. */
function chiselMotif (R: Ramp, style = 0): void {
  bevel(R, 1, 3.4, 0.8)
  inset(3, 3, 10, 10, R[0], R[4])
  if (style === 0) {
    inset(6, 6, 4, 4, R[4], R[0])
    P(7, 7, R[1]); P(8, 7, R[1]); P(7, 8, R[1]); P(8, 8, R[2])
  } else if (style === 1) {
    art(['..aa..', '.a..a.', 'a.aa.a', 'a.aa.a', '.a..a.', '..aa..'], { a: R[0] }, 5, 5)
  } else {
    art(['a....a', '.a..a.', '..aa..', '..aa..', '.a..a.', 'a....a'], { a: R[0] }, 5, 5)
    art(['.b....', '..b...', '......', '......', '......', '......'], { b: R[4] }, 6, 5)
  }
}

def('stone', () => { stoneBase(C_STONE) })
def('smooth_stone', () => {
  const R = ramp('#9c9ea1', 0.6)
  tex(R, { p: 3, q: 5, gain: 1.5, lit: 1, jit: 0.3, lo: 1, hi: 3 })
  frame(0, 0, 16, 16, R[1]); hline(1, 14, 1, R[3]); vline(1, 1, 14, R[3])
})
def('smooth_stone_slab:side', () => {
  const R = ramp('#9c9ea1', 0.6)
  tex(R, { p: 3, q: 5, gain: 1.5, lit: 1, jit: 0.3, lo: 1, hi: 3 })
  for (let x = 0; x < S; x++) { P(x, 0, R[3]); P(x, 7, R[1]); P(x, 8, R[3]); P(x, 15, R[1]) }
})
def('granite', () => speckled('#9c6c59', '#5c3a34', 16))
def('polished_granite', () => { polished('#a06f5c'); const Sp = ramp('#6a443c'); for (let i = 0; i < 8; i++) P(2 + rint(i, 0, SEED, 12), 2 + rint(i, 1, SEED, 12), Sp[2]) })
def('diorite', () => speckled('#c3c3c5', '#75777c', 18, 0.6))
def('polished_diorite', () => { polished('#c9c9cb', 0.55); const Sp = ramp('#84868b'); for (let i = 0; i < 9; i++) P(2 + rint(i, 0, SEED, 12), 2 + rint(i, 1, SEED, 12), Sp[2]) })
def('andesite', () => speckled('#878a87', '#a9aba8', 12, 0.7))
def('polished_andesite', () => { polished('#8a8d8a', 0.6); const Sp = ramp('#a9aba8'); for (let i = 0; i < 7; i++) P(2 + rint(i, 0, SEED, 12), 2 + rint(i, 1, SEED, 12), Sp[2]) })
def('cobblestone', () => cobble(ramp('#85878a', 0.85), { n: 3, gap: 1.05 }))
def('mossy_cobblestone', () => { cobble(ramp('#85878a', 0.85), { n: 3, gap: 1.05, s: hashStr('cobblestone') | 1 }); mossOver(0.42) })
def('bedrock', () => cobble(ramp('#57575c', 1.1), { n: 4, gap: 0.5, jitter: 1, tones: [0.6, 1.2, 2, 2.8, 3.6], lightK: 0.6 }))

function stoneBricks (hex: string, k = 0.75, s = SEED): Ramp {
  const R = ramp(hex, k)
  bricks(R, { w: 8, h: 8, s, inner: texFn({ p: 4, q: 7, gain: 1.6, lit: 1, lo: 1, hi: 3, s }), mortar: tone(R[0], -0.3), bevel: 1.1, vary: 0.8 })
  return R
}
def('stone_bricks', () => { stoneBricks('#7b7e82') })
def('mossy_stone_bricks', () => { stoneBricks('#7b7e82', 0.75, hashStr('stone_bricks') | 1); mossOver(0.36) })
def('cracked_stone_bricks', () => { const R = stoneBricks('#7b7e82', 0.75, hashStr('stone_bricks') | 1); crackLines(tone(R[0], -0.4), 3) })
def('chiseled_stone_bricks', () => { const R = ramp('#7b7e82', 0.75); tex(R, { gain: 1.6, lo: 1, hi: 3 }); chiselMotif(R, 0) })

function clayBricks (hex: string, mortar: string, k = 0.85, s = SEED): Ramp {
  const R = ramp(hex, k)
  bricks(R, { w: 8, h: 4, s, mortar: hx(mortar), vary: 1.2 })
  return R
}
def('bricks', () => { clayBricks('#9b5a48', '#b3a79a') })
def('mud_bricks', () => { const R = ramp('#8d6b53', 0.8); bricks(R, { w: 8, h: 8, inner: texFn({ gain: 1.4, lo: 1, hi: 3 }), mortar: R[0], vary: 0.8 }) })
def('nether_bricks', () => { clayBricks('#31191f', '#170b0f', 1) })
def('cracked_nether_bricks', () => { clayBricks('#31191f', '#170b0f', 1, hashStr('nether_bricks') | 1); crackLines(hx('#0e0609'), 3) })
def('chiseled_nether_bricks', () => { const R = ramp('#31191f', 1); tex(R, { gain: 1.6, lo: 1, hi: 3 }); chiselMotif(R, 1) })
def('red_nether_bricks', () => { clayBricks('#4e1116', '#2a070a', 1) })
def('resin_bricks', () => { clayBricks('#e2701f', '#a2440f', 0.8) })
def('chiseled_resin_bricks', () => { const R = ramp('#e2701f', 0.8); tex(R, { gain: 1.4, lo: 1, hi: 3 }); chiselMotif(R, 2) })
def('resin_block', () => { const R = ramp('#e8751f', 0.8); tex(R, { p: 3, q: 6, gain: 2.4, lit: 3 }); specks(R, 6, 4) })
def('end_stone', () => cobble(ramp('#dadb9d', 0.6), { n: 4, gap: 0.7, tones: [1.6, 2, 2, 2.4, 2.8], lightK: 0.8 }))
def('end_stone_bricks', () => { const R = ramp('#dbdc9f', 0.6); bricks(R, { w: 8, h: 8, inner: texFn({ gain: 1.5, lo: 1, hi: 3 }), mortar: R[0], vary: 0.6 }) })
def('purpur_block', () => { const R = ramp('#a77ba7', 0.7); bricks(R, { w: 8, h: 8, off: 0, inner: texFn({ gain: 1.5, lo: 1, hi: 3 }), mortar: R[1], vary: 1 }) })
function fluted (R: Ramp, cap = 0): void {
  field(R, (x) => [1, 2.4, 3.2, 2][x & 3])
  for (let y = 0; y < cap; y++) for (let x = 0; x < S; x++) { P(x, y, rc(R, y === 0 ? 3.4 : y === cap - 1 ? 1 : 2.4)); P(x, 15 - y, rc(R, y === 0 ? 1 : y === cap - 1 ? 3.2 : 2.2)) }
}
function concentric (R: Ramp, s = SEED): void {
  field(R, (x, y) => {
    const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
    return [2.6, 1.4, 2.4, 3, 1.6, 2.4, 3.2, 1.2][Math.floor(m)] + (rnd(x, y, s) < 0.1 ? -0.4 : 0)
  })
}
def('purpur_pillar', () => fluted(ramp('#a77ba7', 0.7), 0))
def('purpur_pillar:top', () => concentric(ramp('#a77ba7', 0.7)))
const C_QUARTZ = '#ebe6dd'
def('quartz_block:side', () => { const R = ramp(C_QUARTZ, 0.5); tex(R, { p: 2, q: 5, py: 6, qy: 9, gain: 1.8, lit: 1, jit: 0.2, lo: 1, hi: 3 }); for (let x = 0; x < S; x++) { P(x, 0, R[3]); P(x, 15, R[1]) } })
def('quartz_block:top', () => { const R = ramp(C_QUARTZ, 0.5); tex(R, { p: 3, q: 5, gain: 1.6, lit: 1, jit: 0.2, lo: 1, hi: 3 }); bevel(R, 1, 3.2, 1) })
def('quartz_block:bottom', () => { const R = ramp(C_QUARTZ, 0.5); tex(R, { p: 3, q: 5, gain: 1.4, lit: 1, jit: 0.2, lo: 1, hi: 3 }) })
def('chiseled_quartz_block', () => { const R = ramp(C_QUARTZ, 0.55); tex(R, { gain: 1.2, lo: 1, hi: 3, jit: 0.2 }); chiselMotif(R, 2) })
def('chiseled_quartz_block:top', () => concentric(ramp(C_QUARTZ, 0.45)))
def('quartz_pillar', () => fluted(ramp(C_QUARTZ, 0.5), 0))
def('quartz_pillar:top', () => concentric(ramp(C_QUARTZ, 0.45)))
def('quartz_bricks', () => { const R = ramp(C_QUARTZ, 0.5); bricks(R, { w: 8, h: 8, mortar: R[0], vary: 0.5, bevel: 0.8 }) })
def('prismarine', () => {
  const R = ramp('#5ea493', 0.9)
  cobble(R, { n: 4, gap: 0.8, jitter: 0.9, tones: [1, 1.6, 2, 2.6, 3.2], mortar: tone(R[0], -0.5) })
  const B = ramp('#4a7fa8', 0.8)
  for (let i = 0; i < 14; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); if (alphaAt(x, y) > 0) P(x, y, B[2 + (i & 1)]) }
})
def('prismarine_bricks', () => { const R = ramp('#62ab9c', 0.8); bricks(R, { w: 8, h: 8, off: 0, inner: texFn({ gain: 1.8, lo: 1, hi: 3 }), mortar: tone(R[0], -0.5), vary: 1 }) })
def('dark_prismarine', () => { const R = ramp('#345b4d', 0.9); bricks(R, { w: 8, h: 4, mortar: tone(R[0], -0.4), vary: 1 }) })
def('obsidian', () => { const R = ramp('#1d1626', 1.5); tex(R, { p: 3, q: 6, gain: 3.8, lit: 5 }); specks(ramp('#4a3470'), 6, 3) })
def('crying_obsidian', () => {
  const R = ramp('#19131f', 1.2)
  tex(R, { p: 3, q: 6, gain: 3.4, lit: 4, s: hashStr('obsidian') | 1 })
  const G = ramp('#8f3fe0', 0.9)
  for (let i = 0; i < 5; i++) {
    const x = rint(i, 0, SEED, 16); const y0 = rint(i, 1, SEED, 16); const len = 2 + rint(i, 2, SEED, 4)
    for (let k = 0; k < len; k++) P(x, y0 + k, G[k === 0 ? 4 : k === len - 1 ? 1 : 3])
  }
})
def('netherrack', () => { const R = ramp(C_NETHER, 1); tex(R, { p: 5, q: 9, gain: 4.4, lit: 4, jit: 0.6 }); specks(ramp('#3a1518'), 7, 2) })
def('soul_sand', () => {
  const R = ramp('#52412f', 0.9)
  tex(R, { p: 4, q: 8, gain: 3, lit: 2.6 })
  art(['aa..aa', 'aa..aa', '......', '.aaaa.', '.a..a.'], { a: R[0] }, 2, 2)
  art(['aa.aa', '.....', '.aaa.'], { a: R[0] }, 9, 10)
})
def('soul_soil', () => { const R = ramp('#4c3b30', 0.9); tex(R, { p: 2, q: 6, py: 5, qy: 9, gain: 3, lit: 2 }); specks(R, 5, 4) })
function magma (): void {
  const R = ramp('#3b1713', 1)
  cobble(R, { n: 3, gap: 1.5, jitter: 0.9, mortar: hx('#f0841a'), tones: [1, 1.5, 2, 2.4] })
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = getPx(x, y); if (c[0] > 200 && rnd(x, y, SEED) < 0.35) P(x, y, hx('#fdd04a')); else if (c[0] > 200 && rnd(x, y, SEED + 1) < 0.25) P(x, y, hx('#c64a0e')) }
}
def('magma_block', magma)
def('glowstone', () => {
  const R: Ramp = [hx('#8f5a26'), hx('#c98a3a'), hx('#ecc060'), hx('#f9de8c'), hx('#fff6cc')]
  cobble(R, { n: 4, gap: 0.75, jitter: 0.95, tones: [1.4, 2, 2.6, 3.2, 3.6], mortar: R[0], lightK: 0.8 })
})
def('sea_lantern', () => {
  const R: Ramp = [hx('#5d8f8a'), hx('#8fbdb4'), hx('#bfdcd3'), hx('#e2f3ec'), hx('#ffffff')]
  field(R, (x, y) => {
    const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
    const cell = ((x >> 2) + (y >> 2)) & 1
    return m > 7 ? 0.6 : m > 6 ? 1.6 : 2.2 + (7 - m) * 0.22 + cell * 0.5 + ((x & 3) === 0 || (y & 3) === 0 ? -0.6 : 0)
  })
})
function deepslateSide (s = SEED): Ramp {
  const R = ramp(C_DEEP, 0.85)
  const f = (x: number, y: number): number => vn(x, y, 2, 7, s) * 0.7 + vn(x, y, 5, 9, s + 9) * 0.3
  field(R, (x, y) => { const v = f(x, y); return clamp(Math.round(2 + (v - 0.5) * 4.4 + (v - f(x, y + 1)) * 3), 0, 4) })
  return R
}
def('deepslate', () => { deepslateSide() })
def('deepslate:top', () => { stoneBase(C_DEEP, SEED, { p: 4, q: 7, gain: 3 }, 3, 0.85) })
def('cobbled_deepslate', () => cobble(ramp('#55555c', 0.9), { n: 3, gap: 1.05 }))
def('polished_deepslate', () => { polished('#505057', 0.75) })
def('deepslate_bricks', () => { stoneBricks('#4f4f56', 0.8) })
def('cracked_deepslate_bricks', () => { const R = stoneBricks('#4f4f56', 0.8, hashStr('deepslate_bricks') | 1); crackLines(tone(R[0], -0.5), 3) })
def('deepslate_tiles', () => { const R = ramp('#3d3d44', 0.85); bricks(R, { w: 8, h: 4, mortar: tone(R[0], -0.4), vary: 0.8 }) })
def('cracked_deepslate_tiles', () => { const R = ramp('#3d3d44', 0.85); bricks(R, { w: 8, h: 4, mortar: tone(R[0], -0.4), vary: 0.8, s: hashStr('deepslate_tiles') | 1 }); crackLines(tone(R[0], -0.6), 3) })
def('chiseled_deepslate', () => { const R = ramp('#4f4f56', 0.8); tex(R, { gain: 1.6, lo: 1, hi: 3 }); chiselMotif(R, 1) })
def('reinforced_deepslate:side', () => {
  const R = deepslateSide(hashStr('deepslate') | 1)
  const L = ramp('#8a9088', 0.8)
  frame(0, 0, 16, 16, L[1]); frame(1, 1, 14, 14, L[3]); frame(2, 2, 12, 12, R[0])
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) { P(x, y, L[4]) }
})
def('reinforced_deepslate:top', () => {
  const R = ramp(C_DEEP, 0.85); tex(R, { gain: 2.4 })
  const L = ramp('#8a9088', 0.8)
  frame(0, 0, 16, 16, L[1]); frame(1, 1, 14, 14, L[3]); frame(2, 2, 12, 12, R[0])
  rect(6, 6, 4, 4, L[2]); inset(6, 6, 4, 4, L[4], L[0])
})
def('reinforced_deepslate:bottom', () => { stoneBase(C_DEEP, hashStr('deepslate:top') | 1, { p: 4, q: 7, gain: 3 }, 3, 0.85) })
const C_TUFF = '#6e7069'
def('tuff', () => { const R = stoneBase(C_TUFF, SEED, { p: 4, q: 8, gain: 3 }, 2); specks(R, 8, 0); specks(R, 5, 4) })
def('polished_tuff', () => { polished('#737670') })
def('tuff_bricks', () => { stoneBricks('#727570', 0.7) })
def('chiseled_tuff', () => { const R = ramp('#727570', 0.7); tex(R, { gain: 1.6, lo: 1, hi: 3 }); chiselMotif(R, 2) })
def('chiseled_tuff:top', () => { polished('#737670') })
def('chiseled_tuff_bricks', () => { const R = stoneBricks('#727570', 0.7, hashStr('tuff_bricks') | 1); for (let x = 0; x < S; x++) { P(x, 7, R[0]); P(x, 8, R[4]) }; art(['a.a.a.a.a.a.a.a.'], { a: R[0] }, 0, 4); art(['.a.a.a.a.a.a.a.a'], { a: R[0] }, 0, 11) })
def('chiseled_tuff_bricks:top', () => { stoneBricks('#727570', 0.7, hashStr('tuff_bricks') | 1) })
def('calcite', () => {
  const R = ramp('#dfe0dc', 0.5)
  field(R, (x, y) => clamp(Math.round(2 + (vn(x + y, y, 4, 6, SEED) - 0.5) * 3 + (rnd(x, y, SEED) - 0.5) * 0.6), 1, 3))
  specks(R, 5, 4)
})
def('dripstone_block', () => { const R = ramp('#866a5a', 0.9); tex(R, { p: 5, q: 9, gain: 3.8, lit: 3.4 }); specks(R, 6, 0) })
def('basalt', () => bark(ramp('#4e4e55', 0.85), { px: 6, py: 2, gain: 4.4 }))
def('basalt:top', () => { const R = ramp('#55555b', 0.85); tex(R, { p: 4, q: 8, gain: 3.4, lit: 3 }); frame(0, 0, 16, 16, R[1]) })
def('polished_basalt', () => { const R = ramp('#5a5a61', 0.75); bark(R, { px: 4, py: 1, gain: 2.6, lit: 1.5 }); vline(0, 0, 15, R[3]); vline(15, 0, 15, R[1]) })
def('polished_basalt:top', () => concentric(ramp('#5a5a61', 0.65)))
def('smooth_basalt', () => { const R = ramp('#49484e', 0.75); tex(R, { p: 3, q: 6, gain: 2.4, lit: 2 }); specks(R, 5, 4) })
function blackstone (s = SEED): Ramp { const R = stoneBase(C_BLACK, s, { p: 4, q: 7, gain: 3.4, lit: 3 }, 3, 1); specks(R, 5, 4, s); return R }
def('blackstone', () => { blackstone() })
def('blackstone:top', () => { blackstone() })
def('polished_blackstone', () => { polished('#33303a', 0.9) })
def('polished_blackstone_bricks', () => { stoneBricks('#322f38', 0.95) })
def('cracked_polished_blackstone_bricks', () => { const R = stoneBricks('#322f38', 0.95, hashStr('polished_blackstone_bricks') | 1); crackLines(tone(R[0], -0.6), 3) })
def('chiseled_polished_blackstone', () => { const R = ramp('#322f38', 0.95); tex(R, { gain: 1.6, lo: 1, hi: 3 }); chiselMotif(R, 0) })
def('terracotta', () => terracotta(hx('#9a5f45')))
function terracotta (c: RGB): void {
  const R = ramp(c, 0.6)
  field(R, (x, y) => clamp(Math.round((2 + (vn(x, y, 2, 6, SEED) - 0.5) * 2.4 + (rnd(x, y, SEED) - 0.5) * 0.7) * 2) / 2, 1, 3))
}
def('amethyst_block', () => amethyst())
function amethyst (s = SEED): Ramp {
  const R = ramp('#8a61c9', 0.9)
  cobble(R, { n: 3, gap: 0.55, jitter: 1, tones: [1, 1.6, 2.2, 2.8, 3.2], mortar: tone(R[4], 0.6), lightK: 0.8, s })
  return R
}
def('budding_amethyst', () => {
  const R = amethyst(hashStr('amethyst_block') | 1)
  art(['..a..', '.aba.', 'abcba', '.aba.', '..a..'], { a: R[0], b: tone(R[0], -1), c: hx('#f3d9ff') }, 5, 5)
})
def('bone_block', () => {
  const R = ramp('#ddd9c5', 0.55)
  bark(R, { px: 5, py: 2, gain: 2.6, lit: 1.6 })
  specks(R, 8, 0)
})
def('bone_block:top', () => concentric(ramp('#ddd9c5', 0.5)))
def('ancient_debris', () => {
  const R = ramp('#5f4a42', 0.9)
  field(R, (x, y) => clamp(Math.round(2 + (vn(x + y * 0.6, y, 3, 6, SEED) - 0.5) * 5), 0, 4))
  specks(ramp('#8a6a5c'), 6, 3)
})
def('ancient_debris:top', () => concentric(ramp('#6a5148', 0.9)))
def('netherite_block', () => {
  const R = ramp('#423d3f', 0.9)
  tex(R, { p: 3, q: 5, gain: 1.6, lit: 1.2, lo: 1, hi: 3 })
  bevel(R, 1, 3.6, 0.4)
  inset(3, 3, 10, 10, R[0], R[3])
  hline(5, 10, 7, R[3]); hline(5, 10, 8, R[0])
})
def('lodestone:side', () => {
  const R = ramp('#7b7e82', 0.75); tex(R, { gain: 1.6, lo: 1, hi: 3 }); chiselMotif(R, 0)
  const I = ramp('#b8473c'); rect(6, 6, 4, 4, I[2]); P(6, 6, I[4]); P(9, 9, I[0])
})
def('lodestone:top', () => {
  const R = ramp('#7b7e82', 0.75); tex(R, { gain: 1.6, lo: 1, hi: 3 }); bevel(R, 1, 3.4, 0.8)
  const I = ramp('#a9adb3'); rect(5, 5, 6, 6, I[2]); raised(5, 5, 6, 6, I[4], I[0]); P(7, 7, hx('#b8473c')); P(8, 8, hx('#b8473c')); P(8, 7, hx('#d8685a')); P(7, 8, hx('#8a2f28'))
})

// sandstone --------------------------------------------------------------------
function sandstone (hex: string, face: string): void {
  const R = ramp(hex, 0.6)
  if (face === 'top') { tex(R, { p: 3, q: 6, gain: 1.6, lit: 1.2, jit: 0.5, lo: 1, hi: 3 }); return }
  if (face === 'bottom') { tex(R, { p: 4, q: 8, gain: 3, lit: 2.4, jit: 0.8 }); return }
  // strata
  field(R, (x, y) => {
    const band = vn(x, y, 2, 8, SEED)
    return clamp(Math.round((2 + (band - 0.5) * 2.6 + (rnd(x, y, SEED) - 0.5) * 0.5) * 2) / 2, 1, 3)
  })
  for (let x = 0; x < S; x++) { P(x, 0, rc(R, 3.5)); P(x, 1, R[3]); P(x, 2, R[2]); P(x, 3, R[1]); P(x, 15, R[1]); P(x, 14, rc(R, 1.6)) }
  if (face === 'cut' || face === 'chiseled') {
    for (let y = 5; y < 13; y++) for (let x = 0; x < S; x++) P(x, y, rc(R, 2 + (rnd(x, y, SEED) < 0.12 ? 0.5 : 0)))
    for (let x = 0; x < S; x++) { P(x, 4, R[1]); P(x, 5, R[3]); P(x, 12, R[3]); P(x, 13, R[1]) }
  }
  if (face === 'chiseled') {
    for (let k = 0; k < 4; k++) art(['.a.', 'a.a', 'a.a', '.a.'], { a: R[0] }, k * 4, 7)
    for (let k = 0; k < 4; k++) P(k * 4 + 1, 7, R[1])
  }
}
for (const f of ['top', 'bottom', 'side', 'cut', 'chiseled']) {
  def(`sandstone:${f}`, () => sandstone('#dacd9a', f))
  def(`red_sandstone:${f}`, () => sandstone('#b96329', f))
}

// ---------------------------------------------------------------------------
// ores & minerals
// ---------------------------------------------------------------------------
const HOSTS: Record<string, () => void> = {
  stone: () => { stoneBase(C_STONE, SEED_STONE) },
  deepslate: () => { deepslateSide(hashStr('deepslate') | 1) },
  netherrack: () => { const R = ramp(C_NETHER, 1); tex(R, { p: 5, q: 9, gain: 4.4, lit: 4, jit: 0.6, s: hashStr('netherrack') | 1 }) },
  blackstone: () => { blackstone(hashStr('blackstone') | 1) }
}
const ORE: Record<string, { c: string, style: number }> = {
  coal: { c: '#2b2b30', style: 0 },
  iron: { c: '#d8a98a', style: 1 },
  copper: { c: '#e07a4a', style: 2 },
  gold: { c: '#f6cf3e', style: 1 },
  redstone: { c: '#e02a1e', style: 3 },
  lapis: { c: '#2f55c8', style: 3 },
  diamond: { c: '#5fe6dc', style: 4 },
  emerald: { c: '#2fd66a', style: 5 },
  quartz: { c: '#efe9df', style: 1 }
}
const ORE_SHAPES: string[][][] = [
  [['.##.', '####', '.###'], ['##.', '###', '.##'], ['.#.', '###', '##.'], ['##', '##']], // chunky
  [['##.', '.##'], ['.##', '##.'], ['##', '.#'], ['#.', '##']], // nuggets
  [['.#.', '###'], ['##.', '.##'], ['##', '#.']],
  [['#.#', '.#.'], ['.#', '#.', '.#'], ['##', '..', '.#'], ['#', '#']], // dust
  [['.#.', '###', '.#.'], ['.#', '##', '#.'], ['#.', '##', '.#']], // gems
  [['##', '##', '##'], ['#', '#', '#'], ['##', '##']] // bars
]
const ORE_SPOTS = [[2, 2], [10, 1], [6, 6], [12, 9], [2, 11], [8, 12], [13, 4], [5, 14]]
function oreSpots (G: Ramp, style: number, s: number): void {
  const shapes = ORE_SHAPES[style]
  const count = style === 3 ? 8 : style === 0 ? 5 : 6
  const mask = new Uint8Array(S * S)
  const at = (x: number, y: number): number => mask[((y & 15) << 4) | (x & 15)]
  for (let i = 0; i < count; i++) {
    const shape = shapes[rint(i, 0, s, shapes.length)]
    const ox = ORE_SPOTS[i][0] + rint(i, 1, s, 2); const oy = ORE_SPOTS[i][1] + rint(i, 2, s, 2)
    for (let y = 0; y < shape.length; y++) for (let x = 0; x < shape[y].length; x++) if (shape[y].charAt(x) === '#') mask[(((oy + y) & 15) << 4) | ((ox + x) & 15)] = 1
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (at(x, y) === 1) {
        const tl = at(x - 1, y) === 0 && at(x, y - 1) === 0
        const br = at(x + 1, y) === 0 || at(x, y + 1) === 0
        P(x, y, G[tl ? 4 : br ? 1 : (at(x, y - 1) === 0 || at(x - 1, y) === 0) ? 3 : 2])
      } else if (at(x - 1, y - 1) === 1 || at(x, y - 1) === 1 || at(x - 1, y) === 1) {
        shadePx(x, y, -1.3)
      }
    }
  }
}
fam('ore', (a) => {
  const o = ORE[a[0]] ?? { c: '#c8c8c8', style: 1 }
  const host = HOSTS[a[1]] ?? HOSTS.stone
  const s = SEED
  host()
  oreSpots(ramp(o.c, a[0] === 'coal' ? 1.2 : 0.9), o.style, hashStr(a[0]) | 1)
  if (a[0] === 'copper') {
    const Gn = ramp('#4fae8a')
    for (let i = 0; i < 4; i++) P(ORE_SPOTS[i][0] + 2 + rint(i, 5, s, 2), ORE_SPOTS[i][1] + rint(i, 6, s, 2), Gn[3])
  }
})

function metalBlock (hex: string, style: string, k = 0.85): Ramp {
  const R = ramp(hex, k)
  tex(R, { p: 3, q: 5, gain: 1.4, lit: 1, jit: 0.25, lo: 1, hi: 3 })
  bevel(R, 1, 3.8, 0.6)
  if (style === 'plates') {
    for (const y of [5, 10]) { hline(1, 14, y, R[1]); hline(1, 14, y + 1, R[3]) }
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P(x, y, R[1])
  } else if (style === 'shine') {
    for (let k2 = 0; k2 < 4; k2++) { P(3 + k2, 6 - k2, R[4]); P(4 + k2, 6 - k2, R[3]); P(9 + k2, 12 - k2, R[3]) }
    inset(2, 2, 12, 12, R[1], R[3])
  } else if (style === 'facets') {
    field(R, (x, y) => {
      const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
      if (m > 7) return (x === 0 || y === 0) ? 4 : 0.6
      const d = (x + y) % 6
      return 2 + (d < 2 ? 1 : d < 3 ? 1.8 : d < 5 ? 0 : -0.8)
    })
    P(15, 0, R[2]); P(0, 15, R[2])
  } else if (style === 'inset') {
    inset(2, 2, 12, 12, R[0], R[4])
    raised(5, 5, 6, 6, R[4], R[0])
    rect(6, 6, 4, 4, R[3])
  } else if (style === 'grid') {
    for (let i = 3; i < 16; i += 5) { vline(i, 1, 14, R[1]); hline(1, 14, i, R[1]); vline(i + 1, 1, 14, R[3]); hline(1, 14, i + 1, R[3]) }
  }
  return R
}
def('iron_block', () => { metalBlock(C_IRON, 'plates', 0.6) })
def('gold_block', () => { metalBlock(C_GOLD, 'shine', 0.9) })
def('diamond_block', () => { metalBlock('#62e3da', 'facets', 0.85) })
def('emerald_block', () => { metalBlock('#35cf6c', 'inset', 0.95) })
def('redstone_block', () => { metalBlock('#b81a12', 'grid', 0.95) })
def('lapis_block', () => {
  const R = ramp('#2a4fb4', 0.95)
  tex(R, { p: 4, q: 8, gain: 3.2, lit: 2.6 })
  specks(R, 7, 4); specks(ramp('#d9c25a'), 3, 2)
  bevel(R, 1, 3.6, 0.6)
})
def('coal_block', () => {
  const R = ramp('#1e1e22', 1.5)
  cobble(R, { n: 3, gap: 0.5, jitter: 0.9, tones: [1.4, 2, 2.4, 3], mortar: R[0], lightK: 0.9 })
})
function rawBlock (hex: string): void {
  const R = ramp(hex, 1)
  cobble(R, { n: 4, gap: 0.75, jitter: 0.9, tones: [1.2, 1.8, 2.2, 2.8, 3.4], mortar: tone(R[0], -0.5) })
}
def('raw_iron_block', () => rawBlock('#b9916f'))
def('raw_copper_block', () => { rawBlock('#b8623c'); specks(ramp('#4fae8a'), 7, 2) })
def('raw_gold_block', () => rawBlock('#e2b02c'))

// copper family ----------------------------------------------------------------
const COPPER: Record<string, string> = { new: '#c96f4e', exposed: '#a67f68', weathered: '#6f9a72', oxidized: '#55a68d' }
const copperRamp = (stage: string): Ramp => ramp(COPPER[stage] ?? COPPER.new, 0.85)
/** Base copper sheet with stage-dependent patina blotches. */
function copperSheet (stage: string, s = SEED): Ramp {
  const R = copperRamp(stage)
  tex(R, { p: 3, q: 6, gain: 2, lit: 1.6, jit: 0.4, lo: 1, hi: 3, s })
  const patina = stage === 'new' ? null : stage === 'exposed' ? ramp('#7f9a7c', 0.8) : stage === 'weathered' ? ramp('#57a88c', 0.8) : ramp('#7cc7ab', 0.8)
  if (patina !== null) {
    const amount = stage === 'exposed' ? 0.3 : stage === 'weathered' ? 0.38 : 0.28
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (vn(x, y, 4, 4, s + 17) * 0.7 + rnd(x, y, s + 18) * 0.3 > 1 - amount) P(x, y, patina[2 + ((x + y) & 1)])
  }
  return R
}
fam('copper', (a) => { const R = copperSheet(a[0]); bevel(R, 1, 3.6, 0.7); hline(1, 14, 8, R[1]); hline(1, 14, 9, R[3]) })
fam('cut_copper', (a) => {
  const R = copperSheet(a[0])
  for (const [x, y] of [[0, 0], [8, 0], [0, 8], [8, 8]]) raised(x, y, 8, 8, rc(R, 3.6), rc(R, 0.6))
})
fam('chiseled_copper', (a) => {
  const R = copperSheet(a[0])
  bevel(R, 1, 3.6, 0.6)
  inset(3, 3, 10, 10, R[0], R[4])
  for (let y = 5; y < 11; y += 2) hline(5, 10, y, R[0])
  for (let y = 6; y < 11; y += 2) hline(5, 10, y, R[3])
})
fam('copper_grate', (a) => {
  const R = copperSheet(a[0])
  bevel(R, 1, 3.6, 0.6)
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) { const cx = (x - 2) % 4; const cy = (y - 2) % 4; if (cx < 2 && cy < 2) P(x, y, R[0], 0); else if (cx === 2 || cy === 2) P(x, y, R[3]); else P(x, y, R[1]) }
})
fam('copper_bulb', (a) => {
  const R = copperSheet(a[0])
  bevel(R, 1, 3.6, 0.6)
  const lit = a[1] === 'lit'
  const B: Ramp = lit ? [hx('#b8641a'), hx('#e89a2a'), hx('#fbd060'), hx('#fff0a8'), hx('#ffffff')] : [hx('#2c2622'), hx('#463a30'), hx('#5e4c3a'), hx('#7a6248'), hx('#9a8060')]
  inset(3, 3, 10, 10, R[0], R[4])
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const d = Math.hypot(x - 7.5, y - 7.5); P(x, y, rc(B, clamp(3.8 - d * 0.7, 0.5, 4))) }
  for (let i = 4; i < 12; i++) { P(i, 7, R[1]); P(7, i, R[1]) }
  if (a[2] === 'pow') { P(7, 7, hx('#e02a1e')); P(8, 8, hx('#e02a1e')); P(8, 7, hx('#ff6a50')); P(7, 8, hx('#a0140c')) } else { P(7, 7, R[0]) }
})
fam('copper_golem', (a) => {
  const R = copperSheet(a[0])
  bevel(R, 1, 3.6, 0.6)
  art(['.aaaaaa.', '.a.aa.a.', '.aaaaaa.', '...aa...'], { a: R[0] }, 4, 3)
  hline(3, 12, 9, R[0]); hline(3, 12, 10, R[4])
})

// ---------------------------------------------------------------------------
// wood
// ---------------------------------------------------------------------------
function plankTile (wood: string, s = SEED): Ramp {
  const w = woodOf(wood)
  const R = ramp(w.planks, wood === 'pale_oak' || wood === 'birch' || wood === 'cherry' ? 0.6 : 0.8)
  if (wood === 'bamboo') {
    // narrow slats
    field(R, (x, y) => {
      const yy = y % 4
      if (yy === 3) return 0.5
      const node = ((x + (y >> 2) * 5) & 7) === 0
      return (yy === 0 ? 2.8 : yy === 1 ? 2.2 : 1.7) + (node ? -0.9 : 0) + (rnd(x >> 1, y, s) < 0.15 ? -0.4 : 0)
    })
    return R
  }
  planks(R, { s, knots: wood === 'birch' ? 2 : wood === 'spruce' ? 1 : 0, grain: wood === 'crimson' || wood === 'warped' ? 1.4 : 1 })
  return R
}
fam('planks', (a) => { plankTile(a[0]) })
def('bamboo_mosaic', () => {
  const R = ramp(WOOD.bamboo.planks, 0.8)
  field(R, (x, y) => {
    const qx = x >> 3; const qy = y >> 3; const horizontal = ((qx + qy) & 1) === 0
    const t = horizontal ? (y & 7) : (x & 7); const u = horizontal ? (x & 7) : (y & 7)
    if (t === 7 || u === 7) return 0.6
    return [2.8, 2.2, 1.6, 1][t & 3] + (u === 0 ? 0.4 : 0)
  })
})
function logSide (wood: string): void {
  const w = woodOf(wood)
  const R = ramp(w.bark, 0.9)
  switch (wood) {
    case 'birch': {
      const W = ramp(w.bark, 0.5)
      bark(W, { px: 5, py: 1, gain: 1.8, lit: 1 })
      const K = ramp('#34342f', 0.8)
      for (let i = 0; i < 8; i++) {
        const x = rint(i, 0, SEED, 16); const y = (i * 2 + rint(i, 1, SEED, 2)) & 15; const len = 2 + rint(i, 2, SEED, 3)
        for (let k = 0; k < len; k++) P(x + k, y, K[k === 0 ? 3 : 2])
        if ((i & 1) === 0) P(x + 1, y + 1, K[4])
      }
      break
    }
    case 'cherry': {
      bark(R, { px: 5, py: 1, gain: 2.6, lit: 1.6 })
      const L = ramp('#6a4458', 0.8)
      for (let i = 0; i < 7; i++) { const x = rint(i, 0, SEED, 16); const y = (i * 2 + 1) & 15; const len = 2 + rint(i, 2, SEED, 3); for (let k = 0; k < len; k++) P(x + k, y, L[3]) }
      break
    }
    case 'jungle': bark(R, { px: 6, py: 3, gain: 4 }); break
    case 'acacia': {
      const f = (x: number, y: number): number => vn(x + y * 0.5, y, 7, 3, SEED)
      field(R, (x, y) => clamp(Math.round(2 + (f(x, y) - 0.5) * 5 + (f(x, y) - f(x + 1, y)) * 3), 0, 4))
      break
    }
    case 'crimson': case 'warped': {
      bark(R, { px: 6, py: 2, gain: 3.6 })
      const V = wood === 'crimson' ? ramp('#c8362c', 0.9) : ramp('#1fae96', 0.9)
      for (let i = 0; i < 5; i++) {
        let x = 1 + i * 3 + rint(i, 0, SEED, 2); let y = rint(i, 1, SEED, 16); const len = 4 + rint(i, 2, SEED, 6)
        for (let k = 0; k < len; k++) { P(x, y, V[k === 0 || k === len - 1 ? 1 : 3]); y++; if (rint(i, k + 3, SEED, 4) === 0) x += rint(i, k + 30, SEED, 2) * 2 - 1 }
      }
      break
    }
    case 'spruce': case 'dark_oak': bark(R, { px: 7, py: 2, gain: 5.4 }); break
    case 'pale_oak': bark(ramp(w.bark, 1.2), { px: 7, py: 2, gain: 5.4 }); break
    default: bark(R, { px: 8, py: 2, gain: 5 })
  }
}
fam('log', (a) => logSide(a[0]))
fam('logtop', (a) => { const w = woodOf(a[0]); rings(ramp(w.bark, 0.9), ramp(w.inner, 0.7)) })
function strippedSide (wood: string, s = SEED): Ramp {
  const R = ramp(woodOf(wood).inner, 0.6)
  bark(R, { px: 6, py: 1, gain: 2.6, lit: 1.4, s })
  return R
}
fam('slog', (a) => { strippedSide(a[0]) })
fam('slogtop', (a) => { const w = woodOf(a[0]); rings(ramp(w.inner, 0.6), ramp(w.inner, 0.7)) })
function bambooSide (hex: string): void {
  const R = ramp(hex, 0.8)
  field(R, (x, y) => {
    const xx = x & 3
    const node = ((y + (x >> 2) * 5) & 7) === 0
    return (xx === 0 ? 0.8 : xx === 1 ? 3 : xx === 2 ? 2.2 : 1.6) + (node ? -0.8 : 0)
  })
}
def('bamboo_block:side', () => bambooSide(WOOD.bamboo.bark))
def('bamboo_block:top', () => { rings(ramp(WOOD.bamboo.bark, 0.8), ramp(WOOD.bamboo.inner, 0.7)) })
def('stripped_bamboo_block:side', () => bambooSide(WOOD.bamboo.inner))
def('stripped_bamboo_block:top', () => { rings(ramp(WOOD.bamboo.inner, 0.6), ramp(WOOD.bamboo.inner, 0.7)) })
def('bamboo_stalk', () => {
  const R = ramp('#6f9a2e', 0.9)
  field(R, (x, y) => {
    const node = (y & 7) === 3
    return (x & 1) === 0 ? (node ? 1 : 2.8) : (node ? 0.4 : 1.8)
  })
})

const LEAF: Record<string, { c: string, p: number, hole: number, k?: number }> = {
  oak: { c: WOOD.oak.leaf, p: 5, hole: 0.36 },
  spruce: { c: WOOD.spruce.leaf, p: 7, hole: 0.34 },
  birch: { c: WOOD.birch.leaf, p: 6, hole: 0.38 },
  jungle: { c: WOOD.jungle.leaf, p: 4, hole: 0.3 },
  acacia: { c: WOOD.acacia.leaf, p: 6, hole: 0.4 },
  dark_oak: { c: WOOD.dark_oak.leaf, p: 4, hole: 0.28 },
  mangrove: { c: WOOD.mangrove.leaf, p: 5, hole: 0.33 },
  cherry: { c: WOOD.cherry.leaf, p: 5, hole: 0.31, k: 0.7 },
  pale_oak: { c: WOOD.pale_oak.leaf, p: 5, hole: 0.37, k: 0.8 },
  azalea: { c: '#5f8c31', p: 5, hole: 0.33 },
  flowering_azalea: { c: '#5f8c31', p: 5, hole: 0.33 }
}
function leafTile (type: string, s = SEED): Ramp {
  const L = LEAF[type] ?? LEAF.oak
  const R = ramp(L.c, L.k ?? 1)
  leaves(R, { p: L.p, hole: L.hole, s })
  const dot = (n: number, c: RGB, seed: number): void => {
    for (let i = 0; i < n; i++) { const x = rint(i, 0, seed, 16); const y = rint(i, 1, seed, 16); if (alphaAt(x, y) > 0) P(x, y, c) }
  }
  if (type === 'spruce') {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (alphaAt(x, y) > 0 && ((x + y * 2) & 3) === 0) shadePx(x, y, -0.8)
  } else if (type === 'jungle') dot(7, hx('#9bd24a'), s + 9)
  else if (type === 'cherry') { dot(9, hx('#fbe3ee'), s + 9); dot(5, hx('#d86a9c'), s + 10) } else if (type === 'birch') dot(6, hx('#b4cf6a'), s + 9)
  else if (type === 'flowering_azalea') {
    const Fm = ramp('#d85ac0', 0.8)
    for (let i = 0; i < 5; i++) { const x = 1 + rint(i, 0, s + 4, 14); const y = 1 + rint(i, 1, s + 4, 14); P(x, y, Fm[4]); P(x - 1, y, Fm[2]); P(x + 1, y, Fm[2]); P(x, y - 1, Fm[3]); P(x, y + 1, Fm[1]) }
  } else if (type === 'pale_oak') dot(5, hx('#c9cfc4'), s + 9)
  return R
}
for (const t of Object.keys(LEAF)) def(`leaves:${t}`, () => { leafTile(t) })

/** Small tree sprite: trunk plus a shaded crown. */
function sapling (wood: string): void {
  const w = woodOf(wood)
  const L = ramp(LEAF[wood]?.c ?? w.leaf, LEAF[wood]?.k ?? 1)
  const B = ramp(wood === 'birch' ? '#d8d5ca' : w.bark, 0.9)
  clear()
  let inCrown: (x: number, y: number) => number // returns >0 inside, value = lit factor
  let trunkTop = 9
  const ell = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number): number => {
    const dx = (x - cx) / rx; const dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1 ? 1 - (dx + dy) * 0.5 : 0
  }
  switch (wood) {
    case 'spruce': inCrown = (x, y) => (y >= 1 && y <= 11 && Math.abs(x - 7.5) <= 0.6 + (y - 1) * 0.42 * ((y & 1) === 0 ? 1 : 0.72)) ? 1 - (x - 7.5) * 0.2 - (y - 6) * 0.12 : 0; trunkTop = 12; break
    case 'acacia': inCrown = ell(7.5, 5.5, 6, 2.6); trunkTop = 7; break
    case 'birch': inCrown = ell(7.5, 5.5, 3.4, 4.6); break
    case 'jungle': inCrown = ell(7.5, 6, 5.2, 4.2); break
    case 'dark_oak': inCrown = ell(7.5, 6, 5.6, 4.6); trunkTop = 10; break
    case 'cherry': inCrown = ell(7.5, 5.5, 5, 3.8); break
    case 'pale_oak': inCrown = (x, y) => Math.max(ell(7.5, 5, 4.6, 3.6)(x, y), (y > 5 && y < 11 && (x === 3 || x === 12 || x === 5 || x === 10) && ((x + y) & 1) === 0) ? 0.8 : 0); break
    default: inCrown = ell(7.5, 5.5, 4.4, 4.2)
  }
  // trunk
  for (let y = trunkTop; y < S; y++) { Q(7, y, B[3]); Q(8, y, B[1]) }
  if (wood === 'birch') { Q(7, 11, hx('#3a3a36')); Q(8, 13, hx('#3a3a36')) }
  Q(6, 15, B[1]); Q(9, 15, B[0])
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = inCrown(x, y)
      if (v <= 0) continue
      const gap = rnd(x, y, SEED) < 0.1
      if (gap && inCrown(x - 1, y) > 0 && inCrown(x + 1, y) > 0) { Q(x, y, L[0]); continue }
      Q(x, y, L[clamp(Math.round(1.4 + v * 1.3 + (rnd(x, y, SEED + 1) - 0.5) * 1.2), 1, 4)])
    }
  }
  if (wood === 'cherry') for (let i = 0; i < 4; i++) { const x = 4 + rint(i, 0, SEED, 8); const y = 3 + rint(i, 1, SEED, 5); if (alphaAt(x, y) > 0) Q(x, y, hx('#fbe3ee')) }
  if (wood === 'jungle') { Q(5, 8, hx('#9bd24a')); Q(10, 5, hx('#9bd24a')) }
}
fam('sapling', (a) => sapling(a[0]))

fam('sign', (a) => {
  const w = woodOf(a[0])
  const R = ramp(w.planks, 0.7); const Pst = ramp(w.bark, 0.8)
  fill(Pst[2])
  for (let y = 9; y < S; y++) for (let x = 0; x < S; x++) P(x, y, Pst[(x & 1) === 0 ? 3 : 1])
  for (let x = 0; x < S; x++) P(x, 0, Pst[1])
  for (let y = 1; y <= 8; y++) for (let x = 0; x < S; x++) P(x, y, rc(R, 2 + (rnd(x >> 2, y, SEED) < 0.25 ? -0.5 : 0)))
  raised(0, 1, 16, 8, R[4], R[0])
  hline(3, 12, 3, R[1]); hline(3, 10, 5, R[1]); hline(3, 11, 6, R[1])
})
fam('hsign', (a) => {
  const w = woodOf(a[0])
  const R = ramp(w.inner, 0.7); const Bk = ramp(w.bark, 0.8); const Ch = ramp('#5a5e68', 0.9)
  for (let y = 0; y < 2; y++) for (let x = 0; x < S; x++) P(x, y, Bk[y === 0 ? 3 : 1])
  for (let y = 2; y < 6; y++) for (let x = 0; x < S; x++) P(x, y, Ch[(y & 1) === 0 ? 3 : 1])
  for (let y = 6; y < S; y++) for (let x = 0; x < S; x++) P(x, y, rc(R, 2 + (rnd(x >> 2, y, SEED) < 0.25 ? -0.5 : 0)))
  raised(0, 6, 16, 10, R[4], R[0])
  hline(3, 12, 9, R[1]); hline(3, 10, 11, R[1]); hline(3, 11, 12, R[1])
})
fam('shelf', (a) => {
  const R = strippedSide(a[0])
  const Dk = ramp(tone(R[0], -1.2), 0.8)
  rect(1, 3, 14, 10, Dk[2]); hline(1, 14, 3, Dk[0]); vline(1, 3, 12, Dk[1]); hline(1, 14, 12, Dk[3])
  hline(0, 15, 2, R[0]); hline(0, 15, 13, R[4])
})

/** Door halves. `mat` is a wood name, 'iron', or 'copper_<stage>'. */
function door (mat: string, half: string): void {
  const top = half === 'top'
  let R: Ramp; let style: string
  if (mat === 'iron') { R = ramp('#c9c9c6', 0.6); style = 'metal' } else if (mat.startsWith('copper_')) { R = copperSheet(mat.slice(7)); style = 'metal' } else {
    R = plankTile(mat)
    style = ({ oak: 'panes4', spruce: 'solid', birch: 'panes2', jungle: 'lattice', acacia: 'lattice', dark_oak: 'slit', mangrove: 'cross', cherry: 'panes4', pale_oak: 'slit', bamboo: 'panes2', crimson: 'tall2', warped: 'tall2' } as Record<string, string>)[mat] ?? 'solid'
  }
  if (mat === 'iron') tex(R, { gain: 1.2, lo: 1, hi: 3, jit: 0.2 })
  // frame
  vline(0, 0, 15, R[3]); vline(15, 0, 15, R[1]); vline(1, 0, 15, rc(R, 2.5)); vline(14, 0, 15, rc(R, 1.5))
  if (top) { hline(0, 15, 0, R[4]); hline(1, 14, 1, R[3]) } else { hline(0, 15, 15, R[0]); hline(1, 14, 14, R[1]) }
  const hole = (x: number, y: number, w: number, h: number): void => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) Q(i, j, R[0], 0)
    hline(x - 1, x + w, y - 1, R[0]); vline(x - 1, y - 1, y + h, R[0]); hline(x, x + w, y + h, R[4]); vline(x + w, y, y + h, R[3])
  }
  const panel = (x: number, y: number, w: number, h: number): void => { inset(x, y, w, h, R[0], R[4]); raised(x + 1, y + 1, w - 2, h - 2, R[3], R[1]) }
  if (top) {
    switch (style) {
      case 'panes4': hole(3, 3, 4, 4); hole(9, 3, 4, 4); hole(3, 9, 4, 4); hole(9, 9, 4, 4); break
      case 'panes2': hole(3, 3, 4, 5); hole(9, 3, 4, 5); panel(3, 10, 10, 5); break
      case 'lattice': for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) Q(3 + i * 3 + c, 3 + j * 3 + b, R[0], 0) } break
      case 'slit': hole(4, 3, 8, 2); panel(3, 7, 10, 8); break
      case 'cross': hole(3, 3, 4, 4); hole(9, 3, 4, 4); panel(3, 9, 10, 6); break
      case 'tall2': hole(4, 3, 2, 10); hole(10, 3, 2, 10); break
      case 'metal': hole(3, 3, 4, 4); hole(9, 3, 4, 4); for (const [x, y] of [[3, 10], [12, 10], [3, 13], [12, 13]]) { P(x, y, R[4]); P(x + 1 > 15 ? x : x, y + 1, R[0]) } hline(3, 12, 11, R[1]); break
      default: panel(3, 3, 10, 5); panel(3, 9, 10, 6)
    }
  } else {
    if (style === 'lattice' && mat === 'acacia') {
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) Q(3 + i * 3 + c, 1 + j * 3 + b, R[0], 0) }
    } else if (style === 'metal') {
      panel(3, 2, 10, 11)
      for (const [x, y] of [[4, 3], [11, 3], [4, 11], [11, 11]]) P(x, y, R[4])
    } else if (style === 'tall2') { panel(3, 1, 4, 12); panel(9, 1, 4, 12) } else { panel(3, 1, 10, 6); panel(3, 8, 10, 6) }
    // handle
    const K = mat === 'iron' ? ramp('#6a6e76') : ramp('#d8b24a')
    P(12, 1, K[3]); P(12, 2, K[1])
  }
}
fam('door', (a) => door(a[0], a[1] ?? 'bottom'))
fam('trapdoor', (a) => {
  const mat = a[0]
  let R: Ramp
  if (mat === 'iron') { R = ramp('#c9c9c6', 0.6); tex(R, { gain: 1.2, lo: 1, hi: 3, jit: 0.2 }) } else if (mat.startsWith('copper_')) R = copperSheet(mat.slice(7))
  else R = plankTile(mat)
  frame(0, 0, 16, 16, R[1]); hline(0, 15, 0, R[4]); vline(0, 0, 15, R[3]); frame(1, 1, 14, 14, rc(R, 2.5))
  const open = mat === 'oak' || mat === 'jungle' || mat === 'acacia' || mat === 'mangrove' || mat === 'bamboo' || mat === 'cherry' || mat === 'crimson' || mat === 'warped' || mat.startsWith('copper_')
  if (mat === 'iron') {
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { Q(4 + i * 4, 4 + j * 4, R[0], 0); Q(3 + i * 4, 4 + j * 4, R[0]); Q(4 + i * 4, 3 + j * 4, R[0]) }
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P(x, y, R[4])
  } else if (open) {
    for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) {
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) Q(x + i, y + j, R[0], 0)
      hline(x - 1, x + 4, y - 1, R[0]); vline(x - 1, y - 1, y + 4, R[0]); hline(x, x + 4, y + 4, R[4]); vline(x + 4, y, y + 4, R[3])
    }
  } else {
    inset(3, 3, 10, 10, R[0], R[4])
    hline(4, 11, 7, R[0]); hline(4, 11, 8, R[3])
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P(x, y, R[0])
  }
})

// ---------------------------------------------------------------------------
// dyed families
// ---------------------------------------------------------------------------
fam('wool', (a) => {
  const R = dyeRamp(a[0], 0.75)
  field(R, (x, y) => {
    const fluff = (vn(x, y, 8, 8, SEED) - 0.5) * 3 + (vn(x, y, 3, 3, SEED + 1) - 0.5) * 1.4
    const curl = rint(x >> 1, y, SEED + 2, 7) === 0 ? 0.7 : 0
    return clamp(Math.round(2 + fluff + curl), 1, 3)
  })
})
fam('concrete', (a) => {
  const R = dyeRamp(a[0], 0.5)
  field(R, (x, y) => 2 + (vn(x, y, 3, 3, SEED) - 0.5) * 1.2 + (rnd(x, y, SEED) < 0.06 ? -0.4 : 0))
})
fam('powder', (a) => {
  const R = dyeRamp(a[0], 0.7)
  tex(R, { p: 7, q: 12, gain: 3.2, lit: 2, jit: 1.5, lo: 1, hi: 4, bias: 0.3 })
})
function terracottaColor (dye: string): RGB {
  const d = hexRgb(DYE[dye] ?? '#9a9a9a')
  const m = mix(d, hx('#98604a'), 0.52)
  const [h, s, v] = rgb2hsv(m)
  return hsv2rgb(h, s * 0.82, v * 0.92)
}
fam('terracotta', (a) => terracotta(terracottaColor(a[0])))
fam('glazed', (a) => {
  const dye = a[0]
  const base = hexRgb(DYE[dye] ?? '#9a9a9a')
  const [h, s, v] = rgb2hsv(base)
  const main = ramp(hsv2rgb(h, s * 0.82, v * 0.94), 0.9)
  const accent = hsv2rgb(h + 26, Math.min(0.62, s * 0.55 + 0.08), Math.min(0.92, v * 0.95 + 0.14))
  const light = hsv2rgb(h - 12, s * 0.16, Math.min(0.95, 0.7 + v * 0.26))
  const dark = main[0]
  const style = DYE_NAMES.indexOf(dye) & 3
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const qx = x < 8 ? x : 15 - x; const qy = y < 8 ? y : 15 - y
      let c: RGB
      if (style === 0) {
        const v2 = qx + qy
        c = v2 < 2 ? dark : v2 < 4 ? main[2] : v2 === 4 ? light : v2 < 8 ? accent : v2 < 10 ? main[3] : v2 === 10 ? dark : v2 < 13 ? light : main[2]
      } else if (style === 1) {
        const m = Math.max(qx, qy); const n = Math.min(qx, qy)
        c = m === 0 ? dark : m < 3 ? (qx === qy ? light : main[2]) : m === 3 ? light : m < 6 ? (n < 2 ? accent : main[3]) : m === 6 ? dark : accent
        if (qx === qy && m > 3) c = light
      } else if (style === 2) {
        const d = Math.hypot(7.5 - qx, 7.5 - qy)
        c = d < 2 ? light : d < 3.4 ? accent : d < 4.6 ? dark : d < 6.6 ? main[2] : d < 7.6 ? light : (qx + qy < 3 ? accent : main[3])
        if ((qx === 7 || qy === 7) && d > 3.4 && d < 6.6) c = accent
      } else {
        const diag = Math.abs(qx - qy)
        c = (qx === 0 || qy === 0) ? dark : diag === 0 ? light : diag < 3 ? main[2] : diag === 3 ? dark : (qx + qy) < 9 ? accent : main[3]
        if (qx > 5 && qy > 5) c = light
        if (qx === 7 && qy === 7) c = accent
      }
      P(x, y, c)
    }
  }
})

function glassTile (R: Ramp, edgeA: number, bodyA: number, glintA: number): void {
  if (bodyA === 0) clear(); else fill(R[2], bodyA)
  for (let i = 0; i < S; i++) { P(i, 0, R[4], edgeA); P(0, i, R[4], edgeA) }
  for (let i = 0; i < S; i++) { P(i, 15, R[1], edgeA); P(15, i, R[1], edgeA) }
  P(15, 0, R[3], edgeA); P(0, 15, R[3], edgeA)
  const g = R[4]
  for (const [x, y] of [[3, 5], [4, 4], [5, 3], [4, 6], [5, 5], [6, 4], [10, 12], [11, 11], [12, 10]]) P(x, y, g, glintA)
  P(12, 12, R[3], glintA)
}
def('glass', () => glassTile(ramp('#cfe5ee', 0.6), 255, 0, 255))
def('pane_edge:clear', () => { const R = ramp('#cfe5ee', 0.6); field(R, (x, y) => ((x + y) & 3) === 0 ? 4 : 3) })
fam('sglass', (a) => glassTile(dyeRamp(a[0], 0.8), 225, 128, 205))
fam('pane_edge', (a) => { const R = dyeRamp(a[0], 0.8); fill(R[3], 225) })
def('tinted_glass', () => glassTile(ramp('#2e2836', 1), 235, 200, 220))

fam('bed', (a) => {
  const R = dyeRamp(a[0], 0.8); const W = ramp('#e9e9e4', 0.5); const Wd = ramp(WOOD.oak.planks, 0.8)
  const part = a[1]
  if (part === 'side') {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) P(x, y, y < 12 ? rc(R, y === 7 ? 3.2 : y === 11 ? 1 : 2 + (((x + y) & 3) === 0 ? 0.4 : 0)) : rc(Wd, y === 12 ? 3 : y === 15 ? 1 : 2))
    return
  }
  field(R, (x, y) => 2 + (((x + y * 3) & 3) === 0 ? 0.5 : 0) + (vn(x, y, 3, 3, SEED) - 0.5))
  bevel(R, 1, 3.2, 1)
  if (part === 'head') {
    rect(3, 3, 10, 10, W[2]); raised(3, 3, 10, 10, W[4], W[0]); hline(5, 10, 7, W[1]); hline(5, 10, 8, W[3])
  } else {
    for (let i = 2; i < 14; i += 2) { P(i, 4, R[4]); P(i + 1, 11, R[1]) }
    hline(1, 14, 7, R[1]); hline(1, 14, 8, R[3])
  }
})
fam('banner', (a) => {
  const R = dyeRamp(a[0], 0.8); const Wd = ramp(WOOD.oak.bark, 0.8)
  clear()
  for (let y = 2; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (y >= 13 && Math.abs(((x + 2) & 7) - 3.5) > (15.5 - y) * 1.4) continue
      const fold = [0, 0.4, 0.2, -0.4, -0.6, -0.2, 0.3, 0.5][x & 7]
      P(x, y, rc(R, 2 + fold + (y === 2 ? -1 : 0)))
    }
  }
  for (let x = 0; x < S; x++) { P(x, 0, Wd[3]); P(x, 1, Wd[1]) }
})
function candleRamp (dye: string): Ramp { return dye === 'plain' ? ramp('#e8d9a8', 0.6) : dyeRamp(dye, 0.75) }
fam('candle', (a) => {
  const R = candleRamp(a[0])
  if (a[1] === 'lit') { const Fl: Ramp = [hx('#c85a14'), hx('#f08a1e'), hx('#fbc23a'), hx('#ffe68a'), hx('#fffbe0')]; field(Fl, (x, y) => 2 + ((x + y) & 1) + (rnd(x, y, SEED) < 0.3 ? 1 : 0)); return }
  field(R, (x, y) => ((x & 1) === 0 ? 2.6 : 1.6) + ((y & 7) === 0 ? 0.6 : 0))
})
function cakeSide (): void {
  const Sp = ramp('#c98a4a', 0.8); const Ic = ramp('#f4efe6', 0.5); const Rd = ramp('#b8262c', 0.8)
  fill(Sp[2])
  for (let y = 8; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const drip = 9 + Math.round(vn(x, 0, 6, 1, 77) * 2.4)
      if (y <= drip) P(x, y, Ic[y === 8 ? 4 : y === drip ? 1 : 3])
      else if (y === 12) P(x, y, Rd[(x & 3) === 0 ? 3 : 2])
      else P(x, y, Sp[y === 15 ? 1 : (rnd(x, y, 78) < 0.2 ? 3 : 2)])
    }
  }
}
def('cake:side', cakeSide)
def('cake:top', () => {
  const Ic = ramp('#f4efe6', 0.5); const Rd = ramp('#b8262c', 0.8)
  tex(Ic, { p: 3, q: 6, gain: 1.6, lit: 1.4, lo: 1, hi: 4, bias: 0.6 })
  for (const [x, y] of [[3, 3], [8, 2], [12, 4], [5, 7], [10, 8], [2, 11], [7, 12], [12, 12]]) { P(x, y, Rd[3]); P(x + 1, y, Rd[2]); P(x, y + 1, Rd[2]); P(x + 1, y + 1, Rd[1]) }
})
def('cake:bottom', () => tex(ramp('#c98a4a', 0.8), { gain: 2.4 }))
fam('candle_cake', (a) => {
  cakeSide()
  const R = candleRamp(a[0])
  for (let y = 2; y < 8; y++) { P(7, y, R[3]); P(8, y, R[1]) }
  P(7, 2, R[4])
})
fam('shulker', (a) => {
  const R = a[0] === 'plain' ? ramp('#96689a', 0.8) : dyeRamp(a[0], 0.8)
  tex(R, { p: 3, q: 5, gain: 1.4, lit: 1, jit: 0.3, lo: 1, hi: 3 })
  if (a[1] === 'top') {
    bevel(R, 1, 3.6, 0.7); inset(3, 3, 10, 10, R[0], R[4]); raised(5, 5, 6, 6, R[4], R[0]); rect(6, 6, 4, 4, R[3])
  } else {
    bevel(R, 1, 3.6, 0.7)
    hline(1, 14, 9, R[0]); hline(1, 14, 10, R[4])
    for (let x = 3; x < 14; x += 5) { P(x, 4, R[4]); P(x, 5, R[0]); P(x, 12, R[4]); P(x, 13, R[0]) }
    rect(6, 8, 4, 3, R[1]); raised(6, 8, 4, 3, R[3], R[0])
  }
})

// ---------------------------------------------------------------------------
// utility blocks
// ---------------------------------------------------------------------------
const R_OAK = (): Ramp => ramp(WOOD.oak.planks, 0.8)
const R_FURN = (): Ramp => ramp('#77797d', 0.8)
const R_DARKIRON = (): Ramp => ramp('#45474d', 0.9)
const FIRE: Ramp = [hx('#b83a0c'), hx('#e8690e'), hx('#f79a1c'), hx('#fdd34a'), hx('#fff3b8')]
const SOULFIRE: Ramp = [hx('#0c5a78'), hx('#1a8fb0'), hx('#3fc4d8'), hx('#8fe8f0'), hx('#e0fbff')]

function casing (R: Ramp, s = SEED): void {
  tex(R, { p: 3, q: 6, gain: 2, lit: 1.6, lo: 1, hi: 3, s })
  bevel(R, 1, 3.4, 0.7)
}
/** Dark opening with an inner shadow; optionally glowing. */
function opening (x: number, y: number, w: number, h: number, glow: Ramp | null, frameR: Ramp): void {
  rect(x, y, w, h, hx('#17171b'))
  inset(x - 1, y - 1, w + 2, h + 2, frameR[0], frameR[4])
  if (glow !== null) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) Q(x + i, y + j, rc(glow, clamp(1 + (j / h) * 2.6 + (rnd(i, j, SEED) - 0.5) * 1.6 - Math.abs(i - (w - 1) / 2) * 0.4, 0, 4)))
  } else {
    hline(x, x + w - 1, y, hx('#0c0c0f'))
  }
}
function furnaceFront (kind: string, lit: boolean): void {
  const R = kind === 'blast_furnace' ? ramp('#5d6067', 0.9) : R_FURN()
  casing(R, hashStr(kind) | 1)
  if (kind === 'smoker') {
    const W = ramp(WOOD.spruce.planks, 0.8)
    for (let y = 1; y < 5; y++) for (let x = 1; x < 15; x++) P(x, y, W[y === 1 ? 3 : y === 4 ? 1 : 2])
    for (let x = 3; x < 13; x += 3) vline(x, 1, 4, W[0])
    opening(4, 8, 8, 5, lit ? FIRE : null, R)
    for (let x = 5; x < 12; x += 2) vline(x, 8, 12, R[1])
    return
  }
  if (kind === 'blast_furnace') {
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { P(x, y, R[4]); P(x, y + 1 > 14 ? y : y + 1, R[0]) }
    opening(4, 3, 8, 3, null, R)
    for (let x = 5; x < 12; x += 2) vline(x, 3, 5, R[2])
    opening(4, 9, 8, 4, lit ? FIRE : null, R)
    hline(3, 12, 7, R[0]); hline(3, 12, 8, R[4])
    return
  }
  opening(4, 3, 8, 2, null, R)
  opening(3, 8, 10, 5, lit ? FIRE : null, R)
  if (!lit) { for (let x = 4; x < 13; x += 2) vline(x, 10, 12, R[1]) }
}
for (const k of ['furnace', 'blast_furnace', 'smoker']) {
  def(`${k}:front`, () => furnaceFront(k, false))
  def(`${k}:front:lit`, () => furnaceFront(k, true))
}
def('furnace:side', () => { const R = R_FURN(); casing(R); hline(1, 14, 8, R[1]); hline(1, 14, 9, R[3]) })
def('furnace:top', () => { const R = R_FURN(); casing(R); inset(3, 3, 10, 10, R[1], R[3]) })
def('blast_furnace:side', () => { const R = ramp('#5d6067', 0.9); casing(R); for (const y of [4, 11]) { hline(1, 14, y, R[0]); hline(1, 14, y + 1, R[4]) } for (const x of [3, 8, 12]) { P(x, 2, R[4]); P(x, 8, R[4]); P(x, 14, R[4]) } })
def('blast_furnace:top', () => { const R = ramp('#5d6067', 0.9); casing(R); inset(3, 3, 10, 10, R[0], R[4]); rect(5, 5, 6, 6, R[1]); for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P(x, y, R[4]) })
def('smoker:side', () => { const R = R_FURN(); casing(R); const W = ramp(WOOD.spruce.planks, 0.8); for (let y = 5; y < 11; y++) for (let x = 0; x < S; x++) P(x, y, W[y === 5 ? 3 : y === 10 ? 0 : (x & 3) === 0 ? 1 : 2]) })
def('smoker:top', () => { const R = R_FURN(); casing(R); opening(4, 4, 8, 8, null, R); for (let x = 5; x < 12; x += 2) vline(x, 4, 11, R[1]) })

function dispenserFront (kind: string, vertical: boolean): void {
  const R = R_FURN(); casing(R, hashStr('furnace:side') | 1)
  if (vertical) { inset(3, 3, 10, 10, R[0], R[4]); rect(6, 6, 4, 4, hx('#17171b')); frame(5, 5, 6, 6, R[1]); return }
  if (kind === 'dispenser') {
    inset(3, 3, 10, 10, R[0], R[4])
    art(['.aaaaaa.', 'a.a..a.a', 'a......a', 'a.aaaa.a', 'a......a', '.aaaaaa.'], { a: R[0] }, 4, 5)
    rect(7, 8, 2, 2, hx('#17171b'))
  } else {
    inset(3, 3, 10, 10, R[0], R[4])
    art(['.aaaaaa.', 'a......a', 'a.aaaa.a', 'a.aaaa.a', 'a......a', '.aaaaaa.'], { a: R[0] }, 4, 5)
    rect(6, 7, 4, 2, hx('#17171b'))
  }
}
def('dispenser:front', () => dispenserFront('dispenser', false))
def('dispenser:front:vertical', () => dispenserFront('dispenser', true))
def('dropper:front', () => dispenserFront('dropper', false))
def('dropper:front:vertical', () => dispenserFront('dropper', true))
def('observer:front', () => {
  const R = R_FURN(); casing(R)
  rect(2, 3, 12, 6, R[1]); inset(2, 3, 12, 6, R[0], R[4])
  rect(4, 5, 3, 2, hx('#17171b')); rect(9, 5, 3, 2, hx('#17171b'))
  rect(5, 11, 6, 2, hx('#17171b')); inset(4, 10, 8, 4, R[0], R[3])
})
def('observer:side', () => { const R = R_FURN(); casing(R); hline(1, 14, 4, R[0]); hline(1, 14, 5, R[4]); hline(1, 14, 11, R[0]); hline(1, 14, 12, R[4]) })
def('observer:top', () => { const R = R_FURN(); casing(R); art(['...aa...', '..aaaa..', '.aaaaaa.', '...aa...', '...aa...', '...aa...', '...aa...'], { a: R[0] }, 4, 4); vline(9, 8, 10, R[4]) })
function observerBack (on: boolean): void {
  const R = R_FURN(); casing(R)
  inset(5, 5, 6, 6, R[0], R[4])
  const L = on ? ramp('#f03a2a', 0.9) : ramp('#5a1c18', 0.9)
  rect(6, 6, 4, 4, L[2]); P(6, 6, L[4]); P(7, 6, L[3]); P(9, 9, L[0])
}
def('observer:back', () => observerBack(false))
def('observer:back:on', () => observerBack(true))

// pistons
def('piston:top', () => { const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0]); frame(1, 1, 14, 14, R[3]) })
def('piston:top:sticky', () => {
  const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0])
  const G = ramp('#74c25c', 0.9)
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) { const d = Math.hypot(x - 7.5, y - 7.5) + (rnd(x, y, SEED) - 0.5) * 2; if (d < 5.6) P(x, y, G[clamp(Math.round(3.6 - d * 0.45), 1, 4)]) }
})
def('piston:inner', () => { const R = R_FURN(); casing(R); rect(6, 6, 4, 4, ramp(C_IRON, 0.6)[2]); inset(5, 5, 6, 6, R[0], R[4]) })
def('piston:bottom', () => { const R = R_FURN(); cobble(ramp('#85878a', 0.85), { n: 3, gap: 1.05, s: hashStr('cobblestone') | 1 }); frame(0, 0, 16, 16, R[1]) })
function pistonBody (band: boolean): void {
  const R = R_FURN()
  cobble(ramp('#85878a', 0.85), { n: 3, gap: 1.05, s: hashStr('cobblestone') | 1 })
  const I = ramp('#9a9da3', 0.7)
  for (let x = 0; x < S; x++) { P(x, 8, I[3]); P(x, 9, I[1]) }
  for (const x of [2, 7, 12]) { P(x, 8, I[4]); P(x + 1, 9, I[0]) }
  if (band) {
    const W = R_OAK()
    for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) P(x, y, rc(W, y === 0 ? 3.4 : y === 3 ? 0.6 : 2 + (rnd(x >> 2, y, SEED) < 0.3 ? -0.5 : 0)))
    for (let x = 0; x < S; x++) P(x, 4, R[0])
  }
}
def('piston:side', () => pistonBody(true))
def('piston:arm', () => { const R = R_OAK(); field(R, (x, y) => ((x + y) & 3) === 0 ? 1.4 : (y & 3) === 0 ? 3 : 2) })

// chests
function chestRamp (kind: string): [Ramp, Ramp] {
  if (kind === 'ender') return [ramp('#22323a', 1), ramp('#3fd0a0', 0.9)]
  if (kind.startsWith('copper_')) return [copperRamp(kind.slice(7)), ramp('#e8dcc0', 0.7)]
  if (kind === 'trapped') return [ramp('#a9772e', 0.85), ramp('#c8342a', 0.9)]
  return [ramp('#a9772e', 0.85), ramp('#c9ccd0', 0.7)]
}
fam('chest', (a) => {
  const [R, L] = chestRamp(a[0])
  const face = a[1]
  if (face === 'top') {
    field(R, (x, y) => 2 + ((y % 5) === 4 ? -1.2 : (y % 5) === 0 ? 0.6 : 0) + (rnd(x >> 2, y, SEED) < 0.2 ? -0.4 : 0))
    frame(1, 1, 14, 14, R[0]); frame(2, 2, 12, 12, R[3]); frame(0, 0, 16, 16, R[1])
    if (a[0] === 'ender') specks(L, 6, 3)
    return
  }
  field(R, (x, y) => 2 + ((y % 5) === 1 ? -1.2 : (y % 5) === 2 ? 0.6 : 0) + (rnd(x >> 2, y, SEED) < 0.2 ? -0.4 : 0))
  // box occupies rows 2..15, columns 1..14
  frame(1, 2, 14, 14, R[0]); frame(2, 3, 12, 12, R[3]); vline(0, 0, 15, R[1]); vline(15, 0, 15, R[1])
  hline(1, 14, 6, R[0]); hline(2, 13, 7, R[4])
  if (a[0] === 'ender') specks(L, 5, 3)
  if (face === 'front') { rect(7, 5, 2, 4, L[2]); P(7, 5, L[4]); P(8, 8, L[0]); P(7, 8, L[1]); hline(6, 9, 4, R[0]); vline(6, 5, 8, R[0]); vline(9, 5, 8, R[0]); hline(6, 9, 9, R[0]) }
})

// barrel
def('barrel:side', () => {
  const R = ramp(WOOD.spruce.planks, 0.8)
  field(R, (x, y) => { const xx = x & 3; return (xx === 3 ? 0.6 : xx === 0 ? 2.8 : 2) + (rnd(x, y >> 2, SEED) < 0.15 ? -0.4 : 0) })
  const I = ramp('#5a5d63', 0.9)
  for (const y of [3, 11]) for (let x = 0; x < S; x++) { P(x, y, I[3]); P(x, y + 1, I[1]) }
})
function barrelEnd (open: boolean, rim: boolean): void {
  const R = ramp(WOOD.spruce.planks, 0.8)
  planks(R, { s: hashStr('barrel') | 1 })
  frame(0, 0, 16, 16, R[0]); frame(1, 1, 14, 14, R[3])
  if (rim) { const I = ramp('#5a5d63', 0.9); frame(2, 2, 12, 12, I[2]) }
  if (open) { rect(4, 4, 8, 8, hx('#1c1410')); inset(3, 3, 10, 10, R[0], R[4]) }
}
def('barrel:top', () => barrelEnd(false, true))
def('barrel:top:open', () => barrelEnd(true, true))
def('barrel:bottom', () => barrelEnd(false, false))

// shelves of books
const BOOK_COLORS = ['#b83a2e', '#2f6fb0', '#3f8f3f', '#c9a23a', '#7a3fa0', '#b8622a', '#3a9a94', '#8a8a8a']
function bookRow (y0: number, h: number, s: number, gapEvery = 0): void {
  let x = 1
  let i = 0
  while (x < 15) {
    const w = 1 + rint(i, 0, s, 2)
    const tall = h - rint(i, 1, s, 3)
    if (gapEvery > 0 && i % gapEvery === gapEvery - 1) { x += w; i++; continue }
    const R = ramp(BOOK_COLORS[rint(i, 2, s, BOOK_COLORS.length)], 0.85)
    for (let k = 0; k < w && x + k < 15; k++) {
      for (let j = h - tall; j < h; j++) Q(x + k, y0 + j, R[k === 0 ? 3 : 1])
      Q(x + k, y0 + h - tall, R[4])
    }
    if (tall > 3) Q(x, y0 + h - tall + 2, hx('#e8d9a0'))
    x += w; i++
  }
}
def('bookshelf', () => {
  const R = R_OAK()
  fill(hx('#2a1c12'))
  for (const y of [0, 7, 8, 15]) for (let x = 0; x < S; x++) P(x, y, R[y === 0 || y === 8 ? 3 : 1])
  vline(0, 0, 15, R[2]); vline(15, 0, 15, R[1])
  bookRow(1, 6, SEED); bookRow(9, 6, SEED + 5)
})
def('chiseled_bookshelf:front', () => {
  const R = ramp(WOOD.oak.planks, 0.8)
  planks(R, { s: hashStr('planks:oak') | 1 })
  frame(0, 0, 16, 16, R[0])
  for (const y of [2, 9]) for (const x of [1, 6, 11]) { rect(x, y, 4, 5, hx('#2a1c12')); inset(x, y, 4, 5, R[0], R[4]) }
  for (const [x, y, c] of [[2, 3, 0], [12, 3, 3], [7, 10, 1], [12, 10, 4]] as Array<[number, number, number]>) { const B = ramp(BOOK_COLORS[c], 0.85); rect(x, y, 2, 4, B[2]); vline(x, y, y + 3, B[3]); P(x, y, B[4]) }
})
def('chiseled_bookshelf:side', () => { const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0]); frame(1, 1, 14, 14, R[3]) })
def('chiseled_bookshelf:top', () => { const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0]) })

def('crafting_table:top', () => {
  const R = ramp('#b8894e', 0.8)
  planks(R)
  const Dk = ramp('#5a3d22', 0.8)
  frame(0, 0, 16, 16, Dk[1]); frame(1, 1, 14, 14, Dk[3])
  for (const k of [5, 10]) { vline(k, 2, 13, Dk[2]); hline(2, 13, k, Dk[2]) }
})
function craftingSide (front: boolean): void {
  const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 })
  const Dk = ramp('#5a3d22', 0.8)
  for (let x = 0; x < S; x++) { P(x, 0, Dk[3]); P(x, 1, Dk[2]); P(x, 2, Dk[0]) }
  vline(0, 3, 15, Dk[2]); vline(15, 3, 15, Dk[1])
  const I = ramp('#b9bcc2', 0.7); const H = ramp('#7a5a34', 0.8)
  if (front) {
    // hammer and saw
    art(['.iii', '.iii', '..h.', '..h.', '..h.', '..h.'], { i: I[2], h: H[2] }, 2, 5)
    P(3, 5, I[4])
    art(['h....', 'hiiii', '.iiii', '.i.i.'], { i: I[2], h: H[2] }, 8, 6)
    hline(9, 12, 7, I[4])
  } else {
    // shears and pliers
    art(['i...i', '.i.i.', '..i..', '.h.h.', 'h...h', 'h...h'], { i: I[3], h: H[2] }, 3, 5)
    art(['.ii.', '.ii.', '.ii.', '.hh.', '.hh.'], { i: I[2], h: H[1] }, 10, 6)
  }
}
def('crafting_table:front', () => craftingSide(true))
def('crafting_table:side', () => craftingSide(false))

def('jukebox:side', () => { const R = ramp('#6e4530', 0.85); planks(R); frame(0, 0, 16, 16, R[0]); inset(2, 3, 12, 10, R[0], R[4]) })
def('jukebox:top', () => {
  const R = ramp('#6e4530', 0.85); planks(R); frame(0, 0, 16, 16, R[0]); frame(1, 1, 14, 14, R[3])
  rect(3, 3, 10, 10, hx('#1b1a1f')); inset(3, 3, 10, 10, R[0], R[4])
  hline(5, 10, 7, hx('#3a3840')); hline(5, 10, 8, hx('#0e0d11'))
})
def('note_block', () => {
  const R = ramp('#6e4530', 0.85); planks(R); frame(0, 0, 16, 16, R[0]); inset(3, 3, 10, 10, R[0], R[4])
  art(['...aa', '...a.', '...a.', '.aaa.', 'aaaa.', '.aa..'], { a: R[0] }, 5, 5)
  P(6, 8, R[4])
})
function tntSide (): void {
  const R = ramp('#c7372c', 0.9)
  field(R, (x) => [3, 2.4, 2, 1.2][x & 3])
  const W = ramp('#ece8dc', 0.5)
  for (let y = 5; y < 11; y++) for (let x = 0; x < S; x++) P(x, y, W[y === 5 ? 4 : y === 10 ? 1 : 2])
  const K = hx('#26262b')
  art(['aaa.a.a.aaa', '.a..aaa..a.', '.a..a.a..a.', '.a..a.a..a.'], { a: K }, 3, 6)
  for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 15, R[0]) }
}
def('tnt:side', tntSide)
def('tnt:top', () => {
  const R = ramp('#c7372c', 0.9)
  field(R, (x, y) => { const d = Math.hypot((x & 3) - 1.5, (y & 3) - 1.5); return d < 1 ? 3 : d < 1.9 ? 2 : 1 })
  const W = ramp('#ece8dc', 0.5)
  rect(6, 6, 4, 4, W[2]); P(7, 7, hx('#26262b')); P(8, 8, hx('#26262b')); P(6, 6, W[4])
})
def('tnt:bottom', () => { const R = ramp('#c7372c', 0.9); field(R, (x, y) => { const d = Math.hypot((x & 3) - 1.5, (y & 3) - 1.5); return d < 1 ? 3 : d < 1.9 ? 2 : 1 }) })
function targetFace (top: boolean): void {
  const Hy = ramp('#d8c088', 0.7); const Rd = ramp('#d8483a', 0.85); const W = ramp('#f2ede2', 0.5)
  field(Hy, (x, y) => 2 + (((top ? x : y) & 1) === 0 ? 0.5 : -0.3))
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) + (Math.abs(x - 7.5) > 5 && Math.abs(y - 7.5) > 5 ? 1.2 : 0)
    if (m < 1.5) P(x, y, Rd[3]); else if (m < 3.5) P(x, y, W[2]); else if (m < 5.5) P(x, y, Rd[2]); else if (m < 6.5) P(x, y, W[1])
  }
}
def('target:side', () => targetFace(false))
def('target:top', () => targetFace(true))

// work stations
function stationSide (wood: string, s: number): Ramp { const R = ramp(woodOf(wood).planks, 0.8); planks(R, { s }); return R }
def('loom:top', () => { const R = stationSide('oak', SEED); frame(0, 0, 16, 16, R[0]); for (const y of [4, 8, 12]) { hline(2, 13, y, ramp('#e8e2d4', 0.5)[2]); hline(2, 13, y + 1, R[1]) } })
def('loom:side', () => { const R = stationSide('oak', SEED); frame(0, 0, 16, 16, R[0]); inset(2, 2, 12, 5, R[0], R[4]); rect(3, 3, 10, 3, hx('#3a2a1c')) })
def('loom:front', () => {
  const R = stationSide('oak', SEED); frame(0, 0, 16, 16, R[0])
  rect(2, 2, 12, 8, hx('#3a2a1c'))
  const Th = ramp('#e8e2d4', 0.6)
  for (let x = 3; x < 13; x += 2) vline(x, 2, 9, Th[(x & 2) === 0 ? 3 : 1])
  hline(2, 13, 10, R[4]); hline(3, 12, 5, ramp('#c8483a')[2])
  rect(5, 12, 6, 2, R[1])
})
def('cartography_table:top', () => {
  const R = stationSide('dark_oak', SEED); frame(0, 0, 16, 16, R[0])
  const Pp = ramp('#e2d8b8', 0.6)
  rect(2, 2, 12, 12, Pp[2]); raised(2, 2, 12, 12, Pp[4], Pp[0])
  art(['..a...b.', '.aa..bb.', '.a..b...', '...bb.a.', '.b....a.', '.bb..aa.'], { a: hx('#5a8a4a'), b: hx('#4a7ab0') }, 4, 5)
  P(11, 4, hx('#c8342a'))
})
def('cartography_table:side', () => {
  const R = stationSide('dark_oak', SEED); frame(0, 0, 16, 16, R[0])
  const Pp = ramp('#e2d8b8', 0.6)
  for (let x = 0; x < S; x++) { P(x, 0, Pp[3]); P(x, 1, Pp[1]) }
  inset(2, 5, 5, 8, R[0], R[4]); inset(9, 5, 5, 8, R[0], R[4]); P(4, 8, ramp('#d8b24a')[3]); P(11, 8, ramp('#d8b24a')[3])
})
def('fletching_table:top', () => {
  const R = stationSide('birch', SEED); frame(0, 0, 16, 16, R[0])
  art(['.....a', '....a.', '.b.a..', '..b...', '.c.b..', 'c.....'], { a: hx('#e8e8e8'), b: hx('#8a6a3a'), c: hx('#4a4a50') }, 5, 5)
})
def('fletching_table:side', () => {
  const R = stationSide('birch', SEED); frame(0, 0, 16, 16, R[0])
  const Sd = ramp('#d8c9a0', 0.6)
  for (let x = 0; x < S; x++) { P(x, 0, Sd[4]); P(x, 1, Sd[2]); P(x, 2, R[0]) }
  art(['.aaa.', 'a.b.a', 'abcba', 'a.b.a', '.aaa.'], { a: hx('#c8483a'), b: hx('#f2ede2'), c: hx('#c8483a') }, 5, 6)
})
def('smithing_table:top', () => { const R = R_DARKIRON(); casing(R); inset(2, 2, 12, 12, R[0], R[4]); for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) P(x, y, R[4]) })
def('smithing_table:side', () => {
  const R = stationSide('dark_oak', SEED); frame(0, 0, 16, 16, R[0])
  const I = R_DARKIRON()
  for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) P(x, y, I[y === 0 ? 4 : y === 3 ? 0 : 2])
  inset(3, 6, 10, 8, R[0], R[4])
  art(['.aa.', 'aaaa', '.aa.', '.b..', '.b..'], { a: ramp(C_IRON, 0.6)[2], b: hx('#7a5a34') }, 6, 7)
})
def('smithing_table:bottom', () => { const R = stationSide('dark_oak', SEED); frame(0, 0, 16, 16, R[0]) })
def('stonecutter:side', () => { const R = R_FURN(); casing(R); for (let x = 0; x < S; x++) { P(x, 7, R[4]); P(x, 8, R[3]); P(x, 15, R[0]) } const W = R_OAK(); for (let y = 11; y < 14; y++) for (let x = 2; x < 14; x++) P(x, y, W[y === 11 ? 3 : y === 13 ? 1 : 2]) })
def('stonecutter:top', () => {
  const R = R_FURN(); casing(R)
  const I = ramp(C_IRON, 0.6)
  rect(2, 7, 12, 2, hx('#2a2a2f'))
  for (let x = 3; x < 13; x++) P(x, 7, I[(x & 1) === 0 ? 4 : 2])
  hline(3, 12, 8, I[1])
})
def('grindstone:side', () => {
  const R = ramp('#8d8f93', 0.8)
  field(R, (x, y) => { const d = Math.hypot(x - 7.5, y - 6); return d < 2 ? 1 : (Math.floor(d) & 1) === 0 ? 2.4 : 1.8 })
  const W = ramp(WOOD.dark_oak.planks, 0.9); rect(7, 5, 2, 2, W[2])
})
def('grindstone:top', () => { const R = ramp('#8d8f93', 0.8); field(R, (x, y) => ((y & 3) === 0 ? 1.4 : (y & 3) === 1 ? 2.8 : 2) + (rnd(x, y, SEED) < 0.15 ? -0.4 : 0)) })
def('lectern:side', () => {
  const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 })
  rect(4, 4, 8, 9, hx('#2a1c12')); inset(4, 4, 8, 9, R[0], R[4])
  bookRow(5, 3, SEED); bookRow(9, 3, SEED + 3)
  for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 2, R[0]); P(x, 13, R[4]) }
})
def('lectern:top', () => {
  const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0])
  const Pg = ramp('#efe8d2', 0.5); const Cv = ramp('#8a3a2a', 0.9)
  rect(2, 3, 12, 10, Cv[2]); rect(3, 4, 5, 8, Pg[2]); rect(8, 4, 5, 8, Pg[3]); vline(8, 4, 11, Pg[0])
  for (let y = 5; y < 11; y += 2) { hline(4, 6, y, Pg[0]); hline(10, 12, y, Pg[1]) }
})
def('composter:side', () => {
  const R = ramp('#8a6238', 0.85)
  field(R, (x, y) => { const xx = x & 3; return (xx === 3 ? 0.6 : xx === 0 ? 2.8 : 2) + (rnd(x, y >> 2, SEED) < 0.15 ? -0.4 : 0) })
  for (const y of [0, 5, 10, 15]) for (let x = 0; x < S; x++) P(x, y, R[y === 15 ? 0 : 1])
  for (const y of [1, 6, 11]) for (let x = 0; x < S; x++) P(x, y, R[3])
})
def('composter:top', () => {
  const R = ramp('#8a6238', 0.85); fill(R[2]); frame(0, 0, 16, 16, R[3]); frame(1, 1, 14, 14, R[1])
  const So = ramp('#4a3420', 0.9)
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) P(x, y, So[clamp(Math.round(2 + (rnd(x, y, SEED) - 0.5) * 2.4), 1, 3)])
  hline(2, 13, 2, So[0]); vline(2, 2, 13, So[0])
})
def('hopper:side', () => { const R = R_DARKIRON(); casing(R); for (let x = 0; x < S; x++) { P(x, 4, R[0]); P(x, 5, R[4]) } for (const x of [2, 13]) { P(x, 2, R[4]); P(x, 8, R[3]) } })
def('hopper:top', () => { const R = R_DARKIRON(); fill(R[2]); frame(0, 0, 16, 16, R[4]); frame(1, 1, 14, 14, R[1]); rect(2, 2, 12, 12, hx('#1a1b1f')); rect(6, 6, 4, 4, hx('#0c0c0f')); inset(2, 2, 12, 12, hx('#0c0c0f'), R[1]) })
def('cauldron:side', () => { const R = R_DARKIRON(); casing(R); for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 2, R[0]); P(x, 12, R[0]); P(x, 13, R[3]) } })
function cauldronTop (content: string): void {
  const R = R_DARKIRON(); fill(R[2]); frame(0, 0, 16, 16, R[4]); frame(1, 1, 14, 14, R[1])
  let C2: Ramp
  if (content === 'water') C2 = ramp(C_WATER, 0.75)
  else if (content === 'lava') C2 = FIRE
  else if (content === 'snow') C2 = ramp(C_SNOW, 0.45)
  else C2 = ramp('#2c2d33', 0.8)
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) P(x, y, C2[clamp(Math.round(2 + (vn(x, y, 3, 3, SEED) - 0.5) * 3), 1, 3)])
  if (content === '') { hline(2, 13, 2, hx('#141418')); vline(2, 2, 13, hx('#141418')) }
}
def('cauldron:top', () => cauldronTop(''))
def('cauldron:top:water', () => cauldronTop('water'))
def('cauldron:top:lava', () => cauldronTop('lava'))
def('cauldron:top:snow', () => cauldronTop('snow'))
def('brewing_stand', () => {
  const St = ramp('#7b7e82', 0.75); const Rd = ramp('#e8b830', 0.9)
  field(Rd, (x, y) => ((x & 1) === 0 ? 3 : 1.6) + ((y & 3) === 0 ? -0.6 : 0))
  for (let y = 14; y < S; y++) for (let x = 0; x < S; x++) P(x, y, St[y === 14 ? 3 : 1])
})
def('brewing_stand:top', () => { const St = ramp('#7b7e82', 0.75); tex(St, { gain: 2 }); const Rd = ramp('#e8b830', 0.9); rect(7, 7, 2, 2, Rd[3]); for (const [x, y] of [[3, 7], [11, 4], [11, 11]]) { rect(x, y, 2, 2, St[0]) } })
def('enchanting_table:top', () => {
  const Ob = ramp('#19131f', 1.2); tex(Ob, { p: 3, q: 6, gain: 3, lit: 3 })
  const Rd = ramp('#a8262a', 0.9); const Di = ramp('#62e3da', 0.85)
  rect(3, 3, 10, 10, Rd[2]); raised(3, 3, 10, 10, Rd[4], Rd[0])
  for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) { rect(x, y, 2, 2, Di[2]); P(x, y, Di[4]) }
  art(['.a..a.', 'a.aa.a', '.a..a.', '.aaaa.'], { a: hx('#f2d8a0') }, 5, 6)
})
def('enchanting_table:side', () => {
  const Ob = ramp('#19131f', 1.2); tex(Ob, { p: 3, q: 6, gain: 3, lit: 3 })
  const Rd = ramp('#a8262a', 0.9); const Di = ramp('#62e3da', 0.85)
  for (let y = 4; y < 8; y++) for (let x = 0; x < S; x++) P(x, y, Rd[y === 4 ? 4 : y === 7 ? 0 : 2])
  for (const x of [0, 13]) { rect(x, 4, 3, 4, Di[2]); P(x, 4, Di[4]) }
  for (let x = 4; x < 12; x += 2) P(x, 6, hx('#f2d8a0'))
})
function portalFrameTop (eye: boolean): void {
  const E = ramp('#dadb9d', 0.6); cobble(E, { n: 4, gap: 0.7, tones: [1.6, 2, 2, 2.4, 2.8], lightK: 0.8, s: hashStr('end_stone') | 1 })
  const G = ramp('#2f6f62', 0.9)
  frame(0, 0, 16, 16, G[2]); frame(1, 1, 14, 14, G[3]); frame(3, 3, 10, 10, G[1])
  rect(4, 4, 8, 8, hx('#10221f'))
  if (eye) { const Ey = ramp('#3fae86', 0.9); for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 4) P(x, y, Ey[clamp(Math.round(4 - d), 1, 4)]) } rect(7, 6, 2, 4, hx('#0c1a16')) }
}
def('end_portal_frame:top', () => portalFrameTop(false))
def('end_portal_frame:top:eye', () => portalFrameTop(true))
def('end_portal_frame:side', () => {
  const E = ramp('#dadb9d', 0.6); cobble(E, { n: 4, gap: 0.7, tones: [1.6, 2, 2, 2.4, 2.8], lightK: 0.8, s: hashStr('end_stone') | 1 })
  const G = ramp('#2f6f62', 0.9)
  for (let y = 0; y < 8; y++) for (let x = 0; x < S; x++) P(x, y, G[y === 3 ? 4 : y === 7 ? 0 : y < 3 ? 3 : ((x + y) & 3) === 0 ? 1 : 2])
  for (let x = 1; x < S; x += 4) { P(x, 5, G[4]); P(x + 1, 5, G[0]) }
})
function anvilTop (wear: number): void {
  const R = R_DARKIRON(); tex(R, { p: 2, q: 4, py: 5, qy: 9, gain: 2, lo: 1, hi: 3 })
  for (let y = 0; y < S; y++) { P(3, y, R[4]); P(12, y, R[0]) }
  for (let i = 0; i < wear * 5; i++) { const x = 4 + rint(i, 0, SEED, 8); const y = rint(i, 1, SEED, 16); P(x, y, R[0]); P(x + 1, y + 1, R[0]); P(x, y + 1, R[4]) }
}
def('anvil', () => { const R = R_DARKIRON(); tex(R, { p: 3, q: 6, gain: 2, lo: 1, hi: 3 }); for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 5, R[0]); P(x, 6, R[3]); P(x, 11, R[0]) } })
def('anvil:top', () => anvilTop(0))
def('anvil:top:chipped', () => anvilTop(1))
def('anvil:top:damaged', () => anvilTop(2))
def('bell', () => {
  const R = ramp('#e2b23a', 0.95)
  field(R, (x, y) => [3.4, 3, 2.4, 2, 2, 1.6, 1.2, 0.8][(x + 4) & 7] + (y === 9 || y === 2 ? -1 : y === 10 || y === 3 ? 0.6 : 0))
})
def('beacon', () => {
  const Gl = ramp('#bfe6ee', 0.6)
  fill(Gl[2])
  bevel(Gl, 1, 4, 1)
  const Ob = ramp('#19131f', 1.2)
  for (let y = 13; y < 15; y++) for (let x = 2; x < 14; x++) P(x, y, Ob[y === 13 ? 3 : 1])
  const Cr: Ramp = [hx('#3fb8c0'), hx('#6fdde0'), hx('#a8f2f0'), hx('#dafcf8'), hx('#ffffff')]
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); P(x, y, Cr[clamp(Math.round(4.4 - d), 0, 4)]) }
  for (const [x, y] of [[2, 3], [3, 2], [12, 11], [11, 12]]) P(x, y, Gl[4])
})
def('conduit', () => {
  const R = ramp('#a8875a', 0.9); tex(R, { gain: 2.4 })
  frame(5, 5, 6, 6, R[0]); rect(6, 6, 4, 4, R[3])
  const Cy = ramp('#3fc4d8', 0.9); rect(7, 7, 2, 2, Cy[3]); P(7, 7, Cy[4])
})
def('end_rod', () => { const R = ramp('#f2ecf8', 0.5); field(R, (x, y) => ((x & 1) === 0 ? 3 : 2) + ((y & 7) === 0 ? -0.5 : 0)) })
def('heavy_core', () => {
  const R = ramp('#4a4c54', 0.9); tex(R, { gain: 2 })
  for (let y = 8; y < S; y++) for (let x = 4; x < 12; x++) P(x, y, R[y === 8 ? 4 : y === 15 ? 0 : x === 4 ? 3 : x === 11 ? 1 : 2])
  rect(6, 10, 4, 4, R[1]); inset(6, 10, 4, 4, R[0], R[4]); rect(4, 4, 8, 8, R[2]); raised(4, 4, 8, 8, R[4], R[0])
})
def('decorated_pot:side', () => {
  const R = ramp('#9a5a3e', 0.8); terracotta(hx('#9a5a3e'))
  for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 3, R[0]); P(x, 4, R[4]); P(x, 12, R[0]); P(x, 13, R[4]) }
  for (let k = 0; k < 4; k++) art(['.a.', 'a.a', '.a.'], { a: R[0] }, 1 + k * 4, 7)
})
def('decorated_pot:top', () => {
  const R = ramp('#9a5a3e', 0.8); terracotta(hx('#9a5a3e')); bevel(R, 1, 3.6, 0.8)
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 3.2) P(x, y, hx('#1c120e')); else if (d < 4.4) P(x, y, R[d < 3.8 ? 0 : 4]) }
})
function potShape (): void {
  const R = ramp('#9a5a3e', 0.85)
  for (let y = 10; y < S; y++) {
    const inset2 = y >= 14 ? 1 : 0
    for (let x = 5 + inset2; x <= 10 - inset2; x++) Q(x, y, R[y === 10 ? 4 : y === 11 ? 1 : x === 5 + inset2 ? 3 : x === 10 - inset2 ? 1 : 2])
  }
}
def('flower_pot:side', () => { clear(); potShape() })
def('flower_pot:top', () => {
  clear()
  const R = ramp('#9a5a3e', 0.85); const So = ramp('#5a3d26', 0.9)
  rect(5, 5, 6, 6, R[2]); raised(5, 5, 6, 6, R[4], R[0])
  rect(6, 6, 4, 4, So[2]); P(6, 6, So[1]); P(8, 7, So[3]); P(7, 9, So[1])
})
function redstoneLamp (lit: boolean): void {
  const R: Ramp = lit
    ? [hx('#a8641c'), hx('#dc9a34'), hx('#f6c858'), hx('#fde49a'), hx('#fff8dc')]
    : [hx('#2e1a12'), hx('#4a2c1c'), hx('#6a3f26'), hx('#8a5632'), hx('#a8704a')]
  field(R, (x, y) => {
    const cx = (x + 2) & 3; const cy = (y + 2) & 3
    const d = Math.abs(cx - 1.5) + Math.abs(cy - 1.5)
    return d > 2.5 ? 0.6 : d > 1.5 ? 2 : 3.4
  })
  const Fr = ramp('#3a2a22', 0.9)
  frame(0, 0, 16, 16, Fr[lit ? 3 : 2]); P(0, 0, Fr[4]); P(15, 15, Fr[0])
}
def('redstone_lamp', () => redstoneLamp(false))
def('redstone_lamp:lit', () => redstoneLamp(true))
function slabTop (): Ramp { const R = ramp('#9c9ea1', 0.6); tex(R, { p: 3, q: 5, gain: 1.5, lit: 1, jit: 0.3, lo: 1, hi: 3, s: hashStr('smooth_stone') | 1 }); frame(0, 0, 16, 16, R[1]); return R }
function torchDot (x: number, y: number, on: boolean): void {
  const L = on ? ramp('#f03a2a', 0.9) : ramp('#6a1c16', 0.9)
  rect(x, y, 2, 2, L[2]); P(x, y, L[4]); P(x + 1, y + 1, L[0])
  frame(x - 1, y - 1, 4, 4, hx('#5a4a3a'))
}
function repeaterTop (on: boolean, comparator: boolean): void {
  slabTop()
  const L = on ? ramp('#e02a1e', 0.9) : ramp('#5a1410', 0.9)
  if (comparator) {
    vline(7, 3, 12, L[2]); vline(8, 3, 12, L[1]); hline(4, 11, 11, L[2])
    torchDot(7, 2, on); torchDot(3, 11, on); torchDot(11, 11, on)
  } else {
    vline(7, 2, 13, L[2]); vline(8, 2, 13, L[1])
    art(['..aa..', '.aaaa.', 'aaaaaa'], { a: L[3] }, 5, 1)
    torchDot(7, 4, on); torchDot(7, 10, on)
  }
}
def('repeater:top', () => repeaterTop(false, false))
def('repeater:top:on', () => repeaterTop(true, false))
def('comparator:top', () => repeaterTop(false, true))
def('comparator:top:on', () => repeaterTop(true, true))
function daylightTop (inverted: boolean): void {
  const R = inverted ? ramp('#8a96b8', 0.7) : ramp('#d8cba8', 0.6)
  field(R, (x, y) => ((x & 3) === 3 || (y & 3) === 3) ? 0.8 : ((x & 3) === 0 || (y & 3) === 0) ? 3.2 : 2.2)
  const W = ramp(WOOD.oak.planks, 0.8); frame(0, 0, 16, 16, W[1])
}
def('daylight_detector:top', () => daylightTop(false))
def('daylight_detector:top:inverted', () => daylightTop(true))
def('daylight_detector:side', () => { const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); for (let x = 0; x < S; x++) { P(x, 10, ramp('#d8cba8', 0.6)[3]); P(x, 11, R[0]) } })

// sculk
function sculkBase (s = SEED): Ramp {
  const R = ramp('#0f222b', 1.1)
  tex(R, { p: 4, q: 8, gain: 3, lit: 3, s })
  const Cy = ramp('#2ac8c4', 0.9)
  for (let i = 0; i < 7; i++) { const x = rint(i, 0, s + 3, 16); const y = rint(i, 1, s + 3, 16); P(x, y, Cy[2 + (i & 1)]); if (i % 3 === 0) P(x + 1, y, Cy[1]) }
  return R
}
def('sculk', () => { sculkBase() })
def('sculk_vein', () => {
  clear()
  const R = ramp('#123a44', 1); const Cy = ramp('#2ac8c4', 0.9)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = vn(x, y, 5, 5, SEED) * 0.6 + vn(x, y, 9, 9, SEED + 2) * 0.4
    if (Math.abs(v - 0.5) < 0.07) P(x, y, R[2 + ((x + y) & 1)]); else if (v > 0.78) P(x, y, Cy[2])
  }
})
function sculkSensorTop (calibrated: boolean, on: boolean): void {
  const R = sculkBase(hashStr('sculk') | 1)
  const Cy = on ? ramp('#5af0e8', 0.8) : ramp('#1f8f96', 0.9)
  frame(0, 0, 16, 16, R[3]); frame(2, 2, 12, 12, R[0])
  for (const [x, y] of [[1, 1], [12, 1], [1, 12], [12, 12]]) { rect(x, y, 3, 3, Cy[2]); P(x, y, Cy[4]); P(x + 2, y + 2, Cy[0]) }
  if (calibrated) { const Am = ramp('#a86ae0', 0.9); rect(6, 6, 4, 4, Am[2]); P(6, 6, Am[4]); P(9, 9, Am[0]) }
}
def('sculk_sensor:top', () => sculkSensorTop(false, false))
def('sculk_sensor:top:on', () => sculkSensorTop(false, true))
def('sculk_sensor:top:calibrated', () => sculkSensorTop(true, false))
def('sculk_sensor:top:calibrated:on', () => sculkSensorTop(true, true))
def('sculk_sensor:side', () => { const R = sculkBase(hashStr('sculk') | 1); for (let x = 0; x < S; x++) { P(x, 8, R[4]); P(x, 9, R[3]) } const Cy = ramp('#1f8f96', 0.9); for (let x = 1; x < S; x += 5) { vline(x, 10, 13, Cy[2]); P(x, 10, Cy[4]) } })
def('sculk_shrieker:top', () => {
  const R = sculkBase(hashStr('sculk') | 1)
  const Bn = ramp('#d8d4b8', 0.7)
  frame(0, 0, 16, 16, Bn[2]); frame(1, 1, 14, 14, Bn[0])
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 2) P(x, y, hx('#04090c')); else if (d < 3.2) P(x, y, Bn[3]); else if (d < 4.4) P(x, y, R[0]) }
})
def('sculk_shrieker:side', () => { const R = sculkBase(hashStr('sculk') | 1); const Bn = ramp('#d8d4b8', 0.7); for (let x = 0; x < S; x++) { P(x, 8, Bn[4]); P(x, 9, Bn[2]); P(x, 10, Bn[0]) } for (let x = 2; x < S; x += 4) vline(x, 11, 13, R[0]) })
def('sculk_catalyst:top', () => {
  const Bn = ramp('#d8d4b8', 0.7); tex(Bn, { gain: 2.4 })
  const R = ramp('#0f222b', 1.1); const Cy = ramp('#2ac8c4', 0.9)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = vn(x, y, 3, 3, SEED) + Math.hypot(x - 7.5, y - 7.5) * 0.06; if (v < 0.62) P(x, y, R[clamp(Math.round(1 + v * 3), 1, 3)]) }
  P(7, 7, Cy[4]); P(8, 8, Cy[2]); P(4, 9, Cy[2]); P(10, 5, Cy[3])
})
def('sculk_catalyst:side', () => {
  const Bn = ramp('#d8d4b8', 0.7); tex(Bn, { gain: 2.4 })
  const R = ramp('#0f222b', 1.1); const Cy = ramp('#2ac8c4', 0.9)
  for (let x = 0; x < S; x++) { const h = 7 + Math.round(vn(x, 0, 5, 1, SEED) * 5); for (let y = h; y < S; y++) P(x, y, R[clamp(Math.round(1.5 + rnd(x, y, SEED) * 2), 1, 3)]) }
  P(3, 13, Cy[3]); P(11, 12, Cy[2]); P(8, 14, Cy[4])
})

// respawn anchor, crafter, creaking heart, technical blocks
function anchorTop (on: boolean): void {
  const Ob = ramp('#19131f', 1.2); tex(Ob, { p: 3, q: 6, gain: 3.4, lit: 4, s: hashStr('obsidian') | 1 })
  const G = ramp('#8f3fe0', 0.9)
  frame(0, 0, 16, 16, Ob[3]); frame(3, 3, 10, 10, G[1])
  const In: Ramp = on ? [hx('#5a1a9a'), hx('#8f3fe0'), hx('#c98af8'), hx('#f6d860'), hx('#fff6c8')] : [hx('#08060c'), hx('#100c16'), hx('#19131f'), hx('#241c2c'), hx('#30263a')]
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) P(x, y, In[clamp(Math.round(4.2 - Math.hypot(x - 7.5, y - 7.5) + (rnd(x, y, SEED) - 0.5)), 0, 4)])
}
def('respawn_anchor:top', () => anchorTop(false))
def('respawn_anchor:top:on', () => anchorTop(true))
function anchorSide (on: boolean): void {
  const Ob = ramp('#19131f', 1.2); tex(Ob, { p: 3, q: 6, gain: 3.4, lit: 4, s: hashStr('obsidian') | 1 })
  const G = ramp('#8f3fe0', 0.9); const Y = ramp('#f6d860', 0.8)
  frame(0, 0, 16, 16, Ob[3])
  for (let k = 0; k < 4; k++) { const x = 2 + k * 3; rect(x, 5, 2, 6, on ? Y[2] : Ob[0]); inset(x - 1, 4, 4, 8, Ob[0], Ob[4]); if (on) { P(x, 5, Y[4]); P(x + 1, 10, Y[0]) } }
  for (let i = 0; i < 4; i++) { const x = rint(i, 0, SEED, 16); const y = 12 + rint(i, 1, SEED, 3); P(x, y, G[3]); P(x, y + 1, G[1]) }
}
def('respawn_anchor:side', () => anchorSide(false))
def('respawn_anchor:side:on', () => anchorSide(true))
def('respawn_anchor:bottom', () => { const Ob = ramp('#19131f', 1.2); tex(Ob, { p: 3, q: 6, gain: 3.4, lit: 4, s: hashStr('obsidian') | 1 }); frame(0, 0, 16, 16, Ob[3]) })
def('crafter:top', () => {
  const R = R_FURN(); casing(R)
  const W = R_OAK()
  rect(2, 2, 12, 12, W[2]); inset(2, 2, 12, 12, R[0], R[4])
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { rect(3 + i * 4, 3 + j * 4, 2, 2, hx('#2a1c12')); P(4 + i * 4, 4 + j * 4, hx('#4a3424')) }
})
def('crafter:side', () => { const R = R_FURN(); casing(R); const W = R_OAK(); for (let y = 3; y < 9; y++) for (let x = 1; x < 15; x++) P(x, y, W[y === 3 ? 3 : y === 8 ? 0 : (x & 3) === 0 ? 1 : 2]); for (const x of [3, 12]) { P(x, 11, R[4]); P(x, 12, R[0]) } })
def('crafter:front', () => {
  const R = R_FURN(); casing(R); inset(3, 3, 10, 10, R[0], R[4])
  rect(5, 5, 6, 6, hx('#17171b')); frame(4, 4, 8, 8, R[1])
  const Rd = ramp('#e02a1e', 0.9); P(7, 12, Rd[3]); P(8, 12, Rd[1])
})
def('crafter:bottom', () => { const R = R_FURN(); casing(R); inset(4, 4, 8, 8, R[0], R[4]) })
function creakingSide (awake: boolean): void {
  logSide('pale_oak')
  const O2: Ramp = awake ? [hx('#b8440c'), hx('#e8700e'), hx('#f79a1c'), hx('#fdc84a'), hx('#fff0b8')] : [hx('#1c1814'), hx('#2a241e'), hx('#3a322a'), hx('#4a4036'), hx('#5a4e42')]
  for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) { const d = Math.hypot((x - 7.5) * 1.2, y - 7.5) + (rnd(x, y, SEED) - 0.5) * 1.6; if (d < 4.2) P(x, y, O2[clamp(Math.round(4 - d), 0, 4)]) }
}
def('creaking_heart:side', () => creakingSide(false))
def('creaking_heart:side:awake', () => creakingSide(true))
function creakingTop (awake: boolean): void {
  const w = WOOD.pale_oak; rings(ramp(w.bark, 0.9), ramp(w.inner, 0.7))
  const c = awake ? hx('#f79a1c') : hx('#3a322a')
  rect(6, 6, 4, 4, c); P(6, 6, awake ? hx('#fff0b8') : hx('#5a4e42'))
}
def('creaking_heart:top', () => creakingTop(false))
def('creaking_heart:top:awake', () => creakingTop(true))
function techBlock (hex: string, glyph: string[], accent: string): void {
  const R = ramp(hex, 0.85)
  tex(R, { p: 3, q: 5, gain: 1.4, lo: 1, hi: 3 })
  bevel(R, 1, 3.6, 0.6)
  inset(2, 2, 12, 12, R[0], R[4])
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) P(x, y, R[4])
  art(glyph, { a: hx(accent), b: R[0] }, 8 - (glyph[0].length >> 1), 8 - (glyph.length >> 1))
}
const GLYPH: Record<string, string[]> = {
  save: ['aaaaaa', 'a.bb.a', 'a....a', 'a.aa.a', 'a.aa.a', 'aaaaaa'],
  load: ['..aa..', '..aa..', 'aaaaaa', '.aaaa.', '..aa..', 'bbbbbb'],
  corner: ['aaaaaa', 'a.....', 'a.....', 'a.....', 'a.....', 'a.....'],
  data: ['.aaaa.', 'a....a', 'a.aa.a', 'a.aa.a', 'a....a', '.aaaa.'],
  start: ['a.....', 'aaa...', 'aaaaa.', 'aaaaa.', 'aaa...', 'a.....'],
  log: ['aaaaaa', '......', 'aaaa..', '......', 'aaaaa.', '......'],
  fail: ['a....a', '.a..a.', '..aa..', '..aa..', '.a..a.', 'a....a'],
  accept: ['.....a', '....a.', 'a..a..', '.aa...', '.a....', '......'],
  instance: ['aa..aa', 'a....a', '......', '......', 'a....a', 'aa..aa'],
  front: ['..aa..', '.aaaa.', 'aaaaaa', '..aa..', '..aa..', '..aa..'],
  back: ['......', '.aaaa.', '.a..a.', '.a..a.', '.aaaa.', '......'],
  side: ['..a...', '..aa..', 'aaaaa.', 'aaaaa.', '..aa..', '..a...']
}
fam('structure_block', (a) => techBlock('#6a5a78', GLYPH[a[0]] ?? GLYPH.data, '#d8c8e8'))
fam('test_block', (a) => techBlock(({ start: '#4a8a5a', log: '#5a6a8a', fail: '#9a4a44', accept: '#4a9a8a', instance: '#6a6a72' } as Record<string, string>)[a[0]] ?? '#6a6a72', GLYPH[a[0]] ?? GLYPH.data, '#f0f0f0'))
fam('jigsaw', (a) => techBlock('#5a5068', GLYPH[a[0]] ?? GLYPH.side, a[0] === 'front' ? '#e8c860' : '#b8a8c8'))
fam('command_block', (a) => techBlock(({ impulse: '#c8845a', repeating: '#7a5ab0', chain: '#5aa890' } as Record<string, string>)[a[0]] ?? '#c8845a', GLYPH[a[1]] ?? GLYPH.side, '#f2ead8'))

// campfire, light sources
function campfireSide (kind: string): void {
  clear()
  const W = ramp(WOOD.oak.bark, 0.9); const E = ramp(WOOD.oak.inner, 0.7)
  for (let y = 9; y < S; y++) for (let x = 0; x < S; x++) {
    const log = (y - 9) < 3 ? ((x >> 2) & 1) : 1
    P(x, y, log === 1 ? W[clamp(Math.round(2 + (rnd(x >> 1, y, SEED) - 0.5) * 2), 1, 3)] : hx('#1c1410'))
  }
  for (const x of [1, 9]) { rect(x, 9, 3, 3, E[2]); frame(x, 9, 3, 3, W[1]); Q(x + 1, 10, E[0]) }
  hline(0, 15, 12, W[0]); hline(0, 15, 13, W[3])
  if (kind !== '') flame(kind === 'soul' ? SOULFIRE : FIRE, 0, 8, SEED)
}
/** Flame tongues rising from row `base` up to row `top`. */
function flame (Fr: Ramp, top: number, base: number, s: number): void {
  for (let x = 1; x < 15; x++) {
    const h = Math.round((base - top + 1) * (0.35 + vn(x, 0, 6, 1, s) * 0.75) * (1 - Math.abs(x - 7.5) / 11))
    for (let k = 0; k < h; k++) {
      const y = base - k
      const t = k / Math.max(1, h - 1)
      const edge = Math.min(x - 1, 14 - x) < 1 ? 1 : 0
      Q(x, y, Fr[clamp(Math.round(3.6 - t * 3.2 - edge + (rnd(x, y, s) - 0.5) * 1.2 + (Math.abs(x - 7.5) < 3 ? 0.8 : 0)), 0, 4)])
    }
  }
}
def('campfire:side', () => campfireSide(''))
def('campfire:side:fire', () => campfireSide('fire'))
def('campfire:side:soul', () => campfireSide('soul'))
function campfireTop (kind: string): void {
  const W = ramp(WOOD.oak.bark, 0.9)
  fill(hx('#2a2420'))
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = (x >= 1 && x < 5) || (x >= 11 && x < 15); const b = (y >= 1 && y < 5) || (y >= 11 && y < 15)
    if (a) P(x, y, W[(x === 1 || x === 11) ? 3 : (x === 4 || x === 14) ? 1 : 2])
    else if (b) P(x, y, W[(y === 1 || y === 11) ? 3 : (y === 4 || y === 14) ? 1 : 2])
  }
  const Fr = kind === 'soul' ? SOULFIRE : kind === 'fire' ? FIRE : ramp('#3a3430', 0.9)
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) P(x, y, Fr[clamp(Math.round(4 - Math.hypot(x - 7.5, y - 7.5) * 1.1 + (rnd(x, y, SEED) - 0.5) * 1.5), 0, 4)])
}
def('campfire:top', () => campfireTop(''))
def('campfire:top:fire', () => campfireTop('fire'))
def('campfire:top:soul', () => campfireTop('soul'))
def('campfire:bottom', () => { const W = ramp(WOOD.oak.bark, 0.9); bark(W, { px: 2, py: 6, gain: 4 }) })
def('shroomlight', () => {
  const R: Ramp = [hx('#b8521c'), hx('#e07a2a'), hx('#f2a04a'), hx('#fbc878'), hx('#fff0c0')]
  tex(R, { p: 4, q: 8, gain: 4, lit: 2 })
  for (let i = 0; i < 6; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); P(x, y, R[0]); P(x + 1, y, R[1]) }
})
fam('froglight', (a) => {
  const base = ({ ochre: '#f6e6a0', verdant: '#d8f2c4', pearlescent: '#f0d8ec' } as Record<string, string>)[a[0]] ?? '#f0f0d8'
  const edge = ({ ochre: '#d8a84a', verdant: '#8ac87a', pearlescent: '#b88ac0' } as Record<string, string>)[a[0]] ?? '#c0c0a0'
  const R = ramp(base, 0.5); const Eg = ramp(edge, 0.8)
  if (a[1] === 'top') {
    field(R, (x, y) => clamp(4.4 - Math.hypot(x - 7.5, y - 7.5) * 0.4, 1, 4)); frame(0, 0, 16, 16, Eg[2]); frame(1, 1, 14, 14, Eg[3])
  } else {
    field(R, (x, y) => clamp(3.6 - Math.abs(x - 7.5) * 0.25 + (vn(x, y, 2, 4, SEED) - 0.5) * 1.6, 1, 4))
    for (let x = 0; x < S; x++) { P(x, 0, Eg[2]); P(x, 15, Eg[1]); P(x, 1, Eg[3]) }
  }
})
function lanternTile (kind: string, hang: boolean): void {
  clear()
  const Fm = kind.startsWith('copper_') ? copperRamp(kind.slice(7)) : ramp('#4a4d55', 0.9)
  const Gl = kind === 'soul' ? SOULFIRE : kind.startsWith('copper_') ? ([hx('#3a8a4a'), hx('#5ab868'), hx('#8adc8a'), hx('#c8f4b8'), hx('#f0ffe8')] as Ramp) : FIRE
  const top = hang ? 8 : 9
  // cap
  for (let x = 6; x < 10; x++) { Q(x, top - 2, Fm[3]); Q(x, top - 1, Fm[1]) }
  // body: columns 5..10, seven rows
  for (let y = top; y < top + 7; y++) {
    for (let x = 5; x < 11; x++) {
      const edge = x === 5 || x === 10 || y === top || y === top + 6
      Q(x, y, edge ? Fm[x === 5 || y === top ? 3 : 1] : Gl[clamp(Math.round(3.4 - Math.abs(y - top - 3) * 0.7 - Math.abs(x - 7.5) * 0.5), 1, 4)])
    }
  }
  if (hang) for (let y = 0; y < top - 2; y++) { Q(7, y, Fm[(y & 1) === 0 ? 3 : 1]); Q(8, y, Fm[(y & 1) === 0 ? 1 : 3]) }
}
fam('lantern', (a) => lanternTile(a[0], a[1] === 'hang'))
fam('lantern_top', (a) => {
  clear()
  const Fm = a[0].startsWith('copper_') ? copperRamp(a[0].slice(7)) : ramp('#4a4d55', 0.9)
  rect(5, 5, 6, 6, Fm[2]); raised(5, 5, 6, 6, Fm[4], Fm[0]); rect(7, 7, 2, 2, Fm[1])
})
const TORCH: Record<string, Ramp> = {
  fire: FIRE,
  soul: SOULFIRE,
  copper: [hx('#2a7a3a'), hx('#4aa858'), hx('#7ad07a'), hx('#b8f0a8'), hx('#eaffe0')],
  redstone: [hx('#7a100a'), hx('#b81a12'), hx('#e8301e'), hx('#ff6a50'), hx('#ffc0a8')],
  redstone_off: [hx('#2a0c0a'), hx('#401210'), hx('#561a16'), hx('#6a241e'), hx('#7a3028')]
}
function torchTile (kind: string, flameRow: number): void {
  const Fl = TORCH[kind] ?? FIRE; const St = ramp('#8a6a3a', 0.9)
  clear()
  for (let y = flameRow; y < S; y++) for (let x = 0; x < S; x++) {
    const k = y - flameRow
    if (k === 0) P(x, y, Fl[4]); else if (k === 1) P(x, y, Fl[(x & 1) === 0 ? 3 : 2]); else if (k === 2) P(x, y, hx('#3a2a1c'))
    else P(x, y, St[(x & 1) === 0 ? 3 : 1])
  }
}
fam('torch', (a) => torchTile(a[0], 6))
fam('torchw', (a) => torchTile(a[0], 3))
fam('torch_top', (a) => { const Fl = TORCH[a[0]] ?? FIRE; field(Fl, (x, y) => 3 + ((x + y) & 1)) })
def('lever', () => {
  cobble(ramp('#85878a', 0.85), { n: 3, gap: 1.05, s: hashStr('cobblestone') | 1 })
  const St = ramp('#8a6a3a', 0.9)
  for (let i = 3; i < 13; i++) { P(7, i, St[3]); P(8, i, St[1]); P(i, 7, St[3]); P(i, 8, St[1]) }
})
def('tripwire_hook', () => { const R = ramp('#8a7a62', 0.9); tex(R, { gain: 2 }); const I = ramp(C_IRON, 0.6); for (let y = 3; y < 6; y++) for (let x = 0; x < S; x++) P(x, y, I[y === 3 ? 3 : 1]) })
def('ladder', () => {
  clear()
  const R = ramp('#a8824a', 0.85)
  for (let y = 0; y < S; y++) { for (const x of [2, 3]) Q(x, y, R[x === 2 ? 3 : 1]); for (const x of [12, 13]) Q(x, y, R[x === 12 ? 3 : 1]) }
  for (const y of [1, 5, 9, 13]) { for (let x = 1; x < 15; x++) { Q(x, y, R[3]); Q(x, y + 1, R[0]) } Q(2, y, R[4]); Q(12, y, R[4]) }
})
def('scaffolding:side', () => {
  clear()
  const R = ramp(WOOD.bamboo.planks, 0.85)
  for (let y = 0; y < S; y++) { for (const x of [0, 1]) Q(x, y, R[x === 0 ? 3 : 1]); for (const x of [14, 15]) Q(x, y, R[x === 14 ? 3 : 1]) }
  for (let x = 0; x < S; x++) { Q(x, 0, R[4]); Q(x, 1, R[2]); Q(x, 2, R[0]) }
  for (let i = 0; i < 12; i++) { Q(2 + i, 3 + i, R[2]); Q(13 - i, 3 + i, R[1]) }
  for (const y of [5, 11]) { Q(0, y, R[0]); Q(14, y, R[0]) }
})
def('scaffolding:top', () => {
  clear()
  const R = ramp(WOOD.bamboo.planks, 0.85)
  frame(0, 0, 16, 16, R[2]); frame(1, 1, 14, 14, R[1]); hline(0, 15, 0, R[4]); vline(0, 0, 15, R[3])
  for (let i = 2; i < 14; i++) { Q(i, i, R[3]); Q(15 - i, i, R[2]) }
  for (let i = 2; i < 14; i += 3) { vline(i, 2, 13, R[1]) }
})
function cage (R: Ramp, cell = 4): void {
  clear()
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const bx = (x % cell) === 0; const by = (y % cell) === 0
    const edge = x === 0 || y === 0 || x === 15 || y === 15
    if (edge) P(x, y, R[(x === 0 || y === 0) ? 3 : 1])
    else if (bx || by) P(x, y, R[bx && by ? 4 : 2])
    else if ((x % cell) === 1 && (y % cell) === 1) P(x, y, R[0])
  }
}
def('spawner', () => cage(ramp('#3a4a5a', 1)))
fam('trial_spawner', (a) => {
  const R = ramp('#4a5a68', 0.9)
  if (a[0] === 'bottom') { tex(R, { gain: 2 }); bevel(R, 1, 3.4, 0.7); return }
  const k = a[1]
  const Gl = k === 'ominous' ? SOULFIRE : k === 'on' ? FIRE : ramp('#22282e', 0.9)
  cage(R)
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) { if (alphaAt(x, y) === 0) continue; P(x, y, Gl[2]) }
  if (a[0] === 'top') { rect(5, 5, 6, 6, R[2]); raised(5, 5, 6, 6, R[4], R[0]); rect(7, 7, 2, 2, Gl[3]) } else {
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) P(x, y, Gl[clamp(Math.round(3.6 - Math.hypot(x - 7.5, y - 7.5)), 1, 4)])
    for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 1, R[3]); P(x, 14, R[1]); P(x, 15, R[0]) }
  }
})
fam('vault', (a) => {
  const ominous = a[1] === 'ominous'; const on = a[2] === 'on'
  const R = ominous ? ramp('#3a5a6a', 0.9) : ramp('#5a6068', 0.9)
  const Ac = ominous ? SOULFIRE : ([hx('#a8541c'), hx('#d87a2a'), hx('#f2a04a'), hx('#fbc878'), hx('#fff0c0')] as Ramp)
  if (a[0] === 'bottom') { tex(R, { gain: 2 }); bevel(R, 1, 3.4, 0.7); return }
  cage(R)
  for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 1, R[3]); P(x, 14, R[1]); P(x, 15, R[0]) }
  if (a[0] === 'top') { rect(4, 4, 8, 8, R[2]); raised(4, 4, 8, 8, R[4], R[0]); rect(6, 6, 4, 4, Ac[on ? 3 : 1]); return }
  if (a[0] === 'front') {
    rect(5, 4, 6, 9, R[2]); raised(5, 4, 6, 9, R[4], R[0])
    art(['.aa.', 'a..a', '.aa.', '.aa.', '.aa.'], { a: on ? Ac[3] : hx('#17171b') }, 6, 6)
  } else {
    for (const y of [5, 9]) for (const x of [5, 9]) P(x, y, Ac[on ? 3 : 1])
  }
})
fam('bars', (a) => {
  clear()
  const R = a[0] === 'iron' ? ramp('#7c7f86', 0.9) : copperRamp(a[0].slice(7))
  for (const x of [1, 4, 7, 10, 13]) for (let y = 0; y < S; y++) { Q(x, y, R[3]); Q(x + 1, y, R[1]) }
  for (const y of [0, 15]) for (let x = 0; x < S; x++) Q(x, y, R[y === 0 ? 4 : 0])
  for (let x = 0; x < S; x++) { Q(x, 7, R[2]); Q(x, 8, R[0]) }
})
fam('chain', (a) => {
  clear()
  const R = a[0] === 'iron' ? ramp('#5a5e68', 0.9) : copperRamp(a[0].slice(7))
  for (let y = 0; y < S; y++) {
    const k = y & 7
    if (k < 5) { Q(6, y, R[3]); Q(9, y, R[1]); if (k === 0 || k === 4) { Q(7, y, R[2]); Q(8, y, R[2]) } } else { Q(7, y, R[4]); Q(8, y, R[0]) }
    if (k === 4) { Q(7, y, R[1]); Q(8, y, R[0]) }
  }
})

// rails & redstone
function railStraight (type: string, on: boolean): void {
  clear()
  const Tie = ramp('#7a5a34', 0.9); const Mt = ramp('#9a9da3', 0.8)
  for (const y of [1, 5, 9, 13]) for (let x = 2; x < 14; x++) { Q(x, y, Tie[3]); Q(x, y + 1, Tie[1]) }
  let Rl = Mt
  if (type === 'powered') Rl = ramp('#d8a82e', 0.9)
  for (let y = 0; y < S; y++) { Q(3, y, Rl[3]); Q(4, y, Rl[1]); Q(11, y, Rl[3]); Q(12, y, Rl[1]) }
  const Rd = on ? ramp('#f03a2a', 0.9) : ramp('#6a1c16', 0.9)
  if (type === 'powered') { for (let y = 0; y < S; y++) { Q(7, y, Rd[(y & 3) === 0 ? 4 : 2]); Q(8, y, Rd[1]) } } else if (type === 'detector') {
    rect(5, 5, 6, 6, hx('#6a6e76')); raised(5, 5, 6, 6, hx('#9a9da3'), hx('#44464c')); rect(7, 7, 2, 2, Rd[3])
  } else if (type === 'activator') {
    for (let y = 0; y < S; y++) { Q(3, y, Mt[2]); Q(12, y, Mt[0]) }
    for (const y of [2, 6, 10, 14]) { Q(7, y, Rd[3]); Q(8, y, Rd[1]) }
    vline(7, 0, 15, Rd[2])
  }
}
fam('rail', (a) => {
  if (a[0] === 'curve') {
    clear()
    const Tie = ramp('#7a5a34', 0.9); const Mt = ramp('#9a9da3', 0.8)
    // quarter circle centred on the bottom-right corner (connects south and east)
    for (let k = 0; k < 5; k++) { const ang = (k + 0.5) / 5 * Math.PI / 2; for (let r = 3; r < 14; r++) { const x = Math.round(16 - Math.cos(ang) * r); const y = Math.round(16 - Math.sin(ang) * r); Q(x, y, Tie[2]) } }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(16 - x - 0.5, 16 - y - 0.5)
      if (Math.abs(d - 4) < 0.75 || Math.abs(d - 12) < 0.75) Q(x, y, Mt[d % 1 < 0.5 ? 3 : 1])
    }
    return
  }
  railStraight(a[0], a[1] === 'on')
})
fam('redstone', (a) => {
  clear()
  const m = Number(a[0]) | 0; const on = a[1] === 'on'
  const R = on ? ramp('#e8281c', 0.9) : ramp('#6a120e', 0.9)
  const put = (x: number, y: number): void => { if (alphaAt(x, y) === 0) Q(x, y, R[clamp(2 + rint(x, y, 5, 3) - 1, 1, 3)]) }
  if (m === 0) { for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3 + rnd(x, y, 9) * 0.6) put(x, y); if (on) Q(7, 7, R[4]); return }
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) put(x, y)
  for (let k = 0; k < 7; k++) {
    for (const o of [7, 8]) {
      if ((m & 1) !== 0) put(o, k)
      if ((m & 4) !== 0) put(o, 15 - k)
      if ((m & 8) !== 0) put(k, o)
      if ((m & 2) !== 0) put(15 - k, o)
    }
    // frayed edges
    if ((m & 1) !== 0 && rnd(k, 1, 3) < 0.4) put(6 + rint(k, 2, 3, 2) * 3, k)
    if ((m & 4) !== 0 && rnd(k, 3, 3) < 0.4) put(6 + rint(k, 4, 3, 2) * 3, 15 - k)
    if ((m & 8) !== 0 && rnd(k, 5, 3) < 0.4) put(k, 6 + rint(k, 6, 3, 2) * 3)
    if ((m & 2) !== 0 && rnd(k, 7, 3) < 0.4) put(15 - k, 6 + rint(k, 8, 3, 2) * 3)
  }
  if (on) { Q(7, 7, R[4]); Q(8, 8, R[3]) }
})

// portals, fire
def('nether_portal', () => {
  const R: Ramp = [hx('#3a0f6a'), hx('#5a1f9a'), hx('#7a32c8'), hx('#a05ae8'), hx('#d0a0ff')]
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = vn(x + Math.sin(y * 0.8) * 1.5, y, 3, 4, SEED) * 0.7 + vn(x, y, 6, 6, SEED + 1) * 0.3
    const i = clamp(Math.round((v - 0.5) * 6 + 2), 0, 4)
    P(x, y, R[i], 150 + i * 18)
  }
})
def('end_portal', () => {
  fill(hx('#070812'))
  const Cs = ['#3fd0a0', '#7a8af0', '#e0e8ff', '#3a9ab8', '#b88af0']
  for (let i = 0; i < 16; i++) { const x = rint(i, 0, SEED, 16); const y = rint(i, 1, SEED, 16); const c = hx(Cs[i % Cs.length]); P(x, y, c); if (i % 4 === 0) { P(x + 1, y, mix(c, hx('#070812'), 0.5)); P(x, y + 1, mix(c, hx('#070812'), 0.5)) } }
})
function fireTile (Fr: Ramp): void { clear(); flame(Fr, 1, 15, SEED); for (let x = 2; x < 14; x += 3) { Q(x, 2 + rint(x, 0, SEED, 4), Fr[1]) } }
def('fire', () => fireTile(FIRE))
def('fire:soul', () => fireTile(SOULFIRE))

// ---------------------------------------------------------------------------
// organic blocks
// ---------------------------------------------------------------------------
function pumpkinSide (): Ramp {
  const R = ramp('#d57c1c', 0.9)
  field(R, (x, y) => [0.8, 3.2, 2.6, 2, 1.6][(x + 2) % 5] + (y === 0 ? 0.5 : y === 15 ? -0.8 : 0) + (rnd(x, y, SEED) < 0.08 ? -0.4 : 0))
  return R
}
def('pumpkin:side', () => { pumpkinSide() })
def('pumpkin:top', () => {
  const R = ramp('#d57c1c', 0.9)
  field(R, (x, y) => { const a = Math.atan2(y - 7.5, x - 7.5); const d = Math.hypot(x - 7.5, y - 7.5); return 2 + Math.sin(a * 6) * 0.9 - d * 0.06 })
  const St = ramp('#6a8a3a', 0.9); rect(6, 6, 4, 4, St[2]); raised(6, 6, 4, 4, St[4], St[0])
})
function pumpkinFace (lit: boolean): void {
  pumpkinSide()
  const In: Ramp = lit ? [hx('#e8700e'), hx('#f79a1c'), hx('#fdc84a'), hx('#ffe88a'), hx('#fffbd8')] : [hx('#1c1008'), hx('#2a180c'), hx('#3a2210'), hx('#4a2c14'), hx('#5a3618')]
  const rows = ['.aa....aa.', 'aaaa..aaaa', '.aa....aa.', '....aa....', '..........', 'a.aa.aa.aa', 'aaaaaaaaaa', '.aaa.aaaa.']
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y].charAt(x) === 'a') P(3 + x, 4 + y, In[lit ? clamp(Math.round(2 + (rnd(x, y, 5) - 0.5) * 3), 1, 4) : 1 + ((x + y) & 1)])
}
def('pumpkin:face', () => pumpkinFace(false))
def('pumpkin:face:lit', () => pumpkinFace(true))
def('melon:side', () => {
  const R = ramp('#6f9a2a', 0.9)
  field(R, (x, y) => { const w = (x + Math.round(vn(x, y, 1, 4, SEED) * 2)) % 4; return (w === 0 ? 0.8 : w === 1 ? 1.8 : 2.8) + (rnd(x, y, SEED) < 0.1 ? 0.5 : 0) })
})
def('melon:top', () => { const R = ramp('#6f9a2a', 0.9); tex(R, { p: 4, q: 8, gain: 3 }); const St = ramp('#8a7a4a', 0.9); rect(7, 7, 2, 2, St[2]); P(7, 7, St[4]) })
def('hay_block:side', () => {
  const R = ramp('#c9a227', 0.9)
  bark(R, { px: 8, py: 3, gain: 4.2, lit: 2 })
  const Bd = ramp('#a8402c', 0.9)
  for (const y of [3, 11]) for (let x = 0; x < S; x++) { P(x, y, Bd[3]); P(x, y + 1, Bd[1]) }
})
def('hay_block:top', () => {
  const R = ramp('#c9a227', 0.9)
  field(R, (x, y) => clamp(Math.round(2 + (rnd(x, y, SEED) - 0.5) * 3.4), 0, 4))
  const Bd = ramp('#a8402c', 0.9)
  for (let i = 0; i < S; i++) { P(i, 7, Bd[3]); P(i, 8, Bd[1]) }
})
def('mushroom_stem', () => { const R = ramp('#d6d0be', 0.55); bark(R, { px: 6, py: 2, gain: 2.6, lit: 1.4 }) })
def('mushroom_inside', () => { const R = ramp('#cdb48c', 0.7); field(R, (x, y) => (((x & 1) === 0 && (y & 1) === 0) ? 1 : 2.4) + (rnd(x >> 1, y >> 1, SEED) < 0.2 ? -0.6 : 0)) })
def('brown_mushroom_block', () => { const R = ramp('#96735a', 0.8); tex(R, { p: 3, q: 6, gain: 2.4, lit: 2 }) })
def('red_mushroom_block', () => {
  const R = ramp('#c5312b', 0.85); tex(R, { p: 3, q: 6, gain: 2, lit: 1.8, lo: 1, hi: 3 })
  const W = ramp('#f2ede4', 0.5)
  for (const [x, y, r] of [[3, 3, 2], [11, 2, 1], [8, 8, 2], [2, 11, 1], [13, 12, 2], [6, 14, 1]]) { for (let j = 0; j <= r; j++) for (let i = 0; i <= r; i++) { if (r === 2 && (i + j === 0 || i + j === 4 || (i === 0 && j === 2) || (i === 2 && j === 0))) continue; P(x + i, y + j, W[i + j === 0 || (r === 2 && i + j === 1) ? 4 : 2]) } }
})
def('azalea:top', () => { leafTile('azalea', hashStr('leaves:azalea') | 1) })
def('azalea:top:flowering', () => { leafTile('flowering_azalea', hashStr('leaves:flowering_azalea') | 1) })
function azaleaSide (type: string): void {
  leafTile(type, hashStr('leaves:' + type) | 1)
  const W = ramp('#7a5a34', 0.9)
  for (let y = 8; y < S; y++) for (let x = 0; x < S; x++) { if (x >= 6 && x < 10) P(x, y, W[x === 6 ? 3 : x === 9 ? 1 : 2]); else P(x, y, W[0], 0) }
}
def('azalea:side', () => azaleaSide('azalea'))
def('azalea:side:flowering', () => azaleaSide('flowering_azalea'))
def('big_dripleaf:top', () => {
  const R = ramp('#5f9a34', 0.9)
  field(R, (x, y) => 2 + (vn(x, y, 3, 3, SEED) - 0.5) * 1.6)
  for (let i = 1; i < 15; i++) { P(i, 7, R[4]); P(i, 8, R[1]) }
  for (let k = 2; k < 14; k += 3) { for (let j = 1; j < 5; j++) { P(k + j, 7 - j, R[3]); P(k + j, 8 + j, R[3]) } }
  frame(0, 0, 16, 16, R[1])
})
def('big_dripleaf:stem', () => { const R = ramp('#5f9a34', 0.9); field(R, (x, y) => ((x & 1) === 0 ? 3 : 1.4) + ((y & 3) === 0 ? -0.4 : 0)); for (let x = 0; x < S; x++) { P(x, 0, R[4]); P(x, 1, R[0]) } })
fam('cocoa', (a) => { const R = ramp(['#8f9a3a', '#c8943a', '#b05f28'][Number(a[0]) | 0] ?? '#b05f28', 0.9); tex(R, { p: 4, q: 7, gain: 2.6, lit: 2.4 }) })
def('chorus_plant', () => { const R = ramp('#6c4a6e', 0.9); tex(R, { p: 4, q: 8, gain: 3, lit: 2.4 }); specks(ramp('#a887a8', 0.7), 7, 3) })
function chorusFlower (dead: boolean): void {
  const R = dead ? ramp('#7a6a78', 0.8) : ramp('#9a7a9c', 0.8)
  tex(R, { p: 3, q: 6, gain: 2.2, lit: 2 })
  const Pt = dead ? ramp('#5a4a58', 0.8) : ramp('#e6d8e2', 0.6)
  bevel(R, 1, 3.4, 0.8)
  art(['.aa..aa.', 'a..aa..a', 'a......a', '.a....a.', '.a....a.', 'a......a', 'a..aa..a', '.aa..aa.'], { a: Pt[2] }, 4, 4)
}
def('chorus_flower', () => chorusFlower(false))
def('chorus_flower:dead', () => chorusFlower(true))
def('sea_pickle', () => { const R = ramp('#6a7a2c', 0.9); field(R, (x, y) => ((x & 1) === 0 ? 2.6 : 1.6) + (y < 11 ? 0 : -0.4)); for (let x = 0; x < S; x++) P(x, 10, ramp('#c8d87a', 0.8)[3]) })
def('turtle_egg', () => { const R = ramp('#e2e0d0', 0.6); tex(R, { p: 4, q: 8, gain: 2, lit: 2 }); specks(ramp('#6a9a7a', 0.8), 10, 2) })
def('sniffer_egg', () => { const R = ramp('#a8443a', 0.9); tex(R, { p: 3, q: 6, gain: 2.6, lit: 2.4 }); const G = ramp('#4a9a7a', 0.9); for (let i = 0; i < 6; i++) { const x = rint(i, 0, SEED, 14); const y = rint(i, 1, SEED, 14); rect(x, y, 2, 2, G[2]); P(x, y, G[4]) } })
def('dried_ghast', () => { const R = ramp('#b8b2a8', 0.7); tex(R, { p: 3, q: 6, gain: 2.4, lit: 2 }); art(['aa..aa', '......', '.aaaa.'], { a: R[0] }, 5, 9) })
def('dragon_egg', () => { const R = ramp('#17131c', 1.3); tex(R, { p: 3, q: 6, gain: 3, lit: 3.4 }); specks(ramp('#7a3ac8', 0.9), 8, 2) })
function sponge (wet: boolean): void {
  const R = ramp(wet ? '#a8a43a' : '#cbc345', 0.9)
  tex(R, { p: 4, q: 8, gain: 2, lit: 1.6, lo: 1, hi: 3 })
  const hole = wet ? hx('#5a6a3a') : hx('#8a7a1c')
  for (let i = 0; i < 9; i++) { const x = (i * 5 + rint(i, 0, SEED, 3)) & 15; const y = (i * 7 + rint(i, 1, SEED, 3)) & 15; P(x, y, hole); P(x + 1, y, hole); P(x, y + 1, hole); if ((i & 1) === 0) P(x + 1, y + 1, hole); P(x + 2, y + 1, R[4]); P(x + 1, y + 2, R[4]) }
}
def('sponge', () => sponge(false))
def('sponge:wet', () => sponge(true))
def('honey_block', () => {
  const R = ramp('#f0a42c', 0.8)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); P(x, y, m > 7 ? R[3] : m > 4.6 ? R[2] : R[1], m > 7 ? 235 : m > 4.6 ? 175 : 225) }
  P(3, 4, R[4], 240); P(4, 3, R[4], 240); P(3, 3, R[4], 240)
})
def('slime_block', () => {
  const R = ramp('#78c65e', 0.8)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); P(x, y, m > 7 ? R[3] : m > 4.6 ? R[2] : R[1], m > 7 ? 225 : m > 4.6 ? 150 : 215) }
  P(3, 4, R[4], 235); P(4, 3, R[4], 235); P(3, 3, R[4], 235)
})
def('honeycomb_block', () => {
  const R = ramp('#e2951f', 0.9)
  field(R, (x, y) => {
    const row = Math.floor(y / 4); const xx = (x + (row & 1) * 3) % 6; const yy = y % 4
    if (yy === 3) return (xx === 1 || xx === 2 || xx === 3) ? 0.8 : 2
    if (xx === 0 || xx === 4) return 0.8
    if (xx === 5) return 2
    return yy === 0 ? 3.6 : 2.6
  })
})
def('dried_kelp_block', () => { const R = ramp('#3d4b33', 0.9); field(R, (x, y) => (((x >> 2) + (y >> 2)) & 1) === 0 ? [1.2, 2.6, 2, 1.6][x & 3] : [1.2, 2.6, 2, 1.6][y & 3]) })
def('dried_kelp_block:top', () => { const R = ramp('#3d4b33', 0.9); tex(R, { gain: 2.6 }); frame(0, 0, 16, 16, R[1]); for (let i = 0; i < S; i++) { P(i, 7, R[4]); P(i, 8, R[0]) } })
fam('nylium', (a) => {
  const c = a[0] === 'warped' ? '#1d8a7c' : '#a3222c'
  const R = ramp(c, 0.95)
  if (a[1] === 'side') {
    const Nr = ramp(C_NETHER, 1); tex(Nr, { p: 5, q: 9, gain: 4.4, lit: 4, jit: 0.6, s: hashStr('netherrack') | 1 })
    for (let x = 0; x < S; x++) { const d = 2 + Math.round(vn(x, 0, 6, 1, SEED) * 2.4); for (let y = 0; y <= d; y++) P(x, y, R[y === 0 ? 3 : y === d ? 1 : 2]); shadePx(x, d + 1, -0.9) }
    return
  }
  tex(R, { p: 5, q: 9, gain: 3.4, lit: 3 }); specks(R, 8, 4)
})
fam('wart_block', (a) => { const R = ramp(a[0] === 'warped' ? '#16877f' : '#7a1212', 1); cobble(R, { n: 4, gap: 0.4, jitter: 1, tones: [1.2, 1.8, 2.2, 2.8], mortar: R[0], lightK: 0.9 }) })
function rootTangle (R: Ramp, opaqueBg: RGB | null): void {
  if (opaqueBg === null) clear()
  for (let i = 0; i < 7; i++) {
    let x = rint(i, 0, SEED, 16); let y = 0
    const dir = (i & 1) === 0 ? 1 : -1
    while (y < 16) { P(x, y, R[3]); P(x + 1, y, R[1]); if (rint(i, y, SEED + 1, 3) > 0) x += dir; y++; if (rint(i, y, SEED + 2, 5) === 0) { P(x - dir, y, R[2]); P(x - dir * 2, y + 1, R[2]) } }
  }
  for (const y of [0, 15]) for (let x = 0; x < S; x++) P(x, y, R[y === 0 ? 3 : 1])
  for (const x of [0, 15]) for (let y = 0; y < S; y++) P(x, y, R[x === 0 ? 3 : 1])
}
def('mangrove_roots:side', () => rootTangle(ramp('#6a4c30', 0.9), null))
def('mangrove_roots:top', () => { const R = ramp('#6a4c30', 0.9); rootTangle(R, null); rect(5, 5, 6, 6, R[2]); raised(5, 5, 6, 6, R[4], R[0]) })
def('muddy_mangrove_roots:side', () => { const M = ramp('#3f3b41', 0.8); tex(M, { p: 3, q: 6, gain: 2.6, lit: 4 }); rootTangle(ramp('#6a4c30', 0.9), M[2]) })
def('muddy_mangrove_roots:top', () => { const M = ramp('#3f3b41', 0.8); tex(M, { p: 3, q: 6, gain: 2.6, lit: 4 }); const R = ramp('#6a4c30', 0.9); frame(0, 0, 16, 16, R[2]); rect(5, 5, 6, 6, R[2]); raised(5, 5, 6, 6, R[4], R[0]) })
def('cactus:side', () => {
  const R = ramp('#5a8c32', 0.9)
  field(R, (x, y) => [1, 3, 2.4, 1.8][x & 3] + (rnd(x, y, SEED) < 0.06 ? -0.4 : 0))
  const Sp = hx('#e8e6c8')
  for (let y = 1; y < S; y += 4) for (let x = 1; x < S; x += 4) P(x + ((y >> 2) & 1) * 2, y, Sp)
  vline(0, 0, 15, R[0]); vline(15, 0, 15, R[0])
})
def('cactus:top', () => {
  const R = ramp('#5a8c32', 0.9)
  field(R, (x, y) => { const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return m > 7 ? 0 : m > 6 ? 0.8 : [2.8, 2, 1.6, 2.4][Math.floor(m) & 3] })
  P(7, 7, hx('#e8e6c8')); P(8, 8, hx('#c8c6a0'))
})
def('cactus:bottom', () => { const R = ramp('#c8c890', 0.7); field(R, (x, y) => { const m = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return m > 7 ? 0 : [2.8, 2, 1.6, 2.4][Math.floor(m) & 3] }) })
function beeFace (hive: boolean, front: boolean, honey: boolean): void {
  if (hive) {
    const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 })
    for (const y of [0, 5, 10, 15]) for (let x = 0; x < S; x++) P(x, y, R[y === 15 ? 0 : 1])
    vline(0, 0, 15, R[3]); vline(15, 0, 15, R[0])
    if (front) { rect(4, 11, 8, 3, hx('#1c1410')); inset(3, 10, 10, 5, R[0], R[4]); if (honey) { const H = ramp('#f0a42c', 0.8); hline(4, 11, 13, H[2]); P(5, 14, H[3]); P(9, 14, H[2]); P(9, 15, H[3]) } }
    return
  }
  const R = ramp('#d8a83e', 0.9)
  field(R, (x, y) => { const yy = y & 3; return (yy === 3 ? 0.8 : yy === 0 ? 3.2 : 2.2) + (vn(x, y, 5, 1, SEED + (y >> 2)) - 0.5) * 1.2 })
  if (front) { rect(5, 5, 6, 6, hx('#2a1a0c')); inset(4, 4, 8, 8, R[0], R[4]); if (honey) { const H = ramp('#f6b83a', 0.8); rect(5, 9, 6, 2, H[2]); P(6, 11, H[3]); P(6, 12, H[2]); P(9, 11, H[2]) } }
}
def('bee_nest:front', () => beeFace(false, true, false))
def('bee_nest:front:honey', () => beeFace(false, true, true))
def('bee_nest:side', () => beeFace(false, false, false))
def('bee_nest:top', () => { const R = ramp('#d8a83e', 0.9); concentric(R) })
def('bee_nest:bottom', () => { const R = ramp('#c8963a', 0.9); concentric(R) })
def('beehive:front', () => beeFace(true, true, false))
def('beehive:front:honey', () => beeFace(true, true, true))
def('beehive:side', () => beeFace(true, false, false))
def('beehive:top', () => { const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0]); frame(1, 1, 14, 14, R[3]) })
def('beehive:bottom', () => { const R = R_OAK(); planks(R, { s: hashStr('planks:oak') | 1 }); frame(0, 0, 16, 16, R[0]) })

const CORAL: Record<string, string> = { tube: '#3a5fd6', brain: '#d65a9e', bubble: '#a02cbe', fire: '#c7302c', horn: '#d6c62c' }
const coralRamp = (type: string, dead: boolean): Ramp => dead ? ramp('#8a8580', 0.8) : ramp(CORAL[type] ?? '#8a8580', 0.9)
fam('coral_block', (a) => {
  const R = coralRamp(a[0], a[1] === 'dead')
  switch (a[0]) {
    case 'brain': field(R, (x, y) => { const v = vn(x, y, 4, 4, SEED) * 0.6 + vn(x, y, 8, 8, SEED + 1) * 0.4; return Math.abs(((v * 6) % 1) - 0.5) < 0.2 ? 0.8 : 2.6 }); break
    case 'bubble': cobble(R, { n: 5, gap: 0.7, jitter: 0.8, tones: [1.6, 2, 2.6, 3], mortar: R[0] }); break
    case 'tube': tex(R, { p: 4, q: 8, gain: 2.4 }); for (let i = 0; i < 9; i++) { const x = (i * 5 + rint(i, 0, SEED, 3)) & 15; const y = (i * 7 + rint(i, 1, SEED, 3)) & 15; P(x, y, R[0]); P(x + 1, y, R[4]); P(x, y - 1, R[4]); P(x - 1, y, R[3]); P(x, y + 1, R[1]) } break
    case 'fire': bark(R, { px: 7, py: 3, gain: 4.4 }); break
    default: tex(R, { p: 5, q: 9, gain: 3.4, lit: 3 }); specks(R, 8, 4)
  }
})
fam('coral', (a) => {
  clear()
  const R = coralRamp(a[0], a[1] === 'dead')
  const branch = (x: number, y: number, dx: number, len: number, depth: number): void => {
    for (let k = 0; k < len; k++) {
      Q(x, y, R[depth === 0 ? 2 : 3]); if (depth === 0) Q(x + 1, y, R[1])
      y--; if (k % 2 === 1) x += dx
      if (depth < 2 && k === (len >> 1)) branch(x, y, -dx, len - k, depth + 1)
    }
    Q(x, y, R[4])
  }
  if (a[0] === 'brain') { for (let y = 6; y < S; y++) for (let x = 2; x < 14; x++) { const d = Math.hypot((x - 7.5) / 6, (y - 15) / 9); if (d < 1) Q(x, y, R[((x + (y & 1) * 2) & 3) === 0 ? 0 : d < 0.6 ? 3 : 2]) } rim(); return }
  if (a[0] === 'bubble') { for (const [cx, cy, r] of [[5, 12, 3], [10, 11, 3.4], [7, 7, 2.6], [12, 6, 2], [3, 7, 1.8]]) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - cx, y - cy); if (d < r) Q(x, y, R[d < r * 0.4 ? 4 : d < r * 0.8 ? 2 : 1]) } return }
  const n = a[0] === 'horn' ? 3 : 4
  for (let i = 0; i < n; i++) branch(3 + i * (a[0] === 'horn' ? 4 : 3), 15, (i & 1) === 0 ? -1 : 1, a[0] === 'fire' ? 11 - i : a[0] === 'horn' ? 8 + (i & 1) * 3 : 9 + ((i * 3) & 3), a[0] === 'horn' ? 1 : 0)
})
fam('coral_fan', (a) => {
  clear()
  const R = coralRamp(a[0], a[1] === 'dead')
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - 7.5; const dy = 15.5 - y
    const d = Math.hypot(dx, dy); const ang = Math.atan2(dx, dy)
    if (d > 15 || Math.abs(ang) > 1.25) continue
    const ray = Math.abs(Math.sin(ang * 5 + (a[0] === 'brain' ? d * 0.5 : 0)))
    if (ray < 0.3 && d > 4) continue
    Q(x, y, R[d > 13 ? 4 : ray > 0.8 ? 3 : d < 4 ? 1 : 2])
  }
})

// heads --------------------------------------------------------------------------
const HEADS: Record<string, { skin: string, rows: string[], pal: Record<string, string> }> = {
  player: { skin: '#c99873', rows: ['hhhhhhhh', 'hhhhhhhh', 'hsssssshh', 'ssssssss', 'swbssbws', 'sssnnsss', 'ssmmmmss', 'ssssssss'], pal: { h: '#4a3220', w: '#f2f2f2', b: '#3a5aa8', n: '#a87a58', m: '#7a4a3a' } },
  zombie: { skin: '#5f8f4c', rows: ['ssssssss', 'ssssssss', 'ssssssss', 'ssssssss', 'sddssdds', 'sssnnsss', 'ssnnnnss', 'ssssssss'], pal: { d: '#141a12', n: '#3f6a34' } },
  creeper: { skin: '#5fb24c', rows: ['ssssssss', 'ssssssss', 'sddssdds', 'sddssdds', 'sssddsss', 'ssddddss', 'ssddddss', 'ssdssdss'], pal: { d: '#141a12' } },
  skeleton: { skin: '#c9c9c1', rows: ['ssssssss', 'ssssssss', 'ssssssss', 'sddssdds', 'sddssdds', 'sssddsss', 'sdddddds', 'ssssssss'], pal: { d: '#3a3a3a' } },
  wither_skeleton: { skin: '#2f2f33', rows: ['ssssssss', 'ssssssss', 'ssssssss', 'sddssdds', 'sddssdds', 'sssddsss', 'sdddddds', 'ssssssss'], pal: { d: '#0c0c0f' } },
  dragon: { skin: '#1e1a22', rows: ['ssssssss', 'ssssssss', 'spssssps', 'spssssps', 'ssssssss', 'ssnsnsss', 'wswswsws', 'ssssssss'], pal: { p: '#c45ae0', n: '#0c0a0e', w: '#d8d4c8' } },
  piglin: { skin: '#e0a078', rows: ['ssssssss', 'ssssssss', 'swdssdws', 'ssssssss', 'snnnnnns', 'snddddns', 'wsnnnnsw', 'ssssssss'], pal: { w: '#f2f2f2', d: '#3a2018', n: '#c8805a' } }
}
fam('head', (a) => {
  const h = HEADS[a[0]] ?? HEADS.zombie
  const R = ramp(h.skin, 0.8)
  tex(R, { p: 4, q: 8, gain: 1.8, lit: 1.4, lo: 1, hi: 3 })
  if (a[0] === 'player' && a[1] === 'skin') { const Hr = ramp('#4a3220', 0.9); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((y & 7) < 3) P(x, y, Hr[2 + ((x + y) & 1)]) }
  if (a[1] === 'skin') return
  const pal: Record<string, RGB> = { s: R[2] }
  for (const k of Object.keys(h.pal)) pal[k] = hx(h.pal[k])
  const oy = a[1] === 'wall' ? 4 : 8
  rect(4, oy, 8, 8, R[2])
  art(h.rows.map(r => r.slice(0, 8)), pal, 4, oy)
  for (let k = 0; k < 8; k++) { if (h.rows[0].charAt(k) === 's') Q(4 + k, oy, R[3]); if (h.rows[7].charAt(k) === 's') Q(4 + k, oy + 7, R[1]) }
})

// ---------------------------------------------------------------------------
// plants (cutout sprites)
// ---------------------------------------------------------------------------
const C_PLANT = '#4c9a3a'
const PL = (): Ramp => ramp(C_PLANT, 1)

/** Grass-like blades: [x, height, lean]. */
function blades (R: Ramp, specs: number[][], base = 15, hang = false): void {
  specs.forEach(([x, h, lean], i) => {
    for (let k = 0; k < h; k++) {
      const t = k / h
      const xx = x + Math.round(lean * t * t * 2.5)
      const idx = (t < 0.3 ? 1 : t < 0.7 ? 2 : 3) + ((i & 1) === 1 ? -0.6 : 0.3)
      Q(xx, hang ? base + k : base - k, rc(R, idx))
    }
  })
}
function tuft (R: Ramp, n: number, minH: number, maxH: number, s: number, base = 15, hang = false): void {
  const specs: number[][] = []
  for (let i = 0; i < n; i++) specs.push([1 + Math.round(i * 13 / Math.max(1, n - 1)) + (rint(i, 0, s, 2)), minH + rint(i, 1, s, maxH - minH + 1), rint(i, 2, s, 3) - 1])
  blades(R, specs, base, hang)
}
/** Fern: a spine with paired fronds getting wider towards the base. */
function fernShape (R: Ramp, top: number, bottom: number, maxW: number): void {
  for (let y = top; y <= bottom; y++) Q(7, y, R[1])
  for (let y = top + 1; y <= bottom; y += 2) {
    const w = Math.min(maxW, 1 + Math.round((y - top) * maxW / (bottom - top)))
    for (let k = 1; k <= w; k++) {
      const yy = y + (k > w * 0.6 ? 1 : 0) - (k < 2 ? 1 : 0)
      Q(7 - k, yy, R[k === w ? 4 : 2 + (k & 1)]); Q(7 + k, yy, R[k === w ? 3 : 1 + (k & 1)])
    }
  }
}
interface Flower { top: number, head: string[], pal: Record<string, string>, hx?: number, leaves?: Array<[number, number]>, stem?: string, lean?: number }
function flower (f: Flower): void {
  clear()
  const G = f.stem !== undefined ? ramp(f.stem, 1) : PL()
  for (let y = f.top; y < S; y++) Q(7 + (f.lean !== undefined && y < f.top + 3 ? f.lean : 0), y, G[y > 12 ? 1 : 2])
  for (const [y, dir] of f.leaves ?? [[13, -1], [12, 1]]) { Q(7 + dir, y, G[2]); Q(7 + dir * 2, y - 1, G[3]); Q(7 + dir * 3, y - 1, G[dir < 0 ? 4 : 1]) }
  const pal: Record<string, RGB> = {}
  for (const k of Object.keys(f.pal)) pal[k] = hx(f.pal[k])
  const w = f.head[0].length
  art(f.head, pal, f.hx ?? (8 - Math.ceil(w / 2)) + (f.lean ?? 0), f.top - f.head.length)
}
const TULIP = (a: string, b: string): Flower => ({ top: 8, head: ['a.a', 'aba', 'aaa', '.a.'], pal: { a, b }, hx: 6, leaves: [[14, -1], [13, 1], [11, -1]] })
const FLOWERS: Record<string, Flower> = {
  dandelion: { top: 9, head: ['.yy.', 'yYYy', 'yYoy', '.yy.'], pal: { y: '#f0c020', Y: '#fbe060', o: '#d88a10' }, hx: 6 },
  golden_dandelion: { top: 9, head: ['.yy.', 'yYYy', 'yYoy', '.yy.'], pal: { y: '#f6c83a', Y: '#fff0a0', o: '#e8a020' }, hx: 6 },
  poppy: { top: 9, head: ['.rr.', 'rRRr', 'rRkr', '.rr.'], pal: { r: '#c02a20', R: '#e85040', k: '#2a1418' }, hx: 6 },
  blue_orchid: { top: 8, head: ['..b.', '.bBb', 'bBwb', '.bb.', 'b...'], pal: { b: '#2a8ad8', B: '#5ac8f6', w: '#f0f8ff' }, hx: 6, leaves: [[14, -1], [13, 1], [10, 1]] },
  allium: { top: 7, head: ['.ppp.', 'pPPPp', 'pPPpp', 'pppdp', '.pdp.'], pal: { p: '#b070d8', P: '#dcaef4', d: '#8a4ab0' }, hx: 5, leaves: [[14, -1], [14, 1]] },
  red_tulip: TULIP('#d8382c', '#f47a60'),
  orange_tulip: TULIP('#ee8a2a', '#f8bc5a'),
  white_tulip: TULIP('#e2e2e2', '#ffffff'),
  pink_tulip: TULIP('#ee90b8', '#f8c8dc'),
  oxeye_daisy: { top: 9, head: ['.w.w.', 'wwyww', '.yYy.', 'wwyww', '.w.w.'], pal: { w: '#f4f4f0', y: '#e8b820', Y: '#f8dc50' }, hx: 5 },
  cornflower: { top: 8, head: ['b.b.b', '.bBb.', 'bBBBb', '.bdb.'], pal: { b: '#3a5ae0', B: '#6a8af8', d: '#2a3aa8' }, hx: 5, leaves: [[13, -1], [11, 1]] },
  wither_rose: { top: 8, head: ['.kk.', 'kKgk', 'kkKk', '.kk.'], pal: { k: '#1c1c22', K: '#34343c', g: '#5a5a66' }, hx: 6, stem: '#3a4a2a', leaves: [[13, -1], [11, 1], [10, -1]] },
  torchflower: { top: 9, head: ['..y..', '.yYy.', '.oYo.', 'ooYoo', 'rooor', '.rrr.'], pal: { y: '#f8d040', Y: '#fff0a0', o: '#f08a20', r: '#d8501c' }, hx: 5, stem: '#3a8a6a', leaves: [[14, -1], [13, 1], [11, -1]] },
  cactus_flower: { top: 13, head: ['p.p.p', '.pPp.', 'pPyPp', '.pPp.', 'p.p.p'], pal: { p: '#e85aa0', P: '#f8a0c8', y: '#f8e060' }, hx: 5, leaves: [] },
  closed_eyeblossom: { top: 9, head: ['.gg.', 'gGGg', 'gGGg', '.gg.'], pal: { g: '#5a5a58', G: '#7a7a76' }, hx: 6, stem: '#6a6e68', leaves: [[13, -1], [12, 1]] },
  open_eyeblossom: { top: 9, head: ['g.gg.g', '.gOOg.', 'gOoyOg', 'gOyoOg', '.gOOg.', 'g.gg.g'], pal: { g: '#8a8a86', O: '#e8701c', o: '#f8a040', y: '#fde08a' }, hx: 5, stem: '#6a6e68', leaves: [[13, -1], [12, 1]] }
}
for (const name of Object.keys(FLOWERS)) def(`p:${name}`, () => flower(FLOWERS[name]))
def('p:azure_bluet', () => {
  clear(); const G = PL()
  for (const [x, top] of [[4, 9], [8, 7], [11, 10]]) { for (let y = top; y < S; y++) Q(x, y, G[y > 12 ? 1 : 2]); art(['.w.', 'wyw', '.w.'], { w: hx('#f4f4f0'), y: hx('#f0c830') }, x - 1, top - 3) }
  tuft(G, 5, 2, 4, SEED)
})
def('p:lily_of_the_valley', () => {
  clear(); const G = PL()
  for (let y = 5; y < S; y++) Q(7, y, G[2]); Q(8, 4, G[2]); Q(9, 4, G[3]); Q(10, 5, G[3])
  for (const [x, y] of [[9, 6], [10, 8], [9, 10], [11, 6]]) { Q(x, y, hx('#ffffff')); Q(x, y + 1, hx('#dfe8e0')) }
  for (let k = 0; k < 6; k++) { Q(5 - (k > 2 ? 1 : 0), 15 - k, G[3]); Q(4 - (k > 3 ? 1 : 0), 15 - k, G[1]); Q(6, 15 - k, G[2]) }
})
def('p:brown_mushroom', () => { clear(); art(['....cCCCc....', '..cCCCCCCcc..', '.cccccccccccc', '...dd.ss.dd..', '......ss.....', '......sS.....', '.....sSSs....'], { c: hx('#9a7658'), C: hx('#b89070'), d: hx('#6a4e3a'), s: hx('#d8d0bc'), S: hx('#b8ae98') }, 1, 9) })
def('p:red_mushroom', () => { clear(); art(['...rrrr...', '.rrRwRrrr.', 'rwRRRRRwrr', 'rrRRwRRrrr', 'ddd.ss.ddd', '....ss....', '....sS....', '...sSSs...'], { r: hx('#b8261c'), R: hx('#e04a3a'), w: hx('#f4f0e8'), d: hx('#7a1a14'), s: hx('#e0d8c4'), S: hx('#b8ae98') }, 3, 8) })
def('p:short_grass', () => { clear(); tuft(ramp(C_GRASS, 1), 9, 4, 10, SEED) })
def('p:grass', () => { clear(); tuft(ramp(C_GRASS, 1), 9, 4, 10, SEED) })
def('p:tall_grass:bottom', () => { clear(); tuft(ramp(C_GRASS, 1), 11, 12, 16, SEED) })
def('p:tall_grass:top', () => { clear(); tuft(ramp(C_GRASS, 1), 9, 5, 13, SEED) })
def('p:short_dry_grass', () => { clear(); tuft(ramp('#c2a868', 0.9), 8, 3, 7, SEED) })
def('p:tall_dry_grass', () => { clear(); tuft(ramp('#c2a868', 0.9), 10, 6, 13, SEED) })
def('p:fern', () => { clear(); fernShape(ramp('#4a8f3a', 1), 4, 15, 6) })
def('p:large_fern:bottom', () => { clear(); fernShape(ramp('#4a8f3a', 1), 0, 15, 7); for (let y = 0; y < S; y++) Q(8, y, ramp('#4a8f3a', 1)[1]) })
def('p:large_fern:top', () => { clear(); fernShape(ramp('#4a8f3a', 1), 3, 15, 5) })
def('p:dead_bush', () => {
  clear()
  art(['....a.....a.....', '....a....a......', '.a...a..a...a...', '..a..a..a..a....', '...a.a.a..a.....', '....aaa.aa......', '..a..aaa........', '...a..aa..aa....', '....a.aa.a......', '.....aaaa.......', '......aa........', '......aa........', '......aa........', '.....aaaa.......'], { a: hx('#8a6234') }, 0, 2)
  rim(0.9, -0.9)
})
def('p:bush', () => {
  clear(); const R = ramp('#4f9a3a', 1)
  for (let y = 4; y < S; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot((x - 7.5) / 7, (y - 15) / 11); if (d < 1 && rnd(x, y, SEED) > 0.12) Q(x, y, R[clamp(Math.round(2.6 - (x - 7.5) * 0.12 - (y - 9) * 0.2 + (rnd(x, y, SEED + 1) - 0.5) * 1.6), 0, 4)]) }
})
def('p:firefly_bush', () => {
  clear(); const R = ramp('#4a8a44', 1)
  for (let y = 4; y < S; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot((x - 7.5) / 7, (y - 15) / 11); if (d < 1 && rnd(x, y, SEED) > 0.14) Q(x, y, R[clamp(Math.round(2.4 - (x - 7.5) * 0.12 - (y - 9) * 0.2 + (rnd(x, y, SEED + 1) - 0.5) * 1.6), 0, 4)]) }
  for (const [x, y] of [[4, 8], [10, 6], [7, 11], [12, 12], [3, 13]]) Q(x, y, hx('#f6e86a'))
})
function seagrass (minH: number, maxH: number, n: number): void {
  clear(); const R = ramp('#3f8f5a', 1)
  for (let i = 0; i < n; i++) {
    const x0 = 2 + Math.round(i * 12 / (n - 1)); const h = minH + rint(i, 0, SEED, maxH - minH + 1)
    for (let k = 0; k < h; k++) { const x = x0 + Math.round(Math.sin((k + i * 2) * 0.7) * 1.1); Q(x, 15 - k, R[(i & 1) === 0 ? 3 : 1]); if ((i & 1) === 0) Q(x + 1, 15 - k, R[2]) }
  }
}
def('p:seagrass', () => seagrass(5, 10, 5))
def('p:tall_seagrass:bottom', () => seagrass(16, 16, 5))
def('p:tall_seagrass:top', () => seagrass(7, 14, 5))
function kelp (tip: boolean): void {
  clear(); const R = ramp('#5a8a2a', 1)
  const top = tip ? 4 : 0
  for (let y = top; y < S; y++) { const x = 7 + Math.round(Math.sin(y * 0.8) * 1.2); Q(x, y, R[2]); Q(x + 1, y, R[1]) }
  for (let y = top + 1; y < S; y += 3) { const x = 7 + Math.round(Math.sin(y * 0.8) * 1.2); const d = ((y / 3) & 1) === 0 ? -1 : 1; for (let k = 1; k < 4; k++) { Q(x + d * k + (d > 0 ? 1 : 0), y - (k > 1 ? 1 : 0), R[k === 3 ? 4 : 3]); if (k < 3) Q(x + d * k + (d > 0 ? 1 : 0), y + 1 - (k > 1 ? 1 : 0), R[1]) } }
  if (tip) { Q(7, top - 1, R[4]); Q(8, top - 2, R[3]) }
}
def('p:kelp', () => kelp(true))
def('p:kelp_plant', () => kelp(false))
def('p:cobweb', () => {
  clear(); const W = ramp('#e4e8ec', 0.5)
  for (let i = 0; i < S; i++) { Q(i, i, W[2]); Q(15 - i, i, W[2]); Q(i, 7, W[1]); Q(7, i, W[1]); Q(i, 8, W[3]); Q(8, i, W[3]) }
  for (const r of [3, 6]) for (let k = 0; k <= r; k++) { Q(7 - r + k, 7 - k, W[4]); Q(8 + r - k, 7 - k, W[3]); Q(7 - r + k, 8 + k, W[3]); Q(8 + r - k, 8 + k, W[1]) }
})
def('p:sugar_cane', () => {
  clear(); const R = ramp('#7ab04a', 0.95)
  for (const [x, top] of [[3, 2], [7, 0], [11, 4]]) {
    for (let y = top; y < S; y++) { const node = ((y + x) & 3) === 0; Q(x, y, R[node ? 1 : 3]); Q(x + 1, y, R[node ? 0 : 2]) }
    Q(x + 2, top + 3, R[4]); Q(x + 3, top + 2, R[3]); Q(x - 1, top + 7, R[4]); Q(x - 2, top + 6, R[3])
  }
})
function fungus (cap: string, spot: string): void {
  clear(); const Cp = ramp(cap, 0.95); const St = ramp('#d8c8b8', 0.7)
  art(['...cCCc...', '.ccCsCCcc.', 'ccCCCCsCcc', 'cdddddddcc', '....tt....', '...tTt....', '...tTt....', '..ttTtt...'], { c: Cp[2], C: Cp[3], d: Cp[0], s: hx(spot), t: St[2], T: St[3] }, 3, 8)
  Q(11, 6, Cp[2]); Q(12, 5, Cp[3])
}
def('p:crimson_fungus', () => fungus('#b0282c', '#f6b040'))
def('p:warped_fungus', () => fungus('#1a9a8a', '#f08a3a'))
function curlyRoots (c: string, s: number, tall: number): void {
  clear(); const R = ramp(c, 1)
  for (let i = 0; i < 6; i++) {
    let x = 2 + i * 2 + rint(i, 0, s, 2); const h = 3 + rint(i, 1, s, tall)
    for (let k = 0; k < h; k++) { Q(x, 15 - k, R[k > h - 2 ? 4 : (i & 1) === 0 ? 3 : 2]); if (k % 2 === 1) x += rint(i, k + 2, s, 3) - 1 }
  }
}
def('p:crimson_roots', () => curlyRoots('#b02a34', SEED, 8))
def('p:warped_roots', () => curlyRoots('#1aa890', SEED, 9))
def('p:nether_sprouts', () => curlyRoots('#1aa890', SEED, 3))
def('p:hanging_roots', () => { clear(); tuft(ramp('#b08a68', 0.9), 7, 4, 11, SEED, 0, true) })
function hangingVines (c: string, tipC: string, tip: boolean): void {
  clear(); const R = ramp(c, 1)
  for (const [x, len] of tip ? [[4, 9], [8, 12], [11, 7]] : [[4, 16], [8, 16], [11, 16]]) {
    for (let y = 0; y < len; y++) { const xx = x + Math.round(Math.sin((y + x) * 0.9) * 0.8); Q(xx, y, R[(y & 3) === 0 ? 4 : 2]); if ((y & 3) === 2) Q(xx + ((y & 4) === 0 ? 1 : -1), y, R[3]) }
    if (tip) { Q(x, len, hx(tipC)); Q(x, len - 1, hx(tipC)) }
  }
}
def('p:weeping_vines', () => hangingVines('#a01c24', '#f06a50', true))
def('p:weeping_vines_plant', () => hangingVines('#a01c24', '#f06a50', false))
function risingVines (tip: boolean): void {
  clear(); const R = ramp('#16a08c', 1)
  for (const [x, len] of tip ? [[5, 10], [9, 13]] : [[5, 16], [9, 16]]) {
    for (let k = 0; k < len; k++) { const y = 15 - k; const xx = x + Math.round(Math.sin((k + x) * 1.1) * 1.3); Q(xx, y, R[(k & 3) === 0 ? 4 : 2]); if ((k & 3) === 1) Q(xx + ((k & 4) === 0 ? 1 : -1), y, R[3]) }
  }
}
def('p:twisting_vines', () => risingVines(true))
def('p:twisting_vines_plant', () => risingVines(false))
function caveVines (tip: boolean, lit: boolean): void {
  clear(); const R = ramp('#5a8a2c', 1)
  const len = tip ? 12 : 16
  for (const x of [5, 10]) for (let y = 0; y < len - (x === 10 && tip ? 3 : 0); y++) { Q(x, y, R[2]); if ((y & 3) === 1) { const d = ((y >> 2) & 1) === 0 ? -1 : 1; Q(x + d, y, R[3]); Q(x + d * 2, y + 1, R[4]); Q(x + d, y + 1, R[1]) } }
  if (lit) for (const [x, y] of [[4, 6], [11, 9], [6, 12]]) { Q(x, y, hx('#fbc858')); Q(x + 1, y, hx('#f08a20')); Q(x, y + 1, hx('#f08a20')); Q(x + 1, y + 1, hx('#c8641a')) }
}
def('p:cave_vines', () => caveVines(true, false))
def('p:cave_vines:lit', () => caveVines(true, true))
def('p:cave_vines_plant', () => caveVines(false, false))
def('p:cave_vines_plant:lit', () => caveVines(false, true))
def('p:spore_blossom', () => {
  clear(); const G = PL(); const Pk = ramp('#e87ab0', 0.9)
  rect(5, 0, 6, 2, G[2]); hline(5, 10, 0, G[4])
  art(['..pPPPPp..', '.pPPppPPp.', 'pPPp..pPPp', 'pPp....pPp', 'pp......pp', 'p........p'], { p: Pk[1], P: Pk[3] }, 3, 2)
  for (const [x, y] of [[7, 5], [8, 7], [6, 9], [9, 10]]) Q(x, y, hx('#f8e080'))
})
def('p:bamboo_sapling', () => { clear(); const R = ramp('#6f9a2e', 0.9); for (let y = 6; y < S; y++) { Q(7, y, R[3]); Q(8, y, R[1]) } art(['a....a', '.a..a.', '..aa..'], { a: R[4] }, 5, 4); art(['a...', '.a..'], { a: R[3] }, 4, 9) })
def('p:big_dripleaf_stem', () => { clear(); const R = ramp('#5f9a34', 0.9); for (let y = 0; y < S; y++) { Q(7, y, R[3]); Q(8, y, R[1]) } })
function stemSprite (stage: number, attached: boolean): void {
  clear(); const R = ramp(stage >= 3 && !attached ? '#a8a83a' : '#5a9a3a', 1)
  if (attached) { for (let y = 8; y < S; y++) { Q(7, y, R[2]) } for (let x = 7; x < S; x++) { Q(x, 7 + (x > 11 ? 1 : 0), R[3]) } Q(5, 12, R[4]); Q(6, 13, R[3]); return }
  const h = 3 + stage * 3
  for (let k = 0; k < h; k++) { const x = 7 + Math.round(Math.sin(k * 0.6) * 1.2); Q(x, 15 - k, R[k > h - 2 ? 4 : 2]); if (k % 3 === 2) { Q(x - 1, 15 - k, R[3]); Q(x + 1, 14 - k, R[1]) } }
}
for (let i = 0; i < 4; i++) def(`p:stem:${i}`, () => stemSprite(i, false))
def('p:attached_pumpkin_stem', () => stemSprite(3, true))
def('p:attached_melon_stem', () => stemSprite(3, true))
def('p:pale_hanging_moss', () => { clear(); tuft(ramp('#8b9188', 0.9), 9, 14, 16, SEED, 0, true) })
def('p:pale_hanging_moss:tip', () => { clear(); tuft(ramp('#8b9188', 0.9), 9, 5, 13, SEED, 0, true) })
def('p:mangrove_propagule', () => { clear(); const G = PL(); const B = ramp('#6a4c30', 0.9); for (let y = 9; y < S; y++) { Q(7, y, y > 12 ? B[2] : G[2]); Q(8, y, y > 12 ? B[1] : G[1]) } art(['aA....Aa', '.aA..Aa.', '..aAAa..'], { a: G[2], A: G[4] }, 4, 6) })
def('p:mangrove_propagule:hanging', () => { clear(); const G = PL(); const B = ramp('#6a8a3a', 0.9); art(['.aAAa.', 'aAAAAa', '.aAAa.'], { a: G[2], A: G[4] }, 5, 0); for (let y = 3; y < 13; y++) { Q(7, y, B[3]); Q(8, y, B[1]) } Q(7, 13, B[1]) })
// double-height flowers
function bushBody (R: Ramp, top: number, bottom: number, w: number, s: number): void {
  for (let y = top; y <= bottom; y++) for (let x = 0; x < S; x++) {
    if (Math.abs(x - 7.5) > w + vn(x, y, 5, 5, s) * 2 - 1) continue
    if (rnd(x, y, s) < 0.14) continue
    Q(x, y, R[clamp(Math.round(2.4 - (x - 7.5) * 0.14 + (rnd(x, y, s + 1) - 0.5) * 2), 0, 4)])
  }
}
function blooms (R: Ramp, pts: number[][]): void {
  for (const [x, y] of pts) { Q(x, y, R[3]); Q(x + 1, y, R[2]); Q(x, y + 1, R[2]); Q(x + 1, y + 1, R[1]); Q(x, y - 1, R[4]); Q(x - 1, y, R[3]) }
}
def('p:sunflower:bottom', () => { clear(); const G = PL(); for (let y = 0; y < S; y++) { Q(7, y, G[2]); Q(8, y, G[1]) } for (const [y, d] of [[4, -1], [8, 1], [12, -1]]) { for (let k = 1; k < 5; k++) { Q(7 + d * k + (d > 0 ? 1 : 0), y - (k > 2 ? 1 : 0), G[k === 4 ? 4 : 3]); Q(7 + d * k + (d > 0 ? 1 : 0), y + 1 - (k > 2 ? 1 : 0), G[1]) } } })
def('p:sunflower:top', () => {
  clear(); const G = PL(); const Y = ramp('#f2c224', 0.9); const B = ramp('#6a4420', 0.9)
  for (let y = 10; y < S; y++) { Q(7, y, G[2]); Q(8, y, G[1]) }
  for (let y = 0; y < 12; y++) for (let x = 2; x < 14; x++) { const d = Math.hypot(x - 7.5, y - 5.5); const a = Math.atan2(y - 5.5, x - 7.5); if (d < 2.6) Q(x, y, B[clamp(Math.round(3 - d + (rnd(x, y, 3) - 0.5)), 1, 3)]); else if (d < 5.4 + Math.sin(a * 8) * 0.9) Q(x, y, Y[clamp(Math.round(3.6 - (d - 2.6) * 0.5 - (x + y - 13) * 0.08), 1, 4)]) }
})
def('p:lilac:bottom', () => { clear(); bushBody(ramp('#4a8a3a', 1), 0, 15, 6, SEED); blooms(ramp('#c890d8', 0.8), [[4, 3], [10, 2]]) })
def('p:lilac:top', () => { clear(); bushBody(ramp('#4a8a3a', 1), 9, 15, 5, SEED); const L = ramp('#c890d8', 0.8); for (let y = 2; y < 12; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot((x - 7.5) / 4.2, (y - 6.5) / 5); if (d < 1 && rnd(x, y, SEED) > 0.15) Q(x, y, L[clamp(Math.round(2.6 - (x - 7.5) * 0.15 - (y - 6) * 0.15 + (rnd(x, y, SEED + 1) - 0.5) * 2), 0, 4)]) } })
def('p:rose_bush:bottom', () => { clear(); bushBody(ramp('#3f7f34', 1), 0, 15, 6, SEED); blooms(ramp('#d8302c', 0.9), [[3, 5], [11, 9], [7, 2]]) })
def('p:rose_bush:top', () => { clear(); bushBody(ramp('#3f7f34', 1), 4, 15, 5, SEED); blooms(ramp('#d8302c', 0.9), [[5, 6], [10, 9], [8, 12], [3, 12]]) })
def('p:peony:bottom', () => { clear(); bushBody(ramp('#4a8a3a', 1), 0, 15, 6, SEED); blooms(ramp('#f0a8d0', 0.8), [[4, 6], [10, 3]]) })
def('p:peony:top', () => { clear(); bushBody(ramp('#4a8a3a', 1), 6, 15, 5, SEED); const L = ramp('#f0a8d0', 0.8); for (const [cx, cy, r] of [[5, 6, 3], [10, 8, 3], [8, 3, 2.4]]) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - cx, y - cy); if (d < r) Q(x, y, L[d < r * 0.35 ? 1 : d < r * 0.7 ? 3 : 2 + ((x + y) & 1) * 2]) } })
def('p:pitcher_plant:bottom', () => { clear(); const G = ramp('#4a8a6a', 1); for (let y = 0; y < S; y++) { Q(7, y, G[2]); Q(8, y, G[1]) } for (const [y, d] of [[6, -1], [10, 1], [13, -1]]) for (let k = 1; k < 6; k++) { Q(7 + d * k + (d > 0 ? 1 : 0), y - (k >> 1), G[k === 5 ? 4 : 3]); Q(7 + d * k + (d > 0 ? 1 : 0), y + 1 - (k >> 1), G[1]) } })
def('p:pitcher_plant:top', () => { clear(); const G = ramp('#4a8a6a', 1); const Pu = ramp('#7a5ac0', 0.9); const Cy = ramp('#5ac8d8', 0.8); for (let y = 9; y < S; y++) { Q(7, y, G[2]); Q(8, y, G[1]) } art(['..cCCc..', '.cCppCc.', 'cCpPPpCc', 'cppPPppc', '.pppppp.', '..pPPp..', '...pp...'], { c: Cy[2], C: Cy[4], p: Pu[2], P: Pu[0] }, 4, 2) })
def('p:small_dripleaf:bottom', () => { clear(); const R = ramp('#5f9a34', 0.9); for (let y = 0; y < S; y++) { Q(7, y, R[3]); Q(8, y, R[1]) } })
def('p:small_dripleaf:top', () => { clear(); const R = ramp('#5f9a34', 0.9); for (let y = 6; y < S; y++) { Q(7, y, R[3]); Q(8, y, R[1]) } art(['.aAAAa.', 'aAAAAAa', '.aaaaa.'], { a: R[2], A: R[4] }, 1, 4); art(['.aAAa.', 'aAAAAa', '.aaaa.'], { a: R[1], A: R[3] }, 9, 8) })
// crops
function wheat (age: number): void {
  clear()
  const t = age / 7
  const R = ramp(mix(hx('#4f9a38'), hx('#d8b83a'), Math.max(0, (t - 0.45) / 0.55)), 1)
  const h = 3 + Math.round(t * 11)
  for (let i = 0; i < 6; i++) {
    const x = 1 + i * 3 - (i & 1); const hh = h - rint(i, 0, 11, 3)
    for (let k = 0; k < hh; k++) Q(x + (k > hh * 0.7 && (i & 1) === 0 ? 1 : 0), 15 - k, R[k < 2 ? 1 : (i & 1) === 0 ? 3 : 2])
    if (age >= 5) { const top = 15 - hh; for (let k = 0; k < 4; k++) { Q(x + 1, top + k, R[4]); Q(x - 1 + (k & 1) * 2, top + k + 1, R[3]) } }
  }
}
for (let i = 0; i < 8; i++) def(`p:wheat:${i}`, () => wheat(i))
function leafyCrop (stage: number, leaf: string, root: string | null, stemC: string | null): void {
  clear(); const G = ramp(leaf, 1)
  const h = 3 + stage * 2
  for (const x0 of [3, 8, 12]) {
    for (let i = -1; i <= 1; i++) for (let k = 0; k < h - Math.abs(i); k++) Q(x0 + i * (1 + (k > 2 ? 1 : 0)), 15 - k - (root !== null && stage === 3 ? 2 : 0), stemC !== null && k < 2 ? hx(stemC) : G[i < 0 ? 4 : i === 0 ? 2 : 1])
    if (root !== null && stage === 3) { const Rt = ramp(root, 0.9); Q(x0 - 1, 14, Rt[3]); Q(x0, 14, Rt[2]); Q(x0, 15, Rt[2]); Q(x0 + 1, 14, Rt[1]); Q(x0 - 1, 15, Rt[3]); Q(x0 + 1, 15, Rt[0]) }
  }
}
for (let i = 0; i < 4; i++) {
  def(`p:carrots:${i}`, () => leafyCrop(i, '#4f9a38', '#f08a1c', null))
  def(`p:potatoes:${i}`, () => leafyCrop(i, '#3f8a44', '#d8b86a', null))
  def(`p:beetroots:${i}`, () => leafyCrop(i, '#4a8a3a', '#a8242c', '#b03040'))
  def(`p:sweet_berry_bush:${i}`, () => {
    clear(); const R = ramp('#3f7f44', 1); const top = 12 - i * 3
    for (let y = top; y < S; y++) for (let x = 1; x < 15; x++) { if (Math.abs(x - 7.5) > 2.5 + (y - top) * 0.6 + i) continue; if (rnd(x, y, SEED) < 0.16) continue; Q(x, y, R[clamp(Math.round(2.4 - (x - 7.5) * 0.14 + (rnd(x, y, SEED + 1) - 0.5) * 2), 0, 4)]) }
    if (i >= 2) for (const [x, y] of i === 3 ? [[4, 9], [10, 7], [7, 12], [12, 12], [5, 5]] : [[5, 10], [10, 9]]) { Q(x, y, hx('#e83a3a')); Q(x + 1, y, hx('#a81c24')); Q(x, y + 1, hx('#a81c24')) }
  })
}
for (let i = 0; i < 3; i++) def(`p:nether_wart:${i}`, () => {
  clear(); const R = ramp('#a8242c', 1)
  const h = 3 + i * 3
  for (const x0 of [3, 8, 12]) for (let k = 0; k < h; k++) { const w = k < h - 2 ? 1 : 2; for (let j = -w + 1; j <= w - 1 + (w === 1 ? 0 : 0); j++) Q(x0 + j, 15 - k, R[j < 0 ? 3 : k > h - 3 ? 4 : 2]); if (w === 1) Q(x0 + 1, 15 - k, R[1]) }
})
def('p:torchflower_crop:0', () => { clear(); const G = ramp('#3a8a6a', 1); for (let y = 11; y < S; y++) Q(7, y, G[2]); art(['a.a', '.a.'], { a: G[4] }, 6, 9) })
def('p:torchflower_crop:1', () => { clear(); const G = ramp('#3a8a6a', 1); for (let y = 7; y < S; y++) Q(7, y, G[2]); art(['a...a', '.a.a.', '..a..'], { a: G[4] }, 5, 9); art(['.o.', 'oYo', '.o.'], { o: hx('#f08a20'), Y: hx('#f8d040') }, 6, 4) })
function pitcherCrop (age: number, top: boolean): void {
  clear(); const G = ramp('#4a8a6a', 1)
  if (age === 0 && !top) { art(['.aAa.', 'aAAAa', 'aaaaa', '.aaa.'], { a: hx('#8a6a4a'), A: hx('#b08a60') }, 5, 12); return }
  const total = [0, 6, 12, 22, 30][age]
  const from = top ? 16 : 0
  for (let k = from; k < Math.min(total, from + 16); k++) { const y = 15 - (k - from); Q(7, y, G[2]); Q(8, y, G[1]); if (k % 4 === 2) { const d = ((k >> 2) & 1) === 0 ? -1 : 1; for (let j = 1; j < 5; j++) { Q(7 + d * j + (d > 0 ? 1 : 0), y - (j >> 1), G[j === 4 ? 4 : 3]) } } }
  if (age === 4 && top) art(['.cCCc.', 'cCppCc', 'cpPPpc', '.pppp.'], { c: hx('#5ac8d8'), C: hx('#a8ecf0'), p: hx('#7a5ac0'), P: hx('#4a3a8a') }, 5, 0)
}
for (let i = 0; i < 5; i++) { def(`p:pitcher_crop:${i}`, () => pitcherCrop(i, false)); def(`p:pitcher_crop:${i}:top`, () => pitcherCrop(i, true)) }
// dripstone & crystals
fam('p', (a) => {
  clear()
  if (a[0] === 'dripstone') {
    const R = ramp('#866a5a', 0.9)
    const prof: Record<string, [number, number, number]> = { tip: [0.5, 2, 5], tip_merge: [1, 2, 0], frustum: [2, 3, 0], middle: [3, 4, 0], base: [4, 6, 0] }
    const [wTop, wBot, top] = prof[a[1]] ?? prof.tip
    for (let y = top; y < S; y++) { const w = wTop + (wBot - wTop) * (y - top) / (15 - top); for (let x = 0; x < S; x++) { const d = Math.abs(x - 7.5); if (d <= w) Q(x, y, R[clamp(Math.round(2.4 - (x - 7.5) * 0.5 + (rnd(x, y, 7) - 0.5) * 1.4), 0, 4)]) } }
    return
  }
  if (a[0] === 'amethyst') {
    const R = ramp('#9a6ad8', 0.9); const size = Number(a[1]) | 0
    const crystals: number[][] = [[7, 4 + size * 3, 2], [4, 2 + size * 2, 1], [11, 3 + size * 2, 1], [9, 1 + size * 2, 1], [2, size, 1], [13, size + 1, 1]].slice(0, 2 + size + (size > 1 ? 1 : 0))
    for (const [cx, h, w] of crystals) for (let k = 0; k < h; k++) { const ww = k > h - 3 ? Math.max(0, w - (k - (h - 3))) : w; for (let j = -ww; j <= ww; j++) Q(cx + j, 15 - k, R[j < 0 ? 4 : j === 0 ? 3 : 1]) }
    return
  }
  // unknown plant: a neutral sprout
  tuft(PL(), 5, 3, 7, SEED)
})

// flat decals & plates ----------------------------------------------------------
fam('petals', (a) => {
  clear()
  const n = clamp(Number(a[1]) | 0, 1, 4)
  const quads = [[0, 0], [8, 8], [8, 0], [0, 8]]
  for (let q = 0; q < n; q++) {
    const [ox, oy] = quads[q]
    if (a[0] === 'litter') {
      const R = ramp(['#8a5a2a', '#a8742c', '#6a4420'][q % 3], 0.9)
      for (const [x, y] of [[1, 2], [4, 5], [5, 1]]) art(['.aA', 'aAa', 'a..'], { a: R[2], A: R[3] }, ox + x - 1, oy + y - 1)
    } else {
      const cols = a[0] === 'pink' ? ['#f6a8cc', '#f6a8cc', '#f6a8cc'] : ['#f6e060', '#f4f4f0', '#f0a030']
      const G = PL()
      for (const [k, [x, y]] of [[1, 1], [5, 2], [2, 5]].entries()) { const c = hx(cols[(k + q) % 3]); art(['.a.', 'aba', '.a.'], { a: c, b: tone(c, 1.5) }, ox + x - 1, oy + y - 1) }
      Q(ox + 4, oy + 5, G[2]); Q(ox + 6, oy + 6, G[3]); Q(ox + 3, oy + 3, G[1])
    }
  }
})
def('lily_pad', () => {
  clear(); const R = ramp('#3f8a34', 0.95)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5); const a = Math.atan2(y - 7.5, x - 7.5)
    if (d > 6.6 || (Math.abs(a - 0.5) < 0.22 && d > 1.5)) continue
    Q(x, y, R[d > 5.6 ? 1 : Math.abs(Math.sin(a * 4)) < 0.2 && d > 1 ? 1 : 2 + (x + y < 13 ? 1 : 0)])
  }
})
def('frogspawn', () => { clear(); for (let i = 0; i < 14; i++) { const x = 1 + rint(i, 0, SEED, 13); const y = 1 + rint(i, 1, SEED, 13); Q(x, y, hx('#c8ccd8')); Q(x + 1, y, hx('#a8aebe')); Q(x, y + 1, hx('#a8aebe')); Q(x + 1, y + 1, hx('#2a2c34')) } })
def('vine', () => {
  clear(); const R = ramp('#3f7f2c', 1)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = vn(x, y, 6, 3, SEED) * 0.7 + vn(x, y, 9, 6, SEED + 1) * 0.3; const len = 6 + vn(x, 0, 5, 1, SEED + 2) * 12; if (v > 0.42 && y < len) Q(x, y, R[clamp(Math.round(1 + (v - 0.42) * 7), 1, 4)]) }
})
function blotches (R: Ramp, amount: number, glow: RGB | null): void {
  clear()
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = vn(x, y, 4, 4, SEED) * 0.65 + vn(x, y, 8, 8, SEED + 1) * 0.35; if (v > 1 - amount) Q(x, y, glow !== null && v > 1 - amount * 0.45 ? glow : R[clamp(Math.round(1 + (v - (1 - amount)) * 12), 1, 4)]) }
}
def('glow_lichen', () => blotches(ramp('#6f8a80', 0.9), 0.48, hx('#c8f0d8')))
def('resin_clump', () => blotches(ramp('#e8751f', 0.9), 0.4, hx('#fbb04a')))

// potted plants -----------------------------------------------------------------
fam('potted', (a) => {
  clear()
  const inner = a.join(':')
  if (inner.startsWith('cactus')) {
    const R = ramp('#5a8c32', 0.9)
    for (let y = 2; y < 10; y++) for (let x = 6; x < 10; x++) Q(x, y, R[x === 6 ? 1 : x === 7 ? 3 : x === 8 ? 2 : 0])
    Q(7, 4, hx('#e8e6c8')); Q(9, 7, hx('#e8e6c8')); Q(6, 6, hx('#e8e6c8'))
  } else if (inner.startsWith('bamboo')) {
    const R = ramp('#6f9a2e', 0.9)
    for (let y = 0; y < 10; y++) { Q(7, y, R[(y & 3) === 2 ? 1 : 3]); Q(8, y, R[(y & 3) === 2 ? 0 : 1]) }
    art(['aA..', '.aA.'], { a: R[2], A: R[4] }, 9, 2); art(['..Aa', '.Aa.'], { a: R[2], A: R[4] }, 3, 5)
  } else if (inner.startsWith('azalea')) {
    const src = tilePixels(inner.includes('flowering') ? 'leaves:flowering_azalea' : 'leaves:azalea')
    for (let y = 1; y < 10; y++) for (let x = 2; x < 14; x++) { const d = Math.hypot((x - 7.5) / 6, (y - 5.5) / 4.5); const i = ((y << 4) | x) << 2; if (d < 1 && src[i + 3] > 0) Q(x, y, [src[i], src[i + 1], src[i + 2]]) }
  } else {
    const src = tilePixels(inner)
    for (let y = 0; y < 10; y++) for (let x = 0; x < S; x++) { const i = (((y + 6) << 4) | x) << 2; if (src[i + 3] > 0) Q(x, y, [src[i], src[i + 1], src[i + 2]]) }
  }
  potShape()
})

// fallback ----------------------------------------------------------------------
fam('fallback', (a) => {
  const h = hashStr(a.join(':'))
  const R = ramp(hsv2rgb(h % 360, 0.2, 0.52), 0.8)
  tex(R, { p: 4, q: 7, gain: 2.4, lit: 2, s: h | 1 })
  bevel(R, 1, 3.4, 0.8)
})


// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------
function paintBase (key: string): void {
  const u = U.get(key)
  if (u !== undefined) { u([]); return }
  const parts = key.split(':')
  const f = F.get(parts[0])
  if (f !== undefined) { f(parts.slice(1)); return }
  tex(ramp('#808488', 0.7), { gain: 2.4 })
}

/**
 * Paint one 16×16 RGBA tile for a key produced by materials.ts into `out`
 * (row-major, row 0 = top). Deterministic: the only entropy is the key itself.
 */
export function paintTile (key: string, out: Uint8ClampedArray): void {
  const [base, op] = stripOp(key)
  const prevD = D; const prevSeed = SEED
  const buf = op === 0 ? out : new Uint8ClampedArray(N)
  D = buf
  SEED = hashStr(base) | 1
  try {
    D.fill(0, 0, N)
    paintBase(base)
  } finally {
    D = prevD; SEED = prevSeed
  }
  if (op !== 0) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let sx = (op & 2) !== 0 ? 15 - x : x
        let sy = (op & 4) !== 0 ? 15 - y : y
        if ((op & 1) !== 0) { const t = sx; sx = sy; sy = t }
        const si = ((sy << 4) | sx) << 2; const di = ((y << 4) | x) << 2
        out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3]
      }
    }
  }
}

/** Paint a tile into a fresh buffer (convenience for composites and icons). */
export function tilePixels (key: string): Uint8ClampedArray {
  const out = new Uint8ClampedArray(N)
  paintTile(key, out)
  return out
}
