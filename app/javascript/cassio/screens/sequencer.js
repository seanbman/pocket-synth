function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

const PAGE = 16
const VISIBLE_LANES = 6

/** Screen 24: six-row viewport over a global or track-owned step grid. */
export function renderSequencer(state) {
  const seq = state.seq || { current: "A", length: 16, swing: 0, gate: 0.5, lanes: [] }
  const lane = state.seqLane || 0
  const laneCount = Number.isFinite(state.seqLaneCount) ? state.seqLaneCount : (seq.lanes?.length || 0)
  const laneOffset = state.seqLaneOffset || 0
  const cursor = state.seqCursor || 0
  const page = state.seqPage || 0
  const pages = Math.max(1, Math.ceil(seq.length / PAGE))
  const header = !!state.seqHeader
  const shift = !!state.seqShiftMode
  const names = state.seqLaneNames || []
  const ph = state.seqPlayhead ?? -1
  const phCol = ph >= 0 && Math.floor(ph / PAGE) === page ? ph % PAGE : -1
  const cursorCol = cursor % PAGE
  const trackId = state.seqTrackId
  const trackMode = trackId != null

  const rows = []
  for (let visible = 0; visible < VISIBLE_LANES; visible++) {
    const laneIndex = trackMode ? laneOffset + visible : visible
    const exists = laneIndex < laneCount
    const steps = exists ? (seq.lanes?.[laneIndex] || []) : []
    const cells = []
    for (let c = 0; c < PAGE; c++) {
      const i = page * PAGE + c
      const step = steps[i]
      const cls = [
        "seq-cell",
        step?.on ? "on" : "",
        step?.accent ? "accent" : "",
        step?.tie ? "tie" : "",
        exists && laneIndex === lane ? "lane-sel" : "",
        exists && !header && laneIndex === lane && c === cursorCol ? "cursor" : "",
        exists && c === phCol ? "playhead" : "",
        c % 4 === 0 ? "beat" : "",
        !exists || i >= seq.length ? "off-range" : ""
      ].filter(Boolean).join(" ")
      cells.push(`<span class="${cls}" data-seq-col="${c}"></span>`)
    }
    const rowCls = ["seq-row", exists && laneIndex === lane ? "sel" : "", !exists ? "empty" : ""].filter(Boolean).join(" ")
    rows.push(`<div class="${rowCls}"><span class="seq-lane-n">${exists ? laneIndex + 1 : "·"}</span>${cells.join("")}</div>`)
  }

  const headerCls = header ? "selected" : ""
  const pageLabel = pages > 1 ? ` · PAGE ${page + 1}/${pages}` : ""
  const lanePageLabel = trackMode && laneCount > VISIBLE_LANES
    ? ` · LANES ${laneOffset + 1}–${Math.min(laneCount, laneOffset + VISIBLE_LANES)}/${laneCount}`
    : ""
  const status = shift ? "SHIFT" : state.playing ? "▶" : ""
  const metro = state.metroOn ? " · METRO" : ""
  const title = trackMode ? `TRK ${trackId} SEQ${metro} ${status}` : `SEQUENCER${metro} ${status}`
  const laneHeader = trackMode
    ? laneCount
      ? `LANE ${lane + 1}/${laneCount} · ${esc(names[lane] || "")}`
      : "NO SOUND LANES"
    : `LANE ${lane + 1} ${esc(names[lane] || "")}`

  return `
    <div class="lcd-screen sequencer-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${title}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 SWING ${Math.round((seq.swing || 0) * 100)}%</span>
        <span class="green">M2 GATE ${Math.round((seq.gate || 0) * 100)}%</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body seq-body">
        <div class="seq-header ${headerCls}">
          <span class="pink">${trackMode ? esc(state.seqTrackName || `TRACK ${trackId}`) : `PATTERN ${esc(seq.current)}`}</span>
          <span class="pink">${seq.length} STEPS${pageLabel}${lanePageLabel}</span>
          <span class="pink">${laneHeader}</span>
          <span class="muted" data-seq-playhead>${ph >= 0 ? `STEP ${ph + 1}` : ""}</span>
        </div>
        <div class="seq-grid">${rows.join("")}</div>
        <div class="muted seq-hint">${trackMode
          ? laneCount
            ? "PAD = INSERT/ADD SOUND · ▲▼ LANES · D REMOVE"
            : "ASSIGN A SOUND TO A PAD · PRESS PAD TO ADD"
          : header
            ? "◀▶ PATTERN A–D · ▼ GRID"
            : shift
              ? "◀▶ MOVE LANE · OK/C DONE"
              : "ARROWS · OK STEP · HOLD OK EDIT · PAD = LANE · PLAY = PATTERN · HOLD TAP METRO"}</div>
      </div>
      <div class="lcd-soft">
        <div class="${pages > 1 ? "" : "soft-disabled"}"><span class="sk">A</span> <span class="green">PAGE</span></div>
        <div><span class="sk">B</span> <span class="green">LENGTH</span></div>
        <div><span class="sk">C</span> <span class="green">SHIFT${shift ? " ●" : ""}</span></div>
        <div class="${trackMode && !laneCount ? "soft-disabled" : ""}"><span class="sk">D</span> <span class="green">${trackMode ? "REMOVE" : "CLEAR"}</span></div>
      </div>
    </div>
  `
}

/** Screen 25: per-step velocity / gate / accent / tie / micro-shift. */
export function renderStepEdit(state) {
  const seq = state.seq || { current: "A", gate: 0.5 }
  const stepState = state.seqStep || { on: false, vel: 0.85, accent: false, tie: false, shift: 0, gate: null }
  const lane = state.seqLane || 0
  const step = state.seqCursor || 0
  const names = state.seqLaneNames || []
  const vel = Math.round((stepState.accent ? 1 : stepState.vel) * 100)
  const gate = stepState.gate ?? seq.gate
  const gatePct = Math.round(gate * 100)
  const shiftPct = Math.round((stepState.shift || 0) * 100)
  return `
    <div class="lcd-screen step-edit-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">STEP EDIT${state.metroOn ? " · METRO" : ""}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 VELOCITY ${vel}%</span>
        <span class="green">M2 GATE ${gatePct}%${stepState.gate == null ? " (PAT)" : ""}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">LANE ${lane + 1} · STEP ${step + 1} <span class="muted">${esc(names[lane] || "")} · ${esc(seq.current)}</span></div>
        <div class="edit-meter"><div class="pink">VELOCITY${stepState.accent ? " · ACCENT" : ""}</div><div class="meter-track"><div class="meter-fill" style="width:${vel}%"></div></div><div class="meter-val">${vel}%</div></div>
        <div class="edit-meter"><div class="pink">GATE</div><div class="meter-track"><div class="meter-fill" style="width:${gatePct}%"></div></div><div class="meter-val">${gatePct}%</div></div>
        <div class="green">${stepState.on ? "STEP ON" : "STEP OFF"} · ${stepState.accent ? "ACCENT" : "no accent"} · ${stepState.tie ? "TIE →" : "no tie"} · SHIFT ${shiftPct > 0 ? "+" : ""}${shiftPct}%</div>
        <div class="muted">◀▶ MICRO-SHIFT · ▲▼ STEP · OK DONE</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">OFF</span></div>
        <div><span class="sk">B</span> <span class="green">ACCENT${stepState.accent ? " ●" : ""}</span></div>
        <div><span class="sk">C</span> <span class="green">TIE${stepState.tie ? " ●" : ""}</span></div>
        <div><span class="sk">D</span> <span class="green">DONE</span></div>
      </div>
    </div>
  `
}
