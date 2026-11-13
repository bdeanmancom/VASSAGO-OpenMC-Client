/**
 * Scene: WebGL renderer, terrain materials (texture-array shader with per-vertex
 * light + fog), sky dome, sun/moon, stars and clouds.
 */
import * as THREE from 'three'
import { TILE_SIZE } from './looks'

const TERRAIN_VERT = /* glsl */`
in vec3 uvl;
in vec4 shade;
out vec3 vUvl;
out float vAo;
out vec2 vLight;
out float vEmissive;
out float vDist;
void main () {
  vUvl = uvl;
  vAo = shade.x;
  vLight = shade.yz;
  vEmissive = shade.w;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const TERRAIN_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTiles;
uniform float uDay;
uniform float uAmbient;
uniform vec3 uSkyTint;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uGamma;
in vec3 vUvl;
in float vAo;
in vec2 vLight;
in float vEmissive;
in float vDist;
out vec4 outColor;

float curve (float l) { return l / (4.0 - 3.0 * l); }

void main () {
  vec4 tex = texture(uTiles, vUvl);
  if (tex.a < uAlphaTest) discard;
  float sky = curve(vLight.x) * uDay;
  float blk = curve(vLight.y);
  vec3 lightCol = max(uSkyTint * sky, vec3(1.0, 0.86, 0.68) * blk * 1.05);
  lightCol = mix(vec3(uAmbient), vec3(1.0), lightCol);
  lightCol = pow(lightCol, vec3(uGamma));
  vec3 lit = tex.rgb * mix(lightCol * vAo, vec3(1.0), step(0.5, vEmissive));
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  outColor = vec4(mix(lit, uFogColor, fog), tex.a);
}
`

const SKY_VERT = /* glsl */`
out vec3 vDir;
void main () {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`
const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform float uStars;
uniform float uTime;
in vec3 vDir;
out vec4 outColor;

float hash (vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

void main () {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  float t = smoothstep(0.42, 0.95, h);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHorizon * 0.82, smoothstep(0.5, 0.25, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunGlow * (pow(sd, 6.0) * 0.35 + pow(sd, 48.0) * 0.5);
  if (uStars > 0.01 && d.y > -0.1) {
    vec3 g = floor(d * 190.0);
    float s = hash(g);
    float tw = 0.75 + 0.25 * sin(uTime * 1.7 + s * 80.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9972, s) * uStars * tw * smoothstep(-0.1, 0.15, d.y);
  }
  outColor = vec4(col, 1.0);
}
`

const CLOUD_VERT = /* glsl */`
out vec3 vWorld;
void main () {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const CLOUD_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCam;
uniform float uCover;
in vec3 vWorld;
out vec4 outColor;
float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise (vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main () {
  vec2 p = floor((vWorld.xz + vec2(uTime * 1.2, uTime * 0.35)) / 6.0) * 6.0 / 90.0;
  float n = noise(p) * 0.6 + noise(p * 2.3 + 7.0) * 0.4;
  float a = smoothstep(uCover, uCover + 0.06, n);
  float dist = length(vWorld.xz - uCam.xz);
  a *= 1.0 - smoothstep(380.0, 620.0, dist);
  if (a < 0.02) discard;
  outColor = vec4(uColor, a * 0.82);
}
`

export interface Environment { timeOfDay: number, raining: boolean, dimension: string, underwater: boolean, underLava: boolean }

THREE.ColorManagement.enabled = false

const c = (hex: number) => new THREE.Color(hex)
const SKY = {
  dayZenith: c(0x3f7fe0), dayHorizon: c(0xa9d1f5),
  duskZenith: c(0x2b3a78), duskHorizon: c(0xf08f52),
  nightZenith: c(0x05060f), nightHorizon: c(0x101832)
}

export class Scene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000)
  readonly opaqueMat: THREE.ShaderMaterial
  readonly transMat: THREE.ShaderMaterial
  private sky: THREE.Mesh
  private skyMat: THREE.ShaderMaterial
  private sun: THREE.Mesh
  private moon: THREE.Mesh
  private clouds: THREE.Mesh
  private cloudMat: THREE.ShaderMaterial
  private fogColor = new THREE.Color()
  private handScene = new THREE.Scene()
  private handCamera = new THREE.PerspectiveCamera(60, 1, 0.05, 10)
  private hand = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }))
  /** Current sky/day brightness 0..1 for entity lighting. */
  dayLight = 1
  ambient = 0.03
  cloudsEnabled = true
  gamma = 1

  constructor (canvas: HTMLCanvasElement, tiles: THREE.DataArrayTexture, antialias: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', alpha: false, stencil: false })
    // Everything is authored and lit directly in display (sRGB) space, like classic voxel renderers.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.setClearColor(0x0b0d14)
    this.renderer.sortObjects = true

    const uniforms = () => ({
      uTiles: { value: tiles },
      uDay: { value: 1 },
      uAmbient: { value: 0.03 },
      uSkyTint: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: this.fogColor },
      uFogNear: { value: 80 },
      uFogFar: { value: 128 },
      uAlphaTest: { value: 0.5 },
      uGamma: { value: 1 }
    })
    this.opaqueMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: uniforms() })
    this.transMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: uniforms(), transparent: true, depthWrite: false
    })
    this.transMat.uniforms.uAlphaTest.value = 0.02

    this.skyMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunGlow: { value: new THREE.Color() },
        uStars: { value: 0 },
        uTime: { value: 0 }
      }
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.skyMat)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -100
    this.scene.add(this.sky)

    this.sun = this.celestial(sunTexture(), 46)
    this.moon = this.celestial(moonTexture(), 30)

    this.cloudMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uCam: { value: new THREE.Vector3() }, uCover: { value: 0.56 } }
    })
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), this.cloudMat)
    this.clouds.frustumCulled = false
    this.clouds.renderOrder = 2
    this.scene.add(this.clouds)
    this.hand.visible = false
    this.handScene.add(this.hand)
  }

  private celestial (tex: THREE.Texture, size: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }))
    m.frustumCulled = false
    m.renderOrder = -90
    this.scene.add(m)
    return m
  }

  resize (w: number, h: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
    this.handCamera.aspect = this.camera.aspect
    this.handCamera.updateProjectionMatrix()
  }

  /** Update sky, light and fog for the current environment. */
  update (env: Environment, renderDistanceChunks: number, timeSec: number) {
    const cam = this.camera.position
    const angle = (env.timeOfDay / 24000) * Math.PI * 2
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.18).normalize()
    const elev = sunDir.y
    const overworld = env.dimension.includes('overworld')
    const nether = env.dimension.includes('nether')
    const end = env.dimension.includes('end')

    let day = THREE.MathUtils.smoothstep(elev, -0.18, 0.22)
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.32) * (overworld ? 1 : 0)
    const zen = new THREE.Color(); const hor = new THREE.Color()
    let ambient = 0.05
    let skyTint = new THREE.Color(1, 1, 1)
    let dayLight: number
    if (overworld) {
      zen.copy(SKY.nightZenith).lerp(SKY.dayZenith, day)
      hor.copy(SKY.nightHorizon).lerp(SKY.dayHorizon, day)
      zen.lerp(SKY.duskZenith, dusk * 0.6)
      hor.lerp(SKY.duskHorizon, dusk * 0.75)
      if (env.raining) { const g = c(0x6b7480).multiplyScalar(0.35 + 0.65 * day); zen.lerp(g, 0.75); hor.lerp(g, 0.75); day *= 0.8 }
      dayLight = 0.3 + 0.7 * day
      skyTint = new THREE.Color(0.62, 0.72, 1.0).lerp(new THREE.Color(1, 1, 1), day).lerp(new THREE.Color(1.0, 0.82, 0.66), dusk * 0.4)
    } else if (nether) {
      zen.set(0x2a0b0b); hor.set(0x3a1010); dayLight = 0; ambient = 0.26
    } else if (end) {
      zen.set(0x0d0a18); hor.set(0x1a1430); dayLight = 0; ambient = 0.3
    } else {
      zen.copy(SKY.dayZenith); hor.copy(SKY.dayHorizon); dayLight = 1
    }
    this.dayLight = dayLight
    this.ambient = ambient

    const far = Math.max(2, renderDistanceChunks) * 16
    let fogNear = far * 0.72; let fogFar = far * 0.98
    this.fogColor.copy(hor)
    if (nether) { fogNear = Math.min(fogNear, 24); fogFar = Math.min(fogFar, 96) }
    if (env.underwater) { this.fogColor.set(0x0c2f66).multiplyScalar(0.35 + 0.65 * dayLight); fogNear = 0.5; fogFar = 28 }
    if (env.underLava) { this.fogColor.set(0xd9480f); fogNear = 0.1; fogFar = 2.2 }

    for (const m of [this.opaqueMat, this.transMat]) {
      m.uniforms.uDay.value = dayLight
      m.uniforms.uAmbient.value = ambient
      m.uniforms.uSkyTint.value = skyTint
      m.uniforms.uFogNear.value = fogNear
      m.uniforms.uFogFar.value = fogFar
      m.uniforms.uGamma.value = this.gamma
    }

    this.sky.position.copy(cam)
    this.sky.scale.setScalar(900)
    const su = this.skyMat.uniforms
    su.uZenith.value.copy(env.underwater || env.underLava ? this.fogColor : zen)
    su.uHorizon.value.copy(env.underwater || env.underLava ? this.fogColor : hor)
    su.uSunDir.value.copy(sunDir)
    su.uSunGlow.value.set(overworld ? 0xffc27a : 0x000000).multiplyScalar(overworld ? 0.35 + dusk * 0.9 : 0)
    su.uStars.value = overworld ? (1 - day) * (env.raining ? 0.2 : 1) : (end ? 0.5 : 0)
    su.uTime.value = timeSec

    const showOrbs = overworld && !env.underwater && !env.underLava
    this.sun.visible = showOrbs && elev > -0.25
    this.moon.visible = showOrbs && elev < 0.25
    this.sun.position.copy(cam).addScaledVector(sunDir, 400)
    this.sun.lookAt(cam)
    this.moon.position.copy(cam).addScaledVector(sunDir, -400)
    this.moon.lookAt(cam)
    ;(this.sun.material as THREE.MeshBasicMaterial).opacity = env.raining ? 0.15 : 1
    ;(this.moon.material as THREE.MeshBasicMaterial).opacity = env.raining ? 0.15 : 1

    this.clouds.visible = this.cloudsEnabled && overworld && !env.underwater
    this.clouds.position.set(cam.x, 192.4, cam.z)
    const cu = this.cloudMat.uniforms
    cu.uTime.value = timeSec
    cu.uCam.value.copy(cam)
    cu.uCover.value = env.raining ? 0.34 : 0.56
    cu.uColor.value.setScalar(0.25 + 0.75 * dayLight).lerp(SKY.duskHorizon, dusk * 0.35)
    if (env.raining) cu.uColor.value.multiplyScalar(0.6)

    this.renderer.setClearColor(this.fogColor)
  }

  render () {
    const r = this.renderer
    r.render(this.scene, this.camera)
    if (this.hand.visible) {
      r.autoClear = false
      r.clearDepth()
      r.render(this.handScene, this.handCamera)
      r.autoClear = true
    }
  }

  /** Show an item sprite in the first-person hand (null hides it). */
  setHandItem (icon: HTMLCanvasElement | null) {
    const mat = this.hand.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    if (!icon) { mat.map = null; this.hand.visible = false; return }
    const tex = new THREE.CanvasTexture(icon)
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.NoColorSpace
    mat.map = tex
    mat.needsUpdate = true
    this.hand.visible = true
  }

  /** Animate the hand: swing 0..1 (0 = idle), bob offset and scene brightness. */
  updateHand (swing: number, bobX: number, bobY: number, brightness: number, equip: number) {
    if (!this.hand.visible) return
    const s = Math.sin(swing * Math.PI)
    this.hand.position.set(0.62 + bobX - s * 0.28, -0.52 + bobY - s * 0.12 - (1 - equip) * 0.6, -1.05 - s * 0.25)
    this.hand.rotation.set(-0.15 - s * 0.9, -0.55 + s * 0.35, 0.08)
    ;(this.hand.material as THREE.MeshBasicMaterial).color.setScalar(Math.max(0.25, brightness))
  }

  dispose () {
    this.renderer.dispose()
    this.opaqueMat.dispose(); this.transMat.dispose(); this.skyMat.dispose(); this.cloudMat.dispose()
  }
}

/** Build the texture array (one layer per tile) with mipmaps. */
export function buildTileTexture (tileKeys: string[], paintTile: (key: string, out: Uint8ClampedArray) => void, anisotropy: number, mipmaps: boolean): THREE.DataArrayTexture {
  const n = Math.max(1, tileKeys.length)
  const px = TILE_SIZE * TILE_SIZE * 4
  const data = new Uint8Array(n * px)
  const tmp = new Uint8ClampedArray(px)
  for (let i = 0; i < tileKeys.length; i++) {
    tmp.fill(0)
    try { paintTile(tileKeys[i], tmp) } catch { tmp.fill(128) }
    // Bleed colour into fully transparent texels so mipmaps/filtering don't darken cut-out edges.
    let r = 0; let g = 0; let b = 0; let cnt = 0
    for (let p = 0; p < px; p += 4) if (tmp[p + 3] > 0) { r += tmp[p]; g += tmp[p + 1]; b += tmp[p + 2]; cnt++ }
    if (cnt > 0 && cnt < TILE_SIZE * TILE_SIZE) {
      r /= cnt; g /= cnt; b /= cnt
      for (let p = 0; p < px; p += 4) if (tmp[p + 3] === 0) { tmp[p] = r; tmp[p + 1] = g; tmp[p + 2] = b }
    }
    data.set(tmp, i * px)
  }
  const tex = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, n)
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.colorSpace = THREE.NoColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = mipmaps ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter
  tex.generateMipmaps = mipmaps
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = anisotropy
  tex.needsUpdate = true
  return tex
}

function sunTexture (): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,252,235,1)')
  grad.addColorStop(0.22, 'rgba(255,240,190,1)')
  grad.addColorStop(0.3, 'rgba(255,214,130,0.55)')
  grad.addColorStop(1, 'rgba(255,170,60,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace
  return t
}

function moonTexture (): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128
  const g = cv.getContext('2d')!
  const glow = g.createRadialGradient(64, 64, 20, 64, 64, 64)
  glow.addColorStop(0, 'rgba(190,205,255,0.5)'); glow.addColorStop(1, 'rgba(120,140,255,0)')
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#e8ecff'; g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.fill()
  g.fillStyle = 'rgba(150,160,200,0.55)'
  for (const [x, y, r] of [[54, 56, 6], [72, 70, 8], [70, 50, 4], [56, 76, 3]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace
  return t
}
