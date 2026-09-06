#!/usr/bin/env node
/**
 * Regression for the 2026-09-05 user-test blocker:
 * LOOP REC -> count-in -> live pad/piano input must not hang the tab.
 *
 * This deliberately drives the visible hardware controls rather than calling
 * LoopEngine.beginRecord directly, so it exercises count-in, REC orchestration,
 * pointer input, recording teardown, and repeated-record lifecycle behavior.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9341
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-interactive-record")
const chromeBin = process.env.CHROME_BIN || "google-chrome"
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deadline = async (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
])

let failed = false
const pass = (msg) => console.log(`PASS: ${msg}`)
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`) }

try {
  await sleep(1500)
  const targets = await deadline(fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()), 5000, "Chrome target list")
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension:")) || targets[0]
  if (!page?.webSocketDebuggerUrl) throw new Error("No Chrome page target")

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await deadline(new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject }), 5000, "CDP websocket")
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (!msg.id || !pending.has(msg.id)) return
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  const send = (method, params = {}) => deadline(new Promise((resolve) => {
    const callId = ++id
    pending.set(callId, resolve)
    ws.send(JSON.stringify({ id: callId, method, params }))
  }), 6000, method)
  const evalJs = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text)
    }
    return reply.result?.result?.value
  }

  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send("Page.navigate", { url: URL })
  await sleep(7000)

  const setup = await evalJs(`(async () => {
    const app = window.Stimulus?.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="cassio"]'), 'cassio')?.app
    if (!app) return { fatal: 'no app' }
    await app.ensureAudioRunningPublic()
    app.metro.setOn(false)
    app.transport.bpm = 120
    app.project.bpm = 120
    app.project.loop ||= {}
    app.project.loop.countInBars = 1
    app.project.loop.quantize = '1/16'
    app.loopEngine.setLengthBars(1)
    app.loopEngine.applyDefaultLengthToEmpty(1)
    app.screen = 'loop-tracks'
    app.render()
    const rec = app.root.querySelector('[data-action="rec"]')
    const stop = app.root.querySelector('[data-action="stop"]')
    const pad = app.root.querySelector('[data-action="pad-1"]')
    const key = app.root.querySelector('.keyboard .key[data-action]')
    const rect = key?.getBoundingClientRect()
    return {
      fatal: (!rec || !stop || !pad || !key) ? 'missing hardware control' : null,
      keyPoint: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.7 } : null,
      selected: app.loopEngine.selected
    }
  })()`)
  if (setup?.fatal) throw new Error(setup.fatal)

  const pointerControl = async (action) => evalJs(`(() => {
    const app = window.Stimulus.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="cassio"]'), 'cassio').app
    const el = app.root.querySelector('[data-action="${action}"]')
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 71, clientX: 10, clientY: 10 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 71, clientX: 10, clientY: 10 }))
    return true
  })()`)

  const state = () => evalJs(`(() => {
    const app = window.Stimulus.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="cassio"]'), 'cassio').app
    return {
      now: performance.now(),
      countingIn: app.transport.countingIn,
      transportRecording: app.transport.recording,
      loopRecording: app.loopEngine.recording,
      playing: app.transport.playing,
      recordInputOnly: app._recordInputOnly === true,
      seqRunning: app.stepSeq.running,
      seqScheduled: app.stepSeq._scheduled?.length || 0,
      transportScheduled: app.transport._scheduled?.length || 0,
      heldPads: app.heldPads?.size || 0,
      heldKeys: app.heldKeys?.size || 0
    }
  })()`)

  const waitFor = async (predicate, timeoutMs, label) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const snapshot = await state()
      if (predicate(snapshot)) return snapshot
      await sleep(40)
    }
    throw new Error(`${label} not reached`)
  }

  for (let cycle = 1; cycle <= 3; cycle++) {
    await pointerControl("rec")
    const counting = await waitFor((s) => s.countingIn, 1500, `cycle ${cycle} count-in`)
    if (counting.transportRecording || counting.loopRecording) fail(`cycle ${cycle}: recording began before count-in completed`)

    const recording = await waitFor((s) => s.loopRecording && s.transportRecording, 3500, `cycle ${cycle} recording`)
    if (!recording.recordInputOnly) fail(`cycle ${cycle}: REC-from-stop was not input-only`)
    if (recording.seqRunning || recording.seqScheduled > 0) fail(`cycle ${cycle}: sequencer scheduled during input-only take`)

    // Actual pad hardware pointer path.
    await pointerControl("pad-1")
    const afterPad = await state()
    if (!afterPad.loopRecording) fail(`cycle ${cycle}: recording stopped unexpectedly after pad hit`)
    else pass(`cycle ${cycle}: pad hit kept browser responsive`)

    // Actual piano pointer path through the keyboard's pointer-capture handler.
    const keyPoint = setup.keyPoint
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: keyPoint.x, y: keyPoint.y, button: "left", clickCount: 1 })
    await sleep(90)
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: keyPoint.x, y: keyPoint.y, button: "left", clickCount: 1 })
    const afterKey = await state()
    if (!afterKey.loopRecording) fail(`cycle ${cycle}: recording stopped unexpectedly after piano hit`)
    else pass(`cycle ${cycle}: piano hit kept browser responsive`)

    await pointerControl("stop")
    const stopped = await waitFor((s) => !s.loopRecording && !s.transportRecording && !s.playing, 2000, `cycle ${cycle} stop`)
    if (stopped.seqRunning) fail(`cycle ${cycle}: sequencer remained running after STOP`)
    if (stopped.heldPads || stopped.heldKeys) fail(`cycle ${cycle}: held input leaked after STOP`)
    pass(`cycle ${cycle}: REC/count-in/live-input/STOP lifecycle completed`)
    await sleep(120)
  }

  const final = await state()
  if (final.seqScheduled > 8) fail(`scheduler residue grew unexpectedly: seq=${final.seqScheduled}`)
  else pass(`scheduler residue bounded after repeated recording (${final.seqScheduled})`)

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill()
}

process.exit(failed ? 1 : 0)
