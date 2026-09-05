function laneHasMaterial(loopEngine, lane) {
  if (!lane?.assigned) return false
  if (typeof loopEngine.laneHasClip === "function") return !!loopEngine.laneHasClip(lane)
  if (lane.buffer || lane.pattern) return true
  return !!lane.seq?.steps?.some?.((step) => step?.on)
}

function playSoundName(app) {
  const sound = app?.sound
  if (!sound || sound.kind === "kit" || sound.voice === "kit") return null
  const name = String(sound.name || "").trim().toUpperCase().slice(0, 18)
  return name || null
}

/**
 * REC from the main PLAY screen behaves like a performance capture workflow:
 * if the currently selected lane already contains material, create and select a
 * fresh arrangement lane before arming. LOOP-screen REC keeps its existing
 * overdub/replace semantics on the selected lane.
 */
export function installPlayRecordLaneRuntime(app) {
  if (!app || app._playRecordLaneRuntimeInstalled) return
  app._playRecordLaneRuntimeInstalled = true

  const loopEngine = app.loopEngine
  if (!loopEngine?.armForRecord) return

  const originalArm = loopEngine.armForRecord.bind(loopEngine)
  loopEngine.armForRecord = (trackId = loopEngine.selected) => {
    let targetId = trackId
    const current = loopEngine.tracks?.find?.((lane) => lane.id === targetId) || loopEngine.selectedTrack
    const freshCapture = app.screen === "play" && !loopEngine.recording

    if (freshCapture && laneHasMaterial(loopEngine, current)) {
      const lane = loopEngine.addLane?.()
      if (lane) {
        loopEngine.select?.(lane.id)
        const prepared = loopEngine.ensureLaneForRecord?.({ name: playSoundName(app) }) || lane
        if (prepared?.assigned) {
          targetId = prepared.id
          app._lastPlayRecordLaneId = prepared.id
          app.persistLoop?.()
          app.toast?.(`NEW LANE ${prepared.id} · REC`)
        }
      }
    }

    return originalArm(targetId)
  }
}
