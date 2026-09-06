import assert from "node:assert/strict"
import {
  CHASSIS_THEMES,
  DEFAULT_SETTINGS,
  chassisTheme,
  loadSettings,
  normalizeSettings,
  saveSettings
} from "../../app/javascript/cassio/settings_store.js"

const memory = new Map()
const storage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null },
  setItem(key, value) { memory.set(key, value) },
  removeItem(key) { memory.delete(key) }
}

const defaults = loadSettings(storage)
assert.deepEqual(defaults, DEFAULT_SETTINGS)
assert.equal(defaults.brightness, 1)

const saved = saveSettings({
  masterBassDb: 99,
  masterTrebleDb: -99,
  limiter: false,
  metroLevel: 2,
  countInBars: 4,
  brightness: 0.1,
  dimLevel: 9,
  chassisTheme: "mint"
}, storage)

assert.equal(saved.masterBassDb, 12)
assert.equal(saved.masterTrebleDb, -12)
assert.equal(saved.limiter, false)
assert.equal(saved.metroLevel, 1)
assert.equal(saved.countInBars, 4)
assert.equal(saved.brightness, 0.35)
assert.equal(saved.dimLevel, 0.8)
assert.equal(saved.chassisTheme, "mint")
assert.equal(loadSettings(storage).chassisTheme, "mint")

const invalid = normalizeSettings({ countInBars: 3, chassisTheme: "mud" })
assert.equal(invalid.countInBars, DEFAULT_SETTINGS.countInBars)
assert.equal(invalid.chassisTheme, DEFAULT_SETTINGS.chassisTheme)
assert.equal(invalid.brightness, 1)

assert(CHASSIS_THEMES.length >= 6)
assert.equal(chassisTheme("mint").name, "MINT")
assert.equal(chassisTheme("does-not-exist").id, "pink")

console.log("PASS: SETTINGS persist safely and chassis themes normalize")
