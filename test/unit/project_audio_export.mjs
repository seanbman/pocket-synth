import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const sourcePath = "app/javascript/cassio/audio/project_export.js"
let source = readFileSync(sourcePath, "utf8")
source = source.replace('import { exportSample } from "cassio/audio/export_sample"', "const exportSample = async () => 'test'")
const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
const mod = await import(dataUrl)

assert.deepEqual(mod.PROJECT_AUDIO_FORMATS, ["wav", "mp3", "m4a"])

const timelineApp = {
  loopEngine: { timelineSec: () => 12.5, lengthBars: 4 },
  transport: { loopSec: () => 8 }
}
assert.equal(mod.projectSongDurationSec(timelineApp), 12.5)

const fallbackApp = {
  loopEngine: { timelineSec: () => 0, lengthBars: 8 },
  transport: { loopSec: (bars) => bars * 2 }
}
assert.equal(mod.projectSongDurationSec(fallbackApp), 16)
assert.equal(mod.projectSongDurationSec({}), 2)

await assert.rejects(
  () => mod.exportProjectAudio({}, "flac", "NOPE"),
  /UNKNOWN FORMAT/
)

console.log("project audio export unit: ok")
