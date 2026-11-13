/** Item icon cache (canvas + data URL) built on the procedural art module. */
import { paintItemIcon } from './itemicons'
import type { Registry } from './registry'

let registry: Registry | null = null
const canvases = new Map<string, HTMLCanvasElement>()
const urls = new Map<string, string>()

export function setIconRegistry (reg: Registry | null) {
  registry = reg
  canvases.clear(); urls.clear()
}

export function itemIconCanvas (name: string): HTMLCanvasElement {
  let cv = canvases.get(name)
  if (cv) return cv
  cv = document.createElement('canvas')
  cv.width = cv.height = 32
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(32, 32)
  try {
    paintItemIcon(name, { blockLook: n => registry?.defaultLook(n) ?? null }, img.data)
  } catch {
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 120; img.data[i + 1] = 110; img.data[i + 2] = 160; img.data[i + 3] = 255 }
  }
  ctx.putImageData(img, 0, 0)
  canvases.set(name, cv)
  return cv
}

export function itemIconUrl (name: string): string {
  let u = urls.get(name)
  if (!u) { u = itemIconCanvas(name).toDataURL(); urls.set(name, u) }
  return u
}
