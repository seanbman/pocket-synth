#!/usr/bin/env node
/**
 * Loop record smoke: no backing bleed into recTap; overdub aligns to loop boundary.
 * Requires dev server (https://127.0.0.1:3000/) and google-chrome.
 *
 * Usage: node test/smoke/loop_record.mjs [url]
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "https://127.0.0.1:3000/"
const PORT = 9336
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile")

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
    const ctx = app.engine.ctx
    const le = app.loopEngine
    const tr = app.transport
    const sr = ctx.sampleRate
    app.metro.setOn(false)
    tr.bpm = 120
    const bars = 4
    const loopSec = tr.loopSec(bars)
    const samples = Math.floor(loopSec * sr)

    const mkTone = (hz) => {
      const b = ctx.createBuffer(2, samples, sr)
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c)
        for (let i = 0; i < samples; i++) d[i] = Math.sin(2 * Math.PI * hz * i / sr) * 0.4
      }
      return b
    }
    const peakHz = (buf, hz) => {
      if (!buf) return 0
      const d = buf.getChannelData(0)
      const n = Math.min(d.length, sr * 2)
      let re = 0, im = 0
      for (let i = 0; i < n; i++) {
        const ph = 2 * Math.PI * hz * i / sr
        re += d[i] * Math.cos(ph)
        im += d[i] * Math.sin(ph)
      }
      return Math.sqrt(re * re + im * im) / n
    }
    const rms = (buf) => {
      if (!buf) return 0
      const d = buf.getChannelData(0)
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]
      return Math.sqrt(s / d.length)
    }
    const peakIdx = (buf) => {
      if (!buf) return -1
      const d = buf.getChannelData(0)
      let best = 0, ix = 0
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i])
        if (v > best) { best = v; ix = i }
      }
      return ix
    }
    const press = (action) => {
      const btn = app.root.querySelector('[data-action="' + action + '"]')
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    }

    le.ensureGraph()
    le.tracks[0].buffer = mkTone(220)
    le.tracks[0].lengthBars = bars
    le.tracks[1].buffer = null
    le.tracks[1].lengthBars = bars
    le.select(2)
    le.tracks[1].armed = true

    // --- bleed test: silent record while track 1 plays
    press('play')
    for (let i = 0; i < 100 && !tr.playing; i++) await new Promise(r => setTimeout(r, 10))
    await new Promise(r => setTimeout(r, 500))
    const origin = tr._origin
    const now = ctx.currentTime
    const aligned = tr.nextLoopBoundary(origin, loopSec, now)
    le.beginRecord(2, { replace: false, startTime: aligned })
    await new Promise(r => setTimeout(r, loopSec * 1000 + 800))
    const bleed = { rms: rms(le.tracks[1].buffer), hz220: peakHz(le.tracks[1].buffer, 220) }

    // --- alignment test: keyboard hit shortly after aligned capture starts
    le.tracks[1].buffer = null
    press('play')
    await new Promise(r => setTimeout(r, 300))
    await new Promise(r => setTimeout(r, 700))
    const now2 = ctx.currentTime
    const aligned2 = tr.nextLoopBoundary(tr._origin, loopSec, now2)
    const waitMs = Math.max(0, (aligned2 - now2) * 1000)
    await new Promise(r => setTimeout(r, waitMs + 20))
    le.beginRecord(2, { replace: false, startTime: aligned2 })
    await new Promise(r => setTimeout(r, 30))
    app.padSynth.noteOn(69, 0.95, { recTrack: 2 })
    await new Promise(r => setTimeout(r, 120))
    app.padSynth.noteOff(69)
    await new Promise(r => setTimeout(r, loopSec * 1000 + 600))
    const pk = peakIdx(le.tracks[1].buffer)
    const align = {
      peakSample: pk,
      peakMs: +(pk / sr * 1000).toFixed(1),
      hz440: peakHz(le.tracks[1].buffer, 440),
      boundaryWaitMs: +waitMs.toFixed(1)
    }

    // --- monitor off: recording track silent during capture
    le.tracks[0].buffer = mkTone(220)
    le.playDuringRec = 'off'
    le.tracks[1].buffer = null
    press('play')
    await new Promise(r => setTimeout(r, 400))
    const chain0 = le._chains.get(1)
    const gainBefore = chain0?.input?.gain?.value ?? 1
    const now3 = ctx.currentTime
    const aligned3 = tr.nextLoopBoundary(tr._origin, loopSec, now3)
    le.beginRecord(2, { replace: false, startTime: aligned3 })
    await new Promise(r => setTimeout(r, 50))
    const recTrackGain = le._chains.get(2)?.input?.gain?.value ?? 1
    const backingGain = le._chains.get(1)?.input?.gain?.value ?? 1
    le.stopRecord()
    press('stop')
    app.stepSeq?.stop()

    return { bleed, align, monitor: { gainBefore, recTrackGain, backingGain, playDuringRec: le.playDuringRec } }
  })()`)

  console.log(JSON.stringify(out, null, 2))

  if (out.fatal) fail(out.fatal)
  else {
    if (out.bleed.rms < 0.001 && out.bleed.hz220 < 0.001) pass("no loop bleed into recTap")
    else fail(`bleed rms=${out.bleed.rms} hz220=${out.bleed.hz220}`)

    if (out.align.peakSample >= 0 && out.align.peakMs < 500) {
      pass(`keyboard peak near loop start (${out.align.peakMs}ms)`)
    } else fail(`misaligned peak at ${out.align.peakMs}ms (sample ${out.align.peakSample})`)

    if (out.monitor.recTrackGain < 0.01 && out.monitor.backingGain < 0.01) {
      pass("playDuringRec=off mutes backing + recording track during capture")
    } else fail(`monitor gains rec=${out.monitor.recTrackGain} backing=${out.monitor.backingGain}`)
  }

  ws.close()
} finally {
  chrome.kill()
}

process.exit(failed ? 1 : 0)
