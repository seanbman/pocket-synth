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

/** Glass Poly — brightness (cutoff) + space (engine wet) + pitch bend. */
export class GlassPolyVoice {
  constructor(engine) {
    this.engine = engine
    this.brightness = 0.68
    this.pitchBend = 0 // semitones, typically -2..+2
    this.voices = new Map()
    this.attack = 0.018
    this.release = 0.48
  }

  setBrightness(v) {
    this.brightness = Math.min(1, Math.max(0.05, v))
    const cutoff = 400 + this.brightness * 7600
    for (const vox of this.voices.values()) {
      vox.filter.frequency.setTargetAtTime(cutoff, this.engine.now(), 0.03)
    }
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
    filter.Q.value = 1.2
    filter.frequency.value = 400 + this.brightness * 7600

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
