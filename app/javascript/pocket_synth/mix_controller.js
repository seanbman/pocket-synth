export const MIX_SCREENS = new Set(["mixer"])

/** Screen 26: six-track level/pan mixer (MIX menu area + LOOP shortcut). */
export class MixController {
  constructor(app) {
    this.app = app
  }

  open(from = "menu") {
    const a = this.app
    a.mixReturnScreen = from === "loop" ? "loop-tracks" : "menu"
    a.screen = "mixer"
    a.loopEngine.ensureGraph()
    a.render()
  }

  softKey(key) {
    const a = this.app
    if (a.screen !== "mixer") return false
    const t = a.loopEngine.selectedTrack
    if (key === "a") {
      t.mute = !t.mute
      if (t.mute) t.solo = false
      a.loopEngine.refreshGains()
      a.toast(`MUTE ${t.mute ? "ON" : "OFF"}`)
      this.#changed()
    }
    if (key === "b") {
      t.solo = !t.solo
      if (t.solo) t.mute = false
      a.loopEngine.refreshGains()
      a.toast(`SOLO ${t.solo ? "ON" : "OFF"}`)
      this.#changed()
    }
    if (key === "c") this.#resetSelected()
    if (key === "d") {
      a.screen = "loop-tracks"
      a.render()
    }
    return true
  }

  nav(dir) {
    const a = this.app
    if (a.screen !== "mixer") return false
    const le = a.loopEngine
    if (dir === "up" || dir === "down" || dir === "left" || dir === "right") {
      const d = (dir === "down" || dir === "right") ? 1 : -1
      le.select(((le.selected - 1 + d + 6) % 6) + 1)
      a.render()
      return true
    }
    return true
  }

  nudgeKnob(which, delta) {
    const a = this.app
    if (a.screen !== "mixer") return false
    const t = a.loopEngine.selectedTrack
    a.loopEngine.ensureGraph()
    if (which === "m1") {
      a.loopEngine.setTrackLevel(t.id, Math.min(1, Math.max(0, (t.level ?? 1) + delta)))
      a.toast(`TRK ${t.id} LVL ${Math.round(a.loopEngine.selectedTrack.level * 100)}%`)
      this.#changed()
      return true
    }
    if (which === "m2") {
      a.loopEngine.setTrackPan(t.id, Math.min(1, Math.max(-1, (t.pan ?? 0) + delta * 2)))
      a.toast(`TRK ${t.id} PAN ${Math.round(a.loopEngine.selectedTrack.pan * 100)}`)
      this.#changed()
      return true
    }
    return false
  }

  back() {
    const a = this.app
    if (a.screen !== "mixer") return false
    a.screen = a.mixReturnScreen || "menu"
    a.render()
    return true
  }

  selectTrack(n) {
    const a = this.app
    if (a.screen !== "mixer") return
    if (!a.loopEngine.tracks.some((t) => t.id === n)) return
    a.loopEngine.select(n)
    a.toast(`LANE ${n}`)
    a.render()
  }

  #resetSelected() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    t.level = 1
    t.pan = 0
    t.mute = false
    t.solo = false
    a.loopEngine.setTrackLevel(t.id, 1)
    a.loopEngine.setTrackPan(t.id, 0)
    a.loopEngine.refreshGains()
    a.toast(`TRK ${t.id} RESET`)
    this.#changed()
  }

  #changed() {
    const a = this.app
    a.persistLoop?.()
    a.render()
  }

  stateExtras() {
    const a = this.app
    if (a.screen !== "mixer") return {}
    const le = a.loopEngine
    return {
      mixerTracks: le.tracks.map((t) => ({
        id: t.id,
        name: t.assigned ? t.name : "EMPTY",
        level: t.level ?? 1,
        pan: t.pan ?? 0,
        mute: !!t.mute,
        solo: !!t.solo,
        hasAudio: !!t.buffer,
        assigned: !!t.assigned
      })),
      mixerSelected: le.selected
    }
  }
}
