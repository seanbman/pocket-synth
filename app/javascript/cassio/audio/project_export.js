import { exportSample } from "cassio/audio/export_sample"

export const PROJECT_AUDIO_FORMATS = Object.freeze(["wav", "mp3", "m4a"])

export function projectSongDurationSec(app) {
  const timeline = Number(app?.loopEngine?.timelineSec?.())
  if (Number.isFinite(timeline) && timeline > 0) return timeline

  const bars = Math.max(1, Number(app?.loopEngine?.lengthBars) || 1)
  const fallback = Number(app?.transport?.loopSec?.(bars))
  if (Number.isFinite(fallback) && fallback > 0) return fallback
  return 2
}

function stopArrangement(app) {
  app?.transport?.stop?.()
  app?.loopEngine?.stopPlayback?.()
  app?.stepSeq?.stop?.()
  if (app) app.playContext = null
}

function silenceLiveVoices(app) {
  for (const key of ["synth", "padSynth", "drums", "sampleVoice"]) {
    app?.[key]?.allNotesOff?.()
  }
}

function makeStereoBuffer(ctx, left, right, sampleRate) {
  const out = ctx.createBuffer(2, left.length, sampleRate)
  out.copyToChannel(left, 0)
  out.copyToChannel(right, 1)
  return out
}

/**
 * Real-time bounce of one complete CASSIO arrangement cycle from the final
 * post-limiter master path. The metronome and live-held notes are excluded.
 */
export async function captureProjectMaster(app) {
  const engine = app?.engine
  const transport = app?.transport
  const loopEngine = app?.loopEngine
  const stepSeq = app?.stepSeq
  if (!engine || !transport || !loopEngine || !stepSeq) throw new Error("AUDIO ENGINE NOT READY")
  if (loopEngine.recording || transport.recording) throw new Error("STOP RECORDING FIRST")

  if (typeof app.ensureAudioRunningPublic === "function") await app.ensureAudioRunningPublic()
  if (!engine.ready || !engine.ctx) throw new Error("AUDIO ENGINE NOT READY")
  if (engine.ctx.state === "suspended") await engine.resume?.()
  if (engine.ctx.state === "suspended") throw new Error("TAP PLAY THEN EXPORT")

  const ctx = engine.ctx
  const source = engine.analyser
  if (!source?.connect) throw new Error("MASTER OUTPUT NOT READY")

  const durationSec = projectSongDurationSec(app)
  const sampleRate = ctx.sampleRate
  const target = Math.max(1, Math.ceil(durationSec * sampleRate))
  const left = new Float32Array(target)
  const right = new Float32Array(target)
  const processor = ctx.createScriptProcessor(4096, 2, 2)
  const silentSink = ctx.createGain()
  silentSink.gain.value = 0

  let written = 0
  let settled = false
  let timeoutId = null
  let resolveCapture
  let rejectCapture
  const capture = new Promise((resolve, reject) => {
    resolveCapture = resolve
    rejectCapture = reject
  })

  const cleanupCapture = () => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = null
    processor.onaudioprocess = null
    try { source.disconnect(processor) } catch (_) { /* ignore */ }
    try { processor.disconnect() } catch (_) { /* ignore */ }
    try { silentSink.disconnect() } catch (_) { /* ignore */ }
  }

  const finish = (error = null) => {
    if (settled) return
    settled = true
    cleanupCapture()
    stopArrangement(app)
    if (error) rejectCapture(error)
    else resolveCapture(makeStereoBuffer(ctx, left, right, sampleRate))
  }

  const metroWasOn = !!app.metro?.on
  if (app.metro) app.metro.on = false
  silenceLiveVoices(app)
  stopArrangement(app)
  loopEngine.ensureGraph?.()

  const origin = ctx.currentTime + 0.08
  processor.onaudioprocess = (event) => {
    if (settled) return
    const input = event.inputBuffer
    const l = input.getChannelData(0)
    const r = input.numberOfChannels > 1 ? input.getChannelData(1) : l
    const frameStart = Number.isFinite(event.playbackTime) ? event.playbackTime : ctx.currentTime
    let start = Math.max(0, Math.floor((origin - frameStart) * sampleRate))
    if (start >= l.length) return

    for (let i = start; i < l.length && written < target; i++) {
      left[written] = l[i]
      right[written] = r[i]
      written++
    }
    if (written >= target) finish()
  }

  source.connect(processor)
  processor.connect(silentSink)
  silentSink.connect(ctx.destination)

  if (!transport.playAt(origin)) {
    if (app.metro) app.metro.on = metroWasOn
    finish(new Error("TRANSPORT NOT READY"))
    return capture
  }
  app.playContext = "loop"
  loopEngine.startPlayback(origin)
  stepSeq.start(origin, { mode: "arrangement" })

  timeoutId = setTimeout(() => {
    finish(new Error("EXPORT CAPTURE TIMED OUT"))
  }, Math.ceil((durationSec + 5) * 1000))

  try {
    return await capture
  } finally {
    if (app.metro) app.metro.on = metroWasOn
    cleanupCapture()
    stopArrangement(app)
  }
}

export async function exportProjectAudio(app, format, basename = "CASSIO_PROJECT") {
  const fmt = String(format || "wav").toLowerCase()
  if (!PROJECT_AUDIO_FORMATS.includes(fmt)) throw new Error("UNKNOWN FORMAT")
  const buffer = await captureProjectMaster(app)
  return exportSample(buffer, fmt, basename)
}
