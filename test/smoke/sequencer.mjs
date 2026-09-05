#!/usr/bin/env node
/**
 * Step sequencer smoke: global + track-local seq, arrangement play schedules lane seq.
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

    // Loop Options remains the shared/global Pattern A-D editor.
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

    const le = app.loopEngine

    // Give Track 2 its own working track, then enter PATTERN SEQ from its track menu.
    const lib2 = le.createLibraryTrack({ name: 'PAD2' })
    lib2.padSlot = 2
    le.assignLibraryToLane(2, lib2.id)
    le.select(2)
    app.loopMenuIndex = 0
    app.screen = 'loop-menu'
    app.render()
    const menuHtml = app.vscreen?.innerHTML || ''
    const menuHasPatternSeq = menuHtml.includes('PATTERN SEQ')
    app.looper.nav('ok')
    const track2Screen = app.screen
    const track2Id = app.seqTrackId
    const track2Lanes = ((app.vscreen?.innerHTML || '').match(/seq-row/g) || []).length
    app.seqCursor = 0
    app.seqCtl.nav('ok')
    const lane2 = le.tracks.find((t) => t.id === 2)
    const track2Step0 = !!lane2?.seq?.steps?.[0]?.on
    app.seqCtl.back()

    // Track 1 must open a different seq object and start independently empty.
    const lib1 = le.createLibraryTrack({ name: 'PAD1' })
    lib1.padSlot = 1
    le.assignLibraryToLane(1, lib1.id)
    le.select(1)
    app.loopMenuIndex = 0
    app.screen = 'loop-menu'
    app.render()
    app.looper.nav('ok')
    const track1Id = app.seqTrackId
    const lane1 = le.tracks.find((t) => t.id === 1)
    const track1InitiallyOff = !lane1?.seq?.steps?.[0]?.on
    app.seqCursor = 1
    app.seqCtl.nav('ok')
    const track1Step1 = !!lane1?.seq?.steps?.[1]?.on
    const track2StillOwn = !!lane2?.seq?.steps?.[0]?.on && !lane2?.seq?.steps?.[1]?.on
    const seqObjectsIndependent = lane1?.seq !== lane2?.seq && lane1?.seq?.steps !== lane2?.seq?.steps
    app.seqCtl.back()

    // Global bank is still available and can be dropped/baked deliberately.
    app.screen = 'loop-options'
    app.loopOptIndex = 0
    app.render()
    app.looper.softKey('a')
    const globalAgainTrackId = app.seqTrackId
    app.seqLane = 1
    app.seqCursor = 0
    app.seqCtl.nav('ok')
    const globalToggled = app.seqCtl.pattern.lanes?.[1]?.[0]?.on
    app.seqCtl.back()

    le.select(2)
    app.looper.dropPatternOnSelected()
    const bakedHits = !!lane2?.pattern?.lanes?.some((lane) => lane.some((s) => s?.on))
    const bakedDirty = !!lane2?.dirty

    // Clip window: shorten/lengthen updates lengthBars + audible window (not tiled past clip)
    le.lengthBars = 4
    le.setTrackLengthBars(2, 2)
    const origin = app.engine.now()
    le._playOrigin = origin
    const barSec = app.transport.barSec()
    const inClip = !!le.clipLocalSec(lane2, origin + 0.1 * barSec, origin)
    const pastClip = le.clipLocalSec(lane2, origin + 2.5 * barSec, origin)
    le.setTrackLengthBars(2, 4)
    const afterLenIn = !!le.clipLocalSec(lane2, origin + 2.5 * barSec, origin)
    le.setTrackLengthBars(2, 2)
    app.looper.openHome()
    app.render()
    const htmlShort = app.vscreen?.innerHTML || ''
    const clipShort = htmlShort.includes('data-track-id="2"')
    const clipEl = app.vscreen.querySelector('.loop-clip[data-track-id="2"]')
    const clipW = clipEl ? parseFloat(clipEl.style.width) : 0
    const timelineW = 4 * 52
    const clipLooksShort = clipW > 0 && clipW < timelineW * 0.6

    // Arrangement play schedules track-local/baked sequence state.
    app.transportStopPublic()
    app.looper.openHome()
    app.transportPlayPublic()
    await new Promise((r) => setTimeout(r, 80))
    const loopPlayContext = app.playContext
    const stepSeqOnLoop = app.stepSeq.running
    const arrMode = app.stepSeq._mode
    const bakedArmed = app.stepSeq._trackNext.has('pat:2')
    const pastWhilePlaying = le.clipLocalSec(
      lane2,
      (le._playOrigin || origin) + 2.5 * barSec,
      le._playOrigin || origin
    )
    app.transportStopPublic()

    app.screen = 'loop-options'
    app.loopOptIndex = 0
    app.render()
    app.looper.softKey('a')
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
      menuHasPatternSeq,
      track2Screen,
      track2Id,
      track2Lanes,
      track2Step0,
      track1Id,
      track1InitiallyOff,
      track1Step1,
      track2StillOwn,
      seqObjectsIndependent,
      globalAgainTrackId,
      globalToggled,
      bakedHits,
      bakedDirty,
      inClip,
      pastClipNull: pastClip == null,
      afterLenIn,
      clipLooksShort,
      clipShort,
      loopPlayContext,
      stepSeqOnLoop,
      arrMode,
      bakedArmed,
      pastWhilePlayingNull: pastWhilePlaying == null,
      seqPlayContext,
      stepSeqOnSeq
    }
  })()`)

  if (out.fatal) fail(out.fatal)
  else {
    if (out.globalScreen === "sequencer") pass("global Pattern Seq opens from Loop Options")
    else fail(`global screen ${out.globalScreen}`)
    if (out.globalTrackMode == null) pass("Loop Options keeps global mode")
    else fail(`expected global mode, seqTrackId=${out.globalTrackMode}`)
    if (out.globalLanes === 6) pass("global grid shows 6 lanes")
    else fail(`global lanes ${out.globalLanes}`)
    if (out.backToLoop === "loop-tracks") pass("back returns to timeline")
    else fail(`back landed on ${out.backToLoop}`)
    if (out.menuHasPatternSeq) pass("track menu exposes PATTERN SEQ")
    else fail("track menu missing PATTERN SEQ")
    if (out.track2Screen === "sequencer" && out.track2Id === 2) pass("Track 2 menu opens Track 2 local seq")
    else fail(`Track 2 screen=${out.track2Screen} seqTrackId=${out.track2Id}`)
    if (out.track2Lanes === 6) pass("track-local grid renders in sequencer")
    else fail(`track-local lanes ${out.track2Lanes}`)
    if (out.track2Step0) pass("Track 2 step edit lands in Track 2 seq")
    else fail("Track 2 step was not stored locally")
    if (out.track1Id === 1 && out.track1InitiallyOff) pass("Track 1 opens independently from Track 2")
    else fail(`Track 1 id=${out.track1Id} initiallyOff=${out.track1InitiallyOff}`)
    if (out.track1Step1 && out.track2StillOwn && out.seqObjectsIndependent) pass("Track 1 and Track 2 pattern data are isolated")
    else fail(`isolation t1=${out.track1Step1} t2=${out.track2StillOwn} refs=${out.seqObjectsIndependent}`)
    if (out.globalAgainTrackId == null && out.globalToggled) pass("global A-D bank remains separate and editable")
    else fail(`global trackId=${out.globalAgainTrackId} toggled=${out.globalToggled}`)
    if (out.bakedHits && out.bakedDirty) pass("DROP PATTERN bakes global pattern copy onto selected lane")
    else fail(`baked hits=${out.bakedHits} dirty=${out.bakedDirty}`)
    if (out.inClip && out.pastClipNull) pass("2-bar clip: audible in window, silent past clip")
    else fail(`clip window in=${out.inClip} pastNull=${out.pastClipNull}`)
    if (out.afterLenIn) pass("lengthen to 4 bars extends audible window")
    else fail("lengthen did not open window at bar 3")
    if (out.clipLooksShort) pass("shortened length shrinks pink clip")
    else fail(`clip width not short (clipShort=${out.clipShort})`)
    if (out.loopPlayContext === "loop") pass("loop play uses loop context")
    else fail(`loop playContext ${out.loopPlayContext}`)
    if (out.stepSeqOnLoop && out.arrMode === "arrangement") pass("arrangement play runs lane step seq")
    else fail(`arrangement seq running=${out.stepSeqOnLoop} mode=${out.arrMode}`)
    if (out.bakedArmed) pass("arrangement schedules baked 6-lane pattern")
    else fail("baked pattern not armed on arrangement play")
    if (out.pastWhilePlayingNull) pass("playing: bar 3 still outside 2-bar clip window")
    else fail("playing past-clip window not silent")
    if (out.seqPlayContext === "seq") pass("global sequencer play uses seq context")
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
