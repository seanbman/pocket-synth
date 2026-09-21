const NOTE_INDEX = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4,
  F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9,
  "A#": 10, BB: 10, B: 11
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0))

function noteNameToMidi(value = "C3") {
  const match = String(value).trim().toUpperCase().match(/^([A-G](?:#|B)?)(-?\d+)$/)
  if (!match) return 60
  const pitch = NOTE_INDEX[match[1]]
  if (pitch == null) return 60
  return (Number(match[2]) + 1) * 12 + pitch
}

function sourceSignature(source) {
  if (!source || typeof source !== "object") return ""
  return [
    source.soundId || "",
    Number.isFinite(Number(source.midi)) ? Number(source.midi) : "",
    source.fromPad || "",
    source.mode || "",
    source.name || ""
  ].join("|")
}

export function findTrackForSequenceSource(app, source, options = {}) {
  const tracks = app?.loopEngine?.tracks || []
  const explicitId = Number(options.trackId)
  if (Number.isFinite(explicitId)) {
    return tracks.find((track) => track.id === explicitId) || null
  }

  const laneId = options.laneId
  if (laneId) {
    const byLaneId = tracks.find((track) => track.pattern?.laneIds?.includes?.(laneId))
    if (byLaneId) return byLaneId
  }

  if (source && typeof source === "object") {
    const identity = tracks.find((track) => track.pattern?.sources?.some?.((item) => item === source))
    if (identity) return identity

    const signature = sourceSignature(source)
    if (signature) {
      const candidates = tracks.filter((track) =>
        track.pattern?.sources?.some?.((item) => sourceSignature(item) === signature)
      )
      if (candidates.length === 1) return candidates[0]
      if (candidates.length > 1 && app?.seqTrackId != null) {
        return candidates.find((track) => track.id === app.seqTrackId) || candidates[0]
      }
    }
  }

  const modeTrackId = app?.stepSeq?._mode === "track" ? Number(app.stepSeq?._trackId) : NaN
  if (Number.isFinite(modeTrackId)) {
    return tracks.find((track) => track.id === modeTrackId) || null
  }

  if (app?.seqTrackId != null) {
    return tracks.find((track) => track.id === Number(app.seqTrackId)) || null
  }

  return null
}

export function mixSequenceSourceForTrack(app, source, track) {
  if (!source || typeof source !== "object" || !track?.assigned) return source

  const anySolo = (app?.loopEngine?.tracks || []).some((candidate) => candidate.assigned && candidate.solo)
  const audible = !track.mute && (!anySolo || track.solo)
  if (!audible) return null

  const sourceLevel = clamp(source.level ?? 1, 0, 1.5)
  const trackLevel = clamp(track.level ?? track.fx?.level ?? 1, 0, 1.5)
  const sourcePan = clamp(source.pan ?? 0, -1, 1)
  const trackPan = clamp(track.pan ?? track.fx?.pan ?? 0, -1, 1)

  return {
    ...source,
    level: Math.min(1.5, sourceLevel * trackLevel),
    pan: clamp(sourcePan + trackPan, -1, 1)
  }
}

export function hasRecordedTrackAudio(track) {
  return !!(track?.assigned && track.buffer)
}

function stopSamplePreview(app, { toast = true } = {}) {
  const midi = app?._pocket_synthSamplePreviewMidi
  if (midi == null) return false

  try { app.sampleVoice?.noteOff?.(midi, true) } catch (_) { /* already stopped */ }
  if (app._pocket_synthSamplePreviewTimer) clearTimeout(app._pocket_synthSamplePreviewTimer)
  app._pocket_synthSamplePreviewTimer = null
  app._pocket_synthSamplePreviewMidi = null
  if (toast) app.toast?.("PREVIEW STOPPED")
  return true
}

function decoratePreviewControl(app) {
  if (app.screen !== "sample-edit") {
    stopSamplePreview(app, { toast: false })
    return
  }

  const label = app.root?.querySelector?.(".sample-edit-screen .lcd-soft > div:first-child .green")
  if (label) label.textContent = app._pocket_synthSamplePreviewMidi == null ? "PLAY" : "STOP"
}

function stopTextEntryPropagation(input) {
  if (!input || input.dataset.pocket_synthKeyIsolation === "1") return
  input.dataset.pocket_synthKeyIsolation = "1"
  const stop = (event) => event.stopPropagation()
  input.addEventListener("keydown", stop)
  input.addEventListener("keyup", stop)
  input.addEventListener("keypress", stop)
}

function decorateTextEntry(app) {
  const root = app.root
  if (!root?.querySelectorAll) return
  root.querySelectorAll("input, textarea, [contenteditable='true']").forEach(stopTextEntryPropagation)
}

function recordedAudioCells(page, length) {
  const cells = []
  const start = Math.max(0, Number(page) || 0) * 16
  const total = Math.max(16, Number(length) || 16)
  for (let column = 0; column < 16; column++) {
    const active = start + column < total
    const classes = [
      "seq-cell",
      "recorded-audio",
      active ? "on" : "off-range",
      column % 4 === 0 ? "beat" : ""
    ].filter(Boolean).join(" ")
    cells.push(`<span class="${classes}" data-seq-col="${column}" title="RECORDED AUDIO"></span>`)
  }
  return cells.join("")
}

function decorateRecordedAudioLane(app) {
  if (app.screen !== "sequencer" || app.seqTrackId == null) return
  const track = app.loopEngine?.tracks?.find?.((item) => item.id === Number(app.seqTrackId))
  if (!hasRecordedTrackAudio(track)) return

  const grid = app.root?.querySelector?.(".sequencer-screen .seq-grid")
  if (!grid || grid.querySelector(".seq-audio-row")) return

  const empty = [...grid.querySelectorAll(".seq-row.empty")].pop()
  empty?.remove()

  const row = document.createElement("div")
  row.className = "seq-row seq-audio-row"
  row.setAttribute("aria-label", "Recorded synth audio lane")
  const patternLength = Math.max(
    Number(track.pattern?.length) || 0,
    Number(track.seq?.length) || 0,
    Math.max(1, Number(track.lengthBars) || 1) * 16
  )
  row.innerHTML = `<span class="seq-lane-n">R</span>${recordedAudioCells(app.seqPage, patternLength)}`
  grid.prepend(row)

  const header = app.root.querySelector(".sequencer-screen .seq-header .pink:last-of-type")
  if (header && !header.textContent.includes("REC AUDIO")) header.textContent += " · REC AUDIO"

  const hint = app.root.querySelector(".sequencer-screen .seq-hint")
  if (hint && !hint.textContent.includes("R = REC AUDIO")) hint.textContent = `R = REC AUDIO · ${hint.textContent}`
}

function applyTrackChainImmediately(app, trackId) {
  const track = app?.loopEngine?.tracks?.find?.((item) => item.id === Number(trackId))
  const chain = app?.loopEngine?.trackChain?.(trackId)
  const ctx = app?.engine?.ctx
  if (!track || !chain || !ctx) return

  const level = clamp(track.level ?? track.fx?.level ?? 1, 0, 1.5)
  const pan = clamp(track.pan ?? track.fx?.pan ?? 0, -1, 1)
  try {
    chain.apply?.({ ...(track.fx || {}), level, pan })
    chain.level?.gain?.cancelScheduledValues?.(ctx.currentTime)
    chain.level?.gain?.setValueAtTime?.(level, ctx.currentTime)
    chain.pan?.pan?.cancelScheduledValues?.(ctx.currentTime)
    chain.pan?.pan?.setValueAtTime?.(pan, ctx.currentTime)
  } catch (_) { /* graph may still be starting */ }
}

export function installUserReportRegressionRuntime(app) {
  if (!app || app._userReportRegressionRuntimeInstalled) return
  app._userReportRegressionRuntimeInstalled = true

  const sampler = app.sampler
  if (sampler?.preview) {
    const originalPreview = sampler.preview.bind(sampler)
    sampler.preview = async () => {
      if (app._pocket_synthSamplePreviewMidi != null) {
        stopSamplePreview(app)
        app.render?.()
        return false
      }

      const result = await originalPreview()
      if (!app.sampleBuffer || !app.sampleDraft || !app.sampleVoice?.activeCount) return result

      const midi = noteNameToMidi(app.sampleDraft.root || "C3")
      app._pocket_synthSamplePreviewMidi = midi
      app.render?.()

      const loops = !!app.sampleDraft.loopOn || !!app.sampleDraft.stutter
      if (!loops) {
        const seconds = Math.max(0.05, Number(app.sampleVoice.playSeconds?.(midi)) || 0.05)
        app._pocket_synthSamplePreviewTimer = setTimeout(() => {
          if (app._pocket_synthSamplePreviewMidi !== midi) return
          app._pocket_synthSamplePreviewMidi = null
          app._pocket_synthSamplePreviewTimer = null
          if (app.screen === "sample-edit") app.render?.()
        }, seconds * 1000 + 100)
      }
      return result
    }
  }

  const promptFn = app.trackNamePrompt
    || (typeof window !== "undefined" && typeof window.prompt === "function"
      ? window.prompt.bind(window)
      : null)
  if (promptFn) {
    app.trackNamePrompt = (...args) => {
      app._pocket_synthTextEntryActive = true
      try {
        return promptFn(...args)
      } finally {
        app._pocket_synthTextEntryActive = false
      }
    }
  }

  if (typeof window !== "undefined") {
    const guardPromptKeys = (event) => {
      if (!app._pocket_synthTextEntryActive) return
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", guardPromptKeys, true)
    window.addEventListener("keyup", guardPromptKeys, true)
  }

  const baseTrigger = app.triggerSequenceLaneSource?.bind(app)
  if (baseTrigger) {
    app.triggerSequenceLaneSource = (source, options = {}) => {
      const track = findTrackForSequenceSource(app, source, options)
      const mixed = track ? mixSequenceSourceForTrack(app, source, track) : source
      if (!mixed) return false
      return baseTrigger(mixed, options)
    }
  }

  if (app.stepSeq?.trigger) {
    const baseStepTrigger = app.stepSeq.trigger.bind(app.stepSeq)
    app.stepSeq.trigger = (target, options = {}) => {
      if (!target || typeof target !== "object") return baseStepTrigger(target, options)
      const track = findTrackForSequenceSource(app, target, options)
      const mixed = track ? mixSequenceSourceForTrack(app, target, track) : target
      if (!mixed) return false
      return baseStepTrigger(mixed, { ...options, trackId: track?.id ?? options.trackId })
    }
  }

  const loopEngine = app.loopEngine
  if (loopEngine?.setTrackLevel) {
    const baseSetLevel = loopEngine.setTrackLevel.bind(loopEngine)
    loopEngine.setTrackLevel = (trackId, level) => {
      const result = baseSetLevel(trackId, level)
      applyTrackChainImmediately(app, trackId || loopEngine.selected)
      return result
    }
  }
  if (loopEngine?.setTrackPan) {
    const baseSetPan = loopEngine.setTrackPan.bind(loopEngine)
    loopEngine.setTrackPan = (trackId, pan) => {
      const result = baseSetPan(trackId, pan)
      applyTrackChainImmediately(app, trackId || loopEngine.selected)
      return result
    }
  }

  const baseRender = app.render?.bind(app)
  if (baseRender) {
    app.render = (...args) => {
      const result = baseRender(...args)
      queueMicrotask(() => {
        decorateTextEntry(app)
        decoratePreviewControl(app)
        decorateRecordedAudioLane(app)
      })
      return result
    }
  }

  queueMicrotask(() => {
    decorateTextEntry(app)
    decoratePreviewControl(app)
    decorateRecordedAudioLane(app)
  })
}
