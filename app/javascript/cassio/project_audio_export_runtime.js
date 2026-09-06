import { exportProjectAudio, PROJECT_AUDIO_FORMATS } from "cassio/audio/project_export"
import { renderProjectAudioExport } from "cassio/screens/project"

const EXPORT_SCREEN = "project-audio-export"

function selectedProject(projectRuntime) {
  return projectRuntime?.projects?.[projectRuntime.projectIndex] || null
}

function exportBaseName(name) {
  return String(name || "CASSIO PROJECT").trim().replace(/[^a-z0-9_-]+/gi, "_") || "CASSIO_PROJECT"
}

export class ProjectAudioExportRuntime {
  constructor(app) {
    this.app = app
    this.formatIndex = 0
    this.exportBusy = false
    this.baseRender = app.render.bind(app)
    app.render = () => {
      if (app.screen === EXPORT_SCREEN) return this.render()
      return this.baseRender()
    }
    app.projectAudioExportRuntime = this
    this.#bindHardwareCapture()
  }

  render() {
    const projectRuntime = this.app.projectRuntime
    const state = {
      ...(projectRuntime?.state?.() || {}),
      projectAudioFormatIndex: this.formatIndex,
      projectExportBusy: this.exportBusy
    }
    this.app.vscreen.innerHTML = renderProjectAudioExport(state)
    requestAnimationFrame(() => this.app.vscreen.querySelector(".lib-row.selected")?.scrollIntoView({ block: "nearest" }))
  }

  open() {
    const projectRuntime = this.app.projectRuntime
    const row = selectedProject(projectRuntime)
    if (!row) return this.app.toast?.("NO PROJECT")
    if (row.id !== projectRuntime.activeProjectId) return this.app.toast?.("OPEN PROJECT TO EXPORT")
    this.formatIndex = 0
    this.app.screen = EXPORT_SCREEN
    this.render()
  }

  async export(format = PROJECT_AUDIO_FORMATS[this.formatIndex]) {
    if (this.exportBusy) return this.app.toast?.("RENDERING MASTER")
    const projectRuntime = this.app.projectRuntime
    const row = selectedProject(projectRuntime)
    if (!row) return this.app.toast?.("NO PROJECT")
    if (row.id !== projectRuntime?.activeProjectId) return this.app.toast?.("OPEN PROJECT TO EXPORT")

    const fmt = String(format || "wav").toLowerCase()
    this.formatIndex = Math.max(0, PROJECT_AUDIO_FORMATS.indexOf(fmt))
    this.exportBusy = true
    this.render()
    this.app.toast?.(`RENDERING ${fmt.toUpperCase()}`)

    try {
      await exportProjectAudio(this.app, fmt, exportBaseName(row.name))
      this.app.toast?.(`EXPORTED ${fmt.toUpperCase()}`)
    } catch (error) {
      this.app.toast?.(String(error?.message || "EXPORT FAILED").toUpperCase().slice(0, 28))
    } finally {
      this.exportBusy = false
      if (this.app.screen === EXPORT_SCREEN) this.render()
    }
  }

  #bindHardwareCapture() {
    const root = this.app.root
    const own = (event) => {
      const button = event.target.closest?.("[data-action]")
      if (!button) return
      const action = button.dataset.action
      const screen = this.app.screen

      if (screen === "project-manage") {
        const projectRuntime = this.app.projectRuntime
        if (!projectRuntime) return
        const audioOpen = action === "nav-ok" && projectRuntime.projectManageIndex === 2
        const projectFileExport = action === "soft-c"
        if (!audioOpen && !projectFileExport) return

        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.type !== "pointerdown") return
        if (audioOpen) return this.open()
        return void projectRuntime.exportSelectedBundle()
      }

      if (screen !== EXPORT_SCREEN) return
      const projectControl = action.startsWith("soft-") || action.startsWith("nav-") || action === "back-menu"
      if (!projectControl) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type !== "pointerdown") return

      if (this.exportBusy) return this.app.toast?.("RENDERING MASTER")
      if (action === "nav-up" || action === "nav-down") {
        const delta = action === "nav-down" ? 1 : -1
        this.formatIndex = (this.formatIndex + delta + PROJECT_AUDIO_FORMATS.length) % PROJECT_AUDIO_FORMATS.length
        return this.render()
      }
      if (action === "nav-ok") return void this.export()
      if (action === "soft-a") return void this.export("wav")
      if (action === "soft-b") return void this.export("mp3")
      if (action === "soft-c") return void this.export("m4a")
      if (action === "soft-d" || action === "back-menu") {
        this.app.screen = "project-manage"
        return this.app.render()
      }
    }

    root.addEventListener("pointerdown", own, true)
    root.addEventListener("pointerup", own, true)
  }
}

export function installProjectAudioExportRuntime(app) {
  if (!app || app.projectAudioExportRuntime) return app?.projectAudioExportRuntime || null
  return new ProjectAudioExportRuntime(app)
}

export { EXPORT_SCREEN }
