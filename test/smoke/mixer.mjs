#!/usr/bin/env node
/**
 * Mixer smoke: open from menu, mute/solo/level persist on loop tracks.
 * Requires dev server (https://127.0.0.1:3000/) and google-chrome.
 *
 * Usage: node test/smoke/mixer.mjs [url]
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "https://127.0.0.1:3000/"
const PORT = 9337
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-mixer")

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

    const le = app.loopEngine
    const lib = le.createLibraryTrack({ name: 'MIX2' })
    le.assignLibraryToLane(2, lib.id)

    app.mixer.open('menu')
    if (app.screen !== 'mixer') return { fatal: 'mixer not open', screen: app.screen }

    app.loopEngine.select(2)
    app.mixer.nudgeKnob('m1', -0.3)
    app.mixer.softKey('a') // mute
    app.mixer.softKey('b') // solo (clears mute)
    const t2 = app.loopEngine.tracks[1]
    const level = t2.level
    const solo = t2.solo
    const mute = t2.mute

    app.mixer.softKey('d')
    if (app.screen !== 'loop-tracks') return { fatal: 'D did not return to loop', screen: app.screen }

    const t2b = app.loopEngine.tracks[1]
    return {
      level: t2b.level,
      solo: t2b.solo,
      mute: t2b.mute,
      levelOk: Math.abs(t2b.level - level) < 0.01,
      soloOk: t2b.solo === solo,
      muteOk: t2b.mute === mute
    }
  })()`)

  if (out.fatal) fail(out.fatal)
  else {
    if (out.levelOk) pass(`level persisted (${out.level})`)
    else fail(`level not persisted (${out.level})`)
    if (out.soloOk) pass(`solo persisted (${out.solo})`)
    else fail(`solo not persisted (${out.solo})`)
    if (out.muteOk) pass(`mute persisted (${out.mute})`)
    else fail(`mute not persisted (${out.mute})`)
  }
} catch (e) {
  fail(e.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
