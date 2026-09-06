const NOTE_KEY_MAP = {
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12
}

const PRESS_CLASS = "feedback-pressed"
const LATCH_CLASS = "feedback-latched"
const PULSE_CLASS = "feedback-pulse"

function editableTarget(target) {
  return target?.matches?.("input, textarea, select, [contenteditable='true']")
}

function actionForKeyboard(code) {
  if (/^Digit[1-6]$/.test(code)) return `pad-${code.slice(-1)}`
  if (Object.hasOwn(NOTE_KEY_MAP, code)) return `key-${NOTE_KEY_MAP[code]}`
  if (code === "ArrowUp") return "nav-up"
  if (code === "ArrowDown") return "nav-down"
  if (code === "ArrowLeft") return "nav-left"
  if (code === "ArrowRight") return "nav-right"
  if (code === "Enter") return "nav-ok"
  return null
}

function feedbackElement(root, action) {
  if (!action) return null
  return root.querySelector(`[data-action="${action}"]`)
}

function clearPressed(root) {
  root.querySelectorAll(`.${PRESS_CLASS}`).forEach((el) => el.classList.remove(PRESS_CLASS))
}

function syncHold(app) {
  const root = app.root
  if (!root) return
  const holdOn = !!app.project?.hold
  root.classList.toggle("hold-latched", holdOn)

  const softC = feedbackElement(root, "soft-c")
  if (!softC) return
  const showLatch = app.screen === "play" && holdOn
  softC.classList.toggle(LATCH_CLASS, showLatch)
  if (app.screen === "play") softC.setAttribute("aria-pressed", String(holdOn))
  else softC.removeAttribute("aria-pressed")
}

function pulseBpm(app) {
  const readout = app.vscreen?.querySelector?.(".bpm-readout, .lcd-status .pink")
  if (!readout) return
  readout.classList.remove(PULSE_CLASS)
  // Force a style boundary so repeated taps restart the pulse deterministically.
  void readout.offsetWidth
  readout.classList.add(PULSE_CLASS)
  clearTimeout(app._inputFeedbackBpmTimer)
  app._inputFeedbackBpmTimer = setTimeout(() => {
    app.vscreen?.querySelector?.(`.${PULSE_CLASS}`)?.classList.remove(PULSE_CLASS)
  }, 720)
}

export function installInputFeedbackRuntime(app) {
  if (!app || app._inputFeedbackRuntimeInstalled) return
  app._inputFeedbackRuntimeInstalled = true

  const root = app.root
  if (!root) return

  const baseRender = app.render.bind(app)
  app.render = (...args) => {
    const result = baseRender(...args)
    syncHold(app)
    return result
  }

  const press = (el) => el?.classList.add(PRESS_CLASS)
  const release = (el) => el?.classList.remove(PRESS_CLASS)

  root.addEventListener("pointerdown", (event) => {
    const el = event.target.closest?.("[data-action]")
    if (!el) return
    press(el)
    if (el.dataset.action === "soft-c") setTimeout(() => syncHold(app), 0)
  }, true)

  root.addEventListener("pointerup", (event) => {
    const el = event.target.closest?.("[data-action]")
    release(el)
    if (el?.dataset.action === "tap") setTimeout(() => pulseBpm(app), 0)
  }, true)

  const cancelPointer = (event) => {
    release(event.target.closest?.("[data-action]"))
  }
  root.addEventListener("pointercancel", cancelPointer, true)
  root.addEventListener("lostpointercapture", cancelPointer, true)
  window.addEventListener("pointerup", () => clearPressed(root), true)

  window.addEventListener("keydown", (event) => {
    if (event.repeat || editableTarget(event.target)) return
    press(feedbackElement(root, actionForKeyboard(event.code)))
  })

  window.addEventListener("keyup", (event) => {
    if (editableTarget(event.target)) return
    release(feedbackElement(root, actionForKeyboard(event.code)))
  })

  const clearTransient = () => clearPressed(root)
  window.addEventListener("blur", clearTransient)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") clearTransient()
  })

  syncHold(app)
}
