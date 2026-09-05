#!/usr/bin/env node
/**
 * Audio graph smoke: per-synth EQ/FX must not mutate the device master graph.
 * Requires dev server (https://127.0.0.1:3000/) and google-chrome.
 *
 * Usage: node test/smoke/audio_graph.mjs [url]
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "https://127.0.0.1:3000/"
const PORT = 9341
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-audio-graph")

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

    const engine = app.engine
    const before = {
      bass: engine.bassEq.gain.value,
      treble: engine.trebleEq.gain.value,
      wet: engine.wetGain.gain.value,
      delay: engine.delayGain.gain.value
    }

    app.synth.applyPatch({ bassDb: 9, trebleDb: -7, reverb: 0.81, delay: 0.64, pan: 0.4 })
    app.synth.noteOn(60, 0.5)
    const vox = app.synth.voices.get('60')

    const afterSynth = {
      bass: engine.bassEq.gain.value,
      treble: engine.trebleEq.gain.value,
      wet: engine.wetGain.gain.value,
      delay: engine.delayGain.gain.value
    }

    app.padSynth.applyPatch({ bassDb: -5, trebleDb: 4, reverb: 0.1, delay: 0.2 })
    const afterPad = {
      bass: engine.bassEq.gain.value,
      treble: engine.trebleEq.gain.value,
      wet: engine.wetGain.gain.value,
      delay: engine.delayGain.gain.value
    }

    app.synth.noteOff(60, true)

    const same = (a, b) => Math.abs(a - b) < 0.0001
    return {
      masterStableAfterSynth: Object.keys(before).every((k) => same(before[k], afterSynth[k])),
      masterStableAfterPad: Object.keys(before).every((k) => same(before[k], afterPad[k])),
      localEq: !!vox && same(vox.bassEq.gain.value, 9) && same(vox.trebleEq.gain.value, -7),
      localFx: !!vox && same(vox.revSend.gain.value, 0.81) && same(vox.delaySend.gain.value, 0.64 * 0.55),
      localPan: !!vox && same(vox.panner.pan.value, 0.4),
      synthStateUnchangedByPad: same(app.synth.bassDb, 9) && same(app.synth.reverb, 0.81)
    }
  })()`)

  if (out.fatal) fail(out.fatal)
  else {
    if (out.masterStableAfterSynth) pass("keyboard synth patch leaves master graph unchanged")
    else fail("keyboard synth patch mutated master graph")
    if (out.masterStableAfterPad) pass("pad synth patch leaves master graph unchanged")
    else fail("pad synth patch mutated master graph")
    if (out.localEq) pass("per-note bass/treble EQ created with patch values")
    else fail("per-note EQ values missing or wrong")
    if (out.localFx) pass("per-note reverb/delay sends created with patch values")
    else fail("per-note FX send values missing or wrong")
    if (out.localPan) pass("per-note pan created with patch value")
    else fail("per-note pan value missing or wrong")
    if (out.synthStateUnchangedByPad) pass("pad synth patch is isolated from keyboard synth state")
    else fail("pad synth patch contaminated keyboard synth state")
  }
} catch (e) {
  fail(e.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
