#!/usr/bin/env node
import assert from "node:assert/strict"
import { VoiceRegistry } from "../../app/javascript/cassio/voices/registry.js"

function fakeVoice(name) {
  const calls = []
  return {
    name,
    calls,
    applyPatch(patch) { calls.push(["patch", patch]) },
    noteOn(...args) { calls.push(["on", ...args]); return name },
    noteOff(...args) { calls.push(["off", ...args]) },
    allNotesOff() { calls.push(["allOff"]) },
    setPitchBend(value) { calls.push(["bend", value]) }
  }
}

const synth = fakeVoice("synth")
const drums = fakeVoice("drums")
const sample = fakeVoice("sample")
const loaded = []
const registry = new VoiceRegistry({ synth, drums, sample, loadSample: (sound) => loaded.push(sound.id) })

assert.equal(registry.kindFor({ voice: "drum" }), "drum")
assert.equal(registry.kindFor({ voice: "sample" }), "sample")
assert.equal(registry.kindFor({ voice: "poly" }), "synth")
assert.equal(registry.voiceFor({ voice: "drum" }), drums)
assert.equal(registry.voiceFor({ voice: "sample" }), sample)
assert.equal(registry.voiceFor({ voice: "poly" }), synth)

registry.prepare({ id: "s1", voice: "sample" }, { gain: 1.2 })
assert.deepEqual(loaded, ["s1"])
assert.deepEqual(sample.calls.at(-1), ["patch", { gain: 1.2 }])

assert.equal(registry.noteOn({ voice: "drum" }, 36, 0.9, { recTrack: 2 }), "drums")
assert.deepEqual(drums.calls.at(-1), ["on", 36, 0.9, { recTrack: 2 }])
registry.noteOff({ voice: "poly" }, 60, true, { when: 2 })
assert.deepEqual(synth.calls.at(-1), ["off", 60, true, { when: 2 }])
registry.setPitchBend({ voice: "sample" }, 1)
assert.deepEqual(sample.calls.at(-1), ["bend", 1])

registry.allNotesOff()
assert.equal(synth.calls.at(-1)[0], "allOff")
assert.equal(drums.calls.at(-1)[0], "allOff")
assert.equal(sample.calls.at(-1)[0], "allOff")

assert.throws(
  () => new VoiceRegistry({ synth: {}, drums, sample }),
  /synth voice must implement applyPatch\(\)/
)

console.log("PASS: voice registry resolves playable implementations behind one contract")
