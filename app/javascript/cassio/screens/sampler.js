import { knobParamsAt, renderMacroLabels, renderSettingsRows } from "cassio/screens/settings_list"

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
        <div class="muted">A LIBRARY · SYNTH / DRUMS / KITS</div>
        <div class="muted">B SAMPLER · MIC / IMPORT / EDIT</div>
        <div class="muted">C NEW KIT · EMPTY PADS → ASSIGN</div>
        <div class="green" style="margin-top:0.35rem">EDIT SAMPLES → B SAMPLER → OK</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">LIBRARY</span></div>
        <div><span class="sk">B</span> <span class="green">SAMPLER</span></div>
        <div><span class="sk">C</span> <span class="green">NEW KIT</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderSamplerHome(state) {
  const samples = (state.userSamples || []).map((s, i) =>
    `<div class="lib-row ${i === (state.samplerIndex || 0) ? "selected" : ""}">${esc(s.name)}</div>`
  ).join("")
  const sel = (state.userSamples || [])[state.samplerIndex || 0]
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
          <div class="lib-detail-name">${esc(sel?.name || "CAPTURE")}</div>
          <div class="green">PRESS OK → SAMPLE EDIT</div>
          <div class="muted">TRIM · TUNE · EQ · FX</div>
          <div class="muted">▲▼ SELECT · A MIC · B IMPORT</div>
          <div class="muted">C DELETE SELECTED</div>
          <div class="lib-hint">WAV · MP3 · OGG · M4A</div>
        </div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">MIC</span></div>
        <div><span class="sk">B</span> <span class="green">IMPORT</span></div>
        <div><span class="sk">C</span> <span class="green">DEL</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderMicRecord(state) {
  const rec = state.micRecording
  const mon = state.micMonitor
  const gain = Math.round((state.micGain ?? 1) * 100)
  const timer = state.micTimer || "00:00.00"
  const spec = state.micSpectrum || []
  const bars = spec.map((v) => {
    const h = Math.max(4, Math.round(Math.min(1, v) * 100))
    const hot = v > 0.72
    return `<span class="mic-bar ${hot ? "hot" : ""}" style="height:${h}%"></span>`
  }).join("")
  return `
    <div class="lcd-screen mic-record-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${rec ? "● REC" : "MIC RECORD"}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 INPUT ${gain}%</span>
        <span>M2 —</span>
        <span class="green">M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">ONBOARD MIC</div>
        <div class="green">${timer}</div>
        <div class="mic-spectrum">${bars || '<div class="muted">ARMING…</div>'}</div>
        <div class="muted">MONITOR ${mon ? "ON" : "OFF"} · M1 INPUT · M3 MASTER VOL</div>
        <div class="muted">${rec ? "A STOP → GOES TO EDIT / TRIM" : "A REC TO START · D BACK"}</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">${rec ? "STOP" : "REC"}</span></div>
        <div><span class="sk">B</span> <span class="green">MONITOR</span></div>
        <div class="soft-disabled"><span class="sk">C</span> <span class="green">—</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderSampleEdit(state) {
  const d = state.sampleDraft || {}
  const name = d.name || "SAMPLE"
  const dur = d.durationLabel || "—"
  const saved = !!d.sourceId
  const rows = state.sampleEditRows || []
  const idx = state.sampleEditIndex || 0
  const cur = rows[idx]
  const groupLabel = cur ? (cur.kind === "group" ? cur.label : (rows.find((r) => r.kind === "group" && r.id === cur.group)?.label || "")) : ""
  const knobs = knobParamsAt(rows, idx)
  const showWave = !cur || cur.kind !== "param" || cur.group === "sample" || cur.group === "loop" || cur.group === "mix"
  const peaks = state.samplePeaks || []
  const loopOn = !!d.loopOn
  const bars = showWave ? peaks.map((p, i) => {
    const t = peaks.length > 1 ? i / (peaks.length - 1) : 0
    const inRange = t >= (d.trimStart ?? 0) && t <= (d.trimEnd ?? 1)
    const inLoop = loopOn && t >= (d.loopStart ?? 0) && t <= (d.loopEnd ?? 1)
    const h = Math.max(4, Math.round(p * 100))
    return `<span class="sample-peak ${inRange ? "on" : ""} ${inLoop ? "loop" : ""}" style="height:${h}%"></span>`
  }).join("") : ""

  return `
    <div class="lcd-screen sample-edit-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SAMPLE · ${esc(groupLabel)}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        ${renderMacroLabels(knobs, d)}
      </div>
      <div class="edit-body settings-body">
        <div class="sound-name">${esc(name)} <span class="muted">${dur}${saved ? "" : " · UNSAVED"}</span></div>
        ${showWave ? `<div class="sample-wave small">${bars || '<div class="muted">NO WAVE</div>'}</div>` : ""}
        <div class="lib-list settings-list">${renderSettingsRows(rows, idx, d, { visible: showWave ? 5 : 7 })}</div>
        <div class="muted">▲▼ ROW · OK OPEN/CLOSE · ◀▶ CHANGE · KNOBS FOLLOW</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">PLAY</span></div>
        <div><span class="sk">B</span> <span class="green">SAVE…</span></div>
        <div><span class="sk">C</span> <span class="green">ASSIGN</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

export function renderSampleSave(state) {
  const d = state.sampleDraft || {}
  const name = state.saveName || d.name || "SAMPLE"
  const saved = !!d.sourceId
  const dirty = !!d.dirty
  return `
    <div class="lcd-screen sample-save-screen">
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
        <div class="muted">${saved ? "USER / SAMPLES" : "NEW · NOT IN LIBRARY YET"}${dirty ? " · DIRTY" : ""}</div>
        <div class="green" style="margin-top:0.4rem">D SAVE → TRIM / TUNE / EQ / FX</div>
        <div class="muted">B RENAME THIS SAMPLE</div>
        <div class="muted">C SAVE AS → NEW COPY</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">BACK</span></div>
        <div><span class="sk">B</span> <span class="green">RENAME</span></div>
        <div><span class="sk">C</span> <span class="green">SAVE AS</span></div>
        <div><span class="sk">D</span> <span class="green">SAVE</span></div>
      </div>
    </div>
  `
}

export function renderAssignSample(state) {
  const name = state.saveName || state.sampleDraft?.name || "SAMPLE"
  const root = state.sampleDraft?.root || "C3"
  return `
    <div class="lcd-screen assign-sample-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">ASSIGN SAMPLE</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="save-body">
        <div class="sound-name">${esc(name)}</div>
        <div class="muted">ROOT ${esc(root)}</div>
        <div class="green" style="margin-top:0.4rem">A → KEYBOARD (PITCHED)</div>
        <div class="green">B → PAD 1–6 ONLY</div>
        <div class="muted">PAD DOES NOT CHANGE KEYS</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">KEYS</span></div>
        <div><span class="sk">B</span> <span class="green">PAD</span></div>
        <div class="soft-disabled"><span class="sk">C</span> <span class="green">—</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}

/** @deprecated kept so older imports don't break; unused in main flow */
export function renderSaveSample(state) {
  return renderAssignSample(state)
}

/** @deprecated unused in main flow */
export function renderExportPick(_state) {
  return renderAssignSample(_state)
}
