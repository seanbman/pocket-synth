import { bufferToStored, storedToBuffer } from "cassio/audio/sample_io"
import { FxChain } from "cassio/audio/fx_chain"
import { sanitizeFx } from "cassio/audio/fx_params"
import {
  QUANTIZE_OPTS, sanitizeTrackSeq, defaultTrackSeq, sanitizePattern,
  defaultLibraryTrack, newTrackLibraryId, seqLengthBars, trackSeqHasHits,
  patternHasHits, trackSeqToPattern, sanitizeLaneDisplayName, nextLibraryTrackName
} from "cassio/store"

/** Presets for user-set loop / track lengths (OPTIONS + track menu). */
export const LOOP_LENGTH_PRESETS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

function snapLengthBars(n) {
  const v = Math.max(1, Math.round(Number(n) || 4))
  for (const b of LOOP_LENGTH_PRESETS) {
    if (b >= v) return b
  }
  return LOOP_LENGTH_PRESETS[LOOP_LENGTH_PRESETS.length - 1]
}

/** Runtime arrangement lane (may be empty). */
function emptyLane(id, lengthBars = 4) {
  return {
    id,
    assigned: false,
    libraryTrackId: null,
    dirty: false,
    name: "EMPTY",
    armed: false,
    mute: false,
    solo: false,
    monitor: true,
    mode: "overdub",
    level: 1,
    pan: 0,
    offsetSec: 0,
    lengthBars: snapLengthBars(lengthBars),
    padSlot: Math.min(6, Math.max(1, ((id - 1) % 6) + 1)),
    fx: sanitizeFx({}, "track"),
    buffer: null,
    undoBuffer: null,
    seq: defaultTrackSeq(),
    pattern: null
  }
}

function cloneSeq(seq) {
  const s = sanitizeTrackSeq(seq)
  return { ...s, steps: s.steps.map((st) => ({ ...st })) }
}

function clonePattern(p) {
  return p ? sanitizePattern(p) : null
}

function bakedPatternFrom(src) {
  if (src?.pattern) return sanitizePattern(src.pattern)
  if (trackSeqHasHits(src?.seq)) return trackSeqToPattern(src.seq, src.padSlot)
  return null
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
 * Arrangement looper: variable lanes + named track library.
 * Assigned lanes hold working copies (PCM and/or step seq).
 */
export class LoopEngine {
  constructor(engine, transport) {
    this.engine = engine
    this.transport = transport
    this.lengthBars = 4
    this.library = []
    this.tracks = [1, 2, 3, 4, 5, 6].map((n) => emptyLane(n, 4))
    this.selected = 1
    this._nextLaneId = 7
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

  get assignedTracks() {
    return this.tracks.filter((t) => t.assigned)
  }

  laneHasClip(t) {
    return !!t?.assigned && (!!t.buffer || patternHasHits(t.pattern) || trackSeqHasHits(t.seq))
  }

  ensureGraph() {
    if (!this.engine?.ready) return
    for (const t of this.tracks) {
      if (this._chains.has(t.id)) continue
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

  #disposeLaneChain(id) {
    this.#stopTrack(id)
    const chain = this._chains.get(id)
    if (chain) {
      try { chain.dispose?.() } catch (_) { /* ignore */ }
      this._chains.delete(id)
    }
  }

  applyState(loop) {
    if (!loop) return
    if (loop.lengthBars) this.lengthBars = snapLengthBars(loop.lengthBars)
    this.playDuringRec = ["all", "monitored", "off"].includes(loop.playDuringRec)
      ? loop.playDuringRec
      : "all"
    this.quantize = QUANTIZE_OPTS.includes(loop.quantize) ? loop.quantize : "1/16"

    if (Array.isArray(loop.trackLibrary) || loop.arrangement?.lanes) {
      this.#applyLibraryFormat(loop)
    } else if (Array.isArray(loop.tracks)) {
      this.#migrateLegacyTracks(loop)
    }

    if (loop.selected) this.selected = loop.selected
    else if (loop.arrangement?.selectedLaneId) this.selected = loop.arrangement.selectedLaneId
    if (!this.tracks.some((t) => t.id === this.selected)) {
      this.selected = this.tracks[0]?.id || 1
    }

    this.ensureGraph()
    for (const t of this.tracks) {
      this.#syncTrackMix(t)
      this.#applyTrackGain(t)
    }
  }

  #applyLibraryFormat(loop) {
    this.library = (loop.trackLibrary || []).map((src, i) => this.#hydrateLibraryEntry(src, i + 1))
    const lanes = loop.arrangement?.lanes
    if (Array.isArray(lanes) && lanes.length) {
      this.tracks = lanes.map((src) => this.#hydrateLane(src, loop.lengthBars))
      this._nextLaneId = Math.max(1, ...this.tracks.map((t) => t.id)) + 1
    } else {
      this.tracks = [emptyLane(1, this.lengthBars)]
      this._nextLaneId = 2
    }
  }

  #migrateLegacyTracks(loop) {
    this.library = []
    const lanes = []
    let nextId = 1
    for (const src of loop.tracks) {
      const pattern = bakedPatternFrom(src)
      const hasHits = patternHasHits(pattern) || trackSeqHasHits(src.seq)
      const hasAudio = !!src.audio
      const lane = emptyLane(src.id || nextId, snapLengthBars(src.lengthBars ?? loop.lengthBars ?? 4))
      nextId = Math.max(nextId, lane.id + 1)
      const displayName = sanitizeLaneDisplayName(src.name, src.id || lane.id)
      Object.assign(lane, {
        name: displayName,
        armed: !!src.armed,
        mute: !!src.mute,
        solo: !!src.solo,
        monitor: src.monitor !== false,
        mode: src.mode === "replace" ? "replace" : "overdub",
        level: src.level ?? src.fx?.level ?? 1,
        pan: src.pan ?? src.fx?.pan ?? 0,
        offsetSec: Number(src.offsetSec) || 0,
        fx: sanitizeFx(src.fx || {}, "track"),
        lengthBars: snapLengthBars(src.lengthBars ?? loop.lengthBars ?? lane.lengthBars),
        padSlot: Math.min(6, Math.max(1, src.id || 1)),
        seq: sanitizeTrackSeq(src.seq),
        pattern
      })
      if (src.audio && this.engine.ctx) {
        lane.buffer = storedToBuffer(this.engine.ctx, src.audio)
        lane._stored = src.audio
        lane._storedFor = lane.buffer
      }
      if (hasAudio || hasHits) {
        const lib = defaultLibraryTrack({
          name: displayName,
          lengthBars: lane.lengthBars,
          padSlot: lane.padSlot
        })
        lib.seq = cloneSeq(lane.seq)
        lib.pattern = clonePattern(lane.pattern)
        lib.level = lane.level
        lib.pan = lane.pan
        lib.fx = { ...lane.fx }
        lib.audio = src.audio || null
        this.library.push(lib)
        lane.assigned = true
        lane.libraryTrackId = lib.id
        lane.dirty = false
        if (lib.audio && this.engine.ctx && !lane.buffer) {
          lane.buffer = storedToBuffer(this.engine.ctx, lib.audio)
          lane._stored = lib.audio
          lane._storedFor = lane.buffer
        }
      } else {
        lane.assigned = false
        lane.name = "EMPTY"
        lane.libraryTrackId = null
        lane.pattern = null
      }
      lanes.push(lane)
    }
    this.tracks = lanes.length ? lanes : [emptyLane(1, this.lengthBars)]
    this._nextLaneId = Math.max(1, ...this.tracks.map((t) => t.id)) + 1
  }

  #hydrateLibraryEntry(src, fallbackN = 1) {
    const entry = defaultLibraryTrack({
      id: src.id || newTrackLibraryId(),
      name: sanitizeLaneDisplayName(src.name, fallbackN),
      lengthBars: snapLengthBars(src.lengthBars ?? 4),
      padSlot: src.padSlot
    })
    entry.level = src.level ?? 1
    entry.pan = src.pan ?? 0
    entry.fx = sanitizeFx(src.fx || {}, "track")
    entry.seq = sanitizeTrackSeq(src.seq)
    entry.pattern = bakedPatternFrom(src)
    entry.audio = src.audio || null
    entry.updatedAt = src.updatedAt || Date.now()
    return entry
  }

  #hydrateLane(src, defaultBars) {
    const lane = emptyLane(src.id || 1, snapLengthBars(src.lengthBars ?? defaultBars ?? 4))
    lane.assigned = !!src.assigned && !!src.libraryTrackId
    lane.libraryTrackId = src.libraryTrackId || null
    lane.dirty = !!src.dirty
    lane.name = lane.assigned ? sanitizeLaneDisplayName(src.name, src.id || 1) : "EMPTY"
    lane.armed = !!src.armed
    lane.mute = !!src.mute
    lane.solo = !!src.solo
    lane.monitor = src.monitor !== false
    lane.mode = src.mode === "replace" ? "replace" : "overdub"
    lane.level = src.level ?? src.fx?.level ?? 1
    lane.pan = src.pan ?? src.fx?.pan ?? 0
    lane.offsetSec = Number(src.offsetSec) || 0
    lane.fx = sanitizeFx(src.fx || {}, "track")
    lane.lengthBars = snapLengthBars(src.lengthBars ?? defaultBars ?? 4)
    lane.padSlot = Math.min(6, Math.max(1, src.padSlot || lane.padSlot))
    lane.seq = sanitizeTrackSeq(src.seq)
    lane.pattern = bakedPatternFrom(src)
    const audio = src.audio || src.working?.audio
    if (audio && this.engine.ctx) {
      lane.buffer = storedToBuffer(this.engine.ctx, audio)
      lane._stored = audio
      lane._storedFor = lane.buffer
    }
    if (!lane.assigned) {
      lane.libraryTrackId = null
      lane.dirty = false
      lane.name = "EMPTY"
      lane.buffer = null
      lane.pattern = null
    }
    return lane
  }

  serialize() {
    return {
      lengthBars: this.lengthBars,
      selected: this.selected,
      quantize: this.quantize,
      playDuringRec: this.playDuringRec,
      trackLibrary: this.library.map((e) => ({
        id: e.id,
        name: e.name,
        lengthBars: e.lengthBars,
        padSlot: e.padSlot,
        level: e.level,
        pan: e.pan,
        fx: { ...e.fx },
        seq: cloneSeq(e.seq),
        pattern: clonePattern(e.pattern),
        audio: e.audio || null,
        updatedAt: e.updatedAt || Date.now()
      })),
      arrangement: {
        selectedLaneId: this.selected,
        lanes: this.tracks.map((t) => ({
          id: t.id,
          assigned: !!t.assigned,
          libraryTrackId: t.libraryTrackId,
          dirty: !!t.dirty,
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
          padSlot: t.padSlot,
          fx: { ...t.fx },
          seq: cloneSeq(t.seq),
          pattern: clonePattern(t.pattern),
          audio: this.#storedAudio(t)
        }))
      },
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
        seq: cloneSeq(t.seq),
        pattern: clonePattern(t.pattern),
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
    const id = Number(n)
    if (this.tracks.some((t) => t.id === id)) this.selected = id
  }

  addLane() {
    const id = this._nextLaneId++
    const lane = emptyLane(id, this.lengthBars)
    this.tracks.push(lane)
    this.selected = id
    this.ensureGraph()
    return lane
  }

  removeLane(laneId = this.selected) {
    if (this.tracks.length <= 1) return false
    const idx = this.tracks.findIndex((t) => t.id === laneId)
    if (idx < 0) return false
    const [removed] = this.tracks.splice(idx, 1)
    this.#disposeLaneChain(removed.id)
    if (this.selected === removed.id) {
      this.selected = this.tracks[Math.min(idx, this.tracks.length - 1)].id
    }
    return true
  }

  createLibraryTrack({ name = null, lengthBars = null, padSlot = 1 } = {}) {
    const bars = snapLengthBars(lengthBars ?? this.lengthBars)
    const label = name
      ? sanitizeLaneDisplayName(name, this.library.length + 1)
      : nextLibraryTrackName(this.library)
    const entry = defaultLibraryTrack({ name: label, lengthBars: bars, padSlot })
    entry.seq = defaultTrackSeq(Math.min(64, Math.max(16, bars * 16)))
    entry.pattern = null
    this.library.push(entry)
    return entry
  }

  deleteLibraryTrack(libraryId) {
    const i = this.library.findIndex((e) => e.id === libraryId)
    if (i < 0) return false
    this.library.splice(i, 1)
    for (const lane of this.tracks) {
      if (lane.libraryTrackId === libraryId) this.clearLaneAssignment(lane.id, { force: true })
    }
    return true
  }

  /** Ensure selected lane has a library track so REC can arm (auto-create if empty). */
  ensureLaneForRecord({ name = null } = {}) {
    const lane = this.tracks.find((t) => t.id === this.selected) || this.tracks[0]
    if (!lane) return null
    if (lane.assigned) return lane
    const entry = this.createLibraryTrack({
      name: name || nextLibraryTrackName(this.library),
      lengthBars: this.lengthBars
    })
    this.assignLibraryToLane(lane.id, entry.id)
    this.select(lane.id)
    return this.tracks.find((t) => t.id === lane.id) || null
  }

  getLibraryTrack(libraryId) {
    return this.library.find((e) => e.id === libraryId) || null
  }

  /** Place a library track onto a lane as a working copy. */
  assignLibraryToLane(laneId, libraryId) {
    const lane = this.tracks.find((t) => t.id === laneId)
    const entry = this.getLibraryTrack(libraryId)
    if (!lane || !entry) return false
    this.#stopTrack(lane.id)
    lane.assigned = true
    lane.libraryTrackId = entry.id
    lane.dirty = false
    lane.name = entry.name
    lane.lengthBars = snapLengthBars(entry.lengthBars || seqLengthBars(entry.seq))
    lane.padSlot = entry.padSlot || lane.padSlot
    lane.level = entry.level ?? 1
    lane.pan = entry.pan ?? 0
    lane.fx = sanitizeFx(entry.fx || {}, "track")
    lane.seq = cloneSeq(entry.seq)
    lane.pattern = clonePattern(entry.pattern) || bakedPatternFrom(entry)
    lane.undoBuffer = null
    if (entry.audio && this.engine.ctx) {
      lane.buffer = storedToBuffer(this.engine.ctx, entry.audio)
      lane._stored = entry.audio
      lane._storedFor = lane.buffer
    } else {
      lane.buffer = null
      lane._stored = null
      lane._storedFor = null
    }
    this.#syncTrackMix(lane)
    this.#applyTrackGain(lane)
    return true
  }

  /**
   * Bake a working copy of Pattern A–D onto a lane.
   * Empty lanes get a new library track; clip length follows pattern unless PCM is longer.
   */
  dropPatternOnLane(laneId = this.selected, pattern, { letter = "A" } = {}) {
    const lane = this.tracks.find((t) => t.id === laneId)
    if (!lane) return null
    const baked = sanitizePattern(pattern)
    const patBars = seqLengthBars(baked)
    const wasAssigned = !!lane.assigned
    if (!wasAssigned) {
      const entry = this.createLibraryTrack({
        name: nextLibraryTrackName(this.library),
        lengthBars: patBars
      })
      this.assignLibraryToLane(lane.id, entry.id)
    }
    const target = this.tracks.find((t) => t.id === laneId)
    if (!target) return null
    target.pattern = baked
    const pcmBars = target.buffer ? target.lengthBars : 0
    target.lengthBars = snapLengthBars(Math.max(patBars, pcmBars, wasAssigned ? target.lengthBars : 0))
    target.dirty = true
    target.assigned = true
    return target
  }

  clearLaneAssignment(laneId = this.selected, { force = false } = {}) {
    const lane = this.tracks.find((t) => t.id === laneId)
    if (!lane) return false
    if (lane.dirty && !force) return false
    this.#stopTrack(lane.id)
    Object.assign(lane, emptyLane(lane.id, this.lengthBars))
    this.#syncTrackMix(lane)
    this.#applyTrackGain(lane)
    return true
  }

  markDirty(laneId = this.selected) {
    const lane = this.tracks.find((t) => t.id === laneId)
    if (lane?.assigned) lane.dirty = true
  }

  /** Save working copy back to its library entry (or create one). */
  saveLaneToLibrary(laneId = this.selected, { saveAs = false, name = null } = {}) {
    const lane = this.tracks.find((t) => t.id === laneId)
    if (!lane?.assigned) return null
    let entry = !saveAs && lane.libraryTrackId ? this.getLibraryTrack(lane.libraryTrackId) : null
    if (!entry) {
      entry = defaultLibraryTrack({
        name: name || lane.name || "TRACK",
        lengthBars: lane.lengthBars,
        padSlot: lane.padSlot
      })
      this.library.push(entry)
      lane.libraryTrackId = entry.id
    }
    if (name) entry.name = String(name).slice(0, 18)
    else entry.name = lane.name
    entry.lengthBars = lane.lengthBars
    entry.padSlot = lane.padSlot
    entry.level = lane.level
    entry.pan = lane.pan
    entry.fx = { ...lane.fx }
    entry.seq = cloneSeq(lane.seq)
    entry.pattern = clonePattern(lane.pattern)
    entry.audio = this.#storedAudio(lane)
    entry.updatedAt = Date.now()
    lane.name = entry.name
    lane.dirty = false
    return entry
  }

  armSelected() {
    const t = this.selectedTrack
    if (!t?.assigned) return false
    const next = !t.armed
    for (const x of this.tracks) x.armed = false
    t.armed = next
    return t.armed
  }

  /** Exclusive arm for REC — selected track is the capture target. */
  armForRecord(trackId = this.selected) {
    const t = this.tracks.find((x) => x.id === trackId) || this.selectedTrack
    if (!t?.assigned) return null
    for (const x of this.tracks) x.armed = false
    t.armed = true
    this.select(t.id)
    return t
  }

  /**
   * Active song length: default loop bars, extended when assigned clips
   * end past that window.
   */
  timelineBars() {
    const defaultBars = this.lengthBars
    const defaultSec = this.transport.loopSec(defaultBars)
    const barSec = this.transport.barSec()
    let maxEndSec = 0
    for (const t of this.tracks) {
      if (!t.assigned) continue
      const lenSec = this.trackLoopSec(t)
      maxEndSec = Math.max(maxEndSec, (t.offsetSec ?? 0) + lenSec)
    }
    if (maxEndSec <= defaultSec + 0.001) return defaultBars
    const needed = Math.ceil((maxEndSec - 0.001) / barSec)
    return Math.max(defaultBars, needed)
  }

  timelineSec() {
    return this.transport.loopSec(this.timelineBars())
  }

  setLengthBars(n) {
    this.lengthBars = snapLengthBars(n)
  }

  setTrackLengthBars(trackId, n) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned) return this.lengthBars
    const bars = snapLengthBars(n)
    if (t.lengthBars === bars) return bars
    t.lengthBars = bars
    t.dirty = true
    if (t.buffer && this.engine?.ctx) {
      const samples = Math.max(1, Math.floor(this.transport.loopSec(bars) * this.engine.ctx.sampleRate))
      t.buffer = resizeBuffer(this.engine.ctx, t.buffer, samples)
      if (this.transport.playing) {
        this.#startTrack(t, this.engine.ctx.currentTime)
      }
    } else if (this.transport.playing) {
      this.#applyTrackGain(t)
    }
    return bars
  }

  applyDefaultLengthToEmpty(n) {
    const bars = snapLengthBars(n)
    this.lengthBars = bars
    for (const t of this.tracks) {
      // Only empty (unassigned) lanes follow song default — assigned clips keep their own length.
      if (!t.assigned) t.lengthBars = bars
    }
    return bars
  }

  #anySolo() {
    return this.tracks.some((t) => t.assigned && t.solo)
  }

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
    if (!t?.assigned) return
    t.level = level
    t.dirty = true
    this.#syncTrackMix(t)
    this.#applyTrackGain(t)
  }

  setTrackPan(trackId, pan) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned) return
    t.pan = pan
    t.dirty = true
    this.#syncTrackMix(t)
    this.#applyTrackGain(t)
  }

  masterLoopSec() {
    return this.timelineSec()
  }

  trackLoopSec(t) {
    return this.transport.loopSec(t.lengthBars || this.lengthBars)
  }

  /**
   * Local time within the lane's pink-clip window on the song timeline.
   * null when playhead is outside [offset, offset+length) for this cycle —
   * shortening/lengthening lengthBars changes both the clip and this window.
   */
  clipLocalSec(t, atTime = this.engine?.ctx?.currentTime, playOrigin = this._playOrigin) {
    if (!t?.assigned) return null
    const masterLoop = this.masterLoopSec()
    const trackLoop = this.trackLoopSec(t)
    if (!(masterLoop > 0) || !(trackLoop > 0)) return null
    const origin = playOrigin ?? this._playOrigin ?? 0
    const offset = (((Number(t.offsetSec) || 0) % masterLoop) + masterLoop) % masterLoop
    const elapsed = Math.max(0, (atTime ?? origin) - origin)
    const masterPhase = elapsed % masterLoop
    const local = (masterPhase - offset + masterLoop) % masterLoop
    if (local >= trackLoop - 1e-4) return null
    return { local, trackLoop, masterLoop, offset }
  }

  #trackBufferPhase(t, atTime) {
    const clip = this.clipLocalSec(t, atTime)
    if (!clip || !t.buffer) return 0
    const bufDur = Math.min(t.buffer.duration, clip.trackLoop)
    if (!(bufDur > 0)) return 0
    const phase = clip.local % bufDur
    return Math.min(Math.max(0, phase), Math.max(0, bufDur - 0.001))
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

  #startTrack(t, when) {
    if (!t.assigned || !t.buffer || !this.engine?.ready) return
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

  /** Automate lane gain so PCM is silent outside the pink clip on the song timeline. */
  #armClipGainAutomation(t, baseAudible) {
    const chain = this._chains.get(t.id)
    if (!chain || !this.engine?.ctx) return
    const g = chain.input.gain
    const ctx = this.engine.ctx
    const now = ctx.currentTime
    g.cancelScheduledValues(now)

    if (!baseAudible) {
      g.setValueAtTime(0, now)
      return
    }
    if (!this.transport?.playing || this._playOrigin == null) {
      g.setValueAtTime(1, now)
      return
    }

    const master = this.masterLoopSec()
    const len = this.trackLoopSec(t)
    const origin = this._playOrigin
    const offset = master > 0
      ? (((Number(t.offsetSec) || 0) % master) + master) % master
      : 0
    if (!(master > 0) || !(len > 0)) {
      g.setValueAtTime(0, now)
      return
    }

    g.setValueAtTime(this.clipLocalSec(t, now) ? 1 : 0, now)
    const horizon = now + 16
    let k = Math.floor((now - origin - offset) / master) - 1
    for (let n = 0; n < 64; n++, k++) {
      const onAt = origin + offset + k * master
      const offAt = onAt + len
      if (offAt < now) continue
      if (onAt > horizon) break
      if (onAt >= now) g.setValueAtTime(1, onAt)
      if (offAt <= horizon) g.setValueAtTime(0, Math.max(offAt, now))
    }
  }

  setTrackOffset(trackId, offsetSec) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned) return 0
    t.offsetSec = Math.max(0, Math.round(offsetSec))
    if (this.transport?.playing && t.buffer) {
      this.#startTrack(t, this.engine.ctx.currentTime)
    }
    return t.offsetSec
  }

  nudgeTrackOffset(trackId, deltaSec) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned) return 0
    return this.setTrackOffset(trackId, (t.offsetSec ?? 0) + deltaSec)
  }

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
    if (!t.assigned) {
      chain.input.gain.cancelScheduledValues(this.engine.ctx.currentTime)
      chain.input.gain.setValueAtTime(0, this.engine.ctx.currentTime)
      chain.setActive(0)
      return
    }
    const { level, pan } = this.#syncTrackMix(t)
    const solo = this.#anySolo()
    let audible = solo ? t.solo && !t.mute : !t.mute
    if (this._recording && !this.#audibleWhileRecording(t)) audible = false
    if (this._recording && !audible) {
      chain.input.gain.cancelScheduledValues(this.engine.ctx.currentTime)
      chain.input.gain.setValueAtTime(0, this.engine.ctx.currentTime)
    } else {
      this.#armClipGainAutomation(t, audible)
    }
    chain.apply({ ...t.fx, level, pan })
    chain.setActive(audible && this.transport?.playing && t.buffer ? 1 : 0)
  }

  setTrackFx(trackId, key, value) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned) return
    if (key === "level") t.level = value
    else if (key === "pan") t.pan = value
    t.fx = sanitizeFx({ ...t.fx, [key]: value }, "track")
    t.dirty = true
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

  startPlayback(originTime) {
    this.ensureGraph()
    this.stopPlayback()
    if (!this.engine?.ready) return
    const ctx = this.engine.ctx
    const t0 = originTime ?? ctx.currentTime
    this._playOrigin = t0
    for (const t of this.tracks) {
      if (t.assigned && t.buffer) this.#startTrack(t, t0)
    }
    this.refreshGains()
  }

  hasAnyAudio() {
    return this.tracks.some((t) => t.assigned && !!t.buffer)
  }

  get recording() {
    return this._recording
  }

  beginRecord(trackId, { replace = false, startTime = null, onDone = null } = {}) {
    if (!this.engine?.ready) return false
    if (this._recording) this.stopRecord()
    const t = this.tracks.find((x) => x.id === trackId)
    if (!t?.assigned) return false
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
    t.dirty = true
    this._recData = null
    this._recTrack = null
    this.refreshGains()
    const cb = this._onRecDone
    this._onRecDone = null
    cb?.(t)
  }

  undo(trackId) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned || !t.undoBuffer) return false
    const cur = t.buffer
    t.buffer = t.undoBuffer
    t.undoBuffer = cur
    t.dirty = true
    if (this.transport.playing) this.startPlayback(this._playOrigin || this.engine.now())
    return true
  }

  clear(trackId) {
    const t = this.tracks.find((x) => x.id === (trackId || this.selected))
    if (!t?.assigned) return false
    t.undoBuffer = t.buffer
    t.buffer = null
    t.dirty = true
    if (this._sources.get(t.id)) this.#stopTrack(t.id)
    this.refreshGains()
    return true
  }
}
