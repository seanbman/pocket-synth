function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

/** Track library browser — assign into empty arrangement lane / manage named tracks. */
export function renderTrackList(state) {
  const list = state.trackLibrary || []
  const idx = Math.min(Math.max(0, state.trackListIndex || 0), Math.max(0, list.length - 1))
  const assignLane = state.trackListAssignLane
  const previewing = !!state.trackListPreviewing
  const rows = list.length
    ? list.map((t, i) => {
      const flags = [
        t.hasAudio ? "PCM" : "",
        t.hasSeq ? "SEQ" : "",
        `${t.lengthBars || 4}B`
      ].filter(Boolean).join(" · ")
      return `<div class="lib-row ${i === idx ? "selected" : ""}">${esc(t.name)} <span class="muted">${esc(flags)}</span></div>`
    }).join("")
    : `<div class="lib-row muted">NO TRACKS — A NEW</div>`

  const title = assignLane != null ? `PICK FOR LANE ${assignLane}` : "TRACK LIST"
  return `
    <div class="lcd-screen track-list-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${title}${previewing ? " · ▶" : ""}</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 —</span>
        <span class="green">M2 —</span>
        <span class="green">M3 MASTER</span>
      </div>
      <div class="edit-body">
        <div class="sound-name">${list.length} TRACK${list.length === 1 ? "" : "S"}</div>
        <div class="lib-list">${rows}</div>
        <div class="muted">▲▼ · OK SELECT · C PREVIEW · D BACK</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">NEW</span></div>
        <div><span class="sk">B</span> <span class="green">DEL</span></div>
        <div><span class="sk">C</span> <span class="green">PREVIEW${previewing ? " ●" : ""}</span></div>
        <div><span class="sk">D</span> <span class="green">BACK</span></div>
      </div>
    </div>
  `
}
