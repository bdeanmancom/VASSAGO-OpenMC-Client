/**
 * Entity rendering: simple original box models (humanoids, quadrupeds, generic boxes,
 * item sprites) with interpolation, walk animation, name tags and hurt flashes.
 */
import * as THREE from 'three'
import type { EntityDTO, EntityMove } from '../../shared/protocol'

export interface EntityArt {
  colors: (name: string) => { body: string, accent: string }
  itemIcon: (itemName: string) => HTMLCanvasElement
}

const PX = 1 / 16
const HUMANOID = new Set(['player', 'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'wither_skeleton', 'bogged', 'zombie_villager', 'villager',
  'wandering_trader', 'pillager', 'vindicator', 'evoker', 'illusioner', 'witch', 'piglin', 'piglin_brute', 'zombified_piglin', 'enderman', 'armor_stand', 'mannequin'])
const QUADRUPED = new Set(['cow', 'mooshroom', 'pig', 'sheep', 'horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'wolf', 'cat', 'ocelot', 'fox', 'goat',
  'llama', 'trader_llama', 'polar_bear', 'panda', 'camel', 'hoglin', 'zoglin', 'ravager', 'sniffer', 'armadillo', 'creeper', 'turtle', 'frog', 'rabbit', 'spider', 'cave_spider', 'happy_ghast'])

function hash (s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

interface Tracked {
  dto: EntityDTO
  root: THREE.Group
  mats: THREE.MeshBasicMaterial[]
  baseColors: THREE.Color[]
  limbs: { leftArm?: THREE.Object3D, rightArm?: THREE.Object3D, leftLeg?: THREE.Object3D, rightLeg?: THREE.Object3D, head?: THREE.Object3D, legs?: THREE.Object3D[] }
  from: THREE.Vector3
  to: THREE.Vector3
  yawFrom: number
  yawTo: number
  pitch: number
  headYaw: number
  moveStart: number
  walk: number
  walkSpeed: number
  hurtUntil: number
  swingStart: number
  spin: boolean
  tag: THREE.Sprite | null
}

export class Entities {
  readonly group = new THREE.Group()
  private map = new Map<number, Tracked>()
  constructor (private art: EntityArt) {}

  get count () { return this.map.size }

  clear () { for (const id of [...this.map.keys()]) this.remove(id) }

  spawn (dto: EntityDTO) {
    this.remove(dto.id)
    const t = this.build(dto)
    t.root.position.set(dto.x, dto.y, dto.z)
    t.root.rotation.y = dto.yaw
    this.map.set(dto.id, t)
    this.group.add(t.root)
  }

  update (dto: EntityDTO) {
    const t = this.map.get(dto.id)
    if (!t) { this.spawn(dto); return }
    const rebuild = t.dto.name !== dto.name || t.dto.heldItem?.name !== dto.heldItem?.name || t.dto.username !== dto.username
    if (rebuild) {
      const pos = t.root.position.clone(); const yaw = t.root.rotation.y
      this.spawn(dto)
      const n = this.map.get(dto.id)!
      n.from.copy(pos); n.root.position.copy(pos); n.root.rotation.y = yaw; n.yawFrom = yaw
    } else {
      t.dto = dto
      t.root.scale.y = dto.sneaking ? 0.88 : 1
    }
  }

  move (m: EntityMove, now: number) {
    const t = this.map.get(m.id)
    if (!t) return
    t.from.copy(t.root.position)
    t.to.set(m.x, m.y, m.z)
    if (t.from.distanceToSquared(t.to) > 64) t.from.copy(t.to)
    t.yawFrom = t.root.rotation.y
    t.yawTo = m.yaw
    t.pitch = m.pitch
    t.headYaw = m.headYaw ?? m.yaw
    t.moveStart = now
    const d = Math.hypot(t.to.x - t.from.x, t.to.z - t.from.z)
    t.walkSpeed = Math.min(1, d * 4)
  }

  remove (id: number) {
    const t = this.map.get(id)
    if (!t) return
    this.group.remove(t.root)
    t.root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = (m as any).material as THREE.Material | THREE.Material[] | undefined
      for (const one of Array.isArray(mat) ? mat : mat ? [mat] : []) { (one as any).map?.dispose?.(); one.dispose() }
    })
    this.map.delete(id)
  }

  anim (id: number, kind: 'swing' | 'hurt', now: number) {
    const t = this.map.get(id)
    if (!t) return
    if (kind === 'hurt') t.hurtUntil = now + 320
    else t.swingStart = now
  }

  get (id: number) { return this.map.get(id)?.dto }

  /** Advance interpolation/animation. `lightAt` returns brightness 0..1 at a world position. */
  tick (now: number, dt: number, lightAt: (x: number, y: number, z: number) => number) {
    for (const t of this.map.values()) {
      const a = Math.min(1, (now - t.moveStart) / 100)
      t.root.position.lerpVectors(t.from, t.to, a)
      let dy = t.yawTo - t.yawFrom
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      t.root.rotation.y = t.yawFrom + dy * a
      if (a >= 1) t.walkSpeed *= Math.pow(0.001, dt)
      t.walk += dt * (4 + 8 * t.walkSpeed)
      const sw = Math.sin(t.walk) * 0.9 * t.walkSpeed
      const L = t.limbs
      if (L.leftLeg) L.leftLeg.rotation.x = sw
      if (L.rightLeg) L.rightLeg.rotation.x = -sw
      if (L.leftArm) L.leftArm.rotation.x = -sw * 0.8
      if (L.rightArm) {
        const s = (now - t.swingStart) / 250
        L.rightArm.rotation.x = s >= 0 && s < 1 ? -Math.sin(s * Math.PI) * 1.6 : sw * 0.8
      }
      if (L.legs) L.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === 0 ? sw : -sw) })
      if (L.head) {
        L.head.rotation.x = -t.pitch
        let hy = t.headYaw - t.root.rotation.y
        hy = Math.atan2(Math.sin(hy), Math.cos(hy))
        L.head.rotation.y = THREE.MathUtils.clamp(hy, -1.2, 1.2)
      }
      if (t.spin) {
        t.root.rotation.y = now / 900 + (t.dto.id % 7)
        t.root.children[0].position.y = 0.28 + Math.sin(now / 500 + t.dto.id) * 0.06
      }
      const p = t.root.position
      const b = Math.max(0.12, lightAt(p.x, p.y + t.dto.height * 0.6, p.z))
      const hurt = now < t.hurtUntil
      for (let i = 0; i < t.mats.length; i++) {
        const m = t.mats[i]
        m.color.copy(t.baseColors[i]).multiplyScalar(b)
        if (hurt) { m.color.r = Math.min(1, m.color.r + 0.55); m.color.g *= 0.45; m.color.b *= 0.45 }
      }
    }
  }

  /** Ray test against entity bounding boxes. Returns nearest hit within maxDist. */
  raycast (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { id: number, dist: number } | null {
    let best: { id: number, dist: number } | null = null
    const box = new THREE.Box3()
    const ray = new THREE.Ray(origin, dir)
    const hit = new THREE.Vector3()
    for (const t of this.map.values()) {
      const p = t.root.position
      const w = Math.max(0.3, t.dto.width) / 2 + 0.1
      box.min.set(p.x - w, p.y, p.z - w)
      box.max.set(p.x + w, p.y + Math.max(0.3, t.dto.height) + 0.1, p.z + w)
      if (ray.intersectBox(box, hit)) {
        const d = hit.distanceTo(origin)
        if (d <= maxDist && (!best || d < best.dist)) best = { id: t.dto.id, dist: d }
      }
    }
    return best
  }

  // ------------------------------------------------------------------ models

  private build (dto: EntityDTO): Tracked {
    const root = new THREE.Group()
    const mats: THREE.MeshBasicMaterial[] = []
    const baseColors: THREE.Color[] = []
    const mat = (color: THREE.ColorRepresentation, map?: THREE.Texture, opts: Partial<THREE.MeshBasicMaterialParameters> = {}) => {
      const m = new THREE.MeshBasicMaterial(map ? { color, map, ...opts } : { color, ...opts })
      mats.push(m); baseColors.push(m.color.clone())
      return m
    }
    const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[], pivotTop = false) => {
      const g = new THREE.BoxGeometry(w, h, d)
      if (pivotTop) g.translate(0, -h / 2, 0)
      return new THREE.Mesh(g, m)
    }
    const t: Tracked = {
      dto, root, mats, baseColors, limbs: {}, from: new THREE.Vector3(dto.x, dto.y, dto.z), to: new THREE.Vector3(dto.x, dto.y, dto.z),
      yawFrom: dto.yaw, yawTo: dto.yaw, pitch: dto.pitch, headYaw: dto.yaw, moveStart: 0, walk: 0, walkSpeed: 0, hurtUntil: 0, swingStart: -1e9, spin: false, tag: null
    }
    const name = dto.name

    if (name === 'item' || name === 'experience_orb') {
      const tex = name === 'item' && dto.heldItem
        ? new THREE.CanvasTexture(this.art.itemIcon(dto.heldItem.name))
        : orbTexture()
      tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.NoColorSpace
      const size = name === 'item' ? 0.42 : 0.28
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(0xffffff, tex, { transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }))
      m.position.y = 0.28
      root.add(m)
      t.spin = true
      return t
    }

    if (HUMANOID.has(name)) {
      const isPlayer = name === 'player'
      const seed = hash(dto.username ?? name)
      const colors = isPlayer ? playerPalette(seed) : mobPalette(this.art.colors(name))
      const scale = (dto.height / 1.8) * 0.9375
      const body = new THREE.Group(); body.scale.setScalar(scale)
      const skin = mat(colors.skin); const shirt = mat(colors.shirt); const pants = mat(colors.pants)
      const faceTex = faceTexture(colors.skin, colors.hair, colors.eye)
      const faceMat = mat(0xffffff, faceTex)
      const hair = mat(colors.hair)
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z. Model faces -z (yaw 0 = north).
      const head = box(8 * PX, 8 * PX, 8 * PX, [skin, skin, hair, skin, hair, faceMat])
      const headPivot = new THREE.Group(); headPivot.position.y = 24 * PX; head.position.y = 4 * PX; headPivot.add(head)
      const torso = box(8 * PX, 12 * PX, 4 * PX, shirt); torso.position.y = 18 * PX
      const mkLimb = (x: number, y: number, m: THREE.Material) => { const l = box(4 * PX, 12 * PX, 4 * PX, m, true); l.position.set(x, y, 0); return l }
      // slightly different shades so limbs read as separate shapes
      const sleeve = mat((colors.sleeves ? colors.shirt : colors.skin).clone().multiplyScalar(0.86))
      const pantsDark = mat(colors.pants.clone().multiplyScalar(0.84))
      const la = mkLimb(-6 * PX, 24 * PX, sleeve); const ra = mkLimb(6 * PX, 24 * PX, sleeve)
      const ll = mkLimb(-2 * PX, 12 * PX, pants); const rl = mkLimb(2 * PX, 12 * PX, pantsDark)
      body.add(headPivot, torso, la, ra, ll, rl)
      root.add(body)
      t.limbs = { head: headPivot, leftArm: la, rightArm: ra, leftLeg: ll, rightLeg: rl }
      if (dto.heldItem) {
        const tex = new THREE.CanvasTexture(this.art.itemIcon(dto.heldItem.name)); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.NoColorSpace
        const item = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat(0xffffff, tex, { transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }))
        item.rotation.y = Math.PI / 2; item.position.set(0, -11 * PX, -3 * PX)
        ra.add(item)
      }
      if (isPlayer && dto.username) {
        t.tag = nameTag(dto.username)
        t.tag.position.y = dto.height + 0.38
        root.add(t.tag)
      }
      return t
    }

    const col = this.art.colors(name)
    const bodyMat = mat(col.body); const accent = mat(col.accent)
    const w = Math.max(0.2, dto.width); const h = Math.max(0.2, dto.height)
    if (QUADRUPED.has(name)) {
      const legH = name === 'creeper' ? h * 0.25 : h * 0.42
      const bodyH = name === 'creeper' ? h * 0.5 : h * 0.42
      const len = name === 'creeper' ? w * 0.6 : w * 1.5
      const torso = box(w * 0.85, bodyH, len, bodyMat); torso.position.y = legH + bodyH / 2
      const hs = Math.min(w * 0.8, h * 0.36)
      const headPivot = new THREE.Group()
      const head = box(hs, hs, hs, [bodyMat, bodyMat, bodyMat, bodyMat, bodyMat, mat(0xffffff, mobFaceTexture(col.body, col.accent))])
      headPivot.position.set(0, name === 'creeper' ? legH + bodyH + hs / 2 : legH + bodyH * 0.8, name === 'creeper' ? 0 : -len / 2 - hs * 0.3)
      headPivot.add(head)
      const legs: THREE.Object3D[] = []
      const lw = Math.min(0.25, w * 0.28)
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = box(lw, legH, lw, accent, true)
        leg.position.set(x * (w * 0.42 - lw / 2), legH, z * (len / 2 - lw / 2))
        legs.push(leg); root.add(leg)
      }
      root.add(torso, headPivot)
      t.limbs = { head: headPivot, legs: [legs[0], legs[1], legs[3], legs[2]] }
      return t
    }

    // generic box creature / object
    const living = dto.kind === 'mob' || dto.kind === 'hostile' || dto.kind === 'animal' || dto.kind === 'ambient' || dto.kind === 'water_creature'
    const m = box(w, h, w, living ? [bodyMat, bodyMat, accent, bodyMat, bodyMat, mat(0xffffff, mobFaceTexture(col.body, col.accent))] : [bodyMat, bodyMat, accent, accent, bodyMat, bodyMat])
    m.position.y = h / 2
    root.add(m)
    return t
  }
}

function playerPalette (seed: number) {
  const skins = [0xf1c9a5, 0xe0ac7e, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423]
  const hairs = [0x2c1b10, 0x4a2f1b, 0x111111, 0xb5651d, 0xd9b36c, 0x7a1f1f, 0x5b3cc4]
  const hue = (seed % 360) / 360
  return {
    skin: new THREE.Color(skins[seed % skins.length]),
    hair: new THREE.Color(hairs[(seed >>> 4) % hairs.length]),
    eye: new THREE.Color(0x2b2b3a),
    shirt: new THREE.Color().setHSL(hue, 0.62, 0.52),
    pants: new THREE.Color().setHSL((hue + 0.58) % 1, 0.35, 0.3),
    sleeves: (seed >>> 9) % 2 === 0
  }
}

function mobPalette (c: { body: string, accent: string }) {
  const body = new THREE.Color(c.body); const accent = new THREE.Color(c.accent)
  return { skin: body, hair: body.clone().multiplyScalar(0.85), eye: new THREE.Color(0x101014), shirt: accent, pants: accent.clone().multiplyScalar(0.7), sleeves: false }
}

function hex (c: THREE.Color) { return '#' + c.getHexString() }

function faceTexture (skin: THREE.Color, hair: THREE.Color, eye: THREE.Color): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 8
  const g = cv.getContext('2d')!
  g.fillStyle = hex(skin); g.fillRect(0, 0, 8, 8)
  g.fillStyle = hex(hair); g.fillRect(0, 0, 8, 2); g.fillRect(0, 2, 1, 1); g.fillRect(7, 2, 1, 1)
  g.fillStyle = '#ffffff'; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1)
  g.fillStyle = hex(eye); g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1)
  g.fillStyle = hex(skin.clone().multiplyScalar(0.72)); g.fillRect(3, 6, 2, 1)
  const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace
  return t
}

function mobFaceTexture (body: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 8
  const g = cv.getContext('2d')!
  g.fillStyle = body; g.fillRect(0, 0, 8, 8)
  g.fillStyle = '#0e0e12'; g.fillRect(1, 3, 2, 2); g.fillRect(5, 3, 2, 2)
  g.fillStyle = accent; g.fillRect(3, 5, 2, 2)
  const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace
  return t
}

function orbTexture (): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 16
  const g = cv.getContext('2d')!
  const gr = g.createRadialGradient(8, 8, 1, 8, 8, 8)
  gr.addColorStop(0, '#f4ffb0'); gr.addColorStop(0.5, '#7dff5a'); gr.addColorStop(1, 'rgba(60,200,40,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 16, 16)
  return new THREE.CanvasTexture(cv)
}

function nameTag (text: string): THREE.Sprite {
  const cv = document.createElement('canvas')
  const g = cv.getContext('2d')!
  const font = '600 28px Inter, "Segoe UI", system-ui, sans-serif'
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 24
  cv.width = w; cv.height = 40
  g.font = font
  g.fillStyle = 'rgba(10,12,20,0.55)'
  g.beginPath(); (g as any).roundRect?.(0, 0, w, 40, 10); g.fill()
  g.fillStyle = '#f2f4ff'; g.textBaseline = 'middle'; g.fillText(text, 12, 21)
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }))
  s.scale.set(w / 40 * 0.3, 0.3, 1)
  s.renderOrder = 5
  return s
}
