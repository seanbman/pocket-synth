import { midiToFreq } from "cassio/voices/glass_poly"

const TYPES = new Set(["kick", "snare", "hat", "openhat", "clap", "tom"])

function clamp01(v, fallback = 0) {
  const n = Number(v)
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : fallback))
}

/** Synth drums — independent of keyboard poly voice. */
export class DrumVoice {
  constructor(engine) {
    this.engine = engine
    this.drumType = "kick"
    this.tone = 0.5
    this.tuning = 0.5
    this.decay = 0.4
    this.snap = 0.55
    this.noise = 0.5
    this.reverb = 0.1
    this.drive = 0.1
    this.pan = 0
    this.pitchBend = 0
    this.active = new Map()
    this._seq = 0
    this._noiseBuf = null
  }

  get activeCount() {
    return this.active.size
  }

  /** Prebuild shared noise buffer once audio context exists. */
  ensureNoiseCache() {
    const ctx = this.engine.ctx
    if (!ctx || this._noiseBuf) return
    const seconds = 0.45
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this._noiseBuf = buf
  }

  #bendRatio() {
    return Math.pow(2, (this.pitchBend || 0) / 12)
  }

  /** Map 0..1 tuning to ~±1 octave ratio (0.5 = unison). */
  #tuneRatio() {
    return Math.pow(2, (this.tuning - 0.5) * 2)
  }

  applyPatch(patch) {
    if (!patch) return
    if (patch.drumType && TYPES.has(patch.drumType)) this.drumType = patch.drumType
    if (patch.tone != null) this.tone = clamp01(patch.tone, 0.5)
    if (patch.tuning != null) this.tuning = clamp01(patch.tuning, 0.5)
    if (patch.decay != null) this.decay = Math.min(1, Math.max(0.02, Number(patch.decay) || 0.4))
    if (patch.snap != null) this.snap = clamp01(patch.snap, 0.55)
    if (patch.noise != null) this.noise = clamp01(patch.noise, 0.5)
    if (patch.brightness != null && patch.tone == null) this.tone = clamp01(patch.brightness, 0.5)
    if (patch.release != null && patch.decay == null) {
      this.decay = Math.min(1, Math.max(0.02, Number(patch.release) || 0.4))
    }
    if (patch.reverb != null) this.reverb = clamp01(patch.reverb, 0.1)
    if (patch.drive != null) this.drive = clamp01(patch.drive, 0.1)
  }

  setTone(v) { this.tone = clamp01(v, 0.5) }
  setTuning(v) { this.tuning = clamp01(v, 0.5) }
  setDecay(v) { this.decay = Math.min(1, Math.max(0.02, v)) }
  setSnap(v) { this.snap = clamp01(v, 0.55) }
  setNoise(v) { this.noise = clamp01(v, 0.5) }
  setReverb(v) { this.reverb = clamp01(v, 0.1) }
  setDrive(v) { this.drive = clamp01(v, 0.1) }
  setPan(v) { this.pan = Math.min(1, Math.max(-1, Number(v) || 0)) }
  setPitchBend(semitones) {
    this.pitchBend = Math.min(2, Math.max(-2, semitones))
  }

  noteOn(midi = 60, velocity = 0.9) {
    if (!this.engine.ready) return
    const id = `d${++this._seq}`
    const ctx = this.engine.ctx
    const t = ctx.currentTime
    const out = ctx.createGain()
    const driveBoost = 0.85 + this.drive * 1.1
    out.gain.value = Math.min(1.4, velocity * driveBoost)

    // Per-hit room/delay; pan before bus so pad stereo is independent of master
    let bus = out
    if (Math.abs(this.pan) > 0.001) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.min(1, Math.max(-1, this.pan))
      out.connect(panner)
      bus = panner
    }
    const dry = this.engine.dry
    const conv = this.engine.convolver
    const delayIn = this.engine.delay
    bus.connect(dry)
    if (conv && this.reverb > 0.01) {
      const send = ctx.createGain()
      send.gain.value = this.reverb * 0.95
      bus.connect(send)
      send.connect(conv)
    }
    if (delayIn && this.drive > 0.15) {
      const dsend = ctx.createGain()
      dsend.gain.value = (this.drive - 0.15) * 0.45
      bus.connect(dsend)
      dsend.connect(delayIn)
    }

    const type = this.drumType
    if (type === "kick") this.#kick(ctx, t, out, midi)
    else if (type === "snare") this.#snare(ctx, t, out)
    else if (type === "hat") this.#hat(ctx, t, out, false)
    else if (type === "openhat") this.#hat(ctx, t, out, true)
    else if (type === "clap") this.#clap(ctx, t, out)
    else if (type === "tom") this.#tom(ctx, t, out, midi)

    const dur = 0.05 + this.decay * (type === "openhat" ? 1.1 : type === "kick" ? 0.85 : 0.55)
    this.active.set(id, out)
    setTimeout(() => this.active.delete(id), (dur + 0.35) * 1000)
  }

  noteOff(_midi, _immediate = false) {
    /* one-shots; nothing to release */
  }

  allNotesOff() {
    this.active.clear()
  }

  #noiseBuffer(ctx, seconds = 0.2) {
    this.ensureNoiseCache()
    if (this._noiseBuf) return this._noiseBuf
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buf
  }

  #click(ctx, t, out, amount, freq = 2500) {
    if (amount < 0.02) return
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = "square"
    osc.frequency.value = freq * (0.7 + this.tone * 0.8)
    env.gain.setValueAtTime(amount * 0.55, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.012 + amount * 0.02)
    osc.connect(env)
    env.connect(out)
    osc.start(t)
    osc.stop(t + 0.05)
  }

  #kick(ctx, t, out, midi) {
    const bend = this.#bendRatio() * this.#tuneRatio()
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    // TONE: boom vs tight thump — wide pitch range
    const base = (32 + this.tone * 90) * bend
    const start = Math.max(base * 1.2, midiToFreq(Math.min(midi, 48)) * 0.45 * bend)
    osc.frequency.setValueAtTime(start * (2.2 + this.tone * 1.4), t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, base), t + 0.04 + this.decay * 0.12)
    const dur = 0.08 + this.decay * 0.75
    env.gain.setValueAtTime(1, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(env)
    env.connect(out)
    osc.start(t)
    osc.stop(t + dur + 0.03)

    // SNAP: beater click
    this.#click(ctx, t, out, this.snap * 0.9, 1800 + this.tone * 2200)
    // NOISE: short dirt
    if (this.noise > 0.05) {
      const src = ctx.createBufferSource()
      src.buffer = this.#noiseBuffer(ctx, 0.12)
      const hp = ctx.createBiquadFilter()
      hp.type = "highpass"
      hp.frequency.value = 600 + this.tone * 2000
      const nEnv = ctx.createGain()
      nEnv.gain.setValueAtTime(this.noise * 0.35, t)
      nEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + this.noise * 0.06)
      src.connect(hp)
      hp.connect(nEnv)
      nEnv.connect(out)
      src.start(t)
      src.stop(t + 0.12)
    }
  }

  #snare(ctx, t, out) {
    const bend = this.#bendRatio() * this.#tuneRatio()
    const osc = ctx.createOscillator()
    const oscEnv = ctx.createGain()
    osc.type = "triangle"
    // TONE: body pitch
    osc.frequency.value = (140 + this.tone * 320) * bend
    const toneDur = 0.04 + this.decay * 0.22
    const bodyAmt = 0.25 + (1 - this.noise) * 0.45
    oscEnv.gain.setValueAtTime(bodyAmt, t)
    oscEnv.gain.exponentialRampToValueAtTime(0.0001, t + toneDur)
    osc.connect(oscEnv)
    oscEnv.connect(out)
    osc.start(t)
    osc.stop(t + toneDur + 0.02)

    const src = ctx.createBufferSource()
    src.buffer = this.#noiseBuffer(ctx, 0.3)
    const filt = ctx.createBiquadFilter()
    filt.type = "highpass"
    filt.frequency.value = (500 + this.tone * 3500) * Math.min(bend, 2)
    const noiseEnv = ctx.createGain()
    const nDur = 0.04 + this.decay * 0.35
    const crack = 0.15 + this.snap * 0.85
    const noiseAmt = (0.2 + this.noise * 0.85) * crack
    noiseEnv.gain.setValueAtTime(noiseAmt, t)
    noiseEnv.gain.exponentialRampToValueAtTime(0.0001, t + nDur)
    src.connect(filt)
    filt.connect(noiseEnv)
    noiseEnv.connect(out)
    src.start(t)
    src.stop(t + nDur + 0.02)

    this.#click(ctx, t, out, this.snap * 0.5, 3200)
  }

  #hat(ctx, t, out, open) {
    const bend = this.#bendRatio() * this.#tuneRatio()
    const src = ctx.createBufferSource()
    src.buffer = this.#noiseBuffer(ctx, 0.4)
    const filt = ctx.createBiquadFilter()
    filt.type = "bandpass"
    // TONE: dark → sizzly
    filt.frequency.value = (2500 + this.tone * 9000) * Math.min(bend, 2)
    filt.Q.value = 0.6 + this.snap * 2.5
    const env = ctx.createGain()
    const dur = open
      ? (0.08 + this.decay * 1.05)
      : (0.015 + this.decay * 0.18)
    const level = 0.35 + this.noise * 0.45
    env.gain.setValueAtTime(level, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filt)
    filt.connect(env)
    env.connect(out)
    src.start(t)
    src.stop(t + dur + 0.02)
    this.#click(ctx, t, out, this.snap * 0.35, 6000 + this.tone * 4000)
  }

  #clap(ctx, t, out) {
    const bend = this.#bendRatio() * this.#tuneRatio()
    const src = ctx.createBufferSource()
    src.buffer = this.#noiseBuffer(ctx, 0.35)
    const filt = ctx.createBiquadFilter()
    filt.type = "bandpass"
    filt.frequency.value = (700 + this.tone * 2600) * Math.min(bend, 2)
    filt.Q.value = 0.5 + this.snap * 1.8
    const env = ctx.createGain()
    const dur = 0.05 + this.decay * 0.35
    const peak = 0.45 + this.noise * 0.45
    // SNAP: tighter multi-burst
    const gap = 0.014 - this.snap * 0.008
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(peak, t + 0.001)
    env.gain.setValueAtTime(0.08, t + gap)
    env.gain.linearRampToValueAtTime(peak * 0.95, t + gap + 0.002)
    env.gain.setValueAtTime(0.12, t + gap * 2)
    env.gain.linearRampToValueAtTime(peak * 0.7, t + gap * 2 + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filt)
    filt.connect(env)
    env.connect(out)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  #tom(ctx, t, out, midi) {
    const bend = this.#bendRatio() * this.#tuneRatio()
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = "sine"
    const f = midiToFreq(Math.max(36, Math.min(midi, 72))) * (0.45 + this.tone * 1.1) * bend
    osc.frequency.setValueAtTime(f * (1.6 + this.snap * 0.5), t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.75), t + 0.05 + this.decay * 0.1)
    const dur = 0.07 + this.decay * 0.7
    env.gain.setValueAtTime(0.85, t)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(env)
    env.connect(out)
    osc.start(t)
    osc.stop(t + dur + 0.03)
    this.#click(ctx, t, out, this.snap * 0.4, 900 + this.tone * 1200)
    if (this.noise > 0.08) {
      const src = ctx.createBufferSource()
      src.buffer = this.#noiseBuffer(ctx, 0.15)
      const hp = ctx.createBiquadFilter()
      hp.type = "highpass"
      hp.frequency.value = 400 + this.tone * 1500
      const nEnv = ctx.createGain()
      nEnv.gain.setValueAtTime(this.noise * 0.3, t)
      nEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.04 + this.decay * 0.08)
      src.connect(hp)
      hp.connect(nEnv)
      nEnv.connect(out)
      src.start(t)
      src.stop(t + 0.15)
    }
  }
}
