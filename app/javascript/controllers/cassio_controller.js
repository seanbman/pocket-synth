import { Controller } from "@hotwired/stimulus"
import { CassioApp } from "cassio/app"
import { installDeepAudioTrace } from "cassio/debug_audio_hooks"
import { installPlayRecordLaneRuntime } from "cassio/play_record_lane_runtime"
import { installProjectRuntime } from "cassio/project_runtime"
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

function debugTracingEnabled() {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get("debug") === "1" || window.localStorage?.getItem("cassio.debug") === "1"
  } catch (_) {
    return false
  }
}

export default class extends Controller {
  connect() {
    const debug = debugTracingEnabled()
    if (debug) {
      installGlobalDebugHooks()
      trace("app", "cassio.construct.before")
    }

    try {
      this.app = new CassioApp(this.element)
      installTrackPatternRuntime(this.app)
      installSequenceVoiceGuardRuntime(this.app)
      installSequencerUxRuntime(this.app)
      installTrackNamingRuntime(this.app)
      installPlayRecordLaneRuntime(this.app)
      installRecordingRuntime(this.app)
      installProjectRuntime(this.app)

      // Deep audio instrumentation is intentionally opt-in. The source watcher,
      // transport wrappers and periodic probes are useful for diagnosis, but they
      // must never run in the normal performance path on constrained phones.
      if (debug) {
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
      }
    } catch (error) {
      if (debug) {
        trace("error", "cassio.construct.failed", { error }, "error")
        void flushDebug()
      }
      throw error
    }
  }
}
