import {
  SEQ_PATTERNS, SEQ_LENGTHS, SEQ_LANES, defaultStep, sanitizeStep,
  defaultTrackSeq, sanitizeTrackSeq
} from "cassio/store"

export const SEQ_SCREENS = new Set(["sequencer", "step-edit"])
const PAGE = 16

/** Screens 24–25: step sequencer grid + step edit. Lanes = pads 1–6. */
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
    return this.app.loopEngine.tracks.find((t) => t.id === id)
  }

  #trackSeq() {
    const track = this.#track()
    if (!track) return defaultTrackSeq()
    if (!track.seq) track.seq = defaultTrackSeq()
    track.seq = sanitizeTrackSeq(track.seq)
    return track.seq
  }

  get pattern() {
    if (this.#trackMode()) {
      const seq = this.#trackSeq()
      const length = seq.length || 16
      const emptyLane = () => Array.from({ length }, () => defaultStep())
      const padIdx = Math.min(SEQ_LANES - 1, Math.max(0, (this.#track()?.padSlot || 1) - 1))
      const lanes = Array.from({ length: SEQ_LANES }, (_, i) =>
        i === padIdx ? seq.steps : emptyLane()
      )
      return { length, swing: seq.swing ?? 0, gate: seq.gate ?? 0.5, lanes }
    }
    return this.app.stepSeq.pattern
  }

  #cursor() {
    const a = this.app
    const p = this.pattern
    if (this.#trackMode()) {
      const t = this.#track()
      a.seqLane = Math.min(SEQ_LANES - 1, Math.max(0, (t?.padSlot || a.seqTrackId || 1) - 1))
    }
    a.seqLane = Math.min(SEQ_LANES - 1, Math.max(0, a.seqLane || 0))
    a.seqCursor = Math.min(p.length - 1, Math.max(0, a.seqCursor || 0))
    a.seqPage = Math.floor(a.seqCursor / PAGE)
    return { lane: a.seqLane, step: a.seqCursor, page: a.seqPage, header: !!a.seqHeader }
  }

  #step() {
    const { lane, step } = this.#cursor()
    if (this.#trackMode()) return this.#trackSeq().steps[step]
    return this.pattern.lanes[lane][step]
  }

  open(trackId = null) {
    const a = this.app
    // PATTERN SEQ entered from a track's menu edits that track's independent
    // sequence. Loop Options still opens the shared/global A-D pattern bank.
    const resolvedTrackId = trackId ?? (a.screen === "loop-menu" ? a.loopEngine.selected : null)
    a.seqTrackId = resolvedTrackId
    if (resolvedTrackId != null) {
      const t = a.loopEngine.tracks.find((x) => x.id === resolvedTrackId)
      if (!t?.assigned) {
        a.seqTrackId = null
        a.toast("EMPTY LANE")
        return
      }
      a.loopEngine.select(resolvedTrackId)
      this.#trackSeq()
      a.seqLane = Math.min(SEQ_LANES - 1, Math.max(0, (t.padSlot || 1) - 1))
      a.toast(`${t.name || `L${resolvedTrackId}`} STEP SEQ`)
    } else {
      a.seqLane = a.seqLane || 0
      a.toast(`PATTERN ${this.seq.current} · 6 LANES`)
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
    a.seqShiftMode = false
    a.screen = "step-edit"
    a.toast("STEP EDIT")
    a.render()
  }

  selectLane(n) {
    const a = this.app
    if (this.#trackMode()) {
      a.toast(`TRK ${a.seqTrackId} · ${a.padSoundName(a.seqTrackId)}`)
      a.render()
      return
    }
    a.seqLane = Math.min(SEQ_LANES - 1, Math.max(0, (n | 0) - 1))
    a.seqHeader = false
    a.toast(`LANE ${a.seqLane + 1} · ${a.padSoundName(a.seqLane + 1)}`)
    a.render()
  }

  #changed({ rerender = true } = {}) {
    const a = this.app
    if (this.#trackMode()) {
      a.loopEngine.markDirty(a.seqTrackId)
      const seq = this.#trackSeq()
      const t = this.#track()
      if (t && seq) {
        const bars = Math.max(1, Math.ceil((seq.length || 16) / 16))
        if ((t.lengthBars || 0) < bars) a.loopEngine.setTrackLengthBars(t.id, bars)
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
      const st = this.#step()
      if (key === "a") {
        st.on = false
        a.toast("STEP OFF")
        a.screen = "sequencer"
        this.#changed()
      }
      if (key === "b") {
        st.accent = !st.accent
        if (st.accent) st.on = true
        a.toast(`ACCENT ${st.accent ? "ON" : "OFF"}`)
        this.#changed()
      }
      if (key === "c") {
        st.tie = !st.tie
        if (st.tie) st.on = true
        a.toast(`TIE ${st.tie ? "ON" : "OFF"}`)
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
      const p = this.pattern
      const c = this.#cursor()
      if (a.seqShiftMode && (dir === "left" || dir === "right")) {
        this.#rotateLane(c.lane, dir === "right" ? 1 : -1)
        return true
      }
      if (dir === "up") {
        if (c.header) return true
        a.seqLane = Math.min(SEQ_LANES - 1, Math.max(0, c.lane - 1))
        a.render()
        return true
      }
      if (dir === "down") {
        if (c.header) a.seqHeader = false
        else a.seqLane = Math.min(SEQ_LANES - 1, c.lane + 1)
        a.render()
        return true
      }
      if (dir === "left" || dir === "right") {
        const d = dir === "right" ? 1 : -1
        if (c.header) {
          if (this.#trackMode()) {
            a.toast(`TRK ${a.seqTrackId} STEP SEQ`)
            return true
          }
          this.#switchPattern(d)
          return true
        }
        a.seqCursor = (c.step + d + p.length) % p.length
        a.render()
        return true
      }
      if (dir === "ok") {
        if (c.header) {
          a.toast(`PATTERN ${this.seq.current} · ◀▶ SWITCH`)
          return true
        }
        if (a.seqShiftMode) {
          a.seqShiftMode = false
          a.render()
          return true
        }
        const st = this.#step()
        st.on = !st.on
        if (!st.on) { st.accent = false; st.tie = false }
        this.#changed()
        return true
      }
      return true
    }
    if (a.screen === "step-edit") {
      const st = this.#step()
      if (dir === "left" || dir === "right") {
        const d = dir === "right" ? 0.05 : -0.05
        st.shift = Math.round(Math.min(0.5, Math.max(-0.5, (st.shift || 0) + d)) * 100) / 100
        a.toast(`SHIFT ${st.shift > 0 ? "+" : ""}${Math.round(st.shift * 100)}%`)
        this.#changed()
        return true
      }
      if (dir === "up" || dir === "down") {
        const p = this.pattern
        a.seqCursor = (a.seqCursor + (dir === "down" ? 1 : p.length - 1)) % p.length
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
    const p = this.pattern
    const seq = this.#trackMode() ? this.#trackSeq() : null
    if (a.screen === "sequencer") {
      if (which === "m1") {
        const swing = Math.min(1, Math.max(0, (seq?.swing ?? p.swing) + delta))
        if (seq) seq.swing = swing
        else p.swing = swing
        a.toast(`SWING ${Math.round(swing * 100)}%`)
        this.#changed()
        return true
      }
      if (which === "m2") {
        const gate = Math.min(1, Math.max(0.05, (seq?.gate ?? p.gate) + delta))
        if (seq) seq.gate = gate
        else p.gate = gate
        a.toast(`GATE ${Math.round(gate * 100)}%`)
        this.#changed()
        return true
      }
      return false // M3 → master
    }
    if (a.screen === "step-edit") {
      const st = this.#step()
      if (which === "m1") {
        st.vel = Math.min(1, Math.max(0, st.vel + delta))
        if (st.vel > 0.02) st.on = true
        a.toast(`VELOCITY ${Math.round(st.vel * 100)}%`)
        this.#changed()
        return true
      }
      if (which === "m2") {
        const cur = st.gate ?? p.gate
        st.gate = Math.min(1, Math.max(0.05, cur + delta))
        a.toast(`STEP GATE ${Math.round(st.gate * 100)}%`)
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
    const p = this.pattern
    const pages = Math.ceil(p.length / PAGE)
    if (pages <= 1) { a.toast("16 STEPS · 1 PAGE"); return }
    const c = this.#cursor()
    const nextPage = (c.page + 1) % pages
    a.seqCursor = nextPage * PAGE + (c.step % PAGE)
    a.toast(`PAGE ${nextPage + 1}/${pages}`)
    a.render()
  }

  #cycleLength() {
    const a = this.app
    const p = this.pattern
    const i = SEQ_LENGTHS.indexOf(p.length)
    const next = SEQ_LENGTHS[(i + 1) % SEQ_LENGTHS.length]
    if (this.#trackMode()) {
      const seq = this.#trackSeq()
      if (!seq) return
      if (next > seq.steps.length) {
        const src = seq.steps.slice()
        while (seq.steps.length < next) seq.steps.push(sanitizeStep({ ...src[seq.steps.length % src.length] }))
      } else {
        seq.steps.length = next
      }
      seq.length = next
    } else {
      for (let l = 0; l < SEQ_LANES; l++) {
        const lane = p.lanes[l]
        if (next > lane.length) {
          const src = lane.slice()
          while (lane.length < next) lane.push(sanitizeStep({ ...src[lane.length % src.length] }))
        } else {
          lane.length = next
        }
      }
      p.length = next
    }
    a.seqCursor = Math.min(a.seqCursor || 0, next - 1)
    a.toast(`${next} STEPS`)
    this.#changed()
  }

  #rotateLane(lane, dir) {
    const a = this.app
    if (this.#trackMode()) {
      const seq = this.#trackSeq()
      if (!seq || lane !== a.seqTrackId - 1) return
      const arr = seq.steps
      if (dir > 0) arr.unshift(arr.pop())
      else arr.push(arr.shift())
      a.toast(`TRK ${a.seqTrackId} ${dir > 0 ? "→" : "←"} 1 STEP`)
      this.#changed()
      return
    }
    const p = this.pattern
    const arr = p.lanes[lane]
    if (dir > 0) arr.unshift(arr.pop())
    else arr.push(arr.shift())
    a.toast(`LANE ${lane + 1} ${dir > 0 ? "→" : "←"} 1 STEP`)
    this.#changed()
  }

  #switchPattern(dir) {
    const a = this.app
    const i = SEQ_PATTERNS.indexOf(this.seq.current)
    this.seq.current = SEQ_PATTERNS[(i + dir + SEQ_PATTERNS.length) % SEQ_PATTERNS.length]
    a.seqCursor = Math.min(a.seqCursor || 0, this.pattern.length - 1)
    a.toast(`PATTERN ${this.seq.current}`)
    this.#changed()
  }

  #askClearLane() {
    const a = this.app
    const lane = this.#cursor().lane
    a.confirmTitle = "CLEAR LANE?"
    a.confirmLines = [
      { text: `LANE ${lane + 1} · ${a.padSoundName(lane + 1)}`, tone: "green" },
      { text: `PATTERN ${this.seq.current} · ALL STEPS OFF`, tone: "muted" },
      { text: "A CANCEL · D CLEAR", tone: "muted" }
    ]
    a.confirmAction = "clear-seq-lane"
    a.confirmOkLabel = "CLEAR"
    a.confirmReturnScreen = "sequencer"
    a.screen = "confirm"
    a.render()
  }

  clearLaneConfirmed() {
    const a = this.app
    const p = this.pattern
    const lane = this.#cursor().lane
    if (this.#trackMode()) {
      const seq = this.#trackSeq()
      if (seq) seq.steps = Array.from({ length: p.length }, defaultStep)
      a.toast(`TRK ${a.seqTrackId} CLEARED`)
    } else {
      p.lanes[lane] = Array.from({ length: p.length }, defaultStep)
      a.toast(`LANE ${lane + 1} CLEARED`)
    }
    a.screen = "sequencer"
    this.#changed()
  }

  /** Move the playhead column in place while playing (no full re-render). */
  startPlayheadLoop() {
    const a = this.app
    this._lastCol = null // DOM was just re-rendered; re-apply on next frame
    if (this._raf != null) return
    const tick = () => {
      this._raf = null
      if (a.screen !== "sequencer") return
      const playLen = this.#trackMode() ? this.#trackSeq()?.length : null
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
        a.vscreen.querySelectorAll("[data-seq-col]").forEach((el) => {
          el.classList.toggle("playhead", Number(el.dataset.seqCol) === col)
        })
        const ph = a.vscreen.querySelector("[data-seq-playhead]")
        if (ph) ph.textContent = step >= 0 ? `STEP ${step + 1}` : a.transport.playing ? "" : "STOPPED"
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
    const c = this.#cursor()
    const p = this.pattern
    const trackMode = this.#trackMode()
    const playLen = trackMode ? this.#trackSeq()?.length : null
    return {
      seq: {
        current: trackMode ? `TRK ${a.seqTrackId}` : this.seq.current,
        length: p.length,
        swing: p.swing,
        gate: p.gate,
        lanes: p.lanes
      },
      seqTrackId: trackMode ? a.seqTrackId : null,
      seqTrackName: trackMode ? a.padSoundName(a.seqTrackId) : null,
      seqLane: c.lane,
      seqCursor: c.step,
      seqPage: c.page,
      seqHeader: trackMode ? false : c.header,
      seqShiftMode: !!a.seqShiftMode,
      seqLaneNames: Array.from({ length: SEQ_LANES }, (_, i) => a.padSoundName(i + 1)),
      seqStep: this.#step(),
      seqPlayhead: a.transport.playing ? a.stepSeq.playheadStep(playLen) : -1
    }
  }
}
