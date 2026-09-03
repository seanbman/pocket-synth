import { AudioEngine } from "cassio/audio_engine"
import { GlassPolyVoice, noteNameToMidi } from "cassio/voices/glass_poly"
import { DrumVoice } from "cassio/voices/drum"
import { SampleVoice } from "cassio/voices/sample"
import { Transport } from "cassio/transport"
import {
  loadRecovery, saveRecovery, defaultProject, defaultPads, defaultLoop, defaultSeq,
  listUserSounds, putUserSound, deleteUserSound, loadFavorites, saveFavorites,
  quantizeGridSec
} from "cassio/store"
import { patchFromSound, nudgeRoot, sanitizePatch, isUserSound, isKit, isDrum, isSample } from "cassio/patch"
import { renderBoot, renderBootError, renderSplash } from "cassio/screens/boot"
import { renderPlay } from "cassio/screens/play"
import { renderMenu, AREAS } from "cassio/screens/menu"
import { renderLibrary } from "cassio/screens/library"
import { renderDetail } from "cassio/screens/detail"
import { renderEdit } from "cassio/screens/edit"
import { renderSaveSound } from "cassio/screens/save_sound"
import { renderPadAssign } from "cassio/screens/pad_assign"
import { renderManage } from "cassio/screens/manage"
import { renderConfirm } from "cassio/screens/confirm"
import { renderNameEntry } from "cassio/screens/name_entry"
import {
  renderSoundHub, renderSamplerHome, renderMicRecord, renderSampleEdit,
  renderSampleSave, renderAssignSample
} from "cassio/screens/sampler"
import { renderLoopTrackView, renderLoopTrackMenu, renderLoopOptions, renderLoopFx, LOOP_BAR_WIDTH_PX } from "cassio/screens/loop"
import { renderTrackList } from "cassio/screens/track_list"
import { SamplerController, SAMPLER_SCREENS } from "cassio/sampler_controller"
import { LoopController, LOOP_SCREENS } from "cassio/loop_controller"
import { SeqController, SEQ_SCREENS } from "cassio/seq_controller"
import { MixController, MIX_SCREENS } from "cassio/mix_controller"
import { renderSequencer, renderStepEdit } from "cassio/screens/sequencer"
import { renderMixer } from "cassio/screens/mixer"
import { StepSequencer } from "cassio/audio/step_sequencer"
import { fxKnob01 } from "cassio/audio/fx_params"
import { knobParamsAt } from "cassio/screens/settings_list"
import { Metronome } from "cassio/audio/metronome"
import { LoopEngine } from "cassio/audio/loop_engine"
import { storedToBuffer } from "cassio/audio/sample_io"

const NEW_KIT_ENTRY = {
  id: "__new-kit__",
  name: "+ NEW KIT",
  kind: "kit",
  voice: "kit",
  category: "USER / KITS",
  playable: false,
  pads: []
}

const KEY_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12
}

const KNOB_MIN_DEG = -135
const KNOB_MAX_DEG = 135
const VIZ_SILENCE = 0.006
const VIZ_GAIN = 2.8
const EDIT_SCREENS = new Set([
  "edit-shape", "edit-env", "edit-eq", "edit-fx",
  "edit-drum-tone", "edit-drum-decay", "edit-drum-snap", "edit-drum-fx"
])
const DRUM_EDIT_SCREENS = new Set([
  "edit-drum-tone", "edit-drum-decay", "edit-drum-snap", "edit-drum-fx"
])
const PAD_DEG = [0, 2, 4, 5, 7, 9]

export class CassioApp {
  constructor(root) {
    this.root = root
    this.vscreen = root.querySelector("[data-vscreen]")
    this.vscreenOverlay = root.querySelector("[data-vscreen-overlay]")
    this.keyboardEl = root.querySelector(".keyboard")
    this.portraitGate = root.querySelector("[data-portrait-gate]")
    this.engine = new AudioEngine()
    this.synth = new GlassPolyVoice(this.engine)
    this.padSynth = new GlassPolyVoice(this.engine)
    this.drums = new DrumVoice(this.engine)
    this.sampleVoice = new SampleVoice(this.engine)
    this.sampleVoice.bpmSource = () => this.transport?.bpm
    this.sampler = new SamplerController(this)
    this.voice = this.synth
    this.transport = new Transport()
    this.metro = new Metronome(this.engine)
    this.loopEngine = new LoopEngine(this.engine, this.transport)
    this.looper = new LoopController(this)
    this.stepSeq = new StepSequencer(
      this.transport,
      (lane, opts) => this.#triggerPad(lane, { ...opts, fromSeq: true }),
      { trackProvider: () => this.loopEngine.tracks }
    )
    this.stepSeq.onStep = (i, lanes) => this.#onSeqStep(i, lanes)
    this.seqCtl = new SeqController(this)
    this.seqFlash = new Set()
    this.mixer = new MixController(this)
    this.factory = null
    this.userSounds = []
    this.favorites = []
    this.screen = "splash"
    this.menuIndex = 0
    this.heldKeys = new Map()
    this.heldPads = new Map()
    this.pointerKeys = new Map()
    this.project = defaultProject()
    this.sound = null
    this.focusSound = null
    this.editPatch = null
    this.editDirty = false
    this.editReturnScreen = "detail"
    this.saveName = ""
    this.libTab = "factory"
    this.libCategory = null
    this.libIndex = 0
    this.padSelect = 1
    this.kitEditMode = false
    this.kitDirty = false
    this.kitFocus = null
    this.libPickMode = false
    this.librarySnapshot = null
    this.nameDraft = ""
    this.nameMode = null
    this.nameReturnScreen = "save-sound"
    this.confirmTitle = ""
    this.confirmLines = []
    this.confirmAction = null
    this.samplerIndex = 0
    this.sampleBuffer = null
    this.sampleDraft = null
    this.samplePeaks = null
    this.sampleEditIndex = 0
    this.sampleEditExpanded = null
    this.exportFormat = "wav"
    this.exportReturnScreen = "sample-edit"
    this.padAssignReturnScreen = null
    this.loopMenuIndex = 0
    this.loopOptIndex = 0
    this.playNavFocus = "root" // "root" | "metro" — OK toggles; ▲▼ adjust focus
    this.confirmOkLabel = "DELETE"
    this.confirmReturnScreen = "sound-manage"
    this.booting = true
    this.bootError = null
    this.splashDone = false
    this.audioUnlocked = false
    this._unlocking = null
    this._vizRaf = null
    this._tapHoldTimer = null
    this._tapHeld = false
    this._loopNavHoldTimer = null
    this._loopNavHoldInterval = null
    this._loopNavHoldDir = null
    this._loopNavSecMode = false
    this._softHoldKey = null
    this._softHoldTimer = null
    this._softHeld = null
    this.loopTimelineDirty = false
    this.loopScrollLeft = 0
    this.loopScrollTop = 0
    this.loopScrollFollow = true
    this.seqTrackId = null
    this.playContext = null // null | "loop" | "seq" — only one auditions at a time
    this._renderScreen = undefined
    this.#bindHardware()
    this.#bindPitchWheel()
    this.#bindKeyboardPointer()
    this.#bindComputerKeys()
    this.#bindGestureUnlock()
    this.#bindOrientation()
    this.#fitChassis()
    this.root.addEventListener("selectstart", (e) => e.preventDefault())
    window.addEventListener("resize", () => this.#fitChassis())
    this.render()
    this.#runSplashThenBoot()
  }

  async #runSplashThenBoot() {
    await this.#bootThenLogoIntro()
  }

  #setPreloadMsg(msg) {
    const el = document.querySelector("#cassio-preload .cassio-preload-msg")
    if (el) el.textContent = msg
  }

  #dismissPreload() {
    document.getElementById("cassio-preload")?.remove()
  }

  /** Load under preload (if present), then V-screen logo fade → PLAY. Also used for retry. */
  async #bootThenLogoIntro() {
    this.bootError = null
    this.booting = true
    this.splashDone = true
    this.screen = "boot"
    this.#setPreloadMsg("LOADING…")
    try {
      await this.#loadBootAssets()
      this.#dismissPreload()
      this.screen = "splash"
      this.splashDone = false
      this.render()
      await new Promise((r) => setTimeout(r, 1650))
      this.splashDone = true
      this.booting = false
      this.screen = "play"
      this.render()
      this.#syncAllKnobVisuals()
      this.#persist()
    } catch (e) {
      // #region agent log
      fetch("http://127.0.0.1:7775/ingest/fa1177f6-1e5b-449a-b03a-5969bd555f1e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "397b28" },
        body: JSON.stringify({
          sessionId: "397b28",
          runId: "crash-1",
          hypothesisId: "D",
          location: "app.js:#bootThenLogoIntro",
          message: "boot failed",
          data: { message: String(e?.message || e), stack: String(e?.stack || "").slice(0, 600) },
          timestamp: Date.now()
        })
      }).catch(() => {})
      fetch("/debug_ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "397b28",
          runId: "crash-1",
          hypothesisId: "D",
          location: "app.js:#bootThenLogoIntro",
          message: "boot failed",
          data: { message: String(e?.message || e), stack: String(e?.stack || "").slice(0, 600) },
          timestamp: Date.now()
        }),
        keepalive: true
      }).catch(() => {})
      // #endregion
      this.bootError = String(e.message || e) || "AUDIO INIT FAILED — TAP TO RETRY"
      this.#dismissPreload()
      this.render()
    }
  }

  async #startBoot() {
    await this.#bootThenLogoIntro()
  }

  async #loadBootAssets() {
    this.#setBootProgress(0.2, "LOADING FACTORY…")
    const res = await fetch("/factory/sounds.json")
    this.factory = await res.json()
    this.#setBootProgress(0.4, "LOADING USER…")
    this.userSounds = await listUserSounds()
    this.favorites = await loadFavorites()
    this.#setBootProgress(0.6, "LOADING RECOVERY…")
    const recovered = await loadRecovery()
    if (recovered) {
      Object.assign(this.project, recovered)
      if (!this.project.pads?.length) this.project.pads = defaultPads()
    } else if (this.factory?.defaultPads?.length) {
      this.project.pads = this.factory.defaultPads.map((p) => ({
        pad: p.pad,
        soundId: p.soundId,
        level: p.level ?? 1,
        pan: p.pan ?? 0,
        mode: p.mode || "oneshot",
        patch: p.patch || null
      }))
      this.project.padBank = "KIT TIGHT"
    }
    this.transport.bpm = this.project.bpm
    if (this.project.kitVolume == null) this.project.kitVolume = 1
    if (!this.project.loop) this.project.loop = defaultLoop()
    if (!this.project.seq) this.project.seq = defaultSeq()
    this.stepSeq.applyState(this.project.seq)
    this.project.seq = this.stepSeq.seq
    this.#setBootProgress(0.8, "LOADING AUDIO…")
    await this.engine.start()
    this.transport.attach(this.engine)
    this.transport.onTick = (bar, beat, accent) => {
      if (this.#metroAudible()) this.metro.click(accent)
      if (LOOP_SCREENS.has(this.screen) || this.screen === "play") {
        // light UI refresh for playhead — throttle via rAF
        if (!this._loopUiRaf) {
          this._loopUiRaf = requestAnimationFrame(() => {
            this._loopUiRaf = null
            if (LOOP_SCREENS.has(this.screen) || this.screen === "play") this.render()
          })
        }
      }
    }
    this.metro.setOn(this.project.loop.metroOn !== false)
    this.metro.setLevel(this.project.loop.metroLevel ?? 0.7)
    this.metro.setAccent(this.project.loop.metroAccent !== false)
    this.loopEngine.applyState(this.project.loop)
    this.drums.ensureNoiseCache()
    this.engine.setMasterVolume(this.project.masterVolume)
    this.#resolveSound(this.project.soundId)
    this.#applyProjectPatch()
    this.#setBootProgress(1, "READY")
  }

  #bindGestureUnlock() {
    const unlock = () => { void this.#unlockAudioFromGesture() }
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true })
    window.addEventListener("keydown", unlock, { capture: true })
  }

  async #unlockAudioFromGesture() {
    if (this.audioUnlocked && this.engine.ctx?.state === "running") return
    if (this._unlocking) return this._unlocking
    this._unlocking = (async () => {
      try {
        await this.engine.start()
        await this.engine.resume()
        this.drums.ensureNoiseCache()
        this.engine.warmSilent()
        this.audioUnlocked = this.engine.ctx?.state === "running"
      } catch (_) { /* ignore */ }
      finally { this._unlocking = null }
    })()
    return this._unlocking
  }

  async #ensureAudioRunning() {
    if (!this.engine.ready) await this.engine.start()
    if (this.engine.ctx?.state === "suspended") await this.engine.resume()
    if (!this.audioUnlocked && this.engine.ctx?.state === "running") {
      this.drums.ensureNoiseCache()
      this.engine.warmSilent()
      this.audioUnlocked = true
    }
  }

  #setBootProgress(p, msg) {
    this.bootProgress = p
    this.bootMessage = msg
    if (document.getElementById("cassio-preload")) {
      this.#setPreloadMsg(msg)
      return
    }
    this.render()
  }

  #factorySounds() {
    return this.factory?.sounds || []
  }

  #resolveSound(id) {
    const user = this.userSounds.find((s) => s.id === id)
    if (user) {
      this.sound = user
      return user
    }
    const fac = this.#factorySounds().find((s) => s.id === id) || this.#factorySounds()[0]
    this.sound = fac
    return fac
  }

  #applyProjectPatch() {
    const s = this.sound
    const fromSound = s && !isKit(s) ? patchFromSound(s, {
      root: this.project.root || s.root,
      brightness: this.project.brightness,
      resonance: this.project.resonance ?? 0.34,
      attack: this.project.attack ?? 0.018,
      release: this.project.release ?? 0.48,
      bassDb: this.project.bassDb ?? 0,
      trebleDb: this.project.trebleDb ?? 0,
      reverb: this.project.space,
      delay: this.project.delay ?? 0,
      drive: this.project.drive,
      pulseWidth: this.project.pulseWidth,
      motion: this.project.motion,
      tone: this.project.tone,
      decay: this.project.decay,
      snap: this.project.snap
    }) : sanitizePatch({
      root: this.project.root || "C3",
      brightness: this.project.brightness,
      resonance: this.project.resonance ?? 0.34,
      attack: this.project.attack ?? 0.018,
      release: this.project.release ?? 0.48,
      bassDb: this.project.bassDb ?? 0,
      trebleDb: this.project.trebleDb ?? 0,
      reverb: this.project.space,
      delay: this.project.delay ?? 0
    })
    if (isDrum(s)) {
      this.drums.applyPatch(fromSound)
    } else if (isSample(s)) {
      // Samples own their whole patch (fx chain) — synth project values must not leak in.
      const sp = patchFromSound(s, { root: this.project.root || s.root })
      this.sampler.loadBufferForSound(s)
      this.sampleVoice.applyPatch(sp)
      // PLAY macros: level (not trim) · FX — independent of M3 master
      const g = sp.gain != null && sp.gain >= 0.75 ? sp.gain : 1.5
      this.sampleVoice.gain = g
      s.macros = {
        m1: { label: "LEVEL", param: "gain", default: g },
        m2: { label: "FX", param: "reverb", default: sp.reverb ?? 0.2 }
      }
    } else {
      this.synth.applyPatch(fromSound)
    }
    this.project.root = fromSound.root
  }

  #commitPatchToProject(patch) {
    const p = sanitizePatch(patch)
    this.project.root = p.root
    this.project.brightness = p.brightness
    this.project.resonance = p.resonance
    this.project.attack = p.attack
    this.project.release = p.release
    this.project.bassDb = p.bassDb
    this.project.trebleDb = p.trebleDb
    this.project.space = p.reverb
    this.project.delay = p.delay
    this.project.drive = p.drive
    this.project.pulseWidth = p.pulseWidth
    this.project.motion = p.motion
    this.project.tone = p.tone
    this.project.decay = p.decay
    this.project.snap = p.snap
    if (isDrum(this.sound)) this.drums.applyPatch(p)
    else if (isSample(this.sound)) {
      this.sampler.loadBufferForSound(this.sound)
      this.sampleVoice.applyPatch({ root: p.root })
    } else this.synth.applyPatch(p)
  }

  #keyboardIsDrum() {
    return isDrum(this.sound)
  }

  #keyboardIsSample() {
    if (this.screen === "sample-edit" && this.sampleBuffer && this.sampleDraft) return true
    return isSample(this.sound)
  }

  /** Public persist for sampler assign flows. */
  persistPublic() {
    this.#persist()
  }

  /** Public transport stop for smoke tests. */
  transportStopPublic() {
    this.#transportStop()
  }

  /** Public transport play for smoke tests. */
  transportPlayPublic() {
    return this.#transportPlay()
  }

  /** Public play-context apply for loop controller undo/restart. */
  applyPlayContextPublic(origin) {
    this.#applyPlayContext(origin)
  }

  /** Preview a library track from the track list (seq and/or PCM). */
  previewLibraryTrack(entry, origin) {
    this.stopLibraryPreview()
    if (!entry || !this.engine?.ready) return
    const t0 = origin ?? this.engine.now() + 0.05
    this._libPreviewSources = []
    if (entry.audio && this.engine.ctx) {
      const buf = storedToBuffer(this.engine.ctx, entry.audio)
      if (buf) {
        const src = this.engine.ctx.createBufferSource()
        src.buffer = buf
        src.connect(this.engine.master)
        try { src.start(t0) } catch (_) { /* ignore */ }
        this._libPreviewSources.push(src)
      }
    }
    const previewTrack = {
      id: -1,
      assigned: true,
      mute: false,
      padSlot: entry.padSlot || 1,
      seq: entry.seq
    }
    this._libPreviewTracks = [previewTrack]
    this._libPreviewPrevProvider = this.stepSeq.trackProvider
    this.stepSeq.trackProvider = () => this._libPreviewTracks
    if (!this.transport.playing) {
      this.transport.playAt(t0)
      this._libPreviewStartedTransport = true
    }
    this.stepSeq.start(t0, { mode: "arrangement" })
  }

  stopLibraryPreview() {
    if (this._libPreviewSources) {
      for (const src of this._libPreviewSources) {
        try { src.stop(0) } catch (_) { /* ignore */ }
      }
      this._libPreviewSources = []
    }
    if (this._libPreviewPrevProvider) {
      this.stepSeq.trackProvider = this._libPreviewPrevProvider
      this._libPreviewPrevProvider = null
    }
    this._libPreviewTracks = null
    if (this._libPreviewStartedTransport) {
      this._libPreviewStartedTransport = false
      if (this.playContext == null) {
        this.transport.stop()
        this.stepSeq.stop()
      }
    } else if (this.playContext === "loop" && this.transport.playing) {
      this.#applyPlayContext()
    } else if (!this.transport.playing) {
      this.stepSeq.stop()
    }
  }

  /** Display name of the sound on pad n (sequencer lane labels). */
  padSoundName(n) {
    const { assigned } = this.#padSound(n)
    return assigned ? String(assigned.name || assigned.id).toUpperCase() : "EMPTY"
  }

  askDiscardSample(returnScreen = "sample-edit") {
    this.confirmTitle = "DISCARD TAKE?"
    this.confirmLines = [
      { text: this.sampleDraft?.name || "SAMPLE", tone: "green" },
      { text: "NOT SAVED TO USER / SAMPLES.", tone: "muted" },
      { text: "A KEEP · D DISCARD", tone: "muted" }
    ]
    this.confirmAction = "discard-sample"
    this.confirmOkLabel = "DISCARD"
    this.confirmReturnScreen = returnScreen
    this.screen = "confirm"
    this.render()
  }

  askDeleteSample(sound) {
    if (!sound) {
      this.toast("NO SAMPLE")
      return
    }
    this.focusSound = sound
    this.confirmTitle = "DELETE SAMPLE?"
    this.confirmLines = [
      { text: sound.name, tone: "green" },
      { text: "THIS CANNOT BE UNDONE.", tone: "muted" },
      { text: "A CANCEL · D DELETE", tone: "muted" }
    ]
    this.confirmAction = "delete-sound"
    this.confirmOkLabel = "DELETE"
    this.confirmReturnScreen = "sampler-home"
    this.screen = "confirm"
    this.render()
  }

  #soundById(id) {
    if (!id) return null
    return this.userSounds.find((s) => s.id === id)
      || this.#factorySounds().find((s) => s.id === id)
      || null
  }

  #isFavorite(id) {
    return this.favorites.includes(id)
  }

  state() {
    const list = this.#libraryList()
    return {
      bpm: this.transport.bpm,
      playing: this.transport.playing,
      recording: this.transport.recording,
      octave: this.project.octave,
      hold: this.project.hold,
      root: this.project.root,
      sound: this.sound,
      focusSound: this.focusSound || this.sound,
      editPatch: this.editPatch,
      editDirty: this.editDirty,
      saveName: this.saveName,
      menuIndex: this.menuIndex,
      screen: this.screen,
      libTab: this.libTab,
      libCategory: this.libCategory,
      libCategories: this.#libraryCategories(),
      libList: list,
      libIndex: this.libIndex,
      isFavorite: this.#isFavorite((this.focusSound || this.sound)?.id),
      pads: this.project.pads,
      padSelect: this.padSelect,
      padBank: this.project.padBank || "PADS",
      kitEditMode: this.kitEditMode,
      kitDirty: this.kitDirty,
      kitFocus: this.kitFocus,
      kitVolume: this.project.kitVolume ?? 1,
      editReturnScreen: this.editReturnScreen,
      libPickMode: this.libPickMode,
      factorySounds: this.#factorySounds(),
      userSounds: this.userSounds,
      nameDraft: this.nameDraft,
      confirmTitle: this.confirmTitle,
      confirmLines: this.confirmLines,
      confirmOkLabel: this.confirmOkLabel || "DELETE",
      confirmAction: this.confirmAction,
      playNavFocus: this.playNavFocus || "root",
      ...this.sampler.stateExtras(),
      ...this.looper.stateExtras(),
      ...this.seqCtl.stateExtras(),
      ...this.mixer.stateExtras()
    }
  }

  openLibraryFromHub() {
    this.#openLibrary()
  }

  createNewKitFromHub() {
    this.#createNewKit()
  }

  beginSampleName({ initial, returnScreen, mode = "save-sample" }) {
    this.#askName({
      initial: initial || "SAMPLE",
      mode,
      returnScreen: returnScreen || "sample-save"
    })
  }

  async ensureAudioRunningPublic() {
    await this.#ensureAudioRunning()
  }

  render() {
    this.#stopViz()
    const prevScreen = this._renderScreen
    this._renderScreen = this.screen
    if (prevScreen !== undefined && prevScreen !== this.screen) this.#onPlayContextBoundary()
    if (this.bootError) {
      this.vscreen.innerHTML = renderBootError(this.bootError)
    } else if (!this.splashDone || this.screen === "splash") {
      this.vscreen.innerHTML = renderSplash()
    } else if (this.booting) {
      this.vscreen.innerHTML = renderBoot(this.bootProgress || 0.1, this.bootMessage || "LOADING…")
    } else if (this.screen === "menu") {
      this.vscreen.innerHTML = renderMenu(this.state())
    } else if (this.screen === "sound-hub") {
      this.vscreen.innerHTML = renderSoundHub(this.state())
    } else if (this.screen === "sampler-home") {
      this.vscreen.innerHTML = renderSamplerHome(this.state())
    } else if (this.screen === "mic-record") {
      this.vscreen.innerHTML = renderMicRecord(this.state())
    } else if (this.screen === "sample-edit") {
      this.vscreen.innerHTML = renderSampleEdit(this.state())
    } else if (this.screen === "sample-save") {
      this.vscreen.innerHTML = renderSampleSave(this.state())
    } else if (this.screen === "assign-sample") {
      this.vscreen.innerHTML = renderAssignSample(this.state())
    } else if (this.screen === "loop-tracks") {
      this.vscreen.innerHTML = renderLoopTrackView(this.state())
      requestAnimationFrame(() => {
        this.#syncLoopTimeline()
        requestAnimationFrame(() => this.#syncLoopTimeline())
      })
    } else if (this.screen === "loop-menu") {
      this.vscreen.innerHTML = renderLoopTrackMenu(this.state())
      requestAnimationFrame(() => {
        this.vscreen.querySelector(".lib-row.selected")?.scrollIntoView({ block: "nearest" })
      })
    } else if (this.screen === "loop-options") {
      this.vscreen.innerHTML = renderLoopOptions(this.state())
      requestAnimationFrame(() => {
        this.vscreen.querySelector(".lib-row.selected")?.scrollIntoView({ block: "nearest" })
      })
    } else if (this.screen === "loop-fx") {
      this.vscreen.innerHTML = renderLoopFx(this.state())
    } else if (this.screen === "track-list") {
      this.vscreen.innerHTML = renderTrackList(this.state())
      requestAnimationFrame(() => {
        this.vscreen.querySelector(".lib-row.selected")?.scrollIntoView({ block: "nearest" })
      })
    } else if (this.screen === "sequencer") {
      this.vscreen.innerHTML = renderSequencer(this.state())
      this.seqCtl.startPlayheadLoop()
    } else if (this.screen === "step-edit") {
      this.vscreen.innerHTML = renderStepEdit(this.state())
    } else if (this.screen === "mixer") {
      this.vscreen.innerHTML = renderMixer(this.state())
    } else if (this.screen === "library") {
      this.vscreen.innerHTML = renderLibrary(this.state())
      requestAnimationFrame(() => {
        this.vscreen.querySelector(".lib-row.selected")?.scrollIntoView({ block: "nearest" })
      })
    } else if (this.screen === "detail") {
      this.vscreen.innerHTML = renderDetail(this.state())
    } else if (EDIT_SCREENS.has(this.screen)) {
      this.vscreen.innerHTML = renderEdit(this.state())
    } else if (this.screen === "save-sound") {
      this.vscreen.innerHTML = renderSaveSound(this.state())
    } else if (this.screen === "pad-assign") {
      this.vscreen.innerHTML = renderPadAssign(this.state())
    } else if (this.screen === "sound-manage") {
      this.vscreen.innerHTML = renderManage(this.state())
    } else if (this.screen === "confirm") {
      this.vscreen.innerHTML = renderConfirm(this.state())
    } else if (this.screen === "name-entry") {
      this.vscreen.innerHTML = renderNameEntry(this.state())
      requestAnimationFrame(() => this.#bindNameField())
    } else {
      this.vscreen.innerHTML = renderPlay(this.state())
      this.#startViz()
    }
    this.#syncLeds()
    this.#syncAllKnobVisuals()
    this.#fitChassis()
  }

  #knobAngle(value01) {
    const v = Math.min(1, Math.max(0, value01))
    return KNOB_MIN_DEG + v * (KNOB_MAX_DEG - KNOB_MIN_DEG)
  }

  #m1Value() {
    if (this.screen === "loop-fx") return this.looper.fxKnob01(0) ?? 0
    if (this.screen === "mixer" || this.screen === "loop-tracks" || this.screen === "loop-menu") {
      return this.loopEngine.selectedTrack?.level ?? 1
    }
    if (this.screen === "sample-edit" && this.sampleDraft) return this.#sampleEditKnob01(0)
    if (this.screen === "pad-assign") return this.#selectedPad()?.level ?? 1
    if (this.screen === "edit-drum-tone") return this.editPatch?.tone ?? 0.5
    if (this.screen === "edit-drum-decay") return this.editPatch?.decay ?? 0.4
    if (this.screen === "edit-drum-snap") return this.editPatch?.snap ?? 0.55
    if (this.screen === "edit-drum-fx") return this.editPatch?.reverb ?? 0
    if (this.screen === "edit-shape") return this.editPatch?.brightness ?? 0.68
    if (this.screen === "edit-env") return Math.min(1, (this.editPatch?.attack ?? 0.018) / 1.2)
    if (this.screen === "edit-eq") return ((this.editPatch?.bassDb ?? 0) + 12) / 24
    if (this.screen === "edit-fx") return this.editPatch?.reverb ?? 0
    if (this.#keyboardIsSample()) return Math.min(1, (this.sampleVoice.gain ?? 1) / 2.5)
    return this.project.brightness
  }

  #m2Value() {
    if (this.screen === "loop-fx") return this.looper.fxKnob01(1) ?? 0
    if (this.screen === "mixer" || this.screen === "loop-tracks" || this.screen === "loop-menu") {
      return ((this.loopEngine.selectedTrack?.pan ?? 0) + 1) / 2
    }
    if (this.screen === "sample-edit" && this.sampleDraft) return this.#sampleEditKnob01(1)
    if (this.screen === "pad-assign") return ((this.#selectedPad()?.pan ?? 0) + 1) / 2
    if (this.screen === "edit-drum-tone") return this.editPatch?.tuning ?? 0.5
    if (this.screen === "edit-drum-decay") return this.editPatch?.noise ?? 0.5
    if (this.screen === "edit-drum-snap") return this.editPatch?.drive ?? 0.1
    if (this.screen === "edit-drum-fx") return this.editPatch?.delay ?? 0
    if (this.screen === "edit-shape") return this.editPatch?.resonance ?? 0.34
    if (this.screen === "edit-env") return Math.min(1, (this.editPatch?.release ?? 0.48) / 2.5)
    if (this.screen === "edit-eq") return ((this.editPatch?.trebleDb ?? 0) + 12) / 24
    if (this.screen === "edit-fx") return this.editPatch?.delay ?? 0
    return this.project.space
  }

  #m3Value() {
    if (this.screen === "sample-edit" && this.sampleDraft) {
      const v = this.#sampleEditKnob01(2)
      if (v != null) return v
    }
    if (this.screen === "loop-fx") {
      const v = this.looper.fxKnob01(2)
      if (v != null) return v
    }
    if (this.screen === "pad-assign") {
      if (this.kitEditMode) return this.project.kitVolume ?? 1
      return this.#selectedPad()?.level ?? 1
    }
    if (EDIT_SCREENS.has(this.screen) && this.editReturnScreen === "pad-assign") {
      return this.#selectedPad()?.level ?? 1
    }
    return this.project.masterVolume
  }

  /** Knob visual for SAMPLE EDIT: knobs follow the cursor row (null = unassigned). */
  #sampleEditKnob01(i) {
    const rows = this.sampler.editRows()
    const knobs = knobParamsAt(rows, this.sampleEditIndex || 0)
    const p = knobs[i]
    if (!p) return i === 2 ? null : 0
    return Math.min(1, Math.max(0, fxKnob01(p, this.sampleDraft[p.key] ?? p.def)))
  }

  #selectedPad() {
    return this.project.pads?.find((p) => p.pad === this.padSelect) || null
  }

  #padGain(slot) {
    const kit = Math.min(1, Math.max(0, this.project.kitVolume ?? 1))
    const level = Math.min(1, Math.max(0, slot?.level ?? 1))
    return kit * level
  }

  #syncKnobVisual(which) {
    const el = this.root.querySelector(`[data-knob="${which}"]`)
    if (!el) return
    let value = 0
    if (which === "m1") value = this.#m1Value()
    else if (which === "m2") value = this.#m2Value()
    else if (which === "m3") value = this.#m3Value()
    el.style.transform = `rotate(${this.#knobAngle(value)}deg)`
  }

  #syncAllKnobVisuals() {
    this.#syncKnobVisual("m1")
    this.#syncKnobVisual("m2")
    this.#syncKnobVisual("m3")
  }

  #startViz() {
    const canvas = this.vscreen.querySelector("[data-viz-wave]")
    if (!canvas) return
    const ctx2d = canvas.getContext("2d")
    const w = canvas.width
    const h = canvas.height
    const mid = h / 2

    const draw = () => {
      this._vizRaf = requestAnimationFrame(draw)
      ctx2d.fillStyle = "#000"
      ctx2d.fillRect(0, 0, w, h)

      const rms = this.engine.getRms()
      const wave = this.engine.getWaveform()
      const vol = this.project.masterVolume ?? 0.7
      const active = this.synth.voices.size > 0 || this.padSynth.voices.size > 0
        || this.drums.activeCount > 0 || rms > VIZ_SILENCE

      ctx2d.strokeStyle = "#ff2e7e"
      ctx2d.lineWidth = 1.5
      ctx2d.lineJoin = "round"
      ctx2d.lineCap = "round"

      if (!active || !wave) {
        ctx2d.beginPath()
        ctx2d.moveTo(0, mid)
        ctx2d.lineTo(w, mid)
        ctx2d.stroke()
        return
      }

      const scale = Math.min(1.35, (0.22 + rms * 9) * (0.45 + vol * 0.9)) * VIZ_GAIN
      const n = wave.length
      const yAt = (i) => {
        const idx = Math.floor((i / (w - 1)) * (n - 1))
        return mid - (wave[idx] || 0) * mid * scale
      }

      ctx2d.beginPath()
      ctx2d.moveTo(0, yAt(0))
      for (let i = 1; i < w; i++) ctx2d.lineTo(i, yAt(i))
      ctx2d.stroke()

      ctx2d.beginPath()
      ctx2d.moveTo(0, mid)
      ctx2d.lineTo(0, yAt(0))
      for (let i = 1; i < w; i++) ctx2d.lineTo(i, yAt(i))
      ctx2d.lineTo(w - 1, mid)
      ctx2d.closePath()
      ctx2d.fillStyle = "rgba(255, 46, 126, 0.12)"
      ctx2d.fill()
    }
    draw()
  }

  #stopViz() {
    if (this._vizRaf != null) {
      cancelAnimationFrame(this._vizRaf)
      this._vizRaf = null
    }
  }

  #syncLeds() {
    this.root.querySelectorAll("[data-led]").forEach((el) => {
      const name = el.dataset.led
      let on = false
      if (name === "play") on = this.transport.playing
      if (name === "rec") on = this.transport.recording
      if (name === "stop") on = !this.transport.playing
      el.classList.toggle("lit", on)
    })
    this.root.querySelectorAll("[data-pad]").forEach((el) => {
      const n = Number(el.dataset.pad)
      el.classList.toggle("active", this.heldPads.has(n) || this.seqFlash.has(n))
    })
  }

  #onSeqStep(_i, lanes) {
    for (const l of lanes) this.seqFlash.add(l + 1)
    this.#syncLeds()
    clearTimeout(this._seqFlashTimer)
    this._seqFlashTimer = setTimeout(() => {
      this.seqFlash.clear()
      this.#syncLeds()
    }, 90)
  }

  /** Resolve a pad's slot, sound and merged patch (shared by pads and the sequencer). */
  #padSound(n) {
    const slot = this.project.pads?.find((p) => p.pad === n)
    const assigned = slot?.soundId ? this.#soundById(slot.soundId) : null
    if (!assigned) return { slot, assigned: null, patch: null }
    const patch = isKit(assigned) ? null : patchFromSound(assigned, {
      ...(assigned.patch || {}),
      ...(slot.patch || {})
    })
    return { slot, assigned, patch }
  }

  /**
   * Fire pad n's sound at an exact audio time (step sequencer). Gate-mode samples and
   * synth pads get a scheduled release at when + gateSec. Never touches held/HOLD state.
   */
  #activeRecTrack() {
    if (!this.loopEngine.recording) return null
    return this.loopEngine._recTrack?.id ?? this.loopEngine.selected
  }

  #recTrackForPad(_n) {
    return this.#activeRecTrack()
  }

  /** Active loop capture bus — keyboard/overdub targets the armed recording track. */
  #recTrackLive() {
    return this.#activeRecTrack()
  }

  #inLoopPerformance() {
    return LOOP_SCREENS.has(this.screen) || this.loopEngine.recording
  }

  #triggerPad(n, { when = null, velocity = 1, gateSec = null, recTrack = null } = {}) {
    if (!this.engine.ready) return false
    const track = recTrack ?? this.#recTrackForPad(n)
    const { slot, assigned, patch } = this.#padSound(n)
    if (!assigned || isKit(assigned) || assigned.playable === false) return false
    const gain = Math.min(1, Math.max(0, velocity)) * this.#padGain(slot)
    if (isDrum(assigned)) {
      this.drums.applyPatch(patch)
      this.drums.setPan(slot.pan ?? 0)
      this.drums.noteOn(this.#padMidi(n), Math.min(1, 0.95 * gain), { when, recTrack: track })
      return true
    }
    if (isSample(assigned)) {
      this.sampler.loadBufferForSound(assigned)
      this.sampleVoice.applyPatch(patch)
      this.sampleVoice.setPan(slot.pan ?? 0)
      const midi = noteNameToMidi(assigned.root || assigned.patch?.root || "C3")
      const mode = slot.mode || assigned.padMode || "oneshot"
      this.sampleVoice.noteOn(midi, Math.min(1, 0.95 * gain), { when, recTrack: track })
      if (mode === "gate" && gateSec) this.sampleVoice.noteOff(midi, false, { when: (when ?? this.engine.now()) + gateSec })
      return true
    }
    this.padSynth.applyPatch(patch)
    this.padSynth.setPan(slot.pan ?? 0)
    const midi = this.#padMidi(n)
    this.padSynth.noteOn(midi, Math.min(1, 0.9 * gain), { when, recTrack: track })
    const hold = gateSec ?? this.#synthHoldMs(patch) / 1000
    this.padSynth.noteOff(midi, false, { when: (when ?? this.engine.now()) + hold })
    return true
  }

  toast(msg) {
    if (!this.vscreenOverlay) return
    this.vscreenOverlay.textContent = msg
    this.vscreenOverlay.classList.add("show")
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => {
      this.vscreenOverlay.classList.remove("show")
      this.vscreenOverlay.textContent = ""
    }, 1600)
  }

  #fitChassis() {
    const chassis = this.root.querySelector(".chassis")
    if (chassis) chassis.style.transform = ""
  }

  /** Restore scroll; optionally pan to keep the selected track clip in view. */
  #syncLoopTimeline() {
    const scroller = this.vscreen.querySelector("[data-loop-scroll]")
    if (!scroller) return

    const defaultBars = this.loopEngine.lengthBars
    const timelineBars = this.loopEngine.timelineBars()
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)

    if (maxScroll <= 0) {
      this.loopScrollLeft = 0
    } else if (this.loopScrollFollow !== false) {
      this.#followLoopTimelineScroll(scroller, maxScroll)
    } else if (timelineBars <= defaultBars) {
      this.loopScrollLeft = Math.min(this.loopScrollLeft || 0, maxScroll)
    } else {
      this.loopScrollLeft = Math.min(this.loopScrollLeft || 0, maxScroll)
    }

    this.#applyLoopScroll(scroller)

    if (!scroller.dataset.loopScrollBound) {
      scroller.dataset.loopScrollBound = "1"
      scroller.addEventListener("scroll", () => {
        if (this._loopScrollProgrammatic) return
        this.loopScrollLeft = scroller.scrollLeft
        this.loopScrollTop = scroller.scrollTop
        this.loopScrollFollow = false
      }, { passive: true })
    }
    this.#bindLoopTimelineTap()
  }

  /** Tap a timeline row to focus that track without opening the track menu. */
  #bindLoopTimelineTap() {
    const grid = this.vscreen.querySelector(".loop-tgrid")
    if (!grid || grid.dataset.loopTapBound) return
    grid.dataset.loopTapBound = "1"
    let downX = 0
    let downY = 0
    grid.addEventListener("pointerdown", (e) => {
      if (this.screen !== "loop-tracks") return
      downX = e.clientX
      downY = e.clientY
    }, { passive: true })
    grid.addEventListener("pointerup", (e) => {
      if (this.screen !== "loop-tracks") return
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return
      const row = e.target.closest(".loop-trow[data-track-id]")
      if (!row) return
      const id = Number(row.dataset.trackId)
      if (!id) return
      this.looper.selectTrack(id)
    })
  }

  /** Pan horizontal scroll so the selected track clip stays visible. */
  #followLoopTimelineScroll(scroller, maxScroll) {
    const le = this.loopEngine
    const t = le.selectedTrack
    if (!t?.assigned) return

    const timelineBars = le.timelineBars()
    const timelineSec = le.timelineSec()
    const timelineW = timelineBars * LOOP_BAR_WIDTH_PX
    if (timelineSec <= 0 || timelineW <= 0) return

    const offPx = ((t.offsetSec ?? 0) / timelineSec) * timelineW
    const trackBars = t.lengthBars || le.lengthBars
    const clipW = Math.max(8, (trackBars / timelineBars) * timelineW - 2)
    const clipEnd = offPx + clipW
    const viewW = scroller.clientWidth
    const margin = 36
    let scroll = this.loopScrollLeft || 0

    if (offPx < scroll + margin) {
      scroll = Math.max(0, offPx - margin)
    } else if (clipEnd > scroll + viewW - margin) {
      scroll = Math.min(maxScroll, clipEnd - viewW + margin)
    }

    this.loopScrollLeft = scroll
  }

  #applyLoopScroll(scroller) {
    this._loopScrollProgrammatic = true
    scroller.scrollLeft = this.loopScrollLeft || 0
    scroller.scrollTop = this.loopScrollTop || 0
    this._loopScrollProgrammatic = false
  }

  #reflowPadsAfterPortrait() {
    const mid = this.root.querySelector(".mid-row")
    const panel = this.root.querySelector(".mid-panel")
    const pads = this.root.querySelector(".pads")
    for (const el of [mid, panel, pads]) {
      if (!el) continue
      el.style.height = ""
      el.style.minHeight = ""
      el.style.maxHeight = ""
    }
    if (mid) {
      mid.style.display = "none"
      void mid.offsetHeight
      mid.style.display = ""
    }
    void this.root.offsetHeight
    this.#fitChassis()
    requestAnimationFrame(() => {
      this.#fitChassis()
      void this.root.offsetHeight
      this._needsOrientReflow = false
    })
  }

  #schedulePortraitReflow() {
    clearTimeout(this._orientReflowTimer)
    this._orientReflowTimer = setTimeout(() => this.#reflowPadsAfterPortrait(), 120)
  }

  #bindOrientation() {
    const apply = () => {
      const mq = window.matchMedia("(orientation: landscape)")
      const mobileish = window.matchMedia("(max-height: 560px), (max-width: 920px)").matches
      const landscape = mq.matches && window.innerWidth > window.innerHeight && mobileish
      this.root.classList.toggle("landscape", landscape)
      if (this.portraitGate) this.portraitGate.hidden = !landscape
      if (landscape) {
        this._needsOrientReflow = true
        this.#releaseAllPointerKeys()
        this.#releaseAllComputerKeys()
        for (const n of [...this.heldPads.keys()]) this.#padUp(n, { force: true })
      } else if (this._needsOrientReflow) {
        this.#schedulePortraitReflow()
      } else {
        requestAnimationFrame(() => this.#fitChassis())
      }
    }
    apply()
    window.matchMedia("(orientation: landscape)").addEventListener("change", apply)
    window.addEventListener("resize", apply)
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        if (this.root.classList.contains("landscape")) return
        if (this._needsOrientReflow) this.#schedulePortraitReflow()
      })
    }
  }

  /**
   * Coalesce recovery writes. Knob turns called this up to 55×/s on the phone, and each
   * write copied + structured-cloned all loop audio (~8 MB) — WebKit's memory watchdog
   * then killed and reloaded the tab (crash evidence: debug session 397b28).
   */
  #persist() {
    clearTimeout(this._persistTimer)
    this._persistTimer = setTimeout(() => this.#persistNow(), 600)
  }

  /** Flush a pending recovery write immediately (pagehide / backgrounding). */
  flushPersist() {
    if (!this._persistTimer) return
    clearTimeout(this._persistTimer)
    this._persistTimer = null
    this.#persistNow()
  }

  #persistNow() {
    this._persistTimer = null
    if (!this.project.loop) this.project.loop = defaultLoop()
    const loop = {
      ...this.project.loop,
      ...this.loopEngine.serialize(),
      metroOn: this.metro.on,
      metroLevel: this.metro.level,
      metroAccent: this.metro.accent,
      countInBars: this.project.loop.countInBars ?? 1
    }
    // #region agent log
    try {
      const audioBytes = (loop.tracks || []).reduce((n, t) => {
        const chs = t.audio?.channels
        if (!chs) return n
        return n + chs.reduce((a, c) => a + (c?.byteLength || c?.length * 4 || 0), 0)
      }, 0)
      fetch("http://127.0.0.1:7775/ingest/fa1177f6-1e5b-449a-b03a-5969bd555f1e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "397b28" },
        body: JSON.stringify({
          sessionId: "397b28",
          runId: "crash-1",
          hypothesisId: "B",
          location: "app.js:#persist",
          message: "persist recovery",
          data: {
            screen: this.screen,
            soundId: this.project.soundId,
            audioMB: Math.round(audioBytes / 1e4) / 100,
            trackBuffers: (loop.tracks || []).map((t) => !!t.audio),
            memMB: performance?.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null
          },
          timestamp: Date.now()
        })
      }).catch(() => {})
      fetch("/debug_ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "397b28",
          runId: "crash-1",
          hypothesisId: "B",
          location: "app.js:#persist",
          message: "persist recovery",
          data: {
            screen: this.screen,
            soundId: this.project.soundId,
            audioMB: Math.round(audioBytes / 1e4) / 100,
            trackBuffers: (loop.tracks || []).map((t) => !!t.audio),
            memMB: performance?.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null
          },
          timestamp: Date.now()
        }),
        keepalive: true
      }).catch(() => {})
    } catch (_) { /* ignore */ }
    // #endregion
    this.project.loop = loop
    this.project.seq = this.stepSeq.serialize()
    saveRecovery({
      bpm: this.transport.bpm,
      seq: this.project.seq,
      soundId: this.project.soundId,
      octave: this.project.octave,
      hold: this.project.hold,
      masterVolume: this.project.masterVolume,
      brightness: this.project.brightness,
      resonance: this.project.resonance,
      attack: this.project.attack,
      release: this.project.release,
      bassDb: this.project.bassDb,
      trebleDb: this.project.trebleDb,
      space: this.project.space,
      delay: this.project.delay,
      root: this.project.root,
      padBank: this.project.padBank,
      kitVolume: this.project.kitVolume ?? 1,
      pads: this.project.pads,
      loop
    })
  }

  persistLoop() {
    this.#persist()
  }

  setMetroOn(on) {
    this.metro.setOn(on)
    if (!this.project.loop) this.project.loop = defaultLoop()
    this.project.loop.metroOn = this.metro.on
    this.toast(`METRO ${this.metro.on ? "ON" : "OFF"}`)
    this.#persist()
    this.render()
  }

  setMetroLevel(level) {
    this.metro.setLevel(level)
    if (!this.project.loop) this.project.loop = defaultLoop()
    this.project.loop.metroLevel = this.metro.level
    this.toast(`METRO ${Math.round(this.metro.level * 100)}%`)
    this.#persist()
    this.render()
  }

  #tapTempo() {
    const result = this.transport.tap()
    this.project.bpm = result.bpm
    this.metro.tapClick()
    if (this.transport.playing) {
      this.transport.resyncFromNow()
      this.#applyPlayContext(this.transport._origin)
    }
    if (result.locked) this.toast(`BPM ${result.bpm}`)
    else this.toast("TAP TEMPO…")
    this.render()
    this.#persist()
  }

  #bindHardware() {
    this.root.addEventListener("pointerdown", (e) => {
      if (this.root.classList.contains("landscape")) return
      if (this.booting || this.bootError) {
        void this.#unlockAudioFromGesture()
        if (this.bootError) {
          this.bootError = null
          this.booting = true
          this.#startBoot()
        }
        return
      }
      const btn = e.target.closest("[data-action]")
      if (!btn) return
      if (btn.dataset.action.startsWith("key-")) return
      e.preventDefault()
      this.#handleAction(btn.dataset.action, btn, "down", e)
    })
    this.root.addEventListener("pointerup", (e) => {
      const btn = e.target.closest("[data-action]")
      if (!btn) return
      if (btn.dataset.action.startsWith("key-")) return
      this.#handleAction(btn.dataset.action, btn, "up", e)
    })
    this.root.querySelectorAll("[data-knob]").forEach((knob) => {
      let lastY = null
      knob.addEventListener("pointerdown", (e) => {
        lastY = e.clientY
        knob.setPointerCapture(e.pointerId)
      })
      knob.addEventListener("pointermove", (e) => {
        if (lastY == null || this.booting) return
        const dy = lastY - e.clientY
        lastY = e.clientY
        this.#nudgeKnob(knob.dataset.knob, dy * 0.01)
      })
      knob.addEventListener("pointerup", () => { lastY = null })
      knob.addEventListener("pointercancel", () => { lastY = null })
    })
  }

  #bindPitchWheel() {
    const wheel = this.root.querySelector("[data-pitch-wheel]")
    const roller = this.root.querySelector("[data-pitch-roller]")
    if (!wheel || !roller) return

    const TAP_PX = 6
    const maxTravel = () => Math.max(18, wheel.clientHeight * 0.28)
    let dragging = false
    let startY = 0
    let startBend = 0
    let maxAbsDy = 0

    const applyVisual = (semitones) => {
      const y = (-semitones / 2) * maxTravel()
      roller.style.transform = `translateY(calc(-50% + ${y}px))`
      wheel.setAttribute("aria-valuenow", String(Math.round(semitones * 100) / 100))
    }

    const setBend = (semitones, spring = false) => {
      const v = Math.min(2, Math.max(-2, semitones))
      this.synth.setPitchBend(v)
      this.padSynth.setPitchBend(v)
      this.drums.setPitchBend(v)
      this.sampleVoice.setPitchBend(v)
      if (spring) wheel.classList.remove("is-dragging")
      else wheel.classList.add("is-dragging")
      applyVisual(v)
    }

    this._setPitchBendVisual = setBend
    this._applyPitchVisual = applyVisual

    const endDrag = () => {
      if (!dragging) return
      dragging = false
      const tapped = maxAbsDy < TAP_PX
      maxAbsDy = 0

      if (this.project.hold) {
        if (tapped && Math.abs(this.synth.pitchBend || 0) > 0.01) {
          setBend(0, true)
        } else {
          wheel.classList.remove("is-dragging")
          applyVisual(this.synth.pitchBend || 0)
        }
        return
      }
      setBend(0, true)
    }

    wheel.addEventListener("pointerdown", (e) => {
      if (this.booting || this.bootError || this.root.classList.contains("landscape")) return
      e.preventDefault()
      this.#ensureAudioRunning()
      dragging = true
      startY = e.clientY
      startBend = this.synth.pitchBend || 0
      maxAbsDy = 0
      wheel.setPointerCapture(e.pointerId)
      wheel.classList.add("is-dragging")
    })
    wheel.addEventListener("pointermove", (e) => {
      if (!dragging) return
      const dy = startY - e.clientY
      maxAbsDy = Math.max(maxAbsDy, Math.abs(dy))
      const semitones = startBend + (dy / maxTravel()) * 2
      setBend(semitones, false)
    })
    wheel.addEventListener("pointerup", endDrag)
    wheel.addEventListener("pointercancel", endDrag)
    wheel.addEventListener("lostpointercapture", endDrag)
    applyVisual(0)
  }

  #bindKeyboardPointer() {
    const kb = this.keyboardEl
    if (!kb) return

    const degreeFromPoint = (x, y) => {
      const el = document.elementFromPoint(x, y)
      const key = el?.closest?.(".key[data-action]")
      if (!key || !kb.contains(key)) return null
      const m = key.dataset.action.match(/^key-(\d+)$/)
      return m ? Number(m[1]) : null
    }

    const setPointerDegree = (pointerId, next) => {
      const prev = this.pointerKeys.has(pointerId) ? this.pointerKeys.get(pointerId) : null
      if (prev === next) return
      if (prev != null) this.#keyUp(prev)
      if (next != null) {
        this.pointerKeys.set(pointerId, next)
        this.#keyDown(next)
      } else {
        this.pointerKeys.delete(pointerId)
      }
    }

    const endPointer = (e) => {
      if (!this.pointerKeys.has(e.pointerId)) return
      const deg = this.pointerKeys.get(e.pointerId)
      this.pointerKeys.delete(e.pointerId)
      this.#keyUp(deg)
    }

    kb.addEventListener("pointerdown", (e) => {
      if (this.booting || this.bootError || this.root.classList.contains("landscape")) return
      const key = e.target.closest(".key[data-action]")
      if (!key) return
      e.preventDefault()
      e.stopPropagation()
      kb.setPointerCapture(e.pointerId)
      const deg = degreeFromPoint(e.clientX, e.clientY)
      if (deg != null) setPointerDegree(e.pointerId, deg)
    })

    kb.addEventListener("pointermove", (e) => {
      if (!kb.hasPointerCapture(e.pointerId)) return
      setPointerDegree(e.pointerId, degreeFromPoint(e.clientX, e.clientY))
    })

    kb.addEventListener("pointerup", endPointer)
    kb.addEventListener("pointercancel", endPointer)
    kb.addEventListener("lostpointercapture", endPointer)
  }

  #nudgeKnob(which, delta) {
    if (LOOP_SCREENS.has(this.screen) && this.looper.nudgeKnob(which, delta)) return
    if (SEQ_SCREENS.has(this.screen) && this.seqCtl.nudgeKnob(which, delta)) return
    if (MIX_SCREENS.has(this.screen) && this.mixer.nudgeKnob(which, delta)) return
    if (SAMPLER_SCREENS.has(this.screen) && this.sampler.nudgeKnob(which, delta)) return

    if (this.screen === "pad-assign") {
      const p = this.#selectedPad()
      if (!p) return
      if (which === "m1") {
        p.level = Math.min(1, Math.max(0, (p.level ?? 1) + delta))
        this.toast(`PAD ${this.padSelect} LVL ${Math.round(p.level * 100)}%`)
      } else if (which === "m2") {
        p.pan = Math.min(1, Math.max(-1, (p.pan ?? 0) + delta * 2))
        this.toast(`PAD ${this.padSelect} PAN ${Math.round(p.pan * 100)}`)
      } else if (which === "m3") {
        if (this.kitEditMode) {
          this.project.kitVolume = Math.min(1, Math.max(0, (this.project.kitVolume ?? 1) + delta))
          this.toast(`KIT VOL ${Math.round(this.project.kitVolume * 100)}%`)
        } else {
          p.level = Math.min(1, Math.max(0, (p.level ?? 1) + delta))
          this.toast(`PAD ${this.padSelect} LVL ${Math.round(p.level * 100)}%`)
        }
      }
      if (this.kitEditMode) this.kitDirty = true
      this.#syncKnobVisual(which)
      this.render()
      this.#persist()
      this.#previewPadSlot()
      return
    }

    if (which === "m3") {
      if (EDIT_SCREENS.has(this.screen) && this.editReturnScreen === "pad-assign") {
        const p = this.#selectedPad()
        if (p) {
          p.level = Math.min(1, Math.max(0, (p.level ?? 1) + delta))
          if (this.kitEditMode || this.kitFocus) this.kitDirty = true
          this.toast(`PAD ${this.padSelect} LVL ${Math.round(p.level * 100)}%`)
          this.#syncKnobVisual(which)
          this.#persist()
          return
        }
      }
      this.project.masterVolume = Math.min(1, Math.max(0, this.project.masterVolume + delta))
      this.engine.setMasterVolume(this.project.masterVolume)
      this.toast(`VOLUME ${Math.round(this.project.masterVolume * 100)}%`)
      this.#syncKnobVisual(which)
      this.#persist()
      return
    }

    if (EDIT_SCREENS.has(this.screen) && this.editPatch) {
      this.editPatch = sanitizePatch(this.editPatch)
      this.editDirty = true
      const synthEng = this.editReturnScreen === "pad-assign" ? this.padSynth : this.synth
      if (DRUM_EDIT_SCREENS.has(this.screen)) {
        if (this.screen === "edit-drum-tone") {
          if (which === "m1") {
            this.editPatch.tone = Math.min(1, Math.max(0, (this.editPatch.tone ?? 0.5) + delta))
            this.drums.setTone(this.editPatch.tone)
            this.toast(`TONE ${Math.round(this.editPatch.tone * 100)}%`)
          } else {
            this.editPatch.tuning = Math.min(1, Math.max(0, (this.editPatch.tuning ?? 0.5) + delta))
            this.drums.setTuning(this.editPatch.tuning)
            this.toast(`TUNE ${Math.round(this.editPatch.tuning * 100)}%`)
          }
        } else if (this.screen === "edit-drum-decay") {
          if (which === "m1") {
            this.editPatch.decay = Math.min(1, Math.max(0.02, (this.editPatch.decay ?? 0.4) + delta))
            this.drums.setDecay(this.editPatch.decay)
            this.toast(`DECAY ${Math.round(this.editPatch.decay * 100)}%`)
          } else {
            this.editPatch.noise = Math.min(1, Math.max(0, (this.editPatch.noise ?? 0.5) + delta))
            this.drums.setNoise(this.editPatch.noise)
            this.toast(`NOISE ${Math.round(this.editPatch.noise * 100)}%`)
          }
        } else if (this.screen === "edit-drum-snap") {
          if (which === "m1") {
            this.editPatch.snap = Math.min(1, Math.max(0, (this.editPatch.snap ?? 0.55) + delta))
            this.drums.setSnap(this.editPatch.snap)
            this.toast(`SNAP ${Math.round(this.editPatch.snap * 100)}%`)
          } else {
            this.editPatch.drive = Math.min(1, Math.max(0, (this.editPatch.drive ?? 0.1) + delta))
            this.drums.setDrive(this.editPatch.drive)
            this.toast(`DRIVE ${Math.round(this.editPatch.drive * 100)}%`)
          }
        } else if (this.screen === "edit-drum-fx") {
          if (which === "m1") {
            this.editPatch.reverb = Math.min(1, Math.max(0, (this.editPatch.reverb ?? 0) + delta))
            this.drums.setReverb(this.editPatch.reverb)
            this.toast(`ROOM ${Math.round(this.editPatch.reverb * 100)}%`)
          } else {
            this.editPatch.delay = Math.min(1, Math.max(0, (this.editPatch.delay ?? 0) + delta))
            this.drums.setDelay(this.editPatch.delay)
            this.toast(`DELAY ${Math.round(this.editPatch.delay * 100)}%`)
          }
        }
        this.editPatch = sanitizePatch(this.editPatch)
        this.drums.applyPatch(this.editPatch)
        this.#syncKnobVisual(which)
        this.render()
        this.#auditionDrumEdit()
        return
      }
      if (this.screen === "edit-shape") {
        if (which === "m1") {
          this.editPatch.brightness = Math.min(1, Math.max(0.05, this.editPatch.brightness + delta))
          synthEng.setBrightness(this.editPatch.brightness)
          this.toast(`CUTOFF ${Math.round(this.editPatch.brightness * 100)}%`)
        } else {
          this.editPatch.resonance = Math.min(1, Math.max(0, this.editPatch.resonance + delta))
          synthEng.setResonance(this.editPatch.resonance)
          this.toast(`RES ${Math.round(this.editPatch.resonance * 100)}%`)
        }
      } else if (this.screen === "edit-env") {
        if (which === "m1") {
          this.editPatch.attack = Math.min(1.2, Math.max(0.005, this.editPatch.attack + delta * 0.6))
          synthEng.setAttack(this.editPatch.attack)
          this.toast(`ATK ${Math.round(this.editPatch.attack * 1000)}ms`)
        } else {
          this.editPatch.release = Math.min(2.5, Math.max(0.02, this.editPatch.release + delta * 0.8))
          synthEng.setRelease(this.editPatch.release)
          this.toast(`REL ${Math.round(this.editPatch.release * 1000)}ms`)
        }
      } else if (this.screen === "edit-eq") {
        if (which === "m1") {
          this.editPatch.bassDb = Math.min(12, Math.max(-12, this.editPatch.bassDb + delta * 24))
          this.engine.setBassDb(this.editPatch.bassDb)
          this.toast(`BASS ${Math.round(this.editPatch.bassDb)}dB`)
        } else {
          this.editPatch.trebleDb = Math.min(12, Math.max(-12, this.editPatch.trebleDb + delta * 24))
          this.engine.setTrebleDb(this.editPatch.trebleDb)
          this.toast(`TREBLE ${Math.round(this.editPatch.trebleDb)}dB`)
        }
      } else if (this.screen === "edit-fx") {
        if (which === "m1") {
          this.editPatch.reverb = Math.min(1, Math.max(0, this.editPatch.reverb + delta))
          this.engine.setSpace(this.editPatch.reverb)
          this.toast(`REVERB ${Math.round(this.editPatch.reverb * 100)}%`)
        } else {
          this.editPatch.delay = Math.min(1, Math.max(0, this.editPatch.delay + delta))
          this.engine.setDelay(this.editPatch.delay)
          this.toast(`DELAY ${Math.round(this.editPatch.delay * 100)}%`)
        }
      }
      this.editPatch = sanitizePatch(this.editPatch)
      this.#syncKnobVisual(which)
      this.render()
      return
    }

    if (which === "m1") {
      this.#rideMacro("m1", delta)
    } else if (which === "m2") {
      this.#rideMacro("m2", delta)
    }
    this.#syncKnobVisual(which)
    this.#persist()
  }

  #rideMacro(slot, delta) {
    const s = this.sound
    const macro = s?.macros?.[slot]
    const param = macro?.param || (slot === "m1" ? "brightness" : "space")
    const label = macro?.label || (slot === "m1" ? "TONE" : "FX")

    const nudge01 = (key, projectKey = key) => {
      const cur = this.project[projectKey] ?? 0.5
      const next = Math.min(1, Math.max(key === "brightness" ? 0.05 : 0, cur + delta))
      this.project[projectKey] = next
      return next
    }

    if (this.#keyboardIsSample()) {
      if (param === "gain" || param === "level" || (slot === "m1" && param !== "reverb" && param !== "space" && param !== "delay")) {
        const cur = this.sampleVoice.gain ?? s?.patch?.gain ?? 1.5
        const next = Math.min(2.5, Math.max(0.15, cur + delta))
        this.sampleVoice.setGain(next)
        if (!s.patch) s.patch = {}
        s.patch.gain = next
        const stored = this.userSounds?.find((u) => u.id === s.id)
        if (stored) {
          if (!stored.patch) stored.patch = {}
          stored.patch.gain = next
          if (!stored.macros) stored.macros = {}
          stored.macros.m1 = { label: "LEVEL", param: "gain", default: next }
        }
        s.macros = {
          m1: { label: "LEVEL", param: "gain", default: next },
          m2: s.macros?.m2 || { label: "FX", param: "reverb", default: s.patch?.reverb ?? 0.2 }
        }
        // Debounce IDB writes — every nudge was saving ducked levels
        clearTimeout(this._sampleGainSaveTimer)
        this._sampleGainSaveTimer = setTimeout(() => {
          void putUserSound(s).catch(() => {})
        }, 400)
        this.toast(`SAMPLE ${Math.round(next * 100)}%`)
        return
      }
      if (param === "space" || param === "reverb") {
        const cur = s?.patch?.reverb ?? this.sampleVoice.p?.reverb ?? 0.2
        const v = Math.min(1, Math.max(0, cur + delta))
        this.sampleVoice.applyPatch({ reverb: v })
        if (!s.patch) s.patch = {}
        s.patch.reverb = v
        this.toast(`${label} ${Math.round(v * 100)}%`)
        return
      }
      if (param === "delay") {
        const cur = s?.patch?.delay ?? this.sampleVoice.p?.delay ?? 0
        const v = Math.min(1, Math.max(0, cur + delta))
        this.sampleVoice.applyPatch({ delay: v })
        if (!s.patch) s.patch = {}
        s.patch.delay = v
        this.toast(`${label} ${Math.round(v * 100)}%`)
        return
      }
    }

    if (this.#keyboardIsDrum()) {
      if (param === "tone" || param === "brightness" || param === "color") {
        const v = nudge01("tone", "tone")
        this.project.brightness = v
        this.drums.setTone(v)
        this.toast(`${label} ${Math.round(v * 100)}%`)
      } else if (param === "snap") {
        const v = nudge01("snap", "snap")
        this.drums.setSnap(v)
        this.toast(`${label} ${Math.round(v * 100)}%`)
      } else {
        const v = nudge01("decay", "decay")
        this.project.release = 0.05 + v * 2.2
        this.drums.setDecay(v)
        this.toast(`${label} ${Math.round(v * 100)}%`)
      }
      return
    }

    if (param === "drive") {
      const v = nudge01("drive", "drive")
      this.synth.setDrive(v)
      this.toast(`${label} ${Math.round(v * 100)}%`)
    } else if (param === "pulseWidth" || param === "width") {
      const v = Math.min(0.92, Math.max(0.08, (this.project.pulseWidth ?? 0.5) + delta))
      this.project.pulseWidth = v
      this.synth.setPulseWidth(v)
      this.toast(`${label} ${Math.round(v * 100)}%`)
    } else if (param === "motion") {
      const v = nudge01("motion", "motion")
      this.synth.setMotion(v)
      this.toast(`${label} ${Math.round(v * 100)}%`)
    } else if (param === "decay") {
      const v = nudge01("decay", "decay")
      this.project.release = 0.05 + v * 2.2
      this.synth.setRelease(this.project.release)
      this.toast(`${label} ${Math.round(v * 100)}%`)
    } else if (param === "space" || param === "reverb") {
      const v = nudge01("space", "space")
      this.engine.setSpace(v)
      this.toast(`${label} ${Math.round(v * 100)}%`)
    } else {
      const v = nudge01("brightness", "brightness")
      this.synth.setBrightness(v)
      this.toast(`${label} ${Math.round(v * 100)}%`)
    }
  }

  #handleAction(action, el, phase, event) {
    if (action.startsWith("soft-")) {
      const key = action.split("-")[1]
      if (this.screen === "loop-tracks" && (key === "a" || key === "b" || key === "c")) {
        if (phase === "down") {
          this._softHeld = null
          this._softHoldKey = key
          this._softHoldTimer = setTimeout(() => {
            this._softHoldTimer = null
            this._softHeld = key
            if (key === "a") {
              this.looper.askDeleteLane("loop-tracks")
            } else if (key === "b") {
              this.seqCtl.open()
            } else {
              this.screen = "loop-options"
              this.loopOptIndex = 0
              this.render()
            }
          }, 380)
        } else if (this._softHoldKey === key) {
          if (this._softHoldTimer) {
            clearTimeout(this._softHoldTimer)
            this._softHoldTimer = null
          }
          if (!this._softHeld) this.#softKey(key)
          this._softHeld = null
          this._softHoldKey = null
        }
        return
      }
      if (phase === "down") this.#softKey(key)
      return
    }
    if (action.startsWith("pad-")) {
      const n = Number(action.split("-")[1])
      if (phase === "down") this.#padDown(n)
      else this.#padUp(n)
      return
    }
    if (action.startsWith("key-")) return
    if (phase !== "down") {
      if (action === "stop" && this._stopHoldTimer) {
        clearTimeout(this._stopHoldTimer)
        this._stopHoldTimer = null
      }
      if (action === "tap") {
        if (this._tapHoldTimer) {
          clearTimeout(this._tapHoldTimer)
          this._tapHoldTimer = null
        }
        if (this._tapHeld) {
          this._tapHeld = false
          return
        }
        void this.#ensureAudioRunning().then(() => this.#tapTempo())
        return
      }
      if (action === "back-menu") {
        if (this._menuHoldTimer) {
          clearTimeout(this._menuHoldTimer)
          this._menuHoldTimer = null
        }
        if (this._menuOpenedByHold) {
          this._menuOpenedByHold = false
          return
        }
        this.#backTap()
      }
      if (action === "nav-ok" && this._okHoldTimer !== undefined) {
        // Sequencer: OK acts on release so a hold can open Step Edit instead
        if (this._okHoldTimer) {
          clearTimeout(this._okHoldTimer)
          this._okHoldTimer = null
          this.#navOk()
        }
        this._okHoldTimer = undefined
      }
      if (action === "nav-left" || action === "nav-right") {
        this.#loopNavHorizontalUp()
      }
      return
    }
    switch (action) {
      case "play":
        void this.#ensureAudioRunning().then(() => this.#transportPlay())
        break
      case "stop":
        this._stopHoldTimer = setTimeout(() => {
          this._stopHoldTimer = null
          this.synth.allNotesOff()
          this.padSynth.allNotesOff()
          this.drums.allNotesOff()
          this.sampleVoice.allNotesOff?.()
          this.engine.panic()
          this.toast("PANIC")
        }, 450)
        this.#transportStop()
        break
      case "rec":
        void this.#ensureAudioRunning().then(() => this.#transportRec())
        break
      case "tap":
        this._tapHeld = false
        this._tapHoldTimer = setTimeout(() => {
          this._tapHoldTimer = null
          this._tapHeld = true
          this.setMetroOn(!this.metro.on)
        }, 380)
        break
      case "back-menu":
        this._menuOpenedByHold = false
        this._menuHoldTimer = setTimeout(() => {
          this._menuHoldTimer = null
          this._menuOpenedByHold = true
          if (this.screen !== "menu") this.#openMenu()
        }, 380)
        break
      case "nav-up":
        this.#nav("up")
        break
      case "nav-down":
        this.#nav("down")
        break
      case "nav-left":
        if (this.screen === "loop-tracks") this.#loopNavHorizontalDown("left")
        else this.#nav("left")
        break
      case "nav-right":
        if (this.screen === "loop-tracks") this.#loopNavHorizontalDown("right")
        else this.#nav("right")
        break
      case "nav-ok":
        if (this.screen === "sequencer") {
          this._okHoldTimer = setTimeout(() => {
            this._okHoldTimer = null
            this.seqCtl.openStepEdit()
          }, 380)
        } else {
          this._okHoldTimer = undefined
          this.#navOk()
        }
        break
      default:
        break
    }
  }

  #backTap() {
    if (LOOP_SCREENS.has(this.screen) && this.looper.back()) return
    if (SEQ_SCREENS.has(this.screen) && this.seqCtl.back()) return
    if (MIX_SCREENS.has(this.screen) && this.mixer.back()) return
    if (SAMPLER_SCREENS.has(this.screen) && this.sampler.back()) return
    if (this.screen === "menu") {
      this.#closeMenu()
      return
    }
    if (this.screen === "library") {
      if (this.libPickMode) {
        this.libPickMode = false
        this.kitEditMode = true
        this.screen = "pad-assign"
        this.render()
        return
      }
      this.#exitLibrary(false)
      return
    }
    if (this.screen === "detail") {
      this.#clearLibPick()
      this.screen = "library"
      this.render()
      return
    }
    if (EDIT_SCREENS.has(this.screen)) {
      if (this.editDirty) {
        this.saveName = this.focusSound?.name || "USER SOUND"
        this.screen = "save-sound"
      } else if (this.editReturnScreen === "pad-assign" || this.kitEditMode) {
        this.#returnToKitEdit()
      } else {
        this.screen = "detail"
        this.#applyProjectPatch()
      }
      this.render()
      return
    }
    if (this.screen === "save-sound") {
      this.screen = this.editReturnScreen || "edit-shape"
      this.render()
      return
    }
    if (this.screen === "pad-assign") {
      if (this.kitEditMode) {
        this.kitEditMode = false
        this.focusSound = this.kitFocus || this.focusSound
        this.screen = "detail"
      } else if (this.padAssignReturnScreen) {
        this.screen = this.padAssignReturnScreen
        this.padAssignReturnScreen = null
      } else {
        this.screen = "detail"
      }
      this.render()
      return
    }
    if (this.screen === "sound-manage") {
      this.screen = "detail"
      this.render()
      return
    }
    if (this.screen === "confirm") {
      this.screen = this.confirmReturnScreen || "sound-manage"
      this.confirmAction = null
      this.render()
      return
    }
    if (this.screen === "name-entry") {
      this.#cancelName()
      return
    }
    this.#openMenu()
  }

  #softKey(key) {
    if (LOOP_SCREENS.has(this.screen) && this.looper.softKey(key)) return
    if (SEQ_SCREENS.has(this.screen) && this.seqCtl.softKey(key)) return
    if (MIX_SCREENS.has(this.screen) && this.mixer.softKey(key)) return
    if (SAMPLER_SCREENS.has(this.screen) && this.sampler.softKey(key)) return

    if (this.screen === "menu") {
      if (key === "a") this.#openArea()
      if (key === "b") {
        this.menuIndex = (this.menuIndex + AREAS.length - 1) % AREAS.length
        this.render()
      }
      if (key === "c") {
        this.menuIndex = (this.menuIndex + 1) % AREAS.length
        this.render()
      }
      if (key === "d") this.#closeMenu()
      return
    }

    if (this.screen === "library") {
      if (this.libPickMode) {
        if (key === "a") this.#setLibTab("factory")
        if (key === "b") this.#setLibTab("user")
        if (key === "c") this.#setLibTab("fav")
        if (key === "d") {
          this.libPickMode = false
          this.kitEditMode = true
          this.screen = "pad-assign"
          this.render()
        }
        return
      }
      if (key === "a") this.#setLibTab("factory")
      if (key === "b") this.#setLibTab("kits")
      if (key === "c") this.#setLibTab("user")
      if (key === "d") this.#setLibTab("fav")
      return
    }

    if (this.screen === "detail") {
      const focus = this.focusSound || this.sound
      if (key === "a") {
        if (isKit(focus)) this.#useKit()
        else this.#useKeys()
      }
      if (key === "b") {
        if (isKit(focus)) this.#openKitEdit()
        else this.#openEdit()
      }
      if (key === "c") {
        if (isKit(focus)) {
          if (isUserSound(focus)) this.#saveKitInPlace()
          else this.#saveKitAs()
        } else {
          this.#openPadAssign()
        }
      }
      if (key === "d") {
        if (isUserSound(focus)) {
          this.screen = "sound-manage"
          this.render()
        } else {
          this.#toggleFavorite()
        }
      }
      return
    }

    if (this.screen === "sound-manage") {
      if (key === "a") this.#askName({
        initial: (this.focusSound || this.sound)?.name || "",
        mode: "rename",
        returnScreen: "sound-manage"
      })
      if (key === "b") this.#duplicateSound()
      if (key === "c") this.#openDeleteConfirm()
      if (key === "d") {
        this.screen = "detail"
        this.render()
      }
      return
    }

    if (this.screen === "confirm") {
      if (key === "a") {
        this.screen = this.confirmReturnScreen || "sound-manage"
        this.confirmAction = null
        this.render()
      }
      if (key === "d") this.#confirmDestructive()
      return
    }

    if (this.screen === "name-entry") {
      if (key === "a") this.#cancelName()
      if (key === "d") this.#commitName()
      return
    }

    if (EDIT_SCREENS.has(this.screen)) {
      const drum = isDrum(this.focusSound || this.sound)
      if (drum) {
        if (key === "a") this.screen = "edit-drum-tone"
        if (key === "b") this.screen = "edit-drum-decay"
        if (key === "c") this.screen = "edit-drum-snap"
        if (key === "d") this.screen = "edit-drum-fx"
      } else {
        if (key === "a") this.screen = "edit-shape"
        if (key === "b") this.screen = "edit-env"
        if (key === "c") this.screen = "edit-eq"
        if (key === "d") this.screen = "edit-fx"
      }
      this.render()
      return
    }

    if (this.screen === "save-sound") {
      if (key === "a") {
        this.editDirty = false
        if (this.editReturnScreen === "pad-assign") {
          this.#returnToKitEdit()
        } else {
          this.screen = "detail"
          this.#applyProjectPatch()
        }
        this.render()
      }
      if (key === "b") this.#askName({
        initial: this.saveName || this.focusSound?.name || "",
        mode: "save",
        returnScreen: "save-sound"
      })
      if (key === "c") this.#saveAs()
      if (key === "d") {
        if (this.editReturnScreen === "pad-assign") {
          if (isUserSound(this.focusSound)) this.#saveInPlace()
          else this.#applyEditToSelectedPad()
        } else {
          this.#saveInPlace()
        }
      }
      return
    }

    if (this.screen === "pad-assign") {
      if (key === "a") this.#clearPad()
      if (key === "b") {
        if (this.kitEditMode) {
          this.#openLibPickForPad()
        } else {
          const p = this.project.pads.find((x) => x.pad === this.padSelect)
          if (p) {
            p.mode = p.mode === "gate" || p.mode === "oneshot" ? (p.mode === "gate" ? "oneshot" : "gate") : "gate"
            this.toast(`PAD ${this.padSelect} ${p.mode.toUpperCase()}`)
            this.#persist()
            this.render()
          }
        }
      }
      if (key === "c") {
        if (this.kitEditMode) this.#editSelectedPadSound()
        else this.#previewPadSlot()
      }
      if (key === "d") {
        if (this.kitEditMode) {
          this.#finishKitEditDone()
        } else if (this.padAssignReturnScreen) {
          this.screen = this.padAssignReturnScreen
          this.padAssignReturnScreen = null
          this.render()
        } else {
          this.screen = "play"
          this.render()
        }
      }
      return
    }

    // PLAY softs
    if (key === "a") {
      this.project.octave = Math.max(-3, this.project.octave - 1)
      this.#remapHeldNotes()
      this.render()
      this.#persist()
    }
    if (key === "b") {
      this.project.octave = Math.min(3, this.project.octave + 1)
      this.#remapHeldNotes()
      this.render()
      this.#persist()
    }
    if (key === "c") {
      this.project.hold = !this.project.hold
      if (!this.project.hold) {
        this.synth.allNotesOff()
        this.padSynth.allNotesOff()
        this.drums.allNotesOff()
        this.sampleVoice.allNotesOff()
        this.heldKeys.clear()
        this.heldPads.clear()
        this.#syncLeds()
        this.root.querySelectorAll(".key.active").forEach((el) => el.classList.remove("active"))
        if (this._setPitchBendVisual) this._setPitchBendVisual(0, true)
        else {
          this.synth.setPitchBend(0)
          this.padSynth.setPitchBend(0)
          this.drums.setPitchBend(0)
          this.sampleVoice.setPitchBend(0)
        }
      }
      this.render()
      this.#persist()
    }
    if (key === "d") this.#openLibrary()
  }

  #clearLibPick() {
    this.libPickMode = false
  }

  #openMenu() {
    this.#clearLibPick()
    this.screen = "menu"
    this.render()
  }

  #closeMenu() {
    this.#clearLibPick()
    this.screen = "play"
    this.render()
  }

  #openArea() {
    const area = AREAS[this.menuIndex]
    if (area === "PLAY") {
      this.#closeMenu()
      return
    }
    if (area === "SOUND") {
      this.sampler.openHub()
      return
    }
    if (area === "LOOP") {
      this.looper.openHome()
      return
    }
    if (area === "MIX") {
      this.mixer.open("menu")
      return
    }
    this.toast(`${area} — COMING SOON`)
  }

  #transportPlay() {
    this.loopEngine.ensureGraph()
    if (this.transport.playing && !this.transport.recording) {
      this.#transportStop()
      return
    }
    if (this.transport.recording) return
    const origin = this.engine.now() + 0.05
    this.transport.playAt(origin)
    this.playContext = this.#resolvePlayContext()
    this.#applyPlayContext(origin)
    this.render()
  }

  /** Loop PCM — song-level backing (not isolated pattern edit). Metronome is separate. */
  #loopBackingAudible() {
    return LOOP_SCREENS.has(this.screen) || MIX_SCREENS.has(this.screen) || this.screen === "play"
  }

  #seqAudible() {
    return SEQ_SCREENS.has(this.screen)
  }

  #metroAudible() {
    return this.metro.on
  }

  #resolvePlayContext() {
    if (this.#seqAudible()) return "seq"
    if (this.#loopBackingAudible()) return "loop"
    return "loop"
  }

  /** Keep loop PCM and step-seq audition mutually exclusive while transport runs. */
  #onPlayContextBoundary() {
    if (!this.transport.playing) return
    const onSeq = this.#seqAudible()
    const onLoop = this.#loopBackingAudible()
    if (onSeq && this.playContext !== "seq") {
      this.playContext = "seq"
      this.#applyPlayContext()
    } else if (onLoop && !onSeq && this.playContext !== "loop") {
      this.playContext = "loop"
      this.#applyPlayContext()
    }
  }

  #applyPlayContext(origin) {
    if (!this.transport.playing) {
      this.stepSeq.stop()
      this.loopEngine.stopPlayback()
      return
    }
    const t = origin ?? this.transport._origin ?? this.engine.now()
    if (this.playContext === "seq") {
      this.loopEngine.stopPlayback()
      this.#startStepSeq(t)
    } else {
      // Arrangement: PCM clips + per-lane step patterns together
      this.loopEngine.startPlayback(t)
      this.stepSeq.start(t, { mode: "arrangement" })
    }
  }

  #startStepSeq(origin) {
    if (!this.#seqAudible()) {
      this.stepSeq.stop()
      return
    }
    const trackId = this.seqTrackId
    this.stepSeq.start(origin, {
      mode: trackId != null ? "track" : "global",
      trackId: trackId ?? undefined
    })
  }

  #transportStop() {
    this.transport.stop()
    if (this.loopEngine.recording) this.loopEngine.stopRecord()
    this.loopEngine.stopPlayback()
    this.stepSeq.stop()
    this.playContext = null
    this.#syncLeds()
    this.render()
  }

  #transportRec() {
    if (!this.project.loop) this.project.loop = defaultLoop()
    // Second REC while recording: stop input, keep playing
    if (this.transport.recording || this.loopEngine.recording) {
      this.loopEngine.stopRecord()
      this.transport.setRecording(false)
      this.toast("REC OFF")
      this.render()
      this.#persist()
      return
    }

    const track = this.loopEngine.armForRecord(this.loopEngine.selected)
    if (!track) {
      this.toast("PICK TRACK FIRST")
      this.looper.openTrackList({ assignLane: this.loopEngine.selected })
      return
    }
    const replace = track.mode === "replace"
    const countIn = this.project.loop.countInBars ?? 1

    const startRecAt = (startTime, { restartPlayback = true } = {}) => {
      const ok = this.loopEngine.beginRecord(track.id, {
        replace,
        startTime,
        onDone: () => {
          this.transport.setRecording(false)
          if (this.transport.playing) {
            this.loopEngine.startPlayback(this.loopEngine._playOrigin || this.engine.now())
          } else {
            this.loopEngine.stopPlayback()
          }
          this.toast(`TRK ${track.id} TAKE`)
          this.#persist()
          this.render()
        }
      })
      if (!ok) {
        this.transport.setRecording(false)
        this.toast("REC FAILED")
        this.render()
        return
      }
      this.transport.setRecording(true)
      if (restartPlayback) {
        this.playContext = "loop"
        this.#applyPlayContext(startTime)
      }
      this.toast(replace ? "REPLACE" : "RECORDING")
      this.render()
    }

    if (this.transport.playing && !this.transport.countingIn) {
      const bars = track.lengthBars || this.loopEngine.lengthBars
      const loopSec = this.transport.loopSec(bars)
      const origin = this.transport._origin
      let startTime = this.transport.nextLoopBoundary(origin, loopSec, this.engine.now())
      const qSec = quantizeGridSec(this.transport.bpm, this.project.loop?.quantize || this.loopEngine.quantize)
      if (qSec > 0) startTime = this.transport.nextGridPoint(origin, qSec, Math.max(this.engine.now(), startTime))
      if (startTime - this.engine.now() > 0.08) this.toast("REC @ NEXT LOOP")
      startRecAt(startTime, { restartPlayback: false })
      return
    }

    // From stop: count-in then record (also starts play clock)
    this.transport.countIn(countIn, (startTime) => {
      startRecAt(startTime, { restartPlayback: true })
    })
    this.render()
  }

  #libraryCategories() {
    const sounds = this.#libraryListRaw()
    const cats = [...new Set(sounds.map((s) => s.category || "FACTORY / SYNTH"))]
    return cats.length ? cats : [this.libTab === "kits" ? "FACTORY / KITS" : "FACTORY / SYNTH"]
  }

  #libraryListRaw() {
    if (this.libTab === "factory") {
      return this.#factorySounds().filter((s) => !isKit(s))
    }
    if (this.libTab === "kits") {
      if (this.libPickMode) return []
      const fac = this.#factorySounds().filter((s) => isKit(s))
      const user = this.userSounds.filter((s) => isKit(s))
      return [...fac, ...user]
    }
    if (this.libTab === "user") {
      return this.libPickMode
        ? this.userSounds.filter((s) => !isKit(s))
        : this.userSounds
    }
    if (this.libTab === "fav") {
      const favs = this.favorites.map((id) => this.#soundById(id)).filter(Boolean)
      return this.libPickMode ? favs.filter((s) => !isKit(s)) : favs
    }
    // legacy / pick mode: treat unknown as factory non-kits
    return this.#factorySounds().filter((s) => !isKit(s))
  }

  #libraryList() {
    const raw = this.#libraryListRaw()
    if (this.libTab === "fav") return raw
    const cats = this.#libraryCategories()
    if (!cats.length) return raw
    if (!this.libCategory || !cats.includes(this.libCategory)) this.libCategory = cats[0]
    let list = cats.length === 1
      ? raw.filter((s) => (s.category || cats[0]) === this.libCategory)
      : raw.filter((s) => (s.category || cats[0]) === this.libCategory)
    if (this.libTab === "kits" && !this.libPickMode) {
      list = [NEW_KIT_ENTRY, ...list]
    }
    return list
  }

  #setLibTab(tab) {
    this.libTab = tab
    this.libIndex = 0
    this.libCategory = null
    this.render()
    this.#previewHighlight()
  }

  #openLibrary() {
    this.libPickMode = false
    this.kitEditMode = false
    this.librarySnapshot = {
      soundId: this.project.soundId,
      root: this.project.root,
      brightness: this.project.brightness,
      resonance: this.project.resonance,
      attack: this.project.attack,
      release: this.project.release,
      bassDb: this.project.bassDb,
      trebleDb: this.project.trebleDb,
      space: this.project.space,
      delay: this.project.delay,
      padBank: this.project.padBank,
      kitVolume: this.project.kitVolume ?? 1,
      pads: this.#clonePads(this.project.pads)
    }
    this.libTab = "factory"
    this.libIndex = 0
    this.libCategory = null
    this.screen = "library"
    this.render()
    this.#previewHighlight()
  }

  #exitLibrary(committed) {
    if (!committed && this.librarySnapshot) {
      const snap = this.librarySnapshot
      Object.assign(this.project, {
        soundId: snap.soundId,
        root: snap.root,
        brightness: snap.brightness,
        resonance: snap.resonance,
        attack: snap.attack,
        release: snap.release,
        bassDb: snap.bassDb,
        trebleDb: snap.trebleDb,
        space: snap.space,
        delay: snap.delay,
        padBank: snap.padBank,
        kitVolume: snap.kitVolume ?? 1,
        pads: this.#clonePads(snap.pads)
      })
      this.#resolveSound(this.project.soundId)
      this.#applyProjectPatch()
    }
    this.librarySnapshot = null
    this.screen = "play"
    this.render()
  }

  #clonePads(pads) {
    return (pads || []).map((p) => ({
      pad: p.pad,
      soundId: p.soundId ?? null,
      level: p.level ?? 1,
      pan: p.pan ?? 0,
      mode: p.mode || "oneshot",
      patch: p.patch ? { ...p.patch } : null
    }))
  }

  #loadKitPads(kit, { persist = false } = {}) {
    if (!kit || !isKit(kit) || !kit.pads?.length) return false
    this.project.pads = [1, 2, 3, 4, 5, 6].map((n) => {
      const slot = kit.pads.find((p) => p.pad === n) || {}
      return {
        pad: n,
        soundId: slot.soundId ?? null,
        level: slot.level ?? 1,
        pan: slot.pan ?? 0,
        mode: slot.mode || "oneshot",
        patch: slot.patch ? { ...slot.patch } : null
      }
    })
    this.project.padBank = kit.name
    this.project.kitVolume = kit.volume != null ? Math.min(1, Math.max(0, Number(kit.volume) || 1)) : 1
    if (persist) this.#persist()
    return true
  }

  #restoreSnapshotPads() {
    const snap = this.librarySnapshot
    if (!snap?.pads) return
    this.project.pads = this.#clonePads(snap.pads)
    this.project.padBank = snap.padBank
    if (snap.kitVolume != null) this.project.kitVolume = snap.kitVolume
  }

  #synthHoldMs(patch) {
    const atk = Number(patch?.attack) || 0.02
    const rel = Number(patch?.release) || 0.4
    return Math.round(Math.min(2800, Math.max(450, (atk + 0.35 + rel * 0.45) * 1000)))
  }

  #previewHighlight() {
    const list = this.#libraryList()
    const s = list[this.libIndex]
    if (!s) return
    this.focusSound = s
    if (s.id === "__new-kit__" || s.playable === false) return
    this.#ensureAudioRunning()
    if (isKit(s)) {
      if (!this.libPickMode) this.#loadKitPads(s, { persist: false })
      const first = s.pads?.find((p) => p.soundId)
      const drum = first ? this.#soundById(first.soundId) : null
      if (drum) {
        const patch = patchFromSound(drum, { ...(drum.patch || {}), ...(first.patch || {}) })
        this.drums.applyPatch(patch)
        this.drums.noteOn(noteNameToMidi(drum.root || "C2"), 0.75)
      }
      return
    }
    if (!this.libPickMode && this.librarySnapshot?.pads) this.#restoreSnapshotPads()
    const patch = patchFromSound(s, s.patch || {})
    if (isDrum(s)) {
      this.drums.applyPatch(patch)
      this.drums.noteOn(noteNameToMidi(patch.root || "C3"), 0.75)
      return
    }
    if (isSample(s)) {
      this.sampler.loadBufferForSound(s)
      const midi = noteNameToMidi(patch.root || s.root || "C3")
      this.sampleVoice.noteOff(midi, true)
      this.sampleVoice.noteOn(midi, 0.75)
      return
    }
    this.synth.applyPatch(patch)
    const midi = noteNameToMidi(patch.root || "C3")
    this.synth.noteOff(midi, true)
    this.synth.noteOn(midi, 0.7)
    const ms = this.#synthHoldMs(patch)
    setTimeout(() => this.synth.noteOff(midi), ms)
  }

  #shiftPlayRoot(delta) {
    const cur = this.project.root || this.sound?.root || "C3"
    const next = nudgeRoot(cur, delta)
    this.project.root = next
    if (this.editPatch) this.editPatch.root = next
    if (this.sound) {
      this.sound.root = next
      if (this.sound.patch) this.sound.patch.root = next
      if (isUserSound(this.sound)) {
        this.sound.patch = { ...(this.sound.patch || {}), root: next }
        putUserSound(this.sound).then(async () => {
          this.userSounds = await listUserSounds()
        }).catch(() => {})
      }
    }
    this.#remapHeldNotes()
    this.toast(`ROOT ${next}`)
    this.render()
    this.#persist()
  }

  #clearLoopNavHold() {
    if (this._loopNavHoldTimer) {
      clearTimeout(this._loopNavHoldTimer)
      this._loopNavHoldTimer = null
    }
    if (this._loopNavHoldInterval) {
      clearInterval(this._loopNavHoldInterval)
      this._loopNavHoldInterval = null
    }
    this._loopNavHoldDir = null
  }

  /** Loop timeline: tap ◀▶ = ±1s; hold ◀▶ = repeat ±1s. */
  #loopNavHorizontalDown(dir) {
    this.#clearLoopNavHold()
    this._loopNavSecMode = false
    this._loopNavHoldDir = dir
    this._loopNavHoldTimer = setTimeout(() => {
      this._loopNavHoldTimer = null
      this._loopNavSecMode = true
      const d = dir === "right" ? 1 : -1
      this.looper.nudgeTrackOffsetSec(d, 1)
      this._loopNavHoldInterval = setInterval(() => {
        this.looper.nudgeTrackOffsetSec(d, 1)
      }, 350)
    }, 350)
  }

  #loopNavHorizontalUp() {
    if (this.screen !== "loop-tracks") return
    const dir = this._loopNavHoldDir
    const secMode = this._loopNavSecMode
    this.#clearLoopNavHold()
    if (secMode) {
      this.looper.finishTrackOffsetScrub()
      this._loopNavSecMode = false
      return
    }
    if (dir === "left" || dir === "right") {
      this.looper.nudgeTrackOffsetBeat(dir === "right" ? 1 : -1)
    }
    this._loopNavSecMode = false
  }

  #nav(dir) {
    if (LOOP_SCREENS.has(this.screen) && this.looper.nav(dir)) return
    if (SEQ_SCREENS.has(this.screen) && this.seqCtl.nav(dir)) return
    if (MIX_SCREENS.has(this.screen) && this.mixer.nav(dir)) return
    if (SAMPLER_SCREENS.has(this.screen) && this.sampler.nav(dir)) return

    if (this.screen === "menu") {
      if (dir === "up") this.menuIndex = (this.menuIndex + AREAS.length - 1) % AREAS.length
      if (dir === "down") this.menuIndex = (this.menuIndex + 1) % AREAS.length
      this.render()
      return
    }
    if (this.screen === "library") {
      const list = this.#libraryList()
      if (dir === "up" || dir === "down") {
        if (!list.length) return
        this.libIndex = (this.libIndex + (dir === "down" ? 1 : list.length - 1)) % list.length
        this.render()
        this.#previewHighlight()
      }
      if (dir === "left" || dir === "right") {
        const cats = this.#libraryCategories()
        if (cats.length < 2) return
        if (this.libTab !== "factory" && this.libTab !== "kits" && this.libTab !== "user") return
        const i = cats.indexOf(this.libCategory)
        const next = (i + (dir === "right" ? 1 : cats.length - 1)) % cats.length
        this.libCategory = cats[next]
        this.libIndex = 0
        this.render()
        this.#previewHighlight()
      }
      return
    }
    if (this.screen === "detail") {
      const focus = this.focusSound || this.sound
      if (isKit(focus)) return
      if (!this.editPatch) {
        this.editPatch = patchFromSound(focus, focus?.patch || {})
      }
      const delta = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? 12 : dir === "down" ? -12 : 0
      if (!delta) return
      this.editPatch.root = nudgeRoot(this.editPatch.root, delta)
      this.editDirty = true
      this.toast(`ROOT ${this.editPatch.root}`)
      if (this.project.soundId === focus?.id) {
        this.project.root = this.editPatch.root
        this.#remapHeldNotes()
        this.#persist()
      }
      this.render()
      return
    }
    if (this.screen === "pad-assign") {
      if (dir === "left") this.padSelect = this.padSelect === 1 ? 6 : this.padSelect - 1
      if (dir === "right") this.padSelect = this.padSelect === 6 ? 1 : this.padSelect + 1
      if (dir === "up") this.padSelect = this.padSelect <= 3 ? this.padSelect + 3 : this.padSelect - 3
      if (dir === "down") this.padSelect = this.padSelect <= 3 ? this.padSelect + 3 : this.padSelect - 3
      this.render()
      return
    }
    if (this.screen === "play") {
      if (this.playNavFocus === "metro") {
        if (dir === "up") this.setMetroLevel(this.metro.level + 0.05)
        if (dir === "down") this.setMetroLevel(this.metro.level - 0.05)
        if (dir === "left" || dir === "right") this.setMetroOn(!this.metro.on)
        return
      }
      if (dir === "left") this.#shiftPlayRoot(-1)
      if (dir === "right") this.#shiftPlayRoot(1)
      if (dir === "up") this.#shiftPlayRoot(12)
      if (dir === "down") this.#shiftPlayRoot(-12)
    }
  }

  #navOk() {
    if (LOOP_SCREENS.has(this.screen) && this.looper.nav("ok")) return
    if (SEQ_SCREENS.has(this.screen) && this.seqCtl.nav("ok")) return
    if (SAMPLER_SCREENS.has(this.screen) && this.sampler.nav("ok")) return

    if (this.screen === "play") {
      this.playNavFocus = this.playNavFocus === "metro" ? "root" : "metro"
      this.toast(this.playNavFocus === "metro" ? "▲▼ METRO LVL · ◀▶ ON/OFF" : "▲▼ ROOT OCT")
      this.render()
      return
    }

    if (this.screen === "menu") {
      this.#openArea()
      return
    }
    if (this.screen === "library") {
      const list = this.#libraryList()
      const s = list[this.libIndex]
      if (!s) return
      if (s.id === "__new-kit__") {
        this.#createNewKit()
        return
      }
      if (this.libPickMode) {
        if (isKit(s)) {
          this.toast("PICK A SOUND")
          return
        }
        this.#assignSoundToSelectedPad(s)
        this.libPickMode = false
        this.kitEditMode = true
        this.kitDirty = true
        this.project.padBank = "PADS CUSTOM"
        this.screen = "pad-assign"
        this.render()
        this.#persist()
        this.toast(`PAD ${this.padSelect} ← ${s.name}`)
        return
      }
      if (isSample(s)) {
        void this.sampler.openFromSound(s)
        return
      }
      this.focusSound = s
      this.editPatch = isKit(s) ? null : patchFromSound(s, s.patch || {})
      this.editDirty = false
      this.screen = "detail"
      this.render()
      return
    }
    if (this.screen === "pad-assign") {
      if (this.kitEditMode) {
        this.#editSelectedPadSound()
        return
      }
      this.#assignPad()
      return
    }
    if (this.screen === "edit-eq" && this.editPatch) {
      this.editPatch.bassDb = 0
      this.editPatch.trebleDb = 0
      this.editDirty = true
      this.engine.setBassDb(0)
      this.engine.setTrebleDb(0)
      this.toast("EQ RESET")
      this.render()
    }
  }

  #useKeys() {
    const s = this.focusSound || this.sound
    if (!s || s.playable === false) {
      this.toast("NO ENGINE")
      return
    }
    if (isKit(s)) {
      this.#useKit()
      return
    }
    const patch = this.editPatch || patchFromSound(s, s.patch || {})
    this.project.soundId = s.id
    this.sound = s
    this.#commitPatchToProject(patch)
    if (isSample(s)) this.sampler.loadBufferForSound(s)
    this.librarySnapshot = null
    this.editDirty = false
    this.screen = "play"
    this.render()
    this.#persist()
    this.toast(`KEYS ← ${s.name}`)
  }

  #createNewKit() {
    this.libPickMode = false
    this.#askName({
      initial: "MY KIT",
      mode: "kit-new",
      returnScreen: this.screen === "library" ? "library" : "sound-hub"
    })
  }

  #useKit() {
    const s = this.focusSound || this.sound
    if (!this.#loadKitPads(s, { persist: true })) {
      this.toast("NO KIT")
      return
    }
    this.kitDirty = false
    this.kitFocus = s
    this.librarySnapshot = null
    this.screen = "play"
    this.render()
    this.toast(`${s.name} → PADS`)
  }

  #openKitEdit() {
    const s = this.focusSound || this.sound
    if (!isKit(s)) return
    // Ensure pads match this kit if bank name matches, else edit current pads
    if (this.project.padBank !== s.name && s.pads?.length) {
      this.project.pads = [1, 2, 3, 4, 5, 6].map((n) => {
        const slot = s.pads.find((p) => p.pad === n) || {}
        return {
          pad: n,
          soundId: slot.soundId ?? null,
          level: slot.level ?? 1,
          pan: slot.pan ?? 0,
          mode: slot.mode || "oneshot",
          patch: slot.patch || null
        }
      })
      this.project.padBank = s.name
    }
    this.kitFocus = s
    this.focusSound = s
    this.kitEditMode = true
    this.kitDirty = false
    this.padSelect = 1
    this.screen = "pad-assign"
    this.render()
  }

  #returnToKitEdit() {
    this.kitEditMode = true
    this.focusSound = this.kitFocus || this.focusSound
    this.editReturnScreen = "detail"
    this.screen = "pad-assign"
    this.#applyProjectPatch()
  }

  #finishKitEditDone() {
    this.kitEditMode = false
    this.focusSound = this.kitFocus || this.focusSound
    if (!this.kitDirty) {
      this.screen = "detail"
      this.render()
      return
    }
    if (isUserSound(this.focusSound) && isKit(this.focusSound)) {
      this.#saveKitInPlace()
    } else {
      this.screen = "detail"
      this.render()
      this.#saveKitAs()
    }
  }

  #openLibPickForPad() {
    this.libPickMode = true
    this.kitEditMode = false
    this.libTab = "factory"
    this.libCategory = null
    this.libIndex = 0
    this.screen = "library"
    this.render()
    this.#previewHighlight()
  }

  #assignSoundToSelectedPad(s) {
    if (!s || isKit(s)) return
    const p = this.project.pads.find((x) => x.pad === this.padSelect)
    if (!p) return
    p.soundId = s.id
    p.mode = s.padMode || "oneshot"
    p.patch = null
  }

  #auditionDrumEdit() {
    if (!this.editPatch || !isDrum(this.focusSound || this.sound)) return
    this.#ensureAudioRunning()
    this.drums.applyPatch(this.editPatch)
    const midi = this.#padMidi(this.padSelect || 1)
    this.drums.noteOn(midi, 0.9)
  }

  #previewPadSlot() {
    const slot = this.project.pads?.find((p) => p.pad === this.padSelect)
    const assigned = slot?.soundId ? this.#soundById(slot.soundId) : null
    if (!assigned) {
      this.toast("EMPTY")
      return
    }
    this.#ensureAudioRunning()
    const vel = Math.min(1, 0.95 * this.#padGain(slot))
    const pan = slot.pan ?? 0
    if (isDrum(assigned)) {
      const midi = this.#padMidi(this.padSelect)
      const patch = patchFromSound(assigned, { ...(assigned.patch || {}), ...(slot.patch || {}) })
      this.drums.applyPatch(patch)
      this.drums.setPan(pan)
      this.drums.noteOn(midi, vel)
      return
    }
    if (isSample(assigned)) {
      const patch = patchFromSound(assigned, { ...(assigned.patch || {}), ...(slot.patch || {}) })
      this.sampler.loadBufferForSound(assigned)
      this.sampleVoice.applyPatch(patch)
      this.sampleVoice.setPan(pan)
      const midi = noteNameToMidi(assigned.root || assigned.patch?.root || "C3")
      this.sampleVoice.noteOff(midi, true)
      this.sampleVoice.noteOn(midi, vel)
      return
    }
    const midi = this.#padMidi(this.padSelect)
    const patch = patchFromSound(assigned, { ...(assigned.patch || {}), ...(slot.patch || {}) })
    this.padSynth.applyPatch(patch)
    this.padSynth.setPan(pan)
    this.padSynth.noteOn(midi, vel)
    setTimeout(() => this.padSynth.noteOff(midi), this.#synthHoldMs(patch))
  }

  #kitPadsSnapshot() {
    return (this.project.pads || []).map((p) => ({
      pad: p.pad,
      soundId: p.soundId,
      level: p.level ?? 1,
      pan: p.pan ?? 0,
      mode: p.mode || "oneshot",
      patch: p.patch || null
    }))
  }

  #saveKitAs() {
    const focus = this.kitFocus || this.focusSound
    if (
      isKit(focus)
      && !this.kitDirty
      && this.project.padBank !== focus.name
      && focus.pads?.length
    ) {
      this.project.pads = [1, 2, 3, 4, 5, 6].map((n) => {
        const slot = focus.pads.find((p) => p.pad === n) || {}
        return {
          pad: n,
          soundId: slot.soundId ?? null,
          level: slot.level ?? 1,
          pan: slot.pan ?? 0,
          mode: slot.mode || "oneshot",
          patch: slot.patch || null
        }
      })
      this.project.padBank = focus.name
    }
    this.focusSound = focus
    const base = focus?.name || this.project.padBank || "USER KIT"
    this.#askName({
      initial: String(base).replace(/^KIT\s+/i, "") || "MY KIT",
      mode: "kit-save",
      returnScreen: "detail"
    })
  }

  async #saveKitInPlace() {
    const kit = this.kitFocus || this.focusSound
    if (!isKit(kit) || !isUserSound(kit)) {
      this.#saveKitAs()
      return
    }
    kit.pads = this.#kitPadsSnapshot()
    kit.volume = this.project.kitVolume ?? 1
    kit.kind = "kit"
    kit.voice = "kit"
    kit.source = "user"
    kit.category = "USER / KITS"
    kit.playable = true
    await putUserSound(kit)
    this.userSounds = await listUserSounds()
    this.focusSound = this.userSounds.find((u) => u.id === kit.id) || kit
    this.kitFocus = this.focusSound
    this.#syncPadsAfterKitSave(this.focusSound)
    this.kitDirty = false
    this.kitEditMode = false
    this.#persist()
    this.toast("KIT SAVED")
    this.screen = "detail"
    this.render()
  }

  async #finishKitSave(name) {
    const pads = this.#kitPadsSnapshot()
    const id = `user-kit-${Date.now().toString(36)}`
    const kit = {
      id,
      name: name.startsWith("KIT ") ? name : `KIT ${name}`,
      kind: "kit",
      voice: "kit",
      source: "user",
      category: "USER / KITS",
      volume: this.project.kitVolume ?? 1,
      pads,
      playable: true
    }
    await putUserSound(kit)
    this.userSounds = await listUserSounds()
    this.focusSound = kit
    this.kitFocus = kit
    this.#syncPadsAfterKitSave(kit)
    this.kitDirty = false
    this.kitEditMode = false
    this.#persist()
    this.toast("SAVED · SEE USER / KITS")
    this.libTab = "user"
    this.libCategory = "USER / KITS"
    this.screen = "detail"
    this.render()
  }

  async #finishKitNew(name) {
    this.librarySnapshot = null
    this.project.pads = [1, 2, 3, 4, 5, 6].map((n) => ({
      pad: n,
      soundId: null,
      level: 1,
      pan: 0,
      mode: "oneshot",
      patch: null
    }))
    this.project.kitVolume = 1
    this.kitFocus = null
    this.kitDirty = false
    await this.#finishKitSave(name)
    this.toast("NEW KIT · ASSIGN PADS")
    this.#openKitEdit()
  }

  #syncPadsAfterSoundSave(sound) {
    if (!sound?.id) return
    for (const p of this.project.pads || []) {
      if (p.soundId === sound.id) p.patch = null
    }
  }

  #syncPadsAfterKitSave(kit) {
    if (!kit || !isKit(kit)) return
    if (this.project.padBank === kit.name || this.kitFocus?.id === kit.id) {
      this.#loadKitPads(kit, { persist: false })
      this.kitFocus = kit
    }
  }

  #padPatchFromEdit(src, editPatch) {
    const p = sanitizePatch(editPatch || {})
    if (isDrum(src)) {
      return {
        drumType: p.drumType || src?.patch?.drumType || "kick",
        tone: p.tone,
        tuning: p.tuning,
        decay: p.decay,
        snap: p.snap,
        noise: p.noise,
        reverb: p.reverb,
        delay: p.delay,
        drive: p.drive
      }
    }
    return {
      root: p.root,
      brightness: p.brightness,
      resonance: p.resonance,
      attack: p.attack,
      release: p.release,
      bassDb: p.bassDb,
      trebleDb: p.trebleDb,
      reverb: p.reverb,
      delay: p.delay,
      osc1Type: p.osc1Type,
      osc2Type: p.osc2Type,
      detuneCents: p.detuneCents,
      mixGain: p.mixGain,
      drive: p.drive,
      pulseWidth: p.pulseWidth,
      motion: p.motion
    }
  }

  #applyEditToSelectedPad() {
    const p = this.project.pads.find((x) => x.pad === this.padSelect)
    if (!p || !this.editPatch) {
      this.toast("NO EDIT")
      return
    }
    const src = this.focusSound
    p.patch = this.#padPatchFromEdit(src, this.editPatch)
    this.kitDirty = true
    if (this.kitFocus && isUserSound(this.kitFocus)) {
      this.project.padBank = this.kitFocus.name
    } else {
      this.project.padBank = "PADS CUSTOM"
    }
    this.editDirty = false
    this.#persist()
    this.toast(`PAD ${this.padSelect} UPDATED`)
    this.#returnToKitEdit()
    this.render()
  }

  #editSelectedPadSound() {
    const slot = this.project.pads?.find((p) => p.pad === this.padSelect)
    const assigned = slot?.soundId ? this.#soundById(slot.soundId) : null
    if (!assigned) {
      this.toast("EMPTY")
      return
    }
    if (isKit(assigned)) {
      this.toast("PICK A SOUND")
      return
    }
    this.focusSound = assigned
    this.editReturnScreen = "pad-assign"
    this.#openEdit({ padSlotPatch: slot?.patch || null })
  }

  #openEdit({ padSlotPatch = null } = {}) {
    const s = this.focusSound || this.sound
    if (!s || s.playable === false || isKit(s)) {
      this.toast(isKit(s) ? "USE KIT EDIT" : "NO ENGINE")
      return
    }
    if (isSample(s)) {
      this.sampler.openFromSound(s)
      return
    }
    this.focusSound = s
    const live = this.project.soundId === s.id && this.editReturnScreen !== "pad-assign"
    this.editPatch = patchFromSound(s, {
      root: this.editPatch?.root || s.root || this.project.root,
      ...(live ? {
        root: this.project.root || s.root,
        brightness: this.project.brightness,
        resonance: this.project.resonance,
        attack: this.project.attack,
        release: this.project.release,
        bassDb: this.project.bassDb,
        trebleDb: this.project.trebleDb,
        reverb: this.project.space,
        delay: this.project.delay,
        drive: this.project.drive,
        pulseWidth: this.project.pulseWidth,
        motion: this.project.motion,
        tone: this.project.tone,
        decay: this.project.decay,
        snap: this.project.snap
      } : {}),
      ...(padSlotPatch || {})
    })
    this.editDirty = false
    if (this.editReturnScreen !== "pad-assign") this.editReturnScreen = "detail"
    if (isDrum(s)) {
      this.drums.applyPatch(this.editPatch)
      this.screen = "edit-drum-tone"
    } else if (this.editReturnScreen === "pad-assign") {
      this.padSynth.applyPatch(this.editPatch)
      this.screen = "edit-shape"
    } else {
      this.synth.applyPatch(this.editPatch)
      this.screen = "edit-shape"
    }
    this.render()
  }

  #openPadAssign() {
    const s = this.focusSound || this.sound
    if (isKit(s)) {
      this.#openKitEdit()
      return
    }
    this.focusSound = s || this.sound
    this.kitEditMode = false
    this.padSelect = 1
    this.screen = "pad-assign"
    this.render()
  }

  #assignPad() {
    const s = this.focusSound || this.sound
    if (!s || isKit(s)) return
    const p = this.project.pads.find((x) => x.pad === this.padSelect)
    if (!p) return
    p.soundId = s.id
    p.mode = s.padMode || p.mode || "gate"
    p.patch = null
    this.project.padBank = "PADS CUSTOM"
    this.kitDirty = true
    this.toast(`PAD ${this.padSelect} ← ${s.name}`)
    this.#persist()
    this.render()
  }

  #clearPad() {
    const p = this.project.pads.find((x) => x.pad === this.padSelect)
    if (!p) return
    p.soundId = null
    p.patch = null
    this.project.padBank = "PADS CUSTOM"
    this.kitDirty = true
    this.toast(`PAD ${this.padSelect} CLEAR`)
    this.#persist()
    this.render()
  }

  async #toggleFavorite() {
    const s = this.focusSound || this.sound
    if (!s) return
    if (this.#isFavorite(s.id)) {
      this.favorites = this.favorites.filter((id) => id !== s.id)
      this.toast("UNFAVORITED")
    } else {
      this.favorites = [...this.favorites, s.id]
      this.toast("FAVORITED")
    }
    await saveFavorites(this.favorites)
    this.render()
  }

  #namingActive() {
    return this.screen === "name-entry"
  }

  #bindNameField() {
    const input = this.vscreen.querySelector("#cassio-name-field")
    if (!input) return
    input.focus()
    input.select()
    input.oninput = () => {
      this.nameDraft = input.value
    }
    input.onkeydown = (e) => {
      e.stopPropagation()
      if (e.key === "Enter") {
        e.preventDefault()
        this.#commitName()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        this.#cancelName()
      }
    }
  }

  #askName({ initial = "", mode = "save", returnScreen = "save-sound" } = {}) {
    this.nameDraft = String(initial || "").toUpperCase().slice(0, 18)
    this.nameMode = mode
    this.nameReturnScreen = returnScreen
    this.screen = "name-entry"
    this.render()
  }

  #cancelName() {
    this.nameMode = null
    this.screen = this.nameReturnScreen || "detail"
    this.render()
  }

  async #commitName() {
    const input = this.vscreen.querySelector("#cassio-name-field")
    const v = (input?.value || this.nameDraft || "").trim().toUpperCase().slice(0, 18)
    if (!v) {
      this.toast("NAME REQUIRED")
      input?.focus()
      return
    }
    this.saveName = v
    this.nameDraft = v
    const mode = this.nameMode
    this.nameMode = null

    if (mode === "rename") {
      const s = this.focusSound
      if (s && isUserSound(s)) {
        s.name = v
        await putUserSound(s)
        this.userSounds = await listUserSounds()
        this.focusSound = this.userSounds.find((u) => u.id === s.id) || s
        if (this.sound?.id === s.id) this.sound = this.focusSound
        this.toast("RENAMED")
      }
      this.screen = "sound-manage"
      this.render()
      return
    }

    if (mode === "save-sample" || mode === "save-sample-rename") {
      await this.sampler.commitRename(v)
      return
    }

    if (mode === "save-sample-as") {
      await this.sampler.commitSaveAs(v)
      return
    }

    if (mode === "duplicate") {
      await this.#finishDuplicate(v)
      return
    }

    if (mode === "kit-save") {
      await this.#finishKitSave(v)
      return
    }

    if (mode === "kit-new") {
      await this.#finishKitNew(v)
      return
    }

    // save / save-as naming
    this.screen = "save-sound"
    this.render()
    if (mode === "save-as") await this.#saveAs()
  }

  async #saveAs() {
    if (!this.saveName) {
      this.#askName({
        initial: this.focusSound?.name || "USER SOUND",
        mode: "save-as",
        returnScreen: "save-sound"
      })
      return
    }
    const src = this.focusSound || this.sound
    const patch = sanitizePatch(this.editPatch || patchFromSound(src))
    const id = `user-${Date.now().toString(36)}`
    const drum = isDrum(src)
    const fromPad = this.editReturnScreen === "pad-assign"
    const sound = {
      id,
      name: this.saveName,
      category: fromPad ? "USER / PADS" : (drum ? "USER / DRUMS" : "USER / SYNTH"),
      voice: drum ? "drum" : (src?.voice || "poly"),
      root: patch.root || src?.root || "C3",
      padMode: src?.padMode || (drum ? "oneshot" : "gate"),
      source: "user",
      sourceId: src?.sourceId || src?.id,
      macros: src?.macros || (drum
        ? {
            m1: { label: "TONE", param: "tone" },
            m2: { label: "DECAY", param: "decay" }
          }
        : {
            m1: { label: "TONE", param: "brightness" },
            m2: { label: "FX", param: "space" }
          }),
      patch: drum
        ? {
            drumType: patch.drumType || src?.patch?.drumType || "kick",
            tone: patch.tone,
            tuning: patch.tuning,
            decay: patch.decay,
            snap: patch.snap,
            noise: patch.noise,
            reverb: patch.reverb,
            delay: patch.delay,
            drive: patch.drive
          }
        : patch,
      playable: true
    }
    await putUserSound(sound)
    this.userSounds = await listUserSounds()
    this.focusSound = sound
    this.editPatch = patch
    this.editDirty = false
    this.toast(fromPad ? "SAVED · SEE USER / PADS" : (drum ? "SAVED DRUM" : "SAVED USER"))
    if (fromPad) {
      const p = this.project.pads.find((x) => x.pad === this.padSelect)
      if (p) {
        p.soundId = sound.id
        p.patch = null
        this.kitDirty = true
        if (this.kitFocus && isUserSound(this.kitFocus)) {
          this.project.padBank = this.kitFocus.name
        } else {
          this.project.padBank = "PADS CUSTOM"
        }
      }
      this.#syncPadsAfterSoundSave(sound)
      this.#returnToKitEdit()
      this.#persist()
    } else {
      this.screen = "detail"
    }
    this.render()
  }

  async #saveInPlace() {
    const s = this.focusSound
    if (!s || !isUserSound(s)) {
      if (this.editReturnScreen === "pad-assign") {
        this.#applyEditToSelectedPad()
        return
      }
      this.toast("USE SAVE AS")
      return
    }
    if (this.saveName) s.name = this.saveName
    const patch = sanitizePatch(this.editPatch || patchFromSound(s))
    s.root = patch.root
    if (isDrum(s)) {
      s.voice = "drum"
      if (this.editReturnScreen === "pad-assign") s.category = "USER / PADS"
      else s.category = s.category || "USER / DRUMS"
      s.patch = {
        drumType: patch.drumType || s.patch?.drumType || "kick",
        tone: patch.tone,
        tuning: patch.tuning,
        decay: patch.decay,
        snap: patch.snap,
        noise: patch.noise,
        reverb: patch.reverb,
        delay: patch.delay,
        drive: patch.drive
      }
    } else {
      if (this.editReturnScreen === "pad-assign") s.category = "USER / PADS"
      s.patch = { ...patch }
    }
    await putUserSound(s)
    this.userSounds = await listUserSounds()
    this.focusSound = this.userSounds.find((u) => u.id === s.id) || s
    if (this.project.soundId === s.id) this.#commitPatchToProject(patch)
    this.#syncPadsAfterSoundSave(this.focusSound)
    if (this.editReturnScreen === "pad-assign") {
      this.editDirty = false
      this.toast("PAD SOUND SAVED")
      this.#returnToKitEdit()
      this.#persist()
      this.render()
      return
    }
    this.editDirty = false
    this.toast("SAVED")
    this.screen = "detail"
    this.render()
    this.#persist()
  }

  #duplicateSound() {
    const s = this.focusSound || this.sound
    if (!s || !isUserSound(s)) {
      this.toast("USER ONLY")
      return
    }
    const base = (s.name || "SOUND").replace(/\s+COPY$/, "")
    if (!isKit(s)) this.editPatch = sanitizePatch(s.patch || patchFromSound(s))
    this.#askName({
      initial: `${base} COPY`.slice(0, 18),
      mode: "duplicate",
      returnScreen: "sound-manage"
    })
  }

  async #finishDuplicate(name) {
    const src = this.focusSound || this.sound
    if (isKit(src)) {
      const id = `user-kit-${Date.now().toString(36)}`
      const kit = {
        ...src,
        id,
        name,
        source: "user",
        kind: "kit",
        voice: "kit",
        category: "USER / KITS",
        pads: structuredClone(src.pads || this.project.pads || []),
        playable: true
      }
      await putUserSound(kit)
      this.userSounds = await listUserSounds()
      this.focusSound = kit
      this.toast("DUPLICATED")
      this.screen = "detail"
      this.render()
      return
    }
    const patch = sanitizePatch(this.editPatch || src?.patch || patchFromSound(src))
    const id = `user-${Date.now().toString(36)}`
    const sound = {
      ...src,
      id,
      name,
      source: "user",
      sourceId: src?.sourceId || src?.id,
      root: patch.root,
      patch,
      playable: true,
      category: src?.category || "USER / SYNTH"
    }
    await putUserSound(sound)
    this.userSounds = await listUserSounds()
    this.focusSound = sound
    this.editPatch = patch
    this.toast("DUPLICATED")
    this.screen = "detail"
    this.render()
  }

  #openDeleteConfirm() {
    const s = this.focusSound || this.sound
    if (!s || !isUserSound(s)) {
      this.toast("USER ONLY")
      return
    }
    this.confirmTitle = isKit(s) ? "DELETE USER KIT?" : "DELETE USER SOUND?"
    this.confirmLines = [
      { text: s.name, tone: "green" },
      { text: "THIS CANNOT BE UNDONE.", tone: "muted" },
      { text: "A CANCEL · D DELETE", tone: "muted" }
    ]
    this.confirmAction = "delete-sound"
    this.confirmOkLabel = "DELETE"
    this.confirmReturnScreen = "sound-manage"
    this.screen = "confirm"
    this.render()
  }

  async #confirmDestructive() {
    if (this.confirmAction === "discard-sample") {
      this.sampler.clearDraft()
      this.sampler.releaseMic()
      this.confirmAction = null
      this.toast("DISCARDED")
      this.screen = "sampler-home"
      this.render()
      return
    }
    if (this.confirmAction === "clear-loop-track") {
      this.confirmAction = null
      this.looper.clearSelected()
      return
    }
    if (this.confirmAction === "delete-lane") {
      this.confirmAction = null
      this.looper.confirmDeleteLane()
      return
    }
    if (this.confirmAction === "unassign-lane-dirty") {
      this.confirmAction = null
      this.looper.confirmUnassignDirty()
      return
    }
    if (this.confirmAction === "replace-lane-dirty") {
      this.confirmAction = null
      this.looper.confirmReplaceDirty()
      return
    }
    if (this.confirmAction === "delete-library-track") {
      this.confirmAction = null
      this.looper.confirmDeleteLibraryTrack()
      return
    }
    if (this.confirmAction === "clear-seq-lane") {
      this.confirmAction = null
      this.seqCtl.clearLaneConfirmed()
      return
    }
    if (this.confirmAction !== "delete-sound") return
    const s = this.focusSound
    if (!s || !isUserSound(s)) {
      this.screen = "sound-manage"
      this.render()
      return
    }
    const id = s.id
    await deleteUserSound(id)
    this.userSounds = await listUserSounds()
    this.favorites = this.favorites.filter((fid) => fid !== id)
    await saveFavorites(this.favorites)
    for (const p of this.project.pads || []) {
      if (p.soundId === id) p.soundId = null
    }
    if (this.project.soundId === id) {
      this.project.soundId = "glass-poly"
      this.#resolveSound("glass-poly")
      const patch = patchFromSound(this.sound)
      this.#commitPatchToProject(patch)
    }
    this.focusSound = null
    this.editPatch = null
    this.#persist()
    this.toast("DELETED")
    this.confirmAction = null
    if (this.confirmReturnScreen === "sampler-home") {
      this.samplerIndex = 0
      this.screen = "sampler-home"
      this.render()
      return
    }
    this.libTab = isKit(s) ? "kits" : "user"
    this.libIndex = 0
    this.screen = "library"
    this.render()
  }

  #previewFocus() {
    const s = this.focusSound || this.sound
    if (!s || s.playable === false) {
      this.toast("NO ENGINE")
      return
    }
    this.#ensureAudioRunning()
    if (isKit(s)) {
      const first = s.pads?.find((p) => p.soundId)
      const drum = first ? this.#soundById(first.soundId) : null
      if (!drum) return
      const patch = patchFromSound(drum, { ...(drum.patch || {}), ...(first.patch || {}) })
      this.drums.applyPatch(patch)
      this.drums.noteOn(noteNameToMidi(drum.root || "C2"), 0.8)
      return
    }
    const patch = patchFromSound(s, s.patch || this.editPatch || {})
    if (isDrum(s)) {
      this.drums.applyPatch(patch)
      this.drums.noteOn(noteNameToMidi(patch.root || "C3"), 0.8)
      return
    }
    this.synth.applyPatch(patch)
    const midi = noteNameToMidi(patch.root || "C3")
    this.synth.noteOn(midi, 0.75)
    setTimeout(() => this.synth.noteOff(midi), this.#synthHoldMs(patch))
  }

  #baseMidi() {
    if (this.screen === "sample-edit" && this.sampleDraft?.root) {
      return noteNameToMidi(this.sampleDraft.root) + this.project.octave * 12
    }
    const root = this.project.root || this.sound?.root || "C3"
    return noteNameToMidi(root) + this.project.octave * 12
  }

  #padMidi(n) {
    return this.#baseMidi() + PAD_DEG[n - 1] + 12
  }

  #remapHeldNotes() {
    for (const degree of [...this.heldKeys.keys()]) {
      const oldMidi = this.heldKeys.get(degree)
      const newMidi = this.#baseMidi() + degree
      if (oldMidi === newMidi) continue
      if (this.#keyboardIsDrum()) {
        this.drums.noteOff(oldMidi, true)
        this.drums.noteOn(newMidi)
      } else {
        this.synth.noteOff(oldMidi, true)
        this.synth.noteOn(newMidi)
      }
      this.heldKeys.set(degree, newMidi)
    }
    for (const n of [...this.heldPads.keys()]) {
      const entry = this.heldPads.get(n)
      if (!entry || entry.engine === "drum" || entry.engine === "sample") continue
      const oldMidi = entry.midi
      const newMidi = this.#padMidi(n)
      if (oldMidi === newMidi) continue
      const eng = entry.engine === "padSynth" ? this.padSynth : this.synth
      eng.noteOff(oldMidi, true)
      eng.noteOn(newMidi)
      this.heldPads.set(n, { midi: newMidi, engine: entry.engine })
    }
  }

  #keyDown(degree) {
    if (!this.engine.ready || this.engine.ctx?.state === "suspended") {
      void this.#ensureAudioRunning().then(() => {
        if (this.engine.ctx?.state === "running") this.#keyDown(degree)
      })
      return
    }
    void this.#ensureAudioRunning()
    if (this.#inLoopPerformance()) {
      this.#keyDownTrack(this.loopEngine.selected, degree)
      return
    }
    if (this.project.hold && this.heldKeys.has(degree)) {
      const midi = this.heldKeys.get(degree)
      this.heldKeys.delete(degree)
      if (midi != null) {
        if (this.#keyboardIsDrum()) this.drums.noteOff(midi, true)
        else if (this.#keyboardIsSample()) this.sampleVoice.noteOff(midi, true)
        else this.synth.noteOff(midi, true)
      }
      this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.remove("active")
      return
    }
    const midi = this.#baseMidi() + degree
    if (this.heldKeys.has(degree)) {
      const prev = this.heldKeys.get(degree)
      if (this.#keyboardIsDrum()) this.drums.noteOff(prev, true)
      else if (this.#keyboardIsSample()) this.sampleVoice.noteOff(prev, true)
      else this.synth.noteOff(prev, true)
    }
    this.heldKeys.set(degree, midi)
    if (this.#keyboardIsDrum()) {
      this.drums.applyPatch(patchFromSound(this.sound, this.sound?.patch || {}))
      this.drums.noteOn(midi)
    } else if (this.#keyboardIsSample()) {
      // #region agent log
      fetch("http://127.0.0.1:7775/ingest/fa1177f6-1e5b-449a-b03a-5969bd555f1e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "397b28" },
        body: JSON.stringify({
          sessionId: "397b28",
          runId: "crash-1",
          hypothesisId: "A",
          location: "app.js:#keyDown:sample",
          message: "sample keyDown",
          data: {
            screen: this.screen,
            soundId: this.sound?.id,
            gain: this.sampleVoice?.gain,
            hasBuf: !!this.sampleVoice?.buffer,
            midi
          },
          timestamp: Date.now()
        })
      }).catch(() => {})
      fetch("/debug_ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "397b28",
          runId: "crash-1",
          hypothesisId: "A",
          location: "app.js:#keyDown:sample",
          message: "sample keyDown",
          data: {
            screen: this.screen,
            soundId: this.sound?.id,
            gain: this.sampleVoice?.gain,
            hasBuf: !!this.sampleVoice?.buffer,
            midi
          },
          timestamp: Date.now()
        }),
        keepalive: true
      }).catch(() => {})
      // #endregion
      if (this.screen === "sample-edit" && this.sampleBuffer && this.sampleDraft) {
        this.sampleVoice.setBuffer(this.sampleBuffer)
        this.sampleVoice.applyPatch(this.sampleDraft)
      } else {
        // loadBufferForSound already applies patch + repaired gain
        this.sampler.loadBufferForSound(this.sound)
      }
      this.sampleVoice.noteOn(midi, 0.95, { loop: !!this.project.hold })
    } else {
      this.synth.noteOn(midi)
    }
    this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.add("active")
  }

  #keyDownTrack(trackId, degree) {
    const midi = this.#baseMidi() + degree
    const recTrack = this.#recTrackLive()
    const { slot, assigned, patch } = this.#padSound(trackId)
    if (!assigned || isKit(assigned)) {
      this.toast(`TRK ${trackId} EMPTY`)
      return
    }
    if (this.heldKeys.has(degree)) {
      this.#keyUpTrack(trackId, degree, { force: true })
    }
    this.heldKeys.set(degree, midi)
    const vel = Math.min(1, 0.95 * this.#padGain(slot))
    if (isDrum(assigned)) {
      this.drums.applyPatch(patch)
      this.drums.setPan(slot.pan ?? 0)
      this.drums.noteOn(midi, vel, { recTrack })
    } else if (isSample(assigned)) {
      this.sampler.loadBufferForSound(assigned)
      this.sampleVoice.applyPatch(patch)
      this.sampleVoice.setPan(slot.pan ?? 0)
      this.sampleVoice.noteOn(midi, vel, { loop: !!this.project.hold, recTrack })
    } else {
      this.padSynth.applyPatch(patch)
      this.padSynth.setPan(slot.pan ?? 0)
      this.padSynth.noteOn(midi, vel, { recTrack })
    }
    this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.add("active")
  }

  #keyUpTrack(trackId, degree, { force = false } = {}) {
    if (this.project.hold && !force) {
      if (this.heldKeys.has(degree)) {
        this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.add("active")
      }
      return
    }
    this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.remove("active")
    const midi = this.heldKeys.get(degree)
    this.heldKeys.delete(degree)
    if (midi == null) return
    const { assigned } = this.#padSound(trackId)
    if (isDrum(assigned)) this.drums.noteOff(midi)
    else if (isSample(assigned)) this.sampleVoice.noteOff(midi)
    else this.padSynth.noteOff(midi)
  }

  #keyUp(degree, { force = false } = {}) {
    if (this.#inLoopPerformance()) {
      this.#keyUpTrack(this.loopEngine.selected, degree, { force })
      return
    }
    if (this.project.hold && !force) {
      if (this.heldKeys.has(degree)) {
        this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.add("active")
      }
      return
    }
    this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.remove("active")
    const midi = this.heldKeys.get(degree)
    this.heldKeys.delete(degree)
    if (midi != null) {
      if (this.#keyboardIsDrum()) this.drums.noteOff(midi)
      else if (this.#keyboardIsSample()) this.sampleVoice.noteOff(midi)
      else this.synth.noteOff(midi)
    }
  }

  #releaseAllPointerKeys() {
    for (const deg of [...this.pointerKeys.values()]) this.#keyUp(deg, { force: true })
    this.pointerKeys.clear()
  }

  #releaseAllComputerKeys() {
    for (const deg of [...this.heldKeys.keys()]) this.#keyUp(deg, { force: true })
  }

  #padDown(n) {
    if (SEQ_SCREENS.has(this.screen)) {
      this.seqCtl.selectLane(n)
      return
    }
    if (MIX_SCREENS.has(this.screen)) {
      this.mixer.selectTrack(n)
      return
    }
    if (this.screen === "pad-assign") {
      this.padSelect = n
      this.render()
      if (this.kitEditMode) this.#previewPadSlot()
      return
    }
    if (!this.engine.ready || this.engine.ctx?.state === "suspended") {
      void this.#ensureAudioRunning().then(() => {
        if (this.engine.ctx?.state === "running") this.#padDown(n)
      })
      return
    }
    if (EDIT_SCREENS.has(this.screen) && this.editPatch) {
      void this.#ensureAudioRunning()
      const midi = this.#padMidi(n)
      const focus = this.focusSound || this.sound
      if (isDrum(focus)) {
        this.drums.applyPatch(this.editPatch)
        this.drums.noteOn(midi, 0.9)
      } else {
        const eng = this.editReturnScreen === "pad-assign" ? this.padSynth : this.synth
        eng.applyPatch(this.editPatch)
        if (this.heldPads.has(n)) {
          const prev = this.heldPads.get(n)
          if (prev?.engine === "padSynth" && prev.midi != null) this.padSynth.noteOff(prev.midi, true)
          else if (prev?.midi != null) this.synth.noteOff(prev.midi, true)
        }
        const engine = this.editReturnScreen === "pad-assign" ? "padSynth" : "synth"
        this.heldPads.set(n, { midi, engine })
        eng.noteOn(midi)
      }
      this.#syncLeds()
      return
    }
    void this.#ensureAudioRunning()
    if (this.project.hold && this.heldPads.has(n)) {
      const entry = this.heldPads.get(n)
      this.heldPads.delete(n)
      if (entry?.timer) clearTimeout(entry.timer)
      if (entry?.engine === "padSynth" && entry.midi != null) this.padSynth.noteOff(entry.midi, true)
      else if (entry?.engine === "sample" && entry.midi != null) this.sampleVoice.noteOff(entry.midi, true)
      this.#syncLeds()
      return
    }
    const { slot, assigned, patch } = this.#padSound(n)
    const midi = this.#padMidi(n)

    if (!assigned) {
      this.toast("EMPTY")
      return
    }
    if (isKit(assigned)) {
      this.toast("LOAD KIT FIRST")
      return
    }

    if (isDrum(assigned)) {
      this.drums.applyPatch(patch)
      this.drums.setPan(slot.pan ?? 0)
      this.heldPads.set(n, { midi, engine: "drum" })
      this.drums.noteOn(midi, Math.min(1, 0.95 * this.#padGain(slot)), { recTrack: this.#recTrackForPad(n) })
      this.#syncLeds()
      return
    }

    if (isSample(assigned)) {
      this.sampler.loadBufferForSound(assigned)
      this.sampleVoice.applyPatch(patch)
      this.sampleVoice.setPan(slot.pan ?? 0)
      // Pads play at sample root — chromatic #padMidi would pitch-shift (play too fast).
      const midi = noteNameToMidi(assigned.root || assigned.patch?.root || "C3")
      const mode = slot.mode || assigned.padMode || "oneshot"
      const holdOn = !!this.project.hold
      // HOLD latches + loops; oneshot auto-stop only when HOLD is off.
      const oneshot = mode === "oneshot" && !holdOn
      const vel = Math.min(1, 0.95 * this.#padGain(slot))
      if (this.heldPads.has(n)) {
        const prev = this.heldPads.get(n)
        if (prev?.timer) clearTimeout(prev.timer)
        if (prev?.engine === "sample" && prev.midi != null) this.sampleVoice.noteOff(prev.midi, true)
      }
      const entry = { midi, engine: "sample", oneshot }
      if (oneshot) {
        // Real playback time at this rate (tune-aware); no cap — long clips play to the end.
        // The source ends on its own; this timer only clears held/LED state.
        const playDur = Math.max(0.05, this.sampleVoice.playSeconds(midi))
        entry.timer = setTimeout(() => {
          const cur = this.heldPads.get(n)
          if (cur?.midi === midi && cur.engine === "sample") {
            this.heldPads.delete(n)
            this.sampleVoice.noteOff(midi)
            this.#syncLeds()
          }
        }, Math.max(200, playDur * 1000 + 60))
      }
      this.heldPads.set(n, entry)
      this.sampleVoice.noteOn(midi, vel, { loop: holdOn, recTrack: this.#recTrackForPad(n) })
      this.#syncLeds()
      return
    }

    if (assigned.playable === false) {
      this.toast("NO ENGINE")
      return
    }

    this.padSynth.applyPatch(patch)
    this.padSynth.setPan(slot.pan ?? 0)
    if (this.heldPads.has(n)) {
      const prev = this.heldPads.get(n)
      if (prev?.timer) clearTimeout(prev.timer)
      if (prev?.engine === "padSynth" && prev.midi != null) this.padSynth.noteOff(prev.midi, true)
    }
    const mode = slot.mode || assigned.padMode || "gate"
    const oneshot = mode === "oneshot"
    const vel = Math.min(1, 0.9 * this.#padGain(slot))
    const entry = { midi, engine: "padSynth", oneshot }
    if (oneshot) {
      entry.timer = setTimeout(() => {
        const cur = this.heldPads.get(n)
        if (cur?.midi === midi && cur.engine === "padSynth") {
          this.heldPads.delete(n)
          this.padSynth.noteOff(midi)
          this.#syncLeds()
        }
      }, this.#synthHoldMs(patch))
    }
    this.heldPads.set(n, entry)
    this.padSynth.noteOn(midi, vel, { recTrack: this.#recTrackForPad(n) })
    this.#syncLeds()
  }

  #padUp(n, { force = false } = {}) {
    if (this.screen === "pad-assign" || SEQ_SCREENS.has(this.screen)) return
    if (EDIT_SCREENS.has(this.screen) && isDrum(this.focusSound || this.sound)) {
      this.#syncLeds()
      return
    }
    if (this.project.hold && !force) {
      this.#syncLeds()
      return
    }
    const entry = this.heldPads.get(n)
    if (entry?.oneshot && !force) {
      this.#syncLeds()
      return
    }
    this.heldPads.delete(n)
    if (entry?.timer) clearTimeout(entry.timer)
    if (entry?.engine === "padSynth" && entry.midi != null) this.padSynth.noteOff(entry.midi)
    else if (entry?.engine === "synth" && entry.midi != null) this.synth.noteOff(entry.midi)
    else if (entry?.engine === "sample" && entry.midi != null) this.sampleVoice.noteOff(entry.midi)
    this.#syncLeds()
  }

  #bindComputerKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || this.root.classList.contains("landscape")) return
      if (this.#namingActive() || e.target?.id === "cassio-name-field") return
      if (this.booting || this.bootError) {
        void this.#unlockAudioFromGesture()
        if (this.bootError) {
          this.bootError = null
          this.booting = true
          this.#startBoot()
        }
        return
      }
      if (e.code in KEY_MAP) {
        e.preventDefault()
        this.#keyDown(KEY_MAP[e.code])
      }
      if (e.code === "ArrowUp") this.#handleAction("nav-up", null, "down", e)
      if (e.code === "ArrowDown") this.#handleAction("nav-down", null, "down", e)
      if (e.code === "ArrowLeft") this.#handleAction("nav-left", null, "down", e)
      if (e.code === "ArrowRight") this.#handleAction("nav-right", null, "down", e)
      if (e.code === "Enter") this.#handleAction("nav-ok", null, "down", e)
      if (e.code === "Escape") this.#backTap()
      if (e.code >= "Digit1" && e.code <= "Digit6") this.#padDown(Number(e.code.slice(-1)))
    })
    window.addEventListener("keyup", (e) => {
      if (this.#namingActive() || e.target?.id === "cassio-name-field") return
      if (e.code in KEY_MAP) this.#keyUp(KEY_MAP[e.code])
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        this.#handleAction(e.code === "ArrowRight" ? "nav-right" : "nav-left", null, "up", e)
      }
      if (e.code === "Enter") this.#handleAction("nav-ok", null, "up", e)
      if (e.code >= "Digit1" && e.code <= "Digit6") this.#padUp(Number(e.code.slice(-1)))
    })
    window.addEventListener("blur", () => {
      this.#loopNavHorizontalUp()
      this.#releaseAllPointerKeys()
      this.#releaseAllComputerKeys()
      for (const n of [...this.heldPads.keys()]) this.#padUp(n, { force: true })
    })
  }
}
