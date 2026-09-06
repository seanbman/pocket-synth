function hasInputOnlyTake(app) {
  return app?._recordInputOnly === true
}

function deferCompletion(fn) {
  setTimeout(fn, 0)
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

async function cacheStoredAudioCooperatively(track, chunkSamples = 16384) {
  const buffer = track?.buffer
  if (!buffer || track._storedFor === buffer) return

  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const source = buffer.getChannelData(c)
    const copy = new Float32Array(source.length)
    for (let offset = 0; offset < source.length; offset += chunkSamples) {
      const end = Math.min(source.length, offset + chunkSamples)
      copy.set(source.subarray(offset, end), offset)
      await yieldToBrowser()
    }
    channels.push(copy)
  }

  track._stored = {
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    channels
  }
  track._storedFor = buffer
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

function installNonBlockingLoopCapture(loopEngine) {
  const ctx = loopEngine?.engine?.ctx
  const engine = loopEngine?.engine
  const transport = loopEngine?.transport
  if (!ctx || !engine?.recTapForTrack || !transport) return false
  if (loopEngine._nonBlockingCaptureInstalled) return true
  loopEngine._nonBlockingCaptureInstalled = true

  let commitPending = false

  const commitCapture = (snapshot) => {
    const { track, proc, sink, recBus, data, target, replace, onDone } = snapshot

    try {
      proc?.disconnect()
      if (proc && recBus) recBus.disconnect(proc)
      sink?.disconnect()
    } catch (_) { /* already detached */ }

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
    track._stored = null
    track._storedFor = null
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

export function installRecordingRuntime(app) {
  if (!app || app._recordingRuntimeInstalled) return
  app._recordingRuntimeInstalled = true

  const loopEngine = app.loopEngine
  const stepSeq = app.stepSeq
  const transport = app.transport
  if (!loopEngine || !stepSeq || !transport) return

  installNonBlockingLoopCapture(loopEngine)

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
    const inputOnly = app.playContext == null
    app._recordInputOnly = inputOnly

    const ok = captureBeginRecord(trackId, {
      ...options,
      onDone: (track) => {
        app._recordInputOnly = false

        deferCompletion(async () => {
          if (inputOnly) {
            loopEngine.stopPlayback()
            stepSeq.stop()
            transport.stop()
            app.playContext = null
          }

          await cacheStoredAudioCooperatively(track)

          // Diagnostic isolation: intentionally skip CassioApp's original
          // completion callback (saveLaneToLibrary -> #persist -> render).
          // If the 3-cycle browser gate passes, the remaining freeze is inside
          // that post-record completion path rather than capture/PCM commit.
          app.render?.()
        })
      }
    })

    if (!ok) app._recordInputOnly = false
    return ok
  }
}
