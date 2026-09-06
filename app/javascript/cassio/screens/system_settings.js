import { CHASSIS_THEMES } from "cassio/settings_store"

const HOME_ROWS = ["AUDIO", "METRONOME", "DISPLAY", "STORAGE", "PERMISSIONS", "ABOUT"]

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")

const fmtDb = (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)} dB`
const fmtPct = (value) => `${Math.round(Number(value) * 100)}%`
const fmtMinutes = (value) => Number(value) === 0 ? "OFF" : `${value} MIN`
const fmtBytes = (bytes) => {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

function status(title, bpm) {
  return `<div class="lcd-status"><span class="pink">BPM ${bpm}</span><span class="status-mid">${title}</span><span class="battery"></span></div>`
}

function macros(labels = ["", "", "M3 VOLUME"]) {
  return `<div class="lcd-macros"><span>${labels[0]}</span><span>${labels[1]}</span><span>${labels[2]}</span></div>`
}

function soft(labels) {
  return `<div class="lcd-soft">${labels.map((label, i) => `<div><span class="sk">${String.fromCharCode(65 + i)}</span> <span class="green">${label}</span></div>`).join("")}</div>`
}

function rows(items, index) {
  return `<div class="settings-list">${items.map((item, i) => `
    <div class="settings-row ${i === index ? "selected" : ""}">
      <span>${esc(item.label)}</span><span class="settings-value">${esc(item.value ?? "")}</span>
    </div>`).join("")}</div>`
}

function screen(title, bpm, macroLabels, body, softLabels) {
  return `<div class="lcd-screen settings-screen">${status(title, bpm)}${macros(macroLabels)}<div class="settings-body">${body}</div>${soft(softLabels)}</div>`
}

export function renderSettingsHome(state) {
  const body = `<div class="settings-home-grid">
    ${rows(HOME_ROWS.map((label) => ({ label, value: "OPEN" })), state.homeIndex)}
    <div class="settings-preview muted">SYSTEM PREFERENCES<br>PERSIST OUTSIDE PROJECTS.<br><br>DISPLAY INCLUDES<br>CHASSIS COLOR.</div>
  </div>`
  return screen("SETTINGS", state.bpm, ["", "", "M3 VOLUME"], body, ["OPEN", "UP", "DOWN", "BACK"])
}

export function renderSettingsAudio(state) {
  const body = `${rows([
    { label: "MASTER BASS", value: fmtDb(state.settings.masterBassDb) },
    { label: "MASTER TREBLE", value: fmtDb(state.settings.masterTrebleDb) },
    { label: "LIMITER", value: state.settings.limiter ? "ON" : "OFF" }
  ], state.pageIndex)}<div class="settings-note muted">MASTER EQ APPLIES AFTER THE MIXER.<br>LEFT/RIGHT ADJUSTS SELECTED ROW.</div>`
  return screen("SETTINGS / AUDIO", state.bpm, ["M1 BASS", "M2 TREBLE", "M3 VOLUME"], body, ["RESET", "LIMITER", "TEST", "BACK"])
}

export function renderSettingsMetro(state) {
  const body = `${rows([
    { label: "METRONOME", value: state.settings.metroOn ? "ON" : "OFF" },
    { label: "CLICK LEVEL", value: fmtPct(state.settings.metroLevel) },
    { label: "COUNT-IN", value: state.settings.countInBars === 0 ? "OFF" : `${state.settings.countInBars} BAR${state.settings.countInBars === 1 ? "" : "S"}` },
    { label: "ACCENT BEAT 1", value: state.settings.metroAccent ? "ON" : "OFF" },
    { label: "CLICK SOUND", value: state.settings.metroSound.toUpperCase() }
  ], state.pageIndex)}<div class="settings-note muted">CLICK IS MONITOR-ONLY AND IS NEVER RECORDED.</div>`
  return screen("SETTINGS / METRO", state.bpm, ["M1 CLICK LEVEL", "M2 COUNT-IN", "M3 VOLUME"], body, ["TOGGLE", "SOUND", "ACCENT", "BACK"])
}

export function renderSettingsDisplay(state) {
  const theme = CHASSIS_THEMES.find((item) => item.id === state.settings.chassisTheme) || CHASSIS_THEMES[0]
  const body = `${rows([
    { label: "BRIGHTNESS", value: fmtPct(state.settings.brightness) },
    { label: "CHASSIS COLOR", value: theme.name },
    { label: "AUTO DIM", value: fmtMinutes(state.settings.autoDimMinutes) },
    { label: "DIM LEVEL", value: fmtPct(state.settings.dimLevel) },
    { label: "SCREEN SLEEP", value: fmtMinutes(state.settings.screenSleepMinutes) }
  ], state.pageIndex)}
  <div class="chassis-swatches" aria-label="Chassis colors">${CHASSIS_THEMES.map((item) => `<span class="chassis-swatch ${item.id === theme.id ? "selected" : ""}" style="--swatch:${item.base}" title="${item.name}"></span>`).join("")}</div>
  <div class="settings-note muted">CHASSIS COLOR IS GLOBAL AND SURVIVES RELOAD.</div>`
  return screen("SETTINGS / DISPLAY", state.bpm, ["M1 BRIGHTNESS", "M2 DIM LEVEL", "M3 VOLUME"], body, ["CHASSIS", "DIM NOW", "RESET", "BACK"])
}

export function renderSettingsStorage(state) {
  const storage = state.storage || {}
  const percent = storage.quota > 0 ? Math.round((storage.usage / storage.quota) * 100) : null
  const body = `${rows([
    { label: "LOCAL STORAGE", value: percent == null ? "UNKNOWN" : `${percent}% USED` },
    { label: "USED", value: fmtBytes(storage.usage) },
    { label: "QUOTA", value: fmtBytes(storage.quota) },
    { label: "USER SOUNDS", value: state.userSoundCount },
    { label: "PROJECTS", value: state.projectCount },
    { label: "PERSISTENT", value: storage.persisted == null ? "UNKNOWN" : (storage.persisted ? "YES" : "NO") }
  ], state.pageIndex)}<div class="settings-note muted">${esc(state.storageMessage || "REFRESHING STORAGE STATUS...")}</div>`
  return screen("SETTINGS / STORAGE", state.bpm, ["", "", "M3 VOLUME"], body, ["REFRESH", "CLEANUP", "PERSIST", "BACK"])
}

export function renderSettingsPermissions(state) {
  const body = `${rows([
    { label: "MICROPHONE", value: String(state.micPermission || "UNKNOWN").toUpperCase() },
    { label: "MIC TEST LEVEL", value: state.micLevel == null ? "--" : fmtPct(state.micLevel) }
  ], state.pageIndex)}<div class="settings-note muted">${esc(state.permissionMessage || "MIC ACCESS IS REQUESTED ONLY WHEN NEEDED.")}</div>`
  return screen("SETTINGS / PERM", state.bpm, ["", "", "M3 VOLUME"], body, ["TEST MIC", "REQUEST", "HELP", "BACK"])
}

export function renderSettingsAbout(state) {
  const body = `<div class="settings-about">
    <div class="settings-about-title">CASSIO</div>
    <div>V1 PROTOTYPE</div>
    <div class="muted">POCKET SAMPLER / SYNTH / LOOPER</div>
    <hr>
    <div>PROJECTS ${state.projectCount}</div>
    <div>USER SOUNDS ${state.userSoundCount}</div>
    <div>DEBUG ${state.debugEnabled ? "ON" : "OFF"}</div>
    <div class="settings-ua muted">${esc(state.userAgent)}</div>
  </div>`
  return screen("SETTINGS / ABOUT", state.bpm, ["", "", "M3 VOLUME"], body, ["REFRESH", "DEBUG", "DIAG", "BACK"])
}

export { HOME_ROWS }
