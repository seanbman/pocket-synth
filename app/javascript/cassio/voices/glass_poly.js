const NOTE_OFFSETS = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function noteNameToMidi(name) {
  const m = String(name).match(/^([A-G][b#]?)(-?\d+)$/i)
  if (!m) return 60
  const pc = NOTE_OFFSETS[m[1].replace(/^([a-g])/, (_, c) => c.toUpperCase())] ?? 0
  return (parseInt(m[2], 10) + 1) * 12 + pc
}

/** Glass Poly — rideable filter/env; FX via engine. */
export class GlassPolyVoice {
  constructor(engine) {
    this.engine = engine
    this.brightness = 0.68
    this.resonance = 0.34
    this.pitchBend = 0
    this.voices = new Map()
    this.attack = 0.018
    this.release = 0.48
  }

  applyPatch(patch) {
    if (!patch) return
    if (patch.brightness != null) this.setBrightness(patch.brightness)
    if (patch.resonance != null) this.setResonance(patch.resonance)
    if (patch.attack != null) this.setAttack(patch.attack)
    if (patch.release != null) this.setRelease(patch.release)
    if (patch.reverb != null) this.engine.setSpace(patch.reverb)
    if (patch.delay != null) this.engine.setDelay(patch.delay)
    if (patch.bassDb != null) this.engine.setBassDb(patch.bassDb)
    if (patch.trebleDb != null) this.engine.setTrebleDb(patch.trebleDb)
  }

  #cutoffHz() {
    return 400 + this.brightness * 7600
  }

  #q() {
    return 0.5 + this.resonance * 11.5
  }

  setBrightness(v) {
    this.brightness = Math.min(1, Math.max(0.05, v))
    const cutoff = this.#cutoffHz()
    const t = this.engine.now()
    for (const vox of this.voices.values()) {
      vox.filter.frequency.setTargetAtTime(cutoff, t, 0.03)
    }
  }

  setResonance(v) {
    this.resonance = Math.min(1, Math.max(0, v))
    const q = this.#q()
    const t = this.engine.now()
    for (const vox of this.voices.values()) {
      vox.filter.Q.setTargetAtTime(q, t, 0.03)
    }
  }

  setAttack(v) {
    this.attack = Math.min(1.2, Math.max(0.005, v))
  }

  setRelease(v) {
    this.release = Math.min(2.5, Math.max(0.02, v))
  }

  setPitchBend(semitones) {
    this.pitchBend = Math.min(2, Math.max(-2, semitones))
    const cents = this.pitchBend * 100
    const t = this.engine.now()
    for (const vox of this.voices.values()) {
      vox.osc1.detune.setTargetAtTime(cents, t, 0.01)
      vox.osc2.detune.setTargetAtTime(cents, t, 0.01)
    }
  }

  noteOn(midi, velocity = 0.85) {
    if (!this.engine.ready) return
    const key = String(midi)
    if (this.voices.has(key)) this.noteOff(midi, true)

    const ctx = this.engine.ctx
    const t = ctx.currentTime
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    osc1.type = "triangle"
    osc2.type = "sawtooth"
    const freq = midiToFreq(midi)
    osc1.frequency.value = freq
    osc2.frequency.value = freq * 1.002
    const cents = this.pitchBend * 100
    osc1.detune.value = cents
    osc2.detune.value = cents

    const mix = ctx.createGain()
    mix.gain.value = 0.35
    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    filter.Q.value = this.#q()
    filter.frequency.value = this.#cutoffHz()

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(velocity * 0.55, t + this.attack)

    osc1.connect(mix)
    osc2.connect(mix)
    mix.connect(filter)
    filter.connect(env)
    this.engine.connectVoice(env)

    osc1.start(t)
    osc2.start(t)
    this.voices.set(key, { osc1, osc2, env, filter, mix })
  }

  noteOff(midi, immediate = false) {
    const key = String(midi)
    const vox = this.voices.get(key)
    if (!vox) return
    this.voices.delete(key)
    const ctx = this.engine.ctx
    const t = ctx.currentTime
    const rel = immediate ? 0.02 : this.release
    vox.env.gain.cancelScheduledValues(t)
    vox.env.gain.setValueAtTime(Math.max(vox.env.gain.value, 0.0001), t)
    vox.env.gain.exponentialRampToValueAtTime(0.0001, t + rel)
    vox.osc1.stop(t + rel + 0.02)
    vox.osc2.stop(t + rel + 0.02)
  }

  allNotesOff() {
    for (const midi of [...this.voices.keys()]) this.noteOff(Number(midi), true)
  }
}
