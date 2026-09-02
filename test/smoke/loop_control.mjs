#!/usr/bin/env node
/**
 * Loop control smoke: STOP halts playback during record; mute/solo from loop-tracks.
 * Requires dev server (https://127.0.0.1:3000/) and google-chrome.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "https://127.0.0.1:3000/"
const PORT = 9338
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-loop-control")

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
    app.metro.setOn(false)
    app.transport.bpm = 120

    const ctx = app.engine.ctx
    const le = app.loopEngine
    const tr = app.transport
    const sr = ctx.sampleRate
    const samples = Math.floor(tr.loopSec(4) * sr)
    const buf = ctx.createBuffer(2, samples, sr)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < samples; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / sr) * 0.35
    }
    le.tracks[0].buffer = buf
    le.ensureGraph()

    tr.playAt(ctx.currentTime + 0.05)
    le.startPlayback(ctx.currentTime + 0.05)
    await new Promise((r) => setTimeout(r, 120))

    le.beginRecord(1, { replace: true, startTime: ctx.currentTime, onDone: () => {} })
    await new Promise((r) => setTimeout(r, 40))
    app.transportStopPublic?.()
    await new Promise((r) => setTimeout(r, 80))

    const playingAfterStop = tr.playing
    const sourcesAfterStop = le._sources.size

    app.looper.openHome()
    le.select(1)
    app.looper.softKey('b')
    const muted = le.tracks[0].mute
    le.refreshGains()

    app.looper.softKey('c')
    const solo = le.tracks[0].solo

    app.screen = 'loop-options'
    app.loopOptIndex = 2
    app.looper.nav('right')
    const quantize = le.quantize

    le.select(3)
    le.tracks[2].buffer = buf
    le.setTrackOffset(3, 10)
    app.looper.openHome()
    app.loopScrollFollow = true
    app.render()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const scroller = app.vscreen.querySelector('[data-loop-scroll]')
    const scrollLeft = scroller?.scrollLeft ?? 0
    const scrollWidth = scroller?.scrollWidth ?? 0
    const clientWidth = scroller?.clientWidth ?? 0
    const offsetSec = le.tracks[2].offsetSec

    return { playingAfterStop, sourcesAfterStop, muted, solo, quantize, scrollLeft, scrollWidth, clientWidth, offsetSec, fatal: null }
  })()`)

  if (out.fatal) fail(out.fatal)
  else {
    if (!out.playingAfterStop) pass("transport stopped during record")
    else fail(`transport still playing (${out.playingAfterStop})`)
    if (out.sourcesAfterStop === 0) pass("loop sources cleared on stop")
    else fail(`loop sources still running (${out.sourcesAfterStop})`)
    if (out.muted) pass("soft key B muted track")
    else fail("mute soft key failed")
    if (out.solo) pass("soft key C soloed track")
    else fail("solo soft key failed")
    if (out.quantize && out.quantize !== "1/16") pass(`quantize cycled (${out.quantize})`)
    else fail(`quantize not cycled (${out.quantize})`)
    if (out.offsetSec === 10) pass("track offset set to 10s")
    else fail(`offset ${out.offsetSec}`)
    if (out.scrollLeft > 0) pass(`timeline panned (${out.scrollLeft}px)`)
    else fail(`timeline did not pan (scrollLeft=${out.scrollLeft} sw=${out.scrollWidth} cw=${out.clientWidth})`)
  }
} catch (e) {
  fail(e.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
