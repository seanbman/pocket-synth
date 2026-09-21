/** Click metronome — routes to master only (never into loop record tap). */
export class Metronome {
  constructor(engine) {
    this.engine = engine
    this.on = true
    this.level = 0.7
    this.accent = true
    this.sound = "block"
  }

  setOn(v) {
    this.on = !!v
  }

  setLevel(v) {
    this.level = Math.min(1, Math.max(0, Number(v) || 0))
  }

  setAccent(v) {
    this.accent = !!v
  }

  setSound(value) {
    this.sound = ["block", "tick", "soft"].includes(value) ? value : "block"
  }

  /** Fire a click; accent = bar beat 1. Respects metro on/off. */
  click(isAccent = false) {
    if (!this.on) return
    this.#beep(isAccent && this.accent)
  }

  /** Always-on click for tap-tempo feedback (ignores metro on/off). */
  tapClick() {
    this.#beep(true, Math.max(0.35, this.level))
  }

  #beep(accent = false, levelOverride = null) {
    if (!this.engine?.ready) return
    const lvl = levelOverride ?? this.level
    if (lvl <= 0.001) return
    const ctx = this.engine.ctx
    const master = this.engine.master
    if (!ctx || !master) return

    const profile = {
      block: { type: "square", normal: 880, accent: 1350, peak: 0.14, accentPeak: 0.28, duration: 0.045, accentDuration: 0.07 },
      tick: { type: "triangle", normal: 1250, accent: 1750, peak: 0.1, accentPeak: 0.2, duration: 0.028, accentDuration: 0.045 },
      soft: { type: "sine", normal: 720, accent: 1040, peak: 0.085, accentPeak: 0.15, duration: 0.06, accentDuration: 0.085 }
    }[this.sound] || null

    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = profile?.type || "square"
    osc.frequency.value = accent ? (profile?.accent || 1350) : (profile?.normal || 880)
    const peak = lvl * (accent ? (profile?.accentPeak || 0.28) : (profile?.peak || 0.14))
    const duration = accent ? (profile?.accentDuration || 0.07) : (profile?.duration || 0.045)
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.0015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }
}
