import { defaultProject, putUserSound, saveRecovery } from "cassio/store"
import {
  cloneProjectState,
  decodeProjectBundle,
  deleteProject,
  encodeProjectBundle,
  listProjects,
  makeProjectBundle,
  newProjectId,
  putProject
} from "cassio/project_store"
import {
  renderProjectManage,
  renderProjectName,
  renderProjects,
  renderProjectSwitchConfirm
} from "cassio/screens/project"
import { renderProjectDeleteConfirm } from "cassio/screens/project_delete"

const PROJECT_SCREENS = new Set([
  "project-list",
  "project-manage",
  "project-name",
  "project-switch-confirm",
  "project-delete-confirm"
])
const ACTIVE_KEY = "cassio.activeProjectId"

function selectedProject(runtime) {
  return runtime.projects[runtime.projectIndex] || null
}

function safeName(name) {
  return String(name || "UNTITLED").trim().toUpperCase().slice(0, 18) || "UNTITLED"
}

function downloadName(name) {
  return safeName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cassio-project"
}

export class ProjectRuntime {
  constructor(app) {
    this.app = app
    this.projects = []
    this.projectIndex = 0
    this.projectManageIndex = 0
    this.projectNameDraft = ""
    this.projectNamePurpose = null
    this.projectNameTitle = "NAME PROJECT"
    this.pendingSwitch = null
    this.activeProjectId = this.#readActiveId()
    this.baseRender = app.render.bind(app)
    app.render = () => {
      if (PROJECT_SCREENS.has(app.screen)) return this.renderProjectScreen()
      return this.baseRender()
    }
    app.projectRuntime = this
    this.#bindHardwareCapture()
  }

  async open() {
    await this.refreshProjects()
    this.app.screen = "project-list"
    this.app.render()
  }

  async refreshProjects() {
    const previous = selectedProject(this)?.id
    this.projects = await listProjects()
    const idx = this.projects.findIndex((p) => p.id === previous)
    if (idx >= 0) this.projectIndex = idx
    else this.projectIndex = Math.min(this.projectIndex, Math.max(0, this.projects.length - 1))
    if (this.activeProjectId && !this.projects.some((p) => p.id === this.activeProjectId)) {
      this.activeProjectId = null
      this.#writeActiveId(null)
    }
  }

  state() {
    const selected = selectedProject(this)
    const active = this.projects.find((p) => p.id === this.activeProjectId)
    return {
      bpm: this.app.transport?.bpm || this.app.project?.bpm || 120,
      projects: this.projects,
      projectIndex: this.projectIndex,
      projectManageIndex: this.projectManageIndex,
      activeProjectId: this.activeProjectId,
      activeProjectName: active?.name || "",
      selectedProjectName: selected?.name || "",
      projectNameDraft: this.projectNameDraft,
      projectNameTitle: this.projectNameTitle
    }
  }

  renderProjectScreen() {
    const a = this.app
    const state = this.state()
    if (a.screen === "project-list") a.vscreen.innerHTML = renderProjects(state)
    if (a.screen === "project-manage") a.vscreen.innerHTML = renderProjectManage(state)
    if (a.screen === "project-name") {
      a.vscreen.innerHTML = renderProjectName(state)
      requestAnimationFrame(() => this.#bindProjectNameField())
    }
    if (a.screen === "project-switch-confirm") a.vscreen.innerHTML = renderProjectSwitchConfirm(state)
    if (a.screen === "project-delete-confirm") a.vscreen.innerHTML = renderProjectDeleteConfirm(state)
    requestAnimationFrame(() => a.vscreen.querySelector(".lib-row.selected")?.scrollIntoView({ block: "nearest" }))
  }

  snapshotCurrent() {
    const a = this.app
    const loopBase = a.project?.loop || {}
    const loop = {
      ...cloneProjectState(loopBase),
      ...cloneProjectState(a.loopEngine?.serialize?.() || {}),
      metroOn: a.metro?.on ?? loopBase.metroOn,
      metroLevel: a.metro?.level ?? loopBase.metroLevel,
      metroAccent: a.metro?.accent ?? loopBase.metroAccent
    }
    return cloneProjectState({
      ...a.project,
      bpm: a.transport?.bpm ?? a.project?.bpm ?? 120,
      seq: a.stepSeq?.serialize?.() || a.project?.seq,
      loop,
      pads: a.project?.pads || []
    })
  }

  async saveCurrent() {
    if (!this.activeProjectId) {
      this.startName("save-as", "UNTITLED", "SAVE PROJECT")
      return null
    }
    const existing = this.projects.find((p) => p.id === this.activeProjectId)
    if (!existing) {
      this.activeProjectId = null
      this.#writeActiveId(null)
      this.startName("save-as", "UNTITLED", "SAVE PROJECT")
      return null
    }
    const saved = await putProject({ ...existing, state: this.snapshotCurrent() })
    await this.refreshProjects()
    this.projectIndex = Math.max(0, this.projects.findIndex((p) => p.id === saved.id))
    this.app.toast?.(`SAVED ${saved.name}`)
    this.app.render()
    return saved
  }

  startName(purpose, initial = "", title = "NAME PROJECT") {
    this.projectNamePurpose = purpose
    this.projectNameDraft = safeName(initial)
    this.projectNameTitle = title
    this.app.screen = "project-name"
    this.app.render()
  }

  cancelName() {
    if (this.projectNamePurpose === "save-before-switch") this.pendingSwitch = null
    this.projectNamePurpose = null
    this.app.screen = "project-list"
    this.app.render()
  }

  async commitName() {
    const input = this.app.vscreen.querySelector("#cassio-project-name-field")
    const name = safeName(input?.value || this.projectNameDraft)
    this.projectNameDraft = name
    const purpose = this.projectNamePurpose
    this.projectNamePurpose = null

    if (purpose === "new") {
      const state = cloneProjectState(defaultProject())
      const row = await putProject({ id: newProjectId(), name, state })
      this.activeProjectId = row.id
      this.#writeActiveId(row.id)
      await saveRecovery(state)
      location.reload()
      return
    }

    if (purpose === "rename") {
      const row = selectedProject(this)
      if (row) await putProject({ ...row, name })
      await this.refreshProjects()
      this.app.screen = "project-list"
      this.app.toast?.(`RENAMED ${name}`)
      this.app.render()
      return
    }

    if (purpose === "save-as" || purpose === "save-before-switch") {
      const state = this.snapshotCurrent()
      const row = await putProject({ id: newProjectId(), name, state })
      this.activeProjectId = row.id
      this.#writeActiveId(row.id)
      await saveRecovery(state)
      await this.refreshProjects()
      this.projectIndex = Math.max(0, this.projects.findIndex((p) => p.id === row.id))
      this.app.toast?.(`SAVED AS ${row.name}`)

      if (purpose === "save-before-switch") {
        const pending = this.pendingSwitch
        this.pendingSwitch = null
        if (pending) return this.#finishSwitch(pending)
      }

      this.app.screen = "project-list"
      this.app.render()
      return
    }
  }

  async duplicateSelected() {
    const row = selectedProject(this)
    if (!row) return this.app.toast?.("NO PROJECT")
    const duplicate = await putProject({
      id: newProjectId(),
      name: `${row.name.slice(0, 13)} COPY`,
      state: row.state
    })
    await this.refreshProjects()
    this.projectIndex = Math.max(0, this.projects.findIndex((p) => p.id === duplicate.id))
    this.app.toast?.(`DUPLICATED ${duplicate.name}`)
    this.app.screen = "project-list"
    this.app.render()
  }

  requestDelete() {
    if (!selectedProject(this)) return this.app.toast?.("NO PROJECT")
    this.app.screen = "project-delete-confirm"
    this.app.render()
  }

  async confirmDelete() {
    const row = selectedProject(this)
    if (!row) return
    await deleteProject(row.id)
    if (row.id === this.activeProjectId) {
      this.activeProjectId = null
      this.#writeActiveId(null)
    }
    await this.refreshProjects()
    this.app.screen = "project-list"
    this.app.toast?.(`DELETED ${row.name}`)
    this.app.render()
  }

  async exportSelectedBundle({ download = true } = {}) {
    const row = selectedProject(this)
    if (!row) {
      this.app.toast?.("NO PROJECT")
      return null
    }
    const bundle = makeProjectBundle(row, this.app.userSounds || [])
    if (download) {
      const blob = new Blob([encodeProjectBundle(bundle)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${downloadName(row.name)}.cassio`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      this.app.toast?.(`EXPORTED ${row.name}`)
    }
    return bundle
  }

  async importBundle(bundle) {
    if (bundle?.format !== "cassio-project-v1" || !bundle?.project?.state) throw new Error("NOT A CASSIO PROJECT")
    for (const sound of bundle.userSounds || []) await putUserSound(sound)
    if (bundle.userSounds?.length) this.app.userSounds = [...(this.app.userSounds || []).filter((s) => !bundle.userSounds.some((x) => x.id === s.id)), ...bundle.userSounds]
    const row = await putProject({
      id: newProjectId(),
      name: bundle.project.name || "IMPORTED",
      state: bundle.project.state
    })
    await this.refreshProjects()
    this.projectIndex = Math.max(0, this.projects.findIndex((p) => p.id === row.id))
    this.app.screen = "project-list"
    this.app.toast?.(`IMPORTED ${row.name}`)
    this.app.render()
    return row
  }

  importFile() {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".cassio,.json,application/json"
    input.hidden = true
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0]
        if (!file) return
        const bundle = decodeProjectBundle(await file.text())
        await this.importBundle(bundle)
      } catch (error) {
        this.app.toast?.(String(error?.message || "IMPORT FAILED").slice(0, 28))
      } finally {
        input.remove()
      }
    }, { once: true })
    document.body.appendChild(input)
    input.click()
  }

  requestOpenSelected() {
    const row = selectedProject(this)
    if (!row) return this.app.toast?.("NO PROJECT")
    if (row.id === this.activeProjectId) return this.app.toast?.(`${row.name} IS ACTIVE`)
    this.pendingSwitch = { kind: "open", id: row.id }
    this.app.screen = "project-switch-confirm"
    this.app.render()
  }

  requestNew() {
    this.pendingSwitch = { kind: "new" }
    this.app.screen = "project-switch-confirm"
    this.app.render()
  }

  async continueSwitch(saveFirst) {
    const pending = this.pendingSwitch
    if (!pending) return

    if (saveFirst) {
      const existing = this.projects.find((p) => p.id === this.activeProjectId)
      if (!existing) {
        this.startName("save-before-switch", "UNTITLED", "SAVE CURRENT AS")
        return
      }
      await this.saveCurrent()
    }

    this.pendingSwitch = null
    await this.#finishSwitch(pending)
  }

  async #finishSwitch(pending) {
    if (pending.kind === "open") return this.#openProject(pending.id)
    if (pending.kind === "new") return this.startName("new", "NEW PROJECT", "NEW PROJECT")
  }

  async #openProject(id) {
    const row = this.projects.find((p) => p.id === id)
    if (!row) return this.app.toast?.("PROJECT NOT FOUND")
    this.activeProjectId = row.id
    this.#writeActiveId(row.id)
    await saveRecovery(cloneProjectState(row.state))
    location.reload()
  }

  async #manageSelected() {
    const row = selectedProject(this)
    if (!row) return this.app.toast?.("NO PROJECT")
    this.projectManageIndex = 0
    this.app.screen = "project-manage"
    this.app.render()
  }

  async #runManageAction() {
    if (this.projectManageIndex === 0) return this.startName("save-as", `${selectedProject(this)?.name || "PROJECT"} COPY`, "SAVE PROJECT AS")
    if (this.projectManageIndex === 1) return this.duplicateSelected()
    if (this.projectManageIndex === 2) return this.exportSelectedBundle()
    if (this.projectManageIndex === 3) return this.requestDelete()
  }

  #bindProjectNameField() {
    const input = this.app.vscreen.querySelector("#cassio-project-name-field")
    if (!input || input.dataset.projectBound) return
    input.dataset.projectBound = "1"
    input.addEventListener("input", () => { this.projectNameDraft = safeName(input.value) })
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      void this.commitName()
    })
    input.focus()
    input.select()
  }

  #bindHardwareCapture() {
    const root = this.app.root
    const own = (event) => {
      const button = event.target.closest?.("[data-action]")
      if (!button) return
      const action = button.dataset.action
      const menuProjectOpen = this.app.screen === "menu" && this.app.menuIndex === 4 && (action === "soft-a" || action === "nav-ok")
      const projectControl = PROJECT_SCREENS.has(this.app.screen) && (action.startsWith("soft-") || action.startsWith("nav-") || action === "back-menu")
      if (!menuProjectOpen && !projectControl) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type !== "pointerdown") return
      if (menuProjectOpen) return void this.open()
      void this.#handleProjectAction(action)
    }
    root.addEventListener("pointerdown", own, true)
    root.addEventListener("pointerup", own, true)
  }

  async #handleProjectAction(action) {
    const screen = this.app.screen
    if (screen === "project-list") {
      if (action === "nav-up" || action === "nav-down") {
        if (!this.projects.length) return
        const d = action === "nav-down" ? 1 : -1
        this.projectIndex = (this.projectIndex + d + this.projects.length) % this.projects.length
        return this.app.render()
      }
      if (action === "soft-a") return this.requestNew()
      if (action === "soft-b") return this.saveCurrent()
      if (action === "soft-c") {
        const row = selectedProject(this)
        if (!row) return this.app.toast?.("NO PROJECT")
        return this.startName("rename", row.name, "RENAME PROJECT")
      }
      if (action === "soft-d" || action === "nav-ok") return this.requestOpenSelected()
      if (action === "nav-left") return this.importFile()
      if (action === "nav-right") return this.#manageSelected()
      if (action === "back-menu") {
        this.app.screen = "menu"
        return this.app.render()
      }
    }

    if (screen === "project-manage") {
      if (action === "nav-up" || action === "nav-down") {
        const d = action === "nav-down" ? 1 : -1
        this.projectManageIndex = (this.projectManageIndex + d + 4) % 4
        return this.app.render()
      }
      if (action === "nav-ok") return this.#runManageAction()
      if (action === "soft-d" || action === "back-menu") {
        this.app.screen = "project-list"
        return this.app.render()
      }
    }

    if (screen === "project-name") {
      if (action === "soft-a" || action === "back-menu") return this.cancelName()
      if (action === "soft-d" || action === "nav-ok") return this.commitName()
    }

    if (screen === "project-switch-confirm") {
      if (action === "soft-a" || action === "back-menu") {
        this.pendingSwitch = null
        this.app.screen = "project-list"
        return this.app.render()
      }
      if (action === "soft-c") return this.continueSwitch(false)
      if (action === "soft-d") return this.continueSwitch(true)
    }

    if (screen === "project-delete-confirm") {
      if (action === "soft-a" || action === "back-menu") {
        this.app.screen = "project-manage"
        return this.app.render()
      }
      if (action === "soft-d") return this.confirmDelete()
    }
  }

  #readActiveId() {
    try { return localStorage.getItem(ACTIVE_KEY) || null } catch (_) { return null }
  }

  #writeActiveId(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id)
      else localStorage.removeItem(ACTIVE_KEY)
    } catch (_) { /* ignore */ }
  }
}

export function installProjectRuntime(app) {
  if (!app || app.projectRuntime) return app?.projectRuntime || null
  return new ProjectRuntime(app)
}

export { PROJECT_SCREENS }
