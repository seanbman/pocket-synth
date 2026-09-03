#!/usr/bin/env node
/**
 * Step sequencer smoke: global + track seq, arrangement play schedules lane seq.
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

    // Assigned menu: DROP PATTERN, not Track Step Seq; Hold B = global Pattern Seq
    const le = app.loopEngine
    const lib = le.createLibraryTrack({ name: 'PAD2' })
    lib.padSlot = 2
    le.assignLibraryToLane(2, lib.id)
    app.looper.openHome()
    le.select(2)
    app.loopMenuIndex = 1
    app.screen = 'loop-menu'
    app.render()
    const menuHtml = app.vscreen?.innerHTML || ''
    const menuHasDrop = menuHtml.includes('DROP PATTERN')
    const menuNoTrackSeq = !menuHtml.includes('TRACK STEP SEQ')

    app.seqCtl.open()
    const patternScreen = app.screen
    const patternTrackId = app.seqTrackId
    const patternHtml = app.vscreen?.innerHTML || ''
    const patternLanes = (patternHtml.match(/seq-row/g) || []).length

    app.seqCtl.nav('ok')
    const toggled = app.seqCtl.pattern.lanes?.[app.seqLane]?.[app.seqCursor]?.on

    app.seqCtl.back()
    le.select(2)
    app.looper.dropPatternOnSelected()
    const lane2 = le.tracks.find((t) => t.id === 2)
    const bakedHits = !!lane2?.pattern?.lanes?.some((lane) => lane.some((s) => s?.on))
    const bakedDirty = !!lane2?.dirty

    // Arrangement play schedules baked 6-lane pattern
    app.transportStopPublic()
    app.looper.openHome()
    app.transportPlayPublic()
    await new Promise((r) => setTimeout(r, 80))
    const loopPlayContext = app.playContext
    const stepSeqOnLoop = app.stepSeq.running
    const arrMode = app.stepSeq._mode
    const bakedArmed = app.stepSeq._trackNext.has('pat:2')
    app.transportStopPublic()

    app.seqCtl.open()
    app.transportPlayPublic()
    await new Promise((r) => setTimeout(r, 80))
    const seqPlayContext = app.playContext
    const stepSeqOnSeq = app.stepSeq.running
    app.transportStopPublic()

    return {
      fatal: null,
      globalScreen,
      globalLanes,
      globalTrackMode,
      backToLoop,
      menuHasDrop,
      menuNoTrackSeq,
      patternScreen,
      patternTrackId,
      patternLanes,
      toggled,
      bakedHits,
      bakedDirty,
      loopPlayContext,
      stepSeqOnLoop,
      arrMode,
      bakedArmed,
      seqPlayContext,
      stepSeqOnSeq
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
    if (out.menuHasDrop && out.menuNoTrackSeq) pass("menu DROP PATTERN replaces Track Step Seq")
    else fail(`menu drop=${out.menuHasDrop} noTrackSeq=${out.menuNoTrackSeq}`)
    if (out.patternScreen === "sequencer") pass("Hold B / open() is Pattern Seq")
    else fail(`pattern screen ${out.patternScreen}`)
    if (out.patternTrackId == null) pass("Pattern Seq is global (no seqTrackId)")
    else fail(`expected global, seqTrackId=${out.patternTrackId}`)
    if (out.patternLanes === 6) pass("pattern grid shows 6 lanes")
    else fail(`pattern lanes ${out.patternLanes}`)
    if (out.toggled) pass("OK toggles step on")
    else fail("step toggle failed")
    if (out.bakedHits && out.bakedDirty) pass("DROP PATTERN bakes working copy onto lane")
    else fail(`baked hits=${out.bakedHits} dirty=${out.bakedDirty}`)
    if (out.loopPlayContext === "loop") pass("loop play uses loop context")
    else fail(`loop playContext ${out.loopPlayContext}`)
    if (out.stepSeqOnLoop && out.arrMode === "arrangement") pass("arrangement play runs lane step seq")
    else fail(`arrangement seq running=${out.stepSeqOnLoop} mode=${out.arrMode}`)
    if (out.bakedArmed) pass("arrangement schedules baked 6-lane pattern")
    else fail("baked pattern not armed on arrangement play")
    if (out.seqPlayContext === "seq") pass("sequencer play uses seq context")
    else fail(`seq playContext ${out.seqPlayContext}`)
    if (out.stepSeqOnSeq) pass("step seq runs on sequencer play")
    else fail("step seq not running on sequencer play")
  }
} catch (e) {
  fail(e.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
