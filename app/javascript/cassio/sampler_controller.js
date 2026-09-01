import { MicCapture } from "cassio/audio/mic_capture"
import {
  decodeAudioFile, bufferToStored, storedToBuffer, sliceBuffer, formatDuration
} from "cassio/audio/sample_io"
import { exportSample } from "cassio/audio/export_sample"
import { putUserSound, listUserSounds } from "cassio/store"
import { noteNameToMidi } from "cassio/voices/glass_poly"
import { nudgeRoot, isSample } from "cassio/patch"

const EXPORT_FORMATS = ["wav", "mp3", "m4a"]

function peaksFromBuffer(buf, bars = 48) {
  if (!buf) return []
  const ch = buf.getChannelData(0)
  const out = []
  const step = Math.max(1, Math.floor(ch.length / bars))
  for (let i = 0; i < bars; i++) {
    let peak = 0
    const start = i * step
    const end = Math.min(ch.length, start + step)
    for (let j = start; j < end; j++) {
      const v = Math.abs(ch[j])
      if (v > peak) peak = v
    }
    out.push(peak)
  }
  return out
}

/** Sampler screens + mic/import/save/export flow. */
export class SamplerController {
  constructor(app) {
    this.app = app
    this.mic = new MicCapture(app.engine)
    this.meterTimer = null
  }

  userSamples() {
    return (this.app.userSounds || []).filter((s) => isSample(s))
  }

  openHub() {
    this.app.screen = "sound-hub"
    this.app.render()
  }

  openHome() {
    this.app.samplerIndex = 0
    this.app.screen = "sampler-home"
    this.app.render()
  }

  softKey(key) {
    const a = this.app
    if (a.screen === "sound-hub") {
      if (key === "a") a.openLibraryFromHub()
      if (key === "b") this.openHome()
      if (key === "d") { a.screen = "menu"; a.render() }
      return true
    }
    if (a.screen === "sampler-home") {
      if (key === "a") this.openMic()
      if (key === "b") void this.pickFile()
      if (key === "c") this.openSelected()
      if (key === "d") this.openHub()
      return true
    }
    if (a.screen === "mic-record") {
      if (key === "a") void this.toggleRec()
      if (key === "b") {
        this.mic.setMonitor(!this.mic.monitor)
        a.toast(`MONITOR ${this.mic.monitor ? "ON" : "OFF"}`)
        a.render()
      }
      if (key === "d") {
        if (a.sampleBuffer) this.openEdit()
        else this.closeMic()
      }
      return true
    }
    if (a.screen === "sample-edit") {
      if (key === "a") this.preview()
      if (key === "b") {
        a.exportReturnScreen = "sample-edit"
        a.screen = "export-pick"
        a.render()
      }
      if (key === "c") {
        a.saveName = a.sampleDraft?.name || "SAMPLE"
        a.screen = "save-sample"
        a.render()
      }
      if (key === "d") this.openHome()
      return true
    }
    if (a.screen === "save-sample") {
      if (key === "a") { a.screen = "sample-edit"; a.render() }
      if (key === "b") {
        a.beginSampleName({
          initial: a.saveName || a.sampleDraft?.name || "SAMPLE",
          returnScreen: "save-sample"
        })
      }
      if (key === "c") {
        a.exportReturnScreen = "save-sample"
        a.screen = "export-pick"
        a.render()
      }
      if (key === "d") void this.saveToLibrary()
      return true
    }
    if (a.screen === "export-pick") {
      if (key === "a") void this.doExport()
      if (key === "d") {
        a.screen = a.exportReturnScreen || "sample-edit"
        a.render()
      }
      return true
    }
    return false
  }

  nav(dir) {
    const a = this.app
    if (a.screen === "sampler-home") {
      const list = this.userSamples()
      if (!list.length) return true
      if (dir === "up" || dir === "down") {
        const d = dir === "down" ? 1 : list.length - 1
        a.samplerIndex = ((a.samplerIndex || 0) + d) % list.length
        a.render()
      }
      if (dir === "ok") this.openSelected()
      return true
    }
    if (a.screen === "sample-edit" && a.sampleDraft) {
      if (dir === "left" || dir === "right") {
        a.sampleDraft.root = nudgeRoot(a.sampleDraft.root || "C3", dir === "right" ? 1 : -1)
        a.toast(`ROOT ${a.sampleDraft.root}`)
        a.render()
      }
      if (dir === "up" || dir === "down") {
        a.sampleDraft.padMode = a.sampleDraft.padMode === "oneshot" ? "gate" : "oneshot"
        a.toast(a.sampleDraft.padMode.toUpperCase())
        a.render()
      }
      if (dir === "ok") this.preview()
      return true
    }
    if (a.screen === "export-pick") {
      const idx = Math.max(0, EXPORT_FORMATS.indexOf(a.exportFormat || "wav"))
      if (dir === "up" || dir === "down") {
        const d = dir === "down" ? 1 : EXPORT_FORMATS.length - 1
        a.exportFormat = EXPORT_FORMATS[(idx + d) % EXPORT_FORMATS.length]
        a.render()
      }
      if (dir === "ok") void this.doExport()
      return true
    }
    return false
  }

  nudgeKnob(which, delta) {
    const a = this.app
    if (a.screen === "mic-record" && which === "m1") {
      this.mic.setGain(this.mic.gain + delta)
      a.toast(`GAIN ${Math.round(this.mic.gain * 100)}%`)
      a.render()
      return true
    }
    if (a.screen === "sample-edit" && a.sampleDraft) {
      if (which === "m1") {
        a.sampleDraft.trimStart = Math.min(
          (a.sampleDraft.trimEnd ?? 1) - 0.01,
          Math.max(0, (a.sampleDraft.trimStart ?? 0) + delta)
        )
        a.toast(`START ${Math.round(a.sampleDraft.trimStart * 100)}%`)
        a.render()
        return true
      }
      if (which === "m2") {
        a.sampleDraft.trimEnd = Math.min(
          1,
          Math.max((a.sampleDraft.trimStart ?? 0) + 0.01, (a.sampleDraft.trimEnd ?? 1) + delta)
        )
        a.toast(`END ${Math.round(a.sampleDraft.trimEnd * 100)}%`)
        a.render()
        return true
      }
    }
    return false
  }

  back() {
    const a = this.app
    if (a.screen === "export-pick") {
      a.screen = a.exportReturnScreen || "sample-edit"
      a.render()
      return true
    }
    if (a.screen === "save-sample") {
      a.screen = "sample-edit"
      a.render()
      return true
    }
    if (a.screen === "sample-edit") {
      this.openHome()
      return true
    }
    if (a.screen === "mic-record") {
      this.closeMic()
      return true
    }
    if (a.screen === "sampler-home") {
      this.openHub()
      return true
    }
    if (a.screen === "sound-hub") {
      a.screen = "menu"
      a.render()
      return true
    }
    return false
  }

  openMic() {
    const a = this.app
    a.screen = "mic-record"
    a.render()
    // Don't request permission until REC — clearer user gesture + better errors.
    if (!window.isSecureContext) {
      a.toast("NEED HTTPS OR LOCALHOST")
    }
  }

  closeMic() {
    this.#stopMeterUi()
    this.mic.dispose()
    this.openHome()
  }

  async toggleRec() {
    const a = this.app
    if (this.mic.recording) {
      try {
        const buf = await this.mic.stop()
        this.#stopMeterUi()
        if (!buf) {
          a.toast("NO TAKE")
          a.render()
          return
        }
        this.#setDraftFromBuffer(buf, `REC_${Date.now().toString(36).toUpperCase()}`)
        a.toast("TAKE READY")
        this.openEdit()
      } catch (e) {
        a.toast(this.mic.micErrorMessage(e))
        a.render()
      }
      return
    }
    try {
      // getUserMedia must run in the user-gesture turn — before other awaits.
      await this.mic.ensureMic()
      await a.ensureAudioRunningPublic()
      await this.mic.start()
      this.#startMeterUi()
      a.toast("RECORDING")
      a.render()
    } catch (e) {
      a.toast(this.mic.micErrorMessage(e))
      a.render()
    }
  }

  async pickFile() {
    const a = this.app
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "audio/*,.wav,.mp3,.ogg,.m4a,.aac,.mp4"
    input.style.display = "none"
    document.body.appendChild(input)
    const file = await new Promise((resolve) => {
      input.onchange = () => resolve(input.files?.[0] || null)
      input.addEventListener("cancel", () => resolve(null))
      input.click()
    })
    input.remove()
    if (!file) return
    try {
      await a.engine.start()
      await a.engine.resume()
      const buf = await decodeAudioFile(a.engine.ctx, file)
      const base = (file.name || "IMPORT").replace(/\.[^.]+$/, "").slice(0, 18).toUpperCase()
      this.#setDraftFromBuffer(buf, base || "IMPORT")
      a.toast("IMPORTED")
      this.openEdit()
    } catch (e) {
      a.toast(String(e.message || e))
    }
  }

  openSelected() {
    const a = this.app
    const list = this.userSamples()
    const s = list[a.samplerIndex || 0]
    if (!s) {
      a.toast("NO SAMPLE")
      return
    }
    this.openFromSound(s)
  }

  openFromSound(s) {
    const a = this.app
    if (!isSample(s) || !s.audio) {
      a.toast("NO AUDIO")
      return
    }
    void a.engine.start().then(() => {
      const buf = storedToBuffer(a.engine.ctx, s.audio)
      if (!buf) {
        a.toast("DECODE FAIL")
        return
      }
      a.sampleBuffer = buf
      a.sampleDraft = {
        name: s.name,
        root: s.root || s.patch?.root || "C3",
        padMode: s.padMode || "oneshot",
        trimStart: s.patch?.trimStart ?? 0,
        trimEnd: s.patch?.trimEnd ?? 1,
        durationLabel: formatDuration(buf.duration),
        sourceId: s.id
      }
      a.samplePeaks = peaksFromBuffer(buf)
      a.sampleVoice.setBuffer(buf)
      a.sampleVoice.applyPatch(a.sampleDraft)
      this.openEdit()
    })
  }

  openEdit() {
    this.#stopMeterUi()
    this.app.screen = "sample-edit"
    this.app.render()
  }

  preview() {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) return
    void a.ensureAudioRunningPublic()
    a.sampleVoice.setBuffer(a.sampleBuffer)
    a.sampleVoice.applyPatch({
      trimStart: a.sampleDraft.trimStart,
      trimEnd: a.sampleDraft.trimEnd,
      root: a.sampleDraft.root,
      gain: 1
    })
    const midi = noteNameToMidi(a.sampleDraft.root || "C3")
    a.sampleVoice.noteOff(midi, true)
    a.sampleVoice.noteOn(midi, 0.95)
  }

  async saveToLibrary() {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) {
      a.toast("NO SAMPLE")
      return
    }
    const name = (a.saveName || a.sampleDraft.name || "SAMPLE").toUpperCase()
    const id = a.sampleDraft.sourceId && String(a.sampleDraft.sourceId).startsWith("user-")
      ? a.sampleDraft.sourceId
      : `user-${Date.now().toString(36)}`
    const sound = {
      id,
      name,
      category: "USER / SAMPLES",
      voice: "sample",
      root: a.sampleDraft.root || "C3",
      padMode: a.sampleDraft.padMode || "oneshot",
      source: "user",
      playable: true,
      macros: {
        m1: { label: "START", param: "trimStart", default: a.sampleDraft.trimStart ?? 0 },
        m2: { label: "END", param: "trimEnd", default: a.sampleDraft.trimEnd ?? 1 }
      },
      patch: {
        root: a.sampleDraft.root || "C3",
        trimStart: a.sampleDraft.trimStart ?? 0,
        trimEnd: a.sampleDraft.trimEnd ?? 1,
        gain: 1
      },
      audio: bufferToStored(a.sampleBuffer)
    }
    await putUserSound(sound)
    a.userSounds = await listUserSounds()
    a.focusSound = sound
    a.sound = sound
    a.project.soundId = sound.id
    a.sampleVoice.setBuffer(a.sampleBuffer)
    a.sampleVoice.applyPatch(sound.patch)
    a.toast("SAVED · USER / SAMPLES")
    a.libTab = "user"
    a.libCategory = "USER / SAMPLES"
    a.screen = "detail"
    a.render()
  }

  async doExport() {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) {
      a.toast("NO SAMPLE")
      return
    }
    try {
      await a.engine.start()
      const sliced = sliceBuffer(
        a.engine.ctx,
        a.sampleBuffer,
        a.sampleDraft.trimStart ?? 0,
        a.sampleDraft.trimEnd ?? 1
      )
      const fmt = a.exportFormat || "wav"
      await exportSample(sliced, fmt, a.sampleDraft.name || a.saveName || "CASSIO_SAMPLE")
      a.toast(`EXPORTED ${fmt.toUpperCase()}`)
      a.screen = a.exportReturnScreen || "sample-edit"
      a.render()
    } catch (e) {
      a.toast(String(e.message || e))
    }
  }

  loadBufferForSound(sound) {
    const a = this.app
    if (!isSample(sound) || !sound.audio || !a.engine.ctx) return null
    const buf = storedToBuffer(a.engine.ctx, sound.audio)
    if (buf) {
      a.sampleVoice.setBuffer(buf)
      a.sampleVoice.applyPatch({
        ...(sound.patch || {}),
        root: sound.root || sound.patch?.root || "C3"
      })
    }
    return buf
  }

  stateExtras() {
    const a = this.app
    return {
      userSamples: this.userSamples(),
      samplerIndex: a.samplerIndex || 0,
      micRecording: this.mic.recording,
      micMonitor: this.mic.monitor,
      micGain: this.mic.gain,
      micLevel: this.mic.level,
      micTimer: this.mic.elapsedLabel(),
      sampleDraft: a.sampleDraft,
      samplePeaks: a.samplePeaks,
      exportFormat: a.exportFormat || "wav"
    }
  }

  #setDraftFromBuffer(buf, name) {
    const a = this.app
    a.sampleBuffer = buf
    a.sampleDraft = {
      name,
      root: "C3",
      padMode: "oneshot",
      trimStart: 0,
      trimEnd: 1,
      durationLabel: formatDuration(buf.duration)
    }
    a.samplePeaks = peaksFromBuffer(buf)
    a.sampleVoice.setBuffer(buf)
    a.sampleVoice.applyPatch(a.sampleDraft)
  }

  #startMeterUi() {
    this.#stopMeterUi()
    this.meterTimer = setInterval(() => {
      if (this.app.screen !== "mic-record") return
      if (this.mic.hitMax()) void this.toggleRec()
      else this.app.render()
    }, 120)
  }

  #stopMeterUi() {
    if (this.meterTimer) clearInterval(this.meterTimer)
    this.meterTimer = null
  }
}

export const SAMPLER_SCREENS = new Set([
  "sound-hub", "sampler-home", "mic-record", "sample-edit", "save-sample", "export-pick"
])
