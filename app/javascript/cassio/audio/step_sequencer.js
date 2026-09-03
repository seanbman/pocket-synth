import { sanitizeSeq, sanitizePattern, SEQ_LANES, patternHasHits } from "cassio/store"

/**
 * Six-lane step sequencer (Screens 24–25) driven by the Transport clock.
 * Arrangement PLAY schedules each lane's baked pattern (working copy of A–D).
 */
export class StepSequencer {
  constructor(transport, trigger, { trackProvider = null } = {}) {
    this.transport = transport
    this.trigger = trigger
    this.trackProvider = trackProvider
    this.seq = sanitizeSeq(null)
    this.enabled = true
    this.running = false
    this._origin = 0
    this._next = 0
    this._trackNext = new Map()
    this._timer = null
    this._scheduled = []
    this._mode = "global"
    this._trackId = null
    this.onStep = null
  }

  get pattern() {
    return this.seq.patterns[this.seq.current] || this.seq.patterns.A
  }

  applyState(seq) {
    this.seq = sanitizeSeq(seq)
  }

  serialize() {
    return this.seq
  }

  stepSec() {
    return this.transport.beatSec() / 4
  }

  #stepTimeFrom(origin, absIndex, step, swing = 0) {
    const s = this.stepSec()
    let t = origin + absIndex * s
    if (absIndex % 2 === 1) t += swing * s * 0.5
    if (step?.shift) t += step.shift * s
    return t
  }

  #stepTime(absIndex, step, swing = 0) {
    return this.#stepTimeFrom(this._origin, absIndex, step, swing)
  }

  /** @param {"global"|"track"|"arrangement"} mode */
  start(origin, { mode = "global", trackId = null } = {}) {
    this.stop()
    if (!this.enabled) return
    this._mode = mode
    this._trackId = trackId
    this.running = true
    this._origin = origin ?? this.transport.now()
    this._next = 0
    this._trackNext.clear()
    this.#arm()
  }

  resync(origin) {
    if (!this.running) return
    this.start(origin ?? this.transport.now(), { mode: this._mode, trackId: this._trackId })
  }

  stop() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    for (const id of this._scheduled) clearTimeout(id)
    this._scheduled = []
    this.running = false
    this._trackNext.clear()
  }

  playheadStep(length = null) {
    if (!this.running || !this.transport.playing) return -1
    const elapsed = this.transport.now() - this._origin
    if (elapsed < 0) return -1
    const idx = Math.floor(elapsed / this.stepSec())
    const len = length ?? this.pattern.length
    return idx % len
  }

  #armTrackPattern(track) {
    if (track.assigned === false) return false
    const seq = track.seq
    if (!seq?.enabled || track.mute) return false
    const steps = seq.steps || []
    if (!steps.some((s) => s?.on)) return false

    const lookAhead = 0.25
    const now = this.transport.now()
    const s = this.stepSec()
    const len = seq.length || steps.length || 16
    let next = this._trackNext.get(track.id) ?? 0
    const padId = Math.min(6, Math.max(1, track.padSlot || ((track.id - 1) % 6) + 1))
    const origin = this._origin + (Number(track.offsetSec) || 0)

    while (origin + next * s < now + lookAhead) {
      const abs = next
      const i = abs % len
      const step = steps[i]
      if (step?.on) {
        const prev = steps[(i - 1 + len) % len]
        if (!(prev?.on && prev.tie && i !== 0)) {
          const when = this.#stepTimeFrom(origin, abs, step, seq.swing ?? 0)
          let gateSteps = 1
          let k = i
          while (steps[k]?.tie && gateSteps < len) {
            k = (k + 1) % len
            if (!steps[k]?.on) break
            gateSteps++
          }
          const g = step.gate ?? seq.gate ?? 0.5
          const gateSec = Math.max(0.02, (gateSteps - 1 + Math.max(0.05, g)) * s)
          const velocity = step.accent ? 1 : step.vel
          this.#at(when, () => {
            if (!this.running) return
            this.trigger?.(padId, { when, velocity, gateSec, step: i, accent: !!step.accent, fromSeq: true })
          })
        }
      }
      next++
    }
    this._trackNext.set(track.id, next)
    return true
  }

  #armBakedPattern(track) {
    if (track.assigned === false || track.mute) return false
    const p = track.pattern ? sanitizePattern(track.pattern) : null
    if (!patternHasHits(p)) return false

    const lookAhead = 0.25
    const now = this.transport.now()
    const s = this.stepSec()
    const key = `pat:${track.id}`
    let next = this._trackNext.get(key) ?? 0
    const origin = this._origin + (Number(track.offsetSec) || 0)

    while (origin + next * s < now + lookAhead) {
      const abs = next
      const i = abs % p.length
      for (let lane = 0; lane < SEQ_LANES; lane++) {
        const step = p.lanes[lane][i]
        if (!step?.on) continue
        const prev = p.lanes[lane][(i - 1 + p.length) % p.length]
        if (prev?.on && prev.tie && i !== 0) continue
        const when = this.#stepTimeFrom(origin, abs, step, p.swing)
        let gateSteps = 1
        let k = i
        while (p.lanes[lane][k]?.tie && gateSteps < p.length) {
          k = (k + 1) % p.length
          if (!p.lanes[lane][k]?.on) break
          gateSteps++
        }
        const g = step.gate ?? p.gate
        const gateSec = Math.max(0.02, (gateSteps - 1 + Math.max(0.05, g)) * s)
        const velocity = step.accent ? 1 : step.vel
        this.#at(when, () => {
          if (!this.running) return
          this.trigger?.(lane + 1, { when, velocity, gateSec, step: i, accent: !!step.accent, fromSeq: true })
        })
      }
      next++
    }
    this._trackNext.set(key, next)
    return true
  }

  #armGlobalPattern() {
    const lookAhead = 0.25
    const now = this.transport.now()
    const p = this.pattern
    const s = this.stepSec()
    while (this._origin + this._next * s < now + lookAhead) {
      const abs = this._next
      const i = abs % p.length
      const hits = []
      for (let lane = 0; lane < SEQ_LANES; lane++) {
        const step = p.lanes[lane][i]
        if (!step?.on) continue
        const prev = p.lanes[lane][(i - 1 + p.length) % p.length]
        if (prev?.on && prev.tie && i !== 0) continue
        const when = this.#stepTime(abs, step, p.swing)
        let gateSteps = 1
        let k = i
        while (p.lanes[lane][k]?.tie && gateSteps < p.length) {
          k = (k + 1) % p.length
          if (!p.lanes[lane][k]?.on) break
          gateSteps++
        }
        const g = step.gate ?? p.gate
        const gateSec = Math.max(0.02, (gateSteps - 1 + Math.max(0.05, g)) * s)
        const velocity = step.accent ? 1 : step.vel
        hits.push(lane)
        this.#at(when, () => {
          if (!this.running) return
          this.trigger?.(lane + 1, { when, velocity, gateSec, step: i, accent: !!step.accent, fromSeq: true })
        })
      }
      if (hits.length && this.onStep) {
        const when = this.#stepTime(abs, null, p.swing)
        this.#at(when, () => { if (this.running) this.onStep?.(i, hits) })
      }
      this._next++
    }
  }

  #arm() {
    if (!this.running || !this.transport.playing) { this.running = false; return }
    const tracks = this.trackProvider?.() || []
    if (this._mode === "arrangement") {
      for (const track of tracks) {
        if (!this.#armBakedPattern(track)) this.#armTrackPattern(track)
      }
    } else if (this._mode === "track" && this._trackId != null) {
      const track = tracks.find((t) => t.id === this._trackId)
      if (track) this.#armTrackPattern(track)
    } else {
      this.#armGlobalPattern()
    }
    this._timer = setTimeout(() => this.#arm(), 50)
  }

  #at(when, fn) {
    const delay = Math.max(0, (when - this.transport.now()) * 1000 - 40)
    const id = setTimeout(fn, delay)
    this._scheduled.push(id)
  }
}
