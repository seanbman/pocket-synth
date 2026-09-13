#!/usr/bin/env node
import assert from "node:assert/strict"
import {
  findTrackForSequenceSource,
  hasRecordedTrackAudio,
  installUserReportRegressionRuntime,
  mixSequenceSourceForTrack
} from "../../app/javascript/cassio/user_report_regression_runtime.js"

const source = {
  soundId: "glass-poly",
  name: "GLASS POLY",
  level: 0.5,
  pan: -0.2,
  midi: 60,
  fromPad: 1
}
const track = {
  id: 3,
  assigned: true,
  level: 0.4,
  pan: 0.3,
  mute: false,
  solo: false,
  buffer: {},
  pattern: {
    laneIds: ["lane-a"],
    sources: [source]
  }
}
const app = {
  seqTrackId: 3,
  loopEngine: {
    tracks: [track]
  }
}

assert.equal(findTrackForSequenceSource(app, source, { laneId: "lane-a" }), track)
assert.equal(findTrackForSequenceSource(app, { ...source }, {}), track)

const mixed = mixSequenceSourceForTrack(app, source, track)
assert.equal(mixed.level, 0.2)
assert.equal(Math.round(mixed.pan * 10), 1)
assert.equal(hasRecordedTrackAudio(track), true)

track.mute = true
assert.equal(mixSequenceSourceForTrack(app, source, track), null)
track.mute = false

const other = { id: 4, assigned: true, solo: true }
app.loopEngine.tracks.push(other)
assert.equal(mixSequenceSourceForTrack(app, source, track), null)
track.solo = true
assert.ok(mixSequenceSourceForTrack(app, source, track))

{
  const calls = { preview: 0, stopped: [], render: 0, toast: [] }
  const previewApp = {
    screen: "sample-edit",
    sampleBuffer: {},
    sampleDraft: { root: "C3", loopOn: true },
    sampleVoice: {
      activeCount: 0,
      noteOff(midi, immediate) {
        calls.stopped.push([midi, immediate])
        this.activeCount = 0
      },
      playSeconds() { return 1 }
    },
    sampler: {
      async preview() {
        calls.preview++
        previewApp.sampleVoice.activeCount = 1
      }
    },
    loopEngine: {
      selected: 1,
      tracks: [],
      setTrackLevel() {},
      setTrackPan() {},
      trackChain() { return null }
    },
    stepSeq: {
      trigger(target) { return target }
    },
    render() { calls.render++ },
    toast(message) { calls.toast.push(message) },
    root: {
      querySelector() { return null },
      querySelectorAll() { return [] }
    }
  }

  installUserReportRegressionRuntime(previewApp)
  await previewApp.sampler.preview()
  assert.equal(calls.preview, 1)
  assert.equal(previewApp._cassioSamplePreviewMidi, 48)

  await previewApp.sampler.preview()
  assert.equal(calls.preview, 1)
  assert.deepEqual(calls.stopped, [[48, true]])
  assert.equal(previewApp._cassioSamplePreviewMidi, null)
  assert.ok(calls.toast.includes("PREVIEW STOPPED"))
}

console.log("PASS: user-reported preview, recorded-lane and mixer source regressions are guarded")
