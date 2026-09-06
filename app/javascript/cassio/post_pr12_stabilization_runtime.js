import { defaultTrackSeq } from "cassio/store"

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)

function installTrackClearSemantics(app) {
  const engine = app.loopEngine
  if (!engine?.clear || engine._postPr12ClearInstalled) return
  engine._postPr12ClearInstalled = true
  const baseClear = engine.clear.bind(engine)

  engine.clear = (trackId = engine.selected) => {
    const lane = engine.tracks?.find?.((track) => track.id === (trackId || engine.selected))
    if (!lane?.assigned) return false
    const cleared = baseClear(trackId)
    if (!cleared) return false

    const steps = Math.min(64, Math.max(16, Math.round((lane.lengthBars || engine.lengthBars || 4) * 16)))
    lane.seq = defaultTrackSeq(steps)
    lane.pattern = null
    lane.undoBuffer = null
    lane.dirty = true
    return true
  }
}

function followSelectedLane(app) {
  if (app.screen !== "loop-tracks" || app.loopScrollFollow === false) return
  const scroller = app.vscreen?.querySelector?.("[data-loop-scroll]")
  const row = app.vscreen?.querySelector?.(`.loop-trow[data-track-id="${app.loopEngine?.selected}"]`)
  if (!scroller || !row) return

  const scrollerRect = scroller.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const rulerHeight = app.vscreen?.querySelector?.(".loop-ruler-row")?.getBoundingClientRect?.().height || 0
  const visibleTop = scrollerRect.top + rulerHeight
  const visibleBottom = scrollerRect.bottom
  let next = scroller.scrollTop

  if (rowRect.top < visibleTop) next -= visibleTop - rowRect.top
  else if (rowRect.bottom > visibleBottom) next += rowRect.bottom - visibleBottom

  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  next = Math.min(max, Math.max(0, next))
  if (Math.abs(next - scroller.scrollTop) < 1) {
    app.loopScrollTop = scroller.scrollTop
    return
  }

  app._loopScrollProgrammatic = true
  scroller.scrollTop = next
  app.loopScrollTop = next
  requestAnimationFrame(() => { app._loopScrollProgrammatic = false })
}

function installDimLevelPreview(app) {
  const runtime = app.settingsRuntime
  if (!runtime?.update || runtime._postPr12DimPreviewInstalled) return
  runtime._postPr12DimPreviewInstalled = true
  const baseUpdate = runtime.update.bind(runtime)

  runtime.update = (patch, options = {}) => {
    const previewDim = app.screen === "settings-display" && hasOwn(patch, "dimLevel")
    const result = baseUpdate(patch, options)
    if (previewDim) {
      runtime._displayMode = "dim"
      runtime.applyVisual()
    }
    return result
  }
}

function developerModeEnabled(app) {
  try {
    if (app.settingsRuntime?.state) return !!app.settingsRuntime.state().debugEnabled
    return window.localStorage?.getItem("cassio.debug") === "1"
  } catch (_) {
    return false
  }
}

function syncDeveloperControls(app) {
  const marker = document.querySelector("[data-cassio-glitch-marker]")
  if (!marker) return
  marker.hidden = !developerModeEnabled(app)
}

export function installPostPr12StabilizationRuntime(app) {
  if (!app || app._postPr12StabilizationInstalled) return
  app._postPr12StabilizationInstalled = true

  installTrackClearSemantics(app)
  installDimLevelPreview(app)

  const baseRender = app.render.bind(app)
  app.render = (...args) => {
    const result = baseRender(...args)
    syncDeveloperControls(app)
    if (app.screen === "loop-tracks" && app.loopScrollFollow !== false) {
      requestAnimationFrame(() => requestAnimationFrame(() => followSelectedLane(app)))
    }
    return result
  }

  syncDeveloperControls(app)
}
