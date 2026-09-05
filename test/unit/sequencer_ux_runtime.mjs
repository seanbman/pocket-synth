#!/usr/bin/env node
import assert from "node:assert/strict"
import { installSequencerUxRuntime } from "../../app/javascript/cassio/sequencer_ux_runtime.js"

function makeApp() {
  const calls = { renders: 0, toasts: [], nav: [] }
  const app = {
    root: null,
    screen: "loop-tracks",
    seqTrackId: null,
    seqHeader: false,
    seqLane: 0,
    stepSeq: { seq: { current: "B" } },
    render() { calls.renders++ },
    toast(message) { calls.toasts.push(message) }
  }
  app.seqCtl = {
    open(trackId = null) {
      app.seqTrackId = trackId
      app.seqHeader = false
      app.screen = "sequencer"
      return true
    },
    nav(dir) { calls.nav.push(dir); return true }
  }
  installSequencerUxRuntime(app)
  return { app, calls }
}

{
  const { app, calls } = makeApp()
  app.seqCtl.open()
  assert.equal(app.seqTrackId, null)
  assert.equal(app.seqHeader, true)
  assert.match(calls.toasts.at(-1), /^PAD PATTERN B/)
}

{
  const { app, calls } = makeApp()
  app.seqCtl.open(4)
  assert.equal(app.seqTrackId, 4)
  assert.equal(app.seqHeader, false)
  assert.equal(calls.toasts.at(-1), "LANE 4 SEQ")
}

{
  const { app, calls } = makeApp()
  app.seqCtl.open()
  app.seqHeader = false
  app.seqLane = 0
  assert.equal(app.seqCtl.nav("up"), true)
  assert.equal(app.seqHeader, true)
  assert.equal(calls.nav.length, 0)
}

console.log("PASS: sequencer UX separates lane sequences from global pad patterns")
