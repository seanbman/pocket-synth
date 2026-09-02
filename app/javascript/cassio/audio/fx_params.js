/**
 * Shared sample / track processing parameter registry.
 * One flat, ordered list; LEVEL is always row 0 so it never fights M3 (master).
 * Knobs follow the cursor: M1 = selected row, M2 = next, M3 = next-next.
 *
 * scope: "s" sample-only, "t" track-only, "st" both.
 * type:  num | enum | bool | action
 */

const pct = (v) => `${Math.round(v * 100)}%`
const pct2 = (v) => `${Math.round(v * 200) / 2}%`
const db = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}dB`
const st = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}st`
const ct = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}c`
const sec = (v) => `${Math.round(v * 1000)}ms`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)
const x = (v) => `${v.toFixed(2)}x`
const pan = (v) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)
const bipct = (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`

export const CHARACTERS = [
  "off", "cassette", "radio", "telephone", "broken", "dusty", "warm", "crunch", "dirty", "old",
  "cheap", "dream", "space", "underwater", "distant", "haunted", "melt", "destroy", "game",
  "ghost", "machine", "robot"
]

export const FX_GROUPS = [
  {
    id: "mix", label: "MIX", params: [
      { key: "level", label: "LEVEL", type: "num", min: 0, max: 1.5, def: 1, fmt: pct, scope: "st" },
      { key: "pan", label: "PAN", type: "num", min: -1, max: 1, def: 0, fmt: pan, scope: "st" },
      { key: "gain", label: "GAIN", type: "num", min: 0.15, max: 2.5, def: 1.5, fmt: pct, scope: "st" }
    ]
  },
  {
    id: "sample", label: "SAMPLE", params: [
      { key: "trimStart", label: "START", type: "num", min: 0, max: 0.99, def: 0, fmt: pct, scope: "s" },
      { key: "trimEnd", label: "END", type: "num", min: 0.01, max: 1, def: 1, fmt: pct, scope: "s" },
      { key: "trimAction", label: "TRIM → CROP", type: "action", scope: "s" },
      { key: "fadeIn", label: "FADE IN", type: "num", min: 0, max: 2, def: 0, fmt: sec, scope: "s" },
      { key: "fadeOut", label: "FADE OUT", type: "num", min: 0, max: 2, def: 0, fmt: sec, scope: "s" },
      { key: "normalizeAction", label: "NORMALIZE", type: "action", scope: "s" },
      { key: "reverse", label: "REVERSE", type: "bool", def: false, scope: "s" },
      { key: "speed", label: "SPEED", type: "num", min: 0.25, max: 4, def: 1, fmt: x, log: true, scope: "s" },
      { key: "padMode", label: "TRIGGER", type: "enum", opts: ["oneshot", "gate"], def: "oneshot", scope: "s" },
      { key: "voices", label: "VOICES", type: "enum", opts: ["poly", "mono"], def: "poly", scope: "s" },
      { key: "retrigger", label: "RETRIGGER", type: "bool", def: true, scope: "s" },
      { key: "choke", label: "CHOKE GRP", type: "num", min: 0, max: 4, def: 0, step: 1, fmt: (v) => (v ? `G${v}` : "OFF"), scope: "s" }
    ]
  },
  {
    id: "pitch", label: "PITCH", params: [
      { key: "root", label: "ROOT NOTE", type: "note", def: "C3", scope: "s" },
      { key: "tuneSemis", label: "TRANSPOSE", type: "num", min: -24, max: 24, def: 0, step: 1, fmt: st, scope: "s" },
      { key: "fine", label: "FINE", type: "num", min: -100, max: 100, def: 0, step: 1, fmt: ct, scope: "s" },
      { key: "octave", label: "OCTAVE", type: "num", min: -3, max: 3, def: 0, step: 1, fmt: (v) => `${v > 0 ? "+" : ""}${v}`, scope: "s" },
      { key: "detune", label: "DETUNE", type: "num", min: 0, max: 50, def: 0, step: 1, fmt: ct, scope: "s" }
    ]
  },
  {
    id: "loop", label: "LOOP", params: [
      { key: "loopOn", label: "LOOP", type: "bool", def: false, scope: "s" },
      { key: "loopStart", label: "LOOP START", type: "num", min: 0, max: 0.99, def: 0, fmt: pct, scope: "s" },
      { key: "loopEnd", label: "LOOP END", type: "num", min: 0.01, max: 1, def: 1, fmt: pct, scope: "s" },
      { key: "loopMode", label: "DIRECTION", type: "enum", opts: ["fwd", "rev", "pingpong"], def: "fwd", scope: "s" },
      { key: "loopXfade", label: "CROSSFADE", type: "num", min: 0, max: 0.25, def: 0, fmt: sec, scope: "s" }
    ]
  },
  {
    id: "env", label: "AMP ENV", params: [
      { key: "ampAttack", label: "ATTACK", type: "num", min: 0, max: 2, def: 0, fmt: sec, scope: "s" },
      { key: "ampDecay", label: "DECAY", type: "num", min: 0, max: 3, def: 0, fmt: sec, scope: "s" },
      { key: "ampSustain", label: "SUSTAIN", type: "num", min: 0, max: 1, def: 1, fmt: pct, scope: "s" },
      { key: "ampRelease", label: "RELEASE", type: "num", min: 0.01, max: 4, def: 0.04, fmt: sec, scope: "s" }
    ]
  },
  {
    id: "eq", label: "TONE / EQ", params: [
      { key: "bassDb", label: "BASS", type: "num", min: -12, max: 12, def: 0, step: 1, fmt: db, scope: "st" },
      { key: "midDb", label: "MID", type: "num", min: -12, max: 12, def: 0, step: 1, fmt: db, scope: "st" },
      { key: "midFreq", label: "MID FREQ", type: "num", min: 200, max: 5000, def: 1000, fmt: hz, log: true, scope: "st" },
      { key: "trebleDb", label: "TREBLE", type: "num", min: -12, max: 12, def: 0, step: 1, fmt: db, scope: "st" },
      { key: "tilt", label: "TONE TILT", type: "num", min: -1, max: 1, def: 0, fmt: bipct, scope: "st" }
    ]
  },
  {
    id: "filter", label: "FILTER", params: [
      { key: "filterType", label: "FILTER", type: "enum", opts: ["off", "lp", "hp", "bp"], def: "off", scope: "st" },
      { key: "cutoff", label: "CUTOFF", type: "num", min: 40, max: 18000, def: 8000, fmt: hz, log: true, scope: "st" },
      { key: "resonance", label: "RESONANCE", type: "num", min: 0, max: 1, def: 0.1, fmt: pct, scope: "st" },
      { key: "filterDrive", label: "FILT DRIVE", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" }
    ]
  },
  {
    id: "sat", label: "SATURATION", params: [
      { key: "satType", label: "SAT TYPE", type: "enum", opts: ["off", "saturate", "overdrive", "distort", "softclip", "hardclip", "fuzz", "tape"], def: "off", scope: "st" },
      { key: "drive", label: "DRIVE", type: "num", min: 0, max: 1, def: 0.3, fmt: pct, scope: "st" }
    ]
  },
  {
    id: "lofi", label: "LO-FI", params: [
      { key: "bits", label: "BITS", type: "num", min: 3, max: 16, def: 16, step: 1, fmt: (v) => (v >= 16 ? "OFF" : `${v}-BIT`), scope: "st" },
      { key: "downsample", label: "DOWNSAMPLE", type: "num", min: 1, max: 40, def: 1, step: 1, fmt: (v) => (v <= 1 ? "OFF" : `÷${v}`), scope: "st" },
      { key: "alias", label: "ALIASING", type: "bool", def: true, scope: "st" },
      { key: "lofiPreset", label: "LO-FI PRESET", type: "enum", opts: ["custom", "8bit", "12bit", "crunch"], def: "custom", scope: "st" }
    ]
  },
  {
    id: "tape", label: "TAPE / ANALOG", params: [
      { key: "wow", label: "WOW", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "flutter", label: "FLUTTER", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "hiss", label: "HISS", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "dropout", label: "DROPOUT", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "age", label: "AGE", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "temp", label: "COLD ◀▶ WARM", type: "num", min: -1, max: 1, def: 0, fmt: bipct, scope: "st" }
    ]
  },
  {
    id: "vinyl", label: "VINYL / NOISE", params: [
      { key: "dust", label: "DUST", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "crackle", label: "CRACKLE", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "hum", label: "HUM", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "staticNoise", label: "STATIC", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "noiseColor", label: "NOISE", type: "enum", opts: ["white", "pink"], def: "pink", scope: "st" }
    ]
  },
  {
    id: "device", label: "DEVICE", params: [
      { key: "device", label: "DEVICE", type: "enum", opts: ["off", "radio", "telephone", "tiny", "broken", "megaphone"], def: "off", scope: "st" },
      { key: "deviceAmt", label: "AMOUNT", type: "num", min: 0, max: 1, def: 0.7, fmt: pct, scope: "st" }
    ]
  },
  {
    id: "reverb", label: "REVERB", params: [
      { key: "reverb", label: "REVERB MIX", type: "num", min: 0, max: 1, def: 0.2, fmt: pct, scope: "st" },
      { key: "revType", label: "REVERB TYPE", type: "enum", opts: ["room", "hall", "plate", "spring", "tiny", "huge"], def: "room", scope: "st" },
      { key: "revSize", label: "SIZE", type: "num", min: 0.3, max: 2, def: 1, fmt: x, scope: "st" },
      { key: "revDecay", label: "DECAY", type: "num", min: 0.2, max: 1.5, def: 1, fmt: x, scope: "st" },
      { key: "revTone", label: "REV TONE", type: "num", min: -1, max: 1, def: 0, fmt: bipct, scope: "st" }
    ]
  },
  {
    id: "delay", label: "DELAY", params: [
      { key: "delay", label: "DELAY MIX", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "delMode", label: "TIME MODE", type: "enum", opts: ["free", "1/4", "1/8", "1/16", "trip", "slap"], def: "1/8", scope: "st" },
      { key: "delTime", label: "FREE TIME", type: "num", min: 0.02, max: 1.5, def: 0.3, fmt: sec, log: true, scope: "st" },
      { key: "delFeedback", label: "FEEDBACK", type: "num", min: 0, max: 0.95, def: 0.35, fmt: pct, scope: "st" },
      { key: "delPingPong", label: "PING-PONG", type: "bool", def: false, scope: "st" },
      { key: "delFlavor", label: "FLAVOR", type: "enum", opts: ["clean", "lofi", "tape"], def: "clean", scope: "st" }
    ]
  },
  {
    id: "mod", label: "MODULATION", params: [
      { key: "chorusDepth", label: "CHORUS", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "chorusRate", label: "CHORUS RATE", type: "num", min: 0.05, max: 8, def: 0.8, fmt: (v) => `${v.toFixed(2)}Hz`, log: true, scope: "st" },
      { key: "vibDepth", label: "VIBRATO", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "s" },
      { key: "vibRate", label: "VIB RATE", type: "num", min: 0.1, max: 12, def: 5, fmt: (v) => `${v.toFixed(1)}Hz`, log: true, scope: "s" },
      { key: "flangDepth", label: "FLANGER", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "flangRate", label: "FLANG RATE", type: "num", min: 0.05, max: 5, def: 0.3, fmt: (v) => `${v.toFixed(2)}Hz`, log: true, scope: "st" },
      { key: "flangFb", label: "FLANG FEEDBK", type: "num", min: 0, max: 0.9, def: 0.4, fmt: pct, scope: "st" },
      { key: "phaserDepth", label: "PHASER", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "phaserRate", label: "PHASE RATE", type: "num", min: 0.05, max: 5, def: 0.4, fmt: (v) => `${v.toFixed(2)}Hz`, log: true, scope: "st" }
    ]
  },
  {
    id: "ampmod", label: "AMP MOD", params: [
      { key: "tremDepth", label: "TREMOLO", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "tremRate", label: "TREM RATE", type: "num", min: 0.1, max: 20, def: 5, fmt: (v) => `${v.toFixed(1)}Hz`, log: true, scope: "st" },
      { key: "apanDepth", label: "AUTO-PAN", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "apanRate", label: "PAN RATE", type: "num", min: 0.05, max: 10, def: 0.5, fmt: (v) => `${v.toFixed(2)}Hz`, log: true, scope: "st" }
    ]
  },
  {
    id: "dyn", label: "DYNAMICS", params: [
      { key: "comp", label: "COMPRESS", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "punch", label: "PUNCH", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "squash", label: "SQUASH", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "soften", label: "SOFTEN", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" },
      { key: "limiter", label: "LIMITER", type: "bool", def: false, scope: "st" }
    ]
  },
  {
    id: "stereo", label: "STEREO", params: [
      { key: "width", label: "WIDTH", type: "num", min: 0, max: 2, def: 1, fmt: pct, scope: "st" },
      { key: "mono", label: "MONO", type: "bool", def: false, scope: "st" },
      { key: "swap", label: "SWAP L/R", type: "bool", def: false, scope: "st" },
      { key: "widthMod", label: "WIDTH MOD", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" }
    ]
  },
  {
    id: "perf", label: "PERFORM / GLITCH", params: [
      { key: "stutter", label: "STUTTER", type: "bool", def: false, scope: "s" },
      { key: "stutterRate", label: "REPEAT RATE", type: "enum", opts: ["1/8", "1/16", "1/32", "1/64"], def: "1/16", scope: "s" },
      { key: "tapeStart", label: "TAPE START", type: "bool", def: false, scope: "s" },
      { key: "tapeStopAction", label: "TAPE STOP ▶", type: "action", scope: "s" },
      { key: "randStart", label: "RANDOM START", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "s" },
      { key: "randPitch", label: "RANDOM PITCH", type: "num", min: 0, max: 12, def: 0, step: 1, fmt: st, scope: "s" },
      { key: "randPan", label: "RANDOM PAN", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "s" },
      { key: "randReverse", label: "RANDOM REV", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "s" },
      { key: "skip", label: "SKIP / GLITCH", type: "num", min: 0, max: 1, def: 0, fmt: pct, scope: "st" }
    ]
  },
  {
    id: "char", label: "CHARACTER", params: [
      { key: "character", label: "CHARACTER", type: "enum", opts: CHARACTERS, def: "off", scope: "st" },
      { key: "charAmt", label: "AMOUNT", type: "num", min: 0, max: 1, def: 0.6, fmt: pct, scope: "st" }
    ]
  }
]

/** Flat ordered param list for a scope ("sample" | "track"). */
export function fxParamsFor(scope) {
  const flag = scope === "track" ? "t" : "s"
  const out = []
  for (const g of FX_GROUPS) {
    const ps = g.params.filter((p) => p.scope.includes(flag))
    for (const p of ps) out.push({ ...p, group: g.id, groupLabel: g.label })
  }
  return out
}

const BY_KEY = new Map()
for (const g of FX_GROUPS) for (const p of g.params) BY_KEY.set(p.key, p)
export const fxParam = (key) => BY_KEY.get(key)

export function fxDefaults(scope = "sample") {
  const o = {}
  for (const p of fxParamsFor(scope)) if (p.type !== "action") o[p.key] = p.def
  return o
}

/** Clamp/coerce one value for a param spec. */
export function coerceFx(p, v) {
  if (!p) return v
  if (p.type === "bool") return !!v
  if (p.type === "enum") return p.opts.includes(v) ? v : p.def
  if (p.type === "num") {
    const n = Number(v)
    if (!Number.isFinite(n)) return p.def
    const c = Math.min(p.max, Math.max(p.min, n))
    return p.step ? Math.round(c / p.step) * p.step : c
  }
  return v
}

/** Sanitize a flat params object; unknown keys are preserved (legacy fields). */
export function sanitizeFx(obj, scope = "sample") {
  const out = { ...fxDefaults(scope), ...(obj || {}) }
  for (const p of fxParamsFor(scope)) {
    if (p.type === "action") continue
    out[p.key] = coerceFx(p, out[p.key])
  }
  return out
}

/** Knob delta (≈ ±0.01 per px) → new value, tactile/coarse. */
export function nudgeFx(p, cur, delta) {
  if (p.type === "bool") return delta > 0 ? true : delta < 0 ? false : cur
  if (p.type === "enum") {
    const i = Math.max(0, p.opts.indexOf(cur))
    const n = p.opts.length
    return p.opts[(i + (delta > 0 ? 1 : n - 1)) % n]
  }
  if (p.type === "num") {
    if (p.step) {
      // Stepped: accumulate whole steps per ~0.04 knob travel
      const stepsF = delta / 0.04
      const steps = stepsF > 0 ? Math.ceil(stepsF) : Math.floor(stepsF)
      return coerceFx(p, (Number(cur) ?? p.def) + steps * p.step)
    }
    if (p.log) {
      const lo = Math.log(p.min), hi = Math.log(p.max)
      const t = (Math.log(Math.max(p.min, Number(cur) || p.def)) - lo) / (hi - lo)
      return coerceFx(p, Math.exp(lo + Math.min(1, Math.max(0, t + delta)) * (hi - lo)))
    }
    return coerceFx(p, (Number(cur) ?? p.def) + delta * (p.max - p.min))
  }
  return cur
}

/** Step an enum/bool/stepped num with ◀▶; continuous nums move 5%. */
export function stepFx(p, cur, dir) {
  if (p.type === "bool") return !cur
  if (p.type === "enum" || p.step) return nudgeFx(p, cur, dir > 0 ? 0.04 : -0.04)
  if (p.log) return nudgeFx(p, cur, dir * 0.05)
  return coerceFx(p, (Number(cur) ?? p.def) + dir * 0.05 * (p.max - p.min))
}

export function fmtFx(p, v) {
  if (!p) return String(v)
  if (p.type === "bool") return v ? "ON" : "OFF"
  if (p.type === "enum") return String(v).toUpperCase()
  if (p.type === "action") return "OK ▶"
  return p.fmt ? p.fmt(Number(v)) : String(v)
}

/** 0..1 knob position for visuals. */
export function fxKnob01(p, v) {
  if (!p) return 0
  if (p.type === "bool") return v ? 1 : 0
  if (p.type === "enum") return Math.max(0, p.opts.indexOf(v)) / Math.max(1, p.opts.length - 1)
  if (p.type === "action") return 0.5
  const n = Number(v)
  if (p.log) return (Math.log(Math.max(p.min, n)) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min))
  return (n - p.min) / (p.max - p.min)
}

/**
 * Character macro overlays: named presets layered onto the lower-level params.
 * Numeric targets are lerped by charAmt; enums switch when charAmt > 0.
 */
export const CHARACTER_PRESETS = {
  cassette: { satType: "tape", drive: 0.35, hiss: 0.3, wow: 0.35, flutter: 0.25, trebleDb: -6, bassDb: -2, cutoff: 9000, filterType: "lp" },
  radio: { filterType: "bp", cutoff: 1800, resonance: 0.3, comp: 0.6, satType: "overdrive", drive: 0.45, staticNoise: 0.25 },
  telephone: { device: "telephone", deviceAmt: 1, comp: 0.4 },
  broken: { satType: "distort", drive: 0.6, dropout: 0.5, wow: 0.5, filterType: "bp", cutoff: 1200, resonance: 0.5 },
  dusty: { filterType: "lp", cutoff: 4500, crackle: 0.5, dust: 0.4, satType: "saturate", drive: 0.3 },
  warm: { satType: "saturate", drive: 0.4, trebleDb: -4, comp: 0.3, temp: 0.8 },
  crunch: { bits: 8, downsample: 6, satType: "softclip", drive: 0.35 },
  dirty: { satType: "overdrive", drive: 0.6, filterType: "lp", cutoff: 6000, staticNoise: 0.2, hiss: 0.15 },
  old: { filterType: "lp", cutoff: 3500, hiss: 0.35, satType: "tape", drive: 0.4, wow: 0.45, crackle: 0.3 },
  cheap: { device: "tiny", deviceAmt: 0.9, comp: 0.5, satType: "softclip", drive: 0.25 },
  dream: { chorusDepth: 0.6, chorusRate: 0.5, filterType: "lp", cutoff: 5000, reverb: 0.55, revType: "hall", revSize: 1.4 },
  space: { reverb: 0.6, revType: "huge", revSize: 1.6, delay: 0.4, delPingPong: true, delMode: "1/8", chorusDepth: 0.3 },
  underwater: { filterType: "lp", cutoff: 600, resonance: 0.6, chorusDepth: 0.5, chorusRate: 0.2, wow: 0.3 },
  distant: { trebleDb: -8, level: 0.6, reverb: 0.7, revType: "hall", revSize: 1.6 },
  haunted: { reverb: 0.8, revType: "huge", revSize: 1.8, revDecay: 1.3, wow: 0.5, flutter: 0.2, reverse: true },
  melt: { wow: 0.8, flutter: 0.1, satType: "tape", drive: 0.5, filterType: "lp", cutoff: 2500 },
  destroy: { satType: "fuzz", drive: 0.9, bits: 5, downsample: 12, filterType: "off" },
  game: { bits: 8, downsample: 8, alias: true, filterType: "bp", cutoff: 2500, resonance: 0.2 },
  ghost: { reverb: 0.85, revType: "huge", revSize: 1.7, level: 0.75, vibDepth: 0.25, vibRate: 0.7, chorusDepth: 0.3 },
  machine: { satType: "hardclip", drive: 0.65, filterType: "bp", cutoff: 900, resonance: 0.7, delay: 0.35, delMode: "free", delTime: 0.05, delFeedback: 0.6 },
  robot: { tremDepth: 1, tremRate: 18, filterType: "bp", cutoff: 1500, resonance: 0.4, bits: 8, satType: "distort", drive: 0.4 }
}

/** Effective params = base with character overlay applied. */
export function resolveFx(p) {
  const name = p?.character
  const amt = Math.min(1, Math.max(0, Number(p?.charAmt ?? 0)))
  const ov = name && name !== "off" ? CHARACTER_PRESETS[name] : null
  if (!ov || amt <= 0) return p
  const out = { ...p }
  for (const [k, v] of Object.entries(ov)) {
    const spec = BY_KEY.get(k)
    if (typeof v === "number" && spec?.type === "num") {
      const base = Number(p[k] ?? spec.def)
      out[k] = coerceFx(spec, base + (v - base) * amt)
    } else {
      out[k] = v
    }
  }
  return out
}

/** Musical subdivision → seconds at bpm. */
export function syncSeconds(mode, bpm, freeTime) {
  const beat = 60 / Math.max(30, Number(bpm) || 120)
  switch (mode) {
    case "1/4": return beat
    case "1/8": return beat / 2
    case "1/16": return beat / 4
    case "trip": return beat / 3
    case "slap": return 0.09
    case "1/32": return beat / 8
    case "1/64": return beat / 16
    default: return Number(freeTime) || 0.3
  }
}
