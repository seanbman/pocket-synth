#!/usr/bin/env node
import assert from "node:assert/strict"
import { installRecordingRuntime } from "../../app/javascript/cassio/recording_runtime.js"

function makeApp({ playContext = null } = {}) {
  const calls = {
    seqTriggers: [],
    loopStarts: 0,
    seqStarts: 0,
    loopStops: 0,
    seqStops: 0,
    transportStops: 0,
    renders: 0,
    toasts: []
  }
  let done = null

  const loopEngine = {
    beginRecord(_trackId, options = {}) {
      done = options.onDone
      return true
    },
    startPlayback() { calls.loopStarts++ },
    stopPlayback() { calls.loopStops++ }
  }
  const stepSeq = {
    trigger(target, options) {
      calls.seqTriggers.push({ target, options })
    },
    start() { calls.seqStarts++ },
    stop() { calls.seqStops++ }
  }
  const transport = {
    stop() { calls.transportStops++ }
  }
  const app = {
    playContext,
    loopEngine,
    stepSeq,
    transport,
    render() { calls.renders++ },
    toast(message) { calls.toasts.push(message) }
  }

  installRecordingRuntime(app)
  return {
    app,
    calls,
    finish(track = { id: 2, name: "PIANO TAKE" }) { done?.(track) }
  }
}

// Sequencer playback must never be routed to an active record tap.
{
  const { app, calls } = makeApp({ playContext: "loop" })
  app.stepSeq.trigger(3, { recTrack: 4, velocity: 0.8 })
  assert.equal(calls.seqTriggers.length, 1)
  assert.equal(calls.seqTriggers[0].options.recTrack, false)
  assert.equal(calls.seqTriggers[0].options.fromSeq, true)
}

// REC from stop is input-only: backing starts requested by CassioApp are suppressed.
{
  const { app, calls, finish } = makeApp({ playContext: null })
  assert.equal(app.loopEngine.beginRecord(2, { onDone() {} }), true)
  assert.equal(app._recordInputOnly, true)
  app.loopEngine.startPlayback(1)
  app.stepSeq.start(1, { mode: "arrangement" })
  assert.equal(calls.loopStarts, 0)
  assert.equal(calls.seqStarts, 0)

  finish()
  await Promise.resolve()
  assert.equal(calls.transportStops, 1)
  assert.equal(calls.loopStops, 1)
  assert.equal(calls.seqStops, 1)
  assert.equal(app._recordInputOnly, false)
  assert.match(calls.toasts.at(-1), /^TRACK SAVED · PIANO TAKE$/)
}

// PLAY then REC keeps backing audible, but sequencer notes still remain record-isolated.
{
  const { app, calls, finish } = makeApp({ playContext: "loop" })
  assert.equal(app.loopEngine.beginRecord(2, { onDone() {} }), true)
  assert.equal(app._recordInputOnly, false)
  app.loopEngine.startPlayback(1)
  app.stepSeq.start(1, { mode: "arrangement" })
  assert.equal(calls.loopStarts, 1)
  assert.equal(calls.seqStarts, 1)

  finish()
  await Promise.resolve()
  assert.equal(calls.transportStops, 0)
  assert.equal(app._recordInputOnly, false)
  assert.match(calls.toasts.at(-1), /^TRACK SAVED · PIANO TAKE$/)
}

console.log("PASS: recording runtime isolates live input and preserves optional monitoring")
