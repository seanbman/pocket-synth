export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.dry = null
    this.wet = null
    this.convolver = null
    this.wetGain = null
    this.delay = null
    this.delayGain = null
    this.delayFeedback = null
    this.bassEq = null
    this.trebleEq = null
    this.limiter = null
    this.analyser = null
    this.ready = false
    this.masterVolume = 0.7
    this.masterBassDb = 0
    this.masterTrebleDb = 0
    this.limiterEnabled = true
    this.space = 0.24
    this.delayAmt = 0
    this._wave = null
  }

  async start() {
    if (this.ready) return this.ctx
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.masterVolume

    this.bassEq = this.ctx.createBiquadFilter()
    this.bassEq.type = "lowshelf"
    this.bassEq.frequency.value = 120
    this.bassEq.gain.value = this.masterBassDb

    this.trebleEq = this.ctx.createBiquadFilter()
    this.trebleEq.type = "highshelf"
    this.trebleEq.frequency.value = 6000
    this.trebleEq.gain.value = this.masterTrebleDb

    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.12
    this.#applyLimiterState()

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.35
    this._wave = new Float32Array(this.analyser.fftSize)

    this.master.connect(this.bassEq)
    this.bassEq.connect(this.trebleEq)
    this.trebleEq.connect(this.limiter)
    this.limiter.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)

    this.dry = this.ctx.createGain()
    this.dry.gain.value = 1
    this.dry.connect(this.master)

    // Per-track record buses (live performance → loop track N).
    this.recTaps = Array.from({ length: 6 }, () => {
      const tap = this.ctx.createGain()
      tap.gain.value = 1
      return tap
    })

    // Legacy alias — do not connect dry here (avoids mixed recording).
    this.recTap = this.recTaps[0]

    this.wetGain = this.ctx.createGain()
    this.wetGain.gain.value = this.space
    this.convolver = this.ctx.createConvolver()
    this.convolver.buffer = this.#makeImpulse(1.6)
    this.wetGain.connect(this.convolver)
    this.convolver.connect(this.master)

    this.delay = this.ctx.createDelay(1.0)
    this.delay.delayTime.value = 0.28
    this.delayGain = this.ctx.createGain()
    this.delayGain.gain.value = 0
    this.delayFeedback = this.ctx.createGain()
    this.delayFeedback.gain.value = 0.35
    this.delayGain.connect(this.delay)
    this.delay.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delay)
    this.delay.connect(this.master)

    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {})
    }
    this.ready = true
    return this.ctx
  }

  async resume() {
    if (!this.ctx) return
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume() } catch (_) { /* ignore */ }
    }
  }

  /** Near-silent tick to warm the output path after a gesture unlock. */
  warmSilent() {
    if (!this.ctx || !this.master) return
    try {
      const ctx = this.ctx
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      g.gain.value = 0.0001
      osc.connect(g)
      g.connect(this.master)
      const t = ctx.currentTime
      osc.start(t)
      osc.stop(t + 0.02)
    } catch (_) { /* ignore */ }
  }

  getWaveform(out) {
    if (!this.analyser) return null
    const buf = out || this._wave
    this.analyser.getFloatTimeDomainData(buf)
    return buf
  }

  getRms() {
    const buf = this.getWaveform()
    if (!buf) return 0
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.sqrt(sum / buf.length)
  }

  setMasterVolume(v) {
    this.masterVolume = Math.min(1, Math.max(0, v))
    if (this.master) this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02)
  }

  setSpace(v) {
    this.space = Math.min(1, Math.max(0, v))
    if (this.wetGain) this.wetGain.gain.setTargetAtTime(this.space, this.ctx.currentTime, 0.05)
  }

  setDelay(v) {
    this.delayAmt = Math.min(1, Math.max(0, v))
    if (this.delayGain) this.delayGain.gain.setTargetAtTime(this.delayAmt * 0.55, this.ctx.currentTime, 0.05)
  }

  setBassDb(db) {
    this.masterBassDb = Math.min(12, Math.max(-12, Number(db) || 0))
    if (this.bassEq) this.bassEq.gain.setTargetAtTime(this.masterBassDb, this.ctx.currentTime, 0.04)
  }

  setTrebleDb(db) {
    this.masterTrebleDb = Math.min(12, Math.max(-12, Number(db) || 0))
    if (this.trebleEq) this.trebleEq.gain.setTargetAtTime(this.masterTrebleDb, this.ctx.currentTime, 0.04)
  }

  setLimiterEnabled(enabled) {
    this.limiterEnabled = !!enabled
    this.#applyLimiterState()
  }

  recTapForTrack(trackId) {
    const i = Math.min(6, Math.max(1, trackId | 0)) - 1
    return this.recTaps?.[i] || this.recTap
  }

  /** Route live performance audio into a track's record bus (1–6). */
  tapRec(node, trackId) {
    if (!node || !trackId) return
    try { node.connect(this.recTapForTrack(trackId)) } catch (_) { /* ignore */ }
  }

  connectVoice(node, pan = 0, recTrack = null) {
    let src = node
    const p = Number(pan)
    if (Number.isFinite(p) && Math.abs(p) > 0.001 && this.ctx) {
      const panner = this.ctx.createStereoPanner()
      panner.pan.value = Math.min(1, Math.max(-1, p))
      node.connect(panner)
      src = panner
    }
    src.connect(this.dry)
    src.connect(this.wetGain)
    src.connect(this.delayGain)
    if (recTrack) this.tapRec(src, recTrack)
  }

  now() {
    return this.ctx?.currentTime ?? 0
  }

  async panic() {
    if (!this.ctx) return
    const g = this.master.gain
    g.cancelScheduledValues(this.ctx.currentTime)
    g.setValueAtTime(0, this.ctx.currentTime)
    g.setTargetAtTime(this.masterVolume, this.ctx.currentTime + 0.05, 0.05)
  }

  #applyLimiterState() {
    if (!this.limiter) return
    const now = this.ctx?.currentTime || 0
    const threshold = this.limiterEnabled ? -3 : 0
    const knee = this.limiterEnabled ? 3 : 0
    const ratio = this.limiterEnabled ? 20 : 1
    this.limiter.threshold.setTargetAtTime(threshold, now, 0.02)
    this.limiter.knee.setTargetAtTime(knee, now, 0.02)
    this.limiter.ratio.setTargetAtTime(ratio, now, 0.02)
  }

  #makeImpulse(seconds) {
    const rate = this.ctx.sampleRate
    const length = rate * seconds
    const buffer = this.ctx.createBuffer(2, length, rate)
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2)
      }
    }
    return buffer
  }
}
