#!/usr/bin/env node
/**
 * User-test regression: drive the real REC control from stop, wait through the
 * count-in, then interleave rapid pad + keyboard input while loop capture runs.
 *
 * The Node side keeps a hard CDP timeout so a renderer hang fails instead of
 * leaving CI stuck indefinitely.
 */
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createServer } from "node:net"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const profile = join(dirname(fileURLToPath(import.meta.url)), `.chrome-profile-stress-${process.pid}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function chromeBinary() {
  const requested = process.env.CHROME_BIN
  const candidates = [requested, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)
  for (const command of candidates) {
    if (command.includes("/")) return command
    const found = spawnSync("which", [command], { encoding: "utf8" })
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim()
  }
  throw new Error(`Chrome/Chromium not found; tried ${candidates.join(", ")}`)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function pollJson(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError || "no response"}`)
}

const PORT = await freePort()
const chrome = spawn(chromeBinary(), [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" })

let failed = false
const fail = (message) => { failed = true; console.error("FAIL:", message) }
const pass = (message) => console.log("PASS:", message)

try {
  await pollJson(`http://127.0.0.1:${PORT}/json/version`)
  const list = await pollJson(`http://127.0.0.1:${PORT}/json/list`)
  const page = list.find((target) => target.type === "page" && !target.url.startsWith("chrome-extension:")) || list[0]
  if (!page?.webSocketDebuggerUrl) throw new Error("No Chrome page target")

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, timer } = pending.get(message.id)
    clearTimeout(timer)
    pending.delete(message.id)
    resolve(message)
  }
  const send = (method, params = {}, timeoutMs = 20000) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method} (renderer may be hung)`))
    }, timeoutMs)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
  const evalJs = async (expression, timeoutMs = 20000) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, timeoutMs)
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text)
    }
    return response.result?.result?.value
  }

  await send("Runtime.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send("Page.navigate", { url: URL })

  const readyDeadline = Date.now() + 20000
  let ready = false
  while (Date.now() < readyDeadline) {
    try {
      ready = await evalJs(`(() => {
        const app = window.Stimulus?.getControllerForElementAndIdentifier(
          document.querySelector('[data-controller~="cassio"]'), 'cassio')?.app
        return !!app?.engine?.ready && !app?.booting && app?.screen === 'play'
      })()`, 2000)
      if (ready) break
    } catch (_) { /* page still booting */ }
    await sleep(250)
  }
  if (!ready) throw new Error("CASSIO did not finish booting to PLAY")

  const out = await evalJs(`(async () => {
    const app = window.Stimulus?.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="cassio"]'), 'cassio')?.app
    if (!app) return { fatal: 'no app' }
    await app.ensureAudioRunningPublic()

    const le = app.loopEngine
    const tr = app.transport
    tr.stop()
    app.stepSeq?.stop()
    le.stopPlayback()
    if (le.recording) le.stopRecord()

    // Start from one empty lane so REC exercises the actual auto-provision path.
    while (le.tracks.length > 1) le.removeLane(le.tracks[le.tracks.length - 1].id)
    le.clearLaneAssignment(le.tracks[0].id, { force: true })
    le.select(le.tracks[0].id)
    le.setLengthBars(4)
    le.applyDefaultLengthToEmpty(4)
    app.project.loop.countInBars = 1
    app.project.loop.quantize = '1/16'
    tr.bpm = 240
    app.project.bpm = 240
    app.playContext = null
    app.screen = 'loop-tracks'
    app.render()

    const fire = (action) => {
      const button = app.root.querySelector('[data-action="' + action + '"]')
      if (!button) throw new Error('missing hardware action ' + action)
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch' }))
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' }))
    }
    const waitFor = async (predicate, timeoutMs, label) => {
      const deadline = performance.now() + timeoutMs
      while (performance.now() < deadline) {
        if (predicate()) return true
        await new Promise(r => setTimeout(r, 10))
      }
      throw new Error('timeout waiting for ' + label)
    }

    fire('rec')
    await waitFor(() => tr.countingIn, 1500, 'count-in')
    await waitFor(() => tr.recording && le.recording, 3000, 'recording after count-in')

    let maxLagMs = 0
    let beats = 0
    let lastBeat = performance.now()
    const heartbeat = setInterval(() => {
      const now = performance.now()
      maxLagMs = Math.max(maxLagMs, now - lastBeat - 20)
      lastBeat = now
      beats++
    }, 20)

    const started = performance.now()
    const keyDegrees = [0, 2, 4, 5, 7, 9, 11, 12]
    for (let i = 0; i < 160; i++) {
      fire('pad-' + ((i % 6) + 1))
      fire('key-' + keyDegrees[i % keyDegrees.length])
      await new Promise(r => setTimeout(r, 7))
    }
    const stressMs = performance.now() - started

    // Stop through the same REC control users press. This also exercises take
    // finalization and the input-only recording runtime cleanup.
    if (tr.recording || le.recording) fire('rec')
    await waitFor(() => !tr.recording && !le.recording, 3000, 'record stop/finalize')
    await new Promise(r => setTimeout(r, 150))
    clearInterval(heartbeat)

    const track = le.tracks.find(t => t.assigned)
    return {
      fatal: null,
      maxLagMs: +maxLagMs.toFixed(1),
      heartbeatTicks: beats,
      stressMs: +stressMs.toFixed(1),
      transportPlaying: tr.playing,
      transportRecording: tr.recording,
      loopRecording: le.recording,
      inputOnly: !!app._recordInputOnly,
      playContext: app.playContext,
      assigned: !!track?.assigned,
      hasBuffer: !!track?.buffer,
      bufferSeconds: track?.buffer ? +track.buffer.duration.toFixed(2) : 0,
      synthVoices: app.synth?.voices?.size ?? null,
      padSynthVoices: app.padSynth?.voices?.size ?? null,
      screen: app.screen
    }
  })()`, 30000)

  console.log(JSON.stringify(out, null, 2))
  if (out?.fatal) fail(out.fatal)
  else {
    if (out.assigned && out.hasBuffer) pass(`real REC path produced a ${out.bufferSeconds}s take`)
    else fail("real REC path did not produce an assigned audio take")
    if (!out.transportRecording && !out.loopRecording && !out.inputOnly) pass("REC cleanup returned to a non-recording state")
    else fail(`recording state leaked: ${JSON.stringify(out)}`)
    if (out.maxLagMs < 750) pass(`renderer stayed responsive under live-input stress (max lag ${out.maxLagMs}ms)`)
    else fail(`renderer event-loop stall ${out.maxLagMs}ms`)
    if (out.stressMs < 5000 && out.heartbeatTicks >= 20) pass(`stress loop completed in ${out.stressMs}ms with ${out.heartbeatTicks} heartbeat ticks`)
    else fail(`stress loop responsiveness degraded: ${out.stressMs}ms / ${out.heartbeatTicks} ticks`)
  }

  ws.close()
} catch (error) {
  fail(error?.stack || String(error))
} finally {
  chrome.kill()
}

process.exit(failed ? 1 : 0)
