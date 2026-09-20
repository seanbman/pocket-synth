/** BPM clock with bar/beat playhead for loop + metronome. */
export class Transport {
  constructor() {
    this.bpm = 120
    this.playing = false
    this.recording = false
    this.countingIn = false
    this.bar = 1
    this.beat = 1
    this.onTick = null
    this.onBar = null
    this._engine = null
    this._origin = 0
    this._beatIndex = 0
    this._timer = null
    this._scheduled = []
    this.#taps = []
  }

  #taps

  attach(engine) {
    this._engine = engine
  }

  beatSec() {
    return 60 / Math.max(40, Math.min(240, this.bpm))
  }

  barSec() {
    return this.beatSec() * 4
  }

  loopSec(bars) {
    return this.barSec() * Math.max(1, bars || 1)
  }

  /**
   * Next loop downbeat at or after `now` (for overdub capture aligned to the transport).
   * Returns `now` when playback just started (elapsed ≈ 0).
   */
  nextLoopBoundary(origin, loopSec, now = this.now()) {
    const sec = Math.max(0.01, Number(loopSec) || 0.01)
    const elapsed = Math.max(0, now - origin)
    if (elapsed < 0.002) return now
    const k = Math.ceil((elapsed - 0.001) / sec)
    return Math.max(now, origin + k * sec)
  }

  /** Next quantize grid point at or after `now` (0 grid = passthrough). */
  nextGridPoint(origin, gridSec, now = this.now()) {
    const sec = Number(gridSec) || 0
    if (sec <= 0) return now
    const elapsed = Math.max(0, now - origin)
    const k = Math.ceil((elapsed - 0.001) / sec)
    return Math.max(now, origin + k * sec)
  }

  now() {
    return this._engine?.now?.() ?? 0
  }

  /** Elapsed beats since play origin (fractional). */
  playheadBeats() {
    if (!this.playing) return 0
    const elapsed = Math.max(0, this.now() - this._origin)
    return elapsed / this.beatSec()
  }

  playheadLabel() {
    if (!this.playing && !this.countingIn) return "1:1"
    return `${this.bar}:${this.beat}`
  }

  /** Position within a loop cycle (seconds), for timeline UI. */
  playheadSecInLoop(lengthBars = 4) {
    if (!this.playing && !this.countingIn) return 0
    const loopSec = this.loopSec(lengthBars)
    if (loopSec <= 0) return 0
    const elapsed = Math.max(0, this.now() - this._origin)
    return elapsed % loopSec
  }

  play({ restart = true } = {}) {
    if (!this._engine?.ready) return false
    if (this.playing && !restart) return true
    return this.playAt(this.now() + 0.02)
  }

  playAt(origin) {
    if (!this._engine?.ready) return false
    this.#clearSchedule()
    this.playing = true
    this.countingIn = false
    this._origin = origin
    this._beatIndex = 0
    this.bar = 1
    this.beat = 1
    this.#armTicks()
    return true
  }

  /** Start clock for count-in; `onComplete` when record should begin. */
  countIn(bars, onComplete) {
    if (!this._engine?.ready) return false
    this.#clearSchedule()
    this.playing = true
    this.countingIn = true
    this.recording = false
    const nBeats = Math.max(0, Math.round((bars || 0) * 4))
    this._origin = this.now()
    this._beatIndex = 0
    this.bar = 1
    this.beat = 1
    if (nBeats === 0) {
      this.countingIn = false
      onComplete?.(this._origin)
      this.#armTicks()
      return true
    }
    const beat = this.beatSec()
    for (let i = 0; i < nBeats; i++) {
      const t = this._origin + i * beat
      const accent = i % 4 === 0
      this.#at(t, () => {
        this.bar = Math.floor(i / 4) + 1
        this.beat = (i % 4) + 1
        this.onTick?.(this.bar, this.beat, accent)
      })
    }
    const startAt = this._origin + nBeats * beat
    this.#at(startAt, () => {
      this.countingIn = false
      this._origin = startAt
      this._beatIndex = 0
      this.bar = 1
      this.beat = 1
      onComplete?.(startAt)
      this.#armTicks()
    })
    return true
  }

  playPause() {
    if (this.playing) {
      this.stop()
      return false
    }
    return this.play({ restart: true })
  }

  stop() {
    this.#clearSchedule()
    this.playing = false
    this.recording = false
    this.countingIn = false
    this.bar = 1
    this.beat = 1
    this._beatIndex = 0
  }

  setRecording(on) {
    this.recording = !!on
  }

  tap() {
    const now = performance.now()
    this.#taps = this.#taps.filter((t) => now - t < 2500)
    this.#taps.push(now)
    let locked = false
    if (this.#taps.length >= 2) {
      const intervals = []
      for (let i = 1; i < this.#taps.length; i++) intervals.push(this.#taps[i] - this.#taps[i - 1])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      this.bpm = Math.round(Math.min(240, Math.max(40, 60000 / avg)))
      locked = true
    }
    return { bpm: this.bpm, locked, taps: this.#taps.length }
  }

  /** Re-arm tick schedule at current BPM without stopping playback (after tap-tempo). */
  resyncFromNow() {
    if (!this.playing || !this._engine?.ready) return
    this.#clearSchedule()
    this._origin = this.now()
    this._beatIndex = 0
    this.bar = 1
    this.beat = 1
    this.#armTicks()
  }

  #armTicks() {
    if (!this.playing) return
    const beat = this.beatSec()
    const lookAhead = 0.25
    const now = this.now()
    while (this._origin + this._beatIndex * beat < now + lookAhead) {
      const i = this._beatIndex
      const t = this._origin + i * beat
      const accent = i % 4 === 0
      const bar = Math.floor(i / 4) + 1
      const beatN = (i % 4) + 1
      this.#at(t, () => {
        if (!this.playing) return
        this.bar = bar
        this.beat = beatN
        this.onTick?.(bar, beatN, accent)
        if (accent) this.onBar?.(bar)
      })
      this._beatIndex++
    }
    this._timer = setTimeout(() => this.#armTicks(), 50)
  }

  #at(when, fn) {
    const delay = Math.max(0, (when - this.now()) * 1000)
    const id = setTimeout(fn, delay)
    this._scheduled.push(id)
  }

  #clearSchedule() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    for (const id of this._scheduled) clearTimeout(id)
    this._scheduled = []
  }
}
