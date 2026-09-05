function soundById(app, id) {
  if (!id) return null
  return app.userSounds?.find?.((sound) => sound.id === id)
    || app.factory?.sounds?.find?.((sound) => sound.id === id)
    || null
}

function laneKey(target, options = {}) {
  if (!target || typeof target !== "object") return null
  if (options.laneId != null) return `id:${options.laneId}`
  if (options.lane != null) return `lane:${options.lane}`
  if (target.fromPad != null) return `pad:${target.fromPad}`
  return target.soundId ? `sound:${target.soundId}` : null
}

function sourceKind(sound) {
  if (sound?.voice === "sample") return "sample"
  if (sound?.voice === "drum") return "drum"
  return "synth"
}

function sourceMidi(target, sound) {
  const n = Number(target?.midi)
  if (Number.isFinite(n)) return n
  const root = String(sound?.root || sound?.patch?.root || "C3")
  const m = root.match(/^([A-G])([#b]?)(-?\d+)$/i)
  if (!m) return 60
  const pcs = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pc = pcs[m[1].toUpperCase()] ?? 0
  if (m[2] === "#") pc++
  if (m[2] === "b") pc--
  return (Number(m[3]) + 1) * 12 + pc
}

function releasePrevious(app, previous, when) {
  if (!previous || previous.kind === "drum") return
  const opts = Number.isFinite(Number(when)) ? { when: Number(when) } : {}
  if (previous.kind === "sample") {
    app.sampleVoice?.noteOff?.(previous.midi, false, opts)
  } else {
    app.padSynth?.noteOff?.(previous.midi, true, opts)
  }
}

/**
 * A baked sequence lane owns its currently sounding non-drum voice. Retriggering
 * the same lane releases the previous pass first so long samples/synth tails do
 * not survive a pattern wrap and stack with the next iteration.
 *
 * Drums remain one-shots; their short envelopes are intentionally allowed to tail.
 */
export function installSequenceVoiceGuardRuntime(app) {
  if (!app || app._sequenceVoiceGuardRuntimeInstalled) return
  app._sequenceVoiceGuardRuntimeInstalled = true

  const stepSeq = app.stepSeq
  if (!stepSeq?.trigger) return

  const active = new Map()
  const originalTrigger = stepSeq.trigger.bind(stepSeq)
  stepSeq.trigger = (target, options = {}) => {
    const key = laneKey(target, options)
    if (!key) return originalTrigger(target, options)

    const sound = soundById(app, target.soundId)
    const current = {
      kind: sourceKind(sound),
      midi: sourceMidi(target, sound)
    }

    releasePrevious(app, active.get(key), options.when)
    const result = originalTrigger(target, options)
    active.set(key, current)
    return result
  }

  const originalStop = stepSeq.stop?.bind(stepSeq)
  if (originalStop) {
    stepSeq.stop = (...args) => {
      active.clear()
      return originalStop(...args)
    }
  }
}
