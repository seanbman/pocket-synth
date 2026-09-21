import { Controller } from "@hotwired/stimulus"
import { PocketSynthApp } from "pocket_synth/app"
import { installDeepAudioTrace } from "pocket_synth/debug_audio_hooks"
import { installInputFeedbackRuntime } from "pocket_synth/input_feedback_runtime"
import { errorBreadcrumb, installErrorReporter, reportError } from "pocket_synth/error_reporter"
import { installPlayRecordLaneRuntime } from "pocket_synth/play_record_lane_runtime"
import { installPostPr12StabilizationRuntime } from "pocket_synth/post_pr12_stabilization_runtime"
import { installProjectAudioExportRuntime } from "pocket_synth/project_audio_export_runtime"
import { installProjectRuntime } from "pocket_synth/project_runtime"
import { installRecordingRuntime } from "pocket_synth/recording_runtime"
import { installSequenceVoiceGuardRuntime } from "pocket_synth/sequence_voice_guard_runtime"
import { installSequencerUxRuntime } from "pocket_synth/sequencer_ux_runtime"
import { installSettingsBridgeRuntime } from "pocket_synth/settings_bridge_runtime"
import { installSettingsRuntime } from "pocket_synth/settings_runtime"
import { showStartupFailure } from "pocket_synth/startup_guard"
import { installTrackNamingRuntime } from "pocket_synth/track_naming_runtime"
import { installTrackPatternRuntime } from "pocket_synth/track_pattern_runtime"
import { installUserReportRegressionRuntime } from "pocket_synth/user_report_regression_runtime"
import {
  audioSnapshot,
  flushDebug,
  installAudioTrace,
  installGlobalDebugHooks,
  trace
} from "pocket_synth/debug_trace"

function debugTracingEnabled() {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get("debug") === "1" || window.localStorage?.getItem("pocket_synth.debug") === "1"
  } catch (_) {
    return false
  }
}

export default class extends Controller {
  connect() {
    installErrorReporter()
    errorBreadcrumb("pocket_synth.connect")

    const debug = debugTracingEnabled()
    if (debug) {
      installGlobalDebugHooks()
      trace("app", "pocket_synth.construct.before")
    }

    try {
      errorBreadcrumb("pocket_synth.construct.before")
      this.app = new PocketSynthApp(this.element)
      installTrackPatternRuntime(this.app)
      installSequenceVoiceGuardRuntime(this.app)
      installSequencerUxRuntime(this.app)
      installTrackNamingRuntime(this.app)
      installPlayRecordLaneRuntime(this.app)
      installRecordingRuntime(this.app)
      // Install before ProjectRuntime so its capture/render extensions can
      // intercept PROJECT Manage without modifying the stable persistence core.
      installProjectAudioExportRuntime(this.app)
      installProjectRuntime(this.app)
      installSettingsRuntime(this.app)
      installSettingsBridgeRuntime(this.app)
      installInputFeedbackRuntime(this.app)
      installPostPr12StabilizationRuntime(this.app)
      // User-testing fixes are installed last so they can bridge the final
      // sampler, project, sequencer and mixer wrappers without rewriting them.
      installUserReportRegressionRuntime(this.app)

      // Deep audio instrumentation is intentionally opt-in. The source watcher,
      // transport wrappers and periodic probes are useful for diagnosis, but they
      // must never run in the normal performance path on constrained phones.
      errorBreadcrumb("pocket_synth.construct.after")

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
          void flushDebug()
        })

        trace("app", "pocket_synth.construct.after", { audio: audioSnapshot(this.app) })
      }
    } catch (error) {
      errorBreadcrumb("pocket_synth.construct.failed")
      void reportError(error, { kind: "startup" })
      if (debug) {
        trace("error", "pocket_synth.construct.failed", { error }, "error")
        void flushDebug()
      }
      showStartupFailure(this.element, error)
    }
  }
}
