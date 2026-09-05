import {
  cloneTrackPattern,
  sanitizeTrackPattern
} from "cassio/track_pattern"
import {
  captureAllPadSequenceSources,
  capturePadSequenceSource,
  triggerSequenceLaneSource
} from "cassio/sequence_lane_source"

function patternMap(items = []) {
  return new Map((items || []).filter(Boolean).map((item) => [item.id, item.pattern || null]))
}

function restorePattern(raw, fallback, padSources) {
  const pattern = raw || fallback
  return pattern ? cloneTrackPattern(pattern, { padSources }) : null
}

/**
 * Bridges the new arbitrary-lane track-pattern model across the existing loop
 * library/arrangement serializer without changing the global six-pad A-D bank.
 */
export function installTrackPatternRuntime(app) {
  if (!app || app._trackPatternRuntimeInstalled) return
  app._trackPatternRuntimeInstalled = true

  const loopEngine = app.loopEngine
  const stepSeq = app.stepSeq
  const originalTrigger = stepSeq.trigger

  app.captureSequencePadSource = (padNumber) => capturePadSequenceSource(app, padNumber)
  app.captureAllSequencePadSources = () => captureAllPadSequenceSources(app)
  app.triggerSequenceLaneSource = (source, options = {}) => triggerSequenceLaneSource(app, source, options)

  stepSeq.trigger = (target, options = {}) => {
    if (target && typeof target === "object") {
      return triggerSequenceLaneSource(app, target, options)
    }
    return originalTrigger?.(target, options)
  }

  const originalApplyState = loopEngine.applyState.bind(loopEngine)
  loopEngine.applyState = (loop) => {
    const rawLibrary = patternMap(loop?.trackLibrary)
    const rawArrangement = patternMap(loop?.arrangement?.lanes)
    const rawLegacy = patternMap(loop?.tracks)
    originalApplyState(loop)
    const padSources = captureAllPadSequenceSources(app)

    for (const entry of loopEngine.library || []) {
      const raw = rawLibrary.get(entry.id)
      entry.pattern = restorePattern(raw, entry.pattern, padSources)
    }
    for (const track of loopEngine.tracks || []) {
      const raw = rawArrangement.get(track.id) || rawLegacy.get(track.id)
      track.pattern = restorePattern(raw, track.pattern, padSources)
    }
  }

  const originalSerialize = loopEngine.serialize.bind(loopEngine)
  loopEngine.serialize = () => {
    const out = originalSerialize()
    const library = new Map((loopEngine.library || []).map((entry) => [entry.id, entry]))
    const tracks = new Map((loopEngine.tracks || []).map((track) => [track.id, track]))

    for (const stored of out.trackLibrary || []) {
      const live = library.get(stored.id)
      if (live?.pattern) stored.pattern = cloneTrackPattern(live.pattern)
    }
    for (const stored of out.arrangement?.lanes || []) {
      const live = tracks.get(stored.id)
      if (live?.pattern) stored.pattern = cloneTrackPattern(live.pattern)
    }
    for (const stored of out.tracks || []) {
      const live = tracks.get(stored.id)
      if (live?.pattern) stored.pattern = cloneTrackPattern(live.pattern)
    }
    return out
  }

  const originalAssign = loopEngine.assignLibraryToLane.bind(loopEngine)
  loopEngine.assignLibraryToLane = (laneId, libraryId) => {
    const entry = loopEngine.getLibraryTrack(libraryId)
    const dynamic = entry?.pattern ? cloneTrackPattern(entry.pattern) : null
    const ok = originalAssign(laneId, libraryId)
    const lane = loopEngine.tracks.find((track) => track.id === laneId)
    if (ok && lane && dynamic) lane.pattern = dynamic
    return ok
  }

  const originalSave = loopEngine.saveLaneToLibrary.bind(loopEngine)
  loopEngine.saveLaneToLibrary = (laneId = loopEngine.selected, options = {}) => {
    const lane = loopEngine.tracks.find((track) => track.id === laneId)
    const dynamic = lane?.pattern ? cloneTrackPattern(lane.pattern) : null
    const entry = originalSave(laneId, options)
    if (entry && dynamic) entry.pattern = cloneTrackPattern(dynamic)
    return entry
  }

  const originalDrop = loopEngine.dropPatternOnLane.bind(loopEngine)
  loopEngine.dropPatternOnLane = (laneId = loopEngine.selected, pattern, options = {}) => {
    const lane = originalDrop(laneId, pattern, options)
    if (lane?.pattern) {
      lane.pattern = sanitizeTrackPattern(lane.pattern, {
        padSources: captureAllPadSequenceSources(app)
      })
    }
    return lane
  }

  const originalPreview = app.previewLibraryTrack?.bind(app)
  if (originalPreview) {
    app.previewLibraryTrack = (entry, origin) => {
      const dynamic = entry?.pattern ? cloneTrackPattern(entry.pattern) : null
      originalPreview(entry, origin)
      const preview = app._libPreviewTracks?.[0]
      if (preview && dynamic) {
        preview.pattern = dynamic
        if (preview.seq) preview.seq.enabled = false
        if (app.stepSeq.running) app.stepSeq.resync(origin)
      }
    }
  }
}
