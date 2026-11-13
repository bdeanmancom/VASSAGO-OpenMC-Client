/**
 * Client-side world: chunk storage (SharedArrayBuffer-backed when available so mesher
 * workers read without copies), dirty tracking, the meshing job scheduler and the
 * Three.js meshes for every chunk section.
 */
import * as THREE from 'three'
import type { SectionDTO } from '../../shared/protocol'
import type { MesherRequest, MesherResponse } from './mesher.worker'
import type { MeshData } from './mesher'
import { tablesOf, type Registry } from './registry'

const SharedBuf: typeof ArrayBuffer = (typeof SharedArrayBuffer !== 'undefined' && (globalThis as any).crossOriginIsolated !== false)
  ? (SharedArrayBuffer as unknown as typeof ArrayBuffer)
  : ArrayBuffer

interface Section {
  blocks: Uint16Array | null
  light: Uint8Array | number
  version: number
  meshedVersion: number
  queued: boolean
  opaque: THREE.Mesh | null
  translucent: THREE.Mesh | null
}

interface Column {
  x: number
  z: number
  minY: number
  sections: Section[]
  group: THREE.Group
}

export interface WorldStats { columns: number, sectionsMeshed: number, queue: number, meshMsAvg: number, triangles: number, workers: number }

const key = (x: number, z: number) => `${x},${z}`

export class World {
  readonly group = new THREE.Group()
  private columns = new Map<string, Column>()
  private workers: Worker[] = []
  private idle: Worker[] = []
  private jobs = new Map<number, { col: Column, si: number, version: number }>()
  private nextJob = 1
  private dirty = new Set<Section>()
  private dirtyInfo = new Map<Section, { col: Column, si: number }>()
  private meshMs = 0
  private meshCount = 0
  private triangles = 0
  smoothLighting = true
  renderDistance = 8
  /** set by the game each frame; used to prioritise meshing */
  cameraChunk = { x: 0, y: 0, z: 0 }
  onFirstMesh: (() => void) | null = null
  private meshedAny = false
  private urgent: Section[] = []
  private sorted: Section[] = []
  private sortedAt = 0
  private sortStale = false

  constructor (private reg: Registry, private opaqueMat: THREE.Material, private transMat: THREE.Material, workerCount: number) {
    const tables = tablesOf(reg)
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' })
      w.postMessage({ t: 'init', tables } satisfies MesherRequest)
      w.onmessage = (ev: MessageEvent<MesherResponse>) => this.onMeshed(w, ev.data)
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  // ----------------------------------------------------------------- storage

  private share<T extends Uint16Array | Uint8Array> (src: T): T {
    const buf = new SharedBuf(src.byteLength)
    const out = (src instanceof Uint16Array ? new Uint16Array(buf) : new Uint8Array(buf)) as T
    out.set(src as any)
    return out
  }

  setChunk (x: number, z: number, minY: number, sections: SectionDTO[]) {
    const old = this.columns.get(key(x, z))
    if (old) this.disposeColumn(old)
    const group = new THREE.Group()
    group.position.set(x * 16, minY, z * 16)
    group.matrixAutoUpdate = false
    group.updateMatrix()
    this.group.add(group)
    let top = -1
    sections.forEach((s, i) => { if (s.blocks) top = i })
    const col: Column = {
      x,
      z,
      minY,
      group,
      sections: sections.map((s, i) => ({
        blocks: s.blocks ? this.share(s.blocks) : null,
        light: typeof s.light === 'number' ? inferLight(s.light, i, top) : this.share(s.light),
        version: 1,
        meshedVersion: 0,
        queued: false,
        opaque: null,
        translucent: null
      }))
    }
    this.columns.set(key(x, z), col)
    // This column and any neighbour that just became fully surrounded can now be meshed.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.columns.get(key(x + dx, z + dz))
        if (!c) continue
        for (let si = 0; si < c.sections.length; si++) {
          const sec = c.sections[si]
          if (dx === 0 && dz === 0) this.markDirty(c, si)
          else if (sec.meshedVersion === 0 || old) this.markDirty(c, si)
        }
      }
    }
  }

  setLight (x: number, z: number, light: (Uint8Array | number)[]) {
    const col = this.columns.get(key(x, z))
    if (!col) return
    let top = -1
    col.sections.forEach((s, i) => { if (s.blocks) top = i })
    for (let i = 0; i < col.sections.length && i < light.length; i++) {
      const sec = col.sections[i]
      const l = light[i]
      if (typeof l === 'number') {
        const v = inferLight(l, i, top)
        if (sec.light === v) continue
        sec.light = v
      } else if (typeof sec.light !== 'number') {
        if (equalBytes(sec.light, l)) continue
        sec.light.set(l)
      } else sec.light = this.share(l)
      sec.version++
      this.markDirty(col, i)
      if (i > 0) this.touch(col, i - 1)
      if (i + 1 < col.sections.length) this.touch(col, i + 1)
    }
  }

  unloadChunk (x: number, z: number) {
    const col = this.columns.get(key(x, z))
    if (!col) return
    this.disposeColumn(col)
    this.columns.delete(key(x, z))
  }

  clear () {
    for (const col of this.columns.values()) this.disposeColumn(col)
    this.columns.clear()
    this.dirty.clear()
    this.dirtyInfo.clear()
    this.urgent = []
    this.sorted = []
    this.meshedAny = false
  }

  dispose () {
    this.clear()
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.idle = []
  }

  private disposeColumn (col: Column) {
    for (const sec of col.sections) {
      this.disposeMesh(sec.opaque); this.disposeMesh(sec.translucent)
      sec.opaque = null; sec.translucent = null
      sec.version = -1
      this.dirty.delete(sec); this.dirtyInfo.delete(sec)
    }
    this.group.remove(col.group)
  }

  private disposeMesh (m: THREE.Mesh | null) {
    if (!m) return
    this.triangles -= (m.geometry.index?.count ?? 0) / 3
    m.parent?.remove(m)
    m.geometry.dispose()
  }

  getBlock (x: number, y: number, z: number): number {
    const col = this.columns.get(key(x >> 4, z >> 4))
    if (!col) return 0
    const si = (y - col.minY) >> 4
    const sec = col.sections[si]
    if (!sec || !sec.blocks) return 0
    return sec.blocks[(((y - col.minY) & 15) << 8) | ((z & 15) << 4) | (x & 15)]
  }

  /** packed light sky<<4|block at a position (15 sky when unknown). */
  getLight (x: number, y: number, z: number): number {
    const col = this.columns.get(key(x >> 4, z >> 4))
    if (!col) return 0xf0
    const si = (y - col.minY) >> 4
    const sec = col.sections[si]
    if (!sec) return 0xf0
    if (typeof sec.light === 'number') return sec.light
    return sec.light[(((y - col.minY) & 15) << 8) | ((z & 15) << 4) | (x & 15)]
  }

  hasChunk (x: number, z: number) { return this.columns.has(key(x, z)) }

  setBlock (x: number, y: number, z: number, state: number) {
    const col = this.columns.get(key(x >> 4, z >> 4))
    if (!col) return
    const ly = y - col.minY
    const si = ly >> 4
    const sec = col.sections[si]
    if (!sec) return
    if (!sec.blocks) {
      if (state === 0) return
      sec.blocks = new Uint16Array(new SharedBuf(4096 * 2))
    }
    const lx = x & 15; const lz = z & 15; const yy = ly & 15
    const idx = (yy << 8) | (lz << 4) | lx
    if (sec.blocks[idx] === state) return
    sec.blocks[idx] = state
    sec.version++
    this.markDirty(col, si, true)
    // neighbours sharing a border (including diagonals, for ambient occlusion)
    const xs = lx === 0 ? [-1, 0] : lx === 15 ? [0, 1] : [0]
    const ys = yy === 0 ? [-1, 0] : yy === 15 ? [0, 1] : [0]
    const zs = lz === 0 ? [-1, 0] : lz === 15 ? [0, 1] : [0]
    for (const dx of xs) {
      for (const dz of zs) {
        const c = dx === 0 && dz === 0 ? col : this.columns.get(key(col.x + dx, col.z + dz))
        if (!c) continue
        for (const dy of ys) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          const nsi = si + dy
          if (nsi >= 0 && nsi < c.sections.length) this.touch(c, nsi, true)
        }
      }
    }
  }

  private touch (col: Column, si: number, urgent = false) {
    col.sections[si].version++
    this.markDirty(col, si, urgent)
  }

  private markDirty (col: Column, si: number, urgent = false) {
    const sec = col.sections[si]
    if (sec.version < 0) return
    // Empty sections with nothing on screen are trivially up to date.
    if (!sec.blocks && !sec.opaque && !sec.translucent) {
      sec.meshedVersion = sec.version
      if (this.dirty.delete(sec)) this.dirtyInfo.delete(sec)
      return
    }
    if (!this.dirty.has(sec)) { this.dirty.add(sec); this.dirtyInfo.set(sec, { col, si }) }
    if (urgent) this.urgent.push(sec)
    this.sortStale = true
  }

  // ---------------------------------------------------------------- meshing

  private surrounded (col: Column): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if ((dx !== 0 || dz !== 0) && !this.columns.has(key(col.x + dx, col.z + dz))) return false
      }
    }
    return true
  }

  /** Dispatch pending mesh jobs to idle workers. Called every frame and whenever a worker finishes. */
  pump () {
    while (this.idle.length > 0) {
      const sec = this.nextCandidate()
      if (!sec) return
      const info = this.dirtyInfo.get(sec)
      if (!info || sec.queued || sec.version < 0) continue
      const { col, si } = info
      this.dirty.delete(sec); this.dirtyInfo.delete(sec)
      ;(sec as any).urgent = false
      // Nothing to draw: no round trip to a worker needed.
      if (!sec.blocks) {
        this.applyMesh(col, si, sec, null, null)
        sec.meshedVersion = sec.version
        continue
      }
      const blocks: (Uint16Array | null)[] = []
      const light: (Uint8Array | number)[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nc = dx === 0 && dz === 0 ? col : this.columns.get(key(col.x + dx, col.z + dz))
            const ns = nc?.sections[si + dy]
            blocks.push(ns?.blocks ?? null)
            light.push(ns ? ns.light : (dy > 0 ? 0xf0 : 0))
          }
        }
      }
      const id = this.nextJob++
      this.jobs.set(id, { col, si, version: sec.version })
      sec.queued = true
      const w = this.idle.pop()!
      w.postMessage({ t: 'mesh', id, blocks, light, smooth: this.smoothLighting } satisfies MesherRequest)
    }
  }

  /** Next section to mesh: urgent (block edits) first, then nearest-first from a periodically rebuilt list. */
  private nextCandidate (): Section | null {
    while (this.urgent.length > 0) {
      const sec = this.urgent.pop()!
      if (this.dirty.has(sec) && !sec.queued) return sec
    }
    const now = performance.now()
    if (this.sorted.length === 0 || (this.sortStale && now - this.sortedAt > 250)) {
      if (this.dirty.size === 0) return null
      if (this.sorted.length === 0 && !this.sortStale && now - this.sortedAt < 100) return null
      const cam = this.cameraChunk
      const surround = new Map<Column, boolean>()
      const list: { sec: Section, score: number }[] = []
      for (const sec of this.dirty) {
        if (sec.queued) continue
        const info = this.dirtyInfo.get(sec)!
        let ok = surround.get(info.col)
        if (ok === undefined) { ok = this.surrounded(info.col); surround.set(info.col, ok) }
        if (!ok) continue
        const dx = info.col.x - cam.x; const dz = info.col.z - cam.z
        const dy = (info.si + (info.col.minY >> 4)) - cam.y
        list.push({ sec, score: dx * dx + dz * dz + dy * dy * 0.5 })
      }
      list.sort((a, b) => b.score - a.score) // farthest first; we pop from the end
      this.sorted = list.map(l => l.sec)
      this.sortedAt = now
      this.sortStale = false
    }
    while (this.sorted.length > 0) {
      const sec = this.sorted.pop()!
      if (this.dirty.has(sec) && !sec.queued) return sec
    }
    return null
  }

  private onMeshed (w: Worker, res: MesherResponse) {
    this.idle.push(w)
    try { this.finishJob(res) } finally { this.pump() }
  }

  private finishJob (res: MesherResponse) {
    const job = this.jobs.get(res.id)
    this.jobs.delete(res.id)
    if (!job) return
    const sec = job.col.sections[job.si]
    sec.queued = false
    if (sec.version < 0) return // column unloaded meanwhile
    this.meshMs += res.ms; this.meshCount++
    this.applyMesh(job.col, job.si, sec, res.opaque, res.translucent)
    sec.meshedVersion = job.version
    if (sec.version !== job.version) this.markDirty(job.col, job.si, true)
    if (!this.meshedAny) { this.meshedAny = true; this.onFirstMesh?.() }
  }

  private applyMesh (col: Column, si: number, sec: Section, opaque: MeshData | null, translucent: MeshData | null) {
    this.disposeMesh(sec.opaque); this.disposeMesh(sec.translucent)
    sec.opaque = opaque ? this.buildMesh(opaque, this.opaqueMat, si, 0) : null
    sec.translucent = translucent ? this.buildMesh(translucent, this.transMat, si, 1) : null
    if (sec.opaque) col.group.add(sec.opaque)
    if (sec.translucent) col.group.add(sec.translucent)
  }

  private buildMesh (data: MeshData, mat: THREE.Material, si: number, order: number): THREE.Mesh {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    g.setAttribute('uvl', new THREE.BufferAttribute(data.uvl, 3))
    g.setAttribute('shade', new THREE.BufferAttribute(data.shade, 4, true))
    g.setIndex(new THREE.BufferAttribute(data.indices, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14.2)
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 16, 16))
    const m = new THREE.Mesh(g, mat)
    m.position.set(0, si * 16, 0)
    m.matrixAutoUpdate = false
    m.updateMatrix()
    m.renderOrder = order
    this.triangles += data.indices.length / 3
    return m
  }

  /** Hide columns beyond the client render distance. */
  updateVisibility () {
    const cam = this.cameraChunk
    const r = this.renderDistance + 0.5
    for (const col of this.columns.values()) {
      const dx = col.x - cam.x; const dz = col.z - cam.z
      col.group.visible = dx * dx + dz * dz <= r * r + 2
    }
  }

  stats (): WorldStats {
    let meshed = 0
    for (const col of this.columns.values()) for (const s of col.sections) if (s.opaque || s.translucent) meshed++
    return {
      columns: this.columns.size,
      sectionsMeshed: meshed,
      queue: this.jobs.size + this.sorted.length + this.urgent.length,
      meshMsAvg: this.meshCount ? this.meshMs / this.meshCount : 0,
      triangles: Math.round(this.triangles),
      workers: this.workers.length
    }
  }

  /** True when the column the camera is in (and its neighbours) have been meshed. */
  readyAround (cx: number, cz: number): boolean {
    const col = this.columns.get(key(cx, cz))
    if (!col) return false
    if (!this.surrounded(col)) return false
    return col.sections.every(s => s.meshedVersion > 0)
  }
}

/** Sections without stored light: open sky above the terrain, darkness below. */
function inferLight (v: number, index: number, topSolid: number): number {
  if (v >= 0) return v
  return index > topSolid ? 0xf0 : 0x00
}

function equalBytes (a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
