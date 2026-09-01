import { formatDuration } from "cassio/audio/sample_io"

const MAX_SECONDS = 20

/** Mic capture into AudioBuffer via MediaRecorder → decode. */
export class MicCapture {
  constructor(engine) {
    this.engine = engine
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.recording = false
    this.monitor = false
    this.gain = 0.85
    this.level = 0
    this.startedAt = 0
    this._meter = null
    this._raf = null
    this._monitorGain = null
    this._source = null
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
      // Some devices reject advanced constraints — retry plain audio.
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

  async start() {
    await this.ensureMic()
    await this.engine.start()
    await this.engine.resume()
    this.#wireMeter()
    this.chunks = []
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "")
    this.recorder = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream)
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
    return this.#applyGain(buf)
  }

  setMonitor(on) {
    this.monitor = !!on
    this.#wireMeter()
  }

  setGain(v) {
    this.gain = Math.min(1.5, Math.max(0.05, Number(v) || 0.85))
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
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
  }

  #wireMeter() {
    if (!this.stream || !this.engine.ctx) return
    this.#stopMeter()
    const ctx = this.engine.ctx
    this._source = ctx.createMediaStreamSource(this.stream)
    this._inputGain = ctx.createGain()
    this._inputGain.gain.value = this.gain
    this._meter = ctx.createAnalyser()
    this._meter.fftSize = 256
    this._source.connect(this._inputGain)
    this._inputGain.connect(this._meter)
    if (this.monitor) {
      this._monitorGain = ctx.createGain()
      this._monitorGain.gain.value = 0.35
      this._inputGain.connect(this._monitorGain)
      this._monitorGain.connect(ctx.destination)
    }
    const data = new Uint8Array(this._meter.frequencyBinCount)
    const tick = () => {
      if (!this._meter) return
      this._meter.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128
        if (v > peak) peak = v
      }
      this.level = peak
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }

  #stopMeter() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
    try { this._source?.disconnect() } catch (_) { /* ignore */ }
    try { this._inputGain?.disconnect() } catch (_) { /* ignore */ }
    try { this._monitorGain?.disconnect() } catch (_) { /* ignore */ }
    this._source = null
    this._inputGain = null
    this._monitorGain = null
    this._meter = null
  }

  #applyGain(buf) {
    const g = this.gain
    if (Math.abs(g - 1) < 0.01) return buf
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c)
      for (let i = 0; i < data.length; i++) data[i] *= g
    }
    return buf
  }
}

export { MAX_SECONDS }
