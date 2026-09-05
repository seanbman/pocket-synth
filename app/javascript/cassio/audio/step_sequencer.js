import { sanitizeSeq, SEQ_LANES } from "cassio/store"
import { sanitizeTrackPattern, trackPatternHasHits } from "cassio/track_pattern"

/**
 * Step sequencer driven by the Transport clock. Global patterns retain six pad
 * lanes; track-owned patterns may contain any number of captured sound lanes.
 */
export class StepSequencer {
  constructor(transport, trigger, { trackProvider = null, masterSecProvider = null } = {}) {
    this.transport = transport
    this.trigger = trigger
    this.trackProvider = trackProvider
    this.masterSecProvider = masterSecProvider
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

  #masterSec() {
    const n = Number(this.masterSecProvider?.())
    if (n > 0) return n
    return this.transport.loopSec(4)
  }

  #trackLoopSec(track) {
    const bars = track.lengthBars || 4
    return this.transport.loopSec(bars)
  }

  #firstFutureStep(origin, now = this.transport.now()) {
    const s = this.stepSec()
    if (!(s > 0)) return 0
    return Math.max(0, Math.ceil((now - origin) / s - 1e-9))
  }

  /** Local sec inside a track clip at absolute time `when`; null outside it. */
  #clipLocalAt(track, when) {
    const masterLoop = this.#masterSec()
    const trackLoop = this.#trackLoopSec(track)
    if (!(masterLoop > 0) || !(trackLoop > 0)) return null
    const offset = (((Number(track.offsetSec) || 0) % masterLoop) + masterLoop) % masterLoop
    const elapsed = Math.max(0, when - this._origin)
    const masterPhase = elapsed % masterLoop
    const local = (masterPhase - offset + masterLoop) % masterLoop
    if (local >= trackLoop - 1e-4) return null
    return { local, trackLoop, offset, masterLoop }
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
    this._next = this.#firstFutureStep(this._origin)
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

  /** Legacy single-source track.seq playback. */
  #armTrackPattern(track) {
    if (track.assigned === false) return false
    const seq = track.seq
    if (!seq?.enabled || track.mute) return false
    const steps = seq.steps || []
    if (!steps.some((step) => step?.on)) return false

    const lookAhead = 0.25
    const now = this.transport.now()
    const s = this.stepSec()
    const len = seq.length || steps.length || 16
    const padId = Math.min(6, Math.max(1, track.padSlot || ((track.id - 1) % 6) + 1))
    const gateClip = this._mode === "arrangement"
    const scheduleOrigin = gateClip
      ? this._origin
      : this._origin + (Number(track.offsetSec) || 0)
    let next = this._trackNext.get(track.id)
    if (next == null) next = this.#firstFutureStep(scheduleOrigin, now)

    if (!gateClip) {
      const origin = scheduleOrigin
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

    while (this._origin + next * s < now + lookAhead) {
      const when = this._origin + next * s
      const clip = this.#clipLocalAt(track, when)
      if (clip) {
        const i = Math.floor(clip.local / s + 1e-9) % len
        const step = steps[i]
        if (step?.on) {
          const prev = steps[(i - 1 + len) % len]
          if (!(prev?.on && prev.tie && i !== 0)) {
            const hitWhen = this.#stepTimeFrom(this._origin, next, step, seq.swing ?? 0)
            if (this.#clipLocalAt(track, hitWhen)) {
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
              this.#at(hitWhen, () => {
                if (!this.running) return
                this.trigger?.(padId, { when: hitWhen, velocity, gateSec, step: i, accent: !!step.accent, fromSeq: true })
              })
            }
          }
        }
      }
      next++
    }
    this._trackNext.set(track.id, next)
    return true
  }

  #scheduleTrackPatternLane(pattern, lane, stepIndex, hitWhen) {
    const steps = pattern.lanes[lane]
    const step = steps?.[stepIndex]
    if (!step?.on) return false
    const prev = steps[(stepIndex - 1 + pattern.length) % pattern.length]
    if (prev?.on && prev.tie && stepIndex !== 0) return false

    let gateSteps = 1
    let k = stepIndex
    while (steps[k]?.tie && gateSteps < pattern.length) {
      k = (k + 1) % pattern.length
      if (!steps[k]?.on) break
      gateSteps++
    }
    const g = step.gate ?? pattern.gate
    const gateSec = Math.max(0.02, (gateSteps - 1 + Math.max(0.05, g)) * this.stepSec())
    const velocity = step.accent ? 1 : step.vel
    const source = pattern.sources?.[lane]
    const target = source?.soundId ? source : lane + 1
    this.#at(hitWhen, () => {
      if (!this.running) return
      this.trigger?.(target, {
        when: hitWhen,
        velocity,
        gateSec,
        step: stepIndex,
        lane,
        laneId: pattern.laneIds?.[lane] || null,
        accent: !!step.accent,
        fromSeq: true
      })
    })
    return true
  }

  #armBakedPattern(track) {
    if (track.assigned === false || track.mute) return false
    const pattern = track.pattern ? sanitizeTrackPattern(track.pattern) : null
    if (!trackPatternHasHits(pattern)) return false

    const lookAhead = 0.25
    const now = this.transport.now()
    const s = this.stepSec()
    const key = `pat:${track.id}`
    const gateClip = this._mode === "arrangement"
    let next = this._trackNext.get(key)
    if (next == null) next = this.#firstFutureStep(this._origin, now)

    if (!gateClip) {
      while (this._origin + next * s < now + lookAhead) {
        const abs = next
        const i = abs % pattern.length
        for (let lane = 0; lane < pattern.lanes.length; lane++) {
          const hitWhen = this.#stepTimeFrom(this._origin, abs, pattern.lanes[lane][i], pattern.swing)
          this.#scheduleTrackPatternLane(pattern, lane, i, hitWhen)
        }
        next++
      }
      this._trackNext.set(key, next)
      return true
    }

    while (this._origin + next * s < now + lookAhead) {
      const when = this._origin + next * s
      const clip = this.#clipLocalAt(track, when)
      if (clip) {
        const i = Math.floor(clip.local / s + 1e-9) % pattern.length
        for (let lane = 0; lane < pattern.lanes.length; lane++) {
          const step = pattern.lanes[lane][i]
          const hitWhen = this.#stepTimeFrom(this._origin, next, step, pattern.swing)
          if (!this.#clipLocalAt(track, hitWhen)) continue
          this.#scheduleTrackPatternLane(pattern, lane, i, hitWhen)
        }
      }
      next++
    }
    this._trackNext.set(key, next)
    return true
  }

  #armGlobalPattern() {
    const lookAhead = 0.25
    const now = this.transport.now()
    const pattern = this.pattern
    const s = this.stepSec()
    while (this._origin + this._next * s < now + lookAhead) {
      const abs = this._next
      const i = abs % pattern.length
      const hits = []
      for (let lane = 0; lane < SEQ_LANES; lane++) {
        const step = pattern.lanes[lane][i]
        if (!step?.on) continue
        const prev = pattern.lanes[lane][(i - 1 + pattern.length) % pattern.length]
        if (prev?.on && prev.tie && i !== 0) continue
        const when = this.#stepTime(abs, step, pattern.swing)
        let gateSteps = 1
        let k = i
        while (pattern.lanes[lane][k]?.tie && gateSteps < pattern.length) {
          k = (k + 1) % pattern.length
          if (!pattern.lanes[lane][k]?.on) break
          gateSteps++
        }
        const g = step.gate ?? pattern.gate
        const gateSec = Math.max(0.02, (gateSteps - 1 + Math.max(0.05, g)) * s)
        const velocity = step.accent ? 1 : step.vel
        hits.push(lane)
        this.#at(when, () => {
          if (!this.running) return
          this.trigger?.(lane + 1, { when, velocity, gateSec, step: i, accent: !!step.accent, fromSeq: true })
        })
      }
      if (hits.length && this.onStep) {
        const when = this.#stepTime(abs, null, pattern.swing)
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
      const track = tracks.find((item) => item.id === this._trackId)
      if (track && !this.#armBakedPattern(track)) this.#armTrackPattern(track)
    } else {
      this.#armGlobalPattern()
    }
    this._timer = setTimeout(() => this.#arm(), 50)
  }

  #at(when, fn) {
    const now = this.transport.now()
    if (when < now - 0.01) return
    const delay = Math.max(0, (when - now) * 1000 - 40)
    const id = setTimeout(fn, delay)
    this._scheduled.push(id)
  }
}
