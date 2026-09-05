import { isDrum, isSample } from "cassio/patch"
import { assertPlayableVoice, supportsPitchBend } from "cassio/voices/contract"

/**
 * Resolves sound metadata to a playable voice without exposing concrete voice
 * classes to callers. Sample loading remains injected because storage belongs to
 * the sampler/library boundary rather than the audio voice itself.
 */
export class VoiceRegistry {
  constructor({ synth, drums, sample, loadSample = null }) {
    this.synth = assertPlayableVoice(synth, "synth voice")
    this.drums = assertPlayableVoice(drums, "drum voice")
    this.sample = assertPlayableVoice(sample, "sample voice")
    this.loadSample = typeof loadSample === "function" ? loadSample : null
  }

  kindFor(sound) {
    if (isDrum(sound)) return "drum"
    if (isSample(sound)) return "sample"
    return "synth"
  }

  voiceFor(sound) {
    const kind = this.kindFor(sound)
    if (kind === "drum") return this.drums
    if (kind === "sample") return this.sample
    return this.synth
  }

  prepare(sound, patch = null) {
    const voice = this.voiceFor(sound)
    if (this.kindFor(sound) === "sample") this.loadSample?.(sound)
    if (patch) voice.applyPatch(patch)
    return voice
  }

  noteOn(sound, midi, velocity = 0.85, options = {}) {
    const voice = this.voiceFor(sound)
    return voice.noteOn(midi, velocity, options)
  }

  noteOff(sound, midi, immediate = false, options = {}) {
    const voice = this.voiceFor(sound)
    return voice.noteOff(midi, immediate, options)
  }

  allNotesOff() {
    this.synth.allNotesOff()
    this.drums.allNotesOff()
    this.sample.allNotesOff()
  }

  setPitchBend(sound, semitones) {
    const voice = this.voiceFor(sound)
    if (supportsPitchBend(voice)) voice.setPitchBend(semitones)
  }
}
