#!/usr/bin/env node
import assert from "node:assert/strict"
import { installTrackNamingRuntime } from "../../app/javascript/cassio/track_naming_runtime.js"

function makeApp({ assigned = false, name = "EMPTY" } = {}) {
  const track = {
    id: 2,
    assigned,
    libraryTrackId: assigned ? "lib-2" : null,
    name
  }
  const calls = {
    ensured: [],
    saved: [],
    persisted: 0,
    rendered: 0,
    toasts: [],
    originalSoftKeys: []
  }
  const loopEngine = {
    selected: 2,
    tracks: [track],
    get selectedTrack() { return track },
    ensureLaneForRecord(options = {}) {
      calls.ensured.push(options)
      track.assigned = true
      track.libraryTrackId = "lib-2"
      track.name = options.name || "DEFAULT"
      return track
    },
    saveLaneToLibrary(trackId, options = {}) {
      calls.saved.push({ trackId, options })
      track.name = options.name || track.name
      return { id: track.libraryTrackId, name: track.name }
    }
  }
  const looper = {
    softKey(key) {
      calls.originalSoftKeys.push(key)
      return true
    }
  }
  const app = {
    screen: "loop-tracks",
    loopEngine,
    looper,
    root: null,
    render() { calls.rendered++ },
    persistLoop() { calls.persisted++ },
    toast(message) { calls.toasts.push(message) }
  }
  installTrackNamingRuntime(app)
  return { app, track, calls }
}

// A fresh REC lane gets only a temporary recovery label and is marked for naming.
{
  const { app, track, calls } = makeApp({ assigned: false })
  const lane = app.loopEngine.ensureLaneForRecord({ name: "GLASS POLY" })
  assert.equal(lane, track)
  assert.equal(calls.ensured[0].name, "UNTITLED")
  assert.equal(track.name, "UNTITLED")
  assert.equal(track._needsNameAfterTake, true)
}

// Naming commits directly to the lane/library and clears the temporary marker.
{
  const { app, track, calls } = makeApp({ assigned: true, name: "UNTITLED" })
  track._needsNameAfterTake = true
  app.trackNamePrompt = (title, initial) => {
    assert.equal(title, "NAME THIS TAKE")
    assert.equal(initial, "")
    return "piano idea"
  }
  assert.equal(app.renameTrack(2, { afterTake: true }), true)
  assert.equal(track.name, "PIANO IDEA")
  assert.equal(track._needsNameAfterTake, undefined)
  assert.deepEqual(calls.saved[0], { trackId: 2, options: { name: "PIANO IDEA" } })
  assert.equal(calls.persisted, 1)
  assert.match(calls.toasts.at(-1), /^TRACK SAVED · PIANO IDEA$/)
}

// Soft A on an assigned track menu is the fast rename path.
{
  const { app, track, calls } = makeApp({ assigned: true, name: "OLD NAME" })
  app.screen = "loop-menu"
  app.trackNamePrompt = (title, initial) => {
    assert.equal(title, "RENAME TRACK")
    assert.equal(initial, "OLD NAME")
    return "new name"
  }
  assert.equal(app.looper.softKey("a"), true)
  assert.equal(track.name, "NEW NAME")
  assert.equal(calls.originalSoftKeys.length, 0)
  assert.match(calls.toasts.at(-1), /^RENAMED · NEW NAME$/)
}

// Cancelling the post-take prompt keeps the recording safely recoverable.
{
  const { app, track, calls } = makeApp({ assigned: true, name: "UNTITLED" })
  track._needsNameAfterTake = true
  app.trackNamePrompt = () => null
  assert.equal(app.renameTrack(2, { afterTake: true }), false)
  assert.equal(track.name, "UNTITLED")
  assert.equal(calls.saved.length, 0)
  assert.match(calls.toasts.at(-1), /^TAKE KEPT · RENAME ANY TIME$/)
}

console.log("PASS: track naming is explicit after fresh takes and directly accessible")
