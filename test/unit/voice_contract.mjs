#!/usr/bin/env node
import assert from "node:assert/strict"
import { assertPlayableVoice, supportsPitchBend } from "../../app/javascript/cassio/voices/contract.js"

function voice(overrides = {}) {
  return {
    applyPatch() {},
    noteOn() {},
    noteOff() {},
    allNotesOff() {},
    ...overrides
  }
}

const playable = voice({ setPitchBend() {} })
assert.equal(assertPlayableVoice(playable, "test voice"), playable)
assert.equal(supportsPitchBend(playable), true)
assert.equal(supportsPitchBend(voice()), false)
assert.throws(() => assertPlayableVoice(null, "test voice"), /test voice must be an object/)
assert.throws(
  () => assertPlayableVoice(voice({ noteOff: null }), "test voice"),
  /test voice must implement noteOff\(\)/
)

console.log("PASS: playable voice contract rejects incomplete implementations")
