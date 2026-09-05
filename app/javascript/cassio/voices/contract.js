const REQUIRED_METHODS = ["applyPatch", "noteOn", "noteOff", "allNotesOff"]

/**
 * Runtime contract for anything Cassio can play as a voice.
 * JavaScript stays duck-typed; this helper makes the boundary explicit and testable.
 */
export function assertPlayableVoice(voice, label = "voice") {
  if (!voice || typeof voice !== "object") {
    throw new TypeError(`${label} must be an object`)
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof voice[method] !== "function") {
      throw new TypeError(`${label} must implement ${method}()`)
    }
  }
  return voice
}

export function supportsPitchBend(voice) {
  return typeof voice?.setPitchBend === "function"
}
