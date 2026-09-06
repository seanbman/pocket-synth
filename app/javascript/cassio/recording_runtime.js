function hasInputOnlyTake(app) {
  return app?._recordInputOnly === true
}

function deferCompletion(fn) {
  // ScriptProcessor callbacks and transport STOP both run on the main thread.
  // Never perform transport graph changes, rendering, PCM persistence or naming
  // from inside LoopEngine's record-finalization callback.
  setTimeout(fn, 0)
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
 * - ALL completion side effects are deferred one task so LoopEngine can fully
 *   unwind its ScriptProcessor/STOP finalization before touching transport/UI.
 */
export function installRecordingRuntime(app) {
  if (!app || app._recordingRuntimeInstalled) return
  app._recordingRuntimeInstalled = true

  const loopEngine = app.loopEngine
  const stepSeq = app.stepSeq
  const transport = app.transport
  if (!loopEngine || !stepSeq || !transport) return

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

  const originalBeginRecord = loopEngine.beginRecord.bind(loopEngine)
  loopEngine.beginRecord = (trackId, options = {}) => {
    // CassioApp sets playContext when PLAY was deliberately started. During a
    // REC-from-stop count-in it is still null when beginRecord is called.
    const inputOnly = app.playContext == null
    app._recordInputOnly = inputOnly
    const originalDone = options.onDone

    const ok = originalBeginRecord(trackId, {
      ...options,
      onDone: (track) => {
        // Keep LoopEngine's callback intentionally tiny. In particular, do not
        // render or touch the Web Audio graph while #finishRecord is unwinding.
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
