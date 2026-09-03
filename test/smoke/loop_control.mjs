#!/usr/bin/env node
/**
 * Loop control smoke: STOP/mute/solo, library assign, seq clip, lane add.
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

    const lib1 = le.createLibraryTrack({ name: 'DRUMS' })
    le.assignLibraryToLane(1, lib1.id)
    le.tracks[0].buffer = buf
    le.tracks[0].assigned = true
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

    const lib3 = le.createLibraryTrack({ name: 'LEAD' })
    le.assignLibraryToLane(3, lib3.id)
    le.select(3)
    le.tracks.find(t => t.id === 3).buffer = buf
    le.setTrackOffset(3, 10)
    app.looper.openHome()
    app.loopScrollFollow = true
    app.render()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const scroller = app.vscreen.querySelector('[data-loop-scroll]')
    const scrollLeft = scroller?.scrollLeft ?? 0
    const scrollWidth = scroller?.scrollWidth ?? 0
    const clientWidth = scroller?.clientWidth ?? 0
    const offsetSec = le.tracks.find(t => t.id === 3)?.offsetSec

    app.looper.selectTrack(5)
    const tapSelected = le.selected

    // Seq-only clip on empty→assigned lane
    const libSeq = le.createLibraryTrack({ name: 'KICK SEQ' })
    libSeq.seq.steps[0].on = true
    libSeq.seq.steps[4].on = true
    le.assignLibraryToLane(2, libSeq.id)
    app.render()
    const html = app.vscreen?.innerHTML || ''
    const seqClip = html.includes('loop-clip') && html.includes('data-track-id="2"')
    const emptyLaneOk = !le.tracks.find(t => t.id === 4)?.assigned

    // Empty OK opens track list
    le.select(4)
    app.looper.nav('ok')
    const emptyOpensList = app.screen === 'track-list'

    // Add lane
    app.screen = 'loop-tracks'
    const before = le.tracks.length
    app.looper.softKey('a')
    const afterAdd = le.tracks.length

    // Menu scroll + DROP PATTERN (no Track Step Seq)
    le.select(1)
    app.screen = 'loop-menu'
    app.loopMenuIndex = 15
    app.render()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const list = app.vscreen.querySelector('.lib-list')
    const selRow = app.vscreen.querySelector('.lib-row.selected')
    const menuHtml = app.vscreen.innerHTML || ''
    const menuHasDrop = menuHtml.includes('DROP PATTERN')
    const menuNoTrackSeq = !menuHtml.includes('TRACK STEP SEQ')
    const selectedVisible = !!(list && selRow &&
      selRow.offsetTop + selRow.offsetHeight <= list.scrollTop + list.clientHeight + 4 &&
      selRow.offsetTop >= list.scrollTop - 4)
    const menuScrollTop = list?.scrollTop ?? 0

    // Legacy names stripped; custom names kept in full (no .pop())
    const shaker = le.createLibraryTrack({ name: 'Shaker' })
    const custom = le.createLibraryTrack({ name: 'MY LOOP' })
    le.assignLibraryToLane(1, custom.id)
    app.looper.openHome()
    app.render()
    const htmlNames = app.vscreen?.innerHTML || ''
    const showsFullName = htmlNames.includes('MY LOOP')
    const noPoppedLoop = !htmlNames.includes('>1 LOOP<') && !htmlNames.includes(' 1 LOOP')

    // Drop pattern onto empty lane 4
    app.stepSeq.seq.current = 'A'
    app.stepSeq.seq.patterns.A.lanes[0][0].on = true
    le.select(4)
    app.looper.dropPatternOnSelected()
    const lane4 = le.tracks.find(t => t.id === 4)
    const dropAssigned = !!lane4?.assigned && !!lane4?.dirty
    const dropHasPat = !!lane4?.pattern?.lanes?.[0]?.[0]?.on
    app.render()
    const dropHtml = app.vscreen?.innerHTML || ''
    const dropClip = dropHtml.includes('loop-clip') && dropHtml.includes('data-track-id="4"')

    // Delete lane (engine + confirm UI)
    const nBeforeDel = le.tracks.length
    le.addLane()
    const addedId = le.selected
    const removed = le.removeLane(addedId)
    const nAfterDel = le.tracks.length
    app.looper.openHome()
    app.looper.askDeleteLane('loop-tracks')
    const deleteConfirm = app.screen === 'confirm' && app.confirmAction === 'delete-lane'
    const lastLaneGuard = (() => {
      while (le.tracks.length > 1) le.removeLane(le.tracks[le.tracks.length - 1].id)
      return le.removeLane(le.tracks[0].id) === false && le.tracks.length === 1
    })()

    return {
      playingAfterStop, sourcesAfterStop, muted, solo, quantize, scrollLeft, scrollWidth, clientWidth,
      offsetSec, tapSelected, seqClip, emptyLaneOk, emptyOpensList, before, afterAdd,
      menuHasDrop, menuNoTrackSeq, selectedVisible, menuScrollTop,
      shakerName: shaker.name, customName: custom.name, showsFullName, noPoppedLoop,
      dropAssigned, dropHasPat, dropClip,
      nBeforeDel, removed, nAfterDel, deleteConfirm, lastLaneGuard,
      fatal: null
    }
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
    if (out.tapSelected === 5) pass("selectTrack focuses timeline row")
    else fail(`selectTrack id ${out.tapSelected}`)
    if (out.seqClip) pass("seq-only library track draws clip")
    else fail("seq clip missing on timeline")
    if (out.emptyLaneOk) pass("unassigned lane stays empty")
    else fail("lane 4 unexpectedly assigned")
    if (out.emptyOpensList) pass("OK on empty lane opens track list")
    else fail("empty OK did not open track list")
    if (out.afterAdd === out.before + 1) pass("A adds arrangement lane")
    else fail(`lane count ${out.before}→${out.afterAdd}`)
    if (out.menuHasDrop && out.menuNoTrackSeq) pass("track menu DROP PATTERN, no Track Step Seq")
    else fail(`menu drop=${out.menuHasDrop} trackSeqGone=${out.menuNoTrackSeq}`)
    if (out.selectedVisible || out.menuScrollTop > 0) pass(`menu scrolled to selection (scrollTop=${out.menuScrollTop})`)
    else fail(`menu selection not in view (scrollTop=${out.menuScrollTop} visible=${out.selectedVisible})`)
    if (out.shakerName && /^TRACK \d+$/.test(out.shakerName)) pass(`legacy Shaker → ${out.shakerName}`)
    else fail(`shaker name ${out.shakerName}`)
    if (out.customName === "MY LOOP" && out.showsFullName) pass("custom lane name shown in full")
    else fail(`custom name ${out.customName} shown=${out.showsFullName}`)
    if (out.dropAssigned && out.dropHasPat && out.dropClip) pass("DROP PATTERN bakes clip onto empty lane")
    else fail(`drop assigned=${out.dropAssigned} pat=${out.dropHasPat} clip=${out.dropClip}`)
    if (out.removed && out.nAfterDel === out.nBeforeDel) pass("removeLane deletes extra row")
    else fail(`removeLane ${out.nBeforeDel}→${out.nAfterDel} ok=${out.removed}`)
    if (out.deleteConfirm) pass("HOLD A / askDeleteLane opens confirm")
    else fail("delete lane confirm missing")
    if (out.lastLaneGuard) pass("last lane cannot be removed")
    else fail("last-lane guard failed")
  }
} catch (e) {
  fail(e.message)
} finally {
  chrome.kill("SIGTERM")
  await sleep(300)
  process.exit(failed ? 1 : 0)
}
