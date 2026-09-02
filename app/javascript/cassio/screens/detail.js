function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderDetail(state) {
  const s = state.focusSound || state.sound
  const patch = state.editPatch || {}
  const root = patch.root || s?.root || "C3"
  const isKit = s?.kind === "kit" || s?.voice === "kit"
  const isSample = s?.voice === "sample"
  const voice = (s?.voice || "poly").toUpperCase()
  const isUser = s?.source === "user" || String(s?.id || "").startsWith("user-")
  const source = (s?.source || (isUser ? "user" : "factory")).toUpperCase()
  const padMode = (s?.padMode || (isKit ? "BANK" : "gate")).toUpperCase()
  const cat = s?.category || "FACTORY / SYNTH"
  const m1 = s?.macros?.m1?.label || "BRIGHT"
  const m2 = s?.macros?.m2?.label || "SPACE"
  const dLabel = isUser ? "MORE" : (state.isFavorite ? "FAVORITED" : "FAVORITE")
  const playable = s?.playable !== false
  const aLabel = isKit ? "USE PADS" : "USE KEYS"
  const bLabel = isSample ? "TRIM" : "EDIT"
  const cLabel = isKit ? (isUser ? "SAVE" : "SAVE AS") : "ASSIGN"

  return `
    <div class="lcd-screen detail-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${isKit ? "KIT DETAIL" : "SOUND DETAIL"}</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>${isKit ? "PAD BANK" : "◀▶ KEY"}</span>
        <span>${isKit ? "6 PADS" : "▲▼ OCT"}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="detail-body">
        <div class="detail-main">
          <div class="sound-name">${esc(s?.name || "—")}</div>
          <div class="muted">${esc(cat)} / ${esc(voice)}</div>
          <div class="detail-params">
            ${isKit ? `
            <div class="param-row selected">
              <span class="muted">PADS</span>
              <span class="green root-value">1–6</span>
            </div>
            <div class="param-hint">${isUser ? "A LOAD · B EDIT · C SAVE" : "A LOAD · B EDIT · C SAVE AS"}</div>
            <div class="param-row"><span class="muted">KIND</span> <span class="green">KIT</span></div>
            <div class="param-row"><span class="muted">SOURCE</span> <span class="green">${esc(source)}</span></div>
            <div class="param-row"><span class="muted">BANK</span> <span class="green">${esc(state.padBank || "—")}</span></div>
            ` : `
            <div class="param-row selected">
              <span class="muted">ROOT</span>
              <span class="green root-value">${esc(root)}</span>
            </div>
            <div class="param-hint">${isSample ? "B TRIM → SAMPLE EDIT (TRIM/TUNE/EQ/FX)" : "CHANGES THIS SOUND'S KEY"}</div>
            <div class="param-row"><span class="muted">VOICE</span> <span class="green">${esc(voice)}</span></div>
            <div class="param-row"><span class="muted">SOURCE</span> <span class="green">${esc(source)}</span></div>
            <div class="param-row"><span class="muted">PAD MODE</span> <span class="green">${esc(padMode)}</span></div>
            `}
          </div>
          ${playable ? "" : '<div class="muted">NO ENGINE — BROWSE ONLY</div>'}
        </div>
        <div class="detail-macros-box">
          ${isKit ? `
          <div class="pink">KIT</div>
          <div class="green">LOADS PAD ASSIGNMENTS</div>
          <div class="muted">KEYBOARD SOUND STAYS THE SAME.</div>
          <div class="muted" style="margin-top:0.35rem">${isUser ? "C SAVES THIS USER KIT IN PLACE." : "EDIT THEN SAVE AS USER KIT."}</div>
          ` : isSample ? `
          <div class="pink">SAMPLE</div>
          <div class="green">B OPENS TRIM / TUNE / EQ / FX</div>
          <div class="muted">OR: SOUND → SAMPLER → OK</div>
          <div class="muted" style="margin-top:0.35rem">A LOADS ONTO KEYS</div>
          ` : `
          <div class="pink">MACROS</div>
          <div class="green">M1 ${esc(s?.macros?.m1?.label || "BRIGHTNESS")}</div>
          <div class="green">M2 ${esc(s?.macros?.m2?.label || "SPACE")}</div>
          <div class="muted">EDITING FACTORY SOUND SAVES A USER COPY.</div>
          <div class="muted" style="margin-top:0.35rem">M1 ${esc(m1)} · M2 ${esc(m2)} LIVE</div>
          `}
          ${isUser ? '<div class="green" style="margin-top:0.35rem">D MORE · RENAME / DUP / DELETE</div>' : ""}
        </div>
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">${aLabel}</span></div>
        <div><span class="sk">B</span> <span class="green">${bLabel}</span></div>
        <div><span class="sk">C</span> <span class="green">${cLabel}</span></div>
        <div><span class="sk">D</span> <span class="green">${dLabel}</span></div>
      </div>
    </div>
  `
}
