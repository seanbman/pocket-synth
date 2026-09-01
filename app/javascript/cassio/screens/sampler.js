function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderSoundHub(state) {
  return `
    <div class="lcd-screen sound-hub-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SOUND</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">SOUND AREA</div>
        <div class="muted">LIBRARY · SYNTH / DRUMS / KITS</div>
        <div class="muted">SAMPLER · MIC / FILE / USER SAMPLES</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">LIBRARY</span></div>
        <div><span class="sk">B</span> <span class="green">SAMPLER</span></div>
        <div class="soft-disabled"><span class="sk">C</span> <span class="green">—</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderSamplerHome(state) {
  const samples = (state.userSamples || []).map((s, i) =>
    `<div class="lib-row ${i === (state.samplerIndex || 0) ? "selected" : ""}">${esc(s.name)}</div>`
  ).join("")
  return `
    <div class="lcd-screen sampler-home-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SAMPLER</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="lib-body">
        <div class="lib-list-pane">
          <div class="pink lib-cat">USER / SAMPLES</div>
          <div class="lib-list">${samples || '<div class="muted">NO SAMPLES YET</div>'}</div>
        </div>
        <div class="lib-detail-box">
          <div class="lib-detail-name">CAPTURE</div>
          <div class="muted">A MIC RECORD</div>
          <div class="muted">B IMPORT FILE</div>
          <div class="muted">C OPEN SELECTED</div>
          <div class="lib-hint">WAV · MP3 · OGG · M4A</div>
        </div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">MIC</span></div>
        <div><span class="sk">B</span> <span class="green">FILE</span></div>
        <div><span class="sk">C</span> <span class="green">OPEN</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderMicRecord(state) {
  const rec = state.micRecording
  const mon = state.micMonitor
  const gain = Math.round((state.micGain ?? 0.8) * 100)
  const level = Math.round((state.micLevel ?? 0) * 100)
  const timer = state.micTimer || "00:00.00"
  return `
    <div class="lcd-screen mic-record-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${rec ? "● REC" : "MIC RECORD"}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 GAIN ${gain}%</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">ONBOARD MIC</div>
        <div class="green">${timer}</div>
        <div class="edit-meter">
          <div class="muted">LEVEL</div>
          <div class="meter-track"><div class="meter-fill" style="width:${level}%"></div></div>
        </div>
        <div class="muted">MONITOR ${mon ? "ON" : "OFF"} · A = REC STARTS MIC PROMPT</div>
        <div class="muted">D → EDIT AFTER TAKE</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">${rec ? "STOP" : "REC"}</span></div>
        <div><span class="sk">B</span> <span class="green">MONITOR</span></div>
        <div class="soft-disabled"><span class="sk">C</span> <span class="green">—</span></div>
        <div><span class="sk">D</span> <span class="green">${state.sampleDraft ? "EDIT" : "BACK"}</span></div>
      </div>
    </div>
  `
}

export function renderSampleEdit(state) {
  const name = state.sampleDraft?.name || "SAMPLE"
  const start = Math.round((state.sampleDraft?.trimStart ?? 0) * 100)
  const end = Math.round((state.sampleDraft?.trimEnd ?? 1) * 100)
  const dur = state.sampleDraft?.durationLabel || "—"
  const mode = state.sampleDraft?.padMode || "oneshot"
  const root = state.sampleDraft?.root || "C3"
  const peaks = state.samplePeaks || []
  const bars = peaks.map((p, i) => {
    const t = peaks.length > 1 ? i / (peaks.length - 1) : 0
    const inRange = t >= (state.sampleDraft?.trimStart ?? 0) && t <= (state.sampleDraft?.trimEnd ?? 1)
    const h = Math.max(4, Math.round(p * 100))
    return `<span class="sample-peak ${inRange ? "on" : ""}" style="height:${h}%"></span>`
  }).join("")
  return `
    <div class="lcd-screen sample-edit-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SAMPLE EDIT</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 START ${start}%</span>
        <span>M2 END ${end}%</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">${esc(name)}</div>
        <div class="sample-wave">${bars || '<div class="muted">NO WAVE</div>'}</div>
        <div class="muted">${dur} · ROOT ${esc(root)} · ${esc(mode).toUpperCase()}</div>
        <div class="muted">LEFT/RIGHT ROOT · UP/DOWN MODE</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">PLAY</span></div>
        <div><span class="sk">B</span> <span class="green">EXPORT</span></div>
        <div><span class="sk">C</span> <span class="green">SAVE</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderSaveSample(state) {
  const name = state.saveName || state.sampleDraft?.name || "SAMPLE"
  const fmt = (state.exportFormat || "wav").toUpperCase()
  return `
    <div class="lcd-screen save-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SAVE SAMPLE</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="save-body">
        <div class="sound-name">${esc(name)}</div>
        <div class="muted">SAVES TO USER / SAMPLES</div>
        <div class="green">PLAYABLE ON KEYS + PADS</div>
        <div class="muted">EXPORT FORMAT: ${esc(fmt)}</div>
        <div class="save-name-line"><span class="muted">NAME</span> <span class="green">${esc(name)}</span></div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">CANCEL</span></div>
        <div><span class="sk">B</span> <span class="green">NAME</span></div>
        <div><span class="sk">C</span> <span class="green">FORMAT</span></div>
        <div><span class="sk">D</span> <span class="green">SAVE</span></div>
      </div>
    </div>
  `
}

export function renderExportPick(state) {
  const formats = ["wav", "mp3", "m4a"]
  const idx = Math.max(0, formats.indexOf(state.exportFormat || "wav"))
  const rows = formats.map((f, i) =>
    `<div class="lib-row ${i === idx ? "selected" : ""}">${f.toUpperCase()}</div>`
  ).join("")
  return `
    <div class="lcd-screen export-pick-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">EXPORT FORMAT</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="lib-list">${rows}</div>
        <div class="muted">OK / A DOWNLOAD · D BACK</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">EXPORT</span></div>
        <div class="soft-disabled"><span class="sk">B</span> <span class="green">—</span></div>
        <div class="soft-disabled"><span class="sk">C</span> <span class="green">—</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}
