import { Controller } from "@hotwired/stimulus"
import { CassioApp } from "cassio/app"
import { VoiceRegistry } from "cassio/voices/registry"
import { installDeepAudioTrace } from "cassio/debug_audio_hooks"
import { installPlayRecordLaneRuntime } from "cassio/play_record_lane_runtime"
import { installRecordingRuntime } from "cassio/recording_runtime"
import { installSequenceVoiceGuardRuntime } from "cassio/sequence_voice_guard_runtime"
import { installSequencerUxRuntime } from "cassio/sequencer_ux_runtime"
import { installTrackNamingRuntime } from "cassio/track_naming_runtime"
import { installTrackPatternRuntime } from "cassio/track_pattern_runtime"
import {
  audioSnapshot,
  flushDebug,
  installAudioTrace,
  installGlobalDebugHooks,
  trace
} from "cassio/debug_trace"

export default class extends Controller {
  connect() {
    installGlobalDebugHooks()
    trace("app", "cassio.construct.before")

    try {
      this.app = new CassioApp(this.element)
      this.app.voices = new VoiceRegistry({
        synth: this.app.synth,
        drums: this.app.drums,
        sample: this.app.sampleVoice,
        loadSample: (sound) => this.app.sampler.loadBufferForSound(sound)
      })
      installTrackPatternRuntime(this.app)
      installSequenceVoiceGuardRuntime(this.app)
      installSequencerUxRuntime(this.app)
      installTrackNamingRuntime(this.app)
      installPlayRecordLaneRuntime(this.app)
      installRecordingRuntime(this.app)
      installAudioTrace(this.app)
      installDeepAudioTrace(this.app)

      window.addEventListener("pagehide", () => {
        trace("app", "persist.pagehide.before", { audio: audioSnapshot(this.app) })
        this.app?.flushPersist?.()
        void flushDebug({ beacon: true })
      })

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") return
        trace("app", "persist.visibility.before", { audio: audioSnapshot(this.app) })
        this.app?.flushPersist?.()
        void flushDebug({ beacon: true })
      })

      trace("app", "cassio.construct.after", { audio: audioSnapshot(this.app) })
    } catch (error) {
      trace("error", "cassio.construct.failed", { error }, "error")
      void flushDebug()
      throw error
    }
  }
}
