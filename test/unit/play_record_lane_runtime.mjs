#!/usr/bin/env node
import assert from "node:assert/strict"
import { installPlayRecordLaneRuntime } from "../../app/javascript/cassio/play_record_lane_runtime.js"

function makeApp({ screen = "play", hasClip = true } = {}) {
  const calls = { added: 0, ensured: [], armed: [], selected: [], toasts: [], persisted: 0 }
  const first = { id: 1, assigned: true, buffer: hasClip ? {} : null }
  const loopEngine = {
    selected: 1,
    tracks: [first],
    recording: false,
    get selectedTrack() { return this.tracks.find((lane) => lane.id === this.selected) },
    laneHasClip(lane) { return !!lane.buffer },
    addLane() {
      calls.added++
      const lane = { id: 2, assigned: false, buffer: null }
      this.tracks.push(lane)
      this.selected = lane.id
      return lane
    },
    select(id) { this.selected = id; calls.selected.push(id) },
    ensureLaneForRecord(options) {
      calls.ensured.push(options)
      const lane = this.selectedTrack
      lane.assigned = true
      lane.name = options?.name || "UNTITLED"
      return lane
    },
    armForRecord(id) {
      calls.armed.push(id)
      return this.tracks.find((lane) => lane.id === id) || null
    }
  }
  const app = {
    screen,
    sound: { id: "glass-poly", name: "Glass Poly", voice: "poly" },
    loopEngine,
    persistLoop() { calls.persisted++ },
    toast(message) { calls.toasts.push(message) }
  }
  installPlayRecordLaneRuntime(app)
  return { app, calls }
}

{
  const { app, calls } = makeApp({ screen: "play", hasClip: true })
  const armed = app.loopEngine.armForRecord(1)
  assert.equal(calls.added, 1)
  assert.equal(armed.id, 2)
  assert.equal(armed.assigned, true)
  assert.deepEqual(calls.ensured, [{ name: "GLASS POLY" }])
  assert.equal(app._lastPlayRecordLaneId, 2)
  assert.equal(calls.persisted, 1)
}

{
  const { app, calls } = makeApp({ screen: "play", hasClip: false })
  const armed = app.loopEngine.armForRecord(1)
  assert.equal(calls.added, 0)
  assert.equal(armed.id, 1)
}

{
  const { app, calls } = makeApp({ screen: "loop-tracks", hasClip: true })
  const armed = app.loopEngine.armForRecord(1)
  assert.equal(calls.added, 0)
  assert.equal(armed.id, 1)
}

console.log("PASS: PLAY recording captures into a fresh lane without changing LOOP overdub semantics")
