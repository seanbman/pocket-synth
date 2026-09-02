const DB_NAME = "cassio-v1"
const DB_VERSION = 2
const RECOVERY = "recovery"
const USER_SOUNDS = "userSounds"
const FAVORITES = "favorites"
const RECOVERY_KEY = "last-project"

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(RECOVERY)) db.createObjectStore(RECOVERY)
      if (!db.objectStoreNames.contains(USER_SOUNDS)) db.createObjectStore(USER_SOUNDS, { keyPath: "id" })
      if (!db.objectStoreNames.contains(FAVORITES)) db.createObjectStore(FAVORITES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadRecovery() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RECOVERY, "readonly")
      const req = tx.objectStore(RECOVERY).get(RECOVERY_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function saveRecovery(state) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RECOVERY, "readwrite")
      tx.objectStore(RECOVERY).put({ ...state, updatedAt: Date.now() }, RECOVERY_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    // #region agent log
    const body = JSON.stringify({
      sessionId: "397b28",
      runId: "crash-1",
      hypothesisId: "B",
      location: "store.js:saveRecovery",
      message: "saveRecovery failed",
      data: { name: e?.name, message: String(e?.message || e) },
      timestamp: Date.now()
    })
    fetch("http://127.0.0.1:7775/ingest/fa1177f6-1e5b-449a-b03a-5969bd555f1e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "397b28" },
      body
    }).catch(() => {})
    fetch("/debug_ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {})
    // #endregion
  }
}

export async function listUserSounds() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(USER_SOUNDS, "readonly")
      const req = tx.objectStore(USER_SOUNDS).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function getUserSound(id) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(USER_SOUNDS, "readonly")
      const req = tx.objectStore(USER_SOUNDS).get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function putUserSound(sound) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(USER_SOUNDS, "readwrite")
      tx.objectStore(USER_SOUNDS).put(sound)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return sound
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7775/ingest/fa1177f6-1e5b-449a-b03a-5969bd555f1e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "397b28" },
      body: JSON.stringify({
        sessionId: "397b28",
        runId: "crash-1",
        hypothesisId: "C",
        location: "store.js:putUserSound",
        message: "putUserSound failed",
        data: {
          name: e?.name,
          message: String(e?.message || e),
          soundId: sound?.id,
          hasAudio: !!sound?.audio
        },
        timestamp: Date.now()
      })
    }).catch(() => {})
    fetch("/debug_ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "397b28",
        runId: "crash-1",
        hypothesisId: "C",
        location: "store.js:putUserSound",
        message: "putUserSound failed",
        data: {
          name: e?.name,
          message: String(e?.message || e),
          soundId: sound?.id,
          hasAudio: !!sound?.audio
        },
        timestamp: Date.now()
      }),
      keepalive: true
    }).catch(() => {})
    // #endregion
    throw e
  }
}

export async function deleteUserSound(id) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(USER_SOUNDS, "readwrite")
    tx.objectStore(USER_SOUNDS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadFavorites() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FAVORITES, "readonly")
      const req = tx.objectStore(FAVORITES).get("ids")
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function saveFavorites(ids) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FAVORITES, "readwrite")
      tx.objectStore(FAVORITES).put(ids, "ids")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* ignore */
  }
}

export function defaultPads() {
  return [
    { pad: 1, soundId: "kick-01", level: 1, pan: 0, mode: "oneshot" },
    { pad: 2, soundId: "clap-01", level: 1, pan: 0, mode: "oneshot" },
    { pad: 3, soundId: "snare-01", level: 1, pan: 0, mode: "oneshot" },
    { pad: 4, soundId: "tom-01", level: 1, pan: 0, mode: "oneshot" },
    { pad: 5, soundId: "hat-01", level: 1, pan: 0, mode: "oneshot" },
    { pad: 6, soundId: "openhat-01", level: 1, pan: 0, mode: "oneshot" }
  ]
}

export function defaultProject() {
  return {
    bpm: 120,
    soundId: "glass-poly",
    octave: 0,
    hold: false,
    masterVolume: 0.7,
    brightness: 0.68,
    resonance: 0.34,
    attack: 0.018,
    release: 0.48,
    bassDb: 0,
    trebleDb: 0,
    space: 0.24,
    delay: 0,
    root: "C3",
    padBank: "KIT TIGHT",
    kitVolume: 1,
    pads: defaultPads(),
    loop: defaultLoop(),
    seq: defaultSeq()
  }
}

export const SEQ_PATTERNS = ["A", "B", "C", "D"]
export const SEQ_LENGTHS = [16, 32, 64]
export const SEQ_LANES = 6

export function defaultStep() {
  return { on: false, vel: 0.85, accent: false, tie: false, shift: 0, gate: null }
}

export function defaultPattern(length = 16) {
  return {
    length,
    swing: 0,
    gate: 0.5,
    lanes: Array.from({ length: SEQ_LANES }, () => Array.from({ length }, defaultStep))
  }
}

/** Single-track step pattern (one sound per loop track). */
export function defaultTrackSeq(length = 16) {
  return {
    enabled: true,
    length: SEQ_LENGTHS.includes(length) ? length : 16,
    swing: 0,
    gate: 0.5,
    steps: Array.from({ length: SEQ_LENGTHS.includes(length) ? length : 16 }, defaultStep)
  }
}

export function sanitizeTrackSeq(seq) {
  const length = SEQ_LENGTHS.includes(seq?.length) ? seq.length : 16
  const out = defaultTrackSeq(length)
  out.enabled = seq?.enabled !== false
  out.swing = clamp01(seq?.swing, 0)
  out.gate = clamp01(seq?.gate, 0.5)
  const steps = Array.isArray(seq?.steps) ? seq.steps : []
  for (let i = 0; i < length; i++) out.steps[i] = sanitizeStep(steps[i])
  return out
}

/** Step sequencer state: four patterns (A–D), six lanes = pads 1–6. */
export function defaultSeq() {
  const patterns = {}
  for (const k of SEQ_PATTERNS) patterns[k] = defaultPattern(16)
  return { current: "A", patterns }
}

const clamp01 = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d }

export function sanitizeStep(s) {
  const d = defaultStep()
  if (!s || typeof s !== "object") return d
  const shift = Number(s.shift)
  const gate = s.gate == null ? null : clamp01(s.gate, 0.5)
  return {
    on: !!s.on,
    vel: clamp01(s.vel, d.vel),
    accent: !!s.accent,
    tie: !!s.tie,
    shift: Number.isFinite(shift) ? Math.min(0.5, Math.max(-0.5, shift)) : 0,
    gate
  }
}

export function sanitizePattern(p) {
  const length = SEQ_LENGTHS.includes(p?.length) ? p.length : 16
  const out = defaultPattern(length)
  out.swing = clamp01(p?.swing, 0)
  out.gate = clamp01(p?.gate, 0.5)
  for (let l = 0; l < SEQ_LANES; l++) {
    const lane = Array.isArray(p?.lanes?.[l]) ? p.lanes[l] : []
    for (let i = 0; i < length; i++) out.lanes[l][i] = sanitizeStep(lane[i])
  }
  return out
}

export function sanitizeSeq(seq) {
  const out = defaultSeq()
  if (!seq || typeof seq !== "object") return out
  out.current = SEQ_PATTERNS.includes(seq.current) ? seq.current : "A"
  for (const k of SEQ_PATTERNS) out.patterns[k] = sanitizePattern(seq.patterns?.[k])
  return out
}

export const QUANTIZE_OPTS = ["off", "1/4", "1/8", "1/16"]

export const QUANTIZE_LABELS = {
  off: "OFF",
  "1/4": "1/4",
  "1/8": "1/8",
  "1/16": "1/16"
}

/** Seconds per quantize grid cell; 0 when off. */
export function quantizeGridSec(bpm, quantize) {
  if (!quantize || quantize === "off") return 0
  const beat = 60 / Math.max(40, Math.min(240, bpm))
  if (quantize === "1/4") return beat
  if (quantize === "1/8") return beat / 2
  if (quantize === "1/16") return beat / 4
  return 0
}

export function defaultLoop() {
  return {
    lengthBars: 4,
    countInBars: 1,
    quantize: "1/16",
    playDuringRec: "all",
    metroOn: true,
    metroLevel: 0.7,
    metroAccent: true,
    selected: 1,
    tracks: [1, 2, 3, 4, 5, 6].map((n) => ({
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
      lengthBars: 4,
      audio: null,
      seq: defaultTrackSeq()
    }))
  }
}
