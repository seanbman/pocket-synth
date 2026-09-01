function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

export function renderSaveSound(state) {
  const name = state.saveName || state.focusSound?.name || "SOUND"
  const isUser = String(state.focusSound?.id || "").startsWith("user-")
    || state.focusSound?.source === "user"
  const fromPad = state.editReturnScreen === "pad-assign"
  const edited = state.editDirty ? " - EDITED" : ""
  const dLabel = fromPad ? (isUser ? "SAVE" : "TO PAD") : "SAVE"
  const dEnabled = fromPad || isUser

  return `
    <div class="lcd-screen save-screen">
      <div class="lcd-status">
        <span class="pink">BPM ${state.bpm}</span>
        <span class="status-mid">${fromPad ? "SAVE PAD SOUND" : "SAVE SOUND"}</span>
        <span class="battery" title="battery"></span>
      </div>
      <div class="lcd-macros">
        <span>M1 —</span>
        <span>M2 —</span>
        <span>M3 VOLUME</span>
      </div>
      <div class="save-body">
        <div class="sound-name">${esc(name)}${edited}</div>
        ${fromPad ? `
        <div class="muted">PAD EDITS STAY ON THIS KIT SLOT.</div>
        <div class="green">D ${isUser ? "SAVE UPDATES THE USER SOUND" : "TO PAD WRITES THIS PAD ONLY"}.</div>
        <div class="green">C SAVE AS MAKES A NEW LIBRARY SOUND.</div>
        <div class="muted">THEN SAVE THE KIT TO KEEP CHANGES.</div>
        ` : `
        <div class="muted">FACTORY PRESETS ARE READ-ONLY.</div>
        <div class="green">SAVE AS CREATES A USER SOUND</div>
        <div class="green">WITH CURRENT SHAPE / ENV / EQ / FX.</div>
        <div class="muted">EXISTING USER SOUNDS MAY BE SAVED</div>
        <div class="muted">IN PLACE WITH D = SAVE.</div>
        `}
        <div class="save-name-line"><span class="muted">NAME</span> <span class="green">${esc(state.saveName || "—")}</span></div>
        ${dEnabled ? "" : '<div class="muted">D SAVE DISABLED FOR FACTORY</div>'}
      </div>
      <div class="lcd-soft">
        <div><span class="sk">A</span> <span class="green">CANCEL</span></div>
        <div><span class="sk">B</span> <span class="green">NAME</span></div>
        <div><span class="sk">C</span> <span class="green">SAVE AS</span></div>
        <div class="${dEnabled ? "" : "soft-disabled"}"><span class="sk">D</span> <span class="green">${dLabel}</span></div>
      </div>
    </div>
  `
}
