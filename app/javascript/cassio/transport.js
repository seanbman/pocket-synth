export class Transport {
  constructor() {
    this.bpm = 120
    this.playing = false
    this.recording = false
    this.#taps = []
  }

  #taps

  playPause() {
    this.playing = !this.playing
    if (!this.playing) this.recording = false
    return this.playing
  }

  stop() {
    this.playing = false
    this.recording = false
  }

  tap() {
    const now = performance.now()
    this.#taps = this.#taps.filter((t) => now - t < 2500)
    this.#taps.push(now)
    if (this.#taps.length >= 2) {
      const intervals = []
      for (let i = 1; i < this.#taps.length; i++) intervals.push(this.#taps[i] - this.#taps[i - 1])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      this.bpm = Math.round(Math.min(240, Math.max(40, 60000 / avg)))
    }
    return this.bpm
  }
}
