import { bufferToStored, storedToBuffer } from "cassio/audio/sample_io"
import { FxChain } from "cassio/audio/fx_chain"
import { sanitizeFx } from "cassio/audio/fx_params"
import { QUANTIZE_OPTS, sanitizeTrackSeq, defaultTrackSeq } from "cassio/store"

/** Presets for user-set loop / track lengths (OPTIONS + track menu). */
export const LOOP_LENGTH_PRESETS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

function snapLengthBars(n) {
  const v = Math.max(1, Math.round(Number(n) || 4))
  for (const b of LOOP_LENGTH_PRESETS) {
    if (b >= v) return b
  }
  return LOOP_LENGTH_PRESETS[LOOP_LENGTH_PRESETS.length - 1]
}

function emptyTrack(n, lengthBars = 4) {
  return {
    id: n,
    name: `TRK ${n}`,
    armed: n === 1,
    mute: false,
    solo: false,
    monitor: true,
    mode: "overdub",
    level: 1,
    pan: 0,
    offsetSec: 0,
    lengthBars: snapLengthBars(lengthBars),
    fx: sanitizeFx({}, "track"),
    buffer: null,
    undoBuffer: null,
    seq: defaultTrackSeq()
  }
}

/** Pad or truncate buffer to `samples` (silence fills the tail). */
function resizeBuffer(ctx, buf, samples) {
  if (!buf) return null
  const n = Math.max(1, samples | 0)
  if (buf.length === n) return buf
  const ch = buf.numberOfChannels
  const out = ctx.createBuffer(ch, n, ctx.sampleRate)
  const copy = Math.min(buf.length, n)
  for (let c = 0; c < ch; c++) {
    out.getChannelData(c).set(buf.getChannelData(c).subarray(0, copy))
  }
  return out
}

/** Soft-clip mix of two buffers (same length preferred). */
function mixBuffers(ctx, base, pass) {
  if (!pass) return base
  if (!base) return pass
  const len = Math.max(base.length, pass.length)
  const ch = Math.max(base.numberOfChannels, pass.numberOfChannels)
  const out = ctx.createBuffer(ch, len, ctx.sampleRate)
  for (let c = 0; c < ch; c++) {
    const o = out.getChannelData(c)
    const a = c < base.numberOfChannels ? base.getChannelData(c) : null
    const b = c < pass.numberOfChannels ? pass.getChannelData(c) : null
    for (let i = 0; i < len; i++) {
      const v = (a?.[i] || 0) + (b?.[i] || 0)
      o[i] = Math.tanh(v * 0.9)
    }
  }
  return out
}

/**
 * Six-track audio looper: PCM capture from live dry bus, playback to master only.
 */
export class LoopEngine {
  constructor(engine, transport) {
    this.engine = engine
    this.transport = transport
    this.lengthBars = 4
    this.tracks = [1, 2, 3, 4, 5, 6].map(emptyTrack)
    this.selected = 1
    this._sources = new Map()
    this._chains = new Map()
    this._rateMods = new Map()
    this._recording = false
    this._recTrack = null
    this._recProc = null
    this._recMute = null
    this._recData = null
    this._recWritten = 0
    this._recTarget = 0
    this._recStartedAt = 0
    this._onRecDone = null
    this._playOrigin = 0
    /** @type {"all"|"monitored"|"off"} backing tracks heard while recording */
    this.playDuringRec = "all"
    /** @type {"off"|"1/4"|"1/8"|"1/16"} record/overdub grid snap */
    this.quantize = "1/16"
  }

  get selectedTrack() {
    return this.tracks.find((t) => t.id === this.selected) || this.tracks[0]
  }

  ensureGraph() {
    if (!this.engine?.ready) return
    for (const t of this.tracks) {
      if (this._chains.has(t.id)) continue
      // Tracks feed master directly (not the dry bus) so they are never re-recorded.
      const chain = new FxChain(this.engine, {
        scope: "track",
        destination: this.engine.master,
        bpmSource: () => this.transport?.bpm
      })
      chain.ensure()
      this._chains.set(t.id, chain)
      this.#applyTrackGain(t)
    }
  }

  applyState(loop) {
    if (!loop) return
    if (loop.lengthBars) this.lengthBars = snapLengthBars(loop.lengthBars)
    if (loop.selected) this.selected = loop.selected
    this.playDuringRec = ["all", "monitored", "off"].includes(loop.playDuringRec)
      ? loop.playDuringRec
      : "all"
    this.quantize = QUANTIZE_OPTS.includes(loop.quantize) ? loop.quantize : "1/16"
    if (Array.isArray(loop.tracks)) {
      for (const src of loop.tracks) {
        const t = this.tracks.find((x) => x.id === src.id)
        if (!t) continue
        Object.assign(t, {
          name: src.name || t.name,
          armed: !!src.armed,
          mute: !!src.mute,
          solo: !!src.solo,
          monitor: src.monitor !== false,
          mode: src.mode === "replace" ? "replace" : "overdub",
          level: src.level ?? src.fx?.level ?? 1,
          pan: src.pan ?? src.fx?.pan ?? 0,
          offsetSec: Number(src.offsetSec) || 0,
          fx: sanitizeFx(src.fx || {}, "track"),
          // Per-track bars; fall back to project default for older saves
          lengthBars: snapLengthBars(src.lengthBars ?? loop.lengthBars ?? t.lengthBars)
        })
        t.seq = sanitizeTrackSeq(src.seq || t.seq)
        if (src.audio && this.engine.ctx) {
          t.buffer = storedToBuffer(this.engine.ctx, src.audio)
          // Seed the serialize cache so the first persist doesn't re-copy PCM
          t._stored = src.audio
          t._storedFor = t.buffer
        }
      }
    }
    this.ensureGraph()
    for (const t of this.tracks) {
      this.#syncTrackMix(t)
      this.#applyTrackGain(t)
    }
  }

  serialize() {
    return {
      lengthBars: this.lengthBars,
      selected: this.selected,
      quantize: this.quantize,
      playDuringRec: this.playDuringRec,
      tracks: this.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        armed: t.armed,
        mute: t.mute,
        solo: t.solo,
        monitor: t.monitor,
        mode: t.mode,
        level: t.level,
        pan: t.pan,
        offsetSec: t.offsetSec ?? 0,
        lengthBars: t.lengthBars,
        fx: { ...t.fx },
        seq: { ...t.seq, steps: t.seq.steps.map((s) => ({ ...s })) },
        audio: this.#storedAudio(t)
      }))
    }
  }

  /** Serialized PCM cached per buffer identity — level/pan/fx edits must not re-copy audio. */
  #storedAudio(t) {
    if (!t.buffer) { t._storedFor = null; t._stored = null; return null }
    if (t._storedFor !== t.buffer) {
      t._stored = bufferToStored(t.buffer)
      t._storedFor = t.buffer
    }
    return t._stored
  }

  select(n) {
    this.selected = Math.min(6, Math.max(1, n))
  }

  armSelected() {
    const t = this.selectedTrack
    const next = !t.armed
    for (const x of this.tracks) x.armed = false
    t.armed = next
    return t.armed
  }

  /** Exclusive arm for REC — selected track is the capture target. */
  armForRecord(trackId = this.selected) {
    const t = this.tracks.find((x) => x.id === trackId) || this.selectedTrack
    for (const x of this.tracks) x.armed = false
    t.armed = true
    this.select(t.id)
    return t
  }

  /**
   * Active song length: default loop bars, extended only when recorded audio
   * ends past that window. Shrinks when nothing plays beyond the default.
   */
  timelineBars() {
    const defaultBars = this.lengthBars
    const defaultSec = this.transport.loopSec(defaultBars)
    const barSec = this.transport.barSec()
    let maxEndSec = 0
    for (const t of this.tracks) {
      if (!t.buffer) continue
      maxEndSec = Math.max(maxEndSec, (t.offsetSec ?? 0) + this.trackLoopSec(t))
    }
    if (maxEndSec <= defaultSec + 0.001) return defaultBars
    const needed = Math.ceil((maxEndSec - 0.001) / barSec)
    return Math.max(defaultBars, needed)
  }

  timelineSec() {
    return this.transport.loopSec(this.timelineBars())
  }

  /** Project default length (empty tracks / OPTIONS). */
  setLengthBars(n) {
    this.lengthBars = snapLengthBars(n)
  }

  /**
   * Set one track's bar count. Resizes existing audio (pad/truncate).
   * @returns {number} new lengthBars
   */
  setTrackLengthBars(trackId, n) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return this.lengthBars
    const bars = snapLengthBars(n)
    if (t.lengthBars === bars) return bars
    t.lengthBars = bars
    if (t.buffer && this.engine?.ctx) {
      const samples = Math.max(1, Math.floor(this.transport.loopSec(bars) * this.engine.ctx.sampleRate))
      t.buffer = resizeBuffer(this.engine.ctx, t.buffer, samples)
      if (this.transport.playing) {
        this.#startTrack(t, this.engine.ctx.currentTime)
      }
    }
    return bars
  }

  /** Apply default length to every track that has no audio. */
  applyDefaultLengthToEmpty(n) {
    const bars = snapLengthBars(n)
    this.lengthBars = bars
    for (const t of this.tracks) {
      if (!t.buffer) t.lengthBars = bars
    }
    return bars
  }

  #anySolo() {
    return this.tracks.some((t) => t.solo)
  }

  /** Normalize + mirror track level/pan on both mix fields and fx bag. */
  #syncTrackMix(t) {
    const level = Math.min(1.5, Math.max(0, Number(t.level ?? t.fx?.level ?? 1)))
    const pan = Math.min(1, Math.max(-1, Number(t.pan ?? t.fx?.pan ?? 0)))
    t.level = level
    t.pan = pan
    if (t.fx) {
      t.fx.level = level
      t.fx.pan = pan
    }
    return { level, pan }
  }

  setTrackLevel(trackId, level) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return
    t.level = level
    this.#syncTrackMix(t)
    this.#applyTrackGain(t)
  }

  setTrackPan(trackId, pan) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return
    t.pan = pan
    this.#syncTrackMix(t)
    this.#applyTrackGain(t)
  }

  /** Master loop duration — grows with track layout, shrinks when clips fit default. */
  masterLoopSec() {
    return this.timelineSec()
  }

  /** Seconds into the loop cycle where this track's buffer phase starts. */
  trackLoopSec(t) {
    return this.transport.loopSec(t.lengthBars || this.lengthBars)
  }

  /** Buffer read position for a track at audio context time `atTime`. */
  #trackBufferPhase(t, atTime) {
    const masterLoop = this.masterLoopSec()
    const trackLoop = this.trackLoopSec(t)
    const offset = masterLoop > 0
      ? (((t.offsetSec ?? 0) % masterLoop) + masterLoop) % masterLoop
      : 0
    const elapsed = Math.max(0, atTime - this._playOrigin)
    const masterPhase = masterLoop > 0 ? elapsed % masterLoop : 0
    const phase = trackLoop > 0
      ? ((masterPhase - offset) % trackLoop + trackLoop) % trackLoop
      : 0
    return Math.min(Math.max(0, phase), Math.max(0, t.buffer.duration - 0.001))
  }

  #stopTrack(trackId) {
    const src = this._sources.get(trackId)
    if (src) {
      try { src.stop(0) } catch (_) { /* ignore */ }
      this._sources.delete(trackId)
    }
    const detach = this._rateMods.get(trackId)
    if (detach) {
      detach()
      this._rateMods.delete(trackId)
    }
    const chain = this._chains.get(trackId)
    if (chain) chain.setActive(0)
  }

  /** Schedule one track aligned to the master loop at `when`. */
  #startTrack(t, when) {
    if (!t.buffer || !this.engine?.ready) return
    const ctx = this.engine.ctx
    const chain = this._chains.get(t.id)
    if (!chain) return

    this.#stopTrack(t.id)

    const src = ctx.createBufferSource()
    src.buffer = t.buffer
    src.loop = true
    src.loopStart = 0
    src.loopEnd = Math.min(t.buffer.duration, this.trackLoopSec(t))
    src.connect(chain.input)
    this._rateMods.set(t.id, chain.attachRateMod(src.playbackRate, 1))

    const startOff = this.#trackBufferPhase(t, when)
    try {
      src.start(when, startOff)
    } catch (_) { /* ignore */ }
    this._sources.set(t.id, src)
    this.#applyTrackGain(t)
  }

  setTrackOffset(trackId, offsetSec) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return 0
    t.offsetSec = Math.max(0, Math.round(offsetSec))
    if (this.transport?.playing && t.buffer) {
      this.#startTrack(t, this.engine.ctx.currentTime)
    }
    return t.offsetSec
  }

  nudgeTrackOffset(trackId, deltaSec) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return 0
    return this.setTrackOffset(trackId, (t.offsetSec ?? 0) + deltaSec)
  }

  /** During capture: P2 mutes the recording track; P1 honors playDuringRec + per-track monitor. */
  #audibleWhileRecording(t) {
    if (!this._recording) return true
    if (t.id === this._recTrack?.id) return false
    const mode = this.playDuringRec || "all"
    if (mode === "off") return false
    if (mode === "monitored") return t.monitor !== false
    return true
  }

  #applyTrackGain(t) {
    const chain = this._chains.get(t.id)
    if (!chain || !this.engine?.ctx) return
    const { level, pan } = this.#syncTrackMix(t)
    const solo = this.#anySolo()
    let audible = solo ? t.solo && !t.mute : !t.mute
    if (this._recording && !this.#audibleWhileRecording(t)) audible = false
    // Mute/solo gate on the chain input; level/pan ride the chain's MIX params.
    if (this._recording && !audible) {
      chain.input.gain.cancelScheduledValues(this.engine.ctx.currentTime)
      chain.input.gain.setValueAtTime(0, this.engine.ctx.currentTime)
    } else {
      chain.input.gain.setTargetAtTime(audible ? 1 : 0, this.engine.ctx.currentTime, 0.02)
    }
    chain.apply({ ...t.fx, level, pan })
    chain.setActive(audible && this.transport?.playing && t.buffer ? 1 : 0)
  }

  /** Per-track FX param (scope "track"). */
  setTrackFx(trackId, key, value) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return
    if (key === "level") t.level = value
    else if (key === "pan") t.pan = value
    t.fx = sanitizeFx({ ...t.fx, [key]: value }, "track")
    this.#syncTrackMix(t)
    this.#applyTrackGain(t)
  }

  trackChain(trackId) {
    return this._chains.get(trackId || this.selected) || null
  }

  refreshGains() {
    for (const t of this.tracks) this.#applyTrackGain(t)
  }

  stopPlayback() {
    for (const t of this.tracks) this.#stopTrack(t.id)
  }

  /** Schedule looping buffers from a shared master-loop origin. */
  startPlayback(originTime) {
    this.ensureGraph()
    this.stopPlayback()
    if (!this.engine?.ready) return
    const ctx = this.engine.ctx
    const t0 = originTime ?? ctx.currentTime
    this._playOrigin = t0
    for (const t of this.tracks) {
      if (t.buffer) this.#startTrack(t, t0)
    }
    this.refreshGains()
  }

  hasAnyAudio() {
    return this.tracks.some((t) => !!t.buffer)
  }

  get recording() {
    return this._recording
  }

  /**
   * Begin PCM capture of live dry bus for this track's `lengthBars`.
   * Call after count-in at `startTime` (AudioContext time).
   */
  beginRecord(trackId, { replace = false, startTime = null, onDone = null } = {}) {
    if (!this.engine?.ready) return false
    if (this._recording) this.stopRecord()
    const t = this.tracks.find((x) => x.id === trackId)
    if (!t) return false
    this.ensureGraph()
    const ctx = this.engine.ctx
    const bars = snapLengthBars(t.lengthBars || this.lengthBars)
    t.lengthBars = bars
    const samples = Math.max(1, Math.floor(this.transport.loopSec(bars) * ctx.sampleRate))
    this._recording = true
    this._recTrack = t
    this._recReplace = replace || t.mode === "replace"
    this._recTarget = samples
    this._recWritten = 0
    this._recData = [
      new Float32Array(samples),
      new Float32Array(samples)
    ]
    this._onRecDone = onDone
    this._recStartedAt = startTime ?? ctx.currentTime

    const proc = ctx.createScriptProcessor(4096, 2, 2)
    const sink = ctx.createGain()
    sink.gain.value = 0
    const recBus = this.engine.recTapForTrack(trackId)
    recBus.connect(proc)
    proc.connect(sink)
    // Pull the processor graph without summing capture monitor into master (avoids bleed/phase).
    sink.connect(ctx.destination)
    this._recProc = proc
    this._recSink = sink
    this._recBus = recBus

    proc.onaudioprocess = (ev) => {
      if (!this._recording) return
      const now = ctx.currentTime
      if (now + 0.002 < this._recStartedAt) return
      const left = ev.inputBuffer.getChannelData(0)
      const right = ev.inputBuffer.numberOfChannels > 1
        ? ev.inputBuffer.getChannelData(1)
        : left
      const n = left.length
      for (let i = 0; i < n && this._recWritten < this._recTarget; i++) {
        this._recData[0][this._recWritten] = left[i]
        this._recData[1][this._recWritten] = right[i]
        this._recWritten++
      }
      if (this._recWritten >= this._recTarget) this.#finishRecord()
    }
    this.refreshGains()
    return true
  }

  stopRecord() {
    if (!this._recording) return
    this.#finishRecord()
  }

  #finishRecord() {
    if (!this._recording) return
    this._recording = false
    const t = this._recTrack
    const ctx = this.engine.ctx
    try {
      this._recProc?.disconnect()
      this._recBus?.disconnect(this._recProc)
      this._recSink?.disconnect()
    } catch (_) { /* ignore */ }
    this._recProc = null
    this._recSink = null
    this._recBus = null

    // Always keep the full track length (lengthBars). Early REC-off leaves silence
    // for the unwritten tail — never shrink the take.
    const len = Math.max(1, this._recTarget)
    const pass = ctx.createBuffer(2, len, ctx.sampleRate)
    pass.copyToChannel(this._recData[0], 0)
    pass.copyToChannel(this._recData[1], 1)
    t.undoBuffer = t.buffer
    if (this._recReplace || !t.buffer) {
      t.buffer = pass
    } else {
      const base = resizeBuffer(ctx, t.buffer, len)
      t.buffer = mixBuffers(ctx, base, pass)
      t.buffer = resizeBuffer(ctx, t.buffer, len)
    }
    this._recData = null
    this._recTrack = null
    this.refreshGains()
    const cb = this._onRecDone
    this._onRecDone = null
    cb?.(t)
  }

  undo(trackId) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t || !t.undoBuffer) return false
    const cur = t.buffer
    t.buffer = t.undoBuffer
    t.undoBuffer = cur
    if (this.transport.playing) this.startPlayback(this._playOrigin || this.engine.now())
    return true
  }

  clear(trackId) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t) return false
    t.undoBuffer = t.buffer
    t.buffer = null
    const src = this._sources.get(t.id)
    if (src) this.#stopTrack(t.id)
    this.refreshGains()
    return true
  }
}
