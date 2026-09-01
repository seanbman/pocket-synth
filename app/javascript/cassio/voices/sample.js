import { midiToFreq, noteNameToMidi } from "cassio/voices/glass_poly"

/** Sample playback — oneshot/gate from an AudioBuffer with trim + root pitch. */
export class SampleVoice {
  constructor(engine) {
    this.engine = engine
    this.buffer = null
    this.trimStart = 0
    this.trimEnd = 1
    this.rootMidi = 60
    this.gain = 1
    this.pan = 0
    this.padMode = "oneshot"
    this.pitchBend = 0
    this.active = new Map()
    this._seq = 0
  }

  get activeCount() {
    return this.active.size
  }

  setBuffer(buf) {
    this.buffer = buf || null
  }

  applyPatch(patch) {
    if (!patch) return
    if (patch.trimStart != null) this.trimStart = Math.min(0.99, Math.max(0, Number(patch.trimStart) || 0))
    if (patch.trimEnd != null) this.trimEnd = Math.min(1, Math.max(this.trimStart + 0.005, Number(patch.trimEnd) || 1))
    if (patch.root) this.rootMidi = noteNameToMidi(patch.root)
    if (patch.gain != null) this.gain = Math.min(2, Math.max(0, Number(patch.gain) || 1))
    if (patch.reverb != null) this.engine.setSpace(patch.reverb)
    if (patch.delay != null) this.engine.setDelay(patch.delay)
    if (patch.bassDb != null) this.engine.setBassDb(patch.bassDb)
    if (patch.trebleDb != null) this.engine.setTrebleDb(patch.trebleDb)
  }

  setPan(v) {
    this.pan = Math.min(1, Math.max(-1, Number(v) || 0))
  }

  setPitchBend(semitones) {
    this.pitchBend = Math.min(2, Math.max(-2, semitones))
  }

  noteOn(midi = 60, velocity = 0.9) {
    if (!this.engine.ready || !this.buffer) return
    const ctx = this.engine.ctx
    const buf = this.buffer
    const dur = buf.duration
    const start = this.trimStart * dur
    const end = Math.max(start + 0.01, this.trimEnd * dur)
    const len = end - start
    const rate = (midiToFreq(midi) / midiToFreq(this.rootMidi)) * Math.pow(2, (this.pitchBend || 0) / 12)

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = Math.min(4, Math.max(0.25, rate))

    const env = ctx.createGain()
    const t = ctx.currentTime
    const level = Math.min(1.2, velocity * 0.9 * this.gain)
    env.gain.setValueAtTime(level, t)

    src.connect(env)
    this.engine.connectVoice(env, this.pan)

    const id = `s${++this._seq}`
    this.active.set(id, { src, env, midi })
    src.onended = () => this.active.delete(id)

    try {
      src.start(t, start, len / Math.max(0.25, rate))
    } catch (_) {
      this.active.delete(id)
    }
  }

  noteOff(midi, immediate = false) {
    for (const [id, vox] of [...this.active.entries()]) {
      if (midi != null && vox.midi !== midi) continue
      try {
        if (immediate) {
          vox.src.stop()
        } else {
          const t = this.engine.ctx.currentTime
          vox.env.gain.cancelScheduledValues(t)
          vox.env.gain.setValueAtTime(vox.env.gain.value, t)
          vox.env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
          vox.src.stop(t + 0.05)
        }
      } catch (_) { /* already stopped */ }
      this.active.delete(id)
    }
  }

  allNotesOff() {
    for (const midi of new Set([...this.active.values()].map((v) => v.midi))) {
      this.noteOff(midi, true)
    }
  }
}
