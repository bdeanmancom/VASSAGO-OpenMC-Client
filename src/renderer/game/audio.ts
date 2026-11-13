/**
 * Original synthesized sound effects (WebAudio). No sampled or third-party audio is used:
 * every sound is filtered noise or a short oscillator sweep generated at runtime.
 */
import type { SoundGroup } from './blockfx'

export type Sfx = 'step' | 'break' | 'place' | 'hurt' | 'pop' | 'click' | 'splash'

/** How each material family sounds: a noise band (Hz, sharpness), a body tone (Hz) and its wave. */
const MATERIAL: Record<SoundGroup, { band: number, q: number, body: number, wave: OscillatorType, ring: number }> = {
  stone: { band: 1500, q: 1.0, body: 170, wave: 'triangle', ring: 0 },
  wood: { band: 700, q: 2.2, body: 230, wave: 'triangle', ring: 0 },
  dirt: { band: 420, q: 0.7, body: 95, wave: 'sine', ring: 0 },
  grass: { band: 2600, q: 0.6, body: 120, wave: 'sine', ring: 0 },
  sand: { band: 3200, q: 0.5, body: 0, wave: 'sine', ring: 0 },
  gravel: { band: 1900, q: 0.5, body: 110, wave: 'triangle', ring: 0 },
  glass: { band: 5200, q: 3.5, body: 0, wave: 'sine', ring: 2400 },
  wool: { band: 300, q: 0.6, body: 80, wave: 'sine', ring: 0 },
  metal: { band: 2400, q: 4.0, body: 320, wave: 'square', ring: 1250 },
  snow: { band: 1100, q: 0.5, body: 0, wave: 'sine', ring: 0 },
  leaves: { band: 3800, q: 0.7, body: 0, wave: 'sine', ring: 0 }
}

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  volume = 0.6

  private ensure (): AudioContext | null {
    if (this.ctx) return this.ctx
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
      const len = ctx.sampleRate * 0.5
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      let seed = 99991
      for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1 }
    } catch { this.ctx = null }
    return this.ctx
  }

  private burst (freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', sweep = 1) {
    const ctx = this.ensure()
    if (!ctx || !this.master || !this.noise) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = ctx.createBiquadFilter()
    f.type = type; f.Q.value = q
    f.frequency.setValueAtTime(freq, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    src.connect(f); f.connect(g); g.connect(this.master)
    src.start(t, Math.random() * 0.3, dur + 0.02)
  }

  private tone (from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine') {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(to, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + dur + 0.02)
  }

  play (sfx: Sfx) {
    if (this.volume <= 0) return
    if (this.master) this.master.gain.value = this.volume
    switch (sfx) {
      case 'step': this.burst(380 + Math.random() * 160, 1.2, 0.09, 0.22, 'bandpass', 0.6); break
      case 'break': this.burst(900, 0.7, 0.2, 0.5, 'lowpass', 0.25); this.tone(150, 60, 0.14, 0.3, 'triangle'); break
      case 'place': this.burst(520, 1.5, 0.08, 0.4, 'bandpass', 0.5); this.tone(190, 110, 0.08, 0.28, 'triangle'); break
      case 'hurt': this.tone(240, 90, 0.22, 0.4, 'sawtooth'); this.burst(300, 0.8, 0.15, 0.25, 'lowpass', 0.5); break
      case 'pop': this.tone(520, 1040, 0.07, 0.18); break
      case 'click': this.tone(880, 660, 0.04, 0.12, 'square'); break
      case 'splash': this.burst(1400, 0.6, 0.35, 0.3, 'bandpass', 0.3); break
    }
  }

  /** A tool or fist striking a block: short and quiet, in the block's material. */
  hit (group: SoundGroup) {
    if (this.volume <= 0) return
    if (this.master) this.master.gain.value = this.volume
    const m = MATERIAL[group]
    this.burst(m.band * (0.9 + Math.random() * 0.2), m.q, 0.07, 0.2, 'bandpass', 0.6)
    if (m.body) this.tone(m.body * 1.1, m.body * 0.7, 0.06, 0.12, m.wave)
    if (m.ring) this.tone(m.ring, m.ring * 0.96, 0.09, 0.05)
  }

  /** The block giving way: the same material, longer and fuller. */
  breakBlock (group: SoundGroup) {
    if (this.volume <= 0) return
    if (this.master) this.master.gain.value = this.volume
    const m = MATERIAL[group]
    this.burst(m.band, m.q * 0.7, 0.24, 0.5, 'bandpass', 0.3)
    this.burst(m.band * 0.45, 0.6, 0.18, 0.3, 'lowpass', 0.4)
    if (m.body) this.tone(m.body, m.body * 0.4, 0.16, 0.28, m.wave)
    if (m.ring) { this.tone(m.ring * 1.3, m.ring * 0.8, 0.22, 0.1); this.tone(m.ring * 0.75, m.ring * 0.6, 0.18, 0.07) }
  }

  dispose () { void this.ctx?.close(); this.ctx = null }
}
