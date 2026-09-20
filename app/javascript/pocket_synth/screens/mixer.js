function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

/** Screen 26: six vertical faders — level/pan/mute/solo per loop track. */
export function renderMixer(state) {
  const tracks = state.mixerTracks || []
  const sel = state.mixerSelected || 1
  const t = tracks.find((x) => x.id === sel) || tracks[0] || {}
  const cols = tracks.map((tr) => {
    const pct = Math.round((tr.level ?? 1) * 100)
    const h = Math.max(4, Math.round(pct * 0.72))
    const flags = [
      tr.mute ? "M" : "",
      tr.solo ? "S" : "",
      tr.hasAudio ? "" : "○"
    ].filter(Boolean).join("")
    const label = esc(String(tr.name || `TRK ${tr.id}`).split(" ").pop())
    return `
      <div class="mix-col ${tr.id === sel ? "sel" : ""}">
        <div class="mix-fader"><div class="mix-fill" style="height:${h}%"></div></div>
        <div class="mix-val">${String(pct).padStart(2, "0")}</div>
        <div class="mix-name">${label}${flags ? ` <span class="muted">${flags}</span>` : ""}</div>
      </div>`
  }).join("")

  return `
    <div class="lcd-screen mixer-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">MIX</span>
        <span class="battery"></span>
      </div>
      <div class="lcd-macros">
        <span class="green">M1 TRACK ${Math.round((t.level ?? 1) * 100)}%</span>
        <span class="green">M2 PAN ${Math.round((t.pan ?? 0) * 100)}</span>
        <span class="green">M3 VOLUME</span>
      </div>
      <div class="mix-body">
        <div class="mix-grid">${cols}</div>
        <div class="muted mix-hint">▲▼◀▶ SELECT · PAD 1–6 · M1 LVL M2 PAN</div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">MUTE${t.mute ? " ●" : ""}</span></div>
        <div><span class="sk">B</span> <span class="green">SOLO${t.solo ? " ●" : ""}</span></div>
        <div><span class="sk">C</span> <span class="green">RESET</span></div>
        <div><span class="sk">D</span> <span class="green">LOOP</span></div>
      </div>
    </div>
  `
}
