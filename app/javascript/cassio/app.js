import { AudioEngine } from "cassio/audio_engine"
import { GlassPolyVoice, noteNameToMidi } from "cassio/voices/glass_poly"
import { Transport } from "cassio/transport"
import { loadRecovery, saveRecovery, defaultProject } from "cassio/store"
import { renderBoot, renderBootError, renderSplash } from "cassio/screens/boot"
import { renderPlay } from "cassio/screens/play"
import { renderMenu, AREAS } from "cassio/screens/menu"

const KEY_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12
}

const KNOB_MIN_DEG = -135
const KNOB_MAX_DEG = 135
const VIZ_SILENCE = 0.006
const VIZ_GAIN = 2.8

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
    this.screen = "splash"
    this.menuIndex = 0
    this.heldKeys = new Map()
    this.heldPads = new Map()
    this.pointerKeys = new Map()
    this.project = defaultProject()
    this.sound = null
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
      this.#setBootProgress(0.25, "LOADING FACTORY…")
      const res = await fetch("/factory/sounds.json")
      this.factory = await res.json()
      this.#setBootProgress(0.5, "LOADING RECOVERY…")
      const recovered = await loadRecovery()
      if (recovered) Object.assign(this.project, recovered)
      this.transport.bpm = this.project.bpm
      this.#setBootProgress(0.75, "LOADING AUDIO…")
      await this.engine.start()
      this.engine.setMasterVolume(this.project.masterVolume)
      this.engine.setSpace(this.project.space)
      this.voice.setBrightness(this.project.brightness)
      this.sound = this.factory.sounds.find((s) => s.id === this.project.soundId) || this.factory.sounds[0]
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

  state() {
    return {
      bpm: this.transport.bpm,
      playing: this.transport.playing,
      recording: this.transport.recording,
      octave: this.project.octave,
      hold: this.project.hold,
      key: this.project.key,
      sound: this.sound,
      menuIndex: this.menuIndex
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

  #syncKnobVisual(which) {
    const el = this.root.querySelector(`[data-knob="${which}"]`)
    if (!el) return
    let value = 0
    if (which === "m1") value = this.project.brightness
    else if (which === "m2") value = this.project.space
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

      // Amplitude follows loudness + master volume; shape follows live waveform/timbre
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

  #bindOrientation() {
    const apply = () => {
      const mq = window.matchMedia("(orientation: landscape)")
      const mobileish = window.matchMedia("(max-height: 560px), (max-width: 920px)").matches
      const landscape = mq.matches && window.innerWidth > window.innerHeight && mobileish
      this.root.classList.toggle("landscape", landscape)
      if (this.portraitGate) this.portraitGate.hidden = !landscape
      if (landscape) {
        this.#releaseAllPointerKeys()
        this.#releaseAllComputerKeys()
        for (const n of [...this.heldPads.keys()]) this.#padUp(n, { force: true })
      } else {
        requestAnimationFrame(() => this.#fitChassis())
      }
    }
    apply()
    window.matchMedia("(orientation: landscape)").addEventListener("change", apply)
    window.addEventListener("resize", apply)
  }

  #persist() {
    saveRecovery({
      bpm: this.transport.bpm,
      soundId: this.project.soundId,
      octave: this.project.octave,
      hold: this.project.hold,
      masterVolume: this.project.masterVolume,
      brightness: this.project.brightness,
      space: this.project.space,
      key: this.project.key
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
    } else if (which === "m1") {
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
        if (this.screen === "menu") this.#closeMenu()
        else this.#openMenu()
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
        if (this.screen === "menu") {
          this.menuIndex = (this.menuIndex + AREAS.length - 1) % AREAS.length
          this.render()
        }
        break
      case "nav-down":
        if (this.screen === "menu") {
          this.menuIndex = (this.menuIndex + 1) % AREAS.length
          this.render()
        }
        break
      case "nav-ok":
        if (this.screen === "menu") this.#openArea()
        break
      default:
        break
    }
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
    if (key === "d") {
      this.toast("LIBRARY — COMING SOON")
      this.menuIndex = AREAS.indexOf("SOUND")
      this.#openMenu()
    }
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
    this.toast(`${area} — COMING SOON`)
  }

  #baseMidi() {
    return noteNameToMidi("C3") + this.project.octave * 12
  }

  #padMidi(n) {
    return this.#baseMidi() + [0, 2, 4, 5, 7, 9][n - 1] + 12
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
      // Keep latched key visually active while HOLD is on
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
    this.#ensureAudioRunning()
    if (this.project.hold && this.heldPads.has(n)) {
      const midi = this.heldPads.get(n)
      this.heldPads.delete(n)
      if (midi != null) this.voice.noteOff(midi, true)
      this.#syncLeds()
      return
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
    if (this.project.hold && !force) {
      this.#syncLeds()
      return
    }
    const midi = this.heldPads.get(n)
    this.heldPads.delete(n)
    if (midi != null) this.voice.noteOff(midi)
    this.#syncLeds()
  }

  #bindComputerKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || this.root.classList.contains("landscape")) return
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
      if (e.code === "Enter") this.#handleAction("nav-ok", null, "down", e)
      if (e.code === "Escape") {
        if (this.screen === "menu") this.#closeMenu()
        else this.#openMenu()
      }
      if (e.code >= "Digit1" && e.code <= "Digit6") this.#padDown(Number(e.code.slice(-1)))
    })
    window.addEventListener("keyup", (e) => {
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
