function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderLibrary(state) {
  const tab = state.libTab || "factory"
  const cats = state.libCategories || []
  const cat = state.libCategory || cats[0] || "FACTORY / SYNTH"
  const list = state.libList || []
  const idx = Math.min(list.length - 1, Math.max(0, state.libIndex || 0))
  const sel = list[idx]
  const m1 = sel?.macros?.m1?.label || "TONE"
  const m2 = sel?.macros?.m2?.label || "FX"
  const rows = list.map((s, i) =>
    `<div class="lib-row ${i === idx ? "selected" : ""}">${esc(s.name)}</div>`
  ).join("")

  const detail = sel ? `
    <div class="lib-detail-box">
      <div class="lib-detail-name">${esc(sel.name)}</div>
      <div class="muted">${esc(sel.voice || "—").toUpperCase()} / ${esc(sel.root || "C3")}</div>
      <div class="green">M1 ${esc(sel.macros?.m1?.label || "—")}</div>
      <div class="green">M2 ${esc(sel.macros?.m2?.label || "—")}</div>
      <div class="lib-hint">${sel.playable === false ? "NO ENGINE" : "OK DETAIL"}</div>
      <div class="muted">KEYS/PADS PREVIEW</div>
    </div>` : `<div class="lib-detail-box muted">EMPTY</div>`

  const tabs = [
    ["factory", "FACTORY"],
    ["user", "USER"],
    ["rec", "REC"],
    ["fav", "FAV"]
  ].map(([id, label]) =>
    `<div class="${tab === id ? "soft-active" : ""}"><span class="sk">`
    + `${id === "factory" ? "A" : id === "user" ? "B" : id === "rec" ? "C" : "D"}`
    + `</span> <span class="green">${label}</span></div>`
  ).join("")

  return `
    <div class="lcd-screen library-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">SOUND LIBRARY</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 PREVIEW ${esc(m1)}</span>
        <span>M2 PREVIEW ${esc(m2)}</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="lib-body">
        <div class="lib-list-pane">
          <div class="pink lib-cat">${esc(cat)}</div>
          <div class="lib-list">${rows || '<div class="muted">EMPTY</div>'}</div>
        </div>
        ${detail}
      </div>
      <div class="lcd-soft">${tabs}</div>
    </div>
  `
}
