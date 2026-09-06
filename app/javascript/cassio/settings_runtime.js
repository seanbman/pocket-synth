import { listProjects } from "cassio/project_store"
import { CHASSIS_THEMES, DEFAULT_SETTINGS, chassisTheme, loadSettings, saveSettings } from "cassio/settings_store"
import {
  HOME_ROWS,
  renderSettingsAbout,
  renderSettingsAudio,
  renderSettingsDisplay,
  renderSettingsHome,
  renderSettingsMetro,
  renderSettingsPermissions,
  renderSettingsStorage
} from "cassio/screens/system_settings"

export const SETTINGS_SCREENS = new Set([
  "settings-home",
  "settings-audio",
  "settings-metro",
  "settings-display",
  "settings-storage",
  "settings-permissions",
  "settings-about"
])

const PAGE_LENGTHS = {
  "settings-audio": 3,
  "settings-metro": 5,
  "settings-display": 5,
  "settings-storage": 6,
  "settings-permissions": 2,
  "settings-about": 1
}

const cycle = (values, current, dir = 1) => {
  const i = Math.max(0, values.indexOf(current))
  return values[(i + (dir > 0 ? 1 : values.length - 1)) % values.length]
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export class SettingsRuntime {
  constructor(app) {
    this.app = app
    this.settings = loadSettings()
    this.homeIndex = 0
    this.pageIndex = 0
    this.storage = { usage: 0, quota: 0, persisted: null }
    this.storageMessage = "STORAGE STATUS NOT CHECKED"
    this.projectCount = 0
    this.micPermission = "unknown"
    this.micLevel = null
    this.permissionMessage = "MIC ACCESS IS REQUESTED ONLY WHEN NEEDED."
    this._dimTimer = null
    this._sleepTimer = null
    this._displayMode = "awake"

    app.systemSettings = this.settings
    app.settingsRuntime = this

    this.baseRender = app.render.bind(app)
    app.render = () => SETTINGS_SCREENS.has(app.screen) ? this.render() : this.baseRender()

    const applyLoopState = app.loopEngine?.applyState?.bind(app.loopEngine)
    if (applyLoopState) {
      app.loopEngine.applyState = (...args) => {
        const result = applyLoopState(...args)
        this.applyAll()
        return result
      }
    }

    const startEngine = app.engine?.start?.bind(app.engine)
    if (startEngine) {
      app.engine.start = async (...args) => {
        const result = await startEngine(...args)
        this.applyAudio()
        return result
      }
    }

    this.applyAll()
    this.#bindHardwareCapture()
    this.#bindWakeActivity()
    this.#scheduleDisplayTimers()
    void this.refreshPermission()
  }

  state() {
    return {
      bpm: this.app.transport?.bpm || this.app.project?.bpm || 120,
      settings: this.settings,
      homeIndex: this.homeIndex,
      pageIndex: this.pageIndex,
      storage: this.storage,
      storageMessage: this.storageMessage,
      projectCount: this.projectCount,
      userSoundCount: this.app.userSounds?.length || 0,
      micPermission: this.micPermission,
      micLevel: this.micLevel,
      permissionMessage: this.permissionMessage,
      debugEnabled: this.#debugEnabled(),
      userAgent: navigator.userAgent || "UNKNOWN BROWSER"
    }
  }

  async open() {
    this.homeIndex = 0
    this.pageIndex = 0
    this.app.screen = "settings-home"
    await this.refreshCounts()
    this.app.render()
  }

  async openPage(page) {
    this.pageIndex = 0
    this.app.screen = page
    if (page === "settings-storage") await this.refreshStorage()
    if (page === "settings-permissions") await this.refreshPermission()
    if (page === "settings-about") await this.refreshCounts()
    this.app.render()
  }

  render() {
    const state = this.state()
    if (this.app.screen === "settings-home") this.app.vscreen.innerHTML = renderSettingsHome(state)
    if (this.app.screen === "settings-audio") this.app.vscreen.innerHTML = renderSettingsAudio(state)
    if (this.app.screen === "settings-metro") this.app.vscreen.innerHTML = renderSettingsMetro(state)
    if (this.app.screen === "settings-display") this.app.vscreen.innerHTML = renderSettingsDisplay(state)
    if (this.app.screen === "settings-storage") this.app.vscreen.innerHTML = renderSettingsStorage(state)
    if (this.app.screen === "settings-permissions") this.app.vscreen.innerHTML = renderSettingsPermissions(state)
    if (this.app.screen === "settings-about") this.app.vscreen.innerHTML = renderSettingsAbout(state)
    requestAnimationFrame(() => this.app.vscreen.querySelector(".settings-row.selected")?.scrollIntoView({ block: "nearest" }))
  }

  applyAll() {
    this.app.systemSettings = this.settings
    this.applyVisual()
    this.applyAudio()
    this.applyMetronome()
  }

  applyVisual() {
    const theme = chassisTheme(this.settings.chassisTheme)
    const style = this.app.root?.style
    style?.setProperty("--chassis-hi", theme.hi)
    style?.setProperty("--chassis", theme.base)
    style?.setProperty("--chassis-deep", theme.deep)
    this.#applyDisplayMode()
  }

  applyAudio() {
    const engine = this.app.engine
    engine?.setBassDb?.(this.settings.masterBassDb)
    engine?.setTrebleDb?.(this.settings.masterTrebleDb)
    engine?.setLimiterEnabled?.(this.settings.limiter)
  }

  applyMetronome() {
    const metro = this.app.metro
    metro?.setOn?.(this.settings.metroOn)
    metro?.setLevel?.(this.settings.metroLevel)
    metro?.setAccent?.(this.settings.metroAccent)
    metro?.setSound?.(this.settings.metroSound)
    if (this.app.project?.loop) {
      this.app.project.loop.metroOn = this.settings.metroOn
      this.app.project.loop.metroLevel = this.settings.metroLevel
      this.app.project.loop.metroAccent = this.settings.metroAccent
      this.app.project.loop.countInBars = this.settings.countInBars
    }
  }

  update(patch, { toast = null } = {}) {
    this.settings = saveSettings({ ...this.settings, ...patch })
    this.applyAll()
    this.#scheduleDisplayTimers()
    if (toast) this.app.toast?.(toast)
    this.app.render()
    return this.settings
  }

  resetAudio() {
    this.update({
      masterBassDb: DEFAULT_SETTINGS.masterBassDb,
      masterTrebleDb: DEFAULT_SETTINGS.masterTrebleDb
    }, { toast: "MASTER EQ RESET" })
  }

  resetDisplay() {
    this.update({
      brightness: DEFAULT_SETTINGS.brightness,
      dimLevel: DEFAULT_SETTINGS.dimLevel,
      autoDimMinutes: DEFAULT_SETTINGS.autoDimMinutes,
      screenSleepMinutes: DEFAULT_SETTINGS.screenSleepMinutes,
      chassisTheme: DEFAULT_SETTINGS.chassisTheme
    }, { toast: "DISPLAY RESET" })
  }

  cycleChassis(dir = 1) {
    const ids = CHASSIS_THEMES.map((theme) => theme.id)
    const next = cycle(ids, this.settings.chassisTheme, dir)
    const name = chassisTheme(next).name
    this.update({ chassisTheme: next }, { toast: `CHASSIS ${name}` })
    return next
  }

  dimNow() {
    this._displayMode = "dim"
    this.#applyDisplayMode()
    this.app.toast?.("DISPLAY DIM")
  }

  wakeDisplay() {
    const wasDimmed = this._displayMode !== "awake"
    this._displayMode = "awake"
    this.#applyDisplayMode()
    this.#scheduleDisplayTimers()
    return wasDimmed
  }

  async refreshCounts() {
    try { this.projectCount = (await listProjects()).length } catch (_) { this.projectCount = 0 }
    return this.projectCount
  }

  async refreshStorage() {
    await this.refreshCounts()
    try {
      if (!navigator.storage?.estimate) throw new Error("STORAGE API UNSUPPORTED")
      const estimate = await navigator.storage.estimate()
      let persisted = null
      if (navigator.storage.persisted) persisted = await navigator.storage.persisted()
      this.storage = { usage: estimate.usage || 0, quota: estimate.quota || 0, persisted }
      this.storageMessage = "STORAGE STATUS READY"
    } catch (error) {
      this.storage = { usage: 0, quota: 0, persisted: null }
      this.storageMessage = String(error?.message || "STORAGE STATUS FAILED").toUpperCase()
    }
    if (this.app.screen === "settings-storage") this.app.render()
    return this.storage
  }

  cleanupStorage() {
    this.storageMessage = "NO ORPHAN SOURCE-BLOB STORE IN V1; NOTHING DELETED"
    this.app.toast?.("NO ORPHANS TO CLEAN")
    this.app.render()
  }

  async requestPersistentStorage() {
    if (!navigator.storage?.persist) {
      this.storageMessage = "PERSISTENT STORAGE API UNSUPPORTED"
      this.app.render()
      return false
    }
    try {
      const granted = await navigator.storage.persist()
      this.storage.persisted = !!granted
      this.storageMessage = granted ? "PERSISTENT STORAGE GRANTED" : "PERSISTENT STORAGE NOT GRANTED"
      this.app.toast?.(granted ? "STORAGE PERSISTENT" : "PERSIST DENIED")
      this.app.render()
      return !!granted
    } catch (error) {
      this.storageMessage = `PERSIST FAILED: ${String(error?.message || error).toUpperCase()}`.slice(0, 58)
      this.app.render()
      return false
    }
  }

  async refreshPermission() {
    try {
      if (!navigator.permissions?.query) throw new Error("PERMISSIONS API UNSUPPORTED")
      const result = await navigator.permissions.query({ name: "microphone" })
      this.micPermission = result.state || "unknown"
      result.onchange = () => {
        this.micPermission = result.state || "unknown"
        if (this.app.screen === "settings-permissions") this.app.render()
      }
      this.permissionMessage = "MIC PERMISSION STATUS READY"
    } catch (error) {
      this.micPermission = "unknown"
      this.permissionMessage = String(error?.message || "PERMISSION STATUS UNAVAILABLE").toUpperCase()
    }
    if (this.app.screen === "settings-permissions") this.app.render()
    return this.micPermission
  }

  async requestMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micPermission = "unsupported"
      this.permissionMessage = "MICROPHONE API UNSUPPORTED"
      this.app.render()
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      this.micPermission = "granted"
      this.permissionMessage = "MICROPHONE ACCESS GRANTED"
      this.app.toast?.("MIC ALLOWED")
      this.app.render()
      return true
    } catch (error) {
      this.micPermission = "denied"
      this.permissionMessage = `MIC REQUEST FAILED: ${String(error?.name || error).toUpperCase()}`
      this.app.toast?.("MIC BLOCKED")
      this.app.render()
      return false
    }
  }

  async testMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.permissionMessage = "MICROPHONE API UNSUPPORTED"
      this.app.render()
      return null
    }
    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      await this.app.engine?.start?.()
      await this.app.engine?.resume?.()
      const ctx = this.app.engine?.ctx
      if (!ctx) throw new Error("AUDIO ENGINE UNAVAILABLE")
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      await new Promise((resolve) => setTimeout(resolve, 250))
      const values = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(values)
      let sum = 0
      for (const value of values) sum += value * value
      this.micLevel = clamp(Math.sqrt(sum / values.length) * 5, 0, 1)
      source.disconnect()
      analyser.disconnect()
      this.micPermission = "granted"
      this.permissionMessage = "MIC TEST COMPLETE; MONITORING REMAINED OFF"
      this.app.render()
      return this.micLevel
    } catch (error) {
      this.micLevel = null
      this.micPermission = error?.name === "NotAllowedError" ? "denied" : this.micPermission
      this.permissionMessage = `MIC TEST FAILED: ${String(error?.name || error?.message || error).toUpperCase()}`.slice(0, 58)
      this.app.render()
      return null
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop())
    }
  }

  showPermissionHelp() {
    this.permissionMessage = "IF BLOCKED, ALLOW MICROPHONE FOR THIS SITE IN BROWSER/OS PERMISSIONS."
    this.app.render()
  }

  async testTone() {
    try {
      await this.app.engine?.start?.()
      await this.app.engine?.resume?.()
      const ctx = this.app.engine?.ctx
      const master = this.app.engine?.master
      if (!ctx || !master) return false
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const now = ctx.currentTime
      osc.frequency.value = 440
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
      osc.connect(gain)
      gain.connect(master)
      osc.start(now)
      osc.stop(now + 0.32)
      this.app.toast?.("MASTER TEST")
      return true
    } catch (_) {
      this.app.toast?.("TEST FAILED")
      return false
    }
  }

  diagnosticSnapshot() {
    const snapshot = {
      screen: this.app.screen,
      bpm: this.app.transport?.bpm,
      audioReady: !!this.app.engine?.ready,
      audioState: this.app.engine?.ctx?.state || "not-started",
      projects: this.projectCount,
      userSounds: this.app.userSounds?.length || 0,
      chassisTheme: this.settings.chassisTheme,
      storagePersisted: this.storage.persisted,
      micPermission: this.micPermission
    }
    console.info("CASSIO DIAGNOSTICS", snapshot)
    this.app.toast?.("DIAG IN CONSOLE")
    return snapshot
  }

  #debugEnabled() {
    try { return localStorage.getItem("cassio.debug") === "1" } catch (_) { return false }
  }

  #toggleDebug() {
    const enabled = !this.#debugEnabled()
    try {
      if (enabled) localStorage.setItem("cassio.debug", "1")
      else localStorage.removeItem("cassio.debug")
    } catch (_) { /* ignore */ }
    this.app.toast?.(`DEBUG ${enabled ? "ON" : "OFF"}`)
    this.app.render()
  }

  #applyDisplayMode() {
    const style = this.app.root?.style
    if (!style) return
    const level = this._displayMode === "sleep" ? 0.04
      : this._displayMode === "dim" ? this.settings.dimLevel
        : this.settings.brightness
    style.setProperty("--lcd-brightness-effective", String(level))
    this.app.root.classList.toggle("cassio-display-sleep", this._displayMode === "sleep")
  }

  #scheduleDisplayTimers() {
    clearTimeout(this._dimTimer)
    clearTimeout(this._sleepTimer)
    if (this._displayMode !== "awake") return
    if (this.settings.autoDimMinutes > 0) {
      this._dimTimer = setTimeout(() => {
        this._displayMode = "dim"
        this.#applyDisplayMode()
      }, this.settings.autoDimMinutes * 60_000)
    }
    if (this.settings.screenSleepMinutes > 0) {
      this._sleepTimer = setTimeout(() => {
        this._displayMode = "sleep"
        this.#applyDisplayMode()
      }, this.settings.screenSleepMinutes * 60_000)
    }
  }

  #bindWakeActivity() {
    const wake = () => this.wakeDisplay()
    window.addEventListener("pointerdown", wake, { capture: true, passive: true })
    window.addEventListener("keydown", wake, { capture: true })
  }

  #backHome() {
    this.pageIndex = 0
    this.app.screen = "settings-home"
    this.app.render()
  }

  #closeSettings() {
    this.app.screen = "menu"
    this.app.render()
  }

  #homeOpen() {
    const row = HOME_ROWS[this.homeIndex]
    const page = {
      AUDIO: "settings-audio",
      METRONOME: "settings-metro",
      DISPLAY: "settings-display",
      STORAGE: "settings-storage",
      PERMISSIONS: "settings-permissions",
      ABOUT: "settings-about"
    }[row]
    if (page) void this.openPage(page)
  }

  #navPage(dir) {
    const n = PAGE_LENGTHS[this.app.screen] || 1
    if (dir === "up" || dir === "down") {
      this.pageIndex = (this.pageIndex + (dir === "down" ? 1 : n - 1)) % n
      this.app.render()
      return
    }
    if (dir !== "left" && dir !== "right" && dir !== "ok") return
    const step = dir === "left" ? -1 : 1
    if (this.app.screen === "settings-audio") this.#adjustAudio(step, dir)
    if (this.app.screen === "settings-metro") this.#adjustMetro(step, dir)
    if (this.app.screen === "settings-display") this.#adjustDisplay(step, dir)
  }

  #adjustAudio(step, dir) {
    if (this.pageIndex === 0) this.update({ masterBassDb: clamp(this.settings.masterBassDb + step, -12, 12) })
    if (this.pageIndex === 1) this.update({ masterTrebleDb: clamp(this.settings.masterTrebleDb + step, -12, 12) })
    if (this.pageIndex === 2 && dir === "ok") this.update({ limiter: !this.settings.limiter }, { toast: `LIMITER ${this.settings.limiter ? "OFF" : "ON"}` })
  }

  #adjustMetro(step, dir) {
    if (this.pageIndex === 0 && dir === "ok") this.update({ metroOn: !this.settings.metroOn }, { toast: `METRO ${this.settings.metroOn ? "OFF" : "ON"}` })
    if (this.pageIndex === 1) this.update({ metroLevel: clamp(this.settings.metroLevel + step * 0.05, 0, 1) })
    if (this.pageIndex === 2) this.update({ countInBars: cycle([0, 1, 2, 4], this.settings.countInBars, step) })
    if (this.pageIndex === 3 && dir === "ok") this.update({ metroAccent: !this.settings.metroAccent })
    if (this.pageIndex === 4) this.update({ metroSound: cycle(["block", "tick", "soft"], this.settings.metroSound, step) })
  }

  #adjustDisplay(step, dir) {
    if (this.pageIndex === 0) this.update({ brightness: clamp(this.settings.brightness + step * 0.05, 0.35, 1) })
    if (this.pageIndex === 1) this.cycleChassis(step)
    if (this.pageIndex === 2) this.update({ autoDimMinutes: cycle([0, 1, 2, 5, 10], this.settings.autoDimMinutes, step) })
    if (this.pageIndex === 3) this.update({ dimLevel: clamp(this.settings.dimLevel + step * 0.05, 0.08, 0.8) })
    if (this.pageIndex === 4) this.update({ screenSleepMinutes: cycle([0, 2, 5, 10, 20, 30], this.settings.screenSleepMinutes, step) })
  }

  async #handleAction(action) {
    const screen = this.app.screen
    if (screen === "settings-home") {
      if (action === "nav-up" || action === "soft-b") {
        this.homeIndex = (this.homeIndex + HOME_ROWS.length - 1) % HOME_ROWS.length
        return this.app.render()
      }
      if (action === "nav-down" || action === "soft-c") {
        this.homeIndex = (this.homeIndex + 1) % HOME_ROWS.length
        return this.app.render()
      }
      if (action === "nav-ok" || action === "soft-a") return this.#homeOpen()
      if (action === "soft-d" || action === "back-menu") return this.#closeSettings()
      return
    }

    if (action === "nav-up" || action === "nav-down" || action === "nav-left" || action === "nav-right" || action === "nav-ok") {
      this.#navPage(action.replace("nav-", ""))
      return
    }

    if (action === "back-menu" || action === "soft-d") return this.#backHome()

    if (screen === "settings-audio") {
      if (action === "soft-a") return this.resetAudio()
      if (action === "soft-b") return this.update({ limiter: !this.settings.limiter }, { toast: `LIMITER ${this.settings.limiter ? "OFF" : "ON"}` })
      if (action === "soft-c") return this.testTone()
    }
    if (screen === "settings-metro") {
      if (action === "soft-a") return this.update({ metroOn: !this.settings.metroOn }, { toast: `METRO ${this.settings.metroOn ? "OFF" : "ON"}` })
      if (action === "soft-b") return this.update({ metroSound: cycle(["block", "tick", "soft"], this.settings.metroSound, 1) }, { toast: "CLICK SOUND" })
      if (action === "soft-c") return this.update({ metroAccent: !this.settings.metroAccent }, { toast: "BEAT 1 ACCENT" })
    }
    if (screen === "settings-display") {
      if (action === "soft-a") return this.cycleChassis(1)
      if (action === "soft-b") return this.dimNow()
      if (action === "soft-c") return this.resetDisplay()
    }
    if (screen === "settings-storage") {
      if (action === "soft-a") return this.refreshStorage()
      if (action === "soft-b") return this.cleanupStorage()
      if (action === "soft-c") return this.requestPersistentStorage()
    }
    if (screen === "settings-permissions") {
      if (action === "soft-a") return this.testMic()
      if (action === "soft-b") return this.requestMic()
      if (action === "soft-c") return this.showPermissionHelp()
    }
    if (screen === "settings-about") {
      if (action === "soft-a") { await this.refreshCounts(); return this.app.render() }
      if (action === "soft-b") return this.#toggleDebug()
      if (action === "soft-c") return this.diagnosticSnapshot()
    }
  }

  #bindHardwareCapture() {
    const root = this.app.root
    const own = (event) => {
      const button = event.target.closest?.("[data-action]")
      if (!button) return
      const action = button.dataset.action
      const menuSettingsOpen = this.app.screen === "menu" && this.app.menuIndex === 5 && (action === "soft-a" || action === "nav-ok")
      const settingsControl = SETTINGS_SCREENS.has(this.app.screen) && (action.startsWith("soft-") || action.startsWith("nav-") || action === "back-menu")
      if (!menuSettingsOpen && !settingsControl) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type !== "pointerdown") return
      if (menuSettingsOpen) return void this.open()
      void this.#handleAction(action)
    }
    root.addEventListener("pointerdown", own, true)
    root.addEventListener("pointerup", own, true)
  }
}

export function installSettingsRuntime(app) {
  if (!app || app.settingsRuntime) return app?.settingsRuntime || null
  return new SettingsRuntime(app)
}
