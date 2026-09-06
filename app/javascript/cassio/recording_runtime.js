function hasInputOnlyTake(app) {
  return app?._recordInputOnly === true
}

function deferCompletion(fn) {
  // ScriptProcessor callbacks and transport STOP both run on the main thread.
  // Never perform transport graph changes, rendering, PCM persistence or naming
  // from inside the input/audio teardown stack.
  setTimeout(fn, 0)
}

function resizeBuffer(ctx, buf, samples) {
  if (!buf) return null
  const n = Math.max(1, samples | 0)
  if (buf.length === n) return buf
  const out = ctx.createBuffer(buf.numberOfChannels, n, ctx.sampleRate)
  const copy = Math.min(buf.length, n)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.getChannelData(c).set(buf.getChannelData(c).subarray(0, copy))
  }
  return out
}

function mixBuffers(ctx, base, pass) {
  if (!pass) return base
  if (!base) return pass
  const len = Math.max(base.length, pass.length)
  const channels = Math.max(base.numberOfChannels, pass.numberOfChannels)
  const out = ctx.createBuffer(channels, len, ctx.sampleRate)
  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c)
    const a = c < base.numberOfChannels ? base.getChannelData(c) : null
    const b = c < pass.numberOfChannels ? pass.getChannelData(c) : null
    for (let i = 0; i < len; i++) {
      dst[i] = Math.tanh(((a?.[i] || 0) + (b?.[i] || 0)) * 0.9)
    }
  }
  return out
}

/**
 * Installs a non-blocking record capture path on LoopEngine.
 *
 * The original LoopEngine finalizes synchronously from STOP/onaudioprocess:
 * disconnect ScriptProcessor -> create/copy/mix AudioBuffers -> refresh graph ->
 * callback. On mobile/headless Chrome this can lock the client event loop.
 *
 * This runtime preserves the same capture semantics while splitting the work:
 * 1. endCapture() marks recording false and detaches the live callback immediately.
 * 2. the graph disconnect + AudioBuffer commit happens in a later task.
 * 3. the app completion callback runs only after the commit.
 *
 * The app already installs recording policy at runtime, so keeping the browser-
 * compatibility shim here avoids duplicating product behavior in CassioApp.
 */
function installNonBlockingLoopCapture(loopEngine) {
  const ctx = loopEngine?.engine?.ctx
  const engine = loopEngine?.engine
  const transport = loopEngine?.transport
  if (!ctx || !engine?.recTapForTrack || !transport) return false
  if (loopEngine._nonBlockingCaptureInstalled) return true
  loopEngine._nonBlockingCaptureInstalled = true

  let commitPending = false

  const commitCapture = (snapshot) => {
    const {
      track, proc, sink, recBus, data, target, replace, onDone
    } = snapshot

    try {
      proc?.disconnect()
      if (proc && recBus) recBus.disconnect(proc)
      sink?.disconnect()
    } catch (_) { /* already detached or browser-specific graph state */ }

    if (!track || !data) {
      commitPending = false
      onDone?.(track)
      return
    }

    const len = Math.max(1, target | 0)
    const pass = ctx.createBuffer(2, len, ctx.sampleRate)
    pass.copyToChannel(data[0], 0)
    pass.copyToChannel(data[1], 1)

    track.undoBuffer = track.buffer
    if (replace || !track.buffer) {
      track.buffer = pass
    } else {
      const base = resizeBuffer(ctx, track.buffer, len)
      track.buffer = mixBuffers(ctx, base, pass)
      track.buffer = resizeBuffer(ctx, track.buffer, len)
    }
    track.dirty = true
    loopEngine.refreshGains?.()
    commitPending = false
    onDone?.(track)
  }

  const endCapture = () => {
    if (!loopEngine._recording) return false
    loopEngine._recording = false

    const snapshot = {
      track: loopEngine._recTrack,
      proc: loopEngine._recProc,
      sink: loopEngine._recSink,
      recBus: loopEngine._recBus,
      data: loopEngine._recData,
      target: loopEngine._recTarget,
      replace: !!loopEngine._recReplace,
      onDone: loopEngine._onRecDone
    }

    // The live callback must become inert before STOP returns. Do not disconnect
    // the ScriptProcessor synchronously; Chromium can stall while its callback is
    // being serviced. The later commit task owns graph teardown.
    if (snapshot.proc) snapshot.proc.onaudioprocess = null
    loopEngine._recProc = null
    loopEngine._recSink = null
    loopEngine._recBus = null
    loopEngine._recData = null
    loopEngine._recTrack = null
    loopEngine._onRecDone = null
    commitPending = true

    deferCompletion(() => commitCapture(snapshot))
    return true
  }

  loopEngine.stopRecord = endCapture

  loopEngine.beginRecord = (trackId, { replace = false, startTime = null, onDone = null } = {}) => {
    if (!engine?.ready || commitPending) return false
    if (loopEngine._recording) endCapture()

    const track = loopEngine.tracks?.find((candidate) => candidate.id === trackId)
    if (!track?.assigned) return false

    loopEngine.ensureGraph?.()
    const bars = Math.max(1, Math.round(Number(track.lengthBars || loopEngine.lengthBars) || 4))
    track.lengthBars = bars
    const samples = Math.max(1, Math.floor(transport.loopSec(bars) * ctx.sampleRate))

    loopEngine._recording = true
    loopEngine._recTrack = track
    loopEngine._recReplace = replace || track.mode === "replace"
    loopEngine._recTarget = samples
    loopEngine._recWritten = 0
    loopEngine._recData = [new Float32Array(samples), new Float32Array(samples)]
    loopEngine._onRecDone = onDone
    loopEngine._recStartedAt = startTime ?? ctx.currentTime

    const proc = ctx.createScriptProcessor(4096, 2, 2)
    const sink = ctx.createGain()
    sink.gain.value = 0
    const recBus = engine.recTapForTrack(trackId)
    recBus.connect(proc)
    proc.connect(sink)
    sink.connect(ctx.destination)
    loopEngine._recProc = proc
    loopEngine._recSink = sink
    loopEngine._recBus = recBus

    proc.onaudioprocess = (event) => {
      if (!loopEngine._recording) return
      if (ctx.currentTime + 0.002 < loopEngine._recStartedAt) return
      const current = loopEngine._recData
      if (!current) return

      const left = event.inputBuffer.getChannelData(0)
      const right = event.inputBuffer.numberOfChannels > 1
        ? event.inputBuffer.getChannelData(1)
        : left
      for (let i = 0; i < left.length && loopEngine._recWritten < loopEngine._recTarget; i++) {
        current[0][loopEngine._recWritten] = left[i]
        current[1][loopEngine._recWritten] = right[i]
        loopEngine._recWritten++
      }
      if (loopEngine._recWritten >= loopEngine._recTarget) endCapture()
    }

    loopEngine.refreshGains?.()
    return true
  }

  return true
}

/**
 * Recording policy:
 *
 * - REC from stop runs the count-in/transport clock but does not start backing
 *   PCM or sequencer playback.
 * - PLAY then REC keeps backing playback audible for performance monitoring.
 * - Sequencer-generated notes never enter a record bus; only physical live
 *   keyboard/pad performances are captured.
 * - Completed takes are persisted by CassioApp. Fresh unnamed lanes hand off to
 *   the track naming runtime immediately after the take instead of silently
 *   accepting a generated/default track name.
 * - Loop capture teardown is two-phase so STOP remains responsive.
 */
export function installRecordingRuntime(app) {
  if (!app || app._recordingRuntimeInstalled) return
  app._recordingRuntimeInstalled = true

  const loopEngine = app.loopEngine
  const stepSeq = app.stepSeq
  const transport = app.transport
  if (!loopEngine || !stepSeq || !transport) return

  installNonBlockingLoopCapture(loopEngine)

  // Every call through StepSequencer.trigger is generated playback, never live
  // input. `false` is intentional: CassioApp's nullish fallback treats null as
  // "use the active record track", while false explicitly disables the tap.
  const originalSeqTrigger = stepSeq.trigger
  stepSeq.trigger = (target, options = {}) => originalSeqTrigger?.(target, {
    ...options,
    fromSeq: true,
    recTrack: false
  })

  const originalStartPlayback = loopEngine.startPlayback.bind(loopEngine)
  loopEngine.startPlayback = (...args) => {
    if (hasInputOnlyTake(app)) return
    return originalStartPlayback(...args)
  }

  const originalSeqStart = stepSeq.start.bind(stepSeq)
  stepSeq.start = (...args) => {
    if (hasInputOnlyTake(app)) return
    return originalSeqStart(...args)
  }

  const captureBeginRecord = loopEngine.beginRecord.bind(loopEngine)
  loopEngine.beginRecord = (trackId, options = {}) => {
    // CassioApp sets playContext when PLAY was deliberately started. During a
    // REC-from-stop count-in it is still null when beginRecord is called.
    const inputOnly = app.playContext == null
    app._recordInputOnly = inputOnly
    const originalDone = options.onDone

    const ok = captureBeginRecord(trackId, {
      ...options,
      onDone: (track) => {
        app._recordInputOnly = false

        deferCompletion(() => {
          if (inputOnly) {
            loopEngine.stopPlayback()
            stepSeq.stop()
            transport.stop()
            app.playContext = null
          }

          const needsName = !!track?._needsNameAfterTake
          const originalToast = needsName ? app.toast : null
          if (needsName && originalToast) app.toast = () => {}

          try {
            originalDone?.(track)
          } finally {
            if (needsName && originalToast) app.toast = originalToast
            app.render?.()
            queueMicrotask(() => {
              if (needsName && app.renameTrack) {
                app.renameTrack(track?.id || trackId, { afterTake: true })
                return
              }
              const name = String(track?.name || `TRK ${track?.id || trackId}`).slice(0, 18)
              app.toast?.(`TRACK SAVED · ${name}`)
            })
          }
        })
      }
    })

    if (!ok) app._recordInputOnly = false
    return ok
  }
}
