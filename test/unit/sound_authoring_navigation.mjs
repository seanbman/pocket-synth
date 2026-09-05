import assert from "node:assert/strict"
import fs from "node:fs"

const app = fs.readFileSync("app/javascript/cassio/app.js", "utf8")
const play = fs.readFileSync("app/javascript/cassio/screens/play.js", "utf8")
const sampler = fs.readFileSync("app/javascript/cassio/sampler_controller.js", "utf8")

assert.match(app, /this\.menuIndex = 2/, "main menu should initially select SOUND")
assert.match(app, /if \(key === "d"\) this\.sampler\.openHub\(\)/,
  "PLAY D should open the SOUND authoring hub")
assert.match(play, /<span class="sk">D<\/span> <span class="green">SOUND<\/span>/,
  "PLAY should advertise the SOUND route")

assert.match(sampler, /if \(key === "a"\) a\.openLibraryFromHub\(\)/,
  "SOUND A should retain synth and drum library access")
assert.match(sampler, /if \(key === "b"\) this\.openHome\(\)/,
  "SOUND B should retain microphone/import sampler access")
assert.match(sampler, /if \(key === "c"\) a\.createNewKitFromHub\(\)/,
  "SOUND C should retain blank-kit creation")

console.log("PASS: PLAY and MENU expose the complete SOUND authoring workflow")
