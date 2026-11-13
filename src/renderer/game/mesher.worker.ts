/// <reference lib="webworker" />
import { assemble, meshSection, PAD3, type MeshData } from './mesher'
import type { RegistryTables } from './registry'

export type MesherRequest =
  | { t: 'init', tables: RegistryTables }
  | { t: 'mesh', id: number, blocks: (Uint16Array | null)[], light: (Uint8Array | number)[], smooth: boolean }

export interface MesherResponse { t: 'mesh', id: number, opaque: MeshData | null, translucent: MeshData | null, ms: number }

let tables: RegistryTables | null = null
const blocks = new Uint16Array(PAD3)
const light = new Uint8Array(PAD3)

self.onmessage = (ev: MessageEvent<MesherRequest>) => {
  const msg = ev.data
  if (msg.t === 'init') { tables = msg.tables; return }
  if (!tables) return
  const t0 = performance.now()
  assemble(msg.blocks, msg.light, blocks, light)
  const mesh = meshSection(tables, blocks, light, msg.smooth)
  const transfer: ArrayBuffer[] = []
  for (const m of [mesh.opaque, mesh.translucent]) {
    if (m) transfer.push(m.positions.buffer as ArrayBuffer, m.uvl.buffer as ArrayBuffer, m.shade.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer)
  }
  const res: MesherResponse = { t: 'mesh', id: msg.id, opaque: mesh.opaque, translucent: mesh.translucent, ms: performance.now() - t0 }
  ;(self as unknown as Worker).postMessage(res, transfer)
}
