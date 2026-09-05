#!/usr/bin/env node
/**
 * Sequencer smoke: global six-pad bank plus arbitrary, pad-independent track
 * sound lanes. Requires dev server and google-chrome.
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = false
const fail = (msg) => { failed = true; console.error("FAIL:", msg) }
const pass = (msg) => console.log("PASS:", msg)

try {
  await sleep(1500)
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((target) => target.type === "page" && !target.url.startsWith("chrome-extension:")) || list[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id
    pending.set(requestId, resolve)
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
  const evalJs = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (response.result.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text)
    }
    return response.result.result.value
  }

  await send("Runtime.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 932,
    deviceScaleFactor: 2,
    mobile: true
  })
  await send("Page.navigate", { url: URL })
  await sleep(8000)

  const out = await evalJs(`(async () => {
    const app = window.Stimulus?.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="cassio"]'), 'cassio'
    )?.app
    if (!app) return { fatal: 'no app' }
    await app.ensureAudioRunningPublic()
    app.transportStopPublic()

    const playable = (app.factory?.sounds || []).filter((sound) =>
      sound?.playable !== false && sound?.kind !== 'kit' && sound?.voice !== 'kit'
    )
    if (playable.length < 7) return { fatal: 'need at least seven playable factory sounds' }

    // Loop Options remains the fixed global six-pad A-D editor.
    app.screen = 'loop-options'
    app.render()
    app.seqCtl.open()
    const globalTrackId = app.seqTrackId
    const globalRows = (app.vscreen?.innerHTML.match(/seq-row/g) || []).length
    app.seqCtl.back()

    const le = app.loopEngine
    const lib2 = le.createLibraryTrack({ name: 'DYNAMIC SEVEN' })
    le.assignLibraryToLane(2, lib2.id)
    const track2 = le.tracks.find((track) => track.id === 2)
    track2.pattern = null
    track2.seq.enabled = false
    le.select(2)
    app.screen = 'loop-menu'
    app.render()
    app.seqCtl.open(2)

    // Reuse physical Pad 1 with seven different sound assignments. Each press
    // inserts at the cursor and captures a new sound lane by value.
    const slot = app.project.pads.find((pad) => pad.pad === 1)
    for (let i = 0; i < 7; i++) {
      slot.soundId = playable[i].id
      slot.patch = null
      slot.level = 1
      slot.pan = 0
      slot.mode = playable[i].padMode || 'oneshot'
      app.seqCursor = i
      app.seqCtl.selectLane(1)
    }

    const laneCount7 = track2.pattern?.lanes?.length
    const sourceIdsBefore = track2.pattern?.sources?.map((source) => source.soundId) || []
    const uniqueSources = new Set(sourceIdsBefore).size
    const eachLaneOwnHit = track2.pattern?.lanes?.every((lane, i) => !!lane?.[i]?.on)
    const selectedLane7 = app.seqLane === 6
    const secondLanePage = (app.vscreen?.innerHTML || '').includes('LANES 7–7/7')

    // Reassigning the pad does not mutate any already captured lane source.
    slot.soundId = playable[0].id
    slot.pan = 0.75
    const stableAfterPadChange = sourceIdsBefore.every((id, i) => track2.pattern.sources[i].soundId === id)
      && track2.pattern.sources[0].pan === 0

    // Runtime serializer must preserve all seven lanes instead of truncating to six.
    const saved = le.serialize()
    const storedTrack2 = saved.arrangement.lanes.find((track) => track.id === 2)
    const serializedSeven = storedTrack2?.pattern?.lanes?.length === 7
      && storedTrack2?.pattern?.sources?.length === 7
    le.applyState(saved)
    const reloadedTrack2 = le.tracks.find((track) => track.id === 2)
    const reloadedSeven = reloadedTrack2?.pattern?.lanes?.length === 7
      && reloadedTrack2?.pattern?.sources?.map((source) => source.soundId).join('|') === sourceIdsBefore.join('|')

    // D/removal path removes the selected sound lane and keeps the rest aligned.
    le.select(2)
    app.seqTrackId = 2
    app.seqLane = 6
    app.screen = 'sequencer'
    app.render()
    app.seqCtl.clearLaneConfirmed()
    const removedToSix = reloadedTrack2.pattern.lanes.length === 6
      && reloadedTrack2.pattern.sources.length === 6
      && !reloadedTrack2.pattern.sources.some((source) => source.soundId === sourceIdsBefore[6])

    // A separate track receives its own independent pattern object.
    const lib1 = le.createLibraryTrack({ name: 'INDEPENDENT' })
    le.assignLibraryToLane(1, lib1.id)
    const track1 = le.tracks.find((track) => track.id === 1)
    track1.pattern = null
    track1.seq.enabled = false
    le.select(1)
    app.seqCtl.open(1)
    slot.soundId = playable[6].id
    slot.pan = -0.5
    app.seqCursor = 12
    app.seqCtl.selectLane(1)
    const trackObjectsIndependent = track1.pattern !== reloadedTrack2.pattern
      && track1.pattern.lanes !== reloadedTrack2.pattern.lanes
      && track1.pattern.sources[0].soundId === playable[6].id
      && reloadedTrack2.pattern.lanes.length === 6

    // Playback scheduler must emit captured source objects, not pad numbers.
    const scheduled = []
    app.stepSeq.trigger = (target, options) => scheduled.push({ target, options })
    app.transportStopPublic()
    le.select(1)
    app.seqTrackId = 1
    app.screen = 'sequencer'
    const origin = app.engine.now() + 0.05
    app.transport.playAt(origin)
    app.stepSeq.start(origin, { mode: 'track', trackId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 1700))
    app.stepSeq.stop()
    app.transport.stop()
    const scheduledCapturedSource = scheduled.some(({ target }) =>
      target && typeof target === 'object' && target.soundId === playable[6].id
    )

    return {
      fatal: null,
      globalTrackId,
      globalRows,
      laneCount7,
      uniqueSources,
      eachLaneOwnHit,
      selectedLane7,
      secondLanePage,
      stableAfterPadChange,
      serializedSeven,
      reloadedSeven,
      removedToSix,
      trackObjectsIndependent,
      scheduledCapturedSource
    }
  })()`)

  if (out.fatal) fail(out.fatal)
  else {
    if (out.globalTrackId == null && out.globalRows === 6) pass("global A-D bank remains six pad lanes")
    else fail(`global mode trackId=${out.globalTrackId} rows=${out.globalRows}`)
    if (out.laneCount7 === 7 && out.uniqueSources === 7) pass("one track stores seven distinct sound lanes")
    else fail(`dynamic lanes=${out.laneCount7} uniqueSources=${out.uniqueSources}`)
    if (out.eachLaneOwnHit) pass("pad presses insert hits into their captured sound lanes")
    else fail("one or more captured lanes missed its inserted hit")
    if (out.selectedLane7 && out.secondLanePage) pass("lane 7 is reachable in the second six-row viewport")
    else fail(`lane7 selected=${out.selectedLane7} page=${out.secondLanePage}`)
    if (out.stableAfterPadChange) pass("pad reassignment does not mutate existing lane sounds")
    else fail("captured lane changed after pad reassignment")
    if (out.serializedSeven && out.reloadedSeven) pass("seven lanes survive serialize and recovery hydration")
    else fail(`serialize=${out.serializedSeven} reload=${out.reloadedSeven}`)
    if (out.removedToSix) pass("selected sound lane can be removed cleanly")
    else fail("lane removal did not keep sources and steps aligned")
    if (out.trackObjectsIndependent) pass("different tracks retain independent dynamic patterns")
    else fail("track pattern objects or content leaked between tracks")
    if (out.scheduledCapturedSource) pass("scheduler triggers captured source objects instead of current pads")
    else fail("scheduler did not emit the captured lane source")
  }
} catch (error) {
  fail(error.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
