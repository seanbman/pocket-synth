import assert from "node:assert/strict"
import fs from "node:fs"

const audioEngine = fs.readFileSync("app/javascript/cassio/audio_engine.js", "utf8")
assert.match(audioEngine, /this\.recTaps = \[\]/, "record taps must be allocated dynamically")
assert.doesNotMatch(audioEngine, /Math\.min\(6, Math\.max\(1, trackId/, "arrangement record buses must not clamp lane IDs to six")
assert.match(audioEngine, /this\.recTap = this\.recTapForTrack\(1\)/, "legacy record alias must use the dynamic allocator")

const sequencer = fs.readFileSync("app/javascript/cassio/audio/step_sequencer.js", "utf8")
const playbackGuards = sequencer.match(/recTrack: false/g) || []
assert.equal(playbackGuards.length, 4, "every generated sequencer playback path must explicitly opt out of live recording")

console.log("dev audio merge contract verified")
