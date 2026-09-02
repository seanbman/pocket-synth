import { midiToFreq, noteNameToMidi } from "cassio/voices/glass_poly"
import { DEFAULT_SAMPLE_GAIN } from "cassio/patch"
import { FxChain } from "cassio/audio/fx_chain"
import { sanitizeFx, syncSeconds } from "cassio/audio/fx_params"

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Sample playback — oneshot/gate from an AudioBuffer through a per-voice FX chain.
 * Handles trim, fades, ADSR, pitch (root/transpose/fine/octave/detune/bend), speed,
 * reverse, loop modes (fwd/rev/pingpong + crossfade), mono/retrigger/choke,
 * tape start/stop, stutter and per-trigger randomization. Everything else lives in FxChain.
 */
export class SampleVoice {
  constructor(engine) {
    this.engine = engine
    this.buffer = null
    this._reversed = null
    this.rootMidi = 60
    this.p = sanitizeFx({}, "sample")
    this.pitchBend = 0
    this.bpmSource = null
    this.active = new Map()
    this._seq = 0
    this.fx = new FxChain(engine, { scope: "sample", bpmSource: () => this.bpm })
  }

  get bpm() {
    const v = this.bpmSource ? Number(this.bpmSource()) : 120
    return Number.isFinite(v) && v > 0 ? v : 120
  }

  get activeCount() {
    return this.active.size
  }

  // Legacy accessors used by UI/controllers
  get gain() { return this.p.gain }
  set gain(v) { this.p.gain = clamp(Number(v) || DEFAULT_SAMPLE_GAIN, 0.15, 2.5); this.fx.apply({ gain: this.p.gain }) }
  get trimStart() { return this.p.trimStart }
  get trimEnd() { return this.p.trimEnd }
  get tuneSemis() { return this.p.tuneSemis }
  get padMode() { return this.p.padMode }
  get pan() { return this.p.pan }

  setBuffer(buf) {
    this.buffer = buf || null
    this._reversed = null
  }

  /** Apply a full or partial flat patch (legacy keys + fx keys). */
  applyPatch(patch) {
    if (!patch) return
    if (patch.root) this.rootMidi = noteNameToMidi(patch.root)
    const next = { ...this.p }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
    this.p = sanitizeFx(next, "sample")
    if (this.p.trimEnd <= this.p.trimStart + 0.005) this.p.trimEnd = clamp(this.p.trimStart + 0.005, 0.01, 1)
    if (this.p.loopEnd <= this.p.loopStart + 0.005) this.p.loopEnd = clamp(this.p.loopStart + 0.005, 0.01, 1)
    this.fx.ensure()
    this.fx.apply(this.p)
  }

  setPan(v) { this.applyPatch({ pan: v }) }

  /** Sample level (independent of master). */
  setGain(v) { this.applyPatch({ gain: v }) }

  #reversedBuffer() {
    if (this._reversed && this._reversed.length === this.buffer.length) return this._reversed
    const ctx = this.engine.ctx
    const b = this.buffer
    const out = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate)
    for (let c = 0; c < b.numberOfChannels; c++) {
      const src = b.getChannelData(c), dst = out.getChannelData(c)
      for (let i = 0, n = b.length; i < n; i++) dst[i] = src[n - 1 - i]
    }
    this._reversed = out
    return out
  }

  #baseRate(midi) {
    const keyed = midiToFreq(midi) / midiToFreq(this.rootMidi)
    const semis = (this.p.tuneSemis || 0) + (this.p.octave || 0) * 12 + (this.p.fine || 0) / 100
    return keyed * Math.pow(2, semis / 12) * (this.p.speed || 1)
  }

  #rateFor(midi) {
    return this.#baseRate(midi) * Math.pow(2, (this.pitchBend || 0) / 12)
  }

  #trimSeconds() {
    if (!this.buffer) return 0
    const dur = this.buffer.duration
    const start = this.p.trimStart * dur
    const end = Math.max(start + 0.01, this.p.trimEnd * dur)
    return end - start
  }

  /** Real (wall-clock) playback time of the trimmed region at this midi's rate. */
  playSeconds(midi = this.rootMidi) {
    const rate = clamp(this.#rateFor(midi), 0.05, 8)
    return this.#trimSeconds() / rate
  }

  setPitchBend(semitones) {
    this.pitchBend = clamp(semitones, -2, 2)
    const bent = Math.pow(2, this.pitchBend / 12)
    for (const vox of this.active.values()) {
      try {
        vox.src.playbackRate.setTargetAtTime(clamp(vox.baseRate * bent, 0.05, 8), this.engine.ctx.currentTime, 0.02)
      } catch (_) { /* ignore */ }
    }
  }

  /** Performance FX: ramp all active voices to a stop like a tape machine. */
  tapeStop(seconds = 0.8) {
    if (!this.engine.ready) return
    const t = this.engine.ctx.currentTime
    for (const [id, vox] of [...this.active.entries()]) {
      try {
        vox.src.playbackRate.cancelScheduledValues(t)
        vox.src.playbackRate.setValueAtTime(vox.src.playbackRate.value, t)
        vox.src.playbackRate.exponentialRampToValueAtTime(0.01, t + seconds)
        vox.env.gain.setTargetAtTime(0.0001, t + seconds * 0.7, seconds * 0.15)
        vox.src.stop(t + seconds + 0.05)
      } catch (_) { /* ignore */ }
      vox.stopped = true
      this.active.delete(id)
      this.#released()
    }
  }

  #released() {
    this.fx.setActive(this.active.size)
  }

  /** `when` (audio time) lets the step sequencer schedule hits sample-accurately. */
  noteOn(midi = 60, velocity = 0.9, { loop = false, when = null, recTrack = null } = {}) {
    if (!this.engine.ready || !this.buffer) return
    this.fx.ensure()
    const ctx = this.engine.ctx
    const p = this.p

    // Voice management
    if (p.voices === "mono") this.noteOff(null)
    else if (!p.retrigger && [...this.active.values()].some((v) => v.midi === midi)) return
    if (p.choke > 0) this.chokeGroup(p.choke)

    const buf = this.buffer
    const dur = buf.duration
    let start = p.trimStart * dur
    let end = Math.max(start + 0.01, p.trimEnd * dur)
    // Per-trigger randomization
    if (p.randStart > 0) start = start + Math.random() * p.randStart * (end - start) * 0.95
    const randSemis = p.randPitch > 0 ? (Math.random() * 2 - 1) * p.randPitch : 0
    const detune = p.detune > 0 ? (Math.random() * 2 - 1) * p.detune / 100 : 0
    const reverse = !!p.reverse !== (p.randReverse > 0 && Math.random() < p.randReverse)
    const len = end - start

    const baseRate = this.#baseRate(midi) * Math.pow(2, (randSemis + detune) / 12)
    const rate = clamp(baseRate * Math.pow(2, (this.pitchBend || 0) / 12), 0.05, 8)

    const src = ctx.createBufferSource()
    src.buffer = reverse ? this.#reversedBuffer() : buf
    const t = Math.max(ctx.currentTime, Number(when) || 0)
    if (p.tapeStart) {
      src.playbackRate.setValueAtTime(rate * 0.05, t)
      src.playbackRate.exponentialRampToValueAtTime(rate, t + 0.45)
    } else {
      src.playbackRate.value = rate
    }
    const detachMod = this.fx.attachRateMod(src.playbackRate, rate)

    // Region in the (possibly reversed) buffer
    const rStart = reverse ? dur - end : start
    const rEnd = reverse ? dur - start : end

    // Loop region: explicit loop points, stutter slice, or HOLD over trim
    let looping = false, lStart = rStart, lEnd = rEnd, pingpong = false
    if (p.stutter) {
      const slice = syncSeconds(p.stutterRate, this.bpm) * rate
      looping = true; lStart = rStart; lEnd = Math.min(rEnd, rStart + Math.max(0.01, slice))
    } else if (p.loopOn) {
      const ls = clamp(p.loopStart, 0, 0.99) * dur, le = Math.max(ls + 0.01, clamp(p.loopEnd, 0.01, 1) * dur)
      looping = true
      lStart = reverse ? dur - le : ls
      lEnd = reverse ? dur - ls : le
      pingpong = p.loopMode === "pingpong"
      if (p.loopMode === "rev" && !reverse) {
        // reverse-direction loop on a forward one-shot: play from reversed buffer
        src.buffer = this.#reversedBuffer()
        lStart = dur - le; lEnd = dur - ls
      }
    } else if (loop) {
      looping = true
    }

    const env = ctx.createGain()
    const fade = ctx.createGain()
    const vel = clamp(velocity, 0, 2.2)
    // ADSR
    const a = Math.max(0, p.ampAttack), d = Math.max(0, p.ampDecay), s = clamp(p.ampSustain, 0, 1)
    env.gain.setValueAtTime(a > 0.002 ? 0.0001 : vel, t)
    if (a > 0.002) env.gain.linearRampToValueAtTime(vel, t + a)
    if (d > 0.002 && s < 0.999) env.gain.setTargetAtTime(Math.max(0.0001, vel * s), t + a, d / 3)
    else if (s < 0.999) env.gain.setValueAtTime(Math.max(0.0001, vel * s), t + a + 0.001)
    // Fades (in buffer-region time, scaled by rate)
    const playLen = len / rate
    fade.gain.setValueAtTime(p.fadeIn > 0.002 ? 0.0001 : 1, t)
    if (p.fadeIn > 0.002) fade.gain.linearRampToValueAtTime(1, t + Math.min(p.fadeIn, playLen))
    if (!looping && p.fadeOut > 0.002) {
      const fo = Math.min(p.fadeOut, playLen)
      fade.gain.setValueAtTime(1, t + playLen - fo)
      fade.gain.linearRampToValueAtTime(0.0001, t + playLen)
    }

    src.connect(env)
    env.connect(fade)
    fade.connect(this.fx.input)
    if (recTrack) this.engine.tapRec(fade, recTrack)

    const id = `s${++this._seq}`
    const vox = { src, env, fade, midi, baseRate, detachMod, stopped: false, group: p.choke }
    this.active.set(id, vox)
    this.fx.setActive(this.active.size)
    const done = () => {
      if (this.active.get(id) === vox) this.active.delete(id)
      detachMod()
      this.#released()
    }

    try {
      if (looping && pingpong) {
        this.#pingpong(vox, lStart, lEnd, rStart, t)
      } else if (looping) {
        src.loop = true
        src.loopStart = lStart
        src.loopEnd = lEnd
        src.onended = done
        src.start(t, Math.min(Math.max(rStart, lStart), lEnd - 0.001))
      } else {
        // `duration` is in buffer seconds (not scaled by playbackRate).
        src.onended = done
        src.start(t, rStart, rEnd - rStart)
      }
    } catch (_) {
      done()
    }
  }

  /** Ping-pong loop: chain alternating forward/reversed segments with optional crossfade. */
  #pingpong(vox, lStart, lEnd, rStart, t0) {
    const ctx = this.engine.ctx
    const fwd = this.buffer, rev = this.#reversedBuffer()
    const dur = fwd.duration
    const xf = Math.max(0, this.p.loopXfade)
    let dir = 1
    let when = t0
    let first = true
    const segLen = lEnd - lStart
    const rate = () => Math.max(0.05, vox.src.playbackRate.value || vox.baseRate)
    const schedule = () => {
      if (vox.stopped) return
      const src = ctx.createBufferSource()
      src.buffer = dir > 0 ? fwd : rev
      src.playbackRate.value = rate()
      const g = ctx.createGain()
      src.connect(g); g.connect(vox.env)
      const off = first ? Math.min(Math.max(rStart, lStart), lEnd - 0.001) : lStart
      const bufOff = dir > 0 ? off : dur - lEnd
      const segBuf = dir > 0 ? lEnd - off : segLen
      const wall = segBuf / src.playbackRate.value
      if (xf > 0.001) {
        g.gain.setValueAtTime(first ? 1 : 0.0001, when)
        if (!first) g.gain.linearRampToValueAtTime(1, when + Math.min(xf, wall / 2))
        g.gain.setValueAtTime(1, when + wall - Math.min(xf, wall / 2))
        g.gain.linearRampToValueAtTime(0.0001, when + wall)
      }
      try { src.start(when, bufOff, segBuf) } catch (_) { return }
      vox.segs = (vox.segs || []).filter((s) => s !== src)
      vox.segs.push(src)
      vox.src = src
      const next = when + wall - (xf > 0.001 ? Math.min(xf, wall / 2) : 0)
      dir = -dir
      first = false
      when = next
      // Schedule the following segment slightly ahead of time
      const lead = Math.max(0.02, (next - ctx.currentTime) - 0.15)
      vox.timer = setTimeout(schedule, lead * 1000)
    }
    // Replace the pre-made source: never started, just drop it
    try { vox.src.disconnect() } catch (_) { /* ignore */ }
    schedule()
  }

  #stopVox(vox, at) {
    vox.stopped = true
    if (vox.timer) clearTimeout(vox.timer)
    const list = vox.segs ? [...vox.segs, vox.src] : [vox.src]
    for (const s of new Set(list)) { try { s.stop(at) } catch (_) { /* already stopped */ } }
    vox.detachMod?.()
  }

  noteOff(midi, immediate = false, { when = null } = {}) {
    for (const [id, vox] of [...this.active.entries()]) {
      if (midi != null && vox.midi !== midi) continue
      try {
        if (immediate) {
          this.#stopVox(vox)
        } else {
          const now = this.engine.ctx.currentTime
          const t = Math.max(now, Number(when) || 0)
          const rel = Math.max(0.01, this.p.ampRelease || 0.04)
          if (t > now + 0.001) {
            // Scheduled release (sequencer gate): leave the in-flight envelope alone
            vox.env.gain.setTargetAtTime(0.0001, t, Math.max(0.005, rel / 4))
          } else {
            vox.env.gain.cancelScheduledValues(t)
            vox.env.gain.setValueAtTime(Math.max(0.0001, vox.env.gain.value), t)
            vox.env.gain.exponentialRampToValueAtTime(0.0001, t + rel)
          }
          this.#stopVox(vox, t + rel + 0.02)
        }
      } catch (_) { /* already stopped */ }
      this.active.delete(id)
    }
    this.#released()
  }

  /** Stop voices in a choke group (called by app when another sound in that group fires). */
  chokeGroup(group) {
    for (const [id, vox] of [...this.active.entries()]) {
      if (vox.group !== group) continue
      try {
        const t = this.engine.ctx.currentTime
        vox.env.gain.cancelScheduledValues(t)
        vox.env.gain.setTargetAtTime(0.0001, t, 0.008)
        this.#stopVox(vox, t + 0.04)
      } catch (_) { /* ignore */ }
      this.active.delete(id)
    }
    this.#released()
  }

  allNotesOff() {
    for (const midi of new Set([...this.active.values()].map((v) => v.midi))) {
      this.noteOff(midi, true)
    }
  }
}
