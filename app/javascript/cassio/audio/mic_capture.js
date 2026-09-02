import { formatDuration, peakNormalizeBuffer } from "cassio/audio/sample_io"

const MAX_SECONDS = 20
const SPEC_BARS = 28

/** Mic capture into AudioBuffer via MediaRecorder → decode. */
export class MicCapture {
  constructor(engine) {
    this.engine = engine
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.recording = false
    this.monitor = false
    this.gain = 1
    this.level = 0
    this.spectrum = new Array(SPEC_BARS).fill(0)
    this.startedAt = 0
    this._meter = null
    this._raf = null
    this._monitorGain = null
    this._source = null
    this._inputGain = null
    this._recDest = null
    this._freqData = null
  }

  async ensureMic() {
    if (this.stream) return this.stream
    if (!window.isSecureContext) {
      throw new Error("NEED HTTPS OR LOCALHOST")
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MIC API UNAVAILABLE")
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
    } catch (e) {
      if (e?.name === "OverconstrainedError" || e?.name === "NotFoundError") {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } else {
        throw e
      }
    }
    return this.stream
  }

  micErrorMessage(err) {
    const name = err?.name || ""
    const msg = String(err?.message || err || "")
    if (msg.includes("NEED HTTPS")) return msg
    if (msg.includes("UNAVAILABLE")) return msg
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "MIC BLOCKED — CHECK SITE PERMISSIONS"
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "NO MIC FOUND"
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "MIC IN USE ELSEWHERE"
    }
    if (name === "SecurityError") return "MIC BLOCKED BY BROWSER"
    return (msg || "MIC FAILED").slice(0, 28).toUpperCase()
  }

  /** Arm analyser for live meters before REC (call after ensureMic + audio ctx). */
  armMeter() {
    this.#wireMeter()
  }

  async start() {
    await this.ensureMic()
    await this.engine.start()
    await this.engine.resume()
    this.#wireMeter()
    this.chunks = []
    // Record after M1 input gain so volume knob affects the take live.
    if (!this._recDest) {
      this._recDest = this.engine.ctx.createMediaStreamDestination()
      this._inputGain.connect(this._recDest)
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "")
    const recStream = this._recDest.stream
    this.recorder = mime
      ? new MediaRecorder(recStream, { mimeType: mime })
      : new MediaRecorder(recStream)
    this.recorder.ondataavailable = (e) => {
      if (e.data?.size) this.chunks.push(e.data)
    }
    this.recorder.start(100)
    this.recording = true
    this.startedAt = performance.now()
  }

  async stop() {
    if (!this.recorder || !this.recording) return null
    this.recording = false
    const rec = this.recorder
    const done = new Promise((resolve) => { rec.onstop = () => resolve() })
    rec.stop()
    await done
    this.recorder = null
    const type = rec.mimeType || "audio/webm"
    const blob = new Blob(this.chunks, { type })
    this.chunks = []
    const ab = await blob.arrayBuffer()
    const buf = await this.engine.ctx.decodeAudioData(ab.slice(0))
    return this.#finishBuffer(buf)
  }

  setMonitor(on) {
    this.monitor = !!on
    this.#applyMonitor()
  }

  setGain(v) {
    this.gain = Math.min(2, Math.max(0.05, Number(v) || 1))
    if (this._inputGain) this._inputGain.gain.value = this.gain
  }

  elapsedLabel() {
    if (!this.recording) return "00:00.00"
    return formatDuration((performance.now() - this.startedAt) / 1000)
  }

  hitMax() {
    return this.recording && (performance.now() - this.startedAt) / 1000 >= MAX_SECONDS
  }

  dispose() {
    this.#stopMeter()
    try { this.recorder?.stop() } catch (_) { /* ignore */ }
    this.recorder = null
    this.recording = false
    this.level = 0
    this.spectrum.fill(0)
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
  }

  #wireMeter() {
    if (!this.stream || !this.engine.ctx) return
    // Keep graph if already armed (don't break live MediaRecorder).
    if (this._inputGain && this._source) {
      this._inputGain.gain.value = this.gain
      this.#applyMonitor()
      return
    }
    this.#stopMeter()
    const ctx = this.engine.ctx
    this._source = ctx.createMediaStreamSource(this.stream)
    this._inputGain = ctx.createGain()
    this._inputGain.gain.value = this.gain
    this._meter = ctx.createAnalyser()
    this._meter.fftSize = 256
    this._meter.smoothingTimeConstant = 0.55
    this._source.connect(this._inputGain)
    this._inputGain.connect(this._meter)
    this._recDest = ctx.createMediaStreamDestination()
    this._inputGain.connect(this._recDest)
    this.#applyMonitor()

    const time = new Uint8Array(this._meter.fftSize)
    this._freqData = new Uint8Array(this._meter.frequencyBinCount)
    const tick = () => {
      if (!this._meter) return
      this._meter.getByteTimeDomainData(time)
      let peak = 0
      for (let i = 0; i < time.length; i++) {
        const v = Math.abs(time[i] - 128) / 128
        if (v > peak) peak = v
      }
      this.level = peak

      this._meter.getByteFrequencyData(this._freqData)
      const n = this._freqData.length
      const step = Math.max(1, Math.floor(n / SPEC_BARS))
      for (let i = 0; i < SPEC_BARS; i++) {
        let sum = 0
        const start = i * step
        const end = Math.min(n, start + step)
        for (let j = start; j < end; j++) sum += this._freqData[j]
        const avg = (end > start ? sum / (end - start) : 0) / 255
        this.spectrum[i] = avg
      }
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }

  #applyMonitor() {
    try { this._monitorGain?.disconnect() } catch (_) { /* ignore */ }
    this._monitorGain = null
    if (!this.monitor || !this._inputGain || !this.engine.master) return
    this._monitorGain = this.engine.ctx.createGain()
    this._monitorGain.gain.value = 0.4
    this._inputGain.connect(this._monitorGain)
    // Through master so M3 VOLUME affects monitor level.
    this._monitorGain.connect(this.engine.master)
  }

  #stopMeter() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
    try { this._source?.disconnect() } catch (_) { /* ignore */ }
    try { this._inputGain?.disconnect() } catch (_) { /* ignore */ }
    try { this._monitorGain?.disconnect() } catch (_) { /* ignore */ }
    try { this._recDest?.disconnect() } catch (_) { /* ignore */ }
    this._source = null
    this._inputGain = null
    this._monitorGain = null
    this._recDest = null
    this._meter = null
    this._freqData = null
  }

  #finishBuffer(buf) {
    // M1 gain is already in the recorded stream; normalize for usable level.
    peakNormalizeBuffer(buf, 0.9, 8)
    return buf
  }
}

export { MAX_SECONDS, SPEC_BARS }
