import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const asDataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`

let projectSource = readFileSync("app/javascript/cassio/audio/project_export.js", "utf8")
projectSource = projectSource.replace('import { exportSample } from "cassio/audio/export_sample"', "const exportSample = async () => 'test'")
const projectMod = await import(asDataModule(projectSource))

assert.deepEqual(projectMod.PROJECT_AUDIO_FORMATS, ["wav", "mp3", "m4a"])

const timelineApp = {
  loopEngine: { timelineSec: () => 12.5, lengthBars: 4 },
  transport: { loopSec: () => 8 }
}
assert.equal(projectMod.projectSongDurationSec(timelineApp), 12.5)

const fallbackApp = {
  loopEngine: { timelineSec: () => 0, lengthBars: 8 },
  transport: { loopSec: (bars) => bars * 2 }
}
assert.equal(projectMod.projectSongDurationSec(fallbackApp), 16)
assert.equal(projectMod.projectSongDurationSec({}), 2)

await assert.rejects(
  () => projectMod.exportProjectAudio({}, "flac", "NOPE"),
  /UNKNOWN FORMAT/
)

const sampleSource = readFileSync("app/javascript/cassio/audio/export_sample.js", "utf8")
const sampleMod = await import(asDataModule(sampleSource))
const previousMediaRecorder = globalThis.MediaRecorder
try {
  globalThis.MediaRecorder = { isTypeSupported: (type) => type === "audio/aac" }
  assert.equal(sampleMod.pickM4aMime(), null, "raw AAC must not be mislabeled as M4A")
  globalThis.MediaRecorder = { isTypeSupported: (type) => type === "audio/mp4" }
  assert.equal(sampleMod.pickM4aMime(), "audio/mp4")
} finally {
  if (previousMediaRecorder === undefined) delete globalThis.MediaRecorder
  else globalThis.MediaRecorder = previousMediaRecorder
}

const screenSource = readFileSync("app/javascript/cassio/screens/project.js", "utf8")
const screenMod = await import(asDataModule(screenSource))
const manage = screenMod.renderProjectManage({ bpm: 120, selectedProjectName: "TEST", projectManageIndex: 2 })
assert.match(manage, /EXPORT AUDIO/)
assert.match(manage, /EXPORT \.CASSIO/)
const audioScreen = screenMod.renderProjectAudioExport({
  bpm: 120,
  selectedProjectName: "TEST",
  projectAudioFormatIndex: 0,
  projectExportBusy: false
})
assert.match(audioScreen, /EXPORT SONG/)
assert.match(audioScreen, /WAV/)
assert.match(audioScreen, /MP3/)
assert.match(audioScreen, /M4A/)
assert.match(audioScreen, /METRONOME EXCLUDED/)
assert.match(audioScreen, /<div class="lib-row selected"><span>WAV<\/span>/, "selected export row markup must remain valid")

console.log("project audio export unit: ok")
