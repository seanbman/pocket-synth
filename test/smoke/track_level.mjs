#!/usr/bin/env node
import { spawn } from "node:child_process"

const URL = process.argv[2] || "https://127.0.0.1:3000/"
const PORT = 9341
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`, "about:blank"
], { stdio: "ignore" })

try {
  await sleep(1500)
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === "page")
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
  await send("Runtime.enable")
  await send("Page.navigate", { url: URL })
  await sleep(8000)

  const r = await send("Runtime.evaluate", {
    expression: `(async () => {
      const app = window.Stimulus?.getControllerForElementAndIdentifier(
        document.querySelector('[data-controller~="cassio"]'), 'cassio')?.app
      await app.ensureAudioRunningPublic()
      app.looper.openHome()
      const le = app.loopEngine
      const ctx = app.engine.ctx
      const sr = ctx.sampleRate
      const samples = Math.floor(app.transport.loopSec(4) * sr)
      const buf = ctx.createBuffer(2, samples, sr)
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c)
        for (let i = 0; i < samples; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5
      }
      le.tracks[0].buffer = buf
      delete le.tracks[0].level
      le.ensureGraph()
      le.refreshGains()
      const chain = le._chains.get(1)
      const bad = chain.level.gain.value
      le.tracks[0].level = 0.25
      le.refreshGains()
      await new Promise((r) => setTimeout(r, 120))
      const fixed = chain.level.gain.value
      app.looper.nudgeKnob('m1', -0.4)
      await new Promise((r) => setTimeout(r, 120))
      const nudged = chain.level.gain.value
      return { bad, fixed, nudged, lvl: le.tracks[0].level, fxLvl: le.tracks[0].fx?.level }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  console.log(JSON.stringify(r.result.result.value, null, 2))
} finally {
  chrome.kill("SIGTERM")
}
