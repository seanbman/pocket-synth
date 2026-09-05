import {
  SEQ_PATTERNS, SEQ_LENGTHS, SEQ_LANES, defaultStep, sanitizeStep,
  trackSeqHasHits
} from "cassio/store"
import {
  addTrackPatternLane,
  defaultTrackPattern,
  removeTrackPatternLane,
  resizeTrackPattern,
  sanitizeTrackPattern,
  trackLaneSourceSignature,
  trackPatternHasHits,
  trackSeqToTrackPattern
} from "cassio/track_pattern"

export const SEQ_SCREENS = new Set(["sequencer", "step-edit"])
const PAGE = 16
const VISIBLE_LANES = 6

/** Screens 24–25: step sequencer grid + step edit. */
export class SeqController {
  constructor(app) {
    this.app = app
    this._raf = null
  }

  get seq() { return this.app.stepSeq.seq }

  #trackMode() {
    return this.app.seqTrackId != null
  }

  #track() {
    const id = this.app.seqTrackId ?? this.app.loopEngine.selected
    return this.app.loopEngine.tracks.find((track) => track.id === id)
  }

  #padSources() {
    return this.app.captureAllSequencePadSources?.() || []
  }

  #sourceName(index) {
    if (!this.#trackMode()) return this.app.padSoundName(index + 1)
    const source = this.#trackPattern().sources?.[index]
    return String(source?.name || source?.soundId || "EMPTY").toUpperCase()
  }

  /**
   * Track patterns own arbitrary sound lanes. Legacy single-lane track.seq and
   * fixed six-pad patterns are migrated once, with pad sounds captured by value.
   */
  #trackPattern() {
    const track = this.#track()
    if (!track) return defaultTrackPattern()

    const padSources = this.#padSources()
    let pattern = track.pattern
      ? sanitizeTrackPattern(track.pattern, { padSources })
      : null
    const legacyActive = track.seq?.enabled !== false && trackSeqHasHits(track.seq)

    if ((!pattern || !trackPatternHasHits(pattern)) && legacyActive) {
      const source = this.app.captureSequencePadSource?.(track.padSlot || 1) || null
      pattern = trackSeqToTrackPattern(track.seq, source)
    }
    if (!pattern) {
      const length = SEQ_LENGTHS.includes(track.seq?.length) ? track.seq.length : 16
      pattern = defaultTrackPattern(length)
      pattern.swing = track.seq?.swing ?? 0
      pattern.gate = track.seq?.gate ?? 0.5
    }

    track.pattern = pattern
    if (track.seq) track.seq.enabled = false
    return track.pattern
  }

  get pattern() {
    if (this.#trackMode()) return this.#trackPattern()
    return this.app.stepSeq.pattern
  }

  #cursor() {
    const a = this.app
    const pattern = this.pattern
    const laneMax = Math.max(0, (pattern.lanes?.length || 0) - 1)
    a.seqLane = Math.min(laneMax, Math.max(0, a.seqLane || 0))
    a.seqCursor = Math.min(pattern.length - 1, Math.max(0, a.seqCursor || 0))
    a.seqPage = Math.floor(a.seqCursor / PAGE)
    return { lane: a.seqLane, step: a.seqCursor, page: a.seqPage, header: !!a.seqHeader }
  }

  #step() {
    const { lane, step } = this.#cursor()
    return this.pattern.lanes?.[lane]?.[step] || defaultStep()
  }

  open(trackId = null) {
    const a = this.app
    // PATTERN SEQ entered from a track menu edits that track's independent,
    // arbitrary sound-lane pattern. Loop Options keeps the global A-D pad bank.
    const resolvedTrackId = trackId ?? (a.screen === "loop-menu" ? a.loopEngine.selected : null)
    a.seqTrackId = resolvedTrackId
    if (resolvedTrackId != null) {
      const track = a.loopEngine.tracks.find((item) => item.id === resolvedTrackId)
      if (!track?.assigned) {
        a.seqTrackId = null
        a.toast("EMPTY TRACK")
        return
      }
      a.loopEngine.select(resolvedTrackId)
      const pattern = this.#trackPattern()
      a.seqLane = Math.min(Math.max(0, a.seqLane || 0), Math.max(0, pattern.lanes.length - 1))
      a.toast(`${track.name || `L${resolvedTrackId}`} · ${pattern.lanes.length} SOUND LANES`)
    } else {
      a.seqLane = Math.min(SEQ_LANES - 1, Math.max(0, a.seqLane || 0))
      a.toast(`PATTERN ${this.seq.current} · 6 PAD LANES`)
    }
    a.seqCursor = a.seqCursor || 0
    a.seqHeader = false
    a.seqShiftMode = false
    a.screen = "sequencer"
    a.render()
  }

  openStepEdit() {
    const a = this.app
    if (a.screen !== "sequencer" || a.seqHeader) return
    if (!this.pattern.lanes?.length) {
      a.toast("PRESS A PAD TO ADD SOUND")
      return
    }
    a.seqShiftMode = false
    a.screen = "step-edit"
    a.toast("STEP EDIT")
    a.render()
  }

  /**
   * Global mode: pads select one of six pad lanes.
   * Track mode: a pad captures its current sound into a stable lane (if needed)
   * and inserts that sound at the current step.
   */
  selectLane(n) {
    const a = this.app
    const pad = Math.min(6, Math.max(1, Number(n) | 0))
    if (!this.#trackMode()) {
      a.seqLane = pad - 1
      a.seqHeader = false
      a.toast(`LANE ${a.seqLane + 1} · ${a.padSoundName(pad)}`)
      a.render()
      return
    }

    const source = a.captureSequencePadSource?.(pad)
    if (!source) {
      a.toast(`PAD ${pad} EMPTY`)
      return
    }

    const track = this.#track()
    let pattern = this.#trackPattern()
    const signature = trackLaneSourceSignature(source)
    let lane = pattern.sources.findIndex((item) => trackLaneSourceSignature(item) === signature)
    let added = false
    if (lane < 0) {
      const result = addTrackPatternLane(pattern, source)
      pattern = result.pattern
      lane = result.index
      track.pattern = pattern
      added = true
    }

    a.seqLane = lane
    a.seqHeader = false
    const stepIndex = Math.min(pattern.length - 1, Math.max(0, a.seqCursor || 0))
    const step = pattern.lanes[lane][stepIndex]
    step.on = true
    a.triggerSequenceLaneSource?.(pattern.sources[lane], {
      velocity: step.accent ? 1 : step.vel,
      gateSec: Math.max(0.02, (step.gate ?? pattern.gate ?? 0.5) * a.stepSeq.stepSec())
    })
    a.toast(`${added ? "ADDED" : "INSERT"} L${lane + 1} · ${this.#sourceName(lane)}`)
    this.#changed()
  }

  #changed({ rerender = true } = {}) {
    const a = this.app
    if (this.#trackMode()) {
      a.loopEngine.markDirty(a.seqTrackId)
      const pattern = this.#trackPattern()
      const track = this.#track()
      if (track && pattern) {
        const bars = Math.max(1, Math.ceil((pattern.length || 16) / 16))
        if ((track.lengthBars || 0) < bars) a.loopEngine.setTrackLengthBars(track.id, bars)
      }
      a.persistLoop?.()
    } else a.persistPublic?.()
    if (rerender) a.render()
  }

  softKey(key) {
    const a = this.app
    if (a.screen === "sequencer") {
      if (key === "a") this.#nextPage()
      if (key === "b") this.#cycleLength()
      if (key === "c") {
        a.seqShiftMode = !a.seqShiftMode
        a.seqHeader = false
        a.toast(a.seqShiftMode ? "SHIFT · ◀▶ MOVES LANE" : "SHIFT OFF")
        a.render()
      }
      if (key === "d") this.#askClearLane()
      return true
    }
    if (a.screen === "step-edit") {
      const step = this.#step()
      if (key === "a") {
        step.on = false
        a.toast("STEP OFF")
        a.screen = "sequencer"
        this.#changed()
      }
      if (key === "b") {
        step.accent = !step.accent
        if (step.accent) step.on = true
        a.toast(`ACCENT ${step.accent ? "ON" : "OFF"}`)
        this.#changed()
      }
      if (key === "c") {
        step.tie = !step.tie
        if (step.tie) step.on = true
        a.toast(`TIE ${step.tie ? "ON" : "OFF"}`)
        this.#changed()
      }
      if (key === "d") {
        a.screen = "sequencer"
        a.render()
      }
      return true
    }
    return false
  }

  nav(dir) {
    const a = this.app
    if (a.screen === "sequencer") {
      const pattern = this.pattern
      const cursor = this.#cursor()
      const laneCount = pattern.lanes?.length || 0
      if (a.seqShiftMode && (dir === "left" || dir === "right")) {
        this.#rotateLane(cursor.lane, dir === "right" ? 1 : -1)
        return true
      }
      if (dir === "up") {
        if (cursor.header || !laneCount) return true
        a.seqLane = Math.max(0, cursor.lane - 1)
        a.render()
        return true
      }
      if (dir === "down") {
        if (cursor.header) a.seqHeader = false
        else if (laneCount) a.seqLane = Math.min(laneCount - 1, cursor.lane + 1)
        a.render()
        return true
      }
      if (dir === "left" || dir === "right") {
        const delta = dir === "right" ? 1 : -1
        if (cursor.header) {
          if (this.#trackMode()) {
            a.toast(`TRK ${a.seqTrackId} · ${laneCount} SOUND LANES`)
            return true
          }
          this.#switchPattern(delta)
          return true
        }
        a.seqCursor = (cursor.step + delta + pattern.length) % pattern.length
        a.render()
        return true
      }
      if (dir === "ok") {
        if (cursor.header) {
          a.toast(`PATTERN ${this.seq.current} · ◀▶ SWITCH`)
          return true
        }
        if (a.seqShiftMode) {
          a.seqShiftMode = false
          a.render()
          return true
        }
        if (!laneCount) {
          a.toast("PRESS A PAD TO ADD SOUND")
          return true
        }
        const step = this.#step()
        step.on = !step.on
        if (!step.on) { step.accent = false; step.tie = false }
        this.#changed()
        return true
      }
      return true
    }
    if (a.screen === "step-edit") {
      const step = this.#step()
      if (dir === "left" || dir === "right") {
        const delta = dir === "right" ? 0.05 : -0.05
        step.shift = Math.round(Math.min(0.5, Math.max(-0.5, (step.shift || 0) + delta)) * 100) / 100
        a.toast(`SHIFT ${step.shift > 0 ? "+" : ""}${Math.round(step.shift * 100)}%`)
        this.#changed()
        return true
      }
      if (dir === "up" || dir === "down") {
        const pattern = this.pattern
        a.seqCursor = (a.seqCursor + (dir === "down" ? 1 : pattern.length - 1)) % pattern.length
        a.render()
        return true
      }
      if (dir === "ok") {
        a.screen = "sequencer"
        a.render()
        return true
      }
      return true
    }
    return false
  }

  nudgeKnob(which, delta) {
    const a = this.app
    const pattern = this.pattern
    if (a.screen === "sequencer") {
      if (which === "m1") {
        pattern.swing = Math.min(1, Math.max(0, pattern.swing + delta))
        a.toast(`SWING ${Math.round(pattern.swing * 100)}%`)
        this.#changed()
        return true
      }
      if (which === "m2") {
        pattern.gate = Math.min(1, Math.max(0.05, pattern.gate + delta))
        a.toast(`GATE ${Math.round(pattern.gate * 100)}%`)
        this.#changed()
        return true
      }
      return false
    }
    if (a.screen === "step-edit") {
      const step = this.#step()
      if (which === "m1") {
        step.vel = Math.min(1, Math.max(0, step.vel + delta))
        if (step.vel > 0.02) step.on = true
        a.toast(`VELOCITY ${Math.round(step.vel * 100)}%`)
        this.#changed()
        return true
      }
      if (which === "m2") {
        const cur = step.gate ?? pattern.gate
        step.gate = Math.min(1, Math.max(0.05, cur + delta))
        a.toast(`STEP GATE ${Math.round(step.gate * 100)}%`)
        this.#changed()
        return true
      }
      return false
    }
    return false
  }

  back() {
    const a = this.app
    if (a.screen === "step-edit") {
      a.screen = "sequencer"
      a.render()
      return true
    }
    if (a.screen === "sequencer") {
      if (a.seqShiftMode) {
        a.seqShiftMode = false
        a.render()
        return true
      }
      this.stopPlayheadLoop()
      a.seqTrackId = null
      a.screen = "loop-tracks"
      a.render()
      return true
    }
    return false
  }

  #nextPage() {
    const a = this.app
    const pattern = this.pattern
    const pages = Math.ceil(pattern.length / PAGE)
    if (pages <= 1) { a.toast("16 STEPS · 1 PAGE"); return }
    const cursor = this.#cursor()
    const nextPage = (cursor.page + 1) % pages
    a.seqCursor = nextPage * PAGE + (cursor.step % PAGE)
    a.toast(`PAGE ${nextPage + 1}/${pages}`)
    a.render()
  }

  #cycleLength() {
    const a = this.app
    const pattern = this.pattern
    const index = SEQ_LENGTHS.indexOf(pattern.length)
    const next = SEQ_LENGTHS[(index + 1) % SEQ_LENGTHS.length]
    if (this.#trackMode()) {
      this.#track().pattern = resizeTrackPattern(pattern, next)
    } else {
      for (let lane = 0; lane < SEQ_LANES; lane++) {
        const steps = pattern.lanes[lane]
        if (next > steps.length) {
          const src = steps.slice()
          while (steps.length < next) steps.push(sanitizeStep({ ...src[steps.length % src.length] }))
        } else {
          steps.length = next
        }
      }
      pattern.length = next
    }
    a.seqCursor = Math.min(a.seqCursor || 0, next - 1)
    a.toast(`${next} STEPS`)
    this.#changed()
  }

  #rotateLane(lane, dir) {
    const a = this.app
    const steps = this.pattern.lanes?.[lane]
    if (!steps?.length) {
      a.toast("NO SOUND LANE")
      return
    }
    if (dir > 0) steps.unshift(steps.pop())
    else steps.push(steps.shift())
    a.toast(`LANE ${lane + 1} ${dir > 0 ? "→" : "←"} 1 STEP`)
    this.#changed()
  }

  #switchPattern(dir) {
    const a = this.app
    const index = SEQ_PATTERNS.indexOf(this.seq.current)
    this.seq.current = SEQ_PATTERNS[(index + dir + SEQ_PATTERNS.length) % SEQ_PATTERNS.length]
    a.seqCursor = Math.min(a.seqCursor || 0, this.pattern.length - 1)
    a.toast(`PATTERN ${this.seq.current}`)
    this.#changed()
  }

  #askClearLane() {
    const a = this.app
    const lane = this.#cursor().lane
    if (this.#trackMode()) {
      const pattern = this.#trackPattern()
      if (!pattern.lanes.length) {
        a.toast("NO SOUND LANES")
        return
      }
      a.confirmTitle = "REMOVE SOUND LANE?"
      a.confirmLines = [
        { text: `LANE ${lane + 1} · ${this.#sourceName(lane)}`, tone: "green" },
        { text: `TRK ${a.seqTrackId} · REMOVES ALL STEPS`, tone: "muted" },
        { text: "A CANCEL · D REMOVE", tone: "muted" }
      ]
      a.confirmOkLabel = "REMOVE"
    } else {
      a.confirmTitle = "CLEAR LANE?"
      a.confirmLines = [
        { text: `LANE ${lane + 1} · ${a.padSoundName(lane + 1)}`, tone: "green" },
        { text: `PATTERN ${this.seq.current} · ALL STEPS OFF`, tone: "muted" },
        { text: "A CANCEL · D CLEAR", tone: "muted" }
      ]
      a.confirmOkLabel = "CLEAR"
    }
    a.confirmAction = "clear-seq-lane"
    a.confirmReturnScreen = "sequencer"
    a.screen = "confirm"
    a.render()
  }

  clearLaneConfirmed() {
    const a = this.app
    const pattern = this.pattern
    const lane = this.#cursor().lane
    if (this.#trackMode()) {
      this.#track().pattern = removeTrackPatternLane(pattern, lane)
      a.seqLane = Math.max(0, Math.min(lane, this.#track().pattern.lanes.length - 1))
      a.toast(`SOUND LANE ${lane + 1} REMOVED`)
    } else {
      pattern.lanes[lane] = Array.from({ length: pattern.length }, defaultStep)
      a.toast(`LANE ${lane + 1} CLEARED`)
    }
    a.screen = "sequencer"
    this.#changed()
  }

  /** Move the playhead column in place while playing (no full re-render). */
  startPlayheadLoop() {
    const a = this.app
    this._lastCol = null
    if (this._raf != null) return
    const tick = () => {
      this._raf = null
      if (a.screen !== "sequencer") return
      const playLen = this.#trackMode() ? this.#trackPattern()?.length : null
      const step = a.transport.playing ? a.stepSeq.playheadStep(playLen) : -1
      if (step >= 0 && a.transport.playing) {
        const playPage = Math.floor(step / PAGE)
        const viewPage = Math.floor((a.seqCursor || 0) / PAGE)
        if (playPage !== viewPage) {
          a.seqCursor = step
          a.render()
          this._raf = requestAnimationFrame(tick)
          return
        }
      }
      const page = Math.floor((a.seqCursor || 0) / PAGE)
      const col = step >= 0 && Math.floor(step / PAGE) === page ? step % PAGE : -1
      if (col !== this._lastCol) {
        this._lastCol = col
        a.vscreen.querySelectorAll("[data-seq-col]").forEach((element) => {
          element.classList.toggle("playhead", Number(element.dataset.seqCol) === col)
        })
        const playhead = a.vscreen.querySelector("[data-seq-playhead]")
        if (playhead) playhead.textContent = step >= 0 ? `STEP ${step + 1}` : a.transport.playing ? "" : "STOPPED"
      }
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }

  stopPlayheadLoop() {
    if (this._raf != null) cancelAnimationFrame(this._raf)
    this._raf = null
  }

  stateExtras() {
    const a = this.app
    if (!SEQ_SCREENS.has(a.screen)) return {}
    const cursor = this.#cursor()
    const pattern = this.pattern
    const trackMode = this.#trackMode()
    const playLen = trackMode ? this.#trackPattern()?.length : null
    const laneNames = trackMode
      ? pattern.sources.map((source) => String(source?.name || source?.soundId || "EMPTY").toUpperCase())
      : Array.from({ length: SEQ_LANES }, (_, i) => a.padSoundName(i + 1))
    const laneCount = pattern.lanes?.length || 0
    return {
      seq: {
        current: trackMode ? `TRK ${a.seqTrackId}` : this.seq.current,
        length: pattern.length,
        swing: pattern.swing,
        gate: pattern.gate,
        lanes: pattern.lanes
      },
      seqTrackId: trackMode ? a.seqTrackId : null,
      seqTrackName: trackMode ? this.#track()?.name : null,
      seqLane: cursor.lane,
      seqLaneCount: laneCount,
      seqLaneOffset: trackMode ? Math.floor(cursor.lane / VISIBLE_LANES) * VISIBLE_LANES : 0,
      seqCursor: cursor.step,
      seqPage: cursor.page,
      seqHeader: trackMode ? false : cursor.header,
      seqShiftMode: !!a.seqShiftMode,
      seqLaneNames: laneNames,
      seqStep: laneCount ? this.#step() : defaultStep(),
      seqPlayhead: a.transport.playing ? a.stepSeq.playheadStep(playLen) : -1
    }
  }
}
