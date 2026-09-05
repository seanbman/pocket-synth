import { noteNameToMidi } from "cassio/voices/glass_poly"
import { patchFromSound, isKit, isDrum, isSample } from "cassio/patch"
import { normalizeTrackLaneSource } from "cassio/track_pattern"

const PAD_DEG = [0, 2, 4, 5, 7, 9]

function soundById(app, id) {
  if (!id) return null
  return app.userSounds?.find((sound) => sound.id === id)
    || app.factory?.sounds?.find((sound) => sound.id === id)
    || null
}

function baseMidi(app) {
  const root = app.project?.root || app.sound?.root || "C3"
  return noteNameToMidi(root) + (Number(app.project?.octave) || 0) * 12
}

/** Freeze the current sound assigned to a physical input pad. */
export function capturePadSequenceSource(app, padNumber) {
  const pad = Math.min(6, Math.max(1, Number(padNumber) | 0))
  const slot = app.project?.pads?.find((entry) => entry.pad === pad)
  const sound = soundById(app, slot?.soundId)
  if (!slot || !sound || isKit(sound) || sound.playable === false) return null
  const patch = patchFromSound(sound, {
    ...(sound.patch || {}),
    ...(slot.patch || {})
  })
  const midi = isSample(sound)
    ? noteNameToMidi(sound.root || sound.patch?.root || patch.root || "C3")
    : baseMidi(app) + PAD_DEG[pad - 1] + 12
  return normalizeTrackLaneSource({
    soundId: sound.id,
    name: sound.name || sound.id,
    level: slot.level ?? 1,
    pan: slot.pan ?? 0,
    mode: slot.mode || sound.padMode || (isDrum(sound) ? "oneshot" : "gate"),
    patch,
    midi,
    fromPad: pad
  })
}

export function captureAllPadSequenceSources(app) {
  return Array.from({ length: 6 }, (_, i) => capturePadSequenceSource(app, i + 1))
}

function sourceGain(app, source, velocity) {
  const kit = Math.min(1, Math.max(0, Number(app.project?.kitVolume ?? 1)))
  const level = Math.min(1.5, Math.max(0, Number(source.level ?? 1)))
  const vel = Math.min(1, Math.max(0, Number(velocity ?? 1)))
  return Math.min(1, kit * level * vel)
}

function synthHoldSec(patch, gateSec) {
  if (Number(gateSec) > 0) return Number(gateSec)
  const attack = Number(patch?.attack) || 0.02
  const release = Number(patch?.release) || 0.4
  return Math.min(2.8, Math.max(0.45, attack + 0.35 + release * 0.45))
}

/** Trigger a captured lane source without consulting the current pad bank. */
export function triggerSequenceLaneSource(app, rawSource, {
  when = null,
  velocity = 1,
  gateSec = null,
  recTrack = null
} = {}) {
  if (!app.engine?.ready) return false
  const source = normalizeTrackLaneSource(rawSource)
  const sound = soundById(app, source.soundId)
  if (!sound || isKit(sound) || sound.playable === false) return false

  const patch = patchFromSound(sound, {
    ...(sound.patch || {}),
    ...(source.patch || {})
  })
  const gain = sourceGain(app, source, velocity)
  const midi = Number.isFinite(Number(source.midi))
    ? Number(source.midi)
    : noteNameToMidi(sound.root || patch.root || "C3")

  if (isDrum(sound)) {
    app.drums.applyPatch(patch)
    app.drums.setPan(source.pan ?? 0)
    app.drums.noteOn(midi, Math.min(1, 0.95 * gain), { when, recTrack })
    return true
  }

  if (isSample(sound)) {
    app.sampler.loadBufferForSound(sound)
    app.sampleVoice.applyPatch(patch)
    app.sampleVoice.setPan(source.pan ?? 0)
    app.sampleVoice.noteOn(midi, Math.min(1, 0.95 * gain), { when, recTrack })
    if (source.mode === "gate" && gateSec) {
      app.sampleVoice.noteOff(midi, false, {
        when: (when ?? app.engine.now()) + Number(gateSec)
      })
    }
    return true
  }

  app.padSynth.applyPatch(patch)
  app.padSynth.setPan(source.pan ?? 0)
  app.padSynth.noteOn(midi, Math.min(1, 0.9 * gain), { when, recTrack })
  app.padSynth.noteOff(midi, false, {
    when: (when ?? app.engine.now()) + synthHoldSec(patch, gateSec)
  })
  return true
}
