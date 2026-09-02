/** Click metronome — routes to master only (never into loop record tap). */
export class Metronome {
  constructor(engine) {
    this.engine = engine
    this.on = true
    this.level = 0.7
    this.accent = true
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
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = "square"
    osc.frequency.value = accent ? 1350 : 880
    const peak = lvl * (accent ? 0.28 : 0.14)
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.0015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + (accent ? 0.07 : 0.045))
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + 0.09)
  }
}
