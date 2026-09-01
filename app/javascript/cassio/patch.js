/** Shared sound patch helpers for Milestone B. */

export const ROOTS = [
  "C1", "C#1", "D1", "D#1", "E1", "F1", "F#1", "G1", "G#1", "A1", "A#1", "B1",
  "C2", "C#2", "D2", "D#2", "E2", "F2", "F#2", "G2", "G#2", "A2", "A#2", "B2",
  "C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3", "G#3", "A3", "A#3", "B3",
  "C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4",
  "C5", "C#5", "D5", "D#5", "E5", "F5", "F#5", "G5", "G#5", "A5", "A#5", "B5"
]

export function defaultPatch() {
  return {
    root: "C3",
    brightness: 0.68,
    resonance: 0.34,
    attack: 0.018,
    release: 0.48,
    bassDb: 0,
    trebleDb: 0,
    reverb: 0.24,
    delay: 0
  }
}

function compact(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export function sanitizePatch(patch) {
  const d = defaultPatch()
  const p = { ...d, ...compact(patch) }
  const num = (v, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  p.root = ROOTS.includes(p.root) ? p.root : d.root
  p.brightness = Math.min(1, Math.max(0.05, num(p.brightness, d.brightness)))
  p.resonance = Math.min(1, Math.max(0, num(p.resonance, d.resonance)))
  p.attack = Math.min(1.2, Math.max(0.005, num(p.attack, d.attack)))
  p.release = Math.min(2.5, Math.max(0.02, num(p.release, d.release)))
  p.bassDb = Math.min(12, Math.max(-12, num(p.bassDb, d.bassDb)))
  p.trebleDb = Math.min(12, Math.max(-12, num(p.trebleDb, d.trebleDb)))
  p.reverb = Math.min(1, Math.max(0, num(p.reverb, d.reverb)))
  p.delay = Math.min(1, Math.max(0, num(p.delay, d.delay)))
  return p
}

export function patchFromSound(sound, overrides = {}) {
  const base = defaultPatch()
  if (!sound) return sanitizePatch({ ...base, ...compact(overrides) })
  const macros = sound.macros || {}
  if (sound.root) base.root = sound.root
  if (macros.m1?.default != null) base.brightness = macros.m1.default
  if (macros.m2?.default != null) base.reverb = macros.m2.default
  if (sound.patch) Object.assign(base, compact(sound.patch))
  return sanitizePatch({ ...base, ...compact(overrides) })
}

export function nudgeRoot(root, delta) {
  const i = ROOTS.indexOf(root)
  const idx = i < 0 ? ROOTS.indexOf("C3") : i
  const next = Math.min(ROOTS.length - 1, Math.max(0, idx + delta))
  return ROOTS[next]
}

export function meterPct(v01) {
  const n = Number(v01)
  const v = Number.isFinite(n) ? n : 0
  return `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`
}

export function dbLabel(db) {
  const n = Math.round(Number(db) || 0)
  return n > 0 ? `+${n} dB` : `${n} dB`
}

export function isUserSound(sound) {
  if (!sound) return false
  return sound.source === "user" || String(sound.id || "").startsWith("user-")
}
