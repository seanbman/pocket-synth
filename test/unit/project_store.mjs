import assert from "node:assert/strict"
import {
  collectReferencedSoundIds,
  decodeProjectBundle,
  encodeProjectBundle,
  makeProjectBundle
} from "../../app/javascript/cassio/project_store.js"

const state = {
  bpm: 126,
  soundId: "user-lead",
  pads: [{ pad: 1, soundId: "user-kick" }],
  loop: {
    arrangement: {
      lanes: [{ id: 1, source: { soundId: "user-loop", pcm: new Float32Array([0.25, -0.5, 0.75]) } }]
    }
  }
}

const refs = collectReferencedSoundIds(state)
assert.deepEqual([...refs].sort(), ["user-kick", "user-lead", "user-loop"])

const project = { id: "p1", name: "FIRST JAM", state, createdAt: 1, updatedAt: 2 }
const sounds = [
  { id: "user-lead", name: "Lead", audio: new Float32Array([0.1, 0.2]) },
  { id: "user-kick", name: "Kick", audio: new Float32Array([0.3]) },
  { id: "unrelated", name: "Unused", audio: new Float32Array([0.9]) }
]
const bundle = makeProjectBundle(project, sounds)
assert.equal(bundle.format, "cassio-project-v1")
assert.deepEqual(bundle.userSounds.map((s) => s.id).sort(), ["user-kick", "user-lead"])

const decoded = decodeProjectBundle(encodeProjectBundle(bundle))
assert.equal(decoded.project.name, "FIRST JAM")
assert(decoded.project.state.loop.arrangement.lanes[0].source.pcm instanceof Float32Array)
assert.deepEqual(Array.from(decoded.project.state.loop.arrangement.lanes[0].source.pcm), [0.25, -0.5, 0.75])
assert(decoded.userSounds[0].audio instanceof Float32Array)

assert.throws(() => decodeProjectBundle('{"format":"nope"}'), /NOT A CASSIO V1 PROJECT/)
console.log("PASS: project bundles preserve referenced sounds and typed audio")
