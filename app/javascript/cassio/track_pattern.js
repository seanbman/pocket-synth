import { SEQ_LENGTHS, defaultStep, sanitizeStep } from "cassio/store"

export const TRACK_PATTERN_KIND = "track-pattern-v2"

function validLength(length) {
  return SEQ_LENGTHS.includes(Number(length)) ? Number(length) : 16
}

function clonePatch(patch) {
  if (!patch || typeof patch !== "object") return null
  return structuredClone(patch)
}

export function normalizeTrackLaneSource(source = null) {
  if (!source || typeof source !== "object") {
    return {
      soundId: null,
      name: "EMPTY",
      level: 1,
      pan: 0,
      mode: "oneshot",
      patch: null,
      midi: null,
      fromPad: null
    }
  }
  const midi = Number(source.midi)
  const level = Number(source.level)
  const pan = Number(source.pan)
  const fromPad = Number(source.fromPad)
  return {
    soundId: source.soundId ? String(source.soundId) : null,
    name: String(source.name || source.soundId || "EMPTY").slice(0, 40),
    level: Number.isFinite(level) ? Math.min(1.5, Math.max(0, level)) : 1,
    pan: Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0,
    mode: source.mode === "gate" ? "gate" : "oneshot",
    patch: clonePatch(source.patch),
    midi: Number.isFinite(midi) ? midi : null,
    fromPad: Number.isFinite(fromPad) ? Math.min(6, Math.max(1, fromPad | 0)) : null
  }
}

export function newTrackPatternLaneId() {
  return `sq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultTrackPattern(length = 16) {
  return {
    kind: TRACK_PATTERN_KIND,
    length: validLength(length),
    swing: 0,
    gate: 0.5,
    laneIds: [],
    sources: [],
    lanes: []
  }
}

function sanitizeLane(steps, length) {
  const src = Array.isArray(steps) ? steps : []
  return Array.from({ length }, (_, i) => sanitizeStep(src[i] || defaultStep()))
}

/**
 * Track-owned patterns may contain any number of sound lanes. Legacy fixed
 * six-pad patterns are lifted by attaching the current pad-source snapshots.
 */
export function sanitizeTrackPattern(pattern, { padSources = [] } = {}) {
  const length = validLength(pattern?.length)
  const out = defaultTrackPattern(length)
  const swing = Number(pattern?.swing)
  const gate = Number(pattern?.gate)
  out.swing = Number.isFinite(swing) ? Math.min(1, Math.max(0, swing)) : 0
  out.gate = Number.isFinite(gate) ? Math.min(1, Math.max(0.05, gate)) : 0.5

  const rawLanes = Array.isArray(pattern?.lanes) ? pattern.lanes : []
  const rawSources = Array.isArray(pattern?.sources) ? pattern.sources : []
  const rawIds = Array.isArray(pattern?.laneIds) ? pattern.laneIds : []
  const count = Math.max(rawLanes.length, rawSources.length, rawIds.length)

  for (let i = 0; i < count; i++) {
    out.lanes.push(sanitizeLane(rawLanes[i], length))
    out.sources.push(normalizeTrackLaneSource(rawSources[i] || padSources[i] || null))
    out.laneIds.push(String(rawIds[i] || newTrackPatternLaneId()))
  }
  return out
}

export function cloneTrackPattern(pattern, options = {}) {
  const p = sanitizeTrackPattern(pattern, options)
  return {
    ...p,
    laneIds: [...p.laneIds],
    sources: p.sources.map((source) => normalizeTrackLaneSource(source)),
    lanes: p.lanes.map((lane) => lane.map((step) => ({ ...step })))
  }
}

export function trackPatternHasHits(pattern) {
  return Array.isArray(pattern?.lanes)
    && pattern.lanes.some((lane) => Array.isArray(lane) && lane.some((step) => step?.on))
}

export function trackSeqToTrackPattern(seq, source = null) {
  const length = validLength(seq?.length)
  const out = defaultTrackPattern(length)
  const swing = Number(seq?.swing)
  const gate = Number(seq?.gate)
  out.swing = Number.isFinite(swing) ? Math.min(1, Math.max(0, swing)) : 0
  out.gate = Number.isFinite(gate) ? Math.min(1, Math.max(0.05, gate)) : 0.5
  out.laneIds.push(newTrackPatternLaneId())
  out.sources.push(normalizeTrackLaneSource(source))
  out.lanes.push(sanitizeLane(seq?.steps, length))
  return out
}

export function addTrackPatternLane(pattern, source = null) {
  const p = sanitizeTrackPattern(pattern)
  p.laneIds.push(newTrackPatternLaneId())
  p.sources.push(normalizeTrackLaneSource(source))
  p.lanes.push(Array.from({ length: p.length }, defaultStep))
  return { pattern: p, index: p.lanes.length - 1 }
}

export function removeTrackPatternLane(pattern, index) {
  const p = sanitizeTrackPattern(pattern)
  const i = Math.min(p.lanes.length - 1, Math.max(0, Number(index) | 0))
  if (i < 0 || !p.lanes.length) return p
  p.laneIds.splice(i, 1)
  p.sources.splice(i, 1)
  p.lanes.splice(i, 1)
  return p
}

export function resizeTrackPattern(pattern, nextLength) {
  const p = sanitizeTrackPattern(pattern)
  const length = validLength(nextLength)
  p.lanes = p.lanes.map((lane) => {
    const src = lane.length ? lane : [defaultStep()]
    if (length <= lane.length) return lane.slice(0, length).map((step) => ({ ...step }))
    const out = lane.map((step) => ({ ...step }))
    while (out.length < length) out.push(sanitizeStep({ ...src[out.length % src.length] }))
    return out
  })
  p.length = length
  return p
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
}

export function trackLaneSourceSignature(source) {
  const s = normalizeTrackLaneSource(source)
  return JSON.stringify(stableObject({
    soundId: s.soundId,
    level: s.level,
    pan: s.pan,
    mode: s.mode,
    patch: s.patch,
    midi: s.midi
  }))
}
