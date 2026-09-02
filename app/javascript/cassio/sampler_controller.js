import { MicCapture } from "cassio/audio/mic_capture"
import {
  decodeAudioFile, bufferToStored, storedToBuffer, formatDuration,
  peakNormalizeBuffer, sliceBuffer
} from "cassio/audio/sample_io"
import { putUserSound, listUserSounds } from "cassio/store"
import { noteNameToMidi } from "cassio/voices/glass_poly"
import { nudgeRoot, isSample, DEFAULT_SAMPLE_GAIN, patchFromSound } from "cassio/patch"
import { fxDefaults, sanitizeFx, nudgeFx, stepFx, fmtFx } from "cassio/audio/fx_params"
import { buildSettingsRows, knobParamsAt } from "cassio/screens/settings_list"

const DRAFT_UI_KEYS = new Set(["name", "durationLabel", "sourceId", "dirty"])
const DEFAULT_EXPANDED = ["mix", "sample"]

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

/** Sampler screens + mic/import/save/assign/delete flow. */
export class SamplerController {
  constructor(app) {
    this.app = app
    this.mic = new MicCapture(app.engine)
    this.meterTimer = null
  }

  userSamples() {
    return (this.app.userSounds || []).filter((s) => isSample(s))
  }

  hasUnsavedDraft() {
    const a = this.app
    return !!(a.sampleBuffer && a.sampleDraft && !a.sampleDraft.sourceId)
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
      if (key === "c") a.createNewKitFromHub()
      if (key === "d") { a.screen = "menu"; a.render() }
      return true
    }
    if (a.screen === "sampler-home") {
      if (key === "a") void this.openMic()
      if (key === "b") void this.pickFile()
      if (key === "c") this.requestDeleteSelected()
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
      if (key === "d") this.requestLeaveMic()
      return true
    }
    if (a.screen === "sample-edit") {
      if (key === "a") void this.preview()
      if (key === "b") this.openSave()
      if (key === "c") void this.openAssign()
      if (key === "d") void this.requestLeaveEdit()
      return true
    }
    if (a.screen === "sample-save") {
      if (key === "a") { a.screen = "sample-edit"; a.render() }
      if (key === "b") this.askRename()
      if (key === "c") this.askSaveAs()
      if (key === "d") void this.saveToLibrary()
      return true
    }
    if (a.screen === "assign-sample") {
      if (key === "a") void this.assignToKeys()
      if (key === "b") void this.assignToPad()
      if (key === "d") { a.screen = "sample-edit"; a.render() }
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
      const rows = this.editRows()
      const idx = Math.min(rows.length - 1, Math.max(0, a.sampleEditIndex || 0))
      const row = rows[idx]
      if (dir === "up" || dir === "down") {
        a.sampleEditIndex = (idx + (dir === "down" ? 1 : rows.length - 1)) % rows.length
        a.render()
        return true
      }
      if (dir === "ok") {
        if (row?.kind === "group") {
          const set = this.#expanded()
          if (set.has(row.id)) set.delete(row.id); else set.add(row.id)
          a.render()
          return true
        }
        if (row?.kind === "param" && row.p.type === "action") {
          void this.#runAction(row.p.key)
          return true
        }
        void this.preview()
        return true
      }
      if (dir === "left" || dir === "right") {
        if (row?.kind === "param") this.#stepParam(row.p, dir === "right" ? 1 : -1)
        return true
      }
      return true
    }
    return false
  }

  editRows() {
    return buildSettingsRows("sample", this.#expanded())
  }

  #expanded() {
    const a = this.app
    if (!a.sampleEditExpanded) a.sampleEditExpanded = new Set(DEFAULT_EXPANDED)
    return a.sampleEditExpanded
  }

  #setParam(p, value) {
    const a = this.app
    const d = a.sampleDraft
    if (!d) return
    d[p.key] = value
    if (p.key === "trimStart" && d.trimEnd <= d.trimStart + 0.005) d.trimEnd = Math.min(1, d.trimStart + 0.01)
    if (p.key === "trimEnd" && d.trimStart >= d.trimEnd - 0.005) d.trimStart = Math.max(0, d.trimEnd - 0.01)
    if (p.key === "loopStart" && d.loopEnd <= d.loopStart + 0.005) d.loopEnd = Math.min(1, d.loopStart + 0.01)
    if (p.key === "loopEnd" && d.loopStart >= d.loopEnd - 0.005) d.loopStart = Math.max(0, d.loopEnd - 0.01)
    d.dirty = true
    a.toast(`${p.label} ${fmtFx(p, d[p.key])}`)
    this.#applyDraftLive()
    a.render()
  }

  #stepParam(p, dir) {
    const d = this.app.sampleDraft
    if (!d) return
    if (p.type === "action") { void this.#runAction(p.key); return }
    if (p.type === "note") { this.#setParam(p, nudgeRoot(d.root || "C3", dir)); return }
    this.#setParam(p, stepFx(p, d[p.key] ?? p.def, dir))
  }

  async #runAction(key) {
    const a = this.app
    const d = a.sampleDraft
    if (!d || !a.sampleBuffer) return
    if (key === "tapeStopAction") {
      if (!a.sampleVoice.activeCount) await this.preview()
      a.sampleVoice.tapeStop(0.9)
      a.toast("TAPE STOP")
      return
    }
    if (key === "normalizeAction") {
      peakNormalizeBuffer(a.sampleBuffer, 0.95, 40)
      a.samplePeaks = peaksFromBuffer(a.sampleBuffer)
      a.sampleVoice.setBuffer(a.sampleBuffer)
      d.dirty = true
      a.toast("NORMALIZED")
      a.render()
      return
    }
    if (key === "trimAction") {
      const trimmed = (d.trimStart ?? 0) > 0.0005 || (d.trimEnd ?? 1) < 0.9995
      if (!trimmed) { a.toast("NOTHING TO CROP"); return }
      const cropped = sliceBuffer(a.engine.ctx, a.sampleBuffer, d.trimStart, d.trimEnd)
      if (!cropped) { a.toast("CROP FAILED"); return }
      a.sampleBuffer = cropped
      a.samplePeaks = peaksFromBuffer(cropped)
      d.trimStart = 0
      d.trimEnd = 1
      d.durationLabel = formatDuration(cropped.duration)
      d.dirty = true
      this.#applyDraftLive()
      a.toast(`CROPPED · ${d.durationLabel}`)
      a.render()
    }
  }

  nudgeKnob(which, delta) {
    const a = this.app
    if (a.screen === "mic-record") {
      if (which === "m1") {
        this.mic.setGain(this.mic.gain + delta)
        a.toast(`INPUT ${Math.round(this.mic.gain * 100)}%`)
        a.render()
        return true
      }
      // m3 falls through to app master volume
      return false
    }
    if (a.screen === "sample-edit" && a.sampleDraft) {
      const rows = this.editRows()
      const idx = Math.min(rows.length - 1, Math.max(0, a.sampleEditIndex || 0))
      const knobs = knobParamsAt(rows, idx)
      const p = knobs[which === "m1" ? 0 : which === "m2" ? 1 : 2]
      if (!p) return which !== "m3" // unassigned M3 falls through to master
      const d = a.sampleDraft
      if (p.type === "note") this.#setParam(p, nudgeRoot(d.root || "C3", delta > 0 ? 1 : -1))
      else this.#setParam(p, nudgeFx(p, d[p.key] ?? p.def, delta))
      return true
    }
    return false
  }

  back() {
    const a = this.app
    if (a.screen === "assign-sample") {
      a.screen = "sample-edit"
      a.render()
      return true
    }
    if (a.screen === "sample-save") {
      a.screen = "sample-edit"
      a.render()
      return true
    }
    if (a.screen === "sample-edit") {
      void this.requestLeaveEdit()
      return true
    }
    if (a.screen === "mic-record") {
      this.requestLeaveMic()
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

  async requestLeaveEdit() {
    const a = this.app
    if (this.hasUnsavedDraft()) {
      a.askDiscardSample("sample-edit")
      return
    }
    // Auto-save trim/edits for library samples so they persist.
    if (a.sampleDraft?.sourceId && a.sampleDraft.dirty) {
      await this.saveToLibrary({ silent: true })
      a.toast("SAVED")
    }
    this.clearDraft()
    this.openHome()
  }

  requestLeaveMic() {
    if (this.hasUnsavedDraft()) {
      this.app.askDiscardSample("mic-record")
      return
    }
    this.closeMic()
  }

  requestDeleteSelected() {
    const a = this.app
    const list = this.userSamples()
    const s = list[a.samplerIndex || 0]
    if (!s) {
      a.toast("NO SAMPLE")
      return
    }
    a.askDeleteSample(s)
  }

  clearDraft() {
    const a = this.app
    a.sampleBuffer = null
    a.sampleDraft = null
    a.samplePeaks = null
  }

  releaseMic() {
    this.#stopMeterUi()
    this.mic.dispose()
  }

  async openMic() {
    const a = this.app
    a.screen = "mic-record"
    a.render()
    if (!window.isSecureContext) {
      a.toast("NEED HTTPS OR LOCALHOST")
      return
    }
    try {
      await this.mic.ensureMic()
      await a.ensureAudioRunningPublic()
      this.mic.armMeter()
      this.#startMeterUi()
      a.toast("MIC READY")
      a.render()
    } catch (e) {
      a.toast(this.mic.micErrorMessage(e))
      a.render()
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
        await this.openEdit()
      } catch (e) {
        a.toast(this.mic.micErrorMessage(e))
        a.render()
      }
      return
    }
    try {
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
    input.style.cssText = "position:fixed;left:0;top:0;opacity:0;width:1px;height:1px;"
    document.body.appendChild(input)

    let file = null
    try {
      file = await new Promise((resolve) => {
        let done = false
        const finish = (f) => {
          if (done) return
          done = true
          resolve(f)
        }
        input.onchange = () => finish(input.files?.[0] || null)
        input.addEventListener("cancel", () => finish(null))
        // Keep picker in the soft-key gesture turn.
        try {
          if (typeof input.showPicker === "function") {
            input.showPicker().catch(() => input.click())
          } else {
            input.click()
          }
        } catch (_) {
          try { input.click() } catch (e2) {
            finish(null)
            a.toast("CAN'T OPEN FILES")
          }
        }
        // If neither change nor cancel fires (some WebViews), don't hang forever.
        setTimeout(() => finish(null), 120000)
      })
    } finally {
      input.remove()
    }

    if (!file) {
      a.toast("IMPORT CANCELLED")
      return
    }
    try {
      await a.ensureAudioRunningPublic()
      const buf = await decodeAudioFile(a.engine.ctx, file)
      peakNormalizeBuffer(buf, 0.9, 8)
      const base = (file.name || "IMPORT").replace(/\.[^.]+$/, "").slice(0, 18).toUpperCase()
      this.#setDraftFromBuffer(buf, base || "IMPORT")
      a.toast("IMPORTED")
      await this.openEdit()
    } catch (e) {
      a.toast(String(e.message || e).slice(0, 28).toUpperCase())
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
    void this.openFromSound(s)
  }

  async openFromSound(s) {
    const a = this.app
    if (!isSample(s) || !s.audio) {
      a.toast("NO AUDIO")
      return
    }
    try {
      await a.ensureAudioRunningPublic()
      const buf = storedToBuffer(a.engine.ctx, s.audio)
      if (!buf) {
        a.toast("DECODE FAIL")
        return
      }
      peakNormalizeBuffer(buf, 0.9, 4)
      a.sampleBuffer = buf
      a.sampleDraft = {
        ...fxDefaults("sample"),
        ...(s.patch || {}),
        name: s.name,
        root: s.root || s.patch?.root || "C3",
        padMode: s.padMode || s.patch?.padMode || "oneshot",
        durationLabel: formatDuration(buf.duration),
        sourceId: s.id,
        dirty: false
      }
      a.saveName = s.name
      a.sampleEditIndex = 0
      a.samplePeaks = peaksFromBuffer(buf)
      a.sampleVoice.setBuffer(buf)
      a.sampleVoice.applyPatch(a.sampleDraft)
      await this.openEdit()
    } catch (e) {
      a.toast(String(e.message || e).slice(0, 28).toUpperCase())
    }
  }

  async openEdit() {
    this.#stopMeterUi()
    this.mic.dispose()
    const a = this.app
    await a.ensureAudioRunningPublic()
    a.engine.warmSilent?.()
    a.sampleEditIndex = a.sampleEditIndex || 0
    a.screen = "sample-edit"
    a.render()
  }

  /** Flat patch = every sample setting (legacy keys + fx keys), minus UI-only fields. */
  #draftPatch() {
    const d = this.app.sampleDraft || {}
    const out = sanitizeFx(d, "sample")
    for (const k of DRAFT_UI_KEYS) delete out[k]
    out.root = d.root || "C3"
    return out
  }

  #applyDraftLive() {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) return
    a.sampleVoice.setBuffer(a.sampleBuffer)
    a.sampleVoice.applyPatch(this.#draftPatch())
  }

  async preview() {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) {
      a.toast("NO SAMPLE")
      return
    }
    await a.ensureAudioRunningPublic()
    a.engine.warmSilent?.()
    if (a.engine.ctx?.state === "suspended") {
      try { await a.engine.resume() } catch (_) { /* ignore */ }
    }
    if (!a.engine.ready || a.engine.ctx?.state === "suspended") {
      await a.ensureAudioRunningPublic()
      a.engine.warmSilent?.()
    }
    if (!a.engine.ready || a.engine.ctx?.state === "suspended") {
      a.toast("TAP PLAY AGAIN")
      return
    }
    this.#applyDraftLive()
    const midi = noteNameToMidi(a.sampleDraft.root || "C3")
    a.sampleVoice.noteOff(midi, true)
    a.sampleVoice.noteOn(midi, 1)
  }

  openSave() {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) {
      a.toast("NO SAMPLE")
      return
    }
    a.saveName = a.sampleDraft.name || a.saveName || "SAMPLE"
    a.screen = "sample-save"
    a.render()
  }

  askRename() {
    const a = this.app
    a.beginSampleName({
      initial: a.saveName || a.sampleDraft?.name || "SAMPLE",
      returnScreen: "sample-save",
      mode: "save-sample-rename"
    })
  }

  askSaveAs() {
    const a = this.app
    const base = (a.saveName || a.sampleDraft?.name || "SAMPLE").toString().slice(0, 14)
    a.beginSampleName({
      initial: `${base}_2`.slice(0, 18),
      returnScreen: "sample-save",
      mode: "save-sample-as"
    })
  }

  async commitRename(name) {
    const a = this.app
    if (!a.sampleDraft) {
      a.screen = "sample-edit"
      a.render()
      return
    }
    const v = String(name || "").trim().toUpperCase().slice(0, 18)
    if (!v) {
      a.toast("NAME REQUIRED")
      a.screen = "sample-save"
      a.render()
      return
    }
    a.sampleDraft.name = v
    a.saveName = v
    a.sampleDraft.dirty = true
    if (a.sampleBuffer && a.sampleDraft.sourceId) {
      await this.saveToLibrary({ silent: true })
      a.toast(`RENAMED · ${v}`)
    } else {
      a.toast(`NAME · ${v}`)
    }
    a.screen = "sample-save"
    a.render()
  }

  async commitSaveAs(name) {
    const a = this.app
    const v = String(name || "").trim().toUpperCase().slice(0, 18)
    if (!v) {
      a.toast("NAME REQUIRED")
      a.screen = "sample-save"
      a.render()
      return
    }
    if (a.sampleDraft) {
      a.sampleDraft.name = v
      a.saveName = v
    }
    const sound = await this.saveToLibrary({ silent: true, asNew: true })
    if (!sound) {
      a.screen = "sample-save"
      a.render()
      return
    }
    a.toast(`SAVED AS · ${v} · ${a.sampleDraft?.durationLabel || ""}`.trim())
    a.screen = "sample-edit"
    a.render()
  }

  /**
   * Persist to USER / SAMPLES; stay on edit (no key steal).
   * asNew (Save As): crops audio to the trim region → new sound bite with trim reset to 0..1.
   * In-place save keeps full audio + trim points.
   */
  async saveToLibrary({ silent = false, asNew = false } = {}) {
    const a = this.app
    if (!a.sampleBuffer || !a.sampleDraft) {
      a.toast("NO SAMPLE")
      return null
    }
    const name = (a.saveName || a.sampleDraft.name || "SAMPLE").toUpperCase()
    const id = !asNew && a.sampleDraft.sourceId && String(a.sampleDraft.sourceId).startsWith("user-")
      ? a.sampleDraft.sourceId
      : `user-${Date.now().toString(36)}`
    const patch = this.#draftPatch()
    if (asNew && a.engine.ctx) {
      const trimmed = (patch.trimStart ?? 0) > 0.0005 || (patch.trimEnd ?? 1) < 0.9995
      if (trimmed) {
        const cropped = sliceBuffer(a.engine.ctx, a.sampleBuffer, patch.trimStart, patch.trimEnd)
        if (cropped) {
          a.sampleBuffer = cropped
          a.samplePeaks = peaksFromBuffer(cropped)
          a.sampleDraft.trimStart = 0
          a.sampleDraft.trimEnd = 1
          a.sampleDraft.durationLabel = formatDuration(cropped.duration)
          patch.trimStart = 0
          patch.trimEnd = 1
        }
      }
    }
    const sound = {
      id,
      name,
      category: "USER / SAMPLES",
      voice: "sample",
      root: patch.root,
      padMode: patch.padMode || "oneshot",
      source: "user",
      playable: true,
      macros: {
        m1: { label: "LEVEL", param: "gain", default: patch.gain },
        m2: { label: "FX", param: "reverb", default: patch.reverb }
      },
      patch,
      audio: bufferToStored(a.sampleBuffer)
    }
    await putUserSound(sound)
    a.userSounds = await listUserSounds()
    a.focusSound = sound
    const prevId = a.sampleDraft.sourceId
    if (!asNew && prevId && (a.sound?.id === prevId || a.project.soundId === prevId)) {
      a.sound = sound
      a.project.soundId = id
    }
    a.sampleDraft.sourceId = id
    a.sampleDraft.name = name
    a.sampleDraft.dirty = false
    a.saveName = name
    a.sampleVoice.setBuffer(a.sampleBuffer)
    a.sampleVoice.applyPatch(sound.patch)
    a.libTab = "user"
    a.libCategory = "USER / SAMPLES"
    if (!silent) {
      a.toast("SAVED · TRIM + PATCH")
      a.screen = "sample-edit"
      a.render()
    }
    return sound
  }

  async openAssign() {
    const sound = await this.saveToLibrary({ silent: true })
    if (!sound) return
    this.app.toast("SAVED · PICK KEYS OR PAD")
    this.app.screen = "assign-sample"
    this.app.render()
  }

  async assignToKeys() {
    const a = this.app
    const sound = await this.saveToLibrary({ silent: true })
    if (!sound) return
    a.project.soundId = sound.id
    a.sound = sound
    a.focusSound = sound
    a.sampleVoice.setBuffer(a.sampleBuffer)
    a.sampleVoice.applyPatch(sound.patch)
    a.project.root = sound.root || "C3"
    this.clearDraft()
    a.screen = "play"
    a.render()
    a.persistPublic?.()
    a.toast(`KEYS ← ${sound.name}`)
  }

  async assignToPad() {
    const a = this.app
    const sound = await this.saveToLibrary({ silent: true })
    if (!sound) return
    a.focusSound = sound
    a.kitEditMode = false
    a.padSelect = 1
    a.padAssignReturnScreen = "assign-sample"
    a.screen = "pad-assign"
    a.render()
    a.toast("PICK PAD · OK ASSIGNS")
  }

  loadBufferForSound(sound) {
    const a = this.app
    if (!isSample(sound) || !sound.audio || !a.engine.ctx) return null
    const buf = storedToBuffer(a.engine.ctx, sound.audio)
    if (buf) {
      a.sampleVoice.setBuffer(buf)
      let gain = sound.patch?.gain
      // Repair near-silent levels accidentally saved when PLAY M1 became LEVEL
      if (gain == null || !Number.isFinite(Number(gain)) || Number(gain) < 0.75) {
        gain = DEFAULT_SAMPLE_GAIN
        if (sound.patch) sound.patch.gain = gain
      }
      // Full patch (fx defaults filled) so nothing from a previously played sample lingers
      a.sampleVoice.applyPatch(patchFromSound(sound, {
        root: sound.root || sound.patch?.root || "C3",
        gain
      }))
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
      micSpectrum: [...(this.mic.spectrum || [])],
      micTimer: this.mic.elapsedLabel(),
      sampleDraft: a.sampleDraft,
      samplePeaks: a.samplePeaks,
      sampleEditIndex: a.sampleEditIndex || 0,
      sampleEditRows: a.screen === "sample-edit" ? this.editRows() : []
    }
  }

  #setDraftFromBuffer(buf, name) {
    const a = this.app
    a.sampleBuffer = buf
    a.sampleDraft = {
      ...fxDefaults("sample"),
      name,
      root: "C3",
      padMode: "oneshot",
      durationLabel: formatDuration(buf.duration),
      dirty: true
    }
    a.saveName = name
    a.sampleEditIndex = 0
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
    }, 100)
  }

  #stopMeterUi() {
    if (this.meterTimer) clearInterval(this.meterTimer)
    this.meterTimer = null
  }
}

export const SAMPLER_SCREENS = new Set([
  "sound-hub", "sampler-home", "mic-record", "sample-edit", "sample-save", "assign-sample"
])
