#!/usr/bin/env node
/**
 * Step sequencer smoke: global pattern grid + per-track step seq open and render.
 * Requires dev server (https://127.0.0.1:3000/) and google-chrome.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "https://127.0.0.1:3000/"
const PORT = 9339
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-sequencer")

const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = false
const fail = (msg) => { failed = true; console.error("FAIL:", msg) }
const pass = (msg) => console.log("PASS:", msg)

try {
  await sleep(1500)
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension:")) || list[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
    return r.result.result.value
  }
  await send("Runtime.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true })
  await send("Page.navigate", { url: URL })
  await sleep(8000)

  const out = await evalJs(`(async () => {
    const app = window.Stimulus?.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="cassio"]'), 'cassio')?.app
    if (!app) return { fatal: 'no app' }
    await app.ensureAudioRunningPublic()
    app.looper.openHome()

    // Global pattern sequencer (6 lanes) via loop options soft key A
    app.screen = 'loop-options'
    app.loopOptIndex = 0
    app.render()
    app.looper.softKey('a')
    const globalScreen = app.screen
    const globalHtml = app.vscreen?.innerHTML || ''
    const globalLanes = (globalHtml.match(/seq-row/g) || []).length
    const globalTrackMode = app.seqTrackId

    app.seqCtl.back()
    const backToLoop = app.screen

    // Per-track step seq via track menu row 0
    app.looper.openHome()
    app.loopEngine.select(2)
    app.loopMenuIndex = 0
    app.screen = 'loop-menu'
    app.render()
    app.looper.nav('ok')
    const trackScreen = app.screen
    const trackHtml = app.vscreen?.innerHTML || ''
    const trackLanes = (trackHtml.match(/seq-row/g) || []).length
    const trackMode = app.seqTrackId

    app.seqCtl.nav('ok')
    const toggled = app.seqCtl.pattern.lanes?.[app.seqLane]?.[app.seqCursor]?.on

    return {
      fatal: null,
      globalScreen,
      globalLanes,
      globalTrackMode,
      backToLoop,
      trackScreen,
      trackLanes,
      trackMode,
      toggled
    }
  })()`)

  if (out.fatal) fail(out.fatal)
  else {
    if (out.globalScreen === "sequencer") pass("global pattern seq opens")
    else fail(`global screen ${out.globalScreen}`)
    if (out.globalTrackMode == null) pass("global mode (no seqTrackId)")
    else fail(`expected global mode, seqTrackId=${out.globalTrackMode}`)
    if (out.globalLanes === 6) pass("global grid shows 6 lanes")
    else fail(`global lanes ${out.globalLanes}`)
    if (out.backToLoop === "loop-tracks") pass("back returns to timeline")
    else fail(`back landed on ${out.backToLoop}`)
    if (out.trackScreen === "sequencer") pass("track step seq opens")
    else fail(`track screen ${out.trackScreen}`)
    if (out.trackMode === 2) pass("track mode seqTrackId=2")
    else fail(`track mode id ${out.trackMode}`)
    if (out.trackLanes === 1) pass("track grid shows 1 lane")
    else fail(`track lanes ${out.trackLanes}`)
    if (out.toggled) pass("OK toggles step on")
    else fail("step toggle failed")
  }
} catch (e) {
  fail(e.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
