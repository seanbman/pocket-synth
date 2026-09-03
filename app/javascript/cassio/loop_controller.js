import { OPTION_ROWS } from "cassio/screens/loop"
import { nudgeFx, stepFx, fmtFx, fxKnob01, fxDefaults } from "cassio/audio/fx_params"
import { buildSettingsRows, knobParamsAt } from "cassio/screens/settings_list"
import { QUANTIZE_OPTS, QUANTIZE_LABELS, trackSeqHasHits, patternHasHits } from "cassio/store"
import { LOOP_LENGTH_PRESETS } from "cassio/audio/loop_engine"

export const LOOP_SCREENS = new Set([
  "loop-tracks", "loop-menu", "loop-options", "loop-fx", "track-list"
])
const DEFAULT_FX_EXPANDED = ["mix"]

function menuRowsFor(t) {
  const empty = !t?.assigned
  return empty
    ? ["pick", "dropPattern", "patternSeq", "addLane", "delLane", "trackList", "options"]
    : [
      "patternSeq", "dropPattern", "fx", "length", "mode", "monitor", "mute", "solo",
      "save", "replace", "mixer", "options", "addLane", "delLane", "clearAudio", "unassign"
    ]
}

/** LOOP area: arrangement lanes, track library, options, REC orchestration. */
export class LoopController {
  constructor(app) {
    this.app = app
  }

  openHome() {
    const a = this.app
    a.screen = "loop-tracks"
    a.loopMenuIndex = 0
    a.loopOptIndex = 0
    a.trackListAssignLane = null
    a.trackListPreviewing = false
    this.#stopPreview()
    a.render()
  }

  /** Focus a lane on the timeline. */
  selectTrack(id) {
    const a = this.app
    const n = Number(id)
    if (!a.loopEngine.tracks.some((t) => t.id === n)) return
    a.loopEngine.select(n)
    a.loopScrollFollow = true
    a.render()
  }

  openTrackList({ assignLane = null } = {}) {
    const a = this.app
    this.#stopPreview()
    a.trackListAssignLane = assignLane
    a.trackListIndex = 0
    a.trackListPreviewing = false
    a.screen = "track-list"
    a.render()
  }

  softKey(key) {
    const a = this.app
    if (a.screen === "track-list") {
      if (key === "a") this.#newLibraryTrack()
      if (key === "b") this.#askDeleteLibraryTrack()
      if (key === "c") this.#togglePreview()
      if (key === "d") {
        this.#stopPreview()
        a.trackListAssignLane = null
        a.screen = "loop-tracks"
        a.render()
      }
      return true
    }
    if (a.screen === "loop-tracks") {
      if (key === "a") {
        a.loopEngine.addLane()
        a.toast(`LANE ${a.loopEngine.selected}`)
        a.persistLoop?.()
        a.render()
      }
      if (key === "b") this.#toggleMuteSelected()
      if (key === "c") this.#toggleSoloSelected()
      if (key === "d") this.#softKeyDTracks()
      return true
    }
    if (a.screen === "loop-menu") {
      const t = a.loopEngine.selectedTrack
      if (!t?.assigned) {
        if (key === "a") this.openTrackList({ assignLane: t.id })
        if (key === "d") { a.screen = "loop-tracks"; a.render() }
        return true
      }
      if (key === "a") this.#toggleMode()
      if (key === "b") this.#toggleMonitor()
      if (key === "c") this.#askClear()
      if (key === "d") { a.screen = "loop-tracks"; a.render() }
      return true
    }
    if (a.screen === "loop-options") {
      if (key === "a") { a.seqCtl.open(); return true }
      if (key === "b") { a.loopOptIndex = 1; a.render() }
      if (key === "c") this.#cyclePlayDuringRec()
      if (key === "d") { a.screen = "loop-tracks"; a.render() }
      return true
    }
    if (a.screen === "loop-fx") {
      if (key === "a") { this.#fxSelectTrack(1) }
      if (key === "b") { this.#fxSelectTrack(-1) }
      if (key === "c") this.#fxReset()
      if (key === "d") { a.screen = "loop-menu"; a.render() }
      return true
    }
    return false
  }

  #softKeyDTracks() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) {
      this.openTrackList({ assignLane: t.id })
      return
    }
    if (t.dirty) {
      const entry = a.loopEngine.saveLaneToLibrary(t.id)
      a.toast(entry ? `SAVED ${entry.name}` : "SAVE FAILED")
      a.persistLoop?.()
      a.render()
      return
    }
    if (a.loopEngine.undo()) {
      a.toast("UNDO")
      if (a.transport.playing) {
        a.playContext = "loop"
        a.applyPlayContextPublic?.()
      }
      a.persistLoop?.()
    } else a.toast("NOTHING TO UNDO")
    a.render()
  }

  openTrackFx() {
    const a = this.app
    if (!a.loopEngine.selectedTrack?.assigned) {
      a.toast("EMPTY LANE")
      return
    }
    a.loopEngine.ensureGraph()
    a.loopFxIndex = a.loopFxIndex || 0
    a.screen = "loop-fx"
    a.render()
  }

  fxRows() {
    const a = this.app
    if (!a.loopFxExpanded) a.loopFxExpanded = new Set(DEFAULT_FX_EXPANDED)
    return buildSettingsRows("track", a.loopFxExpanded)
  }

  fxValues() {
    const t = this.app.loopEngine.selectedTrack
    return { ...(t?.fx || {}), level: t?.level ?? 1, pan: t?.pan ?? 0 }
  }

  fxKnob01(i) {
    const rows = this.fxRows()
    const knobs = knobParamsAt(rows, this.app.loopFxIndex || 0)
    const p = knobs[i]
    if (!p) return null
    return Math.min(1, Math.max(0, fxKnob01(p, this.fxValues()[p.key] ?? p.def)))
  }

  #fxSet(p, value) {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return
    a.loopEngine.setTrackFx(t.id, p.key, value)
    a.toast(`TRK ${t.id} ${p.label} ${fmtFx(p, this.fxValues()[p.key])}`)
    a.persistLoop?.()
    a.render()
  }

  #fxSelectTrack(dir) {
    const a = this.app
    const ids = a.loopEngine.tracks.map((t) => t.id)
    const i = Math.max(0, ids.indexOf(a.loopEngine.selected))
    const next = ids[(i + (dir > 0 ? 1 : ids.length - 1)) % ids.length]
    a.loopEngine.select(next)
    a.toast(`LANE ${a.loopEngine.selected}`)
    a.render()
  }

  #fxReset() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return
    const d = fxDefaults("track")
    for (const [k, v] of Object.entries(d)) {
      if (k === "level" || k === "pan") continue
      a.loopEngine.setTrackFx(t.id, k, v)
    }
    a.toast(`TRK ${t.id} FX RESET`)
    a.persistLoop?.()
    a.render()
  }

  nav(dir) {
    const a = this.app
    if (a.screen === "track-list") {
      const n = a.loopEngine.library.length || 1
      if (dir === "up" || dir === "down") {
        a.trackListIndex = ((a.trackListIndex || 0) + (dir === "down" ? 1 : n - 1)) % n
        if (a.trackListPreviewing) this.#startPreview()
        a.render()
      }
      if (dir === "ok") this.#selectLibraryTrack()
      return true
    }
    if (a.screen === "loop-tracks") {
      if (dir === "up" || dir === "down") {
        const ids = a.loopEngine.tracks.map((t) => t.id)
        const i = Math.max(0, ids.indexOf(a.loopEngine.selected))
        const next = ids[(i + (dir === "down" ? 1 : ids.length - 1)) % ids.length]
        a.loopEngine.select(next)
        a.loopScrollFollow = true
        a.render()
      }
      if (dir === "ok") {
        const t = a.loopEngine.selectedTrack
        if (!t?.assigned) {
          this.openTrackList({ assignLane: t.id })
        } else {
          a.loopMenuIndex = 0
          a.screen = "loop-menu"
          a.render()
        }
      }
      return true
    }
    if (a.screen === "loop-menu") {
      const t = a.loopEngine.selectedTrack
      const keys = menuRowsFor(t)
      if (dir === "up" || dir === "down") {
        a.loopMenuIndex = ((a.loopMenuIndex || 0) + (dir === "down" ? 1 : keys.length - 1)) % keys.length
        a.render()
      }
      if (dir === "left" || dir === "right" || dir === "ok") {
        this.#menuAction(keys[a.loopMenuIndex || 0], dir)
      }
      return true
    }
    if (a.screen === "loop-options") {
      if (dir === "ok") {
        const key = OPTION_ROWS[a.loopOptIndex || 0]
        if (key === "patternSeq") {
          a.seqCtl.open()
          return true
        }
      }
      if (dir === "up" || dir === "down") {
        const n = OPTION_ROWS.length
        a.loopOptIndex = ((a.loopOptIndex || 0) + (dir === "down" ? 1 : n - 1)) % n
        a.render()
      }
      if (dir === "left" || dir === "right") {
        this.#nudgeOption(dir === "right" ? 1 : -1)
      }
      return true
    }
    if (a.screen === "loop-fx") {
      const rows = this.fxRows()
      const idx = Math.min(rows.length - 1, Math.max(0, a.loopFxIndex || 0))
      const row = rows[idx]
      if (dir === "up" || dir === "down") {
        a.loopFxIndex = (idx + (dir === "down" ? 1 : rows.length - 1)) % rows.length
        a.render()
      } else if (dir === "ok") {
        if (row?.kind === "group") {
          const set = a.loopFxExpanded
          if (set.has(row.id)) set.delete(row.id); else set.add(row.id)
          a.render()
        } else if (row?.kind === "param" && row.p.type !== "action") {
          this.#fxSet(row.p, stepFx(row.p, this.fxValues()[row.p.key] ?? row.p.def, 1))
        }
      } else if ((dir === "left" || dir === "right") && row?.kind === "param" && row.p.type !== "action") {
        this.#fxSet(row.p, stepFx(row.p, this.fxValues()[row.p.key] ?? row.p.def, dir === "right" ? 1 : -1))
      }
      return true
    }
    return false
  }

  #menuAction(key, dir) {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (key === "pick" && dir === "ok") this.openTrackList({ assignLane: t.id })
    else if (key === "patternSeq") a.seqCtl.open()
    else if (key === "dropPattern" && dir === "ok") this.dropPatternOnSelected()
    else if (key === "fx") this.openTrackFx()
    else if (key === "length") this.#nudgeTrackLength(dir === "left" ? -1 : 1)
    else if (key === "mode") this.#toggleMode()
    else if (key === "monitor") this.#toggleMonitor()
    else if (key === "mute") {
      t.mute = !t.mute
      if (t.mute) t.solo = false
      a.loopEngine.refreshGains()
      a.toast(`MUTE ${t.mute ? "ON" : "OFF"}`)
      a.persistLoop?.()
      a.render()
    } else if (key === "solo") {
      t.solo = !t.solo
      if (t.solo) t.mute = false
      a.loopEngine.refreshGains()
      a.toast(`SOLO ${t.solo ? "ON" : "OFF"}`)
      a.persistLoop?.()
      a.render()
    } else if (key === "save" && dir === "ok") {
      const entry = a.loopEngine.saveLaneToLibrary(t.id)
      a.toast(entry ? `SAVED ${entry.name}` : "SAVE FAILED")
      a.persistLoop?.()
      a.render()
    } else if (key === "replace" && dir === "ok") this.#beginReplace(t.id)
    else if (key === "mixer" && dir === "ok") a.mixer.open("loop")
    else if (key === "options" && dir === "ok") {
      a.screen = "loop-options"
      a.loopOptIndex = 0
      a.render()
    } else if (key === "trackList" && dir === "ok") this.openTrackList()
    else if (key === "addLane" && dir === "ok") {
      a.loopEngine.addLane()
      a.toast(`LANE ${a.loopEngine.selected}`)
      a.persistLoop?.()
      a.screen = "loop-tracks"
      a.render()
    } else if (key === "delLane" && dir === "ok") this.askDeleteLane("loop-menu")
    else if (key === "clearAudio" && dir === "ok") this.#askClear()
    else if (key === "unassign" && dir === "ok") this.#askUnassign()
  }

  dropPatternOnSelected() {
    const a = this.app
    const letter = a.stepSeq?.seq?.current || "A"
    const pattern = a.stepSeq?.seq?.patterns?.[letter]
    const lane = a.loopEngine.dropPatternOnLane(a.loopEngine.selected, pattern, { letter })
    if (!lane) {
      a.toast("DROP FAILED")
      return
    }
    a.toast(`PATTERN ${letter} → L${lane.id}`)
    a.persistLoop?.()
    a.screen = "loop-tracks"
    a.render()
  }

  nudgeKnob(which, delta) {
    const a = this.app
    if (a.screen === "loop-tracks" || a.screen === "loop-menu") {
      const t = a.loopEngine.selectedTrack
      if (!t?.assigned) return true
      a.loopEngine.ensureGraph()
      if (which === "m1") {
        a.loopEngine.setTrackLevel(t.id, Math.min(1, Math.max(0, (t.level ?? 1) + delta)))
        a.toast(`TRK ${t.id} LVL ${Math.round(a.loopEngine.selectedTrack.level * 100)}%`)
        a.persistLoop?.()
        a.render()
        return true
      }
      if (which === "m2") {
        a.loopEngine.setTrackPan(t.id, Math.min(1, Math.max(-1, (t.pan ?? 0) + delta * 2)))
        a.toast(`TRK ${t.id} PAN ${Math.round(a.loopEngine.selectedTrack.pan * 100)}`)
        a.persistLoop?.()
        a.render()
        return true
      }
      return false
    }
    if (a.screen === "loop-options") {
      const key = OPTION_ROWS[a.loopOptIndex || 0]
      if (which === "m1" && (key === "metroLevel" || key === "tempo")) {
        this.#nudgeOption(delta > 0 ? 1 : -1)
        return true
      }
      return false
    }
    if (a.screen === "loop-fx") {
      const rows = this.fxRows()
      const knobs = knobParamsAt(rows, a.loopFxIndex || 0)
      const p = knobs[which === "m1" ? 0 : which === "m2" ? 1 : 2]
      if (!p) return which !== "m3"
      this.#fxSet(p, nudgeFx(p, this.fxValues()[p.key] ?? p.def, delta))
      return true
    }
    return false
  }

  back() {
    const a = this.app
    if (a.screen === "track-list") {
      this.#stopPreview()
      a.trackListAssignLane = null
      a.screen = "loop-tracks"
      a.render()
      return true
    }
    if (a.screen === "loop-fx") {
      a.screen = "loop-menu"
      a.render()
      return true
    }
    if (a.screen === "loop-menu" || a.screen === "loop-options") {
      a.screen = "loop-tracks"
      a.render()
      return true
    }
    if (a.screen === "loop-tracks") {
      a.screen = "menu"
      a.render()
      return true
    }
    return false
  }

  stateExtras() {
    const a = this.app
    const le = a.loopEngine
    const timelineBars = le.timelineBars()
    const timelineSec = le.timelineSec()
    return {
      loop: {
        lengthBars: le.lengthBars,
        countInBars: a.project.loop?.countInBars ?? 1,
        quantize: le.quantize || a.project.loop?.quantize || "1/16",
        playDuringRec: le.playDuringRec || a.project.loop?.playDuringRec || "all",
        timelineBars,
        timelineSec,
        beatsPerBar: 4,
        playheadSec: a.transport.playheadSecInLoop(timelineBars),
        selected: le.selected,
        tracks: le.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          assigned: !!t.assigned,
          empty: !t.assigned,
          dirty: !!t.dirty,
          armed: t.armed,
          mute: t.mute,
          solo: t.solo,
          monitor: t.monitor,
          mode: t.mode,
          level: t.level,
          pan: t.pan,
          offsetSec: t.offsetSec ?? 0,
          lengthBars: t.lengthBars,
          fx: t.fx,
          buffer: !!t.buffer,
          hasSeq: patternHasHits(t.pattern) || trackSeqHasHits(t.seq),
          hasClip: le.laneHasClip(t)
        }))
      },
      trackLibrary: le.library.map((e) => ({
        id: e.id,
        name: e.name,
        lengthBars: e.lengthBars,
        hasAudio: !!e.audio,
        hasSeq: patternHasHits(e.pattern) || trackSeqHasHits(e.seq)
      })),
      trackListIndex: a.trackListIndex || 0,
      trackListAssignLane: a.trackListAssignLane,
      trackListPreviewing: !!a.trackListPreviewing,
      loopFxIndex: a.loopFxIndex || 0,
      loopFxRows: a.screen === "loop-fx" ? this.fxRows() : [],
      loopMenuIndex: a.loopMenuIndex || 0,
      loopOptIndex: a.loopOptIndex || 0,
      seqCurrent: a.stepSeq?.seq?.current || "A",
      metroOn: a.metro.on,
      metroLevel: a.metro.level,
      metroAccent: a.metro.accent,
      countingIn: a.transport.countingIn,
      playhead: a.transport.playheadLabel()
    }
  }

  #toggleMode() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return
    t.mode = t.mode === "replace" ? "overdub" : "replace"
    a.toast(t.mode.toUpperCase())
    a.render()
  }

  #nudgeTrackLength(dir) {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return
    const opts = LOOP_LENGTH_PRESETS
    const i = Math.max(0, opts.indexOf(t.lengthBars || a.loopEngine.lengthBars))
    const next = opts[(i + (dir > 0 ? 1 : opts.length - 1)) % opts.length]
    a.loopEngine.setTrackLengthBars(t.id, next)
    a.toast(`LANE ${t.id} ${next} BARS · SONG ${a.loopEngine.timelineBars()}B`)
    a.persistLoop?.()
    a.render()
  }

  #toggleMonitor() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return
    t.monitor = !t.monitor
    a.toast(`MONITOR ${t.monitor ? "ON" : "OFF"}`)
    a.persistLoop?.()
    a.render()
  }

  #toggleMuteSelected() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) { a.toast("EMPTY LANE"); return }
    t.mute = !t.mute
    if (t.mute) t.solo = false
    a.loopEngine.refreshGains()
    a.toast(`MUTE ${t.mute ? "ON" : "OFF"}`)
    a.persistLoop?.()
    a.render()
  }

  #toggleSoloSelected() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) { a.toast("EMPTY LANE"); return }
    t.solo = !t.solo
    if (t.solo) t.mute = false
    a.loopEngine.refreshGains()
    a.toast(`SOLO ${t.solo ? "ON" : "OFF"}`)
    a.persistLoop?.()
    a.render()
  }

  #askClear() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    a.confirmTitle = "CLEAR AUDIO?"
    a.confirmLines = [
      { text: t.name, tone: "green" },
      { text: "ERASES RECORDED AUDIO.", tone: "muted" },
      { text: "A CANCEL · D CLEAR", tone: "muted" }
    ]
    a.confirmAction = "clear-loop-track"
    a.confirmOkLabel = "CLEAR"
    a.confirmReturnScreen = "loop-menu"
    a.screen = "confirm"
    a.render()
  }

  #askUnassign() {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (t.dirty) {
      a.confirmTitle = "UNASSIGN LANE?"
      a.confirmLines = [
        { text: t.name, tone: "green" },
        { text: "DISCARD UNSAVED EDITS?", tone: "muted" },
        { text: "A CANCEL · D DISCARD", tone: "muted" }
      ]
      a.confirmAction = "unassign-lane-dirty"
      a.confirmOkLabel = "DISCARD"
      a.confirmReturnScreen = "loop-menu"
      a.screen = "confirm"
      a.render()
      return
    }
    a.loopEngine.clearLaneAssignment(t.id, { force: true })
    a.toast("LANE EMPTY")
    a.persistLoop?.()
    a.screen = "loop-tracks"
    a.render()
  }

  askDeleteLane(returnScreen = "loop-menu") {
    const a = this.app
    if (a.loopEngine.tracks.length <= 1) {
      a.toast("NEED 1 LANE")
      return
    }
    const t = a.loopEngine.selectedTrack
    a.confirmTitle = "DELETE LANE?"
    a.confirmLines = [
      { text: `LANE ${t.id}`, tone: "green" },
      { text: t.dirty ? "DISCARDS UNSAVED EDITS." : "REMOVES ARRANGEMENT ROW.", tone: "muted" },
      { text: "A CANCEL · D DELETE", tone: "muted" }
    ]
    a.confirmAction = "delete-lane"
    a.confirmOkLabel = "DELETE"
    a.confirmReturnScreen = returnScreen
    a.screen = "confirm"
    a.render()
  }

  #beginReplace(laneId) {
    const a = this.app
    const t = a.loopEngine.tracks.find((x) => x.id === laneId)
    if (t?.dirty) {
      a.confirmTitle = "REPLACE TRACK?"
      a.confirmLines = [
        { text: t.name, tone: "green" },
        { text: "DISCARD UNSAVED EDITS?", tone: "muted" },
        { text: "A CANCEL · D CONTINUE", tone: "muted" }
      ]
      a.confirmAction = "replace-lane-dirty"
      a.confirmOkLabel = "CONTINUE"
      a.confirmReturnScreen = "loop-menu"
      a._pendingReplaceLane = laneId
      a.screen = "confirm"
      a.render()
      return
    }
    this.openTrackList({ assignLane: laneId })
  }

  #newLibraryTrack() {
    const a = this.app
    const entry = a.loopEngine.createLibraryTrack()
    a.trackListIndex = a.loopEngine.library.length - 1
    a.toast(`NEW ${entry.name}`)
    a.persistLoop?.()
    a.render()
  }

  #askDeleteLibraryTrack() {
    const a = this.app
    const entry = a.loopEngine.library[a.trackListIndex || 0]
    if (!entry) { a.toast("NO TRACK"); return }
    a.confirmTitle = "DELETE TRACK?"
    a.confirmLines = [
      { text: entry.name, tone: "green" },
      { text: "CLEARS LANES USING IT.", tone: "muted" },
      { text: "A CANCEL · D DELETE", tone: "muted" }
    ]
    a.confirmAction = "delete-library-track"
    a.confirmOkLabel = "DELETE"
    a.confirmReturnScreen = "track-list"
    a._pendingDeleteLibraryId = entry.id
    a.screen = "confirm"
    a.render()
  }

  #selectLibraryTrack() {
    const a = this.app
    const entry = a.loopEngine.library[a.trackListIndex || 0]
    if (!entry) {
      a.toast("A NEW FIRST")
      return
    }
    const laneId = a.trackListAssignLane ?? a.loopEngine.selected
    this.#stopPreview()
    a.loopEngine.assignLibraryToLane(laneId, entry.id)
    a.loopEngine.select(laneId)
    a.toast(`${entry.name} → L${laneId}`)
    a.trackListAssignLane = null
    a.persistLoop?.()
    a.screen = "loop-tracks"
    a.render()
  }

  #togglePreview() {
    const a = this.app
    if (a.trackListPreviewing) {
      this.#stopPreview()
      a.toast("PREVIEW OFF")
      a.render()
      return
    }
    this.#startPreview()
  }

  #startPreview() {
    const a = this.app
    const entry = a.loopEngine.library[a.trackListIndex || 0]
    this.#stopPreview()
    if (!entry) return
    a.trackListPreviewing = true
    void a.ensureAudioRunningPublic?.().then(() => {
      if (!a.trackListPreviewing) return
      const origin = a.engine.now() + 0.05
      // Temporary assign onto a phantom: schedule seq via one-shot helper on app
      a.previewLibraryTrack?.(entry, origin)
      a.render()
    })
  }

  #stopPreview() {
    const a = this.app
    a.trackListPreviewing = false
    a.stopLibraryPreview?.()
  }

  clearSelected() {
    const a = this.app
    a.loopEngine.clear()
    a.toast("CLEARED")
    a.persistLoop?.()
    a.screen = "loop-tracks"
    a.render()
  }

  confirmDeleteLane() {
    const a = this.app
    a.loopEngine.removeLane(a.loopEngine.selected)
    a.toast("LANE DELETED")
    a.persistLoop?.()
    a.screen = "loop-tracks"
    a.render()
  }

  confirmUnassignDirty() {
    const a = this.app
    a.loopEngine.clearLaneAssignment(a.loopEngine.selected, { force: true })
    a.toast("LANE EMPTY")
    a.persistLoop?.()
    a.screen = "loop-tracks"
    a.render()
  }

  confirmReplaceDirty() {
    const a = this.app
    const laneId = a._pendingReplaceLane || a.loopEngine.selected
    a.loopEngine.clearLaneAssignment(laneId, { force: true })
    a._pendingReplaceLane = null
    this.openTrackList({ assignLane: laneId })
  }

  confirmDeleteLibraryTrack() {
    const a = this.app
    const id = a._pendingDeleteLibraryId
    a._pendingDeleteLibraryId = null
    if (id) a.loopEngine.deleteLibraryTrack(id)
    a.trackListIndex = Math.min(a.trackListIndex || 0, Math.max(0, a.loopEngine.library.length - 1))
    a.toast("TRACK DELETED")
    a.persistLoop?.()
    a.screen = "track-list"
    a.render()
  }

  #nudgeOption(dir) {
    const a = this.app
    const key = OPTION_ROWS[a.loopOptIndex || 0]
    if (key === "patternSeq") return
    const loop = a.project.loop || (a.project.loop = {})
    if (key === "length") {
      const opts = LOOP_LENGTH_PRESETS
      const i = Math.max(0, opts.indexOf(a.loopEngine.lengthBars))
      const next = opts[(i + (dir > 0 ? 1 : opts.length - 1)) % opts.length]
      a.loopEngine.applyDefaultLengthToEmpty(next)
      loop.lengthBars = next
      a.toast(`SONG ${next} BARS`)
    } else if (key === "countIn") {
      loop.countInBars = loop.countInBars ? 0 : 1
      a.toast(`COUNT-IN ${loop.countInBars}`)
    } else if (key === "quantize") {
      const cur = loop.quantize || a.loopEngine.quantize || "1/16"
      const i = Math.max(0, QUANTIZE_OPTS.indexOf(cur))
      const next = QUANTIZE_OPTS[(i + (dir > 0 ? 1 : QUANTIZE_OPTS.length - 1)) % QUANTIZE_OPTS.length]
      loop.quantize = next
      a.loopEngine.quantize = next
      a.toast(`QUANTIZE ${QUANTIZE_LABELS[next]}`)
    } else if (key === "playDuringRec") {
      this.#cyclePlayDuringRec(dir)
    } else if (key === "metroOn") {
      a.setMetroOn(!a.metro.on)
    } else if (key === "metroLevel") {
      a.metro.setLevel(a.metro.level + dir * 0.05)
      loop.metroLevel = a.metro.level
      a.toast(`METRO ${Math.round(a.metro.level * 100)}%`)
    } else if (key === "metroAccent") {
      a.metro.setAccent(!a.metro.accent)
      loop.metroAccent = a.metro.accent
      a.toast(`ACCENT ${a.metro.accent ? "ON" : "OFF"}`)
    } else if (key === "tempo") {
      a.transport.bpm = Math.min(240, Math.max(40, a.transport.bpm + dir * 1))
      a.project.bpm = a.transport.bpm
      a.toast(`BPM ${a.transport.bpm}`)
    }
    a.persistLoop?.()
    a.render()
  }

  #cyclePlayDuringRec(dir = 1) {
    const a = this.app
    const loop = a.project.loop || (a.project.loop = {})
    const opts = ["all", "monitored", "off"]
    const cur = loop.playDuringRec || a.loopEngine.playDuringRec || "all"
    const i = Math.max(0, opts.indexOf(cur))
    const next = opts[(i + (dir > 0 ? 1 : opts.length - 1)) % opts.length]
    loop.playDuringRec = next
    a.loopEngine.playDuringRec = next
    a.toast(`PLAY DURING REC ${next.toUpperCase()}`)
    a.persistLoop?.()
    a.render()
  }

  nudgeTrackOffsetBeat(dir) {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) { a.toast("EMPTY LANE"); return }
    const id = a.loopEngine.selected
    const sec = a.loopEngine.nudgeTrackOffset(id, dir > 0 ? 1 : -1)
    const bars = a.loopEngine.timelineBars()
    a.loopScrollFollow = true
    a.toast(`L${id} ${sec}s · ${bars}B`)
    a.persistLoop?.()
    a.render()
  }

  nudgeTrackOffsetSec(dir, step = 1) {
    const a = this.app
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return 0
    const id = a.loopEngine.selected
    const sec = a.loopEngine.nudgeTrackOffset(id, (dir > 0 ? 1 : -1) * step)
    a.loopScrollFollow = true
    a.loopTimelineDirty = true
    if (!a._loopOffsetUiRaf) {
      a._loopOffsetUiRaf = requestAnimationFrame(() => {
        a._loopOffsetUiRaf = null
        if (a.screen === "loop-tracks") a.render()
      })
    }
    return sec
  }

  finishTrackOffsetScrub() {
    const a = this.app
    if (!a.loopTimelineDirty) return
    a.loopTimelineDirty = false
    const t = a.loopEngine.selectedTrack
    if (!t?.assigned) return
    const bars = a.loopEngine.timelineBars()
    a.loopScrollFollow = true
    if (bars <= a.loopEngine.lengthBars && (t.offsetSec ?? 0) <= 0) a.loopScrollLeft = 0
    a.toast(`L${t.id} ${Math.round(t.offsetSec ?? 0)}s · ${bars}B`)
    a.persistLoop?.()
    a.render()
  }
}
