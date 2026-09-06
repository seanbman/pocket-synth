#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const URL = process.argv[2] || process.env.CASSIO_URL || "http://127.0.0.1:3000/"
const PORT = 9351
const profile = join(dirname(fileURLToPath(import.meta.url)), ".chrome-profile-post-pr12")
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
  const page = targets.find((target) => target.type === "page") || targets[0]
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
    if (!app?._postPr12StabilizationInstalled) return { fatal: 'post-PR12 stabilization runtime missing' }
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const darkStart = getComputedStyle(document.body).backgroundColor === 'rgb(5, 5, 5)'
      && !document.body.textContent.trim().match(/^$/)

    while (app.loopEngine.tracks.length < 10) app.loopEngine.addLane()
    const target = app.loopEngine.tracks[app.loopEngine.tracks.length - 1]
    const library = app.loopEngine.createLibraryTrack({ name: 'PIANO TAKE', lengthBars: 4 })
    app.loopEngine.assignLibraryToLane(target.id, library.id)
    app.loopEngine.select(target.id)
    app.screen = 'loop-tracks'
    app.loopScrollTop = 0
    app.loopScrollFollow = true
    app.render()
    await wait(180)
    const scroller = app.vscreen.querySelector('[data-loop-scroll]')
    const selected = app.vscreen.querySelector('.loop-trow.sel')
    const sr = scroller.getBoundingClientRect()
    const rr = selected.getBoundingClientRect()
    const rulerH = app.vscreen.querySelector('.loop-ruler-row')?.getBoundingClientRect().height || 0
    const verticalFollow = scroller.scrollTop > 0 && rr.top >= sr.top + rulerH - 2 && rr.bottom <= sr.bottom + 2

    target.buffer = app.engine.ctx.createBuffer(1, 256, app.engine.ctx.sampleRate)
    target.seq.steps[0] = { ...target.seq.steps[0], on: true }
    target.pattern = { marker: 'must-clear' }
    const retainedLibraryId = target.libraryTrackId
    const cleared = app.loopEngine.clear(target.id)
    const clearAllMaterial = cleared
      && target.buffer == null
      && target.pattern == null
      && !target.seq.steps.some((step) => step?.on)
      && target.assigned === true
      && target.libraryTrackId === retainedLibraryId
      && !!app.loopEngine.getLibraryTrack(retainedLibraryId)

    app.screen = 'settings-display'
    app.settingsRuntime.pageIndex = 3
    app.settingsRuntime.update({ dimLevel: 0.12 })
    const dimPreview = app.settingsRuntime._displayMode === 'dim'
      && Math.abs(Number(root.style.getPropertyValue('--lcd-brightness-effective')) - 0.12) < 0.001

    localStorage.removeItem('cassio.debug')
    app.render()
    await wait(30)
    const marker = document.querySelector('[data-cassio-glitch-marker]')
    const markerHiddenNormally = !marker || marker.hidden === true
    localStorage.setItem('cassio.debug', '1')
    app.render()
    await wait(30)
    const markerShownInDev = !marker || marker.hidden === false
    localStorage.removeItem('cassio.debug')
    app.render()

    const { showStartupFailure } = await import('cassio/startup_guard')
    const panel = showStartupFailure(root, new Error('SMOKE STARTUP FAILURE'), { reload: () => {} })
    const startupGuard = !!panel
      && panel.textContent.includes('STARTUP ERROR')
      && getComputedStyle(panel).backgroundColor === 'rgb(5, 5, 5)'
      && root.getAttribute('data-cassio-startup-error') === 'true'
    panel.remove()
    root.removeAttribute('data-cassio-startup-error')

    return {
      fatal: null,
      darkStart,
      verticalFollow,
      clearAllMaterial,
      dimPreview,
      markerHiddenNormally,
      markerShownInDev,
      startupGuard
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
