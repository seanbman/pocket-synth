const SETTINGS_KEY = "cassio.systemSettings.v1"

export const CHASSIS_THEMES = [
  { id: "pink", name: "PINK", hi: "#ff4d94", base: "#ff2d7a", deep: "#d4145a" },
  { id: "mint", name: "MINT", hi: "#a4f0dc", base: "#6bd6bd", deep: "#2c8f7f" },
  { id: "cream", name: "CREAM", hi: "#fff5d9", base: "#e8dcc1", deep: "#a98f67" },
  { id: "coral", name: "CORAL", hi: "#ffb095", base: "#ff7a62", deep: "#bd443a" },
  { id: "sky", name: "SKY", hi: "#a9d5ff", base: "#71b5ef", deep: "#3978aa" },
  { id: "lavender", name: "LAVENDER", hi: "#d3c5ff", base: "#ac93ef", deep: "#7255ae" },
  { id: "lemon", name: "LEMON", hi: "#fff6a4", base: "#eadb5e", deep: "#a99b32" },
  { id: "ice", name: "ICE", hi: "#d9f5f6", base: "#a9dde0", deep: "#619ca0" }
]

export const DEFAULT_SETTINGS = Object.freeze({
  masterBassDb: 0,
  masterTrebleDb: 0,
  limiter: true,
  metroOn: true,
  metroLevel: 0.7,
  metroAccent: true,
  metroSound: "block",
  countInBars: 1,
  brightness: 0.8,
  dimLevel: 0.25,
  autoDimMinutes: 2,
  screenSleepMinutes: 10,
  chassisTheme: "pink"
})

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback

export function normalizeSettings(value = {}) {
  return {
    masterBassDb: clamp(value.masterBassDb, -12, 12, DEFAULT_SETTINGS.masterBassDb),
    masterTrebleDb: clamp(value.masterTrebleDb, -12, 12, DEFAULT_SETTINGS.masterTrebleDb),
    limiter: value.limiter !== false,
    metroOn: value.metroOn !== false,
    metroLevel: clamp(value.metroLevel, 0, 1, DEFAULT_SETTINGS.metroLevel),
    metroAccent: value.metroAccent !== false,
    metroSound: choice(value.metroSound, ["block", "tick", "soft"], DEFAULT_SETTINGS.metroSound),
    countInBars: choice(Number(value.countInBars), [0, 1, 2, 4], DEFAULT_SETTINGS.countInBars),
    brightness: clamp(value.brightness, 0.35, 1, DEFAULT_SETTINGS.brightness),
    dimLevel: clamp(value.dimLevel, 0.08, 0.8, DEFAULT_SETTINGS.dimLevel),
    autoDimMinutes: choice(Number(value.autoDimMinutes), [0, 1, 2, 5, 10], DEFAULT_SETTINGS.autoDimMinutes),
    screenSleepMinutes: choice(Number(value.screenSleepMinutes), [0, 2, 5, 10, 20, 30], DEFAULT_SETTINGS.screenSleepMinutes),
    chassisTheme: CHASSIS_THEMES.some((theme) => theme.id === value.chassisTheme)
      ? value.chassisTheme
      : DEFAULT_SETTINGS.chassisTheme
  }
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SETTINGS_KEY)
    return normalizeSettings(raw ? JSON.parse(raw) : {})
  } catch (_) {
    return normalizeSettings()
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeSettings(settings)
  try { storage?.setItem?.(SETTINGS_KEY, JSON.stringify(normalized)) } catch (_) { /* explicit UI reports persistence separately */ }
  return normalized
}

export function chassisTheme(id) {
  return CHASSIS_THEMES.find((theme) => theme.id === id) || CHASSIS_THEMES[0]
}

export { SETTINGS_KEY }
