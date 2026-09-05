const MAX_TRACK_NAME = 18
const PLACEHOLDER_NAME = "UNTITLED"

function cleanTrackName(value) {
  return String(value ?? "").trim().toUpperCase().slice(0, MAX_TRACK_NAME)
}

function isPlaceholderName(value) {
  const name = cleanTrackName(value)
  return !name || name === PLACEHOLDER_NAME || /^TRACK\s+\d+$/.test(name)
}

function decorateRenameControls(app) {
  const root = app?.root
  const track = app?.loopEngine?.selectedTrack
  if (!root || !track?.assigned) return

  if (app.screen === "loop-menu") {
    const firstSoft = root.querySelector(".lcd-soft > div:first-child .green")
    if (firstSoft) firstSoft.textContent = "RENAME"

    const soundName = root.querySelector(".loop-menu-screen .sound-name")
    if (soundName && !soundName.querySelector("[data-track-rename]")) {
      const action = document.createElement("span")
      action.dataset.trackRename = String(track.id)
      action.className = "green"
      action.setAttribute("role", "button")
      action.setAttribute("tabindex", "0")
      action.textContent = " · RENAME"
      soundName.append(action)
    }
  }

  if (app.screen === "loop-tracks") {
    const label = root.querySelector(`.loop-trow.sel[data-track-id="${track.id}"] .loop-tlabel`)
    if (label && !label.querySelector("[data-track-rename]")) {
      const action = document.createElement("span")
      action.dataset.trackRename = String(track.id)
      action.className = "green"
      action.setAttribute("role", "button")
      action.setAttribute("tabindex", "0")
      action.textContent = " [RN]"
      label.append(action)
    }
  }
}

/**
 * Track naming UX layered over the arrangement/library model.
 *
 * Fresh REC lanes use UNTITLED only as a crash-recovery placeholder and are
 * immediately prompted for a real name when the first take finishes. Existing
 * tracks can be renamed from the track menu with soft key A or the visible RN
 * affordance on the selected timeline row.
 */
export function installTrackNamingRuntime(app) {
  if (!app || app._trackNamingRuntimeInstalled) return
  app._trackNamingRuntimeInstalled = true

  const loopEngine = app.loopEngine
  const looper = app.looper
  if (!loopEngine || !looper) return

  const originalEnsureLaneForRecord = loopEngine.ensureLaneForRecord.bind(loopEngine)
  loopEngine.ensureLaneForRecord = (options = {}) => {
    const fresh = !loopEngine.selectedTrack?.assigned
    const lane = originalEnsureLaneForRecord(fresh
      ? { ...options, name: PLACEHOLDER_NAME }
      : options)
    if (fresh && lane) lane._needsNameAfterTake = true
    return lane
  }

  app.renameTrack = (trackId = loopEngine.selected, { afterTake = false } = {}) => {
    const track = loopEngine.tracks.find((item) => item.id === Number(trackId))
    if (!track?.assigned) {
      app.toast?.("EMPTY LANE")
      return false
    }

    const promptFn = app.trackNamePrompt
      || (typeof window !== "undefined" && typeof window.prompt === "function"
        ? window.prompt.bind(window)
        : null)
    if (!promptFn) return false

    const initial = isPlaceholderName(track.name) ? "" : cleanTrackName(track.name)
    const raw = promptFn(afterTake ? "NAME THIS TAKE" : "RENAME TRACK", initial)
    if (raw == null) {
      if (afterTake) app.toast?.("TAKE KEPT · RENAME ANY TIME")
      return false
    }

    const name = cleanTrackName(raw)
    if (!name) {
      app.toast?.("NAME REQUIRED")
      return false
    }

    const entry = loopEngine.saveLaneToLibrary(track.id, { name })
    if (!entry) {
      app.toast?.("RENAME FAILED")
      return false
    }

    delete track._needsNameAfterTake
    app.persistLoop?.()
    app.render?.()
    app.toast?.(afterTake ? `TRACK SAVED · ${entry.name}` : `RENAMED · ${entry.name}`)
    return true
  }

  const originalSoftKey = looper.softKey.bind(looper)
  looper.softKey = (key) => {
    if (app.screen === "loop-menu" && key === "a" && loopEngine.selectedTrack?.assigned) {
      app.renameTrack(loopEngine.selected)
      return true
    }
    return originalSoftKey(key)
  }

  const originalRender = app.render.bind(app)
  app.render = (...args) => {
    const result = originalRender(...args)
    if (typeof document !== "undefined") queueMicrotask(() => decorateRenameControls(app))
    return result
  }

  if (app.root?.addEventListener) {
    app.root.addEventListener("pointerdown", (event) => {
      const target = event.target?.closest?.("[data-track-rename]")
      if (!target) return
      event.preventDefault()
      event.stopImmediatePropagation()
      app.renameTrack(Number(target.dataset.trackRename))
    }, true)

    app.root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return
      const target = event.target?.closest?.("[data-track-rename]")
      if (!target) return
      event.preventDefault()
      event.stopImmediatePropagation()
      app.renameTrack(Number(target.dataset.trackRename))
    }, true)
  }

  if (typeof document !== "undefined") queueMicrotask(() => decorateRenameControls(app))
}
