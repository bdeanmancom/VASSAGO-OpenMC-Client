/**
 * Original synthesized sound effects (WebAudio). No sampled or third-party audio is used:
 * every sound is filtered noise or a short oscillator sweep generated at runtime.
 */
export type Sfx = 'step' | 'break' | 'place' | 'hurt' | 'pop' | 'click' | 'splash'

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

  dispose () { void this.ctx?.close(); this.ctx = null }
}
