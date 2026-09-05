#!/usr/bin/env node
import assert from "node:assert/strict"
import { installSequenceVoiceGuardRuntime } from "../../app/javascript/cassio/sequence_voice_guard_runtime.js"

function makeApp() {
  const calls = { triggers: [], sampleOff: [], synthOff: [] }
  const app = {
    userSounds: [],
    factory: { sounds: [
      { id: "long-sample", voice: "sample", root: "C3" },
      { id: "poly", voice: "poly", root: "C3" },
      { id: "kick", voice: "drum", root: "C2" }
    ] },
    sampleVoice: { noteOff(...args) { calls.sampleOff.push(args) } },
    padSynth: { noteOff(...args) { calls.synthOff.push(args) } },
    stepSeq: {
      trigger(target, options) { calls.triggers.push({ target, options }); return true },
      stop() { calls.stopped = true }
    }
  }
  installSequenceVoiceGuardRuntime(app)
  return { app, calls }
}

{
  const { app, calls } = makeApp()
  const source = { soundId: "long-sample", midi: 60 }
  app.stepSeq.trigger(source, { laneId: "lane-a", when: 1 })
  app.stepSeq.trigger(source, { laneId: "lane-a", when: 3 })
  assert.equal(calls.triggers.length, 2)
  assert.equal(calls.sampleOff.length, 1)
  assert.equal(calls.sampleOff[0][0], 60)
  assert.deepEqual(calls.sampleOff[0][2], { when: 3 })
}

{
  const { app, calls } = makeApp()
  const source = { soundId: "long-sample", midi: 60 }
  app.stepSeq.trigger(source, { laneId: "lane-a", when: 1 })
  app.stepSeq.trigger(source, { laneId: "lane-b", when: 2 })
  assert.equal(calls.sampleOff.length, 0)
}

{
  const { app, calls } = makeApp()
  const source = { soundId: "poly", midi: 64 }
  app.stepSeq.trigger(source, { lane: 2, when: 1 })
  app.stepSeq.trigger(source, { lane: 2, when: 2 })
  assert.equal(calls.synthOff.length, 1)
  assert.equal(calls.synthOff[0][0], 64)
  assert.equal(calls.synthOff[0][1], true)
}

{
  const { app, calls } = makeApp()
  const source = { soundId: "kick", midi: 36 }
  app.stepSeq.trigger(source, { lane: 0, when: 1 })
  app.stepSeq.trigger(source, { lane: 0, when: 2 })
  assert.equal(calls.sampleOff.length, 0)
  assert.equal(calls.synthOff.length, 0)
}

console.log("PASS: sequence lanes release prior non-drum voices before retrigger")
