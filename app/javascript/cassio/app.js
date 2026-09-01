import { AudioEngine } from "cassio/audio_engine"
import { GlassPolyVoice, noteNameToMidi } from "cassio/voices/glass_poly"
import { Transport } from "cassio/transport"
import {
  loadRecovery, saveRecovery, defaultProject, defaultPads,
  listUserSounds, putUserSound, deleteUserSound, loadFavorites, saveFavorites
} from "cassio/store"
import { patchFromSound, nudgeRoot, sanitizePatch, isUserSound } from "cassio/patch"
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

const KEY_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12
}

const KNOB_MIN_DEG = -135
const KNOB_MAX_DEG = 135
const VIZ_SILENCE = 0.006
const VIZ_GAIN = 2.8
const EDIT_SCREENS = new Set(["edit-shape", "edit-env", "edit-eq", "edit-fx"])
const PAD_DEG = [0, 2, 4, 5, 7, 9]

export class CassioApp {
  constructor(root) {
    this.root = root
    this.vscreen = root.querySelector("[data-vscreen]")
    this.vscreenOverlay = root.querySelector("[data-vscreen-overlay]")
    this.keyboardEl = root.querySelector(".keyboard")
    this.portraitGate = root.querySelector("[data-portrait-gate]")
    this.engine = new AudioEngine()
    this.voice = new GlassPolyVoice(this.engine)
    this.transport = new Transport()
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
    this.librarySnapshot = null
    this.nameDraft = ""
    this.nameMode = null
    this.nameReturnScreen = "save-sound"
    this.confirmTitle = ""
    this.confirmLines = []
    this.confirmAction = null
    this.booting = true
    this.bootError = null
    this.splashDone = false
    this._vizRaf = null
    this.#bindHardware()
    this.#bindPitchWheel()
    this.#bindKeyboardPointer()
    this.#bindComputerKeys()
    this.#bindOrientation()
    this.#fitChassis()
    this.root.addEventListener("selectstart", (e) => e.preventDefault())
    window.addEventListener("resize", () => this.#fitChassis())
    this.render()
    this.#runSplashThenBoot()
  }

  async #runSplashThenBoot() {
    this.screen = "splash"
    this.render()
    await new Promise((r) => setTimeout(r, 1500))
    this.splashDone = true
    await this.#startBoot()
  }

  async #startBoot() {
    this.screen = "boot"
    this.booting = true
    this.bootError = null
    this.render()
    try {
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
      }
      this.transport.bpm = this.project.bpm
      this.#setBootProgress(0.8, "LOADING AUDIO…")
      await this.engine.start()
      this.engine.setMasterVolume(this.project.masterVolume)
      this.#resolveSound(this.project.soundId)
      this.#applyProjectPatch()
      this.#setBootProgress(1, "READY")
      await new Promise((r) => setTimeout(r, 280))
      this.booting = false
      this.screen = "play"
      this.render()
      this.#syncAllKnobVisuals()
      this.#persist()
    } catch (e) {
      this.bootError = String(e.message || e) || "AUDIO INIT FAILED — TAP TO RETRY"
      this.render()
    }
  }

  async #ensureAudioRunning() {
    if (!this.engine.ready) return
    await this.engine.resume()
  }

  #setBootProgress(p, msg) {
    this.bootProgress = p
    this.bootMessage = msg
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
    const patch = {
      root: this.project.root || this.sound?.root || "C3",
      brightness: this.project.brightness,
      resonance: this.project.resonance ?? 0.34,
      attack: this.project.attack ?? 0.018,
      release: this.project.release ?? 0.48,
      bassDb: this.project.bassDb ?? 0,
      trebleDb: this.project.trebleDb ?? 0,
      reverb: this.project.space,
      delay: this.project.delay ?? 0
    }
    this.voice.applyPatch(patch)
    this.project.root = patch.root
  }

  #commitPatchToProject(patch) {
    this.project.root = patch.root
    this.project.brightness = patch.brightness
    this.project.resonance = patch.resonance
    this.project.attack = patch.attack
    this.project.release = patch.release
    this.project.bassDb = patch.bassDb
    this.project.trebleDb = patch.trebleDb
    this.project.space = patch.reverb
    this.project.delay = patch.delay
    this.voice.applyPatch(patch)
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
      factorySounds: this.#factorySounds(),
      userSounds: this.userSounds,
      nameDraft: this.nameDraft,
      confirmTitle: this.confirmTitle,
      confirmLines: this.confirmLines
    }
  }

  render() {
    this.#stopViz()
    if (this.bootError) {
      this.vscreen.innerHTML = renderBootError(this.bootError)
    } else if (!this.splashDone || this.screen === "splash") {
      this.vscreen.innerHTML = renderSplash()
    } else if (this.booting) {
      this.vscreen.innerHTML = renderBoot(this.bootProgress || 0.1, this.bootMessage || "LOADING…")
    } else if (this.screen === "menu") {
      this.vscreen.innerHTML = renderMenu(this.state())
    } else if (this.screen === "library") {
      this.vscreen.innerHTML = renderLibrary(this.state())
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
    if (this.screen === "edit-shape") return this.editPatch?.brightness ?? 0.68
    if (this.screen === "edit-env") return Math.min(1, (this.editPatch?.attack ?? 0.018) / 1.2)
    if (this.screen === "edit-eq") return ((this.editPatch?.bassDb ?? 0) + 12) / 24
    if (this.screen === "edit-fx") return this.editPatch?.reverb ?? 0
    return this.project.brightness
  }

  #m2Value() {
    if (this.screen === "edit-shape") return this.editPatch?.resonance ?? 0.34
    if (this.screen === "edit-env") return Math.min(1, (this.editPatch?.release ?? 0.48) / 2.5)
    if (this.screen === "edit-eq") return ((this.editPatch?.trebleDb ?? 0) + 12) / 24
    if (this.screen === "edit-fx") return this.editPatch?.delay ?? 0
    return this.project.space
  }

  #syncKnobVisual(which) {
    const el = this.root.querySelector(`[data-knob="${which}"]`)
    if (!el) return
    let value = 0
    if (which === "m1") value = this.#m1Value()
    else if (which === "m2") value = this.#m2Value()
    else if (which === "m3") value = this.project.masterVolume
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
      const active = this.voice.voices.size > 0 || rms > VIZ_SILENCE

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
      el.classList.toggle("active", this.heldPads.has(n))
    })
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

  #persist() {
    saveRecovery({
      bpm: this.transport.bpm,
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
      pads: this.project.pads
    })
  }

  #bindHardware() {
    this.root.addEventListener("pointerdown", (e) => {
      if (this.root.classList.contains("landscape")) return
      if (this.booting || this.bootError) {
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
      this.voice.setPitchBend(v)
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
        if (tapped && Math.abs(this.voice.pitchBend || 0) > 0.01) {
          setBend(0, true)
        } else {
          wheel.classList.remove("is-dragging")
          applyVisual(this.voice.pitchBend || 0)
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
      startBend = this.voice.pitchBend || 0
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
    if (which === "m3") {
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
      if (this.screen === "edit-shape") {
        if (which === "m1") {
          this.editPatch.brightness = Math.min(1, Math.max(0.05, this.editPatch.brightness + delta))
          this.voice.setBrightness(this.editPatch.brightness)
          this.toast(`CUTOFF ${Math.round(this.editPatch.brightness * 100)}%`)
        } else {
          this.editPatch.resonance = Math.min(1, Math.max(0, this.editPatch.resonance + delta))
          this.voice.setResonance(this.editPatch.resonance)
          this.toast(`RES ${Math.round(this.editPatch.resonance * 100)}%`)
        }
      } else if (this.screen === "edit-env") {
        if (which === "m1") {
          this.editPatch.attack = Math.min(1.2, Math.max(0.005, this.editPatch.attack + delta * 0.6))
          this.voice.setAttack(this.editPatch.attack)
          this.toast(`ATK ${Math.round(this.editPatch.attack * 1000)}ms`)
        } else {
          this.editPatch.release = Math.min(2.5, Math.max(0.02, this.editPatch.release + delta * 0.8))
          this.voice.setRelease(this.editPatch.release)
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
      this.project.brightness = Math.min(1, Math.max(0.05, this.project.brightness + delta))
      this.voice.setBrightness(this.project.brightness)
      this.toast(`TONE ${Math.round(this.project.brightness * 100)}%`)
    } else if (which === "m2") {
      this.project.space = Math.min(1, Math.max(0, this.project.space + delta))
      this.engine.setSpace(this.project.space)
      this.toast(`FX ${Math.round(this.project.space * 100)}%`)
    }
    this.#syncKnobVisual(which)
    this.#persist()
  }

  #handleAction(action, el, phase, event) {
    if (action.startsWith("soft-")) {
      if (phase === "down") this.#softKey(action.split("-")[1])
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
      return
    }
    switch (action) {
      case "play":
        this.#ensureAudioRunning()
        this.transport.playPause()
        this.render()
        break
      case "stop":
        this._stopHoldTimer = setTimeout(() => {
          this._stopHoldTimer = null
          this.voice.allNotesOff()
          this.engine.panic()
          this.toast("PANIC")
        }, 450)
        this.transport.stop()
        this.render()
        break
      case "rec":
        this.toast("REC — COMING SOON")
        break
      case "tap":
        this.transport.tap()
        this.project.bpm = this.transport.bpm
        this.render()
        this.#persist()
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
        this.#nav("left")
        break
      case "nav-right":
        this.#nav("right")
        break
      case "nav-ok":
        this.#navOk()
        break
      default:
        break
    }
  }

  #backTap() {
    if (this.screen === "menu") {
      this.#closeMenu()
      return
    }
    if (this.screen === "library") {
      this.#exitLibrary(false)
      return
    }
    if (this.screen === "detail") {
      this.screen = "library"
      this.render()
      return
    }
    if (EDIT_SCREENS.has(this.screen)) {
      if (this.editDirty) {
        this.saveName = this.focusSound?.name || "USER SOUND"
        this.screen = "save-sound"
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
      this.screen = "detail"
      this.render()
      return
    }
    if (this.screen === "sound-manage") {
      this.screen = "detail"
      this.render()
      return
    }
    if (this.screen === "confirm") {
      this.screen = "sound-manage"
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
      if (key === "a") this.#setLibTab("factory")
      if (key === "b") this.#setLibTab("user")
      if (key === "c") this.#setLibTab("rec")
      if (key === "d") this.#setLibTab("fav")
      return
    }

    if (this.screen === "detail") {
      if (key === "a") this.#useKeys()
      if (key === "b") this.#openEdit()
      if (key === "c") this.#openPadAssign()
      if (key === "d") {
        if (isUserSound(this.focusSound || this.sound)) {
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
        this.screen = "sound-manage"
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
      if (key === "a") this.screen = "edit-shape"
      if (key === "b") this.screen = "edit-env"
      if (key === "c") this.screen = "edit-eq"
      if (key === "d") this.screen = "edit-fx"
      this.render()
      return
    }

    if (this.screen === "save-sound") {
      if (key === "a") {
        this.editDirty = false
        this.screen = "detail"
        this.#applyProjectPatch()
        this.render()
      }
      if (key === "b") this.#askName({
        initial: this.saveName || this.focusSound?.name || "",
        mode: "save",
        returnScreen: "save-sound"
      })
      if (key === "c") this.#saveAs()
      if (key === "d") this.#saveInPlace()
      return
    }

    if (this.screen === "pad-assign") {
      if (key === "a") this.#clearPad()
      if (key === "b") {
        const p = this.project.pads.find((x) => x.pad === this.padSelect)
        if (p) {
          p.mode = p.mode === "gate" ? "one-shot" : "gate"
          this.toast(`PAD ${this.padSelect} ${p.mode.toUpperCase()}`)
          this.#persist()
          this.render()
        }
      }
      if (key === "c") this.#previewFocus()
      if (key === "d") {
        this.screen = "play"
        this.render()
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
        this.voice.allNotesOff()
        this.heldKeys.clear()
        this.heldPads.clear()
        this.#syncLeds()
        this.root.querySelectorAll(".key.active").forEach((el) => el.classList.remove("active"))
        if (this._setPitchBendVisual) this._setPitchBendVisual(0, true)
        else this.voice.setPitchBend(0)
      }
      this.render()
      this.#persist()
    }
    if (key === "d") this.#openLibrary()
  }

  #openMenu() {
    this.screen = "menu"
    this.render()
  }

  #closeMenu() {
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
      this.#openLibrary()
      return
    }
    this.toast(`${area} — COMING SOON`)
  }

  #libraryCategories() {
    const sounds = this.#libraryListRaw()
    const cats = [...new Set(sounds.map((s) => s.category || "FACTORY / SYNTH"))]
    return cats.length ? cats : ["FACTORY / SYNTH"]
  }

  #libraryListRaw() {
    if (this.libTab === "factory") return this.#factorySounds()
    if (this.libTab === "user") return this.userSounds
    if (this.libTab === "rec") {
      return this.userSounds.filter((s) => s.origin === "rec" || s.origin === "import")
    }
    if (this.libTab === "fav") {
      return this.favorites.map((id) => this.#soundById(id)).filter(Boolean)
    }
    return []
  }

  #libraryList() {
    const raw = this.#libraryListRaw()
    if (this.libTab !== "factory") return raw
    const cats = this.#libraryCategories()
    if (!this.libCategory || !cats.includes(this.libCategory)) this.libCategory = cats[0]
    return raw.filter((s) => (s.category || "FACTORY / SYNTH") === this.libCategory)
  }

  #setLibTab(tab) {
    this.libTab = tab
    this.libIndex = 0
    this.libCategory = null
    this.render()
    this.#previewHighlight()
  }

  #openLibrary() {
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
      delay: this.project.delay
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
      Object.assign(this.project, this.librarySnapshot)
      this.#resolveSound(this.project.soundId)
      this.#applyProjectPatch()
    }
    this.librarySnapshot = null
    this.screen = "play"
    this.render()
  }

  #previewHighlight() {
    const list = this.#libraryList()
    const s = list[this.libIndex]
    if (!s) return
    this.focusSound = s
    if (s.playable === false) return
    const patch = patchFromSound(s, s.patch || {})
    this.voice.applyPatch(patch)
    this.#ensureAudioRunning()
    const midi = noteNameToMidi(patch.root || "C3")
    this.voice.noteOff(midi, true)
    this.voice.noteOn(midi, 0.7)
    setTimeout(() => this.voice.noteOff(midi), 280)
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

  #nav(dir) {
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
        if (this.libTab !== "factory" || cats.length < 2) return
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
      if (!this.editPatch) {
        const s = this.focusSound || this.sound
        this.editPatch = patchFromSound(s, s?.patch || {})
      }
      const delta = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? 12 : dir === "down" ? -12 : 0
      if (!delta) return
      this.editPatch.root = nudgeRoot(this.editPatch.root, delta)
      this.editDirty = true
      this.toast(`ROOT ${this.editPatch.root}`)
      if (this.project.soundId === (this.focusSound || this.sound)?.id) {
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
      if (dir === "left") this.#shiftPlayRoot(-1)
      if (dir === "right") this.#shiftPlayRoot(1)
      if (dir === "up") this.#shiftPlayRoot(12)
      if (dir === "down") this.#shiftPlayRoot(-12)
    }
  }

  #navOk() {
    if (this.screen === "menu") {
      this.#openArea()
      return
    }
    if (this.screen === "library") {
      const list = this.#libraryList()
      const s = list[this.libIndex]
      if (!s) return
      this.focusSound = s
      this.editPatch = patchFromSound(s, s.patch || {})
      this.editDirty = false
      this.screen = "detail"
      this.render()
      return
    }
    if (this.screen === "pad-assign") {
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
    const patch = this.editPatch || patchFromSound(s, s.patch || {})
    this.project.soundId = s.id
    this.sound = s
    this.#commitPatchToProject(patch)
    this.librarySnapshot = null
    this.editDirty = false
    this.screen = "play"
    this.render()
    this.#persist()
    this.toast(`KEYS ← ${s.name}`)
  }

  #openEdit() {
    const s = this.focusSound || this.sound
    if (!s || s.playable === false) {
      this.toast("NO ENGINE")
      return
    }
    this.focusSound = s
    const live = this.project.soundId === s.id
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
        delay: this.project.delay
      } : {})
    })
    this.editDirty = false
    this.editReturnScreen = "edit-shape"
    this.voice.applyPatch(this.editPatch)
    this.screen = "edit-shape"
    this.render()
  }

  #openPadAssign() {
    this.focusSound = this.focusSound || this.sound
    this.padSelect = 1
    this.screen = "pad-assign"
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

    if (mode === "duplicate") {
      await this.#finishDuplicate(v)
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
    const sound = {
      id,
      name: this.saveName,
      category: "USER / SYNTH",
      voice: src?.voice || "poly",
      root: patch.root,
      padMode: src?.padMode || "gate",
      source: "user",
      sourceId: src?.sourceId || src?.id,
      macros: src?.macros || {
        m1: { label: "TONE", param: "brightness" },
        m2: { label: "FX", param: "space" }
      },
      patch,
      playable: true
    }
    await putUserSound(sound)
    this.userSounds = await listUserSounds()
    this.focusSound = sound
    this.editPatch = patch
    this.editDirty = false
    this.toast("SAVED USER")
    this.screen = "detail"
    this.render()
  }

  async #saveInPlace() {
    const s = this.focusSound
    if (!s || !isUserSound(s)) {
      this.toast("USE SAVE AS")
      return
    }
    if (this.saveName) s.name = this.saveName
    const patch = sanitizePatch(this.editPatch || patchFromSound(s))
    s.root = patch.root
    s.patch = { ...patch }
    await putUserSound(s)
    this.userSounds = await listUserSounds()
    this.focusSound = this.userSounds.find((u) => u.id === s.id) || s
    if (this.project.soundId === s.id) this.#commitPatchToProject(patch)
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
    this.editPatch = sanitizePatch(s.patch || patchFromSound(s))
    this.#askName({
      initial: `${base} COPY`.slice(0, 18),
      mode: "duplicate",
      returnScreen: "sound-manage"
    })
  }

  async #finishDuplicate(name) {
    const src = this.focusSound || this.sound
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
    this.confirmTitle = "DELETE USER SOUND?"
    this.confirmLines = [
      { text: s.name, tone: "green" },
      { text: "THIS CANNOT BE UNDONE.", tone: "muted" },
      { text: "A CANCEL · D DELETE", tone: "muted" }
    ]
    this.confirmAction = "delete-sound"
    this.screen = "confirm"
    this.render()
  }

  async #confirmDestructive() {
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
    this.libTab = "user"
    this.libIndex = 0
    this.screen = "library"
    this.render()
  }

  #assignPad() {
    const s = this.focusSound || this.sound
    if (!s) return
    const p = this.project.pads.find((x) => x.pad === this.padSelect)
    if (!p) return
    p.soundId = s.id
    p.mode = s.padMode || p.mode || "gate"
    this.toast(`PAD ${this.padSelect} ← ${s.name}`)
    this.#persist()
    this.render()
  }

  #clearPad() {
    const p = this.project.pads.find((x) => x.pad === this.padSelect)
    if (!p) return
    p.soundId = null
    this.toast(`PAD ${this.padSelect} CLEAR`)
    this.#persist()
    this.render()
  }

  #previewFocus() {
    const s = this.focusSound || this.sound
    if (!s || s.playable === false) {
      this.toast("NO ENGINE")
      return
    }
    const patch = patchFromSound(s, s.patch || this.editPatch || {})
    this.voice.applyPatch(patch)
    this.#ensureAudioRunning()
    const midi = noteNameToMidi(patch.root || "C3")
    this.voice.noteOn(midi, 0.75)
    setTimeout(() => this.voice.noteOff(midi), 320)
  }

  #baseMidi() {
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
      this.voice.noteOff(oldMidi, true)
      this.voice.noteOn(newMidi)
      this.heldKeys.set(degree, newMidi)
    }
    for (const n of [...this.heldPads.keys()]) {
      const oldMidi = this.heldPads.get(n)
      const newMidi = this.#padMidi(n)
      if (oldMidi === newMidi) continue
      this.voice.noteOff(oldMidi, true)
      this.voice.noteOn(newMidi)
      this.heldPads.set(n, newMidi)
    }
  }

  #keyDown(degree) {
    this.#ensureAudioRunning()
    if (this.project.hold && this.heldKeys.has(degree)) {
      const midi = this.heldKeys.get(degree)
      this.heldKeys.delete(degree)
      if (midi != null) this.voice.noteOff(midi, true)
      this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.remove("active")
      return
    }
    const midi = this.#baseMidi() + degree
    if (this.heldKeys.has(degree)) {
      this.voice.noteOff(this.heldKeys.get(degree), true)
    }
    this.heldKeys.set(degree, midi)
    this.voice.noteOn(midi)
    this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.add("active")
  }

  #keyUp(degree, { force = false } = {}) {
    if (this.project.hold && !force) {
      if (this.heldKeys.has(degree)) {
        this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.add("active")
      }
      return
    }
    this.root.querySelector(`[data-action="key-${degree}"]`)?.classList.remove("active")
    const midi = this.heldKeys.get(degree)
    this.heldKeys.delete(degree)
    if (midi != null) this.voice.noteOff(midi)
  }

  #releaseAllPointerKeys() {
    for (const deg of [...this.pointerKeys.values()]) this.#keyUp(deg, { force: true })
    this.pointerKeys.clear()
  }

  #releaseAllComputerKeys() {
    for (const deg of [...this.heldKeys.keys()]) this.#keyUp(deg, { force: true })
  }

  #padDown(n) {
    if (this.screen === "pad-assign") {
      this.padSelect = n
      this.render()
      return
    }
    this.#ensureAudioRunning()
    if (this.project.hold && this.heldPads.has(n)) {
      const midi = this.heldPads.get(n)
      this.heldPads.delete(n)
      if (midi != null) this.voice.noteOff(midi, true)
      this.#syncLeds()
      return
    }
    const slot = this.project.pads?.find((p) => p.pad === n)
    const assigned = slot?.soundId ? this.#soundById(slot.soundId) : null
    // Non-playable assigned sounds: still trigger glass poly at pad pitch (stand-in until engines exist)
    if (assigned?.playable !== false && assigned && this.project.soundId !== assigned.id) {
      const patch = patchFromSound(assigned, assigned.patch || {})
      this.voice.applyPatch(patch)
    } else {
      this.#applyProjectPatch()
    }
    const midi = this.#padMidi(n)
    if (this.heldPads.has(n)) {
      this.voice.noteOff(this.heldPads.get(n), true)
    }
    this.heldPads.set(n, midi)
    this.voice.noteOn(midi)
    this.#syncLeds()
  }

  #padUp(n, { force = false } = {}) {
    if (this.screen === "pad-assign") return
    if (this.project.hold && !force) {
      this.#syncLeds()
      return
    }
    const midi = this.heldPads.get(n)
    this.heldPads.delete(n)
    if (midi != null) this.voice.noteOff(midi)
    // Restore keyboard voice patch after pad preview
    if (!this.heldPads.size) this.#applyProjectPatch()
    this.#syncLeds()
  }

  #bindComputerKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || this.root.classList.contains("landscape")) return
      if (this.#namingActive() || e.target?.id === "cassio-name-field") return
      if (this.booting || this.bootError) {
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
      if (e.code >= "Digit1" && e.code <= "Digit6") this.#padUp(Number(e.code.slice(-1)))
    })
    window.addEventListener("blur", () => {
      this.#releaseAllPointerKeys()
      this.#releaseAllComputerKeys()
      for (const n of [...this.heldPads.keys()]) this.#padUp(n, { force: true })
    })
  }
}
