#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9347
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-input-feedback")
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = false
const pass = (msg) => console.log(`PASS: ${msg}`)
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`) }

async function waitChrome() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) return await res.json()
    } catch (_) { /* retry */ }
    await sleep(250)
  }
  throw new Error("Chrome debug endpoint unavailable")
}

try {
  const targets = await waitChrome()
  const page = targets.find((t) => t.type === "page") || targets[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (!msg.id || !pending.has(msg.id)) return
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id
    pending.set(callId, resolve)
    ws.send(JSON.stringify({ id: callId, method, params }))
  })
  const evalJs = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text)
    return reply.result?.result?.value
  }

  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send("Page.navigate", { url: URL })
  await sleep(8000)

  const result = await evalJs(`(async () => {
    const root = document.querySelector('[data-controller~="cassio"]')
    const app = window.Stimulus?.getControllerForElementAndIdentifier(root, 'cassio')?.app
    if (!app?._inputFeedbackRuntimeInstalled) return { fatal: 'input feedback runtime missing' }
    app.screen = 'play'
    app.project.hold = false
    app.render()

    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const el = (action) => root.querySelector('[data-action="' + action + '"]')
    const pointer = (action, type, pointerId, pointerType = 'mouse') => {
      const target = el(action)
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType,
        isPrimary: true,
        buttons: type === 'pointerdown' ? 1 : 0
      }))
      return target
    }

    const pad1 = pointer('pad-1', 'pointerdown', 11, 'mouse')
    await wait(30)
    const mouseDown = pad1.classList.contains('feedback-pressed')
    const cssLoaded = getComputedStyle(pad1).touchAction === 'manipulation' && getComputedStyle(pad1).transform !== 'none'
    pointer('pad-1', 'pointerup', 11, 'mouse')
    await wait(30)
    const mouseReleased = !pad1.classList.contains('feedback-pressed')

    const pad2 = pointer('pad-2', 'pointerdown', 12, 'touch')
    await wait(30)
    const touchDown = pad2.classList.contains('feedback-pressed')
    pointer('pad-2', 'pointercancel', 12, 'touch')
    await wait(30)
    const touchCancelled = !pad2.classList.contains('feedback-pressed')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', bubbles: true }))
    await wait(30)
    const mappedPadDown = el('pad-3').classList.contains('feedback-pressed')
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit3', bubbles: true }))
    await wait(30)
    const mappedPadUp = !el('pad-3').classList.contains('feedback-pressed')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true }))
    await wait(30)
    const mappedKeyDown = el('key-0').classList.contains('feedback-pressed')
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ', bubbles: true }))
    await wait(30)
    const mappedKeyUp = !el('key-0').classList.contains('feedback-pressed')

    pointer('pad-4', 'pointerdown', 14, 'touch')
    await wait(20)
    window.dispatchEvent(new Event('blur'))
    await wait(30)
    const blurClears = !root.querySelector('.feedback-pressed')

    pointer('soft-c', 'pointerdown', 15, 'mouse')
    pointer('soft-c', 'pointerup', 15, 'mouse')
    await wait(80)
    const softC = el('soft-c')
    const holdOn = app.project.hold === true
      && softC.classList.contains('feedback-latched')
      && softC.getAttribute('aria-pressed') === 'true'
      && !!app.vscreen.querySelector('.hold-state.on')
      && app.vscreen.textContent.includes('HOLD ON')

    pointer('soft-c', 'pointerdown', 16, 'mouse')
    pointer('soft-c', 'pointerup', 16, 'mouse')
    await wait(80)
    const holdOff = app.project.hold === false
      && !softC.classList.contains('feedback-latched')
      && softC.getAttribute('aria-pressed') === 'false'
      && !app.vscreen.querySelector('.hold-state.on')

    const tap = pointer('tap', 'pointerdown', 17, 'touch')
    const tapPressed = tap.classList.contains('feedback-pressed')
    pointer('tap', 'pointerup', 17, 'touch')
    await wait(80)
    const bpmPulse = !!app.vscreen.querySelector('.feedback-pulse')
    const tapMessage = /TAP TEMPO|BPM/.test(app.vscreenOverlay?.textContent || '')
    const tapReleased = !tap.classList.contains('feedback-pressed')
    await wait(800)
    const bpmPulseClears = !app.vscreen.querySelector('.feedback-pulse')

    const chassis = root.querySelector('.chassis').getBoundingClientRect()
    const contained = chassis.left >= -1 && chassis.right <= innerWidth + 1
      && document.documentElement.scrollWidth <= innerWidth + 1

    return {
      fatal: null,
      mouseDown,
      cssLoaded,
      mouseReleased,
      touchDown,
      touchCancelled,
      mappedPadDown,
      mappedPadUp,
      mappedKeyDown,
      mappedKeyUp,
      blurClears,
      holdOn,
      holdOff,
      tapPressed,
      bpmPulse,
      tapMessage,
      tapReleased,
      bpmPulseClears,
      contained
    }
  })()`)

  if (result?.fatal) throw new Error(result.fatal)
  for (const [name, ok] of Object.entries(result || {})) {
    if (name === "fatal") continue
    if (ok) pass(name)
    else fail(name)
  }

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
