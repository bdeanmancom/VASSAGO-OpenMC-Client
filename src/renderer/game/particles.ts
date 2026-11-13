/**
 * Block fragments: small square points that fly off a block while it is being hit and
 * burst out of it when it breaks. One draw call, a fixed pool, simple gravity.
 */
import * as THREE from 'three'
import type { RGB3 } from './blockfx'

const MAX = 768
const GRAVITY = 14

export class Particles {
  readonly points: THREE.Points
  private pos = new Float32Array(MAX * 3)
  private col = new Float32Array(MAX * 3)
  private vel = new Float32Array(MAX * 3)
  private life = new Float32Array(MAX) // seconds left; <= 0 means free
  private next = 0
  private alive = 0

  constructor () {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    g.setDrawRange(0, 0)
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, sizeAttenuation: true }))
    this.points.frustumCulled = false
    this.points.renderOrder = 2
    this.pos.fill(1e9)
  }

  get count () { return this.alive }

  private spawn (x: number, y: number, z: number, vx: number, vy: number, vz: number, c: RGB3, light: number, life: number) {
    const i = this.next
    this.next = (this.next + 1) % MAX
    if (this.life[i] <= 0) this.alive++
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz
    this.col[i * 3] = c[0] * light; this.col[i * 3 + 1] = c[1] * light; this.col[i * 3 + 2] = c[2] * light
    this.life[i] = life
  }

  /** A few fragments knocked off the face being hit. `normal` points out of the block. */
  hit (bx: number, by: number, bz: number, normal: readonly [number, number, number] | readonly number[], colors: RGB3[], light: number) {
    for (const c of colors) {
      const u = Math.random() - 0.5; const v = Math.random() - 0.5
      // a point on the face, pushed just outside it
      const x = bx + 0.5 + normal[0] * 0.52 + (normal[0] === 0 ? u * 0.8 : 0)
      const y = by + 0.5 + normal[1] * 0.52 + (normal[1] === 0 ? (normal[0] === 0 ? v : u) * 0.8 : 0)
      const z = bz + 0.5 + normal[2] * 0.52 + (normal[2] === 0 ? v * 0.8 : 0)
      this.spawn(x, y, z, normal[0] * 1.2 + (Math.random() - 0.5) * 1.4, normal[1] * 1.2 + 1 + Math.random() * 1.5, normal[2] * 1.2 + (Math.random() - 0.5) * 1.4, c, light, 0.35 + Math.random() * 0.35)
    }
  }

  /** The block gives way: fragments from all through its volume. */
  burst (bx: number, by: number, bz: number, colors: RGB3[], light: number) {
    for (const c of colors) {
      const x = bx + 0.15 + Math.random() * 0.7; const y = by + 0.15 + Math.random() * 0.7; const z = bz + 0.15 + Math.random() * 0.7
      this.spawn(x, y, z, (x - bx - 0.5) * 4 + (Math.random() - 0.5), 1 + Math.random() * 2.5 + (y - by - 0.5) * 2, (z - bz - 0.5) * 4 + (Math.random() - 0.5), c, light, 0.5 + Math.random() * 0.6)
    }
  }

  update (dt: number) {
    if (this.alive === 0) { if (this.points.geometry.drawRange.count !== 0) this.points.geometry.setDrawRange(0, 0); return }
    const step = Math.min(dt, 0.1)
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= step
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = 1e9; this.alive--; continue }
      this.vel[i * 3 + 1] -= GRAVITY * step
      this.pos[i * 3] += this.vel[i * 3] * step
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * step
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * step
    }
    const g = this.points.geometry
    g.setDrawRange(0, MAX)
    ;(g.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(g.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  dispose () {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
