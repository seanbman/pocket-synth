export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.dry = null
    this.wet = null
    this.convolver = null
    this.wetGain = null
    this.analyser = null
    this.ready = false
    this.masterVolume = 0.7
    this.space = 0.24
    this._wave = null
  }

  async start() {
    if (this.ready) return this.ctx
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.masterVolume

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.35
    this._wave = new Float32Array(this.analyser.fftSize)

    this.master.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)

    this.dry = this.ctx.createGain()
    this.dry.gain.value = 1
    this.dry.connect(this.master)

    this.wetGain = this.ctx.createGain()
    this.wetGain.gain.value = this.space
    this.convolver = this.ctx.createConvolver()
    this.convolver.buffer = this.#makeImpulse(1.6)
    this.wetGain.connect(this.convolver)
    this.convolver.connect(this.master)

    // Never await resume here — without a gesture it can hang forever
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

  connectVoice(node) {
    node.connect(this.dry)
    node.connect(this.wetGain)
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
