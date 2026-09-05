import { audioSnapshot, trace } from "cassio/debug_trace"

let installed = false
let transitionUntil = 0
let sourceWatchTimer = null

const perfNow = () => performance?.now?.() || 0
const inTransitionWindow = () => perfNow() <= transitionUntil

function traceAudio(app, event, data = {}, severity = "info", withState = true) {
  const payload = {
    ...data,
    seqTrackId: app?.seqTrackId ?? null
  }
  if (withState) payload.state = audioSnapshot(app)
  trace("audio", event, payload, severity)
}

function wrap(target, name, app, label, argsData = null, { always = true, settle = true } = {}) {
  if (!target || typeof target[name] !== "function") return
  const original = target[name]
  if (original.__cassioDeepDebugWrapped) return
  let callNo = 0

  const wrapped = function(...args) {
    const shouldTrace = always || inTransitionWindow()
    const callId = `${label}:${++callNo}`
    if (shouldTrace) {
      traceAudio(app, `${label}.before`, {
        callId,
        args: argsData ? argsData(args) : args.slice(0, 6)
      }, "info", always)
    }

    let result
    try {
      result = original.apply(this, args)
    } catch (error) {
      traceAudio(app, `${label}.throw`, { callId, error }, "error")
      throw error
    }

    if (shouldTrace) {
      traceAudio(app, `${label}.after`, { callId }, "info", always)
      if (settle) {
        setTimeout(() => traceAudio(app, `${label}.settled.15ms`, { callId }), 15)
        setTimeout(() => traceAudio(app, `${label}.settled.80ms`, { callId }), 80)
      }
    }

    if (result?.then && typeof result.then === "function") {
      result.then(
        () => shouldTrace && traceAudio(app, `${label}.resolved`, { callId }),
        (error) => traceAudio(app, `${label}.rejected`, { callId, error }, "error")
      )
    }

    return result
  }

  wrapped.__cassioDeepDebugWrapped = true
  target[name] = wrapped
}

function installTransitionWindow(app) {
  const previous = app.render?.bind(app)
  if (!previous || previous.__cassioTransitionWindowWrapped) return
  let lastScreen = app.screen

  const wrapped = (...args) => {
    const nextScreen = app.screen
    if (nextScreen !== lastScreen) {
      transitionUntil = perfNow() + 2500
      traceAudio(app, "transition.window.open", {
        from: lastScreen,
        to: nextScreen,
        untilPerfMs: Math.round(transitionUntil * 10) / 10
      })
      lastScreen = nextScreen
    }
    return previous(...args)
  }

  wrapped.__cassioTransitionWindowWrapped = true
  app.render = wrapped
}

function installSourceWatch(app) {
  const loop = app.loopEngine
  if (!loop) return
  let previous = new Map(loop._sources || [])

  sourceWatchTimer = setInterval(() => {
    const current = new Map(loop._sources || [])
    let changed = current.size !== previous.size
    if (!changed) {
      for (const [trackId, src] of current) {
        if (previous.get(trackId) !== src) {
          changed = true
          break
        }
      }
    }

    if (changed) {
      traceAudio(app, "loop.sources.changed", {
        beforeTracks: [...previous.keys()],
        afterTracks: [...current.keys()],
        transitionWindow: inTransitionWindow()
      })
      previous = current
    }
  }, 40)
}

function voiceArgs(args) {
  const [midi, velocity, options] = args
  return {
    midi: midi ?? null,
    velocity: velocity ?? null,
    when: options?.when ?? null,
    recTrack: options?.recTrack ?? null,
    loop: options?.loop ?? null
  }
}

function offArgs(args) {
  const [midi, immediate, options] = args
  return {
    midi: midi ?? null,
    immediate: typeof immediate === "boolean" ? immediate : null,
    when: options?.when ?? null
  }
}

export function installDeepAudioTrace(app) {
  if (!app || installed) return
  installed = true

  installTransitionWindow(app)
  installSourceWatch(app)

  // Operations that can directly recreate or retime arrangement PCM.
  wrap(app.loopEngine, "setTrackLengthBars", app, "loop.setTrackLengthBars", (args) => ({ trackId: args[0], bars: args[1] }))
  wrap(app.loopEngine, "setTrackOffset", app, "loop.setTrackOffset", (args) => ({ trackId: args[0], offsetSec: args[1] }))
  wrap(app.loopEngine, "nudgeTrackOffset", app, "loop.nudgeTrackOffset", (args) => ({ trackId: args[0], deltaSec: args[1] }))
  wrap(app.loopEngine, "select", app, "loop.select", (args) => ({ trackId: args[0] }), { settle: false })
  wrap(app.loopEngine, "beginRecord", app, "loop.beginRecord", (args) => ({ trackId: args[0], options: args[1] }))
  wrap(app.loopEngine, "stopRecord", app, "loop.stopRecord")

  // Voice events are potentially numerous. Capture every one only in the 2.5s
  // boundary window around a screen transition, where the reported glitch occurs.
  wrap(app.synth, "noteOn", app, "voice.synth.noteOn", voiceArgs, { always: false, settle: false })
  wrap(app.synth, "noteOff", app, "voice.synth.noteOff", offArgs, { always: false, settle: false })
  wrap(app.padSynth, "noteOn", app, "voice.padSynth.noteOn", voiceArgs, { always: false, settle: false })
  wrap(app.padSynth, "noteOff", app, "voice.padSynth.noteOff", offArgs, { always: false, settle: false })
  wrap(app.drums, "noteOn", app, "voice.drums.noteOn", voiceArgs, { always: false, settle: false })
  wrap(app.sampleVoice, "noteOn", app, "voice.sample.noteOn", voiceArgs, { always: false, settle: false })
  wrap(app.sampleVoice, "noteOff", app, "voice.sample.noteOff", offArgs, { always: false, settle: false })

  traceAudio(app, "deep-hooks.install", {
    sourceWatchMs: 40,
    transitionVoiceTraceMs: 2500
  })
}
