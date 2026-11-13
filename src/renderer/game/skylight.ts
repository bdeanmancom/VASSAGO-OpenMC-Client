/**
 * Client-side sky-light repair.
 *
 * Servers can send chunks near the edge of their view distance whose sky light has not been
 * propagated yet (open-air cells lit 0, and no later light update). This re-derives the vertical
 * sky column locally: full light from the top of the world down to the first block that filters
 * light, then attenuated through leaves/water until something opaque. Server-provided values are
 * kept wherever they are brighter, so correct data is never darkened.
 */
export interface LightSection {
  /** 4096 block-state ids, or null for an all-air section */
  blocks: Uint16Array | null
  /** 4096 bytes sky<<4|block, or a uniform byte value */
  light: Uint8Array | number
}

export function repairSkyColumn (sections: LightSection[], filter: Uint8Array, alloc: (fill: number) => Uint8Array): void {
  const n = sections.length
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let sky = 15
      for (let si = n - 1; si >= 0 && sky > 0; si--) {
        const sec = sections[si]
        if (!sec.blocks) {
          if (typeof sec.light === 'number') {
            if ((sec.light >> 4) >= sky) continue
            sec.light = alloc(sec.light)
          }
          const la = sec.light
          for (let y = 15; y >= 0; y--) {
            const i = (y << 8) | (z << 4) | x
            if ((la[i] >> 4) < sky) la[i] = (sky << 4) | (la[i] & 15)
          }
          continue
        }
        const blocks = sec.blocks
        let la = typeof sec.light === 'number' ? null : sec.light
        for (let y = 15; y >= 0 && sky > 0; y--) {
          const i = (y << 8) | (z << 4) | x
          const st = blocks[i]
          if (st !== 0) sky -= filter[st] ?? 15
          if (sky <= 0) break
          if (!la) {
            if (((sec.light as number) >> 4) >= sky) continue
            la = alloc(sec.light as number)
            sec.light = la
          }
          if ((la[i] >> 4) < sky) la[i] = (sky << 4) | (la[i] & 15)
        }
      }
    }
  }
}
