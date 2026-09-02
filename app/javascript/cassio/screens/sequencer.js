function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

const PAGE = 16

/** Screen 24: 6-lane × 16-step grid, pattern header row, playhead column. */
export function renderSequencer(state) {
  const seq = state.seq || { current: "A", length: 16, swing: 0, gate: 0.5, lanes: [] }
  const lane = state.seqLane || 0
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
  const laneStart = trackMode ? lane : 0
  const laneEnd = trackMode ? lane + 1 : 6
  for (let l = laneStart; l < laneEnd; l++) {
    const steps = seq.lanes?.[l] || []
    const cells = []
    for (let c = 0; c < PAGE; c++) {
      const i = page * PAGE + c
      const st = steps[i]
      const cls = [
        "seq-cell",
        st?.on ? "on" : "",
        st?.accent ? "accent" : "",
        st?.tie ? "tie" : "",
        l === lane ? "lane-sel" : "",
        !header && l === lane && c === cursorCol ? "cursor" : "",
        c === phCol ? "playhead" : "",
        c % 4 === 0 ? "beat" : "",
        i >= seq.length ? "off-range" : ""
      ].filter(Boolean).join(" ")
      cells.push(`<span class="${cls}" data-seq-col="${c}"></span>`)
    }
    rows.push(`<div class="seq-row ${l === lane ? "sel" : ""}"><span class="seq-lane-n">${l + 1}</span>${cells.join("")}</div>`)
  }

  const headerCls = header ? "selected" : ""
  const pageLabel = pages > 1 ? ` · PAGE ${page + 1}/${pages}` : ""
  const status = shift ? "SHIFT" : state.playing ? "▶" : ""
  const title = trackMode ? `TRK ${trackId} SEQ ${status}` : `SEQUENCER ${status}`

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
          <span class="pink">${trackMode ? `TRACK ${trackId}` : `PATTERN ${esc(seq.current)}`}</span>
          <span class="pink">${seq.length} STEPS${pageLabel}</span>
          <span class="pink">${trackMode ? esc(state.seqTrackName || names[lane] || "") : `LANE ${lane + 1} ${esc(names[lane] || "")}`}</span>
          <span class="muted" data-seq-playhead>${ph >= 0 ? `STEP ${ph + 1}` : ""}</span>
        </div>
        <div class="seq-grid">${rows.join("")}</div>
        <div class="muted seq-hint">${trackMode ? "PAD SOUND · PLAYS ON LOOP · ARROWS · OK STEP" : header ? "◀▶ PATTERN A–D · ▼ GRID" : shift ? "◀▶ MOVE LANE · OK/C DONE" : "ARROWS · OK STEP · HOLD OK EDIT · PAD = LANE"}</div>
      </div>
      <div class="lcd-soft">
        <div class="${pages > 1 ? "" : "soft-disabled"}"><span class="sk">A</span> <span class="green">PAGE</span></div>
        <div><span class="sk">B</span> <span class="green">LENGTH</span></div>
        <div><span class="sk">C</span> <span class="green">SHIFT${shift ? " ●" : ""}</span></div>
        <div><span class="sk">D</span> <span class="green">CLEAR</span></div>
      </div>
    </div>
  `
}

/** Screen 25: per-step velocity / gate / accent / tie / micro-shift. */
export function renderStepEdit(state) {
  const seq = state.seq || { current: "A", gate: 0.5 }
  const st = state.seqStep || { on: false, vel: 0.85, accent: false, tie: false, shift: 0, gate: null }
  const lane = state.seqLane || 0
  const step = state.seqCursor || 0
  const names = state.seqLaneNames || []
  const vel = Math.round((st.accent ? 1 : st.vel) * 100)
  const gate = st.gate ?? seq.gate
  const gatePct = Math.round(gate * 100)
  const shiftPct = Math.round((st.shift || 0) * 100)
  return `
    <div class="lcd-screen step-edit-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">STEP EDIT</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 VELOCITY ${vel}%</span>
        <span class="green">M2 GATE ${gatePct}%${st.gate == null ? " (PAT)" : ""}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">LANE ${lane + 1} · STEP ${step + 1} <span class="muted">${esc(names[lane] || "")} · PATTERN ${esc(seq.current)}</span></div>
        <div class="edit-meter"><div class="pink">VELOCITY${st.accent ? " · ACCENT" : ""}</div><div class="meter-track"><div class="meter-fill" style="width:${vel}%"></div></div><div class="meter-val">${vel}%</div></div>
        <div class="edit-meter"><div class="pink">GATE</div><div class="meter-track"><div class="meter-fill" style="width:${gatePct}%"></div></div><div class="meter-val">${gatePct}%</div></div>
        <div class="green">${st.on ? "STEP ON" : "STEP OFF"} · ${st.accent ? "ACCENT" : "no accent"} · ${st.tie ? "TIE →" : "no tie"} · SHIFT ${shiftPct > 0 ? "+" : ""}${shiftPct}%</div>
        <div class="muted">◀▶ MICRO-SHIFT · ▲▼ STEP · OK DONE</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">OFF</span></div>
        <div><span class="sk">B</span> <span class="green">ACCENT${st.accent ? " ●" : ""}</span></div>
        <div><span class="sk">C</span> <span class="green">TIE${st.tie ? " ●" : ""}</span></div>
        <div><span class="sk">D</span> <span class="green">DONE</span></div>
      </div>
    </div>
  `
}
