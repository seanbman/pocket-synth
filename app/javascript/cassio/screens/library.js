function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderLibrary(state) {
  const tab = state.libTab || "factory"
  const cats = state.libCategories || []
  const cat = state.libCategory || cats[0] || (tab === "kits" ? "KITS" : "FACTORY / SYNTH")
  const list = state.libList || []
  const idx = Math.min(list.length - 1, Math.max(0, state.libIndex || 0))
  const sel = list[idx]
  const pick = state.libPickMode
  const m1 = sel?.macros?.m1?.label || "TONE"
  const m2 = sel?.macros?.m2?.label || "FX"
  const rows = list.map((s, i) =>
    `<div class="lib-row ${i === idx ? "selected" : ""}">${esc(s.name)}</div>`
  ).join("")

  const detail = sel ? `
    <div class="lib-detail-box">
      <div class="lib-detail-name">${esc(sel.name)}</div>
      <div class="muted">${esc(sel.kind === "kit" || sel.voice === "kit" ? "KIT" : (sel.voice || "—")).toUpperCase()} / ${esc(sel.kind === "kit" ? "PADS" : (sel.root || "C3"))}</div>
      <div class="green">M1 ${esc(sel.kind === "kit" ? "BANK" : (sel.macros?.m1?.label || "—"))}</div>
      <div class="green">M2 ${esc(sel.kind === "kit" ? "LOAD" : (sel.macros?.m2?.label || "—"))}</div>
      <div class="lib-hint">${sel.playable === false ? "NO ENGINE" : pick ? "OK → ASSIGN PAD" : sel.kind === "kit" || sel.voice === "kit" ? "OK → KIT DETAIL" : "OK DETAIL"}</div>
      <div class="muted">${pick ? `PAD ${state.padSelect || 1}` : sel.kind === "kit" || sel.voice === "kit" ? "A USE PADS ON DETAIL" : "KEYS/PADS PREVIEW"}</div>
    </div>` : `<div class="lib-detail-box muted">EMPTY</div>`

  const tabs = pick
    ? [
        ["factory", "A", "FACTORY"],
        ["user", "B", "USER"],
        ["fav", "C", "FAV"],
        ["back", "D", "BACK"]
      ].map(([id, sk, label]) => {
        const active = id !== "back" && tab === id
        return `<div class="${active ? "soft-active" : ""}"><span class="sk">${sk}</span> <span class="green">${label}</span></div>`
      }).join("")
    : [
        ["factory", "A", "FACTORY"],
        ["kits", "B", "KITS"],
        ["user", "C", "USER"],
        ["fav", "D", "FAV"]
      ].map(([id, sk, label]) =>
        `<div class="${tab === id ? "soft-active" : ""}"><span class="sk">${sk}</span> <span class="green">${label}</span></div>`
      ).join("")

  return `
    <div class="lcd-screen library-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${pick ? "PICK FOR PAD" : "SOUND LIBRARY"}</span>
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
